import express from "express";
import type { Server } from "node:http";
import { writeFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pool } from "@workspace/db";
import { prepareTransportFixture } from "../test-support/targeted-transport-fixture";

// Only the identity boundary is simulated here. All normal RBAC helpers,
// transport routes, transactions and SQL execute against verified Development.
vi.mock("../middlewares/auth", async (load) => {
  const actual = await load<typeof import("../middlewares/auth")>();
  return { ...actual, requireAuthentication: () => (_req: any, _res: any, next: any) => next() };
});
import router from "./transport";

describe.runIf(process.env.EDUCORE_TRANSPORT_NATIVE === "1")("Development transport persistence and scoped routed reads", () => {
  let fixture: Awaited<ReturnType<typeof prepareTransportFixture>>;
  let server: Server;
  let base: string;
  let assignmentId: number;
  const date = new Date().toISOString().slice(0, 10);

  async function request(actor: string, path: string, method = "GET", body?: unknown) {
    const result = await fetch(`${base}${path}`, {
      method, headers: { "Content-Type": "application/json", "x-qa-actor": actor },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data: any = await result.json();
    return { status: result.status, data };
  }
  function input(studentId: number, route = "A") {
    return { studentId, routeId: fixture.routes[route],
      pickupStopId: fixture.stops[route].pickup, dropoffStopId: fixture.stops[route].dropoff,
      effectiveDate: date, reason: "Labelled Development transport QA" };
  }
  function endpoint(path: string) { return `${path}?schoolId=${fixture.schoolId}`; }

  beforeAll(async () => {
    fixture = await prepareTransportFixture();
    const app = express();
    app.use(express.json());
    app.use(async (req, res, next) => {
      const actor = fixture.actors[String(req.headers["x-qa-actor"])];
      if (!actor) { res.status(401).json({ error: "QA identity required" }); return; }
      const memberships = await pool.query(
        `SELECT id,role,school_id AS "schoolId",status FROM school_memberships WHERE user_id=$1`,
        [actor.userId],
      );
      (req as any).edupulseUser = {
        user: { id: actor.userId, clerkUserId: actor.clerkUserId, email: actor.email,
          firstName: "Transport QA", lastName: "Fixture", phone: null, status: "ACTIVE" },
        roles: memberships.rows,
      };
      // The production error handler uses structured logging.
      (req as any).log = { warn() {}, error() {}, info() {} };
      next();
    });
    app.use("/api", router);
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    const address = server.address() as { port: number };
    base = `http://127.0.0.1:${address.port}/api`;
  }, 90000);
  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
  });

  it("loads existing same-school students by database ID with class and guardians", async () => {
    const result = await request("admin", endpoint("/transport/students"));
    expect(result.status).toBe(200);
    expect(result.data).toHaveLength(2);
    expect(result.data[0].guardians[0].name).toContain("Transport QA parent");
    expect(result.data.map((s: any) => s.studentId)).toContain(fixture.actors.student1.studentId);
  });
  it("loads existing school buses, DRIVER employees and route-bound stops", async () => {
    for (const path of ["/transport/buses", "/transport/drivers", "/transport/routes"]) {
      const result = await request("admin", endpoint(path));
      expect(result.status).toBe(200);
      expect(result.data).toHaveLength(2);
    }
  });
  it("denies a cross-school combination at the backend", async () => {
    const result = await request("admin",
      `/transport/assignments?schoolId=${fixture.otherSchoolId}`, "POST", input(fixture.actors.student1.studentId));
    expect(result.status).toBe(404);
  });
  it("denies a stop from another route", async () => {
    const result = await request("admin", endpoint("/transport/assignments"), "POST",
      { ...input(fixture.actors.student1.studentId), pickupStopId: fixture.stops.B.pickup });
    expect(result.status).toBe(400);
  });
  it("saves the existing student to route/bus/driver without another student or parent", async () => {
    const result = await request("admin", endpoint("/transport/assignments"), "POST", input(fixture.actors.student1.studentId));
    expect(result.status, JSON.stringify(result.data)).toBe(201);
    assignmentId = result.data.id;
    expect(result.data.busId).toBe(fixture.buses.A);
    expect(result.data.driverEmployeeId).toBe(fixture.actors.driverA.employeeId);
    expect(Number((await pool.query("SELECT count(*) FROM students WHERE school_id=$1", [fixture.schoolId])).rows[0].count)).toBe(2);
  });
  it("retrieves the committed assignment on a fresh database connection and new HTTP read", async () => {
    const client = await pool.connect();
    try {
      const stored = await client.query("SELECT student_id,route_id FROM transport_student_assignments WHERE id=$1", [assignmentId]);
      expect(stored.rows[0]).toEqual({ student_id: fixture.actors.student1.studentId, route_id: fixture.routes.A });
    } finally { client.release(); }
    const result = await request("admin", endpoint(`/transport/assignments/${assignmentId}`));
    expect(result.status).toBe(200);
    expect(result.data.id).toBe(assignmentId);
  });
  it("student sees only their own transport after saving", async () => {
    const result = await request("student1", "/student/transport");
    expect(result.status, JSON.stringify(result.data)).toBe(200);
    expect(result.data.assignment.id).toBe(assignmentId);
    expect((await request("student2", "/student/transport")).data.assignment).toBeNull();
  });
  it("parent resolves each owned child independently and denies an unrelated parent", async () => {
    const own = await request("parent", `/parent/children/${fixture.actors.student1.studentId}/transport`);
    expect(own.status).toBe(200);
    expect(own.data.assignment.id).toBe(assignmentId);
    const sibling = await request("parent", `/parent/children/${fixture.actors.student2.studentId}/transport`);
    expect(sibling.status).toBe(200);
    expect(sibling.data.assignment).toBeNull();
    expect((await request("otherParent", `/parent/children/${fixture.actors.student1.studentId}/transport`)).status).toBe(404);
  });
  it("assigned driver sees their own rider and the other driver does not", async () => {
    expect((await request("driverA", "/driver/transport")).data.assignments.map((a: any) => a.studentId))
      .toEqual([fixture.actors.student1.studentId]);
    expect((await request("driverB", "/driver/transport")).data.assignments).toEqual([]);
  });
  it("driver cannot browse the school-wide rider directory or mutate assignments", async () => {
    expect((await request("driverA", endpoint("/transport/students"))).status).toBe(404);
    expect((await request("driverA", endpoint("/transport/assignments"), "POST", input(fixture.actors.student2.studentId))).status).toBe(404);
  });
  it("family term/session choices use their scoped school without catalog permissions", async () => {
    const own = await request("student1", "/student/attendance-periods");
    expect(own.status).toBe(200);
    expect(own.data.sessions).toHaveLength(1);
    expect(own.data.terms).toHaveLength(1);
    expect((await request("parent", `/parent/children/${fixture.actors.student2.studentId}/attendance-periods`)).status).toBe(200);
    expect((await request("otherParent", `/parent/children/${fixture.actors.student2.studentId}/attendance-periods`)).status).toBe(404);
  });
  it("prevents duplicate active assignment", async () => {
    expect((await request("admin", endpoint("/transport/assignments"), "POST", input(fixture.actors.student1.studentId))).status).toBe(409);
  });
  it("prevents exceeding capacity including reserved riders", async () => {
    const result = await request("admin", endpoint("/transport/assignments"), "POST", input(fixture.actors.student2.studentId));
    expect(result.status).toBe(409);
    expect(result.data.error).toMatch(/capacity/i);
  });
  it("reassigns the rider while retaining historical assignment evidence", async () => {
    const result = await request("admin", endpoint(`/transport/assignments/${assignmentId}`), "PATCH",
      { ...input(fixture.actors.student1.studentId, "B"), studentId: undefined });
    expect(result.status, JSON.stringify(result.data)).toBe(200);
    assignmentId = result.data.id;
    expect(result.data.busId).toBe(fixture.buses.B);
    expect((await request("admin", endpoint(`/transport/assignments/${assignmentId}/history`))).data.length).toBeGreaterThan(0);
  });
  it("old driver loses active rider and new driver gains it after reassignment", async () => {
    expect((await request("driverA", "/driver/transport")).data.assignments).toEqual([]);
    expect((await request("driverB", "/driver/transport")).data.assignments.map((a: any) => a.studentId))
      .toEqual([fixture.actors.student1.studentId]);
  });
  it("family refresh reads the new bus without stale relationships", async () => {
    expect((await request("student1", "/student/transport")).data.assignment.busName).toContain("Bus-B");
    expect((await request("parent", `/parent/children/${fixture.actors.student1.studentId}/transport`)).data.assignment.busName)
      .toContain("Bus-B");
  });
  it("refuses new riders on an inactive bus", async () => {
    await pool.query("UPDATE transport_buses SET status='INACTIVE' WHERE id=$1 AND school_id=$2", [fixture.buses.A, fixture.schoolId]);
    try {
      expect((await request("admin", endpoint("/transport/assignments"), "POST", input(fixture.actors.student2.studentId))).status).toBe(409);
    } finally { await pool.query("UPDATE transport_buses SET status='ACTIVE' WHERE id=$1 AND school_id=$2", [fixture.buses.A, fixture.schoolId]); }
  });
  it("refuses new riders and portal reads when driver employment is inactive", async () => {
    await pool.query("UPDATE employees SET employment_status='INACTIVE' WHERE id=$1 AND school_id=$2", [fixture.actors.driverA.employeeId, fixture.schoolId]);
    try {
      expect((await request("admin", endpoint("/transport/assignments"), "POST", input(fixture.actors.student2.studentId))).status).toBe(409);
      expect((await request("driverA", "/driver/transport")).status).toBe(404);
    } finally { await pool.query("UPDATE employees SET employment_status='ACTIVE' WHERE id=$1 AND school_id=$2", [fixture.actors.driverA.employeeId, fixture.schoolId]); }
  });
  it("retains labelled fixtures and history for the real-browser pass, never deleting working data", async () => {
    // Browser starts with student1 unassigned and student2 on Bus A.
    const second = await request("admin", endpoint("/transport/assignments"), "POST", input(fixture.actors.student2.studentId));
    expect(second.status).toBe(201);
    const deactivated = await request("admin", endpoint(`/transport/assignments/${assignmentId}`), "PATCH",
      { action: "DEACTIVATE", status: "DEACTIVATED", effectiveDate: date, reason: "Prepare labelled browser verification" });
    expect(deactivated.status).toBe(200);
    await writeFile(".local/test-fixtures/targeted-transport.json", JSON.stringify({ ...fixture,
      nativeChecked: true, priorAssignmentId: assignmentId, siblingAssignmentId: second.data.id }, null, 2));
  });
});