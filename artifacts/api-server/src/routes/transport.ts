import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { pool } from "@workspace/db";
import {
  assertRoles,
  assertSchoolAccess,
  assertSchoolOperationalAccess,
  AuthError,
  getUserContext,
  handleAuthError,
  isPlatformOwner,
  requireAuthentication,
} from "../middlewares/auth";
import {
  ensureTransportArrivalAfterDeparture,
  ensureTransportSeatAvailable,
  isValidTransportStopPair,
  normalizeTransportTime,
  normalizeTransportWeekdays,
  projectTransportInvoiceStatus,
  resolveTransportFeePlanAmount,
  resolveTransportFeePlanDueDate,
  requireAllowedKeys,
  requireReason,
  requireRecordId,
  requireTransportAmountMinor,
  requireTransportDate,
} from "./transport-domain";

const router: IRouter = Router();
router.use(requireAuthentication());

type TransportHistoryEntity = "assignment" | "route" | "bus" | "request" | "routeStaff";
type JsonRecord = Record<string, unknown>;
type DbClient = {
  query(queryText: string, values?: any[]): Promise<{ rows: JsonRecord[] }>;
  release?(): void;
};

const schoolReadRoles = ["SCHOOL_ADMIN", "ACCOUNTANT", "TEACHER", "STAFF"] as const;
const weekdaysSet = new Set([
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
]);

const run = (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    handler(req, res).catch((error) => {
      const databaseCode = (error as { code?: string })?.code;
      const normalized = databaseCode === "23505"
        ? new AuthError(409, "This school transport value conflicts with an existing record")
        : databaseCode === "23503"
          ? new AuthError(409, "A referenced school transport record is no longer available")
          : databaseCode === "23514"
            ? new AuthError(400, "The school transport details violate a database validation rule")
            : error;
      handleAuthError(normalized, req, res, next);
    });

function querySchoolId(req: Request): number {
  const value = req.query.schoolId;
  if (typeof value !== "string") throw new AuthError(400, "schoolId is required");
  return requireRecordId(value, "schoolId");
}

function authorizeSchoolRead(req: Request, schoolId: number) {
  if (isPlatformOwner(getUserContext(req))) {
    throw new AuthError(403, "Platform Owner transport access is limited to the separate read-only overview");
  }
  return assertSchoolAccess(req, schoolId, [...schoolReadRoles]);
}

function authorizeSchoolWrite(req: Request, schoolId: number) {
  return assertSchoolOperationalAccess(req, schoolId, ["SCHOOL_ADMIN"]);
}

function roleForSchool(req: Request, schoolId: number): string {
  const context = getUserContext(req);
  if (isPlatformOwner(context)) {
    throw new AuthError(403, "Platform Owner read-only transport visibility does not grant school operating access");
  }
  return context.roles.find(
    (assignment) =>
      assignment.schoolId === schoolId &&
      assignment.status === "ACTIVE" &&
      assignment.role === "SCHOOL_ADMIN",
  )?.role ?? "SCHOOL_ADMIN";
}

function actorName(req: Request): string {
  const context = getUserContext(req);
  const name = [context.user.firstName, context.user.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  return name || context.user.email;
}

function requestId(value: string | string[], label = "recordId"): number {
  return requireRecordId(value, label);
}

function record(body: unknown, allowedKeys: readonly string[], objectName = "body"): JsonRecord {
  return requireAllowedKeys(body, allowedKeys, objectName);
}

function requiredText(value: unknown, label: string, maxLength: number, minLength = 1): string {
  if (typeof value !== "string" || value.trim().length < minLength || value.trim().length > maxLength) {
    throw new AuthError(400, `${label} must contain between ${minLength} and ${maxLength} characters`);
  }
  return value.trim();
}

function optionalText(value: unknown, label: string, maxLength: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.trim().length > maxLength) {
    throw new AuthError(400, `${label} must not exceed ${maxLength} characters`);
  }
  return value.trim() || null;
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new AuthError(400, `${label} must be a boolean`);
  return value;
}

function oneOf<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) {
    throw new AuthError(400, `${label} must be one of: ${values.join(", ")}`);
  }
  return value as T;
}

function ensureOptionalBody(recordValue: JsonRecord, atLeastOne: boolean) {
  if (atLeastOne && Object.keys(recordValue).length === 0) {
    throw new AuthError(400, "At least one supported field must be provided");
  }
}

type TransportFeePlanInput = {
  academicSessionId?: number;
  academicTermId?: number;
  feePlanAmountMinor?: number;
  dueDate?: string;
  feeCategoryId?: number;
};

function transportFeePlanInput(body: JsonRecord): TransportFeePlanInput {
  const academicSessionId = body.academicSessionId === undefined
    ? undefined
    : requireRecordId(body.academicSessionId, "academicSessionId");
  const academicTermId = body.academicTermId === undefined
    ? undefined
    : requireRecordId(body.academicTermId, "academicTermId");
  if ((academicSessionId === undefined) !== (academicTermId === undefined)) {
    throw new AuthError(400, "academicSessionId and academicTermId must be supplied together");
  }
  return {
    ...(academicSessionId === undefined ? {} : { academicSessionId }),
    ...(academicTermId === undefined ? {} : { academicTermId }),
    ...(body.feePlanAmountMinor === undefined
      ? {}
      : { feePlanAmountMinor: requireTransportAmountMinor(body.feePlanAmountMinor, "feePlanAmountMinor") }),
    ...(body.dueDate === undefined
      ? {}
      : { dueDate: requireTransportDate(body.dueDate, "dueDate") }),
    ...(body.feeCategoryId === undefined
      ? {}
      : { feeCategoryId: requireRecordId(body.feeCategoryId, "feeCategoryId") }),
  };
}

function actorRole(req: Request, schoolId: number): string {
  const role = getUserContext(req).roles.find(
    (item) => item.schoolId === schoolId && item.status === "ACTIVE" && item.role !== "PLATFORM_OWNER",
  )?.role;
  if (!role) throw new AuthError(403, "An active school-specific operating role is required");
  return role;
}

async function inTransaction<T>(work: (client: DbClient) => Promise<T>): Promise<T> {
  const connection = await pool.connect();
  const client: DbClient = connection;
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release?.();
  }
}

function historyForeignKeyColumn(entity: TransportHistoryEntity) {
  switch (entity) {
    case "assignment": return "assignment_id";
    case "route": return "route_id";
    case "bus": return "bus_id";
    case "request": return "request_id";
    case "routeStaff": return "route_staff_id";
  }
}

/**
 * Snapshot audit inserts share the mutation transaction; a failed operation
 * cannot commit without its reviewable before/after history.
 */
async function appendHistory(
  client: DbClient,
  req: Request,
  values: {
    schoolId: number;
    entity: TransportHistoryEntity;
    entityId: number;
    studentId?: number | null;
    eventType: string;
    effectiveDate: string;
    reason: string;
    before?: unknown;
    after?: unknown;
  },
) {
  const context = getUserContext(req);
  const entityColumn = historyForeignKeyColumn(values.entity);
  const role = actorRole(req, values.schoolId);
  const before = values.before === undefined || values.before === null
    ? null
    : JSON.stringify(values.before);
  const after = values.after === undefined || values.after === null
    ? null
    : JSON.stringify(values.after);
  const inserted = await client.query(
    `INSERT INTO transport_history
       (school_id, ${entityColumn}, student_id, event_type, effective_date, reason,
        actor_user_id, actor_role, before_state, after_state)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb)
     RETURNING id`,
    [
      values.schoolId,
      values.entityId,
      values.studentId ?? null,
      values.eventType,
      values.effectiveDate,
      requireReason(values.reason, "history reason", 1000),
      context.user.id,
      role,
      before,
      after,
    ],
  );
  await client.query(
    `INSERT INTO audit_logs
       ("user", role, actor_user_id, clerk_user_id, school_id, action, module,
        record_id, severity, event_type, result, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,'School Transport',$7,'info',$8,'SUCCESS',$9::jsonb)`,
    [
      actorName(req),
      role,
      context.user.id,
      context.user.clerkUserId,
      values.schoolId,
      values.eventType,
      values.entityId,
      "APPLICATION_EVENT",
      JSON.stringify({ historyId: inserted.rows[0].id, effectiveDate: values.effectiveDate }),
    ],
  );
  return inserted.rows[0].id as number;
}

async function requireSchoolBus(
  client: DbClient,
  schoolId: number,
  busId: number,
  options: { lock?: boolean; active?: boolean } = {},
) {
  const result = await client.query(
    `SELECT id, school_id AS "schoolId", name, registration_number AS "registrationNumber",
            make, capacity, status, notes, created_at AS "createdAt", updated_at AS "updatedAt"
       FROM transport_buses
      WHERE id = $1 AND school_id = $2 ${options.lock ? "FOR UPDATE" : ""}`,
    [busId, schoolId],
  );
  const row = result.rows[0];
  if (!row) throw new AuthError(404, "Bus not found");
  if (options.active && row.status !== "ACTIVE") {
    throw new AuthError(409, "An inactive or maintenance bus cannot accept active routes");
  }
  return row as JsonRecord & {
    id: number;
    schoolId: number;
    capacity: number;
    status: string;
  };
}

async function countReservedBusPassengers(
  client: DbClient,
  schoolId: number,
  busId: number,
  excludeRouteId: number | null = null,
) {
  const result = await client.query(
    `SELECT count(DISTINCT a.student_id)::int AS "reservedPassengerCount"
       FROM transport_routes r
       JOIN transport_student_assignments a
         ON a.route_id = r.id AND a.school_id = r.school_id
        AND a.status IN ('ACTIVE','SUSPENDED')
      WHERE r.school_id = $1 AND r.bus_id = $2
        AND ($3::int IS NULL OR r.id <> $3)`,
    [schoolId, busId, excludeRouteId],
  );
  return Number(result.rows[0]?.reservedPassengerCount ?? 0);
}

async function requireSchoolDriver(
  client: DbClient,
  schoolId: number,
  employeeId: number,
  options: { lock?: boolean } = {},
) {
  const result = await client.query(
    `SELECT id AS "employeeId", school_id AS "schoolId", employee_no AS "employeeNo",
            first_name || ' ' || last_name AS name, employee_type AS "employeeType",
            employment_status AS "employmentStatus"
       FROM employees
      WHERE id = $1 AND school_id = $2 AND UPPER(employee_type) = 'DRIVER'
      ${options.lock ? "FOR UPDATE" : ""}`,
    [employeeId, schoolId],
  );
  const row = result.rows[0];
  if (!row) throw new AuthError(404, "An existing same-school driver employee could not be found");
  if (String(row.employmentStatus).toUpperCase() !== "ACTIVE") {
    throw new AuthError(409, "An inactive employee cannot be assigned as a transport driver");
  }
  return row;
}

async function assertScheduleAvailable(
  client: DbClient,
  values: {
    schoolId: number;
    busId: number;
    driverEmployeeId: number;
    weekdays: string[];
    departureTime: string;
    arrivalTime: string;
    exceptRouteId?: number;
  },
) {
  const conflict = await client.query(
    `SELECT r.id, r.name
       FROM transport_routes r
      WHERE r.school_id = $1 AND r.status = 'ACTIVE'
        AND r.id IS DISTINCT FROM $7
        AND (r.bus_id = $2 OR r.driver_employee_id = $3)
        AND r.weekdays && $4::text[]
        AND r.departure_time::time < $6::time
        AND $5::time < r.arrival_time::time
      ORDER BY r.id
      LIMIT 1`,
    [
      values.schoolId,
      values.busId,
      values.driverEmployeeId,
      values.weekdays,
      values.departureTime,
      values.arrivalTime,
      values.exceptRouteId ?? null,
    ],
  );
  if (conflict.rows[0]) {
    throw new AuthError(
      409,
      `The selected driver or bus conflicts with route ${conflict.rows[0].name} during an overlapping service period`,
    );
  }
  if (values.exceptRouteId !== undefined) {
    const companionConflict = await client.query(
      `SELECT other_route.name,employee.employee_no AS "employeeNo",
              employee.first_name || ' ' || employee.last_name AS "employeeName"
         FROM transport_route_staff current_staff
         JOIN employees employee
           ON employee.id=current_staff.employee_id AND employee.school_id=current_staff.school_id
          AND UPPER(employee.employment_status)='ACTIVE'
         JOIN transport_routes other_route
           ON other_route.school_id=current_staff.school_id
          AND other_route.id<>current_staff.route_id
          AND other_route.status='ACTIVE'
         LEFT JOIN transport_route_staff other_staff
           ON other_staff.school_id=other_route.school_id
          AND other_staff.route_id=other_route.id
          AND other_staff.employee_id=current_staff.employee_id
          AND other_staff.is_active
        WHERE current_staff.school_id=$1 AND current_staff.route_id=$7
          AND current_staff.is_active
          AND (other_route.driver_employee_id=current_staff.employee_id OR other_staff.id IS NOT NULL)
          AND other_route.weekdays && $4::text[]
          AND other_route.departure_time::time < $6::time
          AND $5::time < other_route.arrival_time::time
        LIMIT 1`,
      [
        values.schoolId,
        values.busId,
        values.driverEmployeeId,
        values.weekdays,
        values.departureTime,
        values.arrivalTime,
        values.exceptRouteId,
      ],
    );
    if (companionConflict.rows[0]) {
      throw new AuthError(
        409,
        `A bus companion (${companionConflict.rows[0].employeeName}) conflicts with another active route schedule`,
      );
    }
  }
}

async function validateRouteStopPair(
  client: DbClient,
  schoolId: number,
  routeId: number,
  pickupStopId: number,
  dropoffStopId: number,
) {
  const stops = await client.query(
    `SELECT id, stop_type AS "stopType", is_active AS "isActive",sequence
       FROM transport_route_stops
      WHERE route_id = $1 AND school_id = $2
        AND id = ANY($3::int[])`,
    [routeId, schoolId, [pickupStopId, dropoffStopId]],
  );
  const pickup = stops.rows.find((stop) => Number(stop.id) === pickupStopId) as
    | { id: number; stopType: string; isActive: boolean; sequence: number }
    | undefined;
  const dropoff = stops.rows.find((stop) => Number(stop.id) === dropoffStopId) as
    | { id: number; stopType: string; isActive: boolean; sequence: number }
    | undefined;
  if (!isValidTransportStopPair(pickup, dropoff)) {
    throw new AuthError(400, "Select two distinct active stops on the selected route with correct pickup and drop-off types");
  }
  return { pickup, dropoff };
}

async function assertStopPairUsesBusSchedule(
  client: DbClient,
  schoolId: number,
  routeId: number,
  busId: number,
  effectiveDate: string,
) {
  const route = await client.query(
    `SELECT weekdays FROM transport_routes
      WHERE id = $1 AND school_id = $2`,
    [routeId, schoolId],
  );
  if (!route.rows[0]) throw new AuthError(404, "Route not found");
  const weekdayNumber = new Date(`${effectiveDate}T00:00:00.000Z`).getUTCDay();
  const dayByNumber = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
  if (!(route.rows[0].weekdays as string[]).includes(dayByNumber[weekdayNumber])) {
    throw new AuthError(409, "The chosen route does not run on the assignment's effective day");
  }
  await requireSchoolBus(client, schoolId, busId, { active: true });
}

async function routeStops(client: DbClient, schoolId: number, routeId: number) {
  const result = await client.query(
    `SELECT id, school_id AS "schoolId", route_id AS "routeId", name,
            stop_type AS "stopType", sequence, notes, is_active AS "isActive",
            created_at AS "createdAt", updated_at AS "updatedAt"
       FROM transport_route_stops
      WHERE school_id = $1 AND route_id = $2
      ORDER BY sequence, id`,
    [schoolId, routeId],
  );
  return result.rows;
}

function stopShape(stop: JsonRecord, schoolId: number, routeId: number) {
  return {
    id: Number(stop.id),
    schoolId,
    routeId,
    name: stop.name,
    stopType: stop.stopType,
    sequence: Number(stop.sequence),
    notes: stop.notes ?? null,
    isActive: Boolean(stop.isActive),
    createdAt: stop.createdAt,
    updatedAt: stop.updatedAt,
  };
}

async function checkStops(
  client: DbClient,
  schoolId: number,
  routeId: number,
  stops: unknown,
  actorId: number,
) {
  if (!Array.isArray(stops) || stops.length < 2 || stops.length > 100) {
    throw new AuthError(400, "A route must have between 2 and 100 ordered pickup/drop-off stops");
  }
  const usedSequences = new Set<number>();
  let hasPickup = false;
  let hasDropoff = false;
  const normalized = stops.map((raw, index) => {
    const stop = requireAllowedKeys(raw, ["name", "stopType", "sequence", "notes", "isActive"], `stops[${index}]`);
    const name = requiredText(stop.name, "Stop name", 120, 2);
    const stopType = oneOf(stop.stopType, ["PICKUP", "DROPOFF", "BOTH"] as const, "stopType");
    const sequence = requireRecordId(stop.sequence, "sequence");
    if (usedSequences.has(sequence)) throw new AuthError(400, "Each stop must have a unique sequence number");
    usedSequences.add(sequence);
    const isActive = optionalBoolean(stop.isActive, "isActive") ?? true;
    if (isActive && (stopType === "PICKUP" || stopType === "BOTH")) hasPickup = true;
    if (isActive && (stopType === "DROPOFF" || stopType === "BOTH")) hasDropoff = true;
    return {
      name,
      stopType,
      sequence,
      notes: optionalText(stop.notes, "Stop notes", 500),
      isActive,
      actorId,
    };
  });
  if (!hasPickup || !hasDropoff) {
    throw new AuthError(400, "The route must have at least one active pickup and one active drop-off stop");
  }
  normalized.sort((left, right) => left.sequence - right.sequence);
  for (const stop of normalized) {
    await client.query(
      `INSERT INTO transport_route_stops
         (school_id, route_id, name, stop_type, sequence, notes, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [schoolId, routeId, stop.name, stop.stopType, stop.sequence, stop.notes, stop.isActive, stop.actorId],
    );
  }
}

const routeRowSql = `
  SELECT r.id, r.school_id AS "schoolId", r.bus_id AS "busId",
         r.driver_employee_id AS "driverEmployeeId", r.name, r.weekdays,
         r.departure_time AS "departureTime", r.arrival_time AS "arrivalTime",
         r.fare_minor AS "fareMinor", r.currency, r.status,
         b.name AS "busName", b.registration_number AS "registrationNumber",
         b.capacity AS "busCapacity",
         e.first_name || ' ' || e.last_name AS "driverName",
         (SELECT count(DISTINCT a.student_id)::int
            FROM transport_routes passenger_route
            JOIN transport_student_assignments a
              ON a.route_id = passenger_route.id AND a.school_id = passenger_route.school_id
             AND a.status = 'ACTIVE'
           WHERE passenger_route.school_id = r.school_id AND passenger_route.bus_id = r.bus_id
         ) AS "passengerCount",
         (SELECT count(DISTINCT a.student_id)::int
            FROM transport_routes reserved_route
            JOIN transport_student_assignments a
              ON a.route_id = reserved_route.id AND a.school_id = reserved_route.school_id
             AND a.status IN ('ACTIVE','SUSPENDED')
           WHERE reserved_route.school_id = r.school_id AND reserved_route.bus_id = r.bus_id
         ) AS "reservedPassengerCount",
         (SELECT count(*)::int FROM transport_routes route_count
           WHERE route_count.school_id = r.school_id AND route_count.bus_id = r.bus_id
             AND route_count.status = 'ACTIVE'
         ) AS "routeCount",
         (SELECT count(*)::int FROM transport_route_staff rs
           WHERE rs.school_id = r.school_id AND rs.route_id = r.id AND rs.is_active
         ) AS "accompanyingStaffCount",
         COALESCE((SELECT jsonb_agg(
             jsonb_build_object('id', stop.id, 'schoolId', stop.school_id, 'routeId', stop.route_id,
               'name', stop.name, 'stopType', stop.stop_type, 'sequence', stop.sequence,
               'notes', stop.notes, 'isActive', stop.is_active, 'createdAt', stop.created_at,
               'updatedAt', stop.updated_at) ORDER BY stop.sequence, stop.id
           )
           FROM transport_route_stops stop
          WHERE stop.route_id = r.id AND stop.school_id = r.school_id), '[]'::jsonb) AS stops,
         r.created_at AS "createdAt", r.updated_at AS "updatedAt"
    FROM transport_routes r
    JOIN transport_buses b ON b.id = r.bus_id AND b.school_id = r.school_id
    JOIN employees e ON e.id = r.driver_employee_id AND e.school_id = r.school_id
`;

function mapRouteShape(row: JsonRecord) {
  const passengers = Number(row.reservedPassengerCount ?? 0);
  const busCapacity = Number(row.busCapacity);
  return {
    id: Number(row.id),
    schoolId: Number(row.schoolId),
    name: row.name,
    busId: Number(row.busId),
    busName: row.busName,
    registrationNumber: row.registrationNumber,
    busCapacity,
    passengerCount: Number(row.passengerCount ?? 0),
    reservedPassengerCount: passengers,
    isOverCapacity: passengers > busCapacity,
    driverEmployeeId: Number(row.driverEmployeeId),
    driverName: row.driverName,
    weekdays: row.weekdays,
    departureTime: row.departureTime,
    arrivalTime: row.arrivalTime,
    fareMinor: Number(row.fareMinor),
    currency: row.currency,
    status: row.status,
    routeCount: Number(row.routeCount ?? 0),
    accompanyingStaffCount: Number(row.accompanyingStaffCount ?? 0),
    stops: Array.isArray(row.stops) ? row.stops : [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function validateBusRouteStaff(
  client: DbClient,
  schoolId: number,
  routeId: number,
  employeeId: number,
  role: "TEACHER" | "STAFF" | "ACCOMPANIER",
  ignoreRouteStaffId?: number,
) {
  const routeResult = await client.query(
    `SELECT id,school_id AS "schoolId",driver_employee_id AS "driverEmployeeId",
            weekdays,departure_time AS "departureTime",arrival_time AS "arrivalTime",
            status
       FROM transport_routes WHERE id=$1 AND school_id=$2 FOR UPDATE`,
    [routeId, schoolId],
  );
  const route = routeResult.rows[0];
  if (!route) throw new AuthError(404, "Transport route not found");
  if (route.status !== "ACTIVE") {
    throw new AuthError(409, "Accompanying staff cannot be added to an inactive route");
  }
  const employeeResult = await client.query(
    `SELECT id,school_id AS "schoolId",employee_no AS "employeeNo",
            first_name || ' ' || last_name AS name,employee_type AS "employeeType",
            employment_status AS "employmentStatus"
       FROM employees WHERE id=$1 AND school_id=$2 FOR UPDATE`,
    [employeeId, schoolId],
  );
  const employee = employeeResult.rows[0];
  if (!employee || String(employee.employmentStatus).toUpperCase() !== "ACTIVE") {
    throw new AuthError(404, "Active same-school employee not found");
  }
  const employeeType = String(employee.employeeType).toUpperCase();
  if (role === "TEACHER" && employeeType !== "TEACHER") {
    throw new AuthError(400, "This employee is not an existing teacher in this school");
  }
  if (role === "STAFF" && !["STAFF", "NON_TEACHING", "ADMINISTRATIVE"].includes(employeeType)) {
    throw new AuthError(400, "This employee is not an eligible same-school staff member");
  }
  if (role === "ACCOMPANIER" && employeeType === "DRIVER") {
    throw new AuthError(409, "Use the existing route driver assignment instead of also assigning this employee as a bus companion");
  }
  const alreadyAssigned = await client.query(
    `SELECT 1 FROM transport_route_staff
      WHERE school_id=$1 AND route_id=$2 AND employee_id=$3 AND is_active
        AND ($4::int IS NULL OR id<>$4)
      LIMIT 1`,
    [schoolId, routeId, employeeId, ignoreRouteStaffId ?? null],
  );
  if (alreadyAssigned.rows[0]) {
    throw new AuthError(409, "This employee already accompanies the selected route");
  }
  const conflict = await client.query(
    `SELECT other_route.id,other_route.name
       FROM transport_routes other_route
       JOIN transport_route_staff other_staff
         ON other_staff.school_id=other_route.school_id
        AND other_staff.route_id=other_route.id AND other_staff.employee_id=$3
        AND other_staff.is_active
      WHERE other_route.school_id=$1 AND other_route.id<>$2
        AND other_route.status='ACTIVE'
        AND (
          other_route.driver_employee_id=$3 OR
          other_route.weekdays && $4::text[]
        )
        AND other_route.weekdays && $4::text[]
        AND other_route.departure_time::time < $6::time
        AND $5::time < other_route.arrival_time::time
      UNION ALL
     SELECT other_route.id,other_route.name
       FROM transport_routes other_route
       WHERE other_route.school_id=$1 AND other_route.id<>$2
         AND other_route.status='ACTIVE'
        AND other_route.driver_employee_id=$3
        AND other_route.weekdays && $4::text[]
        AND other_route.departure_time::time < $6::time
        AND $5::time < other_route.arrival_time::time
      LIMIT 1`,
    [
      schoolId,
      routeId,
      employeeId,
      route.weekdays,
      route.departureTime,
      route.arrivalTime,
    ],
  );
  if (conflict.rows[0]) {
    throw new AuthError(409, "This employee is already a driver or bus companion on an overlapping same-school route");
  }
  if (Number(route.driverEmployeeId) === employeeId) {
    throw new AuthError(409, "The assigned driver cannot also be registered as a bus companion");
  }
  return employee;
}

router.get("/transport/routes/:routeId/staff", run(async (req, res) => {
  const schoolId = querySchoolId(req);
  authorizeSchoolRead(req, schoolId);
  const routeId = requestId(req.params.routeId, "routeId");
  const route = await pool.query(
    `SELECT id FROM transport_routes WHERE id=$1 AND school_id=$2`,
    [routeId, schoolId],
  );
  if (!route.rows[0]) throw new AuthError(404, "Transport route not found");
  const result = await pool.query(
    `SELECT rs.id AS "routeStaffId",rs.school_id AS "schoolId",
            rs.route_id AS "routeId",e.id AS "employeeId",
            e.employee_no AS "employeeNo",
            e.first_name || ' ' || e.last_name AS "employeeName",
            e.employee_type AS "employeeType",rs.role,rs.is_active AS "isActive",
            rs.created_at AS "createdAt",rs.updated_at AS "updatedAt"
       FROM transport_route_staff rs
       JOIN employees e ON e.id=rs.employee_id AND e.school_id=rs.school_id
      WHERE rs.school_id=$1 AND rs.route_id=$2
      ORDER BY rs.is_active DESC,e.first_name,e.last_name`,
    [schoolId, routeId],
  );
  res.json(result.rows.map((row) => ({
    ...row,
    routeStaffId: Number(row.routeStaffId),
    schoolId: Number(row.schoolId),
    routeId: Number(row.routeId),
    employeeId: Number(row.employeeId),
  })));
}));

router.get("/transport/employees", run(async (req, res) => {
  const schoolId = querySchoolId(req);
  authorizeSchoolRead(req, schoolId);
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
  const role = req.query.role === undefined
    ? "ACCOMPANIER"
    : oneOf(req.query.role, ["TEACHER", "STAFF", "ACCOMPANIER"] as const, "role");
  const rawLimit = req.query.limit === undefined ? 20 : requireRecordId(req.query.limit, "limit");
  if (rawLimit > 50) throw new AuthError(400, "limit cannot exceed 50 employee directory results");
  const result = await pool.query(
    `SELECT employee.id AS "employeeId",employee.school_id AS "schoolId",
            employee.employee_no AS "employeeNo",
            employee.first_name || ' ' || employee.last_name AS "employeeName",
            employee.employee_type AS "employeeType"
       FROM employees employee
      WHERE employee.school_id=$1 AND UPPER(employee.employment_status)='ACTIVE'
        AND (
          ($2='TEACHER' AND UPPER(employee.employee_type)='TEACHER') OR
          ($2='STAFF' AND UPPER(employee.employee_type) IN ('STAFF','NON_TEACHING','ADMINISTRATIVE')) OR
          ($2='ACCOMPANIER' AND UPPER(employee.employee_type) <> 'DRIVER')
        )
        AND (
          $3='' OR employee.employee_no ILIKE '%' || $3 || '%' OR
          employee.first_name ILIKE '%' || $3 || '%' OR
          employee.last_name ILIKE '%' || $3 || '%'
        )
      ORDER BY employee.first_name,employee.last_name,employee.employee_no
      LIMIT $4`,
    [schoolId, role, search, rawLimit],
  );
  res.json(result.rows.map((row) => ({
    employeeId: Number(row.employeeId),
    schoolId: Number(row.schoolId),
    employeeNo: String(row.employeeNo),
    employeeName: String(row.employeeName),
    employeeType: String(row.employeeType),
  })));
}));

router.post("/transport/routes/:routeId/staff", run(async (req, res) => {
  const schoolId = querySchoolId(req);
  const context = authorizeSchoolWrite(req, schoolId);
  const routeId = requestId(req.params.routeId, "routeId");
  const body = record(req.body, ["employeeId", "role"]);
  const employeeId = requireRecordId(body.employeeId, "employeeId");
  const role = body.role === undefined
    ? "ACCOMPANIER"
    : oneOf(body.role, ["TEACHER", "STAFF", "ACCOMPANIER"] as const, "role");
  const row = await inTransaction(async (client) => {
    const employee = await validateBusRouteStaff(client, schoolId, routeId, employeeId, role);
    const created = await client.query(
      `INSERT INTO transport_route_staff
         (school_id,route_id,employee_id,role,assigned_by)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id,school_id AS "schoolId",route_id AS "routeId",employee_id AS "employeeId",
                 role,is_active AS "isActive",created_at AS "createdAt",updated_at AS "updatedAt"`,
      [schoolId, routeId, employeeId, role, context.user.id],
    );
    const after = {
      ...created.rows[0],
      routeStaffId: Number(created.rows[0].id),
      routeId,
      schoolId,
      employeeId,
      employeeNo: employee.employeeNo,
      employeeName: employee.name,
      employeeType: employee.employeeType,
    };
    await appendHistory(client, req, {
      schoolId,
      entity: "routeStaff",
      entityId: Number(created.rows[0].id),
      eventType: "TRANSPORT_BUS_EMPLOYEE_ASSIGNED",
      effectiveDate: new Date().toISOString().slice(0, 10),
      reason: "School-admin assigned same-school employee to accompany transport route",
      after,
    });
    return after;
  });
  res.status(201).json(row);
}));

router.patch("/transport/routes/:routeId/staff/:routeStaffId", run(async (req, res) => {
  const schoolId = querySchoolId(req);
  authorizeSchoolWrite(req, schoolId);
  const routeId = requestId(req.params.routeId, "routeId");
  const routeStaffId = requestId(req.params.routeStaffId, "routeStaffId");
  const body = record(req.body, ["isActive", "role", "reason"]);
  const isActive = optionalBoolean(body.isActive, "isActive");
  const requestedRole = body.role === undefined
    ? undefined
    : oneOf(body.role, ["TEACHER", "STAFF", "ACCOMPANIER"] as const, "role");
  if (isActive === undefined && requestedRole === undefined) {
    throw new AuthError(400, "isActive or role must be provided");
  }
  const row = await inTransaction(async (client) => {
    const currentResult = await client.query(
      `SELECT rs.id,rs.school_id AS "schoolId",rs.route_id AS "routeId",
              rs.employee_id AS "employeeId",rs.role,rs.is_active AS "isActive",
              e.employee_no AS "employeeNo",
              e.first_name || ' ' || e.last_name AS "employeeName",
              e.employee_type AS "employeeType"
         FROM transport_route_staff rs
         JOIN employees e ON e.id=rs.employee_id AND e.school_id=rs.school_id
        WHERE rs.id=$1 AND rs.route_id=$2 AND rs.school_id=$3
        FOR UPDATE OF rs`,
      [routeStaffId, routeId, schoolId],
    );
    const current = currentResult.rows[0] as JsonRecord | undefined;
    if (!current) throw new AuthError(404, "Route employee assignment not found");
    const nextIsActive = isActive ?? Boolean(current.isActive);
    const nextRole = requestedRole ?? String(current.role);
    if (Boolean(current.isActive) === nextIsActive && String(current.role) === nextRole) return current;
    if (nextIsActive) {
      await validateBusRouteStaff(
        client,
        schoolId,
        routeId,
        Number(current.employeeId),
        nextRole as "TEACHER" | "STAFF" | "ACCOMPANIER",
        routeStaffId,
      );
    }
    const updatedResult = await client.query(
      `UPDATE transport_route_staff SET is_active=$1,role=$2,updated_at=NOW()
        WHERE id=$3 AND route_id=$4 AND school_id=$5
        RETURNING id,school_id AS "schoolId",route_id AS "routeId",
                  employee_id AS "employeeId",role,is_active AS "isActive",
                  created_at AS "createdAt",updated_at AS "updatedAt"`,
      [nextIsActive, nextRole, routeStaffId, routeId, schoolId],
    );
    const updated = updatedResult.rows[0];
    const after = {
      ...updated,
      routeStaffId,
      employeeNo: current.employeeNo,
      employeeName: current.employeeName,
      employeeType: current.employeeType,
    };
    await appendHistory(client, req, {
      schoolId,
      entity: "routeStaff",
      entityId: routeStaffId,
      eventType: requestedRole !== undefined && String(current.role) !== nextRole
        ? "TRANSPORT_BUS_EMPLOYEE_ROLE_CHANGED"
        : nextIsActive ? "TRANSPORT_BUS_EMPLOYEE_ACTIVATED" : "TRANSPORT_BUS_EMPLOYEE_REMOVED",
      effectiveDate: new Date().toISOString().slice(0, 10),
      reason: body.reason === undefined
        ? (nextIsActive
          ? "School-admin restored same-school bus employee assignment"
          : "School-admin deactivated same-school bus employee assignment")
        : requireReason(body.reason),
      before: current,
      after,
    });
    return after;
  });
  res.json(row);
}));

router.get("/transport/routes/:routeId/history", run(async (req, res) => {
  const schoolId = querySchoolId(req);
  authorizeSchoolRead(req, schoolId);
  const routeId = requestId(req.params.routeId, "routeId");
  const route = await pool.query(
    `SELECT id FROM transport_routes WHERE id=$1 AND school_id=$2`,
    [routeId, schoolId],
  );
  if (!route.rows[0]) throw new AuthError(404, "Route not found");
  const history = await pool.query(
    `SELECT h.id,h.school_id AS "schoolId",h.route_id AS "routeId",
            h.event_type AS "eventType",h.effective_date::text AS "effectiveDate",
            h.reason,h.actor_user_id AS "actorUserId",h.actor_role AS "actorRole",
            COALESCE(NULLIF(TRIM(COALESCE(user.first_name,'') || ' ' || COALESCE(user.last_name,'')),''),
                     user.email,'School action') AS "actorName",
            h.before_state AS "before",h.after_state AS "after",
            h.created_at AS "createdAt"
       FROM transport_history h
       LEFT JOIN transport_route_staff route_staff
         ON route_staff.id=h.route_staff_id AND route_staff.school_id=h.school_id
       LEFT JOIN app_users user ON user.id=h.actor_user_id
      WHERE h.school_id=$1 AND (h.route_id=$2 OR route_staff.route_id=$2)
      ORDER BY h.created_at DESC,h.id DESC
      LIMIT 300`,
    [schoolId, routeId],
  );
  res.json(history.rows.map((row) => ({
    id: Number(row.id),
    schoolId: Number(row.schoolId),
    assignmentId: null,
    studentId: null,
    actorUserId: row.actorUserId === null ? null : Number(row.actorUserId),
    actorName: String(row.actorName),
    actorRole: String(row.actorRole),
    eventType: String(row.eventType),
    effectiveDate: String(row.effectiveDate).slice(0, 10),
    reason: String(row.reason),
    before: row.before,
    after: row.after,
    createdAt: row.createdAt,
  })));
}));

type ActiveTransportTerm = {
  id: number;
  schoolId: number;
  academicSessionId: number;
  sessionName: string;
  termName: string;
  startDate: string;
  endDate: string;
};

function transportTermId(term: ActiveTransportTerm | JsonRecord): number {
  const explicitAcademicTermId = (term as JsonRecord).academicTermId;
  return Number(explicitAcademicTermId ?? (term as ActiveTransportTerm).id);
}

async function currentTransportTerm(client: DbClient, schoolId: number): Promise<ActiveTransportTerm | null> {
  const result = await client.query(
    `SELECT t.id,t.school_id AS "schoolId",t.academic_session_id AS "academicSessionId",
            ac.name AS "sessionName",t.name AS "termName",
            t.start_date::text AS "startDate",t.end_date::text AS "endDate"
       FROM academic_terms t
       JOIN academic_sessions ac ON ac.id=t.academic_session_id AND ac.school_id=t.school_id
       WHERE t.school_id=$1 AND t.is_current AND ac.is_current
      ORDER BY t.start_date DESC,t.id DESC
       LIMIT 1 FOR SHARE OF t,ac`,
    [schoolId],
  );
  const term = result.rows[0];
  return term ? {
    id: Number(term.id),
    schoolId: Number(term.schoolId),
    academicSessionId: Number(term.academicSessionId),
    sessionName: String(term.sessionName),
    termName: String(term.termName),
    startDate: String(term.startDate),
    endDate: String(term.endDate),
  } : null;
}

async function transportTermPlanContext(
  client: DbClient,
  schoolId: number,
  academicSessionId: number,
  academicTermId: number,
  lock = false,
) {
  const result = await client.query(
    `SELECT term.id AS "academicTermId",term.school_id AS "schoolId",
            term.academic_session_id AS "academicSessionId",
            term.start_date::text AS "startDate",term.end_date::text AS "endDate",
            term.is_current AS "termIsCurrent",
            session.is_current AS "sessionIsCurrent"
       FROM academic_terms term
       JOIN academic_sessions session
         ON session.id=term.academic_session_id AND session.school_id=term.school_id
      WHERE term.id=$1 AND term.academic_session_id=$2 AND term.school_id=$3
      ${lock ? "FOR SHARE OF term,session" : ""}`,
    [academicTermId, academicSessionId, schoolId],
  );
  const term = result.rows[0];
  if (!term) throw new AuthError(404, "The selected academic session and term do not belong to this school");
  return term;
}

async function resolveTransportFeeCategory(
  client: DbClient,
  schoolId: number,
  actorUserId: number,
  feeCategoryId: number | undefined,
  amountMinor: number,
) {
  if (amountMinor === 0 && feeCategoryId === undefined) return null;
  if (feeCategoryId === undefined) {
    return ensureTransportFinanceCategory(client, schoolId, actorUserId);
  }
  const category = await client.query(
    `SELECT id FROM fee_categories
      WHERE id=$1 AND school_id=$2 AND status='ACTIVE'
      FOR SHARE`,
    [feeCategoryId, schoolId],
  );
  if (!category.rows[0]) {
    throw new AuthError(404, "Select an active Finance fee category belonging to this school");
  }
  return Number(category.rows[0].id);
}

async function upsertTransportFeePlan(
  client: DbClient,
  values: {
    schoolId: number;
    assignmentId: number;
    academicSessionId: number;
    academicTermId: number;
    amountMinor: number;
    dueDate?: string;
    feeCategoryId?: number;
    actorUserId: number;
  },
) {
  const amountMinor = requireTransportAmountMinor(values.amountMinor, "feePlanAmountMinor");
  const term = await transportTermPlanContext(
    client,
    values.schoolId,
    values.academicSessionId,
    values.academicTermId,
    true,
  );
  const dueDate = resolveTransportFeePlanDueDate(
    values.dueDate,
    term.startDate,
    term.endDate,
  );
  const categoryId = await resolveTransportFeeCategory(
    client,
    values.schoolId,
    values.actorUserId,
    values.feeCategoryId,
    amountMinor,
  );
  const existing = await client.query(
    `SELECT id,fee_invoice_id AS "feeInvoiceId",status
       FROM transport_fee_invoices
      WHERE assignment_id=$1 AND academic_term_id=$2 AND school_id=$3
      FOR UPDATE`,
    [values.assignmentId, values.academicTermId, values.schoolId],
  );
  if (existing.rows[0]?.feeInvoiceId !== null && existing.rows[0]?.feeInvoiceId !== undefined) {
    const unchanged = await client.query(
      `SELECT 1 FROM transport_fee_invoices
        WHERE id=$1 AND amount_minor=$2 AND due_date=$3 AND fee_category_id IS NOT DISTINCT FROM $4`,
      [Number(existing.rows[0].id), amountMinor, dueDate, categoryId],
    );
    if (unchanged.rows[0]) return Number(existing.rows[0].id);
    throw new AuthError(409, "An invoiced transport fee plan is immutable; use existing Finance adjustment workflows");
  }
  const saved = await client.query(
    `INSERT INTO transport_fee_invoices
       (school_id,assignment_id,academic_session_id,academic_term_id,fee_category_id,
        amount_minor,due_date,status,created_by,updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'PLANNED',$8,$8)
     ON CONFLICT (assignment_id,academic_term_id)
     DO UPDATE SET academic_session_id=EXCLUDED.academic_session_id,
                   fee_category_id=EXCLUDED.fee_category_id,
                   amount_minor=EXCLUDED.amount_minor,due_date=EXCLUDED.due_date,
                   status='PLANNED',updated_by=EXCLUDED.updated_by,updated_at=NOW()
     WHERE transport_fee_invoices.school_id=EXCLUDED.school_id
       AND transport_fee_invoices.fee_invoice_id IS NULL
     RETURNING id`,
    [
      values.schoolId,
      values.assignmentId,
      values.academicSessionId,
      values.academicTermId,
      categoryId,
      amountMinor,
      dueDate,
      values.actorUserId,
    ],
  );
  if (!saved.rows[0]) {
    throw new AuthError(409, "The transport fee plan is already invoiced or conflicts with another school term");
  }
  return Number(saved.rows[0].id);
}

async function ensureTransportFinanceCategory(client: DbClient, schoolId: number, actorUserId: number) {
  const existing = await client.query(
    `SELECT id,status FROM fee_categories
      WHERE school_id=$1 AND name='School Transport' FOR SHARE`,
    [schoolId],
  );
  if (existing.rows[0]) {
    if (existing.rows[0].status !== "ACTIVE") {
      throw new AuthError(409, "The school's existing School Transport finance category is inactive; ask its School Admin to reactivate it in Finance");
    }
    return Number(existing.rows[0].id);
  }
  await client.query(
    `INSERT INTO fee_categories (school_id,name,description,compulsory,status,created_by)
     VALUES ($1,'School Transport','School bus and transport service charges',false,'ACTIVE',$2)
     ON CONFLICT (school_id,name) DO NOTHING`,
    [schoolId, actorUserId],
  );
  const category = await client.query(
    `SELECT id,status FROM fee_categories WHERE school_id=$1 AND name='School Transport' FOR SHARE`,
    [schoolId],
  );
  if (!category.rows[0] || category.rows[0].status !== "ACTIVE") {
    throw new AuthError(409, "The School Transport fee category could not be safely activated; configure its status through School Finance");
  }
  return Number(category.rows[0].id);
}

/**
 * Create one normal Finance invoice and link it immutably to the assignment
 * and academic term. Calling this again for the same assignment/term is a
 * no-op, so a calendar transition retry or invoice-page reload cannot bill the
 * family twice. No provider or payment claim is made here.
 */
async function ensureTransportInvoiceForTerm(
  client: DbClient,
  values: {
    assignmentId: number;
    schoolId: number;
    academicTermId: number;
    actorUserId: number;
    actorRole: string;
    req: Request;
    effectiveReason: string;
  },
) {
  let feePlan = await client.query(
    `SELECT id,academic_session_id AS "academicSessionId",
            academic_term_id AS "academicTermId",fee_category_id AS "feeCategoryId",
            amount_minor AS "amountMinor",due_date::text AS "dueDate",
            fee_invoice_id AS "feeInvoiceId",status
       FROM transport_fee_invoices
      WHERE school_id=$1 AND assignment_id=$2 AND academic_term_id=$3
      FOR UPDATE`,
    [values.schoolId, values.assignmentId, values.academicTermId],
  );
  if (feePlan.rows[0]?.status === "CANCELLED") return null;
  if (feePlan.rows[0]?.feeInvoiceId !== null && feePlan.rows[0]?.feeInvoiceId !== undefined) {
    return Number(feePlan.rows[0].feeInvoiceId);
  }
  const assignmentResult = await client.query(
    `SELECT a.id,a.school_id AS "schoolId",a.student_id AS "studentId",
            a.status,a.effective_date::text AS "effectiveDate",
            st.admission_no AS "admissionNo",
            st.first_name || ' ' || st.last_name AS "studentName",
            st.class_name AS "className",st.section,
            r.fare_minor AS "fareMinor",
            t.name AS "termName",t.start_date::text AS "termStartDate",
            t.academic_session_id AS "academicSessionId",
            t.end_date::text AS "dueDate",
            COALESCE((
              SELECT psr.parent_id FROM parent_student_relationships psr
                JOIN parents guardian
                  ON guardian.id=psr.parent_id AND guardian.school_id=st.school_id
                 AND UPPER(guardian.status)='ACTIVE'
               WHERE psr.student_id=st.id AND UPPER(psr.status)='ACTIVE'
               ORDER BY psr.is_primary_guardian DESC,psr.parent_id
               LIMIT 1
            ),NULL) AS "parentId"
       FROM transport_student_assignments a
       JOIN students st ON st.id=a.student_id AND st.school_id=a.school_id
       JOIN transport_routes r ON r.id=a.route_id AND r.school_id=a.school_id
       JOIN academic_terms t ON t.id=$3 AND t.school_id=a.school_id
       JOIN academic_sessions ac
         ON ac.id=t.academic_session_id AND ac.school_id=t.school_id
      WHERE a.id=$1 AND a.school_id=$2 AND a.status <> 'DEACTIVATED'
      FOR UPDATE OF a`,
    [values.assignmentId, values.schoolId, values.academicTermId],
  );
  const assignment = assignmentResult.rows[0];
  if (!assignment) {
    throw new AuthError(404, "The active school transport assignment or requested academic term does not exist");
  }
  if (!feePlan.rows[0]) {
    await upsertTransportFeePlan(client, {
      schoolId: values.schoolId,
      assignmentId: values.assignmentId,
      academicSessionId: Number(assignment.academicSessionId),
      academicTermId: values.academicTermId,
      amountMinor: Number(assignment.fareMinor),
      dueDate: String(assignment.dueDate),
      actorUserId: values.actorUserId,
    });
    feePlan = await client.query(
      `SELECT id,academic_session_id AS "academicSessionId",
              academic_term_id AS "academicTermId",fee_category_id AS "feeCategoryId",
              amount_minor AS "amountMinor",due_date::text AS "dueDate",
              fee_invoice_id AS "feeInvoiceId",status
         FROM transport_fee_invoices
        WHERE school_id=$1 AND assignment_id=$2 AND academic_term_id=$3
        FOR UPDATE`,
      [values.schoolId, values.assignmentId, values.academicTermId],
    );
  }
  if (!feePlan.rows[0] || feePlan.rows[0].status !== "PLANNED") {
    throw new AuthError(409, "An active transport fee plan is required before invoice generation");
  }
  const feePlanRow = feePlan.rows[0];
  const amountMinor = Number(feePlanRow.amountMinor);
  if (amountMinor === 0) return null;
  const feeInvoiceCategoryId = Number(feePlanRow.feeCategoryId);
  if (!Number.isSafeInteger(feeInvoiceCategoryId) || feeInvoiceCategoryId < 1) {
    throw new AuthError(409, "The transport fee plan must reference an existing active Finance category");
  }
  const feeCategory = await client.query(
    `SELECT name FROM fee_categories
      WHERE id=$1 AND school_id=$2 AND status='ACTIVE'
      FOR SHARE`,
    [feeInvoiceCategoryId, values.schoolId],
  );
  if (!feeCategory.rows[0]) {
    throw new AuthError(409, "The selected Finance fee category is inactive; update the transport fee plan to an active category");
  }
  const amountCategoryName = String(feeCategory.rows[0].name);
  const invoiceNumber = `TRANS-${values.schoolId}-${values.academicTermId}-${values.assignmentId}`;
  const invoiceResult = await client.query(
    `INSERT INTO fee_invoices
       (school_id,student_id,parent_id,structure_id,academic_session_id,academic_term_id,
        invoice_number,student_name_snapshot,admission_no_snapshot,class_name_snapshot,section_snapshot,
        issue_date,due_date,currency,subtotal_minor,discount_minor,waiver_minor,total_minor,
        paid_minor,outstanding_minor,status,created_by)
     VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,$9,$10,CURRENT_DATE,$11,'NGN',$12,0,0,$12,0,$12,
             'UNPAID',$13)
     ON CONFLICT (school_id,invoice_number) DO NOTHING
     RETURNING id`,
    [
      values.schoolId,
      Number(assignment.studentId),
      assignment.parentId ? Number(assignment.parentId) : null,
      Number(assignment.academicSessionId),
      values.academicTermId,
      invoiceNumber,
      String(assignment.studentName),
      String(assignment.admissionNo),
      String(assignment.className),
      String(assignment.section),
      String(feePlanRow.dueDate),
      amountMinor,
      values.actorUserId,
    ],
  );
  let feeInvoiceId = invoiceResult.rows[0] ? Number(invoiceResult.rows[0].id) : null;
  const createdFinanceInvoice = feeInvoiceId !== null;
  if (feeInvoiceId === null) {
    const matching = await client.query(
      `SELECT id FROM fee_invoices
        WHERE school_id=$1 AND invoice_number=$2 AND student_id=$3
          AND academic_session_id=$4 AND academic_term_id=$5
          AND total_minor=$6 AND currency='NGN' AND structure_id IS NULL`,
      [
        values.schoolId,
        invoiceNumber,
        Number(assignment.studentId),
        Number(assignment.academicSessionId),
        values.academicTermId,
          amountMinor,
      ],
    );
    if (!matching.rows[0]) {
      throw new AuthError(409, "A conflicting school finance invoice uses the expected transport billing reference");
    }
    feeInvoiceId = Number(matching.rows[0].id);
  }
  if (createdFinanceInvoice) {
    await client.query(
      `INSERT INTO fee_invoice_lines
         (school_id,invoice_id,category_id,category_name_snapshot,description_snapshot,amount_minor)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        values.schoolId,
        feeInvoiceId,
        feeInvoiceCategoryId,
        amountCategoryName,
        `${amountCategoryName} for ${String(assignment.termName ?? "the academic term")}`,
        amountMinor,
      ],
    );
  } else {
    const financeLines = await client.query(
      `SELECT amount_minor AS "amountMinor",
              category_name_snapshot AS "categoryNameSnapshot"
         FROM fee_invoice_lines
        WHERE school_id=$1 AND invoice_id=$2
        FOR UPDATE`,
      [values.schoolId, feeInvoiceId],
    );
    if (
      financeLines.rows.length !== 1 ||
      Number(financeLines.rows[0].amountMinor) !== amountMinor ||
      String(financeLines.rows[0].categoryNameSnapshot) !== amountCategoryName
    ) {
      throw new AuthError(409, "The referenced school Finance invoice does not have the expected transport fee line");
    }
  }

  const linked = await client.query(
    `UPDATE transport_fee_invoices
        SET fee_invoice_id=$1,status='INVOICED',updated_by=$2,updated_at=NOW()
      WHERE id=$3 AND school_id=$4 AND status='PLANNED' AND fee_invoice_id IS NULL
      RETURNING id`,
    [feeInvoiceId, values.actorUserId, Number(feePlanRow.id), values.schoolId],
  );
  if (!linked.rows[0]) {
    throw new AuthError(409, "This assignment/term Finance invoice was linked concurrently; reload its fee plan");
  }
  await appendHistory(client, values.req, {
    schoolId: values.schoolId,
    entity: "assignment",
    entityId: values.assignmentId,
    studentId: Number(assignment.studentId),
    eventType: "TRANSPORT_TERM_FEE_INVOICE_CREATED",
    effectiveDate: String(assignment.effectiveDate),
    reason: values.effectiveReason,
    after: {
      feePlanId: Number(feePlanRow.id),
      feeInvoiceId,
      academicSessionId: Number(assignment.academicSessionId),
      academicTermId: values.academicTermId,
      feePlanAmountMinor: amountMinor,
      dueDate: String(feePlanRow.dueDate).slice(0, 10),
      feeCategoryId: feeInvoiceCategoryId,
    },
  });
  return feeInvoiceId;
}

export async function generateTransportInvoicesForAcademicTerm(
  schoolId: number,
  termId: number,
  req: Request,
) {
  const context = getUserContext(req);
  authorizeSchoolWrite(req, schoolId);
  return inTransaction(async (client) => {
    const termResult = await client.query(
      `SELECT t.id,t.school_id AS "schoolId",t.name,
              t.start_date::text AS "startDate",t.end_date::text AS "endDate",
              t.is_current AS "isCurrent",
              ac.id AS "academicSessionId",ac.name AS "sessionName",
              ac.is_current AS "sessionIsCurrent"
         FROM academic_terms t
         JOIN academic_sessions ac
           ON ac.id=t.academic_session_id AND ac.school_id=t.school_id
        WHERE t.id=$1 AND t.school_id=$2
        FOR UPDATE OF t`,
      [termId, schoolId],
    );
    const term = termResult.rows[0];
    if (!term) throw new AuthError(404, "Academic term not found");
    if (!term.isCurrent || !term.sessionIsCurrent) {
      throw new AuthError(409, "Transport term billing may only be generated for the current school session and term");
    }
    const role = actorRole(req, schoolId);
    const paymentPolicy = await getSchoolTransportPaymentPolicy(client, schoolId);
    const activeAssignments = await client.query(
      `SELECT id,student_id AS "studentId",status,
              effective_date::text AS "effectiveDate"
         FROM transport_student_assignments
        WHERE school_id=$1 AND status IN ('ACTIVE','SUSPENDED')
        ORDER BY id
        FOR UPDATE`,
      [schoolId],
    );
    const invoiceIds: number[] = [];
    for (const assignment of activeAssignments.rows) {
      const invoiceId = await ensureTransportInvoiceForTerm(client, {
        req,
        assignmentId: Number(assignment.id),
        schoolId,
        academicTermId: termId,
        actorUserId: context.user.id,
        actorRole: role,
        effectiveReason: `Idempotent Finance transport assessment for ${term.sessionName} ${term.name}`,
      });
      if (invoiceId !== null) invoiceIds.push(invoiceId);
      if (paymentPolicy.paymentRequired && assignment.status === "ACTIVE") {
        const plan = await client.query(
          `SELECT plan.id,plan.amount_minor AS "amountMinor",plan.status AS "planStatus",
                  invoice.outstanding_minor AS "outstandingMinor"
             FROM transport_fee_invoices plan
             LEFT JOIN fee_invoices invoice
               ON invoice.id=plan.fee_invoice_id AND invoice.school_id=plan.school_id
            WHERE plan.school_id=$1 AND plan.assignment_id=$2 AND plan.academic_term_id=$3`,
          [schoolId, Number(assignment.id), termId],
        );
        const currentPlan = plan.rows[0];
        if (
          currentPlan &&
          Number(currentPlan.amountMinor) > 0 &&
          (currentPlan.planStatus !== "INVOICED" || Number(currentPlan.outstandingMinor ?? 0) > 0)
        ) {
          await client.query(
            `UPDATE transport_student_assignments
                SET status='SUSPENDED',updated_at=NOW()
              WHERE id=$1 AND school_id=$2 AND status='ACTIVE'`,
            [Number(assignment.id), schoolId],
          );
          await appendHistory(client, req, {
            schoolId,
            entity: "assignment",
            entityId: Number(assignment.id),
            studentId: Number(assignment.studentId),
            eventType: "STUDENT_TRANSPORT_ASSIGNMENT_PAYMENT_GATED",
            effectiveDate: String(assignment.effectiveDate),
            reason: `Payment is required for transport in ${term.sessionName} ${term.name}`,
            before: { status: "ACTIVE" },
            after: {
              status: "SUSPENDED",
              feePlanId: Number(currentPlan.id),
              feePlanAmountMinor: Number(currentPlan.amountMinor),
              academicSessionId: Number(term.academicSessionId),
              academicTermId: termId,
            },
          });
        }
      }
    }
    return {
      schoolId,
      academicSessionId: Number(term.academicSessionId),
      academicTermId: termId,
      generatedInvoiceIds: invoiceIds,
      billableAssignmentCount: invoiceIds.length,
    };
  });
}

const transportAssignmentSelect = `
  SELECT a.id,a.school_id AS "schoolId",a.student_id AS "studentId",
         st.first_name || ' ' || st.last_name AS "studentName",
         st.admission_no AS "admissionNo",st.class_name AS "className",st.section,
         a.route_id AS "routeId",r.name AS "routeName",r.bus_id AS "busId",
         b.name AS "busName",b.registration_number AS "registrationNumber",
         b.capacity AS "busCapacity",
         r.driver_employee_id AS "driverEmployeeId",
         driver.first_name || ' ' || driver.last_name AS "driverName",
         pickup.id AS "pickupId",pickup.name AS "pickupName",
         pickup.stop_type AS "pickupType",pickup.sequence AS "pickupSequence",
         pickup.notes AS "pickupNotes",pickup.is_active AS "pickupIsActive",
         pickup.created_at AS "pickupCreatedAt",pickup.updated_at AS "pickupUpdatedAt",
         dropoff.id AS "dropoffId",dropoff.name AS "dropoffName",
         dropoff.stop_type AS "dropoffType",dropoff.sequence AS "dropoffSequence",
         dropoff.notes AS "dropoffNotes",dropoff.is_active AS "dropoffIsActive",
         dropoff.created_at AS "dropoffCreatedAt",dropoff.updated_at AS "dropoffUpdatedAt",
         r.weekdays,r.departure_time AS "departureTime",r.arrival_time AS "arrivalTime",
         r.fare_minor AS "fareMinor",r.currency AS "currency",
         a.status,a.effective_date::text AS "effectiveDate",a.end_date::text AS "endDate",
         a.reason,a.created_at AS "createdAt",a.updated_at AS "updatedAt",
         COALESCE(guardians.items,'[]'::jsonb) AS guardians,
          COALESCE(invoice_rows.items,'[]'::jsonb) AS invoices,
          COALESCE(fee_plan_rows.items,'[]'::jsonb) AS "feePlans"
    FROM transport_student_assignments a
    JOIN students st ON st.id=a.student_id AND st.school_id=a.school_id
    JOIN transport_routes r ON r.id=a.route_id AND r.school_id=a.school_id
    JOIN transport_buses b ON b.id=r.bus_id AND b.school_id=r.school_id
    JOIN employees driver ON driver.id=r.driver_employee_id AND driver.school_id=r.school_id
    JOIN transport_route_stops pickup
      ON pickup.id=a.pickup_stop_id AND pickup.route_id=a.route_id AND pickup.school_id=a.school_id
    JOIN transport_route_stops dropoff
      ON dropoff.id=a.dropoff_stop_id AND dropoff.route_id=a.route_id AND dropoff.school_id=a.school_id
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'name',parent.name,'phone',parent.phone,
          'relationshipType',relationship.relationship_type,
          'isPrimaryGuardian',relationship.is_primary_guardian
        )
        ORDER BY relationship.is_primary_guardian DESC,relationship.contact_priority,parent.id
      ) AS items
        FROM parent_student_relationships relationship
        JOIN parents parent
          ON parent.id=relationship.parent_id AND parent.school_id=st.school_id
         AND UPPER(parent.status)='ACTIVE'
       WHERE relationship.student_id=st.id AND UPPER(relationship.status)='ACTIVE'
    ) guardians ON TRUE
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(
        jsonb_build_object(
          'invoiceId',invoice.id,'invoiceNumber',invoice.invoice_number,
          'academicSessionId',invoice.academic_session_id,'sessionName',session.name,
          'academicTermId',invoice.academic_term_id,'termName',term.name,
          'currency',invoice.currency,'totalMinor',invoice.total_minor,
          'paidMinor',invoice.paid_minor,'outstandingMinor',invoice.outstanding_minor,
          'financeStatus',invoice.status,'dueDate',invoice.due_date,
          'receipts',COALESCE(receipt_rows.receipts,'[]'::jsonb)
        )
        ORDER BY term.start_date,term.id,invoice.id
      ) AS items
        FROM transport_fee_invoices transport_invoice
        JOIN fee_invoices invoice
          ON invoice.id=transport_invoice.fee_invoice_id
         AND invoice.school_id=transport_invoice.school_id
        JOIN academic_sessions session
          ON session.id=transport_invoice.academic_session_id
         AND session.school_id=transport_invoice.school_id
        JOIN academic_terms term
          ON term.id=transport_invoice.academic_term_id
         AND term.school_id=transport_invoice.school_id
        LEFT JOIN LATERAL (
          SELECT jsonb_agg(jsonb_build_object('id',receipt.id,'receiptNumber',receipt.receipt_number)
                           ORDER BY receipt.id) AS receipts
            FROM fee_receipts receipt
           WHERE receipt.school_id=transport_invoice.school_id
             AND receipt.invoice_id=transport_invoice.fee_invoice_id
        ) receipt_rows ON TRUE
       WHERE transport_invoice.school_id=a.school_id
         AND transport_invoice.assignment_id=a.id
    ) invoice_rows ON TRUE
     LEFT JOIN LATERAL (
       SELECT jsonb_agg(
         jsonb_build_object(
           'feePlanId',plan.id,
           'academicSessionId',plan.academic_session_id,'sessionName',session.name,
           'academicTermId',plan.academic_term_id,'termName',term.name,
           'feePlanAmountMinor',plan.amount_minor,'currency','NGN',
           'dueDate',plan.due_date,'status',plan.status,
           'feeCategoryId',plan.fee_category_id,'feeCategoryName',category.name,
           'invoiceId',plan.fee_invoice_id
         )
         ORDER BY term.start_date,term.id,plan.id
       ) AS items
         FROM transport_fee_invoices plan
         JOIN academic_sessions session
           ON session.id=plan.academic_session_id AND session.school_id=plan.school_id
         JOIN academic_terms term
           ON term.id=plan.academic_term_id AND term.school_id=plan.school_id
         LEFT JOIN fee_categories category
           ON category.id=plan.fee_category_id AND category.school_id=plan.school_id
        WHERE plan.school_id=a.school_id AND plan.assignment_id=a.id
     ) fee_plan_rows ON TRUE
`;

function jsonArray(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) return value as JsonRecord[];
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed as JsonRecord[] : [];
    } catch {
      throw new AuthError(500, "Transport response data could not be decoded");
    }
  }
  return [];
}

function mapInvoiceShape(
  raw: JsonRecord,
  assignmentStatus: string,
  suspendWhenOverdue: boolean,
  currentDate?: string,
) {
  const outstandingMinor = Number(raw.outstandingMinor);
  const receipts = jsonArray(raw.receipts).map((receipt) => ({
    id: Number(receipt.id),
    receiptNumber: String(receipt.receiptNumber),
  }));
  return {
    invoiceId: Number(raw.invoiceId),
    invoiceNumber: String(raw.invoiceNumber),
    academicSessionId: Number(raw.academicSessionId),
    sessionName: String(raw.sessionName),
    academicTermId: Number(raw.academicTermId),
    termName: String(raw.termName),
    currency: String(raw.currency),
    totalMinor: Number(raw.totalMinor),
    paidMinor: Number(raw.paidMinor),
    outstandingMinor,
    status: projectTransportInvoiceStatus({
      outstandingMinor,
      feeStatus: String(raw.financeStatus),
      dueDate: String(raw.dueDate).slice(0, 10),
      assignmentStatus,
      suspendWhenOverdue,
      ...(currentDate ? { currentDate } : {}),
    }),
    dueDate: String(raw.dueDate).slice(0, 10),
    receipts,
  };
}

async function getSchoolTransportPaymentPolicy(
  client: DbClient,
  schoolId: number,
  lock = false,
) {
  if (lock) {
    const school = await client.query(
      `SELECT id FROM schools WHERE id=$1 FOR KEY SHARE`,
      [schoolId],
    );
    if (!school.rows[0]) throw new AuthError(404, "School not found");
  }
  const result = await client.query(
    `SELECT payment_required AS "paymentRequired",
            suspend_when_overdue AS "suspendWhenOverdue"
       FROM transport_school_policies WHERE school_id=$1 ${lock ? "FOR SHARE" : ""}`,
    [schoolId],
  );
  return {
    paymentRequired: Boolean(result.rows[0]?.paymentRequired),
    suspendWhenOverdue: Boolean(result.rows[0]?.suspendWhenOverdue),
  };
}

async function assignmentShape(
  client: DbClient,
  schoolId: number,
  assignmentId: number,
  policy?: { suspendWhenOverdue: boolean },
) {
  const response = await client.query(
    `${transportAssignmentSelect}
      WHERE a.school_id=$1 AND a.id=$2`,
    [schoolId, assignmentId],
  );
  const row = response.rows[0] as JsonRecord | undefined;
  if (!row) throw new AuthError(404, "Transport assignment not found");
  const invoicePolicy = policy ?? await getSchoolTransportPaymentPolicy(client, schoolId);
  const invoices = jsonArray(row.invoices).map((invoice) =>
    mapInvoiceShape(invoice, String(row.status), invoicePolicy.suspendWhenOverdue),
  );
  const feePlans = jsonArray(row.feePlans).map((plan) => ({
    feePlanId: Number(plan.feePlanId),
    academicSessionId: Number(plan.academicSessionId),
    sessionName: String(plan.sessionName),
    academicTermId: Number(plan.academicTermId),
    termName: String(plan.termName),
    feePlanAmountMinor: Number(plan.feePlanAmountMinor),
    currency: String(plan.currency),
    dueDate: String(plan.dueDate).slice(0, 10),
    status: String(plan.status),
    feeCategoryId: plan.feeCategoryId === null ? null : Number(plan.feeCategoryId),
    feeCategoryName: plan.feeCategoryName === null ? null : String(plan.feeCategoryName),
    invoiceId: plan.invoiceId === null ? null : Number(plan.invoiceId),
  }));
  const currentFeePlan = feePlans[feePlans.length - 1] ?? null;
  const status = invoicePolicy.suspendWhenOverdue &&
    String(row.status) === "ACTIVE" &&
    invoices.some((invoice) => invoice.status === "SUSPENDED")
      ? "SUSPENDED"
      : String(row.status);
  const stop = (
    stopId: unknown,
    name: unknown,
    stopType: unknown,
    sequence: unknown,
    notes: unknown,
    isActive: unknown,
    createdAt: unknown,
    updatedAt: unknown,
  ) => ({
    id: Number(stopId),
    routeId: Number(row.routeId),
    schoolId,
    name: String(name),
    stopType: String(stopType),
    sequence: Number(sequence),
    notes,
    isActive: Boolean(isActive),
    createdAt,
    updatedAt,
  });
  return {
    id: Number(row.id),
    schoolId,
    studentId: Number(row.studentId),
    studentName: String(row.studentName),
    admissionNo: String(row.admissionNo),
    className: String(row.className),
    section: String(row.section),
    busId: Number(row.busId),
    busName: String(row.busName),
    registrationNumber: String(row.registrationNumber),
    busCapacity: Number(row.busCapacity),
    routeId: Number(row.routeId),
    routeName: String(row.routeName),
    driverEmployeeId: Number(row.driverEmployeeId),
    driverName: String(row.driverName),
    pickup: stop(row.pickupId,row.pickupName,row.pickupType,row.pickupSequence,
      row.pickupNotes,row.pickupIsActive,row.pickupCreatedAt,row.pickupUpdatedAt),
    dropoff: stop(row.dropoffId,row.dropoffName,row.dropoffType,row.dropoffSequence,
      row.dropoffNotes,row.dropoffIsActive,row.dropoffCreatedAt,row.dropoffUpdatedAt),
    schedule: {
      weekdays: row.weekdays,
      departureTime: String(row.departureTime),
      arrivalTime: String(row.arrivalTime),
    },
    weekdays: row.weekdays,
    departureTime: String(row.departureTime),
    arrivalTime: String(row.arrivalTime),
    status,
    effectiveDate: String(row.effectiveDate).slice(0, 10),
    endDate: row.endDate === null ? null : String(row.endDate).slice(0, 10),
    reason: String(row.reason),
    feeMinor: Number(row.fareMinor),
    feePlanAmountMinor: currentFeePlan?.feePlanAmountMinor ?? Number(row.fareMinor),
    academicSessionId: currentFeePlan?.academicSessionId ?? null,
    academicTermId: currentFeePlan?.academicTermId ?? null,
    dueDate: currentFeePlan?.dueDate ?? null,
    feeCategoryId: currentFeePlan?.feeCategoryId ?? null,
    currency: String(row.currency),
    guardians: jsonArray(row.guardians).map((guardian) => ({
      name: String(guardian.name),
      phone: String(guardian.phone),
      relationshipType: String(guardian.relationshipType),
      isPrimaryGuardian: Boolean(guardian.isPrimaryGuardian),
    })),
    feePlans,
    invoices,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function scheduleForActiveView(
  weekdays: unknown,
  departureTime: unknown,
  arrivalTime: unknown,
) {
  return {
    weekdays,
    departureTime,
    arrivalTime,
  };
}

router.get("/transport/students", run(async (req, res) => {
  const schoolId = querySchoolId(req);
  authorizeSchoolRead(req, schoolId);
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
  const rawLimit = req.query.limit === undefined ? 20 : requireRecordId(req.query.limit, "limit");
  if (rawLimit > 50) throw new AuthError(400, "limit cannot exceed 50 student directory results");
  const result = await pool.query(
    `SELECT st.id AS "studentId",st.school_id AS "schoolId",
            st.first_name || ' ' || st.last_name AS "studentName",
            st.admission_no AS "admissionNo",st.class_name AS "className",st.section,
            COALESCE(guardian_rows.items,'[]'::jsonb) AS guardians,
            COALESCE(assignment_row.assignment,'null'::jsonb) AS "activeAssignment"
       FROM students st
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(
           jsonb_build_object('name',p.name,'phone',p.phone,'relationshipType',psr.relationship_type,
                              'isPrimaryGuardian',psr.is_primary_guardian)
           ORDER BY psr.is_primary_guardian DESC,psr.contact_priority,psr.parent_id
         ) AS items
           FROM parent_student_relationships psr
           JOIN parents p
             ON p.id=psr.parent_id AND p.school_id=st.school_id AND UPPER(p.status)='ACTIVE'
          WHERE psr.student_id=st.id AND UPPER(psr.status)='ACTIVE'
       ) guardian_rows ON TRUE
       LEFT JOIN LATERAL (
         SELECT to_jsonb((
           SELECT t
             FROM (
               SELECT a.id, a.status, a.route_id AS "routeId",r.name AS "routeName",
                      r.bus_id AS "busId",b.name AS "busName",a.effective_date::text AS "effectiveDate"
                 FROM transport_student_assignments a
                 JOIN transport_routes r ON r.id=a.route_id AND r.school_id=a.school_id
                 JOIN transport_buses b ON b.id=r.bus_id AND b.school_id=r.school_id
                WHERE a.student_id=st.id AND a.school_id=st.school_id
                  AND a.status IN ('ACTIVE','SUSPENDED')
                ORDER BY a.id DESC LIMIT 1
             ) t
         )) AS assignment
       ) assignment_row ON TRUE
      WHERE st.school_id=$1 AND UPPER(st.status)='ACTIVE'
        AND ($2::text='' OR
             st.admission_no ILIKE '%' || $2 || '%' OR
             st.first_name ILIKE '%' || $2 || '%' OR
             st.last_name ILIKE '%' || $2 || '%' OR
             st.class_name ILIKE '%' || $2 || '%' OR
             st.section ILIKE '%' || $2 || '%')
      ORDER BY st.first_name,st.last_name,st.admission_no
      LIMIT $3`,
    [schoolId, search, rawLimit],
  );
  res.json(result.rows.map((row) => ({
    studentId: Number(row.studentId),
    schoolId: Number(row.schoolId),
    studentName: String(row.studentName),
    admissionNo: String(row.admissionNo),
    className: String(row.className),
    section: String(row.section),
    guardians: jsonArray(row.guardians).map((guardian) => ({
      name: String(guardian.name),
      phone: String(guardian.phone),
      relationshipType: String(guardian.relationshipType),
      isPrimaryGuardian: Boolean(guardian.isPrimaryGuardian),
    })),
    activeAssignment: row.activeAssignment && typeof row.activeAssignment === "object"
      ? row.activeAssignment
      : null,
  })));
}));

router.get("/transport/assignments", run(async (req, res) => {
  const schoolId = querySchoolId(req);
  authorizeSchoolRead(req, schoolId);
  const status = req.query.status === undefined || req.query.status === "all"
    ? null
    : oneOf(req.query.status, ["ACTIVE", "SUSPENDED", "DEACTIVATED"] as const, "status");
  const studentId = req.query.studentId === undefined
    ? null
    : requireRecordId(req.query.studentId, "studentId");
  const result = await pool.query(
    `${transportAssignmentSelect}
      WHERE a.school_id=$1 AND ($2::text IS NULL OR a.status=$2)
        AND ($3::int IS NULL OR a.student_id=$3)
      ORDER BY a.status,a.effective_date DESC,a.student_id,a.id DESC
      LIMIT 500`,
    [schoolId, status, studentId],
  );
  const policy = await getSchoolTransportPaymentPolicy(pool, schoolId);
  const projected = result.rows.map((row) => row as JsonRecord);
  const mapped = [];
  for (const row of projected) {
    mapped.push(await assignmentShape(pool, schoolId, Number(row.id), policy));
  }
  res.json(mapped);
}));

router.get("/transport/assignments/:assignmentId", run(async (req, res) => {
  const schoolId = querySchoolId(req);
  authorizeSchoolRead(req, schoolId);
  const assignmentId = requestId(req.params.assignmentId, "assignmentId");
  res.json(await assignmentShape(pool, schoolId, assignmentId));
}));

router.post("/transport/assignments", run(async (req, res) => {
  const schoolId = querySchoolId(req);
  const context = authorizeSchoolWrite(req, schoolId);
  const body = record(req.body, [
    "studentId", "routeId", "pickupStopId", "dropoffStopId", "effectiveDate", "reason",
    "academicSessionId", "academicTermId", "feePlanAmountMinor", "dueDate", "feeCategoryId",
  ]);
  const studentId = requireRecordId(body.studentId, "studentId");
  const routeId = requireRecordId(body.routeId, "routeId");
  const pickupStopId = requireRecordId(body.pickupStopId, "pickupStopId");
  const dropoffStopId = requireRecordId(body.dropoffStopId, "dropoffStopId");
  const effectiveDate = requireTransportDate(body.effectiveDate, "effectiveDate");
  const reason = requireReason(body.reason);
  const requestedFeePlan = transportFeePlanInput(body);
  const id = await inTransaction(async (client) => {
    const paymentPolicy = await getSchoolTransportPaymentPolicy(client, schoolId, true);
    const student = await client.query(
      `SELECT id FROM students
        WHERE id=$1 AND school_id=$2 AND UPPER(status)='ACTIVE'
        FOR UPDATE`,
      [studentId, schoolId],
    );
    if (!student.rows[0]) throw new AuthError(404, "Existing active student not found in this school");
    const existing = await client.query(
      `SELECT id FROM transport_student_assignments
        WHERE student_id=$1 AND school_id=$2 AND status IN ('ACTIVE','SUSPENDED')
        LIMIT 1`,
      [studentId, schoolId],
    );
    if (existing.rows[0]) throw new AuthError(409, "The student already has an active or suspended transport assignment");
    const selectedRoute = await client.query(
      `SELECT r.id,r.school_id AS "schoolId",r.name,r.bus_id AS "busId",
              r.driver_employee_id AS "driverEmployeeId",r.weekdays,
              r.fare_minor AS "fareMinor",r.status AS "routeStatus",
              bus.capacity AS "busCapacity",bus.status AS "busStatus"
         FROM transport_routes r
         JOIN transport_buses bus ON bus.id=r.bus_id AND bus.school_id=r.school_id
        WHERE r.id=$1 AND r.school_id=$2
        FOR SHARE OF r`,
      [routeId, schoolId],
    );
    const route = selectedRoute.rows[0];
    if (!route) throw new AuthError(404, "Transport route not found in this school");
    if (route.routeStatus !== "ACTIVE") throw new AuthError(409, "An inactive route cannot receive student assignments");
    await assertStopPairUsesBusSchedule(client, schoolId, routeId, Number(route.busId), effectiveDate);
    const { pickup } = await validateRouteStopPair(client, schoolId, routeId, pickupStopId, dropoffStopId);
    if (!pickup) throw new AuthError(404, "Pickup stop not found");
    const bus = await requireSchoolBus(client, schoolId, Number(route.busId), { lock: true, active: true });
    const reservedCount = await countReservedBusPassengers(client, schoolId, Number(route.busId));
    ensureTransportSeatAvailable(Number(bus.capacity), reservedCount);
    const term = await currentTransportTerm(client, schoolId);
    const feePlanTerm = requestedFeePlan.academicTermId !== undefined
      ? await transportTermPlanContext(
        client,
        schoolId,
        requestedFeePlan.academicSessionId!,
        requestedFeePlan.academicTermId,
        true,
      )
      : term;
    const hasRequestedFeePlan = Object.keys(requestedFeePlan).length > 0;
    if (hasRequestedFeePlan && !feePlanTerm) {
      throw new AuthError(409, "A school academic term is required to save an explicit transport fee plan");
    }
    const feePlanAmountMinor = resolveTransportFeePlanAmount(
      requestedFeePlan.feePlanAmountMinor,
      Number(route.fareMinor),
    );
    const feePlanDueDate = feePlanTerm
      ? resolveTransportFeePlanDueDate(
        requestedFeePlan.dueDate,
        feePlanTerm.startDate,
        feePlanTerm.endDate,
      )
      : undefined;
    const feePlanMatchesCurrentTerm = Boolean(
      feePlanTerm && term &&
      transportTermId(feePlanTerm) === term.id &&
      Number(feePlanTerm.academicSessionId) === term.academicSessionId,
    );
    if (
      paymentPolicy.paymentRequired &&
      feePlanAmountMinor > 0 &&
      (!term || !feePlanMatchesCurrentTerm)
    ) {
      throw new AuthError(409, "Payment-gated transport assignments require a fee plan for the school's current academic term");
    }
    const status: "ACTIVE" | "SUSPENDED" =
      paymentPolicy.paymentRequired && feePlanAmountMinor > 0
        ? "SUSPENDED"
        : "ACTIVE";
    const assignmentResult = await client.query(
      `INSERT INTO transport_student_assignments
         (school_id,student_id,route_id,pickup_stop_id,dropoff_stop_id,status,effective_date,reason,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [schoolId, studentId, routeId, pickupStopId, dropoffStopId, status, effectiveDate, reason, context.user.id],
    );
    const assignmentId = Number(assignmentResult.rows[0].id);
    if (feePlanTerm && (feePlanAmountMinor > 0 || hasRequestedFeePlan)) {
      await upsertTransportFeePlan(client, {
        schoolId,
        assignmentId,
        academicSessionId: Number(feePlanTerm.academicSessionId),
        academicTermId: transportTermId(feePlanTerm),
        amountMinor: feePlanAmountMinor,
        ...(feePlanDueDate ? { dueDate: feePlanDueDate } : {}),
        ...(requestedFeePlan.feeCategoryId === undefined ? {} : { feeCategoryId: requestedFeePlan.feeCategoryId }),
        actorUserId: context.user.id,
      });
    }
    if (term && feePlanMatchesCurrentTerm && feePlanAmountMinor > 0) {
      await ensureTransportInvoiceForTerm(client, {
        req,
        assignmentId,
        schoolId,
        academicTermId: term.id,
        actorUserId: context.user.id,
        actorRole: actorRole(req, schoolId),
        effectiveReason: `Transport fee invoice for ${term.sessionName} ${term.termName}`,
      });
    }
    if (status === "SUSPENDED") {
      const unpaid = await client.query(
        `SELECT i.id
           FROM transport_fee_invoices link
           JOIN fee_invoices i ON i.id=link.fee_invoice_id AND i.school_id=link.school_id
          WHERE link.assignment_id=$1 AND link.school_id=$2
            AND link.academic_term_id=$3
            AND i.outstanding_minor>0
          LIMIT 1`,
        [assignmentId, schoolId, term!.id],
      );
      if (!unpaid.rows[0]) {
        await client.query(
          `UPDATE transport_student_assignments
              SET status='ACTIVE',updated_at=NOW()
            WHERE id=$1 AND school_id=$2`,
          [assignmentId, schoolId],
        );
      }
    }
    const created = await client.query(
      `${transportAssignmentSelect} WHERE a.id=$1 AND a.school_id=$2`,
      [assignmentId, schoolId],
    );
    const after = mapAssignmentRow(created.rows[0], paymentPolicy);
    await appendHistory(client, req, {
      schoolId,
      entity: "assignment",
      entityId: assignmentId,
      studentId,
      eventType: after.status === "SUSPENDED" ? "STUDENT_TRANSPORT_ASSIGNMENT_PAYMENT_GATED" : "STUDENT_TRANSPORT_ASSIGNED",
      effectiveDate,
      reason: after.status === "SUSPENDED" ? `Payment is required before transport activation. ${reason}` : reason,
      after,
    });
    return assignmentId;
  });
  const row = await assignmentShape(pool, schoolId, id);
  res.status(201).json(row);
}));

router.put("/transport/assignments/:assignmentId/fee-plans/:academicTermId", run(async (req, res) => {
  const schoolId = querySchoolId(req);
  const context = authorizeSchoolWrite(req, schoolId);
  const assignmentId = requestId(req.params.assignmentId, "assignmentId");
  const academicTermId = requestId(req.params.academicTermId, "academicTermId");
  const body = record(req.body, [
    "academicSessionId", "feePlanAmountMinor", "dueDate", "feeCategoryId", "reason",
  ]);
  const academicSessionId = requireRecordId(body.academicSessionId, "academicSessionId");
  if (body.feePlanAmountMinor === undefined) {
    throw new AuthError(400, "feePlanAmountMinor is required");
  }
  const amountMinor = requireTransportAmountMinor(body.feePlanAmountMinor, "feePlanAmountMinor");
  const dueDate = body.dueDate === undefined ? undefined : requireTransportDate(body.dueDate, "dueDate");
  const feeCategoryId = body.feeCategoryId === undefined
    ? undefined
    : requireRecordId(body.feeCategoryId, "feeCategoryId");
  const reason = requireReason(body.reason);
  await inTransaction(async (client) => {
    const assignment = await client.query(
      `SELECT id,student_id AS "studentId",status,effective_date::text AS "effectiveDate"
         FROM transport_student_assignments
        WHERE id=$1 AND school_id=$2
        FOR UPDATE`,
      [assignmentId, schoolId],
    );
    if (!assignment.rows[0]) throw new AuthError(404, "Transport assignment not found");
    if (assignment.rows[0].status === "DEACTIVATED") {
      throw new AuthError(409, "A deactivated assignment cannot receive a new fee plan");
    }
    const before = await assignmentShape(client, schoolId, assignmentId);
    const term = await transportTermPlanContext(client, schoolId, academicSessionId, academicTermId, true);
    const policy = await getSchoolTransportPaymentPolicy(client, schoolId, true);
    await upsertTransportFeePlan(client, {
      schoolId,
      assignmentId,
      academicSessionId,
      academicTermId,
      amountMinor,
      ...(dueDate ? { dueDate } : {}),
      ...(feeCategoryId === undefined ? {} : { feeCategoryId }),
      actorUserId: context.user.id,
    });
    if (term.termIsCurrent && term.sessionIsCurrent && amountMinor > 0) {
      await ensureTransportInvoiceForTerm(client, {
        req,
        assignmentId,
        schoolId,
        academicTermId,
        actorUserId: context.user.id,
        actorRole: actorRole(req, schoolId),
        effectiveReason: `Updated transport fee plan for academic term ${academicTermId}`,
      });
      if (policy.paymentRequired) {
        await client.query(
          `UPDATE transport_student_assignments
              SET status='SUSPENDED',updated_at=NOW()
            WHERE id=$1 AND school_id=$2 AND status='ACTIVE'`,
          [assignmentId, schoolId],
        );
        const outstanding = await client.query(
          `SELECT 1 FROM transport_fee_invoices link
             JOIN fee_invoices invoice
               ON invoice.id=link.fee_invoice_id AND invoice.school_id=link.school_id
            WHERE link.assignment_id=$1 AND link.school_id=$2
              AND link.academic_term_id=$3 AND invoice.outstanding_minor>0
            LIMIT 1`,
          [assignmentId, schoolId, academicTermId],
        );
        if (!outstanding.rows[0]) {
          await client.query(
            `UPDATE transport_student_assignments
                SET status='ACTIVE',updated_at=NOW()
              WHERE id=$1 AND school_id=$2 AND status='SUSPENDED'`,
            [assignmentId, schoolId],
          );
        }
      }
    }
    const after = await assignmentShape(client, schoolId, assignmentId, policy);
    await appendHistory(client, req, {
      schoolId,
      entity: "assignment",
      entityId: assignmentId,
      studentId: Number(assignment.rows[0].studentId),
      eventType: "TRANSPORT_ASSIGNMENT_FEE_PLAN_UPDATED",
      effectiveDate: String(assignment.rows[0].effectiveDate),
      reason,
      before,
      after,
    });
  });
  res.json(await assignmentShape(pool, schoolId, assignmentId));
}));

router.patch("/transport/assignments/:assignmentId/fee-plans/:academicTermId", run(async (req, res) => {
  const schoolId = querySchoolId(req);
  const context = authorizeSchoolWrite(req, schoolId);
  const assignmentId = requestId(req.params.assignmentId, "assignmentId");
  const academicTermId = requestId(req.params.academicTermId, "academicTermId");
  const body = record(req.body, ["status", "reason"]);
  const status = oneOf(body.status, ["CANCELLED"] as const, "status");
  const reason = requireReason(body.reason);
  await inTransaction(async (client) => {
    const assignment = await client.query(
      `SELECT id,student_id AS "studentId",status,effective_date::text AS "effectiveDate"
         FROM transport_student_assignments
        WHERE id=$1 AND school_id=$2
        FOR UPDATE`,
      [assignmentId, schoolId],
    );
    if (!assignment.rows[0]) throw new AuthError(404, "Transport assignment not found");
    const before = await assignmentShape(client, schoolId, assignmentId);
    const plan = await client.query(
      `SELECT id,amount_minor AS "amountMinor",fee_invoice_id AS "feeInvoiceId",status
         FROM transport_fee_invoices
        WHERE school_id=$1 AND assignment_id=$2 AND academic_term_id=$3
        FOR UPDATE`,
      [schoolId, assignmentId, academicTermId],
    );
    if (!plan.rows[0]) throw new AuthError(404, "Transport assignment fee plan not found");
    if (plan.rows[0].feeInvoiceId !== null) {
      throw new AuthError(409, "An invoiced fee cannot be cancelled here; use the existing school Finance workflows");
    }
    if (plan.rows[0].status === "CANCELLED") {
      throw new AuthError(409, "This transport fee plan is already cancelled");
    }
    const policy = await getSchoolTransportPaymentPolicy(client, schoolId, true);
    if (
      policy.paymentRequired &&
      Number(plan.rows[0].amountMinor) > 0 &&
      assignment.rows[0].status !== "DEACTIVATED"
    ) {
      throw new AuthError(409, "A positive fee plan cannot be cancelled while payment-gated transport is configured for an active or suspended assignment");
    }
    await client.query(
      `UPDATE transport_fee_invoices
          SET status=$1,updated_by=$2,updated_at=NOW()
        WHERE id=$3 AND school_id=$4 AND fee_invoice_id IS NULL`,
      [status, context.user.id, Number(plan.rows[0].id), schoolId],
    );
    const after = await assignmentShape(client, schoolId, assignmentId, policy);
    await appendHistory(client, req, {
      schoolId,
      entity: "assignment",
      entityId: assignmentId,
      studentId: Number(assignment.rows[0].studentId),
      eventType: "TRANSPORT_ASSIGNMENT_FEE_PLAN_CANCELLED",
      effectiveDate: String(assignment.rows[0].effectiveDate),
      reason,
      before,
      after,
    });
  });
  res.json(await assignmentShape(pool, schoolId, assignmentId));
}));

function mapAssignmentRow(
  row: JsonRecord,
  policy: { suspendWhenOverdue: boolean },
) {
  const mapped = { ...row, invoices: jsonArray(row.invoices) };
  const full = mapRawAssignmentToApiShape(mapped);
  full.invoices = jsonArray(row.invoices).map((invoice) =>
    mapInvoiceShape(invoice, String(row.status), policy.suspendWhenOverdue),
  );
  if (
    policy.suspendWhenOverdue &&
    String(row.status) === "ACTIVE" &&
    full.invoices.some((invoice) => invoice.status === "SUSPENDED")
  ) {
    full.status = "SUSPENDED";
  }
  return full;
}

function mapRawAssignmentToApiShape(row: JsonRecord) {
  const feePlans = jsonArray(row.feePlans).map((plan) => ({
    feePlanId: Number(plan.feePlanId),
    academicSessionId: Number(plan.academicSessionId),
    sessionName: String(plan.sessionName),
    academicTermId: Number(plan.academicTermId),
    termName: String(plan.termName),
    feePlanAmountMinor: Number(plan.feePlanAmountMinor),
    currency: String(plan.currency),
    dueDate: String(plan.dueDate).slice(0, 10),
    status: String(plan.status),
    feeCategoryId: plan.feeCategoryId === null ? null : Number(plan.feeCategoryId),
    feeCategoryName: plan.feeCategoryName === null ? null : String(plan.feeCategoryName),
    invoiceId: plan.invoiceId === null ? null : Number(plan.invoiceId),
  }));
  const currentFeePlan = feePlans[feePlans.length - 1] ?? null;
  return {
    id: Number(row.id),
    schoolId: Number(row.schoolId),
    studentId: Number(row.studentId),
    studentName: String(row.studentName),
    admissionNo: String(row.admissionNo),
    className: String(row.className),
    section: String(row.section),
    busId: Number(row.busId),
    busName: String(row.busName),
    registrationNumber: String(row.registrationNumber),
    busCapacity: Number(row.busCapacity),
    routeId: Number(row.routeId),
    routeName: String(row.routeName),
    driverEmployeeId: Number(row.driverEmployeeId),
    driverName: String(row.driverName),
    pickup: {
      id: Number(row.pickupId), routeId: Number(row.routeId), schoolId: Number(row.schoolId),
      name: String(row.pickupName), stopType: String(row.pickupType), sequence: Number(row.pickupSequence),
      notes: row.pickupNotes ?? null, isActive: Boolean(row.pickupIsActive),
      createdAt: row.pickupCreatedAt, updatedAt: row.pickupUpdatedAt,
    },
    dropoff: {
      id: Number(row.dropoffId), routeId: Number(row.routeId), schoolId: Number(row.schoolId),
      name: String(row.dropoffName), stopType: String(row.dropoffType), sequence: Number(row.dropoffSequence),
      notes: row.dropoffNotes ?? null, isActive: Boolean(row.dropoffIsActive),
      createdAt: row.dropoffCreatedAt, updatedAt: row.dropoffUpdatedAt,
    },
    schedule: {
      weekdays: row.weekdays,
      departureTime: String(row.departureTime),
      arrivalTime: String(row.arrivalTime),
    },
    weekdays: row.weekdays,
    departureTime: String(row.departureTime),
    arrivalTime: String(row.arrivalTime),
    status: String(row.status),
    effectiveDate: String(row.effectiveDate).slice(0, 10),
    endDate: row.endDate === null ? null : String(row.endDate).slice(0, 10),
    reason: String(row.reason),
    feeMinor: Number(row.fareMinor),
    feePlanAmountMinor: currentFeePlan?.feePlanAmountMinor ?? Number(row.fareMinor),
    academicSessionId: currentFeePlan?.academicSessionId ?? null,
    academicTermId: currentFeePlan?.academicTermId ?? null,
    dueDate: currentFeePlan?.dueDate ?? null,
    feeCategoryId: currentFeePlan?.feeCategoryId ?? null,
    currency: String(row.currency),
    guardians: jsonArray(row.guardians).map((guardian) => ({
      name: String(guardian.name),
      phone: String(guardian.phone),
      relationshipType: String(guardian.relationshipType),
      isPrimaryGuardian: Boolean(guardian.isPrimaryGuardian),
    })),
    feePlans,
    invoices: [] as JsonRecord[],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function checkTransportActivationPaymentGate(
  client: DbClient,
  req: Request,
  schoolId: number,
  assignmentId: number,
  routeId: number,
) {
  const policy = await getSchoolTransportPaymentPolicy(client, schoolId);
  if (!policy.paymentRequired) return;
  const route = await client.query(
    `SELECT fare_minor AS "fareMinor" FROM transport_routes WHERE id=$1 AND school_id=$2`,
    [routeId, schoolId],
  );
  if (!route.rows[0]) throw new AuthError(404, "Transport route not found");
  const term = await currentTransportTerm(client, schoolId);
  if (!term) {
    if (Number(route.rows[0].fareMinor) === 0) return;
    throw new AuthError(409, "No active school term exists; fee-gated transport cannot be activated");
  }
  const context = getUserContext(req);
  await ensureTransportInvoiceForTerm(client, {
    req,
    assignmentId,
    schoolId,
    academicTermId: term.id,
    actorUserId: context.user.id,
    actorRole: actorRole(req, schoolId),
    effectiveReason: `Idempotent Finance transport assessment for ${term.sessionName} ${term.termName}`,
  });
  const fee = await client.query(
    `SELECT plan.amount_minor AS "amountMinor",plan.status AS "planStatus",
            invoice.outstanding_minor AS "outstandingMinor",
            invoice.total_minor AS "totalMinor"
       FROM transport_fee_invoices plan
       LEFT JOIN fee_invoices invoice
         ON invoice.id=plan.fee_invoice_id AND invoice.school_id=plan.school_id
      WHERE plan.assignment_id=$1 AND plan.school_id=$2 AND plan.academic_term_id=$3`,
    [assignmentId, schoolId, term.id],
  );
  if (!fee.rows[0] || fee.rows[0].planStatus === "CANCELLED") {
    throw new AuthError(409, "An active transport fee plan is required before payment-gated activation");
  }
  if (Number(fee.rows[0].amountMinor) === 0) return;
  if (
    fee.rows[0].planStatus !== "INVOICED" ||
    fee.rows[0].outstandingMinor === null ||
    Number(fee.rows[0].outstandingMinor) > 0
  ) {
    throw new AuthError(409, "The current transport Finance invoice must be fully paid before activation");
  }
}

router.patch("/transport/assignments/:assignmentId", run(async (req, res) => {
  const schoolId = querySchoolId(req);
  const context = authorizeSchoolWrite(req, schoolId);
  const assignmentId = requestId(req.params.assignmentId, "assignmentId");
  const body = record(req.body, [
    "routeId", "pickupStopId", "dropoffStopId", "status", "action", "effectiveDate", "reason",
  ]);
  const effectiveDate = requireTransportDate(body.effectiveDate, "effectiveDate");
  const reason = requireReason(body.reason);
  const nextStatus = body.status === undefined
    ? undefined
    : oneOf(body.status, ["ACTIVE", "SUSPENDED", "DEACTIVATED"] as const, "status");
  const requestedAction = body.action === undefined
    ? undefined
    : oneOf(body.action, ["ASSIGN_BUS", "CHANGE_ROUTE", "CHANGE_STOPS", "ACTIVATE", "SUSPEND", "DEACTIVATE"] as const, "action");
  const routeChanged = body.routeId !== undefined;
  const pickupChanged = body.pickupStopId !== undefined;
  const dropoffChanged = body.dropoffStopId !== undefined;
  const statusChanged = nextStatus !== undefined;
  if (!routeChanged && !pickupChanged && !dropoffChanged && !statusChanged) {
    throw new AuthError(400, "Specify a bus/route/stop change or a new service status");
  }
  if (routeChanged && (!pickupChanged || !dropoffChanged)) {
    throw new AuthError(400, "Changing routes requires new pickupStopId and dropoffStopId on that route");
  }
  const action = requestedAction ?? (
    nextStatus === "DEACTIVATED" ? "DEACTIVATE" :
      nextStatus === "SUSPENDED" ? "SUSPEND" :
        nextStatus === "ACTIVE" ? "ACTIVATE" :
          routeChanged ? "CHANGE_ROUTE" : pickupChanged || dropoffChanged ? "CHANGE_STOPS" : "CHANGE_ROUTE"
  );
  const actionStatus = ({
    ACTIVATE: "ACTIVE",
    SUSPEND: "SUSPENDED",
    DEACTIVATE: "DEACTIVATED",
  } as const)[action as "ACTIVATE" | "SUSPEND" | "DEACTIVATE"] ?? undefined;
  if (actionStatus && nextStatus && actionStatus !== nextStatus) {
    throw new AuthError(400, "status and action must describe the same documented transport change");
  }
  const client = await pool.connect();
  let changedId: number;
  try {
    await client.query("BEGIN");
    const currentResult = await client.query(
      `${transportAssignmentSelect}
        WHERE a.id=$1 AND a.school_id=$2
        FOR UPDATE OF a`,
      [assignmentId, schoolId],
    );
    const currentRaw = currentResult.rows[0] as JsonRecord | undefined;
    if (!currentRaw) throw new AuthError(404, "Transport assignment not found");
    const current = mapRawAssignmentToApiShape(currentRaw);
    if (current.status === "DEACTIVATED") {
      throw new AuthError(409, "A deactivated transport assignment remains in history; reactivate through an approved parent request or create a new current assignment");
    }
    const oldRouteId = Number(currentRaw.routeId);
    const routeId = body.routeId === undefined ? oldRouteId : requireRecordId(body.routeId, "routeId");
    const routeResult = await client.query(
      `SELECT r.id,r.school_id AS "schoolId",r.name,r.bus_id AS "busId",
              r.driver_employee_id AS "driverEmployeeId",r.weekdays,r.fare_minor AS "fareMinor",
              r.status AS "routeStatus",bus.capacity AS "busCapacity",bus.status AS "busStatus"
         FROM transport_routes r JOIN transport_buses bus
           ON bus.id=r.bus_id AND bus.school_id=r.school_id
        WHERE r.id=$1 AND r.school_id=$2 FOR SHARE OF r`,
      [routeId, schoolId],
    );
    const route = routeResult.rows[0];
    if (!route) throw new AuthError(404, "Transport route not found in this school");
    if (route.routeStatus !== "ACTIVE") throw new AuthError(409, "An inactive route cannot receive an active transport assignment");
    const pickupStopId = body.pickupStopId === undefined
      ? Number(currentRaw.pickupId)
      : requireRecordId(body.pickupStopId, "pickupStopId");
    const dropoffStopId = body.dropoffStopId === undefined
      ? Number(currentRaw.dropoffId)
      : requireRecordId(body.dropoffStopId, "dropoffStopId");
    const busIds = [...new Set([
      Number(currentRaw.busId),
      Number(route.busId),
    ])].sort((left, right) => left - right);
    for (const busId of busIds) {
      await requireSchoolBus(client, schoolId, busId, { lock: true, active: true });
    }
    await assertStopPairUsesBusSchedule(client, schoolId, routeId, Number(route.busId), effectiveDate);
    await validateRouteStopPair(client, schoolId, routeId, pickupStopId, dropoffStopId);
    if (routeId !== oldRouteId) {
      const conflicting = await client.query(
        `SELECT 1 FROM transport_student_assignments
          WHERE student_id=$1 AND school_id=$2 AND id<>$3
            AND status IN ('ACTIVE','SUSPENDED')
          LIMIT 1`,
        [Number(current.studentId), schoolId, assignmentId],
      );
      if (conflicting.rows[0]) throw new AuthError(409, "The student already has another active transport assignment");
    }
    const newStatus = actionStatus ?? nextStatus ?? String(current.status);
    if (newStatus === "ACTIVE") {
      const remaining = await client.query(
        `SELECT count(DISTINCT a.student_id)::int AS "reservedPassengerCount"
           FROM transport_routes r
           JOIN transport_student_assignments a
             ON a.route_id=r.id AND a.school_id=r.school_id
            AND a.status IN ('ACTIVE','SUSPENDED') AND a.id<>$3
          WHERE r.school_id=$1 AND r.bus_id=$2`,
        [schoolId, Number(route.busId), assignmentId],
      );
      ensureTransportSeatAvailable(Number(route.busCapacity), Number(remaining.rows[0]?.reservedPassengerCount ?? 0));
      await checkTransportActivationPaymentGate(client, req, schoolId, assignmentId, routeId);
    }
    const oldStatus = String(current.status);
    await client.query(
      `UPDATE transport_student_assignments
          SET route_id=$1,pickup_stop_id=$2,dropoff_stop_id=$3,status=$4,
        effective_date=CASE WHEN $4<>'DEACTIVATED' AND $5::boolean THEN $6::date ELSE effective_date END,
              end_date=CASE WHEN $4='DEACTIVATED' THEN $6::date ELSE NULL END,
              reason=$7,updated_at=NOW()
        WHERE id=$8 AND school_id=$9`,
      [
        routeId,
        pickupStopId,
        dropoffStopId,
        newStatus,
        statusChanged || effectiveDate !== String(current.effectiveDate),
        effectiveDate,
        reason,
        assignmentId,
        schoolId,
      ],
    );
    const updatedResult = await client.query(
      `${transportAssignmentSelect} WHERE a.id=$1 AND a.school_id=$2`,
      [assignmentId, schoolId],
    );
    const updated = mapAssignmentRow(
      updatedResult.rows[0],
      await getSchoolTransportPaymentPolicy(client, schoolId),
    );
    const eventType = newStatus !== oldStatus
      ? ({
        ACTIVE: "STUDENT_TRANSPORT_ACTIVATED",
        SUSPENDED: "STUDENT_TRANSPORT_SUSPENDED",
        DEACTIVATED: "STUDENT_TRANSPORT_DEACTIVATED",
      } as const)[newStatus as "ACTIVE" | "SUSPENDED" | "DEACTIVATED"]
      : "STUDENT_TRANSPORT_ASSIGNMENT_UPDATED";
    await appendHistory(client, req, {
      schoolId,
      entity: "assignment",
      entityId: assignmentId,
      studentId: Number(current.studentId),
      eventType,
      effectiveDate,
      reason,
      before: current,
      after: updated,
    });
    changedId = assignmentId;
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  res.json(await assignmentShape(pool, schoolId, changedId));
}));

async function verifySchoolAssignmentAccess(req: Request, schoolId: number, assignmentId: number) {
  authorizeSchoolRead(req, schoolId);
  const result = await pool.query(
    `SELECT id FROM transport_student_assignments WHERE id=$1 AND school_id=$2`,
    [assignmentId, schoolId],
  );
  if (!result.rows[0]) throw new AuthError(404, "Transport assignment not found");
}

router.get("/transport/assignments/:assignmentId/history", run(async (req, res) => {
  const schoolId = querySchoolId(req);
  const assignmentId = requestId(req.params.assignmentId, "assignmentId");
  await verifySchoolAssignmentAccess(req, schoolId, assignmentId);
  const student = await pool.query(
    `SELECT student_id AS "studentId" FROM transport_student_assignments
      WHERE id=$1 AND school_id=$2`,
    [assignmentId, schoolId],
  );
  const entries = await studentTransportHistory(pool, schoolId, Number(student.rows[0].studentId));
  res.json(entries.filter((entry) => Number(entry.assignmentId) === assignmentId));
}));
async function familyStudent(
  req: Request,
  familyRole: "PARENT" | "STUDENT",
  requestedStudentId?: number,
) {
  const context = getUserContext(req);
  if (isPlatformOwner(context)) {
    throw new AuthError(403, "A Platform Owner cannot obtain a child's transport data through a secondary school role");
  }
  assertRoles(req, [familyRole]);
  if (familyRole === "STUDENT") {
    const result = await pool.query(
      `SELECT st.id AS "studentId",st.school_id AS "schoolId"
         FROM students st
        WHERE st.user_id=$1 AND UPPER(st.status)='ACTIVE'`,
      [context.user.id],
    );
    const row = result.rows[0];
    if (!row || (requestedStudentId !== undefined && Number(row.studentId) !== requestedStudentId)) {
      throw new AuthError(404, "Student transport details not found");
    }
    return { studentId: Number(row.studentId), schoolId: Number(row.schoolId), parentId: null };
  }
  if (requestedStudentId === undefined) throw new AuthError(400, "studentId is required");
  const result = await pool.query(
    `SELECT st.id AS "studentId",st.school_id AS "schoolId",parent.id AS "parentId"
       FROM parents parent
       JOIN parent_student_relationships relationship
         ON relationship.parent_id=parent.id AND UPPER(relationship.status)='ACTIVE'
       JOIN students st ON st.id=relationship.student_id
       JOIN schools school ON school.id=st.school_id AND school.id=parent.school_id
      WHERE parent.user_id=$1 AND UPPER(parent.status)='ACTIVE'
        AND UPPER(st.status)='ACTIVE' AND st.id=$2
      LIMIT 1`,
    [context.user.id, requestedStudentId],
  );
  const row = result.rows[0];
  if (!row) throw new AuthError(404, "Student is not an active child of this parent account");
  return {
    studentId: Number(row.studentId),
    schoolId: Number(row.schoolId),
    parentId: Number(row.parentId),
  };
}

async function studentTransportHistory(
  client: DbClient,
  schoolId: number,
  studentId: number,
) {
  const result = await client.query(
    `SELECT h.id,h.school_id AS "schoolId",h.assignment_id AS "assignmentId",
            h.student_id AS "studentId",h.event_type AS "eventType",
            h.effective_date::text AS "effectiveDate",h.reason,
            h.actor_user_id AS "actorUserId",h.actor_role AS "actorRole",
            COALESCE(NULLIF(TRIM(COALESCE(user.first_name,'') || ' ' || COALESCE(user.last_name,'')),''),
                     user.email,'School action') AS "actorName",
            h.before_state AS "before",h.after_state AS "after",h.created_at AS "createdAt"
       FROM transport_history h
       LEFT JOIN app_users user ON user.id=h.actor_user_id
      WHERE h.school_id=$1 AND h.student_id=$2
      ORDER BY h.created_at DESC,h.id DESC
      LIMIT 300`,
    [schoolId, studentId],
  );
  const resultValues = await client.query(
    `SELECT r.id AS "transportHistoryId",r.school_id AS "schoolId",r.student_id AS "studentId",
            r.assignment_id AS "assignmentId",r.status AS "eventType",
            r.effective_date::text AS "effectiveDate",r.reason,
            parent.user_id AS "actorUserId",parent.name AS "actorName",
            'PARENT'::text AS "actorRole",NULL::jsonb AS before,r.school_action AS after,
            r.created_at AS "createdAt"
       FROM transport_parent_requests r
       JOIN parents parent ON parent.id=r.parent_id AND parent.school_id=r.school_id
      WHERE r.school_id=$1 AND r.student_id=$2
      ORDER BY r.created_at DESC,r.id DESC
      LIMIT 100`,
    [schoolId, studentId],
  );
  const assignments = result.rows.map((row) => ({
    id: Number(row.id),
    schoolId: Number(row.schoolId),
    assignmentId: row.assignmentId === null ? null : Number(row.assignmentId),
    studentId: Number(row.studentId),
    actorUserId: row.actorUserId === null ? null : Number(row.actorUserId),
    actorName: String(row.actorName),
    actorRole: String(row.actorRole),
    eventType: String(row.eventType),
    effectiveDate: String(row.effectiveDate).slice(0, 10),
    reason: String(row.reason),
    before: row.before,
    after: row.after,
    createdAt: row.createdAt,
  }));
  const requests = resultValues.rows.map((row) => ({
    id: Number(row.transportHistoryId),
    schoolId: Number(row.schoolId),
    assignmentId: row.assignmentId === null ? null : Number(row.assignmentId),
    studentId: Number(row.studentId),
    actorUserId: row.actorUserId === null ? null : Number(row.actorUserId),
    actorName: String(row.actorName),
    actorRole: String(row.actorRole),
    eventType: `PARENT_REQUEST_${String(row.eventType)}`,
    effectiveDate: String(row.effectiveDate).slice(0, 10),
    reason: String(row.reason),
    before: null,
    after: row.after,
    createdAt: row.createdAt,
  }));
  return [...assignments, ...requests]
    .sort((first, second) =>
      new Date(String(second.createdAt)).getTime() - new Date(String(first.createdAt)).getTime(),
    )
    .slice(0, 300);
}

async function studentTransportView(schoolId: number, studentId: number) {
  const assignmentResult = await pool.query(
    `SELECT id FROM transport_student_assignments
      WHERE school_id=$1 AND student_id=$2
      ORDER BY CASE status WHEN 'ACTIVE' THEN 0 WHEN 'SUSPENDED' THEN 1 ELSE 2 END,id DESC
      LIMIT 1`,
    [schoolId, studentId],
  );
  let assignment: JsonRecord | null = null;
  if (assignmentResult.rows[0]) {
    assignment = await assignmentShape(pool, schoolId, Number(assignmentResult.rows[0].id));
  }
  const status = assignment
    ? String(assignment.status)
    : "NOT_ASSIGNED";
  return {
    schoolId,
    studentId,
    transportStatus: status,
    assignment: assignment ? {
      id: Number(assignment.id),
      studentId,
      schoolId,
      studentName: assignment.studentName,
      busName: assignment.busName,
      registrationNumber: assignment.registrationNumber,
      busCapacity: assignment.busCapacity,
      routeName: assignment.routeName,
      driverName: assignment.driverName,
      pickup: assignment.pickup,
      dropoff: assignment.dropoff,
      schedule: assignment.schedule,
      status: assignment.status,
      effectiveDate: assignment.effectiveDate,
      endDate: assignment.endDate,
      reason: assignment.reason,
      feeMinor: assignment.feeMinor,
      feePlanAmountMinor: assignment.feePlanAmountMinor,
      academicSessionId: assignment.academicSessionId,
      academicTermId: assignment.academicTermId,
      dueDate: assignment.dueDate,
      feePlans: assignment.feePlans,
      currency: assignment.currency,
      invoices: assignment.invoices,
    } : null,
    invoices: assignment?.invoices ?? [],
    history: await studentTransportHistory(pool, schoolId, studentId),
  };
}

router.get("/parent/children/:studentId/transport", run(async (req, res) => {
  const studentId = requestId(req.params.studentId, "studentId");
  const target = await familyStudent(req, "PARENT", studentId);
  res.json(await studentTransportView(target.schoolId, target.studentId));
}));

router.get("/student/transport", run(async (req, res) => {
  const target = await familyStudent(req, "STUDENT");
  res.json(await studentTransportView(target.schoolId, target.studentId));
}));

router.get("/parent/children/:studentId/transport/history", run(async (req, res) => {
  const studentId = requestId(req.params.studentId, "studentId");
  const target = await familyStudent(req, "PARENT", studentId);
  res.json(await studentTransportHistory(pool, target.schoolId, target.studentId));
}));

router.get("/student/transport/history", run(async (req, res) => {
  const target = await familyStudent(req, "STUDENT");
  res.json(await studentTransportHistory(pool, target.schoolId, target.studentId));
}));

async function transportRequestShape(
  client: DbClient,
  schoolId: number,
  requestIdValue: number,
) {
  const result = await client.query(
    `SELECT request.id,request.school_id AS "schoolId",
            request.student_id AS "studentId",student.first_name || ' ' || student.last_name AS "studentName",
            student.admission_no AS "admissionNo",student.class_name AS "className",student.section,
            request.parent_id AS "parentId",parent.name AS "parentName",parent.phone AS "parentPhone",
            request.assignment_id AS "assignmentId",request.request_type AS "requestType",
            request.request_date AS "requestDate",request.effective_date::text AS "effectiveDate",
            request.reason,request.status,request.school_action AS "schoolAction",
            request.school_note AS "schoolNote",request.reviewed_by AS "reviewedBy",
            request.reviewed_at AS "reviewedAt",
            COALESCE(NULLIF(TRIM(COALESCE(reviewer.first_name,'') || ' ' || COALESCE(reviewer.last_name,'')),''),
                     reviewer.email,'') AS "reviewerName",
            request.created_at AS "createdAt",request.updated_at AS "updatedAt"
       FROM transport_parent_requests request
       JOIN students student ON student.id=request.student_id AND student.school_id=request.school_id
       JOIN parents parent ON parent.id=request.parent_id AND parent.school_id=request.school_id
       LEFT JOIN app_users reviewer ON reviewer.id=request.reviewed_by
      WHERE request.id=$1 AND request.school_id=$2`,
    [requestIdValue, schoolId],
  );
  const row = result.rows[0];
  if (!row) throw new AuthError(404, "Transport activation request not found");
  return {
    id: Number(row.id),
    schoolId: Number(row.schoolId),
    studentId: Number(row.studentId),
    studentName: String(row.studentName),
    admissionNo: String(row.admissionNo),
    className: String(row.className),
    section: String(row.section),
    parentId: Number(row.parentId),
    parentName: String(row.parentName),
    assignmentId: row.assignmentId === null ? null : Number(row.assignmentId),
    requestType: String(row.requestType),
    requestDate: row.requestDate,
    effectiveDate: String(row.effectiveDate).slice(0, 10),
    reason: String(row.reason),
    status: String(row.status),
    schoolAction: row.schoolAction === null ? null : String(row.schoolAction),
    schoolNote: row.schoolNote === null ? null : String(row.schoolNote),
    reviewedBy: row.reviewedBy === null ? null : Number(row.reviewedBy),
    reviewedAt: row.reviewedAt,
    reviewerName: row.reviewerName ? String(row.reviewerName) : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function listSchoolTransportRequests(
  schoolId: number,
  status: string | null,
  studentId?: number,
  parentId?: number,
) {
  const result = await pool.query(
    `SELECT id FROM transport_parent_requests
      WHERE school_id=$1
        AND ($2::text IS NULL OR status=$2)
        AND ($3::int IS NULL OR student_id=$3)
        AND ($4::int IS NULL OR parent_id=$4)
      ORDER BY CASE status WHEN 'PENDING' THEN 0 ELSE 1 END,request_date DESC,id DESC
      LIMIT 500`,
    [schoolId, status, studentId ?? null, parentId ?? null],
  );
  const rows: JsonRecord[] = [];
  for (const entry of result.rows) {
    rows.push(await transportRequestShape(pool, schoolId, Number(entry.id)));
  }
  return rows;
}

router.get("/transport/requests", run(async (req, res) => {
  const schoolId = querySchoolId(req);
  authorizeSchoolRead(req, schoolId);
  const status = req.query.status === undefined || req.query.status === "all"
    ? null
    : oneOf(req.query.status, ["PENDING", "APPROVED", "REJECTED", "WITHDRAWN"] as const, "status");
  const requests = await listSchoolTransportRequests(schoolId, status);
  res.json(requests);
}));

router.get("/parent/children/:studentId/transport/requests", run(async (req, res) => {
  const studentId = requestId(req.params.studentId, "studentId");
  const family = await familyStudent(req, "PARENT", studentId);
  res.json(await listSchoolTransportRequests(
    family.schoolId,
    null,
    family.studentId,
    Number(family.parentId),
  ));
}));

router.post("/parent/children/:studentId/transport/requests", run(async (req, res) => {
  const studentId = requestId(req.params.studentId, "studentId");
  const family = await familyStudent(req, "PARENT", studentId);
  const context = getUserContext(req);
  const body = record(req.body, ["requestType", "effectiveDate", "reason"]);
  const requestType = oneOf(body.requestType, ["ACTIVATE", "DEACTIVATE"] as const, "requestType");
  const effectiveDate = requireTransportDate(body.effectiveDate, "effectiveDate");
  const reason = requireReason(body.reason, "reason", 1000);
  const requestIdValue = await inTransaction(async (client) => {
    const relation = await client.query(
      `SELECT relationship.student_id AS "studentId",parent.id AS "parentId"
         FROM parents parent
         JOIN parent_student_relationships relationship
           ON relationship.parent_id=parent.id
          AND relationship.student_id=$2
          AND UPPER(relationship.status)='ACTIVE'
        WHERE parent.id=$1 AND parent.school_id=$3 AND UPPER(parent.status)='ACTIVE'
        FOR SHARE OF relationship`,
      [family.parentId, family.studentId, family.schoolId],
    );
    if (!relation.rows[0]) throw new AuthError(403, "An active same-school parent–student relationship is required");
    const student = await client.query(
      `SELECT id FROM students WHERE id=$1 AND school_id=$2 AND UPPER(status)='ACTIVE' FOR UPDATE`,
      [family.studentId, family.schoolId],
    );
    if (!student.rows[0]) throw new AuthError(404, "Active same-school student not found");
    const assignment = await client.query(
      `SELECT id,status FROM transport_student_assignments
        WHERE student_id=$1 AND school_id=$2
        ORDER BY CASE status WHEN 'ACTIVE' THEN 0 WHEN 'SUSPENDED' THEN 1 ELSE 2 END,id DESC
        LIMIT 1`,
      [family.studentId, family.schoolId],
    );
    const current = assignment.rows[0];
    if (requestType === "ACTIVATE" && current?.status === "ACTIVE") {
      throw new AuthError(409, "This student already has active school transportation");
    }
    if (requestType === "DEACTIVATE" && current?.status !== "ACTIVE" && current?.status !== "SUSPENDED") {
      throw new AuthError(409, "There is no current transport assignment to deactivate");
    }
    let created;
    try {
      created = await client.query(
        `INSERT INTO transport_parent_requests
           (school_id,student_id,parent_id,assignment_id,request_type,effective_date,reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         RETURNING id`,
        [
          family.schoolId,
          family.studentId,
          family.parentId,
          current ? Number(current.id) : null,
          requestType,
          effectiveDate,
          reason,
        ],
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new AuthError(409, "This student already has a pending school transport request; wait for its review");
      }
      throw error;
    }
    const parent = await client.query(
      `SELECT name FROM parents WHERE id=$1 AND school_id=$2`,
      [family.parentId, family.schoolId],
    );
    await appendHistory(client, req, {
      schoolId: family.schoolId,
      entity: "request",
      entityId: Number(created.rows[0].id),
      studentId: family.studentId,
      eventType: "PARENT_TRANSPORT_" + requestType + "_REQUESTED",
      effectiveDate,
      reason,
      after: {
        requestId: Number(created.rows[0].id),
        requestType,
        status: "PENDING",
        studentId: family.studentId,
        parentId: family.parentId,
        parentName: String(parent.rows[0]?.name ?? ""),
      },
    });
    return Number(created.rows[0].id);
  });
  res.status(201).json(await transportRequestShape(pool, family.schoolId, requestIdValue));
}));

router.post("/parent/children/:studentId/transport/requests/:requestId/withdraw", run(async (req, res) => {
  const studentId = requestId(req.params.studentId, "studentId");
  const requestRecordId = requestId(req.params.requestId, "requestId");
  const family = await familyStudent(req, "PARENT", studentId);
  const body = record(req.body, ["reason"]);
  const reason = requireReason(body.reason, "reason", 1000);
  await inTransaction(async (client) => {
    const currentResult = await client.query(
      `SELECT id,school_id AS "schoolId",student_id AS "studentId",parent_id AS "parentId",
              assignment_id AS "assignmentId",request_type AS "requestType",
              status,effective_date::text AS "effectiveDate",reason
         FROM transport_parent_requests
        WHERE id=$1 AND school_id=$2 AND student_id=$3 AND parent_id=$4
        FOR UPDATE`,
      [requestRecordId, family.schoolId, family.studentId, family.parentId],
    );
    const current = currentResult.rows[0] as JsonRecord | undefined;
    if (!current) throw new AuthError(404, "This parent's student transport request was not found");
    if (current.status !== "PENDING") {
      throw new AuthError(409, "Only a pending transport request may be withdrawn");
    }
    const updated = await client.query(
      `UPDATE transport_parent_requests
          SET status='WITHDRAWN',school_action='NO_CHANGE',school_note=$1,
              reviewed_by=$2,reviewed_at=NOW(),updated_at=NOW()
        WHERE id=$3 AND school_id=$4
        RETURNING id`,
      [reason, getUserContext(req).user.id, requestRecordId, family.schoolId],
    );
    await appendHistory(client, req, {
      schoolId: family.schoolId,
      entity: "request",
      entityId: Number(updated.rows[0].id),
      studentId: family.studentId,
      eventType: "PARENT_TRANSPORT_REQUEST_WITHDRAWN",
      effectiveDate: String(current.effectiveDate).slice(0, 10),
      reason,
      before: current,
      after: { status: "WITHDRAWN", schoolAction: "NO_CHANGE" },
    });
  });
  res.json(await transportRequestShape(pool, family.schoolId, requestRecordId));
}));

router.post("/transport/requests/:requestId/review", run(async (req, res) => {
  const schoolId = querySchoolId(req);
  const context = authorizeSchoolWrite(req, schoolId);
  const id = requestId(req.params.requestId, "requestId");
  const body = record(req.body, [
    "decision", "action", "effectiveDate", "schoolNote", "routeId", "pickupStopId", "dropoffStopId",
  ]);
  const decision = oneOf(body.decision, ["APPROVE", "REJECT"] as const, "decision");
  const action = oneOf(body.action, ["ACTIVATE", "SUSPEND", "DEACTIVATE", "NO_CHANGE"] as const, "action");
  const effectiveDate = body.effectiveDate === undefined
    ? undefined
    : requireTransportDate(body.effectiveDate, "effectiveDate");
  const schoolNote = optionalText(body.schoolNote, "schoolNote", 1000);
  if (schoolNote !== null && schoolNote.trim().length < 3) {
    throw new AuthError(400, "schoolNote must contain at least 3 characters");
  }
  if ((decision === "REJECT" && action !== "NO_CHANGE") ||
      (decision === "APPROVE" && action === "NO_CHANGE" && !schoolNote)) {
    throw new AuthError(400, "Rejected requests must use NO_CHANGE; approved NO_CHANGE decisions require an explanatory schoolNote");
  }
  const reviewed = await inTransaction(async (client) => {
    const requestResult = await client.query(
      `SELECT id,school_id AS "schoolId",student_id AS "studentId",parent_id AS "parentId",
              assignment_id AS "assignmentId",request_type AS "requestType",
              status,effective_date::text AS "effectiveDate",reason,school_action AS "schoolAction"
         FROM transport_parent_requests
        WHERE id=$1 AND school_id=$2
        FOR UPDATE`,
      [id, schoolId],
    );
    const parentRequest = requestResult.rows[0] as JsonRecord | undefined;
    if (!parentRequest) throw new AuthError(404, "Transport parent request not found in this school");
    if (parentRequest.status !== "PENDING") {
      throw new AuthError(409, "This transport request has already been decided or withdrawn");
    }
    const requestType = String(parentRequest.requestType);
    if (decision === "REJECT" && action !== "NO_CHANGE") {
      throw new AuthError(400, "A rejected parent request must not change its assignment");
    }
    if (action === "ACTIVATE" && requestType !== "ACTIVATE") {
      throw new AuthError(400, "A deactivation request cannot be approved as activation");
    }
    if ((action === "SUSPEND" || action === "DEACTIVATE") && requestType !== "DEACTIVATE") {
      throw new AuthError(400, "An activation request can only be approved for activation or no change");
    }
    const eventDate = effectiveDate ?? String(parentRequest.effectiveDate).slice(0, 10);
    let finalAction: string = action;
    let actionNote = schoolNote;
    if (decision === "APPROVE" && action === "ACTIVATE") {
      const routeId = requireRecordId(body.routeId, "routeId");
      const pickupStopId = requireRecordId(body.pickupStopId, "pickupStopId");
      const dropoffStopId = requireRecordId(body.dropoffStopId, "dropoffStopId");
      await client.query(
        `SELECT id FROM students
          WHERE id=$1 AND school_id=$2 AND UPPER(status)='ACTIVE' FOR UPDATE`,
        [Number(parentRequest.studentId), schoolId],
      );
      const selectedRoute = await client.query(
        `SELECT r.id,r.name,r.bus_id AS "busId",r.fare_minor AS "fareMinor",
                r.status AS "routeStatus",bus.capacity AS "busCapacity",
                bus.status AS "busStatus"
           FROM transport_routes r JOIN transport_buses bus
             ON bus.id=r.bus_id AND bus.school_id=r.school_id
          WHERE r.id=$1 AND r.school_id=$2 FOR SHARE OF r`,
        [routeId, schoolId],
      );
      const route = selectedRoute.rows[0];
      if (!route) throw new AuthError(404, "The selected activation route is not in this school");
      if (route.routeStatus !== "ACTIVE") throw new AuthError(409, "An inactive route cannot activate student transport");
      await assertStopPairUsesBusSchedule(client, schoolId, routeId, Number(route.busId), eventDate);
      await validateRouteStopPair(client, schoolId, routeId, pickupStopId, dropoffStopId);
      const existingResult = await client.query(
        `SELECT id,status,route_id AS "routeId",effective_date::text AS "effectiveDate"
           FROM transport_student_assignments
          WHERE id=$1 AND school_id=$2 AND student_id=$3
          FOR UPDATE`,
        [parentRequest.assignmentId, schoolId, Number(parentRequest.studentId)],
      );
      const current = existingResult.rows[0] as JsonRecord | undefined;
      if (current?.status === "ACTIVE") {
        throw new AuthError(409, "The student is already using active school transport; close the stale request as no change");
      }
      const bus = await requireSchoolBus(client, schoolId, Number(route.busId), { lock: true, active: true });
      const occupied = await client.query(
        `SELECT count(DISTINCT a.student_id)::int AS count
           FROM transport_routes other_route
           JOIN transport_student_assignments a
             ON a.route_id=other_route.id AND a.school_id=other_route.school_id
            AND a.status IN ('ACTIVE','SUSPENDED')
            AND ($3::int IS NULL OR a.id<>$3)
          WHERE other_route.school_id=$1 AND other_route.bus_id=$2`,
        [schoolId, Number(route.busId), current ? Number(current.id) : null],
      );
      ensureTransportSeatAvailable(Number(bus.capacity), Number(occupied.rows[0]?.count ?? 0));
      const policy = await getSchoolTransportPaymentPolicy(client, schoolId, true);
      const term = await currentTransportTerm(client, schoolId);
      if (policy.paymentRequired && Number(route.fareMinor) > 0 && !term) {
        throw new AuthError(409, "The payment policy prevents starting this service before a current academic term is active");
      }
      const targetStatus = policy.paymentRequired && Number(route.fareMinor) > 0 ? "SUSPENDED" : "ACTIVE";
      let assignmentId: number;
      if (current && current.status !== "DEACTIVATED") {
        if (String(current.effectiveDate).slice(0, 10) > eventDate) {
          throw new AuthError(400, "The activation date cannot predate this student's existing assignment");
        }
        await client.query(
          `UPDATE transport_student_assignments
              SET route_id=$1,pickup_stop_id=$2,dropoff_stop_id=$3,
                  status=$4,end_date=NULL,reason=$5,updated_at=NOW()
            WHERE id=$6 AND school_id=$7`,
          [
            routeId,
            pickupStopId,
            dropoffStopId,
            targetStatus,
            String(parentRequest.reason),
            Number(current.id),
            schoolId,
          ],
        );
        assignmentId = Number(current.id);
      } else {
        const inserted = await client.query(
          `INSERT INTO transport_student_assignments
             (school_id,student_id,route_id,pickup_stop_id,dropoff_stop_id,status,effective_date,reason,created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING id`,
          [
            schoolId,
            Number(parentRequest.studentId),
            routeId,
            pickupStopId,
            dropoffStopId,
            targetStatus,
            eventDate,
            String(parentRequest.reason),
            context.user.id,
          ],
        );
        assignmentId = Number(inserted.rows[0].id);
      }
      if (term && Number(route.fareMinor) > 0) {
        await ensureTransportInvoiceForTerm(client, {
          req,
          assignmentId,
          schoolId,
          academicTermId: term.id,
          actorUserId: context.user.id,
          actorRole: actorRole(req, schoolId),
          effectiveReason: `Transport fee invoice for ${term.sessionName} ${term.termName} following parent request ${id}`,
        });
      }
      if (targetStatus === "SUSPENDED") {
        const invoice = await client.query(
          `SELECT invoice.id
             FROM transport_fee_invoices link
             JOIN fee_invoices invoice
               ON invoice.id=link.fee_invoice_id AND invoice.school_id=link.school_id
            WHERE link.school_id=$1 AND link.assignment_id=$2 AND link.academic_term_id=$3
              AND invoice.outstanding_minor>0
            LIMIT 1`,
          [schoolId, assignmentId, term!.id],
        );
        if (!invoice.rows[0]) {
          await client.query(
            `UPDATE transport_student_assignments SET status='ACTIVE',updated_at=NOW()
              WHERE id=$1 AND school_id=$2`,
            [assignmentId, schoolId],
          );
          finalAction = "ACTIVATE";
        } else {
          finalAction = "SUSPEND";
          actionNote ??= "Request approved; Finance invoice remains outstanding, so transport activation is suspended until paid.";
        }
      }
      const afterAssignment = await assignmentShape(client, schoolId, assignmentId, policy);
      await appendHistory(client, req, {
        schoolId,
        entity: "assignment",
        entityId: assignmentId,
        studentId: Number(parentRequest.studentId),
        eventType: finalAction === "SUSPEND"
          ? "STUDENT_TRANSPORT_REQUEST_ACTIVATION_PAYMENT_GATED"
          : "STUDENT_TRANSPORT_ASSIGNMENT_APPROVED",
        effectiveDate: eventDate,
        reason: String(parentRequest.reason),
        after: afterAssignment,
      });
      await client.query(
        `UPDATE transport_parent_requests
            SET assignment_id=$1,school_action=$2,school_note=$3,
                status='APPROVED',reviewed_by=$4,reviewed_at=NOW(),updated_at=NOW()
          WHERE id=$5 AND school_id=$6`,
        [assignmentId, finalAction, actionNote, context.user.id, id, schoolId],
      );
      finalAction = finalAction;
    } else {
      if (decision === "APPROVE" && action !== "NO_CHANGE") {
        const assignmentId = Number(parentRequest.assignmentId);
        if (!Number.isSafeInteger(assignmentId) || assignmentId < 1) {
          throw new AuthError(409, "The student's active transport assignment has changed since this request was submitted");
        }
        const assignmentResult = await client.query(
          `SELECT id,status,effective_date::text AS "effectiveDate"
             FROM transport_student_assignments
            WHERE id=$1 AND school_id=$2 AND student_id=$3
            FOR UPDATE`,
          [assignmentId, schoolId, Number(parentRequest.studentId)],
        );
        const assignment = assignmentResult.rows[0];
        if (!assignment || !["ACTIVE", "SUSPENDED"].includes(String(assignment.status))) {
          throw new AuthError(409, "The student's current assignment changed since this request was submitted");
        }
        if (String(assignment.effectiveDate).slice(0, 10) > eventDate && action === "DEACTIVATE") {
          throw new AuthError(400, "The deactivation date cannot predate this student's current assignment");
        }
        const targetStatus = action === "DEACTIVATE" ? "DEACTIVATED" : "SUSPENDED";
        await client.query(
          `UPDATE transport_student_assignments
              SET status=$1,end_date=CASE WHEN $1='DEACTIVATED' THEN $2::date ELSE NULL END,
                  reason=$3,updated_at=NOW()
            WHERE id=$4 AND school_id=$5`,
          [targetStatus, eventDate, String(parentRequest.reason), assignmentId, schoolId],
        );
        const afterAssignment = await assignmentShape(client, schoolId, assignmentId);
        await appendHistory(client, req, {
          schoolId,
          entity: "assignment",
          entityId: assignmentId,
          studentId: Number(parentRequest.studentId),
          eventType: targetStatus === "DEACTIVATED"
            ? "STUDENT_TRANSPORT_DEACTIVATED_BY_PARENT_REQUEST"
            : "STUDENT_TRANSPORT_SUSPENDED_BY_PARENT_REQUEST",
          effectiveDate: eventDate,
          reason: String(parentRequest.reason),
          after: afterAssignment,
        });
      }
      await client.query(
        `UPDATE transport_parent_requests
            SET school_action=$1,school_note=$2,
                status=$3,reviewed_by=$4,reviewed_at=NOW(),updated_at=NOW()
          WHERE id=$5 AND school_id=$6`,
        [
          action,
          schoolNote ?? (decision === "REJECT" ? "The School Admin declined this request." : null),
          decision === "REJECT" ? "REJECTED" : "APPROVED",
          context.user.id,
          id,
          schoolId,
        ],
      );
    }
    const request = await transportRequestShape(client, schoolId, id);
    await appendHistory(client, req, {
      schoolId,
      entity: "request",
      entityId: id,
      studentId: Number(parentRequest.studentId),
      eventType: decision === "REJECT" ? "PARENT_TRANSPORT_REQUEST_REJECTED" : "PARENT_TRANSPORT_REQUEST_APPROVED",
      effectiveDate: eventDate,
      reason: schoolNote ?? (decision === "REJECT" ? "School Admin declined transport request" : "School Admin reviewed transport request"),
      before: parentRequest,
      after: request,
    });
    return request;
  });
  res.json(reviewed);
}));


router.get("/transport/buses", run(async (req, res) => {
  const schoolId = querySchoolId(req);
  authorizeSchoolRead(req, schoolId);
  const status = req.query.status === undefined
    ? null
    : oneOf(req.query.status, ["ACTIVE", "INACTIVE", "MAINTENANCE"] as const, "status");
  const result = await pool.query(
    `SELECT b.id, b.school_id AS "schoolId", b.name,
            b.registration_number AS "registrationNumber", b.make, b.capacity, b.status, b.notes,
            (SELECT count(*)::int FROM transport_routes r
              WHERE r.school_id=b.school_id AND r.bus_id=b.id AND r.status='ACTIVE') AS "routeCount",
            (SELECT count(DISTINCT a.student_id)::int
               FROM transport_routes r JOIN transport_student_assignments a
                 ON a.school_id=r.school_id AND a.route_id=r.id AND a.status IN ('ACTIVE','SUSPENDED')
              WHERE r.school_id=b.school_id AND r.bus_id=b.id) AS "passengerCount",
            b.created_at AS "createdAt", b.updated_at AS "updatedAt"
       FROM transport_buses b
      WHERE b.school_id=$1 AND ($2::text IS NULL OR b.status=$2)
      ORDER BY b.status, b.name, b.id`,
    [schoolId, status],
  );
  res.json(result.rows.map((row) => ({
    ...row,
    id: Number(row.id),
    schoolId: Number(row.schoolId),
    capacity: Number(row.capacity),
    routeCount: Number(row.routeCount),
    passengerCount: Number(row.passengerCount),
  })));
}));

router.post("/transport/buses", run(async (req, res) => {
  const schoolId = querySchoolId(req);
  const context = authorizeSchoolWrite(req, schoolId);
  const body = record(req.body, ["name", "registrationNumber", "make", "capacity", "status", "notes"]);
  const name = requiredText(body.name, "name", 100, 2);
  const registrationNumber = requiredText(body.registrationNumber, "registrationNumber", 30, 3);
  const make = optionalText(body.make, "make", 100);
  if (!Number.isSafeInteger(body.capacity) || Number(body.capacity) < 1 || Number(body.capacity) > 250) {
    throw new AuthError(400, "capacity must be an integer between 1 and 250");
  }
  const capacity = Number(body.capacity);
  const status = body.status === undefined
    ? "ACTIVE"
    : oneOf(body.status, ["ACTIVE", "INACTIVE", "MAINTENANCE"] as const, "status");
  const notes = optionalText(body.notes, "notes", 1000);
  const row = await inTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO transport_buses
         (school_id, name, registration_number, make, capacity, status, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, name, registration_number AS "registrationNumber", make, capacity, status, notes,
                 school_id AS "schoolId", created_at AS "createdAt", updated_at AS "updatedAt"`,
      [schoolId, name, registrationNumber, make, capacity, status, notes, context.user.id],
    );
    await appendHistory(client, req, {
      schoolId,
      entity: "bus",
      entityId: Number(inserted.rows[0].id),
      eventType: "BUS_CREATED",
      effectiveDate: new Date().toISOString().slice(0, 10),
      reason: "School transport bus registered",
      after: inserted.rows[0],
    });
    return inserted.rows[0];
  });
  res.status(201).json({ ...row, id: Number(row.id), schoolId: Number(row.schoolId), capacity: Number(row.capacity), routeCount: 0, passengerCount: 0 });
}));

router.patch("/transport/buses/:busId", run(async (req, res) => {
  const schoolId = querySchoolId(req);
  const context = authorizeSchoolWrite(req, schoolId);
  const busId = requestId(req.params.busId, "busId");
  const body = record(req.body, ["name", "registrationNumber", "make", "capacity", "status", "notes"]);
  ensureOptionalBody(body, true);
  const name = body.name === undefined ? undefined : requiredText(body.name, "name", 100, 2);
  const registrationNumber = body.registrationNumber === undefined
    ? undefined
    : requiredText(body.registrationNumber, "registrationNumber", 30, 3);
  const make = body.make === undefined ? undefined : optionalText(body.make, "make", 100);
  let capacity: number | undefined;
  if (body.capacity !== undefined) {
    if (!Number.isSafeInteger(body.capacity) || Number(body.capacity) < 1 || Number(body.capacity) > 250) {
      throw new AuthError(400, "capacity must be an integer between 1 and 250");
    }
    capacity = Number(body.capacity);
  }
  const status = body.status === undefined ? undefined : oneOf(body.status, ["ACTIVE", "INACTIVE", "MAINTENANCE"] as const, "status");
  const notes = body.notes === undefined ? undefined : optionalText(body.notes, "notes", 1000);
  const row = await inTransaction(async (client) => {
    const current = await requireSchoolBus(client, schoolId, busId, { lock: true });
    const reservedCount = await countReservedBusPassengers(client, schoolId, busId);
    ensureTransportSeatAvailable(capacity ?? Number(current.capacity), reservedCount, 0);
    if (status && status !== "ACTIVE" && reservedCount > 0) {
      throw new AuthError(409, "Suspend or deactivate this bus's student assignments before taking the bus out of service");
    }
    const updated = await client.query(
      `UPDATE transport_buses
          SET name=COALESCE($1,name), registration_number=COALESCE($2,registration_number),
              make=CASE WHEN $3::boolean THEN $4::text ELSE make END,
              capacity=COALESCE($5,capacity), status=COALESCE($6,status),
              notes=CASE WHEN $7::boolean THEN $8::text ELSE notes END,
              updated_at=NOW()
        WHERE id=$9 AND school_id=$10
        RETURNING id, school_id AS "schoolId", name, registration_number AS "registrationNumber",
                  make, capacity, status, notes, created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        name ?? null,
        registrationNumber ?? null,
        body.make !== undefined,
        make,
        capacity ?? null,
        status ?? null,
        body.notes !== undefined,
        notes,
        busId,
        schoolId,
      ],
    );
    await appendHistory(client, req, {
      schoolId,
      entity: "bus",
      entityId: busId,
      eventType: status ? "BUS_STATUS_UPDATED" : "BUS_UPDATED",
      effectiveDate: new Date().toISOString().slice(0, 10),
      reason: "School-admin bus maintenance",
      before: current,
      after: updated.rows[0],
    });
    return updated.rows[0];
  });
  const totals = await pool.query(
    `SELECT count(DISTINCT r.id)::int AS "routeCount",
            count(DISTINCT a.student_id)::int AS "passengerCount"
       FROM transport_buses b
       LEFT JOIN transport_routes r ON r.school_id=b.school_id AND r.bus_id=b.id AND r.status='ACTIVE'
       LEFT JOIN transport_student_assignments a
         ON a.school_id=r.school_id AND a.route_id=r.id AND a.status IN ('ACTIVE','SUSPENDED')
      WHERE b.id=$1 AND b.school_id=$2`,
    [busId, schoolId],
  );
  res.json({
    ...row,
    id: Number(row.id),
    schoolId: Number(row.schoolId),
    capacity: Number(row.capacity),
    routeCount: Number(totals.rows[0].routeCount),
    passengerCount: Number(totals.rows[0].passengerCount),
  });
}));

router.get("/transport/drivers", run(async (req, res) => {
  const schoolId = querySchoolId(req);
  authorizeSchoolRead(req, schoolId);
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
  const result = await pool.query(
    `SELECT id AS "employeeId", school_id AS "schoolId", employee_no AS "employeeNo",
            first_name || ' ' || last_name AS name, employee_type AS "employeeType"
       FROM employees
      WHERE school_id=$1 AND UPPER(employee_type)='DRIVER'
        AND UPPER(employment_status)='ACTIVE'
        AND ($2::text = '' OR employee_no ILIKE '%' || $2 || '%' OR
             first_name ILIKE '%' || $2 || '%' OR last_name ILIKE '%' || $2 || '%')
      ORDER BY first_name, last_name, employee_no
      LIMIT 50`,
    [schoolId, search],
  );
  res.json(result.rows.map((row) => ({ ...row, employeeId: Number(row.employeeId), schoolId: Number(row.schoolId) })));
}));

router.get("/transport/routes", run(async (req, res) => {
  const schoolId = querySchoolId(req);
  authorizeSchoolRead(req, schoolId);
  const busId = req.query.busId === undefined ? null : requireRecordId(req.query.busId, "busId");
  const status = req.query.status === undefined ? null : oneOf(req.query.status, ["ACTIVE", "INACTIVE"] as const, "status");
  const result = await pool.query(
    `${routeRowSql}
      WHERE r.school_id=$1 AND ($2::int IS NULL OR r.bus_id=$2)
        AND ($3::text IS NULL OR r.status=$3)
      ORDER BY r.status, r.name, r.id`,
    [schoolId, busId, status],
  );
  res.json(result.rows.map(mapRouteShape));
}));

router.post("/transport/routes", run(async (req, res) => {
  const schoolId = querySchoolId(req);
  const context = authorizeSchoolWrite(req, schoolId);
  const body = record(req.body, [
    "name", "busId", "driverEmployeeId", "weekdays", "departureTime", "arrivalTime", "fareMinor", "status", "stops",
  ]);
  const name = requiredText(body.name, "name", 120, 2);
  const busId = requireRecordId(body.busId, "busId");
  const driverEmployeeId = requireRecordId(body.driverEmployeeId, "driverEmployeeId");
  const weekdays = normalizeTransportWeekdays(body.weekdays);
  const departureTime = normalizeTransportTime(body.departureTime, "departureTime");
  const arrivalTime = normalizeTransportTime(body.arrivalTime, "arrivalTime");
  ensureTransportArrivalAfterDeparture(departureTime, arrivalTime);
  const fareMinor = body.fareMinor === undefined ? 0 : requireTransportAmountMinor(body.fareMinor, "fareMinor");
  const status = body.status === undefined ? "ACTIVE" : oneOf(body.status, ["ACTIVE", "INACTIVE"] as const, "status");
  const row = await inTransaction(async (client) => {
    await requireSchoolBus(client, schoolId, busId, { lock: true, active: status === "ACTIVE" });
    await requireSchoolDriver(client, schoolId, driverEmployeeId, { lock: true });
    if (status === "ACTIVE") {
      await assertScheduleAvailable(client, {
        schoolId,
        busId,
        driverEmployeeId,
        weekdays,
        departureTime,
        arrivalTime,
      });
    }
    const inserted = await client.query(
      `INSERT INTO transport_routes
         (school_id,bus_id,driver_employee_id,name,weekdays,departure_time,arrival_time,fare_minor,status,created_by)
       VALUES ($1,$2,$3,$4,$5::text[],$6,$7,$8,$9,$10)
       RETURNING id`,
      [schoolId, busId, driverEmployeeId, name, weekdays, departureTime, arrivalTime, fareMinor, status, context.user.id],
    );
    const routeId = Number(inserted.rows[0].id);
    await checkStops(client, schoolId, routeId, body.stops, context.user.id);
    const readBack = await client.query(
      `${routeRowSql} WHERE r.id=$1 AND r.school_id=$2`,
      [routeId, schoolId],
    );
    const route = mapRouteShape(readBack.rows[0]);
    await appendHistory(client, req, {
      schoolId,
      entity: "route",
      entityId: routeId,
      eventType: "ROUTE_CREATED",
      effectiveDate: new Date().toISOString().slice(0, 10),
      reason: "School-admin transport route registration",
      after: route,
    });
    return route;
  });
  res.status(201).json(row);
}));

router.patch("/transport/routes/:routeId", run(async (req, res) => {
  const schoolId = querySchoolId(req);
  const context = authorizeSchoolWrite(req, schoolId);
  const routeId = requestId(req.params.routeId, "routeId");
  const body = record(req.body, [
    "name", "busId", "driverEmployeeId", "weekdays", "departureTime", "arrivalTime", "fareMinor", "status",
  ]);
  ensureOptionalBody(body, true);
  const client = await pool.connect();
  let result: JsonRecord;
  try {
    await client.query("BEGIN");
    const currentResult = await client.query(
      `${routeRowSql}
        WHERE r.id=$1 AND r.school_id=$2
        FOR UPDATE OF r`,
      [routeId, schoolId],
    );
    const current = currentResult.rows[0];
    if (!current) throw new AuthError(404, "Route not found");
    const before = mapRouteShape(current);
    const busId = body.busId === undefined ? Number(current.busId) : requireRecordId(body.busId, "busId");
    const driverEmployeeId = body.driverEmployeeId === undefined
      ? Number(current.driverEmployeeId)
      : requireRecordId(body.driverEmployeeId, "driverEmployeeId");
    const weekdays = body.weekdays === undefined
      ? normalizeTransportWeekdays(current.weekdays)
      : normalizeTransportWeekdays(body.weekdays);
    const departureTime = body.departureTime === undefined
      ? normalizeTransportTime(current.departureTime, "departureTime")
      : normalizeTransportTime(body.departureTime, "departureTime");
    const arrivalTime = body.arrivalTime === undefined
      ? normalizeTransportTime(current.arrivalTime, "arrivalTime")
      : normalizeTransportTime(body.arrivalTime, "arrivalTime");
    ensureTransportArrivalAfterDeparture(departureTime, arrivalTime);
    const fareMinor = body.fareMinor === undefined ? Number(current.fareMinor) : requireTransportAmountMinor(body.fareMinor, "fareMinor");
    const status = body.status === undefined
      ? String(current.status)
      : oneOf(body.status, ["ACTIVE", "INACTIVE"] as const, "status");
    const bus = await requireSchoolBus(client, schoolId, busId, { lock: true, active: status === "ACTIVE" });
    await requireSchoolDriver(client, schoolId, driverEmployeeId, { lock: true });
    const matchingCompanion = await client.query(
      `SELECT 1 FROM transport_route_staff
        WHERE school_id=$1 AND route_id=$2 AND employee_id=$3 AND is_active
        LIMIT 1`,
      [schoolId, routeId, driverEmployeeId],
    );
    if (matchingCompanion.rows[0]) {
      throw new AuthError(409, "An existing route companion cannot also become this route's driver");
    }
    const routeAssignments = await client.query(
      `SELECT count(DISTINCT student_id)::int AS "reservedPassengers"
         FROM transport_student_assignments
        WHERE school_id=$1 AND route_id=$2 AND status IN ('ACTIVE','SUSPENDED')`,
      [schoolId, routeId],
    );
    const ownReserved = Number(routeAssignments.rows[0]?.reservedPassengers ?? 0);
    const otherRoutePassengers = await countReservedBusPassengers(client, schoolId, busId, routeId);
    ensureTransportSeatAvailable(Number(bus.capacity), otherRoutePassengers, ownReserved);
    if (status === "INACTIVE" && ownReserved > 0) {
      throw new AuthError(409, "Deactivate or reassign this route's student transport assignments first");
    }
    if (status === "ACTIVE") {
      await assertScheduleAvailable(client, {
        schoolId,
        busId,
        driverEmployeeId,
        weekdays,
        departureTime,
        arrivalTime,
        exceptRouteId: routeId,
      });
    }
    await client.query(
      `UPDATE transport_routes
          SET bus_id=$1,driver_employee_id=$2,name=$3,weekdays=$4::text[],
              departure_time=$5,arrival_time=$6,fare_minor=$7,status=$8,updated_at=NOW()
        WHERE id=$9 AND school_id=$10`,
      [
        busId,
        driverEmployeeId,
        body.name === undefined ? String(current.name) : requiredText(body.name, "name", 120, 2),
        weekdays,
        departureTime,
        arrivalTime,
        fareMinor,
        status,
        routeId,
        schoolId,
      ],
    );
    if (status === "ACTIVE") {
      const companions = await client.query(
        `SELECT id,employee_id AS "employeeId",role
           FROM transport_route_staff
          WHERE school_id=$1 AND route_id=$2 AND is_active
          ORDER BY id
          FOR UPDATE`,
        [schoolId, routeId],
      );
      for (const companion of companions.rows) {
        await validateBusRouteStaff(
          client,
          schoolId,
          routeId,
          Number(companion.employeeId),
          String(companion.role) as "TEACHER" | "STAFF" | "ACCOMPANIER",
          Number(companion.id),
        );
      }
    }
    const updated = await client.query(
      `${routeRowSql} WHERE r.id=$1 AND r.school_id=$2`,
      [routeId, schoolId],
    );
    result = mapRouteShape(updated.rows[0]);
    await appendHistory(client, req, {
      schoolId,
      entity: "route",
      entityId: routeId,
      eventType: status !== current.status ? "ROUTE_STATUS_UPDATED" : "ROUTE_UPDATED",
      effectiveDate: new Date().toISOString().slice(0, 10),
      reason: "School-admin route or transport schedule change",
      before,
      after: result,
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  res.json(result);
}));

router.post("/transport/routes/:routeId/stops", run(async (req, res) => {
  const schoolId = querySchoolId(req);
  const context = authorizeSchoolWrite(req, schoolId);
  const routeId = requestId(req.params.routeId, "routeId");
  const body = record(req.body, ["name", "stopType", "sequence", "notes", "isActive"]);
  const name = requiredText(body.name, "name", 120, 2);
  const stopType = oneOf(body.stopType, ["PICKUP", "DROPOFF", "BOTH"] as const, "stopType");
  const sequence = requireRecordId(body.sequence, "sequence");
  const notes = optionalText(body.notes, "notes", 500);
  const isActive = optionalBoolean(body.isActive, "isActive") ?? true;
  const row = await inTransaction(async (client) => {
    await client.query(
      `SELECT id FROM transport_routes WHERE id=$1 AND school_id=$2 FOR UPDATE`,
      [routeId, schoolId],
    ).then((result) => {
      if (!result.rows[0]) throw new AuthError(404, "Route not found");
    });
    const created = await client.query(
      `INSERT INTO transport_route_stops
         (school_id,route_id,name,stop_type,sequence,notes,is_active,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id,school_id AS "schoolId",route_id AS "routeId",name,
                 stop_type AS "stopType",sequence,notes,is_active AS "isActive",
                 created_at AS "createdAt",updated_at AS "updatedAt"`,
      [schoolId, routeId, name, stopType, sequence, notes, isActive, context.user.id],
    );
    const result = stopShape(created.rows[0], schoolId, routeId);
    await appendHistory(client, req, {
      schoolId,
      entity: "route",
      entityId: routeId,
      eventType: "ROUTE_STOP_ADDED",
      effectiveDate: new Date().toISOString().slice(0, 10),
      reason: "School-admin ordered pickup/drop-off stop",
      after: result,
    });
    return result;
  });
  res.status(201).json(row);
}));

router.patch("/transport/routes/:routeId/stops/:stopId", run(async (req, res) => {
  const schoolId = querySchoolId(req);
  const context = authorizeSchoolWrite(req, schoolId);
  const routeId = requestId(req.params.routeId, "routeId");
  const stopId = requestId(req.params.stopId, "stopId");
  const body = record(req.body, ["name", "stopType", "sequence", "notes", "isActive"]);
  ensureOptionalBody(body, true);
  let result: JsonRecord;
  try {
    result = await inTransaction(async (client) => {
      await client.query(
        `SELECT id FROM transport_routes WHERE id=$1 AND school_id=$2 FOR UPDATE`,
        [routeId, schoolId],
      ).then((response) => {
        if (!response.rows[0]) throw new AuthError(404, "Route not found");
      });
      const currentResult = await client.query(
        `SELECT id,school_id AS "schoolId",route_id AS "routeId",name,stop_type AS "stopType",
                sequence,notes,is_active AS "isActive",created_at AS "createdAt",updated_at AS "updatedAt"
           FROM transport_route_stops
          WHERE id=$1 AND route_id=$2 AND school_id=$3
          FOR UPDATE`,
        [stopId, routeId, schoolId],
      );
      if (!currentResult.rows[0]) throw new AuthError(404, "Route stop not found");
      const current = currentResult.rows[0] as JsonRecord;
      const isActive = body.isActive === undefined
        ? Boolean(current.isActive)
        : optionalBoolean(body.isActive, "isActive")!;
      const stopType = body.stopType === undefined
        ? String(current.stopType)
        : oneOf(body.stopType, ["PICKUP", "DROPOFF", "BOTH"] as const, "stopType");
      const assignmentsUsingStop = await client.query(
        `SELECT 1 FROM transport_student_assignments
          WHERE school_id=$1 AND route_id=$2 AND status IN ('ACTIVE','SUSPENDED')
            AND (pickup_stop_id=$3 OR dropoff_stop_id=$3)
          LIMIT 1`,
        [schoolId, routeId, stopId],
      );
      if (assignmentsUsingStop.rows[0] && !isActive) {
        throw new AuthError(409, "Reassign or deactivate students before deactivating a stop they use");
      }
      if (assignmentsUsingStop.rows[0]) {
        const invalidatedAssignments = await client.query(
          `SELECT 1 FROM transport_student_assignments
            WHERE school_id=$1 AND route_id=$2 AND status IN ('ACTIVE','SUSPENDED')
              AND (
                (pickup_stop_id=$3 AND $4::text NOT IN ('PICKUP','BOTH'))
                OR (dropoff_stop_id=$3 AND $4::text NOT IN ('DROPOFF','BOTH'))
              )
            LIMIT 1`,
          [schoolId, routeId, stopId, stopType],
        );
        if (invalidatedAssignments.rows[0]) {
        throw new AuthError(409, "Deactivate or reassign students before changing the type of a stop they use");
        }
      }
      const sequence = body.sequence === undefined
        ? Number(current.sequence)
        : requireRecordId(body.sequence, "sequence");
      const name = body.name === undefined ? String(current.name) : requiredText(body.name, "name", 120, 2);
      const notes = body.notes === undefined ? current.notes : optionalText(body.notes, "notes", 500);
      if (sequence !== Number(current.sequence)) {
        const invalidatedPair = await client.query(
          `SELECT 1
             FROM transport_student_assignments assignment
             JOIN transport_route_stops pickup
               ON pickup.id=assignment.pickup_stop_id
              AND pickup.route_id=assignment.route_id
              AND pickup.school_id=assignment.school_id
             JOIN transport_route_stops dropoff
               ON dropoff.id=assignment.dropoff_stop_id
              AND dropoff.route_id=assignment.route_id
              AND dropoff.school_id=assignment.school_id
            WHERE assignment.school_id=$1 AND assignment.route_id=$2
              AND assignment.status IN ('ACTIVE','SUSPENDED')
              AND (
                (assignment.pickup_stop_id=$3 AND $4::int >= dropoff.sequence)
                OR (assignment.dropoff_stop_id=$3 AND $4::int <= pickup.sequence)
              )
            LIMIT 1`,
          [schoolId, routeId, stopId, sequence],
        );
        if (invalidatedPair.rows[0]) {
          throw new AuthError(409, "Reassign students before changing this stop's order across an active pickup/drop-off pair");
        }
      }
      const updated = await client.query(
        `UPDATE transport_route_stops
            SET name=$1,stop_type=$2,sequence=$3,notes=$4,is_active=$5,updated_at=NOW()
          WHERE id=$6 AND route_id=$7 AND school_id=$8
          RETURNING id,school_id AS "schoolId",route_id AS "routeId",name,
                    stop_type AS "stopType",sequence,notes,is_active AS "isActive",
                    created_at AS "createdAt",updated_at AS "updatedAt"`,
        [name, stopType, sequence, notes, isActive, stopId, routeId, schoolId],
      );
      const after = stopShape(updated.rows[0], schoolId, routeId);
      await appendHistory(client, req, {
        schoolId,
        entity: "route",
        entityId: routeId,
        eventType: "ROUTE_STOP_UPDATED",
        effectiveDate: new Date().toISOString().slice(0, 10),
        reason: "School-admin pickup/drop-off stop change",
        before: current,
        after,
      });
      return after;
    });
  } catch (error) {
    throw error;
  }
  res.json(result);
}));

router.get("/transport/policy", run(async (req, res) => {
  const schoolId = querySchoolId(req);
  authorizeSchoolRead(req, schoolId);
  res.json({ schoolId, ...await getSchoolTransportPaymentPolicy(pool, schoolId) });
}));

router.patch("/transport/policy", run(async (req, res) => {
  const schoolId = querySchoolId(req);
  const context = authorizeSchoolWrite(req, schoolId);
  const body = record(req.body, ["paymentRequired", "suspendWhenOverdue"]);
  ensureOptionalBody(body, true);
  const paymentRequired = optionalBoolean(body.paymentRequired, "paymentRequired");
  const suspendWhenOverdue = optionalBoolean(body.suspendWhenOverdue, "suspendWhenOverdue");
  const updated = await inTransaction(async (client) => {
    await client.query(
      `SELECT id FROM schools WHERE id=$1 FOR UPDATE`,
      [schoolId],
    );
    const existing = await getSchoolTransportPaymentPolicy(client, schoolId, true);
    const next = {
      paymentRequired: paymentRequired ?? existing.paymentRequired,
      suspendWhenOverdue: suspendWhenOverdue ?? existing.suspendWhenOverdue,
    };
    if (next.suspendWhenOverdue && !next.paymentRequired) {
      throw new AuthError(400, "Overdue suspension requires paymentRequired to be enabled");
    }
    await client.query(
      `INSERT INTO transport_school_policies
         (school_id,payment_required,suspend_when_overdue,updated_by,updated_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (school_id)
       DO UPDATE SET payment_required=EXCLUDED.payment_required,
                     suspend_when_overdue=EXCLUDED.suspend_when_overdue,
                     updated_by=EXCLUDED.updated_by,updated_at=NOW()`,
      [schoolId, next.paymentRequired, next.suspendWhenOverdue, context.user.id],
    );
    const role = actorRole(req, schoolId);
    const userContext = getUserContext(req);
    await client.query(
      `INSERT INTO audit_logs
         ("user",role,actor_user_id,clerk_user_id,school_id,action,module,
          severity,event_type,result,metadata)
       VALUES ($1,$2,$3,$4,$5,'TRANSPORT_POLICY_UPDATED','School Transport',
               'warning','APPLICATION_EVENT','SUCCESS',$6::jsonb)`,
      [
        actorName(req),
        role,
        userContext.user.id,
        userContext.user.clerkUserId,
        schoolId,
        JSON.stringify({ previous: existing, current: next }),
      ],
    );
    return { schoolId, ...next };
  });
  res.json(updated);
}));

router.post("/transport/finance/terms/:termId/generate", run(async (req, res) => {
  const schoolId = querySchoolId(req);
  authorizeSchoolWrite(req, schoolId);
  const termId = requestId(req.params.termId, "termId");
  res.json(await generateTransportInvoicesForAcademicTerm(schoolId, termId, req));
}));

router.get("/transport/platform-owner/overview", run(async (req, res) => {
  const context = getUserContext(req);
  assertRoles(req, ["PLATFORM_OWNER"]);
  if (!isPlatformOwner(context)) {
    throw new AuthError(403, "Platform Owner access is required");
  }
  const schoolId = req.query.schoolId === undefined ? null : requireRecordId(req.query.schoolId, "schoolId");
  const academicSessionId = req.query.academicSessionId === undefined
    ? null
    : requireRecordId(req.query.academicSessionId, "academicSessionId");
  const academicTermId = req.query.academicTermId === undefined
    ? null
    : requireRecordId(req.query.academicTermId, "academicTermId");
  const invoiceStatus = req.query.status === undefined || req.query.status === "all"
    ? null
    : oneOf(req.query.status, ["UNPAID", "PARTIALLY_PAID", "PAID", "OVERDUE", "WAIVED", "CANCELLED"] as const, "status");
  const fromDate = req.query.fromDate === undefined
    ? null
    : requireTransportDate(req.query.fromDate, "fromDate");
  const toDate = req.query.toDate === undefined
    ? null
    : requireTransportDate(req.query.toDate, "toDate");
  if (fromDate && toDate && fromDate > toDate) {
    throw new AuthError(400, "fromDate must be on or before toDate");
  }
  const search = typeof req.query.search === "string" ? req.query.search.trim().slice(0, 100) : "";
  const rawLimit = req.query.limit === undefined ? 50 : requireRecordId(req.query.limit, "limit");
  if (rawLimit > 100) throw new AuthError(400, "limit cannot exceed 100 global invoice history records");
  const employeeId = req.query.employeeId === undefined
    ? null
    : requireRecordId(req.query.employeeId, "employeeId");
  const stats = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM transport_buses bus
         WHERE ($1::int IS NULL OR bus.school_id=$1)) AS "busCount",
       (SELECT count(*)::int FROM transport_buses bus
         WHERE bus.status='ACTIVE' AND ($1::int IS NULL OR bus.school_id=$1)) AS "activeBusCount",
       (SELECT COALESCE(sum(bus.capacity),0)::int FROM transport_buses bus
         WHERE bus.status='ACTIVE' AND ($1::int IS NULL OR bus.school_id=$1)) AS "activeSeatCapacity",
       (SELECT count(*)::int FROM transport_routes route
         WHERE route.status='ACTIVE' AND ($1::int IS NULL OR route.school_id=$1)) AS "activeRouteCount",
       (SELECT count(*)::int FROM transport_student_assignments assignment
         WHERE assignment.status='ACTIVE' AND ($1::int IS NULL OR assignment.school_id=$1)) AS "activeAssignmentCount",
       (SELECT count(*)::int FROM transport_student_assignments assignment
         WHERE assignment.status='SUSPENDED' AND ($1::int IS NULL OR assignment.school_id=$1)) AS "suspendedAssignmentCount",
       (SELECT count(*)::int FROM transport_student_assignments assignment
         WHERE assignment.status='DEACTIVATED' AND ($1::int IS NULL OR assignment.school_id=$1)) AS "deactivatedAssignmentCount",
       (SELECT count(DISTINCT route.driver_employee_id)::int
          FROM transport_routes route
         WHERE route.status='ACTIVE' AND ($1::int IS NULL OR route.school_id=$1)) AS "assignedDriverCount",
       (SELECT count(*)::int FROM transport_route_staff staff
         WHERE staff.is_active AND ($1::int IS NULL OR staff.school_id=$1)) AS "activeCompanionCount",
       (SELECT count(*)::int FROM transport_parent_requests request
         WHERE request.status='PENDING' AND ($1::int IS NULL OR request.school_id=$1)) AS "pendingParentRequestCount"`,
    [schoolId],
  );
  const finance = await pool.query(
    `SELECT count(*)::int AS "invoiceCount",
            COALESCE(sum(invoice.total_minor),0)::bigint AS "invoicedMinor",
            COALESCE(sum(invoice.paid_minor),0)::bigint AS "paidMinor",
            COALESCE(sum(invoice.outstanding_minor),0)::bigint AS "outstandingMinor",
            count(*) FILTER (WHERE invoice.status='PAID')::int AS "paidInvoiceCount",
            count(*) FILTER (WHERE invoice.status='OVERDUE')::int AS "overdueInvoiceCount"
       FROM transport_fee_invoices transport
       JOIN fee_invoices invoice
         ON invoice.id=transport.fee_invoice_id AND invoice.school_id=transport.school_id
      WHERE ($1::int IS NULL OR transport.school_id=$1)
        AND ($2::int IS NULL OR transport.academic_session_id=$2)
        AND ($3::int IS NULL OR transport.academic_term_id=$3)
        AND ($4::date IS NULL OR invoice.issue_date >= $4)
        AND ($5::date IS NULL OR invoice.issue_date <= $5)
        AND ($6::text IS NULL OR invoice.status=$6)
        AND ($7::int IS NULL OR EXISTS(
              SELECT 1 FROM transport_student_assignments employee_assignment
               JOIN transport_routes employee_route
                 ON employee_route.id=employee_assignment.route_id
                AND employee_route.school_id=employee_assignment.school_id
              WHERE employee_assignment.id=transport.assignment_id
                AND employee_route.driver_employee_id=$7))
        AND ($8::text='' OR
             invoice.invoice_number ILIKE '%' || $8 || '%' OR
             invoice.student_name_snapshot ILIKE '%' || $8 || '%' OR
             invoice.admission_no_snapshot ILIKE '%' || $8 || '%' OR
             EXISTS (SELECT 1 FROM schools school
                      WHERE school.id=transport.school_id
                        AND (school.name ILIKE '%' || $8 || '%' OR school.code ILIKE '%' || $8 || '%')))`,
    [schoolId, academicSessionId, academicTermId, fromDate, toDate, invoiceStatus, employeeId, search],
  );
  const invoices = await pool.query(
    `SELECT invoice.id AS "invoiceId",invoice.school_id AS "schoolId",
            school.name AS "schoolName",invoice.invoice_number AS "invoiceNumber",
            invoice.student_id AS "studentId",invoice.student_name_snapshot AS "studentName",
            invoice.admission_no_snapshot AS "admissionNo",
            invoice.academic_session_id AS "academicSessionId",session.name AS "sessionName",
            invoice.academic_term_id AS "academicTermId",term.name AS "termName",
            invoice.currency,invoice.total_minor AS "totalMinor",invoice.paid_minor AS "paidMinor",
            invoice.outstanding_minor AS "outstandingMinor",invoice.status,
            invoice.issue_date::text AS "issueDate",invoice.due_date::text AS "dueDate",
            assignment.id AS "assignmentId",route.id AS "routeId",route.name AS "routeName",
            route.driver_employee_id AS "driverEmployeeId",
            driver.first_name || ' ' || driver.last_name AS "driverName",
            transport.created_at AS "generatedAt",
            COALESCE(receipt_rows.receipts,'[]'::jsonb) AS receipts
       FROM transport_fee_invoices transport
       JOIN fee_invoices invoice
         ON invoice.id=transport.fee_invoice_id AND invoice.school_id=transport.school_id
       JOIN schools school ON school.id=transport.school_id
       JOIN academic_sessions session
         ON session.id=transport.academic_session_id AND session.school_id=transport.school_id
       JOIN academic_terms term
         ON term.id=transport.academic_term_id AND term.school_id=transport.school_id
       JOIN transport_student_assignments assignment
         ON assignment.id=transport.assignment_id AND assignment.school_id=transport.school_id
       JOIN transport_routes route ON route.id=assignment.route_id AND route.school_id=assignment.school_id
       JOIN employees driver ON driver.id=route.driver_employee_id AND driver.school_id=route.school_id
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object('id',receipt.id,'receiptNumber',receipt.receipt_number)
                          ORDER BY receipt.id) AS receipts
           FROM fee_receipts receipt
          WHERE receipt.school_id=transport.school_id AND receipt.invoice_id=invoice.id
       ) receipt_rows ON TRUE
      WHERE ($1::int IS NULL OR transport.school_id=$1)
        AND ($2::int IS NULL OR transport.academic_session_id=$2)
        AND ($3::int IS NULL OR transport.academic_term_id=$3)
        AND ($4::date IS NULL OR invoice.issue_date >= $4)
        AND ($5::date IS NULL OR invoice.issue_date <= $5)
        AND ($6::text IS NULL OR invoice.status=$6)
        AND ($7::int IS NULL OR route.driver_employee_id=$7)
        AND ($8::text='' OR
             invoice.invoice_number ILIKE '%' || $8 || '%' OR
             invoice.student_name_snapshot ILIKE '%' || $8 || '%' OR
             invoice.admission_no_snapshot ILIKE '%' || $8 || '%' OR
             school.name ILIKE '%' || $8 || '%' OR school.code ILIKE '%' || $8 || '%')
      ORDER BY invoice.issue_date DESC,transport.created_at DESC,invoice.id DESC
      LIMIT $9`,
    [schoolId, academicSessionId, academicTermId, fromDate, toDate, invoiceStatus, employeeId, search, rawLimit],
  );
  res.json({
    readOnly: true,
    generatedAt: new Date().toISOString(),
    filters: {
      schoolId,
      academicSessionId,
      academicTermId,
      fromDate,
      toDate,
      invoiceStatus: invoiceStatus ?? "all",
      employeeId,
      search,
    },
    operationalSummary: {
      busCount: Number(stats.rows[0]?.busCount ?? 0),
      activeBusCount: Number(stats.rows[0]?.activeBusCount ?? 0),
      activeSeatCapacity: Number(stats.rows[0]?.activeSeatCapacity ?? 0),
      activeRouteCount: Number(stats.rows[0]?.activeRouteCount ?? 0),
      activeAssignmentCount: Number(stats.rows[0]?.activeAssignmentCount ?? 0),
      suspendedAssignmentCount: Number(stats.rows[0]?.suspendedAssignmentCount ?? 0),
      deactivatedAssignmentCount: Number(stats.rows[0]?.deactivatedAssignmentCount ?? 0),
      assignedDriverCount: Number(stats.rows[0]?.assignedDriverCount ?? 0),
      activeCompanionCount: Number(stats.rows[0]?.activeCompanionCount ?? 0),
      pendingParentRequestCount: Number(stats.rows[0]?.pendingParentRequestCount ?? 0),
    },
    financeSummary: {
      invoiceCount: Number(finance.rows[0]?.invoiceCount ?? 0),
      invoicedMinor: Number(finance.rows[0]?.invoicedMinor ?? 0),
      paidMinor: Number(finance.rows[0]?.paidMinor ?? 0),
      outstandingMinor: Number(finance.rows[0]?.outstandingMinor ?? 0),
      paidInvoiceCount: Number(finance.rows[0]?.paidInvoiceCount ?? 0),
      overdueInvoiceCount: Number(finance.rows[0]?.overdueInvoiceCount ?? 0),
    },
    invoices: invoices.rows.map((invoice) => ({
      ...invoice,
      invoiceId: Number(invoice.invoiceId),
      schoolId: Number(invoice.schoolId),
      studentId: Number(invoice.studentId),
      academicSessionId: Number(invoice.academicSessionId),
      academicTermId: Number(invoice.academicTermId),
      assignmentId: Number(invoice.assignmentId),
      routeId: Number(invoice.routeId),
      driverEmployeeId: Number(invoice.driverEmployeeId),
      totalMinor: Number(invoice.totalMinor),
      paidMinor: Number(invoice.paidMinor),
      outstandingMinor: Number(invoice.outstandingMinor),
      receipts: jsonArray(invoice.receipts).map((receipt) => ({
        id: Number(receipt.id),
        receiptNumber: String(receipt.receiptNumber),
      })),
    })),
    invoiceTotalCount: Number(finance.rows[0]?.invoiceCount ?? 0),
  });
}));

export default router;