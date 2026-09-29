import { Router, type IRouter, type NextFunction, type Request } from "express";
import {
  CreateEmployeeBody,
  CreateEmployeeQueryParams,
  CreateEmployeeResponse,
  GetEmployeeParams,
  GetEmployeeQueryParams,
  GetEmployeeResponse,
  GetParentParams,
  GetParentQueryParams,
  GetParentResponse,
  GetStudentSelfProfileResponse,
  ListEmployeesQueryParams,
  ListEmployeesResponse,
  UpdateEmployeeBody,
  UpdateEmployeeParams,
  UpdateEmployeeQueryParams,
  UpdateEmployeeResponse,
  UpdateEmployeeStatusBody,
  UpdateEmployeeStatusParams,
  UpdateEmployeeStatusQueryParams,
  UpdateEmployeeStatusResponse,
  UpdateParentBody,
  UpdateParentParams,
  UpdateParentQueryParams,
  UpdateParentResponse,
} from "@workspace/api-zod";
import { pool } from "@workspace/db";
import {
  AuthError,
  assertRoles,
  assertSchoolAccess,
  assertSchoolOperationalAccess,
  getUserContext,
  handleAuthError,
  requireAuthentication,
} from "../middlewares/auth";

const router: IRouter = Router();
router.use(requireAuthentication());

const asyncRoute =
  (handler: (req: Request, res: any) => Promise<void>) =>
  (req: Request, res: any, next: NextFunction) =>
    handler(req, res).catch((error) => handleAuthError(error, req, res, next));

const employeeSelect = `
  e.id, e.school_id AS "schoolId", e.employee_no AS "employeeId",
  e.first_name AS "firstName", e.middle_name AS "middleName", e.last_name AS "lastName",
  e.employee_type AS "type", e.phone, e.email, e.address, e.photo AS "photoUrl",
  e.gender, e.employment_status AS "status", e.date_employed AS "dateEmployed",
  e.department, e.qualification, e.user_id AS "userId"`;
const employeeReturning = `
  id, school_id AS "schoolId", employee_no AS "employeeId",
  first_name AS "firstName", middle_name AS "middleName", last_name AS "lastName",
  employee_type AS "type", phone, email, address, photo AS "photoUrl",
  gender, employment_status AS "status", date_employed AS "dateEmployed",
  department, qualification, user_id AS "userId"`;

function isManager(req: Request, schoolId: number) {
  return getUserContext(req).roles.some(
    (assignment) =>
      assignment.status === "ACTIVE" &&
      ((assignment.role === "PLATFORM_OWNER" && assignment.schoolId === null) ||
        (assignment.role === "SCHOOL_ADMIN" && assignment.schoolId === schoolId)),
  );
}

async function audit(req: Request, schoolId: number, action: string, eventType: string, recordId: number) {
  const context = getUserContext(req);
  const actor = [context.user.firstName, context.user.lastName].filter(Boolean).join(" ") || context.user.email;
  const role = context.roles.find((assignment) => assignment.schoolId === schoolId)?.role ??
    context.roles.find((assignment) => assignment.schoolId === null)?.role ?? "AUTHENTICATED";
  await pool.query(
    `INSERT INTO audit_logs
      ("user", role, actor_user_id, clerk_user_id, school_id, action, module, record_id,
       severity, event_type, result)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'info', $9, 'SUCCESS')`,
    [actor, role, context.user.id, context.user.clerkUserId, schoolId, action, "People", recordId, eventType],
  );
}

async function employee(req: Request, id: number) {
  const result = await pool.query(`SELECT ${employeeSelect} FROM employees e WHERE e.id = $1`, [id]);
  if (!result.rows[0]) throw new AuthError(404, "Employee not found");
  return result.rows[0];
}

router.get("/employees", asyncRoute(async (req, res) => {
  const query = ListEmployeesQueryParams.parse(req.query);
  assertSchoolAccess(req, query.schoolId, ["SCHOOL_ADMIN", "TEACHER", "STAFF"]);
  const values: unknown[] = [query.schoolId];
  const conditions = ["e.school_id = $1"];
  if (!isManager(req, query.schoolId)) {
    values.push(getUserContext(req).user.id);
    conditions.push(`e.user_id = $${values.length}`);
  }
  if (query.search) {
    values.push(`%${query.search}%`);
    conditions.push(`(e.first_name ILIKE $${values.length} OR e.last_name ILIKE $${values.length} OR e.employee_no ILIKE $${values.length})`);
  }
  if (query.employeeId) { values.push(query.employeeId); conditions.push(`e.employee_no = $${values.length}`); }
  if (query.department) { values.push(query.department); conditions.push(`e.department = $${values.length}`); }
  if (query.role) { values.push(query.role); conditions.push(`e.employee_type = $${values.length}`); }
  if (query.status) { values.push(query.status); conditions.push(`e.employment_status = $${values.length}`); }
  const result = await pool.query(
    `SELECT ${employeeSelect} FROM employees e WHERE ${conditions.join(" AND ")} ORDER BY e.last_name, e.first_name`,
    values,
  );
  res.json(ListEmployeesResponse.parse(result.rows));
}));

router.post("/employees", asyncRoute(async (req, res) => {
  const query = CreateEmployeeQueryParams.parse(req.query);
  assertSchoolOperationalAccess(req, query.schoolId, ["SCHOOL_ADMIN"]);
  const body = CreateEmployeeBody.parse(req.body);
  if (body.userId) {
    const user = await pool.query(`SELECT id FROM app_users WHERE id = $1`, [body.userId]);
    if (!user.rows[0]) throw new AuthError(404, "User not found");
  }
  const result = await pool.query(
    `INSERT INTO employees
      (school_id, user_id, employee_no, first_name, middle_name, last_name, phone, email,
       address, photo, gender, employee_type, date_employed, department, qualification)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING ${employeeReturning}`,
    [query.schoolId, body.userId ?? null, body.employeeId, body.firstName, body.middleName ?? null,
      body.lastName, body.phone ?? null, body.email ?? null, body.address ?? null, body.photoUrl ?? null,
      body.gender ?? null, body.type, body.dateEmployed ?? null, body.department ?? null, body.qualification ?? null],
  );
  await audit(req, query.schoolId, "Created employee", "EMPLOYEE_CREATED", result.rows[0].id);
  res.status(201).json(CreateEmployeeResponse.parse(result.rows[0]));
}));

router.get("/employees/:employeeId", asyncRoute(async (req, res) => {
  const params = GetEmployeeParams.parse(req.params);
  const query = GetEmployeeQueryParams.parse(req.query);
  const row = await employee(req, params.employeeId);
  assertSchoolAccess(req, row.schoolId, ["SCHOOL_ADMIN", "TEACHER", "STAFF"]);
  if (row.schoolId !== query.schoolId ||
      (!isManager(req, row.schoolId) && row.userId !== getUserContext(req).user.id)) {
    throw new AuthError(404, "Employee not found");
  }
  res.json(GetEmployeeResponse.parse(row));
}));

router.patch("/employees/:employeeId", asyncRoute(async (req, res) => {
  const params = UpdateEmployeeParams.parse(req.params);
  const query = UpdateEmployeeQueryParams.parse(req.query);
  const body = UpdateEmployeeBody.parse(req.body);
  const current = await employee(req, params.employeeId);
  if (current.schoolId !== query.schoolId) throw new AuthError(404, "Employee not found");
  assertSchoolOperationalAccess(req, current.schoolId, ["SCHOOL_ADMIN"]);
  const result = await pool.query(
    `UPDATE employees SET first_name = COALESCE($1, first_name), middle_name = COALESCE($2, middle_name),
       last_name = COALESCE($3, last_name), phone = COALESCE($4, phone), email = COALESCE($5, email),
       address = COALESCE($6, address), photo = COALESCE($7, photo), gender = COALESCE($8, gender),
       date_employed = COALESCE($9, date_employed), department = COALESCE($10, department),
       qualification = COALESCE($11, qualification), user_id = COALESCE($12, user_id), updated_at = NOW()
     WHERE id = $13 AND school_id = $14 RETURNING ${employeeReturning}`,
    [body.firstName ?? null, body.middleName ?? null, body.lastName ?? null, body.phone ?? null,
      body.email ?? null, body.address ?? null, body.photoUrl ?? null, body.gender ?? null,
      body.dateEmployed ?? null, body.department ?? null, body.qualification ?? null, body.userId ?? null,
      params.employeeId, current.schoolId],
  );
  await audit(req, current.schoolId, "Updated employee", "EMPLOYEE_UPDATED", params.employeeId);
  res.json(UpdateEmployeeResponse.parse(result.rows[0]));
}));

router.patch("/employees/:employeeId/status", asyncRoute(async (req, res) => {
  const params = UpdateEmployeeStatusParams.parse(req.params);
  const query = UpdateEmployeeStatusQueryParams.parse(req.query);
  const body = UpdateEmployeeStatusBody.parse(req.body);
  const current = await employee(req, params.employeeId);
  if (current.schoolId !== query.schoolId) throw new AuthError(404, "Employee not found");
  assertSchoolOperationalAccess(req, current.schoolId, ["SCHOOL_ADMIN"]);
  const result = await pool.query(
    `UPDATE employees SET employment_status = $1, updated_at = NOW()
     WHERE id = $2 AND school_id = $3 RETURNING ${employeeReturning}`,
    [body.status, params.employeeId, current.schoolId],
  );
  await audit(req, current.schoolId, "Changed employee status", "EMPLOYEE_STATUS_CHANGED", params.employeeId);
  res.json(UpdateEmployeeStatusResponse.parse(result.rows[0]));
}));

async function parent(req: Request, id: number, schoolId: number) {
  const result = await pool.query(
    `SELECT p.id, p.school_id AS "schoolId", p.name, p.email, p.phone, p.address, p.status,
       au.clerk_user_id AS "clerkUserId", NULL::text AS "relationshipType",
       NULL::text AS "emergencyContactName", NULL::text AS "emergencyContactPhone",
       COUNT(psr.id)::int AS "childrenCount",
       COUNT(psr.id) FILTER (WHERE psr.status = 'ACTIVE')::int AS "activeChildren"
     FROM parents p LEFT JOIN app_users au ON au.id = p.user_id
       LEFT JOIN parent_student_relationships psr ON psr.parent_id = p.id
     WHERE p.id = $1 AND p.school_id = $2
     GROUP BY p.id, au.clerk_user_id`,
    [id, schoolId],
  );
  if (!result.rows[0]) throw new AuthError(404, "Parent not found");
  return result.rows[0];
}

router.get("/parents/:parentId", asyncRoute(async (req, res) => {
  const params = GetParentParams.parse(req.params);
  const query = GetParentQueryParams.parse(req.query);
  assertSchoolAccess(req, query.schoolId, ["SCHOOL_ADMIN"]);
  res.json(GetParentResponse.parse(await parent(req, params.parentId, query.schoolId)));
}));

router.patch("/parents/:parentId", asyncRoute(async (req, res) => {
  const params = UpdateParentParams.parse(req.params);
  const query = UpdateParentQueryParams.parse(req.query);
  const body = UpdateParentBody.parse(req.body);
  assertSchoolOperationalAccess(req, query.schoolId, ["SCHOOL_ADMIN"]);
  await parent(req, params.parentId, query.schoolId);
  await pool.query(
    `UPDATE parents SET name = COALESCE($1, name), email = COALESCE($2, email),
       phone = COALESCE($3, phone), address = COALESCE($4, address),
       status = COALESCE($5, status), updated_at = NOW()
     WHERE id = $6 AND school_id = $7`,
    [body.name ?? null, body.email ?? null, body.phone ?? null, body.address ?? null,
      body.status ?? null, params.parentId, query.schoolId],
  );
  const updated = await parent(req, params.parentId, query.schoolId);
  await audit(req, query.schoolId, "Updated parent", "PARENT_UPDATED", params.parentId);
  res.json(UpdateParentResponse.parse(updated));
}));

router.get("/student/profile", asyncRoute(async (req, res) => {
  assertRoles(req, ["STUDENT"]);
  const context = getUserContext(req);
  const result = await pool.query(
    `SELECT st.id, st.school_id AS "schoolId", st.admission_no AS "admissionNo",
       st.first_name AS "firstName", st.last_name AS "lastName", st.middle_name AS "middleName",
       st.date_of_birth AS "dateOfBirth", st.photo AS "passportUrl", st.admission_date AS "admissionDate",
       st.admission_status AS "admissionStatus", st.address,
       st.previous_school AS "previousSchool", st.medical_info AS "medicalInformation",
       st.emergency_contact_name AS "emergencyContactName", st.emergency_contact_phone AS "emergencyContactPhone",
       NULL::int AS "currentClassId", NULL::int AS "currentSessionId", NULL::int AS "currentTermId",
       st.created_at AS "createdAt", st.updated_at AS "updatedAt", st.gender, st.class_name AS "className",
       st.section, st.parent_name AS "parentName", st.parent_phone AS "parentPhone", st.status, st.joined_at AS "joinedAt",
       CASE WHEN EXISTS (SELECT 1 FROM subscriptions sub WHERE sub.student_id = st.id AND sub.status = 'active')
         THEN 'active' ELSE 'unpaid' END AS "subscriptionStatus",
       COALESCE((SELECT nc.status FROM nfc_cards nc WHERE nc.student_id = st.id AND nc.status <> 'replaced' LIMIT 1), 'unassigned') AS "cardStatus"
     FROM students st WHERE st.user_id = $1`,
    [context.user.id],
  );
  if (!result.rows[0]) throw new AuthError(404, "Student profile not found");
  const row = result.rows[0];
  res.json(GetStudentSelfProfileResponse.parse({
    ...row,
    admissionStatus: row.admissionStatus?.toLowerCase(),
    gender: row.gender?.toLowerCase(),
    status: row.status?.toUpperCase(),
    joinedAt: row.joinedAt instanceof Date ? row.joinedAt.toISOString() : String(row.joinedAt),
  }));
}));

export default router;