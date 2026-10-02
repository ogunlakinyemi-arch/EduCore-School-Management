import { Router, type NextFunction, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { queueCommunicationNotification } from "../services/communication-service";
import {
  requireSecurityAccess,
  type SecurityAccessPermission,
} from "../services/school-security-core-service";
import {
  assertSchoolSecurityIncidentObject,
  newSchoolSecurityIncidentAttachmentPath,
  schoolSecurityIncidentAttachmentDownloadUrl,
  schoolSecurityIncidentAttachmentUploadUrl,
  schoolSecurityIncidentUploadExpiresAt,
} from "../services/school-security-incident-storage";
import {
  incidentAttachmentDownloadOutputSchema,
  incidentAttachmentSchema,
  incidentAttachmentUploadInputSchema,
  incidentAttachmentUploadIntentOutputSchema,
  incidentInputSchema,
  incidentOutputSchema,
  incidentPatchSchema,
  pickupCancelInputSchema,
  pickupCompletionInputSchema,
  pickupDecisionInputSchema,
  pickupPersonDecisionInputSchema,
  pickupPersonInputSchema,
  pickupPersonOutputSchema,
  pickupRequestInputSchema,
  pickupRequestOutputSchema,
  visitorInputSchema,
  visitorOutputSchema,
  visitorPatchSchema,
} from "../services/school-security-operations";
import {
  AuthError,
  getUserContext,
  handleAuthError,
  requireAuthentication,
  type UserContext,
} from "../middlewares/auth";

type Queryable = {
  query<Row = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: Row[]; rowCount?: number | null }>;
};
type TransactionClient = Queryable & { release(): void };

class OperationRateLimitError extends Error {
  constructor(message: string, public readonly retryAfterSeconds: number) {
    super(message);
  }
}

const visitorSelect = `id,school_id AS "schoolId",visitor_name AS "visitorName",phone,
  id_reference AS "idReference",purpose,host_name AS "hostName",host_student_id AS "hostStudentId",
  checked_in_at AS "checkedInAt",checked_out_at AS "checkedOutAt",status,notes,
  security_officer_user_id AS "securityOfficerUserId",security_location_id AS "securityLocationId",
  security_device_id AS "securityDeviceId",version,created_at AS "createdAt",updated_at AS "updatedAt"`;
const pickupPersonSelect = `id,school_id AS "schoolId",student_id AS "studentId",
  full_name AS "fullName",phone,relationship,identity_reference AS "identityReference",status,
  valid_from AS "validFrom",valid_until AS "validUntil",requested_at AS "requestedAt",
  decision_reason AS "decisionReason",
  decided_at AS "decidedAt",version,created_at AS "createdAt",updated_at AS "updatedAt"`;
const pickupRequestSelect = `id,school_id AS "schoolId",student_id AS "studentId",
  requested_by_parent_id AS "requestedByParentId",pickup_person_id AS "pickupPersonId",
  requested_pickup_at AS "requestedPickupAt",valid_from AS "validFrom",valid_until AS "validUntil",
  reason,status,decision_reason AS "decisionReason",decided_at AS "decidedAt",
  completed_at AS "completedAt",completion_pickup_person_id AS "completionPickupPersonId",
  recorded_security_event_id AS "recordedSecurityEventId",version,
  created_at AS "createdAt",updated_at AS "updatedAt"`;
const incidentSelect = `id,school_id AS "schoolId",incident_type AS "incidentType",
  occurred_at AS "occurredAt",security_location_id AS "securityLocationId",
  security_device_id AS "securityDeviceId",student_id AS "studentId",
  involved_persons AS "involvedPersons",
  assigned_staff_user_id AS "assignedStaffUserId",description,severity,status,resolution,
  created_by_user_id AS "createdByUserId",version,created_at AS "createdAt",updated_at AS "updatedAt"`;
const incidentAttachmentSelect = `id,school_id AS "schoolId",incident_id AS "incidentId",
  file_name AS "fileName",content_type AS "contentType",byte_size AS "byteSize",status,
  uploaded_by_user_id AS "uploadedByUserId",upload_expires_at AS "uploadExpiresAt",
  confirmed_at AS "confirmedAt",created_at AS "createdAt"`;

const isActiveOwner = (context: UserContext) => context.roles.some(
  (assignment) => assignment.role === "PLATFORM_OWNER" && assignment.schoolId === null && assignment.status === "ACTIVE",
);
function positiveId(value: string | string[] | undefined, label: string): number {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) throw new AuthError(404, `${label} not found`);
  const id = Number(value);
  if (!Number.isSafeInteger(id)) throw new AuthError(404, `${label} not found`);
  return id;
}

function queryPositiveId(value: unknown, fallback: number, label: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value)) throw new AuthError(400, `${label} must be a non-negative integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > 100_000) throw new AuthError(400, `${label} is out of range`);
  return parsed;
}

function parseInput<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch {
    throw new AuthError(400, "Request body does not match the required school-security contract");
  }
}

function idempotencyKey(req: Request): string {
  const value = req.header("Idempotency-Key");
  if (!value || value.length < 8 || value.length > 128 || /[\r\n]/.test(value)) {
    throw new AuthError(400, "A valid Idempotency-Key header is required");
  }
  return value;
}

function expectedVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new AuthError(400, "expectedVersion must be a positive integer");
  }
  return Number(value);
}

async function withTransaction<T>(run: (client: TransactionClient) => Promise<T>): Promise<T> {
  const client = await pool.connect() as unknown as TransactionClient;
  try {
    await client.query("BEGIN");
    const value = await run(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* keep the original operation error */ }
    throw error;
  } finally {
    client.release();
  }
}

async function assertOperationsPermission(
  req: Request,
  schoolId: number,
  permission: SecurityAccessPermission,
): Promise<UserContext> {
  const context = getUserContext(req);
  const ownerReadOnly = isActiveOwner(context);
  if (context.user.status !== "ACTIVE" || (ownerReadOnly && permission !== "SECURITY_READ")) {
    throw new AuthError(403, "Platform Owner access to school security is read-only");
  }
  return requireSecurityAccess(req, schoolId, permission, { ownerReadOnly });
}

async function requireParentStudent(
  req: Request,
  studentId: number,
): Promise<{ schoolId: number; parentId: number }> {
  const context = getUserContext(req);
  const result = await pool.query<{ schoolId: number; parentId: number }>(
    `SELECT st.school_id AS "schoolId",p.id AS "parentId"
       FROM students st
       JOIN parents p ON p.school_id=st.school_id AND p.user_id=$1
        AND UPPER(p.status)='ACTIVE'
       JOIN app_users au ON au.id=p.user_id AND UPPER(au.status)='ACTIVE'
       JOIN parent_student_relationships psr ON psr.parent_id=p.id
        AND psr.student_id=st.id AND UPPER(psr.status)='ACTIVE'
      WHERE st.id=$2 AND UPPER(st.status)='ACTIVE'
      LIMIT 1`,
    [context.user.id, studentId],
  );
  const link = result.rows[0];
  if (context.user.status !== "ACTIVE" || !link || !context.roles.some((role) =>
    role.role === "PARENT" && role.status === "ACTIVE" && role.schoolId === link.schoolId)) {
    throw new AuthError(404, "Student not found");
  }
  return link;
}

async function assertParentStudentInTransaction(
  client: Queryable,
  req: Request,
  scope: { schoolId: number; parentId: number },
  studentId: number,
): Promise<void> {
  const context = getUserContext(req);
  const link = await client.query(
    `SELECT 1 FROM parents p
      JOIN app_users u ON u.id=p.user_id AND UPPER(u.status)='ACTIVE'
      JOIN parent_student_relationships psr ON psr.parent_id=p.id
       AND psr.student_id=$3 AND UPPER(psr.status)='ACTIVE'
      JOIN students st ON st.id=psr.student_id AND st.school_id=p.school_id
       AND UPPER(st.status)='ACTIVE'
     WHERE p.id=$1 AND p.school_id=$2 AND UPPER(p.status)='ACTIVE' AND u.id=$4
     LIMIT 1 FOR SHARE OF p,u,psr,st`,
    [scope.parentId, scope.schoolId, studentId, context.user.id],
  );
  if (!link.rows[0]) throw new AuthError(404, "Student not found");
}

async function assertSchoolStudent(schoolId: number, studentId: number): Promise<void> {
  const result = await pool.query(
    `SELECT 1 FROM students WHERE id=$1 AND school_id=$2 AND UPPER(status)='ACTIVE' LIMIT 1`,
    [studentId, schoolId],
  );
  if (!result.rows[0]) throw new AuthError(404, "Student not found");
}

async function assertLocationAndDeviceScope(
  schoolId: number,
  securityLocationId: number | null | undefined,
  securityDeviceId: number | null | undefined,
): Promise<void> {
  if (securityLocationId != null) {
    const location = await pool.query(
      `SELECT id FROM security_locations
        WHERE id=$1 AND school_id=$2 AND status='ACTIVE' LIMIT 1`,
      [securityLocationId, schoolId],
    );
    if (!location.rows[0]) throw new AuthError(404, "Active security location not found");
  }
  if (securityDeviceId != null) {
    const device = await pool.query(
      `SELECT d.id FROM platform_devices d
        JOIN device_school_bindings b ON b.device_id=d.id AND b.school_id=$2
       WHERE d.id=$1 AND d.school_id=$2 AND d.status='ACTIVE' LIMIT 1`,
      [securityDeviceId, schoolId],
    );
    if (!device.rows[0]) throw new AuthError(404, "Active security device not found in this school");
  }
}

async function assertIncidentPeopleScope(
  schoolId: number,
  people: Array<{ personType: "STUDENT" | "STAFF" | "VISITOR"; personId: number }>,
): Promise<void> {
  const identityKeys = people.map((person) => `${person.personType}:${person.personId}`);
  if (new Set(identityKeys).size !== identityKeys.length) {
    throw new AuthError(400, "An involved person cannot be listed more than once");
  }
  for (const personType of ["STUDENT", "STAFF", "VISITOR"] as const) {
    const ids = [...new Set(people
      .filter((person) => person.personType === personType)
      .map((person) => person.personId))];
    if (ids.length === 0) continue;
    const query = personType === "STUDENT"
      ? `SELECT id FROM students WHERE school_id=$1 AND id=ANY($2::int[]) AND UPPER(status)='ACTIVE'`
      : personType === "STAFF"
        ? `SELECT e.id FROM employees e
            JOIN app_users u ON u.id=e.user_id AND UPPER(u.status)='ACTIVE'
           WHERE e.school_id=$1 AND e.id=ANY($2::int[]) AND e.employment_status='ACTIVE'`
        : `SELECT id FROM school_security_visitors WHERE school_id=$1 AND id=ANY($2::int[])`;
    const found = await pool.query<{ id: number }>(query, [schoolId, ids]);
    if (new Set(found.rows.map((row) => Number(row.id))).size !== ids.length) {
      throw new AuthError(404, `Involved ${personType.toLowerCase()} not found in this school`);
    }
  }
}

async function saveHistory(
  client: Queryable,
  req: Request,
  schoolId: number,
  studentId: number | null,
  entityType: "VISITOR" | "PICKUP_PERSON" | "PICKUP_REQUEST" | "INCIDENT",
  entityId: number,
  revision: number,
  eventType: string,
  snapshot: Record<string, unknown>,
  result = "SUCCESS",
): Promise<void> {
  await client.query(
    `INSERT INTO school_security_operation_history
      (school_id,student_id,entity_type,entity_id,revision,event_type,actor_user_id,result,snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    [schoolId, studentId, entityType, entityId, revision, eventType, getUserContext(req).user.id, result, JSON.stringify(snapshot)],
  );
}

async function audit(
  client: Queryable,
  req: Request,
  schoolId: number,
  action: string,
  entityId: number,
  metadata: Record<string, string | number | boolean | null> = {},
): Promise<void> {
  const context = getUserContext(req);
  await client.query(
    `INSERT INTO audit_logs
      ("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,event_type,result,metadata)
     VALUES ($1,$2,$3,$4,$5,$6,'School Security',$7,'SCHOOL_SECURITY_OPERATION','SUCCESS',$8::jsonb)`,
    [
      [context.user.firstName, context.user.lastName].filter(Boolean).join(" ") || context.user.email,
      context.roles.find((role) => role.status === "ACTIVE" && role.schoolId === schoolId)?.role ?? "STAFF",
      context.user.id,
      context.user.clerkUserId,
      schoolId,
      action,
      entityId,
      JSON.stringify(metadata),
    ],
  );
}

async function assertOperationRateLimit(
  client: Queryable,
  req: Request,
  schoolId: number,
  action: string,
  maximum: number,
  windowSeconds: number,
): Promise<void> {
  const actorId = getUserContext(req).user.id;
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `security-rate:${schoolId}:${actorId}:${action}`,
  ]);
  const recent = await client.query<{ count: number | string }>(
    `SELECT COUNT(*)::int AS count FROM audit_logs
      WHERE actor_user_id=$1 AND school_id=$2 AND action=$3 AND result='SUCCESS'
        AND "timestamp" >= now()-($4::integer * interval '1 second')`,
    [actorId, schoolId, action, windowSeconds],
  );
  if (Number(recent.rows[0]?.count ?? 0) >= maximum) {
    throw new OperationRateLimitError("School security operation rate limit reached", windowSeconds);
  }
}

async function queueFamilyNotification(
  client: Queryable,
  schoolId: number,
  studentId: number,
  eventKey: string,
  subject: string,
  body: string,
): Promise<void> {
  const recipients = await client.query<{ userId: number }>(
    `SELECT DISTINCT p.user_id AS "userId"
       FROM parents p
       JOIN parent_student_relationships psr ON psr.parent_id=p.id
        AND psr.student_id=$2 AND UPPER(psr.status)='ACTIVE'
       JOIN students st ON st.id=psr.student_id AND st.school_id=p.school_id
        AND UPPER(st.status)='ACTIVE'
       JOIN app_users au ON au.id=p.user_id AND UPPER(au.status)='ACTIVE'
      WHERE p.school_id=$1 AND UPPER(p.status)='ACTIVE' AND p.user_id IS NOT NULL`,
    [schoolId, studentId],
  );
  for (const recipient of recipients.rows) {
    await queueCommunicationNotification(client, {
      recipientUserId: Number(recipient.userId),
      schoolId,
      subjectStudentId: studentId,
      category: "SECURITY",
      eventKey,
      subject,
      body,
      link: "/parent/communication",
      channels: ["IN_APP"],
    });
  }
}

function listWindow(req: Request) {
  const limit = Math.min(100, Math.max(1, queryPositiveId(req.query.limit, 50, "limit")));
  const offset = queryPositiveId(req.query.offset, 0, "offset");
  return { limit, offset };
}

function optionalDateFilter(value: unknown, label: string): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new AuthError(400, `${label} must be a valid date`);
  }
  return new Date(value).toISOString();
}

function asyncRoute(
  handler: (req: Request, res: Response) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) =>
    handler(req, res).catch((error) => {
      if (error instanceof OperationRateLimitError) {
        res.setHeader("Retry-After", String(error.retryAfterSeconds));
        return res.status(429).json({ error: error.message, code: "RATE_LIMITED" });
      }
      return handleAuthError(error, req, res, next);
    });
}

/**
 * All staff access is delegated to the security-core permission service. This
 * module stores operations and history without adding a separate grant system.
 */
export function createSchoolSecurityOperationsRouter() {
  const router = Router();
  router.use(requireAuthentication());

  // Visitor registry, check-in, amendment and explicit check-out.
  router.get("/schools/:schoolId/security/visitors", asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    await assertOperationsPermission(req, schoolId, "VISITOR_MANAGE");
    const { limit, offset } = listWindow(req);
    const from = optionalDateFilter(req.query.from, "from");
    const to = optionalDateFilter(req.query.to, "to");
    if (from && to && from > to) throw new AuthError(400, "from must be earlier than to");
    const status = req.query.status;
    if (status !== undefined && status !== "ON_SITE" && status !== "CHECKED_OUT") {
      throw new AuthError(400, "status is not a supported visitor filter");
    }
    const listed = await pool.query(
      `SELECT ${visitorSelect} FROM school_security_visitors
        WHERE school_id=$1 AND ($2::text IS NULL OR status=$2)
          AND ($3::timestamptz IS NULL OR checked_in_at >= $3)
          AND ($4::timestamptz IS NULL OR checked_in_at <= $4)
        ORDER BY checked_in_at DESC,id DESC LIMIT $5 OFFSET $6`,
      [schoolId, status ?? null, from, to, limit, offset],
    );
    res.json(listed.rows.map((row) => visitorOutputSchema.parse(row)));
  }));

  router.post("/schools/:schoolId/security/visitors", asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const context = await assertOperationsPermission(req, schoolId, "VISITOR_MANAGE");
    const input = parseInput(visitorInputSchema, req.body);
    if (input.hostStudentId != null) await assertSchoolStudent(schoolId, input.hostStudentId);
    await assertLocationAndDeviceScope(schoolId, input.securityLocationId, input.securityDeviceId);
    const created = await withTransaction(async (client) => {
      await assertOperationRateLimit(client, req, schoolId, "VISITOR_CHECKED_IN", 20, 600);
      const result = await client.query(
        `INSERT INTO school_security_visitors
          (school_id,visitor_name,phone,id_reference,purpose,host_name,host_student_id,notes,
           security_officer_user_id,security_location_id,security_device_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING ${visitorSelect}`,
        [
          schoolId, input.visitorName, input.phone ?? null, input.idReference ?? null, input.purpose,
          input.hostName ?? null, input.hostStudentId ?? null, input.notes ?? null, context.user.id,
          input.securityLocationId ?? null, input.securityDeviceId ?? null,
        ],
      );
      const visitor = visitorOutputSchema.parse(result.rows[0]);
      await saveHistory(client, req, schoolId, input.hostStudentId ?? null, "VISITOR",
        visitor.id, visitor.version, "VISITOR_CHECKED_IN", visitor as unknown as Record<string, unknown>);
      await audit(client, req, schoolId, "VISITOR_CHECKED_IN", visitor.id, { version: visitor.version });
      return visitor;
    });
    res.status(201).json(created);
  }));

  router.patch("/schools/:schoolId/security/visitors/:visitorId", asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const visitorId = positiveId(req.params.visitorId, "Visitor");
    await assertOperationsPermission(req, schoolId, "VISITOR_MANAGE");
    const input = parseInput(visitorPatchSchema, req.body);
    if (input.hostStudentId != null) await assertSchoolStudent(schoolId, input.hostStudentId);
    const fields: Record<string, string> = {
      visitorName: "visitor_name", phone: "phone", idReference: "id_reference",
      purpose: "purpose", hostName: "host_name", hostStudentId: "host_student_id", notes: "notes",
    };
    const updated = await withTransaction(async (client) => {
      const current = await client.query(
        `SELECT ${visitorSelect} FROM school_security_visitors
          WHERE id=$1 AND school_id=$2 FOR UPDATE`,
        [visitorId, schoolId],
      );
      const prior = current.rows[0] as Record<string, unknown> | undefined;
      if (!prior) throw new AuthError(404, "Visitor not found");
      if (Number(prior.version) !== input.expectedVersion) throw new AuthError(409, "Visitor version is stale");
      if (prior.status !== "ON_SITE") throw new AuthError(409, "Checked-out visitor records cannot be edited");
      const values: unknown[] = [visitorId, schoolId];
      const changes = Object.entries(fields).filter(([key]) => Object.hasOwn(input, key));
      const assignments = changes.map(([key, column]) => {
        values.push(input[key as keyof typeof input] ?? null);
        return `${column}=$${values.length}`;
      });
      values.push(input.expectedVersion);
      const saved = await client.query(
        `UPDATE school_security_visitors SET ${assignments.join(",")},version=version+1,updated_at=now()
          WHERE id=$1 AND school_id=$2 AND status='ON_SITE' AND version=$${values.length}
          RETURNING ${visitorSelect}`,
        values,
      );
      const visitor = visitorOutputSchema.parse(saved.rows[0]);
      await saveHistory(client, req, schoolId, visitor.hostStudentId, "VISITOR",
        visitor.id, visitor.version, "VISITOR_UPDATED", visitor as unknown as Record<string, unknown>);
      await audit(client, req, schoolId, "VISITOR_UPDATED", visitor.id, { version: visitor.version });
      return visitor;
    });
    res.json(updated);
  }));

  router.post("/schools/:schoolId/security/visitors/:visitorId/checkout", asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const visitorId = positiveId(req.params.visitorId, "Visitor");
    await assertOperationsPermission(req, schoolId, "VISITOR_MANAGE");
    const key = idempotencyKey(req);
    const version = expectedVersion((req.body as Record<string, unknown> | undefined)?.expectedVersion);
    const checkedOut = await withTransaction(async (client) => {
      const current = await client.query(
        `SELECT ${visitorSelect},checkout_idempotency_key AS "checkoutIdempotencyKey"
           FROM school_security_visitors WHERE id=$1 AND school_id=$2 FOR UPDATE`,
        [visitorId, schoolId],
      );
      const prior = current.rows[0] as (Record<string, unknown> & { checkoutIdempotencyKey?: string | null }) | undefined;
      if (!prior) throw new AuthError(404, "Visitor not found");
      if (prior.status === "CHECKED_OUT") {
        if (prior.checkoutIdempotencyKey === key) {
          const { checkoutIdempotencyKey: _key, ...snapshot } = prior;
          return visitorOutputSchema.parse(snapshot);
        }
        throw new AuthError(409, "Visitor has already been checked out");
      }
      if (Number(prior.version) !== version) throw new AuthError(409, "Visitor version is stale");
      const updated = await client.query(
        `UPDATE school_security_visitors SET status='CHECKED_OUT',checked_out_at=now(),
           checkout_idempotency_key=$3,version=version+1,updated_at=now()
          WHERE id=$1 AND school_id=$2 AND status='ON_SITE' AND version=$4
          RETURNING ${visitorSelect}`,
        [visitorId, schoolId, key, version],
      );
      const visitor = visitorOutputSchema.parse(updated.rows[0]);
      await saveHistory(client, req, schoolId, visitor.hostStudentId, "VISITOR",
        visitor.id, visitor.version, "VISITOR_CHECKED_OUT", visitor as unknown as Record<string, unknown>);
      await audit(client, req, schoolId, "VISITOR_CHECKED_OUT", visitor.id, { version: visitor.version });
      return visitor;
    });
    res.json(checkedOut);
  }));

  router.get("/schools/:schoolId/security/visitors/:visitorId/history", asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const visitorId = positiveId(req.params.visitorId, "Visitor");
    await assertOperationsPermission(req, schoolId, "VISITOR_MANAGE");
    const result = await pool.query(
      `SELECT h.id,h.entity_type AS "entityType",h.entity_id AS "entityId",h.revision,
          h.event_type AS "eventType",h.actor_user_id AS "actorUserId",h.result,h.snapshot,h.created_at AS "createdAt"
         FROM school_security_operation_history h JOIN school_security_visitors v
           ON v.id=h.entity_id AND v.school_id=h.school_id
        WHERE h.school_id=$1 AND h.entity_type='VISITOR' AND h.entity_id=$2
        ORDER BY h.revision ASC LIMIT 500`,
      [schoolId, visitorId],
    );
    res.json(result.rows);
  }));

  // Parents can only manage nominations/requests tied to a current active child link.
  router.get("/parent/children/:studentId/security/pickup-persons", asyncRoute(async (req, res) => {
    const studentId = positiveId(req.params.studentId, "Student");
    const scope = await requireParentStudent(req, studentId);
    const rows = await pool.query(
      `SELECT ${pickupPersonSelect} FROM school_authorized_pickup_persons
        WHERE school_id=$1 AND student_id=$2 AND nominated_by_parent_id=$3
        ORDER BY requested_at DESC,id DESC LIMIT 100`,
      [scope.schoolId, studentId, scope.parentId],
    );
    res.json(rows.rows.map((row) => pickupPersonOutputSchema.parse(row)));
  }));

  router.post("/parent/children/:studentId/security/pickup-persons", asyncRoute(async (req, res) => {
    const studentId = positiveId(req.params.studentId, "Student");
    const scope = await requireParentStudent(req, studentId);
    const input = parseInput(pickupPersonInputSchema, req.body);
    const created = await withTransaction(async (client) => {
      await assertParentStudentInTransaction(client, req, scope, studentId);
      await assertOperationRateLimit(client, req, scope.schoolId, "PICKUP_PERSON_NOMINATED", 5, 86400);
      const result = await client.query(
        `INSERT INTO school_authorized_pickup_persons
          (school_id,student_id,nominated_by_parent_id,full_name,phone,relationship,identity_reference,valid_from,valid_until)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING ${pickupPersonSelect}`,
        [
          scope.schoolId, studentId, scope.parentId, input.fullName, input.phone, input.relationship ?? null,
          input.identityReference ?? null, input.validFrom ?? null, input.validUntil ?? null,
        ],
      );
      const person = pickupPersonOutputSchema.parse(result.rows[0]);
      await saveHistory(client, req, scope.schoolId, studentId, "PICKUP_PERSON",
        person.id, person.version, "PICKUP_PERSON_NOMINATED", person as unknown as Record<string, unknown>);
      await audit(client, req, scope.schoolId, "PICKUP_PERSON_NOMINATED", person.id, { studentId });
      return person;
    });
    res.status(201).json(created);
  }));

  router.get("/schools/:schoolId/students/:studentId/security/pickup-persons", asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const studentId = positiveId(req.params.studentId, "Student");
    await assertOperationsPermission(req, schoolId, "PICKUP_APPROVE");
    await assertSchoolStudent(schoolId, studentId);
    const rows = await pool.query(
      `SELECT ${pickupPersonSelect} FROM school_authorized_pickup_persons
        WHERE school_id=$1 AND student_id=$2 ORDER BY requested_at DESC,id DESC LIMIT 200`,
      [schoolId, studentId],
    );
    res.json(rows.rows.map((row) => pickupPersonOutputSchema.parse(row)));
  }));

  router.post("/schools/:schoolId/students/:studentId/security/pickup-persons/:personId/decision", asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const studentId = positiveId(req.params.studentId, "Student");
    const personId = positiveId(req.params.personId, "Pickup person");
    const context = await assertOperationsPermission(req, schoolId, "PICKUP_APPROVE");
    await assertSchoolStudent(schoolId, studentId);
    const input = parseInput(pickupPersonDecisionInputSchema, req.body);
    const status = input.decision === "APPROVE" ? "APPROVED" : input.decision === "REJECT" ? "REJECTED" : "REVOKED";
    const updated = await withTransaction(async (client) => {
      const current = await client.query(
        `SELECT ${pickupPersonSelect} FROM school_authorized_pickup_persons
          WHERE id=$1 AND school_id=$2 AND student_id=$3 FOR UPDATE`,
        [personId, schoolId, studentId],
      );
      const prior = current.rows[0] as Record<string, unknown> | undefined;
      if (!prior) throw new AuthError(404, "Pickup person not found");
      if (Number(prior.version) !== input.expectedVersion) throw new AuthError(409, "Pickup person version is stale");
      if (input.decision === "APPROVE") {
        const activeNominatorLink = await client.query(
          `SELECT 1
             FROM school_authorized_pickup_persons pp
             JOIN parents p ON p.id=pp.nominated_by_parent_id AND p.school_id=pp.school_id
               AND UPPER(p.status)='ACTIVE'
             JOIN app_users u ON u.id=p.user_id AND UPPER(u.status)='ACTIVE'
             JOIN parent_student_relationships psr ON psr.parent_id=p.id
               AND psr.student_id=pp.student_id AND UPPER(psr.status)='ACTIVE'
             JOIN students st ON st.id=psr.student_id AND st.school_id=p.school_id
               AND UPPER(st.status)='ACTIVE'
            WHERE pp.id=$1 AND pp.school_id=$2 AND pp.student_id=$3
            LIMIT 1 FOR SHARE OF p,u,psr,st`,
          [personId, schoolId, studentId],
        );
        if (!activeNominatorLink.rows[0]) {
          throw new AuthError(409, "Pickup nomination is no longer attached to an active parent-child relationship");
        }
      }
      if ((input.decision === "APPROVE" || input.decision === "REJECT") && prior.status !== "PENDING") {
        throw new AuthError(409, "Only a pending pickup-person nomination can be decided");
      }
      if (input.decision === "REVOKE" && prior.status !== "APPROVED") {
        throw new AuthError(409, "Only an approved pickup person can be revoked");
      }
      const result = await client.query(
        `UPDATE school_authorized_pickup_persons SET status=$4,decision_by_user_id=$5,decision_reason=$6,decided_at=now(),
            version=version+1,updated_at=now()
          WHERE id=$1 AND school_id=$2 AND student_id=$3 AND version=$7
          RETURNING ${pickupPersonSelect}`,
        [personId, schoolId, studentId, status, context.user.id, input.reason ?? null, input.expectedVersion],
      );
      const person = pickupPersonOutputSchema.parse(result.rows[0]);
      const eventType = input.decision === "REVOKE" ? "PICKUP_PERSON_REVOKED" : `PICKUP_PERSON_${status}`;
      await saveHistory(client, req, schoolId, studentId, "PICKUP_PERSON",
        personId, person.version, eventType, person as unknown as Record<string, unknown>);
      await audit(client, req, schoolId, eventType, personId, { studentId, version: person.version });
      await queueFamilyNotification(
        client, schoolId, studentId, `school-security:pickup-person:${personId}:v${person.version}`,
        "Pickup-person nomination update",
        "A pickup-person nomination for your child has been reviewed.",
      );
      return person;
    });
    res.json(updated);
  }));

  router.post("/parent/children/:studentId/security/pickup-requests", asyncRoute(async (req, res) => {
    const studentId = positiveId(req.params.studentId, "Student");
    const scope = await requireParentStudent(req, studentId);
    const input = parseInput(pickupRequestInputSchema, req.body);
    const pickupTime = new Date(input.requestedPickupAt);
    if (pickupTime.getTime() < Date.now() ||
        pickupTime.getTime() > Date.now() + 90 * 24 * 60 * 60 * 1000) {
      throw new AuthError(400, "Requested pickup time must be now or later and no more than 90 days ahead");
    }
    const validFrom = new Date(pickupTime.getTime() - 30 * 60 * 1000);
    const validUntil = new Date(pickupTime.getTime() + 3 * 60 * 60 * 1000);
    const created = await withTransaction(async (client) => {
      await assertParentStudentInTransaction(client, req, scope, studentId);
      await assertOperationRateLimit(client, req, scope.schoolId, "PICKUP_REQUESTED", 10, 86400);
      const person = await client.query(
        `SELECT id FROM school_authorized_pickup_persons
          WHERE id=$1 AND school_id=$2 AND student_id=$3 AND status='APPROVED'
            AND (valid_from IS NULL OR valid_from <= $4)
            AND (valid_until IS NULL OR valid_until >= $4)
          LIMIT 1`,
        [input.pickupPersonId, scope.schoolId, studentId, pickupTime],
      );
      if (!person.rows[0]) throw new AuthError(409, "Pickup person is not approved or is not valid at the requested time");
      const result = await client.query(
        `INSERT INTO school_pickup_requests
          (school_id,student_id,requested_by_parent_id,pickup_person_id,requested_pickup_at,valid_from,valid_until,reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING ${pickupRequestSelect}`,
        [scope.schoolId, studentId, scope.parentId, input.pickupPersonId, pickupTime, validFrom, validUntil, input.reason ?? null],
      );
      const request = pickupRequestOutputSchema.parse(result.rows[0]);
      await saveHistory(client, req, scope.schoolId, studentId, "PICKUP_REQUEST",
        request.id, request.version, "PICKUP_REQUESTED", request as unknown as Record<string, unknown>);
      await audit(client, req, scope.schoolId, "PICKUP_REQUESTED", request.id, { studentId });
      return request;
    });
    res.status(201).json(created);
  }));

  router.get("/parent/children/:studentId/security/pickup-requests", asyncRoute(async (req, res) => {
    const studentId = positiveId(req.params.studentId, "Student");
    const scope = await requireParentStudent(req, studentId);
    const { limit, offset } = listWindow(req);
    const rows = await pool.query(
      `SELECT ${pickupRequestSelect} FROM school_pickup_requests
        WHERE school_id=$1 AND student_id=$2 AND requested_by_parent_id=$3
        ORDER BY created_at DESC,id DESC LIMIT $4 OFFSET $5`,
      [scope.schoolId, studentId, scope.parentId, limit, offset],
    );
    res.json(rows.rows.map((row) => pickupRequestOutputSchema.parse(row)));
  }));

  router.get("/schools/:schoolId/students/:studentId/security/pickup-requests", asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const studentId = positiveId(req.params.studentId, "Student");
    await assertOperationsPermission(req, schoolId, "PICKUP_APPROVE");
    await assertSchoolStudent(schoolId, studentId);
    const { limit, offset } = listWindow(req);
    const status = req.query.status;
    if (status !== undefined && !["PENDING", "APPROVED", "REJECTED", "CANCELLED", "REFUSED", "COMPLETED"].includes(String(status))) {
      throw new AuthError(400, "status is not a supported pickup-request filter");
    }
    const rows = await pool.query(
      `SELECT ${pickupRequestSelect} FROM school_pickup_requests
        WHERE school_id=$1 AND student_id=$2 AND ($3::text IS NULL OR status=$3)
        ORDER BY created_at DESC,id DESC LIMIT $4 OFFSET $5`,
      [schoolId, studentId, status ?? null, limit, offset],
    );
    res.json(rows.rows.map((row) => pickupRequestOutputSchema.parse(row)));
  }));

  router.post("/schools/:schoolId/students/:studentId/security/pickup-requests/:requestId/decision", asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const studentId = positiveId(req.params.studentId, "Student");
    const requestId = positiveId(req.params.requestId, "Pickup request");
    const context = await assertOperationsPermission(req, schoolId, "PICKUP_APPROVE");
    await assertSchoolStudent(schoolId, studentId);
    const input = parseInput(pickupDecisionInputSchema, req.body);
    const status = input.decision === "APPROVE" ? "APPROVED" : "REJECTED";
    const updated = await withTransaction(async (client) => {
      const current = await client.query(
        `SELECT ${pickupRequestSelect} FROM school_pickup_requests
          WHERE id=$1 AND school_id=$2 AND student_id=$3 FOR UPDATE`,
        [requestId, schoolId, studentId],
      );
      const prior = current.rows[0] as Record<string, unknown> | undefined;
      if (!prior) throw new AuthError(404, "Pickup request not found");
      if (Number(prior.version) !== input.expectedVersion) throw new AuthError(409, "Pickup request version is stale");
      if (prior.status !== "PENDING") throw new AuthError(409, "Only pending pickup requests can be approved or rejected");
      const activeParentLink = await client.query(
        `SELECT 1 FROM parents p
          JOIN parent_student_relationships psr ON psr.parent_id=p.id
           AND psr.student_id=$2 AND UPPER(psr.status)='ACTIVE'
          JOIN students st ON st.id=psr.student_id AND st.school_id=p.school_id
           AND UPPER(st.status)='ACTIVE'
         WHERE p.id=$1 AND p.school_id=$3 AND UPPER(p.status)='ACTIVE'
         LIMIT 1`,
        [Number(prior.requestedByParentId), studentId, schoolId],
      );
      if (!activeParentLink.rows[0]) throw new AuthError(409, "Pickup request is no longer attached to an active parent-child relationship");
      const saved = await client.query(
        `UPDATE school_pickup_requests SET status=$4,decision_by_user_id=$5,decision_reason=$6,
            decided_at=now(),version=version+1,updated_at=now()
          WHERE id=$1 AND school_id=$2 AND student_id=$3 AND status='PENDING' AND version=$7
          RETURNING ${pickupRequestSelect}`,
        [requestId, schoolId, studentId, status, context.user.id, input.reason, input.expectedVersion],
      );
      const request = pickupRequestOutputSchema.parse(saved.rows[0]);
      await saveHistory(client, req, schoolId, studentId, "PICKUP_REQUEST",
        requestId, request.version, `PICKUP_${status}`, request as unknown as Record<string, unknown>);
      await audit(client, req, schoolId, `PICKUP_${status}`, requestId, { studentId, version: request.version });
      await queueFamilyNotification(
        client,
        schoolId,
        studentId,
        `school-security:pickup-decision:${requestId}:v${request.version}`,
        "Pickup request update",
        "A pickup request for your child has been reviewed by the school.",
      );
      return request;
    });
    res.json(updated);
  }));

  router.post("/parent/children/:studentId/security/pickup-requests/:requestId/cancel", asyncRoute(async (req, res) => {
    const studentId = positiveId(req.params.studentId, "Student");
    const requestId = positiveId(req.params.requestId, "Pickup request");
    const scope = await requireParentStudent(req, studentId);
    const input = parseInput(pickupCancelInputSchema, req.body);
    const canceled = await withTransaction(async (client) => {
      await assertParentStudentInTransaction(client, req, scope, studentId);
      const saved = await client.query(
        `UPDATE school_pickup_requests SET status='CANCELLED',decision_reason=$6,
            version=version+1,updated_at=now()
          WHERE id=$1 AND school_id=$2 AND student_id=$3 AND requested_by_parent_id=$4
            AND status IN ('PENDING','APPROVED') AND version=$5
          RETURNING ${pickupRequestSelect}`,
        [requestId, scope.schoolId, studentId, scope.parentId, input.expectedVersion, input.reason ?? null],
      );
      const request = saved.rows[0];
      if (!request) throw new AuthError(409, "Pickup request is stale, unavailable, or no longer cancellable");
      const parsed = pickupRequestOutputSchema.parse(request);
      await saveHistory(client, req, scope.schoolId, studentId, "PICKUP_REQUEST",
        requestId, parsed.version, "PICKUP_CANCELLED", parsed as unknown as Record<string, unknown>);
      await audit(client, req, scope.schoolId, "PICKUP_CANCELLED", requestId, { studentId, version: parsed.version });
      return parsed;
    });
    res.json(canceled);
  }));

  router.post("/schools/:schoolId/students/:studentId/security/pickup-requests/:requestId/refuse", asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const studentId = positiveId(req.params.studentId, "Student");
    const requestId = positiveId(req.params.requestId, "Pickup request");
    const context = await assertOperationsPermission(req, schoolId, "PICKUP_APPROVE");
    await assertSchoolStudent(schoolId, studentId);
    const input = parseInput(pickupCancelInputSchema, req.body);
    const refused = await withTransaction(async (client) => {
      const updated = await client.query(
        `UPDATE school_pickup_requests SET status='REFUSED',decision_by_user_id=$5,decision_reason=$6,
            decided_at=now(),version=version+1,updated_at=now()
          WHERE id=$1 AND school_id=$2 AND student_id=$3 AND status='APPROVED' AND version=$4
          RETURNING ${pickupRequestSelect}`,
        [requestId, schoolId, studentId, input.expectedVersion, context.user.id, input.reason ?? "Pickup was refused at school"],
      );
      if (!updated.rows[0]) throw new AuthError(409, "Only a current approved pickup request can be refused");
      const request = pickupRequestOutputSchema.parse(updated.rows[0]);
      await saveHistory(client, req, schoolId, studentId, "PICKUP_REQUEST",
        requestId, request.version, "PICKUP_REFUSED", request as unknown as Record<string, unknown>);
      await audit(client, req, schoolId, "PICKUP_REFUSED", requestId, { studentId });
      return request;
    });
    res.json(refused);
  }));

  router.post("/schools/:schoolId/students/:studentId/security/pickup-requests/:requestId/completion", asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const studentId = positiveId(req.params.studentId, "Student");
    const requestId = positiveId(req.params.requestId, "Pickup request");
    const context = await assertOperationsPermission(req, schoolId, "PICKUP_APPROVE");
    await assertSchoolStudent(schoolId, studentId);
    const input = parseInput(pickupCompletionInputSchema, req.body);
    const key = idempotencyKey(req);
    const request = await withTransaction(async (client) => {
      const current = await client.query(
        `SELECT ${pickupRequestSelect},completion_idempotency_key AS "completionIdempotencyKey"
           FROM school_pickup_requests WHERE id=$1 AND school_id=$2 AND student_id=$3 FOR UPDATE`,
        [requestId, schoolId, studentId],
      );
      const prior = current.rows[0] as (Record<string, unknown> & { completionIdempotencyKey?: string | null }) | undefined;
      if (!prior) throw new AuthError(404, "Pickup request not found");
      if (prior.status === "COMPLETED") {
        if (prior.completionIdempotencyKey === key) {
          const { completionIdempotencyKey: _key, ...snapshot } = prior;
          return pickupRequestOutputSchema.parse(snapshot);
        }
        throw new AuthError(409, "Pickup request has already been completed");
      }
      if (prior.status !== "APPROVED") throw new AuthError(409, "Only an approved pickup request can be completed");
      if (Number(prior.version) !== input.expectedVersion) throw new AuthError(409, "Pickup request version is stale");
      if (Number(prior.pickupPersonId) !== input.pickupPersonId) {
        throw new AuthError(409, "Completion pickup person does not match the approved request");
      }
      const person = await client.query(
        `SELECT id FROM school_authorized_pickup_persons
          WHERE id=$1 AND school_id=$2 AND student_id=$3 AND status='APPROVED'
            AND (valid_from IS NULL OR valid_from <= now())
            AND (valid_until IS NULL OR valid_until >= now())
          LIMIT 1 FOR SHARE`,
        [input.pickupPersonId, schoolId, studentId],
      );
      if (!person.rows[0]) throw new AuthError(409, "Pickup person is not currently approved or valid");
      const activeParentLink = await client.query(
        `SELECT 1 FROM parents p
          JOIN app_users au ON au.id=p.user_id AND UPPER(au.status)='ACTIVE'
          JOIN parent_student_relationships psr ON psr.parent_id=p.id
           AND psr.student_id=$2 AND UPPER(psr.status)='ACTIVE'
          JOIN students st ON st.id=psr.student_id AND st.school_id=p.school_id
           AND UPPER(st.status)='ACTIVE'
         WHERE p.id=$1 AND p.school_id=$3 AND UPPER(p.status)='ACTIVE'
         LIMIT 1 FOR SHARE OF p,au,psr,st`,
        [Number(prior.requestedByParentId), studentId, schoolId],
      );
      if (!activeParentLink.rows[0]) throw new AuthError(409, "Pickup request is no longer attached to an active parent-child relationship");
      const exitEvent = await client.query(
        `SELECT id FROM security_events
          WHERE id=$1 AND school_id=$2 AND student_id=$3 AND person_type='STUDENT'
            AND event_type='EXIT' AND identity_result='CONFIRMED'
            AND occurred_at >= $4 AND occurred_at <= $5 AND occurred_at <= now()
          LIMIT 1 FOR SHARE`,
        [input.recordedSecurityEventId, schoolId, studentId, prior.validFrom, prior.validUntil],
      );
      if (!exitEvent.rows[0]) {
        throw new AuthError(409, "A verified, recorded student-exit security event is required");
      }
      const saved = await client.query(
        `UPDATE school_pickup_requests SET status='COMPLETED',completed_at=now(),completed_by_user_id=$5,
            completion_pickup_person_id=$6,recorded_security_event_id=$7,completion_idempotency_key=$8,
            version=version+1,updated_at=now()
          WHERE id=$1 AND school_id=$2 AND student_id=$3 AND status='APPROVED' AND version=$4
            AND requested_by_parent_id=$9 AND valid_from <= now() AND valid_until >= now()
          RETURNING ${pickupRequestSelect}`,
        [
          requestId, schoolId, studentId, input.expectedVersion, context.user.id,
          input.pickupPersonId, input.recordedSecurityEventId, key, Number(prior.requestedByParentId),
        ],
      );
      if (!saved.rows[0]) throw new AuthError(409, "Pickup request is stale or outside its approved release window");
      const completed = pickupRequestOutputSchema.parse(saved.rows[0]);
      await saveHistory(client, req, schoolId, studentId, "PICKUP_REQUEST",
        requestId, completed.version, "PICKUP_COMPLETED", completed as unknown as Record<string, unknown>);
      await audit(client, req, schoolId, "PICKUP_COMPLETED", requestId, {
        studentId, version: completed.version, recordedSecurityEventId: input.recordedSecurityEventId,
      });
      await queueFamilyNotification(
        client,
        schoolId,
        studentId,
        `security-event:${input.recordedSecurityEventId}`,
        "Student release update",
        "An approved pickup request for your child has been completed at school.",
      );
      return completed;
    });
    res.json(request);
  }));

  router.get("/schools/:schoolId/students/:studentId/security/pickup-requests/:requestId/history", asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const studentId = positiveId(req.params.studentId, "Student");
    const requestId = positiveId(req.params.requestId, "Pickup request");
    await assertOperationsPermission(req, schoolId, "PICKUP_APPROVE");
    const result = await pool.query(
      `SELECT id,revision,event_type AS "eventType",actor_user_id AS "actorUserId",
          result,snapshot,created_at AS "createdAt"
         FROM school_security_operation_history
        WHERE school_id=$1 AND student_id=$2 AND entity_type='PICKUP_REQUEST' AND entity_id=$3
        ORDER BY revision ASC LIMIT 500`,
      [schoolId, studentId, requestId],
    );
    res.json(result.rows);
  }));

  // Security incidents are school-restricted and never exposed through the parent surface.
  router.get("/schools/:schoolId/security/incidents", asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    await assertOperationsPermission(req, schoolId, "INCIDENT_MANAGE");
    const { limit, offset } = listWindow(req);
    const from = optionalDateFilter(req.query.from, "from");
    const to = optionalDateFilter(req.query.to, "to");
    if (from && to && from > to) throw new AuthError(400, "from must be earlier than to");
    const status = req.query.status;
    if (status !== undefined && !["OPEN", "INVESTIGATING", "RESOLVED"].includes(String(status))) {
      throw new AuthError(400, "status is not a supported incident filter");
    }
    const rows = await pool.query(
      `SELECT ${incidentSelect} FROM school_security_incidents
        WHERE school_id=$1 AND ($2::text IS NULL OR status=$2)
          AND ($3::timestamptz IS NULL OR occurred_at >= $3)
          AND ($4::timestamptz IS NULL OR occurred_at <= $4)
        ORDER BY occurred_at DESC,id DESC LIMIT $5 OFFSET $6`,
      [schoolId, status ?? null, from, to, limit, offset],
    );
    res.json(rows.rows.map((row) => incidentOutputSchema.parse(row)));
  }));

  router.post("/schools/:schoolId/security/incidents", asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const context = await assertOperationsPermission(req, schoolId, "INCIDENT_MANAGE");
    const input = parseInput(incidentInputSchema, req.body);
    if (input.studentId != null) await assertSchoolStudent(schoolId, input.studentId);
    await assertIncidentPeopleScope(schoolId, input.involvedPersons);
    await assertLocationAndDeviceScope(schoolId, input.securityLocationId, input.securityDeviceId);
    if (input.assignedStaffUserId != null) {
      const staff = await pool.query(
        `SELECT 1 FROM school_memberships sm
          JOIN app_users au ON au.id=sm.user_id AND UPPER(au.status)='ACTIVE'
         WHERE sm.user_id=$1 AND sm.school_id=$2 AND sm.status='ACTIVE'
           AND sm.role IN ('SCHOOL_ADMIN','STAFF')
         LIMIT 1`,
        [input.assignedStaffUserId, schoolId],
      );
      if (!staff.rows[0]) throw new AuthError(400, "Assigned person must be active school staff");
    }
    const created = await withTransaction(async (client) => {
      await assertOperationRateLimit(client, req, schoolId, "SECURITY_INCIDENT_CREATED", 20, 600);
      const saved = await client.query(
        `INSERT INTO school_security_incidents
          (school_id,incident_type,occurred_at,security_location_id,security_device_id,student_id,
           involved_persons,assigned_staff_user_id,description,severity,created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)
         RETURNING ${incidentSelect}`,
        [
          schoolId, input.incidentType, input.occurredAt, input.securityLocationId ?? null,
          input.securityDeviceId ?? null, input.studentId ?? null, JSON.stringify(input.involvedPersons),
          input.assignedStaffUserId ?? null, input.description, input.severity, context.user.id,
        ],
      );
      const incident = incidentOutputSchema.parse(saved.rows[0]);
      await saveHistory(client, req, schoolId, input.studentId ?? null, "INCIDENT",
        incident.id, incident.version, "INCIDENT_CREATED", incident as unknown as Record<string, unknown>);
      await audit(client, req, schoolId, "SECURITY_INCIDENT_CREATED", incident.id, {
        studentId: incident.studentId, severity: incident.severity,
      });
      return incident;
    });
    res.status(201).json(created);
  }));

  router.patch("/schools/:schoolId/security/incidents/:incidentId", asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const incidentId = positiveId(req.params.incidentId, "Incident");
    const context = await assertOperationsPermission(req, schoolId, "INCIDENT_MANAGE");
    const input = parseInput(incidentPatchSchema, req.body);
    if (input.involvedPersons) await assertIncidentPeopleScope(schoolId, input.involvedPersons);
    if (input.assignedStaffUserId != null) {
      const staff = await pool.query(
        `SELECT 1 FROM school_memberships sm
          JOIN app_users au ON au.id=sm.user_id AND UPPER(au.status)='ACTIVE'
         WHERE sm.user_id=$1 AND sm.school_id=$2 AND sm.status='ACTIVE'
           AND sm.role IN ('SCHOOL_ADMIN','STAFF') LIMIT 1`,
        [input.assignedStaffUserId, schoolId],
      );
      if (!staff.rows[0]) throw new AuthError(400, "Assigned person must be active school staff");
    }
    const saved = await withTransaction(async (client) => {
      const current = await client.query(
        `SELECT ${incidentSelect} FROM school_security_incidents
          WHERE id=$1 AND school_id=$2 FOR UPDATE`,
        [incidentId, schoolId],
      );
      const prior = current.rows[0] as Record<string, unknown> | undefined;
      if (!prior) throw new AuthError(404, "Security incident not found");
      if (Number(prior.version) !== input.expectedVersion) throw new AuthError(409, "Security incident version is stale");
      const status = input.status ?? String(prior.status);
      if (prior.status === "RESOLVED" && status !== "RESOLVED") {
        throw new AuthError(409, "Resolved security incidents cannot be reopened");
      }
      if (status === "RESOLVED" && !(input.resolution ?? prior.resolution)) {
        throw new AuthError(400, "A resolution is required to resolve an incident");
      }
      if (input.status === "INVESTIGATING" && prior.status !== "OPEN") {
        throw new AuthError(409, "Only open incidents can move to investigating");
      }
      if (input.status === "RESOLVED" && prior.status !== "INVESTIGATING" && prior.status !== "OPEN") {
        throw new AuthError(409, "Incident lifecycle transition is not permitted");
      }
      const updated = await client.query(
        `UPDATE school_security_incidents SET status=$3,
            assigned_staff_user_id=CASE WHEN $4::boolean THEN $5 ELSE assigned_staff_user_id END,
            involved_persons=CASE WHEN $6::boolean THEN $7::jsonb ELSE involved_persons END,
            resolution=CASE WHEN $8::boolean THEN $9 ELSE resolution END,
            version=version+1,updated_at=now()
          WHERE id=$1 AND school_id=$2 AND version=$10
          RETURNING ${incidentSelect}`,
        [
          incidentId, schoolId, status, Object.hasOwn(input, "assignedStaffUserId"),
          input.assignedStaffUserId ?? null, Object.hasOwn(input, "involvedPersons"),
          Object.hasOwn(input, "involvedPersons") ? JSON.stringify(input.involvedPersons) : null,
          Object.hasOwn(input, "resolution"), input.resolution ?? null, input.expectedVersion,
        ],
      );
      if (!updated.rows[0]) throw new AuthError(409, "Security incident changed; reload before retrying");
      const incident = incidentOutputSchema.parse(updated.rows[0]);
      await saveHistory(client, req, schoolId, incident.studentId, "INCIDENT",
        incident.id, incident.version, "INCIDENT_UPDATED", incident as unknown as Record<string, unknown>);
      await audit(client, req, schoolId, "SECURITY_INCIDENT_UPDATED", incident.id, {
        status: incident.status, version: incident.version, actorUserId: context.user.id,
      });
      return incident;
    });
    res.json(saved);
  }));

  router.get("/schools/:schoolId/security/incidents/:incidentId/attachments", asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const incidentId = positiveId(req.params.incidentId, "Incident");
    await assertOperationsPermission(req, schoolId, "INCIDENT_MANAGE");
    const incident = await pool.query(
      `SELECT 1 FROM school_security_incidents WHERE id=$1 AND school_id=$2 LIMIT 1`,
      [incidentId, schoolId],
    );
    if (!incident.rows[0]) throw new AuthError(404, "Security incident not found");
    const attachments = await pool.query(
      `SELECT ${incidentAttachmentSelect} FROM school_security_incident_attachments
        WHERE incident_id=$1 AND school_id=$2 AND status='CONFIRMED'
        ORDER BY created_at ASC,id ASC`,
      [incidentId, schoolId],
    );
    res.json(attachments.rows.map((row) => incidentAttachmentSchema.parse(row)));
  }));

  router.post("/schools/:schoolId/security/incidents/:incidentId/attachments/upload-intent", asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const incidentId = positiveId(req.params.incidentId, "Incident");
    const context = await assertOperationsPermission(req, schoolId, "INCIDENT_MANAGE");
    const input = parseInput(incidentAttachmentUploadInputSchema, req.body);
    const incident = await pool.query(
      `SELECT 1 FROM school_security_incidents WHERE id=$1 AND school_id=$2 LIMIT 1`,
      [incidentId, schoolId],
    );
    if (!incident.rows[0]) throw new AuthError(404, "Security incident not found");
    const objectPath = newSchoolSecurityIncidentAttachmentPath(schoolId, incidentId);
    const uploadUrl = await schoolSecurityIncidentAttachmentUploadUrl(objectPath);
    const uploadExpiresAt = schoolSecurityIncidentUploadExpiresAt();
    const created = await withTransaction(async (client) => {
      await assertOperationRateLimit(client, req, schoolId, "SECURITY_INCIDENT_ATTACHMENT_STAGED", 20, 3600);
      const inserted = await client.query(
        `INSERT INTO school_security_incident_attachments
          (school_id,incident_id,object_path,file_name,content_type,byte_size,status,uploaded_by_user_id,upload_expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,'PENDING_UPLOAD',$7,$8)
         RETURNING ${incidentAttachmentSelect}`,
        [
          schoolId, incidentId, objectPath, input.fileName, input.contentType, input.byteSize,
          context.user.id, uploadExpiresAt,
        ],
      );
      const attachment = incidentAttachmentSchema.parse(inserted.rows[0]);
      const incidentVersion = await client.query<{ version: number; studentId: number | null }>(
        `UPDATE school_security_incidents SET version=version+1,updated_at=now()
          WHERE id=$1 AND school_id=$2
          RETURNING version,student_id AS "studentId"`,
        [incidentId, schoolId],
      );
      const incidentRecord = incidentVersion.rows[0];
      if (!incidentRecord) throw new AuthError(404, "Security incident not found");
      await saveHistory(client, req, schoolId, incidentRecord.studentId, "INCIDENT",
        incidentId, incidentRecord.version, "INCIDENT_ATTACHMENT_UPLOAD_INTENT_CREATED", {
          attachmentId: attachment.id, fileName: attachment.fileName,
          contentType: attachment.contentType, byteSize: attachment.byteSize,
        });
      await audit(client, req, schoolId, "SECURITY_INCIDENT_ATTACHMENT_STAGED", attachment.id, {
        incidentId, incidentVersion: incidentRecord.version,
        byteSize: attachment.byteSize, contentType: attachment.contentType,
      });
      return attachment;
    });
    res.status(201).json(incidentAttachmentUploadIntentOutputSchema.parse({ attachment: created, uploadUrl }));
  }));

  router.post("/schools/:schoolId/security/incidents/:incidentId/attachments/:attachmentId/confirm", asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const incidentId = positiveId(req.params.incidentId, "Incident");
    const attachmentId = positiveId(req.params.attachmentId, "Incident attachment");
    const context = await assertOperationsPermission(req, schoolId, "INCIDENT_MANAGE");
    const staged = await pool.query<{
      id: number;
      schoolId: number;
      incidentId: number;
      objectPath: string;
      contentType: string;
      byteSize: number;
      status: string;
      uploadedByUserId: number;
      uploadExpiresAt: Date | string;
    }>(
      `SELECT id,school_id AS "schoolId",incident_id AS "incidentId",object_path AS "objectPath",
          content_type AS "contentType",byte_size AS "byteSize",status,
          uploaded_by_user_id AS "uploadedByUserId",upload_expires_at AS "uploadExpiresAt"
         FROM school_security_incident_attachments
        WHERE id=$1 AND school_id=$2 AND incident_id=$3 LIMIT 1`,
      [attachmentId, schoolId, incidentId],
    );
    const pending = staged.rows[0];
    if (!pending) throw new AuthError(404, "Security incident attachment not found");
    if (Number(pending.uploadedByUserId) !== context.user.id) {
      throw new AuthError(404, "Security incident attachment not found");
    }
    if (pending.status === "CONFIRMED") {
      const result = await pool.query(
        `SELECT ${incidentAttachmentSelect} FROM school_security_incident_attachments
          WHERE id=$1 AND school_id=$2 AND incident_id=$3 AND status='CONFIRMED'`,
        [attachmentId, schoolId, incidentId],
      );
      res.json(incidentAttachmentSchema.parse(result.rows[0]));
      return;
    }
    if (pending.status !== "PENDING_UPLOAD" || new Date(pending.uploadExpiresAt).getTime() > Date.now()) {
      throw new AuthError(409, "Upload URL is still active or the attachment is no longer awaiting confirmation");
    }
    await assertSchoolSecurityIncidentObject(
      pending.objectPath, schoolId, incidentId, pending.contentType, Number(pending.byteSize),
    );
    const confirmed = await withTransaction(async (client) => {
      const current = await client.query(
        `SELECT ${incidentAttachmentSelect} FROM school_security_incident_attachments
          WHERE id=$1 AND school_id=$2 AND incident_id=$3 AND uploaded_by_user_id=$4
          FOR UPDATE`,
        [attachmentId, schoolId, incidentId, context.user.id],
      );
      const record = current.rows[0] as Record<string, unknown> | undefined;
      if (!record) throw new AuthError(404, "Security incident attachment not found");
      if (record.status !== "PENDING_UPLOAD") throw new AuthError(409, "Security incident attachment was already confirmed");
      if (new Date(String(record.uploadExpiresAt)).getTime() > Date.now()) {
        throw new AuthError(409, "Upload URL is still active; confirm after it expires");
      }
      const update = await client.query(
        `UPDATE school_security_incident_attachments SET status='CONFIRMED',confirmed_at=now()
          WHERE id=$1 AND school_id=$2 AND incident_id=$3 AND uploaded_by_user_id=$4
            AND status='PENDING_UPLOAD' AND upload_expires_at<=now()
          RETURNING ${incidentAttachmentSelect}`,
        [attachmentId, schoolId, incidentId, context.user.id],
      );
      const attachment = update.rows[0];
      if (!attachment) throw new AuthError(409, "Security incident attachment upload is stale");
      const incident = await client.query<{ id: number; version: number; studentId: number | null }>(
        `UPDATE school_security_incidents SET version=version+1,updated_at=now()
          WHERE id=$1 AND school_id=$2
          RETURNING id,version,student_id AS "studentId"`,
        [incidentId, schoolId],
      );
      const incidentRecord = incident.rows[0];
      if (!incidentRecord) throw new AuthError(404, "Security incident not found");
      const parsed = incidentAttachmentSchema.parse(attachment);
      await saveHistory(client, req, schoolId, incidentRecord.studentId, "INCIDENT",
        incidentId, incidentRecord.version, "INCIDENT_ATTACHMENT_CONFIRMED", {
          attachmentId, fileName: parsed.fileName, contentType: parsed.contentType, byteSize: parsed.byteSize,
        });
      await audit(client, req, schoolId, "SECURITY_INCIDENT_ATTACHMENT_CONFIRMED", attachmentId, {
        incidentId, version: incidentRecord.version,
      });
      return parsed;
    });
    res.json(confirmed);
  }));

  router.get("/schools/:schoolId/security/incidents/:incidentId/attachments/:attachmentId/download", asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const incidentId = positiveId(req.params.incidentId, "Incident");
    const attachmentId = positiveId(req.params.attachmentId, "Incident attachment");
    await assertOperationsPermission(req, schoolId, "INCIDENT_MANAGE");
    const result = await pool.query(
      `SELECT ${incidentAttachmentSelect},object_path AS "objectPath"
         FROM school_security_incident_attachments
        WHERE id=$1 AND school_id=$2 AND incident_id=$3 AND status='CONFIRMED' LIMIT 1`,
      [attachmentId, schoolId, incidentId],
    );
    const row = result.rows[0] as (Record<string, unknown> & { objectPath: string }) | undefined;
    if (!row) throw new AuthError(404, "Security incident attachment not found");
    const attachment = incidentAttachmentSchema.parse({
      id: row.id,
      schoolId: row.schoolId,
      incidentId: row.incidentId,
      fileName: row.fileName,
      contentType: row.contentType,
      byteSize: row.byteSize,
      status: row.status,
      uploadedByUserId: row.uploadedByUserId,
      uploadExpiresAt: row.uploadExpiresAt,
      confirmedAt: row.confirmedAt,
      createdAt: row.createdAt,
    });
    await assertSchoolSecurityIncidentObject(
      row.objectPath, schoolId, incidentId, attachment.contentType, attachment.byteSize,
    );
    const downloadUrl = await schoolSecurityIncidentAttachmentDownloadUrl(row.objectPath);
    await withTransaction(async (client) => {
      await assertOperationRateLimit(client, req, schoolId, "SECURITY_INCIDENT_ATTACHMENT_DOWNLOAD", 30, 600);
      await audit(client, req, schoolId, "SECURITY_INCIDENT_ATTACHMENT_DOWNLOAD", attachmentId, { incidentId });
    });
    res.json(incidentAttachmentDownloadOutputSchema.parse({ attachment, downloadUrl }));
  }));

  router.get("/schools/:schoolId/security/incidents/:incidentId/history", asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const incidentId = positiveId(req.params.incidentId, "Incident");
    await assertOperationsPermission(req, schoolId, "INCIDENT_MANAGE");
    const result = await pool.query(
      `SELECT h.id,h.revision,h.event_type AS "eventType",h.actor_user_id AS "actorUserId",
          h.result,h.snapshot,h.created_at AS "createdAt"
         FROM school_security_operation_history h JOIN school_security_incidents i
           ON i.id=h.entity_id AND i.school_id=h.school_id
        WHERE h.school_id=$1 AND h.entity_type='INCIDENT' AND h.entity_id=$2
        ORDER BY h.revision ASC LIMIT 500`,
      [schoolId, incidentId],
    );
    res.json(result.rows);
  }));

  return router;
}

const schoolSecurityOperationsRouter = createSchoolSecurityOperationsRouter();
export default schoolSecurityOperationsRouter;