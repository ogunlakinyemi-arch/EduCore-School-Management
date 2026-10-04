import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; values: unknown[] }>,
  conflict: "" as "" | "teacher" | "class" | "room",
  valid: true,
  failedSelection: "" as string,
  studentRoleSchools: [1] as number[],
  studentProfiles: [{ studentId: 10, schoolId: 1, status: "ACTIVE" }] as Array<{
    studentId: number; schoolId: number; status: string;
  }>,
  studentAssignments: [{
    studentId: 10, schoolId: 1, sessionId: 2, termId: 3, classId: 4, section: "Blue",
  }] as Array<{
    studentId: number; schoolId: number; sessionId: number; termId: number; classId: number; section: string;
  }>,
  entry: {
    id: 71, schoolId: 1, sessionId: 2, termId: 3, classId: 4, section: "Blue",
    subjectId: 5, teacherId: 6, day: "MONDAY", startTime: "09:00:00", endTime: "10:00:00",
    room: "R1", status: "ACTIVE", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
  },
}));

const db = vi.hoisted(() => {
  const result = (rows: any[] = []) => ({ rows, rowCount: rows.length });
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    state.calls.push({ sql, values });
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return result();
    if (sql.includes("pg_advisory_xact_lock")) return result();
    if (sql.includes("AS class_valid")) return result([Object.fromEntries([
      "class_valid","session_valid","term_valid","subject_valid","teacher_valid","teacher_active","subject_assignment_valid","teacher_assignment_valid",
    ].map(key=>[key,key !== (state.failedSelection || "teacher_assignment_valid")]))]);
    if (sql.includes("FROM school_classes c")) return result(state.valid ? [{ id: 4 }] : []);
    if (sql.includes("FROM academic_timetable_entries") && sql.includes("teacher_conflict")) {
      if (!state.conflict) return result();
      return result([{
        teacher_conflict: state.conflict === "teacher",
        class_conflict: state.conflict === "class",
        room_conflict: state.conflict === "room",
      }]);
    }
    if (sql.includes("INSERT INTO academic_timetable_entries")) return result([{ ...state.entry }]);
    if (sql.includes("UPDATE academic_timetable_entries")) return result([{ ...state.entry }]);
    if (sql.includes("INSERT INTO audit_logs")) return result();
    if (sql.includes("FROM employees WHERE user_id")) return result([{ id: 6 }]);
    if (sql.includes("FROM academic_timetable_entries te")) return result([{ ...state.entry }]);
    if (sql.includes("FROM students st") && sql.includes("UPPER(st.status)='ACTIVE'")) {
      return result(state.studentProfiles.filter((profile) =>
        profile.status === "ACTIVE" &&
        (values[1] as number[]).includes(profile.schoolId) &&
        (values[2] === null || values[2] === profile.schoolId),
      ).map(({ studentId, schoolId }) => ({ studentId, schoolId })));
    }
    if (sql.includes("FROM student_class_assignments a")) {
      return result(state.studentAssignments
        .filter((assignment) => assignment.studentId === values[0] && assignment.schoolId === values[1])
        .map(({ sessionId, termId, classId, section }) => ({ sessionId, termId, classId, section })));
    }
    if (sql.includes("FROM parents p")) {
      return Number(values[1]) === 10
        ? result([{ studentId: 10, schoolId: 1, sessionId: 2, termId: 3, classId: 4, section: "Blue" }])
        : result();
    }
    throw new Error(`Unhandled query: ${sql}`);
  });
  const client = { query, release: vi.fn() };
  return { query, client, connect: vi.fn(async () => client) };
});

vi.mock("@workspace/db", () => ({ pool: db }));
vi.mock("../middlewares/auth", () => {
  class AuthError extends Error {
    constructor(public readonly statusCode: number, message: string) { super(message); }
  }
  const context = (req: express.Request) => (req as any).edupulseUser;
  const allowedSchoolRole = (req: express.Request, schoolId: number, roles: string[]) => {
    const role = context(req)?.roles?.find((assignment: any) =>
      roles.includes(assignment.role) &&
      (assignment.role === "PLATFORM_OWNER" ? assignment.schoolId === null : assignment.schoolId === schoolId),
    );
    if (!role) throw new AuthError(404, "Resource not found");
    return context(req);
  };
  return {
    AuthError,
    assertRoles: (req: express.Request, roles: string[]) => {
      if (!context(req)?.roles?.some((assignment: any) => roles.includes(assignment.role))) {
        throw new AuthError(403, "Not authorized");
      }
      return context(req);
    },
    assertSchoolAccess: allowedSchoolRole,
    assertSchoolOperationalAccess: (req: express.Request, schoolId: number, roles: string[]) => {
      const permitted = context(req)?.roles?.some((assignment: any) =>
        assignment.status === "ACTIVE" && assignment.schoolId === schoolId && roles.includes(assignment.role),
      );
      if (!permitted) throw new AuthError(404, "Resource not found");
      return context(req);
    },
    getUserContext: context,
    handleAuthError: (error: any, _req: express.Request, res: express.Response) =>
      res.status(error.statusCode ?? 500).json({ error: error.message }),
    requireAuthentication: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const role = req.header("x-test-role") ?? "SCHOOL_ADMIN";
      (req as any).edupulseUser = {
        user: {
          id: Number(req.header("x-test-user-id") ?? 20), clerkUserId: "clerk-test",
          email: "user@example.test", firstName: "Test", lastName: "User",
        },
        roles: role === "STUDENT"
          ? state.studentRoleSchools.map((schoolId) => ({ role, schoolId, status: "ACTIVE" }))
          : [{ role, schoolId: role === "PLATFORM_OWNER" ? null : Number(req.header("x-test-school") ?? 1), status: "ACTIVE" }],
      };
      next();
    },
  };
});

import timetableRouter from "./academic-timetable";

const app = express();
app.use(express.json());
app.use(timetableRouter);
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(500).json({ error: String(error) });
});

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
  state.conflict = "";
  state.valid = true;
  state.failedSelection = "";
  state.studentRoleSchools = [1];
  state.studentProfiles = [{ studentId: 10, schoolId: 1, status: "ACTIVE" }];
  state.studentAssignments = [{
    studentId: 10, schoolId: 1, sessionId: 2, termId: 3, classId: 4, section: "Blue",
  }];
  db.query.mockClear();
  db.client.query.mockClear();
  db.connect.mockClear();
});

const validBody = {
  schoolId: 1, sessionId: 2, termId: 3, classId: 4, section: "Blue",
  subjectId: 5, teacherId: 6, day: "MONDAY", startTime: "09:00", endTime: "10:00", room: "R1",
};

async function request(path: string, role = "SCHOOL_ADMIN", options: RequestInit = {}, schoolId = 1) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-test-role": role,
      "x-test-school": String(schoolId),
      ...(options.headers ?? {}),
    },
  });
}

describe("academic timetable API", () => {
  it.each([
    ["class_valid","Selected class/section"],["subject_valid","Selected subject is not available"],
    ["teacher_valid","Selected teacher is not available"],["session_valid","Selected session"],
    ["term_valid","Selected term"],["subject_assignment_valid","Selected subject is not assigned"],
    ["teacher_assignment_valid","Selected teacher is not assigned"],
    ["teacher_active","Selected employee is not an active teacher"],
  ])("rejects %s with a school-scoped explanation and no write",async(key,message)=>{
    state.valid=false;state.failedSelection=key;
    const response=await request("/academic/timetable","SCHOOL_ADMIN",{method:"POST",body:JSON.stringify(validBody)});
    expect(response.status).toBe(404);expect((await response.json() as {error:string}).error).toContain(message);
    expect(state.calls.some(({sql})=>sql.includes("INSERT INTO academic_timetable_entries"))).toBe(false);
    expect(state.calls.some(({sql})=>sql==="ROLLBACK")).toBe(true);
  });
  it("creates only a valid school/session/term/class/section/subject/teacher assignment and audits the write", async () => {
    const response = await request("/academic/timetable", "SCHOOL_ADMIN", {
      method: "POST", body: JSON.stringify(validBody),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: 71, schoolId: 1, teacherId: 6, day: "MONDAY" });
    expect(state.calls.some(({ sql }) => sql.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(state.calls.some(({ sql }) => sql.includes("INSERT INTO audit_logs"))).toBe(true);
    expect(state.calls.find(({ sql }) => sql.includes("FROM school_classes c"))?.values).toEqual([1, 2, 3, 4, 5, 6, "Blue"]);
    const insert = state.calls.find(({ sql }) => sql.includes("INSERT INTO academic_timetable_entries"));
    expect(insert?.sql).toContain("teacher_employee_id");
    expect(insert?.sql).toContain("weekday");
    expect(insert?.sql).toContain("created_by");
    expect(insert?.values.at(-1)).toBe(20);
  });

  it.each(["teacher", "class", "room"] as const)("rejects overlapping %s conflicts with 409", async (conflict) => {
    state.conflict = conflict;
    const response = await request("/academic/timetable", "SCHOOL_ADMIN", {
      method: "POST", body: JSON.stringify(validBody),
    });
    expect(response.status).toBe(409);
    expect(state.calls.some(({ sql }) => sql.includes("INSERT INTO academic_timetable_entries"))).toBe(false);
    expect(state.calls.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("returns 404 for cross-school identifiers and invalid historical resource assignments", async () => {
    const crossSchool = await request("/academic/timetable", "SCHOOL_ADMIN", {
      method: "POST", body: JSON.stringify({ ...validBody, schoolId: 2 }),
    });
    expect(crossSchool.status).toBe(404);
    expect(db.connect).not.toHaveBeenCalled();

    state.valid = false;
    const invalidRelation = await request("/academic/timetable", "SCHOOL_ADMIN", {
      method: "POST", body: JSON.stringify(validBody),
    });
    expect(invalidRelation.status).toBe(404);
    expect(state.calls.some(({ sql }) => sql.includes("INSERT INTO academic_timetable_entries"))).toBe(false);
  });

  it("denies staff and teachers mutations, while teachers can only read their own schedule", async () => {
    expect((await request("/academic/timetable", "STAFF", {
      method: "POST", body: JSON.stringify(validBody),
    })).status).toBe(403);
    expect((await request("/academic/timetable/71", "TEACHER", {
      method: "PATCH", body: JSON.stringify({ schoolId: 1 }),
    })).status).toBe(403);

    const response = await request("/academic/timetable?schoolId=1&classId=99", "TEACHER");
    expect(response.status).toBe(200);
    const listing = state.calls.find(({ sql }) => sql.includes("FROM academic_timetable_entries te"));
    expect(listing?.sql).toContain("te.teacher_employee_id=$");
    expect(listing?.values).toEqual([1, 6, 99]);
  });

  it("denies platform-owner timetable creation and updates before connecting to the database", async () => {
    const create = await request("/academic/timetable", "PLATFORM_OWNER", {
      method: "POST", body: JSON.stringify(validBody),
    });
    const update = await request("/academic/timetable/71", "PLATFORM_OWNER", {
      method: "PATCH", body: JSON.stringify({ schoolId: 1, status: "CANCELLED" }),
    });
    expect([create.status, update.status]).toEqual([403, 403]);
    expect(db.connect).not.toHaveBeenCalled();
    expect(state.calls.some(({ sql }) => /INSERT INTO academic_timetable_entries|UPDATE academic_timetable_entries/.test(sql))).toBe(false);
  });

  it("allows admins to cancel an existing entry and writes a cancellation audit", async () => {
    const response = await request("/academic/timetable/71", "SCHOOL_ADMIN", {
      method: "PATCH", body: JSON.stringify({ schoolId: 1, status: "CANCELLED" }),
    });
    expect(response.status).toBe(200);
    expect(state.calls.some(({ sql }) => sql.includes("UPDATE academic_timetable_entries"))).toBe(true);
    expect(state.calls.find(({ sql }) => sql.includes("INSERT INTO audit_logs"))?.values[5]).toBe("Cancelled timetable entry");
  });

  it("limits student and linked-parent reads to the child's current class and section", async () => {
    const studentResponse = await request("/academic/students/me/timetable", "STUDENT", {}, 1);
    expect(studentResponse.status).toBe(200);
    const profileLookup = state.calls.find(({ sql }) => sql.includes("FROM students st") && sql.includes("UPPER(st.status)"));
    expect(profileLookup?.sql).toContain("st.school_id=ANY($2::int[])");
    expect(profileLookup?.values).toEqual([20, [1], null]);
    const assignmentLookup = state.calls.find(({ sql }) => sql.includes("FROM student_class_assignments a"));
    expect(assignmentLookup?.sql).toContain("st.school_id=$2");
    expect(assignmentLookup?.values).toEqual([10, 1]);
    const studentListing = state.calls.find(({ sql }) => sql.includes("FROM academic_timetable_entries te"));
    expect(studentListing?.sql).toContain("te.school_class_id=$3");
    expect(studentListing?.sql).toContain("te.academic_term_id=$5");
    expect(studentListing?.values.slice(0, 5)).toEqual([1, 2, 4, "Blue", 3]);

    state.calls.length = 0;
    expect((await request("/academic/parents/children/10/timetable", "PARENT")).status).toBe(200);
    const parentListing = state.calls.find(({ sql }) => sql.includes("FROM academic_timetable_entries te"));
    expect(parentListing?.values.slice(0, 5)).toEqual([1, 2, 4, "Blue", 3]);

    state.calls.length = 0;
    expect((await request("/academic/parents/children/11/timetable", "PARENT")).status).toBe(404);
    expect(state.calls.some(({ sql }) => sql.includes("FROM academic_timetable_entries te"))).toBe(false);
  });

  it("requires an active self profile and its school-scoped student identity", async () => {
    state.studentProfiles = [{ studentId: 10, schoolId: 1, status: "INACTIVE" }];
    const inactive = await request("/academic/students/me/timetable", "STUDENT");
    expect(inactive.status).toBe(404);
    expect(state.calls.some(({ sql }) => sql.includes("FROM academic_timetable_entries te"))).toBe(false);

    state.calls.length = 0;
    state.studentProfiles = [{ studentId: 10, schoolId: 2, status: "ACTIVE" }];
    const crossSchool = await request("/academic/students/me/timetable", "STUDENT");
    expect(crossSchool.status).toBe(404);
    expect(state.calls.some(({ sql }) => sql.includes("FROM academic_timetable_entries te"))).toBe(false);

    state.calls.length = 0;
    const wrongRequestedSchool = await request("/academic/students/me/timetable?schoolId=2", "STUDENT");
    expect(wrongRequestedSchool.status).toBe(404);
    expect(state.calls).toHaveLength(0);
  });

  it("rejects duplicate active profiles instead of choosing an arbitrary school", async () => {
    state.studentRoleSchools = [1, 2];
    state.studentProfiles = [
      { studentId: 10, schoolId: 1, status: "ACTIVE" },
      { studentId: 20, schoolId: 2, status: "ACTIVE" },
    ];
    const response = await request("/academic/students/me/timetable", "STUDENT");
    expect(response.status).toBe(409);
    expect(state.calls.some(({ sql }) => sql.includes("FROM student_class_assignments a"))).toBe(false);
    expect(state.calls.some(({ sql }) => sql.includes("FROM academic_timetable_entries te"))).toBe(false);
  });

  it("validates time ranges, weekdays, and statuses before touching the database", async () => {
    expect((await request("/academic/timetable", "SCHOOL_ADMIN", {
      method: "POST", body: JSON.stringify({ ...validBody, startTime: "10:00", endTime: "09:00" }),
    })).status).toBe(400);
    expect((await request("/academic/timetable", "SCHOOL_ADMIN", {
      method: "POST", body: JSON.stringify({ ...validBody, day: "FUNDAY" }),
    })).status).toBe(400);
    expect(db.connect).not.toHaveBeenCalled();
  });
});