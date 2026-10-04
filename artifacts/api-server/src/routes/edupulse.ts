import { Router, type IRouter, type Request, type Response as ExpressResponse } from "express";
import { generateSchoolCode } from "../lib/generated-person-codes";
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
} from "@workspace/api-zod";
import { pool } from "@workspace/db";
import { PaymentProviderError } from "../lib/fee-providers";
import { configuredTestAdapter } from "../lib/fee-providers/factory";
import {
  finalizeVerifiedStudentSubscriptionPayment,
  findStudentSubscriptionTermPaymentConflict,
  normalizeStudentSubscriptionTerm,
  studentSubscriptionAmountToMinor,
} from "../lib/student-subscription-billing";
import { canonicalSchoolLogoVersionUrl } from "../lib/schoolLogoStorage";
import { generateAdmissionNumber } from "./admission-number";
import { generateSchoolRegistrationNumber, registrationNumberChanged } from "../services/school-registration-number";
import {
  configuredStudentSubscriptionCheckoutBaseUrl,
  studentSubscriptionCheckoutReturnUrl,
} from "../lib/student-subscription-return-url";
import { z } from "zod/v4";
import {
  AuthError,
  assertRoles,
  assertSchoolAccess,
  assertSchoolOperationalAccess,
  getUserContext,
  isPlatformOwner,
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

// Cards created before the phase 5 lifecycle was introduced use lower-case
// `locked`/`unassigned` (and `active`). Keep those values readable while
// storing the expanded lifecycle in the same lower-case representation.
const cardStatuses = new Set([
  "active", "inactive", "lost", "blocked", "replaced", "expired", "suspended",
  "locked", "unassigned",
]);
const terminalCardStatuses = new Set(["replaced", "expired"]);

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

function assertCardControlAccess(req: Request, schoolId: number) {
  const context = getUserContext(req);
  if (isPlatformOwner(context)) return context;
  throw new AuthError(403, "Official NFC assignment and activation require Platform Owner permission", "ACCESS_DENIED");
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
  db: { query: (text: string, values?: unknown[]) => Promise<any> } = pool,
) {
  const context = getUserContext(req);
  const actor = [context.user.firstName, context.user.lastName]
    .filter(Boolean)
    .join(" ") || context.user.email;
  const role = context.roles.find((assignment) =>
    assignment.schoolId === null || assignment.schoolId === schoolId,
  )?.role ?? "AUTHENTICATED";
  await db.query(
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
          (SELECT CASE WHEN COUNT(*) = 0 THEN NULL::float
                 ELSE ROUND(100.0 * (
                   SELECT COUNT(DISTINCT e.student_id) FROM attendance_events e
                   WHERE e.school_id=$1 AND e.event_date=CURRENT_DATE AND e.event_type='SCHOOL_ENTRY'
                     AND e.attendance_status IN ('PRESENT','LATE')
                 ) / COUNT(*), 1)::float END
           FROM students st WHERE st.school_id=$1 AND UPPER(st.status)='ACTIVE') AS "attendanceRate",
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
    if (body.registrationNumber != null && body.registrationNumber !== "") {
      throw new AuthError(400, "School registration numbers are generated by the system");
    }
    const registrationNumber = generateSchoolRegistrationNumber();
    const code = body.code?.trim() || generateSchoolCode(body.name);
    const result = await pool.query(`
      INSERT INTO schools (code, name, city, state, registration_number, address, lga, phone, email, website, logo, school_type, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING id
    `, [code, body.name, body.city, body.state, registrationNumber, body.address ?? null,
      body.lga ?? null, body.phone ?? null, body.email ?? null, body.website ?? null, body.logoUrl ?? null,
      body.schoolType ?? null, body.status === "active" ? "pending" : body.status ?? "pending"]);
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
    if (body.code !== undefined && body.code !== current.rows[0].code) {
      throw new AuthError(409, "A school's code is permanent and cannot be changed");
    }
    if (registrationNumberChanged(body.registrationNumber, current.rows[0].registration_number)) {
      throw new AuthError(409, "A school's registration number is permanent and cannot be changed");
    }
    const next = { ...current.rows[0],
      ...Object.fromEntries(Object.entries(body).map(([key, value]) => [({
        registrationNumber: "registration_number", schoolType: "school_type", logoUrl: "logo",
      } as Record<string, string>)[key] ?? key, value])),
      registration_number: current.rows[0].registration_number,
      logo: body.logoUrl ?? current.rows[0].logo };
    const result = await pool.query(`
      UPDATE schools s SET code=$1,name=$2,city=$3,state=$4,registration_number=$5,address=$6,lga=$7,phone=$8,
        email=$9,website=$10,logo=$11,school_type=$12,status=$13,updated_at=NOW()
      WHERE s.id=$14 AND ($13 <> 'active' OR EXISTS (
        SELECT 1
        FROM school_memberships sm
        JOIN app_users au ON au.id = sm.user_id
        WHERE sm.school_id = s.id
          AND sm.role = 'SCHOOL_ADMIN'
          AND sm.status = 'ACTIVE'
          AND au.status = 'ACTIVE'
      ))
      RETURNING s.id
    `, [next.code,next.name,next.city,next.state,next.registration_number,next.address,next.lga,next.phone,
      next.email,next.website,next.logo,next.school_type,next.status,params.schoolId]);
    if (!result.rows[0]) {
      return res.status(409).json({
        error: "School cannot be activated until an active School Admin is linked",
      });
    }
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
    const result = await pool.query(`UPDATE schools s SET status = $1, updated_at = NOW()
      WHERE s.id = $2
        AND ($1 <> 'active' OR EXISTS (
          SELECT 1
          FROM school_memberships sm
          JOIN app_users au ON au.id = sm.user_id
          WHERE sm.school_id = s.id
            AND sm.role = 'SCHOOL_ADMIN'
            AND sm.status = 'ACTIVE'
            AND au.status = 'ACTIVE'
        ))
      RETURNING s.id`, [body.status, params.schoolId]);
    if (!result.rows[0]) {
      const school = await pool.query(`SELECT id FROM schools WHERE id = $1`, [params.schoolId]);
      if (!school.rows[0]) return res.status(404).json({ error: "School not found" });
      return res.status(409).json({
        error: "School cannot be activated until an active School Admin is linked",
      });
    }
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
      conditions.push(`(st.first_name ILIKE $${values.length} OR st.last_name ILIKE $${values.length} OR st.admission_no ILIKE $${values.length} OR concat_ws(' ',st.first_name,NULLIF(BTRIM(st.middle_name),''),st.last_name) ILIKE $${values.length})`);
    }
    if (query.classId) {
      // classId is a database class record; filtering by name keeps tenant scope explicit.
      values.push(query.classId);
      conditions.push(`st.class_name = (SELECT name FROM school_classes WHERE id = $${values.length} AND school_id = $1)`);
    }
    const context = getUserContext(req);
    const isOwner = context.roles.some((role) =>
      role.role === "PLATFORM_OWNER" && role.schoolId === null && role.status === "ACTIVE");
    const isSchoolAdmin = !isOwner && context.roles.some((role) =>
      role.role === "SCHOOL_ADMIN" && role.schoolId === query.schoolId && role.status === "ACTIVE");
    values.push(isSchoolAdmin);
    const adminParameter = `$${values.length}`;
    values.push(context.user.id);
    const actorParameter = `$${values.length}`;
    // General roster access is not a medical-record permission. Retain legacy
    // fields for explicitly authorized clinical users without exposing them to
    // ordinary teachers, accountants, staff, or platform owners.
    const medicalAllowed = `(${adminParameter}::boolean OR (
      NOT ${isOwner ? "TRUE" : "FALSE"} AND EXISTS (
        SELECT 1 FROM student_care_grants g
        JOIN app_users clinical_user ON clinical_user.id=g.user_id AND UPPER(clinical_user.status)='ACTIVE'
        WHERE g.school_id=st.school_id AND g.user_id=${actorParameter} AND g.active=TRUE
          AND 'MEDICAL_READ'=ANY(g.permissions)
          AND EXISTS (SELECT 1 FROM school_memberships membership
            WHERE membership.school_id=g.school_id AND membership.user_id=g.user_id
              AND UPPER(membership.status)='ACTIVE')
      )))`;
    const result = await pool.query(`
      SELECT st.id, st.school_id AS "schoolId", st.admission_no AS "admissionNo", st.email,
        (SELECT CASE WHEN au.clerk_user_id IS NULL THEN 'PENDING' ELSE au.status END FROM app_users au WHERE au.id=st.user_id) AS "accountStatus",
        st.first_name AS "firstName", st.last_name AS "lastName", st.middle_name AS "middleName",
        st.date_of_birth AS "dateOfBirth", st.photo AS "passportUrl", st.admission_date AS "admissionDate",
        LOWER(st.admission_status) AS "admissionStatus", st.address, st.previous_school AS "previousSchool",
        CASE WHEN ${medicalAllowed} THEN st.medical_info ELSE NULL END AS "medicalInformation",
        CASE WHEN ${medicalAllowed} THEN st.emergency_contact_name ELSE NULL END AS "emergencyContactName",
        CASE WHEN ${medicalAllowed} THEN st.emergency_contact_phone ELSE NULL END AS "emergencyContactPhone", st.gender,
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

router.get("/school-users/activation-candidates", async (req, res) => {
  try {
    const schoolId = Number(req.query.schoolId);
    const role = String(req.query.role ?? "").toUpperCase();
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    if (!Number.isSafeInteger(schoolId) || schoolId < 1) throw new AuthError(400, "A valid school is required");
    if (!["SCHOOL_ADMIN", "TEACHER", "ACCOUNTANT", "STAFF", "DRIVER", "PARENT", "STUDENT"].includes(role)) {
      throw new AuthError(400, "Choose a supported school role");
    }
    assertSchoolAccess(req, schoolId, ["SCHOOL_ADMIN"]);
    let result;
    if (role === "PARENT") {
      result = await pool.query(
        `SELECT p.id AS "personId",'PARENT' AS "personType",p.name AS "fullName",p.email,
                p.email AS "profileEmail",au.email AS "accountEmail",p.phone,
                p.status AS "profileStatus",au.status AS "accountStatus",au.id AS "accountId",
                p.user_id AS "linkedUserId"
           FROM parents p LEFT JOIN app_users au ON au.id=p.user_id
          WHERE p.school_id=$1 AND ($2='' OR p.name ILIKE '%'||$2||'%' OR p.email ILIKE '%'||$2||'%')
          ORDER BY p.name,p.id`,
        [schoolId, search],
      );
    } else if (role === "STUDENT") {
      result = await pool.query(
        `SELECT st.id AS "personId",'STUDENT' AS "personType",
                concat_ws(' ',st.first_name,st.middle_name,st.last_name) AS "fullName",
                 COALESCE(st.email,au.email) AS email,st.email AS "profileEmail",au.email AS "accountEmail",
                 st.status AS "profileStatus",au.status AS "accountStatus",au.id AS "accountId",
                st.user_id AS "linkedUserId",st.admission_no AS "admissionNo"
           FROM students st LEFT JOIN app_users au ON au.id=st.user_id
          WHERE st.school_id=$1 AND ($2='' OR st.first_name ILIKE '%'||$2||'%' OR
            st.last_name ILIKE '%'||$2||'%' OR st.admission_no ILIKE '%'||$2||'%')
          ORDER BY st.last_name,st.first_name,st.id`,
        [schoolId, search],
      );
    } else if (role === "SCHOOL_ADMIN") {
      result = await pool.query(
        `SELECT au.id AS "personId",'ACCOUNT' AS "personType",
                 concat_ws(' ',au.first_name,au.last_name) AS "fullName",au.email,
                 au.email AS "profileEmail",au.email AS "accountEmail",
                NULL::text AS phone,au.status AS "profileStatus",au.status AS "accountStatus",
                au.id AS "accountId",au.id AS "linkedUserId"
           FROM school_memberships sm JOIN app_users au ON au.id=sm.user_id
          WHERE sm.school_id=$1 AND sm.status='ACTIVE' AND au.status='ACTIVE'
            AND ($2='' OR au.first_name ILIKE '%'||$2||'%' OR au.last_name ILIKE '%'||$2||'%' OR au.email ILIKE '%'||$2||'%')
          GROUP BY au.id ORDER BY au.last_name,au.first_name,au.id`,
        [schoolId, search],
      );
    } else {
      result = await pool.query(
        `SELECT e.id AS "personId",e.employee_type AS "personType",
                 concat_ws(' ',e.first_name,e.middle_name,e.last_name) AS "fullName",e.email,
                 e.email AS "profileEmail",au.email AS "accountEmail",e.phone,
                e.employment_status AS "profileStatus",au.status AS "accountStatus",au.id AS "accountId",
                e.user_id AS "linkedUserId",e.employee_no AS "employeeNo"
           FROM employees e LEFT JOIN app_users au ON au.id=e.user_id
          WHERE e.school_id=$1 AND e.employee_type=$2
            AND ($3='' OR e.first_name ILIKE '%'||$3||'%' OR e.last_name ILIKE '%'||$3||'%' OR
              e.employee_no ILIKE '%'||$3||'%' OR e.email ILIKE '%'||$3||'%')
          ORDER BY e.last_name,e.first_name,e.id`,
        [schoolId, role, search],
      );
    }
    res.json(result.rows);
  } catch (error) {
    fail(req, res, error);
  }
});

router.post("/students", async (req, res) => {
  try {
    const schoolId = CreateStudentQueryParams.parse(req.query).schoolId;
    assertSchoolOperationalAccess(req, schoolId, ["SCHOOL_ADMIN"]);
    const rawBody = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    const suppliedAdmissionNo = typeof rawBody.admissionNo === "string" ? rawBody.admissionNo.trim() : "";
    const body = CreateStudentBody.parse({ ...rawBody, admissionNo: suppliedAdmissionNo || "AUTO-GENERATED" });
    const client = await pool.connect();
    let result;
    let admissionNo = suppliedAdmissionNo;
    try {
      await client.query("BEGIN");
      await client.query(`SELECT id FROM schools WHERE id=$1 FOR UPDATE`, [schoolId]);
      if (!admissionNo) admissionNo = await generateAdmissionNumber(client, schoolId);
      result = await client.query(`
      INSERT INTO students (school_id, admission_no, email, first_name, last_name, middle_name, date_of_birth, photo,
        admission_date, admission_status, address, previous_school, medical_info, emergency_contact_name,
        emergency_contact_phone, gender, class_name, section, parent_name, parent_phone, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,'ACTIVE')
      RETURNING id, school_id AS "schoolId", admission_no AS "admissionNo", email, first_name AS "firstName",
        last_name AS "lastName", gender, class_name AS "className", section, parent_name AS "parentName",
        parent_phone AS "parentPhone", status, joined_at AS "joinedAt"
      `, [schoolId, admissionNo, typeof rawBody.email === "string" && rawBody.email.trim() ? z.string().email().max(254).parse(rawBody.email.trim()) : null,
        body.firstName, body.lastName, body.middleName ?? null, body.dateOfBirth ?? null,
        body.passportUrl ?? null, body.admissionDate ?? null, (body.admissionStatus ?? "admitted").toUpperCase(),
        body.address ?? null, body.previousSchool ?? null, body.medicalInformation ?? null, body.emergencyContactName ?? null,
        body.emergencyContactPhone ?? null, body.gender, body.className, body.section, body.parentName ?? null, body.parentPhone ?? null]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const row = result!.rows[0];
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
       SELECT st.id, st.school_id AS "schoolId", st.admission_no AS "admissionNo", st.email,
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
    assertSchoolOperationalAccess(req, query.schoolId, ["SCHOOL_ADMIN"]);
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

router.patch("/students/:studentId/contact", async (req, res) => {
  try {
    const params = UpdateStudentParams.parse(req.params);
    const query = UpdateStudentQueryParams.parse(req.query);
    assertSchoolOperationalAccess(req, query.schoolId, ["SCHOOL_ADMIN"]);
    const rawEmail = req.body?.email;
    const email = rawEmail === null || rawEmail === "" ? null : z.string().email().max(254).parse(rawEmail);
    const updated = await pool.query(
      `UPDATE students SET email=$1,updated_at=NOW()
        WHERE id=$2 AND school_id=$3
        RETURNING id,school_id AS "schoolId",email`,
      [email, params.studentId, query.schoolId],
    );
    if (!updated.rows[0]) throw new AuthError(404, "Student not found");
    await audit(req, query.schoolId, "Corrected student activation contact", "Students", params.studentId, "info", "STUDENT_EMAIL_CORRECTED");
    res.json(updated.rows[0]);
  } catch (error) {
    fail(req, res, error);
  }
});

router.patch("/students/:studentId/status", async (req, res) => {
  try {
    const params = UpdateStudentStatusParams.parse(req.params);
    const query = UpdateStudentStatusQueryParams.parse(req.query);
    const body = UpdateStudentStatusBody.parse(req.body);
    assertSchoolOperationalAccess(req, query.schoolId, ["SCHOOL_ADMIN"]);
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
        p.default_relationship_type AS "relationshipType", au.clerk_user_id AS "clerkUserId",
        p.emergency_contact_name AS "emergencyContactName", p.emergency_contact_phone AS "emergencyContactPhone",
        (SELECT COUNT(*)::int FROM parent_student_relationships psr WHERE psr.parent_id=p.id) AS "childrenCount",
        (SELECT COUNT(*)::int FROM parent_student_relationships psr JOIN students st
           ON st.id=psr.student_id AND st.school_id=p.school_id
          WHERE psr.parent_id=p.id AND psr.status='ACTIVE' AND UPPER(st.status)='ACTIVE') AS "activeChildren",
        au.status AS "accountStatus"
      FROM parents p LEFT JOIN app_users au ON au.id=p.user_id
      WHERE p.school_id = $1 ${condition} ORDER BY p.name
    `, values);
    res.json(result.rows);
  } catch (error) {
    fail(req, res, error);
  }
});

router.get("/parents/:parentId/children", async (req, res) => {
  try {
    const schoolId = asNumber(req.query.schoolId);
    const parentId = asNumber(req.params.parentId);
    if (!Number.isSafeInteger(schoolId) || schoolId < 1 || !Number.isSafeInteger(parentId) || parentId < 1) {
      throw new AuthError(400, "A valid school and parent are required");
    }
    assertSchoolAccess(req, schoolId, ["SCHOOL_ADMIN"]);
    const parent = await pool.query(
      `SELECT id FROM parents WHERE id=$1 AND school_id=$2`,
      [parentId, schoolId],
    );
    if (!parent.rows[0]) throw new AuthError(404, "Parent not found");
    const children = await pool.query(
      `SELECT st.id,st.school_id AS "schoolId",st.admission_no AS "admissionNo",
              st.first_name AS "firstName",st.last_name AS "lastName",st.class_name AS "className",
              st.section,st.status AS "studentStatus",psr.relationship_type AS "relationshipType",
              psr.status AS "relationshipStatus"
         FROM parent_student_relationships psr
         JOIN students st ON st.id=psr.student_id AND st.school_id=$2
        WHERE psr.parent_id=$1 ORDER BY st.last_name,st.first_name,st.id`,
      [parentId, schoolId],
    );
    res.json(children.rows);
  } catch (error) {
    fail(req, res, error);
  }
});

router.post("/parents/:parentId/children", async (req, res) => {
  const schoolId = Number(req.query.schoolId);
  const parentId = Number(req.params.parentId);
  const studentIds: unknown = req.body?.studentIds;
  const requestedRelationshipType = req.body?.relationshipType;
  try {
    if (!Number.isSafeInteger(schoolId) || schoolId < 1 || !Number.isSafeInteger(parentId) || parentId < 1) {
      throw new AuthError(400, "A valid school and parent are required");
    }
    assertSchoolOperationalAccess(req, schoolId, ["SCHOOL_ADMIN"]);
    if (!Array.isArray(studentIds) || !studentIds.length || studentIds.length > 100 ||
        studentIds.some((value) => !Number.isSafeInteger(value) || Number(value) < 1) ||
        new Set(studentIds).size !== studentIds.length) {
      throw new AuthError(400, "Select one or more distinct student profiles");
    }
    if (requestedRelationshipType !== undefined &&
        !["Father", "Mother", "Guardian", "Grandparent", "Other"].includes(requestedRelationshipType)) {
      throw new AuthError(400, "Choose a supported relationship type");
    }
    const client = await pool.connect();
    let children;
    try {
      await client.query("BEGIN");
      const parent = await client.query(
        `SELECT p.id,p.user_id,p.status AS "parentStatus",au.status AS "accountStatus",
           p.default_relationship_type AS "defaultRelationshipType"
           FROM parents p LEFT JOIN app_users au ON au.id=p.user_id
          WHERE p.id=$1 AND p.school_id=$2 FOR UPDATE OF p`,
        [parentId, schoolId],
      );
      if (!parent.rows[0]) throw new AuthError(404, "Parent not found");
      const relationshipType = requestedRelationshipType ??
        parent.rows[0].defaultRelationshipType ?? "Guardian";
      if (!["Father", "Mother", "Guardian", "Grandparent", "Other"].includes(relationshipType)) {
        throw new AuthError(400, "Choose a supported relationship type");
      }
      const parentStatus = String(parent.rows[0].parentStatus).toUpperCase();
      if (!["ACTIVE", "PENDING"].includes(parentStatus)) {
        throw new AuthError(409, "Only an active or pending parent profile can receive school-authorized children");
      }
      if (parent.rows[0].user_id && String(parent.rows[0].accountStatus).toUpperCase() !== "ACTIVE") {
        throw new AuthError(409, "An inactive parent account cannot receive additional children");
      }
      const found = await client.query(
        `SELECT id FROM students WHERE school_id=$1 AND id=ANY($2::int[]) AND upper(status)='ACTIVE'`,
        [schoolId, studentIds],
      );
      if (found.rows.length !== studentIds.length) throw new AuthError(404, "One or more students are not available in this school");
      for (const studentId of studentIds as number[]) {
        await client.query(
          `INSERT INTO parent_student_relationships(parent_id,student_id,relationship_type,status)
           VALUES($1,$2,$3,'ACTIVE')
           ON CONFLICT(parent_id,student_id) DO UPDATE
             SET relationship_type=EXCLUDED.relationship_type,status='ACTIVE'`,
          [parentId, studentId, relationshipType],
        );
      }
      await audit(
        req, schoolId, "Linked students to parent profile", "Parents", parentId,
        "info", "PARENT_CHILDREN_LINKED", "SUCCESS", { studentIds }, client,
      );
      children = await client.query(
        `SELECT st.id,st.school_id AS "schoolId",st.admission_no AS "admissionNo",
                st.first_name AS "firstName",st.last_name AS "lastName",st.class_name AS "className",
                st.section,st.status AS "studentStatus",psr.relationship_type AS "relationshipType",
                psr.status AS "relationshipStatus"
           FROM parent_student_relationships psr
           JOIN students st ON st.id=psr.student_id AND st.school_id=$2
          WHERE psr.parent_id=$1 ORDER BY st.last_name,st.first_name,st.id`,
        [parentId, schoolId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    res.json(children!.rows);
  } catch (error) {
    fail(req, res, error);
  }
});

router.post("/parents", async (req, res) => {
  try {
    const schoolId = tenantId(req, ["SCHOOL_ADMIN"]);
    assertSchoolOperationalAccess(req, schoolId, ["SCHOOL_ADMIN"]);
    const body = CreateParentBody.parse(req.body);
    const result = await pool.query(`
      INSERT INTO parents (school_id, name, email, phone, address,
        default_relationship_type, emergency_contact_name, emergency_contact_phone)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, school_id AS "schoolId", name, email, phone, address, status,
        default_relationship_type AS "relationshipType",
        emergency_contact_name AS "emergencyContactName", emergency_contact_phone AS "emergencyContactPhone"
    `, [schoolId, body.name, body.email, body.phone, body.address ?? null,
      body.relationshipType ?? null, body.emergencyContactName ?? null, body.emergencyContactPhone ?? null]);
    const parent = { ...result.rows[0],
      clerkUserId: null, childrenCount: 0, activeChildren: 0 };
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
    assertSchoolOperationalAccess(req, schoolId, ["SCHOOL_ADMIN"]);
    const body = CreateClassBody.parse(req.body);
    if (/^SS\s*[123]$/i.test(body.name) && !["Science", "Commercial", "Art"].includes(body.section)) {
      throw new AuthError(400, "Senior Secondary classes require Science, Commercial or Art stream");
    }
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

const studentSubscriptionVerificationInput = z.object({
  paymentReference: z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/),
  providerTransactionId: z.string().min(1).max(16).regex(/^[0-9]+$/),
}).strict();

function subscriptionPaymentId(raw: string | undefined, name: string): number {
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id < 1) throw new AuthError(400, `A valid ${name} is required`);
  return id;
}

function subscriptionPaymentDto(row: any) {
  return {
    paymentId: Number(row.paymentId),
    subscriptionId: Number(row.subscriptionId),
    schoolId: Number(row.schoolId),
    studentId: Number(row.studentId),
    sessionId: Number(row.sessionId),
    termId: Number(row.termId),
    payerUserId: Number(row.payerUserId),
    provider: row.provider,
    providerMode: row.providerMode,
    reference: row.reference,
    status: row.status,
    grossAmountMinor: Number(row.grossAmountMinor),
    providerFeeMinor: row.providerFeeMinor == null ? null : Number(row.providerFeeMinor),
    settlementAmountMinor: row.settlementAmountMinor == null ? null : Number(row.settlementAmountMinor),
    currency: row.currency,
    settlementStatus: row.settlementStatus,
    reconciliationStatus: row.reconciliationStatus,
    checkoutUrl: row.checkoutUrl ?? null,
    failureCode: row.failureCode ?? null,
    createdAt: dateString(row.createdAt),
    paidAt: dateString(row.paidAt),
  };
}

function cloneImmutableReceipt(value: any): any {
  if (Array.isArray(value)) return value.map(cloneImmutableReceipt);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneImmutableReceipt(child)]),
    );
  }
  return value;
}

function schoolVisibleFinancialSnapshot(value: any): any {
  if (Array.isArray(value)) {
    return value
      .filter((item) => !item || typeof item !== "object"
        || !("recipientType" in item) || item.recipientType === "SCHOOL")
      .map(schoolVisibleFinancialSnapshot);
  }
  if (!value || typeof value !== "object") return value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (/(platform|edupulse|partner|commission|attribution)/i.test(key)) continue;
    sanitized[key] = schoolVisibleFinancialSnapshot(child);
  }
  return sanitized;
}

async function readStudentSubscriptionPaymentResponse(
  subscriptionId: number,
  paymentId: number,
  schoolId: number,
  isPlatformOwner: boolean,
) {
  const paymentResult = await pool.query(
    `SELECT p.id AS "paymentId",p.subscription_id AS "subscriptionId",
            p.school_id AS "schoolId",p.student_id AS "studentId",
            p.academic_session_id AS "sessionId",p.academic_term_id AS "termId",
            p.payer_user_id AS "payerUserId",p.provider,p.provider_mode AS "providerMode",
            p.reference,p.status,p.gross_amount_minor AS "grossAmountMinor",
            p.provider_fee_minor AS "providerFeeMinor",
            p.settlement_amount_minor AS "settlementAmountMinor",p.currency,
            p.settlement_status AS "settlementStatus",
            p.reconciliation_status AS "reconciliationStatus",p.checkout_url AS "checkoutUrl",
            p.failure_code AS "failureCode",p.receipt_snapshot AS "receiptSnapshot",
            p.created_at AS "createdAt",p.paid_at AS "paidAt"
       FROM student_subscription_payments p
      WHERE p.id=$1 AND p.subscription_id=$2 AND p.school_id=$3`,
    [paymentId, subscriptionId, schoolId],
  );
  const payment = paymentResult.rows[0];
  if (!payment) throw new AuthError(404, "Student subscription payment not found");
  const [subscriptionResult, allocationsResult] = await Promise.all([
    pool.query(
      `SELECT s.id,s.school_id AS "schoolId",s.student_id AS "studentId",s.amount::float,
              s.school_share::float AS "schoolShare",s.edupulse_share::float AS "edupulseShare",
              s.partner_share::float AS "partnerShare",s.status,
              s.verification_status AS "verificationStatus",s.provider,s.provider_reference AS "providerReference",
              s.term,s.expires_at AS "expiresAt",s.allocation_snapshot AS "allocationSnapshot"
         FROM subscriptions s
        WHERE s.id=$1 AND s.school_id=$2`,
      [subscriptionId, schoolId],
    ),
    pool.query(
      `SELECT recipient_type AS "recipientType",recipient_id AS "recipientId",
              entry_type AS "entryType",amount_minor AS "amountMinor",currency
         FROM student_subscription_allocations
        WHERE payment_id=$1
         ${isPlatformOwner ? "" : "AND recipient_type='SCHOOL'"}
        ORDER BY id`,
      [paymentId],
    ),
  ]);
  const responseSubscription = subscriptionResult.rows[0] ?? null;
  const receiptSnapshot = cloneImmutableReceipt(payment.receiptSnapshot ?? null);
  const responseAllocations = allocationsResult.rows
    .filter((allocation: any) => isPlatformOwner || allocation.recipientType === "SCHOOL")
    .map((allocation: any) => ({
      recipientType: allocation.recipientType,
      recipientId: allocation.recipientId == null ? null : Number(allocation.recipientId),
      entryType: allocation.entryType,
      amountMinor: Number(allocation.amountMinor),
      currency: allocation.currency,
    }));
  const responsePayment = subscriptionPaymentDto(payment);
  if (!isPlatformOwner) {
    responsePayment.providerFeeMinor = null;
    responsePayment.settlementAmountMinor = null;
  }
  return {
    payment: responsePayment,
    receipt: isPlatformOwner ? receiptSnapshot : schoolVisibleFinancialSnapshot(receiptSnapshot),
    subscription: isPlatformOwner || responseSubscription === null
      ? responseSubscription
      : schoolVisibleFinancialSnapshot(responseSubscription),
    allocations: responseAllocations,
    activated: payment.status === "PAID",
  };
}

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
        sub.expires_at AS "expiresAt",latest.id AS "lastPaymentId",
        latest.status AS "lastPaymentStatus",latest.reference AS "lastPaymentReference"
      FROM subscriptions sub JOIN students st ON st.id = sub.student_id AND st.school_id = sub.school_id
      LEFT JOIN LATERAL (
        SELECT p.id,p.status,p.reference
          FROM student_subscription_payments p
         WHERE p.subscription_id=sub.id AND p.school_id=sub.school_id
         ORDER BY p.created_at DESC,p.id DESC
         LIMIT 1
      ) latest ON TRUE
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
    assertSchoolOperationalAccess(req, schoolId, ["SCHOOL_ADMIN", "ACCOUNTANT"]);
    const body = CreateSubscriptionBody.parse(req.body);
    const termName = normalizeStudentSubscriptionTerm(body.term);
    const student = await pool.query(
      `SELECT id, status, first_name || ' ' || last_name AS name
         FROM students WHERE id = $1 AND school_id = $2`,
      [body.studentId, schoolId],
    );
    if (!student.rows[0]) return res.status(404).json({ error: "Student not found in school" });
    if (String(student.rows[0].status).toUpperCase() !== "ACTIVE") {
      throw new AuthError(409, "Only active students can receive a current-term subscription");
    }
    const currentTerm = await pool.query(
      `SELECT t.end_date AS "endDate"
         FROM academic_terms t
         JOIN academic_sessions ses ON ses.id=t.academic_session_id AND ses.school_id=t.school_id
        WHERE t.school_id=$1 AND t.name=$2
          AND t.is_current=true AND UPPER(t.status)='ACTIVE'
          AND ses.is_current=true AND UPPER(ses.status)='ACTIVE'
          AND t.start_date<=CURRENT_DATE AND t.end_date>=CURRENT_DATE
        LIMIT 1`,
      [schoolId, termName],
    );
    if (!currentTerm.rows[0]) {
      throw new AuthError(409, "Student subscriptions can only be created for the active current academic term");
    }
    const expiresAt = new Date(`${String(currentTerm.rows[0].endDate).slice(0, 10)}T00:00:00.000Z`);
    expiresAt.setUTCDate(expiresAt.getUTCDate() + 1);
    const result = await pool.query(`
      INSERT INTO subscriptions (school_id, student_id, term, provider, expires_at)
      VALUES ($1, $2, $3, 'FLUTTERWAVE', $4)
      RETURNING id, school_id AS "schoolId", student_id AS "studentId", amount::float,
        school_share::float AS "schoolShare", edupulse_share::float AS "edupulseShare",
        status, verification_status AS "verificationStatus", provider, term, expires_at AS "expiresAt"
    `, [schoolId, body.studentId, termName, expiresAt]);
    const row = result.rows[0];
    await audit(req, schoolId, "Created subscription", "Subscriptions", row.id, "info", "SUBSCRIPTION_CREATED");
    res.status(201).json({ ...row, studentName: student.rows[0].name, expiresAt: dateString(row.expiresAt) });
  } catch (error) {
    fail(req, res, error);
  }
});

router.post("/subscriptions/:subscriptionId/checkout", async (req, res) => {
  try {
    const subscriptionId = subscriptionPaymentId(req.params.subscriptionId, "subscriptionId");
    const idempotencyKey = req.get("Idempotency-Key") ?? "";
    if (!/^[A-Za-z0-9._:-]{8,120}$/.test(idempotencyKey)) {
      throw new AuthError(400, "A valid Idempotency-Key header is required");
    }
    let adapter: ReturnType<typeof configuredTestAdapter> | null;
    try {
      adapter = configuredTestAdapter("FLUTTERWAVE");
    } catch (error) {
      if (error instanceof PaymentProviderError) {
        throw new AuthError(503, "Flutterwave test checkout is unavailable", "PROVIDER_UNAVAILABLE");
      }
      throw error;
    }
    if (!adapter || !configuredStudentSubscriptionCheckoutBaseUrl() || adapter.provider !== "flutterwave") {
      throw new AuthError(503, "Flutterwave test checkout is unavailable", "PROVIDER_UNAVAILABLE");
    }
    const context = getUserContext(req);
    if (!context.user.email) throw new AuthError(409, "The authenticated payer must have a verified email address");

    const client = await pool.connect();
    let payment: any;
    let reused = false;
    try {
      await client.query("BEGIN");
      const subscriptionResult = await client.query(
        `SELECT sub.id,sub.school_id AS "schoolId",sub.student_id AS "studentId",
                sub.amount,sub.status,sub.verification_status AS "verificationStatus",
                sub.provider_reference AS "providerReference",sub.term,st.status AS "studentStatus"
           FROM subscriptions sub
           JOIN students st ON st.id=sub.student_id AND st.school_id=sub.school_id
          WHERE sub.id=$1
          FOR UPDATE OF sub,st`,
        [subscriptionId],
      );
      const subscription = subscriptionResult.rows[0];
      if (!subscription) throw new AuthError(404, "Student subscription not found");
      assertSchoolOperationalAccess(req, subscription.schoolId, ["SCHOOL_ADMIN", "ACCOUNTANT"]);

      const previous = await client.query(
        `SELECT id AS "paymentId",subscription_id AS "subscriptionId",school_id AS "schoolId",
                student_id AS "studentId",academic_session_id AS "sessionId",
                academic_term_id AS "termId",payer_user_id AS "payerUserId",
                provider,provider_mode AS "providerMode",reference,status,
                gross_amount_minor AS "grossAmountMinor",provider_fee_minor AS "providerFeeMinor",
                settlement_amount_minor AS "settlementAmountMinor",currency,
                settlement_status AS "settlementStatus",reconciliation_status AS "reconciliationStatus",
                checkout_url AS "checkoutUrl",failure_code AS "failureCode",
                created_at AS "createdAt",paid_at AS "paidAt"
           FROM student_subscription_payments
          WHERE subscription_id=$1 AND idempotency_key=$2
          FOR UPDATE`,
        [subscriptionId, idempotencyKey],
      );
      if (previous.rows[0]) {
        payment = previous.rows[0];
        reused = true;
        await client.query("COMMIT");
      } else {
        if (String(subscription.studentStatus).toUpperCase() !== "ACTIVE") {
          throw new AuthError(409, "Only active students can receive a current-term subscription");
        }
        if (String(subscription.verificationStatus).toLowerCase() === "verified"
            || String(subscription.status).toLowerCase() === "active"
            || subscription.providerReference) {
          throw new AuthError(409, "A verified or legacy student subscription cannot be charged again");
        }
        if (studentSubscriptionAmountToMinor(subscription.amount) !== 500_000) {
          throw new AuthError(409, "Student subscriptions must use the fixed NGN 5,000 amount");
        }
        const termResult = await client.query(
          `SELECT t.id AS "termId",t.academic_session_id AS "sessionId",t.end_date AS "endDate"
             FROM academic_terms t
             JOIN academic_sessions ses ON ses.id=t.academic_session_id AND ses.school_id=t.school_id
            WHERE t.school_id=$1 AND t.name=$2
              AND t.is_current=true AND UPPER(t.status)='ACTIVE'
              AND ses.is_current=true AND UPPER(ses.status)='ACTIVE'
              AND t.start_date<=CURRENT_DATE AND t.end_date>=CURRENT_DATE
            LIMIT 1
            FOR SHARE OF t,ses`,
          [subscription.schoolId, normalizeStudentSubscriptionTerm(subscription.term)],
        );
        const currentTerm = termResult.rows[0];
        if (!currentTerm) {
          throw new AuthError(409, "Student subscriptions can only be charged in the active current academic term");
        }
        const existingTermPayment = await findStudentSubscriptionTermPaymentConflict(client, {
          schoolId: Number(subscription.schoolId),
          studentId: Number(subscription.studentId),
          sessionId: Number(currentTerm.sessionId),
          termId: Number(currentTerm.termId),
        });
        if (existingTermPayment) {
          throw new AuthError(
            409,
            "An existing payment for this student and current academic term must be completed or reconciled before checkout",
            "STUDENT_TERM_PAYMENT_ALREADY_EXISTS",
          );
        }
        const reference = adapter.generateReference();
        const inserted = await client.query(
          `INSERT INTO student_subscription_payments (
             subscription_id,school_id,student_id,academic_session_id,academic_term_id,
             payer_user_id,provider,provider_mode,reference,idempotency_key,gross_amount_minor,currency
           ) VALUES ($1,$2,$3,$4,$5,$6,'FLUTTERWAVE','SANDBOX',$7,$8,500000,'NGN')
           RETURNING id AS "paymentId",subscription_id AS "subscriptionId",school_id AS "schoolId",
             student_id AS "studentId",academic_session_id AS "sessionId",academic_term_id AS "termId",
             payer_user_id AS "payerUserId",provider,provider_mode AS "providerMode",reference,status,
             gross_amount_minor AS "grossAmountMinor",provider_fee_minor AS "providerFeeMinor",
             settlement_amount_minor AS "settlementAmountMinor",currency,
             settlement_status AS "settlementStatus",reconciliation_status AS "reconciliationStatus",
             checkout_url AS "checkoutUrl",failure_code AS "failureCode",
             created_at AS "createdAt",paid_at AS "paidAt"`,
          [
            subscriptionId,
            subscription.schoolId,
            subscription.studentId,
            currentTerm.sessionId,
            currentTerm.termId,
            context.user.id,
            reference,
            idempotencyKey,
          ],
        );
        payment = inserted.rows[0];
        await client.query("COMMIT");
      }
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    if (reused) {
      const status = payment.status === "RECONCILIATION_REQUIRED" || !payment.checkoutUrl ? 202 : 200;
      return res.status(status).json({ payment: subscriptionPaymentDto(payment), reused: true });
    }
    let checkout: { reference: string; checkoutUrl: string };
    try {
      const returnUrl = studentSubscriptionCheckoutReturnUrl(
        Number(payment.subscriptionId),
        Number(payment.paymentId),
        String(payment.reference),
      );
      if (!returnUrl) throw new PaymentProviderError("Student subscription return URL is not configured");
      checkout = await adapter.initializePayment({
        reference: payment.reference,
        amountMinor: Number(payment.grossAmountMinor),
        currency: String(payment.currency),
        email: context.user.email,
        returnUrl,
      });
      if (checkout.reference !== payment.reference) {
        throw new PaymentProviderError("Flutterwave checkout returned a mismatched payment reference");
      }
    } catch {
      const failed = await pool.query(
        `UPDATE student_subscription_payments
            SET status='RECONCILIATION_REQUIRED',reconciliation_status='RECONCILIATION_REQUIRED',
                failure_code='CHECKOUT_INITIALIZATION_OUTCOME_UNKNOWN',updated_at=NOW()
          WHERE id=$1
          RETURNING id AS "paymentId",subscription_id AS "subscriptionId",school_id AS "schoolId",
            student_id AS "studentId",academic_session_id AS "sessionId",academic_term_id AS "termId",
            payer_user_id AS "payerUserId",provider,provider_mode AS "providerMode",reference,status,
            gross_amount_minor AS "grossAmountMinor",provider_fee_minor AS "providerFeeMinor",
            settlement_amount_minor AS "settlementAmountMinor",currency,
            settlement_status AS "settlementStatus",reconciliation_status AS "reconciliationStatus",
            checkout_url AS "checkoutUrl",failure_code AS "failureCode",
            created_at AS "createdAt",paid_at AS "paidAt"`,
        [payment.paymentId],
      );
      return res.status(202).json({ payment: subscriptionPaymentDto(failed.rows[0] ?? payment), reused: false });
    }
    const persisted = await pool.query(
      `UPDATE student_subscription_payments
          SET checkout_url=$1,updated_at=NOW()
        WHERE id=$2 AND status='PENDING'
        RETURNING id AS "paymentId",subscription_id AS "subscriptionId",school_id AS "schoolId",
          student_id AS "studentId",academic_session_id AS "sessionId",academic_term_id AS "termId",
          payer_user_id AS "payerUserId",provider,provider_mode AS "providerMode",reference,status,
          gross_amount_minor AS "grossAmountMinor",provider_fee_minor AS "providerFeeMinor",
          settlement_amount_minor AS "settlementAmountMinor",currency,
          settlement_status AS "settlementStatus",reconciliation_status AS "reconciliationStatus",
          checkout_url AS "checkoutUrl",failure_code AS "failureCode",
          created_at AS "createdAt",paid_at AS "paidAt"`,
      [checkout.checkoutUrl, payment.paymentId],
    );
    if (!persisted.rows[0]) {
      throw new AuthError(409, "Student checkout changed state while Flutterwave was initializing");
    }
    res.status(201).json({ payment: subscriptionPaymentDto(persisted.rows[0]), reused: false });
  } catch (error) {
    fail(req, res, error);
  }
});

router.post("/subscriptions/:subscriptionId/verify", async (req, res) => {
  try {
    const subscriptionId = subscriptionPaymentId(req.params.subscriptionId, "subscriptionId");
    const input = studentSubscriptionVerificationInput.parse(req.body);
    const paymentResult = await pool.query(
      `SELECT p.id AS "paymentId",p.school_id AS "schoolId",p.reference,p.status,
              p.gross_amount_minor AS "grossAmountMinor",p.currency,p.provider,p.provider_mode AS "providerMode"
         FROM student_subscription_payments p
         JOIN subscriptions s ON s.id=p.subscription_id AND s.school_id=p.school_id
        WHERE p.subscription_id=$1 AND p.reference=$2`,
      [subscriptionId, input.paymentReference],
    );
    const payment = paymentResult.rows[0];
    if (!payment) throw new AuthError(404, "Persisted student subscription checkout not found");
    assertSchoolOperationalAccess(req, payment.schoolId, ["SCHOOL_ADMIN", "ACCOUNTANT"]);
    const viewAllAllocations = isPlatformOwner(getUserContext(req));
    if (payment.status === "PAID") {
      const result = await readStudentSubscriptionPaymentResponse(
        subscriptionId,
        payment.paymentId,
        payment.schoolId,
        viewAllAllocations,
      );
      return res.json(result);
    }
    if (payment.provider !== "FLUTTERWAVE" || payment.providerMode !== "SANDBOX") {
      throw new AuthError(409, "Student payment was not initialized using the Flutterwave sandbox adapter");
    }
    let adapter: ReturnType<typeof configuredTestAdapter> | null;
    try {
      adapter = configuredTestAdapter("FLUTTERWAVE");
    } catch (error) {
      if (error instanceof PaymentProviderError) {
        throw new AuthError(503, "Flutterwave payment verification is unavailable", "PROVIDER_UNAVAILABLE");
      }
      throw error;
    }
    if (!adapter || adapter.provider !== "flutterwave") {
      throw new AuthError(503, "Flutterwave payment verification is unavailable", "PROVIDER_UNAVAILABLE");
    }
    let verified;
    try {
      verified = await adapter.verifyPayment({
        reference: input.paymentReference,
        providerTransactionId: input.providerTransactionId,
        amountMinor: Number(payment.grossAmountMinor),
        currency: String(payment.currency),
      });
    } catch {
      await pool.query(
        `UPDATE student_subscription_payments AS p
            SET status=CASE WHEN p.status='FAILED' AND EXISTS (
                  SELECT 1 FROM student_subscription_payments other
                   WHERE other.school_id=p.school_id AND other.student_id=p.student_id
                     AND other.academic_session_id=p.academic_session_id
                     AND other.academic_term_id=p.academic_term_id AND other.id<>p.id
                     AND (other.status IN ('PENDING','RECONCILIATION_REQUIRED','PAID')
                       OR other.reconciliation_status='RECONCILIATION_REQUIRED')
                ) THEN p.status ELSE 'RECONCILIATION_REQUIRED' END,
                reconciliation_status=CASE WHEN p.status='FAILED' AND EXISTS (
                  SELECT 1 FROM student_subscription_payments other
                   WHERE other.school_id=p.school_id AND other.student_id=p.student_id
                     AND other.academic_session_id=p.academic_session_id
                     AND other.academic_term_id=p.academic_term_id AND other.id<>p.id
                     AND (other.status IN ('PENDING','RECONCILIATION_REQUIRED','PAID')
                       OR other.reconciliation_status='RECONCILIATION_REQUIRED')
                ) THEN p.reconciliation_status ELSE 'RECONCILIATION_REQUIRED' END,
                failure_code='PROVIDER_VERIFICATION_UNCERTAIN',updated_at=NOW()
          WHERE p.id=$1 AND p.status<>'PAID'`,
        [payment.paymentId],
      );
      const result = await readStudentSubscriptionPaymentResponse(
        subscriptionId,
        payment.paymentId,
        payment.schoolId,
        viewAllAllocations,
      );
      return res.status(202).json(result);
    }
    const finalized = await finalizeVerifiedStudentSubscriptionPayment(
      pool,
      Number(payment.paymentId),
      verified,
      canonicalSchoolLogoVersionUrl,
    );
    const result = await readStudentSubscriptionPaymentResponse(
      subscriptionId,
      payment.paymentId,
      payment.schoolId,
      viewAllAllocations,
    );
    res.status(
      finalized.reconciliationRequired || finalized.status === "PENDING" ? 202 : 200,
    ).json(result);
  } catch (error) {
    fail(req, res, error);
  }
});

router.get("/subscriptions/:subscriptionId/payments/:paymentId", async (req, res) => {
  try {
    const subscriptionId = subscriptionPaymentId(req.params.subscriptionId, "subscriptionId");
    const paymentId = subscriptionPaymentId(req.params.paymentId, "paymentId");
    const subscription = await pool.query(
      `SELECT school_id AS "schoolId" FROM subscriptions WHERE id=$1`,
      [subscriptionId],
    );
    if (!subscription.rows[0]) throw new AuthError(404, "Student subscription not found");
    const context = assertSchoolAccess(req, subscription.rows[0].schoolId, ["SCHOOL_ADMIN", "ACCOUNTANT"]);
    res.json(await readStudentSubscriptionPaymentResponse(
      subscriptionId,
      paymentId,
      Number(subscription.rows[0].schoolId),
      isPlatformOwner(context),
    ));
  } catch (error) {
    fail(req, res, error);
  }
});

router.get("/cards", async (req, res) => {
  try {
    const query = ListCardsQueryParams.parse(req.query);
    assertSchoolAccess(req, query.schoolId, ["SCHOOL_ADMIN"]);
    const values: unknown[] = [query.schoolId];
    const condition = query.status && query.status !== "all" ? `AND nc.status = $2` : "";
    if (condition) values.push(query.status);
    const result = await pool.query(`
      SELECT nc.id, nc.school_id AS "schoolId", nc.uid, nc.student_id AS "studentId",
        CASE WHEN st.id IS NULL THEN NULL ELSE st.first_name || ' ' || st.last_name END AS "studentName",
        employee."employeeId", employee."employeeName", employee."personType",
        nc.status, nc.scans, nc.last_scan AS "lastScan"
      FROM nfc_cards nc
      LEFT JOIN students st ON st.id = nc.student_id
      LEFT JOIN LATERAL (
        SELECT e.id AS "employeeId",
               trim(concat_ws(' ',e.first_name,e.middle_name,e.last_name)) AS "employeeName",
               CASE WHEN UPPER(e.employee_type)='TEACHER' THEN 'TEACHER' ELSE 'STAFF' END AS "personType"
          FROM employee_nfc_card_bindings b
          JOIN employees e ON e.id=b.employee_id AND e.school_id=b.school_id
         WHERE b.nfc_card_id=nc.id AND b.school_id=nc.school_id
           AND nc.student_id IS NULL
           AND UPPER(e.employee_type) IN ('TEACHER','STAFF')
           AND b.status IN ('ASSIGNED','ACTIVE','LOCKED')
         ORDER BY CASE WHEN b.status IN ('ASSIGNED','ACTIVE','LOCKED') THEN 0 ELSE 1 END,b.id DESC
         LIMIT 1
      ) employee ON TRUE
      WHERE nc.school_id = $1 ${condition} ORDER BY nc.id DESC
    `, values);
    res.json(result.rows.map((row) => ({ ...row, lastScan: dateString(row.lastScan) })));
  } catch (error) {
    fail(req, res, error);
  }
});

router.post("/cards", async (req, res) => {
  const client = await pool.connect();
  try {
    const schoolId = tenantId(req, ["SCHOOL_ADMIN", "STAFF"]);
    const context = assertCardControlAccess(req, schoolId);
    if (!isPlatformOwner(context)) {
      throw new AuthError(403, "Only the Platform Owner may provision physical NFC cards; school users can assign prepared cards");
    }
    const body = RegisterCardBody.parse(req.body);
    RegisterCardQueryParams.parse(req.query);
    const studentId = body.studentId ?? null;
    await client.query("BEGIN");
    // UID is a physical-card identity, not a school-scoped identity. Lock
    // matching rows so two simultaneous registrations cannot claim it.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext(LOWER($1)))`, [body.uid]);
    const duplicate = await client.query(
      `SELECT id FROM nfc_cards WHERE LOWER(uid) = LOWER($1) FOR UPDATE`,
      [body.uid],
    );
    if (duplicate.rows[0]) {
      throw new AuthError(409, "NFC card UID is already registered");
    }
    if (studentId) {
      const student = await client.query(`SELECT id FROM students WHERE id = $1 AND school_id = $2`, [studentId, schoolId]);
      if (!student.rows[0]) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Student not found in school" });
        return;
      }
    }
    const status = studentId ? "locked" : "unassigned";
    const result = await client.query(`
      INSERT INTO nfc_cards (school_id, uid, student_id, status, issued_at)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING id, school_id AS "schoolId", uid, student_id AS "studentId", status, scans, last_scan AS "lastScan"
    `, [schoolId, body.uid, studentId, status]);
    await client.query(
      `INSERT INTO nfc_card_history
       (school_id, nfc_card_id, student_id, action, previous_status, new_status, actor_user_id)
       VALUES ($1, $2, $3, 'REGISTERED', NULL, $4, $5)`,
      [schoolId, result.rows[0].id, studentId, status, getUserContext(req).user.id],
    );
    await audit(req, schoolId, "Registered NFC card", "NFC Cards", result.rows[0].id, "info", "NFC_CARD_REGISTERED", "SUCCESS", null, client);
    await client.query("COMMIT");
    res.status(201).json({ ...result.rows[0], studentName: null, lastScan: null });
  } catch (error) {
    await client.query("ROLLBACK");
    fail(req, res, error);
  } finally {
    client.release();
  }
});

router.patch("/cards/:cardId/status", async (req, res) => {
  const client = await pool.connect();
  try {
    const cardId = asNumber(req.params.cardId);
    const rawStatus = req.body?.status;
    if (typeof rawStatus !== "string") {
      throw new AuthError(400, "A valid card status is required");
    }
    const status = rawStatus.toLowerCase();
    if (!cardStatuses.has(status)) {
      throw new AuthError(400, "Invalid NFC card status");
    }
    await client.query("BEGIN");
    const card = await client.query(
      `SELECT nc.school_id AS "schoolId",employee."bindingId" AS "employeeBindingId"
             , nc.status AS "status", nc.student_id AS "studentId"
       FROM nfc_cards nc
       LEFT JOIN students st ON st.id = nc.student_id
        LEFT JOIN LATERAL (
          SELECT b.id AS "bindingId"
            FROM employee_nfc_card_bindings b
           WHERE b.nfc_card_id=nc.id AND b.school_id=nc.school_id
           ORDER BY CASE WHEN b.status IN ('ASSIGNED','ACTIVE','LOCKED') THEN 0 ELSE 1 END,b.id DESC
           LIMIT 1
        ) employee ON TRUE
       WHERE nc.id = $1
          AND (nc.student_id IS NULL OR st.school_id = nc.school_id)
       FOR UPDATE OF nc`,
      [cardId],
    );
    if (!card.rows[0]) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Card not found" });
      return;
    }
    assertCardControlAccess(req, card.rows[0].schoolId);
    if (card.rows[0].employeeBindingId != null) {
      throw new AuthError(409, "Employee-bound cards must be managed through employee NFC controls");
    }
    const previousStatus = String(card.rows[0].status).toLowerCase();
    if (terminalCardStatuses.has(previousStatus) && status !== previousStatus) {
      throw new AuthError(409, `A ${previousStatus} card cannot change status`);
    }
    if (status === "active" && card.rows[0].studentId !== null) {
      const student = await client.query(
        `SELECT id FROM students WHERE id = $1 AND school_id = $2 FOR UPDATE`,
        [card.rows[0].studentId, card.rows[0].schoolId],
      );
      if (!student.rows[0]) throw new AuthError(404, "Student not found in card's school");
      const activeCard = await client.query(
        `SELECT id FROM nfc_cards
         WHERE school_id = $1 AND student_id = $2 AND lower(status) = 'active' AND id <> $3
         LIMIT 1`,
        [card.rows[0].schoolId, card.rows[0].studentId, cardId],
      );
      if (activeCard.rows[0]) throw new AuthError(409, "Student already has an active NFC card");
    }
    const result = await client.query(`
      UPDATE nfc_cards
      SET status = $1,
          activated_at = CASE WHEN $1 = 'active' AND activated_at IS NULL THEN NOW() ELSE activated_at END,
          deactivated_at = CASE WHEN $1 IN ('inactive','lost','blocked','replaced','expired','suspended') THEN COALESCE(deactivated_at, NOW()) ELSE deactivated_at END,
          replaced_at = CASE WHEN $1 = 'replaced' THEN COALESCE(replaced_at, NOW()) ELSE replaced_at END
      WHERE id = $2
      RETURNING id, school_id AS "schoolId", uid, student_id AS "studentId", status, scans, last_scan AS "lastScan"
    `, [status, cardId]);
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      res.status(404).json({ error: "Card not found" });
      return;
    }
    await client.query(
      `INSERT INTO nfc_card_history
       (school_id, nfc_card_id, student_id, action, previous_status, new_status, actor_user_id)
       VALUES ($1, $2, $3, 'STATUS_CHANGED', $4, $5, $6)`,
      [result.rows[0].schoolId, cardId, result.rows[0].studentId, previousStatus, status, getUserContext(req).user.id],
    );
    await audit(req, result.rows[0].schoolId, `Changed NFC status to ${status}`, "NFC Cards", cardId, "info", "NFC_STATUS_CHANGED", "SUCCESS", {
      previousStatus,
      newStatus: status,
    }, client);
    await client.query("COMMIT");
    res.json({ ...result.rows[0], studentName: null, lastScan: dateString(result.rows[0].lastScan) });
  } catch (error) {
    await client.query("ROLLBACK");
    fail(req, res, error);
  } finally {
    client.release();
  }
});

router.patch("/cards/:cardId/reassign", async (req, res) => {
  const client = await pool.connect();
  try {
    const cardId = asNumber(req.params.cardId);
    const studentId = req.body?.studentId;
    if (!Number.isInteger(cardId) || cardId < 1 ||
        !Number.isInteger(studentId) || studentId < 1) {
      throw new AuthError(400, "A valid cardId and studentId are required");
    }

    await client.query("BEGIN");
    const card = await client.query(
      `SELECT nc.id, nc.school_id AS "schoolId", nc.uid, nc.student_id AS "studentId",
              nc.status, nc.scans, nc.last_scan AS "lastScan",
              employee."bindingId" AS "employeeBindingId"
       FROM nfc_cards nc
       LEFT JOIN students st ON st.id = nc.student_id
       LEFT JOIN LATERAL (
         SELECT b.id AS "bindingId"
           FROM employee_nfc_card_bindings b
          WHERE b.nfc_card_id=nc.id AND b.school_id=nc.school_id
          ORDER BY CASE WHEN b.status IN ('ASSIGNED','ACTIVE','LOCKED') THEN 0 ELSE 1 END,b.id DESC
          LIMIT 1
       ) employee ON TRUE
       WHERE nc.id = $1 AND (nc.student_id IS NULL OR st.school_id = nc.school_id)
       FOR UPDATE OF nc`,
      [cardId],
    );
    if (!card.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Card not found" });
    }
    assertCardControlAccess(req, card.rows[0].schoolId);
    if (card.rows[0].employeeBindingId != null) {
      throw new AuthError(409, "Employee-bound cards cannot be reassigned to students");
    }

    const currentStatus = String(card.rows[0].status).toLowerCase();
    if (!cardStatuses.has(currentStatus) || terminalCardStatuses.has(currentStatus)) {
      throw new AuthError(409, "This NFC card is not eligible for reassignment");
    }

    const student = await client.query(
      `SELECT id, school_id AS "schoolId", first_name AS "firstName", last_name AS "lastName"
       FROM students WHERE id = $1 AND school_id = $2 FOR UPDATE`,
      [studentId, card.rows[0].schoolId],
    );
    if (!student.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Student not found in card's school" });
    }
    if (Number(card.rows[0].studentId) === studentId) {
      throw new AuthError(409, "This card is already assigned to that student");
    }

    const duplicate = await client.query(
      `SELECT id FROM nfc_cards
       WHERE school_id = $1 AND student_id = $2 AND status = 'active' AND id <> $3
       FOR UPDATE`,
      [card.rows[0].schoolId, studentId, cardId],
    );
    if (duplicate.rows[0]) {
      throw new AuthError(409, "Student already has an active NFC card");
    }

    const updated = await client.query(
      `UPDATE nfc_cards SET student_id = $1
       WHERE id = $2 AND school_id = $3
       RETURNING id, school_id AS "schoolId", uid, student_id AS "studentId",
         status, scans, last_scan AS "lastScan"`,
      [studentId, cardId, card.rows[0].schoolId],
    );
    if (!updated.rows[0]) {
      throw new AuthError(404, "Card not found");
    }

    const previousStudentId = card.rows[0].studentId ?? null;
    await client.query(
      `INSERT INTO nfc_card_history
       (school_id, nfc_card_id, student_id, action, previous_status, new_status, reason, actor_user_id)
       VALUES ($1, $2, $3, 'REASSIGNED_FROM', $4, $4, $5, $6),
              ($1, $2, $7, 'REASSIGNED_TO', $4, $4, $5, $6)`,
      [
        card.rows[0].schoolId,
        cardId,
        previousStudentId,
        currentStatus,
        `Card reassigned from student ${previousStudentId ?? "unassigned"} to student ${studentId}`,
        getUserContext(req).user.id,
        studentId,
      ],
    );
    await audit(
      req,
      card.rows[0].schoolId,
      "Reassigned NFC card",
      "NFC Cards",
      cardId,
      "info",
      "NFC_CARD_REASSIGNED",
      "SUCCESS",
      { previousStudentId, studentId },
      client,
    );
    await client.query("COMMIT");
    res.json({
      ...updated.rows[0],
      studentName: `${student.rows[0].firstName} ${student.rows[0].lastName}`,
      lastScan: dateString(updated.rows[0].lastScan),
    });
  } catch (error) {
    await client.query("ROLLBACK");
    fail(req, res, error);
  } finally {
    client.release();
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