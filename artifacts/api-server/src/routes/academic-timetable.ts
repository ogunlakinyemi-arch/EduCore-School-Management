import { Router, type NextFunction, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import {
  assertRoles,
  assertSchoolAccess,
  AuthError,
  getUserContext,
  handleAuthError,
  requireAuthentication,
} from "../middlewares/auth";

const router = Router();
router.use(requireAuthentication());

const writeRoles = ["SCHOOL_ADMIN", "PLATFORM_OWNER"] as const;
const readRoles = ["SCHOOL_ADMIN", "PLATFORM_OWNER", "TEACHER"] as const;
const weekdays = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
type TimetableValues = {
  schoolId: number;
  sessionId: number;
  termId: number;
  classId: number;
  section: string;
  subjectId: number;
  teacherId: number;
  day: (typeof weekdays)[number];
  startTime: string;
  endTime: string;
  room: string | null;
  status: "ACTIVE" | "CANCELLED" | "ARCHIVED";
};

const select = `te.id, te.school_id AS "schoolId",
  te.academic_session_id AS "sessionId", te.academic_term_id AS "termId",
  te.school_class_id AS "classId", te.section, te.subject_id AS "subjectId",
  te.teacher_employee_id AS "teacherId", te.weekday AS day, te.weekday AS weekday,
  te.start_time AS "startTime", te.end_time AS "endTime",
  te.room, te.status, te.created_at AS "createdAt", te.updated_at AS "updatedAt"`;
const returning = `id, school_id AS "schoolId", academic_session_id AS "sessionId",
  academic_term_id AS "termId", school_class_id AS "classId", section,
  subject_id AS "subjectId", teacher_employee_id AS "teacherId", weekday AS day, weekday AS weekday,
  start_time AS "startTime", end_time AS "endTime", room, status,
  created_at AS "createdAt", updated_at AS "updatedAt"`;

const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    handler(req, res).catch((error) => handleAuthError(error, req, res, next));

function id(value: unknown, label: string, required = true): number | null {
  if (value === undefined || value === null || value === "") {
    if (!required) return null;
    throw new AuthError(400, `${label} is required`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new AuthError(400, `${label} must be a positive integer`);
  return parsed;
}

function pathId(value: string | string[], label: string): number {
  const parsed = Array.isArray(value) ? Number.NaN : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new AuthError(404, `${label} not found`);
  return parsed;
}

function optionalString(value: unknown, label: string, maxLength: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > maxLength) {
    throw new AuthError(400, `${label} must be a string of at most ${maxLength} characters`);
  }
  return value.trim() || null;
}

function time(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) {
    throw new AuthError(400, `${label} must be a valid 24-hour time`);
  }
  return value.length === 5 ? `${value}:00` : value;
}

function weekday(value: unknown): TimetableValues["day"] {
  if (typeof value !== "string" || !weekdays.includes(value.toUpperCase() as TimetableValues["day"])) {
    throw new AuthError(400, `day must be one of ${weekdays.join(", ")}`);
  }
  return value.toUpperCase() as TimetableValues["day"];
}

function parseValues(input: Record<string, unknown>, previous?: TimetableValues): TimetableValues {
  const merged = (key: string) => input[key] === undefined ? undefined : input[key];
  const schoolId = id(merged("schoolId") ?? previous?.schoolId, "schoolId")!;
  const sessionId = id(merged("sessionId") ?? previous?.sessionId, "sessionId")!;
  const termId = id(input.termId ?? previous?.termId, "termId")!;
  const classId = id(merged("classId") ?? previous?.classId, "classId")!;
  const section = input.section === undefined
    ? previous?.section ?? ""
    : optionalString(input.section, "section", 80) ?? "";
  const subjectId = id(merged("subjectId") ?? previous?.subjectId, "subjectId")!;
  const teacherId = id(merged("teacherId") ?? previous?.teacherId, "teacherId")!;
  const suppliedDay = input.weekday ?? input.day;
  const day = suppliedDay === undefined ? previous?.day ?? weekday(undefined) : weekday(suppliedDay);
  const startTime = input.startTime === undefined
    ? previous?.startTime ?? time(undefined, "startTime")
    : time(input.startTime, "startTime");
  const endTime = input.endTime === undefined
    ? previous?.endTime ?? time(undefined, "endTime")
    : time(input.endTime, "endTime");
  if (startTime >= endTime) throw new AuthError(400, "endTime must be later than startTime");
  const room = input.room === undefined ? previous?.room ?? null : optionalString(input.room, "room", 120);
  const statusValue = input.status === undefined ? previous?.status ?? "ACTIVE" : input.status;
  if (statusValue !== "ACTIVE" && statusValue !== "CANCELLED" && statusValue !== "ARCHIVED") {
    throw new AuthError(400, "status must be ACTIVE, CANCELLED, or ARCHIVED");
  }
  return { schoolId, sessionId, termId, classId, section, subjectId, teacherId, day, startTime, endTime, room, status: statusValue };
}

function isManager(req: Request, schoolId: number): boolean {
  return getUserContext(req).roles.some(
    (assignment) =>
      assignment.status === "ACTIVE" &&
      (assignment.role === "PLATFORM_OWNER" && assignment.schoolId === null ||
        assignment.role === "SCHOOL_ADMIN" && assignment.schoolId === schoolId),
  );
}

function schoolFromQuery(req: Request, allowedRoles: readonly string[]): number {
  const schoolId = id(req.query.schoolId, "schoolId")!;
  ensureSchoolRole(req, schoolId, allowedRoles);
  assertSchoolAccess(req, schoolId, allowedRoles as any);
  return schoolId;
}

function ensureSchoolRole(req: Request, schoolId: number, roles: readonly string[]) {
  const context = getUserContext(req);
  const eligible = context.roles.some((assignment) =>
    roles.includes(assignment.role) &&
    (assignment.role === "PLATFORM_OWNER"
      ? assignment.schoolId === null
      : assignment.schoolId === schoolId),
  );
  const hasRole = context.roles.some((assignment) =>
    roles.includes(assignment.role) &&
    (assignment.role === "PLATFORM_OWNER" ? assignment.schoolId === null : assignment.schoolId !== null),
  );
  if (!hasRole) throw new AuthError(403, "You are not authorized for academic timetable access");
  if (!eligible) throw new AuthError(404, "Resource not found");
}

async function audit(req: Request, client: { query: (sql: string, values?: unknown[]) => Promise<any> }, schoolId: number, entryId: number, action: string) {
  const context = getUserContext(req);
  const actor = [context.user.firstName, context.user.lastName].filter(Boolean).join(" ") || context.user.email;
  const role = context.roles.find((assignment) => assignment.schoolId === schoolId)?.role ??
    context.roles.find((assignment) => assignment.schoolId === null)?.role ?? "AUTHENTICATED";
  await client.query(
    `INSERT INTO audit_logs ("user", role, actor_user_id, clerk_user_id, school_id, action, module, record_id, severity, event_type, result)
     VALUES ($1,$2,$3,$4,$5,$6,'Academics',$7,'info','APPLICATION_EVENT','SUCCESS')`,
    [actor, role, context.user.id, context.user.clerkUserId, schoolId, action, entryId],
  );
}

function filters(req: Request, schoolId: number, baseWhere: string[] = [], values: unknown[] = [schoolId]) {
  const conditions = ["te.school_id=$1", ...baseWhere];
  const optional: Array<[string, string, (value: unknown, label: string) => number | null]> = [
    ["sessionId", "te.academic_session_id", (value, label) => id(value, label)],
    ["termId", "te.academic_term_id", (value, label) => id(value, label)],
    ["classId", "te.school_class_id", (value, label) => id(value, label)],
    ["subjectId", "te.subject_id", (value, label) => id(value, label)],
    ["teacherId", "te.teacher_employee_id", (value, label) => id(value, label)],
  ];
  for (const [key, column, parse] of optional) {
    const raw = req.query[key];
    if (raw !== undefined) {
      values.push(parse(raw, key));
      conditions.push(`${column} = $${values.length}`);
    }
  }
  if (req.query.section !== undefined) {
    const section = optionalString(req.query.section, "section", 80) ?? "";
    values.push(section);
    conditions.push(`te.section = $${values.length}`);
  }
  if (req.query.day !== undefined) {
    values.push(weekday(req.query.day));
    conditions.push(`te.weekday = $${values.length}`);
  }
  if (req.query.status !== undefined) {
    if (req.query.status !== "ACTIVE" && req.query.status !== "CANCELLED" && req.query.status !== "ARCHIVED") {
      throw new AuthError(400, "status must be ACTIVE, CANCELLED, or ARCHIVED");
    }
    values.push(req.query.status);
    conditions.push(`te.status = $${values.length}`);
  }
  return { conditions, values };
}

async function timetableRows(req: Request, res: Response, schoolId: number, baseWhere: string[] = [], values: unknown[] = [schoolId]) {
  const filter = filters(req, schoolId, baseWhere, values);
  const result = await pool.query(
    `SELECT ${select}, c.name AS "className", s.name AS "subjectName",
       e.first_name AS "teacherFirstName", e.last_name AS "teacherLastName"
       FROM academic_timetable_entries te
       JOIN school_classes c ON c.id=te.school_class_id AND c.school_id=te.school_id
       JOIN subjects s ON s.id=te.subject_id AND s.school_id=te.school_id
       JOIN employees e ON e.id=te.teacher_employee_id AND e.school_id=te.school_id
      WHERE ${filter.conditions.join(" AND ")}
      ORDER BY CASE te.weekday WHEN 'MONDAY' THEN 1 WHEN 'TUESDAY' THEN 2 WHEN 'WEDNESDAY' THEN 3
        WHEN 'THURSDAY' THEN 4 WHEN 'FRIDAY' THEN 5 WHEN 'SATURDAY' THEN 6 ELSE 7 END, te.start_time, te.id`,
    filter.values,
  );
  res.json(result.rows);
}

router.get("/academic/timetable", asyncRoute(async (req, res) => {
  const schoolId = schoolFromQuery(req, readRoles);
  const context = getUserContext(req);
  const baseWhere: string[] = [];
  const values: unknown[] = [schoolId];
  if (!isManager(req, schoolId)) {
    if (!context.roles.some((assignment) => assignment.role === "TEACHER" && assignment.schoolId === schoolId && assignment.status === "ACTIVE")) {
      throw new AuthError(403, "You are not authorized to view timetables");
    }
    const teacher = await pool.query(`SELECT id FROM employees WHERE user_id=$1 AND school_id=$2`, [context.user.id, schoolId]);
    if (!teacher.rows[0]) throw new AuthError(404, "Teacher not found");
    if (req.query.teacherId !== undefined && Number(req.query.teacherId) !== Number(teacher.rows[0].id)) {
      throw new AuthError(404, "Timetable not found");
    }
    values.push(Number(teacher.rows[0].id));
    baseWhere.push(`te.teacher_employee_id=$${values.length}`);
    baseWhere.push(`EXISTS (
      SELECT 1 FROM teacher_class_assignments authorized
      JOIN academic_sessions authorized_session
        ON authorized_session.id=te.academic_session_id AND authorized_session.school_id=te.school_id
       WHERE authorized.school_id=te.school_id AND authorized.employee_id=te.teacher_employee_id
         AND authorized.academic_session_id=te.academic_session_id
         AND authorized.school_class_id=te.school_class_id
         AND (authorized.section='' OR authorized.section=te.section)
         AND (authorized.assignment_type<>'SUBJECT_TEACHER' OR authorized.subject_id=te.subject_id)
         AND authorized.status='ACTIVE'
         AND authorized.start_date <= authorized_session.end_date
         AND (authorized.end_date IS NULL OR authorized.end_date >= authorized_session.start_date)
    )`);
  }
  await timetableRows(req, res, schoolId, baseWhere, values);
}));

router.post("/academic/timetable", asyncRoute(async (req, res) => {
  const values = parseValues(req.body ?? {});
  ensureSchoolRole(req, values.schoolId, writeRoles);
  assertSchoolAccess(req, values.schoolId, writeRoles as any);
  const client = await pool.connect();
  let result: any;
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock($1::int, $2::int)`, [values.schoolId, weekdays.indexOf(values.day) + 1]);
    const valid = await client.query(
      `SELECT c.id
         FROM school_classes c
         JOIN academic_sessions ac ON ac.id=$2 AND ac.school_id=c.school_id
         LEFT JOIN academic_terms t ON t.id=$3 AND t.school_id=c.school_id AND t.academic_session_id=ac.id
         JOIN subjects sub ON sub.id=$5 AND sub.school_id=c.school_id
         JOIN employees e ON e.id=$6 AND e.school_id=c.school_id
        WHERE c.id=$4 AND c.school_id=$1
        AND t.id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM class_subjects cs
             WHERE cs.school_id=c.school_id AND cs.school_class_id=c.id
               AND cs.subject_id=sub.id AND cs.academic_session_id=ac.id
               AND (cs.academic_term_id IS NULL OR cs.academic_term_id IS NOT DISTINCT FROM $3)
               AND (cs.section IS NULL OR cs.section='' OR cs.section=$7)
               AND (cs.employee_id IS NULL OR cs.employee_id=e.id)
               AND UPPER(cs.status)='ACTIVE'
          )
          AND EXISTS (
            SELECT 1 FROM teacher_class_assignments ta
             WHERE ta.school_id=c.school_id AND ta.employee_id=e.id
               AND ta.school_class_id=c.id AND ta.academic_session_id=ac.id
               AND (ta.section='' OR ta.section=$7)
               AND (ta.assignment_type<>'SUBJECT_TEACHER' OR ta.subject_id=sub.id)
               AND ta.status='ACTIVE'
               AND ta.start_date <= COALESCE(ac.end_date, CURRENT_DATE)
               AND (ta.end_date IS NULL OR ta.end_date >= ac.start_date)
          )`,
      [values.schoolId, values.sessionId, values.termId, values.classId, values.subjectId, values.teacherId, values.section],
    );
    if (!valid.rows[0]) throw new AuthError(404, "Class, subject, teacher, session, term, or assignment not found in school");
    if (values.status === "ACTIVE") await rejectConflicts(client, values);
    result = await client.query(
      `INSERT INTO academic_timetable_entries
        (school_id, academic_session_id, academic_term_id, school_class_id, section, subject_id, teacher_employee_id,
         weekday, start_time, end_time, room, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING ${returning}`,
      [values.schoolId, values.sessionId, values.termId, values.classId, values.section, values.subjectId, values.teacherId,
        values.day, values.startTime, values.endTime, values.room, values.status, getUserContext(req).user.id],
    );
    await audit(req, client, values.schoolId, result.rows[0].id, "Created timetable entry");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  res.status(201).json(result.rows[0]);
}));

router.patch("/academic/timetable/:entryId", asyncRoute(async (req, res) => {
  const entryId = pathId(req.params.entryId, "Timetable entry");
  const schoolId = id(req.body?.schoolId, "schoolId")!;
  ensureSchoolRole(req, schoolId, writeRoles);
  assertSchoolAccess(req, schoolId, writeRoles as any);
  const client = await pool.connect();
  let updated: any;
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT ${select} FROM academic_timetable_entries te
        WHERE te.id=$1 AND te.school_id=$2 FOR UPDATE`,
      [entryId, schoolId],
    );
    if (!existing.rows[0]) throw new AuthError(404, "Timetable entry not found");
    const previous = rowToValues(existing.rows[0]);
    const values = parseValues({ ...req.body, schoolId }, previous);
    await client.query(`SELECT pg_advisory_xact_lock($1::int, $2::int)`, [values.schoolId, weekdays.indexOf(values.day) + 1]);
    const valid = await client.query(
      `SELECT c.id FROM school_classes c
        JOIN academic_sessions ac ON ac.id=$2 AND ac.school_id=c.school_id
        LEFT JOIN academic_terms t ON t.id=$3 AND t.school_id=c.school_id AND t.academic_session_id=ac.id
        JOIN subjects sub ON sub.id=$5 AND sub.school_id=c.school_id
        JOIN employees e ON e.id=$6 AND e.school_id=c.school_id
       WHERE c.id=$4 AND c.school_id=$1 AND t.id IS NOT NULL
         AND EXISTS (SELECT 1 FROM class_subjects cs WHERE cs.school_id=c.school_id AND cs.school_class_id=c.id
           AND cs.subject_id=sub.id AND cs.academic_session_id=ac.id
           AND (cs.academic_term_id IS NULL OR cs.academic_term_id IS NOT DISTINCT FROM $3)
           AND (cs.section IS NULL OR cs.section='' OR cs.section=$7)
           AND (cs.employee_id IS NULL OR cs.employee_id=e.id) AND UPPER(cs.status)='ACTIVE')
         AND EXISTS (SELECT 1 FROM teacher_class_assignments ta WHERE ta.school_id=c.school_id
           AND ta.employee_id=e.id AND ta.school_class_id=c.id AND ta.academic_session_id=ac.id
           AND (ta.section='' OR ta.section=$7) AND (ta.assignment_type<>'SUBJECT_TEACHER' OR ta.subject_id=sub.id)
           AND ta.status='ACTIVE' AND ta.start_date <= COALESCE(ac.end_date,CURRENT_DATE)
           AND (ta.end_date IS NULL OR ta.end_date >= ac.start_date))`,
      [values.schoolId, values.sessionId, values.termId, values.classId, values.subjectId, values.teacherId, values.section],
    );
    if (!valid.rows[0]) throw new AuthError(404, "Class, subject, teacher, session, term, or assignment not found in school");
    if (values.status === "ACTIVE") await rejectConflicts(client, values, entryId);
    updated = await client.query(
      `UPDATE academic_timetable_entries SET academic_session_id=$1, academic_term_id=$2,
        school_class_id=$3, section=$4, subject_id=$5, teacher_employee_id=$6, weekday=$7,
        start_time=$8, end_time=$9, room=$10, status=$11, updated_at=NOW()
       WHERE id=$12 AND school_id=$13 RETURNING ${returning}`,
      [values.sessionId, values.termId, values.classId, values.section, values.subjectId, values.teacherId,
        values.day, values.startTime, values.endTime, values.room, values.status, entryId, schoolId],
    );
    if (!updated.rows[0]) throw new AuthError(404, "Timetable entry not found");
    const action = values.status === "CANCELLED"
      ? "Cancelled timetable entry"
      : values.status === "ARCHIVED" ? "Archived timetable entry" : "Updated timetable entry";
    await audit(req, client, schoolId, entryId, action);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  res.json(updated.rows[0]);
}));

function rowToValues(row: Record<string, any>): TimetableValues {
  return {
    schoolId: Number(row.schoolId), sessionId: Number(row.sessionId),
    termId: Number(row.termId), classId: Number(row.classId),
    section: row.section ?? "", subjectId: Number(row.subjectId), teacherId: Number(row.teacherId),
    day: weekday(row.day), startTime: String(row.startTime).slice(0, 8),
    endTime: String(row.endTime).slice(0, 8), room: row.room ?? null,
    status: row.status,
  };
}

async function rejectConflicts(client: { query: (sql: string, values?: unknown[]) => Promise<any> }, values: TimetableValues, excludeId?: number) {
  const result = await client.query(
    `SELECT id,
       (teacher_employee_id=$6) AS teacher_conflict,
       (school_class_id=$4 AND COALESCE(section,'')=COALESCE($5,'')) AS class_conflict,
       (room IS NOT NULL AND $10::text IS NOT NULL AND LOWER(room)=LOWER($10)) AS room_conflict
       FROM academic_timetable_entries
      WHERE school_id=$1 AND academic_session_id=$2 AND academic_term_id IS NOT DISTINCT FROM $3
        AND weekday=$7 AND status='ACTIVE'
        AND start_time < $9::time AND end_time > $8::time
        AND ($11::int IS NULL OR id<>$11)`,
    [values.schoolId, values.sessionId, values.termId, values.classId, values.section, values.teacherId,
      values.day, values.startTime, values.endTime, values.room, excludeId ?? null],
  );
  const conflict = result.rows.find((row: any) => row.teacher_conflict || row.class_conflict || row.room_conflict);
  if (conflict) {
    const kind = conflict.teacher_conflict ? "teacher" : conflict.class_conflict ? "class and section" : "room";
    throw new AuthError(409, `Timetable ${kind} conflict`);
  }
}

router.get("/academic/students/me/timetable", asyncRoute(async (req, res) => {
  assertRoles(req, ["STUDENT"]);
  const context = getUserContext(req);
  const result = await pool.query(
    `SELECT st.id AS "studentId", st.school_id AS "schoolId",
       a.academic_session_id AS "sessionId", a.academic_term_id AS "termId",
       a.school_class_id AS "classId", a.section
       FROM students st JOIN student_class_assignments a ON a.student_id=st.id AND a.school_id=st.school_id
       JOIN school_classes c ON c.id=a.school_class_id AND c.school_id=a.school_id
       JOIN academic_sessions ac ON ac.id=a.academic_session_id AND ac.school_id=a.school_id
      WHERE st.user_id=$1 AND a.is_current=true AND a.status='ACTIVE'
        AND ac.is_current=true AND ac.status='ACTIVE' ORDER BY a.start_date DESC LIMIT 1`,
    [context.user.id],
  );
  const assignment = result.rows[0];
  if (!assignment) throw new AuthError(404, "Current student class assignment not found");
  if (req.query.schoolId !== undefined && id(req.query.schoolId, "schoolId") !== Number(assignment.schoolId)) {
    throw new AuthError(404, "Timetable not found");
  }
  await timetableRows(req, res, Number(assignment.schoolId), [
    "te.school_id=$1", "te.academic_session_id=$2", "te.school_class_id=$3",
    "COALESCE(te.section,'')=$4", "te.academic_term_id=$5", "te.status='ACTIVE'",
  ], [assignment.schoolId, assignment.sessionId, assignment.classId, assignment.section ?? "", assignment.termId]);
}));

router.get("/academic/parents/children/:studentId/timetable", asyncRoute(async (req, res) => {
  assertRoles(req, ["PARENT"]);
  const studentId = pathId(req.params.studentId, "Student");
  const context = getUserContext(req);
  const result = await pool.query(
    `SELECT st.id AS "studentId", st.school_id AS "schoolId",
       a.academic_session_id AS "sessionId", a.academic_term_id AS "termId",
       a.school_class_id AS "classId", a.section
       FROM parents p
       JOIN parent_student_relationships psr ON psr.parent_id=p.id AND UPPER(psr.status)='ACTIVE'
       JOIN students st ON st.id=psr.student_id AND st.school_id=p.school_id
       JOIN student_class_assignments a ON a.student_id=st.id AND a.school_id=st.school_id
       JOIN school_classes c ON c.id=a.school_class_id AND c.school_id=a.school_id
       JOIN academic_sessions ac ON ac.id=a.academic_session_id AND ac.school_id=a.school_id
      WHERE p.user_id=$1 AND UPPER(p.status)='ACTIVE' AND psr.student_id=$2
        AND a.is_current=true AND a.status='ACTIVE' AND ac.is_current=true AND ac.status='ACTIVE'
      ORDER BY a.start_date DESC LIMIT 1`,
    [context.user.id, studentId],
  );
  const assignment = result.rows[0];
  if (!assignment) throw new AuthError(404, "Student not found");
  if (req.query.schoolId !== undefined && id(req.query.schoolId, "schoolId") !== Number(assignment.schoolId)) {
    throw new AuthError(404, "Timetable not found");
  }
  await timetableRows(req, res, Number(assignment.schoolId), [
    "te.school_id=$1", "te.academic_session_id=$2", "te.school_class_id=$3",
    "COALESCE(te.section,'')=$4", "te.academic_term_id=$5", "te.status='ACTIVE'",
  ], [assignment.schoolId, assignment.sessionId, assignment.classId, assignment.section ?? "", assignment.termId]);
}));

export default router;