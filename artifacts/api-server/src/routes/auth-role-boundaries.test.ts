import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  caller: "PLATFORM_OWNER",
  queries: [] as Array<{ sql: string; values: unknown[] }>,
  createSchoolInvitation: vi.fn(async (input: Record<string, unknown>) => ({
    status: "INVITATION_SENT",
    invitationId: "inv-test",
    schoolId: input.schoolId,
    role: input.role,
  })),
}));

const poolMock = vi.hoisted(() => ({
  query: vi.fn(async (sql: string, values: unknown[] = []) => {
    state.queries.push({ sql, values });
    if (sql.includes("SELECT id, school_id AS \"schoolId\" FROM students")) {
      return { rows: Number(values[0]) === 11 ? [{ id: 11, schoolId: 1 }] : [] };
    }
    if (sql.includes("SELECT id, school_id AS \"schoolId\" FROM parents")) {
      return { rows: Number(values[0]) === 21 ? [{ id: 21, schoolId: 1 }] : [] };
    }
    if (sql.includes("FROM parent_student_relationships psr")) {
      return { rows: Number(values[0]) === 31 ? [{ id: 31, schoolId: 1 }] : [] };
    }
    if (sql.includes("SELECT id, role FROM school_memberships")) {
      return { rows: Number(values[0]) === 77
        ? [{ id: 63, role: "TEACHER" }, { id: 62, role: "SCHOOL_ADMIN" }]
        : [{ id: 61, role: "TEACHER" }] };
    }
    if (sql.includes("FROM school_memberships WHERE id = $1")) {
      return { rows: Number(values[0]) === 62
        ? [{ id: 62, userId: 77, schoolId: 1, role: "SCHOOL_ADMIN" }]
        : [{ id: 61, userId: 75, schoolId: 1, role: "TEACHER" }] };
    }
    if (sql.includes("SELECT id FROM app_users WHERE lower(email)=lower($1)")) {
      return { rows: [{ id: 90 }] };
    }
    if (sql.includes("SELECT id FROM app_users WHERE id = $1")) return { rows: [{ id: 70 }] };
    if (sql.includes("INSERT INTO parent_student_relationships")) {
      return { rows: [{ id: 31, parentId: 21, studentId: 11, relationshipType: "Guardian", status: "ACTIVE" }] };
    }
    if (sql.includes("INSERT INTO school_memberships")) {
      return { rows: [{ id: 62, userId: Number(values[0]), schoolId: values[1], role: values[2], status: "ACTIVE" }] };
    }
    if (sql.includes("UPDATE school_memberships")) {
      return { rows: [{ id: Number(values.at(-1)), userId: 70, schoolId: 1, role: "TEACHER", status: "ACTIVE" }] };
    }
    if (sql.includes("UPDATE parent_student_relationships") && sql.includes("RETURNING")) {
      return { rows: [{ id: 31, parentId: 21, studentId: 11, relationshipType: "Guardian", status: "ACTIVE" }] };
    }
    return { rows: [] };
  }),
}));

vi.mock("@workspace/db", () => ({ pool: poolMock }));
vi.mock("./school-invitations", () => ({
  activateAcceptedSchoolInvitation: vi.fn(),
  createSchoolInvitation: state.createSchoolInvitation,
  INVITABLE_SCHOOL_ROLES: ["SCHOOL_ADMIN", "TEACHER", "ACCOUNTANT", "STAFF", "PARENT"],
}));
vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    requireAuthentication: () => (
      req: express.Request,
      _res: express.Response,
      next: express.NextFunction,
    ) => {
      const role = req.header("x-test-caller") ?? state.caller;
      const memberships = role === "PLATFORM_OWNER"
        ? [{ id: 1, role, schoolId: null, status: "ACTIVE" }]
        : role === "SCHOOL_ADMIN"
          ? [{ id: 2, role, schoolId: 1, status: "ACTIVE" }]
          : role === "SCHOOL_ADMIN_OTHER"
            ? [{ id: 3, role: "SCHOOL_ADMIN", schoolId: 2, status: "ACTIVE" }]
            : [
                { id: 4, role: "SCHOOL_ADMIN", schoolId: 2, status: "ACTIVE" },
                { id: 5, role: "TEACHER", schoolId: 1, status: "ACTIVE" },
              ];
      (req as any).edupulseUser = {
        user: {
          id: role === "SCHOOL_ADMIN" ? 70 : 80,
          clerkUserId: `clerk-${role}`,
          email: `${role.toLowerCase()}@example.test`,
          firstName: "Test",
          lastName: "User",
          phone: null,
          status: "ACTIVE",
        },
        roles: memberships,
      };
      next();
    },
  };
});

import authRouter from "./auth";
import { AuthError } from "../middlewares/auth";

const app = express();
app.use(express.json());
app.use(authRouter);
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
  state.caller = "PLATFORM_OWNER";
  state.queries.length = 0;
  poolMock.query.mockClear();
  state.createSchoolInvitation.mockClear();
});

async function call(path: string, method = "GET", body?: Record<string, unknown>, caller = state.caller) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "content-type": "application/json", "x-test-caller": caller },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

const relationship = { parentId: 21, studentId: 11, relationshipType: "Guardian" };

describe("school role and parent relationship authorization", () => {
  it("denies Platform Owner parent-child relationship creation, editing, and deactivation", async () => {
    expect((await call("/parent-student-relationships", "POST", relationship)).status).toBe(404);
    expect((await call("/parent-student-relationships/31", "PATCH", { status: "INACTIVE" })).status).toBe(404);
    expect((await call("/parent-student-relationships/31", "DELETE")).status).toBe(404);
    expect(state.queries.some(({ sql }) =>
      sql.includes("INSERT INTO parent_student_relationships") ||
      (sql.includes("UPDATE parent_student_relationships") && sql.includes("SET")))).toBe(false);
  });

  it("allows a School Admin to manage parent-child relationships only in their school", async () => {
    expect((await call("/parent-student-relationships", "POST", relationship, "SCHOOL_ADMIN")).status).toBe(201);
    expect((await call("/parent-student-relationships/31", "PATCH", { status: "INACTIVE" }, "SCHOOL_ADMIN")).status).toBe(200);
    expect((await call("/parent-student-relationships/31", "DELETE", undefined, "SCHOOL_ADMIN")).status).toBe(204);
    expect((await call("/parent-student-relationships", "POST", relationship, "SCHOOL_ADMIN_OTHER")).status).toBe(404);
  });

  it("denies Owner ordinary school-role invitation, grant, reactivation, and role changes", async () => {
    expect((await call("/school-users/invitations", "POST", {
      schoolId: 1, email: "teacher@example.test", fullName: "School Teacher", role: "TEACHER",
    })).status).toBe(404);
    expect((await call("/school-users", "POST", { schoolId: 1, userId: 70, role: "TEACHER" })).status).toBe(404);
    expect((await call("/school-users/70/status", "PATCH", { schoolId: 1, status: "ACTIVE" })).status).toBe(404);
    expect((await call("/school-memberships/61/role", "PATCH", { role: "STAFF" })).status).toBe(404);
    expect(state.createSchoolInvitation).not.toHaveBeenCalled();
    expect(state.queries.some(({ sql }) =>
      sql.includes("INSERT INTO school_memberships") || sql.includes("UPDATE school_memberships"))).toBe(false);
  });

  it("allows School Admin scoped invitations and membership grants", async () => {
    expect((await call("/school-users/invitations", "POST", {
      schoolId: 1, email: "teacher@example.test", fullName: "School Teacher", role: "TEACHER",
    }, "SCHOOL_ADMIN")).status).toBe(202);
    expect(state.createSchoolInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: 1, role: "TEACHER" }),
      expect.anything(),
    );
    expect((await call("/school-users", "POST", { schoolId: 1, userId: 71, role: "TEACHER" }, "SCHOOL_ADMIN")).status).toBe(201);
    expect((await call("/school-users/71/status", "PATCH", { schoolId: 1, status: "INACTIVE" }, "SCHOOL_ADMIN")).status).toBe(200);
    expect((await call("/school-memberships/61/role", "PATCH", { role: "STAFF" }, "SCHOOL_ADMIN")).status).toBe(200);
  });

  it("blocks School Admins from changing another School Admin membership", async () => {
    expect((await call("/school-users/77/status", "PATCH", {
      schoolId: 1, status: "INACTIVE",
    }, "SCHOOL_ADMIN")).status).toBe(403);
    expect((await call("/school-memberships/62/role", "PATCH", {
      role: "STAFF",
    }, "SCHOOL_ADMIN")).status).toBe(403);
    expect(state.queries.some(({ sql }) => sql.includes("UPDATE school_memberships"))).toBe(false);
  });

  it("retains Platform Owner invitations for School Admins and platform-level role grants", async () => {
    expect((await call("/schools/1/administrators", "POST", {
      fullName: "New Admin", email: "new-admin@example.test",
    })).status).toBe(202);
    expect(state.createSchoolInvitation).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: 1, role: "SCHOOL_ADMIN" }),
      expect.anything(),
    );
    expect((await call("/platform-users", "POST", {
      email: "platform@example.test", role: "PLATFORM_OWNER",
    })).status).toBe(201);
  });
});