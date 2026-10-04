import { Router, type NextFunction, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { familyChildSchoolScope } from "../lib/family-child-school-scope";
import {
  AuthError,
  assertSchoolOperationalAccess,
  getUserContext,
  requireAuthentication,
} from "../middlewares/auth";
import {
  queueCommunicationNotification,
  type CommunicationQueryClient,
} from "../services/communication-service";
import { logger } from "../lib/logger";

const router = Router();
router.use(requireAuthentication());

const run = (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    handler(req, res).catch(next);

const allSchoolRoles = ["SCHOOL_ADMIN", "PLATFORM_OWNER", "TEACHER"] as const;
const resultReadRoles = [...allSchoolRoles, "STUDENT", "PARENT"] as const;
const managerRoles = ["SCHOOL_ADMIN"] as const;
const studentParentRoles = ["STUDENT", "PARENT"] as const;
type Role = "PLATFORM_OWNER" | "SCHOOL_ADMIN" | "TEACHER" | "STUDENT" | "PARENT";

function id(value: unknown, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new AuthError(400, `${label} must be a positive integer`);
  return parsed;
}
function requiredString(value: unknown, label: string, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new AuthError(400, `${label} is required`);
  }
  return value.trim();
}
function scoreValue(value: unknown, label: string): number {
  if ((typeof value !== "number" && typeof value !== "string") ||
      (typeof value === "string" && value.trim() === "")) {
    throw new AuthError(400, `${label} must be a non-negative number`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new AuthError(400, `${label} must be a non-negative number`);
  return parsed;
}
function hasRole(req: Request, roles: readonly Role[], schoolId?: number): boolean {
  const context = getUserContext(req);
  return context.roles.some((membership) =>
    membership.status === "ACTIVE" &&
    (roles as readonly string[]).includes(membership.role) &&
    (membership.role === "PLATFORM_OWNER"
      ? membership.schoolId === null
      : schoolId === undefined || membership.schoolId === schoolId),
  );
}
function authorizeSchool(req: Request, rawSchool: unknown, roles: readonly Role[]) {
  const schoolId = id(rawSchool, "schoolId");
  if (!hasRole(req, roles)) throw new AuthError(403, "You are not authorized for this action");
  if (!hasRole(req, roles, schoolId)) throw new AuthError(404, "Resource not found", "CROSS_TENANT_ACCESS_ATTEMPT");
  return schoolId;
}
function requireRole(req: Request, roles: readonly Role[]) {
  if (!hasRole(req, roles)) throw new AuthError(403, "You are not authorized for this action");
}
function auditSql(actor: ReturnType<typeof getUserContext>, schoolId: number, action: string, recordId: number) {
  const role = actor.roles.find((r) => r.schoolId === schoolId || r.schoolId === null)?.role ?? "AUTHENTICATED";
  return {
    sql: `INSERT INTO audit_logs ("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,severity,event_type,result)
          VALUES ($1,$2,$3,$4,$5,$6,'Academics',$7,'info','APPLICATION_EVENT','SUCCESS')`,
    values: [
      [actor.user.firstName, actor.user.lastName].filter(Boolean).join(" ") || actor.user.email,
      role, actor.user.id, actor.user.clerkUserId, schoolId, action, recordId,
    ],
  };
}
async function audit(req: Request, schoolId: number, action: string, recordId: number, client: any = pool) {
  const query = auditSql(getUserContext(req), schoolId, action, recordId);
  await client.query(query.sql, query.values);
}
async function auditResultReview(
  req: Request,
  schoolId: number,
  action: string,
  recordId: number,
  decision: string,
  comment: string | null,
  client: any,
) {
  const context = getUserContext(req);
  const role = context.roles.find((assignment) => assignment.schoolId === schoolId)?.role ?? "SCHOOL_ADMIN";
  await client.query(
    `INSERT INTO audit_logs
      ("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,severity,event_type,result,metadata)
     VALUES($1,$2,$3,$4,$5,$6,'Academics',$7,'info','ACADEMIC_RESULT_REVIEWED','SUCCESS',$8::jsonb)`,
    [
      [context.user.firstName, context.user.lastName].filter(Boolean).join(" ") || context.user.email,
      role, context.user.id, context.user.clerkUserId, schoolId, action, recordId,
      JSON.stringify({ decision, comment }),
    ],
  );
}
async function notifyStudentAcademicRecord(
  client: CommunicationQueryClient,
  schoolId: number,
  studentId: number,
  classId: number,
  input: { category: "ACADEMIC"; eventKey: string; subject: string; body: string },
) {
  const recipients = await client.query<{ userId: number | string; link: string }>(
    `SELECT linked.user_id AS "userId",
            CASE WHEN bool_or(linked.is_student) THEN '/my-academics' ELSE '/' END AS link
       FROM (
         SELECT st.user_id, TRUE AS is_student
           FROM students st
          WHERE st.id=$1 AND st.school_id=$2 AND UPPER(st.status)='ACTIVE'
         UNION ALL
         SELECT p.user_id, FALSE AS is_student
           FROM parents p
           JOIN parent_student_relationships psr
             ON psr.parent_id=p.id AND UPPER(psr.status)='ACTIVE'
           JOIN students st ON st.id=psr.student_id AND st.school_id=p.school_id
          WHERE st.id=$1 AND p.school_id=$2 AND UPPER(p.status)='ACTIVE'
       ) linked
      WHERE linked.user_id IS NOT NULL
      GROUP BY linked.user_id
      ORDER BY linked.user_id`,
    [studentId, schoolId],
  );
  for (const recipient of recipients.rows) {
    await queueCommunicationNotification(client, {
      recipientUserId: Number(recipient.userId),
      schoolId,
      subjectStudentId: studentId,
      subjectClassId: classId,
      category: input.category,
      eventKey: input.eventKey,
      subject: input.subject,
      body: input.body,
      link: recipient.link,
      channels: ["IN_APP"],
    });
  }
}
async function notifyStudentAcademicRecordSafely(
  req: Request,
  schoolId: number,
  studentId: number,
  classId: number,
  input: { category: "ACADEMIC"; eventKey: string; subject: string; body: string },
) {
  try {
    await notifyStudentAcademicRecord(pool, schoolId, studentId, classId, input);
  } catch (error) {
    const fields = {
      schoolId,
      studentId,
      eventKey: input.eventKey,
      error: error instanceof Error ? error.message : "Unknown communication queue failure",
    };
    if (req.log) req.log.warn(fields, "Could not queue academic communication");
    else logger.warn(fields, "Could not queue academic communication");
  }
}
function bodyObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AuthError(400, "A JSON object body is required");
  return body as Record<string, unknown>;
}
function isUniqueViolation(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}
function gradeFor(score: number, maximum: number, rules: Array<{ min_score: string; max_score: string; grade: string; grade_point: string | null; remark: string }>) {
  const percent = maximum === 0 ? -1 : score * 100 / maximum;
  const matches = rules.filter((rule) => percent >= Number(rule.min_score) && percent <= Number(rule.max_score));
  if (matches.length > 1) throw new AuthError(409, "School grading rules overlap for this score");
  const rule = matches[0];
  return rule ? { grade: rule.grade, gradePoint: rule.grade_point, remark: rule.remark } : { grade: null, gradePoint: null, remark: null };
}

const resultSelect = `r.id,r.school_id AS "schoolId",r.assessment_id AS "assessmentId",r.student_id AS "studentId",
  r.student_class_assignment_id AS "studentClassAssignmentId",r.teacher_employee_id AS "teacherId",
  r.academic_session_id AS "sessionId",r.academic_term_id AS "termId",r.school_class_id AS "classId",
  r.section_snapshot AS section,r.subject_id AS "subjectId",r.score,r.max_score AS "maxScore",
  r.grade,r.grade_point AS "gradePoint",r.remark,r.status,r.published_at AS "publishedAt"`;
const resultReturning = `id,school_id AS "schoolId",assessment_id AS "assessmentId",student_id AS "studentId",
  student_class_assignment_id AS "studentClassAssignmentId",teacher_employee_id AS "teacherId",
  academic_session_id AS "sessionId",academic_term_id AS "termId",school_class_id AS "classId",
  section_snapshot AS section,subject_id AS "subjectId",score,max_score AS "maxScore",
  grade,grade_point AS "gradePoint",remark,status,review_status AS "reviewStatus",published_at AS "publishedAt"`;
const cardSelect = `rc.id,rc.school_id AS "schoolId",rc.student_id AS "studentId",
  rc.academic_session_id AS "sessionId",rc.academic_term_id AS "termId",
  (SELECT name FROM academic_sessions WHERE id=rc.academic_session_id AND school_id=rc.school_id) AS "sessionName",
  (SELECT name FROM academic_terms WHERE id=rc.academic_term_id AND school_id=rc.school_id) AS "termName",
  rc.student_class_assignment_id AS "studentClassAssignmentId",rc.school_class_id AS "classId",
  rc.class_name_snapshot AS "className",rc.section_snapshot AS section,rc.status,
  rc.teacher_remark AS "teacherRemark",rc.school_remark AS "schoolRemark",rc.published_by AS "publishedBy",
  EXISTS(SELECT 1 FROM audit_logs al WHERE al.school_id=rc.school_id AND al.record_id=rc.id AND al.action='Approved academic report card') AS "isApproved",
  CASE WHEN rc.status='PUBLISHED' THEN rc.published_at ELSE NULL END AS "publishedAt"`;
const cardReturning = `id,school_id AS "schoolId",student_id AS "studentId",
  academic_session_id AS "sessionId",academic_term_id AS "termId",
  student_class_assignment_id AS "studentClassAssignmentId",school_class_id AS "classId",
  class_name_snapshot AS "className",section_snapshot AS section,status,
  teacher_remark AS "teacherRemark",school_remark AS "schoolRemark",published_by AS "publishedBy",
  CASE WHEN status='PUBLISHED' THEN published_at ELSE NULL END AS "publishedAt"`;
function reportResultState(lineCount: number, unpublishedCount: number, incompleteCount: number) {
  if (unpublishedCount > 0) return "SOME_RESULTS_UNPUBLISHED";
  if (incompleteCount > 0) return "INCOMPLETE_RESULTS";
  return lineCount > 0 ? "COMPLETE" : "NO_PUBLISHED_RESULTS";
}

// School grading rules. Scores are matched against the percentage (score / maxScore * 100).
router.get("/academic/grading-rules", run(async (req, res) => {
  const schoolId = authorizeSchool(req, req.query.schoolId, allSchoolRoles);
  const result = await pool.query(
    `SELECT id,school_id AS "schoolId",min_score AS "minScore",max_score AS "maxScore",grade,
            grade_point AS "gradePoint",remark,status
       FROM academic_grading_rules WHERE school_id=$1 ORDER BY min_score,id`,
    [schoolId],
  );
  res.json(result.rows);
}));
router.post("/academic/grading-rules", run(async (req, res) => {
  const schoolId = authorizeSchool(req, req.query.schoolId, managerRoles);
  assertSchoolOperationalAccess(req, schoolId, managerRoles as any);
  const body = bodyObject(req.body);
  const min = scoreValue(body.minScore, "minScore");
  const max = scoreValue(body.maxScore, "maxScore");
  const grade = requiredString(body.grade, "grade", 40);
  const remark = requiredString(body.remark, "remark", 500);
  const point = body.gradePoint == null ? null : scoreValue(body.gradePoint, "gradePoint");
  if (max < min || max > 100) throw new AuthError(400, "Grading range must satisfy 0 <= minScore <= maxScore <= 100");
  const client = await pool.connect();
  let created;
  try {
    await client.query("BEGIN");
    await client.query(`SELECT id FROM schools WHERE id=$1 FOR UPDATE`, [schoolId]);
    const overlap = await client.query(
      `SELECT id FROM academic_grading_rules WHERE school_id=$1 AND status='ACTIVE'
        AND NOT(max_score < $2 OR min_score > $3) FOR UPDATE`,
      [schoolId, min, max],
    );
    if (overlap.rows.length) throw new AuthError(409, "Grading rule overlaps an existing active rule");
    created = await client.query(
      `INSERT INTO academic_grading_rules(school_id,min_score,max_score,grade,grade_point,remark,status)
       VALUES($1,$2,$3,$4,$5,$6,'ACTIVE')
       RETURNING id,school_id AS "schoolId",min_score AS "minScore",max_score AS "maxScore",grade,grade_point AS "gradePoint",remark,status`,
      [schoolId, min, max, grade, point, remark],
    );
    await audit(req, schoolId, "Created academic grading rule", created.rows[0].id, client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  res.status(201).json(created!.rows[0]);
}));
router.patch("/academic/grading-rules/:ruleId", run(async (req, res) => {
  const schoolId = authorizeSchool(req, req.query.schoolId, managerRoles);
  assertSchoolOperationalAccess(req, schoolId, managerRoles as any);
  const body = bodyObject(req.body);
  const ruleId = id(req.params.ruleId, "ruleId");
  const min = body.minScore === undefined ? null : scoreValue(body.minScore, "minScore");
  const max = body.maxScore === undefined ? null : scoreValue(body.maxScore, "maxScore");
  if ((min ?? 0) > (max ?? 100) || (min ?? 0) < 0 || (max ?? 100) > 100) {
    throw new AuthError(400, "Grading range must satisfy 0 <= minScore <= maxScore <= 100");
  }
  const grade = body.grade === undefined ? null : requiredString(body.grade, "grade", 40);
  const remark = body.remark === undefined ? null : requiredString(body.remark, "remark", 500);
  const point = body.gradePoint === undefined ? undefined : body.gradePoint === null ? null : scoreValue(body.gradePoint, "gradePoint");
  const status = body.status === undefined ? null : requiredString(body.status, "status", 20);
  if (status && !["ACTIVE", "INACTIVE", "ARCHIVED"].includes(status)) throw new AuthError(400, "Invalid grading rule status");
  const client = await pool.connect();
  let updated;
  try {
    await client.query("BEGIN");
    await client.query(`SELECT id FROM schools WHERE id=$1 FOR UPDATE`, [schoolId]);
    const existing = await client.query(
      `SELECT min_score,max_score,status FROM academic_grading_rules WHERE id=$1 AND school_id=$2 FOR UPDATE`,
      [ruleId,schoolId],
    );
    if (!existing.rows[0]) throw new AuthError(404, "Grading rule not found");
    const finalMin = min ?? Number(existing.rows[0].min_score);
    const finalMax = max ?? Number(existing.rows[0].max_score);
    if (finalMax < finalMin) throw new AuthError(400, "Grading range must satisfy minScore <= maxScore");
    if ((status ?? existing.rows[0].status) === "ACTIVE") {
      const overlap = await client.query(
        `SELECT id FROM academic_grading_rules WHERE school_id=$1 AND status='ACTIVE' AND id<>$2
          AND NOT(max_score < $3 OR min_score > $4) FOR UPDATE`,
        [schoolId,ruleId,finalMin,finalMax],
      );
      if (overlap.rows.length) throw new AuthError(409, "Grading rule overlaps an existing active rule");
    }
    updated = await client.query(
      `UPDATE academic_grading_rules SET min_score=COALESCE($1,min_score),max_score=COALESCE($2,max_score),
         grade=COALESCE($3,grade),grade_point=CASE WHEN $4 THEN $5 ELSE grade_point END,
         remark=COALESCE($6,remark),status=COALESCE($7,status),updated_at=NOW()
       WHERE id=$8 AND school_id=$9
       RETURNING id,school_id AS "schoolId",min_score AS "minScore",max_score AS "maxScore",grade,grade_point AS "gradePoint",remark,status`,
      [min,max,grade,point !== undefined,point ?? null,remark,status,ruleId,schoolId],
    );
    await audit(req, schoolId, "Updated academic grading rule", ruleId, client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  res.json(updated!.rows[0]);
}));

router.get("/academic/results", run(async (req, res) => {
  const schoolId = authorizeSchool(req, req.query.schoolId, resultReadRoles);
  let studentId = req.query.studentId == null ? null : id(req.query.studentId, "studentId");
  const assessmentId = req.query.assessmentId == null ? null : id(req.query.assessmentId, "assessmentId");
  const familyOnly = hasRole(req, studentParentRoles, schoolId) &&
    !hasRole(req, ["SCHOOL_ADMIN", "PLATFORM_OWNER", "TEACHER"], schoolId);
  if (familyOnly) {
    if (studentId === null) throw new AuthError(400, "Select one of your authorized student profiles");
    const self = await resolveSelfStudent(req, schoolId);
    if (self < 0) await ensureChild(req, schoolId, studentId);
    else if (self !== studentId) throw new AuthError(404, "Student record not found");
  }
  const teacherOnly = hasRole(req, ["TEACHER"], schoolId) && !hasRole(req, managerRoles, schoolId);
  const select = teacherOnly
    ? `${resultSelect},r.review_status AS "reviewStatus",r.review_comment AS "reviewComment",r.reviewed_at AS "reviewedAt"`
    : resultSelect;
  const result = await pool.query(
    `SELECT ${select} FROM academic_results r
      WHERE r.school_id=$1 AND ($2::int IS NULL OR r.student_id=$2)
        AND ($3::int IS NULL OR r.assessment_id=$3)
        AND (NOT $6::boolean OR r.status='PUBLISHED')
        AND (NOT $4::boolean OR r.teacher_employee_id IN (
          SELECT e.id FROM employees e WHERE e.school_id=$1 AND e.user_id=$5
        ))
      ORDER BY r.academic_session_id DESC,r.academic_term_id DESC,r.id`,
    [schoolId, studentId, assessmentId, teacherOnly, getUserContext(req).user.id, familyOnly],
  );
  res.json(result.rows);
}));
router.post("/academic/results", run(async (req, res) => {
  const body = bodyObject(req.body);
  const schoolId = authorizeSchool(req, body.schoolId, ["SCHOOL_ADMIN", "TEACHER"]);
  assertSchoolOperationalAccess(req, schoolId, ["SCHOOL_ADMIN", "TEACHER"] as any);
  requireRole(req, ["SCHOOL_ADMIN", "TEACHER"]);
  const assessmentId = id(body.assessmentId, "assessmentId");
  const studentId = id(body.studentId, "studentId");
  const score = scoreValue(body.score, "score");
  const remark = body.remark == null ? null : requiredString(body.remark, "remark", 500);
  const actor = getUserContext(req);
  const client = await pool.connect();
  let created;
  try {
    await client.query("BEGIN");
    const assessment = await client.query(
      `SELECT a.id,a.school_id,a.academic_session_id,a.academic_term_id,a.school_class_id,a.section,
              a.subject_id,a.teacher_employee_id,a.max_score,a.assessment_date,a.status
         FROM academic_assessments a
         JOIN academic_sessions s ON s.id=a.academic_session_id AND s.school_id=a.school_id
         JOIN academic_terms t ON t.id=a.academic_term_id AND t.school_id=a.school_id AND t.academic_session_id=s.id
         JOIN school_classes c ON c.id=a.school_class_id AND c.school_id=a.school_id
         JOIN subjects sub ON sub.id=a.subject_id AND sub.school_id=a.school_id
         JOIN academic_assessment_types at ON at.id=a.assessment_type_id AND at.school_id=a.school_id
         JOIN employees e ON e.id=a.teacher_employee_id AND e.school_id=a.school_id
        WHERE a.id=$1 AND a.school_id=$2 FOR SHARE`,
      [assessmentId, schoolId],
    );
    const a = assessment.rows[0];
    if (!a) throw new AuthError(404, "Assessment not found");
    if (!["OPEN", "CLOSED"].includes(a.status)) throw new AuthError(409, "Assessment is not available for result entry");
    await client.query("SELECT pg_advisory_xact_lock($1::int,$2::int)",[schoolId,studentId]);
    const frozen=await client.query(`SELECT 1 FROM academic_report_cards rc WHERE rc.school_id=$1 AND rc.student_id=$2
      AND rc.academic_session_id=$3 AND rc.academic_term_id=$4 AND (rc.status='PUBLISHED' OR EXISTS(
        SELECT 1 FROM audit_logs al WHERE al.school_id=rc.school_id AND al.record_id=rc.id AND al.action='Approved academic report card')) LIMIT 1`,
      [schoolId,studentId,a.academic_session_id,a.academic_term_id]);
    if(frozen.rows.length) throw new AuthError(409,"Approved or published report periods cannot accept new scores");
    if (score > Number(a.max_score)) throw new AuthError(400, "Score cannot exceed the assessment maximum score");
    const assignment = await client.query(
      `SELECT sca.id,sca.section FROM student_class_assignments sca
         JOIN students st ON st.id=sca.student_id AND st.school_id=sca.school_id
        WHERE sca.student_id=$1 AND sca.school_id=$2 AND sca.academic_session_id=$3
          AND sca.academic_term_id=$4 AND sca.school_class_id=$5 AND ($6::text IS NULL OR sca.section=$6)
          AND sca.status IN ('ACTIVE','INACTIVE')
          AND (sca.start_date IS NULL OR sca.start_date <= $7::date)
          AND (sca.end_date IS NULL OR sca.end_date >= $7::date)
        ORDER BY sca.start_date DESC NULLS LAST,sca.id DESC LIMIT 1`,
      [studentId, schoolId, a.academic_session_id, a.academic_term_id, a.school_class_id, a.section, a.assessment_date],
    );
    if (!assignment.rows[0]) throw new AuthError(404, "Student is not assigned to this assessment context");
    const teacher = await client.query(
      `SELECT e.id FROM employees e
        WHERE e.id=$1 AND e.school_id=$2 AND (
          e.user_id=$3 AND EXISTS (
            SELECT 1 FROM class_subjects cs WHERE cs.school_id=$2 AND cs.employee_id=e.id
              AND cs.academic_session_id=$4 AND (cs.academic_term_id IS NULL OR cs.academic_term_id=$5)
              AND cs.school_class_id=$6 AND cs.subject_id=$7 AND cs.status='ACTIVE'
              AND (cs.section IS NULL OR cs.section=$8)
          ) OR EXISTS (
            SELECT 1 FROM teacher_class_assignments ta WHERE ta.school_id=$2 AND ta.employee_id=e.id
              AND ta.academic_session_id=$4 AND ta.school_class_id=$6 AND ta.status='ACTIVE'
              AND (ta.section=$8 OR ta.section IS NULL OR ta.section='')
              AND ta.assignment_type='SUBJECT_TEACHER' AND ta.subject_id=$7
              AND (ta.start_date IS NULL OR ta.start_date<=(SELECT assessment_date FROM academic_assessments WHERE id=$9 AND school_id=$2))
              AND (ta.end_date IS NULL OR ta.end_date>=(SELECT assessment_date FROM academic_assessments WHERE id=$9 AND school_id=$2))
          )
        )`,
      [a.teacher_employee_id, schoolId, actor.user.id, a.academic_session_id, a.academic_term_id, a.school_class_id, a.subject_id, a.section, assessmentId],
    );
    if (!teacher.rows[0]) throw new AuthError(404, "Teacher assignment not found");
    const isAdmin = hasRole(req, managerRoles, schoolId);
    if (!isAdmin) {
      const ownTeacher = await client.query(`SELECT id FROM employees WHERE id=$1 AND school_id=$2 AND user_id=$3`, [a.teacher_employee_id, schoolId, actor.user.id]);
      if (!ownTeacher.rows[0]) throw new AuthError(403, "Teachers may enter results only for their assigned subject");
    }
    const duplicate = await client.query(`SELECT id FROM academic_results WHERE school_id=$1 AND assessment_id=$2 AND student_id=$3 FOR UPDATE`, [schoolId, assessmentId, studentId]);
    if (duplicate.rows[0]) throw new AuthError(409, "A result already exists for this student and assessment");
    const rules = await client.query(
      `SELECT min_score,max_score,grade,grade_point,remark FROM academic_grading_rules
        WHERE school_id=$1 AND status='ACTIVE' ORDER BY min_score`,
      [schoolId],
    );
    const grade = gradeFor(score, Number(a.max_score), rules.rows);
    created = await client.query(
      `INSERT INTO academic_results(school_id,assessment_id,student_id,student_class_assignment_id,teacher_employee_id,
        academic_session_id,academic_term_id,school_class_id,section_snapshot,subject_id,score,max_score,grade,grade_point,remark,status,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,COALESCE($15,$16),'DRAFT',$17)
       RETURNING ${resultReturning}`,
      [schoolId,assessmentId,studentId,assignment.rows[0].id,a.teacher_employee_id,a.academic_session_id,a.academic_term_id,
        a.school_class_id,assignment.rows[0].section,a.subject_id,score,a.max_score,grade.grade,grade.gradePoint,remark,grade.remark,actor.user.id],
    );
    await audit(req, schoolId, "Created academic result", created.rows[0].id, client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (isUniqueViolation(error)) throw new AuthError(409, "A result already exists for this student and assessment");
    throw error;
  } finally { client.release(); }
  res.status(201).json(created!.rows[0]);
}));
router.patch("/academic/results/:resultId", run(async (req, res) => {
  const body = bodyObject(req.body);
  const schoolId = authorizeSchool(req, body.schoolId, ["SCHOOL_ADMIN", "TEACHER"]);
  assertSchoolOperationalAccess(req, schoolId, ["SCHOOL_ADMIN", "TEACHER"] as any);
  const resultId = id(req.params.resultId, "resultId");
  const actor = getUserContext(req);
  const client = await pool.connect();
  let updated;
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(school_id,student_id) FROM academic_results WHERE id=$1 AND school_id=$2`,[resultId,schoolId]);
    const existing = await client.query(`SELECT * FROM academic_results WHERE id=$1 AND school_id=$2 FOR UPDATE`, [resultId, schoolId]);
    const current = existing.rows[0];
    if (!current) throw new AuthError(404, "Result not found");
    const admin = hasRole(req, managerRoles, schoolId);
    if (current.status === "PUBLISHED" || current.review_status === "APPROVED") {
      throw new AuthError(409, "Approved or published results are immutable");
    }
    if (!admin && !["DRAFT"].includes(current.status)) {
      throw new AuthError(409, "Submitted results cannot be edited until the School Admin returns them for correction");
    }
    if (!admin) {
      requireRole(req, ["TEACHER"]);
      const ownership = await client.query(`SELECT id FROM employees WHERE id=$1 AND school_id=$2 AND user_id=$3`, [current.teacher_employee_id, schoolId, actor.user.id]);
      if (!ownership.rows[0]) throw new AuthError(403, "Teachers may edit only their own results");
      const authorizedAssignment = await client.query(
        `SELECT a.id FROM academic_assessments a
          WHERE a.id=$1 AND a.school_id=$2 AND a.academic_session_id=$3 AND a.academic_term_id=$4
            AND a.school_class_id=$5 AND a.subject_id=$6
            AND (
              EXISTS (SELECT 1 FROM class_subjects cs WHERE cs.school_id=$2 AND cs.employee_id=$7
                AND cs.academic_session_id=$3 AND (cs.academic_term_id IS NULL OR cs.academic_term_id=$4)
                AND cs.school_class_id=$5 AND cs.subject_id=$6 AND cs.status='ACTIVE'
                AND (cs.section IS NULL OR cs.section=$8))
              OR EXISTS (SELECT 1 FROM teacher_class_assignments ta WHERE ta.school_id=$2 AND ta.employee_id=$7
                AND ta.academic_session_id=$3 AND ta.school_class_id=$5 AND ta.subject_id=$6
                AND ta.assignment_type='SUBJECT_TEACHER' AND ta.status='ACTIVE'
                AND (ta.section=$8 OR ta.section='') AND (ta.start_date IS NULL OR ta.start_date<=a.assessment_date)
                AND (ta.end_date IS NULL OR ta.end_date>=a.assessment_date))
            )`,
        [current.assessment_id,schoolId,current.academic_session_id,current.academic_term_id,current.school_class_id,current.subject_id,current.teacher_employee_id,current.section_snapshot],
      );
      if (!authorizedAssignment.rows[0]) throw new AuthError(403, "Teacher assignment does not cover this result context");
    }
    const score = body.score === undefined ? Number(current.score) : scoreValue(body.score, "score");
    if (score > Number(current.max_score)) throw new AuthError(400, "Score cannot exceed the assessment maximum score");
    const scoreChanged = score !== Number(current.score);
    const remark = body.remark === undefined
      ? scoreChanged ? null : current.remark
      : body.remark === null ? null : requiredString(body.remark, "remark", 500);
    let grade = { grade: current.grade, gradePoint: current.grade_point, remark: current.remark };
    if (current.status !== "PUBLISHED" || scoreChanged) {
      const rules = await client.query(`SELECT min_score,max_score,grade,grade_point,remark FROM academic_grading_rules WHERE school_id=$1 AND status='ACTIVE' ORDER BY min_score`, [schoolId]);
      grade = gradeFor(score, Number(current.max_score), rules.rows);
    }
    updated = await client.query(
      `UPDATE academic_results SET score=$1,remark=$2,grade=$3,grade_point=$4,
          status=CASE WHEN status='PUBLISHED' THEN status ELSE 'DRAFT' END,
          review_status=CASE WHEN status='PUBLISHED' OR review_status='RETURNED' THEN review_status ELSE 'NOT_REVIEWED' END,
          review_comment=CASE WHEN status='PUBLISHED' OR review_status='RETURNED' THEN review_comment ELSE NULL END,
          reviewed_by=CASE WHEN status='PUBLISHED' OR review_status='RETURNED' THEN reviewed_by ELSE NULL END,
          reviewed_at=CASE WHEN status='PUBLISHED' OR review_status='RETURNED' THEN reviewed_at ELSE NULL END,updated_at=NOW()
        WHERE id=$5 AND school_id=$6 RETURNING ${resultReturning}`,
      [score,remark ?? grade.remark,grade.grade,grade.gradePoint,resultId,schoolId],
    );
    await audit(req, schoolId, current.status === "PUBLISHED" ? "Corrected published academic result" : "Updated academic result", resultId, client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  res.json(updated!.rows[0]);
}));

router.post("/academic/results/:resultId/submit", run(async (req, res) => {
  const body = bodyObject(req.body);
  const schoolId = authorizeSchool(req, body.schoolId, ["SCHOOL_ADMIN", "TEACHER"]);
  assertSchoolOperationalAccess(req, schoolId, ["SCHOOL_ADMIN", "TEACHER"] as any);
  const resultId = id(req.params.resultId, "resultId");
  const actor = getUserContext(req);
  const client = await pool.connect();
  let submitted;
  try {
    await client.query("BEGIN");
    const existing = await client.query(
      `SELECT id,teacher_employee_id,status FROM academic_results WHERE id=$1 AND school_id=$2 FOR UPDATE`,
      [resultId, schoolId],
    );
    const current = existing.rows[0];
    if (!current) throw new AuthError(404, "Result not found");
    if (!hasRole(req, managerRoles, schoolId)) {
      requireRole(req, ["TEACHER"]);
      const ownership = await client.query(
        `SELECT id FROM employees WHERE id=$1 AND school_id=$2 AND user_id=$3`,
        [current.teacher_employee_id, schoolId, actor.user.id],
      );
      if (!ownership.rows[0]) throw new AuthError(403, "Teachers may submit only their own assigned results");
    }
    if (current.status !== "DRAFT") throw new AuthError(409, "Only draft or returned results can be submitted for review");
    submitted = await client.query(
      `UPDATE academic_results SET status='SUBMITTED',review_status='NOT_REVIEWED',updated_at=NOW()
        WHERE id=$1 AND school_id=$2 RETURNING ${resultReturning}`,
      [resultId, schoolId],
    );
    await audit(req, schoolId, "Submitted academic result for review", resultId, client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  res.json({ ...submitted!.rows[0], reviewStatus: "NOT_REVIEWED", reviewComment: null });
}));

router.get("/academic/results/review", run(async (req, res) => {
  const schoolId = authorizeSchool(req, req.query.schoolId, managerRoles);
  const assessmentId = req.query.assessmentId == null ? null : id(req.query.assessmentId, "assessmentId");
  const result = await pool.query(
    `SELECT ${resultSelect},r.review_status AS "reviewStatus",r.review_comment AS "reviewComment",
             r.reviewed_by AS "reviewedBy",r.reviewed_at AS "reviewedAt",
             concat_ws(' ',st.first_name,st.middle_name,st.last_name) AS "studentName",
             st.admission_no AS "admissionNo"
       FROM academic_results r
        LEFT JOIN students st ON st.id=r.student_id AND st.school_id=r.school_id
      WHERE r.school_id=$1 AND ($2::int IS NULL OR r.assessment_id=$2)
      ORDER BY CASE WHEN r.status='SUBMITTED' THEN 0 ELSE 1 END,r.id`,
    [schoolId, assessmentId],
  );
  res.json(result.rows);
}));

router.post("/academic/results/:resultId/review", run(async (req, res) => {
  const body = bodyObject(req.body);
  const schoolId = authorizeSchool(req, body.schoolId, managerRoles);
  assertSchoolOperationalAccess(req, schoolId, managerRoles as any);
  const resultId = id(req.params.resultId, "resultId");
  const decision = requiredString(body.decision, "decision", 20).toUpperCase();
  if (!["APPROVE", "RETURN"].includes(decision)) throw new AuthError(400, "Decision must be APPROVE or RETURN");
  const comment = body.comment == null ? null : requiredString(body.comment, "comment", 2000);
  if (decision === "RETURN" && !comment) throw new AuthError(400, "A review comment is required when returning a result");
  const actor = getUserContext(req);
  const client = await pool.connect();
  let reviewed;
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT id,status,review_status FROM academic_results WHERE id=$1 AND school_id=$2 FOR UPDATE`,
      [resultId, schoolId],
    );
    if (!current.rows[0]) throw new AuthError(404, "Result not found");
    if(current.rows[0].review_status==="APPROVED") throw new AuthError(409,"Approved results are frozen");
    if (current.rows[0].status !== "SUBMITTED") throw new AuthError(409, "Only submitted results can be reviewed");
    reviewed = await client.query(
      `UPDATE academic_results
          SET status=CASE WHEN $1='RETURN' THEN 'DRAFT' ELSE 'SUBMITTED' END,
              review_status=CASE WHEN $1='RETURN' THEN 'RETURNED' ELSE 'APPROVED' END,
              review_comment=$2,reviewed_by=$3,reviewed_at=NOW(),updated_at=NOW()
        WHERE id=$4 AND school_id=$5 RETURNING ${resultReturning}`,
      [decision, comment, actor.user.id, resultId, schoolId],
    );
    await auditResultReview(
      req,
      schoolId,
      decision === "RETURN" ? "Returned academic result for correction" : "Approved academic result",
      resultId,
      decision,
      comment,
      client,
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
  res.json({ ...reviewed!.rows[0], reviewStatus: decision === "RETURN" ? "RETURNED" : "APPROVED", reviewComment: comment });
}));

router.post("/academic/assessments/:assessmentId/publish-results", run(async (req, res) => {
  const body = bodyObject(req.body);
  const schoolId = authorizeSchool(req, body.schoolId, managerRoles);
  assertSchoolOperationalAccess(req, schoolId, managerRoles as any);
  const assessmentId = id(req.params.assessmentId, "assessmentId");
  const context = getUserContext(req);
  const client = await pool.connect();
  let result;
  try {
    await client.query("BEGIN");
    const assessment = await client.query(`SELECT id FROM academic_assessments WHERE id=$1 AND school_id=$2 FOR UPDATE`, [assessmentId, schoolId]);
    if (!assessment.rows[0]) throw new AuthError(404, "Assessment not found");
    result = await client.query(
      `UPDATE academic_results SET status='PUBLISHED',published_by=$1,published_at=NOW(),updated_at=NOW()
        WHERE assessment_id=$2 AND school_id=$3 AND status='SUBMITTED' AND review_status='APPROVED'
        RETURNING ${resultReturning}`,
      [context.user.id, assessmentId, schoolId],
    );
    await audit(req, schoolId, "Published assessment results", assessmentId, client);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  const notifiedStudents = new Set<number>();
  for (const publishedResult of result!.rows) {
    const studentId = Number(publishedResult.studentId);
    if (!Number.isSafeInteger(studentId) || studentId < 1 || notifiedStudents.has(studentId)) continue;
    notifiedStudents.add(studentId);
    await notifyStudentAcademicRecordSafely(req, schoolId, studentId, Number(publishedResult.classId), {
      category: "ACADEMIC",
      eventKey: `assessment-results-published:${assessmentId}:${studentId}`,
      subject: "Academic results available",
      body: "New academic results are available in your Yemait EduCore account.",
    });
  }
  res.json({ assessmentId, publishedCount: result!.rows.length, results: result!.rows });
}));

async function resolveSelfStudent(req: Request, schoolId: number): Promise<number> {
  const context = getUserContext(req);
  if (hasRole(req, ["STUDENT"], schoolId)) {
    const r = await pool.query(`SELECT id FROM students WHERE user_id=$1 AND school_id=$2`, [context.user.id, schoolId]);
    if (r.rows[0]) return Number(r.rows[0].id);
  }
  if (hasRole(req, ["PARENT"], schoolId)) {
    const r = await pool.query(`SELECT id FROM parents WHERE user_id=$1 AND school_id=$2`, [context.user.id, schoolId]);
    if (r.rows[0]) return -Number(r.rows[0].id);
  }
  throw new AuthError(404, "Student or parent record not found");
}
async function ensureChild(req: Request, schoolId: number, studentId: number) {
  const context = getUserContext(req);
  const parent = await pool.query(
    `SELECT 1 FROM parents p JOIN parent_student_relationships psr ON psr.parent_id=p.id
      JOIN students st ON st.id=psr.student_id
     WHERE p.user_id=$1 AND st.school_id=$2 AND psr.student_id=$3 AND psr.status='ACTIVE'
       AND UPPER(p.status)='ACTIVE' AND ${familyChildSchoolScope()}`,
    [context.user.id, schoolId, studentId],
  );
  if (!parent.rows[0]) throw new AuthError(404, "Student not found");
}
async function readStudentRows(req: Request, res: Response, table: "results" | "report-cards", studentId: number, parent = false) {
  const schoolId = id(req.query.schoolId, "schoolId");
  requireRole(req, studentParentRoles);
  const contextStudent = await resolveSelfStudent(req, schoolId);
  if (parent) {
    if (contextStudent >= 0) throw new AuthError(403, "Parent role required");
    await ensureChild(req, schoolId, studentId);
  } else {
    if (contextStudent < 0) throw new AuthError(403, "Student role required");
    if (contextStudent !== studentId) throw new AuthError(404, "Student record not found");
  }
  if (table === "results") {
    const result = await pool.query(
      `SELECT ${resultSelect} FROM academic_results r
        WHERE r.school_id=$1 AND r.student_id=$2 AND r.status='PUBLISHED'
        ORDER BY r.academic_session_id DESC,r.academic_term_id DESC,r.id`,
      [schoolId, studentId],
    );
    res.json(result.rows);
  } else {
    const cards = await pool.query(
      `SELECT ${cardSelect},EXISTS(SELECT 1 FROM academic_results ar
        WHERE ar.school_id=rc.school_id AND ar.student_id=rc.student_id AND ar.academic_session_id=rc.academic_session_id
          AND ar.academic_term_id=rc.academic_term_id AND ar.status<>'PUBLISHED') AS "hasUnpublishedResults"
        FROM academic_report_cards rc WHERE rc.school_id=$1 AND rc.student_id=$2 AND rc.status='PUBLISHED'
        ORDER BY rc.academic_session_id DESC,rc.academic_term_id DESC`,
      [schoolId, studentId],
    );
    const rows = await Promise.all(cards.rows.map(async (card: any) => {
      const lines = await pool.query(`SELECT id,subject_id AS "subjectId",subject_name_snapshot AS "subjectName",
        assessment_name_snapshot AS "assessmentName",score,max_score AS "maxScore",grade,grade_point AS "gradePoint",remark
        FROM academic_report_card_lines WHERE school_id=$1 AND report_card_id=$2 ORDER BY id`, [schoolId, card.id]);
      const incomplete = await pool.query(`SELECT count(*)::int AS count FROM academic_results r
        WHERE r.school_id=$1 AND r.student_id=$2 AND r.academic_session_id=$3 AND r.academic_term_id=$4
          AND r.status='PUBLISHED' AND r.student_class_assignment_id=$5 AND NOT EXISTS
          (SELECT 1 FROM academic_report_card_lines l WHERE l.school_id=r.school_id AND l.report_card_id=$6 AND l.result_id=r.id)`,
        [schoolId,card.studentId,card.sessionId,card.termId,card.studentClassAssignmentId,card.id]);
      return { ...card, resultState: reportResultState(lines.rows.length, Number(card.hasUnpublishedResults), Number(incomplete.rows[0].count)), lines: lines.rows };
    }));
    res.json(rows);
  }
}
router.get("/academic/students/me/results", run(async (req, res) => {
  const schoolId = id(req.query.schoolId, "schoolId");
  requireRole(req, ["STUDENT"]);
  const studentId = await resolveSelfStudent(req, schoolId);
  await readStudentRows(req, res, "results", studentId);
}));
router.get("/academic/parents/children/:studentId/results", run(async (req, res) => {
  const studentId = id(req.params.studentId, "studentId");
  await readStudentRows(req, res, "results", studentId, true);
}));

router.get("/academic/report-cards", run(async (req, res) => {
  const schoolId = authorizeSchool(req, req.query.schoolId, allSchoolRoles);
  const studentId = req.query.studentId == null ? null : id(req.query.studentId, "studentId");
  const cards = await pool.query(`SELECT ${cardSelect} FROM academic_report_cards rc
    WHERE rc.school_id=$1 AND ($2::int IS NULL OR rc.student_id=$2) ORDER BY rc.academic_session_id DESC,rc.academic_term_id DESC,rc.id`, [schoolId, studentId]);
  const rows = await Promise.all(cards.rows.map(async (card: any) => {
    const lines = await pool.query(`SELECT id,subject_id AS "subjectId",subject_name_snapshot AS "subjectName",
      assessment_name_snapshot AS "assessmentName",score,max_score AS "maxScore",grade,grade_point AS "gradePoint",remark
      FROM academic_report_card_lines WHERE school_id=$1 AND report_card_id=$2 ORDER BY id`, [schoolId, card.id]);
    const state = await pool.query(`SELECT count(*)::int AS count FROM academic_results WHERE school_id=$1 AND student_id=$2
       AND academic_session_id=$3 AND academic_term_id=$4 AND status<>'PUBLISHED'`,
       [schoolId,card.studentId,card.sessionId,card.termId]);
    const incomplete = await pool.query(`SELECT count(*)::int AS count FROM academic_results r
      WHERE r.school_id=$1 AND r.student_id=$2 AND r.academic_session_id=$3 AND r.academic_term_id=$4
        AND r.status='PUBLISHED' AND r.student_class_assignment_id=$5 AND NOT EXISTS
        (SELECT 1 FROM academic_report_card_lines l WHERE l.school_id=r.school_id AND l.report_card_id=$6 AND l.result_id=r.id)`,
      [schoolId,card.studentId,card.sessionId,card.termId,card.studentClassAssignmentId,card.id]);
    return { ...card, resultState: reportResultState(lines.rows.length, Number(state.rows[0].count), Number(incomplete.rows[0].count)), lines: lines.rows };
  }));
  res.json(rows);
}));
router.post("/academic/report-cards", run(async (req, res) => {
  const body = bodyObject(req.body);
  const schoolId = authorizeSchool(req, body.schoolId, managerRoles);
  assertSchoolOperationalAccess(req, schoolId, managerRoles as any);
  const studentId = id(body.studentId, "studentId");
  const sessionId = id(body.sessionId, "sessionId");
  const termId = id(body.termId, "termId");
  const teacherRemark = body.teacherRemark == null ? "" : requiredString(body.teacherRemark, "teacherRemark");
  const schoolRemark = body.schoolRemark == null ? "" : requiredString(body.schoolRemark, "schoolRemark");
  const client = await pool.connect();
  let created;
  let snapshotLines: any[] = [];
  let incompleteCount = 0;
  let unpublishedCount = 0;
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`report-card:${schoolId}:${studentId}:${sessionId}:${termId}`]);
    await client.query("SELECT pg_advisory_xact_lock($1::int,$2::int)",[schoolId,studentId]);
    const assignment = await client.query(
      `SELECT sca.id,sca.school_class_id,sca.section,c.name AS class_name
        FROM student_class_assignments sca JOIN school_classes c ON c.id=sca.school_class_id AND c.school_id=sca.school_id
        JOIN academic_sessions s ON s.id=sca.academic_session_id AND s.school_id=sca.school_id
        JOIN academic_terms t ON t.id=sca.academic_term_id AND t.school_id=sca.school_id AND t.academic_session_id=s.id
       WHERE sca.school_id=$1 AND sca.student_id=$2 AND sca.academic_session_id=$3 AND sca.academic_term_id=$4
         AND sca.status IN ('ACTIVE','INACTIVE') ORDER BY sca.id DESC LIMIT 1`,
      [schoolId,studentId,sessionId,termId],
    );
    const assignmentRow = assignment.rows[0];
    if (!assignmentRow) throw new AuthError(404, "Student academic assignment not found");
    if ((body.classId != null && id(body.classId, "classId") !== Number(assignmentRow.school_class_id)) ||
        (body.section != null && String(body.section) !== String(assignmentRow.section))) {
      throw new AuthError(404, "Student does not belong to the selected class/section for this period");
    }
    const existing = await client.query(`SELECT ${cardReturning} FROM academic_report_cards
      WHERE school_id=$1 AND student_id=$2 AND academic_session_id=$3 AND academic_term_id=$4 FOR UPDATE`,
      [schoolId,studentId,sessionId,termId]);
    if (existing.rows[0]?.status === "PUBLISHED" || existing.rows[0]?.status === "ARCHIVED") {
      throw new AuthError(409, "Published or archived report cards cannot be regenerated");
    }
    const approved = existing.rows[0] && await client.query(`SELECT 1 FROM audit_logs WHERE school_id=$1 AND record_id=$2 AND action='Approved academic report card'`, [schoolId,existing.rows[0].id]);
    if (approved?.rows.length) throw new AuthError(409, "Approved report cards cannot be regenerated");
    const available = await client.query(`SELECT count(*)::int AS count FROM academic_results WHERE school_id=$1 AND student_id=$2
      AND academic_session_id=$3 AND academic_term_id=$4 AND student_class_assignment_id=$5 AND status<>'ARCHIVED'
      AND grade IS NOT NULL AND grade_point IS NOT NULL AND remark IS NOT NULL`,
      [schoolId,studentId,sessionId,termId,assignmentRow.id]);
    if (!Number(available.rows[0]?.count)) throw new AuthError(409, "No calculated assessment scores exist for this student and period. Enter marks and configure grading rules first.");
    created = existing.rows.length ? existing : await client.query(
      `INSERT INTO academic_report_cards(school_id,student_id,academic_session_id,academic_term_id,student_class_assignment_id,
        school_class_id,class_name_snapshot,section_snapshot,status,teacher_remark,school_remark,published_by,published_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'DRAFT',$9,$10,NULL,NULL)
       RETURNING ${cardReturning}`,
      [schoolId,studentId,sessionId,termId,assignmentRow.id,assignmentRow.school_class_id,assignmentRow.class_name,assignmentRow.section,teacherRemark,schoolRemark],
    );
    await client.query(
      `INSERT INTO academic_report_card_lines(school_id,report_card_id,result_id,subject_id,subject_name_snapshot,
        assessment_name_snapshot,score,max_score,grade,grade_point,remark)
       SELECT r.school_id,$1,r.id,r.subject_id,s.name,a.title,r.score,r.max_score,r.grade,r.grade_point,r.remark
        FROM academic_results r JOIN subjects s ON s.id=r.subject_id AND s.school_id=r.school_id
        JOIN academic_assessments a ON a.id=r.assessment_id AND a.school_id=r.school_id
       WHERE r.school_id=$2 AND r.student_id=$3 AND r.academic_session_id=$4 AND r.academic_term_id=$5
         AND r.status<>'ARCHIVED' AND r.student_class_assignment_id=$6
         AND r.grade IS NOT NULL AND r.grade_point IS NOT NULL AND r.remark IS NOT NULL
       ON CONFLICT (report_card_id,result_id) DO UPDATE SET score=EXCLUDED.score,max_score=EXCLUDED.max_score,
         grade=EXCLUDED.grade,grade_point=EXCLUDED.grade_point,remark=EXCLUDED.remark`,
      [created.rows[0].id,schoolId,studentId,sessionId,termId,assignmentRow.id],
    );
    const lines = await client.query(
      `SELECT id,subject_id AS "subjectId",subject_name_snapshot AS "subjectName",
        assessment_name_snapshot AS "assessmentName",score,max_score AS "maxScore",grade,grade_point AS "gradePoint",remark
       FROM academic_report_card_lines WHERE school_id=$1 AND report_card_id=$2 ORDER BY id`,
      [schoolId, created.rows[0].id],
    );
    snapshotLines = lines.rows;
    const incomplete = await client.query(`SELECT count(*)::int AS count FROM academic_results r
      WHERE r.school_id=$1 AND r.student_id=$2 AND r.academic_session_id=$3 AND r.academic_term_id=$4
        AND r.status='PUBLISHED' AND r.student_class_assignment_id=$5 AND NOT EXISTS
        (SELECT 1 FROM academic_report_card_lines l WHERE l.school_id=r.school_id AND l.report_card_id=$6 AND l.result_id=r.id)`,
      [schoolId,studentId,sessionId,termId,assignmentRow.id,created.rows[0].id]);
    incompleteCount = Number(incomplete.rows[0].count);
    const unpublished = await client.query(`SELECT count(*)::int AS count FROM academic_results
      WHERE school_id=$1 AND student_id=$2 AND academic_session_id=$3 AND academic_term_id=$4
        AND student_class_assignment_id=$5 AND status<>'PUBLISHED'`,
      [schoolId,studentId,sessionId,termId,assignmentRow.id]);
    unpublishedCount = Number(unpublished.rows[0].count);
    await audit(req, schoolId, "Created academic report card draft", created.rows[0].id, client);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  res.status(201).json({
    ...created!.rows[0],
    lines: snapshotLines,
    resultState: reportResultState(snapshotLines.length, unpublishedCount, incompleteCount),
  });
}));
router.post("/academic/report-cards/:id/publish", run(async (req, res) => {
  const body = bodyObject(req.body);
  const schoolId = authorizeSchool(req, body.schoolId, managerRoles);
  assertSchoolOperationalAccess(req, schoolId, managerRoles as any);
  const cardId = id(req.params.id, "id");
  const context = getUserContext(req);
  const client = await pool.connect();
  let card;
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(school_id,student_id) FROM academic_report_cards WHERE id=$1 AND school_id=$2`,[cardId,schoolId]);
    const selected = await client.query(`SELECT id,student_id,academic_session_id,academic_term_id,student_class_assignment_id,status FROM academic_report_cards WHERE id=$1 AND school_id=$2 FOR UPDATE`, [cardId,schoolId]);
    const current = selected.rows[0];
    if (!current) throw new AuthError(404, "Report card not found");
    if (current.status !== "DRAFT") throw new AuthError(409, "Only draft report cards may be published");
    if (body.decision != null && !["APPROVE", "PUBLISH"].includes(String(body.decision))) throw new AuthError(400, "Invalid report card decision");
    if (body.decision === "APPROVE") {
      const missing = await client.query(`SELECT 1 FROM academic_results r WHERE r.school_id=$1 AND r.student_id=$2
        AND r.academic_session_id=$3 AND r.academic_term_id=$4 AND r.student_class_assignment_id=$5
        AND r.status<>'ARCHIVED' AND NOT EXISTS(SELECT 1 FROM academic_report_card_lines l
          WHERE l.school_id=r.school_id AND l.report_card_id=$6 AND l.result_id=r.id) LIMIT 1`,
        [schoolId,current.student_id,current.academic_session_id,current.academic_term_id,current.student_class_assignment_id,cardId]);
      if(missing.rows.length) throw new AuthError(409,"Compile every assessment score before approving this report card");
      const unreviewed = await client.query(`SELECT 1 FROM academic_report_card_lines l
        JOIN academic_results r ON r.id=l.result_id AND r.school_id=l.school_id
        WHERE l.report_card_id=$1 AND l.school_id=$2 AND
          (r.status='ARCHIVED' OR (r.status<>'PUBLISHED' AND r.review_status<>'APPROVED')
           OR r.score<>l.score OR r.max_score<>l.max_score OR r.grade IS DISTINCT FROM l.grade) LIMIT 1`, [cardId,schoolId]);
      const lineCount = await client.query(`SELECT count(*)::int AS count FROM academic_report_card_lines WHERE report_card_id=$1 AND school_id=$2`, [cardId,schoolId]);
      if (unreviewed.rows.length || !Number(lineCount.rows[0]?.count)) throw new AuthError(409, "Review and approve every compiled assessment score before approving the report card");
      await audit(req, schoolId, "Approved academic report card", cardId, client);
      card = await client.query(`SELECT ${cardReturning} FROM academic_report_cards WHERE id=$1 AND school_id=$2`, [cardId,schoolId]);
      await client.query("COMMIT");
      const lines = await pool.query(`SELECT id,subject_id AS "subjectId",subject_name_snapshot AS "subjectName",assessment_name_snapshot AS "assessmentName",score,max_score AS "maxScore",grade,grade_point AS "gradePoint",remark FROM academic_report_card_lines WHERE report_card_id=$1 AND school_id=$2`, [cardId,schoolId]);
      res.json({ ...card.rows[0], isApproved:true, lines:lines.rows, resultState:"COMPLETE" });
      return;
    }
    const approval = await client.query(`SELECT 1 FROM audit_logs WHERE school_id=$1 AND record_id=$2 AND action='Approved academic report card'`, [schoolId,cardId]);
    if (!approval.rows.length) throw new AuthError(409, "Approve the compiled report card before publishing");
    await client.query(`UPDATE academic_results SET status='PUBLISHED',published_by=$1,published_at=NOW(),updated_at=NOW()
      WHERE school_id=$2 AND student_id=$3 AND academic_session_id=$4 AND academic_term_id=$5
        AND student_class_assignment_id=$6 AND status='SUBMITTED' AND review_status='APPROVED'`,
      [context.user.id,schoolId,current.student_id,current.academic_session_id,current.academic_term_id,current.student_class_assignment_id]);
    await client.query(
      `INSERT INTO academic_report_card_lines(school_id,report_card_id,result_id,subject_id,subject_name_snapshot,
        assessment_name_snapshot,score,max_score,grade,grade_point,remark)
       SELECT r.school_id,$1,r.id,r.subject_id,s.name,a.title,r.score,r.max_score,r.grade,r.grade_point,r.remark
        FROM academic_results r JOIN subjects s ON s.id=r.subject_id AND s.school_id=r.school_id
        JOIN academic_assessments a ON a.id=r.assessment_id AND a.school_id=r.school_id
       WHERE r.school_id=$2 AND r.student_id=$3 AND r.academic_session_id=$4 AND r.academic_term_id=$5
         AND r.status='PUBLISHED' AND r.student_class_assignment_id=$6
         AND r.grade IS NOT NULL AND r.grade_point IS NOT NULL AND r.remark IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM academic_report_card_lines prior
           WHERE prior.school_id=r.school_id AND prior.report_card_id=$1 AND prior.result_id=r.id)`,
      [cardId,schoolId,current.student_id,current.academic_session_id,current.academic_term_id,current.student_class_assignment_id],
    );
    card = await client.query(`UPDATE academic_report_cards SET status='PUBLISHED',published_by=$1,published_at=NOW(),updated_at=NOW()
      WHERE id=$2 AND school_id=$3 RETURNING ${cardReturning}`, [context.user.id,cardId,schoolId]);
    await audit(req, schoolId, "Published academic report card", cardId, client);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  await notifyStudentAcademicRecordSafely(
    req,
    schoolId,
    Number(card!.rows[0].studentId),
    Number(card!.rows[0].classId),
    {
    category: "ACADEMIC",
    eventKey: `report-card-published:${cardId}`,
    subject: "Report card available",
    body: "A report card is now available in your Yemait EduCore account.",
    },
  );
  const lines = await pool.query(`SELECT id,subject_id AS "subjectId",subject_name_snapshot AS "subjectName",
    assessment_name_snapshot AS "assessmentName",score,max_score AS "maxScore",grade,grade_point AS "gradePoint",remark
    FROM academic_report_card_lines WHERE school_id=$1 AND report_card_id=$2 ORDER BY id`, [schoolId,cardId]);
  const missing = await pool.query(`SELECT count(*)::int AS count FROM academic_results WHERE school_id=$1 AND student_id=$2
    AND academic_session_id=$3 AND academic_term_id=$4 AND student_class_assignment_id=$5 AND status<>'PUBLISHED'`,
    [schoolId,card!.rows[0].studentId,card!.rows[0].sessionId,card!.rows[0].termId,card!.rows[0].studentClassAssignmentId]);
  const incomplete = await pool.query(`SELECT count(*)::int AS count FROM academic_results r
    WHERE r.school_id=$1 AND r.student_id=$2 AND r.academic_session_id=$3 AND r.academic_term_id=$4
      AND r.status='PUBLISHED' AND r.student_class_assignment_id=$5 AND NOT EXISTS
      (SELECT 1 FROM academic_report_card_lines l WHERE l.school_id=r.school_id AND l.report_card_id=$6 AND l.result_id=r.id)`,
    [schoolId,card!.rows[0].studentId,card!.rows[0].sessionId,card!.rows[0].termId,card!.rows[0].studentClassAssignmentId,cardId]);
  res.json({ ...card!.rows[0], resultState: reportResultState(lines.rows.length, Number(missing.rows[0].count), Number(incomplete.rows[0].count)), lines: lines.rows });
}));
router.get("/academic/students/me/report-cards", run(async (req, res) => {
  const schoolId = id(req.query.schoolId, "schoolId");
  requireRole(req, ["STUDENT"]);
  const studentId = await resolveSelfStudent(req, schoolId);
  await readStudentRows(req, res, "report-cards", studentId);
}));
router.get("/academic/parents/children/:studentId/report-cards", run(async (req, res) => {
  const studentId = id(req.params.studentId, "studentId");
  await readStudentRows(req, res, "report-cards", studentId, true);
}));

export { gradeFor };
export default router;