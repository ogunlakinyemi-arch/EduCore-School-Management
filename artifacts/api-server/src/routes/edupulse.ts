import { Router, type IRouter, type Request, type Response as ExpressResponse } from "express";
import {
  CreateClassBody,
  CreateParentBody,
  CreateSchoolBody,
  CreateStudentBody,
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
  UpdateStudentBody,
  UpdateStudentParams,
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
          (SELECT COUNT(*)::int FROM students WHERE status = 'active') AS "totalStudents",
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
          0::int AS "staffCount",
          CASE WHEN EXISTS (SELECT 1 FROM subscriptions WHERE school_id = s.id AND status = 'active')
            THEN 'active' ELSE 'attention' END AS "subscriptionStatus"
        FROM schools s WHERE s.id = $1
      `, [schoolId]),
      pool.query(`
        SELECT
          (SELECT COUNT(*)::int FROM students WHERE school_id = $1) AS "totalStudents",
          (SELECT COUNT(*)::int FROM students WHERE school_id = $1 AND status = 'active') AS "activeStudents",
          (SELECT COUNT(*)::int FROM students st WHERE school_id = $1 AND NOT EXISTS (
            SELECT 1 FROM subscriptions sub WHERE sub.student_id = st.id AND sub.status = 'active'
          )) AS "unpaidStudents",
          94.2::float AS "attendanceRate",
          (SELECT COUNT(*)::int FROM subscriptions WHERE school_id = $1 AND status = 'pending') AS "pendingPayments",
          (SELECT COUNT(*)::int FROM nfc_cards WHERE school_id = $1 AND status = 'active') AS "activeCards",
          (SELECT COUNT(*)::int FROM nfc_cards WHERE school_id = $1 AND status = 'locked') AS "lockedCards"
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
    assertRoles(req, ["PLATFORM_OWNER"]);
    const query = ListSchoolsQueryParams.parse(req.query);
    const values: unknown[] = [];
    const conditions: string[] = [];
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
      SELECT s.id, s.code, s.name, s.city, s.state, s.status, s.created_at AS "createdAt",
        (SELECT COUNT(*)::int FROM students WHERE school_id = s.id) AS "studentCount",
        0::int AS "staffCount",
        CASE WHEN EXISTS (SELECT 1 FROM subscriptions WHERE school_id = s.id AND status = 'active')
          THEN 'active' ELSE 'attention' END AS "subscriptionStatus"
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
    const code = `EDU-${Date.now().toString(36).slice(-6).toUpperCase()}`;
    const result = await pool.query(`
      INSERT INTO schools (code, name, city, state, status)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, code, name, city, state, status, created_at AS "createdAt"
    `, [code, body.name, body.city, body.state, body.status ?? "active"]);
    await audit(req, null, "Created school", "Schools", result.rows[0].id, "info", "SCHOOL_CREATED");
    res.status(201).json({ ...result.rows[0], studentCount: 0, staffCount: 0, subscriptionStatus: "attention" });
  } catch (error) {
    fail(req, res, error);
  }
});

router.get("/schools/:schoolId", async (req, res) => {
  try {
    const id = asNumber(req.params.schoolId);
    assertSchoolAccess(req, id, ["SCHOOL_ADMIN"]);
    const result = await pool.query(`
      SELECT s.id, s.code, s.name, s.city, s.state, s.status, s.created_at AS "createdAt",
        (SELECT COUNT(*)::int FROM students WHERE school_id = s.id) AS "studentCount",
        0::int AS "staffCount",
        CASE WHEN EXISTS (SELECT 1 FROM subscriptions WHERE school_id = s.id AND status = 'active')
          THEN 'active' ELSE 'attention' END AS "subscriptionStatus"
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
    const next = { ...current.rows[0], ...body };
    const result = await pool.query(`
      UPDATE schools SET name = $1, city = $2, state = $3, status = $4 WHERE id = $5
      RETURNING id, code, name, city, state, status, created_at AS "createdAt"
    `, [next.name, next.city, next.state, next.status, params.schoolId]);
    await audit(req, params.schoolId, "Updated school", "Schools", params.schoolId, "info", "SCHOOL_UPDATED");
    res.json({ ...result.rows[0], studentCount: 0, staffCount: 0, subscriptionStatus: "attention" });
  } catch (error) {
    fail(req, res, error);
  }
});

router.get("/students", async (req, res) => {
  try {
    const query = ListStudentsQueryParams.parse(req.query);
    assertSchoolAccess(req, query.schoolId, ["SCHOOL_ADMIN", "TEACHER", "ACCOUNTANT", "STAFF"]);
    const values: unknown[] = [query.schoolId];
    const conditions = ["st.school_id = $1"];
    if (query.status && query.status !== "all") {
      values.push(query.status);
      conditions.push(`st.status = $${values.length}`);
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
        st.first_name AS "firstName", st.last_name AS "lastName", st.gender,
        st.class_name AS "className", st.section, st.parent_name AS "parentName",
        st.parent_phone AS "parentPhone", st.status, st.joined_at AS "joinedAt",
        CASE WHEN EXISTS (SELECT 1 FROM subscriptions sub WHERE sub.student_id = st.id AND sub.status = 'active')
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
    const schoolId = tenantId(req, ["SCHOOL_ADMIN"]);
    const body = CreateStudentBody.parse(req.body);
    const result = await pool.query(`
      INSERT INTO students (school_id, admission_no, first_name, last_name, gender, class_name, section, parent_name, parent_phone)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id, school_id AS "schoolId", admission_no AS "admissionNo", first_name AS "firstName",
        last_name AS "lastName", gender, class_name AS "className", section, parent_name AS "parentName",
        parent_phone AS "parentPhone", status, joined_at AS "joinedAt"
    `, [schoolId, body.admissionNo, body.firstName, body.lastName, body.gender, body.className, body.section, body.parentName ?? null, body.parentPhone ?? null]);
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
        st.first_name AS "firstName", st.last_name AS "lastName", st.gender,
        st.class_name AS "className", st.section, st.parent_name AS "parentName",
        st.parent_phone AS "parentPhone", st.status, st.joined_at AS "joinedAt",
        CASE WHEN EXISTS (SELECT 1 FROM subscriptions sub WHERE sub.student_id = st.id AND sub.status = 'active')
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
    res.json({ ...row, subscriptionStatus: "unpaid", cardStatus: "unassigned", joinedAt: dateString(row.joinedAt) });
  } catch (error) {
    fail(req, res, error);
  }
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
      SELECT p.id, p.school_id AS "schoolId", p.name, p.email, p.phone,
        (SELECT COUNT(*)::int FROM students st WHERE st.school_id = p.school_id AND st.parent_name = p.name) AS "childrenCount",
        (SELECT COUNT(*)::int FROM students st WHERE st.school_id = p.school_id AND st.parent_name = p.name AND st.status = 'active') AS "activeChildren"
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
      INSERT INTO parents (school_id, name, email, phone) VALUES ($1, $2, $3, $4)
      RETURNING id, school_id AS "schoolId", name, email, phone
    `, [schoolId, body.name, body.email, body.phone]);
    const parent = { ...result.rows[0], childrenCount: 0, activeChildren: 0 };
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
        c.capacity, (SELECT COUNT(*)::int FROM students st WHERE st.school_id = c.school_id AND st.class_name = c.name AND st.section = c.section) AS "studentCount"
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
    res.status(201).json({ ...row, studentName: student.rows[0].name, expiresAt: dateString(row.expiresAt) });
  } catch (error) {
    fail(req, res, error);
  }
});

router.post("/subscriptions/:subscriptionId/verify", async (req, res) => {
  try {
    const params = VerifySubscriptionParams.parse(req.params);
    const body = VerifySubscriptionBody.parse(req.body);
    const existing = await pool.query(`SELECT * FROM subscriptions WHERE id = $1`, [params.subscriptionId]);
    if (!existing.rows[0]) return res.status(404).json({ error: "Subscription not found" });
    assertSchoolAccess(req, existing.rows[0].school_id, ["SCHOOL_ADMIN", "ACCOUNTANT"]);
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
    const card = await pool.query(`SELECT school_id AS "schoolId" FROM nfc_cards WHERE id = $1`, [cardId]);
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