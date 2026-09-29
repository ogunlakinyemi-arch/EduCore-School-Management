import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; values: unknown[] }>,
  role: "TEACHER",
  userId: 20,
  schoolId: 1,
  resourceExists: true,
  teacherAssigned: true,
  parentLinked: true,
  studentExists: true,
  assessmentTypeExists: true,
  assignment: {
    id: 701,
    schoolId: 1,
    sessionId: 2,
    termId: 3,
    classId: 4,
    section: "Blue",
    subjectId: 5,
    teacherId: 6,
    createdBy: 20,
    title: "Fractions",
    description: "Complete questions 1–5",
    issueDate: "2026-03-01",
    dueDate: "2026-03-08",
    maxScore: 20,
    status: "DRAFT",
    createdAt: "2026-02-28T12:00:00.000Z",
    updatedAt: "2026-02-28T12:00:00.000Z",
  },
}));

const poolMock = vi.hoisted(() => ({
  query: vi.fn(async (sql: string, values: unknown[] = []) => {
    state.calls.push({ sql, values });
    if (sql.includes("INSERT INTO audit_logs")) return { rows: [] };
    if (sql.includes("FROM school_classes c")) {
      return { rows: state.resourceExists ? [{ id: 4 }] : [] };
    }
    if (sql.includes("FROM employees e") && sql.includes("teacher_class_assignments")) {
      return { rows: state.teacherAssigned ? [{ id: 6 }] : [] };
    }
    if (sql.includes("FROM employees e")) return { rows: [{ id: 6 }] };
    if (sql.includes("INSERT INTO academic_assignments")) return { rows: [state.assignment] };
    if (sql.includes("FROM academic_assessment_types") && sql.includes("SELECT id")) {
      return { rows: state.assessmentTypeExists ? [{ id: 8 }] : [] };
    }
    if (sql.includes("INSERT INTO academic_assessment_types")) {
      return { rows: [{ id: 901, schoolId: 1, name: "Continuous Assessment", code: "CA", status: "ACTIVE" }] };
    }
    if (sql.includes("INSERT INTO academic_assessments")) {
      return { rows: [{ id: 801, schoolId: 1, sessionId: 2, termId: 3, classId: 4, section: "Blue", subjectId: 5, teacherId: 6, assessmentTypeId: 8, title: "Mid-term", date: "2026-03-05", maxScore: 50, status: "DRAFT", description: "", createdBy: 20, createdAt: "2026-02-28T12:00:00.000Z", updatedAt: "2026-02-28T12:00:00.000Z" }] };
    }
    if (sql.includes("FROM parents p")) {
      return { rows: state.parentLinked ? [{ id: 11, schoolId: 1 }] : [] };
    }
    if (sql.includes("FROM students")) {
      return { rows: state.studentExists ? [{ id: 11, schoolId: 1 }] : [] };
    }
    if (sql.includes("FROM academic_assignments a")) {
      return { rows: [{ ...state.assignment, status: "PUBLISHED" }] };
    }
    throw new Error(`Unhandled SQL in academic-work test: ${sql}`);
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
    getUserContext: (req: express.Request) => (req as any).edupulseUser,
    assertSchoolOperationalAccess: (req: express.Request, schoolId: number, roles: string[]) => {
      const context = (req as any).edupulseUser;
      const allowed = context.roles.some((membership: any) =>
        membership.status === "ACTIVE" && membership.schoolId === schoolId && roles.includes(membership.role),
      );
      if (!allowed) throw new AuthError(404, "Resource not found");
      return context;
    },
    handleAuthError: (error: any, _req: express.Request, res: express.Response) =>
      res.status(error.statusCode ?? 500).json({ error: error.message }),
    requireAuthentication: () => (
      req: express.Request,
      res: express.Response,
      next: express.NextFunction,
    ) => {
      const role = req.header("x-test-role") ?? state.role;
      const schoolId = role === "PLATFORM_OWNER" ? null : state.schoolId;
      (req as any).edupulseUser = {
        user: { id: state.userId, clerkUserId: "clerk-test", email: "test@example.com", firstName: "Test", lastName: "User" },
        roles: [{ role, schoolId, status: "ACTIVE" }],
      };
      next();
    },
  };
});

import academicWorkRouter from "./academic-work";

const app = express();
app.use(express.json());
app.use(academicWorkRouter);
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
  state.calls.length = 0;
  state.role = "TEACHER";
  state.userId = 20;
  state.schoolId = 1;
  state.resourceExists = true;
  state.teacherAssigned = true;
  state.parentLinked = true;
  state.studentExists = true;
  state.assessmentTypeExists = true;
});

async function call(path: string, options: { method?: string; role?: string; body?: unknown } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "x-test-role": options.role ?? state.role,
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
}

const assignmentBody = {
  sessionId: 2,
  termId: 3,
  classId: 4,
  section: "Blue",
  subjectId: 5,
  title: "Fractions",
  description: "Complete questions 1–5",
  issueDate: "2026-03-01",
  dueDate: "2026-03-08",
  maxScore: 20,
};

describe("academic assignments and assessments API", () => {
  it("creates a teacher assignment only after validating all academic and historical teacher mappings", async () => {
    const response = await call("/academic/assignments?schoolId=1", { method: "POST", body: assignmentBody });
    expect(response.status, await response.clone().text()).toBe(201);
    expect(await response.json()).toEqual(state.assignment);
    const resource = state.calls.find(({ sql }) => sql.includes("FROM school_classes c"));
    expect(resource?.values).toEqual([1, 2, 3, 4, 5, "Blue"]);
    const assigned = state.calls.find(({ sql }) => sql.includes("teacher_class_assignments"));
    expect(assigned?.values).toEqual([1, 20, 2, 3, 4, 5, "Blue"]);
    expect(state.calls.some(({ sql }) => sql.includes("INSERT INTO audit_logs"))).toBe(true);
    expect(state.calls.find(({ sql }) => sql.includes("INSERT INTO academic_assignments"))?.sql).toContain("VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)");
  });

  it("rejects a teacher without active class/subject authorization and returns 404 on mismatched resources", async () => {
    state.teacherAssigned = false;
    expect((await call("/academic/assignments?schoolId=1", { method: "POST", body: assignmentBody })).status).toBe(403);
    expect(state.calls.some(({ sql }) => sql.includes("INSERT INTO academic_assignments"))).toBe(false);

    state.calls.length = 0;
    state.teacherAssigned = true;
    state.resourceExists = false;
    expect((await call("/academic/assignments?schoolId=1", { method: "POST", body: assignmentBody })).status).toBe(404);
    expect(state.calls.some(({ sql }) => sql.includes("INSERT INTO academic_assignments"))).toBe(false);
  });

  it("enforces strict role rejection and school tenant scope", async () => {
    expect((await call("/academic/assignments?schoolId=1", { method: "POST", role: "STAFF", body: assignmentBody })).status).toBe(404);
    expect((await call("/academic/assignments?schoolId=2", { method: "POST", role: "TEACHER", body: assignmentBody })).status).toBe(404);
    expect(state.calls.some(({ sql }) => sql.includes("INSERT INTO academic_assignments"))).toBe(false);
  });

  it("rejects impossible dates and non-positive maximum scores before database writes", async () => {
    const invalidDate = { ...assignmentBody, issueDate: "2026-02-30" };
    expect((await call("/academic/assignments?schoolId=1", { method: "POST", body: invalidDate })).status).toBe(400);
    const invalidScore = { ...assignmentBody, maxScore: 0 };
    expect((await call("/academic/assignments?schoolId=1", { method: "POST", body: invalidScore })).status).toBe(400);
    expect(state.calls.some(({ sql }) => sql.includes("INSERT INTO academic_assignments"))).toBe(false);
  });

  it("limits student reads to the signed-in student and published assignment query", async () => {
    state.role = "STUDENT";
    state.userId = 200;
    const response = await call("/academic/students/me/assignments?schoolId=1");
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).toEqual([{ ...state.assignment, status: "PUBLISHED" }]);
    const studentProfile = state.calls.find(({ sql }) => sql.includes("FROM students"));
    expect(studentProfile?.values).toEqual([200, 1]);
    const assignmentQuery = state.calls.find(({ sql }) => sql.includes("FROM academic_assignments a"));
    expect(assignmentQuery?.sql).toContain("a.status='PUBLISHED'");
    expect(assignmentQuery?.sql).toContain("student_class_assignments");
    expect(assignmentQuery?.values).toEqual([11, 1]);
    expect((await call("/academic/students/me/assignments?schoolId=1", { role: "PARENT" })).status).toBe(403);
  });

  it("prevents parent assignment IDOR for an unlinked child and scopes linked children", async () => {
    state.role = "PARENT";
    state.userId = 100;
    state.parentLinked = false;
    expect((await call("/academic/parents/children/12/assignments?schoolId=1")).status).toBe(404);
    expect(state.calls.some(({ sql }) => sql.includes("FROM academic_assignments a"))).toBe(false);
    state.parentLinked = true;
    state.calls.length = 0;
    const linkedResponse = await call("/academic/parents/children/11/assignments?schoolId=1");
    expect(linkedResponse.status, await linkedResponse.clone().text()).toBe(200);
    const parentLookup = state.calls.find(({ sql }) => sql.includes("FROM parents p"));
    expect(parentLookup?.values).toEqual([100, 1, 11]);
  });

  it("creates assessments only with same-school configurable assessment types", async () => {
    const body = {
      sessionId: 2, termId: 3, classId: 4, section: "Blue", subjectId: 5,
      assessmentTypeId: 8, title: "Mid-term", date: "2026-03-05", maxScore: 50,
    };
    const response = await call("/academic/assessments?schoolId=1", { method: "POST", body });
    expect(response.status).toBe(201);
    const result = await response.json();
    expect(result).toMatchObject({ schoolId: 1, assessmentTypeId: 8, maxScore: 50, status: "DRAFT", title: "Mid-term", teacherId: 6, createdBy: 20 });
    expect(state.calls.some(({ sql, values }) => sql.includes("FROM academic_assessment_types") && values[0] === 8 && values[1] === 1)).toBe(true);
    expect(state.calls.some(({ sql }) => sql.includes("INSERT INTO audit_logs"))).toBe(true);
  });

  it("rejects assessment types from another school and denies administrative types to teachers", async () => {
    state.assessmentTypeExists = false;
    const body = {
      sessionId: 2, termId: 3, classId: 4, subjectId: 5,
      assessmentTypeId: 88, title: "Mid-term", date: "2026-03-05", maxScore: 50,
    };
    expect((await call("/academic/assessments?schoolId=1", { method: "POST", body })).status).toBe(404);
    expect((await call("/academic/assessment-types?schoolId=1", { method: "POST", body: { name: "Quiz" } })).status).toBe(404);
    expect(state.calls.some(({ sql }) => sql.includes("INSERT INTO academic_assessments"))).toBe(false);
  });

  it("lets a school administrator configure a per-school assessment type", async () => {
    const response = await call("/academic/assessment-types?schoolId=1", {
      method: "POST",
      role: "SCHOOL_ADMIN",
      body: { name: "Continuous Assessment", code: "CA" },
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: 901, schoolId: 1, name: "Continuous Assessment", code: "CA", status: "ACTIVE" });
    const insert = state.calls.find(({ sql }) => sql.includes("INSERT INTO academic_assessment_types"));
    expect(insert?.values).toEqual([1, "Continuous Assessment", "CA", "ACTIVE"]);
    expect(insert?.sql).not.toContain("description");
    expect(state.calls.some(({ sql }) => sql.includes("INSERT INTO audit_logs"))).toBe(true);
  });

  it("rejects platform-owner writes to school assignments and assessment configuration", async () => {
    const ownerAssignment = await call("/academic/assignments?schoolId=1", {
      method: "POST", role: "PLATFORM_OWNER", body: assignmentBody,
    });
    const ownerType = await call("/academic/assessment-types?schoolId=1", {
      method: "POST", role: "PLATFORM_OWNER", body: { name: "Quiz", code: "QZ" },
    });

    expect([ownerAssignment.status, ownerType.status]).toEqual([404, 404]);
    expect(state.calls.some(({ sql }) =>
      sql.includes("INSERT INTO academic_assignments") || sql.includes("INSERT INTO academic_assessment_types"),
    )).toBe(false);
  });
});