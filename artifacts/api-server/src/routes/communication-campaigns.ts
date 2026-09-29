import { Router, type NextFunction, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import {
  CreateCommunicationAnnouncementBody,
  CreateCommunicationAnnouncementResponse,
  CreateCommunicationTemplateBody,
  CreateCommunicationTemplateResponse,
  GetCommunicationAnnouncementParams,
  GetCommunicationAnnouncementResponse,
  ListCommunicationAnnouncementsQueryParams,
  ListCommunicationAnnouncementsResponse,
  ListCommunicationTemplatesQueryParams,
  ListCommunicationTemplatesResponse,
  PreviewCommunicationAnnouncementBody,
  PreviewCommunicationAnnouncementResponse,
  RetryCommunicationDeliveryParams,
  RetryCommunicationDeliveryResponse,
  UpdateCommunicationTemplateBody,
  UpdateCommunicationTemplateParams,
  UpdateCommunicationTemplateResponse,
} from "@workspace/api-zod";
import {
  AuthError,
  assertSchoolOperationalAccess,
  getUserContext,
  handleAuthError,
  requireAuthentication,
  type Role,
} from "../middlewares/auth";
import { logger } from "../lib/logger";
import {
  dispatchCommunicationDeliveries,
  queueCommunicationNotification,
  renderCommunicationTemplate,
  type CommunicationCategory,
} from "../services/communication-service";

const router = Router();
router.use(requireAuthentication());

const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    handler(req, res).catch((error) => {
      if (error instanceof RateLimitError) {
        res.set("Retry-After", String(error.retryAfterSeconds));
        res.status(429).json({ error: error.message, code: "RATE_LIMITED" });
        return;
      }
      handleAuthError(error, req, res, next);
    });

class RateLimitError extends Error {
  constructor(message: string, readonly retryAfterSeconds: number) {
    super(message);
  }
}

const categories = [
  "ATTENDANCE", "ACADEMIC", "ASSIGNMENT", "FINANCE", "PAYMENT",
  "ANNOUNCEMENT", "ACCOUNT", "SYSTEM", "SUBSCRIPTION", "PARTNER", "SECURITY",
] as const;
const channels = ["IN_APP", "SMS", "EMAIL"] as const;
const recipientLimit = 1000;
const retryLimit = 5;
const campaignRateLimit = 10;
const campaignRateWindowMinutes = 10;
const retryRateLimit = 10;
const successfulDeliveryStatuses = "('SENT','DELIVERED','READ')";
const campaignDerivedStatus = `CASE
  WHEN c.status='CANCELLED' THEN 'CANCELLED'
  WHEN COUNT(d.id)=0 THEN 'FAILED'
  WHEN BOOL_AND(d.status='CANCELLED') THEN 'CANCELLED'
  WHEN BOOL_OR(d.status='PROCESSING')
    OR (BOOL_OR(d.status='QUEUED') AND BOOL_OR(d.status IN ${successfulDeliveryStatuses} OR d.status IN ('FAILED','CANCELLED')))
    THEN 'SENDING'
  WHEN BOOL_OR(d.status='QUEUED') THEN 'QUEUED'
  WHEN BOOL_OR(d.status='FAILED') AND NOT BOOL_OR(d.status IN ${successfulDeliveryStatuses}) THEN 'FAILED'
  ELSE 'SENT'
END`;
const recipientDerivedStatus = `CASE
  WHEN COUNT(d.id)=0 THEN cr.status
  WHEN BOOL_OR(d.status IN ('QUEUED','PROCESSING')) THEN 'QUEUED'
  WHEN BOOL_OR(d.status IN ${successfulDeliveryStatuses}) THEN 'SENT'
  WHEN BOOL_AND(d.status='CANCELLED') THEN 'SKIPPED'
  ELSE 'FAILED'
END`;

type TargetType = "SCHOOL" | "PARENTS" | "STUDENTS" | "TEACHERS" | "STAFF" | "CLASS" | "SECTION" | "USERS";
type Channel = (typeof channels)[number];
type Recipient = {
  userId: number;
  role: "SCHOOL_ADMIN" | "TEACHER" | "STAFF" | "ACCOUNTANT" | "PARENT" | "STUDENT";
  studentName: string | null;
  parentName: string | null;
  className: string | null;
  subjectStudentId: number | null;
  subjectClassId: number | null;
};
type TargetInput = { schoolId: number; targetType: TargetType; targetCriteria: Record<string, unknown> };

const allowedTemplateVariables = new Set([
  "student_name", "parent_name", "school_name", "class_name", "amount",
  "invoice_number", "payment_date", "attendance_date", "term_name", "assignment_title",
]);

function parse<T>(schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } } }, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AuthError(400, result.error.issues[0]?.message ?? "Request validation failed");
  }
  return result.data;
}

function safeId(value: unknown, label: string): number {
  const id = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new AuthError(400, `${label} must be a positive integer`);
  return id;
}

function requireSchoolRole(req: Request, schoolId: number, roles: readonly Role[]) {
  const context = assertSchoolOperationalAccess(req, schoolId, [...roles]);
  return context;
}

function activeRoles(req: Request, schoolId: number): Set<string> {
  return new Set(getUserContext(req).roles
    .filter(role => role.status === "ACTIVE" && role.schoolId === schoolId)
    .map(role => role.role));
}

function validateCriteria(targetType: TargetType, raw: Record<string, unknown>): Record<string, unknown> {
  const criteria = raw ?? {};
  const allowedKeys = targetType === "CLASS" ? ["classId"]
    : targetType === "SECTION" ? ["classId", "section"]
      : targetType === "USERS" ? ["userIds"] : [];
  if (Object.keys(criteria).some(key => !allowedKeys.includes(key))) {
    throw new AuthError(400, "Target criteria contains unsupported fields");
  }
  if (targetType === "CLASS" || targetType === "SECTION") {
    criteria.classId = safeId(criteria.classId, "classId");
  }
  if (targetType === "SECTION") {
    if (typeof criteria.section !== "string" || !criteria.section.trim() || criteria.section.length > 100) {
      throw new AuthError(400, "section must be a non-empty string of at most 100 characters");
    }
    criteria.section = criteria.section.trim();
  }
  if (targetType === "USERS") {
    if (!Array.isArray(criteria.userIds) || criteria.userIds.length < 1 || criteria.userIds.length > 100) {
      throw new AuthError(400, "userIds must contain between 1 and 100 school-recipient IDs");
    }
    if (criteria.userIds.some(id => !Number.isSafeInteger(id) || (id as number) < 1)) {
      throw new AuthError(400, "userIds must contain positive integers");
    }
    criteria.userIds = [...new Set(criteria.userIds as number[])];
  }
  return criteria;
}

function authorizeTarget(req: Request, input: TargetInput, category?: CommunicationCategory) {
  requireSchoolRole(req, input.schoolId, ["SCHOOL_ADMIN", "TEACHER", "ACCOUNTANT"]);
  const roles = activeRoles(req, input.schoolId);
  const isAdmin = roles.has("SCHOOL_ADMIN");
  const isTeacher = roles.has("TEACHER");
  const isAccountant = roles.has("ACCOUNTANT");

  if (isAdmin) {
    if (category !== undefined && category !== "ANNOUNCEMENT") {
      throw new AuthError(400, "Manual school campaigns may only be categorized as ANNOUNCEMENT");
    }
    return;
  }
  if (isTeacher) {
    if ((input.targetType !== "CLASS" && input.targetType !== "SECTION")
      || (category !== undefined && category !== "ANNOUNCEMENT")) {
      throw new AuthError(403, "Teachers may communicate only with their assigned class or section");
    }
    return;
  }
  if (isAccountant) {
    if ((category !== undefined && category !== "FINANCE")
      || !["PARENTS", "STUDENTS", "USERS"].includes(input.targetType)) {
      throw new AuthError(403, "Accountants may send general finance announcements only to authorized families");
    }
    return;
  }
  requireSchoolRole(req, input.schoolId, ["SCHOOL_ADMIN", "TEACHER", "ACCOUNTANT"]);
}

function targetCte(input: TargetInput): { sql: string; values: unknown[] } {
  const baseValues: unknown[] = [input.schoolId];
  let candidates: string;
  const studentCandidates = (assignmentFilter = "", requireAssignment = false) => `
    SELECT st.user_id AS "userId", 'STUDENT'::text AS role,
      concat_ws(' ',st.first_name,st.last_name) AS "studentName",
      p.name AS "parentName", c.name AS "className",
      st.id AS "subjectStudentId", sca.school_class_id AS "subjectClassId"
    FROM students st
    JOIN app_users u ON u.id=st.user_id AND UPPER(u.status)='ACTIVE'
    LEFT JOIN parent_student_relationships psr ON psr.student_id=st.id AND UPPER(psr.status)='ACTIVE'
    LEFT JOIN parents p ON p.id=psr.parent_id AND p.school_id=st.school_id AND UPPER(p.status)='ACTIVE'
    LEFT JOIN student_class_assignments sca ON sca.student_id=st.id AND sca.school_id=st.school_id
      AND sca.status='ACTIVE' AND sca.is_current=true
    LEFT JOIN school_classes c ON c.id=sca.school_class_id AND c.school_id=sca.school_id
    WHERE st.school_id=$1 AND UPPER(st.status)='ACTIVE'
      ${requireAssignment ? "AND sca.id IS NOT NULL" : ""} ${assignmentFilter}`;
  const parentCandidates = (assignmentFilter = "", requireAssignment = false) => `
    SELECT p.user_id AS "userId", 'PARENT'::text AS role,
      concat_ws(' ',st.first_name,st.last_name) AS "studentName", p.name AS "parentName", c.name AS "className",
      st.id AS "subjectStudentId", sca.school_class_id AS "subjectClassId"
    FROM parents p
    JOIN app_users u ON u.id=p.user_id AND UPPER(u.status)='ACTIVE'
    JOIN parent_student_relationships psr ON psr.parent_id=p.id AND UPPER(psr.status)='ACTIVE'
    JOIN students st ON st.id=psr.student_id AND st.school_id=p.school_id
      AND UPPER(st.status)='ACTIVE'
    LEFT JOIN student_class_assignments sca ON sca.student_id=st.id AND sca.school_id=st.school_id
      AND sca.status='ACTIVE' AND sca.is_current=true
    LEFT JOIN school_classes c ON c.id=sca.school_class_id AND c.school_id=sca.school_id
    WHERE p.school_id=$1 AND UPPER(p.status)='ACTIVE'
      ${requireAssignment ? "AND sca.id IS NOT NULL" : ""} ${assignmentFilter}`;
  const schoolStaff = (roles: string[], employeeFilter = "") => `
    SELECT u.id AS "userId", sm.role::text AS role,
      NULL::text AS "studentName", NULL::text AS "parentName", NULL::text AS "className",
      NULL::int AS "subjectStudentId", NULL::int AS "subjectClassId"
    FROM school_memberships sm
    JOIN app_users u ON u.id=sm.user_id AND UPPER(u.status)='ACTIVE'
    LEFT JOIN employees e ON e.user_id=u.id AND e.school_id=sm.school_id
      AND UPPER(e.employment_status)='ACTIVE' ${employeeFilter}
    WHERE sm.school_id=$1 AND UPPER(sm.status)='ACTIVE'
      AND sm.role IN (${roles.map(role => `'${role}'`).join(",")})
      ${employeeFilter.includes("e.employee_type") ? "AND e.id IS NOT NULL" : ""}`;

  switch (input.targetType) {
    case "PARENTS":
      candidates = parentCandidates();
      break;
    case "STUDENTS":
      candidates = studentCandidates();
      break;
    case "TEACHERS":
      candidates = schoolStaff(["TEACHER"], "AND UPPER(e.employee_type)='TEACHER'");
      break;
    case "STAFF":
      candidates = schoolStaff(["STAFF"], "AND UPPER(e.employee_type)<>'TEACHER'");
      break;
    case "CLASS":
    case "SECTION": {
      baseValues.push(input.targetCriteria.classId);
      let assignmentFilter = `AND sca.school_class_id=$${baseValues.length}`;
      let parentFilter = `AND sca.school_class_id=$${baseValues.length}`;
      if (input.targetType === "SECTION") {
        baseValues.push(input.targetCriteria.section);
        assignmentFilter += ` AND sca.section=$${baseValues.length}`;
        parentFilter += ` AND sca.section=$${baseValues.length}`;
      }
      candidates = `${studentCandidates(assignmentFilter, true)} UNION ALL ${parentCandidates(parentFilter, true)}`;
      break;
    }
    case "USERS":
      baseValues.push(input.targetCriteria.userIds);
      candidates = `
        SELECT u.id AS "userId", eligible.role, eligible."studentName", eligible."parentName",
          eligible."className",eligible."subjectStudentId",eligible."subjectClassId"
        FROM app_users u
        JOIN (
          ${studentCandidates()}
          UNION ALL ${parentCandidates()}
          UNION ALL ${schoolStaff(["SCHOOL_ADMIN","TEACHER","STAFF","ACCOUNTANT"])}
        ) eligible ON eligible."userId"=u.id
        WHERE u.id=ANY($${baseValues.length}::int[])`;
      break;
    case "SCHOOL":
      candidates = `${studentCandidates()} UNION ALL ${parentCandidates()} UNION ALL ${schoolStaff(["SCHOOL_ADMIN","TEACHER","STAFF","ACCOUNTANT"])}`;
      break;
    default:
      throw new AuthError(400, "Unsupported recipient target");
  }

  return {
    sql: `
      WITH candidates AS (${candidates}),
      recipients AS (
        SELECT DISTINCT ON (candidate."userId")
          candidate."userId", candidate.role, candidate."studentName", candidate."parentName", candidate."className"
          ,candidate."subjectStudentId",candidate."subjectClassId"
        FROM candidates candidate
        WHERE candidate."userId" IS NOT NULL
        ORDER BY candidate."userId",
          CASE candidate.role WHEN 'SCHOOL_ADMIN' THEN 1 WHEN 'TEACHER' THEN 2
            WHEN 'STAFF' THEN 3 WHEN 'ACCOUNTANT' THEN 4 WHEN 'PARENT' THEN 5 ELSE 6 END
      )
      SELECT recipients."userId",recipients.role,recipients."studentName",recipients."parentName",
        recipients."className",recipients."subjectStudentId",recipients."subjectClassId",
        u.first_name AS "firstName",u.last_name AS "lastName",
        u.email,u.phone
      FROM recipients
      JOIN app_users u ON u.id=recipients."userId" AND UPPER(u.status)='ACTIVE'
      ORDER BY recipients."userId"
      LIMIT ${recipientLimit + 1}`,
    values: baseValues,
  };
}

async function resolveRecipients(req: Request, input: TargetInput, category?: CommunicationCategory): Promise<Recipient[]> {
  authorizeTarget(req, input, category);
  const context = getUserContext(req);
  const criteria = validateCriteria(input.targetType, input.targetCriteria);
  const validatedInput = { ...input, targetCriteria: criteria };
  if (activeRoles(req, input.schoolId).has("TEACHER")) {
    const isAdmin = activeRoles(req, input.schoolId).has("SCHOOL_ADMIN");
    if (!isAdmin) {
      const assigned = await pool.query(
        `SELECT 1
           FROM teacher_class_assignments tca
           JOIN employees e ON e.id=tca.employee_id AND e.school_id=tca.school_id
           JOIN academic_sessions s ON s.id=tca.academic_session_id AND s.school_id=tca.school_id
          WHERE tca.school_id=$1 AND tca.school_class_id=$2
            AND tca.status='ACTIVE' AND s.is_current=true AND e.user_id=$3
            AND UPPER(e.employment_status)='ACTIVE' AND UPPER(e.employee_type)='TEACHER'
            AND ($4::text IS NULL OR tca.section=$4)`,
        [input.schoolId, criteria.classId, context.user.id, input.targetType === "SECTION" ? criteria.section : null],
      );
      if (!assigned.rows.length) {
        throw new AuthError(404, "The class or section is not assigned to this teacher");
      }
    }
  }
  const built = targetCte(validatedInput);
  const result = await pool.query(built.sql, built.values);
  const rows = result.rows as Array<Record<string, unknown>>;
  if (activeRoles(req, input.schoolId).has("ACCOUNTANT") && !activeRoles(req, input.schoolId).has("SCHOOL_ADMIN")
    && rows.some(row => row.role !== "PARENT" && row.role !== "STUDENT")) {
    throw new AuthError(404, "One or more selected recipients are not authorized for this school");
  }
  if (input.targetType === "USERS" && rows.length !== (criteria.userIds as number[]).length) {
    throw new AuthError(404, "One or more selected recipients are not authorized for this school");
  }
  if (rows.length > recipientLimit) throw new AuthError(400, `A communication may target at most ${recipientLimit} recipients`);
  return rows.map(row => ({
    userId: Number(row.userId),
    role: row.role as Recipient["role"],
    studentName: typeof row.studentName === "string" ? row.studentName : null,
    parentName: typeof row.parentName === "string" ? row.parentName : null,
    className: typeof row.className === "string" ? row.className : null,
    subjectStudentId: Number.isSafeInteger(Number(row.subjectStudentId)) && Number(row.subjectStudentId) > 0
      ? Number(row.subjectStudentId) : null,
    subjectClassId: Number.isSafeInteger(Number(row.subjectClassId)) && Number(row.subjectClassId) > 0
      ? Number(row.subjectClassId) : null,
  }));
}

function validateTemplateSource(body: string, subject: string | null | undefined, allowedVariables: string[]) {
  const variables = new Set(allowedVariables);
  for (const text of [body, subject ?? ""]) {
    const tokens = [...text.matchAll(/{{\s*([^{}]+?)\s*}}/g)].map(match => match[1]);
    const residue = text.replace(/{{\s*[^{}]+?\s*}}/g, "");
    if (residue.includes("{{") || residue.includes("}}")) {
      throw new AuthError(400, "Template contains an invalid placeholder");
    }
    for (const token of tokens) {
      if (!allowedTemplateVariables.has(token) || !variables.has(token)) {
        throw new AuthError(400, `Template variable "${token}" is not in the allowed-variable list`);
      }
    }
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a],[b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function roleForRequest(req: Request, schoolId: number) {
  const roles = activeRoles(req, schoolId);
  if (roles.has("SCHOOL_ADMIN")) return "SCHOOL_ADMIN";
  if (roles.has("TEACHER")) return "TEACHER";
  if (roles.has("ACCOUNTANT")) return "ACCOUNTANT";
  return "SCHOOL_ADMIN";
}

async function writeAudit(
  db: { query: (sql: string, values?: unknown[]) => Promise<any> },
  req: Request,
  schoolId: number,
  action: string,
  eventType: string,
  recordId: number,
  metadata: Record<string, unknown>,
) {
  const context = getUserContext(req);
  const actor = [context.user.firstName, context.user.lastName].filter(Boolean).join(" ") || context.user.email;
  await db.query(
    `INSERT INTO audit_logs
      ("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,severity,event_type,result,metadata)
     VALUES($1,$2,$3,$4,$5,$6,'Communications',$7,'info',$8,'SUCCESS',$9::jsonb)`,
    [actor, roleForRequest(req, schoolId), context.user.id, context.user.clerkUserId,
      schoolId, action, recordId, eventType, JSON.stringify(metadata)],
  );
}

router.get("/communication/templates", asyncRoute(async (req, res) => {
  const query = parse(ListCommunicationTemplatesQueryParams, req.query);
  requireSchoolRole(req, query.schoolId, ["SCHOOL_ADMIN", "TEACHER", "ACCOUNTANT"]);
  const roles = activeRoles(req, query.schoolId);
  const categoryFilter = roles.has("SCHOOL_ADMIN")
    ? ""
    : roles.has("ACCOUNTANT") ? "AND category='FINANCE'"
      : "AND category='ANNOUNCEMENT'";
  const result = await pool.query(
    `SELECT id,school_id AS "schoolId",template_key AS "templateKey",name,category,channel,
       subject,body,allowed_variables AS "allowedVariables",is_active AS "isActive",
       created_at AS "createdAt",updated_at AS "updatedAt"
     FROM communication_templates
      WHERE school_id=$1 AND is_active=true AND ($2::text IS NULL OR category=$2)
        ${categoryFilter}
     ORDER BY name,id`,
    [query.schoolId, req.query.category ?? null],
  );
  res.json(ListCommunicationTemplatesResponse.parse(result.rows));
}));

router.post("/communication/templates", asyncRoute(async (req, res) => {
  const body = parse(CreateCommunicationTemplateBody.strict(), req.body);
  requireSchoolRole(req, body.schoolId, ["SCHOOL_ADMIN"]);
  const variables = body.allowedVariables ?? [];
  validateTemplateSource(body.body, body.subject, variables);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const inserted = await client.query(
      `INSERT INTO communication_templates
        (school_id,template_key,name,category,channel,subject,body,allowed_variables,is_active,created_by_user_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id,school_id AS "schoolId",template_key AS "templateKey",name,category,channel,
         subject,body,allowed_variables AS "allowedVariables",is_active AS "isActive",
         created_at AS "createdAt",updated_at AS "updatedAt"`,
      [body.schoolId, body.templateKey, body.name, body.category, body.channel,
        body.subject ?? null, body.body, variables, body.isActive, getUserContext(req).user.id],
    );
    const row = inserted.rows[0];
    if (!row) throw new Error("Template could not be created");
    await writeAudit(client, req, body.schoolId, "Created communication template", "COMMUNICATION_TEMPLATE_CREATED", Number(row.id), {
      templateKey: body.templateKey, channel: body.channel,
    });
    await client.query("COMMIT");
    res.status(201).json(CreateCommunicationTemplateResponse.parse(row));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if ((error as { code?: string }).code === "23505") {
      throw new AuthError(409, "A template with this key and channel already exists");
    }
    throw error;
  } finally {
    client.release();
  }
}));

router.patch("/communication/templates/:templateId", asyncRoute(async (req, res) => {
  const params = parse(UpdateCommunicationTemplateParams, req.params);
  const body = parse(UpdateCommunicationTemplateBody.strict(), req.body);
  const existing = await pool.query(
    `SELECT id,school_id AS "schoolId",template_key AS "templateKey",name,category,channel,subject,body,
       allowed_variables AS "allowedVariables",is_active AS "isActive"
     FROM communication_templates WHERE id=$1`,
    [params.templateId],
  );
  if (!existing.rows[0]) throw new AuthError(404, "Template not found");
  const current = existing.rows[0];
  requireSchoolRole(req, Number(current.schoolId), ["SCHOOL_ADMIN"]);
  const merged = {
    name: body.name ?? current.name,
    category: body.category ?? current.category,
    channel: body.channel ?? current.channel,
    subject: body.subject === undefined ? current.subject : body.subject,
    body: body.body ?? current.body,
    allowedVariables: body.allowedVariables ?? current.allowedVariables,
    isActive: body.isActive ?? current.isActive,
  };
  validateTemplateSource(merged.body, merged.subject, merged.allowedVariables);
  const updated = await pool.query(
    `UPDATE communication_templates
       SET name=$1,category=$2,channel=$3,subject=$4,body=$5,allowed_variables=$6,is_active=$7,updated_at=NOW()
     WHERE id=$8 AND school_id=$9
     RETURNING id,school_id AS "schoolId",template_key AS "templateKey",name,category,channel,
       subject,body,allowed_variables AS "allowedVariables",is_active AS "isActive",
       created_at AS "createdAt",updated_at AS "updatedAt"`,
    [merged.name, merged.category, merged.channel, merged.subject, merged.body,
      merged.allowedVariables, merged.isActive, params.templateId, current.schoolId],
  );
  await writeAudit(pool, req, Number(current.schoolId), "Updated communication template", "COMMUNICATION_TEMPLATE_UPDATED",
    params.templateId, { templateKey: current.templateKey, channel: merged.channel });
  res.json(UpdateCommunicationTemplateResponse.parse(updated.rows[0]));
}));

router.post("/communication/announcements/preview", asyncRoute(async (req, res) => {
  const body = parse(PreviewCommunicationAnnouncementBody.strict(), req.body);
  const targetType = body.targetType as TargetType;
  const input = {
    schoolId: body.schoolId,
    targetType,
    targetCriteria: validateCriteria(targetType, body.targetCriteria as Record<string, unknown>),
  };
  const recipients = await resolveRecipients(req, input);
  const result: Array<{ channel: Channel; eligibleRecipientCount: number }> = [];
  for (const channel of body.channels) {
    const field = channel === "SMS" ? "phone" : channel === "EMAIL" ? "email" : null;
    if (!field) {
      result.push({ channel, eligibleRecipientCount: recipients.length });
      continue;
    }
    const count = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM app_users u
       WHERE u.id=ANY($1::int[]) AND NULLIF(BTRIM(u.${field}), '') IS NOT NULL`,
      [recipients.map(recipient => recipient.userId)],
    );
    result.push({ channel, eligibleRecipientCount: Number(count.rows[0]?.count ?? 0) });
  }
  res.json(PreviewCommunicationAnnouncementResponse.parse({
    schoolId: body.schoolId, recipientCount: recipients.length, channelCounts: result,
  }));
}));

router.post("/communication/announcements", asyncRoute(async (req, res) => {
  const body = parse(CreateCommunicationAnnouncementBody.strict(), req.body);
  const targetType = body.targetType as TargetType;
  const targetCriteria = validateCriteria(targetType, body.targetCriteria as Record<string, unknown>);
  const recipientInput = { schoolId: body.schoolId, targetType, targetCriteria };
  authorizeTarget(req, recipientInput, body.category as CommunicationCategory);
  const recipients = await resolveRecipients(req, recipientInput, body.category as CommunicationCategory);
  if (!recipients.length) throw new AuthError(400, "No eligible recipients were found for this target");

  const template = body.templateId == null ? null : (await pool.query(
    `SELECT id,school_id AS "schoolId",category,channel,subject,body,allowed_variables AS "allowedVariables",
       is_active AS "isActive"
     FROM communication_templates WHERE id=$1 AND school_id=$2`,
    [body.templateId, body.schoolId],
  )).rows[0];
  if (body.templateId != null && (!template || !template.isActive)) {
    throw new AuthError(404, "Template not found");
  }
  if (template && template.category !== body.category) {
    throw new AuthError(400, "The template category must match the announcement category");
  }
  if (template && !body.channels.includes(template.channel as Channel)) {
    throw new AuthError(400, "Selected channels must include the template channel");
  }

  const school = await pool.query(`SELECT name FROM schools WHERE id=$1`, [body.schoolId]);
  if (!school.rows[0]) throw new AuthError(404, "School not found");
  const schoolName = String(school.rows[0].name);
  const isFinanceMessage = body.category === "FINANCE";
  const manualMessageLabel = isFinanceMessage
    ? `School finance announcement — not a payment confirmation. Manually authored by ${schoolName}.`
    : `Manually authored school message from ${schoolName}.`;
  const subjectLabel = isFinanceMessage
    ? `[School finance announcement — not a payment confirmation from ${schoolName}]`
    : `[Manually authored school message from ${schoolName}]`;
  const source = template
    ? { body: template.body, subject: template.subject, allowedVariables: template.allowedVariables as string[] }
    : { body: body.body, subject: body.subject ?? null, allowedVariables: [] as string[] };
  const campaignBody = `${manualMessageLabel}\n${source.body}`;
  const campaignSubject = `${subjectLabel} ${source.subject ?? body.subject ?? body.title}`;
  if (!template) {
    validateTemplateSource(body.body, body.subject, []);
  }
  const renderedRecipients = recipients.map(recipient => {
    const values = {
      school_name: schoolName,
      student_name: recipient.studentName,
      parent_name: recipient.parentName,
      class_name: recipient.className
        ?? (targetCriteria.classId ? String(targetCriteria.classId) : undefined),
    };
    try {
      const rendered = renderCommunicationTemplate(source, values);
      const renderedBody = `${manualMessageLabel}\n${rendered.body}`;
      const renderedSubject = `${subjectLabel} ${rendered.subject ?? body.subject ?? body.title}`;
      if (renderedBody.length > 10_000 || renderedSubject.length > 500) {
        throw new AuthError(400, "The manually authored message exceeds the delivery size limit");
      }
      return { recipient, subject: renderedSubject, body: renderedBody };
    } catch {
      throw new AuthError(400, "The selected template includes values that cannot be resolved for every recipient");
    }
  });

  const client = await pool.connect();
  let campaign: Record<string, any> | undefined;
  let wasCreated = false;
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock($1::int,$2::int)",
      [body.schoolId, getUserContext(req).user.id],
    );
    const inserted = await client.query(
      `INSERT INTO communication_campaigns
        (school_id,created_by_user_id,template_id,idempotency_key,title,subject,body,category,
         target_type,target_criteria,channels,status,recipient_count)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,'QUEUED',$12)
       ON CONFLICT (school_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
       RETURNING id,school_id AS "schoolId",created_by_user_id AS "createdByUserId",
         template_id AS "templateId",title,subject,body,category,target_type AS "targetType",
         target_criteria AS "targetCriteria",channels,status,recipient_count AS "recipientCount",
         created_at AS "createdAt",sent_at AS "sentAt"`,
       [body.schoolId, getUserContext(req).user.id, body.templateId ?? null, body.idempotencyKey,
         body.title, campaignSubject, campaignBody, body.category, targetType,
        JSON.stringify(targetCriteria), body.channels, recipients.length],
    );
    campaign = inserted.rows[0];
    if (!campaign) {
      if (body.idempotencyKey == null) {
        throw new RateLimitError("Campaign limit reached; try again after the current 10-minute window.", 600);
      }
      const existing = await client.query(
        `SELECT id,school_id AS "schoolId",created_by_user_id AS "createdByUserId",
           template_id AS "templateId",title,subject,body,category,target_type AS "targetType",
           target_criteria AS "targetCriteria",channels,status,recipient_count AS "recipientCount",
           created_at AS "createdAt",sent_at AS "sentAt"
         FROM communication_campaigns
         WHERE school_id=$1 AND idempotency_key=$2
         FOR UPDATE`,
        [body.schoolId, body.idempotencyKey],
      );
      campaign = existing.rows[0];
      if (!campaign) {
        throw new RateLimitError("Campaign limit reached; try again after the current 10-minute window.", 600);
      }
      if (Number(campaign.createdByUserId) !== getUserContext(req).user.id
        || campaign.title !== body.title
         || campaign.subject !== campaignSubject
         || campaign.body !== campaignBody
        || campaign.category !== body.category
        || campaign.targetType !== targetType
        || stableJson(campaign.targetCriteria) !== stableJson(targetCriteria)
        || stableJson(campaign.channels) !== stableJson(body.channels)
        || Number(campaign.templateId ?? 0) !== Number(body.templateId ?? 0)) {
        throw new AuthError(409, "The idempotency key is already in use by a different campaign");
      }
      wasCreated = false;
    } else {
      wasCreated = true;
      const recentCampaigns = await client.query(
        `SELECT COUNT(*)::int AS count
         FROM communication_campaigns
         WHERE school_id=$1 AND created_by_user_id=$2
           AND created_at >= NOW() - INTERVAL '${campaignRateWindowMinutes} minutes'`,
        [body.schoolId, getUserContext(req).user.id],
      );
      if (Number(recentCampaigns.rows[0]?.count ?? 0) > campaignRateLimit) {
        throw new RateLimitError("Campaign limit reached; try again after the current 10-minute window.", 600);
      }
      for (const item of renderedRecipients) {
        const notificationInput = {
          recipientUserId: item.recipient.userId,
          schoolId: body.schoolId,
          category: body.category as CommunicationCategory,
          eventKey: `COMMUNICATION_CAMPAIGN:${campaign.id}:${item.recipient.userId}`,
          subject: item.subject,
          body: item.body,
          link: null,
          channels: body.channels,
          subjectStudentId: item.recipient.subjectStudentId,
          subjectClassId: item.recipient.subjectClassId,
        };
        const notificationId = await queueCommunicationNotification(client, notificationInput);
        await client.query(
          `INSERT INTO communication_campaign_recipients
             (campaign_id,school_id,recipient_user_id,notification_id,status)
           VALUES($1,$2,$3,$4,
             CASE WHEN $4 IS NOT NULL AND EXISTS(
               SELECT 1 FROM communication_deliveries d WHERE d.notification_id=$4
             ) THEN 'QUEUED' ELSE 'SKIPPED' END)
           ON CONFLICT (campaign_id,recipient_user_id) DO NOTHING`,
          [campaign.id, body.schoolId, item.recipient.userId, notificationId],
        );
      }
      await writeAudit(client, req, body.schoolId, "Created school communication campaign",
        "COMMUNICATION_ANNOUNCEMENT_CREATED", Number(campaign.id), {
          recipientCount: recipients.length, targetType, category: body.category,
          channels: body.channels,
        });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  if (wasCreated) {
    void dispatchCommunicationDeliveries(pool, Math.min(500, recipients.length * body.channels.length))
      .catch(error => logger.error(
        { campaignId: campaign?.id, errorName: error instanceof Error ? error.name : "unknown" },
        "Communication campaign delivery dispatch failed",
      ));
  }
  res.status(wasCreated ? 201 : 200).json(CreateCommunicationAnnouncementResponse.parse(campaign));
}));

function historyAccess(req: Request, schoolId: number) {
  const context = requireSchoolRole(req, schoolId, ["SCHOOL_ADMIN", "TEACHER", "ACCOUNTANT"]);
  const roles = activeRoles(req, schoolId);
  if (roles.has("SCHOOL_ADMIN")) return { role: "SCHOOL_ADMIN", userId: context.user.id };
  if (roles.has("ACCOUNTANT")) return { role: "ACCOUNTANT", userId: context.user.id };
  return { role: "TEACHER", userId: context.user.id };
}

router.get("/communication/announcements", asyncRoute(async (req, res) => {
  const query = parse(ListCommunicationAnnouncementsQueryParams, req.query);
  const access = historyAccess(req, query.schoolId);
  const values: unknown[] = [query.schoolId];
  const filters = ["c.school_id=$1"];
  if (access.role === "ACCOUNTANT") filters.push("c.category='FINANCE'");
  if (access.role === "TEACHER") {
    values.push(access.userId);
    filters.push(`c.created_by_user_id=$${values.length}`);
  }
  if (query.beforeId !== undefined) {
    values.push(query.beforeId);
    filters.push(`c.id<$${values.length}`);
  }
  values.push(query.limit + 1);
  const result = await pool.query(
    `SELECT c.id,c.school_id AS "schoolId",c.created_by_user_id AS "createdByUserId",
       c.template_id AS "templateId",c.title,c.subject,c.body,c.category,c.target_type AS "targetType",
       c.target_criteria AS "targetCriteria",c.channels,${campaignDerivedStatus} AS status,
       COUNT(DISTINCT cr.recipient_user_id)::int AS "recipientCount",
       c.created_at AS "createdAt",c.sent_at AS "sentAt"
     FROM communication_campaigns c
     LEFT JOIN communication_campaign_recipients cr
       ON cr.campaign_id=c.id AND cr.school_id=c.school_id
     LEFT JOIN communication_notifications n
       ON n.id=cr.notification_id AND n.school_id=cr.school_id
         AND n.recipient_user_id=cr.recipient_user_id
     LEFT JOIN communication_deliveries d ON d.notification_id=n.id
     WHERE ${filters.join(" AND ")}
     GROUP BY c.id
     ORDER BY c.id DESC LIMIT $${values.length}`,
    values,
  );
  const rows = result.rows.slice(0, query.limit);
  const hasMore = result.rows.length > query.limit;
  res.json(ListCommunicationAnnouncementsResponse.parse({
    items: rows,
    hasMore,
    nextBeforeId: hasMore ? Number(rows[rows.length - 1]?.id) : null,
  }));
}));

router.get("/communication/announcements/:campaignId", asyncRoute(async (req, res) => {
  const params = parse(GetCommunicationAnnouncementParams, req.params);
  const campaignResult = await pool.query(
    `SELECT c.id,c.school_id AS "schoolId",c.created_by_user_id AS "createdByUserId",
       c.template_id AS "templateId",c.title,c.subject,c.body,c.category,c.target_type AS "targetType",
       c.target_criteria AS "targetCriteria",c.channels,${campaignDerivedStatus} AS status,
       COUNT(DISTINCT cr.recipient_user_id)::int AS "recipientCount",
       c.created_at AS "createdAt",c.sent_at AS "sentAt"
     FROM communication_campaigns c
     LEFT JOIN communication_campaign_recipients cr
       ON cr.campaign_id=c.id AND cr.school_id=c.school_id
     LEFT JOIN communication_notifications n
       ON n.id=cr.notification_id AND n.school_id=cr.school_id
         AND n.recipient_user_id=cr.recipient_user_id
     LEFT JOIN communication_deliveries d ON d.notification_id=n.id
     WHERE c.id=$1
     GROUP BY c.id`,
    [params.campaignId],
  );
  const campaign = campaignResult.rows[0];
  if (!campaign) throw new AuthError(404, "Communication campaign not found");
  const access = historyAccess(req, Number(campaign.schoolId));
  if ((access.role === "ACCOUNTANT" && campaign.category !== "FINANCE")
    || (access.role === "TEACHER" && Number(campaign.createdByUserId) !== access.userId)) {
    throw new AuthError(404, "Communication campaign not found");
  }
  const recipients = await pool.query(
    `SELECT cr.recipient_user_id AS "recipientUserId",
       COALESCE(
         CASE WHEN EXISTS (SELECT 1 FROM students st WHERE st.user_id=cr.recipient_user_id AND st.school_id=cr.school_id) THEN 'STUDENT' END,
         CASE WHEN EXISTS (SELECT 1 FROM parents p WHERE p.user_id=cr.recipient_user_id AND p.school_id=cr.school_id) THEN 'PARENT' END,
         (SELECT sm.role FROM school_memberships sm
           WHERE sm.user_id=cr.recipient_user_id AND sm.school_id=cr.school_id
           ORDER BY CASE sm.role WHEN 'SCHOOL_ADMIN' THEN 1 WHEN 'TEACHER' THEN 2 WHEN 'STAFF' THEN 3 ELSE 4 END LIMIT 1),
         'STAFF'
       ) AS "recipientRole",
       ${recipientDerivedStatus} AS status,
       COALESCE(json_agg(json_build_object(
         'id',d.id,'channel',d.channel,'status',d.status,
         'provider',CASE WHEN d.error_code='SIMULATED' OR d.last_error LIKE '%simulated delivery%'
           THEN split_part(d.last_error,':',1) ELSE NULL END,
         'providerMessageId',d.provider_message_id,
         'providerAcknowledgedAt',d.provider_acknowledged_at,'sentAt',d.sent_at,
         'deliveredAt',d.delivered_at,'failedAt',d.failed_at,'errorCode',d.error_code,
         'lastError',d.last_error,'attempts',d.attempts,'nextAttemptAt',d.next_attempt_at,
         'lastAttemptAt',d.last_attempt_at,
         'simulated',d.error_code='SIMULATED',
         'label',CASE WHEN d.error_code='SIMULATED'
           THEN 'Development simulation — no message was sent.' ELSE NULL END
       ) ORDER BY d.id) FILTER (WHERE d.id IS NOT NULL),'[]'::json) AS deliveries
     FROM communication_campaign_recipients cr
     LEFT JOIN communication_notifications n ON n.id=cr.notification_id
       AND n.school_id=cr.school_id AND n.recipient_user_id=cr.recipient_user_id
     LEFT JOIN communication_deliveries d ON d.notification_id=n.id
     WHERE cr.campaign_id=$1 AND cr.school_id=$2
     GROUP BY cr.id,cr.recipient_user_id,cr.school_id,cr.status
     ORDER BY cr.id`,
    [campaign.id, campaign.schoolId],
  );
  const parsed = GetCommunicationAnnouncementResponse.parse({ ...campaign, recipients: recipients.rows });
  res.json({
    ...parsed,
    recipients: parsed.recipients.map(recipient => ({
      ...recipient,
      deliveries: recipient.deliveries.map(delivery => {
        const simulated = delivery.errorCode === "SIMULATED";
        return {
          ...delivery,
          simulated,
          label: simulated ? "Development simulation — no message was sent." : null,
        };
      }),
    })),
  });
}));

router.post("/communication/deliveries/:deliveryId/retry", asyncRoute(async (req, res) => {
  const params = parse(RetryCommunicationDeliveryParams, req.params);
  const client = await pool.connect();
  let retry: Record<string, any> | undefined;
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT d.id,d.status,d.attempts,d.error_code AS "errorCode",
          n.school_id AS "schoolId",n.category,n.recipient_user_id AS "recipientUserId"
       FROM communication_deliveries d
       JOIN communication_notifications n ON n.id=d.notification_id
       WHERE d.id=$1 FOR UPDATE OF d`,
      [params.deliveryId],
    );
    const delivery = found.rows[0];
    if (!delivery || delivery.schoolId == null) throw new AuthError(404, "Delivery not found");
    const roles = activeRoles(req, Number(delivery.schoolId));
    if (roles.has("ACCOUNTANT")) {
      requireSchoolRole(req, Number(delivery.schoolId), ["ACCOUNTANT"]);
      if (delivery.category !== "FINANCE") throw new AuthError(404, "Delivery not found");
    } else {
      requireSchoolRole(req, Number(delivery.schoolId), ["SCHOOL_ADMIN"]);
    }
    if (delivery.status !== "FAILED" || Number(delivery.attempts) >= retryLimit
      || ["SIMULATED", "CONFIGURATION", "AUTHENTICATION", "INVALID_REQUEST", "PROVIDER_REJECTED",
        "COMMUNICATION_PROVIDER_NOT_CONFIGURED", "PROVIDER_OUTCOME_UNKNOWN"].includes(String(delivery.errorCode))) {
      throw new AuthError(409, "This delivery is not eligible for another retry");
    }
    const senderUserId = getUserContext(req).user.id;
    await client.query(
      "SELECT pg_advisory_xact_lock($1::int,$2::int)",
      [Number(delivery.schoolId), senderUserId],
    );
    const recentRetries = await client.query(
      `SELECT COUNT(*)::int AS count
       FROM audit_logs
       WHERE school_id=$1 AND actor_user_id=$2 AND module='Communications'
         AND event_type='COMMUNICATION_DELIVERY_RETRY'
         AND timestamp >= NOW() - INTERVAL '1 minute'`,
      [Number(delivery.schoolId), senderUserId],
    );
    if (Number(recentRetries.rows[0]?.count ?? 0) >= retryRateLimit) {
      throw new RateLimitError("Retry limit reached; try again after the current 1-minute window.", 60);
    }
    const updated = await client.query(
      `UPDATE communication_deliveries
          SET status='QUEUED',next_attempt_at=NOW(),failed_at=NULL,updated_at=NOW()
        WHERE id=$1 AND status='FAILED' AND attempts<$2
       RETURNING id,channel,status,
         CASE WHEN last_error LIKE '%simulated delivery%' THEN split_part(last_error,':',1) ELSE NULL END AS provider,
         provider_message_id AS "providerMessageId",
         provider_acknowledged_at AS "providerAcknowledgedAt",sent_at AS "sentAt",
         delivered_at AS "deliveredAt",failed_at AS "failedAt",error_code AS "errorCode",
         last_error AS "lastError",attempts,next_attempt_at AS "nextAttemptAt",
         last_attempt_at AS "lastAttemptAt"`,
      [params.deliveryId, retryLimit],
    );
    retry = updated.rows[0];
    if (!retry) throw new AuthError(409, "This delivery is not eligible for another retry");
    await writeAudit(client, req, Number(delivery.schoolId), "Retried communication delivery",
      "COMMUNICATION_DELIVERY_RETRY", params.deliveryId, { category: delivery.category });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  void dispatchCommunicationDeliveries(pool, 1)
    .catch(error => logger.error(
      { deliveryId: params.deliveryId, errorName: error instanceof Error ? error.name : "unknown" },
      "Communication delivery retry dispatch failed",
    ));
  const simulated = retry.errorCode === "SIMULATED";
  const parsed = RetryCommunicationDeliveryResponse.parse({
    ...retry,
    simulated,
    label: simulated ? "Development simulation — no message was sent." : null,
  });
  res.json({
    ...parsed,
    simulated,
    label: simulated ? "Development simulation — no message was sent." : null,
  });
}));

export default router;