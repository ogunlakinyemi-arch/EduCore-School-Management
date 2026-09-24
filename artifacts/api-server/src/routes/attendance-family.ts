import { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "@workspace/db";
import {
  assertRoles,
  AuthError,
  getUserContext,
  handleAuthError,
  requireAuthentication,
} from "../middlewares/auth";

const router = Router();
router.use(requireAuthentication());

const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    handler(req, res).catch((error) => handleAuthError(error, req, res, next));

function dateFilter(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AuthError(400, `${name} must be a valid date in YYYY-MM-DD format`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new AuthError(400, `${name} must be a valid date in YYYY-MM-DD format`);
  }
  return value;
}

function studentIdParam(value: string | string[]) {
  if (typeof value !== "string") throw new AuthError(404, "Student not found");
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new AuthError(404, "Student not found");
  }
  return id;
}

async function attendanceForStudent(
  studentId: number,
  schoolId: number,
  req: Request,
  res: Response,
) {
  const from = dateFilter(req.query.from, "from");
  const to = dateFilter(req.query.to, "to");
  if (from && to && from > to) {
    throw new AuthError(400, "from must be on or before to");
  }

  const values: unknown[] = [studentId, schoolId];
  const filters: string[] = [];
  if (from) {
    values.push(from);
    filters.push(`ae.event_date >= $${values.length}::date`);
  }
  if (to) {
    values.push(to);
    filters.push(`ae.event_date <= $${values.length}::date`);
  }
  const result = await pool.query(
    `SELECT ae.id, ae.student_id AS "studentId", ae.school_id AS "schoolId",
        ae.event_date AS date, ae.event_type AS "eventType",
        ae.attendance_status AS status, ae.occurred_at AS "occurredAt",
        ae.identification_method AS "identificationMethod",
        discrepancy.status AS "discrepancyStatus"
       FROM attendance_events ae
       LEFT JOIN LATERAL (
         SELECT d.status
           FROM attendance_discrepancies d
          WHERE d.attendance_event_id = ae.id
            AND d.school_id = ae.school_id
            AND d.student_id = ae.student_id
          ORDER BY d.created_at DESC, d.id DESC
          LIMIT 1
       ) discrepancy ON TRUE
      WHERE ae.student_id = $1 AND ae.school_id = $2
        ${filters.length ? `AND ${filters.join(" AND ")}` : ""}
      ORDER BY ae.event_date DESC, ae.occurred_at DESC, ae.id DESC
      LIMIT 500`,
    values,
  );
  res.json(result.rows);
}

router.get(
  "/parent/children/:studentId/attendance",
  asyncRoute(async (req, res) => {
    assertRoles(req, ["PARENT"]);
    const context = getUserContext(req);
    const studentId = studentIdParam(req.params.studentId);
    const authorized = await pool.query(
      `SELECT st.id AS "studentId", st.school_id AS "schoolId"
         FROM parents p
         JOIN parent_student_relationships psr
           ON psr.parent_id = p.id AND UPPER(psr.status) = 'ACTIVE'
         JOIN students st ON st.id = psr.student_id
         JOIN schools s ON s.id = st.school_id AND s.id = p.school_id
        WHERE p.user_id = $1 AND UPPER(p.status) = 'ACTIVE'
          AND psr.student_id = $2
        LIMIT 1`,
      [context.user.id, studentId],
    );
    const student = authorized.rows[0];
    if (!student) throw new AuthError(404, "Student not found");
    await attendanceForStudent(student.studentId, student.schoolId, req, res);
  }),
);

router.get(
  "/student/attendance",
  asyncRoute(async (req, res) => {
    assertRoles(req, ["STUDENT"]);
    const context = getUserContext(req);
    const result = await pool.query(
      `SELECT st.id AS "studentId", st.school_id AS "schoolId"
         FROM students st
         JOIN schools s ON s.id = st.school_id
        WHERE st.user_id = $1
        LIMIT 1`,
      [context.user.id],
    );
    const student = result.rows[0];
    if (!student) throw new AuthError(404, "Student profile not found");
    await attendanceForStudent(student.studentId, student.schoolId, req, res);
  }),
);

router.get(
  "/student/attendance/:studentId",
  asyncRoute(async (req, res) => {
    assertRoles(req, ["STUDENT"]);
    const context = getUserContext(req);
    const requestedStudentId = studentIdParam(req.params.studentId);
    const result = await pool.query(
      `SELECT st.id AS "studentId", st.school_id AS "schoolId"
         FROM students st
         JOIN schools s ON s.id = st.school_id
        WHERE st.user_id = $1
        LIMIT 1`,
      [context.user.id],
    );
    const student = result.rows[0];
    if (!student || student.studentId !== requestedStudentId) {
      throw new AuthError(404, "Student not found");
    }
    await attendanceForStudent(student.studentId, student.schoolId, req, res);
  }),
);

export default router;