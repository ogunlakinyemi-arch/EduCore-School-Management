import { Router, type NextFunction, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { emitDomainParentEvent, queueCommunicationNotification } from "../services/communication-service";
import {
  behaviourConfigurationInputSchema,
  behaviourConfigurationOutputSchema,
  behaviourRecordInputSchema,
  behaviourRecordPatchSchema,
  careHistoryEntryOutputSchema,
  careGrantInputSchema,
  careGrantOutputSchema,
  behaviourRecordOutputSchema,
  medicalProfileInputSchema,
  medicalProfileOutputSchema,
  medicalVisitInputSchema,
  medicalVisitOutputSchema,
  medicalVisitPatchSchema,
  nextBehaviourStatus,
  parentBehaviourNotification,
  parentCareSummaryOutputSchema,
  projectParentBehaviour,
  resolveParentNotificationStatus,
  projectParentWelfare,
  stableRequestHash,
  welfareRecordInputSchema,
  welfareRecordOutputSchema,
  welfareRecordPatchSchema,
  type CarePermission,
} from "../services/student-care-service";
import {
  assertSchoolOperationalAccess,
  AuthError,
  getUserContext,
  handleAuthError,
  requireAuthentication,
} from "../middlewares/auth";

const router = Router();
router.use(requireAuthentication());

type Queryable = {
  query<Row = Record<string, unknown>>(sql: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount?: number | null }>;
};
type TransactionClient = Queryable & { release(): void };

async function notifyFamilyOfStudentCareUpdate(
  client: Queryable,
  schoolId: number,
  studentId: number,
  eventType: string,
  eventId: string,
): Promise<void> {
  await emitDomainParentEvent(client, {
    schoolId,
    studentId,
    eventType,
    eventId,
    category: "SYSTEM",
    subject: "Student care update",
    body: "The school has an important update about your child. Please contact the school for more information.",
    privacy: "GENERIC",
    link: "/parent/communication",
    channels: ["IN_APP"],
  });
}

function comparableVisitValue(value: unknown, dateTime = false): unknown {
  if (value == null) return null;
  if (!dateTime) return String(value);
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function hasMeaningfulMedicalVisitChange(
  before: Record<string, unknown>,
  input: object,
): boolean {
  const values = input as Record<string, unknown>;
  // Staff notes are intentionally excluded; these are the clinical visit fields.
  const fields: Array<[string, boolean]> = [
    ["occurredAt", true],
    ["reason", false],
    ["symptoms", false],
    ["observations", false],
    ["actionTaken", false],
    ["treatment", false],
    ["referral", false],
    ["followUpAt", true],
    ["followUpNotes", false],
  ];
  return fields.some(([field, dateTime]) =>
    Object.hasOwn(values, field) &&
    comparableVisitValue(before[field], dateTime) !== comparableVisitValue(values[field], dateTime));
}

const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    handler(req, res).catch((error) => handleAuthError(error, req, res, next));

const positiveId = (value: string | string[], label: string): number => {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new AuthError(404, `${label} not found`);
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id)) throw new AuthError(404, `${label} not found`);
  return id;
};

function parseInput<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch {
    throw new AuthError(400, "Request body does not match the required student-care contract");
  }
}

function requestKey(req: Request): string {
  const value = req.header("Idempotency-Key");
  if (!value || value.length < 8 || value.length > 128 || /[\r\n]/.test(value)) {
    throw new AuthError(400, "A valid Idempotency-Key header is required");
  }
  return value;
}

function expectedVersion(req: Request): number {
  const value = req.header("If-Match-Version");
  if (!value || !/^[1-9]\d*$/.test(value)) throw new AuthError(400, "If-Match-Version is required");
  return Number(value);
}

async function withTransaction<T>(run: (client: TransactionClient) => Promise<T>): Promise<T> {
  const client = await pool.connect() as unknown as TransactionClient;
  try {
    await client.query("BEGIN");
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* preserve original error */ }
    throw error;
  } finally {
    client.release();
  }
}

function isActiveOwner(context: ReturnType<typeof getUserContext>): boolean {
  return context.roles.some((role) =>
    role.status === "ACTIVE" && role.role === "PLATFORM_OWNER" && role.schoolId === null,
  );
}

async function assertStudentScope(schoolId: number, studentId: number): Promise<void> {
  const result = await pool.query(
    `SELECT 1 FROM students st
      WHERE st.id=$1 AND st.school_id=$2 AND UPPER(st.status)='ACTIVE'
      LIMIT 1`,
    [studentId, schoolId],
  );
  if (!result.rows[0]) throw new AuthError(404, "Student not found");
}

async function hasPermission(
  userId: number,
  schoolId: number,
  permission: CarePermission,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1
       FROM student_care_grants g
       JOIN school_memberships sm
         ON sm.user_id=g.user_id AND sm.school_id=g.school_id
        AND UPPER(sm.status)='ACTIVE'
       JOIN app_users u ON u.id=g.user_id AND UPPER(u.status)='ACTIVE'
      WHERE g.user_id=$1 AND g.school_id=$2 AND g.active=TRUE
        AND $3=ANY(g.permissions)
        AND NOT EXISTS (
          SELECT 1 FROM school_memberships owner_role
           WHERE owner_role.user_id=$1 AND owner_role.school_id IS NULL
             AND owner_role.role='PLATFORM_OWNER' AND UPPER(owner_role.status)='ACTIVE'
        )
        AND EXISTS (
          SELECT 1 FROM school_memberships active_member
           WHERE active_member.user_id=$1 AND active_member.school_id=$2
             AND UPPER(active_member.status)='ACTIVE'
        )
      LIMIT 1`,
    [userId, schoolId, permission],
  );
  return Boolean(result.rows[0]);
}

async function isSchoolAdmin(req: Request, schoolId: number): Promise<boolean> {
  const context = getUserContext(req);
  if (isActiveOwner(context)) return false;
  try {
    assertSchoolOperationalAccess(req, schoolId, ["SCHOOL_ADMIN"]);
    return true;
  } catch (error) {
    if (error instanceof AuthError && (error.statusCode === 403 || error.statusCode === 404)) return false;
    throw error;
  }
}

async function requireCareAccess(
  req: Request,
  schoolId: number,
  studentId: number,
  permission: CarePermission,
  options: { allowAssignedTeacher?: boolean } = {},
): Promise<void> {
  const context = getUserContext(req);
  if (isActiveOwner(context)) {
    throw new AuthError(403, "Platform Owner accounts are excluded from student-care access");
  }
  const admin = await isSchoolAdmin(req, schoolId);
  const isMember = context.roles.some((role) =>
    role.status === "ACTIVE" && role.schoolId === schoolId &&
    ["TEACHER", "ACCOUNTANT", "STAFF"].includes(role.role),
  );
  if (!admin && !isMember) throw new AuthError(404, "Student not found");
  await assertStudentScope(schoolId, studentId);
  if (admin) return;
  if (await hasPermission(context.user.id, schoolId, permission)) return;
  if (
    options.allowAssignedTeacher &&
    context.roles.some((role) => role.status === "ACTIVE" && role.schoolId === schoolId && role.role === "TEACHER") &&
    await teacherAssignedToStudent(context.user.id, schoolId, studentId)
  ) return;
  throw new AuthError(403, "An explicit student-care permission is required");
}

async function teacherAssignedToStudent(
  userId: number,
  schoolId: number,
  studentId: number,
  schoolClassId?: number | null,
  subjectId?: number | null,
): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1
       FROM employees e
       JOIN teacher_class_assignments tca
         ON tca.employee_id=e.id AND tca.school_id=e.school_id
        AND UPPER(tca.status)='ACTIVE'
       JOIN student_class_assignments sca
         ON sca.school_id=tca.school_id
        AND sca.school_class_id=tca.school_class_id
        AND sca.section=tca.section
        AND sca.academic_session_id=tca.academic_session_id
        AND sca.student_id=$3 AND sca.is_current=TRUE
        AND UPPER(sca.status)='ACTIVE'
      WHERE e.user_id=$1 AND e.school_id=$2
        AND UPPER(e.employment_status)='ACTIVE'
        AND ($4::integer IS NULL OR tca.school_class_id=$4)
        AND ($4::integer IS NULL OR tca.subject_id IS NOT DISTINCT FROM $5::integer)
      LIMIT 1`,
    [userId, schoolId, studentId, schoolClassId ?? null, subjectId ?? null],
  );
  return Boolean(result.rows[0]);
}

async function assertTeacherBehaviourRecordScope(
  req: Request,
  schoolId: number,
  studentId: number,
  schoolClassId: number | null,
  subjectId: number | null,
): Promise<void> {
  const context = getUserContext(req);
  const teacherRole = context.roles.some((role) =>
    role.status === "ACTIVE" && role.schoolId === schoolId && role.role === "TEACHER",
  );
  if (teacherRole && !await isSchoolAdmin(req, schoolId) &&
      !await teacherAssignedToStudent(context.user.id, schoolId, studentId, schoolClassId, subjectId)) {
    throw new AuthError(404, "Behaviour record not found in your active class and subject assignment");
  }
}

async function audit(
  client: Queryable,
  req: Request,
  schoolId: number,
  action: string,
  recordType: string,
  recordId: number,
  metadata: Record<string, string | number | boolean | null> = {},
) {
  const context = getUserContext(req);
  const userLabel = [context.user.firstName, context.user.lastName].filter(Boolean).join(" ") || context.user.email;
  await client.query(
    `INSERT INTO audit_logs
       ("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,event_type,result,metadata)
     VALUES ($1,$2,$3,$4,$5,$6,'Student Care',$7,'STUDENT_CARE_EVENT','SUCCESS',$8::jsonb)`,
    [
      userLabel,
      context.roles.find((role) => role.status === "ACTIVE" && role.schoolId === schoolId)?.role ?? "STAFF",
      context.user.id,
      context.user.clerkUserId,
      schoolId,
      action,
      recordId,
      JSON.stringify({ resourceType: recordType, ...metadata }),
    ],
  );
}

async function saveRevision(
  client: Queryable,
  req: Request,
  schoolId: number,
  studentId: number,
  recordType: string,
  recordId: number,
  revision: number,
  snapshot: Record<string, unknown>,
) {
  const user = getUserContext(req).user;
  await client.query(
    `INSERT INTO student_care_record_history
      (school_id,student_id,record_type,record_id,revision,changed_by_user_id,snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [schoolId, studentId, recordType, recordId, revision, user.id, JSON.stringify(snapshot)],
  );
}

async function lockIdempotency(client: Queryable, scope: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [scope]);
}

async function getIdempotentResource(
  client: Queryable,
  req: Request,
  schoolId: number,
  studentId: number,
  type: string,
  key: string,
  body: unknown,
) {
  const actorId = getUserContext(req).user.id;
  const scope = `${schoolId}:${studentId}:${type}:${key}:${actorId}`;
  await lockIdempotency(client, scope);
  const prior = await client.query<{ requestHash: string; snapshot: Record<string, unknown> }>(
    `SELECT i.request_hash AS "requestHash",h.snapshot
       FROM student_care_idempotency i
       JOIN student_care_record_history h
         ON h.school_id=i.school_id AND h.student_id=i.student_id
        AND h.record_type=i.resource_type AND h.record_id=i.resource_id
        AND h.revision=i.response_revision
      WHERE i.school_id=$1 AND i.student_id=$2 AND i.resource_type=$3 AND i.request_key=$4
        AND i.created_by_user_id=$5`,
    [schoolId, studentId, type, key, actorId],
  );
  if (!prior.rows[0]) return null;
  if (prior.rows[0].requestHash !== stableRequestHash(body)) {
    throw new AuthError(409, "This Idempotency-Key was already used with a different request");
  }
  return prior.rows[0].snapshot;
}

async function storeIdempotency(
  client: Queryable,
  req: Request,
  schoolId: number,
  studentId: number,
  type: string,
  key: string,
  body: unknown,
  resourceId: number,
  responseRevision = 1,
) {
  await client.query(
    `INSERT INTO student_care_idempotency
      (school_id,student_id,request_key,resource_type,request_hash,resource_id,response_revision,created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [schoolId, studentId, key, type, stableRequestHash(body), resourceId, responseRevision, getUserContext(req).user.id],
  );
}

const profileSelect = `id, school_id AS "schoolId", student_id AS "studentId",
  blood_group AS "bloodGroup", genotype, allergies, conditions, support_needs AS "supportNeeds",
  medications, emergency_medical_notes AS "emergencyMedicalNotes",
  provider_contacts AS "providerContacts", emergency_contacts AS "emergencyContacts",
  version, updated_at AS "updatedAt", archived_at AS "archivedAt"`;
const visitSelect = `id, school_id AS "schoolId", student_id AS "studentId",
  occurred_at AS "occurredAt", reason, symptoms, observations, action_taken AS "actionTaken",
  treatment, referral, follow_up_at AS "followUpAt", follow_up_notes AS "followUpNotes",
  notes, recorded_by_user_id AS "recordedByUserId", version,
  created_at AS "createdAt", updated_at AS "updatedAt", archived_at AS "archivedAt"`;
const welfareSelect = `id, school_id AS "schoolId", student_id AS "studentId", category, concern,
  assigned_staff_user_id AS "assignedStaffUserId", follow_up_at AS "followUpAt",
  follow_up_status AS "followUpStatus", status, resolution, internal_notes AS "internalNotes",
  parent_visible AS "parentVisible", created_by_user_id AS "createdByUserId", version,
  created_at AS "createdAt", updated_at AS "updatedAt", archived_at AS "archivedAt"`;
const behaviourSelect = `id, school_id AS "schoolId", student_id AS "studentId",
  occurred_at AS "occurredAt", school_class_id AS "schoolClassId", subject_id AS "subjectId",
  category, severity, description, location, reporter_user_id AS "reporterUserId", action,
  parent_notification_status AS "parentNotificationStatus",
  follow_up_at AS "followUpAt", follow_up_notes AS "followUpNotes", status, resolution,
  internal_notes AS "internalNotes", parent_visible AS "parentVisible", version,
  created_at AS "createdAt", updated_at AS "updatedAt", archived_at AS "archivedAt"`;

router.get(
  "/schools/:schoolId/students/:studentId/medical-profile",
  asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const studentId = positiveId(req.params.studentId, "Student");
    await requireCareAccess(req, schoolId, studentId, "MEDICAL_READ");
    const result = await pool.query(
      `SELECT ${profileSelect} FROM student_medical_profiles
        WHERE school_id=$1 AND student_id=$2`,
      [schoolId, studentId],
    );
    const profile = result.rows[0];
    if (!profile) throw new AuthError(404, "Medical profile not found");
    res.json(medicalProfileOutputSchema.parse(profile));
  }),
);

router.put(
  "/schools/:schoolId/students/:studentId/medical-profile",
  asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const studentId = positiveId(req.params.studentId, "Student");
    await requireCareAccess(req, schoolId, studentId, "MEDICAL_WRITE");
    const input = parseInput(medicalProfileInputSchema, req.body);
    const key = requestKey(req);
    const userId = getUserContext(req).user.id;
    const row = await withTransaction(async (client) => {
      const retried = await getIdempotentResource(client, req, schoolId, studentId, "MEDICAL_PROFILE", key, input);
      if (retried) return medicalProfileOutputSchema.parse(retried);
      await lockIdempotency(client, `medical-profile:${schoolId}:${studentId}`);
      const current = await client.query(
        `SELECT ${profileSelect} FROM student_medical_profiles
          WHERE school_id=$1 AND student_id=$2 FOR UPDATE`,
        [schoolId, studentId],
      );
      const prior = current.rows[0] as Record<string, unknown> | undefined;
      const version = prior ? Number(prior.version) : 0;
      if (version !== input.expectedVersion) throw new AuthError(409, "Medical profile version is stale");
      const values = [
        input.bloodGroup ?? null, input.genotype ?? null, JSON.stringify(input.allergies),
        JSON.stringify(input.conditions), JSON.stringify(input.supportNeeds),
        JSON.stringify(input.medications), input.emergencyMedicalNotes ?? null,
        JSON.stringify(input.providerContacts), JSON.stringify(input.emergencyContacts),
      ];
       const restoring = Boolean(prior?.archivedAt);
       const updated = prior
        ? await client.query(
          `UPDATE student_medical_profiles SET blood_group=$3,genotype=$4,allergies=$5::jsonb,
             conditions=$6::jsonb,support_needs=$7::jsonb,medications=$8::jsonb,
             emergency_medical_notes=$9,provider_contacts=$10::jsonb,emergency_contacts=$11::jsonb,
              archived_at=NULL,version=version+1,updated_by_user_id=$12,updated_at=now()
            WHERE id=$1 AND school_id=$2 AND version=$13
           RETURNING ${profileSelect}`,
          [Number(prior.id), schoolId, ...values, userId, version],
        )
        : await client.query(
          `INSERT INTO student_medical_profiles
             (school_id,student_id,blood_group,genotype,allergies,conditions,support_needs,medications,
              emergency_medical_notes,provider_contacts,emergency_contacts,updated_by_user_id)
           VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10::jsonb,$11::jsonb,$12)
           RETURNING ${profileSelect}`,
          [schoolId, studentId, ...values, userId],
        );
      const saved = updated.rows[0] as Record<string, unknown> | undefined;
      if (!saved) throw new AuthError(409, "Medical profile version changed; reload before retrying");
      const profile = medicalProfileOutputSchema.parse(saved);
      await saveRevision(client, req, schoolId, studentId, "MEDICAL_PROFILE", Number(profile.id), profile.version, profile as unknown as Record<string, unknown>);
      await storeIdempotency(client, req, schoolId, studentId, "MEDICAL_PROFILE", key, input, profile.id, profile.version);
       await audit(client, req, schoolId,
         restoring ? "MEDICAL_PROFILE_RESTORED" : prior ? "MEDICAL_PROFILE_UPDATED" : "MEDICAL_PROFILE_CREATED",
         "MEDICAL_PROFILE", profile.id, { version: profile.version, restored: restoring });
      return profile;
    });
    res.json(row);
  }),
);

router.get(
  "/schools/:schoolId/students/:studentId/medical-profile/history",
  asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const studentId = positiveId(req.params.studentId, "Student");
    await requireCareAccess(req, schoolId, studentId, "MEDICAL_READ");
    const result = await pool.query(
      `SELECT h.revision,h.changed_at AS "changedAt",h.changed_by_user_id AS "changedByUserId",h.snapshot
         FROM student_care_record_history h
        WHERE h.school_id=$1 AND h.student_id=$2 AND h.record_type='MEDICAL_PROFILE'
        ORDER BY h.revision DESC LIMIT 200`,
      [schoolId, studentId],
    );
    res.json(result.rows.map((row) => careHistoryEntryOutputSchema.parse(row)));
  }),
);

router.get(
  "/schools/:schoolId/students/:studentId/medical-visits",
  asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const studentId = positiveId(req.params.studentId, "Student");
    await requireCareAccess(req, schoolId, studentId, "MEDICAL_READ");
    const result = await pool.query(
      `SELECT ${visitSelect} FROM student_medical_visits
        WHERE school_id=$1 AND student_id=$2 ORDER BY occurred_at DESC,id DESC LIMIT 500`,
      [schoolId, studentId],
    );
    res.json(result.rows.map((row) => medicalVisitOutputSchema.parse(row)));
  }),
);

router.post(
  "/schools/:schoolId/students/:studentId/medical-visits",
  asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const studentId = positiveId(req.params.studentId, "Student");
    await requireCareAccess(req, schoolId, studentId, "MEDICAL_WRITE");
    const input = parseInput(medicalVisitInputSchema, req.body);
    const key = requestKey(req);
    const result = await withTransaction(async (client) => {
      const prior = await getIdempotentResource(client, req, schoolId, studentId, "MEDICAL_VISIT", key, input);
      if (prior) return prior;
      const inserted = await client.query(
        `INSERT INTO student_medical_visits
          (school_id,student_id,occurred_at,reason,symptoms,observations,action_taken,treatment,referral,
           follow_up_at,follow_up_notes,notes,recorded_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING ${visitSelect}`,
        [schoolId, studentId, input.occurredAt, input.reason, input.symptoms ?? null,
          input.observations ?? null, input.actionTaken ?? null, input.treatment ?? null,
          input.referral ?? null, input.followUpAt ?? null, input.followUpNotes ?? null,
          input.notes ?? null, getUserContext(req).user.id],
      );
      const row = inserted.rows[0] as Record<string, unknown>;
      const id = Number(row.id);
      await saveRevision(client, req, schoolId, studentId, "MEDICAL_VISIT", id, 1, row);
      await storeIdempotency(client, req, schoolId, studentId, "MEDICAL_VISIT", key, input, id);
      await audit(client, req, schoolId, "MEDICAL_VISIT_RECORDED", "MEDICAL_VISIT", id, { version: 1 });
      await notifyFamilyOfStudentCareUpdate(
        client, schoolId, studentId, "STUDENT_MEDICAL_VISIT_RECORDED", `${id}:1`,
      );
      return row;
    });
    res.status(201).json(medicalVisitOutputSchema.parse(result));
  }),
);

router.patch(
  "/schools/:schoolId/students/:studentId/medical-visits/:visitId",
  asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const studentId = positiveId(req.params.studentId, "Student");
    const visitId = positiveId(req.params.visitId, "Visit");
    await requireCareAccess(req, schoolId, studentId, "MEDICAL_WRITE");
    const input = parseInput(medicalVisitPatchSchema, req.body);
    const fields: Record<string, string> = {
      occurredAt: "occurred_at", reason: "reason", symptoms: "symptoms", observations: "observations",
      actionTaken: "action_taken", treatment: "treatment", referral: "referral", followUpAt: "follow_up_at",
      followUpNotes: "follow_up_notes", notes: "notes",
    };
    const result = await withTransaction(async (client) => {
      const current = await client.query(
        `SELECT ${visitSelect} FROM student_medical_visits
          WHERE id=$1 AND school_id=$2 AND student_id=$3 FOR UPDATE`,
        [visitId, schoolId, studentId],
      );
      const prior = current.rows[0] as Record<string, unknown> | undefined;
      if (!prior || prior.archivedAt) throw new AuthError(404, "Medical visit not found");
      if (Number(prior.version) !== input.expectedVersion) throw new AuthError(409, "Medical visit version is stale");
      const changes = Object.entries(fields).filter(([key]) => Object.hasOwn(input, key));
      if (!changes.length) throw new AuthError(400, "At least one visit field must be updated");
      const values: unknown[] = [visitId, schoolId, studentId];
      const sets = changes.map(([key, column]) => {
        values.push(input[key as keyof typeof input] ?? null);
        return `${column}=$${values.length}`;
      });
      values.push(input.expectedVersion);
      const updated = await client.query(
        `UPDATE student_medical_visits SET ${sets.join(",")},version=version+1,updated_at=now()
          WHERE id=$1 AND school_id=$2 AND student_id=$3 AND version=$${values.length} AND archived_at IS NULL
          RETURNING ${visitSelect}`,
        values,
      );
      const row = updated.rows[0] as Record<string, unknown> | undefined;
      if (!row) throw new AuthError(409, "Medical visit version changed; reload before retrying");
      await saveRevision(client, req, schoolId, studentId, "MEDICAL_VISIT", visitId, Number(row.version), row);
      await audit(client, req, schoolId, "MEDICAL_VISIT_UPDATED", "MEDICAL_VISIT", visitId, { version: Number(row.version) });
      if (hasMeaningfulMedicalVisitChange(prior, input)) {
        await notifyFamilyOfStudentCareUpdate(
          client, schoolId, studentId, "STUDENT_MEDICAL_VISIT_UPDATED", `${visitId}:${Number(row.version)}`,
        );
      }
      return row;
    });
    res.json(medicalVisitOutputSchema.parse(result));
  }),
);

router.delete(
  "/schools/:schoolId/students/:studentId/medical-profile",
  asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const studentId = positiveId(req.params.studentId, "Student");
    const version = expectedVersion(req);
    await requireCareAccess(req, schoolId, studentId, "MEDICAL_WRITE");
    const row = await withTransaction(async (client) => {
      const updated = await client.query(
        `UPDATE student_medical_profiles SET archived_at=now(),updated_at=now(),version=version+1
          WHERE school_id=$1 AND student_id=$2 AND version=$3 AND archived_at IS NULL
          RETURNING ${profileSelect}`,
        [schoolId, studentId, version],
      );
      const archived = updated.rows[0] as Record<string, unknown> | undefined;
      if (!archived) throw new AuthError(409, "Medical profile version is stale or already archived");
      const profile = medicalProfileOutputSchema.parse(archived);
      await saveRevision(client, req, schoolId, studentId, "MEDICAL_PROFILE", profile.id, profile.version, profile as unknown as Record<string, unknown>);
      await audit(client, req, schoolId, "MEDICAL_PROFILE_ARCHIVED", "MEDICAL_PROFILE", profile.id, { version: profile.version });
      return profile;
    });
    res.json(row);
  }),
);

router.delete(
  "/schools/:schoolId/students/:studentId/medical-visits/:visitId",
  asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const studentId = positiveId(req.params.studentId, "Student");
    const visitId = positiveId(req.params.visitId, "Visit");
    const version = expectedVersion(req);
    await requireCareAccess(req, schoolId, studentId, "MEDICAL_WRITE");
    const row = await withTransaction(async (client) => {
      const updated = await client.query(
        `UPDATE student_medical_visits SET archived_at=now(),updated_at=now(),version=version+1
          WHERE id=$1 AND school_id=$2 AND student_id=$3 AND version=$4 AND archived_at IS NULL
          RETURNING ${visitSelect}`,
        [visitId, schoolId, studentId, version],
      );
      const archived = updated.rows[0] as Record<string, unknown> | undefined;
      if (!archived) throw new AuthError(409, "Visit version is stale or visit is already archived");
      await saveRevision(client, req, schoolId, studentId, "MEDICAL_VISIT", visitId, Number(archived.version), archived);
      await audit(client, req, schoolId, "MEDICAL_VISIT_ARCHIVED", "MEDICAL_VISIT", visitId, { version: Number(archived.version) });
      return archived;
    });
    res.json(medicalVisitOutputSchema.parse(row));
  }),
);

router.get(
  "/schools/:schoolId/students/:studentId/medical-visits/:visitId/history",
  asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const studentId = positiveId(req.params.studentId, "Student");
    const visitId = positiveId(req.params.visitId, "Visit");
    await requireCareAccess(req, schoolId, studentId, "MEDICAL_READ");
    const result = await pool.query(
      `SELECT revision,changed_at AS "changedAt",changed_by_user_id AS "changedByUserId",snapshot
         FROM student_care_record_history
        WHERE school_id=$1 AND student_id=$2 AND record_type='MEDICAL_VISIT' AND record_id=$3
        ORDER BY revision`,
      [schoolId, studentId, visitId],
    );
    res.json(result.rows.map((row) => careHistoryEntryOutputSchema.parse(row)));
  }),
);

async function welfareVisibility(req: Request, schoolId: number, studentId: number) {
  const admin = await isSchoolAdmin(req, schoolId);
  const context = getUserContext(req);
  const hasWelfare = admin || await hasPermission(context.user.id, schoolId, "WELFARE_READ");
  const hasSafeguarding = admin || await hasPermission(context.user.id, schoolId, "SAFEGUARDING_READ");
  if (!hasWelfare && !hasSafeguarding) {
    await requireCareAccess(req, schoolId, studentId, "WELFARE_READ");
  }
  await assertStudentScope(schoolId, studentId);
  return { admin, hasWelfare, hasSafeguarding };
}

router.get(
  "/schools/:schoolId/students/:studentId/welfare",
  asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const studentId = positiveId(req.params.studentId, "Student");
    const visibility = await welfareVisibility(req, schoolId, studentId);
    const categories = visibility.admin || (visibility.hasWelfare && visibility.hasSafeguarding)
      ? null
      : visibility.hasSafeguarding ? ["SAFEGUARDING"] : ["WELFARE_CONCERN", "COUNSELLING_REFERRAL", "FAMILY_SUPPORT", "LEARNING_SUPPORT"];
    const result = await pool.query(
      `SELECT ${welfareSelect} FROM student_welfare_records
        WHERE school_id=$1 AND student_id=$2 AND ($3::text[] IS NULL OR category=ANY($3::text[]))
        ORDER BY updated_at DESC,id DESC LIMIT 500`,
      [schoolId, studentId, categories],
    );
    res.json(result.rows.map((row) => welfareRecordOutputSchema.parse(row)));
  }),
);

router.post(
  "/schools/:schoolId/students/:studentId/welfare",
  asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const studentId = positiveId(req.params.studentId, "Student");
    const input = parseInput(welfareRecordInputSchema, req.body);
    const permission = input.category === "SAFEGUARDING" ? "SAFEGUARDING_WRITE" : "WELFARE_WRITE";
    await requireCareAccess(req, schoolId, studentId, permission);
    if (input.category === "SAFEGUARDING" && input.parentVisible) {
      throw new AuthError(400, "Safeguarding records cannot be made parent-visible");
    }
    const key = requestKey(req);
    const result = await withTransaction(async (client) => {
      const prior = await getIdempotentResource(client, req, schoolId, studentId, "WELFARE", key, input);
      if (prior) return prior;
      if (input.assignedStaffUserId) {
        const assigned = await client.query(
          `SELECT 1 FROM school_memberships WHERE user_id=$1 AND school_id=$2 AND UPPER(status)='ACTIVE'`,
          [input.assignedStaffUserId, schoolId],
        );
        if (!assigned.rows[0]) throw new AuthError(400, "Assigned staff member is not active in this school");
      }
      const inserted = await client.query(
        `INSERT INTO student_welfare_records
          (school_id,student_id,category,concern,assigned_staff_user_id,follow_up_at,follow_up_status,
           status,resolution,internal_notes,parent_visible,created_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING ${welfareSelect}`,
        [schoolId, studentId, input.category, input.concern, input.assignedStaffUserId ?? null,
          input.followUpAt ?? null, input.followUpStatus, input.status, input.resolution ?? null,
          input.internalNotes ?? null, input.category === "SAFEGUARDING" ? false : input.parentVisible,
          getUserContext(req).user.id],
      );
      const row = inserted.rows[0] as Record<string, unknown>;
      const id = Number(row.id);
      await saveRevision(client, req, schoolId, studentId, "WELFARE", id, 1, row);
      await storeIdempotency(client, req, schoolId, studentId, "WELFARE", key, input, id);
      await audit(client, req, schoolId, "WELFARE_RECORD_CREATED", "WELFARE", id, { category: input.category, version: 1 });
      if (row.category !== "SAFEGUARDING" && row.parentVisible === true) {
        await notifyFamilyOfStudentCareUpdate(
          client, schoolId, studentId, "STUDENT_WELFARE_SUMMARY_CREATED", `${id}:1`,
        );
      }
      return row;
    });
    res.status(201).json(welfareRecordOutputSchema.parse(result));
  }),
);

router.patch(
  "/schools/:schoolId/students/:studentId/welfare/:recordId",
  asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const studentId = positiveId(req.params.studentId, "Student");
    const recordId = positiveId(req.params.recordId, "Welfare record");
    const input = parseInput(welfareRecordPatchSchema, req.body);
    const current = await pool.query(
      `SELECT category FROM student_welfare_records WHERE id=$1 AND school_id=$2 AND student_id=$3`,
      [recordId, schoolId, studentId],
    );
    const priorCategory = (current.rows[0] as { category: string } | undefined)?.category;
    if (!priorCategory) throw new AuthError(404, "Welfare record not found");
    await requireCareAccess(req, schoolId, studentId, priorCategory === "SAFEGUARDING" ? "SAFEGUARDING_WRITE" : "WELFARE_WRITE");
    if (input.category === "SAFEGUARDING") await requireCareAccess(req, schoolId, studentId, "SAFEGUARDING_WRITE");
    if (input.category && input.category !== "SAFEGUARDING") await requireCareAccess(req, schoolId, studentId, "WELFARE_WRITE");
    if ((input.category ?? priorCategory) === "SAFEGUARDING" && input.parentVisible) {
      throw new AuthError(400, "Safeguarding records cannot be made parent-visible");
    }
    const fields: Record<string, string> = {
      category: "category", concern: "concern", assignedStaffUserId: "assigned_staff_user_id",
      followUpAt: "follow_up_at", followUpStatus: "follow_up_status", status: "status",
      resolution: "resolution", internalNotes: "internal_notes", parentVisible: "parent_visible",
    };
    const result = await withTransaction(async (client) => {
      const locked = await client.query(
        `SELECT ${welfareSelect} FROM student_welfare_records
          WHERE id=$1 AND school_id=$2 AND student_id=$3 FOR UPDATE`,
        [recordId, schoolId, studentId],
      );
      const before = locked.rows[0] as Record<string, unknown> | undefined;
      if (!before || before.archivedAt) throw new AuthError(404, "Welfare record not found");
      if (Number(before.version) !== input.expectedVersion) throw new AuthError(409, "Welfare record version is stale");
      const changes = Object.entries(fields).filter(([key]) => Object.hasOwn(input, key));
      if ((input.category ?? String(before.category)) === "SAFEGUARDING" && !Object.hasOwn(input, "parentVisible")) {
        changes.push(["parentVisible", "parent_visible"]);
      }
      if (!changes.length) throw new AuthError(400, "At least one welfare field must be updated");
      if (input.assignedStaffUserId) {
        const assigned = await client.query(
          `SELECT 1 FROM school_memberships WHERE user_id=$1 AND school_id=$2 AND UPPER(status)='ACTIVE'`,
          [input.assignedStaffUserId, schoolId],
        );
        if (!assigned.rows[0]) throw new AuthError(400, "Assigned staff member is not active in this school");
      }
      const values: unknown[] = [recordId, schoolId, studentId];
      const sets = changes.map(([key, column]) => {
        values.push(key === "parentVisible" && input.category === "SAFEGUARDING"
          ? false
          : input[key as keyof typeof input] ?? null);
        return `${column}=$${values.length}`;
      });
      values.push(input.expectedVersion);
      const updated = await client.query(
        `UPDATE student_welfare_records SET ${sets.join(",")},version=version+1,updated_at=now()
          WHERE id=$1 AND school_id=$2 AND student_id=$3 AND version=$${values.length} AND archived_at IS NULL
          RETURNING ${welfareSelect}`,
        values,
      );
      const row = updated.rows[0] as Record<string, unknown> | undefined;
      if (!row) throw new AuthError(409, "Welfare record version changed; reload before retrying");
      await saveRevision(client, req, schoolId, studentId, "WELFARE", recordId, Number(row.version), row);
      await audit(client, req, schoolId, "WELFARE_RECORD_UPDATED", "WELFARE", recordId, { category: String(row.category), version: Number(row.version) });
      const becameParentVisible = before.parentVisible !== true && row.parentVisible === true;
      // The parent summary exposes only category, concern and status; internal fields stay silent.
      const changedSharedSummary = ["category", "concern", "status"].some((field) =>
        String(before[field] ?? "") !== String(row[field] ?? ""));
      if (row.category !== "SAFEGUARDING" && row.parentVisible === true &&
          (becameParentVisible || changedSharedSummary)) {
        await notifyFamilyOfStudentCareUpdate(
          client, schoolId, studentId, "STUDENT_WELFARE_SUMMARY_UPDATED", `${recordId}:${Number(row.version)}`,
        );
      }
      return row;
    });
    res.json(welfareRecordOutputSchema.parse(result));
  }),
);

router.delete(
  "/schools/:schoolId/students/:studentId/welfare/:recordId",
  asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const studentId = positiveId(req.params.studentId, "Student");
    const recordId = positiveId(req.params.recordId, "Welfare record");
    const version = expectedVersion(req);
    const found = await pool.query(
      `SELECT category FROM student_welfare_records WHERE id=$1 AND school_id=$2 AND student_id=$3`,
      [recordId, schoolId, studentId],
    );
    const category = (found.rows[0] as { category: string } | undefined)?.category;
    if (!category) throw new AuthError(404, "Welfare record not found");
    await requireCareAccess(req, schoolId, studentId, category === "SAFEGUARDING" ? "SAFEGUARDING_WRITE" : "WELFARE_WRITE");
    const row = await withTransaction(async (client) => {
      const updated = await client.query(
        `UPDATE student_welfare_records SET archived_at=now(),updated_at=now(),version=version+1
          WHERE id=$1 AND school_id=$2 AND student_id=$3 AND version=$4 AND archived_at IS NULL
          RETURNING ${welfareSelect}`,
        [recordId, schoolId, studentId, version],
      );
      const archived = updated.rows[0] as Record<string, unknown> | undefined;
      if (!archived) throw new AuthError(409, "Welfare record version is stale or already archived");
      await saveRevision(client, req, schoolId, studentId, "WELFARE", recordId, Number(archived.version), archived);
      await audit(client, req, schoolId, "WELFARE_RECORD_ARCHIVED", "WELFARE", recordId, { category, version: Number(archived.version) });
      return archived;
    });
    res.json(welfareRecordOutputSchema.parse(row));
  }),
);

router.get(
  "/schools/:schoolId/students/:studentId/welfare/:recordId/history",
  asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const studentId = positiveId(req.params.studentId, "Student");
    const recordId = positiveId(req.params.recordId, "Welfare record");
    const current = await pool.query(
      `SELECT category FROM student_welfare_records WHERE id=$1 AND school_id=$2 AND student_id=$3`,
      [recordId, schoolId, studentId],
    );
    const category = (current.rows[0] as { category: string } | undefined)?.category;
    if (!category) throw new AuthError(404, "Welfare record not found");
    await requireCareAccess(req, schoolId, studentId, category === "SAFEGUARDING" ? "SAFEGUARDING_READ" : "WELFARE_READ");
    const result = await pool.query(
      `SELECT revision,changed_at AS "changedAt",changed_by_user_id AS "changedByUserId",snapshot
         FROM student_care_record_history
        WHERE school_id=$1 AND student_id=$2 AND record_type='WELFARE' AND record_id=$3
        ORDER BY revision`,
      [schoolId, studentId, recordId],
    );
    res.json(result.rows.map((row) => careHistoryEntryOutputSchema.parse(row)));
  }),
);

router.get(
  "/schools/:schoolId/students/:studentId/behaviour",
  asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const studentId = positiveId(req.params.studentId, "Student");
    await requireCareAccess(req, schoolId, studentId, "BEHAVIOUR_READ", { allowAssignedTeacher: true });
    const context = getUserContext(req);
    const teacherOnly = context.roles.some((role) => role.status === "ACTIVE" && role.schoolId === schoolId && role.role === "TEACHER") &&
      !await isSchoolAdmin(req, schoolId);
    const result = await pool.query(
      `SELECT ${behaviourSelect} FROM student_behaviour_records b
        WHERE b.school_id=$1 AND b.student_id=$2
          AND ($3::boolean=FALSE OR EXISTS (
            SELECT 1 FROM employees e
            JOIN teacher_class_assignments tca ON tca.employee_id=e.id AND tca.school_id=e.school_id
            JOIN student_class_assignments sca
              ON sca.school_id=tca.school_id AND sca.school_class_id=tca.school_class_id
             AND sca.section=tca.section AND sca.academic_session_id=tca.academic_session_id
            WHERE e.user_id=$4 AND e.school_id=b.school_id AND UPPER(e.employment_status)='ACTIVE'
              AND UPPER(tca.status)='ACTIVE' AND UPPER(sca.status)='ACTIVE' AND sca.is_current=TRUE
              AND sca.student_id=b.student_id AND b.school_class_id=tca.school_class_id
              AND (tca.subject_id IS NULL OR tca.subject_id=b.subject_id)
          ))
        ORDER BY b.occurred_at DESC,b.id DESC LIMIT 500`,
      [schoolId, studentId, teacherOnly, context.user.id],
    );
    res.json(result.rows.map((row) => behaviourRecordOutputSchema.parse(row)));
  }),
);

router.post(
  "/schools/:schoolId/students/:studentId/behaviour",
  asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const studentId = positiveId(req.params.studentId, "Student");
    const input = parseInput(behaviourRecordInputSchema, req.body);
    const context = getUserContext(req);
    const admin = await isSchoolAdmin(req, schoolId);
    const teacherMember = context.roles.some((role) => role.status === "ACTIVE" && role.schoolId === schoolId && role.role === "TEACHER");
    if (teacherMember && !admin && !input.schoolClassId) {
      throw new AuthError(400, "Assigned teachers must identify the student's active class context");
    }
    const assigned = teacherMember && await teacherAssignedToStudent(
      context.user.id, schoolId, studentId, input.schoolClassId, input.subjectId,
    );
    if (!admin && !(assigned && !input.parentVisible) &&
      !await hasPermission(context.user.id, schoolId, "BEHAVIOUR_WRITE")) {
      await requireCareAccess(req, schoolId, studentId, "BEHAVIOUR_WRITE");
    } else {
      await assertStudentScope(schoolId, studentId);
    }
    if (teacherMember && !admin && !assigned) throw new AuthError(403, "Student is outside your active class and subject assignments");
    if (teacherMember && !admin && (input.parentVisible || input.internalNotes)) {
      if (!await hasPermission(context.user.id, schoolId, "BEHAVIOUR_WRITE")) {
        throw new AuthError(403, "Publishing parent-visible records or writing confidential notes requires an explicit behaviour grant");
      }
    }
    const configuration = await pool.query(
      `SELECT categories,actions FROM student_behaviour_configurations WHERE school_id=$1`,
      [schoolId],
    );
    const categories = (configuration.rows[0] as { categories: string[] } | undefined)?.categories ??
      ["POSITIVE", "CONCERN", "INCIDENT", "RULE_VIOLATION", "RECOGNITION"];
    if (!categories.includes(input.category)) throw new AuthError(400, "Behaviour category is not enabled by the school");
    const configurationActions = (configuration.rows[0] as { actions?: string[] } | undefined)?.actions ??
      ["Verbal warning", "Written warning", "Detention", "Counselling", "Parent meeting", "Behaviour agreement", "Suspension"];
    if (input.action && !configurationActions.includes(input.action)) {
      throw new AuthError(400, "Behaviour action is not configured by the school");
    }
    if (input.schoolClassId && !assigned && !admin) throw new AuthError(403, "Class context is outside your assignment");
    if (input.subjectId && !assigned && !admin) throw new AuthError(403, "Subject context is outside your assignment");
    if (input.schoolClassId) {
      const enrollment = await pool.query(
        `SELECT 1 FROM student_class_assignments sca
          WHERE sca.student_id=$1 AND sca.school_id=$2 AND sca.school_class_id=$3
            AND sca.is_current=TRUE AND UPPER(sca.status)='ACTIVE'`,
        [studentId, schoolId, input.schoolClassId],
      );
      if (!enrollment.rows[0]) throw new AuthError(400, "Student is not currently enrolled in the selected class");
    }
    const key = requestKey(req);
    const result = await withTransaction(async (client) => {
      const prior = await getIdempotentResource(client, req, schoolId, studentId, "BEHAVIOUR", key, input);
      if (prior) return prior;
      const inserted = await client.query(
        `INSERT INTO student_behaviour_records
          (school_id,student_id,occurred_at,school_class_id,subject_id,category,severity,description,location,
           reporter_user_id,action,follow_up_at,follow_up_notes,resolution,internal_notes,parent_visible)
         VALUES ($1,$2,COALESCE($3::timestamptz,now()),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING ${behaviourSelect}`,
        [schoolId, studentId, input.occurredAt ?? null, input.schoolClassId ?? null,
          input.subjectId ?? null, input.category, input.severity, input.description,
          input.location ?? null, context.user.id, input.action ?? null, input.followUpAt ?? null,
          input.followUpNotes ?? null, input.resolution ?? null, input.internalNotes ?? null,
          input.parentVisible ?? false],
      );
      const row = inserted.rows[0] as Record<string, unknown>;
      const id = Number(row.id);
      await saveRevision(client, req, schoolId, studentId, "BEHAVIOUR", id, 1, row);
      await storeIdempotency(client, req, schoolId, studentId, "BEHAVIOUR", key, input, id);
      await audit(client, req, schoolId, "BEHAVIOUR_RECORD_CREATED", "BEHAVIOUR", id, { category: input.category, status: "REVIEW", version: 1 });
      return row;
    });
    res.status(201).json(behaviourRecordOutputSchema.parse(result));
  }),
);

router.patch(
  "/schools/:schoolId/students/:studentId/behaviour/:recordId",
  asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const studentId = positiveId(req.params.studentId, "Student");
    const recordId = positiveId(req.params.recordId, "Behaviour record");
    const input = parseInput(behaviourRecordPatchSchema, req.body);
    const found = await pool.query(
      `SELECT category,school_class_id AS "schoolClassId",subject_id AS "subjectId"
         FROM student_behaviour_records WHERE id=$1 AND school_id=$2 AND student_id=$3`,
      [recordId, schoolId, studentId],
    );
    const before = found.rows[0] as { category: string; schoolClassId: number | null; subjectId: number | null } | undefined;
    if (!before) throw new AuthError(404, "Behaviour record not found");
    await assertTeacherBehaviourRecordScope(req, schoolId, studentId, before.schoolClassId, before.subjectId);
    const behaviorOptions = await pool.query(
      `SELECT categories,actions FROM student_behaviour_configurations WHERE school_id=$1`,
      [schoolId],
    );
    const allowedCategories = (behaviorOptions.rows[0] as { categories: string[] } | undefined)?.categories ??
      ["POSITIVE", "CONCERN", "INCIDENT", "RULE_VIOLATION", "RECOGNITION"];
    const allowedActions = (behaviorOptions.rows[0] as { actions: string[] } | undefined)?.actions ??
      ["Verbal warning", "Written warning", "Detention", "Counselling", "Parent meeting", "Behaviour agreement", "Suspension"];
    if (input.category && !allowedCategories.includes(input.category)) throw new AuthError(400, "Behaviour category is not enabled by the school");
    if (input.action && !allowedActions.includes(input.action)) throw new AuthError(400, "Behaviour action is not configured by the school");
    const context = getUserContext(req);
    const admin = await isSchoolAdmin(req, schoolId);
    const teacherMember = context.roles.some((role) => role.status === "ACTIVE" && role.schoolId === schoolId && role.role === "TEACHER");
    if (!admin && !await hasPermission(context.user.id, schoolId, "BEHAVIOUR_WRITE")) {
      if (teacherMember) throw new AuthError(403, "Assigned teachers may create records but require an explicit grant to edit them");
      await requireCareAccess(req, schoolId, studentId, "BEHAVIOUR_WRITE");
    }
    if (!admin && input.status && !await hasPermission(context.user.id, schoolId, "BEHAVIOUR_REVIEW")) {
      throw new AuthError(403, "Behaviour lifecycle review permission is required");
    }
    if (!admin && input.status === "ACTION" && !await hasPermission(context.user.id, schoolId, "BEHAVIOUR_ACTION")) {
      throw new AuthError(403, "Behaviour action permission is required");
    }
    if (teacherMember && !admin && (input.parentVisible || input.internalNotes) &&
        !await hasPermission(context.user.id, schoolId, "BEHAVIOUR_WRITE")) {
      throw new AuthError(403, "Publishing parent-visible records or writing confidential notes requires an explicit behaviour grant");
    }
    const fields: Record<string, string> = {
      category: "category", severity: "severity", description: "description", location: "location",
      occurredAt: "occurred_at", schoolClassId: "school_class_id", subjectId: "subject_id",
      action: "action", followUpAt: "follow_up_at", followUpNotes: "follow_up_notes",
      resolution: "resolution", internalNotes: "internal_notes", parentVisible: "parent_visible",
    };
    const result = await withTransaction(async (client) => {
      const locked = await client.query(
        `SELECT ${behaviourSelect} FROM student_behaviour_records
          WHERE id=$1 AND school_id=$2 AND student_id=$3 FOR UPDATE`,
        [recordId, schoolId, studentId],
      );
      const current = locked.rows[0] as Record<string, unknown> | undefined;
      if (!current || current.archivedAt) throw new AuthError(404, "Behaviour record not found");
      if (Number(current.version) !== input.expectedVersion) throw new AuthError(409, "Behaviour record version is stale");
      const nextClassId = Object.hasOwn(input, "schoolClassId")
        ? input.schoolClassId ?? null
        : current.schoolClassId as number | null;
      const nextSubjectId = Object.hasOwn(input, "subjectId")
        ? input.subjectId ?? null
        : current.subjectId as number | null;
      if (teacherMember && !admin &&
          (!nextClassId || !await teacherAssignedToStudent(context.user.id, schoolId, studentId, nextClassId, nextSubjectId))) {
        throw new AuthError(403, "Updated class or subject context is outside your active assignment");
      }
      if (input.status && !nextBehaviourStatus(String(current.status), input.status)) {
        throw new AuthError(409, "Behaviour workflow must advance one stage at a time");
      }
      if (input.status === "PARENT_NOTIFICATION" && input.parentNotificationRequested !== true) {
        throw new AuthError(400, "Request parent notification to complete the notification stage");
      }
      if (input.status === "ACTION" && !(input.action ?? current.action)) {
        throw new AuthError(400, "An action is required before the action stage can be completed");
      }
      if (input.status === "FOLLOW_UP" && !(input.followUpAt ?? current.followUpAt ?? input.followUpNotes ?? current.followUpNotes)) {
        throw new AuthError(400, "Follow-up date or notes are required before follow-up stage");
      }
      if (input.status === "RESOLVED" && !(input.resolution ?? current.resolution)) {
        throw new AuthError(400, "Resolution is required before closing a behaviour record");
      }
      const changes = Object.entries(fields).filter(([key]) => Object.hasOwn(input, key));
      const values: unknown[] = [recordId, schoolId, studentId];
      const sets = changes.map(([key, column]) => {
        values.push(input[key as keyof typeof input] ?? null);
        return `${column}=$${values.length}`;
      });
      if (input.status) {
        values.push(input.status);
        sets.push(`status=$${values.length}`);
      }
      let notificationId: number | null = null;
      let notificationStatus: string | null = null;
      if (input.status === "PARENT_NOTIFICATION" && input.parentNotificationRequested) {
        const parents = await client.query<{ userId: number }>(
          `SELECT DISTINCT p.user_id AS "userId"
             FROM parents p
             JOIN parent_student_relationships psr
               ON psr.parent_id=p.id AND UPPER(psr.status)='ACTIVE'
             JOIN students st ON st.id=psr.student_id AND st.school_id=p.school_id
            WHERE psr.student_id=$1 AND p.school_id=$2
              AND p.user_id IS NOT NULL AND UPPER(p.status)='ACTIVE'
            ORDER BY p.user_id`,
          [studentId, schoolId],
        );
        {
          let queuedCount = 0;
          let failureCount = 0;
          for (const parent of parents.rows) {
            try {
              const id = await queueCommunicationNotification(client, {
                recipientUserId: Number(parent.userId),
                schoolId,
                subjectStudentId: studentId,
                category: "ACADEMIC",
                eventKey: `student-care-behaviour:${schoolId}:${recordId}:${parent.userId}`,
                subject: parentBehaviourNotification.subject,
                body: parentBehaviourNotification.body,
                link: "/parent/dashboard",
                channels: ["IN_APP"],
              });
              if (id !== null) {
                notificationId ??= id;
                queuedCount += 1;
              }
            } catch {
              failureCount += 1;
            }
          }
          notificationStatus = resolveParentNotificationStatus(parents.rows.length, queuedCount, failureCount);
        }
      }
      if (notificationStatus) {
        values.push(notificationStatus);
        sets.push(`parent_notification_status=$${values.length}`);
        values.push(notificationId);
        sets.push(`parent_notification_id=$${values.length}`);
      }
      if (!sets.length) throw new AuthError(400, "At least one behaviour field or workflow stage is required");
      values.push(input.expectedVersion);
      const updated = await client.query(
        `UPDATE student_behaviour_records SET ${sets.join(",")},version=version+1,updated_at=now()
          WHERE id=$1 AND school_id=$2 AND student_id=$3 AND version=$${values.length} AND archived_at IS NULL
          RETURNING ${behaviourSelect}`,
        values,
      );
      const row = updated.rows[0] as Record<string, unknown> | undefined;
      if (!row) throw new AuthError(409, "Behaviour record version changed; reload before retrying");
      await saveRevision(client, req, schoolId, studentId, "BEHAVIOUR", recordId, Number(row.version), row);
      await audit(client, req, schoolId, input.status === "ACTION" ? "BEHAVIOUR_ACTION_RECORDED" :
        input.status === "PARENT_NOTIFICATION" ? "BEHAVIOUR_PARENT_NOTIFICATION_REQUESTED" :
          input.status === "RESOLVED" ? "BEHAVIOUR_RESOLVED" : "BEHAVIOUR_RECORD_UPDATED",
      "BEHAVIOUR", recordId, {
        status: String(row.status),
        notificationStatus: String(row.parentNotificationStatus),
        version: Number(row.version),
      });
      return row;
    });
    res.json(behaviourRecordOutputSchema.parse(result));
  }),
);

router.delete(
  "/schools/:schoolId/students/:studentId/behaviour/:recordId",
  asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const studentId = positiveId(req.params.studentId, "Student");
    const recordId = positiveId(req.params.recordId, "Behaviour record");
    const version = expectedVersion(req);
    const found = await pool.query(
      `SELECT school_class_id AS "schoolClassId",subject_id AS "subjectId"
         FROM student_behaviour_records WHERE id=$1 AND school_id=$2 AND student_id=$3`,
      [recordId, schoolId, studentId],
    );
    const context = found.rows[0] as { schoolClassId: number | null; subjectId: number | null } | undefined;
    if (!context) throw new AuthError(404, "Behaviour record not found");
    await assertTeacherBehaviourRecordScope(req, schoolId, studentId, context.schoolClassId, context.subjectId);
    await requireCareAccess(req, schoolId, studentId, "BEHAVIOUR_WRITE");
    const row = await withTransaction(async (client) => {
      const updated = await client.query(
        `UPDATE student_behaviour_records SET archived_at=now(),updated_at=now(),version=version+1
          WHERE id=$1 AND school_id=$2 AND student_id=$3 AND version=$4 AND archived_at IS NULL
          RETURNING ${behaviourSelect}`,
        [recordId, schoolId, studentId, version],
      );
      const archived = updated.rows[0] as Record<string, unknown> | undefined;
      if (!archived) throw new AuthError(409, "Behaviour record version is stale or already archived");
      await saveRevision(client, req, schoolId, studentId, "BEHAVIOUR", recordId, Number(archived.version), archived);
      await audit(client, req, schoolId, "BEHAVIOUR_RECORD_ARCHIVED", "BEHAVIOUR", recordId, { version: Number(archived.version) });
      return archived;
    });
    res.json(behaviourRecordOutputSchema.parse(row));
  }),
);

router.get(
  "/schools/:schoolId/students/:studentId/behaviour/:recordId/history",
  asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const studentId = positiveId(req.params.studentId, "Student");
    const recordId = positiveId(req.params.recordId, "Behaviour record");
    const record = await pool.query(
      `SELECT school_class_id AS "schoolClassId",subject_id AS "subjectId"
         FROM student_behaviour_records WHERE id=$1 AND school_id=$2 AND student_id=$3`,
      [recordId, schoolId, studentId],
    );
    const scopedRecord = record.rows[0] as { schoolClassId: number | null; subjectId: number | null } | undefined;
    if (!scopedRecord) throw new AuthError(404, "Behaviour record not found");
    await assertTeacherBehaviourRecordScope(req, schoolId, studentId, scopedRecord.schoolClassId, scopedRecord.subjectId);
    await requireCareAccess(req, schoolId, studentId, "BEHAVIOUR_READ", { allowAssignedTeacher: true });
    const result = await pool.query(
      `SELECT revision,changed_at AS "changedAt",changed_by_user_id AS "changedByUserId",snapshot
         FROM student_care_record_history
        WHERE school_id=$1 AND student_id=$2 AND record_type='BEHAVIOUR' AND record_id=$3
        ORDER BY revision`,
      [schoolId, studentId, recordId],
    );
    res.json(result.rows.map((row) => careHistoryEntryOutputSchema.parse(row)));
  }),
);

router.get(
  "/schools/:schoolId/behaviour/configuration",
  asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    const context = getUserContext(req);
    if (isActiveOwner(context)) throw new AuthError(403, "Platform Owner accounts are excluded from student-care access");
    if (!await isSchoolAdmin(req, schoolId) && !context.roles.some((role) => role.status === "ACTIVE" && role.schoolId === schoolId && role.role === "TEACHER")) {
      throw new AuthError(403, "School behaviour configuration access is required");
    }
    const result = await pool.query(
      `SELECT categories,actions,version,"updated_at" AS "updatedAt"
         FROM student_behaviour_configurations WHERE school_id=$1`,
      [schoolId],
    );
    res.json(behaviourConfigurationOutputSchema.parse(result.rows[0] ?? {
      categories: ["POSITIVE", "CONCERN", "INCIDENT", "RULE_VIOLATION", "RECOGNITION"],
      actions: ["Verbal warning", "Written warning", "Detention", "Counselling", "Parent meeting", "Behaviour agreement", "Suspension"],
      version: 0,
      updatedAt: null,
    }));
  }),
);

router.put(
  "/schools/:schoolId/behaviour/configuration",
  asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    if (!await isSchoolAdmin(req, schoolId)) throw new AuthError(403, "School Admin operational access is required");
    const input = parseInput(behaviourConfigurationInputSchema, req.body);
    if (input.categories.some((category) => !["POSITIVE", "CONCERN", "INCIDENT", "RULE_VIOLATION", "RECOGNITION"].includes(category))) {
      throw new AuthError(400, "Behaviour categories must be one or more supported behaviour types");
    }
    const result = await withTransaction(async (client) => {
      const current = await client.query(
        `SELECT categories,actions,version FROM student_behaviour_configurations WHERE school_id=$1 FOR UPDATE`,
        [schoolId],
      );
      const old = current.rows[0] as { categories: string[]; actions: string[]; version: number } | undefined;
      const version = Number(old?.version ?? 0);
      if (version !== input.expectedVersion) throw new AuthError(409, "Behaviour configuration version is stale");
      const context = getUserContext(req);
      const saved = await client.query(
        `INSERT INTO student_behaviour_configurations
          (school_id,categories,actions,updated_by_user_id,version,updated_at)
         VALUES ($1,$2::jsonb,$3::jsonb,$4,1,now())
         ON CONFLICT (school_id) DO UPDATE SET categories=EXCLUDED.categories,actions=EXCLUDED.actions,
           updated_by_user_id=EXCLUDED.updated_by_user_id,version=student_behaviour_configurations.version+1,
           updated_at=now()
         WHERE student_behaviour_configurations.version=$5
         RETURNING school_id AS "schoolId",categories,actions,version,updated_at AS "updatedAt"`,
        [schoolId, JSON.stringify(input.categories), JSON.stringify(input.actions), context.user.id, input.expectedVersion],
      );
      const row = saved.rows[0] as Record<string, unknown> | undefined;
      if (!row) throw new AuthError(409, "Behaviour configuration changed; reload before retrying");
      await audit(client, req, schoolId, "BEHAVIOUR_CONFIGURATION_UPDATED", "BEHAVIOUR_CONFIGURATION", schoolId, { version: Number(row.version) });
      // Validate the public DTO before commit; RETURNING also contains the
      // internal schoolId, which the strict response contract does not allow.
      return behaviourConfigurationOutputSchema.parse({
        categories: row.categories,
        actions: row.actions,
        version: row.version,
        updatedAt: row.updatedAt,
      });
    });
    res.json(behaviourConfigurationOutputSchema.parse(result));
  }),
);

router.get(
  "/schools/:schoolId/care-access",
  asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    if (!await isSchoolAdmin(req, schoolId)) throw new AuthError(403, "School Admin operational access is required");
    const result = await pool.query(
      `SELECT g.school_id AS "schoolId",g.user_id AS "userId",g.active,g.permissions,
              g.updated_at AS "updatedAt"
         FROM student_care_grants g
        WHERE g.school_id=$1 ORDER BY g.user_id`,
      [schoolId],
    );
    res.json(result.rows.map((row) => careGrantOutputSchema.parse(row)));
  }),
);

router.put(
  "/schools/:schoolId/care-access",
  asyncRoute(async (req, res) => {
    const schoolId = positiveId(req.params.schoolId, "School");
    if (!await isSchoolAdmin(req, schoolId)) throw new AuthError(403, "School Admin operational access is required");
    const input = parseInput(careGrantInputSchema, req.body);
    const target = await pool.query(
      `SELECT 1 FROM app_users u
        WHERE u.id=$1 AND UPPER(u.status)='ACTIVE'
          AND EXISTS (SELECT 1 FROM school_memberships sm
                       WHERE sm.user_id=u.id AND sm.school_id=$2 AND UPPER(sm.status)='ACTIVE')
          AND NOT EXISTS (SELECT 1 FROM school_memberships owner_role
                           WHERE owner_role.user_id=u.id AND owner_role.school_id IS NULL
                             AND owner_role.role='PLATFORM_OWNER' AND UPPER(owner_role.status)='ACTIVE')
        LIMIT 1`,
      [input.userId, schoolId],
    );
    if (!target.rows[0]) throw new AuthError(404, "Active school user not found");
    const row = await withTransaction(async (client) => {
      const saved = await client.query(
        `INSERT INTO student_care_grants(school_id,user_id,permissions,active,granted_by_user_id,updated_at)
         VALUES ($1,$2,$3::text[],$4,$5,now())
         ON CONFLICT (school_id,user_id) DO UPDATE SET permissions=EXCLUDED.permissions,
           active=EXCLUDED.active,granted_by_user_id=EXCLUDED.granted_by_user_id,updated_at=now()
         RETURNING school_id AS "schoolId",user_id AS "userId",active,permissions,updated_at AS "updatedAt"`,
        [schoolId, input.userId, input.permissions, input.active, getUserContext(req).user.id],
      );
      await audit(client, req, schoolId, input.active ? "STUDENT_CARE_GRANT_UPDATED" : "STUDENT_CARE_GRANT_REVOKED",
        "CARE_GRANT", input.userId, { permissionCount: input.permissions.length, active: input.active });
      return careGrantOutputSchema.parse(saved.rows[0]);
    });
    res.json(row);
  }),
);

async function loadParentVisibleCareSummary(schoolId: number, studentId: number) {
  const [welfare, behaviour] = await Promise.all([
    pool.query(
      `SELECT id,category,concern,status,updated_at AS "updatedAt"
         FROM student_welfare_records
        WHERE school_id=$1 AND student_id=$2 AND parent_visible=TRUE
          AND category <> 'SAFEGUARDING' AND archived_at IS NULL
        ORDER BY updated_at DESC`,
      [schoolId, studentId],
    ),
    pool.query(
      `SELECT id,category,description,status,occurred_at AS "occurredAt"
         FROM student_behaviour_records
        WHERE school_id=$1 AND student_id=$2 AND parent_visible=TRUE AND archived_at IS NULL
        ORDER BY occurred_at DESC`,
      [schoolId, studentId],
    ),
  ]);
  return parentCareSummaryOutputSchema.parse({
    studentId,
    welfare: welfare.rows.map((row) => projectParentWelfare(row as Record<string, unknown>)),
    behaviour: behaviour.rows.map((row) => projectParentBehaviour(row as Record<string, unknown>)),
  });
}

router.get(
  "/student/care-summary",
  asyncRoute(async (req, res) => {
    const context = getUserContext(req);
    if (isActiveOwner(context)) throw new AuthError(403, "Platform Owner accounts are excluded from student-care access");
    const activeSchoolIds = context.roles
      .filter((role) => role.status === "ACTIVE" && role.role === "STUDENT" && role.schoolId !== null)
      .map((role) => role.schoolId as number);
    if (!activeSchoolIds.length) throw new AuthError(403, "An active student role is required");
    const mapped = await pool.query(
      `SELECT st.id AS "studentId",st.school_id AS "schoolId"
         FROM students st
         JOIN app_users u ON u.id=st.user_id AND UPPER(u.status)='ACTIVE'
         JOIN school_memberships sm
           ON sm.user_id=st.user_id AND sm.school_id=st.school_id
          AND UPPER(sm.role)='STUDENT' AND UPPER(sm.status)='ACTIVE'
        WHERE st.user_id=$1 AND st.school_id=ANY($2::integer[])
          AND UPPER(st.status)='ACTIVE'
        LIMIT 1`,
      [context.user.id, activeSchoolIds],
    );
    const student = mapped.rows[0] as { studentId: number; schoolId: number } | undefined;
    if (!student) throw new AuthError(404, "Active student account mapping not found");
    res.json(await loadParentVisibleCareSummary(student.schoolId, student.studentId));
  }),
);

router.get(
  "/parent/children/:studentId/care-summary",
  asyncRoute(async (req, res) => {
    const context = getUserContext(req);
    if (isActiveOwner(context)) throw new AuthError(403, "Platform Owner accounts are excluded from student-care access");
    if (!context.roles.some((role) => role.status === "ACTIVE" && role.role === "PARENT")) {
      throw new AuthError(403, "Parent access is required");
    }
    const studentId = positiveId(req.params.studentId, "Student");
    const linked = await pool.query(
      `SELECT st.id AS "studentId",st.school_id AS "schoolId"
         FROM parents p
         JOIN parent_student_relationships psr
           ON psr.parent_id=p.id AND UPPER(psr.status)='ACTIVE'
         JOIN students st ON st.id=psr.student_id AND st.school_id=p.school_id
        WHERE p.user_id=$1 AND psr.student_id=$2
          AND UPPER(p.status)='ACTIVE' AND UPPER(st.status)='ACTIVE'
        LIMIT 1`,
      [context.user.id, studentId],
    );
    const child = linked.rows[0] as { studentId: number; schoolId: number } | undefined;
    if (!child) throw new AuthError(404, "Student not found");
    res.json(await loadParentVisibleCareSummary(child.schoolId, studentId));
  }),
);

export default router;