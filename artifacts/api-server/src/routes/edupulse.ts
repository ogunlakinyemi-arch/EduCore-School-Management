import { Router, type IRouter, type Request, type Response as ExpressResponse } from "express";
import {
  CreateClassBody,
  CreateParentBody,
  CreateSchoolBody,
  CreateStudentBody,
  CreateStudentQueryParams,
  CreateSubscriptionBody,
  GetSchoolDashboardQueryParams,
  ListAuditLogsQueryParams,
  ListCardsQueryParams,
  ListClassesQueryParams,
  ListParentsQueryParams,
  ListSchoolsQueryParams,
  ListStudentsQueryParams,
  ListSubscriptionsQueryParams,
  RegisterCardBody,
  RegisterCardQueryParams,
  UpdateCardStatusBody,
  UpdateStudentQueryParams,
  UpdateSchoolBody,
  UpdateSchoolParams,
  UpdateSchoolStatusBody,
  UpdateSchoolStatusParams,
  UpdateStudentBody,
  UpdateStudentParams,
  UpdateStudentStatusBody,
  UpdateStudentStatusParams,
  UpdateStudentStatusQueryParams,
  VerifySubscriptionBody,
  VerifySubscriptionParams,
} from "@workspace/api-zod";
import { pool } from "@workspace/db";
import {
  AuthError,
  assertRoles,
  assertSchoolAccess,
  getUserContext,
  requireAuthentication,
  type Role,
} from "../middlewares/auth";

const router: IRouter = Router();
router.use(requireAuthentication());

const asNumber = (value: unknown) => Number(value);
const asString = (value: unknown) =>
  typeof value === "string" ? value : undefined;
const dateString = (value: Date | string | null) =>
  value ? new Date(value).toISOString() : null;

const schoolFields = `
  s.id, s.code, s.name, s.city, s.state, s.registration_number AS "registrationNumber",
  s.address, s.lga, s.phone, s.email, s.website, s.logo AS "logoUrl", s.school_type AS "schoolType",
  s.status, s.created_at AS "createdAt",
  (SELECT COUNT(*)::int FROM students st WHERE st.school_id = s.id) AS "studentCount",
  (SELECT COUNT(*)::int FROM employees e WHERE e.school_id = s.id AND e.employment_status = 'ACTIVE') AS "staffCount",
  (SELECT CASE WHEN COUNT(*) = 0 THEN 'attention'
          WHEN COUNT(*) FILTER (WHERE LOWER(status) = 'active' AND expires_at > NOW()) > 0 THEN 'active'
          ELSE 'expired' END FROM subscriptions WHERE school_id = s.id) AS "subscriptionStatus",
  (SELECT CASE WHEN EXISTS (SELECT 1 FROM academic_sessions ac WHERE ac.school_id = s.id)
          AND EXISTS (SELECT 1 FROM academic_terms at WHERE at.school_id = s.id)
        THEN 'complete' ELSE 'incomplete' END) AS "academicSetupStatus"`;

const administrators = `(SELECT COALESCE(json_agg(json_build_object(
  'id', u.id, 'email', u.email, 'firstName', u.first_name, 'lastName', u.last_name,
  'phone', u.phone, 'userStatus', u.status, 'membershipId', sm.id, 'role', sm.role,
  'membershipStatus', sm.status, 'schoolId', sm.school_id) ORDER BY u.id), '[]'::json)
  FROM school_memberships sm JOIN app_users u ON u.id = sm.user_id
  WHERE sm.school_id = s.id AND sm.role = 'SCHOOL_ADMIN') AS administrators`;

function tenantId(req: Request, roles: Role[]) {
  const raw = req.query.schoolId;
  const id = asNumber(raw);
  if (!Number.isInteger(id) || id < 1) {
    throw new AuthError(400, "A valid schoolId is required");
  }
  assertSchoolAccess(req, id, roles);
  return id;
}

async function audit(
  req: Request,
  schoolId: number | null,
  action: string,
  module: string,
  recordId: number | null,
  severity = "info",
  eventType = "APPLICATION_EVENT",
  result = "SUCCESS",
  metadata: Record<string, unknown> | null = null,
) {
  const context = getUserContext(req);
  const actor = [context.user.firstName, context.user.lastName]
    .filter(Boolean)
    .join(" ") || context.user.email;
  const role = context.roles.find((assignment) =>
    assignment.schoolId === null || assignment.schoolId === schoolId,
  )?.role ?? "AUTHENTICATED";
  await pool.query(
    `INSERT INTO audit_logs
      ("user", role, actor_user_id, clerk_user_id, school_id, action, module,
       record_id, severity, event_type, result, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      actor,
      role,
      context.user.id,
      context.user.clerkUserId,
      schoolId,
      action,
      module,
      recordId,
      severity,
      eventType,
      result,
      metadata,
    ],
  );
}

function fail(req: Request, res: ExpressResponse, error: unknown) {
  if (error instanceof AuthError) {
    const context = (req as Request & { edupulseUser?: unknown }).edupulseUser as
      | { user?: { id: number; clerkUserId: string }; roles?: Array<{ role: string }> }
      | undefined;
    void pool.query(
      `INSERT INTO audit_logs
        ("user", role, actor_user_id, clerk_user_id, school_id, action, module,
         severity, event_type, result, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, 'Security', 'critical', $7, 'DENIED', $8)`,
      [
        context?.user?.clerkUserId ?? "Unauthenticated request",
        context?.roles?.[0]?.role ?? "UNAUTHENTICATED",
        context?.user?.id ?? null,
        context?.user?.clerkUserId ?? null,
        Number.isInteger(Number(req.query.schoolId)) ? Number(req.query.schoolId) : null,
        error.message,
        error.eventType,
        JSON.stringify({ method: req.method, path: req.path }),
      ],
    ).catch(() => undefined);
    return res.status(error.statusCode).json({ error: error.message, code: error.eventType });
  }
  const message = error instanceof Error ? error.message : "Request failed";
  const statusCode = message.includes("required") || message.includes("invalid")
    ? 400
    : 500;
  res.status(statusCode).json({ error: message });
}

router.get("/dashboard/platform", async (req, res) => {
  try {
    assertRoles(req, ["PLATFORM_OWNER"]);
    const [counts, recent] = await Promise.all([
      pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM schools) AS "totalSchools",
          (SELECT COUNT(*)::int FROM schools WHERE status = 'active') AS "activeSchools",
          (SELECT COUNT(*)::int FROM schools WHERE status = 'suspended') AS "suspendedSchools",
           (SELECT COUNT(*)::int FROM schools WHERE status = 'inactive') AS "inactiveSchools",
          (SELECT COUNT(*)::int FROM students WHERE UPPER(status) = 'ACTIVE') AS "totalStudents",
           (SELECT COUNT(*)::int FROM employees WHERE employee_type = 'TEACHER' AND employment_status = 'ACTIVE') AS "totalTeachers",
           (SELECT COUNT(*)::int FROM parents WHERE status = 'ACTIVE') AS "totalParents",
          (SELECT COUNT(*)::int FROM subscriptions WHERE status = 'active') AS "activeSubscriptions",
          (SELECT COUNT(*)::int FROM subscriptions WHERE status = 'pending') AS "pendingPayments",
          COALESCE((SELECT SUM(amount)::float FROM subscriptions WHERE verification_status = 'verified'), 0) AS "revenue",
          COALESCE((SELECT SUM(school_share)::float FROM subscriptions WHERE verification_status = 'verified'), 0) AS "schoolAllocation",
          COALESCE((SELECT SUM(edupulse_share)::float FROM subscriptions WHERE verification_status = 'verified'), 0) AS "edupulseAllocation",
          (SELECT COUNT(*)::int FROM nfc_cards WHERE status = 'active') AS "activeCards",
          (SELECT COUNT(*)::int FROM nfc_cards WHERE status = 'locked') AS "lockedCards"
      `),
      pool.query(`
        SELECT a.id, a."user", a.role, s.name AS school, a.action, a.module,
               a.record_id AS "recordId", a.timestamp, a.severity
        FROM audit_logs a
        LEFT JOIN schools s ON s.id = a.school_id
        ORDER BY a.timestamp DESC
        LIMIT 8
      `),
    ]);
    res.json({ ...counts.rows[0], recentActivity: recent.rows.map(mapAudit) });
  } catch (error) {
    fail(req, res, error);
  }
});

router.get("/dashboard/school", async (req, res) => {
  try {
    const schoolId = GetSchoolDashboardQueryParams.parse(req.query).schoolId;
    assertSchoolAccess(req, schoolId, ["SCHOOL_ADMIN", "TEACHER", "ACCOUNTANT", "STAFF"]);
    const [school, metrics, recent] = await Promise.all([
      pool.query(`
        SELECT s.id, s.code, s.name, s.city, s.state, s.status, s.created_at AS "createdAt",
          (SELECT COUNT(*)::int FROM students WHERE school_id = s.id) AS "studentCount",
          (SELECT COUNT(*)::int FROM employees WHERE school_id = s.id AND employment_status = 'ACTIVE') AS "staffCount",
          CASE WHEN EXISTS (SELECT 1 FROM subscriptions WHERE school_id = s.id AND LOWER(status) = 'active')
            THEN 'active' ELSE 'attention' END AS "subscriptionStatus"
        FROM schools s WHERE s.id = $1
      `, [schoolId]),
      pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM students WHERE school_id = $1) AS "totalStudents",
          (SELECT COUNT(*)::int FROM students WHERE school_id = $1 AND UPPER(status) = 'ACTIVE') AS "activeStudents",
          (SELECT COUNT(*)::int FROM students st WHERE school_id = $1 AND NOT EXISTS (
            SELECT 1 FROM subscriptions sub WHERE sub.student_id = st.id AND LOWER(sub.status) = 'active'
          )) AS "unpaidStudents",
          NULL::float AS "attendanceRate",
           (SELECT COUNT(*)::int FROM subscriptions WHERE school_id = $1 AND LOWER(status) = 'pending') AS "pendingPayments",
          (SELECT COUNT(*)::int FROM nfc_cards WHERE school_id = $1 AND status = 'active') AS "activeCards",
           (SELECT COUNT(*)::int FROM nfc_cards WHERE school_id = $1 AND status = 'locked') AS "lockedCards",
           (SELECT COUNT(*)::int FROM parents WHERE school_id = $1) AS "totalParents",
           (SELECT COUNT(*)::int FROM employees WHERE school_id = $1 AND employee_type = 'TEACHER' AND employment_status = 'ACTIVE') AS "activeTeachers",
           (SELECT COUNT(*)::int FROM employees WHERE school_id = $1 AND employee_type <> 'TEACHER' AND employment_status = 'ACTIVE') AS "otherStaff",
           (SELECT COUNT(*)::int FROM school_classes WHERE school_id = $1) AS "totalClasses",
           (SELECT COUNT(DISTINCT section)::int FROM school_classes WHERE school_id = $1) AS "totalSections",
           (SELECT COUNT(*)::int FROM subjects WHERE school_id = $1 AND status = 'ACTIVE') AS "totalSubjects",
           (SELECT row_to_json(x) FROM (SELECT id, school_id AS "schoolId", name, start_date AS "startDate",
             end_date AS "endDate", status, is_current AS "isCurrent" FROM academic_sessions
             WHERE school_id = $1 AND (is_current OR status = 'ACTIVE') ORDER BY is_current DESC, id DESC LIMIT 1) x) AS "currentAcademicSession",
           (SELECT row_to_json(x) FROM (SELECT id, academic_session_id AS "sessionId", name,
             start_date AS "startDate", end_date AS "endDate", status, is_current AS "isCurrent" FROM academic_terms
             WHERE school_id = $1 AND (is_current OR status = 'ACTIVE') ORDER BY is_current DESC, id DESC LIMIT 1) x) AS "currentTerm"
      `, [schoolId]),
      pool.query(`
        SELECT a.id, a."user", a.role, s.name AS school, a.action, a.module,
               a.record_id AS "recordId", a.timestamp, a.severity
        FROM audit_logs a LEFT JOIN schools s ON s.id = a.school_id
        WHERE a.school_id = $1 ORDER BY a.timestamp DESC LIMIT 6
      `, [schoolId]),
    ]);
    if (!school.rows[0]) return res.status(404).json({ error: "School not found" });
    res.json({
      school: { ...school.rows[0], createdAt: dateString(school.rows[0].createdAt) },
      ...metrics.rows[0],
      recentActivity: recent.rows.map(mapAudit),
    });
  } catch (error) {
    fail(req, res, error);
  }
});

router.get("/schools", async (req, res) => {
  try {
    const context = getUserContext(req);
    const platformOwner = context.roles.some(
      (assignment) => assignment.role === "PLATFORM_OWNER" && assignment.schoolId === null,
    );
    const query = ListSchoolsQueryParams.parse(req.query);
    const values: unknown[] = [];
    const conditions: string[] = [];
    if (!platformOwner) {
      values.push(context.user.id);
      conditions.push(`EXISTS (
        SELECT 1 FROM school_memberships sm
        WHERE sm.school_id = s.id AND sm.user_id = $${values.length}
          AND sm.status = 'ACTIVE'
          AND sm.role IN ('SCHOOL_ADMIN', 'TEACHER', 'ACCOUNTANT', 'STAFF')
      )`);
    }
    if (query.status && query.status !== "all") {
      values.push(query.status);
      conditions.push(`s.status = $${values.length}`);
    }
    if (query.search) {
      values.push(`%${query.search}%`);
      conditions.push(`(s.name ILIKE $${values.length} OR s.code ILIKE $${values.length} OR s.city ILIKE $${values.length})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(`
        SELECT ${schoolFields}, ${administrators}
      FROM schools s ${where} ORDER BY s.created_at DESC
    `, values);
    res.json(result.rows.map((row) => ({ ...row, createdAt: dateString(row.createdAt) })));
  } catch (error) {
    fail(req, res, error);
  }
});

router.post("/schools", async (req, res) => {
  try {
    assertRoles(req, ["PLATFORM_OWNER"]);
    const body = CreateSchoolBody.parse(req.body);
    const code = body.code ?? `EDU-${Date.now().toString(36).slice(-6).toUpperCase()}`;
    const result = await pool.query(`
      INSERT INTO schools (code, name, city, state, registration_number, address, lga, phone, email, website, logo, school_type, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING id
    `, [code, body.name, body.city, body.state, body.registrationNumber ?? null, body.address ?? null,
      body.lga ?? null, body.phone ?? null, body.email ?? null, body.website ?? null, body.logoUrl ?? null,
      body.schoolType ?? null, body.status ?? "active"]);
    const school = await pool.query(`SELECT ${schoolFields}, ${administrators} FROM schools s WHERE s.id = $1`, [result.rows[0].id]);
    await audit(req, null, "Created school", "Schools", result.rows[0].id, "info", "SCHOOL_CREATED");
    res.status(201).json({ ...school.rows[0], createdAt: dateString(school.rows[0].createdAt) });
  } catch (error) {
    fail(req, res, error);
  }
});

router.get("/schools/:schoolId", async (req, res) => {
  try {
    const id = asNumber(req.params.schoolId);
    assertSchoolAccess(req, id, ["SCHOOL_ADMIN"]);
    const result = await pool.query(`
       SELECT ${schoolFields}, ${administrators}
      FROM schools s WHERE s.id = $1
    `, [id]);
    if (!result.rows[0]) return res.status(404).json({ error: "School not found" });
    res.json({ ...result.rows[0], createdAt: dateString(result.rows[0].createdAt) });
  } catch (error) {
    fail(req, res, error);
  }
});

router.patch("/schools/:schoolId", async (req, res) => {
  try {
    const params = UpdateSchoolParams.parse(req.params);
    assertSchoolAccess(req, params.schoolId, ["SCHOOL_ADMIN"]);
    const body = UpdateSchoolBody.parse(req.body);
    const current = await pool.query(`SELECT * FROM schools WHERE id = $1`, [params.schoolId]);
    if (!current.rows[0]) return res.status(404).json({ error: "School not found" });
    const next = { ...current.rows[0],
      ...Object.fromEntries(Object.entries(body).map(([key, value]) => [({
        registrationNumber: "registration_number", schoolType: "school_type", logoUrl: "logo",
      } as Record<string, string>)[key] ?? key, value])),
      logo: body.logoUrl ?? current.rows[0].logo };
    const result = await pool.query(`
      UPDATE schools SET code=$1,name=$2,city=$3,state=$4,registration_number=$5,address=$6,lga=$7,phone=$8,
        email=$9,website=$10,logo=$11,school_type=$12,status=$13,updated_at=NOW() WHERE id=$14 RETURNING id
    `, [next.code,next.name,next.city,next.state,next.registration_number,next.address,next.lga,next.phone,
      next.email,next.website,next.logo,next.school_type,next.status,params.schoolId]);
    const school = await pool.query(`SELECT ${schoolFields}, ${administrators} FROM schools s WHERE s.id = $1`, [result.rows[0].id]);
    await audit(req, params.schoolId, "Updated school", "Schools", params.schoolId, "info", "SCHOOL_UPDATED");
    res.json({ ...school.rows[0], createdAt: dateString(school.rows[0].createdAt) });
  } catch (error) {
    fail(req, res, error);
  }
});

router.patch("/schools/:schoolId/status", async (req, res) => {
  try {
    const params = UpdateSchoolStatusParams.parse(req.params);
    const body = UpdateSchoolStatusBody.parse(req.body);
    assertRoles(req, ["PLATFORM_OWNER"]);
    const result = await pool.query(`UPDATE schools SET status = $1, updated_at = NOW()
      WHERE id = $2 RETURNING id`, [body.status, params.schoolId]);
    if (!result.rows[0]) { res.status(404).json({ error: "School not found" }); return; }
    const school = await pool.query(`SELECT ${schoolFields}, ${administrators} FROM schools s WHERE s.id = $1`, [params.schoolId]);
    await audit(req, params.schoolId, `Changed school status to ${body.status}`, "Schools", params.schoolId, "info", "SCHOOL_STATUS_CHANGED");
    res.json({ ...school.rows[0], createdAt: dateString(school.rows[0].createdAt) });
  } catch (error) { fail(req, res, error); }
});

router.get("/students", async (req, res) => {
  try {
    const query = ListStudentsQueryParams.parse(req.query);
    assertSchoolAccess(req, query.schoolId, ["SCHOOL_ADMIN", "TEACHER", "ACCOUNTANT", "STAFF"]);
    const values: unknown[] = [query.schoolId];
    const conditions = ["st.school_id = $1"];
    if (query.status && query.status !== "all") {
      values.push(query.status);
      conditions.push(`UPPER(st.status) = UPPER($${values.length})`);
    }
    if (query.search) {
      values.push(`%${query.search}%`);
      conditions.push(`(st.first_name ILIKE $${values.length} OR st.last_name ILIKE $${values.length} OR st.admission_no ILIKE $${values.length})`);
    }
    if (query.classId) {
      // classId is a database class record; filtering by name keeps tenant scope explicit.
      values.push(query.classId);
      conditions.push(`st.class_name = (SELECT name FROM school_classes WHERE id = $${values.length} AND school_id = $1)`);
    }
    const result = await pool.query(`
      SELECT st.id, st.school_id AS "schoolId", st.admission_no AS "admissionNo",
        st.first_name AS "firstName", st.last_name AS "lastName", st.middle_name AS "middleName",
        st.date_of_birth AS "dateOfBirth", st.photo AS "passportUrl", st.admission_date AS "admissionDate",
        LOWER(st.admission_status) AS "admissionStatus", st.address, st.previous_school AS "previousSchool",
        st.medical_info AS "medicalInformation", st.emergency_contact_name AS "emergencyContactName",
        st.emergency_contact_phone AS "emergencyContactPhone", st.gender,
        CASE WHEN st.status IN ('active','ACTIVE') THEN 'ACTIVE' ELSE UPPER(st.status) END AS status,
        st.class_name AS "className", st.section, st.parent_name AS "parentName",
        st.parent_phone AS "parentPhone", st.created_at AS "createdAt", st.updated_at AS "updatedAt", st.joined_at AS "joinedAt",
        CASE WHEN EXISTS (SELECT 1 FROM subscriptions sub WHERE sub.student_id = st.id AND LOWER(sub.status) = 'active')
          THEN 'active' ELSE 'unpaid' END AS "subscriptionStatus",
        COALESCE((SELECT nc.status FROM nfc_cards nc WHERE nc.student_id = st.id AND nc.status <> 'replaced' LIMIT 1), 'unassigned') AS "cardStatus"
      FROM students st WHERE ${conditions.join(" AND ")} ORDER BY st.last_name, st.first_name
    `, values);
    res.json(result.rows.map((row) => ({ ...row, joinedAt: dateString(row.joinedAt) })));
  } catch (error) {
    fail(req, res, error);
  }
});

router.post("/students", async (req, res) => {
  try {
    const schoolId = CreateStudentQueryParams.parse(req.query).schoolId;
    assertSchoolAccess(req, schoolId, ["SCHOOL_ADMIN"]);
    const body = CreateStudentBody.parse(req.body);
    const result = await pool.query(`
      INSERT INTO students (school_id, admission_no, first_name, last_name, middle_name, date_of_birth, photo,
        admission_date, admission_status, address, previous_school, medical_info, emergency_contact_name,
        emergency_contact_phone, gender, class_name, section, parent_name, parent_phone, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'ACTIVE')
      RETURNING id, school_id AS "schoolId", admission_no AS "admissionNo", first_name AS "firstName",
        last_name AS "lastName", gender, class_name AS "className", section, parent_name AS "parentName",
        parent_phone AS "parentPhone", status, joined_at AS "joinedAt"
    `, [schoolId, body.admissionNo, body.firstName, body.lastName, body.middleName ?? null, body.dateOfBirth ?? null,
      body.passportUrl ?? null, body.admissionDate ?? null, (body.admissionStatus ?? "admitted").toUpperCase(),
      body.address ?? null, body.previousSchool ?? null, body.medicalInformation ?? null, body.emergencyContactName ?? null,
      body.emergencyContactPhone ?? null, body.gender, body.className, body.section, body.parentName ?? null, body.parentPhone ?? null]);
    const row = result.rows[0];
    const student = { ...row, subscriptionStatus: "unpaid", cardStatus: "unassigned", joinedAt: dateString(row.joinedAt) };
    await audit(req, schoolId, "Created student", "Students", row.id, "info", "STUDENT_CREATED");
    res.status(201).json(student);
  } catch (error) {
    fail(req, res, error);
  }
});

router.get("/students/:studentId", async (req, res) => {
  try {
    const studentId = asNumber(req.params.studentId);
    const schoolId = tenantId(req, ["SCHOOL_ADMIN", "TEACHER", "ACCOUNTANT", "STAFF"]);
    const result = await pool.query(`
       SELECT st.id, st.school_id AS "schoolId", st.admission_no AS "admissionNo",
         st.first_name AS "firstName", st.last_name AS "lastName", st.middle_name AS "middleName",
         st.date_of_birth AS "dateOfBirth", st.photo AS "passportUrl", st.admission_date AS "admissionDate",
         LOWER(st.admission_status) AS "admissionStatus", st.address, st.previous_school AS "previousSchool",
         st.medical_info AS "medicalInformation", st.emergency_contact_name AS "emergencyContactName",
         st.emergency_contact_phone AS "emergencyContactPhone", st.gender,
         CASE WHEN st.status IN ('active','ACTIVE') THEN 'ACTIVE' ELSE UPPER(st.status) END AS status,
        st.class_name AS "className", st.section, st.parent_name AS "parentName",
         st.parent_phone AS "parentPhone", st.joined_at AS "joinedAt",
         CASE WHEN EXISTS (SELECT 1 FROM subscriptions sub WHERE sub.student_id = st.id AND LOWER(sub.status) = 'active')
          THEN 'active' ELSE 'unpaid' END AS "subscriptionStatus",
        COALESCE((SELECT nc.status FROM nfc_cards nc WHERE nc.student_id = st.id AND nc.status <> 'replaced' LIMIT 1), 'unassigned') AS "cardStatus"
      FROM students st WHERE st.id = $1 AND st.school_id = $2
    `, [studentId, schoolId]);
    if (!result.rows[0]) return res.status(404).json({ error: "Student not found" });
    res.json({ ...result.rows[0], joinedAt: dateString(result.rows[0].joinedAt) });
  } catch (error) {
    fail(req, res, error);
  }
});

router.patch("/students/:studentId", async (req, res) => {
  try {
    const params = UpdateStudentParams.parse(req.params);
    const query = UpdateStudentQueryParams.parse(req.query);
    assertSchoolAccess(req, query.schoolId, ["SCHOOL_ADMIN"]);
    const body = UpdateStudentBody.parse(req.body);
    const current = await pool.query(`SELECT * FROM students WHERE id = $1 AND school_id = $2`, [params.studentId, query.schoolId]);
    if (!current.rows[0]) return res.status(404).json({ error: "Student not found" });
    const next = {
      ...current.rows[0],
      first_name: body.firstName ?? current.rows[0].first_name,
      last_name: body.lastName ?? current.rows[0].last_name,
      class_name: body.className ?? current.rows[0].class_name,
      section: body.section ?? current.rows[0].section,
      status: body.status ?? current.rows[0].status,
    };
    const result = await pool.query(`
      UPDATE students SET first_name = $1, last_name = $2, class_name = $3, section = $4, status = $5
      WHERE id = $6 AND school_id = $7
      RETURNING id, school_id AS "schoolId", admission_no AS "admissionNo", first_name AS "firstName",
        last_name AS "lastName", gender, class_name AS "className", section, parent_name AS "parentName",
        parent_phone AS "parentPhone", status, joined_at AS "joinedAt"
    `, [next.first_name, next.last_name, next.class_name, next.section, next.status, params.studentId, query.schoolId]);
    const row = result.rows[0];
    await audit(req, query.schoolId, "Updated student", "Students", params.studentId, "info", "STUDENT_UPDATED");
    res.json({ ...row, subscriptionStatus: "unpaid", cardStatus: "unassigned", joinedAt: dateString(row.joinedAt) });
  } catch (error) {
    fail(req, res, error);
  }
});

router.patch("/students/:studentId/status", async (req, res) => {
  try {
    const params = UpdateStudentStatusParams.parse(req.params);
    const query = UpdateStudentStatusQueryParams.parse(req.query);
    const body = UpdateStudentStatusBody.parse(req.body);
    assertSchoolAccess(req, query.schoolId, ["SCHOOL_ADMIN"]);
    const result = await pool.query(
      `UPDATE students SET status = $1, updated_at = NOW()
       WHERE id = $2 AND school_id = $3
       RETURNING id, school_id AS "schoolId", admission_no AS "admissionNo", first_name AS "firstName",
       last_name AS "lastName", middle_name AS "middleName", date_of_birth AS "dateOfBirth",
       photo AS "passportUrl", admission_date AS "admissionDate", LOWER(admission_status) AS "admissionStatus",
       address, previous_school AS "previousSchool", medical_info AS "medicalInformation",
       emergency_contact_name AS "emergencyContactName", emergency_contact_phone AS "emergencyContactPhone",
       gender, class_name AS "className", section, parent_name AS "parentName", parent_phone AS "parentPhone",
       status, joined_at AS "joinedAt"`,
      [body.status, params.studentId, query.schoolId],
    );
    if (!result.rows[0]) { res.status(404).json({ error: "Student not found" }); return; }
    await audit(req, query.schoolId, `Changed student status to ${body.status}`, "Students", params.studentId, "info", "STUDENT_STATUS_CHANGED");
    res.json({ ...result.rows[0], subscriptionStatus: "unpaid", cardStatus: "unassigned", joinedAt: dateString(result.rows[0].joinedAt) });
  } catch (error) { fail(req, res, error); }
});

router.get("/parents", async (req, res) => {
  try {
    const query = ListParentsQueryParams.parse(req.query);
    assertSchoolAccess(req, query.schoolId, ["SCHOOL_ADMIN"]);
    const values: unknown[] = [query.schoolId];
    const condition = query.search
      ? `AND (p.name ILIKE $2 OR p.email ILIKE $2 OR p.phone ILIKE $2)`
      : "";
    if (query.search) values.push(`%${query.search}%`);
    const result = await pool.query(`
      SELECT p.id, p.school_id AS "schoolId", p.name, p.email, p.phone, p.address, p.status,
        NULL::text AS "relationshipType", NULL::text AS "clerkUserId",
        NULL::text AS "emergencyContactName", NULL::text AS "emergencyContactPhone",
        (SELECT COUNT(*)::int FROM students st WHERE st.school_id = p.school_id AND st.parent_name = p.name) AS "childrenCount",
         (SELECT COUNT(*)::int FROM students st WHERE st.school_id = p.school_id AND st.parent_name = p.name AND UPPER(st.status) = 'ACTIVE') AS "activeChildren"
      FROM parents p WHERE p.school_id = $1 ${condition} ORDER BY p.name
    `, values);
    res.json(result.rows);
  } catch (error) {
    fail(req, res, error);
  }
});

router.post("/parents", async (req, res) => {
  try {
    const schoolId = tenantId(req, ["SCHOOL_ADMIN"]);
    const body = CreateParentBody.parse(req.body);
    const result = await pool.query(`
      INSERT INTO parents (school_id, name, email, phone, address) VALUES ($1, $2, $3, $4, $5)
      RETURNING id, school_id AS "schoolId", name, email, phone, address, status
    `, [schoolId, body.name, body.email, body.phone, body.address ?? null]);
    const parent = { ...result.rows[0], relationshipType: body.relationshipType ?? null,
      clerkUserId: null, emergencyContactName: body.emergencyContactName ?? null,
      emergencyContactPhone: body.emergencyContactPhone ?? null, childrenCount: 0, activeChildren: 0 };
    await audit(req, schoolId, "Created parent", "Parents", result.rows[0].id, "info", "USER_CREATED");
    res.status(201).json(parent);
  } catch (error) {
    fail(req, res, error);
  }
});

router.get("/classes", async (req, res) => {
  try {
    const query = ListClassesQueryParams.parse(req.query);
    assertSchoolAccess(req, query.schoolId, ["SCHOOL_ADMIN", "TEACHER", "ACCOUNTANT", "STAFF"]);
    const result = await pool.query(`
      SELECT c.id, c.school_id AS "schoolId", c.name, c.section, c.class_teacher AS "classTeacher",
        c.capacity, (SELECT CASE WHEN EXISTS (SELECT 1 FROM student_class_assignments a
          WHERE a.school_id = c.school_id AND a.school_class_id = c.id AND a.is_current)
          THEN (SELECT COUNT(DISTINCT a.student_id)::int FROM student_class_assignments a
            WHERE a.school_id = c.school_id AND a.school_class_id = c.id AND a.section = c.section
              AND a.is_current AND UPPER(a.status) = 'ACTIVE')
          ELSE (SELECT COUNT(*)::int FROM students st WHERE st.school_id = c.school_id
            AND st.class_name = c.name AND st.section = c.section) END) AS "studentCount"
      FROM school_classes c WHERE c.school_id = $1 ORDER BY c.name, c.section
    `, [query.schoolId]);
    res.json(result.rows);
  } catch (error) {
    fail(req, res, error);
  }
});

router.post("/classes", async (req, res) => {
  try {
    const schoolId = tenantId(req, ["SCHOOL_ADMIN"]);
    const body = CreateClassBody.parse(req.body);
    const result = await pool.query(`
      INSERT INTO school_classes (school_id, name, section, class_teacher, capacity) VALUES ($1, $2, $3, $4, $5)
      RETURNING id, school_id AS "schoolId", name, section, class_teacher AS "classTeacher", capacity
    `, [schoolId, body.name, body.section, body.classTeacher ?? null, body.capacity]);
    await audit(req, schoolId, "Created class", "Classes", result.rows[0].id, "info", "CLASS_CREATED");
    res.status(201).json({ ...result.rows[0], studentCount: 0 });
  } catch (error) {
    fail(req, res, error);
  }
});

router.get("/subscriptions", async (req, res) => {
  try {
    const query = ListSubscriptionsQueryParams.parse(req.query);
    assertSchoolAccess(req, query.schoolId, ["SCHOOL_ADMIN", "ACCOUNTANT"]);
    const values: unknown[] = [query.schoolId];
    const condition = query.status && query.status !== "all" ? `AND sub.status = $2` : "";
    if (condition) values.push(query.status);
    const result = await pool.query(`
      SELECT sub.id, sub.school_id AS "schoolId", sub.student_id AS "studentId",
        st.first_name || ' ' || st.last_name AS "studentName",
        sub.amount::float, sub.school_share::float AS "schoolShare", sub.edupulse_share::float AS "edupulseShare",
        sub.status, sub.verification_status AS "verificationStatus", sub.provider, sub.term,
        sub.expires_at AS "expiresAt"
      FROM subscriptions sub JOIN students st ON st.id = sub.student_id AND st.school_id = sub.school_id
      WHERE sub.school_id = $1 ${condition} ORDER BY sub.created_at DESC
    `, values);
    res.json(result.rows.map((row) => ({ ...row, expiresAt: dateString(row.expiresAt) })));
  } catch (error) {
    fail(req, res, error);
  }
});

router.post("/subscriptions", async (req, res) => {
  try {
    const schoolId = tenantId(req, ["SCHOOL_ADMIN", "ACCOUNTANT"]);
    const body = CreateSubscriptionBody.parse(req.body);
    const student = await pool.query(`SELECT id, first_name || ' ' || last_name AS name FROM students WHERE id = $1 AND school_id = $2`, [body.studentId, schoolId]);
    if (!student.rows[0]) return res.status(404).json({ error: "Student not found in school" });
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 90);
    const result = await pool.query(`
      INSERT INTO subscriptions (school_id, student_id, term, provider, expires_at)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, school_id AS "schoolId", student_id AS "studentId", amount::float,
        school_share::float AS "schoolShare", edupulse_share::float AS "edupulseShare",
        status, verification_status AS "verificationStatus", provider, term, expires_at AS "expiresAt"
    `, [schoolId, body.studentId, body.term, body.provider ?? "test", expiresAt]);
    const row = result.rows[0];
    await audit(req, schoolId, "Created subscription", "Subscriptions", row.id, "info", "SUBSCRIPTION_CREATED");
    res.status(201).json({ ...row, studentName: student.rows[0].name, expiresAt: dateString(row.expiresAt) });
  } catch (error) {
    fail(req, res, error);
  }
});

router.post("/subscriptions/:subscriptionId/verify", async (req, res) => {
  try {
    const params = VerifySubscriptionParams.parse(req.params);
    const body = VerifySubscriptionBody.parse(req.body);
    const existing = await pool.query(
      `SELECT sub.*
       FROM subscriptions sub
       JOIN students st ON st.id = sub.student_id AND st.school_id = sub.school_id
       WHERE sub.id = $1`,
      [params.subscriptionId],
    );
    if (!existing.rows[0]) return res.status(404).json({ error: "Subscription not found" });
    assertSchoolAccess(req, existing.rows[0].school_id, ["SCHOOL_ADMIN", "ACCOUNTANT"]);
    if (existing.rows[0].verification_status === "verified") {
      throw new AuthError(409, "Subscription is already verified");
    }
    const result = await pool.query(`
      UPDATE subscriptions SET status = 'active', verification_status = 'verified', provider_reference = $1
      WHERE id = $2
      RETURNING id, school_id AS "schoolId", student_id AS "studentId", amount::float,
        school_share::float AS "schoolShare", edupulse_share::float AS "edupulseShare",
        status, verification_status AS "verificationStatus", provider, term, expires_at AS "expiresAt"
    `, [body.providerReference, params.subscriptionId]);
    await pool.query(`UPDATE nfc_cards SET status = 'active' WHERE student_id = $1 AND status IN ('locked', 'unassigned')`, [existing.rows[0].student_id]);
    await audit(req, existing.rows[0].school_id, "Verified subscription payment", "Subscriptions", params.subscriptionId, "info", "SUBSCRIPTION_VERIFIED");
    const student = await pool.query(`SELECT first_name || ' ' || last_name AS name FROM students WHERE id = $1`, [existing.rows[0].student_id]);
    res.json({ ...result.rows[0], studentName: student.rows[0]?.name ?? "Student", expiresAt: dateString(result.rows[0].expiresAt) });
  } catch (error) {
    fail(req, res, error);
  }
});

router.get("/cards", async (req, res) => {
  try {
    const query = ListCardsQueryParams.parse(req.query);
    assertSchoolAccess(req, query.schoolId, ["SCHOOL_ADMIN", "STAFF"]);
    const values: unknown[] = [query.schoolId];
    const condition = query.status && query.status !== "all" ? `AND nc.status = $2` : "";
    if (condition) values.push(query.status);
    const result = await pool.query(`
      SELECT nc.id, nc.school_id AS "schoolId", nc.uid, nc.student_id AS "studentId",
        CASE WHEN st.id IS NULL THEN NULL ELSE st.first_name || ' ' || st.last_name END AS "studentName",
        nc.status, nc.scans, nc.last_scan AS "lastScan"
      FROM nfc_cards nc LEFT JOIN students st ON st.id = nc.student_id
      WHERE nc.school_id = $1 ${condition} ORDER BY nc.id DESC
    `, values);
    res.json(result.rows.map((row) => ({ ...row, lastScan: dateString(row.lastScan) })));
  } catch (error) {
    fail(req, res, error);
  }
});

router.post("/cards", async (req, res) => {
  try {
    const schoolId = tenantId(req, ["SCHOOL_ADMIN", "STAFF"]);
    const body = RegisterCardBody.parse(req.body);
    RegisterCardQueryParams.parse(req.query);
    const studentId = body.studentId ?? null;
    if (studentId) {
      const student = await pool.query(`SELECT id FROM students WHERE id = $1 AND school_id = $2`, [studentId, schoolId]);
      if (!student.rows[0]) return res.status(404).json({ error: "Student not found in school" });
    }
    const status = studentId ? "locked" : "unassigned";
    const result = await pool.query(`
      INSERT INTO nfc_cards (school_id, uid, student_id, status) VALUES ($1, $2, $3, $4)
      RETURNING id, school_id AS "schoolId", uid, student_id AS "studentId", status, scans, last_scan AS "lastScan"
    `, [schoolId, body.uid, studentId, status]);
    await audit(req, schoolId, "Registered NFC card", "NFC Cards", result.rows[0].id, "info", "NFC_CARD_REGISTERED");
    res.status(201).json({ ...result.rows[0], studentName: null, lastScan: null });
  } catch (error) {
    fail(req, res, error);
  }
});

router.patch("/cards/:cardId/status", async (req, res) => {
  try {
    const cardId = asNumber(req.params.cardId);
    const body = UpdateCardStatusBody.parse(req.body);
    const card = await pool.query(
      `SELECT nc.school_id AS "schoolId"
       FROM nfc_cards nc
       LEFT JOIN students st ON st.id = nc.student_id
       WHERE nc.id = $1
         AND (nc.student_id IS NULL OR st.school_id = nc.school_id)`,
      [cardId],
    );
    if (!card.rows[0]) return res.status(404).json({ error: "Card not found" });
    assertSchoolAccess(req, card.rows[0].schoolId, ["SCHOOL_ADMIN", "STAFF"]);
    const result = await pool.query(`
      UPDATE nfc_cards SET status = $1 WHERE id = $2
      RETURNING id, school_id AS "schoolId", uid, student_id AS "studentId", status, scans, last_scan AS "lastScan"
    `, [body.status, cardId]);
    if (!result.rows[0]) return res.status(404).json({ error: "Card not found" });
    await audit(req, result.rows[0].schoolId, `Changed NFC status to ${body.status}`, "NFC Cards", cardId, "info", "NFC_STATUS_CHANGED");
    res.json({ ...result.rows[0], studentName: null, lastScan: dateString(result.rows[0].lastScan) });
  } catch (error) {
    fail(req, res, error);
  }
});

router.get("/audit-logs", async (req, res) => {
  try {
    const query = ListAuditLogsQueryParams.parse(req.query);
    if (query.schoolId) {
      assertSchoolAccess(req, query.schoolId, ["SCHOOL_ADMIN"]);
    } else {
      assertRoles(req, ["PLATFORM_OWNER"]);
    }
    const values: unknown[] = [];
    const conditions: string[] = [];
    if (query.schoolId) {
      values.push(query.schoolId);
      conditions.push(`a.school_id = $${values.length}`);
    }
    if (query.search) {
      values.push(`%${query.search}%`);
      conditions.push(`(a.action ILIKE $${values.length} OR a.module ILIKE $${values.length} OR a."user" ILIKE $${values.length})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await pool.query(`
      SELECT a.id, a."user", a.role, a.actor_user_id AS "actorUserId",
        a.clerk_user_id AS "clerkUserId", a.event_type AS "eventType",
        a.result, s.name AS school, a.action, a.module,
        a.record_id AS "recordId", a.timestamp, a.severity
      FROM audit_logs a LEFT JOIN schools s ON s.id = a.school_id ${where}
      ORDER BY a.timestamp DESC LIMIT 100
    `, values);
    res.json(result.rows.map(mapAudit));
  } catch (error) {
    fail(req, res, error);
  }
});

function mapAudit(row: Record<string, unknown>) {
  return { ...row, timestamp: dateString(row.timestamp as string) };
}

export default router;