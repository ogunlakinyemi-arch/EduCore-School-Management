import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; values: unknown[] }>,
}));
const poolMock = vi.hoisted(() => ({
  query: vi.fn(async (sql: string, values: unknown[] = []) => {
    state.calls.push({ sql, values });
    if (sql.includes("INSERT INTO audit_logs")) return { rows: [] };
    if (sql.includes("FROM academic_sessions")) {
      return { rows: [{ id: 11, schoolId: values[0], name: "2026/2027", status: "ACTIVE" }] };
    }
    if (sql.includes("FROM academic_terms")) {
      return { rows: [{ id: 12, schoolId: 1, sessionId: 11, name: "Second term", status: "ACTIVE" }] };
    }
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
  it.each(["SCHOOL_ADMIN", "PLATFORM_OWNER", "TEACHER", "ACCOUNTANT"])(
    "allows %s to read school academic periods used by finance pickers", async role => {
      const sessions = await request("/academic-sessions?schoolId=1", role);
      expect(sessions.status).toBe(200);
      expect(((await sessions.json()) as { name: string }[])[0].name).toBe("2026/2027");
      const terms = await request("/academic-sessions/11/terms?schoolId=1", role);
      expect(terms.status).toBe(200);
      expect(((await terms.json()) as { name: string }[])[0].name).toBe("Second term");
      expect(state.calls.every(({ sql }) => !/\b(INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(true);
    },
  );

  it.each(["PARENT", "STUDENT", "STAFF", "PARTNER"])(
    "does not expose the school-wide academic catalog to %s", async role => {
      for (const path of ["/academic-sessions?schoolId=1", "/academic-sessions/11/terms?schoolId=1"]) {
        expect((await request(path, role)).status).toBe(404);
      }
      expect(state.calls).toHaveLength(0);
    },
  );

  it("keeps Accountant period reads tenant-scoped and denies academic writes and unrelated reads", async () => {
    for (const path of ["/academic-sessions?schoolId=2", "/academic-sessions/11/terms?schoolId=2", "/subjects?schoolId=1"]) {
      expect((await request(path, "ACCOUNTANT")).status).toBe(404);
    }
    expect((await request("/academic-sessions?schoolId=1", "ACCOUNTANT", "POST", {
      name: "2026/2027", startDate: "2026-09-01", endDate: "2027-07-31", isCurrent: false,
    })).status).toBe(404);
    expect(state.calls).toHaveLength(0);
  });
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