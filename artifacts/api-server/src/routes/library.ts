import { Router, type NextFunction, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import {
  assertSchoolOperationalAccess,
  AuthError,
  getUserContext,
  handleAuthError,
  requireAuthentication,
  type Role,
} from "../middlewares/auth";
import { queueCommunicationNotification } from "../services/communication-service";

const router = Router();
router.use(requireAuthentication());

type BorrowerType = "STUDENT" | "TEACHER" | "STAFF";
type CopyStatus = "AVAILABLE" | "BORROWED" | "RESERVED" | "LOST" | "DAMAGED" | "MAINTENANCE" | "RETIRED";
type OverdueNotificationLoan = {
  id: number | string;
  borrowerUserId: number | string;
  studentId: number | string | null;
  title: string;
  dueOn: string | Date;
  daysOverdue: number | string;
};
type LibraryQuery = {
  query<Row = Record<string, any>>(sql: string, values?: unknown[]): Promise<{ rows: Row[]; rowCount?: number | null }>;
};
type LibraryClient = LibraryQuery & { release: () => void };

const copyStatuses = new Set<CopyStatus>([
  "AVAILABLE", "BORROWED", "RESERVED", "LOST", "DAMAGED", "MAINTENANCE", "RETIRED",
]);
const asyncRoute = (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => {
    handler(req, res).catch(error => handleAuthError(error, req, res, next));
  };

function positiveId(value: unknown, label: string): number {
  const raw = typeof value === "number" ? String(value) : value;
  if (typeof raw !== "string" || !/^[1-9]\d*$/.test(raw)) {
    throw new AuthError(400, `${label} must be a positive integer`);
  }
  const id = Number(raw);
  if (!Number.isSafeInteger(id)) throw new AuthError(400, `${label} must be a positive integer`);
  return id;
}

function schoolIdFrom(value: unknown): number {
  return positiveId(value, "schoolId");
}

function bodyObject(value: unknown, allowedKeys: readonly string[], requiredKeys: readonly string[] = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuthError(400, "Request body must be an object");
  }
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !allowedKeys.includes(key))) {
    throw new AuthError(400, "Request body contains unsupported fields");
  }
  if (requiredKeys.some(key => body[key] === undefined || body[key] === null)) {
    throw new AuthError(400, "One or more required fields are missing");
  }
  return body;
}

function text(value: unknown, label: string, maximum: number, optional = false): string | null {
  if (optional && (value === undefined || value === null || value === "")) return null;
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new AuthError(400, `${label} must be a non-empty string of at most ${maximum} characters`);
  }
  return value.trim();
}

function optionalText(value: unknown, label: string, maximum: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > maximum) {
    throw new AuthError(400, `${label} must be at most ${maximum} characters`);
  }
  return value.trim() || null;
}

function dateOnly(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AuthError(400, `${label} must be a calendar date in YYYY-MM-DD format`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new AuthError(400, `${label} must be a valid calendar date`);
  }
  return value;
}

function idempotencyKey(value: unknown): string {
  return text(value, "idempotencyKey", 160) as string;
}

function isPlatformOwner(req: Request): boolean {
  return getUserContext(req).roles.some(role =>
    role.role === "PLATFORM_OWNER" && role.schoolId === null && role.status === "ACTIVE",
  );
}

function schoolRole(req: Request, schoolId: number): Role[] {
  return getUserContext(req).roles
    .filter(role => role.status === "ACTIVE" && role.schoolId === schoolId)
    .map(role => role.role);
}

function requireAdmin(req: Request, schoolId: number) {
  return assertSchoolOperationalAccess(req, schoolId, ["SCHOOL_ADMIN"]);
}

async function isLibraryStaff(req: Request, schoolId: number, catalogue = false): Promise<boolean> {
  const context = getUserContext(req);
  const roles = schoolRole(req, schoolId);
  if (roles.includes("SCHOOL_ADMIN")) return true;
  if (!roles.some(role => role === "STAFF" || role === "TEACHER")) return false;
  const result = await pool.query(
    `SELECT 1
       FROM library_staff ls
       JOIN employees e ON e.school_id=ls.school_id AND e.user_id=ls.user_id
         AND UPPER(e.employment_status)='ACTIVE'
       JOIN school_memberships sm ON sm.school_id=ls.school_id AND sm.user_id=ls.user_id
         AND sm.status='ACTIVE' AND sm.role IN ('STAFF','TEACHER')
         AND ((sm.role='TEACHER' AND UPPER(e.employee_type)='TEACHER')
           OR (sm.role='STAFF' AND UPPER(e.employee_type)<>'TEACHER'))
      WHERE ls.school_id=$1 AND ls.user_id=$2 AND ls.is_active=true
        AND ($3::boolean=false OR ls.can_manage_catalogue=true)
      LIMIT 1`,
    [schoolId, context.user.id, catalogue],
  );
  return result.rows.length > 0;
}

async function requireLibraryManager(req: Request, schoolId: number, catalogue = false): Promise<void> {
  if (isPlatformOwner(req)) throw new AuthError(404, "Resource not found", "CROSS_TENANT_ACCESS_ATTEMPT");
  if (schoolRole(req, schoolId).includes("SCHOOL_ADMIN")) {
    requireAdmin(req, schoolId);
    return;
  }
  if (!(await isLibraryStaff(req, schoolId, catalogue))) {
    throw new AuthError(403, "Authorized library staff access is required");
  }
}

async function requireSchoolViewer(req: Request, schoolId: number): Promise<void> {
  if (isPlatformOwner(req)) throw new AuthError(404, "Resource not found", "CROSS_TENANT_ACCESS_ATTEMPT");
  const context = getUserContext(req);
  const roles = schoolRole(req, schoolId);
  if (roles.some(role => ["SCHOOL_ADMIN", "TEACHER", "STAFF"].includes(role))) {
    assertSchoolOperationalAccess(req, schoolId, ["SCHOOL_ADMIN", "TEACHER", "STAFF"]);
    return;
  }
  if (roles.includes("ACCOUNTANT") || roles.includes("PARTNER")) {
    throw new AuthError(404, "Resource not found", "CROSS_TENANT_ACCESS_ATTEMPT");
  }
  const student = await pool.query(
    `SELECT 1 FROM students
      WHERE school_id=$1 AND user_id=$2 AND UPPER(status)='ACTIVE' LIMIT 1`,
    [schoolId, context.user.id],
  );
  if (student.rows.length) return;
  const parent = await pool.query(
    `SELECT 1 FROM parents p
       JOIN parent_student_relationships psr ON psr.parent_id=p.id AND UPPER(psr.status)='ACTIVE'
       JOIN students s ON s.id=psr.student_id AND s.school_id=p.school_id AND UPPER(s.status)='ACTIVE'
      WHERE p.school_id=$1 AND p.user_id=$2 AND UPPER(p.status)='ACTIVE' LIMIT 1`,
    [schoolId, context.user.id],
  );
  if (!parent.rows.length) {
    throw new AuthError(404, "Resource not found", "CROSS_TENANT_ACCESS_ATTEMPT");
  }
}

function pageSize(value: unknown, fallback = 50, maximum = 200): number {
  if (value === undefined) return fallback;
  const parsed = positiveId(value, "limit");
  if (parsed > maximum) throw new AuthError(400, `limit must not exceed ${maximum}`);
  return parsed;
}

async function writeAudit(
  client: LibraryQuery,
  req: Request,
  schoolId: number,
  action: string,
  eventType: string,
  recordId: number | null,
  metadata: Record<string, unknown> = {},
) {
  const context = getUserContext(req);
  const role = schoolRole(req, schoolId)[0] ?? "LIBRARY_STAFF";
  const actor = [context.user.firstName, context.user.lastName].filter(Boolean).join(" ") || context.user.email;
  await client.query(
    `INSERT INTO audit_logs
      ("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,severity,event_type,result,metadata)
     VALUES($1,$2,$3,$4,$5,$6,'Library',$7,'info',$8,'SUCCESS',$9::jsonb)`,
    [actor, role, context.user.id, context.user.clerkUserId, schoolId, action, recordId, eventType, JSON.stringify(metadata)],
  );
}

function transaction<T>(callback: (client: LibraryClient) => Promise<T>) {
  return (async () => {
    for (let attempt = 0; ; attempt += 1) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await callback(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        const code = (error as { code?: string })?.code;
        if ((code === "40001" || code === "40P01") && attempt < 1) continue;
        if (code === "23505") throw new AuthError(409, "A conflicting library record already exists");
        if (code === "23503") throw new AuthError(404, "A referenced record was not found in this school");
        if (code === "23514") throw new AuthError(400, "A library record violates a required status or value constraint");
        if (code === "40001" || code === "40P01") {
          throw new AuthError(409, "Library records changed concurrently; safely retry the request");
        }
        throw error;
      } finally {
        client.release();
      }
    }
  })();
}

function parseBookInput(body: Record<string, unknown>, partial = false) {
  const allowed = [
    "title", "subtitle", "isbn", "authorId", "publisherId", "categoryId", "publicationYear",
    "edition", "subject", "description", "coverReference", "language", "shelfLocation", "status",
  ];
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new AuthError(400, "Book contains unsupported fields");
  const values: Record<string, unknown> = {};
  const fieldText: Array<[string, string, number, boolean?]> = [
    ["title", "title", 300], ["subtitle", "subtitle", 300, true], ["isbn", "isbn", 40, true],
    ["edition", "edition", 80, true], ["subject", "subject", 200, true], ["description", "description", 10_000, true],
    ["coverReference", "coverReference", 500, true], ["language", "language", 80], ["shelfLocation", "shelfLocation", 120, true],
  ];
  for (const [key, label, max, optional] of fieldText) {
    if (body[key] !== undefined || (!partial && key === "title")) {
      values[key] = optional ? optionalText(body[key], label, max) : text(body[key], label, max);
    }
  }
  for (const key of ["authorId", "publisherId", "categoryId"] as const) {
    if (body[key] !== undefined) values[key] = body[key] === null ? null : positiveId(body[key], key);
  }
  if (body.publicationYear !== undefined) {
    if (body.publicationYear === null) values.publicationYear = null;
    else {
      const year = Number(body.publicationYear);
      if (!Number.isInteger(year) || year < 1000 || year > 2200) throw new AuthError(400, "publicationYear is invalid");
      values.publicationYear = year;
    }
  }
  if (body.status !== undefined) {
    if (body.status !== "ACTIVE" && body.status !== "ARCHIVED") throw new AuthError(400, "status is invalid");
    values.status = body.status;
  }
  return values;
}

function sqlUpdate(values: Record<string, unknown>, mapping: Record<string, string>) {
  const entries = Object.entries(values);
  if (!entries.length) throw new AuthError(400, "At least one update field is required");
  return {
    sql: entries.map(([key], index) => `"${mapping[key]}"=$${index + 1}`).join(","),
    values: entries.map(([, value]) => value),
  };
}

const bookColumns: Record<string, string> = {
  title: "title", subtitle: "subtitle", isbn: "isbn", authorId: "author_id",
  publisherId: "publisher_id", categoryId: "category_id", publicationYear: "publication_year",
  edition: "edition", subject: "subject", description: "description", coverReference: "cover_reference",
  language: "language", shelfLocation: "shelf_location", status: "status",
};
const bookProjection = `b.id,b.school_id AS "schoolId",b.title,b.subtitle,b.isbn,
  b.author_id AS "authorId",a.name AS "authorName",b.publisher_id AS "publisherId",p.name AS "publisherName",
  b.category_id AS "categoryId",c.name AS "categoryName",b.publication_year AS "publicationYear",
  b.edition,b.subject,b.description,b.cover_reference AS "coverReference",b.language,
  b.shelf_location AS "shelfLocation",b.status,b.created_at AS "createdAt",b.updated_at AS "updatedAt",
  COUNT(cp.id)::int AS "totalCopies",
  COUNT(cp.id) FILTER (WHERE cp.status='AVAILABLE')::int AS "availableCopies"`;

router.get("/library/books", asyncRoute(async (req, res) => {
  const schoolId = schoolIdFrom(req.query.schoolId);
  await requireSchoolViewer(req, schoolId);
  const limit = pageSize(req.query.limit);
  const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) throw new AuthError(400, "offset is invalid");
  const values: unknown[] = [schoolId];
  const filters = ["b.school_id=$1", "b.status='ACTIVE'"];
  if (typeof req.query.q === "string" && req.query.q.trim()) {
    values.push(`%${req.query.q.trim().slice(0, 120)}%`);
    filters.push(`(b.title ILIKE $${values.length} OR b.subtitle ILIKE $${values.length}
      OR b.isbn ILIKE $${values.length} OR b.subject ILIKE $${values.length}
      OR a.name ILIKE $${values.length} OR cp.copy_code ILIKE $${values.length})`);
  }
  if (req.query.categoryId !== undefined) {
    values.push(positiveId(req.query.categoryId, "categoryId"));
    filters.push(`b.category_id=$${values.length}`);
  }
  if (req.query.availability !== undefined) {
    if (req.query.availability !== "AVAILABLE" && req.query.availability !== "UNAVAILABLE") {
      throw new AuthError(400, "availability must be AVAILABLE or UNAVAILABLE");
    }
    filters.push(req.query.availability === "AVAILABLE"
      ? "EXISTS (SELECT 1 FROM library_book_copies ac WHERE ac.book_id=b.id AND ac.school_id=b.school_id AND ac.status='AVAILABLE')"
      : "NOT EXISTS (SELECT 1 FROM library_book_copies ac WHERE ac.book_id=b.id AND ac.school_id=b.school_id AND ac.status='AVAILABLE')");
  }
  values.push(limit, offset);
  const result = await pool.query(
    `SELECT ${bookProjection}
       FROM library_books b
       LEFT JOIN library_authors a ON a.id=b.author_id AND a.school_id=b.school_id
       LEFT JOIN library_publishers p ON p.id=b.publisher_id AND p.school_id=b.school_id
       LEFT JOIN library_categories c ON c.id=b.category_id AND c.school_id=b.school_id
       LEFT JOIN library_book_copies cp ON cp.book_id=b.id AND cp.school_id=b.school_id
      WHERE ${filters.join(" AND ")}
      GROUP BY b.id,a.name,p.name,c.name
      ORDER BY lower(b.title),b.id
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  res.json({ items: result.rows, schoolId, limit, offset });
}));

router.get("/library/books/:bookId", asyncRoute(async (req, res) => {
  const schoolId = schoolIdFrom(req.query.schoolId);
  await requireSchoolViewer(req, schoolId);
  const bookId = positiveId(req.params.bookId, "bookId");
  const result = await pool.query(
    `SELECT ${bookProjection}
       FROM library_books b
       LEFT JOIN library_authors a ON a.id=b.author_id AND a.school_id=b.school_id
       LEFT JOIN library_publishers p ON p.id=b.publisher_id AND p.school_id=b.school_id
       LEFT JOIN library_categories c ON c.id=b.category_id AND c.school_id=b.school_id
       LEFT JOIN library_book_copies cp ON cp.book_id=b.id AND cp.school_id=b.school_id
      WHERE b.id=$1 AND b.school_id=$2 AND b.status='ACTIVE'
      GROUP BY b.id,a.name,p.name,c.name`,
    [bookId, schoolId],
  );
  if (!result.rows[0]) throw new AuthError(404, "Book not found");
  res.json(result.rows[0]);
}));

router.post("/library/books", asyncRoute(async (req, res) => {
  const schoolId = schoolIdFrom(req.body?.schoolId);
  await requireLibraryManager(req, schoolId, true);
  const body = bodyObject(req.body, ["schoolId", "title", "subtitle", "isbn", "authorId", "publisherId",
    "categoryId", "publicationYear", "edition", "subject", "description", "coverReference", "language", "shelfLocation"], ["title"]);
  const { schoolId: _schoolId, ...bookFields } = body;
  const values = parseBookInput(bookFields);
  const columns = Object.keys(values).map(key => bookColumns[key]);
  const params = Object.values(values);
  const placeholders = params.map((_, index) => `$${index + 1}`);
  columns.unshift("school_id", "created_by_user_id");
  placeholders.unshift(`$${params.length + 1}`, `$${params.length + 2}`);
  const inserted = await transaction(async client => {
    const result = await client.query(
      `INSERT INTO library_books (${columns.map(column => `"${column}"`).join(",")})
       VALUES (${placeholders.join(",")}) RETURNING id,school_id AS "schoolId",title,status,created_at AS "createdAt"`,
      [...params, schoolId, getUserContext(req).user.id],
    );
    const row = result.rows[0];
    await writeAudit(client, req, schoolId, "Created library book", "LIBRARY_BOOK_CREATED", Number(row.id), { title: row.title });
    return row;
  });
  res.status(201).json(inserted);
}));

router.patch("/library/books/:bookId", asyncRoute(async (req, res) => {
  const schoolId = schoolIdFrom(req.body?.schoolId);
  const bookId = positiveId(req.params.bookId, "bookId");
  await requireLibraryManager(req, schoolId, true);
  const body = bodyObject(req.body, ["schoolId", "title", "subtitle", "isbn", "authorId", "publisherId",
    "categoryId", "publicationYear", "edition", "subject", "description", "coverReference", "language", "shelfLocation", "status"]);
  const { schoolId: _schoolId, ...bookFields } = body;
  const values = parseBookInput(bookFields, true);
  const update = sqlUpdate(values, bookColumns);
  const result = await transaction(async client => {
    const updated = await client.query(
      `UPDATE library_books SET ${update.sql},updated_at=NOW()
        WHERE id=$${update.values.length + 1} AND school_id=$${update.values.length + 2}
        RETURNING id,school_id AS "schoolId",title,status,updated_at AS "updatedAt"`,
      [...update.values, bookId, schoolId],
    );
    if (!updated.rows[0]) throw new AuthError(404, "Book not found");
    await writeAudit(client, req, schoolId, "Updated library book", "LIBRARY_BOOK_UPDATED", bookId, { fields: Object.keys(values) });
    return updated.rows[0];
  });
  res.json(result);
}));

const directoryResources = {
  categories: {
    table: "library_categories", name: "category", max: 100,
    columns: { name: "name", description: "description" },
  },
  authors: {
    table: "library_authors", name: "author", max: 200,
    columns: { name: "name", reference: "reference" },
  },
  publishers: {
    table: "library_publishers", name: "publisher", max: 200,
    columns: { name: "name", reference: "reference" },
  },
} as const;

for (const [resource, config] of Object.entries(directoryResources)) {
  router.get(`/library/${resource}`, asyncRoute(async (req, res) => {
    const schoolId = schoolIdFrom(req.query.schoolId);
    await requireSchoolViewer(req, schoolId);
    const result = await pool.query(
      `SELECT id,school_id AS "schoolId",name,${resource === "categories" ? "description,is_active AS \"isActive\"" : "reference"},
        created_at AS "createdAt",updated_at AS "updatedAt"
       FROM ${config.table} WHERE school_id=$1 ${resource === "categories" ? "AND is_active=true" : ""}
       ORDER BY lower(name),id`,
      [schoolId],
    );
    res.json(result.rows);
  }));

  router.post(`/library/${resource}`, asyncRoute(async (req, res) => {
    const schoolId = schoolIdFrom(req.body?.schoolId);
    await requireLibraryManager(req, schoolId, true);
    const allowed = resource === "categories"
      ? ["schoolId", "name", "description"] : ["schoolId", "name", "reference"];
    const body = bodyObject(req.body, allowed, ["name"]);
    const name = text(body.name, "name", config.max);
    const extra = resource === "categories"
      ? optionalText(body.description, "description", 1000)
      : optionalText(body.reference, "reference", 500);
    const extraColumn = resource === "categories" ? "description" : "reference";
    const result = await transaction(async client => {
      const inserted = await client.query(
        `INSERT INTO ${config.table} (school_id,name,${extraColumn},created_by_user_id)
         VALUES($1,$2,$3,$4)
         RETURNING id,school_id AS "schoolId",name,${extraColumn},created_at AS "createdAt"`,
        [schoolId, name, extra, getUserContext(req).user.id],
      );
      await writeAudit(client, req, schoolId, `Created library ${config.name}`, `LIBRARY_${config.name.toUpperCase()}_CREATED`,
        Number(inserted.rows[0].id), { name });
      return inserted.rows[0];
    });
    res.status(201).json(result);
  }));

  router.patch(`/library/${resource}/:recordId`, asyncRoute(async (req, res) => {
    const schoolId = schoolIdFrom(req.body?.schoolId);
    const recordId = positiveId(req.params.recordId, "recordId");
    await requireLibraryManager(req, schoolId, true);
    const allowed = resource === "categories"
      ? ["schoolId", "name", "description", "isActive"] : ["schoolId", "name", "reference"];
    const body = bodyObject(req.body, allowed);
    const fields: Record<string, unknown> = {};
    if (body.name !== undefined) fields.name = text(body.name, "name", config.max);
    if (resource === "categories" && body.description !== undefined) {
      fields.description = optionalText(body.description, "description", 1000);
    }
    if (resource !== "categories" && body.reference !== undefined) {
      fields.reference = optionalText(body.reference, "reference", 500);
    }
    if (resource === "categories" && body.isActive !== undefined) {
      if (typeof body.isActive !== "boolean") throw new AuthError(400, "isActive must be a boolean");
      fields.is_active = body.isActive;
    }
    const mapping = { ...config.columns, ...(resource === "categories" ? { is_active: "is_active" } : {}) };
    const update = sqlUpdate(fields, mapping);
    const result = await transaction(async client => {
      const changed = await client.query(
        `UPDATE ${config.table} SET ${update.sql},updated_at=NOW()
          WHERE id=$${update.values.length + 1} AND school_id=$${update.values.length + 2}
          RETURNING id,school_id AS "schoolId",name,created_at AS "createdAt",updated_at AS "updatedAt"`,
        [...update.values, recordId, schoolId],
      );
      if (!changed.rows[0]) throw new AuthError(404, `${config.name} not found`);
      await writeAudit(client, req, schoolId, `Updated library ${config.name}`, `LIBRARY_${config.name.toUpperCase()}_UPDATED`,
        recordId, { fields: Object.keys(fields) });
      return changed.rows[0];
    });
    res.json(result);
  }));
}

router.post("/library/books/:bookId/copies", asyncRoute(async (req, res) => {
  const schoolId = schoolIdFrom(req.body?.schoolId);
  const bookId = positiveId(req.params.bookId, "bookId");
  await requireLibraryManager(req, schoolId, true);
  const body = bodyObject(req.body, ["schoolId", "copyCode", "barcode", "condition", "location", "acquiredOn", "acquisitionReference"], ["copyCode"]);
  const copyCode = text(body.copyCode, "copyCode", 100);
  const barcode = optionalText(body.barcode, "barcode", 100);
  const condition = body.condition ?? "GOOD";
  if (!["NEW", "GOOD", "FAIR", "POOR"].includes(String(condition))) throw new AuthError(400, "condition is invalid");
  const location = optionalText(body.location, "location", 120);
  const acquiredOn = body.acquiredOn == null ? null : dateOnly(body.acquiredOn, "acquiredOn");
  const acquisitionReference = optionalText(body.acquisitionReference, "acquisitionReference", 200);
  const created = await transaction(async client => {
    const book = await client.query(
      "SELECT id FROM library_books WHERE id=$1 AND school_id=$2 AND status='ACTIVE' FOR UPDATE",
      [bookId, schoolId],
    );
    if (!book.rows.length) throw new AuthError(404, "Book not found");
    const copy = await client.query(
      `INSERT INTO library_book_copies
        (school_id,book_id,copy_code,barcode,condition,location,acquired_on,acquisition_reference,created_by_user_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id,school_id AS "schoolId",book_id AS "bookId",copy_code AS "copyCode",barcode,condition,status,
         location,acquired_on AS "acquiredOn",created_at AS "createdAt"`,
      [schoolId, bookId, copyCode, barcode, condition, location, acquiredOn, acquisitionReference, getUserContext(req).user.id],
    );
    await client.query(
      `INSERT INTO library_copy_status_history
        (school_id,copy_id,previous_status,new_status,reason,changed_by_user_id)
       VALUES($1,$2,'NONE','AVAILABLE','Copy registered', $3)`,
      [schoolId, copy.rows[0].id, getUserContext(req).user.id],
    );
    await writeAudit(client, req, schoolId, "Registered library copy", "LIBRARY_COPY_CREATED", Number(copy.rows[0].id), { bookId, copyCode });
    return copy.rows[0];
  });
  res.status(201).json(created);
}));

router.get("/library/books/:bookId/copies", asyncRoute(async (req, res) => {
  const schoolId = schoolIdFrom(req.query.schoolId);
  const bookId = positiveId(req.params.bookId, "bookId");
  await requireSchoolViewer(req, schoolId);
  const copies = await pool.query(
    `SELECT cp.id,cp.school_id AS "schoolId",cp.book_id AS "bookId",cp.copy_code AS "copyCode",cp.barcode,
      cp.condition,cp.status,cp.location,cp.acquired_on AS "acquiredOn",cp.created_at AS "createdAt"
     FROM library_book_copies cp
     JOIN library_books b ON b.id=cp.book_id AND b.school_id=cp.school_id AND b.status='ACTIVE'
     WHERE cp.school_id=$1 AND cp.book_id=$2 ORDER BY cp.copy_code,cp.id`,
    [schoolId, bookId],
  );
  res.json(copies.rows);
}));

router.get("/library/copies/:copyId/history", asyncRoute(async (req, res) => {
  const schoolId = schoolIdFrom(req.query.schoolId);
  const copyId = positiveId(req.params.copyId, "copyId");
  await requireLibraryManager(req, schoolId);
  const result = await pool.query(
    `SELECT h.id,h.copy_id AS "copyId",h.loan_id AS "loanId",h.previous_status AS "previousStatus",
      h.new_status AS "newStatus",h.reason,h.notes,h.changed_by_user_id AS "changedByUserId",h.created_at AS "createdAt"
     FROM library_copy_status_history h
     WHERE h.school_id=$1 AND h.copy_id=$2 ORDER BY h.created_at DESC,h.id DESC`,
    [schoolId, copyId],
  );
  res.json(result.rows);
}));

router.patch("/library/copies/:copyId/status", asyncRoute(async (req, res) => {
  const schoolId = schoolIdFrom(req.body?.schoolId);
  const copyId = positiveId(req.params.copyId, "copyId");
  await requireLibraryManager(req, schoolId);
  const body = bodyObject(req.body, ["schoolId", "status", "reason", "notes"], ["status", "reason"]);
  const status = body.status;
  if (typeof status !== "string" || !copyStatuses.has(status as CopyStatus) || status === "BORROWED" || status === "RESERVED") {
    throw new AuthError(400, "status must be an authorized copy condition/status");
  }
  const reason = text(body.reason, "reason", 500) as string;
  const notes = optionalText(body.notes, "notes", 2000);
  const result = await transaction(async client => {
    const copy = await client.query(
      `SELECT id,status,book_id AS "bookId"
         FROM library_book_copies
        WHERE id=$1 AND school_id=$2 FOR UPDATE`,
      [copyId, schoolId],
    );
    const current = copy.rows[0];
    if (!current) throw new AuthError(404, "Copy not found");
    if (current.status === status) throw new AuthError(409, "Copy already has the requested status");
    const openLoan = await client.query(
      "SELECT id FROM library_loans WHERE school_id=$1 AND copy_id=$2 AND status='OPEN' FOR UPDATE",
      [schoolId, copyId],
    );
    let loanId: number | null = openLoan.rows[0] ? Number(openLoan.rows[0].id) : null;
    if (loanId && status !== "LOST") throw new AuthError(409, "An actively borrowed copy can only be marked lost");
    if (loanId) {
      await client.query(
        "UPDATE library_loans SET status='LOST',updated_at=NOW() WHERE school_id=$1 AND id=$2 AND status='OPEN'",
        [schoolId, loanId],
      );
    }
    await client.query(
      "UPDATE library_book_copies SET status=$1,updated_at=NOW() WHERE school_id=$2 AND id=$3",
      [status, schoolId, copyId],
    );
    await client.query(
      `INSERT INTO library_copy_status_history
        (school_id,copy_id,loan_id,previous_status,new_status,reason,notes,changed_by_user_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [schoolId, copyId, loanId, current.status, status, reason, notes, getUserContext(req).user.id],
    );
    await writeAudit(client, req, schoolId, "Changed library copy status", "LIBRARY_COPY_STATUS_CHANGED", copyId,
      { previousStatus: current.status, status, reason, loanId });
    return { id: copyId, schoolId, bookId: Number(current.bookId), previousStatus: current.status, status };
  });
  res.json(result);
}));

router.get("/library/permissions", asyncRoute(async (req, res) => {
  const schoolId = schoolIdFrom(req.query.schoolId);
  await requireSchoolViewer(req, schoolId);
  res.json({
    canManageLoans: await isLibraryStaff(req, schoolId),
    canManageCatalogue: await isLibraryStaff(req, schoolId, true),
    canAssignStaff: schoolRole(req, schoolId).includes("SCHOOL_ADMIN"),
  });
}));

router.get("/library/staff", asyncRoute(async (req, res) => {
  const schoolId = schoolIdFrom(req.query.schoolId);
  await requireSchoolViewer(req, schoolId);
  const admin = schoolRole(req, schoolId).includes("SCHOOL_ADMIN");
  const result = await pool.query(
    `SELECT ls.id,ls.school_id AS "schoolId",ls.user_id AS "userId",ls.is_active AS "isActive",
            ls.can_manage_catalogue AS "canManageCatalogue",e.id AS "employeeId",
            e.employee_no AS "employeeNo",e.employee_type AS "employeeType",
            concat_ws(' ',e.first_name,e.middle_name,e.last_name) AS name,
            e.employment_status AS "employmentStatus",au.status AS "accountStatus"
       FROM library_staff ls
       JOIN employees e ON e.school_id=ls.school_id AND e.user_id=ls.user_id
       JOIN app_users au ON au.id=ls.user_id
      WHERE ls.school_id=$1 AND ($2::boolean OR ls.user_id=$3)
      ORDER BY e.last_name,e.first_name,e.id`,
    [schoolId, admin, getUserContext(req).user.id],
  );
  res.json(result.rows);
}));

router.post("/library/staff", asyncRoute(async (req, res) => {
  const schoolId = schoolIdFrom(req.body?.schoolId);
  requireAdmin(req, schoolId);
  const body = bodyObject(req.body, ["schoolId", "userId", "canManageCatalogue"], ["userId"]);
  const userId = positiveId(body.userId, "userId");
  if (body.canManageCatalogue !== undefined && typeof body.canManageCatalogue !== "boolean") {
    throw new AuthError(400, "canManageCatalogue must be a boolean");
  }
  const result = await transaction(async client => {
    const eligible = await client.query(
      `SELECT 1 FROM school_memberships sm
         JOIN app_users u ON u.id=sm.user_id AND UPPER(u.status)='ACTIVE'
         JOIN employees e ON e.user_id=sm.user_id AND e.school_id=sm.school_id AND UPPER(e.employment_status)='ACTIVE'
        WHERE sm.school_id=$1 AND sm.user_id=$2 AND sm.status='ACTIVE'
          AND ((sm.role='TEACHER' AND UPPER(e.employee_type)='TEACHER')
            OR (sm.role='STAFF' AND UPPER(e.employee_type)<>'TEACHER')) LIMIT 1`,
      [schoolId, userId],
    );
    if (!eligible.rows.length) throw new AuthError(404, "Active school staff member not found");
    const staff = await client.query(
      `INSERT INTO library_staff(school_id,user_id,can_manage_catalogue,is_active,assigned_by_user_id)
       VALUES($1,$2,$3,true,$4)
       ON CONFLICT(school_id,user_id) DO UPDATE
         SET can_manage_catalogue=EXCLUDED.can_manage_catalogue,is_active=true,assigned_by_user_id=EXCLUDED.assigned_by_user_id,
             updated_at=NOW()
       RETURNING id,school_id AS "schoolId",user_id AS "userId",can_manage_catalogue AS "canManageCatalogue",
         is_active AS "isActive"`,
      [schoolId, userId, body.canManageCatalogue === true, getUserContext(req).user.id],
    );
    await writeAudit(client, req, schoolId, "Assigned library staff", "LIBRARY_STAFF_ASSIGNED", Number(staff.rows[0].id),
      { userId, canManageCatalogue: body.canManageCatalogue === true });
    return staff.rows[0];
  });
  res.status(201).json(result);
}));

router.delete("/library/staff/:userId", asyncRoute(async (req, res) => {
  const schoolId = schoolIdFrom(req.query.schoolId);
  const userId = positiveId(req.params.userId, "userId");
  requireAdmin(req, schoolId);
  const updated = await transaction(async client => {
    const staff = await client.query(
      `UPDATE library_staff SET is_active=false,updated_at=NOW()
        WHERE school_id=$1 AND user_id=$2 AND is_active=true
        RETURNING id`,
      [schoolId, userId],
    );
    if (!staff.rows[0]) throw new AuthError(404, "Library staff member not found");
    await writeAudit(client, req, schoolId, "Revoked library staff access", "LIBRARY_STAFF_REVOKED",
      Number(staff.rows[0].id), { userId });
    return { revoked: true, userId };
  });
  res.json(updated);
}));

const defaultSettings = {
  student_borrowing_enabled: true, teacher_borrowing_enabled: false, staff_borrowing_enabled: false,
  max_books_per_student: 3, max_books_per_teacher: 5, max_books_per_staff: 5,
  student_loan_days: 14, teacher_loan_days: 30, staff_loan_days: 30,
  max_renewals: 1, renewal_requires_not_overdue: true, fines_enabled: false,
};
const settingFields: Record<string, { column: string; type: "boolean" | "integer"; minimum?: number; maximum?: number }> = {
  studentBorrowingEnabled: { column: "student_borrowing_enabled", type: "boolean" },
  teacherBorrowingEnabled: { column: "teacher_borrowing_enabled", type: "boolean" },
  staffBorrowingEnabled: { column: "staff_borrowing_enabled", type: "boolean" },
  maxBooksPerStudent: { column: "max_books_per_student", type: "integer", minimum: 1, maximum: 50 },
  maxBooksPerTeacher: { column: "max_books_per_teacher", type: "integer", minimum: 1, maximum: 50 },
  maxBooksPerStaff: { column: "max_books_per_staff", type: "integer", minimum: 1, maximum: 50 },
  studentLoanDays: { column: "student_loan_days", type: "integer", minimum: 1, maximum: 180 },
  teacherLoanDays: { column: "teacher_loan_days", type: "integer", minimum: 1, maximum: 180 },
  staffLoanDays: { column: "staff_loan_days", type: "integer", minimum: 1, maximum: 180 },
  maxRenewals: { column: "max_renewals", type: "integer", minimum: 0, maximum: 20 },
  renewalRequiresNotOverdue: { column: "renewal_requires_not_overdue", type: "boolean" },
};

router.get("/library/settings", asyncRoute(async (req, res) => {
  const schoolId = schoolIdFrom(req.query.schoolId);
  await requireSchoolViewer(req, schoolId);
  const result = await pool.query("SELECT * FROM library_settings WHERE school_id=$1", [schoolId]);
  const row = result.rows[0] ?? defaultSettings;
  const response: Record<string, unknown> = { schoolId };
  for (const [key, config] of Object.entries(settingFields)) response[key] = row[config.column];
  response.finesEnabled = false;
  res.json(response);
}));

router.patch("/library/settings", asyncRoute(async (req, res) => {
  const schoolId = schoolIdFrom(req.body?.schoolId);
  requireAdmin(req, schoolId);
  const body = bodyObject(req.body, ["schoolId", ...Object.keys(settingFields), "finesEnabled"]);
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === "schoolId") continue;
    if (key === "finesEnabled") {
      if (value !== false) throw new AuthError(400, "Library fines are disabled until Finance integration is implemented");
      continue;
    }
    const config = settingFields[key];
    if (!config) throw new AuthError(400, "Unsupported library setting");
    if (config.type === "boolean") {
      if (typeof value !== "boolean") throw new AuthError(400, `${key} must be a boolean`);
    } else if (!Number.isSafeInteger(value) || (value as number) < config.minimum! || (value as number) > config.maximum!) {
      throw new AuthError(400, `${key} is outside the allowed range`);
    }
    values[config.column] = value;
  }
  if (!Object.keys(values).length) throw new AuthError(400, "At least one setting must be supplied");
  const update = sqlUpdate(values, Object.fromEntries(Object.keys(values).map(key => [key, key])));
  const result = await transaction(async client => {
    await client.query(
      `INSERT INTO library_settings(school_id,updated_by_user_id) VALUES($1,$2) ON CONFLICT(school_id) DO NOTHING`,
      [schoolId, getUserContext(req).user.id],
    );
    const changed = await client.query(
      `UPDATE library_settings SET ${update.sql},updated_by_user_id=$${update.values.length + 1},updated_at=NOW()
        WHERE school_id=$${update.values.length + 2} RETURNING *`,
      [...update.values, getUserContext(req).user.id, schoolId],
    );
    await writeAudit(client, req, schoolId, "Updated library settings", "LIBRARY_SETTINGS_UPDATED", null,
      { fields: Object.keys(values) });
    return changed.rows[0];
  });
  const response: Record<string, unknown> = { schoolId };
  for (const [key, config] of Object.entries(settingFields)) response[key] = result[config.column];
  response.finesEnabled = false;
  res.json(response);
}));

async function hasActiveBorrowerEntitlement(
  client: LibraryQuery,
  schoolId: number,
  borrowerType: BorrowerType,
  borrowerUserId: number,
  borrowerStudentId: number | null,
): Promise<boolean> {
  if (borrowerType === "STUDENT") {
    const student = await client.query(
      `SELECT 1
         FROM students s
         JOIN app_users u ON u.id=s.user_id AND UPPER(u.status)='ACTIVE'
        WHERE s.school_id=$1 AND s.id=$2 AND s.user_id=$3 AND UPPER(s.status)='ACTIVE'
        LIMIT 1 FOR SHARE OF s,u`,
      [schoolId, borrowerStudentId, borrowerUserId],
    );
    return student.rows.length > 0;
  }
  const staff = await client.query(
    `SELECT 1
       FROM school_memberships sm
       JOIN app_users u ON u.id=sm.user_id AND UPPER(u.status)='ACTIVE'
       JOIN employees e ON e.school_id=sm.school_id AND e.user_id=sm.user_id
         AND UPPER(e.employment_status)='ACTIVE'
      WHERE sm.school_id=$1 AND sm.user_id=$2 AND sm.status='ACTIVE' AND sm.role=$3
        AND (($3='TEACHER' AND UPPER(e.employee_type)='TEACHER')
          OR ($3='STAFF' AND UPPER(e.employee_type)<>'TEACHER'))
      LIMIT 1 FOR SHARE OF sm,u,e`,
    [schoolId, borrowerUserId, borrowerType],
  );
  return staff.rows.length > 0;
}

const loanProjection = `l.id,l.school_id AS "schoolId",l.book_id AS "bookId",b.title AS "bookTitle",
  l.copy_id AS "copyId",cp.copy_code AS "copyCode",l.borrower_type AS "borrowerType",
  l.borrower_user_id AS "borrowerUserId",l.borrower_student_id AS "borrowerStudentId",
  l.issued_at AS "issuedAt",l.due_on AS "dueOn",l.returned_at AS "returnedAt",
  l.returned_overdue AS "returnedOverdue",l.days_overdue_at_return AS "daysOverdueAtReturn",l.status,
  l.issued_by_user_id AS "issuedByUserId",l.returned_by_user_id AS "returnedByUserId",
  l.renewal_count AS "renewalCount",l.notes,
  CASE WHEN l.status='OPEN' AND l.due_on<CURRENT_DATE THEN true ELSE false END AS overdue,
  CASE WHEN l.status='OPEN' AND l.due_on<CURRENT_DATE THEN CURRENT_DATE-l.due_on ELSE 0 END::int AS "daysOverdue"`;

router.get("/library/loans", asyncRoute(async (req, res) => {
  const schoolId = schoolIdFrom(req.query.schoolId);
  await requireSchoolViewer(req, schoolId);
  const context = getUserContext(req);
  const manager = await isLibraryStaff(req, schoolId);
  let rows;
  if (manager) {
    const result = await pool.query(
      `SELECT ${loanProjection}
         FROM library_loans l
         JOIN library_books b ON b.id=l.book_id AND b.school_id=l.school_id
         JOIN library_book_copies cp ON cp.id=l.copy_id AND cp.school_id=l.school_id
        WHERE l.school_id=$1 AND ($2::text IS NULL OR l.status=$2)
        ORDER BY l.issued_at DESC,l.id DESC LIMIT $3`,
      [schoolId, req.query.status ?? null, pageSize(req.query.limit)],
    );
    rows = result.rows;
  } else {
    const result = await pool.query(
      `SELECT ${loanProjection}
         FROM library_loans l
         JOIN library_books b ON b.id=l.book_id AND b.school_id=l.school_id
         JOIN library_book_copies cp ON cp.id=l.copy_id AND cp.school_id=l.school_id
        WHERE l.school_id=$1 AND (
          l.borrower_user_id=$2 OR
          (l.borrower_student_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM parents p
            JOIN parent_student_relationships psr ON psr.parent_id=p.id AND UPPER(psr.status)='ACTIVE'
            WHERE p.user_id=$2 AND p.school_id=$1 AND UPPER(p.status)='ACTIVE' AND psr.student_id=l.borrower_student_id
          ))
        )
        ORDER BY l.issued_at DESC,l.id DESC LIMIT $3`,
      [schoolId, context.user.id, pageSize(req.query.limit)],
    );
    rows = result.rows;
  }
  res.json(rows);
}));

router.post("/library/loans", asyncRoute(async (req, res) => {
  const schoolId = schoolIdFrom(req.body?.schoolId);
  const body = bodyObject(req.body, ["schoolId", "copyId", "borrowerType", "borrowerUserId", "borrowerStudentId",
    "dueOn", "notes", "idempotencyKey"], ["copyId", "borrowerType", "borrowerUserId", "idempotencyKey"]);
  const copyId = positiveId(body.copyId, "copyId");
  const borrowerType = body.borrowerType;
  if (borrowerType !== "STUDENT" && borrowerType !== "TEACHER" && borrowerType !== "STAFF") {
    throw new AuthError(400, "borrowerType is invalid");
  }
  const borrowerUserId = positiveId(body.borrowerUserId, "borrowerUserId");
  const borrowerStudentId = body.borrowerStudentId == null ? null : positiveId(body.borrowerStudentId, "borrowerStudentId");
  if ((borrowerType === "STUDENT") !== (borrowerStudentId !== null)) {
    throw new AuthError(400, "Student loans require borrowerStudentId; staff loans must not include it");
  }
  const key = idempotencyKey(body.idempotencyKey);
  const notes = optionalText(body.notes, "notes", 2000);
  const context = getUserContext(req);
  const selfBorrow = borrowerUserId === context.user.id;
  if (isPlatformOwner(req)) throw new AuthError(404, "Resource not found", "CROSS_TENANT_ACCESS_ATTEMPT");
  let manager = false;
  if (!selfBorrow) {
    await requireLibraryManager(req, schoolId);
    manager = true;
  } else {
    const roles = schoolRole(req, schoolId);
    if (!roles.includes(borrowerType as Role)) {
      const identity = borrowerType === "STUDENT"
        ? await pool.query(
          `SELECT 1 FROM students WHERE school_id=$1 AND id=$2 AND user_id=$3 AND UPPER(status)='ACTIVE'`,
          [schoolId, borrowerStudentId, borrowerUserId],
        )
        : { rows: [] };
      if (!identity.rows.length) throw new AuthError(404, "Borrower not found in this school");
    } else {
      assertSchoolOperationalAccess(req, schoolId, [borrowerType as Role]);
    }
  }
  const inserted = await transaction(async client => {
    await client.query("SELECT pg_advisory_xact_lock($1::int,$2::int)", [schoolId, borrowerUserId]);
    const existing = await client.query(
      `SELECT ${loanProjection}
         FROM library_loans l
         JOIN library_books b ON b.id=l.book_id AND b.school_id=l.school_id
         JOIN library_book_copies cp ON cp.id=l.copy_id AND cp.school_id=l.school_id
        WHERE l.school_id=$1 AND l.idempotency_key=$2`,
      [schoolId, key],
    );
    if (existing.rows[0]) {
      if (Number(existing.rows[0].copyId) !== copyId || Number(existing.rows[0].borrowerUserId) !== borrowerUserId) {
        throw new AuthError(409, "idempotencyKey was already used for a different loan");
      }
      return existing.rows[0];
    }
    const settingsResult = await client.query("SELECT * FROM library_settings WHERE school_id=$1", [schoolId]);
    const settings = settingsResult.rows[0] ?? defaultSettings;
    const enabledKey = borrowerType === "STUDENT" ? "student_borrowing_enabled"
      : borrowerType === "TEACHER" ? "teacher_borrowing_enabled" : "staff_borrowing_enabled";
    if (!settings[enabledKey]) throw new AuthError(403, `Borrowing for ${borrowerType.toLowerCase()} is disabled by this school`);
    let limit: number;
    let loanDays: number;
    if (borrowerType === "STUDENT") {
      limit = Number(settings.max_books_per_student);
      loanDays = Number(settings.student_loan_days);
      const identity = await client.query(
        `SELECT 1 FROM students s
          JOIN app_users u ON u.id=s.user_id AND UPPER(u.status)='ACTIVE'
         WHERE s.school_id=$1 AND s.id=$2 AND s.user_id=$3 AND UPPER(s.status)='ACTIVE'`,
        [schoolId, borrowerStudentId, borrowerUserId],
      );
      if (!identity.rows.length) throw new AuthError(404, "Student borrower not found in this school");
    } else {
      limit = Number(borrowerType === "TEACHER" ? settings.max_books_per_teacher : settings.max_books_per_staff);
      loanDays = Number(borrowerType === "TEACHER" ? settings.teacher_loan_days : settings.staff_loan_days);
      const identity = await client.query(
        `SELECT 1 FROM school_memberships sm
           JOIN app_users u ON u.id=sm.user_id AND UPPER(u.status)='ACTIVE'
           JOIN employees e ON e.school_id=sm.school_id AND e.user_id=sm.user_id AND UPPER(e.employment_status)='ACTIVE'
          WHERE sm.school_id=$1 AND sm.user_id=$2 AND sm.status='ACTIVE'
            AND sm.role=$3
            AND (($3='TEACHER' AND UPPER(e.employee_type)='TEACHER')
              OR ($3='STAFF' AND UPPER(e.employee_type)<>'TEACHER')) LIMIT 1`,
        [schoolId, borrowerUserId, borrowerType],
      );
      if (!identity.rows.length) throw new AuthError(404, "Staff borrower not found in this school");
    }
    if (selfBorrow && !manager && borrowerUserId !== context.user.id) throw new AuthError(403, "Borrower is not authorized");
    const count = await client.query(
      "SELECT count(*)::int AS count FROM library_loans WHERE school_id=$1 AND borrower_user_id=$2 AND status='OPEN'",
      [schoolId, borrowerUserId],
    );
    if (Number(count.rows[0]?.count ?? 0) >= limit) throw new AuthError(409, "Borrower has reached the school's active-loan limit");
    const copy = await client.query(
      `SELECT cp.id,cp.book_id AS "bookId",cp.status,b.status AS "bookStatus"
         FROM library_book_copies cp JOIN library_books b ON b.id=cp.book_id AND b.school_id=cp.school_id
        WHERE cp.school_id=$1 AND cp.id=$2 FOR UPDATE OF cp`,
      [schoolId, copyId],
    );
    if (!copy.rows[0] || copy.rows[0].bookStatus !== "ACTIVE") throw new AuthError(404, "Available copy not found");
    if (copy.rows[0].status !== "AVAILABLE") throw new AuthError(409, "Copy is not currently available");
    const dueOn = body.dueOn == null
      ? null
      : dateOnly(body.dueOn, "dueOn");
    if (dueOn !== null) {
      const permittedDate = await client.query(
        "SELECT $1::date>=CURRENT_DATE AS not_past,$1::date<=CURRENT_DATE+$2::int AS within_policy",
        [dueOn, loanDays],
      );
      if (!permittedDate.rows[0]?.not_past || !permittedDate.rows[0]?.within_policy) {
        throw new AuthError(400, "dueOn must fall within the configured loan period for this borrower");
      }
    }
    const loan = await client.query(
      `INSERT INTO library_loans
        (school_id,book_id,copy_id,borrower_type,borrower_user_id,borrower_student_id,due_on,
         issued_by_user_id,idempotency_key,notes)
       VALUES($1,$2,$3,$4,$5,$6,COALESCE($7::date,CURRENT_DATE+$8),$9,$10,$11)
       RETURNING id,school_id AS "schoolId",book_id AS "bookId",copy_id AS "copyId",borrower_type AS "borrowerType",
         borrower_user_id AS "borrowerUserId",borrower_student_id AS "borrowerStudentId",
         issued_at AS "issuedAt",due_on AS "dueOn",status,issued_by_user_id AS "issuedByUserId",
         renewal_count AS "renewalCount",notes`,
      [schoolId, copy.rows[0].bookId, copyId, borrowerType, borrowerUserId, borrowerStudentId, dueOn, loanDays,
        context.user.id, key, notes],
    );
    await client.query(
      "UPDATE library_book_copies SET status='BORROWED',updated_at=NOW() WHERE school_id=$1 AND id=$2 AND status='AVAILABLE'",
      [schoolId, copyId],
    );
    await client.query(
      `INSERT INTO library_copy_status_history(school_id,copy_id,loan_id,previous_status,new_status,reason,changed_by_user_id)
       VALUES($1,$2,$3,'AVAILABLE','BORROWED','Book issued',$4)`,
      [schoolId, copyId, loan.rows[0].id, context.user.id],
    );
    await writeAudit(client, req, schoolId, "Issued library book", "LIBRARY_BOOK_ISSUED", Number(loan.rows[0].id),
      { borrowerType, borrowerUserId, borrowerStudentId, copyId, dueOn: loan.rows[0].dueOn });
    return loan.rows[0];
  });
  res.status(201).json(inserted);
}));

router.post("/library/loans/:loanId/return", asyncRoute(async (req, res) => {
  const schoolId = schoolIdFrom(req.body?.schoolId);
  const loanId = positiveId(req.params.loanId, "loanId");
  const body = bodyObject(req.body, ["schoolId", "copyStatus", "reason", "notes"]);
  const requestedStatus = body.copyStatus ?? "AVAILABLE";
  if (requestedStatus !== "AVAILABLE" && requestedStatus !== "DAMAGED") {
    throw new AuthError(400, "copyStatus must be AVAILABLE or DAMAGED");
  }
  const reason = requestedStatus === "DAMAGED" ? text(body.reason, "reason", 500) as string : "Book returned";
  const notes = optionalText(body.notes, "notes", 2000);
  const context = getUserContext(req);
  const result = await transaction(async client => {
    const loanReference = await client.query(
      "SELECT copy_id AS \"copyId\" FROM library_loans WHERE id=$1 AND school_id=$2",
      [loanId, schoolId],
    );
    if (!loanReference.rows[0]) throw new AuthError(404, "Loan not found");
    const copy = await client.query(
      "SELECT status FROM library_book_copies WHERE id=$1 AND school_id=$2 FOR UPDATE",
      [loanReference.rows[0].copyId, schoolId],
    );
    const loan = await client.query(
      `SELECT id,copy_id AS "copyId",borrower_user_id AS "borrowerUserId",
         borrower_type AS "borrowerType",borrower_student_id AS "borrowerStudentId",status
         FROM library_loans WHERE id=$1 AND school_id=$2 AND copy_id=$3 FOR UPDATE`,
      [loanId, schoolId, loanReference.rows[0].copyId],
    );
    const row = loan.rows[0];
    if (!row) throw new AuthError(404, "Loan not found");
    const isOwner = Number(row.borrowerUserId) === context.user.id;
    if (isOwner && !(await hasActiveBorrowerEntitlement(
      client,
      schoolId,
      row.borrowerType as BorrowerType,
      Number(row.borrowerUserId),
      row.borrowerStudentId == null ? null : Number(row.borrowerStudentId),
    ))) {
      throw new AuthError(404, "Loan not found");
    }
    const manager = await isLibraryStaff(req, schoolId);
    if (!isOwner && !manager) throw new AuthError(404, "Loan not found");
    if (row.status !== "OPEN") throw new AuthError(409, "Loan is no longer active");
    if (!copy.rows[0] || copy.rows[0].status !== "BORROWED") throw new AuthError(409, "Loan copy is not in borrowed status");
    await client.query(
      `UPDATE library_loans
          SET status='RETURNED',returned_at=NOW(),returned_by_user_id=$1,
              returned_overdue=(due_on<CURRENT_DATE),
              days_overdue_at_return=GREATEST(CURRENT_DATE-due_on,0),
              notes=COALESCE($2,notes),updated_at=NOW()
        WHERE id=$3 AND school_id=$4 AND status='OPEN'`,
      [context.user.id, notes, loanId, schoolId],
    );
    await client.query(
      "UPDATE library_book_copies SET status=$1,updated_at=NOW() WHERE id=$2 AND school_id=$3",
      [requestedStatus, row.copyId, schoolId],
    );
    await client.query(
      `INSERT INTO library_copy_status_history(school_id,copy_id,loan_id,previous_status,new_status,reason,notes,changed_by_user_id)
       VALUES($1,$2,$3,'BORROWED',$4,$5,$6,$7)`,
      [schoolId, row.copyId, loanId, requestedStatus, reason, notes, context.user.id],
    );
    await writeAudit(client, req, schoolId, "Returned library book", "LIBRARY_BOOK_RETURNED", loanId,
      { copyId: Number(row.copyId), copyStatus: requestedStatus });
    const returned = await client.query(
      `SELECT id,school_id AS "schoolId",copy_id AS "copyId",status,returned_at AS "returnedAt",
        returned_by_user_id AS "returnedByUserId",returned_overdue AS "returnedOverdue",
        days_overdue_at_return AS "daysOverdueAtReturn"
       FROM library_loans WHERE id=$1 AND school_id=$2`,
      [loanId, schoolId],
    );
    return returned.rows[0];
  });
  res.json(result);
}));

router.post("/library/loans/:loanId/renew", asyncRoute(async (req, res) => {
  const schoolId = schoolIdFrom(req.body?.schoolId);
  const loanId = positiveId(req.params.loanId, "loanId");
  const body = bodyObject(req.body, ["schoolId", "idempotencyKey"], ["idempotencyKey"]);
  const key = idempotencyKey(body.idempotencyKey);
  const context = getUserContext(req);
  const result = await transaction(async client => {
    const loanReference = await client.query(
      "SELECT copy_id AS \"copyId\" FROM library_loans WHERE id=$1 AND school_id=$2",
      [loanId, schoolId],
    );
    if (!loanReference.rows[0]) throw new AuthError(404, "Loan not found");
    const copy = await client.query(
      "SELECT status FROM library_book_copies WHERE id=$1 AND school_id=$2 FOR UPDATE",
      [loanReference.rows[0].copyId, schoolId],
    );
    const loan = await client.query(
      `SELECT id,borrower_user_id AS "borrowerUserId",borrower_type AS "borrowerType",
        borrower_student_id AS "borrowerStudentId",due_on AS "dueOn",status,
        renewal_count AS "renewalCount",copy_id AS "copyId"
       FROM library_loans
       WHERE id=$1 AND school_id=$2 AND copy_id=$3 FOR UPDATE`,
      [loanId, schoolId, loanReference.rows[0].copyId],
    );
    const row = loan.rows[0];
    if (!row) throw new AuthError(404, "Loan not found");
    const isOwner = Number(row.borrowerUserId) === context.user.id;
    if (isOwner && !(await hasActiveBorrowerEntitlement(
      client,
      schoolId,
      row.borrowerType as BorrowerType,
      Number(row.borrowerUserId),
      row.borrowerStudentId == null ? null : Number(row.borrowerStudentId),
    ))) {
      throw new AuthError(404, "Loan not found");
    }
    const manager = await isLibraryStaff(req, schoolId);
    if (!isOwner && !manager) throw new AuthError(404, "Loan not found");
    const prior = await client.query(
      `SELECT id,loan_id AS "loanId",previous_due_on AS "previousDueOn",new_due_on AS "newDueOn",created_at AS "createdAt"
       FROM library_renewals WHERE school_id=$1 AND loan_id=$2 AND idempotency_key=$3`,
      [schoolId, loanId, key],
    );
    if (prior.rows[0]) {
      return prior.rows[0];
    }
    if (row.status !== "OPEN") throw new AuthError(409, "Only an active loan can be renewed");
    if (!copy.rows[0] || copy.rows[0].status !== "BORROWED") {
      throw new AuthError(409, "Loan copy is not currently borrowed");
    }
    const settingsResult = await client.query("SELECT * FROM library_settings WHERE school_id=$1", [schoolId]);
    const settings = settingsResult.rows[0] ?? defaultSettings;
    const maxRenewals = Number(settings.max_renewals);
    if (Number(row.renewalCount) >= maxRenewals) throw new AuthError(409, "The renewal limit has been reached");
    if (settings.renewal_requires_not_overdue) {
      const overdue = await client.query("SELECT $1::date<CURRENT_DATE AS overdue", [row.dueOn]);
      if (overdue.rows[0]?.overdue) throw new AuthError(409, "Overdue loans cannot be renewed under this school's rules");
    }
    const type = row.borrowerType as BorrowerType;
    const extension = type === "TEACHER" ? Number(settings.teacher_loan_days)
      : type === "STAFF" ? Number(settings.staff_loan_days) : Number(settings.student_loan_days);
    const updated = await client.query(
      `UPDATE library_loans SET due_on=due_on+$1,renewal_count=renewal_count+1,updated_at=NOW()
        WHERE id=$2 AND school_id=$3 AND status='OPEN'
        RETURNING due_on AS "newDueOn",renewal_count AS "renewalCount"`,
      [extension, loanId, schoolId],
    );
    const renewal = await client.query(
      `INSERT INTO library_renewals(school_id,loan_id,renewed_by_user_id,previous_due_on,new_due_on,idempotency_key)
       VALUES($1,$2,$3,$4,$5,$6)
       RETURNING id,loan_id AS "loanId",previous_due_on AS "previousDueOn",new_due_on AS "newDueOn",created_at AS "createdAt"`,
      [schoolId, loanId, context.user.id, row.dueOn, updated.rows[0].newDueOn, key],
    );
    await writeAudit(client, req, schoolId, "Renewed library book", "LIBRARY_BOOK_RENEWED", loanId,
      { previousDueOn: row.dueOn, newDueOn: updated.rows[0].newDueOn });
    return renewal.rows[0];
  });
  res.json(result);
}));

router.get("/library/overdue", asyncRoute(async (req, res) => {
  const schoolId = schoolIdFrom(req.query.schoolId);
  await requireLibraryManager(req, schoolId);
  const result = await pool.query(
    `SELECT ${loanProjection},u.first_name AS "borrowerFirstName",u.last_name AS "borrowerLastName",
      s.first_name AS "studentFirstName",s.last_name AS "studentLastName"
       FROM library_loans l
       JOIN library_books b ON b.id=l.book_id AND b.school_id=l.school_id
       JOIN library_book_copies cp ON cp.id=l.copy_id AND cp.school_id=l.school_id
       JOIN app_users u ON u.id=l.borrower_user_id
       LEFT JOIN students s ON s.id=l.borrower_student_id AND s.school_id=l.school_id
      WHERE l.school_id=$1 AND l.status='OPEN' AND l.due_on<CURRENT_DATE
      ORDER BY l.due_on,l.id LIMIT $2`,
    [schoolId, pageSize(req.query.limit)],
  );
  res.json(result.rows);
}));

router.post("/library/overdue/notifications", asyncRoute(async (req, res) => {
  const schoolId = schoolIdFrom(req.body?.schoolId);
  await requireLibraryManager(req, schoolId);
  const client = await pool.connect();
  let queued = 0;
  let overdueLoansProcessed = 0;
  try {
    await client.query("BEGIN");
    let cursorDueOn: string | null = null;
    let cursorLoanId = 0;
    const batchSize = 500;
    while (true) {
      const pageResult: { rows: OverdueNotificationLoan[] } = await client.query<OverdueNotificationLoan>(
        `SELECT l.id,l.borrower_user_id AS "borrowerUserId",l.borrower_student_id AS "studentId",
          b.title,l.due_on AS "dueOn",CURRENT_DATE-l.due_on AS "daysOverdue"
         FROM library_loans l JOIN library_books b ON b.id=l.book_id AND b.school_id=l.school_id
         WHERE l.school_id=$1 AND l.status='OPEN' AND l.due_on<CURRENT_DATE
           AND (
             NOT EXISTS (
               SELECT 1 FROM communication_notifications n
                WHERE n.school_id=l.school_id AND n.recipient_user_id=l.borrower_user_id
                  AND n.event_key='library-overdue:'||l.id::text||':'||l.due_on::text||':'||l.borrower_user_id::text
             )
             OR EXISTS (
               SELECT 1
                 FROM parents p
                 JOIN parent_student_relationships psr ON psr.parent_id=p.id AND UPPER(psr.status)='ACTIVE'
                 JOIN students child ON child.id=psr.student_id AND child.school_id=p.school_id
                   AND UPPER(child.status)='ACTIVE'
                WHERE l.borrower_student_id IS NOT NULL AND child.id=l.borrower_student_id
                  AND p.school_id=l.school_id AND p.user_id IS NOT NULL AND UPPER(p.status)='ACTIVE'
                  AND NOT EXISTS (
                    SELECT 1 FROM communication_notifications pn
                     WHERE pn.school_id=l.school_id AND pn.recipient_user_id=p.user_id
                        AND pn.event_key='library-overdue:'||l.id::text||':'||l.due_on::text||':'||p.user_id::text
                  )
             )
           )
           AND ($2::date IS NULL OR (l.due_on,l.id)>($2::date,$3::integer))
         ORDER BY l.due_on,l.id LIMIT $4`,
        [schoolId, cursorDueOn, cursorLoanId, batchSize],
      );
      if (!pageResult.rows.length) break;
      overdueLoansProcessed += pageResult.rows.length;
      const lastLoan = pageResult.rows[pageResult.rows.length - 1];
      cursorDueOn = lastLoan.dueOn instanceof Date
        ? lastLoan.dueOn.toISOString().slice(0, 10)
        : String(lastLoan.dueOn).slice(0, 10);
      cursorLoanId = Number(lastLoan.id);

      for (const loan of pageResult.rows) {
        const targets = new Set<number>([Number(loan.borrowerUserId)]);
        if (loan.studentId != null) {
          const parents = await client.query(
            `SELECT p.user_id AS "userId"
               FROM parents p JOIN parent_student_relationships psr ON psr.parent_id=p.id AND UPPER(psr.status)='ACTIVE'
               JOIN students s ON s.id=psr.student_id AND s.school_id=p.school_id AND UPPER(s.status)='ACTIVE'
              WHERE p.school_id=$1 AND s.id=$2 AND p.user_id IS NOT NULL AND UPPER(p.status)='ACTIVE'
              ORDER BY p.user_id`,
            [schoolId, loan.studentId],
          );
          for (const parent of parents.rows) targets.add(Number(parent.userId));
        }
        for (const recipientUserId of targets) {
          const dueOn = loan.dueOn instanceof Date
            ? loan.dueOn.toISOString().slice(0, 10)
            : String(loan.dueOn).slice(0, 10);
          const eventKey = `library-overdue:${loan.id}:${dueOn}:${recipientUserId}`;
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [eventKey]);
          const existing = await client.query(
            `SELECT 1 FROM communication_notifications
              WHERE school_id=$1 AND recipient_user_id=$2 AND event_key=$3 LIMIT 1`,
            [schoolId, recipientUserId, eventKey],
          );
          if (existing.rows.length) continue;
          const isParent = loan.studentId != null && recipientUserId !== Number(loan.borrowerUserId);
          const link = isParent
            ? `/parent/library/${Number(loan.studentId)}`
            : "/library/loans";
          const notificationId = await queueCommunicationNotification(client, {
            recipientUserId,
            schoolId,
            subjectStudentId: loan.studentId == null ? null : Number(loan.studentId),
            category: "SYSTEM",
            eventKey,
            subject: "Overdue library book",
            body: `${loan.title} was due on ${loan.dueOn}. It is ${loan.daysOverdue} day(s) overdue. Please contact the school library.`,
            link,
            channels: ["IN_APP", "SMS", "EMAIL"],
          });
          if (notificationId !== null) queued += 1;
        }
      }
      if (pageResult.rows.length < batchSize) break;
    }
    await writeAudit(client, req, schoolId, "Queued overdue library notifications", "LIBRARY_OVERDUE_NOTIFICATIONS_QUEUED",
      null, { overdueLoans: overdueLoansProcessed, notificationsQueued: queued });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  res.json({ schoolId, notificationsQueued: queued });
}));

router.get("/library/reports", asyncRoute(async (req, res) => {
  const schoolId = schoolIdFrom(req.query.schoolId);
  await requireLibraryManager(req, schoolId);
  const [catalogue, loans, mostBorrowed, overdueBorrowers] = await Promise.all([
    pool.query(
      `SELECT COUNT(DISTINCT b.id)::int AS "catalogueTitles",COUNT(cp.id)::int AS "totalCopies",
        COUNT(cp.id) FILTER (WHERE cp.status='AVAILABLE')::int AS "availableCopies",
        COUNT(cp.id) FILTER (WHERE cp.status='BORROWED')::int AS "borrowedCopies",
        COUNT(cp.id) FILTER (WHERE cp.status='LOST')::int AS "lostCopies",
        COUNT(cp.id) FILTER (WHERE cp.status='DAMAGED')::int AS "damagedCopies"
       FROM library_books b LEFT JOIN library_book_copies cp ON cp.book_id=b.id AND cp.school_id=b.school_id
       WHERE b.school_id=$1 AND b.status='ACTIVE'`,
      [schoolId],
    ),
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE status='OPEN')::int AS "activeLoans",
        COUNT(*) FILTER (WHERE status='OPEN' AND due_on<CURRENT_DATE)::int AS "overdueLoans",
        COUNT(*) FILTER (WHERE status='RETURNED')::int AS "returnedLoans",
        COUNT(*) FILTER (WHERE status='LOST')::int AS "lostLoans"
       FROM library_loans WHERE school_id=$1`,
      [schoolId],
    ),
    pool.query(
      `SELECT b.id AS "bookId",b.title,COUNT(l.id)::int AS "timesBorrowed"
       FROM library_loans l JOIN library_books b ON b.id=l.book_id AND b.school_id=l.school_id
       WHERE l.school_id=$1 GROUP BY b.id,b.title ORDER BY COUNT(l.id) DESC,lower(b.title) LIMIT 10`,
      [schoolId],
    ),
    pool.query(
      `SELECT l.borrower_user_id AS "borrowerUserId",l.borrower_student_id AS "borrowerStudentId",
        COUNT(*)::int AS "overdueCount",MIN(l.due_on) AS "oldestDueOn"
       FROM library_loans l WHERE l.school_id=$1 AND l.status='OPEN' AND l.due_on<CURRENT_DATE
       GROUP BY l.borrower_user_id,l.borrower_student_id ORDER BY COUNT(*) DESC LIMIT 50`,
      [schoolId],
    ),
  ]);
  res.json({
    schoolId,
    catalogue: catalogue.rows[0],
    loans: loans.rows[0],
    mostBorrowedBooks: mostBorrowed.rows,
    borrowersWithOverdueItems: overdueBorrowers.rows,
    generatedAt: new Date().toISOString(),
  });
}));

export default router;