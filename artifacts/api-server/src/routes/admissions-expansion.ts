import { createHmac } from "node:crypto";
import { Router, type NextFunction, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { AuthError, assertSchoolOperationalAccess, getUserContext, handleAuthError, requireAuthentication } from "../middlewares/auth";
import { generateAdmissionNumber } from "./admission-number";
import {
  admissionApplicationInputSchema,
  admissionApplicationListResponseSchema,
  admissionApplicationPatchInputSchema,
  admissionApplicationResponseSchema,
  admissionConversionInputSchema,
  admissionConversionResponseSchema,
  admissionDocumentDownloadInputSchema,
  admissionDocumentDownloadResponseSchema,
  admissionDocumentInputSchema,
  admissionDocumentResponseSchema,
  admissionDocumentUploadInputSchema,
  admissionDocumentUploadResponseSchema,
  admissionPortalSettingsInputSchema,
  admissionPortalSettingsResponseSchema,
  admissionReviewInputSchema,
  admissionStatusTransitionInputSchema,
  admissionTrackingInputSchema,
  canTransitionAdmissionStatus,
  newAdmissionReceiptSecret,
  publicAdmissionApplicationReceiptSchema,
  publicAdmissionApplicationStatusSchema,
  publicAdmissionPortalResponseSchema,
  sha256,
  stableJson,
  verifyAdmissionReceipt,
  type AdmissionApplicationInput,
  type AdmissionStatus,
} from "../services/admissions";
import {
  admissionDocumentDownloadUrl,
  admissionDocumentUploadUrl,
  admissionsObjectPathMatchesApplication,
  assertStagedAdmissionObject,
  newAdmissionDocumentPath,
  newAdmissionIntakeDocumentPath,
  publicAdmissionLogoUrl,
} from "../services/admissions-storage";
import { isManagedSchoolLogoObjectPath, readValidatedSchoolLogo } from "../lib/schoolLogoStorage";
import { emitDomainParentEvent } from "../services/communication-service";

const router = Router();
const publicPortalKey = /^[a-z0-9][a-z0-9-]{2,79}$/;
const idemKeyPattern = /^[A-Za-z0-9._:-]{16,128}$/;
const rateWindowMs = 10 * 60 * 1000;

class AdmissionConflict extends Error {
  constructor(message: string, readonly code = "ADMISSION_CONFLICT") {
    super(message);
  }
}

class AdmissionRateLimit extends Error {
  constructor(message: string, readonly retryAfterSeconds: number) {
    super(message);
  }
}

const asyncRoute =
  (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    handler(req, res).catch((error) => {
      if (error instanceof AdmissionRateLimit) {
        res.set("Retry-After", String(error.retryAfterSeconds));
        res.status(429).json({ error: error.message, code: "RATE_LIMITED" });
        return;
      }
      if (error instanceof AdmissionConflict) {
        res.status(409).json({ error: error.message, code: error.code });
        return;
      }
      handleAuthError(error, req, res, next);
    });

function parse<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ message: string }> } } },
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new AuthError(400, result.error.issues[0]?.message ?? "Request validation failed");
  return result.data;
}

function safeId(value: unknown, label: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1) throw new AuthError(400, `${label} must be a positive integer`);
  return id;
}

function keyFromRequest(req: Request): string {
  const raw = req.get("Idempotency-Key")?.trim() ?? "";
  if (!idemKeyPattern.test(raw)) throw new AuthError(400, "Idempotency-Key must be 16 to 128 safe characters");
  return raw;
}

function normalizedPortalKey(req: Request): string {
  const value = Array.isArray(req.params.portalKey) ? req.params.portalKey[0] : req.params.portalKey;
  if (typeof value !== "string" || !publicPortalKey.test(value)) throw new AuthError(404, "Admission portal not found");
  return value;
}

function timestamp(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  return date.toISOString();
}

function dateString(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function jsonValue(value: unknown, fallback: unknown = null): any {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

function activeSchoolAdmin(req: Request, schoolId: number) {
  return assertSchoolOperationalAccess(req, schoolId, ["SCHOOL_ADMIN"]);
}

function auditActorRole(req: Request, schoolId: number): string {
  const context = getUserContext(req);
  return context.roles.find((assignment) =>
    assignment.status === "ACTIVE" &&
    assignment.schoolId === schoolId &&
    assignment.role === "SCHOOL_ADMIN")?.role ?? "SCHOOL_ADMIN";
}

async function audit(
  client: { query: (sql: string, values?: unknown[]) => Promise<any> },
  req: Request | null,
  schoolId: number,
  action: string,
  eventType: string,
  recordId: number,
  metadata: Record<string, unknown>,
): Promise<void> {
  const context = req ? getUserContext(req) : null;
  const actor = context
    ? [context.user.firstName, context.user.lastName].filter(Boolean).join(" ") || context.user.email
    : "Public applicant";
  await client.query(
    `INSERT INTO audit_logs
       ("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,severity,event_type,result,metadata)
     VALUES($1,$2,$3,$4,$5,$6,'Admissions',$7,'info',$8,'SUCCESS',$9::jsonb)`,
    [actor, context ? auditActorRole(req!, schoolId) : "PUBLIC", context?.user.id ?? null,
      context?.user.clerkUserId ?? null, schoolId, action, recordId, eventType, JSON.stringify(metadata)],
  );
}

async function enforcePublicLimit(req: Request, scope: string, maxRequests: number): Promise<void> {
  const hmacKey = process.env.CLERK_SECRET_KEY;
  if (!hmacKey) throw new Error("CLERK_SECRET_KEY is required for privacy-preserving admissions rate limits");
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const bucketHash = createHmac("sha256", hmacKey).update(`admissions:${scope}:${ip}`).digest("hex");
  const result = await pool.query(
    `INSERT INTO admission_request_rate_limits(bucket_hash,bucket_started_at,request_count,updated_at)
     VALUES($1,NOW(),1,NOW())
     ON CONFLICT(bucket_hash) DO UPDATE SET
       request_count=CASE WHEN admission_request_rate_limits.bucket_started_at <= NOW() - INTERVAL '10 minutes'
         THEN 1 ELSE admission_request_rate_limits.request_count+1 END,
       bucket_started_at=CASE WHEN admission_request_rate_limits.bucket_started_at <= NOW() - INTERVAL '10 minutes'
         THEN NOW() ELSE admission_request_rate_limits.bucket_started_at END,
       updated_at=NOW()
     RETURNING request_count,
       GREATEST(1,CEIL(EXTRACT(EPOCH FROM (bucket_started_at + INTERVAL '10 minutes' - NOW()))))::int AS "retryAfterSeconds"`,
    [bucketHash],
  );
  const count = Number(result.rows[0]?.request_count ?? 0);
  if (count > maxRequests) {
    throw new AdmissionRateLimit("Too many admission requests. Please wait before trying again.",
      Number(result.rows[0]?.retryAfterSeconds ?? Math.ceil(rateWindowMs / 1000)));
  }
}

async function availableSchoolLogoObjectPath(
  client: { query: (sql: string, values?: unknown[]) => Promise<any> },
  schoolId: number,
): Promise<string | null> {
  const result = await client.query(
    `SELECT s.logo AS legacy_logo_path,l.object_path AS current_logo_path
       FROM schools s
       LEFT JOIN school_branding_logos l ON l.school_id=s.id AND l.is_current=true
      WHERE s.id=$1`,
    [schoolId],
  );
  const candidate = result.rows[0]?.current_logo_path ?? result.rows[0]?.legacy_logo_path;
  return isManagedSchoolLogoObjectPath(schoolId, candidate) ? candidate : null;
}

async function publicPortalLogoUrl(objectPath: string | null, schoolId: number): Promise<string | null> {
  if (isManagedSchoolLogoObjectPath(schoolId, objectPath)) {
    const logo = await readValidatedSchoolLogo(schoolId, objectPath);
    return `data:${logo.contentType};base64,${logo.bytes.toString("base64")}`;
  }
  return publicAdmissionLogoUrl(objectPath);
}

function mapPortalSettings(row: Record<string, any>, availableClassIds: number[], availableSchoolLogoObjectPath: string | null) {
  return {
    schoolId: Number(row.school_id),
    portalKey: row.portal_key,
    portalUrl: `/admissions/portal/${row.portal_key}`,
    open: row.is_open,
    academicSessionId: row.academic_session_id == null ? null : Number(row.academic_session_id),
    academicTermId: row.academic_term_id == null ? null : Number(row.academic_term_id),
    availableClassIds,
    deadline: dateString(row.deadline),
    feeInfo: row.fee_info,
    requirements: jsonValue(row.requirements, []),
    requiredDocuments: jsonValue(row.required_documents, []),
    instructions: row.instructions,
    entranceExamination: row.entrance_examination,
    interviewInformation: row.interview_information,
    publicDescription: row.public_description,
    publicAddress: row.public_address,
    publicPhone: row.public_phone,
    publicEmail: row.public_email,
    logoObjectPath: row.logo_object_path,
    availableSchoolLogoObjectPath,
  };
}

async function fetchSettings(client: { query: (sql: string, values?: unknown[]) => Promise<any> }, schoolId: number) {
  const result = await client.query(
    `SELECT * FROM admission_portal_settings WHERE school_id=$1`,
    [schoolId],
  );
  const row = result.rows[0];
  if (!row) throw new AuthError(404, "Admission portal settings not found");
  const classes = await client.query(
    `SELECT class_id FROM admission_portal_classes WHERE school_id=$1 ORDER BY class_id`,
    [schoolId],
  );
  const schoolLogoPath = await availableSchoolLogoObjectPath(client, schoolId);
  return mapPortalSettings(row, classes.rows.map((item: any) => Number(item.class_id)), schoolLogoPath);
}

function applicationDto(row: Record<string, any>, documents: Record<string, any>[]) {
  return {
    id: Number(row.id),
    schoolId: Number(row.school_id),
    applicationNumber: row.application_number,
    status: row.status,
    applicant: {
      firstName: row.applicant_first_name,
      middleName: row.applicant_middle_name,
      lastName: row.applicant_last_name,
      dateOfBirth: dateString(row.date_of_birth),
      gender: row.gender,
      photoObjectPath: row.photo_object_path,
      previousSchool: row.previous_school,
      previousClass: row.previous_class,
      intendedClassId: Number(row.intended_class_id),
      academicSessionId: Number(row.academic_session_id),
      academicTermId: row.academic_term_id == null ? null : Number(row.academic_term_id),
      address: row.applicant_address,
    },
    guardian: {
      fullName: row.guardian_name,
      phone: row.guardian_phone,
      email: row.guardian_email,
      relationship: row.guardian_relationship,
      address: row.guardian_address,
    },
    emergencyContact: row.emergency_contact_name
      ? { fullName: row.emergency_contact_name, phone: row.emergency_contact_phone, relationship: row.emergency_contact_relationship }
      : null,
    documents: documents.map((doc) => ({
      id: Number(doc.id),
      documentType: doc.document_type,
      fileName: doc.file_name,
      contentType: doc.content_type,
      byteSize: Number(doc.byte_size),
      objectPath: doc.object_path,
    })),
    assessment: jsonValue(row.assessment),
    interview: jsonValue(row.interview),
    internalNotes: row.internal_notes,
    publicMessage: row.public_message,
    studentId: row.converted_student_id == null ? null : Number(row.converted_student_id),
    version: Number(row.version),
    createdAt: timestamp(row.created_at),
    updatedAt: timestamp(row.updated_at),
  };
}

async function fetchApplication(
  client: { query: (sql: string, values?: unknown[]) => Promise<any> },
  applicationId: number,
  schoolId: number,
) {
  const result = await client.query(
    `SELECT * FROM admission_applications WHERE id=$1 AND school_id=$2`,
    [applicationId, schoolId],
  );
  const row = result.rows[0];
  if (!row) throw new AuthError(404, "Admission application not found");
  const docs = await client.query(
    `SELECT id,document_type,file_name,content_type,byte_size,object_path
       FROM admission_application_documents WHERE application_id=$1 AND school_id=$2 ORDER BY id`,
    [applicationId, schoolId],
  );
  return { row, dto: admissionApplicationResponseSchema.parse(applicationDto(row, docs.rows)) };
}

async function validateSchoolReferences(
  client: { query: (sql: string, values?: unknown[]) => Promise<any> },
  schoolId: number,
  classId: number,
  sessionId: number,
  termId: number | null,
): Promise<void> {
  const cls = await client.query(
    `SELECT id FROM school_classes WHERE id=$1 AND school_id=$2`,
    [classId, schoolId],
  );
  const session = await client.query(
    `SELECT id FROM academic_sessions WHERE id=$1 AND school_id=$2`,
    [sessionId, schoolId],
  );
  if (!cls.rows[0] || !session.rows[0]) throw new AuthError(400, "Admission class and session must belong to the selected school");
  if (termId != null) {
    const term = await client.query(
      `SELECT id FROM academic_terms WHERE id=$1 AND school_id=$2 AND academic_session_id=$3`,
      [termId, schoolId, sessionId],
    );
    if (!term.rows[0]) throw new AuthError(400, "Admission term must belong to the selected school and session");
  }
}

function dateIsPast(date: string | null): boolean {
  return Boolean(date && date < new Date().toISOString().slice(0, 10));
}

async function createApplication(
  req: Request | null,
  schoolId: number,
  input: AdmissionApplicationInput,
  idempotencyKey: string,
  source: "PUBLIC" | "STAFF",
  draft: boolean,
) {
  const canonicalPayload = stableJson({ input, source, draft, schoolId });
  const payloadHash = sha256(canonicalPayload);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const previous = await client.query(
      `SELECT id,payload_hash FROM admission_applications WHERE school_id=$1 AND idempotency_key=$2 FOR UPDATE`,
      [schoolId, idempotencyKey],
    );
    if (previous.rows[0]) {
      if (previous.rows[0].payload_hash !== payloadHash) {
        throw new AdmissionConflict("Idempotency-Key was already used for a different application payload.", "IDEMPOTENCY_KEY_CONFLICT");
      }
      if (source === "PUBLIC") {
        throw new AdmissionConflict(
          "This application was already created. Use the receipt secret returned by the original response; it cannot be recovered or reissued.",
          "IDEMPOTENT_REPLAY",
        );
      }
      await client.query("COMMIT");
      return (await fetchApplication(pool, Number(previous.rows[0].id), schoolId)).dto;
    }

    const settingsResult = await client.query(
      `SELECT is_open,academic_session_id,academic_term_id,deadline,portal_key
         FROM admission_portal_settings WHERE school_id=$1 FOR UPDATE`,
      [schoolId],
    );
    const settings = settingsResult.rows[0];
    if (!settings) throw new AuthError(404, "Admission portal is unavailable");
    if (source === "PUBLIC" && !settings.is_open) throw new AuthError(403, "Admissions are currently closed");
    const deadline = dateString(settings.deadline);
    if (source === "PUBLIC" && dateIsPast(deadline)) throw new AuthError(403, "The admission application deadline has passed");
    const configuredSession = settings.academic_session_id == null ? null : Number(settings.academic_session_id);
    const configuredTerm = settings.academic_term_id == null ? null : Number(settings.academic_term_id);
    const sessionId = input.applicant.academicSessionId ?? configuredSession;
    const termId = input.applicant.academicTermId ?? configuredTerm;
    if (!sessionId) throw new AuthError(400, "An admission academic session must be configured or selected");
    if (configuredSession != null && sessionId !== configuredSession) throw new AuthError(400, "The selected academic session is not open for admission");
    if (configuredTerm != null && termId !== configuredTerm) throw new AuthError(400, "The selected admission term is not open for admission");
    await validateSchoolReferences(client, schoolId, input.applicant.intendedClassId, sessionId, termId ?? null);
    if (source === "PUBLIC") {
      const available = await client.query(
        `SELECT 1 FROM admission_portal_classes WHERE school_id=$1 AND class_id=$2`,
        [schoolId, input.applicant.intendedClassId],
      );
      if (!available.rows[0]) throw new AuthError(400, "The selected class is not available for public admission");
    }
    for (const document of input.documents ?? []) {
      if (!document.objectPath.startsWith(`/objects/admissions/intake/${settings.portal_key}/`)) {
        throw new AuthError(400, "An uploaded document is not staged for this school's admission portal");
      }
      await assertStagedAdmissionObject(document.objectPath, document.contentType, document.byteSize);
    }
    if (input.applicant.photoObjectPath) {
      const photoDocument = (input.documents ?? []).find((document) => document.objectPath === input.applicant.photoObjectPath);
      if (!photoDocument || !["image/jpeg", "image/png", "image/webp"].includes(photoDocument.contentType)) {
        throw new AuthError(400, "Applicant photograph must be included as a confirmed private image document");
      }
    }

    const counter = await client.query(
      `UPDATE admission_application_counters SET current_value=current_value+1,updated_at=NOW()
       WHERE school_id=$1 RETURNING current_value`,
      [schoolId],
    );
    if (!counter.rows[0]) throw new AuthError(500, "Admission application counter is unavailable");
    const school = await client.query(`SELECT registration_number,code FROM schools WHERE id=$1`, [schoolId]);
    if (!school.rows[0]) throw new AuthError(404, "School not found");
    const safeCode = String(school.rows[0].registration_number || school.rows[0].code || `school-${schoolId}`)
      .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || `school-${schoolId}`;
    const applicationNumber = `ADM-${safeCode}-${schoolId}-${new Date().getUTCFullYear()}-${String(counter.rows[0].current_value).padStart(5, "0")}`;
    const receiptSecret = source === "PUBLIC" ? newAdmissionReceiptSecret() : null;
    const result = await client.query(
      `INSERT INTO admission_applications(
         school_id,application_number,status,source,applicant_first_name,applicant_middle_name,applicant_last_name,
         date_of_birth,gender,photo_object_path,previous_school,previous_class,intended_class_id,academic_session_id,
         academic_term_id,applicant_address,guardian_name,guardian_phone,guardian_email,guardian_relationship,
         guardian_address,emergency_contact_name,emergency_contact_phone,emergency_contact_relationship,
         receipt_secret_hash,idempotency_key,payload_hash,created_by_user_id
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
       RETURNING id`,
      [schoolId, applicationNumber, draft ? "Draft" : "Submitted", source,
        input.applicant.firstName, input.applicant.middleName ?? null, input.applicant.lastName,
        input.applicant.dateOfBirth, input.applicant.gender, input.applicant.photoObjectPath ?? null,
        input.applicant.previousSchool ?? null, input.applicant.previousClass ?? null,
        input.applicant.intendedClassId, sessionId, termId ?? null, input.applicant.address ?? null,
        input.guardian.fullName, input.guardian.phone, input.guardian.email ?? null,
        input.guardian.relationship ?? null, input.guardian.address ?? null,
        input.emergencyContact?.fullName ?? null, input.emergencyContact?.phone ?? null,
        input.emergencyContact?.relationship ?? null, receiptSecret ? sha256(receiptSecret) : null,
        idempotencyKey, payloadHash, req ? getUserContext(req).user.id : null],
    );
    const applicationId = Number(result.rows[0].id);
    for (const document of input.documents ?? []) {
      await client.query(
        `INSERT INTO admission_application_documents(
           school_id,application_id,document_type,file_name,content_type,byte_size,object_path,created_by_user_id
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [schoolId, applicationId, document.documentType, document.fileName, document.contentType,
          document.byteSize, document.objectPath, req ? getUserContext(req).user.id : null],
      );
    }
    await audit(client, req, schoolId, "Created admission application",
      source === "PUBLIC" ? "ADMISSION_PUBLIC_APPLICATION_CREATED" : "ADMISSION_STAFF_APPLICATION_CREATED",
      applicationId, { applicationNumber, source, status: draft ? "Draft" : "Submitted" });
    await client.query("COMMIT");
    return source === "PUBLIC"
      ? publicAdmissionApplicationReceiptSchema.parse({
        applicationId,
        applicationNumber,
        status: draft ? "Draft" : "Submitted",
        receiptSecret,
        confirmation: {
          deliveryStatus: "NOT_SENT",
          message: "Application submitted. No SMS or email has been sent.",
        },
      })
      : (await fetchApplication(pool, applicationId, schoolId)).dto;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if ((error as { code?: string })?.code === "23505") {
      throw new AdmissionConflict("A duplicate application request was detected; retry with its original idempotency key.",
        "IDEMPOTENCY_KEY_CONFLICT");
    }
    throw error;
  } finally {
    client.release();
  }
}

router.get("/admissions/portals/:portalKey", asyncRoute(async (req, res) => {
  const portalKey = normalizedPortalKey(req);
  await enforcePublicLimit(req, `portal:${portalKey}`, 120);
  const result = await pool.query(
    `SELECT ps.school_id,ps.portal_key,ps.is_open,ps.deadline,ps.fee_info,ps.requirements,
            ps.required_documents,ps.instructions,ps.entrance_examination,ps.interview_information,
            ps.public_description,ps.public_address,ps.public_phone,ps.public_email,ps.logo_object_path,
            s.name,ss.name AS session_name,st.name AS term_name
       FROM admission_portal_settings ps
       JOIN schools s ON s.id=ps.school_id
       LEFT JOIN academic_sessions ss ON ss.id=ps.academic_session_id AND ss.school_id=ps.school_id
       LEFT JOIN academic_terms st ON st.id=ps.academic_term_id AND st.school_id=ps.school_id
      WHERE ps.portal_key=$1 AND lower(s.status)='active'`,
    [portalKey],
  );
  const row = result.rows[0];
  if (!row) throw new AuthError(404, "Admission portal not found");
  const classes = await pool.query(
    `SELECT c.id,c.name,c.section
       FROM admission_portal_classes pc
       JOIN school_classes c ON c.id=pc.class_id AND c.school_id=pc.school_id
      WHERE pc.school_id=$1 ORDER BY c.name,c.section`,
    [row.school_id],
  );
  const output = publicAdmissionPortalResponseSchema.parse({
    portalKey: row.portal_key,
    school: {
      name: row.name,
      description: row.public_description,
      address: row.public_address,
      publicPhone: row.public_phone,
      publicEmail: row.public_email,
      logoUrl: await publicPortalLogoUrl(row.logo_object_path, Number(row.school_id)),
    },
    admission: {
      open: row.is_open && !dateIsPast(dateString(row.deadline)),
      session: row.session_name ?? null,
      term: row.term_name ?? null,
      deadline: dateString(row.deadline),
      feeInfo: row.fee_info,
      requirements: jsonValue(row.requirements, []),
      requiredDocuments: jsonValue(row.required_documents, []),
      instructions: row.instructions,
      entranceExamination: row.entrance_examination,
      interviewInformation: row.interview_information,
    },
    availableClasses: classes.rows.map((item: any) => ({
      id: Number(item.id),
      name: item.name,
      section: item.section,
    })),
  });
  res.json(output);
}));

router.post("/admissions/documents/upload", requireAuthentication(), asyncRoute(async (req, res) => {
  const schoolId = safeId(req.query.schoolId, "schoolId");
  activeSchoolAdmin(req, schoolId);
  const input = parse(admissionDocumentUploadInputSchema, req.body);
  const portal = await pool.query(
    `SELECT portal_key FROM admission_portal_settings WHERE school_id=$1`,
    [schoolId],
  );
  if (!portal.rows[0]) throw new AuthError(404, "Admission portal settings not found");
  const objectPath = newAdmissionIntakeDocumentPath(String(portal.rows[0].portal_key));
  const uploadUrl = await admissionDocumentUploadUrl(objectPath, input.contentType);
  await audit(pool, req, schoolId, "Issued staff admission document upload link",
    "ADMISSION_STAFF_DOCUMENT_UPLOAD_STAGED", schoolId, {
      documentType: input.documentType,
      contentType: input.contentType,
      byteSize: input.byteSize,
    });
  res.json(admissionDocumentUploadResponseSchema.parse({
    uploadUrl, objectPath, expiresAt: new Date(Date.now() + 180_000).toISOString(),
  }));
}));

router.post("/admissions/portals/:portalKey/documents/upload", asyncRoute(async (req, res) => {
  const portalKey = normalizedPortalKey(req);
  const input = parse(admissionDocumentUploadInputSchema, req.body);
  await enforcePublicLimit(req, `upload:${portalKey}`, 12);
  const portal = await pool.query(
    `SELECT ps.school_id FROM admission_portal_settings ps
       JOIN schools s ON s.id=ps.school_id
      WHERE ps.portal_key=$1 AND ps.is_open=true AND lower(s.status)='active'
        AND (ps.deadline IS NULL OR ps.deadline >= CURRENT_DATE)`,
    [portalKey],
  );
  if (!portal.rows[0]) throw new AuthError(404, "Admission portal is not accepting document uploads");
  const objectPath = newAdmissionIntakeDocumentPath(portalKey);
  const uploadUrl = await admissionDocumentUploadUrl(objectPath, input.contentType);
  res.json(admissionDocumentUploadResponseSchema.parse({
    uploadUrl, objectPath, expiresAt: new Date(Date.now() + 180_000).toISOString(),
  }));
}));

router.post("/admissions/portals/:portalKey/applications", asyncRoute(async (req, res) => {
  const portalKey = normalizedPortalKey(req);
  const input = parse(admissionApplicationInputSchema, req.body);
  const key = keyFromRequest(req);
  await enforcePublicLimit(req, `submit:${portalKey}`, 8);
  const portal = await pool.query(
    `SELECT school_id FROM admission_portal_settings
      WHERE portal_key=$1 AND is_open=true AND (deadline IS NULL OR deadline >= CURRENT_DATE)`,
    [portalKey],
  );
  if (!portal.rows[0]) throw new AuthError(404, "Admission portal is unavailable or closed");
  const receipt = await createApplication(null, Number(portal.rows[0].school_id), input, key, "PUBLIC", false);
  res.status(201).json(receipt);
}));

router.post("/admissions/applications/track", asyncRoute(async (req, res) => {
  const input = parse(admissionTrackingInputSchema, req.body);
  await enforcePublicLimit(req, "tracking", 10);
  const result = await pool.query(
    `SELECT application_number,status,public_message,updated_at,receipt_secret_hash
       FROM admission_applications
      WHERE application_number=$1 AND guardian_phone=$2 AND receipt_secret_hash IS NOT NULL`,
    [input.applicationNumber, input.phone],
  );
  const row = result.rows[0];
  if (!row || !verifyAdmissionReceipt(input.receiptSecret, row.receipt_secret_hash)) {
    throw new AuthError(404, "Application tracking credentials were not found");
  }
  res.json(publicAdmissionApplicationStatusSchema.parse({
    applicationNumber: row.application_number,
    status: row.status,
    publicMessage: row.public_message,
    updatedAt: timestamp(row.updated_at),
  }));
}));

router.get("/admissions/portal-settings", requireAuthentication(), asyncRoute(async (req, res) => {
  const schoolId = safeId(req.query.schoolId, "schoolId");
  activeSchoolAdmin(req, schoolId);
  const settings = await fetchSettings(pool, schoolId);
  res.json(admissionPortalSettingsResponseSchema.parse(settings));
}));

router.put("/admissions/portal-settings", requireAuthentication(), asyncRoute(async (req, res) => {
  const schoolId = safeId(req.query.schoolId, "schoolId");
  activeSchoolAdmin(req, schoolId);
  const input = parse(admissionPortalSettingsInputSchema, req.body);
  if (input.open && (!input.academicSessionId || input.availableClassIds.length === 0)) {
    throw new AuthError(400, "Opening admissions requires an academic session and at least one available class");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (input.availableClassIds.length) {
      const classes = await client.query(
        `SELECT count(*)::int AS count FROM school_classes WHERE school_id=$1 AND id=ANY($2::int[])`,
        [schoolId, input.availableClassIds],
      );
      if (Number(classes.rows[0]?.count) !== input.availableClassIds.length) {
        throw new AuthError(400, "Every available admission class must belong to this school");
      }
    }
    if (input.academicSessionId) {
      const session = await client.query(
        `SELECT 1 FROM academic_sessions WHERE id=$1 AND school_id=$2`,
        [input.academicSessionId, schoolId],
      );
      if (!session.rows[0]) throw new AuthError(400, "Academic session must belong to this school");
    }
    if (input.academicTermId) {
      const term = await client.query(
        `SELECT 1 FROM academic_terms WHERE id=$1 AND school_id=$2 AND academic_session_id=$3`,
        [input.academicTermId, schoolId, input.academicSessionId ?? null],
      );
      if (!term.rows[0]) throw new AuthError(400, "Academic term must belong to this school and selected session");
    }
    if (input.logoObjectPath) {
      if (isManagedSchoolLogoObjectPath(schoolId, input.logoObjectPath)) {
        const candidate = await availableSchoolLogoObjectPath(client, schoolId);
        if (candidate !== input.logoObjectPath) {
          throw new AuthError(400, "Portal logo must be the current confirmed branding logo owned by this school");
        }
        try {
          await readValidatedSchoolLogo(schoolId, input.logoObjectPath);
        } catch {
          throw new AuthError(400, "Current school branding logo is missing or invalid");
        }
      } else {
        const logoPattern = new RegExp(`^/objects/admissions/${schoolId}/[1-9][0-9]*/(?:photo-)?[0-9a-f-]{36}$`, "i");
        if (!logoPattern.test(input.logoObjectPath) || !await publicAdmissionLogoUrl(input.logoObjectPath)) {
          throw new AuthError(400, "Portal logo must be a confirmed image object owned by this school");
        }
      }
    }
    await client.query(
      `UPDATE admission_portal_settings SET
         is_open=$2,academic_session_id=$3,academic_term_id=$4,deadline=$5,fee_info=$6,
         requirements=$7::jsonb,required_documents=$8::jsonb,instructions=$9,
         entrance_examination=$10,interview_information=$11,public_description=$12,
         public_address=$13,public_phone=$14,public_email=$15,logo_object_path=$16,
         updated_by_user_id=$17,updated_at=NOW()
       WHERE school_id=$1`,
      [schoolId, input.open, input.academicSessionId ?? null, input.academicTermId ?? null,
        input.deadline ?? null, input.feeInfo ?? null, JSON.stringify(input.requirements),
        JSON.stringify(input.requiredDocuments), input.instructions ?? null,
        input.entranceExamination ?? null, input.interviewInformation ?? null,
        input.publicDescription ?? null, input.publicAddress ?? null, input.publicPhone ?? null,
        input.publicEmail ?? null, input.logoObjectPath ?? null, getUserContext(req).user.id],
    );
    await client.query(`DELETE FROM admission_portal_classes WHERE school_id=$1`, [schoolId]);
    for (const classId of input.availableClassIds) {
      await client.query(
        `INSERT INTO admission_portal_classes(school_id,class_id) VALUES($1,$2)`,
        [schoolId, classId],
      );
    }
    await audit(client, req, schoolId, "Updated admission portal settings",
      "ADMISSION_PORTAL_SETTINGS_UPDATED", schoolId, { isOpen: input.open });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  res.json(admissionPortalSettingsResponseSchema.parse(await fetchSettings(pool, schoolId)));
}));

router.get("/admissions/applications", requireAuthentication(), asyncRoute(async (req, res) => {
  const schoolId = safeId(req.query.schoolId, "schoolId");
  activeSchoolAdmin(req, schoolId);
  const status = typeof req.query.status === "string" ? req.query.status : null;
  if (status && !["Draft", "Submitted", "UnderReview", "Shortlisted", "InterviewScheduled",
    "AssessmentPending", "AssessmentCompleted", "Accepted", "Waitlisted", "Rejected", "Withdrawn", "Enrolled"].includes(status)) {
    throw new AuthError(400, "Unsupported application status");
  }
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
  const result = await pool.query(
    `SELECT * FROM admission_applications
      WHERE school_id=$1 AND ($2::text IS NULL OR status=$2)
        AND ($3='' OR application_number ILIKE '%' || $3 || '%'
          OR applicant_first_name ILIKE '%' || $3 || '%'
          OR applicant_last_name ILIKE '%' || $3 || '%'
          OR guardian_phone ILIKE '%' || $3 || '%')
      ORDER BY created_at DESC,id DESC LIMIT 100`,
    [schoolId, status, search],
  );
  const applications = [];
  for (const row of result.rows) {
    const docs = await pool.query(
      `SELECT id,document_type,file_name,content_type,byte_size,object_path
         FROM admission_application_documents WHERE application_id=$1 AND school_id=$2 ORDER BY id`,
      [row.id, schoolId],
    );
    applications.push(applicationDto(row, docs.rows));
  }
  res.json(admissionApplicationListResponseSchema.parse({ applications }));
}));

router.post("/admissions/applications", requireAuthentication(), asyncRoute(async (req, res) => {
  const schoolId = safeId(req.body.schoolId, "schoolId");
  activeSchoolAdmin(req, schoolId);
  const { schoolId: _schoolId, saveAsDraft: rawDraft, ...applicationInput } = req.body ?? {};
  if (rawDraft !== undefined && typeof rawDraft !== "boolean") {
    throw new AuthError(400, "saveAsDraft must be a boolean");
  }
  const input = parse(admissionApplicationInputSchema, applicationInput);
  const key = keyFromRequest(req);
  const saved = await createApplication(req, schoolId, input, key, "STAFF", rawDraft === undefined ? true : Boolean(rawDraft));
  res.status(201).json(admissionApplicationResponseSchema.parse(saved));
}));

router.get("/admissions/applications/:applicationId", requireAuthentication(), asyncRoute(async (req, res) => {
  const applicationId = safeId(req.params.applicationId, "applicationId");
  const schoolId = safeId(req.query.schoolId, "schoolId");
  activeSchoolAdmin(req, schoolId);
  const { dto } = await fetchApplication(pool, applicationId, schoolId);
  res.json(dto);
}));

router.patch("/admissions/applications/:applicationId", requireAuthentication(), asyncRoute(async (req, res) => {
  const applicationId = safeId(req.params.applicationId, "applicationId");
  const schoolId = safeId(req.query.schoolId, "schoolId");
  activeSchoolAdmin(req, schoolId);
  const input = parse(admissionApplicationPatchInputSchema, req.body);
  if (Object.keys(input.applicant ?? {}).length === 0 &&
      Object.keys(input.guardian ?? {}).length === 0 &&
      input.emergencyContact === undefined) {
    throw new AuthError(400, "Provide at least one applicant, guardian, or emergency-contact field to update");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const selected = await client.query(
      `SELECT * FROM admission_applications WHERE id=$1 AND school_id=$2 FOR UPDATE`,
      [applicationId, schoolId],
    );
    const row = selected.rows[0];
    if (!row) throw new AuthError(404, "Admission application not found");
    if (!["Draft", "Submitted"].includes(row.status)) {
      throw new AdmissionConflict("Only Draft or Submitted admission applications can be edited.", "APPLICATION_PROFILE_LOCKED");
    }
    if (Number(row.version) !== input.expectedVersion) {
      throw new AdmissionConflict("Application changed; reload before editing.", "STALE_APPLICATION_VERSION");
    }

    const applicantPatch = input.applicant ?? {};
    const guardianPatch = input.guardian ?? {};
    const hasField = (value: object, field: string) => Object.prototype.hasOwnProperty.call(value, field);
    const applicant = {
      firstName: hasField(applicantPatch, "firstName") ? applicantPatch.firstName! : row.applicant_first_name,
      middleName: hasField(applicantPatch, "middleName") ? applicantPatch.middleName ?? null : row.applicant_middle_name,
      lastName: hasField(applicantPatch, "lastName") ? applicantPatch.lastName! : row.applicant_last_name,
      dateOfBirth: hasField(applicantPatch, "dateOfBirth") ? applicantPatch.dateOfBirth! : dateString(row.date_of_birth),
      gender: hasField(applicantPatch, "gender") ? applicantPatch.gender! : row.gender,
      previousSchool: hasField(applicantPatch, "previousSchool") ? applicantPatch.previousSchool ?? null : row.previous_school,
      previousClass: hasField(applicantPatch, "previousClass") ? applicantPatch.previousClass ?? null : row.previous_class,
      intendedClassId: hasField(applicantPatch, "intendedClassId") ? applicantPatch.intendedClassId! : Number(row.intended_class_id),
      academicSessionId: hasField(applicantPatch, "academicSessionId") ? applicantPatch.academicSessionId! : Number(row.academic_session_id),
      academicTermId: hasField(applicantPatch, "academicTermId")
        ? applicantPatch.academicTermId ?? null
        : row.academic_term_id == null ? null : Number(row.academic_term_id),
      address: hasField(applicantPatch, "address") ? applicantPatch.address ?? null : row.applicant_address,
    };
    const guardian = {
      fullName: hasField(guardianPatch, "fullName") ? guardianPatch.fullName! : row.guardian_name,
      phone: hasField(guardianPatch, "phone") ? guardianPatch.phone! : row.guardian_phone,
      email: hasField(guardianPatch, "email") ? guardianPatch.email ?? null : row.guardian_email,
      relationship: hasField(guardianPatch, "relationship") ? guardianPatch.relationship ?? null : row.guardian_relationship,
      address: hasField(guardianPatch, "address") ? guardianPatch.address ?? null : row.guardian_address,
    };
    const emergency = input.emergencyContact === undefined
      ? {
        fullName: row.emergency_contact_name,
        phone: row.emergency_contact_phone,
        relationship: row.emergency_contact_relationship,
      }
      : input.emergencyContact;
    const sessionId = Number(applicant.academicSessionId);
    await validateSchoolReferences(client, schoolId, Number(applicant.intendedClassId), sessionId, applicant.academicTermId);
    const updated = await client.query(
      `UPDATE admission_applications SET
         applicant_first_name=$4,applicant_middle_name=$5,applicant_last_name=$6,date_of_birth=$7,gender=$8,
         previous_school=$9,previous_class=$10,intended_class_id=$11,academic_session_id=$12,academic_term_id=$13,
         applicant_address=$14,guardian_name=$15,guardian_phone=$16,guardian_email=$17,
         guardian_relationship=$18,guardian_address=$19,emergency_contact_name=$20,
         emergency_contact_phone=$21,emergency_contact_relationship=$22,
         version=version+1,updated_at=NOW()
       WHERE id=$1 AND school_id=$2 AND version=$3 AND status IN ('Draft','Submitted')
       RETURNING id`,
      [applicationId, schoolId, input.expectedVersion, applicant.firstName, applicant.middleName, applicant.lastName,
        applicant.dateOfBirth, applicant.gender, applicant.previousSchool, applicant.previousClass,
        applicant.intendedClassId, sessionId, applicant.academicTermId, applicant.address,
        guardian.fullName, guardian.phone, guardian.email, guardian.relationship, guardian.address,
        emergency?.fullName ?? null, emergency?.phone ?? null, emergency?.relationship ?? null],
    );
    if (updated.rowCount !== 1) {
      throw new AdmissionConflict("Application changed or is no longer editable; reload before editing.", "STALE_APPLICATION_VERSION");
    }
    await audit(client, req, schoolId, "Updated admission application profile",
      "ADMISSION_APPLICATION_PROFILE_UPDATED", applicationId, {
        applicantFields: Object.keys(applicantPatch),
        guardianFields: Object.keys(guardianPatch),
        emergencyContactUpdated: input.emergencyContact !== undefined,
        version: input.expectedVersion + 1,
      });
    const { dto } = await fetchApplication(client, applicationId, schoolId);
    await client.query("COMMIT");
    res.json(dto);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}));

router.patch("/admissions/applications/:applicationId/review", requireAuthentication(), asyncRoute(async (req, res) => {
  const applicationId = safeId(req.params.applicationId, "applicationId");
  const schoolId = safeId(req.query.schoolId, "schoolId");
  activeSchoolAdmin(req, schoolId);
  const input = parse(admissionReviewInputSchema, req.body);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { row } = await fetchApplication(client, applicationId, schoolId);
    if (Number(row.version) !== input.expectedVersion) throw new AdmissionConflict("Application changed; reload before editing.", "STALE_APPLICATION_VERSION");
    const updated = await client.query(
      `UPDATE admission_applications SET
         assessment=COALESCE($4::jsonb,assessment),interview=COALESCE($5::jsonb,interview),
         internal_notes=COALESCE($6,internal_notes),public_message=COALESCE($7,public_message),
         version=version+1,updated_at=NOW()
       WHERE id=$1 AND school_id=$2 AND version=$3`,
      [applicationId, schoolId, input.expectedVersion,
        input.assessment ? JSON.stringify(input.assessment) : null,
        input.interview ? JSON.stringify(input.interview) : null,
        input.internalNotes ?? null, input.publicMessage ?? null],
    );
    if (updated.rowCount !== 1) throw new AdmissionConflict("Application changed; reload before editing.", "STALE_APPLICATION_VERSION");
    await audit(client, req, schoolId, "Updated admission review",
      "ADMISSION_REVIEW_UPDATED", applicationId, {
        assessmentUpdated: Boolean(input.assessment),
        interviewUpdated: Boolean(input.interview),
        internalNotesUpdated: input.internalNotes !== undefined,
      });
    const { dto } = await fetchApplication(client, applicationId, schoolId);
    await client.query("COMMIT");
    res.json(dto);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}));

router.put("/admissions/applications/:applicationId/status", requireAuthentication(), asyncRoute(async (req, res) => {
  const applicationId = safeId(req.params.applicationId, "applicationId");
  const schoolId = safeId(req.query.schoolId, "schoolId");
  activeSchoolAdmin(req, schoolId);
  const input = parse(admissionStatusTransitionInputSchema, req.body);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { row } = await fetchApplication(client, applicationId, schoolId);
    const previousStatus = row.status as AdmissionStatus;
    if (Number(row.version) !== input.expectedVersion) throw new AdmissionConflict("Application changed; reload before transitioning.", "STALE_APPLICATION_VERSION");
    if (!canTransitionAdmissionStatus(previousStatus, input.status)) {
      throw new AdmissionConflict(`Admission status cannot transition from ${previousStatus} to ${input.status}.`, "INVALID_STATUS_TRANSITION");
    }
    const updated = await client.query(
      `UPDATE admission_applications SET status=$4,
         public_message=COALESCE($5,public_message),internal_notes=COALESCE($6,internal_notes),
         version=version+1,updated_at=NOW()
       WHERE id=$1 AND school_id=$2 AND version=$3`,
      [applicationId, schoolId, input.expectedVersion, input.status, input.publicMessage ?? null, input.internalNotes ?? null],
    );
    if (updated.rowCount !== 1) throw new AdmissionConflict("Application changed; reload before transitioning.", "STALE_APPLICATION_VERSION");
    await audit(client, req, schoolId, "Changed admission application status",
      input.status === "Accepted" || input.status === "Rejected" || input.status === "Waitlisted"
        ? "ADMISSION_DECISION" : "ADMISSION_STATUS_CHANGED",
      applicationId, { from: previousStatus, to: input.status });
    const { dto } = await fetchApplication(client, applicationId, schoolId);
    await client.query("COMMIT");
    res.json(dto);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}));

router.post("/admissions/applications/:applicationId/documents/upload", requireAuthentication(), asyncRoute(async (req, res) => {
  const applicationId = safeId(req.params.applicationId, "applicationId");
  const schoolId = safeId(req.query.schoolId, "schoolId");
  activeSchoolAdmin(req, schoolId);
  const input = parse(admissionDocumentUploadInputSchema, req.body);
  await fetchApplication(pool, applicationId, schoolId);
  const objectPath = newAdmissionDocumentPath(schoolId, applicationId);
  const uploadUrl = await admissionDocumentUploadUrl(objectPath, input.contentType);
  res.json(admissionDocumentUploadResponseSchema.parse({
    uploadUrl, objectPath, expiresAt: new Date(Date.now() + 180_000).toISOString(),
  }));
}));

router.post("/admissions/applications/:applicationId/documents/confirm", requireAuthentication(), asyncRoute(async (req, res) => {
  const applicationId = safeId(req.params.applicationId, "applicationId");
  const schoolId = safeId(req.query.schoolId, "schoolId");
  activeSchoolAdmin(req, schoolId);
  const input = parse(admissionDocumentInputSchema, req.body);
  if (!admissionsObjectPathMatchesApplication(input.objectPath, schoolId, applicationId)) {
    throw new AuthError(404, "Private application document not found");
  }
  await fetchApplication(pool, applicationId, schoolId);
  await assertStagedAdmissionObject(input.objectPath, input.contentType, input.byteSize);
  if (input.documentType.toLowerCase() === "photo" &&
      !["image/jpeg", "image/png", "image/webp"].includes(input.contentType)) {
    throw new AuthError(400, "Applicant photographs must use a supported image format");
  }
  const actorId = getUserContext(req).user.id;
  const client = await pool.connect();
  let row: Record<string, any>;
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `INSERT INTO admission_application_documents(
         school_id,application_id,document_type,file_name,content_type,byte_size,object_path,created_by_user_id
       ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT(object_path) DO NOTHING
       RETURNING id,document_type,file_name,content_type,byte_size,object_path`,
      [schoolId, applicationId, input.documentType, input.fileName, input.contentType, input.byteSize, input.objectPath, actorId],
    );
    let created = Boolean(result.rows[0]);
    row = result.rows[0];
    if (!row) {
      const existing = await client.query(
        `SELECT id,application_id,school_id,document_type,file_name,content_type,byte_size,object_path
           FROM admission_application_documents WHERE object_path=$1`,
        [input.objectPath],
      );
      row = existing.rows[0];
      if (!row || Number(row.application_id) !== applicationId || Number(row.school_id) !== schoolId ||
          row.document_type !== input.documentType || row.file_name !== input.fileName ||
          row.content_type !== input.contentType || Number(row.byte_size) !== input.byteSize) {
        throw new AdmissionConflict("This staged object is already attached to a different application or has conflicting metadata.", "DOCUMENT_OBJECT_CONFLICT");
      }
      created = false;
    }
    if (input.documentType.toLowerCase() === "photo") {
      await client.query(
        `UPDATE admission_applications SET photo_object_path=$3,version=version+1,updated_at=NOW()
         WHERE id=$1 AND school_id=$2 AND photo_object_path IS DISTINCT FROM $3`,
        [applicationId, schoolId, input.objectPath],
      );
    }
    if (created) {
      await audit(client, req, schoolId, "Added private admission document",
        "ADMISSION_DOCUMENT_CONFIRMED", applicationId, { documentId: Number(row.id) });
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  res.status(201).json(admissionDocumentResponseSchema.parse({
    id: Number(row.id),
    documentType: row.document_type,
    fileName: row.file_name,
    contentType: row.content_type,
    byteSize: Number(row.byte_size),
    objectPath: row.object_path,
  }));
}));

const optionalReceiptOrUserAuth = (req: Request, res: Response, next: NextFunction) => {
  if (typeof req.body?.receiptSecret === "string") {
    next();
    return;
  }
  requireAuthentication()(req, res, next);
};

router.post("/admissions/applications/:applicationId/documents/:documentId/download", optionalReceiptOrUserAuth, asyncRoute(async (req, res) => {
  const applicationId = safeId(req.params.applicationId, "applicationId");
  const documentId = safeId(req.params.documentId, "documentId");
  const input = parse(admissionDocumentDownloadInputSchema, req.body ?? {});
  let schoolId: number;
  const context = (() => {
    try { return getUserContext(req); } catch { return null; }
  })();
  if (context) {
    const app = await pool.query(
      `SELECT school_id FROM admission_applications WHERE id=$1`,
      [applicationId],
    );
    if (!app.rows[0]) throw new AuthError(404, "Application document not found");
    schoolId = Number(app.rows[0].school_id);
    activeSchoolAdmin(req, schoolId);
  } else {
    await enforcePublicLimit(req, "document-download", 10);
    if (!input.receiptSecret) throw new AuthError(404, "Application document not found");
    const app = await pool.query(
      `SELECT school_id,receipt_secret_hash FROM admission_applications WHERE id=$1`,
      [applicationId],
    );
    if (!app.rows[0] || !verifyAdmissionReceipt(input.receiptSecret, app.rows[0].receipt_secret_hash)) {
      throw new AuthError(404, "Application document not found");
    }
    schoolId = Number(app.rows[0].school_id);
  }
  const result = await pool.query(
    `SELECT object_path FROM admission_application_documents
      WHERE id=$1 AND application_id=$2 AND school_id=$3`,
    [documentId, applicationId, schoolId],
  );
  if (!result.rows[0]) throw new AuthError(404, "Application document not found");
  const downloadUrl = await admissionDocumentDownloadUrl(result.rows[0].object_path);
  res.json(admissionDocumentDownloadResponseSchema.parse({
    downloadUrl, expiresAt: new Date(Date.now() + 300_000).toISOString(),
  }));
}));

router.post("/admissions/applications/:applicationId/convert", requireAuthentication(), asyncRoute(async (req, res) => {
  const applicationId = safeId(req.params.applicationId, "applicationId");
  const schoolId = safeId(req.query.schoolId, "schoolId");
  activeSchoolAdmin(req, schoolId);
  keyFromRequest(req);
  const input = parse(admissionConversionInputSchema, req.body);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT id FROM schools WHERE id=$1 FOR UPDATE`, [schoolId]);
    const selected = await client.query(
      `SELECT * FROM admission_applications WHERE id=$1 AND school_id=$2 FOR UPDATE`,
      [applicationId, schoolId],
    );
    const application = selected.rows[0];
    if (!application) throw new AuthError(404, "Admission application not found");
    if (application.converted_student_id != null) {
      const student = await client.query(
        `SELECT id,admission_no FROM students WHERE id=$1 AND school_id=$2`,
        [application.converted_student_id, schoolId],
      );
      await client.query("COMMIT");
      res.json(admissionConversionResponseSchema.parse({
        applicationId,
        studentId: Number(application.converted_student_id),
        admissionNumber: student.rows[0]?.admission_no ?? "",
        parentId: application.converted_parent_id == null ? null : Number(application.converted_parent_id),
        idempotent: true,
      }));
      return;
    }
    if (application.status !== "Accepted") throw new AdmissionConflict("Only an accepted applicant can be converted.", "APPLICATION_NOT_ACCEPTED");
    if (Number(application.version) !== input.expectedVersion) throw new AdmissionConflict("Application changed; reload before converting.", "STALE_APPLICATION_VERSION");
    const classResult = await client.query(
      `SELECT name,section FROM school_classes WHERE id=$1 AND school_id=$2`,
      [application.intended_class_id, schoolId],
    );
    if (!classResult.rows[0]) throw new AuthError(409, "The intended class is no longer available in this school");

    let studentId: number;
    let admissionNumber: string;
    if (input.existingStudentId) {
      const existingStudent = await client.query(
        `SELECT id,admission_no,first_name,last_name,date_of_birth
           FROM students WHERE id=$1 AND school_id=$2 FOR UPDATE`,
        [input.existingStudentId, schoolId],
      );
      if (!existingStudent.rows[0]) throw new AuthError(404, "Existing student was not found in this school");
      const existingName = `${existingStudent.rows[0].first_name} ${existingStudent.rows[0].last_name}`.trim().toLocaleLowerCase();
      const applicantName = `${application.applicant_first_name} ${application.applicant_last_name}`.trim().toLocaleLowerCase();
      if (existingName !== applicantName ||
          dateString(existingStudent.rows[0].date_of_birth) !== dateString(application.date_of_birth)) {
        throw new AdmissionConflict(
          "The explicitly selected student does not match the applicant name and date of birth; resolve the identity discrepancy before linking.",
          "STUDENT_IDENTITY_MISMATCH",
        );
      }
      studentId = Number(existingStudent.rows[0].id);
      admissionNumber = existingStudent.rows[0].admission_no;
      await client.query(
        `UPDATE students SET class_name=$3,section=$4,
           photo=COALESCE(photo,$5),previous_school=COALESCE(previous_school,$6),
           address=COALESCE(address,$7),parent_name=COALESCE(parent_name,$8),
           parent_phone=COALESCE(parent_phone,$9),updated_at=NOW()
         WHERE id=$1 AND school_id=$2`,
        [studentId, schoolId, classResult.rows[0].name, input.section ?? classResult.rows[0].section,
          application.photo_object_path, application.previous_school,
          application.applicant_address ?? application.guardian_address,
          application.guardian_name, application.guardian_phone],
      );
    } else {
      const possibleMatches = await client.query(
        `SELECT id FROM students WHERE school_id=$1
          AND lower(first_name)=lower($2) AND lower(last_name)=lower($3)
          AND date_of_birth=$4 FOR UPDATE`,
        [schoolId, application.applicant_first_name, application.applicant_last_name, application.date_of_birth],
      );
      if (possibleMatches.rows.length) {
        throw new AdmissionConflict(
          "A possible existing student matches this applicant. Select the correct existingStudentId explicitly or resolve the duplicate before conversion.",
          "POSSIBLE_DUPLICATE_STUDENT",
        );
      }
      admissionNumber = await generateAdmissionNumber(client, schoolId);
      const inserted = await client.query(
        `INSERT INTO students(
           school_id,admission_no,first_name,last_name,gender,class_name,section,date_of_birth,photo,
           previous_school,address,parent_name,parent_phone,admission_status,admission_date
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'ADMITTED',CURRENT_DATE)
         RETURNING id`,
        [schoolId, admissionNumber, application.applicant_first_name, application.applicant_last_name,
          application.gender, classResult.rows[0].name, input.section ?? classResult.rows[0].section,
          application.date_of_birth, application.photo_object_path, application.previous_school,
          application.applicant_address ?? application.guardian_address,
          application.guardian_name, application.guardian_phone],
      );
      studentId = Number(inserted.rows[0].id);
    }

    let parentId: number | null = null;
    if (input.existingParentId) {
      const parentResult = await client.query(
        `SELECT id,user_id,status FROM parents WHERE id=$1 AND school_id=$2 FOR UPDATE`,
        [input.existingParentId, schoolId],
      );
      if (!parentResult.rows[0]) throw new AuthError(404, "Existing parent was not found in this school");
      parentId = Number(parentResult.rows[0].id);
      // Existing active parent users retain their existing account and invitation state.
    } else if (input.createParentRecord) {
      if (!application.guardian_email) {
        throw new AuthError(400, "A guardian email is required to create a Parent record; phone-only applicants remain valid without one.");
      }
      const possibleParents = await client.query(
        `SELECT id FROM parents
          WHERE school_id=$1 AND (phone=$2 OR lower(email)=lower($3))
          FOR UPDATE`,
        [schoolId, application.guardian_phone, application.guardian_email],
      );
      if (possibleParents.rows.length) {
        throw new AdmissionConflict(
          "A parent record with this phone already exists. Select its existingParentId explicitly to link it.",
          "POSSIBLE_DUPLICATE_PARENT",
        );
      }
      const parent = await client.query(
        `INSERT INTO parents(school_id,name,email,phone,address,status)
         VALUES($1,$2,$3,$4,$5,'ACTIVE') RETURNING id`,
        [schoolId, application.guardian_name, application.guardian_email, application.guardian_phone, application.guardian_address],
      );
      parentId = Number(parent.rows[0].id);
    }

    if (parentId != null) {
      await client.query(
        `INSERT INTO parent_student_relationships(parent_id,student_id,relationship_type,is_primary_guardian,is_emergency_contact,status)
         VALUES($1,$2,$3,true,$4,'ACTIVE') ON CONFLICT(parent_id,student_id) DO NOTHING`,
        [parentId, studentId, input.parentRelationship,
          Boolean(application.emergency_contact_phone && application.guardian_phone === application.emergency_contact_phone)],
      );
    }
    const updated = await client.query(
      `UPDATE admission_applications SET status='Enrolled',converted_student_id=$3,converted_parent_id=$4,
         version=version+1,updated_at=NOW()
       WHERE id=$1 AND school_id=$2 AND converted_student_id IS NULL`,
      [applicationId, schoolId, studentId, parentId],
    );
    if (updated.rowCount !== 1) throw new AdmissionConflict("Application was converted by another request.", "DUPLICATE_CONVERSION");
    await emitDomainParentEvent(client, {
      schoolId,
      studentId,
      eventType: "ADMISSION_CONVERTED",
      eventId: applicationId,
      category: "SYSTEM",
      subject: "Admission completed",
      body: "Your child has been enrolled. Sign in to view their school information.",
      privacy: "PARENT_SAFE",
      link: "/parent/dashboard",
      channels: ["IN_APP"],
    });
    await audit(client, req, schoolId, "Converted accepted applicant to student",
      "ADMISSION_STUDENT_CONVERTED", applicationId, { studentId, parentId, applicationNumber: application.application_number });
    await client.query("COMMIT");
    res.json(admissionConversionResponseSchema.parse({
      applicationId, studentId, admissionNumber, parentId, idempotent: false,
    }));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if ((error as { code?: string })?.code === "23505") {
      throw new AdmissionConflict("A duplicate student conversion was prevented by a database uniqueness constraint.", "DUPLICATE_CONVERSION");
    }
    throw error;
  } finally {
    client.release();
  }
}));

export { router as admissionsExpansionRouter };
export default router;