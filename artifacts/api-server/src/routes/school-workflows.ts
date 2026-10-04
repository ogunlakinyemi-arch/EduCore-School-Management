import { randomUUID } from "node:crypto";
import { registrationNumberChanged } from "../services/school-registration-number";
import { Router, type NextFunction, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import {
  AuthError,
  assertSchoolOperationalAccess,
  getUserContext,
  handleAuthError,
  requireAuthentication,
  type Role,
} from "../middlewares/auth";
import {
  isManagedSchoolLogoObjectPath,
  newSchoolLogoObjectPath,
  readValidatedSchoolLogo,
  SCHOOL_LOGO_UPLOAD_URL_TTL_SECONDS,
  signedSchoolLogoUploadUrl,
} from "../lib/schoolLogoStorage";

const router = Router();
router.use(requireAuthentication());

const MAX_LOGO_BYTES = 3 * 1024 * 1024;
const ALLOWED_LOGO_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const CALENDAR_CATEGORIES = new Set([
  "RESUMPTION",
  "MID_TERM_BREAK",
  "HOLIDAY",
  "EXAMINATION",
  "RESULT_PUBLICATION",
  "SCHOOL_EVENT",
  "OTHER",
]);
const CALENDAR_AUDIENCES = new Set(["TEACHER", "STUDENT", "PARENT", "STAFF"]);
const WRITE_SCHOOL_ADMIN: Role[] = ["SCHOOL_ADMIN"];
const SCHOOL_BRANDING_READERS = [
  "SCHOOL_ADMIN",
  "TEACHER",
  "ACCOUNTANT",
  "PARENT",
  "STUDENT",
  "STAFF",
] as const;
const CALENDAR_READERS = [
  "SCHOOL_ADMIN",
  "TEACHER",
  "ACCOUNTANT",
  "PARENT",
  "STUDENT",
  "STAFF",
] as const;
const SCHOOL_NAME_SELECT = `s.id AS "schoolId", s.name, s.registration_number AS "registrationNumber",
  s.address, s.city, s.state, s.lga, s.phone, s.email, s.website,
  s.school_type AS "schoolType", s.logo, l.object_path AS "managedLogoObjectPath"`;

type QueryExecutor = {
  query(sql: string, values?: unknown[]): Promise<{ rows: any[] }>;
};

const run = (
  handler: (req: Request, res: Response) => Promise<void>,
) => (
  req: Request,
  res: Response,
  next: NextFunction,
) => handler(req, res).catch((error) => handleAuthError(error, req, res, next));

function object(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new AuthError(400, `${label} must be a JSON object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(
  input: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const extra = Object.keys(input).find((key) => !allowed.includes(key));
  if (extra) throw new AuthError(400, `${label} contains unsupported field '${extra}'`);
}

function positiveId(raw: unknown, label: string): number {
  if ((typeof raw !== "string" && typeof raw !== "number") ||
    !/^[1-9]\d*$/.test(String(raw))) {
    throw new AuthError(400, `${label} must be a positive integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new AuthError(400, `${label} must be a positive integer`);
  return value;
}

function optionalQueryId(raw: unknown, label: string): number | undefined {
  if (raw === undefined) return undefined;
  if (Array.isArray(raw) || typeof raw !== "string") {
    throw new AuthError(400, `${label} must be a single positive integer`);
  }
  return positiveId(raw, label);
}

function scalarQueryText(raw: unknown, label: string): string | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== "string" || raw.length === 0) {
    throw new AuthError(400, `${label} must be a single non-empty value`);
  }
  return raw;
}

export function isValidCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function dateInput(raw: unknown, label: string, nullable = false): string | null {
  if (nullable && raw === null) return null;
  if (!isValidCalendarDate(raw)) {
    throw new AuthError(400, `${label} must be a valid date in YYYY-MM-DD format`);
  }
  return raw;
}

function dateRange(start: string, end: string | null, label: string): void {
  if (end && end < start) throw new AuthError(400, `${label} end date must not precede the start date`);
}

function positiveOptionalText(
  raw: unknown,
  label: string,
  max: number,
  nullable = false,
): string | null {
  if (nullable && raw === null) return null;
  if (typeof raw !== "string" || !raw.trim() || raw.trim().length > max) {
    throw new AuthError(400, `${label} must be a non-empty string of at most ${max} characters`);
  }
  return raw.trim();
}

function optionalNullableText(
  raw: unknown,
  label: string,
  max: number,
): string | null {
  if (raw === null) return null;
  return positiveOptionalText(raw, label, max);
}

function activePlatformOwner(context: ReturnType<typeof getUserContext>): boolean {
  return context.roles.some((role) =>
    role.role === "PLATFORM_OWNER" &&
    role.schoolId === null &&
    role.status === "ACTIVE",
  );
}

function hasActiveSchoolRole(
  context: ReturnType<typeof getUserContext>,
  schoolId: number,
  roles: readonly string[],
): boolean {
  return context.roles.some((assignment) =>
    assignment.status === "ACTIVE" &&
    assignment.schoolId === schoolId &&
    roles.includes(assignment.role),
  );
}

function assertSchoolReader(req: Request, schoolId: number, roles: readonly string[]) {
  const context = getUserContext(req);
  if (!activePlatformOwner(context) && !hasActiveSchoolRole(context, schoolId, roles)) {
    throw new AuthError(404, "Resource not found", "CROSS_TENANT_ACCESS_ATTEMPT");
  }
  return context;
}

function assertSchoolWriter(req: Request, schoolId: number) {
  return assertSchoolOperationalAccess(req, schoolId, WRITE_SCHOOL_ADMIN);
}

function managerForSchool(context: ReturnType<typeof getUserContext>, schoolId: number): boolean {
  return activePlatformOwner(context) ||
    hasActiveSchoolRole(context, schoolId, ["SCHOOL_ADMIN"]);
}

function assertSchoolExists(row: unknown, label = "School"): asserts row {
  if (!row) throw new AuthError(404, `${label} not found`, "CROSS_TENANT_ACCESS_ATTEMPT");
}

async function requireSchoolRecord(schoolId: number) {
  const result = await pool.query("SELECT id FROM schools WHERE id=$1", [schoolId]);
  assertSchoolExists(result.rows[0]);
}

async function audit(
  req: Request,
  schoolId: number,
  action: string,
  recordId: number | null,
  metadata: Record<string, unknown> = {},
  executor: QueryExecutor = pool,
) {
  const context = getUserContext(req);
  const actor = [context.user.firstName, context.user.lastName]
    .filter(Boolean)
    .join(" ") || context.user.email;
  const activeRole = context.roles.find((assignment) =>
    assignment.status === "ACTIVE" &&
    (assignment.schoolId === schoolId || (
      assignment.role === "PLATFORM_OWNER" && assignment.schoolId === null
    )),
  )?.role ?? "AUTHENTICATED";
  await executor.query(
    `INSERT INTO audit_logs
      ("user", role, actor_user_id, clerk_user_id, school_id, action, module,
       record_id, severity, event_type, result, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,'Academics',$7,'info','APPLICATION_EVENT','SUCCESS',$8::jsonb)`,
    [
      actor,
      activeRole,
      context.user.id,
      context.user.clerkUserId,
      schoolId,
      action,
      recordId,
      JSON.stringify(metadata),
    ],
  );
}

function legacyLogoUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const value = raw.trim();
  if (value.startsWith("/") && !value.startsWith("//") && !value.includes("\\")) return value;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? value : null;
  } catch {
    return null;
  }
}

function logoUrl(schoolId: number, row: Record<string, unknown>): string | null {
  return isManagedSchoolLogoObjectPath(schoolId, row.managedLogoObjectPath)
    ? `/api/schools/${schoolId}/branding/logo`
    : legacyLogoUrl(row.logo);
}

function serializeBranding(schoolId: number, row: Record<string, unknown>) {
  return {
    schoolId,
    name: row.name,
    registrationNumber: row.registrationNumber,
    address: row.address,
    city: row.city,
    state: row.state,
    lga: row.lga,
    phone: row.phone,
    email: row.email,
    website: row.website,
    schoolType: row.schoolType,
    logoUrl: logoUrl(schoolId, row),
  };
}

async function getBranding(schoolId: number) {
  return pool.query(
    `SELECT ${SCHOOL_NAME_SELECT} FROM schools s
      LEFT JOIN school_branding_logos l ON l.school_id=s.id AND l.is_current=true
     WHERE s.id=$1`,
    [schoolId],
  );
}

const brandingUpdateFields = {
  name: "name",
  registrationNumber: "registration_number",
  address: "address",
  city: "city",
  state: "state",
  lga: "lga",
  phone: "phone",
  email: "email",
  website: "website",
  schoolType: "school_type",
} as const;

function parseBrandingUpdate(raw: unknown): Array<[keyof typeof brandingUpdateFields, unknown]> {
  const body = object(raw, "branding");
  rejectUnknownKeys(body, Object.keys(brandingUpdateFields), "branding");
  const entries = Object.entries(body);
  if (!entries.length) throw new AuthError(400, "At least one official school identity field must be supplied");
  const parsed: Array<[keyof typeof brandingUpdateFields, unknown]> = [];
  for (const [name, value] of entries) {
    const field = name as keyof typeof brandingUpdateFields;
    switch (field) {
      case "name":
        parsed.push([field, positiveOptionalText(value, "School name", 200)]);
        break;
      case "city":
        parsed.push([field, positiveOptionalText(value, "City", 160)]);
        break;
      case "state":
        parsed.push([field, positiveOptionalText(value, "State", 160)]);
        break;
      case "registrationNumber":
        parsed.push([field, optionalNullableText(value, "Registration number", 100)]);
        break;
      case "address":
        parsed.push([field, optionalNullableText(value, "Address", 500)]);
        break;
      case "lga":
        parsed.push([field, optionalNullableText(value, "LGA", 160)]);
        break;
      case "phone":
        parsed.push([field, optionalNullableText(value, "Phone", 50)]);
        break;
      case "email": {
        const email = optionalNullableText(value, "Email", 254);
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          throw new AuthError(400, "Email must be a valid school email address");
        }
        parsed.push([field, email?.toLowerCase() ?? null]);
        break;
      }
      case "website": {
        const website = optionalNullableText(value, "Website", 255);
        if (website) {
          let parsedWebsite: URL;
          try {
            parsedWebsite = new URL(website);
          } catch {
            throw new AuthError(400, "Website must be a valid HTTPS URL");
          }
          if (parsedWebsite.protocol !== "https:" || parsedWebsite.username || parsedWebsite.password) {
            throw new AuthError(400, "Website must be an HTTPS URL without embedded credentials");
          }
        }
        parsed.push([field, website]);
        break;
      }
      case "schoolType":
        parsed.push([field, optionalNullableText(value, "School type", 100)]);
        break;
    }
  }
  return parsed;
}

router.get("/schools/:schoolId/branding", run(async (req, res) => {
  const schoolId = positiveId(req.params.schoolId, "schoolId");
  assertSchoolReader(req, schoolId, SCHOOL_BRANDING_READERS);
  const result = await getBranding(schoolId);
  assertSchoolExists(result.rows[0]);
  res.setHeader("Cache-Control", "private, no-store");
  res.json(serializeBranding(schoolId, result.rows[0]!));
}));

router.put("/schools/:schoolId/branding", run(async (req, res) => {
  const schoolId = positiveId(req.params.schoolId, "schoolId");
  assertSchoolWriter(req, schoolId);
  const fields = parseBrandingUpdate(req.body);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const locks = await client.query(`SELECT id,registration_number FROM schools WHERE id=$1 FOR UPDATE`, [schoolId]);
    assertSchoolExists(locks.rows[0]);
    const requestedNumber = fields.find(([field]) => field === "registrationNumber");
    if (requestedNumber && registrationNumberChanged(requestedNumber[1], locks.rows[0].registration_number)) {
      throw new AuthError(409, "A school's registration number is permanent and cannot be changed");
    }
    const parameters: unknown[] = [];
    const assignments = fields.map(([field, value]) => {
      parameters.push(field === "registrationNumber" ? locks.rows[0].registration_number : value);
      return `${brandingUpdateFields[field]}=$${parameters.length}`;
    });
    parameters.push(schoolId);
    const result = await client.query(
      `UPDATE schools SET ${assignments.join(",")}, updated_at=NOW()
        WHERE id=$${parameters.length} RETURNING id`,
      parameters,
    );
    const updated = result.rows[0];
    if (!updated) throw new AuthError(404, "School not found");
    await audit(req, schoolId, "Updated official school profile", Number(updated.id), {
      updatedFields: fields.map(([field]) => field),
    }, client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const reread = await getBranding(schoolId);
  assertSchoolExists(reread.rows[0]);
  res.setHeader("Cache-Control", "private, no-store");
  res.json(serializeBranding(schoolId, reread.rows[0]!));
}));

function mimeInput(raw: unknown): string {
  if (typeof raw !== "string" || !ALLOWED_LOGO_MIME_TYPES.has(raw.trim().toLowerCase())) {
    throw new AuthError(400, "School logos must be JPEG, PNG, or WebP; SVG uploads are not accepted");
  }
  return raw.trim().toLowerCase();
}

router.post("/schools/:schoolId/branding/logo-upload-url", run(async (req, res) => {
  const schoolId = positiveId(req.params.schoolId, "schoolId");
  assertSchoolWriter(req, schoolId);
  const body = object(req.body, "upload request");
  rejectUnknownKeys(body, ["contentType", "size"], "upload request");
  mimeInput(body.contentType);
  if (!Number.isSafeInteger(body.size) || Number(body.size) < 1 || Number(body.size) > MAX_LOGO_BYTES) {
    throw new AuthError(400, "School logos must be between 1 byte and 3 MB");
  }
  const school = await pool.query("SELECT id FROM schools WHERE id=$1", [schoolId]);
  assertSchoolExists(school.rows[0]);
  const objectPath = newSchoolLogoObjectPath(schoolId);
  const uploadURL = await signedSchoolLogoUploadUrl(objectPath);
  res.status(201).json({
    uploadURL,
    objectPath,
    expiresInSeconds: SCHOOL_LOGO_UPLOAD_URL_TTL_SECONDS,
  });
}));

router.put("/schools/:schoolId/branding/logo", run(async (req, res) => {
  const schoolId = positiveId(req.params.schoolId, "schoolId");
  const context = assertSchoolWriter(req, schoolId);
  const body = object(req.body, "logo confirmation");
  rejectUnknownKeys(body, ["objectPath"], "logo confirmation");
  const objectPath = body.objectPath;
  if (!isManagedSchoolLogoObjectPath(schoolId, objectPath)) {
    throw new AuthError(400, "Logo objectPath must be generated for this school");
  }
  const school = await pool.query("SELECT id FROM schools WHERE id=$1", [schoolId]);
  assertSchoolExists(school.rows[0]);
  let validated: Awaited<ReturnType<typeof readValidatedSchoolLogo>>;
  try {
    validated = await readValidatedSchoolLogo(schoolId, objectPath);
  } catch (error) {
    if ((error as { code?: number })?.code === 404 ||
      (error instanceof Error && error.message === "Private school logo object not found")) {
      throw new AuthError(404, "Uploaded school logo was not found");
    }
    if (error instanceof TypeError ||
      (error instanceof Error && error.message.startsWith("Private school logo "))) {
      throw new AuthError(400, "School logo is corrupt or unsupported");
    }
    throw error;
  }
  const client = await pool.connect();
  let previous: unknown = null;
  try {
    await client.query("BEGIN");
    const locked = await client.query(
      `SELECT id, logo FROM schools WHERE id=$1 FOR UPDATE`,
      [schoolId],
    );
    assertSchoolExists(locked.rows[0]);
    const existing = await client.query(
      `SELECT id, object_path AS "objectPath"
         FROM school_branding_logos
        WHERE school_id=$1 AND is_current=true FOR UPDATE`,
      [schoolId],
    );
    const currentVersion = existing.rows[0];
    previous = currentVersion?.objectPath ?? null;
    if (previous !== objectPath) {
      await client.query(
        `UPDATE school_branding_logos SET is_current=false
          WHERE school_id=$1 AND is_current=true`,
        [schoolId],
      );
      const confirmedVersion = await client.query(
        `SELECT id FROM school_branding_logos
          WHERE school_id=$1 AND object_path=$2 FOR UPDATE`,
        [schoolId, objectPath],
      );
      if (confirmedVersion.rows[0]) {
        // A previously confirmed version can be restored without changing its
        // immutable ID, validated metadata, or stored bytes.
        await client.query(
          `UPDATE school_branding_logos SET is_current=true
            WHERE school_id=$1 AND id=$2`,
          [schoolId, confirmedVersion.rows[0].id],
        );
      } else {
        await client.query(
          `INSERT INTO school_branding_logos
            (school_id,object_path,content_type,byte_size,updated_by_user_id,is_current)
           VALUES ($1,$2,$3,$4,$5,true)`,
          [schoolId, objectPath, validated.contentType, validated.bytes.length, context.user.id],
        );
      }
    }
    // Existing school/profile/E-ID/receipt/document consumers get the same
    // secure, authenticated logo URL without any consumer receiving a bucket
    // path or signed GCS download URL.
    const privateLogoURL = `/api/schools/${schoolId}/branding/logo`;
    await client.query(
      "UPDATE schools SET logo=$1,updated_at=NOW() WHERE id=$2",
      [privateLogoURL, schoolId],
    );
    await audit(req, schoolId, "Uploaded official school logo", schoolId, {
      contentType: validated.contentType,
      byteSize: validated.bytes.length,
      replacedLogo: typeof previous === "string" && previous !== objectPath,
    }, client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const reread = await getBranding(schoolId);
  assertSchoolExists(reread.rows[0]);
  res.setHeader("Cache-Control", "private, no-store");
  res.json(serializeBranding(schoolId, reread.rows[0]!));
}));

router.get("/schools/:schoolId/branding/logo", run(async (req, res) => {
  const schoolId = positiveId(req.params.schoolId, "schoolId");
  assertSchoolReader(req, schoolId, SCHOOL_BRANDING_READERS);
  const result = await pool.query(
    `SELECT l.object_path AS "objectPath"
       FROM schools s
       LEFT JOIN school_branding_logos l ON l.school_id=s.id AND l.is_current=true
      WHERE s.id=$1`,
    [schoolId],
  );
  assertSchoolExists(result.rows[0]);
  const objectPath = result.rows[0]?.objectPath;
  if (!isManagedSchoolLogoObjectPath(schoolId, objectPath)) {
    throw new AuthError(404, "Managed school logo not found");
  }
  let validated: Awaited<ReturnType<typeof readValidatedSchoolLogo>>;
  try {
    validated = await readValidatedSchoolLogo(schoolId, objectPath);
  } catch (error) {
    if ((error as { code?: number })?.code === 404 ||
      (error instanceof Error && error.message === "Private school logo object not found")) {
      throw new AuthError(404, "Managed school logo not found");
    }
    if (error instanceof TypeError ||
      (error instanceof Error && error.message.startsWith("Private school logo "))) {
      throw new AuthError(400, "Managed school logo is corrupt or unsupported");
    }
    throw error;
  }
  res.setHeader("Content-Type", validated.contentType);
  res.setHeader("Content-Length", String(validated.bytes.length));
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.status(200).send(validated.bytes);
}));

router.get("/schools/:schoolId/branding/logo-versions/:logoId", run(async (req, res) => {
  const schoolId = positiveId(req.params.schoolId, "schoolId");
  const logoId = positiveId(req.params.logoId, "logoId");
  assertSchoolReader(req, schoolId, SCHOOL_BRANDING_READERS);
  const result = await pool.query(
    `SELECT object_path AS "objectPath"
       FROM school_branding_logos
      WHERE school_id=$1 AND id=$2`,
    [schoolId, logoId],
  );
  const objectPath = result.rows[0]?.objectPath;
  if (!isManagedSchoolLogoObjectPath(schoolId, objectPath)) {
    throw new AuthError(404, "Confirmed school logo version not found");
  }
  let validated: Awaited<ReturnType<typeof readValidatedSchoolLogo>>;
  try {
    validated = await readValidatedSchoolLogo(schoolId, objectPath);
  } catch (error) {
    if ((error as { code?: number })?.code === 404 ||
      (error instanceof Error && error.message === "Private school logo object not found")) {
      throw new AuthError(404, "Confirmed school logo version not found");
    }
    if (error instanceof TypeError ||
      (error instanceof Error && error.message.startsWith("Private school logo "))) {
      throw new AuthError(400, "Confirmed school logo version is corrupt or unsupported");
    }
    throw error;
  }
  res.setHeader("Content-Type", validated.contentType);
  res.setHeader("Content-Length", String(validated.bytes.length));
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.status(200).send(validated.bytes);
}));

type CalendarAudience = "TEACHER" | "STUDENT" | "PARENT" | "STAFF";
type CalendarDateItem = {
  title: string;
  startDate: string;
  endDate: string | null;
  notes: string | null;
  audience: CalendarAudience[];
};

function parseAudience(raw: unknown, label: string): CalendarAudience[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 4) {
    throw new AuthError(400, `${label} must contain one or more permitted audience roles`);
  }
  const audiences = raw.map((value) => {
    if (typeof value !== "string" || !CALENDAR_AUDIENCES.has(value)) {
      throw new AuthError(400, `${label} contains an unsupported audience role`);
    }
    return value as CalendarAudience;
  });
  if (new Set(audiences).size !== audiences.length) {
    throw new AuthError(400, `${label} must not repeat an audience role`);
  }
  return audiences;
}

function parseCalendarDateItem(raw: unknown, label: string): CalendarDateItem {
  const input = object(raw, label);
  rejectUnknownKeys(input, ["title", "startDate", "endDate", "notes", "audience"], label);
  const title = positiveOptionalText(input.title, `${label} title`, 180)!;
  const startDate = dateInput(input.startDate, `${label} startDate`)!;
  const endDate = input.endDate === undefined ? null : dateInput(input.endDate, `${label} endDate`, true);
  dateRange(startDate, endDate, label);
  const notes = input.notes === undefined ? null : optionalNullableText(input.notes, `${label} notes`, 2000);
  const audience = input.audience === undefined
    ? [...CALENDAR_AUDIENCES] as CalendarAudience[]
    : parseAudience(input.audience, `${label} audience`);
  return { title, startDate, endDate, notes, audience };
}

function optionalNotes(raw: unknown, label: string): string | null {
  if (raw === undefined || raw === null) return null;
  return optionalNullableText(raw, label, 2000);
}

function requireCalendarCategory(raw: unknown, allowed: readonly string[]): string {
  if (typeof raw !== "string" || !allowed.includes(raw)) {
    throw new AuthError(400, "Unsupported academic calendar category");
  }
  return raw;
}

const eventSelect = `ce.id, ce.school_id AS "schoolId",
  ce.academic_session_id AS "sessionId", ac.name AS "sessionName",
  ce.academic_term_id AS "termId", t.name AS "termName",
  ce.title, ce.category, ce.start_date::text AS "startDate", ce.end_date::text AS "endDate",
  ce.is_academic AS academic, ce.audience, ce.status, ce.source, ce.notes`;

async function oneStoredCalendarEvent(
  executor: QueryExecutor,
  schoolId: number,
  eventId: number,
) {
  return executor.query(
    `SELECT ${eventSelect}
       FROM school_calendar_events ce
       LEFT JOIN academic_sessions ac
         ON ac.id=ce.academic_session_id AND ac.school_id=ce.school_id
       LEFT JOIN academic_terms t
         ON t.id=ce.academic_term_id AND t.school_id=ce.school_id
      WHERE ce.id=$1 AND ce.school_id=$2`,
    [eventId, schoolId],
  );
}

type CalendarFilters = {
  sessionId?: number;
  termId?: number;
  startsOnOrAfter?: string;
  endsOnOrBefore?: string;
};

function parseCalendarFilters(query: Request["query"]): CalendarFilters {
  rejectUnknownKeys(query as Record<string, unknown>, [
    "sessionId",
    "termId",
    "startsOnOrAfter",
    "endsOnOrBefore",
  ], "calendar query");
  const sessionId = optionalQueryId(query.sessionId, "sessionId");
  const termId = optionalQueryId(query.termId, "termId");
  const startsOnOrAfterRaw = scalarQueryText(query.startsOnOrAfter, "startsOnOrAfter");
  const endsOnOrBeforeRaw = scalarQueryText(query.endsOnOrBefore, "endsOnOrBefore");
  const startsOnOrAfter = startsOnOrAfterRaw === undefined
    ? undefined
    : dateInput(startsOnOrAfterRaw, "startsOnOrAfter")!;
  const endsOnOrBefore = endsOnOrBeforeRaw === undefined
    ? undefined
    : dateInput(endsOnOrBeforeRaw, "endsOnOrBefore")!;
  if (startsOnOrAfter && endsOnOrBefore && startsOnOrAfter > endsOnOrBefore) {
    throw new AuthError(400, "startsOnOrAfter must not fall after endsOnOrBefore");
  }
  return { sessionId, termId, startsOnOrAfter, endsOnOrBefore };
}

function calendarAudiences(context: ReturnType<typeof getUserContext>, schoolId: number) {
  if (managerForSchool(context, schoolId)) return { manager: true, roles: [] as string[] };
  const roleToAudience: Record<string, CalendarAudience | undefined> = {
    TEACHER: "TEACHER",
    STAFF: "STAFF",
    STUDENT: "STUDENT",
    PARENT: "PARENT",
  };
  const audiences = context.roles
    .filter((role) =>
      role.status === "ACTIVE" &&
      role.schoolId === schoolId &&
      (CALENDAR_READERS as readonly string[]).includes(role.role),
    )
    .map((role) => roleToAudience[role.role])
    .filter((role): role is CalendarAudience => role !== undefined);
  return { manager: false, roles: [...new Set(audiences)] };
}

async function listCalendarRows(
  req: Request,
  schoolId: number,
  filters: CalendarFilters,
) {
  const context = assertSchoolReader(req, schoolId, CALENDAR_READERS);
  await requireSchoolRecord(schoolId);
  const access = calendarAudiences(context, schoolId);
  if (!access.manager && access.roles.length === 0) {
    throw new AuthError(404, "Resource not found", "CROSS_TENANT_ACCESS_ATTEMPT");
  }
  const result = await pool.query(
    `WITH calendar AS (
       SELECT 'SESSION_START:' || ac.id::text AS id,
         ac.school_id AS "schoolId", ac.id AS "sessionId",
         ac.name AS "sessionName", NULL::integer AS "termId", NULL::text AS "termName",
         ac.name || ' session starts' AS title, 'TERM_START'::text AS category,
         ac.start_date::text AS "startDate", NULL::text AS "endDate", true AS academic,
         ARRAY['TEACHER','STUDENT','PARENT','STAFF']::text[] AS audience,
         CASE WHEN UPPER(ac.status)='INACTIVE' THEN 'INACTIVE' ELSE 'ACTIVE' END AS status,
         'SESSION_TERM'::text AS source, NULL::text AS notes
       FROM academic_sessions ac
       UNION ALL
       SELECT 'SESSION_END:' || ac.id::text, ac.school_id, ac.id, ac.name, NULL::integer, NULL::text,
         ac.name || ' session ends', 'TERM_END'::text, ac.end_date::text, NULL::text, true,
         ARRAY['TEACHER','STUDENT','PARENT','STAFF']::text[],
         CASE WHEN UPPER(ac.status)='INACTIVE' THEN 'INACTIVE' ELSE 'ACTIVE' END,
         'SESSION_TERM'::text, NULL::text
       FROM academic_sessions ac
       UNION ALL
       SELECT 'TERM_START:' || t.id::text, t.school_id, ac.id, ac.name, t.id, t.name,
         t.name || ' starts', 'TERM_START'::text, t.start_date::text, NULL::text, true,
         ARRAY['TEACHER','STUDENT','PARENT','STAFF']::text[],
         CASE WHEN UPPER(t.status)='INACTIVE' OR UPPER(ac.status)='INACTIVE' THEN 'INACTIVE' ELSE 'ACTIVE' END,
         'SESSION_TERM'::text, NULL::text
       FROM academic_terms t JOIN academic_sessions ac
         ON ac.id=t.academic_session_id AND ac.school_id=t.school_id
       UNION ALL
       SELECT 'TERM_END:' || t.id::text, t.school_id, ac.id, ac.name, t.id, t.name,
         t.name || ' ends', 'TERM_END'::text, t.end_date::text, NULL::text, true,
         ARRAY['TEACHER','STUDENT','PARENT','STAFF']::text[],
         CASE WHEN UPPER(t.status)='INACTIVE' OR UPPER(ac.status)='INACTIVE' THEN 'INACTIVE' ELSE 'ACTIVE' END,
         'SESSION_TERM'::text, NULL::text
       FROM academic_terms t JOIN academic_sessions ac
         ON ac.id=t.academic_session_id AND ac.school_id=t.school_id
       UNION ALL
       SELECT ce.id::text, ce.school_id, ce.academic_session_id, ac.name,
         ce.academic_term_id, t.name, ce.title, ce.category,
         ce.start_date::text, ce.end_date::text, ce.is_academic, ce.audience,
         ce.status, ce.source, ce.notes
       FROM school_calendar_events ce
       LEFT JOIN academic_sessions ac
         ON ac.id=ce.academic_session_id AND ac.school_id=ce.school_id
       LEFT JOIN academic_terms t
         ON t.id=ce.academic_term_id AND t.school_id=ce.school_id
     )
     SELECT * FROM calendar c
      WHERE c."schoolId"=$1
        AND ($2::integer IS NULL OR c."sessionId"=$2)
        AND ($3::integer IS NULL OR c."termId"=$3)
        AND ($4::date IS NULL OR COALESCE(c."endDate",c."startDate")::date >= $4::date)
        AND ($5::date IS NULL OR COALESCE(c."endDate",c."startDate")::date <= $5::date)
        AND ($6::boolean OR (c.status='ACTIVE' AND c.audience && $7::text[]))
      ORDER BY c."startDate",c.id`,
    [
      schoolId,
      filters.sessionId ?? null,
      filters.termId ?? null,
      filters.startsOnOrAfter ?? null,
      filters.endsOnOrBefore ?? null,
      access.manager,
      access.roles,
    ],
  );
  return result.rows;
}

router.get("/schools/:schoolId/academic-calendar", run(async (req, res) => {
  const schoolId = positiveId(req.params.schoolId, "schoolId");
  const filters = parseCalendarFilters(req.query);
  const rows = await listCalendarRows(req, schoolId, filters);
  res.setHeader("Cache-Control", "private, no-store");
  res.json(rows);
}));

function parseCreatedCalendarEvent(raw: unknown) {
  const body = object(raw, "calendar event");
  rejectUnknownKeys(body, [
    "termId",
    "title",
    "category",
    "startDate",
    "endDate",
    "academic",
    "audience",
    "notes",
  ], "calendar event");
  const termId = body.termId === undefined || body.termId === null
    ? null
    : positiveId(body.termId, "termId");
  const title = positiveOptionalText(body.title, "Event title", 180)!;
  const category = requireCalendarCategory(
    body.category,
    ["RESUMPTION", "MID_TERM_BREAK", "HOLIDAY", "EXAMINATION", "RESULT_PUBLICATION", "SCHOOL_EVENT", "OTHER"],
  );
  const startDate = dateInput(body.startDate, "startDate")!;
  const endDate = body.endDate === undefined ? null : dateInput(body.endDate, "endDate", true);
  dateRange(startDate, endDate, "Calendar event");
  if (typeof body.academic !== "boolean") {
    throw new AuthError(400, "academic must be a boolean");
  }
  const audience = parseAudience(body.audience, "audience");
  const notes = optionalNotes(body.notes, "notes");
  return { termId, title, category, startDate, endDate, academic: body.academic, audience, notes };
}

async function validateEventTerm(
  executor: QueryExecutor,
  schoolId: number,
  termId: number | null,
) {
  if (termId === null) return { sessionId: null, termId: null };
  const term = await executor.query(
    `SELECT t.id, t.academic_session_id AS "sessionId"
       FROM academic_terms t
      WHERE t.id=$1 AND t.school_id=$2`,
    [termId, schoolId],
  );
  if (!term.rows[0]) throw new AuthError(404, "Academic term not found in this school");
  return { sessionId: Number(term.rows[0].sessionId), termId: Number(term.rows[0].id) };
}

router.post("/schools/:schoolId/academic-calendar", run(async (req, res) => {
  const schoolId = positiveId(req.params.schoolId, "schoolId");
  const context = assertSchoolWriter(req, schoolId);
  const body = parseCreatedCalendarEvent(req.body);
  const client = await pool.connect();
  let eventId = 0;
  try {
    await client.query("BEGIN");
    const academicPeriod = await validateEventTerm(client, schoolId, body.termId);
    const inserted = await client.query(
      `INSERT INTO school_calendar_events
        (school_id,academic_session_id,academic_term_id,source,source_key,title,category,
         start_date,end_date,is_academic,audience,status,notes,created_by_user_id,updated_by_user_id)
       VALUES ($1,$2,$3,'SCHOOL_EVENT',$4,$5,$6,$7,$8,$9,$10,'ACTIVE',$11,$12,$12)
       RETURNING id`,
      [
        schoolId,
        academicPeriod.sessionId,
        academicPeriod.termId,
        `school:${schoolId}:manual:${randomUUID()}`,
        body.title,
        body.category,
        body.startDate,
        body.endDate,
        body.academic,
        body.audience,
        body.notes,
        context.user.id,
      ],
    );
    eventId = Number(inserted.rows[0]?.id);
    await audit(req, schoolId, "Created school calendar event", eventId, {}, client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const event = await oneStoredCalendarEvent(pool, schoolId, eventId);
  if (!event.rows[0]) throw new Error("Created calendar event could not be reloaded");
  res.status(201).json(event.rows[0]);
}));

type ParsedGeneratedTerm = {
  termId: number;
  resumptionDate: string | null;
  midTermBreaks: CalendarDateItem[];
  holidays: CalendarDateItem[];
  examinations: CalendarDateItem[];
  resultPublicationDates: CalendarDateItem[];
};

function parseGenerateCalendar(raw: unknown): { sessionId: number; terms: ParsedGeneratedTerm[] } {
  const body = object(raw, "calendar configuration");
  rejectUnknownKeys(body, ["sessionId", "terms"], "calendar configuration");
  const sessionId = positiveId(body.sessionId, "sessionId");
  if (!Array.isArray(body.terms) || body.terms.length < 1 || body.terms.length > 32) {
    throw new AuthError(400, "terms must contain one or more academic-term configurations");
  }
  const used = new Set<number>();
  const terms = body.terms.map((rawTerm, index) => {
    const term = object(rawTerm, `terms[${index}]`);
    rejectUnknownKeys(term, [
      "termId",
      "resumptionDate",
      "midTermBreaks",
      "holidays",
      "examinations",
      "resultPublicationDates",
    ], `terms[${index}]`);
    const termId = positiveId(term.termId, `terms[${index}].termId`);
    if (used.has(termId)) throw new AuthError(400, "A term must not be configured more than once");
    used.add(termId);
    const resumptionDate = term.resumptionDate === undefined || term.resumptionDate === null
      ? null
      : dateInput(term.resumptionDate, `terms[${index}].resumptionDate`)!;
    const readItems = (key: string): CalendarDateItem[] => {
      const values = term[key];
      if (values === undefined) return [];
      if (!Array.isArray(values) || values.length > 100) {
        throw new AuthError(400, `terms[${index}].${key} must be an array of up to 100 entries`);
      }
      return values.map((value, itemIndex) =>
        parseCalendarDateItem(value, `terms[${index}].${key}[${itemIndex}]`),
      );
    };
    return {
      termId,
      resumptionDate,
      midTermBreaks: readItems("midTermBreaks"),
      holidays: readItems("holidays"),
      examinations: readItems("examinations"),
      resultPublicationDates: readItems("resultPublicationDates"),
    };
  });
  return { sessionId, terms };
}

function assertConfiguredDateInRange(
  date: string,
  term: { startDate: string; endDate: string },
  label: string,
) {
  if (date < term.startDate || date > term.endDate) {
    throw new AuthError(400, `${label} must fall within its configured academic term`);
  }
}

type GeneratedCalendarEntry = CalendarDateItem & {
  category: string;
  sourceIndex: number;
};

function materializeGeneratedEntries(
  config: ParsedGeneratedTerm,
  term: { id: number; sessionId: number; name: string; startDate: string; endDate: string },
  session: { name: string; startDate: string; endDate: string },
): GeneratedCalendarEntry[] {
  const events: GeneratedCalendarEntry[] = [];
  if (config.resumptionDate) {
    assertConfiguredDateInRange(config.resumptionDate, term, `${term.name} resumption date`);
    events.push({
      category: "RESUMPTION",
      sourceIndex: 0,
      title: `${term.name} resumption`,
      startDate: config.resumptionDate,
      endDate: null,
      notes: null,
      audience: [...CALENDAR_AUDIENCES] as CalendarAudience[],
    });
  }
  for (const [category, items, permittedRange] of [
    ["MID_TERM_BREAK", config.midTermBreaks, term],
    ["HOLIDAY", config.holidays, term],
    ["EXAMINATION", config.examinations, term],
    ["RESULT_PUBLICATION", config.resultPublicationDates, session],
  ] as const) {
    items.forEach((item, index) => {
      assertConfiguredDateInRange(item.startDate, permittedRange, `${category} start date`);
      if (item.endDate) {
        assertConfiguredDateInRange(item.endDate, permittedRange, `${category} end date`);
      }
      events.push({
        ...item,
        category,
        sourceIndex: index,
      });
    });
  }
  return events;
}

router.post("/schools/:schoolId/academic-calendar/generate", run(async (req, res) => {
  const schoolId = positiveId(req.params.schoolId, "schoolId");
  const context = assertSchoolWriter(req, schoolId);
  const body = parseGenerateCalendar(req.body);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1::int,$2::int)", [schoolId, 0]);
    const sessionResult = await client.query(
      `SELECT id, name, start_date::text AS "startDate", end_date::text AS "endDate"
         FROM academic_sessions WHERE id=$1 AND school_id=$2 FOR UPDATE`,
      [body.sessionId, schoolId],
    );
    const session = sessionResult.rows[0] as
      | { id: number; name: string; startDate: string; endDate: string }
      | undefined;
    if (!session) throw new AuthError(404, "Academic session not found in this school");
    const termsResult = await client.query(
      `SELECT id,academic_session_id AS "sessionId",name,start_date::text AS "startDate",
              end_date::text AS "endDate"
         FROM academic_terms
        WHERE school_id=$1 AND academic_session_id=$2
        ORDER BY start_date,id FOR UPDATE`,
      [schoolId, body.sessionId],
    );
    const terms = termsResult.rows as Array<{
      id: number;
      sessionId: number;
      name: string;
      startDate: string;
      endDate: string;
    }>;
    if (terms.length !== body.terms.length ||
      terms.some((term) => !body.terms.some((configuration) => configuration.termId === Number(term.id)))) {
      throw new AuthError(400, "Configure every academic term in the selected session exactly once");
    }
    const termById = new Map(terms.map((term) => [Number(term.id), term]));
    for (const term of terms) {
      const configuration = body.terms.find((candidate) => candidate.termId === Number(term.id))!;
      if (configuration.resumptionDate) {
        assertConfiguredDateInRange(configuration.resumptionDate, term, `${term.name} resumption date`);
      }
    }
    await client.query(
      `UPDATE school_calendar_events SET status='INACTIVE',updated_by_user_id=$3,updated_at=NOW()
        WHERE school_id=$1 AND academic_session_id=$2 AND source='GENERATED'`,
      [schoolId, body.sessionId, context.user.id],
    );
    let generatedCount = 0;
    for (const configuration of body.terms) {
      const term = termById.get(configuration.termId);
      if (!term) throw new AuthError(404, "Academic term not found in this school");
      const entries = materializeGeneratedEntries(configuration, term, session);
      for (const entry of entries) {
        const sourceKey = `calendar:v1:session:${body.sessionId}:term:${configuration.termId}:${entry.category}:${entry.sourceIndex}`;
        await client.query(
          `INSERT INTO school_calendar_events
            (school_id,academic_session_id,academic_term_id,source,source_key,title,category,
             start_date,end_date,is_academic,audience,status,notes,created_by_user_id,updated_by_user_id)
           VALUES ($1,$2,$3,'GENERATED',$4,$5,$6,$7,$8,true,$9,'ACTIVE',$10,$11,$11)
           ON CONFLICT (school_id,source_key) DO UPDATE
             SET academic_session_id=EXCLUDED.academic_session_id,
                 academic_term_id=EXCLUDED.academic_term_id,title=EXCLUDED.title,
                 category=EXCLUDED.category,start_date=EXCLUDED.start_date,
                 end_date=EXCLUDED.end_date,is_academic=EXCLUDED.is_academic,
                 audience=EXCLUDED.audience,status='ACTIVE',notes=EXCLUDED.notes,
                 updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=NOW()`,
          [
            schoolId,
            body.sessionId,
            configuration.termId,
            sourceKey,
            entry.title,
            entry.category,
            entry.startDate,
            entry.endDate,
            entry.audience,
            entry.notes,
            context.user.id,
          ],
        );
        generatedCount += 1;
      }
    }
    await audit(req, schoolId, "Generated academic calendar", Number(body.sessionId), {
      configuredTerms: body.terms.length,
      generatedEntries: generatedCount,
    }, client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const rows = await listCalendarRows(req, schoolId, { sessionId: body.sessionId });
  res.json(rows);
}));

function parseCalendarEventPatch(raw: unknown) {
  const input = object(raw, "calendar event update");
  rejectUnknownKeys(input, [
    "termId",
    "title",
    "category",
    "startDate",
    "endDate",
    "academic",
    "audience",
    "notes",
    "status",
  ], "calendar event update");
  if (Object.keys(input).length === 0) throw new AuthError(400, "Supply at least one calendar field to update");
  const update: Record<string, unknown> = {};
  if ("title" in input) update.title = positiveOptionalText(input.title, "Event title", 180);
  if ("category" in input) update.category = requireCalendarCategory(
    input.category,
    ["RESUMPTION", "MID_TERM_BREAK", "HOLIDAY", "EXAMINATION", "RESULT_PUBLICATION", "SCHOOL_EVENT", "OTHER"],
  );
  if ("startDate" in input) update.startDate = dateInput(input.startDate, "startDate");
  if ("endDate" in input) update.endDate = dateInput(input.endDate, "endDate", true);
  if ("academic" in input) {
    if (typeof input.academic !== "boolean") throw new AuthError(400, "academic must be a boolean");
    update.academic = input.academic;
  }
  if ("audience" in input) update.audience = parseAudience(input.audience, "audience");
  if ("notes" in input) update.notes = optionalNotes(input.notes, "notes");
  if ("status" in input) {
    if (input.status !== "ACTIVE" && input.status !== "INACTIVE") {
      throw new AuthError(400, "status must be ACTIVE or INACTIVE");
    }
    update.status = input.status;
  }
  return update;
}

router.patch("/schools/:schoolId/academic-calendar/:eventId", run(async (req, res) => {
  const schoolId = positiveId(req.params.schoolId, "schoolId");
  assertSchoolWriter(req, schoolId);
  const eventId = positiveId(req.params.eventId, "eventId");
  const patch = parseCalendarEventPatch(req.body);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const prior = await client.query(
      `SELECT start_date::text AS "startDate",end_date::text AS "endDate",source
         FROM school_calendar_events WHERE id=$1 AND school_id=$2 FOR UPDATE`,
      [eventId, schoolId],
    );
    if (!prior.rows[0]) throw new AuthError(404, "School calendar event not found");
    const startDate = (patch.startDate ?? prior.rows[0].startDate) as string;
    const endDate = ("endDate" in patch ? patch.endDate : prior.rows[0].endDate) as string | null;
    dateRange(startDate, endDate, "Calendar event");
    let period: { sessionId: number | null; termId: number | null } | undefined;
    if ("termId" in (req.body as Record<string, unknown>)) {
      const rawTermId = (req.body as Record<string, unknown>).termId;
      period = await validateEventTerm(
        client,
        schoolId,
        rawTermId === null ? null : positiveId(rawTermId, "termId"),
      );
    }
    const columns: Record<string, string> = {
      title: "title",
      category: "category",
      startDate: "start_date",
      endDate: "end_date",
      academic: "is_academic",
      audience: "audience",
      notes: "notes",
      status: "status",
    };
    const values: unknown[] = [];
    const sets: string[] = [];
    for (const [field, value] of Object.entries(patch)) {
      values.push(value);
      sets.push(`${columns[field]}=$${values.length}`);
    }
    if (period) {
      values.push(period.sessionId);
      sets.push(`academic_session_id=$${values.length}`);
      values.push(period.termId);
      sets.push(`academic_term_id=$${values.length}`);
    }
    sets.push("updated_by_user_id=$" + (values.push(getUserContext(req).user.id), values.length));
    sets.push("updated_at=NOW()");
    values.push(eventId, schoolId);
    const updated = await client.query(
      `UPDATE school_calendar_events
          SET ${sets.join(",")}
        WHERE id=$${values.length - 1} AND school_id=$${values.length}
        RETURNING id`,
      values,
    );
    if (!updated.rows[0]) throw new AuthError(404, "School calendar event not found");
    await audit(req, schoolId, "Updated school calendar event", eventId, {
      updatedFields: Object.keys(patch),
    }, client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  const result = await oneStoredCalendarEvent(pool, schoolId, eventId);
  if (!result.rows[0]) throw new Error("Updated calendar event could not be reloaded");
  res.json(result.rows[0]);
}));

function assignmentSelect() {
  return `SELECT ta.id,'CLASS'::text AS "assignmentKind",ta.school_id AS "schoolId",
      e.id AS "employeeId",
      trim(concat_ws(' ',e.first_name,e.middle_name,e.last_name)) AS "employeeName",
      e.employee_no AS "employeeNo",e.employee_type AS "employeeType",
      ac.id AS "sessionId",ac.name AS "sessionName",c.id AS "classId",c.name AS "className",
      sub.id AS "subjectId",sub.name AS "subjectName",ta.section,
      ta.assignment_type AS "assignmentType",ta.start_date::text AS "startDate",
      ta.end_date::text AS "endDate",ta.status
    FROM teacher_class_assignments ta
    JOIN employees e ON e.id=ta.employee_id AND e.school_id=ta.school_id
    JOIN academic_sessions ac ON ac.id=ta.academic_session_id AND ac.school_id=ta.school_id
    JOIN school_classes c ON c.id=ta.school_class_id AND c.school_id=ta.school_id
    LEFT JOIN subjects sub ON sub.id=ta.subject_id AND sub.school_id=ta.school_id
    WHERE ta.school_id=$1
    UNION ALL
    SELECT sa.id,'SUBJECT'::text AS "assignmentKind",sa.school_id AS "schoolId",
      e.id AS "employeeId",
      trim(concat_ws(' ',e.first_name,e.middle_name,e.last_name)) AS "employeeName",
      e.employee_no AS "employeeNo",e.employee_type AS "employeeType",
      ac.id AS "sessionId",ac.name AS "sessionName",NULL::integer AS "classId",
      NULL::text AS "className",sub.id AS "subjectId",sub.name AS "subjectName",
      NULL::text AS section,'SUBJECT_TEACHER'::text AS "assignmentType",
      sa.start_date::text AS "startDate",sa.end_date::text AS "endDate",sa.status
    FROM teacher_subject_assignments sa
    JOIN employees e ON e.id=sa.employee_id AND e.school_id=sa.school_id
    JOIN academic_sessions ac ON ac.id=sa.academic_session_id AND ac.school_id=sa.school_id
    JOIN subjects sub ON sub.id=sa.subject_id AND sub.school_id=sa.school_id
    WHERE sa.school_id=$1`;
}

router.get("/schools/:schoolId/teacher-assignments", run(async (req, res) => {
  const schoolId = positiveId(req.params.schoolId, "schoolId");
  const employeeId = optionalQueryId(req.query.employeeId, "employeeId");
  const sessionId = optionalQueryId(req.query.sessionId, "sessionId");
  const classId = optionalQueryId(req.query.classId, "classId");
  const subjectId = optionalQueryId(req.query.subjectId, "subjectId");
  const status = scalarQueryText(req.query.status, "status") ?? "ACTIVE";
  if (!["ACTIVE", "INACTIVE", "all"].includes(status)) {
    throw new AuthError(400, "status must be ACTIVE, INACTIVE, or all");
  }
  rejectUnknownKeys(req.query as Record<string, unknown>, [
    "employeeId",
    "sessionId",
    "classId",
    "subjectId",
    "status",
  ], "assignment query");
  const context = assertSchoolReader(req, schoolId, ["SCHOOL_ADMIN", "TEACHER"]);
  await requireSchoolRecord(schoolId);
  const manager = managerForSchool(context, schoolId);
  if (!manager && employeeId !== undefined) {
    const ownEmployee = await pool.query(
      `SELECT id FROM employees WHERE school_id=$1 AND user_id=$2 AND id=$3`,
      [schoolId, context.user.id, employeeId],
    );
    if (!ownEmployee.rows[0]) throw new AuthError(404, "Teacher assignment not found");
  }
  const parameters: unknown[] = [schoolId];
  const filters: string[] = [];
  const pushFilter = (sql: (placeholder: string) => string, value: unknown) => {
    parameters.push(value);
    filters.push(sql(`$${parameters.length}`));
  };
  if (!manager) pushFilter((slot) => `"employeeId" IN (SELECT id FROM employees WHERE school_id=$1 AND user_id=${slot})`, context.user.id);
  else if (employeeId !== undefined) pushFilter((slot) => `"employeeId"=${slot}`, employeeId);
  if (sessionId !== undefined) pushFilter((slot) => `"sessionId"=${slot}`, sessionId);
  if (classId !== undefined) pushFilter((slot) => `"classId"=${slot}`, classId);
  if (subjectId !== undefined) pushFilter((slot) => `"subjectId"=${slot}`, subjectId);
  if (status !== "all") pushFilter((slot) => `status=${slot}`, status);
  const selected = assignmentSelect();
  const query = filters.length
    ? `SELECT * FROM (${selected}) assignment WHERE ${filters.join(" AND ")} ORDER BY "startDate" DESC,id DESC`
    : `SELECT * FROM (${selected}) assignment ORDER BY "startDate" DESC,id DESC`;
  const result = await pool.query(query, parameters);
  res.setHeader("Cache-Control", "private, no-store");
  res.json(result.rows);
}));

function parseAssignmentCreate(raw: unknown) {
  const body = object(raw, "teacher assignment");
  rejectUnknownKeys(body, [
    "employeeId",
    "sessionId",
    "classId",
    "subjectId",
    "section",
    "assignmentType",
    "startDate",
  ], "teacher assignment");
  const employeeId = positiveId(body.employeeId, "employeeId");
  const sessionId = positiveId(body.sessionId, "sessionId");
  const classId = body.classId === undefined || body.classId === null
    ? null
    : positiveId(body.classId, "classId");
  const subjectId = body.subjectId === undefined || body.subjectId === null
    ? null
    : positiveId(body.subjectId, "subjectId");
  if (body.assignmentType !== "CLASS_TEACHER" && body.assignmentType !== "SUBJECT_TEACHER") {
    throw new AuthError(400, "assignmentType must be CLASS_TEACHER or SUBJECT_TEACHER");
  }
  const assignmentType = body.assignmentType;
  if (assignmentType === "CLASS_TEACHER" && (!classId || subjectId)) {
    throw new AuthError(400, "CLASS_TEACHER requires a class and must not include a subject");
  }
  if (assignmentType === "SUBJECT_TEACHER" && !subjectId) {
    throw new AuthError(400, "SUBJECT_TEACHER requires a subject");
  }
  const section = body.section === undefined ? "" : (() => {
    if (typeof body.section !== "string" || body.section.length > 80) {
      throw new AuthError(400, "section must be a string of at most 80 characters");
    }
    return body.section.trim();
  })();
  const startDate = dateInput(body.startDate, "startDate")!;
  return { employeeId, sessionId, classId, subjectId, assignmentType, section, startDate };
}

async function validateAssignmentResources(
  client: QueryExecutor,
  schoolId: number,
  body: ReturnType<typeof parseAssignmentCreate>,
) {
  const check = await client.query(
    `SELECT e.id AS "employeeId", ac.id AS "sessionId",
            c.id AS "classId", c.section AS "classSection", sub.id AS "subjectId"
       FROM employees e
       JOIN academic_sessions ac ON ac.id=$3 AND ac.school_id=e.school_id
       LEFT JOIN school_classes c ON c.id=$4 AND c.school_id=e.school_id
       LEFT JOIN subjects sub ON sub.id=$5 AND sub.school_id=e.school_id
      WHERE e.id=$2 AND e.school_id=$1
        AND UPPER(e.employee_type)='TEACHER'
        AND UPPER(e.employment_status)='ACTIVE'
        AND UPPER(ac.status)='ACTIVE'
        AND $6::date BETWEEN ac.start_date AND ac.end_date
        AND ($4::integer IS NULL OR c.id IS NOT NULL)
        AND ($5::integer IS NULL OR (sub.id IS NOT NULL AND UPPER(sub.status)='ACTIVE'))`,
    [schoolId, body.employeeId, body.sessionId, body.classId, body.subjectId, body.startDate],
  );
  if (!check.rows[0]) {
    throw new AuthError(404, "Active teacher, class, subject, or session not found in this school");
  }
  return check.rows[0] as { classSection?: string | null };
}

router.post("/schools/:schoolId/teacher-assignments", run(async (req, res) => {
  const schoolId = positiveId(req.params.schoolId, "schoolId");
  const context = assertSchoolWriter(req, schoolId);
  const body = parseAssignmentCreate(req.body);
  const client = await pool.connect();
  let insertedId = 0;
  const assignmentKind = body.assignmentType === "CLASS_TEACHER" || body.classId !== null
    ? "CLASS"
    : "SUBJECT";
  try {
    await client.query("BEGIN");
    const resources = await validateAssignmentResources(client, schoolId, body);
    if (body.classId !== null && !body.section) {
      body.section = resources.classSection ?? "";
    }
    const slotId = body.classId ?? body.subjectId!;
    await client.query("SELECT pg_advisory_xact_lock($1::int,$2::int)", [schoolId, slotId]);
    if (assignmentKind === "CLASS") {
      await client.query(
        `UPDATE teacher_class_assignments
            SET status='INACTIVE',
                end_date=GREATEST(start_date,LEAST(COALESCE(end_date,CURRENT_DATE),$7::date-1)),
                updated_at=NOW()
          WHERE school_id=$1 AND school_class_id=$2 AND academic_session_id=$3
            AND section=$4 AND assignment_type=$5
            AND subject_id IS NOT DISTINCT FROM $6 AND status='ACTIVE'`,
        [
          schoolId,
          body.classId,
          body.sessionId,
          body.section,
          body.assignmentType,
          body.subjectId,
          body.startDate,
        ],
      );
      const result = await client.query(
        `INSERT INTO teacher_class_assignments
          (school_id,employee_id,academic_session_id,school_class_id,subject_id,
           section,assignment_type,status,start_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE',$8)
         RETURNING id`,
        [
          schoolId,
          body.employeeId,
          body.sessionId,
          body.classId,
          body.subjectId,
          body.section,
          body.assignmentType,
          body.startDate,
        ],
      );
      insertedId = Number(result.rows[0]?.id);
    } else {
      await client.query(
        `UPDATE teacher_subject_assignments
            SET status='INACTIVE',
                end_date=GREATEST(start_date,LEAST(COALESCE(end_date,CURRENT_DATE),$6::date-1)),
                updated_by_user_id=$5,updated_at=NOW()
          WHERE school_id=$1 AND subject_id=$2 AND academic_session_id=$3
            AND status='ACTIVE'`,
        [schoolId, body.subjectId, body.sessionId, body.employeeId, context.user.id, body.startDate],
      );
      const result = await client.query(
        `INSERT INTO teacher_subject_assignments
          (school_id,employee_id,subject_id,academic_session_id,start_date,
           status,created_by_user_id,updated_by_user_id)
         VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6,$6)
         RETURNING id`,
        [schoolId, body.employeeId, body.subjectId, body.sessionId, body.startDate, context.user.id],
      );
      insertedId = Number(result.rows[0]?.id);
    }
    await audit(req, schoolId, "Assigned teacher to academic classes and subjects", insertedId, {
      assignmentKind,
      employeeId: body.employeeId,
      sessionId: body.sessionId,
      classId: body.classId,
      subjectId: body.subjectId,
      assignmentType: body.assignmentType,
    }, client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string })?.code === "23505") {
      throw new AuthError(409, "An identical active teacher assignment already exists");
    }
    throw error;
  } finally {
    client.release();
  }
  const result = await pool.query(
    `SELECT * FROM (${assignmentSelect()}) assignment
      WHERE "assignmentKind"=$2 AND id=$3 AND "schoolId"=$1`,
    [schoolId, assignmentKind, insertedId],
  );
  if (!result.rows[0]) throw new Error("Saved teacher assignment could not be reloaded");
  res.status(201).json(result.rows[0]);
}));

async function assertAssignmentSlotVacant(
  executor: QueryExecutor,
  schoolId: number,
  kind: "CLASS" | "SUBJECT",
  assignmentId: number,
  prior: Record<string, unknown>,
) {
  const slotId = Number(prior.slotId);
  await executor.query("SELECT pg_advisory_xact_lock($1::int,$2::int)", [schoolId, slotId]);
  const conflict = kind === "CLASS"
    ? await executor.query(
      `SELECT id FROM teacher_class_assignments
        WHERE school_id=$1 AND academic_session_id=$2 AND school_class_id=$3
          AND section=$5 AND assignment_type=$6
          AND subject_id IS NOT DISTINCT FROM $7
          AND id<>$4 AND status='ACTIVE'`,
      [
        schoolId,
        prior.sessionId,
        slotId,
        assignmentId,
        prior.section,
        prior.assignmentType,
        prior.subjectId,
      ],
    )
    : await executor.query(
      `SELECT id FROM teacher_subject_assignments
        WHERE school_id=$1 AND academic_session_id=$2 AND subject_id=$3
          AND id<>$4 AND status='ACTIVE'`,
      [schoolId, prior.sessionId, slotId, assignmentId],
    );
  if (conflict.rows[0]) {
    throw new AuthError(409, "Another teacher already occupies this assignment slot");
  }
}

router.patch("/schools/:schoolId/teacher-assignments/:assignmentKind/:assignmentId", run(async (req, res) => {
  const schoolId = positiveId(req.params.schoolId, "schoolId");
  const context = assertSchoolWriter(req, schoolId);
  const kind = scalarQueryText(req.params.assignmentKind, "assignmentKind");
  if (kind !== "CLASS" && kind !== "SUBJECT") {
    throw new AuthError(400, "assignmentKind must be CLASS or SUBJECT");
  }
  const assignmentId = positiveId(req.params.assignmentId, "assignmentId");
  const input = object(req.body, "teacher assignment update");
  rejectUnknownKeys(input, ["employeeId", "startDate", "endDate", "status"], "teacher assignment update");
  if (Object.keys(input).length === 0) {
    throw new AuthError(400, "Supply employeeId, status, or a date to update an assignment");
  }
  if (input.status !== undefined && input.status !== "ACTIVE" && input.status !== "INACTIVE") {
    throw new AuthError(400, "status must be ACTIVE or INACTIVE");
  }
  const replacementEmployeeId = input.employeeId === undefined
    ? undefined
    : positiveId(input.employeeId, "employeeId");
  const replacementStartDate = input.startDate === undefined
    ? undefined
    : dateInput(input.startDate, "startDate")!;
  const endDate = input.endDate === undefined ? undefined : dateInput(input.endDate, "endDate")!;
  if (replacementStartDate !== undefined && replacementEmployeeId === undefined) {
    throw new AuthError(400, "startDate may only be supplied when replacing the assigned teacher");
  }
  if (replacementEmployeeId !== undefined && input.status === "INACTIVE") {
    throw new AuthError(400, "A replacement teacher assignment must be active");
  }
  const client = await pool.connect();
  let responseAssignmentId = assignmentId;
  try {
    await client.query("BEGIN");
    const table = kind === "CLASS" ? "teacher_class_assignments" : "teacher_subject_assignments";
    const slotColumns = kind === "CLASS"
      ? `academic_session_id AS "sessionId",school_class_id AS "slotId",
         section,assignment_type AS "assignmentType",subject_id AS "subjectId"`
      : "academic_session_id AS \"sessionId\",subject_id AS \"slotId\"";
    const prior = await client.query(
      `SELECT ${slotColumns},employee_id AS "employeeId",start_date::text AS "startDate",
              end_date::text AS "endDate",status
         FROM ${table} WHERE id=$1 AND school_id=$2 FOR UPDATE`,
      [assignmentId, schoolId],
    );
    if (!prior.rows[0]) throw new AuthError(404, "Teacher assignment not found in this school");
    if (replacementEmployeeId !== undefined) {
      if (Number(prior.rows[0].employeeId) === replacementEmployeeId) {
        throw new AuthError(400, "Replacement employeeId must identify a different teacher");
      }
      if (prior.rows[0].status !== "ACTIVE") {
        throw new AuthError(409, "Only an active teacher assignment can be replaced");
      }
      const newStartDate = replacementStartDate ??
        (prior.rows[0].startDate === null ? undefined : String(prior.rows[0].startDate));
      if (!newStartDate) {
        throw new AuthError(400, "startDate is required to replace an assignment with no recorded start date");
      }
      const newEndDate = endDate === undefined
        ? (prior.rows[0].endDate as string | null)
        : endDate;
      dateRange(newStartDate, newEndDate, "Replacement teacher assignment");
      const subjectId = kind === "SUBJECT"
        ? Number(prior.rows[0].slotId)
        : prior.rows[0].subjectId === null
          ? null
          : Number(prior.rows[0].subjectId);
      const eligibleReplacement = await client.query(
        `SELECT e.id FROM employees e
          JOIN academic_sessions ac
            ON ac.id=$3 AND ac.school_id=e.school_id AND UPPER(ac.status)='ACTIVE'
          LEFT JOIN subjects sub
            ON sub.id=$5 AND sub.school_id=e.school_id AND UPPER(sub.status)='ACTIVE'
         WHERE e.id=$2 AND e.school_id=$1 AND UPPER(e.employee_type)='TEACHER'
           AND UPPER(e.employment_status)='ACTIVE'
           AND $4::date BETWEEN ac.start_date AND ac.end_date
           AND ($5::integer IS NULL OR sub.id IS NOT NULL)`,
        [schoolId, replacementEmployeeId, prior.rows[0].sessionId, newStartDate, subjectId],
      );
      if (!eligibleReplacement.rows[0]) {
        throw new AuthError(404, "Active replacement teacher or assignment session not found in this school");
      }
      await assertAssignmentSlotVacant(client, schoolId, kind, assignmentId, prior.rows[0]);
      await client.query(
        `UPDATE ${table}
            SET status='INACTIVE',
                end_date=CASE
                  WHEN start_date IS NULL THEN COALESCE(end_date,$1::date-1)
                  WHEN $1::date > start_date
                    THEN GREATEST(start_date,LEAST(COALESCE(end_date,$1::date-1),$1::date-1))
                  ELSE end_date
                END,
                ${kind === "SUBJECT" ? "updated_by_user_id=$4," : ""}updated_at=NOW()
          WHERE id=$2 AND school_id=$3`,
        [newStartDate, assignmentId, schoolId, context.user.id],
      );
      const inserted = kind === "CLASS"
        ? await client.query(
          `INSERT INTO teacher_class_assignments
            (school_id,employee_id,academic_session_id,school_class_id,subject_id,
             section,assignment_type,status,start_date,end_date)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE',$8,$9) RETURNING id`,
          [
            schoolId,
            replacementEmployeeId,
            prior.rows[0].sessionId,
            prior.rows[0].slotId,
            subjectId,
            prior.rows[0].section,
            prior.rows[0].assignmentType,
            newStartDate,
            newEndDate,
          ],
        )
        : await client.query(
          `INSERT INTO teacher_subject_assignments
            (school_id,employee_id,subject_id,academic_session_id,start_date,end_date,
             status,created_by_user_id,updated_by_user_id)
           VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',$7,$7) RETURNING id`,
          [
            schoolId,
            replacementEmployeeId,
            prior.rows[0].slotId,
            prior.rows[0].sessionId,
            newStartDate,
            newEndDate,
            context.user.id,
          ],
        );
      responseAssignmentId = Number(inserted.rows[0]?.id);
      await audit(req, schoolId, "Replaced teacher on academic assignment", responseAssignmentId, {
        assignmentKind: kind,
        previousAssignmentId: assignmentId,
        previousEmployeeId: Number(prior.rows[0].employeeId),
        replacementEmployeeId,
        sessionId: Number(prior.rows[0].sessionId),
      }, client);
    } else {
      const start = String(prior.rows[0].startDate);
      const finalEnd = endDate === undefined
        ? (prior.rows[0].endDate as string | null)
        : endDate;
      dateRange(start, finalEnd, "Teacher assignment");
      if (input.status === "ACTIVE") {
        const eligibleTeacher = await client.query(
          `SELECT e.id FROM employees e
            JOIN academic_sessions ac
              ON ac.id=$3 AND ac.school_id=e.school_id AND UPPER(ac.status)='ACTIVE'
           WHERE e.id=$2 AND e.school_id=$1 AND UPPER(e.employee_type)='TEACHER'
             AND UPPER(e.employment_status)='ACTIVE'`,
          [schoolId, prior.rows[0].employeeId, prior.rows[0].sessionId],
        );
        if (!eligibleTeacher.rows[0]) {
          throw new AuthError(404, "Active teacher assignment resources not found in this school");
        }
        await assertAssignmentSlotVacant(client, schoolId, kind, assignmentId, prior.rows[0]);
      }
      await client.query(
        `UPDATE ${table}
          SET status=COALESCE($1,status),
              end_date=COALESCE($2,end_date),
              ${kind === "SUBJECT" ? "updated_by_user_id=$3," : ""}updated_at=NOW()
        WHERE id=$4 AND school_id=$5`,
        [input.status ?? null, endDate ?? null, context.user.id, assignmentId, schoolId],
      );
      await audit(req, schoolId, "Updated teacher academic assignment", assignmentId, {
        assignmentKind: kind,
        updatedFields: Object.keys(input),
      }, client);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string })?.code === "23505") {
      throw new AuthError(409, "Another teacher already occupies this assignment slot");
    }
    throw error;
  } finally {
    client.release();
  }
  const result = await pool.query(
    `SELECT * FROM (${assignmentSelect()}) assignment
      WHERE "assignmentKind"=$2 AND id=$3 AND "schoolId"=$1`,
    [schoolId, kind, responseAssignmentId],
  );
  if (!result.rows[0]) throw new AuthError(404, "Teacher assignment not found");
  res.json(result.rows[0]);
}));

function parseDutyBody(raw: unknown, partial = false) {
  const body = object(raw, partial ? "duty update" : "teacher duty");
  const allowed = partial
    ? ["employeeId", "dutyRole", "startDate", "endDate", "notes", "status"]
    : ["employeeId", "dutyRole", "startDate", "endDate", "notes"];
  rejectUnknownKeys(body, allowed, "teacher duty");
  if (partial && !Object.keys(body).length) {
    throw new AuthError(400, "Supply at least one duty field to update");
  }
  const value: Record<string, unknown> = {};
  if ("employeeId" in body) value.employeeId = positiveId(body.employeeId, "employeeId");
  if ("dutyRole" in body) value.dutyRole = positiveOptionalText(body.dutyRole, "Duty role", 100);
  if ("startDate" in body) value.startDate = dateInput(body.startDate, "startDate");
  if ("endDate" in body) value.endDate = dateInput(body.endDate, "endDate");
  if ("notes" in body) value.notes = optionalNotes(body.notes, "notes");
  if ("status" in body) {
    if (body.status !== "ACTIVE" && body.status !== "INACTIVE") {
      throw new AuthError(400, "status must be ACTIVE or INACTIVE");
    }
    value.status = body.status;
  }
  if (!partial && !("employeeId" in value && "dutyRole" in value && "startDate" in value && "endDate" in value)) {
    throw new AuthError(400, "employeeId, dutyRole, startDate, and endDate are required");
  }
  const start = (value.startDate ?? null) as string | null;
  const end = (value.endDate ?? null) as string | null;
  if (start && end) {
    dateRange(start, end, "Duty roster");
    const dayCount = Math.floor(
      (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
    ) + 1;
    if (dayCount > 7) throw new AuthError(400, "A teacher duty roster entry must not span more than one week");
  }
  return value;
}

function dutySelect() {
  return `SELECT d.id,d.school_id AS "schoolId",e.id AS "employeeId",
      trim(concat_ws(' ',e.first_name,e.middle_name,e.last_name)) AS "employeeName",
      e.employee_no AS "employeeNo",d.duty_role AS "dutyRole",
      d.start_date::text AS "startDate",d.end_date::text AS "endDate",
      d.status,d.notes,d.created_at AS "createdAt",d.updated_at AS "updatedAt"
    FROM teacher_duty_roster d
    JOIN employees e ON e.id=d.employee_id AND e.school_id=d.school_id`;
}

router.get("/schools/:schoolId/duty-roster", run(async (req, res) => {
  const schoolId = positiveId(req.params.schoolId, "schoolId");
  rejectUnknownKeys(req.query as Record<string, unknown>, [
    "startsOnOrAfter",
    "endsOnOrBefore",
    "status",
  ], "duty roster query");
  const fromRaw = scalarQueryText(req.query.startsOnOrAfter, "startsOnOrAfter");
  const toRaw = scalarQueryText(req.query.endsOnOrBefore, "endsOnOrBefore");
  const from = fromRaw === undefined ? undefined : dateInput(fromRaw, "startsOnOrAfter")!;
  const to = toRaw === undefined ? undefined : dateInput(toRaw, "endsOnOrBefore")!;
  if (from && to && from > to) {
    throw new AuthError(400, "startsOnOrAfter must not be later than endsOnOrBefore");
  }
  const status = scalarQueryText(req.query.status, "status") ?? "ACTIVE";
  if (!["ACTIVE", "INACTIVE", "all"].includes(status)) {
    throw new AuthError(400, "status must be ACTIVE, INACTIVE, or all");
  }
  const context = assertSchoolReader(req, schoolId, ["SCHOOL_ADMIN", "TEACHER"]);
  await requireSchoolRecord(schoolId);
  const manager = managerForSchool(context, schoolId);
  const parameters: unknown[] = [schoolId];
  const filters: string[] = [];
  const push = (condition: (placeholder: string) => string, value: unknown) => {
    parameters.push(value);
    filters.push(condition(`$${parameters.length}`));
  };
  if (!manager) {
    push((placeholder) => `e.user_id=${placeholder}`, context.user.id);
    if (!hasActiveSchoolRole(context, schoolId, ["TEACHER"])) {
      throw new AuthError(404, "Duty roster not found", "CROSS_TENANT_ACCESS_ATTEMPT");
    }
  }
  if (from) push((placeholder) => `d.end_date >= ${placeholder}::date`, from);
  if (to) push((placeholder) => `d.start_date <= ${placeholder}::date`, to);
  if (status !== "all") push((placeholder) => `d.status=${placeholder}`, status);
  const result = await pool.query(
    `SELECT * FROM (${dutySelect()}
      WHERE d.school_id=$1${filters.length ? ` AND ${filters.join(" AND ")}` : ""}) duties
      ORDER BY "startDate", "employeeName", id`,
    parameters,
  );
  res.setHeader("Cache-Control", "private, no-store");
  res.json(result.rows);
}));

router.post("/schools/:schoolId/duty-roster", run(async (req, res) => {
  const schoolId = positiveId(req.params.schoolId, "schoolId");
  const context = assertSchoolWriter(req, schoolId);
  const body = parseDutyBody(req.body);
  const employeeId = Number(body.employeeId);
  const client = await pool.connect();
  let dutyId = 0;
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1::int,$2::int)", [schoolId, employeeId]);
    const teacher = await client.query(
      `SELECT id FROM employees
        WHERE id=$1 AND school_id=$2 AND UPPER(employee_type)='TEACHER'
          AND UPPER(employment_status)='ACTIVE'`,
      [employeeId, schoolId],
    );
    if (!teacher.rows[0]) throw new AuthError(404, "Active teacher not found in this school");
    const conflict = await client.query(
      `SELECT id FROM teacher_duty_roster
        WHERE school_id=$1 AND employee_id=$2 AND status='ACTIVE'
          AND start_date <= $4::date AND end_date >= $3::date
        LIMIT 1`,
      [schoolId, employeeId, body.startDate, body.endDate],
    );
    if (conflict.rows[0]) throw new AuthError(409, "This teacher already has a duty during the requested date range");
    const inserted = await client.query(
      `INSERT INTO teacher_duty_roster
        (school_id,employee_id,duty_role,start_date,end_date,status,notes,
         created_by_user_id,updated_by_user_id)
       VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6,$7,$7)
       RETURNING id`,
      [
        schoolId,
        employeeId,
        body.dutyRole,
        body.startDate,
        body.endDate,
        body.notes,
        context.user.id,
      ],
    );
    dutyId = Number(inserted.rows[0]?.id);
    await audit(req, schoolId, "Created teacher duty roster assignment", dutyId, {
      employeeId,
      startDate: body.startDate,
      endDate: body.endDate,
    }, client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string })?.code === "23505") {
      throw new AuthError(409, "This teacher already has a duty during the requested date range");
    }
    throw error;
  } finally {
    client.release();
  }
  const result = await pool.query(
    `SELECT * FROM (${dutySelect()}) duties WHERE "schoolId"=$1 AND id=$2`,
    [schoolId, dutyId],
  );
  if (!result.rows[0]) throw new Error("Created teacher duty could not be reloaded");
  res.status(201).json(result.rows[0]);
}));

router.patch("/schools/:schoolId/duty-roster/:dutyId", run(async (req, res) => {
  const schoolId = positiveId(req.params.schoolId, "schoolId");
  const context = assertSchoolWriter(req, schoolId);
  const dutyId = positiveId(req.params.dutyId, "dutyId");
  const patch = parseDutyBody(req.body, true);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query(
      `SELECT employee_id AS "employeeId",start_date::text AS "startDate",
              end_date::text AS "endDate",status,duty_role AS "dutyRole",notes
         FROM teacher_duty_roster WHERE id=$1 AND school_id=$2 FOR UPDATE`,
      [dutyId, schoolId],
    );
    if (!current.rows[0]) throw new AuthError(404, "Teacher duty not found in this school");
    const nextEmployeeId = Number(patch.employeeId ?? current.rows[0].employeeId);
    const nextStart = String(patch.startDate ?? current.rows[0].startDate);
    const nextEnd = String(patch.endDate ?? current.rows[0].endDate);
    dateRange(nextStart, nextEnd, "Duty roster");
    const dayCount = Math.floor(
      (Date.parse(`${nextEnd}T00:00:00Z`) - Date.parse(`${nextStart}T00:00:00Z`)) / 86_400_000,
    ) + 1;
    if (dayCount > 7) throw new AuthError(400, "A teacher duty roster entry must not span more than one week");
    if ((patch.status ?? current.rows[0].status) === "ACTIVE") {
      const teacher = await client.query(
        `SELECT id FROM employees
          WHERE id=$1 AND school_id=$2 AND UPPER(employee_type)='TEACHER'
            AND UPPER(employment_status)='ACTIVE'`,
        [nextEmployeeId, schoolId],
      );
      if (!teacher.rows[0]) throw new AuthError(404, "Active teacher not found in this school");
      await client.query("SELECT pg_advisory_xact_lock($1::int,$2::int)", [
        schoolId,
        nextEmployeeId,
      ]);
      const conflict = await client.query(
        `SELECT id FROM teacher_duty_roster
          WHERE school_id=$1 AND employee_id=$2 AND status='ACTIVE' AND id<>$5
            AND start_date <= $4::date AND end_date >= $3::date
          LIMIT 1`,
        [schoolId, nextEmployeeId, nextStart, nextEnd, dutyId],
      );
      if (conflict.rows[0]) throw new AuthError(409, "This teacher already has a duty during the requested date range");
    }
    await client.query(
      `UPDATE teacher_duty_roster
          SET employee_id=$1,duty_role=$2,start_date=$3,end_date=$4,
              notes=$5,status=$6,updated_by_user_id=$7,updated_at=NOW()
        WHERE id=$8 AND school_id=$9`,
      [
        nextEmployeeId,
        patch.dutyRole ?? current.rows[0].dutyRole,
        nextStart,
        nextEnd,
        "notes" in patch ? patch.notes : current.rows[0].notes,
        patch.status ?? current.rows[0].status,
        context.user.id,
        dutyId,
        schoolId,
      ],
    );
    await audit(req, schoolId, "Updated teacher duty roster assignment", dutyId, {
      updatedFields: Object.keys(patch),
    }, client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if ((error as { code?: string })?.code === "23505") {
      throw new AuthError(409, "This teacher already has a duty during the requested date range");
    }
    throw error;
  } finally {
    client.release();
  }
  const result = await pool.query(
    `SELECT * FROM (${dutySelect()}) duties WHERE "schoolId"=$1 AND id=$2`,
    [schoolId, dutyId],
  );
  if (!result.rows[0]) throw new Error("Updated teacher duty could not be reloaded");
  res.json(result.rows[0]);
}));

export default router;