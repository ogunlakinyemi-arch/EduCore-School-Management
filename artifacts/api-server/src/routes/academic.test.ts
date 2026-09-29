import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; values: unknown[] }>,
}));
const poolMock = vi.hoisted(() => ({
  query: vi.fn(async (sql: string, values: unknown[] = []) => {
    state.calls.push({ sql, values });
    if (sql.includes("INSERT INTO audit_logs")) return { rows: [] };
    if (sql.includes("INSERT INTO subjects")) {
      return { rows: [{ id: 81, schoolId: 1, name: "Mathematics", code: "MTH", description: null, status: "ACTIVE" }] };
    }
    if (sql.includes("FROM subjects")) {
      return { rows: [{ id: 81, schoolId: 1, name: "Mathematics", code: "MTH", description: null, status: "ACTIVE" }] };
    }
    throw new Error(`Unhandled academic authorization query: ${sql}`);
  }),
}));

vi.mock("@workspace/db", () => ({ pool: poolMock }));
vi.mock("../middlewares/auth", () => {
  class AuthError extends Error {
    constructor(public readonly statusCode: number, message: string) { super(message); }
  }
  const context = (req: express.Request) => (req as any).edupulseUser;
  const permits = (req: express.Request, schoolId: number, roles: string[]) =>
    context(req).roles.some((role: any) =>
      role.status === "ACTIVE" && role.schoolId === schoolId && roles.includes(role.role),
    );
  return {
    AuthError,
    getUserContext: context,
    assertSchoolAccess: (req: express.Request, schoolId: number, roles: string[]) => {
      if (context(req).roles.some((role: any) => role.role === "PLATFORM_OWNER" && role.schoolId === null)) return context(req);
      if (!permits(req, schoolId, roles)) throw new AuthError(404, "Resource not found");
      return context(req);
    },
    assertSchoolOperationalAccess: (req: express.Request, schoolId: number, roles: string[]) => {
      if (!permits(req, schoolId, roles)) throw new AuthError(404, "Resource not found");
      return context(req);
    },
    handleAuthError: (error: any, _req: express.Request, res: express.Response) =>
      res.status(error.statusCode ?? 500).json({ error: error.message }),
    requireAuthentication: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const role = req.header("x-test-role") ?? "SCHOOL_ADMIN";
      (req as any).edupulseUser = {
        user: { id: 12, clerkUserId: "academic-test", email: "admin@example.test", firstName: "Test", lastName: "Admin" },
        roles: [{
          role, schoolId: role === "PLATFORM_OWNER" ? null : Number(req.header("x-test-school") ?? 1),
          status: "ACTIVE",
        }],
      };
      next();
    },
  };
});

import academicRouter from "./academic";

const app = express();
app.use(express.json());
app.use(academicRouter);
let server: ReturnType<typeof app.listen>;
let baseUrl = "";

beforeAll(async () => new Promise<void>((resolve) => {
  server = app.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (address && typeof address === "object") baseUrl = `http://127.0.0.1:${address.port}`;
    resolve();
  });
}));
afterAll(async () => new Promise<void>((resolve, reject) =>
  server.close((error) => error ? reject(error) : resolve()),
));
beforeEach(() => {
  state.calls.length = 0;
  poolMock.query.mockClear();
});

async function request(path: string, role: string, method = "GET", body?: unknown, schoolId = 1) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "x-test-role": role,
      "x-test-school": String(schoolId),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("school operational academic authorization", () => {
  it("retains platform-owner school academic reads without granting subject writes", async () => {
    const read = await request("/subjects?schoolId=1", "PLATFORM_OWNER");
    expect(read.status).toBe(200);
    expect(await read.json()).toHaveLength(1);

    state.calls.length = 0;
    const write = await request("/subjects?schoolId=1", "PLATFORM_OWNER", "POST", {
      name: "Science", code: "SCI",
    });
    expect(write.status).toBe(404);
    expect(state.calls.some(({ sql }) => sql.includes("INSERT INTO subjects"))).toBe(false);
  });

  it("allows a school admin to create a subject only in their own school", async () => {
    const allowed = await request("/subjects?schoolId=1", "SCHOOL_ADMIN", "POST", {
      name: "Mathematics", code: "MTH",
    });
    expect(allowed.status).toBe(201);
    expect(state.calls.find(({ sql }) => sql.includes("INSERT INTO subjects"))?.values[0]).toBe(1);

    state.calls.length = 0;
    const otherSchool = await request("/subjects?schoolId=2", "SCHOOL_ADMIN", "POST", {
      name: "Science", code: "SCI",
    });
    expect(otherSchool.status).toBe(404);
    expect(state.calls.some(({ sql }) => sql.includes("INSERT INTO subjects"))).toBe(false);
  });
});