import { Router, type NextFunction, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { familyChildSchoolScope } from "../lib/family-child-school-scope";
import {
  AuthError,
  assertSchoolOperationalAccess,
  getUserContext,
  handleAuthError,
  requireAuthentication,
} from "../middlewares/auth";
import {
  queueCommunicationNotification,
  type CommunicationQueryClient,
} from "../services/communication-service";

const router = Router();
router.use(requireAuthentication());

const ADMIN = ["SCHOOL_ADMIN"] as const;
const READ_SCHOOL = ["SCHOOL_ADMIN", "PLATFORM_OWNER", "TEACHER"] as const;
const ASSIGNMENT_STATUSES = ["DRAFT", "PUBLISHED", "CLOSED", "ARCHIVED"] as const;
const ASSESSMENT_STATUSES = ["DRAFT", "OPEN", "CLOSED", "PUBLISHED", "ARCHIVED"] as const;

const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    handler(req, res).catch((error) => handleAuthError(error, req, res, next));

function id(value: unknown, label: string, status: 400 | 404 = 400): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new AuthError(status, `${label} is invalid`);
  return parsed;
}

function requiredString(value: unknown, label: string, max = 250): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new AuthError(400, `${label} must be a non-empty string of at most ${max} characters`);
  }
  return value.trim();
}

function optionalString(value: unknown, label: string, max = 10000): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string" || value.length > max) {
    throw new AuthError(400, `${label} must be a string of at most ${max} characters`);
  }
  return value;
}

function dateValue(value: unknown, label: string, optional = false): string | null | undefined {
  if (value === undefined && optional) return undefined;
  if (value === null && optional) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AuthError(400, `${label} must be a valid date in YYYY-MM-DD format`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new AuthError(400, `${label} must be a valid date in YYYY-MM-DD format`);
  }
  return value;
}

function scoreValue(value: unknown, label: string, optional = false): number | undefined {
  if (value === undefined && optional) return undefined;
  const score = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(score) || score <= 0 || score > 99999999.99 || Math.round(score * 100) !== score * 100) {
    throw new AuthError(400, `${label} must be greater than 0 and have at most two decimal places`);
  }
  return score;
}

function statusValue(value: unknown, choices: readonly string[], optional = false): string | undefined {
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string" || !choices.includes(value)) {
    throw new AuthError(400, `status must be one of: ${choices.join(", ")}`);
  }
  return value;
}

function schoolContext(req: Request, raw: unknown, allowed: readonly string[], operational = false) {
  const schoolId = id(raw, "schoolId");
  const context = getUserContext(req);
  if (operational) assertSchoolOperationalAccess(req, schoolId, allowed as any);
  const permitted = context.roles.some((role) =>
    role.status === "ACTIVE" &&
    allowed.includes(role.role) &&
    (role.role === "PLATFORM_OWNER" ? role.schoolId === null : role.schoolId === schoolId),
  );
  if (!permitted) {
    const roleAllowedElsewhere = context.roles.some((role) => role.status === "ACTIVE" && allowed.includes(role.role));
    if (roleAllowedElsewhere) throw new AuthError(404, "Academic resource not found");
    throw new AuthError(403, "You are not authorized for this academic operation");
  }
  return { schoolId, context };
}

function audit(
  req: Request,
  schoolId: number,
  action: string,
  recordId: number,
  client: CommunicationQueryClient = pool,
) {
  const context = getUserContext(req);
  const actor = [context.user.firstName, context.user.lastName].filter(Boolean).join(" ") || context.user.email;
  const role = context.roles.find((r) => r.schoolId === schoolId || r.schoolId === null)?.role ?? "AUTHENTICATED";
  return client.query(
    `INSERT INTO audit_logs ("user", role, actor_user_id, clerk_user_id, school_id, action, module, record_id, severity, event_type, result)
     VALUES ($1,$2,$3,$4,$5,$6,'Academics',$7,'info','APPLICATION_EVENT','SUCCESS')`,
    [actor, role, context.user.id, context.user.clerkUserId, schoolId, action, recordId],
  );
}

async function notifyPublishedAssignment(
  client: CommunicationQueryClient,
  assignment: {
    id: number;
    schoolId: number;
    sessionId: number;
    termId: number;
    classId: number;
    section: string | null;
    title: string;
  },
) {
  const recipients = await client.query<{ userId: number | string; studentId: number | string; link: string }>(
    `SELECT roster.recipient_user_id AS "userId",
            roster.subject_student_id AS "studentId",
            CASE WHEN bool_or(roster.is_student) THEN '/my-academics' ELSE '/' END AS link
       FROM (
         SELECT st.user_id AS recipient_user_id, st.id AS subject_student_id, TRUE AS is_student
           FROM student_class_assignments sca
           JOIN students st ON st.id=sca.student_id AND st.school_id=sca.school_id
          WHERE sca.school_id=$1 AND sca.school_class_id=$2
            AND sca.academic_session_id=$3 AND sca.academic_term_id=$4
            AND ($5::text IS NULL OR sca.section=$5)
            AND UPPER(sca.status)='ACTIVE' AND UPPER(st.status)='ACTIVE'
         UNION ALL
          SELECT p.user_id AS recipient_user_id, st.id AS subject_student_id, FALSE AS is_student
           FROM student_class_assignments sca
           JOIN students st ON st.id=sca.student_id AND st.school_id=sca.school_id
           JOIN parent_student_relationships psr
             ON psr.student_id=st.id AND UPPER(psr.status)='ACTIVE'
           JOIN parents p ON p.id=psr.parent_id AND p.school_id=sca.school_id
          WHERE sca.school_id=$1 AND sca.school_class_id=$2
            AND sca.academic_session_id=$3 AND sca.academic_term_id=$4
            AND ($5::text IS NULL OR sca.section=$5)
            AND UPPER(sca.status)='ACTIVE' AND UPPER(st.status)='ACTIVE'
            AND UPPER(p.status)='ACTIVE'
       ) roster
      WHERE roster.recipient_user_id IS NOT NULL
       GROUP BY roster.recipient_user_id, roster.subject_student_id
       ORDER BY roster.recipient_user_id, roster.subject_student_id`,
    [assignment.schoolId, assignment.classId, assignment.sessionId, assignment.termId, assignment.section],
  );

  for (const recipient of recipients.rows) {
    await queueCommunicationNotification(client, {
      recipientUserId: Number(recipient.userId),
      schoolId: assignment.schoolId,
       subjectStudentId: Number(recipient.studentId),
       subjectClassId: assignment.classId,
      category: "ASSIGNMENT",
       eventKey: `assignment-published:${assignment.id}:${recipient.studentId}`,
      subject: "New assignment available",
      body: `A new assignment, "${assignment.title}", is available.`,
      link: recipient.link,
      channels: ["IN_APP"],
    });
  }
}

const assignmentColumns = `a.id, a.school_id AS "schoolId", a.academic_session_id AS "sessionId",
  a.academic_term_id AS "termId", a.school_class_id AS "classId", a.section,
  a.subject_id AS "subjectId", a.teacher_employee_id AS "teacherId", a.created_by AS "createdBy", a.title, a.description,
  a.issue_date AS "issueDate", a.due_date AS "dueDate", a.max_score AS "maxScore",
  a.status, a.created_at AS "createdAt", a.updated_at AS "updatedAt"`;

const assessmentTypeColumns = `id, school_id AS "schoolId", name, code, status`;

const assessmentColumns = `a.id, a.school_id AS "schoolId", a.academic_session_id AS "sessionId",
  a.academic_term_id AS "termId", a.school_class_id AS "classId", a.section,
  a.subject_id AS "subjectId", a.teacher_employee_id AS "teacherId",
  a.assessment_type_id AS "assessmentTypeId", at.name AS "assessmentTypeName",
  a.title, a.assessment_date AS date,
  a.max_score AS "maxScore", a.status, a.description, a.created_by AS "createdBy",
  a.created_at AS "createdAt", a.updated_at AS "updatedAt"`;

function filters(req: Request, alias: string, firstValues: unknown[], dateColumn = "due_date") {
  const values = [...firstValues];
  const where: string[] = [];
  const fields: Array<[string, string]> = [
    ["sessionId", "academic_session_id"],
    ["termId", "academic_term_id"],
    ["classId", "school_class_id"],
    ["subjectId", "subject_id"],
    ["teacherId", "teacher_employee_id"],
  ];
  for (const [queryName, column] of fields) {
    if (req.query[queryName] !== undefined) {
      values.push(id(req.query[queryName], queryName));
      where.push(`${alias}.${column} = $${values.length}`);
    }
  }
  for (const queryName of ["section", "status"]) {
    if (req.query[queryName] !== undefined) {
      const value = req.query[queryName];
      if (typeof value !== "string" || !value.trim()) throw new AuthError(400, `${queryName} is invalid`);
      values.push(value.trim());
      where.push(`${alias}.${queryName} = $${values.length}`);
    }
  }
  const from = dateValue(req.query.from, "from", true);
  const to = dateValue(req.query.to, "to", true);
  if (from && to && from > to) throw new AuthError(400, "from must be on or before to");
  if (from) {
    values.push(from);
    where.push(`${alias}.${dateColumn} >= $${values.length}::date`);
  }
  if (to) {
    values.push(to);
    where.push(`${alias}.${dateColumn} <= $${values.length}::date`);
  }
  return { values, where };
}

async function validateAcademicResource(
  schoolId: number,
  sessionId: number,
  termId: number,
  classId: number,
  subjectId: number,
  section: string | null,
) {
  const result = await pool.query(
    `SELECT c.id
       FROM school_classes c
       JOIN academic_sessions s ON s.id=$2 AND s.school_id=c.school_id
       JOIN academic_terms t ON t.id=$3 AND t.school_id=c.school_id AND t.academic_session_id=s.id
       JOIN subjects sub ON sub.id=$5 AND sub.school_id=c.school_id
       JOIN class_subjects cs ON cs.school_id=c.school_id AND cs.school_class_id=c.id
          AND cs.subject_id=sub.id AND cs.academic_session_id=s.id
          AND cs.academic_term_id IS NOT DISTINCT FROM t.id AND cs.status='ACTIVE'
          AND (cs.section IS NULL OR cs.section IS NOT DISTINCT FROM $6)
      WHERE c.id=$4 AND c.school_id=$1`,
    [schoolId, sessionId, termId, classId, subjectId, section],
  );
  if (!result.rows[0]) throw new AuthError(404, "Academic school, session, term, class, section, or subject not found");
}

async function validateTeacherAssignment(
  schoolId: number,
  userId: number,
  sessionId: number,
  termId: number,
  classId: number,
  subjectId: number,
  section: string | null,
) {
  const result = await pool.query(
    `SELECT e.id
       FROM employees e
       JOIN teacher_class_assignments tca ON tca.employee_id=e.id AND tca.school_id=e.school_id
          AND tca.academic_session_id=$3 AND tca.school_class_id=$5
          AND tca.section=COALESCE($7,'') AND tca.status='ACTIVE'
          AND (tca.subject_id IS NULL OR tca.subject_id=$6)
       JOIN class_subjects cs ON cs.school_id=e.school_id AND cs.school_class_id=$5
          AND cs.subject_id=$6 AND cs.academic_session_id=$3
          AND cs.academic_term_id IS NOT DISTINCT FROM $4
          AND (cs.section IS NULL OR cs.section IS NOT DISTINCT FROM $7) AND cs.status='ACTIVE'
          AND (cs.employee_id IS NULL OR cs.employee_id=e.id)
      WHERE e.school_id=$1 AND e.user_id=$2 AND e.employment_status='ACTIVE'
        AND e.employee_type='TEACHER'`,
    [schoolId, userId, sessionId, termId, classId, subjectId, section],
  );
  if (!result.rows[0]) throw new AuthError(403, "Teacher is not assigned to this class, subject, session, and section");
  return id(result.rows[0].id, "teacherId", 404);
}

function assignmentInput(body: any, partial = false) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AuthError(400, "A JSON object body is required");
  const result: Record<string, unknown> = {};
  const requiredFields = ["sessionId", "termId", "classId", "subjectId", "title", "issueDate", "dueDate", "maxScore"];
  for (const key of requiredFields) {
    if (partial && body[key] === undefined) continue;
    if (["sessionId", "termId", "classId", "subjectId"].includes(key)) result[key] = id(body[key], key);
    else if (key === "title") result[key] = requiredString(body[key], key);
    else if (key === "issueDate" || key === "dueDate") result[key] = dateValue(body[key], key);
    else result[key] = scoreValue(body[key], key);
  }
  if (body.section !== undefined) {
    if (body.section !== null && (typeof body.section !== "string" || body.section.length > 100)) {
      throw new AuthError(400, "section must be a string of at most 100 characters or null");
    }
    result.section = body.section;
  } else if (!partial) result.section = null;
  const description = optionalString(body.description, "description");
  if (description !== undefined) result.description = description;
  const status = statusValue(body.status, ASSIGNMENT_STATUSES, true);
  if (status !== undefined) result.status = status;
  if (body.teacherId !== undefined) result.teacherId = id(body.teacherId, "teacherId");
  const allowed = new Set(["sessionId", "termId", "classId", "subjectId", "teacherId", "title", "issueDate", "dueDate", "maxScore", "section", "description", "status"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new AuthError(400, "Request contains unsupported fields");
  if (!partial && (result.issueDate as string) > (result.dueDate as string)) throw new AuthError(400, "issueDate must be on or before dueDate");
  return result;
}

function assessmentInput(body: any, partial = false) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AuthError(400, "A JSON object body is required");
  const result: Record<string, unknown> = {};
  const requiredFields = ["sessionId", "termId", "classId", "subjectId", "assessmentTypeId", "title", "date", "maxScore"];
  for (const key of requiredFields) {
    if (partial && body[key] === undefined) continue;
    if (["sessionId", "termId", "classId", "subjectId", "assessmentTypeId"].includes(key)) result[key] = id(body[key], key);
    else if (key === "title") result[key] = requiredString(body[key], key);
    else if (key === "date") result[key] = dateValue(body[key], key);
    else result[key] = scoreValue(body[key], key);
  }
  if (body.section !== undefined) {
    if (body.section !== null && (typeof body.section !== "string" || body.section.length > 100)) {
      throw new AuthError(400, "section must be a string of at most 100 characters or null");
    }
    result.section = body.section;
  } else if (!partial) result.section = null;
  const description = optionalString(body.description, "description");
  if (description !== undefined) result.description = description;
  const status = statusValue(body.status, ASSESSMENT_STATUSES, true);
  if (status !== undefined) result.status = status;
  if (body.teacherId !== undefined) result.teacherId = id(body.teacherId, "teacherId");
  const allowed = new Set([...requiredFields, "section", "description", "status", "teacherId"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) throw new AuthError(400, "Request contains unsupported fields");
  return result;
}

async function studentAssignments(req: Request, res: Response, studentId: number) {
  const values: unknown[] = [studentId, id(req.query.schoolId, "schoolId")];
  const predicates: string[] = [];
  for (const [name, column] of [["sessionId", "academic_session_id"], ["termId", "academic_term_id"], ["classId", "school_class_id"], ["subjectId", "subject_id"]] as const) {
    if (req.query[name] !== undefined) {
      values.push(id(req.query[name], name));
      predicates.push(`a.${column}=$${values.length}`);
    }
  }
  if (req.query.section !== undefined) {
    if (typeof req.query.section !== "string" || !req.query.section.trim()) throw new AuthError(400, "section is invalid");
    values.push(req.query.section.trim());
    predicates.push(`a.section=$${values.length}`);
  }
  const from = dateValue(req.query.from, "from", true);
  const to = dateValue(req.query.to, "to", true);
  if (from && to && from > to) throw new AuthError(400, "from must be on or before to");
  if (from) {
    values.push(from);
    predicates.push(`a.due_date >= $${values.length}::date`);
  }
  if (to) {
    values.push(to);
    predicates.push(`a.due_date <= $${values.length}::date`);
  }
  const result = await pool.query(
    `SELECT ${assignmentColumns}
       FROM academic_assignments a
      WHERE a.school_id=$2 AND a.status='PUBLISHED'
        ${predicates.length ? `AND ${predicates.join(" AND ")}` : ""}
        AND EXISTS (
          SELECT 1 FROM student_class_assignments sca
           WHERE sca.student_id=$1 AND sca.school_id=a.school_id
             AND sca.academic_session_id=a.academic_session_id
             AND sca.academic_term_id=a.academic_term_id
             AND sca.school_class_id=a.school_class_id AND sca.section=a.section
        )
      ORDER BY a.due_date, a.id`,
    values,
  );
  res.json(result.rows);
}

router.get("/academic/assignments", asyncRoute(async (req, res) => {
  const { schoolId, context } = schoolContext(req, req.query.schoolId, READ_SCHOOL);
  if (req.query.status !== undefined && !ASSIGNMENT_STATUSES.includes(String(req.query.status) as typeof ASSIGNMENT_STATUSES[number])) {
    throw new AuthError(400, "status is invalid");
  }
  const { values, where } = filters(req, "a", [schoolId]);
  if (!context.roles.some((r) => r.role === "SCHOOL_ADMIN" && r.schoolId === schoolId && r.status === "ACTIVE") &&
      !context.roles.some((r) => r.role === "PLATFORM_OWNER" && r.schoolId === null)) {
    const teacher = await pool.query(
      `SELECT e.id FROM employees e WHERE e.school_id=$1 AND e.user_id=$2
        AND e.employment_status='ACTIVE' AND e.employee_type='TEACHER'`,
      [schoolId, context.user.id],
    );
    if (!teacher.rows[0]) throw new AuthError(403, "An active teacher profile in this school is required");
    values.push(teacher.rows[0].id);
    where.push(`a.teacher_employee_id=$${values.length}`);
  }
  const result = await pool.query(
    `SELECT ${assignmentColumns} FROM academic_assignments a
      WHERE a.school_id=$1 ${where.length ? `AND ${where.join(" AND ")}` : ""}
      ORDER BY a.issue_date DESC, a.id DESC`,
    values,
  );
  res.json(result.rows);
}));

router.post("/academic/assignments", asyncRoute(async (req, res) => {
  const input = assignmentInput(req.body);
  const { schoolId, context } = schoolContext(req, req.query.schoolId, [...ADMIN, "TEACHER"], true);
  const section = (input.section ?? null) as string | null;
  await validateAcademicResource(schoolId, input.sessionId as number, input.termId as number, input.classId as number, input.subjectId as number, section);
  let teacherId: number;
  const admin = context.roles.some((r) => r.status === "ACTIVE" && r.role === "SCHOOL_ADMIN" && r.schoolId === schoolId);
  if (!admin) {
    teacherId = await validateTeacherAssignment(schoolId, context.user.id, input.sessionId as number, input.termId as number, input.classId as number, input.subjectId as number, section);
    if (input.teacherId !== undefined && input.teacherId !== teacherId) throw new AuthError(403, "Teachers may create assignments only under their own profile");
  } else {
    const requestedTeacher = input.teacherId;
    if (requestedTeacher !== undefined) {
      const result = await pool.query(
        `SELECT e.id FROM employees e WHERE e.id=$1 AND e.school_id=$2 AND e.employment_status='ACTIVE' AND e.employee_type='TEACHER'`,
        [requestedTeacher, schoolId],
      );
      if (!result.rows[0]) throw new AuthError(404, "Teacher profile not found");
      teacherId = requestedTeacher as number;
    } else {
      const result = await pool.query(
        `SELECT e.id FROM employees e WHERE e.school_id=$1 AND e.user_id=$2 AND e.employment_status='ACTIVE' AND e.employee_type='TEACHER'`,
        [schoolId, context.user.id],
      );
      teacherId = id(result.rows[0]?.id, "teacher profile", 404);
    }
  }
  const status = input.status ?? "DRAFT";
  const insertSql =
    `INSERT INTO academic_assignments
       (school_id, academic_session_id, academic_term_id, school_class_id, section, subject_id, teacher_employee_id,
        created_by, title, description, issue_date, due_date, max_score, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING id, school_id AS "schoolId", academic_session_id AS "sessionId", academic_term_id AS "termId",
       school_class_id AS "classId", section, subject_id AS "subjectId", teacher_employee_id AS "teacherId",
       created_by AS "createdBy", title,
       description, issue_date AS "issueDate", due_date AS "dueDate", max_score AS "maxScore", status,
       created_at AS "createdAt", updated_at AS "updatedAt"`;
  const insertValues = [
    schoolId, input.sessionId, input.termId, input.classId, section, input.subjectId,
    teacherId, context.user.id, input.title, input.description ?? "", input.issueDate,
    input.dueDate, input.maxScore, status,
  ];
  if (status !== "PUBLISHED") {
    const result = await pool.query(insertSql, insertValues);
    await audit(req, schoolId, "Created academic assignment", result.rows[0].id);
    res.status(201).json(result.rows[0]);
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(insertSql, insertValues);
    const assignment = result.rows[0];
    await audit(req, schoolId, status === "PUBLISHED" ? "Published academic assignment" : "Created academic assignment", assignment.id, client);
    if (status === "PUBLISHED") {
      await notifyPublishedAssignment(client, {
        id: Number(assignment.id),
        schoolId,
        sessionId: Number(assignment.sessionId),
        termId: Number(assignment.termId),
        classId: Number(assignment.classId),
        section: assignment.section ?? null,
        title: String(assignment.title),
      });
    }
    await client.query("COMMIT");
    res.status(201).json(assignment);
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Keep the original assignment or notification error.
    }
    throw error;
  } finally {
    client.release();
  }
}));

router.patch("/academic/assignments/:assignmentId", asyncRoute(async (req, res) => {
  const assignmentId = id(req.params.assignmentId, "assignmentId", 404);
  const input = assignmentInput(req.body, true);
  if (Object.keys(input).length === 0) throw new AuthError(400, "At least one assignment field is required");
  const schoolId = id(req.query.schoolId, "schoolId");
  const { context } = schoolContext(req, schoolId, [...ADMIN, "TEACHER"], true);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const target = await client.query(
      `SELECT * FROM academic_assignments WHERE id=$1 AND school_id=$2 FOR UPDATE`,
      [assignmentId, schoolId],
    );
    const current = target.rows[0];
    if (!current) throw new AuthError(404, "Assignment not found");
    const admin = context.roles.some((r) => r.status === "ACTIVE" && r.role === "SCHOOL_ADMIN" && r.schoolId === schoolId);
    if (!admin) {
      const teacherId = await validateTeacherAssignment(schoolId, context.user.id, current.academic_session_id, current.academic_term_id, current.school_class_id, current.subject_id, current.section);
      if (!context.roles.some((r) => r.role === "TEACHER" && r.schoolId === schoolId && r.status === "ACTIVE") || teacherId !== current.teacher_employee_id) {
        throw new AuthError(403, "You are not authorized to edit this assignment");
      }
    }
    const nextStatus = (input.status ?? current.status) as string;
    const transitions: Record<string, string[]> = { DRAFT: ["DRAFT", "PUBLISHED", "ARCHIVED"], PUBLISHED: ["PUBLISHED", "CLOSED", "ARCHIVED"], CLOSED: ["CLOSED", "ARCHIVED"], ARCHIVED: ["ARCHIVED"] };
    if (!transitions[current.status]?.includes(nextStatus)) throw new AuthError(400, `Invalid assignment status transition: ${current.status} to ${nextStatus}`);
    const sessionId = (input.sessionId ?? current.academic_session_id) as number;
    const termId = (input.termId ?? current.academic_term_id) as number;
    const classId = (input.classId ?? current.school_class_id) as number;
    const subjectId = (input.subjectId ?? current.subject_id) as number;
    const section = (input.section === undefined ? current.section : input.section) as string | null;
    let teacherId = current.teacher_employee_id as number;
    if (input.teacherId !== undefined) {
      if (!admin) throw new AuthError(403, "Only a school administrator can reassign an assignment");
      const teacher = await pool.query(
        `SELECT id FROM employees WHERE id=$1 AND school_id=$2 AND employment_status='ACTIVE' AND employee_type='TEACHER'`,
        [input.teacherId, schoolId],
      );
      if (!teacher.rows[0]) throw new AuthError(404, "Teacher profile not found");
      teacherId = input.teacherId as number;
    }
    await validateAcademicResource(schoolId, sessionId, termId, classId, subjectId, section);
    if (!admin) await validateTeacherAssignment(schoolId, context.user.id, sessionId, termId, classId, subjectId, section);
    const issueDate = (input.issueDate ?? current.issue_date) as string;
    const dueDate = (input.dueDate ?? current.due_date) as string;
    if (issueDate > dueDate) throw new AuthError(400, "issueDate must be on or before dueDate");
    const result = await client.query(
      `UPDATE academic_assignments SET academic_session_id=$1, academic_term_id=$2, school_class_id=$3,
         section=$4, subject_id=$5, teacher_employee_id=$6, title=$7, description=$8, issue_date=$9, due_date=$10, max_score=$11,
         status=$12, updated_at=NOW()
       WHERE id=$13 AND school_id=$14
       RETURNING id, school_id AS "schoolId", academic_session_id AS "sessionId", academic_term_id AS "termId",
         school_class_id AS "classId", section, subject_id AS "subjectId", teacher_employee_id AS "teacherId",
         created_by AS "createdBy", title,
         description, issue_date AS "issueDate", due_date AS "dueDate", max_score AS "maxScore", status,
         created_at AS "createdAt", updated_at AS "updatedAt"`,
      [sessionId, termId, classId, section, subjectId, teacherId, input.title ?? current.title, input.description === undefined ? current.description : input.description ?? "", issueDate, dueDate, input.maxScore ?? current.max_score, nextStatus, assignmentId, schoolId],
    );
    const action = current.status !== "PUBLISHED" && nextStatus === "PUBLISHED" ? "Published academic assignment" : "Updated academic assignment";
    await audit(req, schoolId, action, assignmentId, client);
    if (current.status !== "PUBLISHED" && nextStatus === "PUBLISHED") {
      await notifyPublishedAssignment(client, {
        id: Number(result.rows[0].id),
        schoolId,
        sessionId,
        termId,
        classId,
        section,
        title: String(result.rows[0].title),
      });
    }
    await client.query("COMMIT");
    res.json(result.rows[0]);
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Keep the original assignment or notification error.
    }
    throw error;
  } finally {
    client.release();
  }
}));

router.get("/academic/students/me/assignments", asyncRoute(async (req, res) => {
  const { context } = schoolContext(req, req.query.schoolId, ["STUDENT"]);
  const result = await pool.query(`SELECT id, school_id AS "schoolId" FROM students WHERE user_id=$1 AND school_id=$2`, [context.user.id, id(req.query.schoolId, "schoolId")]);
  if (!result.rows[0]) throw new AuthError(404, "Student profile not found");
  await studentAssignments(req, res, id(result.rows[0].id, "studentId", 404));
}));

router.get("/academic/parents/children/:studentId/assignments", asyncRoute(async (req, res) => {
  const { context } = schoolContext(req, req.query.schoolId, ["PARENT"]);
  const studentId = id(req.params.studentId, "studentId", 404);
  const result = await pool.query(
    `SELECT st.id, st.school_id AS "schoolId"
       FROM parents p
       JOIN parent_student_relationships psr ON psr.parent_id=p.id AND UPPER(psr.status)='ACTIVE'
       JOIN students st ON st.id=psr.student_id
      WHERE p.user_id=$1 AND st.school_id=$2 AND UPPER(p.status)='ACTIVE' AND st.id=$3 AND ${familyChildSchoolScope()}`,
    [context.user.id, id(req.query.schoolId, "schoolId"), studentId],
  );
  if (!result.rows[0]) throw new AuthError(404, "Student not found");
  await studentAssignments(req, res, studentId);
}));

router.get("/academic/assessment-types", asyncRoute(async (req, res) => {
  const { schoolId } = schoolContext(req, req.query.schoolId, READ_SCHOOL);
  if (req.query.status !== undefined && !["ACTIVE", "INACTIVE", "ARCHIVED"].includes(String(req.query.status))) {
    throw new AuthError(400, "status is invalid");
  }
  const result = await pool.query(
    `SELECT ${assessmentTypeColumns} FROM academic_assessment_types
      WHERE school_id=$1 AND ($2::text IS NULL OR status=$2) ORDER BY name, id`,
    [schoolId, typeof req.query.status === "string" ? req.query.status : null],
  );
  res.json(result.rows);
}));

router.post("/academic/assessment-types", asyncRoute(async (req, res) => {
  const { schoolId } = schoolContext(req, req.query.schoolId, ADMIN, true);
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => !["name", "code", "status"].includes(key))) {
    throw new AuthError(400, "Assessment type requires name and code, with optional status");
  }
  const name = requiredString(body.name, "name");
  const code = requiredString(body.code, "code", 64);
  const status = statusValue(body.status, ["ACTIVE", "INACTIVE", "ARCHIVED"], true) ?? "ACTIVE";
  const result = await pool.query(
    `INSERT INTO academic_assessment_types (school_id,name,code,status)
     VALUES ($1,$2,$3,$4) RETURNING ${assessmentTypeColumns}`,
    [schoolId, name, code, status],
  );
  await audit(req, schoolId, "Created academic assessment type", result.rows[0].id);
  res.status(201).json(result.rows[0]);
}));

router.get("/academic/assessments", asyncRoute(async (req, res) => {
  const { schoolId, context } = schoolContext(req, req.query.schoolId, READ_SCHOOL);
  const { values, where } = filters(req, "a", [schoolId], "assessment_date");
  if (req.query.status !== undefined && !ASSESSMENT_STATUSES.includes(String(req.query.status) as typeof ASSESSMENT_STATUSES[number])) {
    throw new AuthError(400, "status is invalid");
  }
  if (!context.roles.some((r) => r.role === "SCHOOL_ADMIN" && r.schoolId === schoolId && r.status === "ACTIVE") &&
      !context.roles.some((r) => r.role === "PLATFORM_OWNER" && r.schoolId === null)) {
    const teacher = await pool.query(
      `SELECT e.id FROM employees e WHERE e.school_id=$1 AND e.user_id=$2 AND e.employment_status='ACTIVE' AND e.employee_type='TEACHER'`,
      [schoolId, context.user.id],
    );
    if (!teacher.rows[0]) throw new AuthError(403, "An active teacher profile in this school is required");
    values.push(context.user.id);
    where.push(`a.created_by=$${values.length}`);
  }
  const result = await pool.query(
    `SELECT ${assessmentColumns} FROM academic_assessments a
       JOIN academic_assessment_types at ON at.id=a.assessment_type_id AND at.school_id=a.school_id
      WHERE a.school_id=$1 ${where.length ? `AND ${where.join(" AND ")}` : ""}
      ORDER BY a.assessment_date DESC, a.id DESC`,
    values,
  );
  res.json(result.rows);
}));

router.post("/academic/assessments", asyncRoute(async (req, res) => {
  const input = assessmentInput(req.body);
  const { schoolId, context } = schoolContext(req, req.query.schoolId, [...ADMIN, "TEACHER"], true);
  const section = (input.section ?? null) as string | null;
  await validateAcademicResource(schoolId, input.sessionId as number, input.termId as number, input.classId as number, input.subjectId as number, section);
  const type = await pool.query(`SELECT id FROM academic_assessment_types WHERE id=$1 AND school_id=$2 AND status='ACTIVE'`, [input.assessmentTypeId, schoolId]);
  if (!type.rows[0]) throw new AuthError(404, "Assessment type not found");
  const admin = context.roles.some((r) => r.status === "ACTIVE" && r.role === "SCHOOL_ADMIN" && r.schoolId === schoolId);
  let teacherEmployeeId: number;
  if (admin) {
    const teacher = input.teacherId === undefined
      ? await pool.query(`SELECT id FROM employees WHERE school_id=$1 AND user_id=$2 AND employment_status='ACTIVE' AND employee_type='TEACHER'`, [schoolId, context.user.id])
      : await pool.query(`SELECT id FROM employees WHERE id=$1 AND school_id=$2 AND employment_status='ACTIVE' AND employee_type='TEACHER'`, [input.teacherId, schoolId]);
    if (!teacher.rows[0]) throw new AuthError(404, "Teacher profile not found");
    teacherEmployeeId = id(teacher.rows[0].id, "teacherId", 404);
  } else {
    teacherEmployeeId = await validateTeacherAssignment(schoolId, context.user.id, input.sessionId as number, input.termId as number, input.classId as number, input.subjectId as number, section);
    if (input.teacherId !== undefined && input.teacherId !== teacherEmployeeId) throw new AuthError(403, "Teachers may create assessments only under their own profile");
  }
  const status = input.status ?? "DRAFT";
  const result = await pool.query(
    `INSERT INTO academic_assessments
       (school_id,academic_session_id,academic_term_id,school_class_id,section,subject_id,assessment_type_id,
        teacher_employee_id,created_by,title,description,assessment_date,max_score,status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING id, school_id AS "schoolId", academic_session_id AS "sessionId", academic_term_id AS "termId",
       school_class_id AS "classId", section, subject_id AS "subjectId", teacher_employee_id AS "teacherId",
       assessment_type_id AS "assessmentTypeId", title, assessment_date AS date, max_score AS "maxScore",
       status, description, created_by AS "createdBy",
       created_at AS "createdAt", updated_at AS "updatedAt"`,
    [schoolId, input.sessionId, input.termId, input.classId, section, input.subjectId, input.assessmentTypeId, teacherEmployeeId, context.user.id, input.title, input.description ?? "", input.date, input.maxScore, status],
  );
  await audit(req, schoolId, status === "PUBLISHED" ? "Published academic assessment" : "Created academic assessment", result.rows[0].id);
  res.status(201).json(result.rows[0]);
}));

router.patch("/academic/assessments/:assessmentId", asyncRoute(async (req, res) => {
  const assessmentId = id(req.params.assessmentId, "assessmentId", 404);
  const input = assessmentInput(req.body, true);
  if (Object.keys(input).length === 0) throw new AuthError(400, "At least one assessment field is required");
  const schoolId = id(req.query.schoolId, "schoolId");
  const { context } = schoolContext(req, schoolId, [...ADMIN, "TEACHER"], true);
  const target = await pool.query(`SELECT * FROM academic_assessments WHERE id=$1 AND school_id=$2`, [assessmentId, schoolId]);
  const current = target.rows[0];
  if (!current) throw new AuthError(404, "Assessment not found");
  const admin = context.roles.some((r) => r.status === "ACTIVE" && r.role === "SCHOOL_ADMIN" && r.schoolId === schoolId);
  if (!admin) {
    const teacherEmployeeId = await validateTeacherAssignment(schoolId, context.user.id, current.academic_session_id, current.academic_term_id, current.school_class_id, current.subject_id, current.section);
    if (!context.roles.some((r) => r.role === "TEACHER" && r.schoolId === schoolId && r.status === "ACTIVE") || context.user.id !== current.created_by) {
      throw new AuthError(403, "You are not authorized to edit this assessment");
    }
    if (input.teacherId !== undefined && input.teacherId !== teacherEmployeeId) {
      throw new AuthError(403, "Teachers may not reassign assessments");
    }
  }
  const nextStatus = (input.status ?? current.status) as string;
  const transitions: Record<string, string[]> = { DRAFT: ["DRAFT", "OPEN", "PUBLISHED", "ARCHIVED"], OPEN: ["OPEN", "CLOSED", "PUBLISHED"], CLOSED: ["CLOSED", "PUBLISHED", "ARCHIVED"], PUBLISHED: ["PUBLISHED", "ARCHIVED"], ARCHIVED: ["ARCHIVED"] };
  if (!transitions[current.status]?.includes(nextStatus)) throw new AuthError(400, `Invalid assessment status transition: ${current.status} to ${nextStatus}`);
  const sessionId = (input.sessionId ?? current.academic_session_id) as number;
  const termId = (input.termId ?? current.academic_term_id) as number;
  const classId = (input.classId ?? current.school_class_id) as number;
  const subjectId = (input.subjectId ?? current.subject_id) as number;
  const section = (input.section === undefined ? current.section : input.section) as string | null;
  const typeId = (input.assessmentTypeId ?? current.assessment_type_id) as number;
  let teacherEmployeeId = current.teacher_employee_id as number;
  if (input.teacherId !== undefined) {
    const teacher = await pool.query(
      `SELECT id FROM employees WHERE id=$1 AND school_id=$2 AND employment_status='ACTIVE' AND employee_type='TEACHER'`,
      [input.teacherId, schoolId],
    );
    if (!teacher.rows[0]) throw new AuthError(404, "Teacher profile not found");
    teacherEmployeeId = input.teacherId as number;
  }
  await validateAcademicResource(schoolId, sessionId, termId, classId, subjectId, section);
  if (!admin) await validateTeacherAssignment(schoolId, context.user.id, sessionId, termId, classId, subjectId, section);
  const type = await pool.query(`SELECT id FROM academic_assessment_types WHERE id=$1 AND school_id=$2 AND status='ACTIVE'`, [typeId, schoolId]);
  if (!type.rows[0]) throw new AuthError(404, "Assessment type not found");
  const result = await pool.query(
    `UPDATE academic_assessments SET academic_session_id=$1,academic_term_id=$2,school_class_id=$3,section=$4,
       subject_id=$5,teacher_employee_id=$6,assessment_type_id=$7,title=$8,assessment_date=$9,max_score=$10,
       status=$11,description=$12,updated_at=NOW()
     WHERE id=$13 AND school_id=$14
     RETURNING id, school_id AS "schoolId", academic_session_id AS "sessionId", academic_term_id AS "termId",
       school_class_id AS "classId", section, subject_id AS "subjectId", teacher_employee_id AS "teacherId",
       assessment_type_id AS "assessmentTypeId", title, assessment_date AS date, max_score AS "maxScore",
       status, description, created_by AS "createdBy",
       created_at AS "createdAt", updated_at AS "updatedAt"`,
    [sessionId, termId, classId, section, subjectId, teacherEmployeeId, typeId, input.title ?? current.title, input.date ?? current.assessment_date, input.maxScore ?? current.max_score, nextStatus, input.description === undefined ? current.description : input.description ?? "", assessmentId, schoolId],
  );
  const action = current.status !== "PUBLISHED" && nextStatus === "PUBLISHED" ? "Published academic assessment" : "Updated academic assessment";
  await audit(req, schoolId, action, assessmentId);
  res.json(result.rows[0]);
}));

export default router;