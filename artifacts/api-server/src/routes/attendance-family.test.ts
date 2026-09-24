import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  queryCalls: [] as Array<{ sql: string; values: unknown[] }>,
  parent: { userId: 100, schoolId: 1, status: "ACTIVE" },
  relationships: [
    { parentUserId: 100, studentId: 11, status: "ACTIVE" },
    { parentUserId: 101, studentId: 22, status: "ACTIVE" },
    { parentUserId: 100, studentId: 33, status: "ACTIVE" },
  ],
  students: [
    { id: 11, schoolId: 1, userId: 200 },
    { id: 22, schoolId: 1, userId: 201 },
    { id: 33, schoolId: 2, userId: 202 },
  ],
  events: [
    {
      id: 501,
      studentId: 11,
      schoolId: 1,
      date: "2025-03-04",
      eventType: "SCHOOL_ENTRY",
      status: "PRESENT",
      occurredAt: "2025-03-04T08:00:00.000Z",
      identificationMethod: "NFC",
      discrepancyStatus: null,
    },
  ],
}));

const poolMock = vi.hoisted(() => ({
  query: vi.fn(async (sql: string, values: unknown[] = []) => {
    state.queryCalls.push({ sql, values });
    if (sql.includes("FROM parents p")) {
      const userId = Number(values[0]);
      const studentId = Number(values[1]);
      const link = state.relationships.find(
        (relationship) =>
          relationship.parentUserId === userId &&
          relationship.studentId === studentId &&
          relationship.status === "ACTIVE",
      );
      const student = state.students.find((candidate) => candidate.id === studentId);
      if (
        !link ||
        state.parent.userId !== userId ||
        state.parent.status !== "ACTIVE" ||
        !student ||
        state.parent.schoolId !== student.schoolId
      ) {
        return { rows: [] };
      }
      return { rows: [{ studentId: student.id, schoolId: student.schoolId }] };
    }
    if (sql.includes("FROM students st")) {
      const student = state.students.find((candidate) => candidate.userId === Number(values[0]));
      return { rows: student ? [{ studentId: student.id, schoolId: student.schoolId }] : [] };
    }
    if (sql.includes("FROM attendance_events ae")) {
      return { rows: state.events };
    }
    throw new Error(`Unhandled pool query: ${sql}`);
  }),
}));

vi.mock("@workspace/db", () => ({ pool: poolMock }));
vi.mock("../middlewares/auth", () => {
  class AuthError extends Error {
    constructor(public readonly statusCode: number, message: string) {
      super(message);
    }
  }
  return {
    AuthError,
    assertRoles: (req: express.Request, roles: string[]) => {
      const context = (req as any).edupulseUser;
      if (!context?.roles.some((assignment: any) => roles.includes(assignment.role))) {
        throw new AuthError(403, "Not authorized");
      }
      return context;
    },
    getUserContext: (req: express.Request) => (req as any).edupulseUser,
    handleAuthError: (error: any, _req: express.Request, res: express.Response) =>
      res.status(error.statusCode ?? 500).json({ error: error.message }),
    requireAuthentication: () => (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      const role = req.header("x-test-role") ?? "PARENT";
      const userId = Number(req.header("x-test-user-id") ?? (role === "STUDENT" ? 200 : 100));
      (req as any).edupulseUser = {
        user: { id: userId },
        roles: [{ role, schoolId: role === "PARENT" ? 1 : 1, status: "ACTIVE" }],
      };
      next();
    },
  };
});

import attendanceFamilyRouter from "./attendance-family";

const app = express();
app.use(attendanceFamilyRouter);
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

afterAll(async () =>
  new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  ),
);

beforeEach(() => {
  state.queryCalls.length = 0;
  state.parent = { userId: 100, schoolId: 1, status: "ACTIVE" };
  state.relationships[0].status = "ACTIVE";
});

async function call(path: string, role = "PARENT", userId?: number) {
  return fetch(`${baseUrl}${path}`, {
    headers: {
      "x-test-role": role,
      ...(userId === undefined ? {} : { "x-test-user-id": String(userId) }),
    },
  });
}

describe("family attendance read access", () => {
  it("returns only attendance fields for an actively linked child", async () => {
    const response = await call("/parent/children/11/attendance?from=2025-03-01&to=2025-03-31");
    expect(response.status).toBe(200);
    const rows = await response.json();
    expect(rows).toEqual(state.events);
    const attendanceQuery = state.queryCalls.find(({ sql }) => sql.includes("FROM attendance_events ae"));
    expect(attendanceQuery?.values).toEqual([11, 1, "2025-03-01", "2025-03-31"]);
    expect(attendanceQuery?.sql).toContain("LIMIT 500");
    expect(attendanceQuery?.sql).not.toMatch(/device_id|nfc_card_id|biometric|actor_user_id|failure_reason/i);
  });

  it("returns 404 for unrelated child IDs and children linked across schools", async () => {
    expect((await call("/parent/children/22/attendance")).status).toBe(404);
    expect((await call("/parent/children/33/attendance")).status).toBe(404);
    expect(state.queryCalls.some(({ sql }) => sql.includes("FROM attendance_events ae"))).toBe(false);
  });

  it("requires an active parent profile and an active relationship", async () => {
    state.parent.status = "INACTIVE";
    expect((await call("/parent/children/11/attendance")).status).toBe(404);
    state.parent.status = "ACTIVE";
    state.relationships[0].status = "INACTIVE";
    expect((await call("/parent/children/11/attendance")).status).toBe(404);
  });

  it("resolves student attendance only by the authenticated user's own student profile", async () => {
    const response = await call("/student/attendance", "STUDENT", 200);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(state.events);
    const ownProfileLookup = state.queryCalls.find(({ sql }) => sql.includes("FROM students st"));
    expect(ownProfileLookup?.values).toEqual([200]);
    expect((await call("/student/attendance", "PARENT", 100)).status).toBe(403);
  });

  it("allows the explicit student ID only when it matches the authenticated user's profile", async () => {
    const ownResponse = await call("/student/attendance/11?from=2025-03-01", "STUDENT", 200);
    expect(ownResponse.status).toBe(200);
    expect(await ownResponse.json()).toEqual(state.events);
    const attendanceQuery = state.queryCalls.find(({ sql }) => sql.includes("FROM attendance_events ae"));
    expect(attendanceQuery?.values).toEqual([11, 1, "2025-03-01"]);

    state.queryCalls.length = 0;
    expect((await call("/student/attendance/22", "STUDENT", 200)).status).toBe(404);
    expect((await call("/student/attendance/33", "STUDENT", 200)).status).toBe(404);
    expect((await call("/student/attendance/not-an-id", "STUDENT", 200)).status).toBe(404);
    expect(state.queryCalls.some(({ sql }) => sql.includes("FROM attendance_events ae"))).toBe(false);
  });

  it("rejects malformed and reversed date filters", async () => {
    expect((await call("/parent/children/11/attendance?from=2025-02-30")).status).toBe(400);
    expect((await call("/student/attendance?from=2025-03-10&to=2025-03-01", "STUDENT", 200)).status).toBe(400);
  });
});