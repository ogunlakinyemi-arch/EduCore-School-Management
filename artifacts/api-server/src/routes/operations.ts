import { Router, type IRouter, type NextFunction, type Request } from "express";
import { pool } from "@workspace/db";
import {
  assertSchoolOperationalAccess,
  AuthError,
  getUserContext,
  handleAuthError,
  requireAuthentication,
} from "../middlewares/auth";

type QueryResult = { rows: Array<Record<string, any>>; rowCount?: number | null };
type Queryable = { query(sql: string, values?: unknown[]): Promise<QueryResult> };
type TransactionClient = Queryable & { release(): void };

const router: IRouter = Router();
router.use(requireAuthentication());

const priorities = new Set(["LOW", "MEDIUM", "HIGH", "URGENT"]);
const assetStatuses = new Set(["ACTIVE", "AVAILABLE", "ASSIGNED", "MAINTENANCE", "DAMAGED", "LOST", "RETIRED"]);
const conditions = new Set(["NEW", "GOOD", "FAIR", "POOR", "DAMAGED"]);
const workStatuses = new Set(["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"]);
const facilityStatuses = new Set(["ACTIVE", "INACTIVE", "MAINTENANCE", "RETIRED"]);
const categoryTypes = new Set(["ASSET", "MAINTENANCE", "TASK"]);
const legalWorkTransitions: Record<string, ReadonlySet<string>> = {
  OPEN: new Set(["ASSIGNED", "CANCELLED"]),
  ASSIGNED: new Set(["OPEN", "IN_PROGRESS", "CANCELLED"]),
  IN_PROGRESS: new Set(["ASSIGNED", "ON_HOLD", "COMPLETED", "CANCELLED"]),
  ON_HOLD: new Set(["ASSIGNED", "IN_PROGRESS", "CANCELLED"]),
  COMPLETED: new Set(["IN_PROGRESS"]),
  CANCELLED: new Set(),
};
const staffWorkTransitions: Record<string, ReadonlySet<string>> = {
  ASSIGNED: new Set(["IN_PROGRESS"]),
  IN_PROGRESS: new Set(["ON_HOLD", "COMPLETED"]),
  ON_HOLD: new Set(["IN_PROGRESS"]),
};

const asyncRoute =
  (handler: (req: Request, res: any) => Promise<void>) =>
    (req: Request, res: any, next: NextFunction) =>
      handler(req, res).catch((error: unknown) => {
        if (error instanceof AuthError) {
          handleAuthError(error, req, res, next);
          return;
        }
        const code = (error as { code?: string } | null)?.code;
        if (code === "23505") {
          res.status(409).json({ error: "A school operation record with those unique values already exists." });
          return;
        }
        if (code === "23503" || code === "23514" || code === "22P02" || code === "22007") {
          res.status(400).json({ error: "A referenced record or field value is invalid for this school." });
          return;
        }
        next(error);
      });

function parseSchoolId(value: unknown): number {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new AuthError(400, "schoolId must be a positive integer");
  }
  const schoolId = Number(value);
  if (!Number.isSafeInteger(schoolId)) throw new AuthError(400, "schoolId must be a positive integer");
  return schoolId;
}

function parseRecordId(value: unknown, label: string): number {
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new AuthError(404, `${label} not found`);
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id)) throw new AuthError(404, `${label} not found`);
  return id;
}

function schoolFor(req: Request, roles: Array<"SCHOOL_ADMIN" | "STAFF"> = ["SCHOOL_ADMIN"]) {
  const schoolId = parseSchoolId(req.query.schoolId);
  const context = assertSchoolOperationalAccess(req, schoolId, roles);
  return { schoolId, context };
}

function isSchoolAdmin(context: ReturnType<typeof getUserContext>, schoolId: number): boolean {
  return context.roles.some((assignment) =>
    assignment.status === "ACTIVE" && assignment.schoolId === schoolId && assignment.role === "SCHOOL_ADMIN",
  );
}

function assertWorkTransition(from: string, to: string, staffOnly: boolean): void {
  if (from === to) return;
  const allowed = (staffOnly ? staffWorkTransitions : legalWorkTransitions)[from];
  if (!allowed?.has(to)) {
    throw new AuthError(409, `Illegal work status transition from ${from} to ${to}`);
  }
}

function bodyObject(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuthError(400, "Request body must be an object");
  }
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new AuthError(400, "Request body contains unsupported fields");
  }
  return body;
}

function requiredText(body: Record<string, unknown>, key: string, maxLength = 500): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxLength) {
    throw new AuthError(400, `${key} must contain 1 to ${maxLength} characters`);
  }
  return value.trim();
}

function optionalText(body: Record<string, unknown>, key: string, maxLength = 2000): string | null | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string" || value.length > maxLength) {
    throw new AuthError(400, `${key} must be a string no longer than ${maxLength} characters`);
  }
  return value.trim();
}

function optionalId(body: Record<string, unknown>, key: string): number | null | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw new AuthError(400, `${key} must be a positive integer or null`);
  }
  return value;
}

function optionalDate(body: Record<string, unknown>, key: string): string | null | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new AuthError(400, `${key} must be a calendar date in YYYY-MM-DD format or null`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new AuthError(400, `${key} must be a valid calendar date`);
  }
  return value;
}

function optionalEnum(
  body: Record<string, unknown>,
  key: string,
  allowed: ReadonlySet<string>,
): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.has(value)) {
    throw new AuthError(400, `${key} contains an unsupported value`);
  }
  return value;
}

function optionalInteger(body: Record<string, unknown>, key: string, min: number, max: number): number | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new AuthError(400, `${key} must be an integer from ${min} to ${max}`);
  }
  return value;
}

async function inTransaction<T>(operation: (client: TransactionClient) => Promise<T>): Promise<T> {
  const client = await pool.connect() as TransactionClient;
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original operation failure.
    }
    throw error;
  } finally {
    client.release();
  }
}

async function audit(
  client: Queryable,
  req: Request,
  schoolId: number,
  recordId: number,
  action: string,
  eventType: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const context = getUserContext(req);
  const role = context.roles.find((assignment) =>
    assignment.status === "ACTIVE" && assignment.schoolId === schoolId,
  )?.role ?? "STAFF";
  const actor = [context.user.firstName, context.user.lastName].filter(Boolean).join(" ") || context.user.email;
  await client.query(
    `INSERT INTO audit_logs
       ("user", role, actor_user_id, clerk_user_id, school_id, action, module, record_id,
        severity, event_type, result, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, 'Operations', $7, 'info', $8, 'SUCCESS', $9::jsonb)`,
    [
      actor,
      role,
      context.user.id,
      context.user.clerkUserId,
      schoolId,
      action,
      recordId,
      eventType,
      JSON.stringify(metadata),
    ],
  );
}

async function recordWorkStatus(
  client: Queryable,
  entity: "maintenance" | "task",
  schoolId: number,
  recordId: number,
  fromStatus: string | null,
  toStatus: string,
  actorUserId: number,
): Promise<void> {
  const table = entity === "maintenance"
    ? "maintenance_request_status_history"
    : "operational_task_status_history";
  const idColumn = entity === "maintenance" ? "maintenance_request_id" : "task_id";
  await client.query(
    `INSERT INTO ${table} (school_id, ${idColumn}, from_status, to_status, actor_user_id)
     VALUES ($1, $2, $3, $4, $5)`,
    [schoolId, recordId, fromStatus, toStatus, actorUserId],
  );
}

async function validateAssignee(client: Queryable, schoolId: number, userId: number | null): Promise<void> {
  if (userId === null) return;
  const result = await client.query(
    `SELECT 1
     FROM app_users u
     JOIN school_memberships m ON m.user_id = u.id AND m.school_id = $2
     WHERE u.id = $1 AND u.status = 'ACTIVE' AND m.status = 'ACTIVE'
       AND m.role IN ('SCHOOL_ADMIN', 'TEACHER', 'STAFF')
     LIMIT 1`,
    [userId, schoolId],
  );
  if (!result.rows.length) throw new AuthError(404, "Responsible staff member not found in this school");
}

async function validateCategory(
  client: Queryable,
  schoolId: number,
  categoryId: number | null,
  categoryType: "ASSET" | "MAINTENANCE" | "TASK",
): Promise<void> {
  if (categoryId === null) return;
  const result = await client.query(
    `SELECT 1 FROM school_operation_categories
     WHERE id = $1 AND school_id = $2 AND category_type = $3 AND is_active = true`,
    [categoryId, schoolId, categoryType],
  );
  if (!result.rows.length) throw new AuthError(404, "Active operation category not found in this school");
}

const categorySelect = `
  id, school_id AS "schoolId", category_type AS "categoryType", name, description,
  is_active AS "isActive", created_by_user_id AS "createdByUserId",
  created_at AS "createdAt", updated_at AS "updatedAt"`;
const assetSelect = `
  id, school_id AS "schoolId", category_id AS "categoryId", asset_code AS "assetCode",
  name, description, quantity, unit, location, condition,
  assigned_to_user_id AS "assignedToUserId", acquired_on AS "acquiredOn", status, notes,
  created_by_user_id AS "createdByUserId", created_at AS "createdAt", updated_at AS "updatedAt"`;
const facilitySelect = `
  id, school_id AS "schoolId", name, facility_type AS "facilityType", location,
  condition, capacity, status, notes, created_by_user_id AS "createdByUserId",
  created_at AS "createdAt", updated_at AS "updatedAt"`;
const maintenanceSelect = `
  id, school_id AS "schoolId", category_id AS "categoryId", asset_id AS "assetId",
  title, description, location, reported_by_user_id AS "reportedByUserId",
  assigned_to_user_id AS "assignedToUserId", priority, status,
  reported_at AS "reportedAt", due_on AS "dueOn", completed_at AS "completedAt",
  notes, created_at AS "createdAt", updated_at AS "updatedAt"`;
const taskSelect = `
  id, school_id AS "schoolId", category_id AS "categoryId", title, description,
  assigned_to_user_id AS "assignedToUserId", created_by_user_id AS "createdByUserId",
  priority, status, due_on AS "dueOn", notes, completed_at AS "completedAt",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

router.get("/operations/categories", asyncRoute(async (req, res) => {
  const { schoolId } = schoolFor(req);
  const type = req.query.type;
  if (type !== undefined && (typeof type !== "string" || !categoryTypes.has(type))) {
    throw new AuthError(400, "type must be ASSET, MAINTENANCE, or TASK");
  }
  const values: unknown[] = [schoolId];
  const typeFilter = type ? ` AND category_type = $2` : "";
  if (type) values.push(type);
  const result = await pool.query(
    `SELECT ${categorySelect} FROM school_operation_categories
     WHERE school_id = $1${typeFilter} ORDER BY category_type, name`,
    values,
  );
  res.json(result.rows);
}));

router.post("/operations/categories", asyncRoute(async (req, res) => {
  const { schoolId, context } = schoolFor(req);
  const body = bodyObject(req.body, ["categoryType", "name", "description"]);
  if (typeof body.categoryType !== "string" || !categoryTypes.has(body.categoryType)) {
    throw new AuthError(400, "categoryType must be ASSET, MAINTENANCE, or TASK");
  }
  const name = requiredText(body, "name", 120);
  const description = optionalText(body, "description", 1000) ?? null;
  const result = await inTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO school_operation_categories
         (school_id, category_type, name, description, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${categorySelect}`,
      [schoolId, body.categoryType, name, description, context.user.id],
    );
    const row = inserted.rows[0];
    await audit(client, req, schoolId, row.id, "Created operation category", "OPERATION_CATEGORY_CREATED", {
      categoryType: body.categoryType,
      name,
    });
    return row;
  });
  res.status(201).json(result);
}));

router.patch("/operations/categories/:categoryId", asyncRoute(async (req, res) => {
  const { schoolId } = schoolFor(req);
  const categoryId = parseRecordId(req.params.categoryId, "Category");
  const body = bodyObject(req.body, ["name", "description", "isActive"]);
  const changes: Array<[string, unknown]> = [];
  if (body.name !== undefined) changes.push(["name", requiredText(body, "name", 120)]);
  if (body.description !== undefined) changes.push(["description", optionalText(body, "description", 1000)]);
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== "boolean") throw new AuthError(400, "isActive must be a boolean");
    changes.push(["is_active", body.isActive]);
  }
  if (!changes.length) throw new AuthError(400, "At least one category field must be provided");
  const row = await inTransaction(async (client) => {
    const current = await client.query(
      `SELECT id, name, description, is_active AS "isActive"
       FROM school_operation_categories WHERE id = $1 AND school_id = $2 FOR UPDATE`,
      [categoryId, schoolId],
    );
    if (!current.rows[0]) throw new AuthError(404, "Category not found");
    const assignments = changes.map(([key], index) =>
      `${key} = $${index + 1}`).join(", ");
    const result = await client.query(
      `UPDATE school_operation_categories SET ${assignments}, updated_at = NOW()
       WHERE id = $${changes.length + 1} AND school_id = $${changes.length + 2}
       RETURNING ${categorySelect}`,
      [...changes.map(([, value]) => value), categoryId, schoolId],
    );
    await audit(client, req, schoolId, categoryId, "Updated operation category", "OPERATION_CATEGORY_UPDATED", {
      before: current.rows[0],
      after: result.rows[0],
    });
    return result.rows[0];
  });
  res.json(row);
}));

router.get("/operations/assets", asyncRoute(async (req, res) => {
  const { schoolId } = schoolFor(req);
  const status = req.query.status;
  if (status !== undefined && (typeof status !== "string" || !assetStatuses.has(status))) {
    throw new AuthError(400, "status contains an unsupported asset status");
  }
  const result = await pool.query(
    `SELECT ${assetSelect} FROM school_assets
     WHERE school_id = $1
       AND ($2::text IS NULL OR status = $2)
       AND ($3::text IS NULL OR name ILIKE '%' || $3 || '%' OR asset_code ILIKE '%' || $3 || '%')
     ORDER BY name, id`,
    [schoolId, typeof status === "string" ? status : null,
      typeof req.query.search === "string" ? req.query.search.slice(0, 100) : null],
  );
  res.json(result.rows);
}));

router.get("/operations/assets/:assetId/history", asyncRoute(async (req, res) => {
  const { schoolId } = schoolFor(req);
  const assetId = parseRecordId(req.params.assetId, "Asset");
  const asset = await pool.query(
    "SELECT 1 FROM school_assets WHERE id = $1 AND school_id = $2",
    [assetId, schoolId],
  );
  if (!asset.rows.length) throw new AuthError(404, "Asset not found");
  const result = await pool.query(
    `SELECT id, school_id AS "schoolId", asset_id AS "assetId", event_type AS "eventType",
       quantity_before AS "quantityBefore", quantity_after AS "quantityAfter",
       assigned_to_before_user_id AS "assignedToBeforeUserId",
       assigned_to_after_user_id AS "assignedToAfterUserId",
       status_before AS "statusBefore", status_after AS "statusAfter",
       actor_user_id AS "actorUserId", event_at AS "eventAt", metadata
     FROM school_asset_history
     WHERE school_id = $1 AND asset_id = $2
     ORDER BY event_at, id`,
    [schoolId, assetId],
  );
  res.json(result.rows);
}));

router.post("/operations/assets", asyncRoute(async (req, res) => {
  const { schoolId, context } = schoolFor(req);
  const body = bodyObject(req.body, [
    "categoryId", "assetCode", "name", "description", "quantity", "unit", "location",
    "condition", "assignedToUserId", "acquiredOn", "status", "notes",
  ]);
  const name = requiredText(body, "name", 200);
  const categoryId = optionalId(body, "categoryId") ?? null;
  const assetCode = optionalText(body, "assetCode", 100) ?? null;
  const description = optionalText(body, "description", 4000) ?? null;
  const quantity = body.quantity === undefined ? 1 : optionalInteger(body, "quantity", 0, 1_000_000);
  const unit = body.unit === undefined ? "item" : requiredText(body, "unit", 40);
  const location = optionalText(body, "location", 300) ?? null;
  const condition = optionalEnum(body, "condition", conditions) ?? "GOOD";
  const assignedToUserId = optionalId(body, "assignedToUserId") ?? null;
  const acquiredOn = optionalDate(body, "acquiredOn") ?? null;
  const status = optionalEnum(body, "status", assetStatuses) ?? "AVAILABLE";
  const notes = optionalText(body, "notes", 4000) ?? null;
  const row = await inTransaction(async (client) => {
    await validateCategory(client, schoolId, categoryId, "ASSET");
    await validateAssignee(client, schoolId, assignedToUserId);
    const inserted = await client.query(
      `INSERT INTO school_assets
         (school_id, category_id, asset_code, name, description, quantity, unit, location,
          condition, assigned_to_user_id, acquired_on, status, notes, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING ${assetSelect}`,
      [schoolId, categoryId, assetCode, name, description, quantity, unit, location,
        condition, assignedToUserId, acquiredOn, status, notes, context.user.id],
    );
    const created = inserted.rows[0];
    await client.query(
      `INSERT INTO school_asset_history
         (school_id, asset_id, event_type, quantity_after, assigned_to_after_user_id,
          status_after, actor_user_id, metadata)
       VALUES ($1, $2, 'CREATED', $3, $4, $5, $6, $7::jsonb)`,
      [schoolId, created.id, created.quantity, created.assignedToUserId, created.status,
        context.user.id, JSON.stringify({ name: created.name, assetCode: created.assetCode })],
    );
    await audit(client, req, schoolId, created.id, "Created school asset", "SCHOOL_ASSET_CREATED", {
      assetCode, name, quantity, status, assignedToUserId,
    });
    return created;
  });
  res.status(201).json(row);
}));

router.patch("/operations/assets/:assetId", asyncRoute(async (req, res) => {
  const { schoolId, context } = schoolFor(req);
  const assetId = parseRecordId(req.params.assetId, "Asset");
  const body = bodyObject(req.body, [
    "categoryId", "assetCode", "name", "description", "quantity", "unit", "location",
    "condition", "assignedToUserId", "acquiredOn", "status", "notes",
  ]);
  const fields: Record<string, unknown> = {};
  if (body.categoryId !== undefined) fields.category_id = optionalId(body, "categoryId");
  if (body.assetCode !== undefined) fields.asset_code = optionalText(body, "assetCode", 100);
  if (body.name !== undefined) fields.name = requiredText(body, "name", 200);
  if (body.description !== undefined) fields.description = optionalText(body, "description", 4000);
  if (body.quantity !== undefined) fields.quantity = optionalInteger(body, "quantity", 0, 1_000_000);
  if (body.unit !== undefined) fields.unit = requiredText(body, "unit", 40);
  if (body.location !== undefined) fields.location = optionalText(body, "location", 300);
  if (body.condition !== undefined) fields.condition = optionalEnum(body, "condition", conditions);
  if (body.assignedToUserId !== undefined) fields.assigned_to_user_id = optionalId(body, "assignedToUserId");
  if (body.acquiredOn !== undefined) fields.acquired_on = optionalDate(body, "acquiredOn");
  if (body.status !== undefined) fields.status = optionalEnum(body, "status", assetStatuses);
  if (body.notes !== undefined) fields.notes = optionalText(body, "notes", 4000);
  if (!Object.keys(fields).length) throw new AuthError(400, "At least one asset field must be provided");
  const row = await inTransaction(async (client) => {
    const currentResult = await client.query(
      `SELECT ${assetSelect} FROM school_assets WHERE id = $1 AND school_id = $2 FOR UPDATE`,
      [assetId, schoolId],
    );
    const current = currentResult.rows[0];
    if (!current) throw new AuthError(404, "Asset not found");
    if (Object.hasOwn(fields, "category_id")) {
      await validateCategory(client, schoolId, fields.category_id as number | null, "ASSET");
    }
    if (Object.hasOwn(fields, "assigned_to_user_id")) {
      await validateAssignee(client, schoolId, fields.assigned_to_user_id as number | null);
    }
    const entries = Object.entries(fields);
    const assignments = entries.map(([key], index) => `${key} = $${index + 1}`).join(", ");
    const updated = await client.query(
      `UPDATE school_assets SET ${assignments}, updated_at = NOW()
       WHERE id = $${entries.length + 1} AND school_id = $${entries.length + 2}
       RETURNING ${assetSelect}`,
      [...entries.map(([, value]) => value), assetId, schoolId],
    );
    const after = updated.rows[0];
    let hasTrackedHistory = false;
    if (current.quantity !== after.quantity) {
      await client.query(
        `INSERT INTO school_asset_history
           (school_id, asset_id, event_type, quantity_before, quantity_after, actor_user_id)
         VALUES ($1, $2, 'QUANTITY_CHANGED', $3, $4, $5)`,
        [schoolId, assetId, current.quantity, after.quantity, context.user.id],
      );
      hasTrackedHistory = true;
    }
    if (current.assignedToUserId !== after.assignedToUserId) {
      await client.query(
        `INSERT INTO school_asset_history
           (school_id, asset_id, event_type, assigned_to_before_user_id,
            assigned_to_after_user_id, actor_user_id)
         VALUES ($1, $2, 'ASSIGNMENT_CHANGED', $3, $4, $5)`,
        [schoolId, assetId, current.assignedToUserId, after.assignedToUserId, context.user.id],
      );
      hasTrackedHistory = true;
    }
    if (current.status !== after.status) {
      await client.query(
        `INSERT INTO school_asset_history
           (school_id, asset_id, event_type, status_before, status_after, actor_user_id)
         VALUES ($1, $2, 'STATUS_CHANGED', $3, $4, $5)`,
        [schoolId, assetId, current.status, after.status, context.user.id],
      );
      hasTrackedHistory = true;
    }
    if (!hasTrackedHistory) {
      await client.query(
        `INSERT INTO school_asset_history
           (school_id, asset_id, event_type, actor_user_id, metadata)
         VALUES ($1, $2, 'UPDATED', $3, $4::jsonb)`,
        [schoolId, assetId, context.user.id, JSON.stringify({ before: current, after })],
      );
    }
    await audit(client, req, schoolId, assetId, "Updated school asset", "SCHOOL_ASSET_UPDATED", {
      before: current,
      after,
    });
    return after;
  });
  res.json(row);
}));

router.get("/operations/facilities", asyncRoute(async (req, res) => {
  const { schoolId } = schoolFor(req);
  const result = await pool.query(
    `SELECT ${facilitySelect} FROM school_facilities
     WHERE school_id = $1 ORDER BY name, id`,
    [schoolId],
  );
  res.json(result.rows);
}));

router.post("/operations/facilities", asyncRoute(async (req, res) => {
  const { schoolId, context } = schoolFor(req);
  const body = bodyObject(req.body, ["name", "facilityType", "location", "condition", "capacity", "status", "notes"]);
  const name = requiredText(body, "name", 200);
  const facilityType = requiredText(body, "facilityType", 100);
  const location = optionalText(body, "location", 300) ?? null;
  const condition = optionalEnum(body, "condition", conditions) ?? "GOOD";
  const capacity = optionalInteger(body, "capacity", 0, 1_000_000) ?? null;
  const status = optionalEnum(body, "status", facilityStatuses) ?? "ACTIVE";
  const notes = optionalText(body, "notes", 4000) ?? null;
  const row = await inTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO school_facilities
         (school_id, name, facility_type, location, condition, capacity, status, notes, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING ${facilitySelect}`,
      [schoolId, name, facilityType, location, condition, capacity, status, notes, context.user.id],
    );
    const created = inserted.rows[0];
    await audit(client, req, schoolId, created.id, "Created school facility", "SCHOOL_FACILITY_CREATED", {
      name, facilityType, status,
    });
    return created;
  });
  res.status(201).json(row);
}));

router.patch("/operations/facilities/:facilityId", asyncRoute(async (req, res) => {
  const { schoolId } = schoolFor(req);
  const facilityId = parseRecordId(req.params.facilityId, "Facility");
  const body = bodyObject(req.body, ["name", "facilityType", "location", "condition", "capacity", "status", "notes"]);
  const fields: Record<string, unknown> = {};
  if (body.name !== undefined) fields.name = requiredText(body, "name", 200);
  if (body.facilityType !== undefined) fields.facility_type = requiredText(body, "facilityType", 100);
  if (body.location !== undefined) fields.location = optionalText(body, "location", 300);
  if (body.condition !== undefined) fields.condition = optionalEnum(body, "condition", conditions);
  if (body.capacity !== undefined) fields.capacity = optionalInteger(body, "capacity", 0, 1_000_000);
  if (body.status !== undefined) fields.status = optionalEnum(body, "status", facilityStatuses);
  if (body.notes !== undefined) fields.notes = optionalText(body, "notes", 4000);
  if (!Object.keys(fields).length) throw new AuthError(400, "At least one facility field must be provided");
  const row = await inTransaction(async (client) => {
    const currentResult = await client.query(
      `SELECT ${facilitySelect} FROM school_facilities WHERE id = $1 AND school_id = $2 FOR UPDATE`,
      [facilityId, schoolId],
    );
    const current = currentResult.rows[0];
    if (!current) throw new AuthError(404, "Facility not found");
    const entries = Object.entries(fields);
    const assignments = entries.map(([key], index) => `${key} = $${index + 1}`).join(", ");
    const updated = await client.query(
      `UPDATE school_facilities SET ${assignments}, updated_at = NOW()
       WHERE id = $${entries.length + 1} AND school_id = $${entries.length + 2}
       RETURNING ${facilitySelect}`,
      [...entries.map(([, value]) => value), facilityId, schoolId],
    );
    await audit(client, req, schoolId, facilityId, "Updated school facility", "SCHOOL_FACILITY_UPDATED", {
      before: current,
      after: updated.rows[0],
    });
    return updated.rows[0];
  });
  res.json(row);
}));

router.get("/operations/maintenance-requests", asyncRoute(async (req, res) => {
  const { schoolId, context } = schoolFor(req, ["SCHOOL_ADMIN", "STAFF"]);
  const status = req.query.status;
  if (status !== undefined && (typeof status !== "string" || !workStatuses.has(status))) {
    throw new AuthError(400, "status contains an unsupported maintenance status");
  }
  const admin = isSchoolAdmin(context, schoolId);
  const result = await pool.query(
    `SELECT ${maintenanceSelect} FROM maintenance_requests
     WHERE school_id = $1 AND ($2::boolean OR reported_by_user_id = $3 OR assigned_to_user_id = $3)
       AND ($4::text IS NULL OR status = $4)
     ORDER BY reported_at DESC, id DESC`,
    [schoolId, admin, context.user.id,
      typeof status === "string" ? status : null],
  );
  res.json(result.rows);
}));

router.post("/operations/maintenance-requests", asyncRoute(async (req, res) => {
  const { schoolId, context } = schoolFor(req, ["SCHOOL_ADMIN", "STAFF"]);
  const admin = isSchoolAdmin(context, schoolId);
  const body = bodyObject(req.body, [
    "categoryId", "assetId", "title", "description", "location", "assignedToUserId",
    "priority", "dueOn", "notes",
  ]);
  const title = requiredText(body, "title", 200);
  const description = requiredText(body, "description", 4000);
  const categoryId = optionalId(body, "categoryId") ?? null;
  const assetId = optionalId(body, "assetId") ?? null;
  const location = optionalText(body, "location", 300) ?? null;
  const assignedToUserId = optionalId(body, "assignedToUserId") ?? null;
  if (!admin && assignedToUserId !== null) {
    throw new AuthError(403, "Only a School Admin may assign maintenance requests");
  }
  const priority = optionalEnum(body, "priority", priorities);
  const dueOn = optionalDate(body, "dueOn") ?? null;
  const notes = optionalText(body, "notes", 4000) ?? null;
  const row = await inTransaction(async (client) => {
    const settings = await client.query(
      `SELECT staff_can_report_maintenance AS "staffCanReportMaintenance",
              default_maintenance_priority AS "defaultPriority"
       FROM school_operations_settings WHERE school_id = $1`,
      [schoolId],
    );
    const staffCanReport = settings.rows[0]?.staffCanReportMaintenance ?? true;
    if (!admin && !staffCanReport) {
      throw new AuthError(403, "Maintenance reporting is disabled for staff at this school");
    }
    await validateCategory(client, schoolId, categoryId, "MAINTENANCE");
    await validateAssignee(client, schoolId, assignedToUserId);
    const initialStatus = assignedToUserId === null ? "OPEN" : "ASSIGNED";
    const inserted = await client.query(
      `INSERT INTO maintenance_requests
         (school_id, category_id, asset_id, title, description, location, reported_by_user_id,
           assigned_to_user_id, priority, status, due_on, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING ${maintenanceSelect}`,
      [schoolId, categoryId, assetId, title, description, location, context.user.id,
        assignedToUserId, priority ?? settings.rows[0]?.defaultPriority ?? "MEDIUM",
        initialStatus, dueOn, notes],
    );
    const created = inserted.rows[0];
    await recordWorkStatus(client, "maintenance", schoolId, created.id, null, created.status, context.user.id);
    await audit(client, req, schoolId, created.id, "Created maintenance request", "MAINTENANCE_REQUEST_CREATED", {
      title, priority: created.priority, status: created.status, assetId, assignedToUserId,
    });
    return created;
  });
  res.status(201).json(row);
}));

router.patch("/operations/maintenance-requests/:requestId", asyncRoute(async (req, res) => {
  const { schoolId, context } = schoolFor(req, ["SCHOOL_ADMIN", "STAFF"]);
  const admin = isSchoolAdmin(context, schoolId);
  const requestId = parseRecordId(req.params.requestId, "Maintenance request");
  const body = bodyObject(req.body, [
    "categoryId", "assetId", "title", "description", "location", "assignedToUserId",
    "priority", "status", "dueOn", "notes",
  ]);
  const fields: Record<string, unknown> = {};
  if (body.categoryId !== undefined) fields.category_id = optionalId(body, "categoryId");
  if (body.assetId !== undefined) fields.asset_id = optionalId(body, "assetId");
  if (body.title !== undefined) fields.title = requiredText(body, "title", 200);
  if (body.description !== undefined) fields.description = requiredText(body, "description", 4000);
  if (body.location !== undefined) fields.location = optionalText(body, "location", 300);
  if (body.assignedToUserId !== undefined) fields.assigned_to_user_id = optionalId(body, "assignedToUserId");
  if (body.priority !== undefined) fields.priority = optionalEnum(body, "priority", priorities);
  if (body.status !== undefined) fields.status = optionalEnum(body, "status", workStatuses);
  if (body.dueOn !== undefined) fields.due_on = optionalDate(body, "dueOn");
  if (body.notes !== undefined) fields.notes = optionalText(body, "notes", 4000);
  if (!Object.keys(fields).length) throw new AuthError(400, "At least one maintenance request field must be provided");
  if (!admin && Object.keys(fields).some((key) => key !== "status")) {
    throw new AuthError(403, "Assigned staff may only change maintenance request status");
  }
  const row = await inTransaction(async (client) => {
    const currentResult = await client.query(
      `SELECT ${maintenanceSelect} FROM maintenance_requests WHERE id = $1 AND school_id = $2 FOR UPDATE`,
      [requestId, schoolId],
    );
    const current = currentResult.rows[0];
    if (!current) throw new AuthError(404, "Maintenance request not found");
    if (!admin && current.assignedToUserId !== context.user.id) {
      throw new AuthError(404, "Maintenance request not found");
    }
    if (!admin && !Object.hasOwn(fields, "status")) {
      throw new AuthError(403, "Assigned staff may only change maintenance request status");
    }
    if (Object.hasOwn(fields, "category_id")) {
      await validateCategory(client, schoolId, fields.category_id as number | null, "MAINTENANCE");
    }
    if (Object.hasOwn(fields, "assigned_to_user_id")) {
      await validateAssignee(client, schoolId, fields.assigned_to_user_id as number | null);
    }
    if (!Object.hasOwn(fields, "status") && Object.hasOwn(fields, "assigned_to_user_id")) {
      if (current.status === "OPEN" && fields.assigned_to_user_id !== null) fields.status = "ASSIGNED";
      if (current.status === "ASSIGNED" && fields.assigned_to_user_id === null) fields.status = "OPEN";
    }
    const nextAssignee = Object.hasOwn(fields, "assigned_to_user_id")
      ? fields.assigned_to_user_id as number | null
      : current.assignedToUserId as number | null;
    const nextStatus = Object.hasOwn(fields, "status") ? fields.status as string : current.status as string;
    if (nextStatus === "ASSIGNED" && nextAssignee === null) {
      throw new AuthError(400, "An assignee is required when status is ASSIGNED");
    }
    assertWorkTransition(current.status as string, nextStatus, !admin);
    const entries = Object.entries(fields);
    const assignments = entries.map(([key], index) => `${key} = $${index + 1}`).join(", ");
    const values = entries.map(([, value]) => value);
    const index = values.length;
    values.push(requestId, schoolId);
    const statusParameter = entries.findIndex(([key]) => key === "status") + 1;
    const completedAt = Object.hasOwn(fields, "status")
      ? `, completed_at = CASE WHEN $${statusParameter} = 'COMPLETED' THEN COALESCE(completed_at, NOW()) ELSE completed_at END`
      : "";
    const updated = await client.query(
      `UPDATE maintenance_requests SET ${assignments}${completedAt}, updated_at = NOW()
       WHERE id = $${index + 1} AND school_id = $${index + 2}
       RETURNING ${maintenanceSelect}`,
      values,
    );
    if (current.status !== updated.rows[0].status) {
      await recordWorkStatus(
        client, "maintenance", schoolId, requestId, current.status as string,
        updated.rows[0].status as string, context.user.id,
      );
    }
    await audit(client, req, schoolId, requestId, "Updated maintenance request", "MAINTENANCE_REQUEST_UPDATED", {
      before: current,
      after: updated.rows[0],
    });
    return updated.rows[0];
  });
  res.json(row);
}));

router.get("/operations/tasks", asyncRoute(async (req, res) => {
  const { schoolId, context } = schoolFor(req, ["SCHOOL_ADMIN", "STAFF"]);
  const admin = isSchoolAdmin(context, schoolId);
  const result = await pool.query(
    `SELECT ${taskSelect} FROM operational_tasks
     WHERE school_id = $1 AND ($2::boolean OR assigned_to_user_id = $3)
     ORDER BY CASE priority WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
       due_on NULLS LAST, id DESC`,
    [schoolId, admin, context.user.id],
  );
  res.json(result.rows);
}));

router.post("/operations/tasks", asyncRoute(async (req, res) => {
  const { schoolId, context } = schoolFor(req);
  const body = bodyObject(req.body, [
    "categoryId", "title", "description", "assignedToUserId", "priority", "dueOn", "notes",
  ]);
  const title = requiredText(body, "title", 200);
  const categoryId = optionalId(body, "categoryId") ?? null;
  const description = optionalText(body, "description", 4000) ?? null;
  const assignedToUserId = optionalId(body, "assignedToUserId") ?? null;
  const priority = optionalEnum(body, "priority", priorities);
  const dueOn = optionalDate(body, "dueOn") ?? null;
  const notes = optionalText(body, "notes", 4000) ?? null;
  const row = await inTransaction(async (client) => {
    await validateCategory(client, schoolId, categoryId, "TASK");
    await validateAssignee(client, schoolId, assignedToUserId);
    const settings = await client.query(
      `SELECT default_task_priority AS "defaultPriority"
       FROM school_operations_settings WHERE school_id = $1`,
      [schoolId],
    );
    const initialStatus = assignedToUserId === null ? "OPEN" : "ASSIGNED";
    const inserted = await client.query(
      `INSERT INTO operational_tasks
         (school_id, category_id, title, description, assigned_to_user_id, created_by_user_id,
          priority, status, due_on, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${taskSelect}`,
      [schoolId, categoryId, title, description, assignedToUserId, context.user.id,
        priority ?? settings.rows[0]?.defaultPriority ?? "MEDIUM", initialStatus, dueOn, notes],
    );
    const created = inserted.rows[0];
    await recordWorkStatus(client, "task", schoolId, created.id, null, created.status, context.user.id);
    await audit(client, req, schoolId, created.id, "Created operational task", "OPERATIONAL_TASK_CREATED", {
      title, status: created.status, priority: created.priority, assignedToUserId,
    });
    return created;
  });
  res.status(201).json(row);
}));

router.patch("/operations/tasks/:taskId", asyncRoute(async (req, res) => {
  const { schoolId, context } = schoolFor(req, ["SCHOOL_ADMIN", "STAFF"]);
  const admin = isSchoolAdmin(context, schoolId);
  const taskId = parseRecordId(req.params.taskId, "Operational task");
  const body = bodyObject(req.body, [
    "categoryId", "title", "description", "assignedToUserId", "priority", "status", "dueOn", "notes",
  ]);
  const fields: Record<string, unknown> = {};
  if (body.categoryId !== undefined) fields.category_id = optionalId(body, "categoryId");
  if (body.title !== undefined) fields.title = requiredText(body, "title", 200);
  if (body.description !== undefined) fields.description = optionalText(body, "description", 4000);
  if (body.assignedToUserId !== undefined) fields.assigned_to_user_id = optionalId(body, "assignedToUserId");
  if (body.priority !== undefined) fields.priority = optionalEnum(body, "priority", priorities);
  if (body.status !== undefined) fields.status = optionalEnum(body, "status", workStatuses);
  if (body.dueOn !== undefined) fields.due_on = optionalDate(body, "dueOn");
  if (body.notes !== undefined) fields.notes = optionalText(body, "notes", 4000);
  if (!Object.keys(fields).length) throw new AuthError(400, "At least one task field must be provided");
  if (!admin && Object.keys(fields).some((key) => key !== "status")) {
    throw new AuthError(403, "Assigned staff may only change task status");
  }
  const row = await inTransaction(async (client) => {
    const currentResult = await client.query(
      `SELECT ${taskSelect} FROM operational_tasks WHERE id = $1 AND school_id = $2 FOR UPDATE`,
      [taskId, schoolId],
    );
    const current = currentResult.rows[0];
    if (!current) throw new AuthError(404, "Operational task not found");
    if (!admin && current.assignedToUserId !== context.user.id) {
      throw new AuthError(404, "Operational task not found");
    }
    if (!admin && !Object.hasOwn(fields, "status")) {
      throw new AuthError(403, "Assigned staff may only change task status");
    }
    if (Object.hasOwn(fields, "category_id")) {
      await validateCategory(client, schoolId, fields.category_id as number | null, "TASK");
    }
    if (Object.hasOwn(fields, "assigned_to_user_id")) {
      await validateAssignee(client, schoolId, fields.assigned_to_user_id as number | null);
    }
    if (!Object.hasOwn(fields, "status") && Object.hasOwn(fields, "assigned_to_user_id")) {
      if (current.status === "OPEN" && fields.assigned_to_user_id !== null) fields.status = "ASSIGNED";
      if (current.status === "ASSIGNED" && fields.assigned_to_user_id === null) fields.status = "OPEN";
    }
    const nextAssignee = Object.hasOwn(fields, "assigned_to_user_id")
      ? fields.assigned_to_user_id as number | null
      : current.assignedToUserId as number | null;
    const nextStatus = Object.hasOwn(fields, "status") ? fields.status as string : current.status as string;
    if (nextStatus === "ASSIGNED" && nextAssignee === null) {
      throw new AuthError(400, "An assignee is required when status is ASSIGNED");
    }
    assertWorkTransition(current.status as string, nextStatus, !admin);
    const entries = Object.entries(fields);
    const assignments = entries.map(([key], index) => `${key} = $${index + 1}`).join(", ");
    const values = entries.map(([, value]) => value);
    const index = values.length;
    const statusParameter = entries.findIndex(([key]) => key === "status") + 1;
    const completedAt = Object.hasOwn(fields, "status")
      ? `, completed_at = CASE WHEN $${statusParameter} = 'COMPLETED' THEN COALESCE(completed_at, NOW()) ELSE completed_at END`
      : "";
    const updated = await client.query(
      `UPDATE operational_tasks SET ${assignments}${completedAt}, updated_at = NOW()
       WHERE id = $${index + 1} AND school_id = $${index + 2}
       RETURNING ${taskSelect}`,
      [...values, taskId, schoolId],
    );
    if (current.status !== updated.rows[0].status) {
      await recordWorkStatus(
        client, "task", schoolId, taskId, current.status as string,
        updated.rows[0].status as string, context.user.id,
      );
    }
    await audit(client, req, schoolId, taskId, "Updated operational task", "OPERATIONAL_TASK_UPDATED", {
      before: current,
      after: updated.rows[0],
    });
    return updated.rows[0];
  });
  res.json(row);
}));

router.get("/operations/settings", asyncRoute(async (req, res) => {
  const { schoolId, context } = schoolFor(req, ["SCHOOL_ADMIN", "STAFF"]);
  const admin = context.roles.some((assignment) =>
    assignment.status === "ACTIVE" && assignment.schoolId === schoolId && assignment.role === "SCHOOL_ADMIN",
  );
  if (!admin) throw new AuthError(403, "Only a School Admin may view operational settings");
  const result = await pool.query(
    `SELECT school_id AS "schoolId",
       default_maintenance_priority AS "defaultMaintenancePriority",
       default_task_priority AS "defaultTaskPriority",
       staff_can_report_maintenance AS "staffCanReportMaintenance",
       updated_by_user_id AS "updatedByUserId", updated_at AS "updatedAt"
     FROM school_operations_settings WHERE school_id = $1`,
    [schoolId],
  );
  res.json(result.rows[0] ?? {
    schoolId,
    defaultMaintenancePriority: "MEDIUM",
    defaultTaskPriority: "MEDIUM",
    staffCanReportMaintenance: true,
    updatedByUserId: null,
    updatedAt: null,
  });
}));

router.put("/operations/settings", asyncRoute(async (req, res) => {
  const { schoolId, context } = schoolFor(req);
  const body = bodyObject(req.body, [
    "defaultMaintenancePriority", "defaultTaskPriority", "staffCanReportMaintenance",
  ]);
  if (!Object.keys(body).length) throw new AuthError(400, "At least one settings field must be provided");
  const maintenancePriority = body.defaultMaintenancePriority === undefined
    ? undefined : optionalEnum(body, "defaultMaintenancePriority", priorities);
  const taskPriority = body.defaultTaskPriority === undefined
    ? undefined : optionalEnum(body, "defaultTaskPriority", priorities);
  const staffCanReport = body.staffCanReportMaintenance;
  if (staffCanReport !== undefined && typeof staffCanReport !== "boolean") {
    throw new AuthError(400, "staffCanReportMaintenance must be a boolean");
  }
  const row = await inTransaction(async (client) => {
    const current = await client.query(
      `SELECT default_maintenance_priority AS "defaultMaintenancePriority",
              default_task_priority AS "defaultTaskPriority",
              staff_can_report_maintenance AS "staffCanReportMaintenance"
       FROM school_operations_settings WHERE school_id = $1 FOR UPDATE`,
      [schoolId],
    );
    const value = current.rows[0];
    const inserted = await client.query(
      `INSERT INTO school_operations_settings
         (school_id, default_maintenance_priority, default_task_priority,
          staff_can_report_maintenance, updated_by_user_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (school_id) DO UPDATE SET
         default_maintenance_priority = EXCLUDED.default_maintenance_priority,
         default_task_priority = EXCLUDED.default_task_priority,
         staff_can_report_maintenance = EXCLUDED.staff_can_report_maintenance,
         updated_by_user_id = EXCLUDED.updated_by_user_id,
         updated_at = NOW()
       RETURNING school_id AS "schoolId",
         default_maintenance_priority AS "defaultMaintenancePriority",
         default_task_priority AS "defaultTaskPriority",
         staff_can_report_maintenance AS "staffCanReportMaintenance",
         updated_by_user_id AS "updatedByUserId", updated_at AS "updatedAt"`,
      [schoolId, maintenancePriority ?? value?.defaultMaintenancePriority ?? "MEDIUM",
        taskPriority ?? value?.defaultTaskPriority ?? "MEDIUM",
        staffCanReport ?? value?.staffCanReportMaintenance ?? true, context.user.id],
    );
    await audit(client, req, schoolId, schoolId, "Updated school operations settings",
      "SCHOOL_OPERATIONS_SETTINGS_UPDATED", {
        before: value ?? null,
        after: inserted.rows[0],
      });
    return inserted.rows[0];
  });
  res.json(row);
}));

router.get("/operations/reports", asyncRoute(async (req, res) => {
  const { schoolId } = schoolFor(req);
  const result = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM school_assets WHERE school_id = $1 AND status <> 'RETIRED') AS "activeAssets",
       (SELECT COALESCE(SUM(quantity), 0)::int FROM school_assets
         WHERE school_id = $1 AND status <> 'RETIRED') AS "inventoryQuantity",
       (SELECT COUNT(*)::int FROM school_facilities WHERE school_id = $1 AND status <> 'RETIRED') AS "facilities",
       (SELECT COUNT(*)::int FROM maintenance_requests WHERE school_id = $1
         AND status NOT IN ('COMPLETED', 'CANCELLED')) AS "openMaintenanceRequests",
       (SELECT COUNT(*)::int FROM maintenance_requests WHERE school_id = $1
         AND status NOT IN ('COMPLETED', 'CANCELLED') AND due_on < CURRENT_DATE) AS "overdueMaintenanceRequests",
       (SELECT COUNT(*)::int FROM operational_tasks WHERE school_id = $1
         AND status NOT IN ('COMPLETED', 'CANCELLED')) AS "openTasks",
       (SELECT COUNT(*)::int FROM operational_tasks WHERE school_id = $1
         AND status NOT IN ('COMPLETED', 'CANCELLED') AND due_on < CURRENT_DATE) AS "overdueTasks",
       (SELECT COUNT(*)::int FROM school_assets WHERE school_id = $1 AND status = 'DAMAGED') AS "damagedAssets",
       (SELECT COUNT(*)::int FROM school_assets WHERE school_id = $1 AND status = 'LOST') AS "lostAssets"`,
    [schoolId],
  );
  res.json(result.rows[0]);
}));

export default router;