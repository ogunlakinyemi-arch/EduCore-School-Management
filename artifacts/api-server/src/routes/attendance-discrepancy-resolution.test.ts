import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  discrepancy: {
    id: 401,
    school_id: 1,
    student_id: 11,
    attendance_event_id: 101,
    discrepancy_type: "EXIT_WITHOUT_ENTRY",
    status: "OPEN",
    details: { note: "Original discrepancy detail" } as Record<string, any>,
    resolved_by: null as number | null,
    resolved_at: null as string | null,
    created_at: "2025-02-03T08:00:00.000Z",
  },
  transactions: [] as string[],
  audit: [] as unknown[][],
}));

const poolMock = vi.hoisted(() => {
  const result = (rows: any[] = []) => ({ rows, rowCount: rows.length });
  const client = {
    query: vi.fn(async (sql: string, values: any[] = []) => {
      if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) {
        state.transactions.push(sql);
        return result();
      }
      if (sql.includes("FROM attendance_discrepancies") && sql.includes("FOR UPDATE")) {
        return result(state.discrepancy.id === Number(values[0]) ? [{ ...state.discrepancy }] : []);
      }
      if (sql.includes("UPDATE attendance_discrepancies")) {
        state.discrepancy.status = String(values[0]);
        state.discrepancy.resolved_by = Number(values[1]);
        state.discrepancy.resolved_at = "2025-02-03T09:00:00.000Z";
        state.discrepancy.details = {
          ...state.discrepancy.details,
          reason: values[2],
          previousStatus: values[3],
          newStatus: values[0],
          resolutionHistory: [{
            reason: values[2],
            previousStatus: values[3],
            newStatus: values[0],
            resolvedBy: Number(values[1]),
            resolvedAt: state.discrepancy.resolved_at,
          }],
        };
        return result([{
          id: state.discrepancy.id,
          schoolId: state.discrepancy.school_id,
          studentId: state.discrepancy.student_id,
          attendanceEventId: state.discrepancy.attendance_event_id,
          discrepancyType: state.discrepancy.discrepancy_type,
          status: state.discrepancy.status,
          details: state.discrepancy.details,
          resolvedBy: state.discrepancy.resolved_by,
          resolvedAt: state.discrepancy.resolved_at,
          createdAt: state.discrepancy.created_at,
        }]);
      }
      if (sql.includes("INSERT INTO audit_logs")) {
        state.audit.push(values);
        return result();
      }
      throw new Error(`Unhandled client query: ${sql}`);
    }),
    release: vi.fn(),
  };
  return {
    client,
    connect: vi.fn(async () => client),
  };
});

vi.mock("@workspace/db", () => ({ pool: { connect: poolMock.connect } }));
vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const role = String(req.header("x-test-role") ?? "SCHOOL_ADMIN") as any;
      const schoolId = role === "PLATFORM_OWNER" ? null : Number(req.header("x-test-school") ?? 1);
      (req as any).edupulseUser = {
        user: {
          id: 10,
          clerkUserId: "test-user",
          email: "admin@example.test",
          firstName: "Test",
          lastName: "Admin",
          phone: null,
          status: "ACTIVE",
        },
        roles: [{ id: 1, role, schoolId, status: "ACTIVE" }],
      };
      next();
    },
  };
});

import discrepancyResolutionRouter from "./attendance-discrepancy-resolution";
import { AuthError } from "../middlewares/auth";

const app = express();
app.use(express.json());
app.use(discrepancyResolutionRouter);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (error instanceof AuthError) return res.status(error.statusCode).json({ error: error.message, code: error.eventType });
  return res.status(500).json({ error: String(error) });
});

let server: ReturnType<typeof app.listen>;
let baseUrl = "";
beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});
afterAll(async () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

beforeEach(() => {
  state.discrepancy = {
    id: 401,
    school_id: 1,
    student_id: 11,
    attendance_event_id: 101,
    discrepancy_type: "EXIT_WITHOUT_ENTRY",
    status: "OPEN",
    details: { note: "Original discrepancy detail" } as Record<string, any>,
    resolved_by: null,
    resolved_at: null,
    created_at: "2025-02-03T08:00:00.000Z",
  };
  state.transactions = [];
  state.audit = [];
  poolMock.client.query.mockClear();
  poolMock.connect.mockClear();
});

async function resolve(
  role: string,
  body: Record<string, unknown> = { schoolId: 1, status: "RESOLVED", reason: "Verified by administrator" },
  schoolId?: number,
) {
  return fetch(`${baseUrl}/school/attendance/discrepancies/401/resolve`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-test-role": role,
      ...(schoolId === undefined ? {} : { "x-test-school": String(schoolId) }),
    },
    body: JSON.stringify(body),
  });
}

describe("attendance discrepancy resolution", () => {
  it("resolves an open discrepancy atomically and returns original and resolution details", async () => {
    const response = await resolve("SCHOOL_ADMIN");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      id: 401,
      schoolId: 1,
      studentId: 11,
      attendanceEventId: 101,
      discrepancyType: "EXIT_WITHOUT_ENTRY",
      status: "RESOLVED",
      createdAt: "2025-02-03T08:00:00.000Z",
      resolvedBy: 10,
      resolutionReason: "Verified by administrator",
      resolver: { id: 10, name: "Test Admin", email: "admin@example.test" },
      details: {
        note: "Original discrepancy detail",
        reason: "Verified by administrator",
        previousStatus: "OPEN",
        newStatus: "RESOLVED",
      },
      resolutionHistory: [{
        reason: "Verified by administrator",
        previousStatus: "OPEN",
        newStatus: "RESOLVED",
        resolvedBy: 10,
      }],
    });
    expect(state.transactions).toEqual(["BEGIN", "COMMIT"]);
    expect(poolMock.client.query.mock.calls.find(([sql]) => sql.includes("FOR UPDATE"))?.[0]).toContain("FOR UPDATE");
    expect(poolMock.client.query.mock.calls.some(([sql]) => sql.includes("ATTENDANCE_DISCREPANCY_RESOLVED"))).toBe(true);
    expect(state.audit[0]?.[6]).toBe(401);
    expect(JSON.parse(String(state.audit[0]?.[7]))).toEqual({
      reason: "Verified by administrator",
      previousStatus: "OPEN",
      newStatus: "RESOLVED",
    });
  });

  it("allows platform owners, but hides cross-school records and denies other roles", async () => {
    expect((await resolve("PLATFORM_OWNER")).status).toBe(200);
    state.discrepancy.status = "OPEN";
    expect((await resolve("SCHOOL_ADMIN", { schoolId: 2, status: "DISMISSED", reason: "Not applicable" })).status).toBe(404);
    expect(state.discrepancy.status).toBe("OPEN");
    expect((await resolve("SCHOOL_ADMIN", { schoolId: 1, status: "DISMISSED", reason: "Not applicable" }, 2)).status).toBe(404);
    for (const role of ["TEACHER", "STAFF", "ACCOUNTANT", "PARENT", "STUDENT", "PARTNER"]) {
      state.discrepancy.status = "OPEN";
      expect((await resolve(role)).status).toBe(403);
    }
  });

  it("rejects non-open states with 409 and validates the requested terminal resolution", async () => {
    state.discrepancy.status = "DISMISSED";
    expect((await resolve("SCHOOL_ADMIN")).status).toBe(409);
    state.discrepancy.status = "OPEN";
    expect((await resolve("SCHOOL_ADMIN", { schoolId: 1, status: "OPEN", reason: "Keep open" })).status).toBe(400);
    expect((await resolve("SCHOOL_ADMIN", { schoolId: 1, status: "RESOLVED", reason: "no" })).status).toBe(400);
  });
});