import { randomBytes } from "node:crypto";
import { Router, type IRouter, type NextFunction, type Request } from "express";
import { pool } from "@workspace/db";
import {
  AuthError,
  assertSchoolOperationalAccess,
  getUserContext,
  handleAuthError,
  requireAuthentication,
} from "../middlewares/auth";
import {
  IMPORT_KINDS,
  mapSourceRows,
  normalizeHeader,
  parseImportFile,
  prepareImportRows,
  type ImportKind,
  type PreparedImportRow,
  type SchoolClass,
} from "./people-import-service";

const router: IRouter = Router();
router.use(requireAuthentication());
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const PREVIEW_TTL_MS = 20 * 60 * 1000;
const previews = new Map<string, PendingPreview>();

type Upload = { filename: string; mimeType: string; buffer: Buffer };
type ImportDatabaseClient = {
  query: (sql: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, any>> }>;
  release: () => void;
};
type PendingPreview = {
  id: string;
  userId: number;
  schoolId: number;
  kind: ImportKind;
  filename: string;
  mimeType: string;
  createdAt: number;
  rows: PreparedImportRow[];
  processing: boolean;
  used: boolean;
};

class ImportRowError extends Error {}
class ImportRowSkip extends Error {}

const asyncRoute =
  (handler: (req: Request, res: any) => Promise<void>) =>
  (req: Request, res: any, next: NextFunction) =>
    handler(req, res).catch((error) => handleAuthError(error, req, res, next));

function authorizedSchoolId(req: Request): { schoolId: number; userId: number } {
  const context = getUserContext(req);
  const adminSchoolIds = [...new Set(context.roles
    .filter((role) => role.role === "SCHOOL_ADMIN" && role.status === "ACTIVE" && role.schoolId !== null)
    .map((role) => role.schoolId!))];
  if (!adminSchoolIds.length) throw new AuthError(403, "School Administrator access is required");
  const raw = req.query.schoolId;
  let schoolId: number;
  if (raw === undefined) {
    if (adminSchoolIds.length !== 1) throw new AuthError(400, "Select an authorized school context");
    schoolId = adminSchoolIds[0];
  } else {
    if (Array.isArray(raw) || !/^[1-9]\d*$/.test(String(raw))) throw new AuthError(400, "schoolId is invalid");
    schoolId = Number(raw);
  }
  if (!adminSchoolIds.includes(schoolId)) throw new AuthError(404, "Resource not found", "CROSS_TENANT_ACCESS_ATTEMPT");
  assertSchoolOperationalAccess(req, schoolId, ["SCHOOL_ADMIN"]);
  return { schoolId, userId: context.user.id };
}

async function readMultipart(req: Request): Promise<{ fields: Map<string, string>; file: Upload }> {
  const boundaryValue = req.headers["content-type"]?.match(/multipart\/form-data\s*;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i);
  const boundary = boundaryValue?.[1] ?? boundaryValue?.[2];
  if (!boundary || boundary.length > 200) throw new AuthError(400, "A valid multipart form is required");
  const contentLength = Number(req.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES + 64 * 1024) {
    throw new AuthError(400, "The upload is larger than the 5 MB limit");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_UPLOAD_BYTES + 64 * 1024) throw new AuthError(400, "The upload is larger than the 5 MB limit");
    chunks.push(buffer);
  }
  const body = Buffer.concat(chunks);
  const marker = Buffer.from(`--${boundary}`);
  const headerEndMarker = Buffer.from("\r\n\r\n");
  const fields = new Map<string, string>();
  let file: Upload | null = null;
  let cursor = body.indexOf(marker);
  while (cursor >= 0) {
    cursor += marker.length;
    if (body.subarray(cursor, cursor + 2).toString() === "--") break;
    if (body.subarray(cursor, cursor + 2).toString() === "\r\n") cursor += 2;
    const headerEnd = body.indexOf(headerEndMarker, cursor);
    if (headerEnd < 0) throw new AuthError(400, "The multipart upload is malformed");
    const headers = body.toString("utf8", cursor, headerEnd);
    const nextMarker = body.indexOf(marker, headerEnd + headerEndMarker.length);
    if (nextMarker < 0) throw new AuthError(400, "The multipart upload is incomplete");
    let valueEnd = nextMarker;
    if (body.subarray(valueEnd - 2, valueEnd).toString() === "\r\n") valueEnd -= 2;
    const disposition = headers.match(/content-disposition:\s*form-data;([^\r\n]+)/i)?.[1] ?? "";
    const name = disposition.match(/(?:^|;)\s*name="([^"]*)"/i)?.[1];
    if (!name) throw new AuthError(400, "A multipart field is missing its name");
    const filename = disposition.match(/(?:^|;)\s*filename="([^"]*)"/i)?.[1];
    const data = body.subarray(headerEnd + headerEndMarker.length, valueEnd);
    if (filename !== undefined) {
      if (name !== "file" || file) throw new AuthError(400, "Upload exactly one file using the file field");
      const mimeType = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() ?? "application/octet-stream";
      const safeName = filename.replace(/\\/g, "/").split("/").pop()?.replace(/[\u0000-\u001f\u007f]/g, "").trim() ?? "";
      if (!safeName || safeName.length > 180) throw new AuthError(400, "The upload filename is invalid");
      file = { filename: safeName, mimeType, buffer: Buffer.from(data) };
    } else {
      if (data.length > 16 * 1024) throw new AuthError(400, "An import setting is too large");
      fields.set(name, data.toString("utf8"));
    }
    cursor = nextMarker;
  }
  if (!file) throw new AuthError(400, "Choose one CSV, XLSX, or readable text PDF file");
  if (file.buffer.length > MAX_UPLOAD_BYTES) throw new AuthError(400, "The upload is larger than the 5 MB limit");
  return { fields, file };
}

function parseJsonObject<T extends object>(raw: string | undefined, label: string): T {
  if (!raw) return {} as T;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new AuthError(400, `${label} must be valid JSON`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AuthError(400, `${label} must be an object`);
  return value as T;
}

function parseKind(raw: string | undefined): ImportKind {
  if (!raw || !IMPORT_KINDS.includes(raw as ImportKind)) throw new AuthError(400, "Select a supported import type");
  return raw as ImportKind;
}

function availableFields(kind: ImportKind): string[] {
  if (kind === "students") {
    return [
      "admissionNo", "firstName", "middleName", "lastName", "dateOfBirth", "admissionDate",
      "gender", "className", "section", "parentName", "parentEmail", "parentPhone",
      "parentRelationshipType", "address", "status",
    ];
  }
  if (kind === "parents") return ["name", "email", "phone", "address", "admissionNo", "relationshipType"];
  return ["employeeId", "firstName", "middleName", "lastName", "email", "phone", "department", "qualification", "type"];
}

function cleanMapping(kind: ImportKind, mapping: Record<string, string>, headers: string[]): Record<string, string> {
  const allowed = new Set(availableFields(kind));
  const normalizedHeaders = new Map<string, string | null>();
  for (const header of headers) {
    const normalized = normalizeHeader(header);
    normalizedHeaders.set(normalized, normalizedHeaders.has(normalized) ? null : header);
  }
  const clean: Record<string, string> = {};
  for (const [field, source] of Object.entries(mapping)) {
    if (["schoolid", "school_id", "tenantid", "tenant_id", "userid", "user_id", "role"].includes(normalizeHeader(field))) {
      throw new AuthError(400, `The ${field} field is assigned by the server and cannot be imported`);
    }
    if (!allowed.has(field)) throw new AuthError(400, `The ${field} field is not available for this import type`);
    if (typeof source !== "string" || !source.trim()) continue;
    const actualHeader = headers.includes(source) ? source : normalizedHeaders.get(normalizeHeader(source));
    if (!actualHeader) throw new AuthError(400, `Mapped column for ${field} is not present in the uploaded file`);
    clean[field] = actualHeader;
  }
  return clean;
}

function publicRow(row: PreparedImportRow) {
  return {
    index: row.index,
    sourceRow: row.sourceRow,
    values: row.values,
    status: row.status,
    errors: row.errors,
    warnings: row.warnings,
  };
}

function expirePreviews() {
  const now = Date.now();
  for (const [id, preview] of previews) {
    if (now - preview.createdAt > PREVIEW_TTL_MS || preview.used) previews.delete(id);
  }
}

function storePreview(preview: PendingPreview) {
  expirePreviews();
  const related = [...previews.values()]
    .filter((entry) => entry.userId === preview.userId && entry.schoolId === preview.schoolId)
    .sort((left, right) => left.createdAt - right.createdAt);
  while (related.length >= 5) {
    const oldest = related.shift();
    if (oldest) previews.delete(oldest.id);
  }
  while (previews.size >= 100) {
    const oldest = [...previews.values()].sort((left, right) => left.createdAt - right.createdAt)[0];
    if (!oldest) break;
    previews.delete(oldest.id);
  }
  previews.set(preview.id, preview);
}

router.get("/people/imports/classes", asyncRoute(async (req, res) => {
  const { schoolId } = authorizedSchoolId(req);
  const result = await pool.query(
    `SELECT id, name, section FROM school_classes WHERE school_id = $1 ORDER BY name, section, id`,
    [schoolId],
  );
  res.json({ classes: result.rows as SchoolClass[] });
}));

router.post("/people/imports/inspect", asyncRoute(async (req, res) => {
  const { schoolId } = authorizedSchoolId(req);
  const { fields, file } = await readMultipart(req);
  const kind = parseKind(fields.get("kind"));
  const { rows, detectedType } = parseImportFile(file);
  const classes = kind === "students"
    ? await pool.query(`SELECT id, name, section FROM school_classes WHERE school_id = $1 ORDER BY name, section`, [schoolId])
    : { rows: [] as SchoolClass[] };
  res.json({
    filename: file.filename,
    detectedType,
    kind,
    columns: Object.keys(rows[0]?.values ?? {}),
    classes: classes.rows,
  });
}));

router.post("/people/imports/preview", asyncRoute(async (req, res) => {
  const { schoolId, userId } = authorizedSchoolId(req);
  const { fields, file } = await readMultipart(req);
  const kind = parseKind(fields.get("kind"));
  const { rows, detectedType } = parseImportFile(file);
  const mapping = cleanMapping(
    kind,
    parseJsonObject<Record<string, string>>(fields.get("mapping"), "Column mapping"),
    Object.keys(rows[0]?.values ?? {}),
  );
  const sourceRows = mapSourceRows(rows, mapping);
  const classMapping = parseJsonObject<Record<string, number>>(fields.get("classMapping"), "Class mapping");
  for (const [raw, id] of Object.entries(classMapping)) {
    if (!raw.trim() || !Number.isInteger(Number(id)) || Number(id) < 1) {
      throw new AuthError(400, "Every class mapping must point to an existing school class");
    }
  }
  if (kind !== "students" && Object.keys(classMapping).length) throw new AuthError(400, "Class mapping is only used for student imports");

  const [classes, students, parents, employees, admissionNumbers] = await Promise.all([
    pool.query(`SELECT id, name, section FROM school_classes WHERE school_id = $1 ORDER BY name, section`, [schoolId]),
    pool.query(`SELECT admission_no AS "admissionNo", first_name AS "firstName", last_name AS "lastName", date_of_birth AS "dateOfBirth" FROM students WHERE school_id = $1`, [schoolId]),
    pool.query(`SELECT name, email, phone FROM parents WHERE school_id = $1`, [schoolId]),
    pool.query(`SELECT employee_no AS "employeeId", first_name AS "firstName", last_name AS "lastName", email FROM employees WHERE school_id = $1`, [schoolId]),
    pool.query(`SELECT admission_no FROM students WHERE school_id = $1`, [schoolId]),
  ]);
  const prepared = prepareImportRows({
    kind,
    rows: sourceRows,
    classMapping,
    classes: classes.rows,
    existing: {
      students: students.rows,
      parents: parents.rows,
      employees: employees.rows,
      studentAdmissions: admissionNumbers.rows.map((row) => row.admission_no),
    },
  });
  expirePreviews();
  const previewId = randomBytes(32).toString("base64url");
  const entry: PendingPreview = {
    id: previewId,
    userId,
    schoolId,
    kind,
    filename: file.filename,
    mimeType: file.mimeType,
    createdAt: Date.now(),
    rows: prepared,
    processing: false,
    used: false,
  };
  storePreview(entry);
  const classValues = kind === "students"
    ? [...new Set(sourceRows.map((row) => `${(row.values.className ?? "").trim()}${(row.values.section ?? "").trim() ? ` / ${(row.values.section ?? "").trim()}` : ""}`).filter(Boolean))]
    : [];
  res.json({
    previewId,
    filename: file.filename,
    detectedType,
    kind,
    detected: prepared.length,
    counts: {
      ready: prepared.filter((row) => row.status === "READY").length,
      potentialDuplicates: prepared.filter((row) => row.status === "POTENTIAL_DUPLICATE").length,
      duplicates: prepared.filter((row) => row.status === "DUPLICATE").length,
      invalid: prepared.filter((row) => row.status === "INVALID").length,
    },
    columns: Object.keys(rows[0]?.values ?? {}),
    classes: classes.rows,
    classValues,
    rows: prepared.map(publicRow),
  });
}));

function validParentRelationship(value: unknown): string {
  const relationship = String(value ?? "Guardian");
  return ["Father", "Mother", "Guardian", "Grandparent", "Other"].includes(relationship) ? relationship : "Guardian";
}

async function lockParentIdentifiers(
  client: ImportDatabaseClient,
  schoolId: number,
  email: string,
  name: string,
  phone: string,
) {
  const keys = [
    `import-parent-email:${schoolId}:${email.trim().toLocaleLowerCase()}`,
    `import-parent-identity:${schoolId}:${name.trim().toLocaleLowerCase()}:${phone.replace(/\D/g, "")}`,
  ].sort();
  for (const key of keys) {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [key]);
  }
}

async function saveRow(client: ImportDatabaseClient, preview: PendingPreview, row: PreparedImportRow): Promise<number> {
  const value = row.values;
  if (preview.kind === "students") {
    const student = await client.query(
      `INSERT INTO students
        (school_id, admission_no, first_name, middle_name, last_name, date_of_birth, admission_date,
         gender, class_name, section, parent_name, parent_phone, address, status, admission_status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'ADMITTED')
       RETURNING id`,
      [
        preview.schoolId, value.admissionNo, value.firstName, value.middleName, value.lastName,
        value.dateOfBirth, value.admissionDate, value.gender, value.className, value.section,
        value.parentName, value.parentPhone, value.address, value.status,
      ],
    );
    const studentId = student.rows[0].id as number;
    const email = String(value.parentEmail ?? "").trim().toLocaleLowerCase();
    const name = String(value.parentName ?? "").trim();
    const phone = String(value.parentPhone ?? "").trim();
    if (email && name && phone) {
      await lockParentIdentifiers(client, preview.schoolId, email, name, phone);
      const matched = await client.query(
        `SELECT id, name, phone FROM parents WHERE school_id = $1 AND lower(email) = lower($2) ORDER BY id LIMIT 1`,
        [preview.schoolId, email],
      );
      // An email alone is not proof of a parent-child relationship. If an existing
      // profile disagrees with the uploaded identity, leave the child unlinked.
      const existing = matched.rows[0];
      const matchesIdentity = existing &&
        String(existing.name).trim().toLocaleLowerCase() === name.toLocaleLowerCase() &&
        String(existing.phone).replace(/\D/g, "") === phone.replace(/\D/g, "");
      const parent = existing ? (matchesIdentity ? existing : null) : (await client.query(
          `INSERT INTO parents (school_id, name, email, phone, status) VALUES ($1,$2,$3,$4,'ACTIVE') RETURNING id`,
          [preview.schoolId, name, email, phone],
        )).rows[0];
      if (parent) {
        await client.query(
          `INSERT INTO parent_student_relationships (parent_id, student_id, relationship_type, status)
           VALUES ($1,$2,$3,'ACTIVE') ON CONFLICT (parent_id, student_id) DO NOTHING`,
          [parent.id, studentId, validParentRelationship(value.parentRelationshipType)],
        );
      }
    }
    return studentId;
  }
  if (preview.kind === "parents") {
    await lockParentIdentifiers(
      client,
      preview.schoolId,
      String(value.email ?? ""),
      String(value.name ?? ""),
      String(value.phone ?? ""),
    );
    const duplicate = await client.query(
      `SELECT id FROM parents
       WHERE school_id = $1 AND (
         lower(email) = lower($2) OR
         (lower(name) = lower($3) AND regexp_replace(phone, '[^0-9]', '', 'g') = $4)
       )
       ORDER BY id LIMIT 1`,
      [preview.schoolId, value.email, value.name, String(value.phone ?? "").replace(/\D/g, "")],
    );
    if (duplicate.rows[0]) throw new ImportRowSkip("Matching parent details were created after preview; this row was skipped");
    const parent = await client.query(
      `INSERT INTO parents (school_id, name, email, phone, address, status)
       VALUES ($1,$2,$3,$4,$5,'ACTIVE') RETURNING id`,
      [preview.schoolId, value.name, value.email, value.phone, value.address],
    );
    const admissionNo = String(value.admissionNo ?? "");
    if (admissionNo) {
      const student = await client.query(
        `SELECT id FROM students WHERE school_id = $1 AND lower(admission_no) = lower($2)`,
        [preview.schoolId, admissionNo],
      );
      if (!student.rows[0]) throw new ImportRowError("The linked student is no longer available in this school");
      await client.query(
        `INSERT INTO parent_student_relationships (parent_id, student_id, relationship_type, status)
         VALUES ($1,$2,$3,'ACTIVE') ON CONFLICT (parent_id, student_id) DO NOTHING`,
        [parent.rows[0].id, student.rows[0].id, validParentRelationship(value.relationshipType)],
      );
    }
    return parent.rows[0].id as number;
  }
  const employee = await client.query(
    `INSERT INTO employees
      (school_id, employee_no, first_name, middle_name, last_name, email, phone, department, qualification, employee_type, employment_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ACTIVE') RETURNING id`,
    [
      preview.schoolId, value.employeeId, value.firstName, value.middleName, value.lastName,
      value.email, value.phone, value.department, value.qualification, value.type,
    ],
  );
  return employee.rows[0].id as number;
}

function acquireClient(): Promise<ImportDatabaseClient> {
  const connectionPool = pool as unknown as {
    connect: (callback: (error: Error | undefined, client: ImportDatabaseClient) => void) => void;
  };
  return new Promise((resolve, reject) => {
    connectionPool.connect((error, client) => {
      if (error) reject(error);
      else resolve(client);
    });
  });
}

router.post("/people/imports/confirm", asyncRoute(async (req, res) => {
  const { schoolId, userId } = authorizedSchoolId(req);
  const body = req.body as {
    previewId?: unknown;
    selectedRows?: unknown;
    includePotentialDuplicates?: unknown;
  };
  if (typeof body.previewId !== "string" || !/^[A-Za-z0-9_-]{40,60}$/.test(body.previewId)) {
    throw new AuthError(400, "A valid import preview is required");
  }
  const pending = previews.get(body.previewId);
  if (!pending || pending.used || pending.processing || pending.userId !== userId || pending.schoolId !== schoolId ||
      Date.now() - pending.createdAt > PREVIEW_TTL_MS) {
    throw new AuthError(404, "This import preview is unavailable or expired");
  }
  if (!Array.isArray(body.selectedRows) || body.selectedRows.length === 0 ||
      body.selectedRows.length > pending.rows.length ||
      body.selectedRows.some((index) => !Number.isInteger(index) || Number(index) < 0 || Number(index) >= pending.rows.length)) {
    throw new AuthError(400, "Select one or more rows from this preview");
  }
  const unique = new Set(body.selectedRows as number[]);
  if (unique.size !== body.selectedRows.length) throw new AuthError(400, "The selected rows contain duplicates");
  const selected = pending.rows.filter((row) => unique.has(row.index));
  if (selected.some((row) => row.status === "INVALID" || row.status === "DUPLICATE")) {
    throw new AuthError(400, "Resolve invalid rows and skip existing duplicates before confirming");
  }
  const potentialSelected = selected.filter((row) => row.status === "POTENTIAL_DUPLICATE");
  if (potentialSelected.length && body.includePotentialDuplicates !== true) {
    throw new AuthError(400, "Confirm importing the flagged possible duplicates as new records");
  }
  pending.processing = true;
  let client: ImportDatabaseClient | undefined;
  let imported = 0;
  const rowResults: Array<{ index: number; sourceRow: number; status: "IMPORTED" | "FAILED" | "SKIPPED"; recordId?: number; message?: string }> = [];
  try {
    client = await acquireClient();
    await client.query("BEGIN");
    for (const row of pending.rows) {
      if (!unique.has(row.index)) {
        if (row.status === "INVALID") {
          rowResults.push({
            index: row.index,
            sourceRow: row.sourceRow,
            status: "FAILED",
            message: row.errors.map((issue) => issue.message).join("; ").slice(0, 240),
          });
        } else {
          const skipReason = row.status === "DUPLICATE"
            ? row.warnings.map((warning) => warning.message).join("; ")
            : "Not selected for import";
          rowResults.push({ index: row.index, sourceRow: row.sourceRow, status: "SKIPPED", message: skipReason.slice(0, 240) });
        }
        continue;
      }
      const savepoint = `import_row_${row.index}`;
      await client.query(`SAVEPOINT ${savepoint}`);
      try {
        const recordId = await saveRow(client, pending, row);
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        imported += 1;
        rowResults.push({ index: row.index, sourceRow: row.sourceRow, status: "IMPORTED", recordId });
      } catch (error) {
        await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await client.query(`RELEASE SAVEPOINT ${savepoint}`);
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
        if (error instanceof ImportRowSkip) {
          rowResults.push({ index: row.index, sourceRow: row.sourceRow, status: "SKIPPED", message: error.message });
          continue;
        }
        const message = error instanceof ImportRowError
          ? error.message
          : code === "23505"
            ? "A matching record was created after preview; review the duplicate and try again"
            : code === "23503"
              ? "A related school record is no longer available"
              : "The record could not be saved; verify its values and try again";
        rowResults.push({ index: row.index, sourceRow: row.sourceRow, status: "FAILED", message: message.slice(0, 240) });
      }
    }
    const skipped = rowResults.filter((row) => row.status === "SKIPPED").length;
    const failed = rowResults.filter((row) => row.status === "FAILED").length;
    const context = getUserContext(req);
    const actor = [context.user.firstName, context.user.lastName].filter(Boolean).join(" ") || context.user.email;
    await client.query(
      `INSERT INTO audit_logs
        ("user", role, actor_user_id, clerk_user_id, school_id, action, module, severity, event_type, result, metadata)
       VALUES ($1,'SCHOOL_ADMIN',$2,$3,$4,$5,'People Import','info','BULK_IMPORT_COMPLETED',$6,$7::jsonb)`,
      [
        actor,
        userId,
        context.user.clerkUserId,
        schoolId,
        `Bulk import ${pending.kind}: ${imported} imported, ${skipped} skipped, ${failed} failed`,
        failed ? "PARTIAL" : "SUCCESS",
        JSON.stringify({
          fileType: pending.mimeType,
          fileName: pending.filename,
          importType: pending.kind,
          recordsDetected: pending.rows.length,
          recordsImported: imported,
          recordsSkipped: skipped,
          recordsFailed: failed,
          result: failed ? "PARTIAL" : "SUCCESS",
          errors: rowResults.filter((row) => row.status === "FAILED").map((row) => ({ row: row.sourceRow, reason: row.message })),
        }),
      ],
    );
    await client.query("COMMIT");
    pending.used = true;
    res.json({
      detected: pending.rows.length,
      imported,
      skipped,
      failed,
      results: rowResults,
    });
  } catch (error) {
    if (client) await client.query("ROLLBACK");
    pending.processing = false;
    throw error;
  } finally {
    if (client) client.release();
  }
}));

export default router;