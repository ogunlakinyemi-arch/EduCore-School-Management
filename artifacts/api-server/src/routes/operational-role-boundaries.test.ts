import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "PLATFORM_OWNER",
  queries: [] as Array<{ sql: string; values: unknown[] }>,
  parentStatus: "PENDING",
  linkedParentUserId: null as number | null,
  availableChildIds: [11] as number[],
}));

const poolMock = vi.hoisted(() => ({
  query: vi.fn(async (sql: string, values: unknown[] = []) => {
    state.queries.push({ sql, values });
    return { rows: [] };
  }),
  connect: vi.fn(async () => ({
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      state.queries.push({ sql, values });
      if (sql.includes("SELECT p.id,p.user_id,p.status AS \"parentStatus\"")) return {
        rows: [{
          id: 44,
          user_id: state.linkedParentUserId,
          parentStatus: state.parentStatus,
          accountStatus: state.linkedParentUserId ? "ACTIVE" : null,
        }],
      };
      if (sql.includes("SELECT id FROM students WHERE school_id=$1 AND id=ANY($2::int[])")) {
        const requested = Array.isArray(values[1]) ? values[1] as number[] : [];
        return { rows: requested.filter(id => state.availableChildIds.includes(id)).map(id => ({ id })) };
      }
      if (sql.includes("COALESCE(MAX((substring(admission_no")) return { rows: [{ sequence: 0 }] };
      if (sql.includes("INSERT INTO students (school_id, admission_no, email")) return {
        rows: [{
          id: 45, schoolId: values[0], admissionNo: values[1], email: values[2],
          firstName: values[3], lastName: values[4], gender: values[15],
          className: values[16], section: values[17], status: "ACTIVE",
        }],
      };
      if (sql.includes("SELECT id FROM students")) return { rows: [{ id: 11 }] };
      if (sql.includes("SELECT id FROM nfc_cards")) return { rows: [] };
      if (sql.includes("SELECT nc.school_id AS")) return {
        rows: [{ schoolId: 1, status: "locked", studentId: 11 }],
      };
      if (sql.includes("INSERT INTO nfc_cards")) return {
        rows: [{ id: 41, schoolId: Number(values[0]), uid: values[1], studentId: values[2],
          status: values[3] ?? "locked", scans: 0, lastScan: null }],
      };
      if (sql.includes("UPDATE nfc_cards")) return {
        rows: [{ id: 41, schoolId: 1, uid: "CARD-41", studentId: 11, status: values[0], scans: 0, lastScan: null }],
      };
      return { rows: [] };
    }),
    release: vi.fn(),
  })),
}));

vi.mock("@workspace/db", () => ({ pool: poolMock }));
vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      const role = state.role as any;
      (req as any).edupulseUser = {
        user: {
          id: 12,
          clerkUserId: `clerk-${role}`,
          email: `${role.toLowerCase()}@example.test`,
          firstName: "Test",
          lastName: "User",
          phone: null,
          status: "ACTIVE",
        },
        roles: [{
          id: 1,
          role,
          schoolId: role === "PLATFORM_OWNER" ? null : 1,
          status: "ACTIVE",
        }],
      };
      next();
    },
  };
});

import edupulseRouter from "./edupulse";
import peopleRouter from "./people";
import { AuthError } from "../middlewares/auth";

const app = express();
app.use(express.json());
app.use(edupulseRouter);
app.use(peopleRouter);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof AuthError) return res.status(error.statusCode).json({ error: error.message });
  return res.status(500).json({ error: String(error) });
});

let server: ReturnType<typeof app.listen>;
let baseUrl = "";

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address !== "string") baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

afterAll(async () => new Promise<void>((resolve, reject) =>
  server.close((error) => (error ? reject(error) : resolve())),
));

beforeEach(() => {
  state.role = "PLATFORM_OWNER";
  state.queries.length = 0;
  state.parentStatus = "PENDING";
  state.linkedParentUserId = null;
  state.availableChildIds = [11];
  poolMock.query.mockClear();
  poolMock.connect.mockClear();
});

async function call(path: string, method = "GET", body?: Record<string, unknown>) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

describe("Platform Owner school-operation boundaries", () => {
  it("preserves platform-owner school and student read access", async () => {
    expect((await call("/schools")).status).toBe(200);
    expect((await call("/students?schoolId=1")).status).toBe(200);
  });

  it("accepts the Student Directory's uppercase default status and rejects lowercase active", async () => {
    expect((await call("/students?schoolId=1&status=ACTIVE")).status).toBe(200);
    expect((await call("/students?schoolId=1&status=active")).status).toBe(400);
  });

  it("generates optional admission numbers within school scope and persists the student email", async () => {
    state.role = "SCHOOL_ADMIN";
    const response = await call("/students?schoolId=1", "POST", {
      firstName: "Amina",
      lastName: "Bello",
      email: "amina@example.test",
      gender: "female",
      className: "Primary 1",
      section: "A",
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ admissionNo: "ADM-1-000001", email: "amina@example.test" });
    const insert = state.queries.find(({ sql }) => sql.includes("INSERT INTO students (school_id, admission_no, email"));
    expect(insert?.values.slice(0, 3)).toEqual([1, "ADM-1-000001", "amina@example.test"]);
    expect(state.queries.some(({ sql }) => sql === "COMMIT")).toBe(true);
  });

  it("preserves the explicit Platform Owner NFC assignment exception with tenant-bound writes", async () => {
    const response = await call("/cards?schoolId=1", "POST", { uid: "CARD-OWNER", studentId: 11 });
    expect(response.status).toBe(201);
    const cardInsert = state.queries.find(({ sql }) => sql.includes("INSERT INTO nfc_cards"));
    expect(cardInsert?.values.slice(0, 3)).toEqual([1, "CARD-OWNER", 11]);
  });

  it("denies Platform Owner writes to students, parents, classes, and ordinary school employees", async () => {
    const deniedRequests: Array<[string, Record<string, unknown>]> = [
      ["/students?schoolId=1", {
        admissionNo: "A-1", firstName: "Ada", lastName: "Okafor",
        gender: "female", className: "Primary 1", section: "A",
      }],
      ["/parents?schoolId=1", { name: "Parent User", email: "parent@example.test", phone: "1234567890" }],
      ["/classes?schoolId=1", { name: "Primary 1", section: "A", capacity: 30 }],
      ["/employees?schoolId=1", {
        employeeId: "EMP-1", firstName: "School", lastName: "Teacher", type: "TEACHER",
      }],
    ];

    for (const [path, body] of deniedRequests) {
      const before = state.queries.filter(({ sql }) => !sql.includes("audit_logs")).length;
      const response = await call(path, "POST", body);
      expect(response.status, path).toBe(404);
      expect(state.queries.filter(({ sql }) => !sql.includes("audit_logs")).length, path).toBe(before);
    }
  });

  it("does not grant a global owner membership in a school for operational authorization", async () => {
    const response = await call("/parents?schoolId=1", "POST", {
      name: "Parent User", email: "parent@example.test", phone: "1234567890",
    });
    expect(response.status).toBe(404);
    expect(state.queries.some(({ sql }) => sql.includes("INSERT INTO parents"))).toBe(false);
  });
});

describe("existing pending-parent child links", () => {
  it("allows a School Admin to attach only active same-school students to an unlinked pending parent profile", async () => {
    state.role = "SCHOOL_ADMIN";
    const response = await call(
      "/parents/44/children?schoolId=1",
      "POST",
      { studentIds: [11], relationshipType: "Guardian" },
    );
    expect(response.status).toBe(200);
    expect(state.queries.some(({ sql }) =>
      sql.includes("INSERT INTO parent_student_relationships(parent_id,student_id,relationship_type,status)"))).toBe(true);
    expect(state.queries.some(({ sql }) => sql === "COMMIT")).toBe(true);
    expect(state.queries.find(({ sql }) => sql.includes("id=ANY($2::int[])"))?.sql).toContain("upper(status)='ACTIVE'");

    state.queries.length = 0;
    const unavailable = await call(
      "/parents/44/children?schoolId=1",
      "POST",
      { studentIds: [12], relationshipType: "Guardian" },
    );
    expect(unavailable.status).toBe(404);
    expect(state.queries.some(({ sql }) => sql.includes("INSERT INTO parent_student_relationships"))).toBe(false);
    expect(state.queries).toContainEqual({ sql: "ROLLBACK", values: [] });
  });
});