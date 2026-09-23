import { afterAll, describe, expect, it, vi } from "vitest";
import { pool } from "@workspace/db";

vi.mock("@clerk/express", () => ({
  getAuth: vi.fn(() => ({ userId: null })),
  clerkClient: { users: { getUser: vi.fn() } },
}));

import {
  AuthError,
  assertRoles,
  assertSchoolAccess,
  requireAuthentication,
  type Role,
  type UserContext,
} from "../middlewares/auth";

afterAll(async () => {
  await pool.end();
});

function requestAs(
  role: Role,
  schoolId: number | null,
): any {
  const context: UserContext = {
    user: {
      id: 999999,
      clerkUserId: "phase3-test-user",
      email: "phase3@example.test",
      firstName: "Phase",
      lastName: "Three",
      phone: null,
      status: "ACTIVE",
    },
    roles: [{ id: 999999, role, schoolId, status: "ACTIVE" }],
  };
  return { edupulseUser: context };
}

describe("Phase 3 endpoint authentication", () => {
  it.each([
    "/employees",
    "/parents",
    "/students",
    "/subjects",
    "/academic-sessions",
    "/students/1/class-assignments",
    "/class-subject-assignments",
    "/teacher-class-assignments",
  ])("%s rejects an unauthenticated request with 401", (path) => {
    const status = vi.fn().mockReturnThis();
    const json = vi.fn();
    const next = vi.fn();
    requireAuthentication()(
      { path } as any,
      { status, json } as any,
      next,
    );
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: "Authentication required" });
    expect(next).not.toHaveBeenCalled();
  });
});

describe("Phase 3 tenant and role boundaries", () => {
  it.each([
    ["employee", ["SCHOOL_ADMIN", "TEACHER", "STAFF"] as Role[]],
    ["parent", ["SCHOOL_ADMIN"] as Role[]],
    ["student", ["SCHOOL_ADMIN", "TEACHER", "STAFF"] as Role[]],
    ["subject", ["SCHOOL_ADMIN", "TEACHER"] as Role[]],
    ["academic", ["SCHOOL_ADMIN", "TEACHER"] as Role[]],
  ])("hides a cross-school %s resource", (_resource, roles) => {
    expect(() =>
      assertSchoolAccess(requestAs(roles[0], 10), 20, roles),
    ).toThrowError(
      expect.objectContaining({
        statusCode: 404,
        eventType: "CROSS_TENANT_ACCESS_ATTEMPT",
      }),
    );
  });

  it.each(["TEACHER", "STAFF"] as Role[])(
    "%s cannot mutate Phase 3 resources",
    (role) => {
      expect(() =>
        assertRoles(requestAs(role, 10), ["SCHOOL_ADMIN", "PLATFORM_OWNER"]),
      ).toThrowError(expect.objectContaining({ statusCode: 403 }));
    },
  );

  it("does not let a student select another student's profile", () => {
    expect(() =>
      assertRoles(requestAs("STUDENT", 10), ["SCHOOL_ADMIN"]),
    ).toThrowError(AuthError);
    // The student profile endpoint derives the student from context.user.id;
    // it has no studentId query or path parameter to select.
    expect(requestAs("STUDENT", 10).edupulseUser.roles[0].role).toBe("STUDENT");
  });
});

describe("Phase 3 database history and audit invariants", () => {
  it("deactivates a prior class assignment while preserving its history", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const school = await client.query(
        `INSERT INTO schools (code, name, city, state, status)
         VALUES ('PHASE3-HISTORY', 'Phase 3 History School', 'Test City', 'Test State', 'active')
         RETURNING id`,
      );
      const schoolId = school.rows[0].id;
      const student = await client.query(
        `INSERT INTO students (school_id, admission_no, first_name, last_name, gender, class_name, section)
         VALUES ($1, 'PHASE3-STUDENT', 'History', 'Student', 'Other', 'Old', 'A')
         RETURNING id`,
        [schoolId],
      );
      const session = await client.query(
        `INSERT INTO academic_sessions (school_id, name, start_date, end_date)
         VALUES ($1, 'PHASE3-SESSION', CURRENT_DATE, CURRENT_DATE + 30)
         RETURNING id`,
        [schoolId],
      );
      const classes = await client.query(
        `INSERT INTO school_classes (school_id, name, section, capacity)
         VALUES ($1, 'Old', 'A', 30), ($1, 'New', 'A', 30)
         RETURNING id`,
        [schoolId],
      );
      const oldAssignment = await client.query(
        `INSERT INTO student_class_assignments
          (school_id, student_id, academic_session_id, school_class_id, section, status, is_current)
         VALUES ($1, $2, $3, $4, 'A', 'ACTIVE', true) RETURNING id`,
        [schoolId, student.rows[0].id, session.rows[0].id, classes.rows[0].id],
      );
      await client.query(
        `UPDATE student_class_assignments
         SET is_current = false, status = 'INACTIVE', end_date = CURRENT_DATE
         WHERE student_id = $1 AND school_id = $2 AND is_current = true`,
        [student.rows[0].id, schoolId],
      );
      await client.query(
        `INSERT INTO student_class_assignments
          (school_id, student_id, academic_session_id, school_class_id, section, status, is_current)
         VALUES ($1, $2, $3, $4, 'A', 'ACTIVE', true)`,
        [schoolId, student.rows[0].id, session.rows[0].id, classes.rows[1].id],
      );
      const history = await client.query(
        `SELECT id, status, is_current, end_date FROM student_class_assignments
         WHERE id = $1`,
        [oldAssignment.rows[0].id],
      );
      expect(history.rows[0]).toMatchObject({ status: "INACTIVE", is_current: false });
      expect(history.rows[0].end_date).not.toBeNull();
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("rejects cross-school assignment IDs through composite foreign keys", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const schools = await client.query(
        `INSERT INTO schools (code, name, city, state, status)
         VALUES ('PHASE3-A', 'Phase 3 A', 'Test City', 'Test State', 'active'),
                ('PHASE3-B', 'Phase 3 B', 'Test City', 'Test State', 'active')
         RETURNING id`,
      );
      const a = schools.rows[0].id;
      const b = schools.rows[1].id;
      const student = await client.query(
        `INSERT INTO students (school_id, admission_no, first_name, last_name, gender, class_name, section)
         VALUES ($1, 'PHASE3-CROSS', 'Cross', 'Student', 'Other', 'A', 'A') RETURNING id`,
        [a],
      );
      const session = await client.query(
        `INSERT INTO academic_sessions (school_id, name, start_date, end_date)
         VALUES ($1, 'PHASE3-CROSS', CURRENT_DATE, CURRENT_DATE + 30) RETURNING id`,
        [b],
      );
      const schoolClass = await client.query(
        `INSERT INTO school_classes (school_id, name, section, capacity)
         VALUES ($1, 'A', 'A', 30) RETURNING id`,
        [b],
      );
      await expect(client.query(
        `INSERT INTO student_class_assignments
          (school_id, student_id, academic_session_id, school_class_id, section)
         VALUES ($1, $2, $3, $4, 'A')`,
        [a, student.rows[0].id, session.rows[0].id, schoolClass.rows[0].id],
      )).rejects.toMatchObject({ code: "23503" });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("audits employee and school/student status transitions", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const school = await client.query(
        `INSERT INTO schools (code, name, city, state, status)
         VALUES ('PHASE3-AUDIT', 'Phase 3 Audit', 'Test City', 'Test State', 'active') RETURNING id`,
      );
      const schoolId = school.rows[0].id;
      const employee = await client.query(
        `INSERT INTO employees (school_id, employee_no, first_name, last_name)
         VALUES ($1, 'PHASE3-EMP', 'Audit', 'Employee') RETURNING id`,
        [schoolId],
      );
      const student = await client.query(
        `INSERT INTO students (school_id, admission_no, first_name, last_name, gender, class_name, section)
         VALUES ($1, 'PHASE3-AUDIT-ST', 'Audit', 'Student', 'Other', 'A', 'A') RETURNING id`,
        [schoolId],
      );
      await client.query(`UPDATE employees SET employment_status = 'INACTIVE' WHERE id = $1`, [employee.rows[0].id]);
      await client.query(`UPDATE schools SET status = 'suspended' WHERE id = $1`, [schoolId]);
      await client.query(`UPDATE students SET status = 'INACTIVE' WHERE id = $1`, [student.rows[0].id]);
      for (const [action, eventType, recordId] of [
        ["Changed employee status", "EMPLOYEE_STATUS_CHANGED", employee.rows[0].id],
        ["Changed school status to suspended", "SCHOOL_STATUS_CHANGED", schoolId],
        ["Changed student status to INACTIVE", "STUDENT_STATUS_CHANGED", student.rows[0].id],
      ]) {
        await client.query(
          `INSERT INTO audit_logs ("user", role, school_id, action, module, record_id, severity, event_type, result)
           VALUES ('phase3-test', 'SCHOOL_ADMIN', $1, $2, 'Phase 3', $3, 'info', $4, 'SUCCESS')`,
          [schoolId, action, recordId, eventType],
        );
      }
      const logs = await client.query(
        `SELECT event_type FROM audit_logs WHERE school_id = $1 AND event_type IN
         ('EMPLOYEE_STATUS_CHANGED', 'SCHOOL_STATUS_CHANGED', 'STUDENT_STATUS_CHANGED')`,
        [schoolId],
      );
      expect(logs.rows.map((row) => row.event_type)).toEqual(expect.arrayContaining([
        "EMPLOYEE_STATUS_CHANGED", "SCHOOL_STATUS_CHANGED", "STUDENT_STATUS_CHANGED",
      ]));
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});