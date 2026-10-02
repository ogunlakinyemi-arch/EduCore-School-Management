import { createHash } from "node:crypto";
import type { Request } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { AuthError, getUserContext } from "../middlewares/auth";
import {
  emitDomainParentEvent,
  type CommunicationQueryClient,
} from "./communication-service";
import { getStaffNfcEligibility } from "../routes/staff-nfc-billing-service";

export const securityEventTypeSchema = z.enum(["ENTRY", "EXIT"]);
export const securityAccessPermissionSchema = z.enum([
  "SECURITY_READ",
  "SECURITY_MANAGE",
  "VISITOR_MANAGE",
  "PICKUP_APPROVE",
  "INCIDENT_MANAGE",
  "EMERGENCY_BROADCAST",
  "COMMUNICATION_SEND",
  "MANAGE_READERS",
  "MANAGE_CARDS",
  "REVIEW_PRESENCE",
]);
export const securityPermissionSchema = z.enum([
  "READ",
  "MANAGE_READERS",
  "MANAGE_CARDS",
  "REVIEW_PRESENCE",
  "SECURITY_READ",
  "SECURITY_MANAGE",
  "VISITOR_MANAGE",
  "PICKUP_APPROVE",
  "INCIDENT_MANAGE",
  "EMERGENCY_BROADCAST",
  "COMMUNICATION_SEND",
]);
export const locationInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  zoneType: z.enum(["GATE", "CAMPUS", "BUILDING", "OTHER"]).default("OTHER"),
}).strict();
export const readerInputSchema = z.object({
  locationId: z.number().int().positive(),
  deviceId: z.number().int().positive(),
  name: z.string().trim().min(2).max(120),
  permissions: z.array(securityEventTypeSchema).min(1).max(2),
}).strict();
export const securitySettingsInputSchema = z.object({
  securityEnabled: z.boolean(),
  parentEntryAlerts: z.boolean(),
  parentExitAlerts: z.boolean(),
}).strict();
export const grantInputSchema = z.object({
  userId: z.number().int().positive(),
  permissions: z.array(securityPermissionSchema).min(1).max(11)
    .refine((permissions) => new Set(permissions).size === permissions.length, "Permissions must be unique"),
  expiresAt: z.string().datetime().nullable().optional(),
}).strict();
export const presenceReviewInputSchema = z.object({
  state: z.enum(["ON_CAMPUS", "OFF_CAMPUS"]),
  reason: z.string().trim().min(3).max(500),
}).strict();

const locationSchema = z.object({
  id: z.number().int().positive(),
  schoolId: z.number().int().positive(),
  name: z.string(),
  description: z.string().nullable(),
  zoneType: z.enum(["GATE", "CAMPUS", "BUILDING", "OTHER"]),
  status: z.enum(["ACTIVE", "INACTIVE"]),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
const readerSchema = z.object({
  id: z.number().int().positive(),
  schoolId: z.number().int().positive(),
  locationId: z.number().int().positive(),
  deviceId: z.number().int().positive(),
  deviceName: z.string(),
  deviceSerial: z.string(),
  name: z.string(),
  status: z.enum(["ACTIVE", "INACTIVE"]),
  permissions: z.array(securityEventTypeSchema),
  locationName: z.string(),
});
const securityEventSchema = z.object({
  id: z.number().int().positive(),
  schoolId: z.number().int().positive(),
  readerId: z.number().int().nullable(),
  locationId: z.number().int().nullable(),
  deviceId: z.number().int().positive(),
  personType: z.enum(["STUDENT", "STAFF", "UNKNOWN"]),
  personName: z.string().nullable(),
  studentId: z.number().int().nullable(),
  employeeId: z.number().int().nullable(),
  eventType: securityEventTypeSchema,
  identityResult: z.enum(["CONFIRMED", "REJECTED"]),
  reasonCode: z.string().nullable(),
  locationName: z.string().nullable(),
  readerName: z.string().nullable(),
  className: z.string().nullable(),
  section: z.string().nullable(),
  occurredAt: z.string().datetime(),
  receivedAt: z.string().datetime(),
  syncStatus: z.literal("SYNCED"),
  physicalControlStatus: z.literal("NOT_CONNECTED"),
});
const presenceSchema = z.object({
  id: z.number().int().positive(),
  schoolId: z.number().int().positive(),
  personType: z.enum(["STUDENT", "STAFF"]),
  studentId: z.number().int().nullable(),
  employeeId: z.number().int().nullable(),
  personName: z.string(),
  admissionNumber: z.string().nullable(),
  employeeNumber: z.string().nullable(),
  className: z.string().nullable(),
  section: z.string().nullable(),
  state: z.enum(["ON_CAMPUS", "OFF_CAMPUS", "REQUIRES_REVIEW"]),
  lastOccurredAt: z.string().datetime(),
  reviewReason: z.string().nullable(),
});
export const parentChildSecuritySummarySchema = z.object({
  studentId: z.number().int().positive(),
  schoolId: z.number().int().positive(),
  nfcStatus: z.enum(["ACTIVE", "LOST", "INACTIVE", "NO_CARD"]),
  currentPresence: z.object({
    state: z.enum(["ON_CAMPUS", "OFF_CAMPUS", "REQUIRES_REVIEW"]),
    lastOccurredAt: z.string().datetime(),
  }).nullable(),
  recentEvents: z.array(z.object({
    eventType: securityEventTypeSchema,
    occurredAt: z.string().datetime(),
  }).strict()).max(10),
}).strict();
export const schoolSecurityAccessSchema = z.object({
  schoolId: z.number().int().positive(),
  actorRole: z.enum(["PLATFORM_OWNER", "SCHOOL_ADMIN", "STAFF"]).nullable(),
  canView: z.boolean(),
  readOnly: z.boolean(),
  permissions: z.array(securityAccessPermissionSchema),
  grantedPermissions: z.array(securityPermissionSchema),
}).strict();
export const securityDashboardSchema = z.object({
  schoolId: z.number().int().positive(),
  range: z.object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
  }).strict(),
  studentsOnCampus: z.number().int().nonnegative(),
  staffOnCampus: z.number().int().nonnegative(),
  offCampusPeople: z.number().int().nonnegative(),
  presenceRequiresReview: z.number().int().nonnegative(),
  acceptedEntryEvents: z.number().int().nonnegative(),
  acceptedExitEvents: z.number().int().nonnegative(),
  visitorsCurrentlyOnCampus: z.number().int().nonnegative(),
  todayVisitorCheckIns: z.number().int().nonnegative(),
  openIncidents: z.number().int().nonnegative(),
  pendingPickupRequests: z.number().int().nonnegative(),
  lateArrivals: z.number().int().nonnegative(),
  earlyDepartures: z.number().int().nonnegative(),
  rejectedAttempts: z.number().int().nonnegative(),
  revokedCardAttempts: z.number().int().nonnegative(),
  visitorCountsAvailable: z.literal(true),
  physicalAccessControl: z.literal("NOT_CONNECTED"),
}).strict();
export const eligibleSecurityDeviceSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  serialNumber: z.string(),
  deviceType: z.enum(["NFC", "BIOMETRIC", "HYBRID"]),
  readerId: z.number().int().positive().nullable(),
  readerName: z.string().nullable(),
  locationId: z.number().int().positive().nullable(),
});

type SecurityDb = Pick<CommunicationQueryClient, "query">;
type SecurityTransactionClient = SecurityDb & { release(): void };
export type SecurityEventType = z.infer<typeof securityEventTypeSchema>;
export type SecurityAccessPermission = z.infer<typeof securityAccessPermissionSchema>;
export type SecurityPermission = z.infer<typeof securityPermissionSchema>;
const ALL_SECURITY_PERMISSIONS: SecurityAccessPermission[] = [
  "SECURITY_READ", "SECURITY_MANAGE", "VISITOR_MANAGE", "PICKUP_APPROVE",
  "INCIDENT_MANAGE", "EMERGENCY_BROADCAST", "COMMUNICATION_SEND",
  "MANAGE_READERS", "MANAGE_CARDS", "REVIEW_PRESENCE",
];
const MANAGEMENT_SUBPERMISSIONS: SecurityAccessPermission[] = [
  "MANAGE_READERS", "MANAGE_CARDS", "REVIEW_PRESENCE",
];

async function withSecurityTransaction<T>(
  work: (client: SecurityTransactionClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect() as unknown as SecurityTransactionClient;
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch { /* preserve the original failure */ }
    throw error;
  } finally {
    client.release();
  }
}

function num(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : 0;
}

function dateTime(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new AuthError(500, "Stored security event has an invalid timestamp");
  return date.toISOString();
}

function jsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") {
    const parsed = value.replace(/^\{|\}$/g, "").split(",").filter(Boolean);
    return parsed;
  }
  return [];
}

async function schoolExists(schoolId: number, db: SecurityDb = pool) {
  const school = await db.query(`SELECT id FROM schools WHERE id=$1`, [schoolId]);
  if (!school.rows[0]) throw new AuthError(404, "School not found");
}

type LiveSecurityAccess = {
  context: ReturnType<typeof getUserContext>;
  owner: boolean;
  schoolAdmin: boolean;
  eligibleStaff: boolean;
  restrictedInternal: boolean;
  directPermissions: SecurityPermission[];
};

async function loadLiveSecurityAccess(
  req: Request,
  schoolId: number,
  db: SecurityDb = pool,
): Promise<LiveSecurityAccess> {
  const context = getUserContext(req);
  await schoolExists(schoolId, db);
  const actor = await db.query(
    `SELECT
       EXISTS(SELECT 1 FROM school_memberships sm
         WHERE sm.user_id=u.id AND sm.school_id IS NULL AND sm.role='PLATFORM_OWNER' AND sm.status='ACTIVE') AS owner,
       EXISTS(SELECT 1 FROM school_memberships sm
         WHERE sm.user_id=u.id AND sm.school_id=$3 AND sm.role='SCHOOL_ADMIN' AND sm.status='ACTIVE') AS school_admin,
       EXISTS(SELECT 1 FROM school_memberships sm
         WHERE sm.user_id=u.id AND sm.school_id=$3 AND sm.status='ACTIVE'
           AND sm.role IN ('STAFF','TEACHER','ACCOUNTANT')) AS eligible_staff,
       EXISTS(SELECT 1 FROM school_memberships sm
         WHERE sm.user_id=u.id AND sm.status='ACTIVE'
           AND sm.role IN ('DEVICE_ACTIVATION_OFFICER','COMPANY_ACCOUNTANT')) AS restricted_internal
       FROM app_users u
      WHERE u.id=$1 AND u.clerk_user_id=$2 AND UPPER(u.status)='ACTIVE'`,
    [context.user.id, context.user.clerkUserId, schoolId],
  );
  if (!actor.rows[0]) throw new AuthError(404, "School security not found");
  const row = actor.rows[0];
  const owner = Boolean(row.owner) && !row.restricted_internal;
  const schoolAdmin = Boolean(row.school_admin) && !row.restricted_internal;
  const eligibleStaff = Boolean(row.eligible_staff) && !row.restricted_internal;
  let directPermissions: SecurityPermission[] = [];
  if (eligibleStaff) {
    const grants = await db.query(
      `SELECT DISTINCT granted.permission
         FROM security_staff_grants g
         JOIN app_users u ON u.id=g.user_id AND u.clerk_user_id=$3 AND UPPER(u.status)='ACTIVE'
         CROSS JOIN LATERAL unnest(g.permissions) AS granted(permission)
        WHERE g.school_id=$1 AND g.user_id=$2 AND g.status='ACTIVE'
          AND (g.expires_at IS NULL OR g.expires_at>NOW())
          AND EXISTS (
            SELECT 1 FROM school_memberships sm
             WHERE sm.user_id=g.user_id AND sm.school_id=g.school_id AND sm.status='ACTIVE'
               AND sm.role IN ('STAFF','TEACHER','ACCOUNTANT')
          )
          AND NOT EXISTS (
            SELECT 1 FROM school_memberships internal
             WHERE internal.user_id=g.user_id AND internal.status='ACTIVE'
               AND internal.role IN ('DEVICE_ACTIVATION_OFFICER','COMPANY_ACCOUNTANT')
          )`,
      [schoolId, context.user.id, context.user.clerkUserId],
    );
    directPermissions = grants.rows.map((grant: any) => String(grant.permission) as SecurityPermission);
  }
  return { context, owner, schoolAdmin, eligibleStaff, restrictedInternal: Boolean(row.restricted_internal), directPermissions };
}

function permissionsForAccess(access: LiveSecurityAccess): SecurityAccessPermission[] {
  if (access.restrictedInternal) return [];
  if (access.owner) return ["SECURITY_READ"];
  if (access.schoolAdmin) return [...ALL_SECURITY_PERMISSIONS];
  const direct = new Set(access.directPermissions);
  const permissions = new Set<SecurityAccessPermission>();
  if (direct.has("READ") || direct.has("SECURITY_READ")) permissions.add("SECURITY_READ");
  for (const permission of direct) {
    if (permission !== "READ") permissions.add(permission);
  }
  if (direct.has("SECURITY_MANAGE")) {
    permissions.add("SECURITY_READ");
    for (const permission of MANAGEMENT_SUBPERMISSIONS) permissions.add(permission);
  }
  return ALL_SECURITY_PERMISSIONS.filter((permission) => permissions.has(permission));
}

function accessHasPermission(access: LiveSecurityAccess, permission: SecurityAccessPermission) {
  if (access.restrictedInternal) return false;
  if (access.owner) return permission === "SECURITY_READ";
  if (access.schoolAdmin) return true;
  const direct = new Set(access.directPermissions);
  if (permission === "SECURITY_READ") {
    return direct.has("READ") || direct.has("SECURITY_READ") || direct.has("SECURITY_MANAGE");
  }
  if (permission === "SECURITY_MANAGE") return direct.has("SECURITY_MANAGE");
  if (MANAGEMENT_SUBPERMISSIONS.includes(permission)) {
    return direct.has(permission as SecurityPermission) || direct.has("SECURITY_MANAGE");
  }
  return direct.has(permission as SecurityPermission);
}

export async function getSchoolSecurityAccess(req: Request, schoolId: number) {
  const access = await loadLiveSecurityAccess(req, schoolId);
  const permissions = permissionsForAccess(access);
  const actorRole = access.owner ? "PLATFORM_OWNER"
    : access.schoolAdmin ? "SCHOOL_ADMIN"
      : access.eligibleStaff ? "STAFF" : null;
  return schoolSecurityAccessSchema.parse({
    schoolId,
    actorRole,
    canView: permissions.includes("SECURITY_READ"),
    readOnly: access.owner,
    permissions,
    grantedPermissions: access.schoolAdmin || access.owner ? [] : access.directPermissions,
  });
}

/**
 * Shared authorization contract for core and expanded school-security routes.
 * Platform Owner access is opt-in and read-only; all other access is school
 * scoped to an active School Admin or an explicit active staff grant.
 */
export async function requireSecurityAccess(
  req: Request,
  schoolId: number,
  permission: SecurityAccessPermission,
  options: { ownerReadOnly?: boolean } = {},
) {
  const access = await loadLiveSecurityAccess(req, schoolId);
  if (access.owner) {
    if (permission === "SECURITY_READ" && options.ownerReadOnly === true) return access.context;
    throw new AuthError(404, "School security operation not found");
  }
  if (accessHasPermission(access, permission)) return access.context;
  throw new AuthError(404, "School security operation not found");
}

export async function requireAnySecurityAccess(
  req: Request,
  schoolId: number,
  permissions: SecurityAccessPermission[],
) {
  const access = await loadLiveSecurityAccess(req, schoolId);
  if (access.owner) {
    if (permissions.includes("SECURITY_READ")) return access.context;
    throw new AuthError(404, "School security operation not found");
  }
  if (permissions.some((permission) => accessHasPermission(access, permission))) return access.context;
  throw new AuthError(404, "School security operation not found");
}

export async function assertSecurityRead(req: Request, schoolId: number) {
  return requireSecurityAccess(req, schoolId, "SECURITY_READ", { ownerReadOnly: true });
}

export async function assertSecurityMutation(
  req: Request,
  schoolId: number,
  permission: Exclude<SecurityPermission, "READ">,
) {
  const permissionMap: Record<Exclude<SecurityPermission, "READ">, SecurityAccessPermission> = {
    MANAGE_READERS: "MANAGE_READERS",
    MANAGE_CARDS: "MANAGE_CARDS",
    REVIEW_PRESENCE: "REVIEW_PRESENCE",
    SECURITY_READ: "SECURITY_READ",
    SECURITY_MANAGE: "SECURITY_MANAGE",
    VISITOR_MANAGE: "VISITOR_MANAGE",
    PICKUP_APPROVE: "PICKUP_APPROVE",
    INCIDENT_MANAGE: "INCIDENT_MANAGE",
    EMERGENCY_BROADCAST: "EMERGENCY_BROADCAST",
    COMMUNICATION_SEND: "COMMUNICATION_SEND",
  };
  return requireSecurityAccess(req, schoolId, permissionMap[permission]);
}

export async function grantSchoolSecurityStaff(
  req: Request,
  schoolId: number,
  input: z.infer<typeof grantInputSchema>,
) {
  const context = getUserContext(req);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const access = await loadLiveSecurityAccess(req, schoolId, client);
    if (access.owner || !access.schoolAdmin) throw new AuthError(404, "School security grants not found");
    const recipient = await client.query(
      `SELECT u.id FROM app_users u
        WHERE u.id=$1 AND UPPER(u.status)='ACTIVE'
          AND EXISTS(SELECT 1 FROM school_memberships sm
                       WHERE sm.user_id=u.id AND sm.school_id=$2 AND sm.status='ACTIVE'
                         AND sm.role IN ('STAFF','TEACHER','ACCOUNTANT'))
          AND NOT EXISTS(SELECT 1 FROM school_memberships internal
                       WHERE internal.user_id=u.id AND internal.status='ACTIVE'
                         AND internal.role IN ('DEVICE_ACTIVATION_OFFICER','COMPANY_ACCOUNTANT'))
        FOR UPDATE`,
      [input.userId, schoolId],
    );
    if (!recipient.rows[0]) throw new AuthError(404, "Active school staff member not found");
    await client.query(
      `UPDATE security_staff_grants
          SET status='EXPIRED',revoked_at=COALESCE(revoked_at,NOW()),updated_at=NOW()
        WHERE school_id=$1 AND user_id=$2 AND status='ACTIVE'
          AND expires_at IS NOT NULL AND expires_at<=NOW()`,
      [schoolId,input.userId],
    );
    const current = await client.query(
      `SELECT id FROM security_staff_grants WHERE school_id=$1 AND user_id=$2 AND status='ACTIVE' FOR UPDATE`,
      [schoolId, input.userId],
    );
    if (current.rows[0]) {
      throw new AuthError(409, "This staff member already has an active security grant; revoke it before issuing a replacement");
    }
    const inserted = await client.query(
      `INSERT INTO security_staff_grants
         (school_id,user_id,permissions,expires_at,granted_by_user_id)
       VALUES($1,$2,$3,$4,$5) RETURNING id,permissions,expires_at AS "expiresAt"`,
      [schoolId, input.userId, input.permissions, input.expiresAt ?? null, context.user.id],
    );
    await auditSecurityAction(client, req, schoolId, "Granted delegated school security permissions", Number(inserted.rows[0].id), {
      userId: input.userId, permissions: input.permissions, expiresAt: input.expiresAt ?? null,
    });
    await client.query("COMMIT");
    return {
      id: num(inserted.rows[0].id),
      userId: input.userId,
      schoolId,
      permissions: jsonArray(inserted.rows[0].permissions),
      expiresAt: inserted.rows[0].expiresAt == null ? null : dateTime(inserted.rows[0].expiresAt),
      status: "ACTIVE" as const,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function revokeSchoolSecurityGrant(req: Request, schoolId: number, grantId: number) {
  const context = getUserContext(req);
  return withSecurityTransaction(async (client) => {
    const access = await loadLiveSecurityAccess(req, schoolId, client);
    if (access.owner || !access.schoolAdmin) throw new AuthError(404, "School security grants not found");
    const result = await client.query(
      `UPDATE security_staff_grants
          SET status='REVOKED',revoked_by_user_id=$1,revoked_at=NOW(),updated_at=NOW()
        WHERE id=$2 AND school_id=$3 AND status='ACTIVE'
        RETURNING id`,
      [context.user.id, grantId, schoolId],
    );
    if (!result.rows[0]) throw new AuthError(404, "Active security grant not found");
    await auditSecurityAction(client, req, schoolId, "Revoked delegated school security permissions", grantId, {});
    return { id: grantId, schoolId, status: "REVOKED" as const };
  });
}

export async function listSecurityGrants(schoolId: number) {
  const result = await pool.query(
    `SELECT g.id,g.school_id AS "schoolId",g.user_id AS "userId",
            trim(concat_ws(' ',u.first_name,u.last_name)) AS "staffName",
            g.permissions,
            CASE WHEN g.status='ACTIVE' AND g.expires_at<=NOW() THEN 'EXPIRED' ELSE g.status END AS status,
            g.expires_at AS "expiresAt",
            g.granted_by_user_id AS "grantedByUserId",g.revoked_by_user_id AS "revokedByUserId",
            g.revoked_at AS "revokedAt",g.created_at AS "createdAt",g.updated_at AS "updatedAt"
       FROM security_staff_grants g
       JOIN app_users u ON u.id=g.user_id
      WHERE g.school_id=$1
      ORDER BY CASE WHEN g.status='ACTIVE' AND (g.expires_at IS NULL OR g.expires_at>NOW()) THEN 0 ELSE 1 END,
               g.created_at DESC,g.id DESC`,
    [schoolId],
  );
  return result.rows.map((row: any) => ({
    id: num(row.id),
    schoolId: num(row.schoolId),
    userId: num(row.userId),
    staffName: String(row.staffName ?? ""),
    permissions: jsonArray(row.permissions) as SecurityPermission[],
    status: String(row.status),
    expiresAt: row.expiresAt == null ? null : dateTime(row.expiresAt),
    grantedByUserId: num(row.grantedByUserId),
    revokedByUserId: row.revokedByUserId == null ? null : num(row.revokedByUserId),
    revokedAt: row.revokedAt == null ? null : dateTime(row.revokedAt),
    createdAt: dateTime(row.createdAt),
    updatedAt: dateTime(row.updatedAt),
  }));
}

async function auditSecurityAction(
  db: SecurityDb,
  req: Request,
  schoolId: number,
  action: string,
  recordId: number,
  metadata: Record<string, unknown>,
) {
  const context = getUserContext(req);
  await db.query(
    `INSERT INTO audit_logs
       ("user",role,actor_user_id,clerk_user_id,school_id,action,module,record_id,
        severity,event_type,result,metadata)
     VALUES($1,$2,$3,$4,$5,$6,'School Security',$7,'info','SECURITY_CONFIGURATION','SUCCESS',$8::jsonb)`,
    [
      [context.user.firstName, context.user.lastName].filter(Boolean).join(" ") || context.user.email,
      context.roles.find((role) => role.schoolId === schoolId)?.role ?? "SCHOOL_ADMIN",
      context.user.id, context.user.clerkUserId, schoolId, action, recordId, JSON.stringify(metadata),
    ],
  );
}

export async function listSecurityLocations(schoolId: number) {
  const result = await pool.query(
    `SELECT id,school_id AS "schoolId",name,description,zone_type AS "zoneType",status,
            created_at AS "createdAt",updated_at AS "updatedAt"
       FROM security_locations WHERE school_id=$1 ORDER BY name,id`,
    [schoolId],
  );
  return result.rows.map((row: any) => locationSchema.parse({
    ...row, id: num(row.id), schoolId: num(row.schoolId),
    createdAt: dateTime(row.createdAt), updatedAt: dateTime(row.updatedAt),
  }));
}

export async function createSecurityLocation(
  req: Request,
  schoolId: number,
  input: z.infer<typeof locationInputSchema>,
) {
  const context = getUserContext(req);
  return withSecurityTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO security_locations
         (school_id,name,description,zone_type,created_by_user_id,updated_by_user_id)
       VALUES($1,$2,$3,$4,$5,$5)
       RETURNING id,school_id AS "schoolId",name,description,zone_type AS "zoneType",status,
                 created_at AS "createdAt",updated_at AS "updatedAt"`,
      [schoolId, input.name, input.description ?? null, input.zoneType, context.user.id],
    );
    const location = locationSchema.parse({
      ...result.rows[0], id: num(result.rows[0].id), schoolId,
      createdAt: dateTime(result.rows[0].createdAt), updatedAt: dateTime(result.rows[0].updatedAt),
    });
    await auditSecurityAction(client, req, schoolId, "Created security location", location.id, {
      name: location.name, zoneType: location.zoneType,
    });
    return location;
  });
}

export async function setSecurityLocationStatus(
  req: Request,
  schoolId: number,
  locationId: number,
  status: "ACTIVE" | "INACTIVE",
) {
  const context = getUserContext(req);
  return withSecurityTransaction(async (client) => {
    const result = await client.query(
      `UPDATE security_locations SET status=$1,updated_by_user_id=$2,updated_at=NOW()
        WHERE id=$3 AND school_id=$4
        RETURNING id,school_id AS "schoolId",name,description,zone_type AS "zoneType",status,
                  created_at AS "createdAt",updated_at AS "updatedAt"`,
      [status, context.user.id, locationId, schoolId],
    );
    if (!result.rows[0]) throw new AuthError(404, "Security location not found");
    const location = locationSchema.parse({
      ...result.rows[0], id: num(result.rows[0].id), schoolId,
      createdAt: dateTime(result.rows[0].createdAt), updatedAt: dateTime(result.rows[0].updatedAt),
    });
    await auditSecurityAction(client, req, schoolId, "Changed security location status", locationId, { status });
    return location;
  });
}

export async function listSecurityReaders(schoolId: number) {
  const result = await pool.query(
    `SELECT r.id,r.school_id AS "schoolId",r.location_id AS "locationId",r.device_id AS "deviceId",
            d.name AS "deviceName",d.serial_number AS "deviceSerial",r.name,r.status,r.permissions,
            l.name AS "locationName"
       FROM security_readers r
       JOIN platform_devices d ON d.id=r.device_id
       JOIN security_locations l ON l.id=r.location_id AND l.school_id=r.school_id
      WHERE r.school_id=$1 ORDER BY l.name,r.name,r.id`,
    [schoolId],
  );
  return result.rows.map((row: any) => readerSchema.parse({
    ...row, id: num(row.id), schoolId: num(row.schoolId), locationId: num(row.locationId),
    deviceId: num(row.deviceId), permissions: jsonArray(row.permissions),
  }));
}

export async function listEligibleSecurityDevices(schoolId: number) {
  const result = await pool.query(
    `SELECT DISTINCT ON (d.id)
            d.id,d.name,d.serial_number AS "serialNumber",d.device_type AS "deviceType",
            r.id AS "readerId",r.name AS "readerName",r.location_id AS "locationId"
       FROM platform_devices d
       JOIN device_school_bindings binding
         ON binding.device_id=d.id AND binding.school_id=$1
       JOIN device_credentials credential
         ON credential.device_id=d.id AND credential.school_id=$1
        AND credential.status='ACTIVE'
        AND (credential.expires_at IS NULL OR credential.expires_at>NOW())
       LEFT JOIN security_readers r ON r.device_id=d.id AND r.school_id=$1
      WHERE d.school_id=$1 AND d.status='ACTIVE' AND d.configuration_status='CONFIGURED'
      ORDER BY d.id,r.updated_at DESC NULLS LAST,r.id DESC`,
    [schoolId],
  );
  return result.rows.map((row: any) => eligibleSecurityDeviceSchema.parse({
    ...row,
    id: num(row.id),
    readerId: row.readerId == null ? null : num(row.readerId),
    locationId: row.locationId == null ? null : num(row.locationId),
  }));
}

export async function configureSecurityReader(
  req: Request,
  schoolId: number,
  input: z.infer<typeof readerInputSchema>,
) {
  const context = getUserContext(req);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const device = await client.query(
      `SELECT d.id FROM platform_devices d
        JOIN device_credentials c ON c.device_id=d.id AND c.school_id=d.school_id
       WHERE d.id=$1 AND d.school_id=$2 AND d.status='ACTIVE'
         AND d.configuration_status='CONFIGURED' AND c.status='ACTIVE'
         AND (c.expires_at IS NULL OR c.expires_at>NOW())
       LIMIT 1 FOR UPDATE OF d`,
      [input.deviceId, schoolId],
    );
    if (!device.rows[0]) throw new AuthError(404, "Configured active device not found in this school");
    const location = await client.query(
      `SELECT id FROM security_locations WHERE id=$1 AND school_id=$2 AND status='ACTIVE' FOR SHARE`,
      [input.locationId, schoolId],
    );
    if (!location.rows[0]) throw new AuthError(404, "Active security location not found");
    const inserted = await client.query(
      `INSERT INTO security_readers
         (school_id,location_id,device_id,name,permissions,created_by_user_id,updated_by_user_id)
       VALUES($1,$2,$3,$4,$5,$6,$6)
       ON CONFLICT (school_id,device_id) DO UPDATE SET
         location_id=EXCLUDED.location_id,name=EXCLUDED.name,
         permissions=EXCLUDED.permissions,status='ACTIVE',
         updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=NOW()
       RETURNING id`,
      [schoolId, input.locationId, input.deviceId, input.name, input.permissions, context.user.id],
    );
    const readerId = num(inserted.rows[0].id);
    await auditSecurityAction(client, req, schoolId, "Configured security reader", readerId, {
      deviceId: input.deviceId, locationId: input.locationId, permissions: input.permissions,
    });
    await client.query("COMMIT");
    return (await listSecurityReaders(schoolId)).find((row) => row.id === readerId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getParentChildSecuritySummary(req: Request, studentId: number) {
  const context = getUserContext(req);
  const result = await pool.query(
    `SELECT st.id AS "studentId",st.school_id AS "schoolId",
            CASE
              WHEN card.id IS NULL THEN 'NO_CARD'
              WHEN LOWER(card.status)='lost' THEN 'LOST'
              WHEN LOWER(card.status)='active'
                AND (card.expires_at IS NULL OR card.expires_at>NOW()) THEN 'ACTIVE'
              ELSE 'INACTIVE'
            END AS "nfcStatus",
            presence.state AS "presenceState",presence.last_occurred_at AS "lastOccurredAt",
            COALESCE(events.items,'[]'::jsonb) AS "recentEvents"
       FROM parents parent
       JOIN app_users actor ON actor.id=parent.user_id AND actor.clerk_user_id=$1 AND UPPER(actor.status)='ACTIVE'
       JOIN parent_student_relationships relationship
         ON relationship.parent_id=parent.id AND UPPER(relationship.status)='ACTIVE'
       JOIN students st ON st.id=relationship.student_id AND st.school_id=parent.school_id
         AND UPPER(st.status)='ACTIVE'
       LEFT JOIN LATERAL (
         SELECT c.id,c.status,c.expires_at FROM nfc_cards c
          WHERE c.school_id=st.school_id AND c.student_id=st.id
          ORDER BY (LOWER(c.status)='active' AND (c.expires_at IS NULL OR c.expires_at>NOW())) DESC,
                   c.issued_at DESC NULLS LAST,c.id DESC LIMIT 1
       ) card ON TRUE
       LEFT JOIN campus_presence presence
         ON presence.school_id=st.school_id AND presence.person_type='STUDENT'
        AND presence.student_id=st.id
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object(
                  'eventType',recent.event_type,'occurredAt',recent.occurred_at
                ) ORDER BY recent.id DESC) AS items
           FROM (
             SELECT e.id,e.event_type,e.occurred_at
               FROM security_events e
              WHERE e.school_id=st.school_id AND e.student_id=st.id
                AND e.person_type='STUDENT' AND e.identity_result='CONFIRMED'
              ORDER BY e.id DESC LIMIT 10
           ) recent
       ) events ON TRUE
      WHERE parent.user_id=$2 AND UPPER(parent.status)='ACTIVE'
        AND relationship.student_id=$3
      LIMIT 1`,
    [context.user.clerkUserId, context.user.id, studentId],
  );
  const row = result.rows[0];
  if (!row) throw new AuthError(404, "Student not found");
  const rawEvents = Array.isArray(row.recentEvents)
    ? row.recentEvents
    : typeof row.recentEvents === "string" ? JSON.parse(row.recentEvents) : [];
  return parentChildSecuritySummarySchema.parse({
    studentId: num(row.studentId),
    schoolId: num(row.schoolId),
    nfcStatus: row.nfcStatus,
    currentPresence: row.presenceState == null ? null : {
      state: row.presenceState,
      lastOccurredAt: dateTime(row.lastOccurredAt),
    },
    recentEvents: rawEvents.map((event: any) => ({
      eventType: event.eventType,
      occurredAt: dateTime(event.occurredAt),
    })),
  });
}

export async function setSecurityReaderStatus(
  req: Request,
  schoolId: number,
  readerId: number,
  status: "ACTIVE" | "INACTIVE",
) {
  const context = getUserContext(req);
  await withSecurityTransaction(async (client) => {
    const result = await client.query(
      `UPDATE security_readers SET status=$1,updated_by_user_id=$2,updated_at=NOW()
        WHERE id=$3 AND school_id=$4 RETURNING id`,
      [status, context.user.id, readerId, schoolId],
    );
    if (!result.rows[0]) throw new AuthError(404, "Security reader not found");
    await auditSecurityAction(client, req, schoolId, "Changed security reader status", readerId, { status });
  });
  return (await listSecurityReaders(schoolId)).find((row) => row.id === readerId);
}

export async function getSecuritySettings(schoolId: number) {
  const result = await pool.query(
    `SELECT security_enabled AS "securityEnabled",
            parent_entry_alerts AS "parentEntryAlerts",
            parent_exit_alerts AS "parentExitAlerts",updated_at AS "updatedAt"
       FROM security_school_settings WHERE school_id=$1`,
    [schoolId],
  );
  const row = result.rows[0];
  return {
    schoolId,
    securityEnabled: row?.securityEnabled ?? true,
    parentEntryAlerts: row?.parentEntryAlerts ?? true,
    parentExitAlerts: row?.parentExitAlerts ?? true,
    updatedAt: row?.updatedAt ? dateTime(row.updatedAt) : null,
  };
}

export async function updateSecuritySettings(
  req: Request,
  schoolId: number,
  input: z.infer<typeof securitySettingsInputSchema>,
) {
  const context = getUserContext(req);
  return withSecurityTransaction(async (client) => {
    const result = await client.query(
      `INSERT INTO security_school_settings
         (school_id,security_enabled,parent_entry_alerts,parent_exit_alerts,updated_by_user_id,updated_at)
       VALUES($1,$2,$3,$4,$5,NOW())
       ON CONFLICT(school_id) DO UPDATE SET security_enabled=EXCLUDED.security_enabled,
         parent_entry_alerts=EXCLUDED.parent_entry_alerts,parent_exit_alerts=EXCLUDED.parent_exit_alerts,
         updated_by_user_id=EXCLUDED.updated_by_user_id,updated_at=NOW()
       RETURNING updated_at AS "updatedAt"`,
      [schoolId, input.securityEnabled, input.parentEntryAlerts, input.parentExitAlerts, context.user.id],
    );
    await auditSecurityAction(client, req, schoolId, "Updated school security settings", schoolId, input);
    return { schoolId, ...input, updatedAt: dateTime(result.rows[0].updatedAt) };
  });
}

export async function listSecurityEvents(
  schoolId: number,
  query: {
    limit: number;
    beforeId?: number;
    from?: string;
    to?: string;
    eventType?: SecurityEventType;
    result?: "CONFIRMED" | "REJECTED";
    studentId?: number;
  },
) {
  const result = await pool.query(
    `SELECT e.id,e.school_id AS "schoolId",e.reader_id AS "readerId",e.location_id AS "locationId",
            e.device_id AS "deviceId",e.person_type AS "personType",e.person_name_snapshot AS "personName",
            e.student_id AS "studentId",e.employee_id AS "employeeId",e.event_type AS "eventType",
            e.identity_result AS "identityResult",e.reason_code AS "reasonCode",
            e.location_name_snapshot AS "locationName",e.reader_name_snapshot AS "readerName",
            e.class_name_snapshot AS "className",e.section_snapshot AS section,
            e.occurred_at AS "occurredAt",e.received_at AS "receivedAt",
            e.sync_status AS "syncStatus",e.physical_control_status AS "physicalControlStatus"
       FROM security_events e
      WHERE e.school_id=$1 AND ($2::bigint IS NULL OR e.id<$2)
        AND ($3::timestamptz IS NULL OR e.occurred_at >= $3)
        AND ($4::timestamptz IS NULL OR e.occurred_at <= $4)
        AND ($5::text IS NULL OR e.event_type=$5)
        AND ($6::text IS NULL OR e.identity_result=$6)
         AND ($7::bigint IS NULL OR (e.person_type='STUDENT' AND e.student_id=$7))
       ORDER BY e.id DESC LIMIT $8`,
    [
      schoolId, query.beforeId ?? null, query.from ?? null, query.to ?? null,
      query.eventType ?? null, query.result ?? null, query.studentId ?? null, query.limit,
    ],
  );
  return result.rows.map((row: any) => securityEventSchema.parse({
    ...row,
    id: num(row.id), schoolId: num(row.schoolId), readerId: row.readerId == null ? null : num(row.readerId),
    locationId: row.locationId == null ? null : num(row.locationId), deviceId: num(row.deviceId),
    studentId: row.studentId == null ? null : num(row.studentId), employeeId: row.employeeId == null ? null : num(row.employeeId),
    occurredAt: dateTime(row.occurredAt), receivedAt: dateTime(row.receivedAt),
  }));
}

export async function listCampusPresence(
  schoolId: number,
  limit: number,
  beforeId?: number,
  from?: string,
  to?: string,
) {
  const result = await pool.query(
    `SELECT p.id,p.school_id AS "schoolId",p.person_type AS "personType",
            p.student_id AS "studentId",p.employee_id AS "employeeId",p.state,
            p.last_occurred_at AS "lastOccurredAt",p.review_reason AS "reviewReason",
            COALESCE(trim(concat_ws(' ',st.first_name,st.middle_name,st.last_name)),
                     trim(concat_ws(' ',e.first_name,e.middle_name,e.last_name))) AS "personName",
            st.admission_no AS "admissionNumber",e.employee_no AS "employeeNumber",
            COALESCE(current_class.name,last_event.class_name_snapshot) AS "className",
            COALESCE(current_class.section,last_event.section_snapshot) AS section
       FROM campus_presence p
       LEFT JOIN students st ON st.id=p.student_id AND st.school_id=p.school_id
       LEFT JOIN employees e ON e.id=p.employee_id AND e.school_id=p.school_id
       LEFT JOIN LATERAL (
         SELECT c.name,a.section FROM student_class_assignments a
         JOIN school_classes c ON c.id=a.school_class_id AND c.school_id=a.school_id
         JOIN academic_sessions s ON s.id=a.academic_session_id AND s.school_id=a.school_id
          AND s.status='ACTIVE' AND s.is_current=true
         WHERE a.school_id=p.school_id AND a.student_id=p.student_id
           AND a.status='ACTIVE' AND a.is_current=true
         ORDER BY a.created_at DESC,a.id DESC LIMIT 1
       ) current_class ON p.person_type='STUDENT'
       LEFT JOIN security_events last_event
         ON last_event.id=p.last_security_event_id AND last_event.school_id=p.school_id
      WHERE p.school_id=$1 AND ($2::bigint IS NULL OR p.id<$2)
        AND ($3::timestamptz IS NULL OR p.last_occurred_at >= $3)
        AND ($4::timestamptz IS NULL OR p.last_occurred_at <= $4)
      ORDER BY p.id DESC LIMIT $5`,
    [schoolId, beforeId ?? null, from ?? null, to ?? null, limit],
  );
  return result.rows.map((row: any) => presenceSchema.parse({
    ...row, id: num(row.id), schoolId: num(row.schoolId),
    studentId: row.studentId == null ? null : num(row.studentId),
    employeeId: row.employeeId == null ? null : num(row.employeeId),
    lastOccurredAt: dateTime(row.lastOccurredAt),
  }));
}

export async function getSecurityDashboard(schoolId: number, from: string, to: string) {
  const counts = await pool.query(
    `SELECT
       COUNT(*) FILTER(WHERE person_type='STUDENT' AND state='ON_CAMPUS')::int AS "studentsOnCampus",
       COUNT(*) FILTER(WHERE person_type='STAFF' AND state='ON_CAMPUS')::int AS "staffOnCampus",
       COUNT(*) FILTER(WHERE state='OFF_CAMPUS')::int AS "offCampusPeople",
       COUNT(*) FILTER(WHERE state='REQUIRES_REVIEW')::int AS "presenceReview"
       FROM campus_presence WHERE school_id=$1`,
    [schoolId],
  );
  const activity = await pool.query(
    `SELECT COUNT(*) FILTER(WHERE identity_result='REJECTED')::int AS "rejectedAttempts",
            COUNT(*) FILTER(WHERE identity_result='CONFIRMED' AND event_type='ENTRY')::int AS "acceptedEntryEvents",
            COUNT(*) FILTER(WHERE identity_result='CONFIRMED' AND event_type='EXIT')::int AS "acceptedExitEvents",
            COUNT(*) FILTER(WHERE reason_code IN ('LOST_CARD','REVOKED_CARD'))::int AS "revokedCardAttempts",
            COUNT(*) FILTER(WHERE identity_result='CONFIRMED' AND event_type='ENTRY' AND attendance_status='LATE')::int AS "lateArrivals",
            COUNT(*) FILTER(WHERE identity_result='CONFIRMED' AND event_type='EXIT' AND attendance_status='LEFT_EARLY')::int AS "earlyDepartures"
       FROM security_events e
       LEFT JOIN attendance_events a ON a.id=e.attendance_event_id AND a.school_id=e.school_id
      WHERE e.school_id=$1 AND e.occurred_at >= $2 AND e.occurred_at <= $3`,
    [schoolId, from, to],
  );
  const currentDate = new Date();
  const todayStart = new Date(Date.UTC(
    currentDate.getUTCFullYear(), currentDate.getUTCMonth(), currentDate.getUTCDate(),
  ));
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);
  const visitors = await pool.query(
    `SELECT COUNT(*) FILTER(WHERE status='ON_SITE')::int AS "visitorsCurrentlyOnCampus",
            COUNT(*) FILTER(WHERE checked_in_at >= $2 AND checked_in_at < $3)::int AS "todayVisitorCheckIns"
       FROM school_security_visitors
      WHERE school_id=$1`,
    [schoolId, todayStart, tomorrowStart],
  );
  const incidents = await pool.query(
    `SELECT COUNT(*)::int AS "openIncidents"
       FROM school_security_incidents
      WHERE school_id=$1 AND status IN ('OPEN','INVESTIGATING')`,
    [schoolId],
  );
  const pickups = await pool.query(
    `SELECT COUNT(*)::int AS "pendingPickupRequests"
       FROM school_pickup_requests
      WHERE school_id=$1 AND status='PENDING'`,
    [schoolId],
  );
  const eventCounts = counts.rows[0] ?? {};
  const eventStats = activity.rows[0] ?? {};
  const visitorStats = visitors.rows[0] ?? {};
  return securityDashboardSchema.parse({
    schoolId,
    range: { from, to },
    studentsOnCampus: num(eventCounts.studentsOnCampus),
    staffOnCampus: num(eventCounts.staffOnCampus),
    offCampusPeople: num(eventCounts.offCampusPeople),
    presenceRequiresReview: num(eventCounts.presenceReview),
    acceptedEntryEvents: num(eventStats.acceptedEntryEvents),
    acceptedExitEvents: num(eventStats.acceptedExitEvents),
    visitorsCurrentlyOnCampus: num(visitorStats.visitorsCurrentlyOnCampus),
    todayVisitorCheckIns: num(visitorStats.todayVisitorCheckIns),
    openIncidents: num(incidents.rows[0]?.openIncidents),
    pendingPickupRequests: num(pickups.rows[0]?.pendingPickupRequests),
    lateArrivals: num(eventStats.lateArrivals),
    earlyDepartures: num(eventStats.earlyDepartures),
    rejectedAttempts: num(eventStats.rejectedAttempts),
    revokedCardAttempts: num(eventStats.revokedCardAttempts),
    visitorCountsAvailable: true,
    physicalAccessControl: "NOT_CONNECTED" as const,
  });
}

function nextPresence(
  state: "ON_CAMPUS" | "OFF_CAMPUS" | "REQUIRES_REVIEW" | null,
  lastOccurredAt: Date | null,
  type: SecurityEventType,
  occurredAt: Date,
): { state: "ON_CAMPUS" | "OFF_CAMPUS" | "REQUIRES_REVIEW"; reason: string | null } {
  if (lastOccurredAt && occurredAt.getTime() <= lastOccurredAt.getTime()) {
    return { state: "REQUIRES_REVIEW", reason: "OUT_OF_ORDER_OR_DUPLICATE_EVENT" };
  }
  if (state === "REQUIRES_REVIEW") return { state, reason: "PRIOR_AMBIGUOUS_SEQUENCE" };
  if (type === "ENTRY") {
    return state === "ON_CAMPUS"
      ? { state: "REQUIRES_REVIEW", reason: "ENTRY_WHILE_ALREADY_ON_CAMPUS" }
      : { state: "ON_CAMPUS", reason: null };
  }
  return state === "ON_CAMPUS"
    ? { state: "OFF_CAMPUS", reason: null }
    : { state: "REQUIRES_REVIEW", reason: "EXIT_WITHOUT_CONFIRMED_ENTRY" };
}

async function updateCampusPresence(
  client: SecurityDb,
  event: { id: number; schoolId: number; personType: "STUDENT" | "STAFF"; personId: number; eventType: SecurityEventType; occurredAt: Date },
) {
  const personColumn = event.personType === "STUDENT" ? "student_id" : "employee_id";
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [
    `${event.schoolId}:${event.personType}:${event.personId}`,
  ]);
  const current = await client.query<{
    state: "ON_CAMPUS" | "OFF_CAMPUS" | "REQUIRES_REVIEW";
    lastOccurredAt: string | Date;
  }>(
    `SELECT state,last_occurred_at AS "lastOccurredAt"
       FROM campus_presence
      WHERE school_id=$1 AND ${personColumn}=$2 FOR UPDATE`,
    [event.schoolId, event.personId],
  );
  const prior = current.rows[0];
  const transition = nextPresence(
    prior?.state ?? null,
    prior?.lastOccurredAt ? new Date(prior.lastOccurredAt) : null,
    event.eventType,
    event.occurredAt,
  );
  await client.query(
    `INSERT INTO campus_presence
       (school_id,person_type,student_id,employee_id,state,last_security_event_id,last_occurred_at,review_reason)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT DO NOTHING`,
    [
      event.schoolId,event.personType,
      event.personType === "STUDENT" ? event.personId : null,
      event.personType === "STAFF" ? event.personId : null,
      transition.state,event.id,event.occurredAt,transition.reason,
    ],
  );
  if (prior) {
    await client.query(
      `UPDATE campus_presence SET state=$1,last_security_event_id=$2,
          last_occurred_at=GREATEST(last_occurred_at,$3),review_reason=$4,updated_at=NOW()
        WHERE school_id=$5 AND ${personColumn}=$6`,
      [transition.state,event.id,event.occurredAt,transition.reason,event.schoolId,event.personId],
    );
  }
}

export type RejectedTapInput = {
  schoolId: number;
  deviceId: number;
  credentialId: number;
  eventType: SecurityEventType;
  occurredAt: Date;
  eventKey: string;
  uid: string;
  reasonCode: "UNKNOWN_CARD" | "WRONG_SCHOOL" | "LOST_CARD" | "REVOKED_CARD" | "EXPIRED_CARD" |
    "INACTIVE_CARD" | "NOT_ASSIGNED" | "INACTIVE_PERSON" | "NO_CURRENT_PLACEMENT" |
    "STAFF_BILLING_INELIGIBLE" | "READER_INACTIVE" | "READER_PERMISSION_DENIED" |
    "SECURITY_DISABLED" | "IDENTITY_MISMATCH" | "OTHER";
  personType?: "STUDENT" | "STAFF" | "UNKNOWN";
  studentId?: number | null;
  employeeId?: number | null;
  nfcCardId?: number | null;
};

/**
 * Transaction-joined accepted-event hook. Call after the authoritative student
 * or staff attendance event has been inserted, before its transaction commits.
 * It checks the existing current placement/card/binding and employee billing
 * entitlement again, records a distinct security identity event, and queues
 * idempotent in-app parent alerts. It never controls a physical lock.
 */
export async function recordSecurityEventFromAttendance(
  client: SecurityDb,
  attendanceEventId: number,
) {
  const found = await client.query<any>(
    `SELECT a.id,a.school_id AS "schoolId",a.student_id AS "studentId",a.employee_id AS "employeeId",
            a.device_id AS "deviceId",a.nfc_card_id AS "cardId",a.event_type AS "eventType",
            a.result,a.event_date AS "eventDate",a.occurred_at AS "occurredAt",a.attendance_status AS "attendanceStatus",
            a.academic_term_id AS "termId",a.dedupe_key AS "dedupeKey",
            c.uid,c.student_id AS "cardStudentId",c.status AS "cardStatus",c.expires_at AS "cardExpiresAt",
            d.name AS "deviceName",
            reader.id AS "readerId",reader.name AS "readerName",reader.status AS "readerStatus",
            reader.permissions,reader.location_id AS "locationId",loc.name AS "locationName",
            loc.status AS "locationStatus",
            st.status AS "studentStatus",st.first_name AS "studentFirstName",
            st.middle_name AS "studentMiddleName",st.last_name AS "studentLastName",
            st.admission_no AS "admissionNumber",
            e.employment_status AS "employmentStatus",e.employee_type AS "employeeType",
            e.first_name AS "employeeFirstName",e.middle_name AS "employeeMiddleName",
            e.last_name AS "employeeLastName",e.employee_no AS "employeeNumber"
       FROM attendance_events a
       LEFT JOIN nfc_cards c ON c.id=a.nfc_card_id AND c.school_id=a.school_id
       JOIN platform_devices d ON d.id=a.device_id AND d.school_id=a.school_id
       LEFT JOIN security_readers reader ON reader.device_id=a.device_id AND reader.school_id=a.school_id
       LEFT JOIN security_locations loc ON loc.id=reader.location_id AND loc.school_id=reader.school_id
       LEFT JOIN students st ON st.id=a.student_id AND st.school_id=a.school_id
       LEFT JOIN employees e ON e.id=a.employee_id AND e.school_id=a.school_id
      WHERE a.id=$1`,
    [attendanceEventId],
  );
  const row = found.rows[0];
  if (!row || !["SCHOOL_ENTRY", "SCHOOL_EXIT"].includes(String(row.eventType))) return null;
  if (row.cardId == null) return null; // biometric/manual attendance is not an NFC event
  const type: SecurityEventType = row.eventType === "SCHOOL_ENTRY" ? "ENTRY" : "EXIT";
  const occurredAt = new Date(row.occurredAt);
  const eventKey = `attendance:${num(row.id)}`;
  const uid = String(row.uid ?? "");
  let personType: "STUDENT" | "STAFF" | "UNKNOWN" = row.studentId != null ? "STUDENT" : row.employeeId != null ? "STAFF" : "UNKNOWN";
  let reasonCode: RejectedTapInput["reasonCode"] | null = null;
  let studentId: number | null = row.studentId == null ? null : num(row.studentId);
  let employeeId: number | null = row.employeeId == null ? null : num(row.employeeId);
  let className: string | null = null;
  let section: string | null = null;
  let personName: string | null = null;
  let admissionNumber: string | null = null;
  let employeeNumber: string | null = null;
  if (row.result !== "ACCEPTED") reasonCode = "IDENTITY_MISMATCH";
  else if (!row.readerId) {
    // Existing configured devices remain usable while security location mapping
    // is pending; event location is explicitly unknown rather than fabricated.
  } else if (row.readerStatus !== "ACTIVE") reasonCode = "READER_INACTIVE";
  else if (!jsonArray(row.permissions).includes(type)) reasonCode = "READER_PERMISSION_DENIED";
  else if (row.locationStatus !== "ACTIVE") reasonCode = "READER_INACTIVE";
  if (!reasonCode && String(row.cardStatus ?? "").toLowerCase() !== "active") {
    const status = String(row.cardStatus ?? "").toLowerCase();
    reasonCode = status === "lost" ? "LOST_CARD" :
      ["revoked", "replaced", "deactivated"].includes(status) ? "REVOKED_CARD" :
      status === "expired" ? "EXPIRED_CARD" :
      status === "" ? "NOT_ASSIGNED" : "INACTIVE_CARD";
  }
  if (!reasonCode && personType === "STUDENT" && num(row.cardStudentId) !== studentId) {
    reasonCode = "IDENTITY_MISMATCH";
  }
  if (!reasonCode && personType === "STAFF" && row.cardStudentId != null) {
    reasonCode = "IDENTITY_MISMATCH";
  }
  if (!reasonCode && row.cardExpiresAt && new Date(row.cardExpiresAt).getTime() <= Date.now()) {
    reasonCode = "EXPIRED_CARD";
  }
  if (personType === "STUDENT" && studentId !== null) {
    const current = await client.query<any>(
      `SELECT c.name AS "className",a.section,
              trim(concat_ws(' ',s.first_name,s.middle_name,s.last_name)) AS "personName",
              s.admission_no AS "admissionNumber"
         FROM students s
         JOIN student_class_assignments a
           ON a.student_id=s.id AND a.school_id=s.school_id
          AND a.status='ACTIVE' AND a.is_current=true
         JOIN academic_sessions ses
           ON ses.id=a.academic_session_id AND ses.school_id=a.school_id
          AND ses.status='ACTIVE' AND ses.is_current=true
         JOIN school_classes c ON c.id=a.school_class_id AND c.school_id=a.school_id
        WHERE s.id=$1 AND s.school_id=$2 AND UPPER(s.status)='ACTIVE'
          AND (a.start_date IS NULL OR a.start_date<=$3::date)
          AND (a.end_date IS NULL OR a.end_date>=$3::date)
        ORDER BY a.created_at DESC,a.id DESC LIMIT 1 FOR SHARE OF s,a`,
      [studentId, row.schoolId, row.eventDate],
    );
    if (!current.rows[0] && !reasonCode) reasonCode = "NO_CURRENT_PLACEMENT";
    if (String(row.studentStatus ?? "").toUpperCase() !== "ACTIVE" && !reasonCode) reasonCode = "INACTIVE_PERSON";
    personName = current.rows[0]?.personName ?? null;
    admissionNumber = current.rows[0]?.admissionNumber ?? null;
    className = current.rows[0]?.className ?? null;
    section = current.rows[0]?.section ?? null;
  } else if (personType === "STAFF" && employeeId !== null) {
    const binding = await client.query<any>(
      `SELECT b.id FROM employee_nfc_card_bindings b
        WHERE b.school_id=$1 AND b.nfc_card_id=$2 AND b.employee_id=$3 AND b.status='ACTIVE'
        FOR SHARE`,
      [row.schoolId, row.cardId, employeeId],
    );
    if (!binding.rows[0] && !reasonCode) reasonCode = "NOT_ASSIGNED";
    if (String(row.employmentStatus ?? "").toUpperCase() !== "ACTIVE" && !reasonCode) reasonCode = "INACTIVE_PERSON";
    if (!["TEACHER","STAFF"].includes(String(row.employeeType ?? "").toUpperCase()) && !reasonCode) {
      reasonCode = "IDENTITY_MISMATCH";
    }
    if (!reasonCode) {
      const term = await client.query<any>(
        `SELECT id FROM academic_terms
          WHERE school_id=$1 AND status='ACTIVE' AND is_current=true
            AND CURRENT_DATE BETWEEN start_date AND end_date
          ORDER BY start_date DESC,id DESC LIMIT 1`,
        [row.schoolId],
      );
      const eligibility = term.rows[0]
        ? await getStaffNfcEligibility(client, employeeId, num(row.schoolId), num(term.rows[0].id))
        : { eligible: false };
      if (!eligibility.eligible) reasonCode = "STAFF_BILLING_INELIGIBLE";
    }
    personName = [row.employeeFirstName, row.employeeMiddleName, row.employeeLastName].filter(Boolean).join(" ");
    employeeNumber = row.employeeNumber;
  } else {
    personType = "UNKNOWN";
    reasonCode ??= "IDENTITY_MISMATCH";
    studentId = null;
    employeeId = null;
  }
  if (row.readerId && row.locationId == null) reasonCode ??= "OTHER";

  const settings = await client.query(
    `SELECT security_enabled AS enabled,parent_entry_alerts AS entryAlerts,parent_exit_alerts AS exitAlerts
       FROM security_school_settings WHERE school_id=$1`,
    [row.schoolId],
  );
  if (settings.rows[0]?.enabled === false) return null;

  const cardHash = uid ? createHash("sha256").update(uid.toUpperCase()).digest("hex") : null;
  const identityResult = reasonCode ? "REJECTED" : "CONFIRMED";
  const inserted = await client.query(
    `INSERT INTO security_events
       (school_id,reader_id,location_id,device_id,attendance_event_id,nfc_card_id,student_id,employee_id,
        person_type,person_name_snapshot,admission_number_snapshot,employee_number_snapshot,
        class_name_snapshot,section_snapshot,location_name_snapshot,reader_name_snapshot,event_type,
        identity_result,reason_code,card_uid_sha256,event_key,occurred_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
     ON CONFLICT (school_id,device_id,event_key) DO NOTHING
     RETURNING id`,
    [
      row.schoolId,row.readerId ?? null,row.locationId ?? null,row.deviceId,row.id,row.cardId,
      studentId,employeeId,personType,personName,admissionNumber,employeeNumber,className,section,
      row.locationName ?? null,row.readerName ?? row.deviceName,type,identityResult,reasonCode,cardHash,
      eventKey,occurredAt,
    ],
  );
  const wasInserted = Boolean(inserted.rows[0]);
  let securityEventId = inserted.rows[0]?.id;
  if (securityEventId === undefined) {
    const prior = await client.query(
      `SELECT id,attendance_event_id AS "attendanceEventId",identity_result AS "identityResult"
         FROM security_events WHERE school_id=$1 AND device_id=$2 AND event_key=$3`,
      [row.schoolId,row.deviceId,eventKey],
    );
    if (!prior.rows[0] || num(prior.rows[0].attendanceEventId) !== num(row.id) ||
        prior.rows[0].identityResult !== identityResult) {
      throw new AuthError(409, "Security event idempotency key conflicts with an existing event");
    }
    securityEventId = prior.rows[0].id;
  }
  const finalEventId = num(securityEventId);
  if (!wasInserted) {
    return { securityEventId: finalEventId, identityResult, reasonCode };
  }
  if (identityResult === "CONFIRMED" && personType !== "UNKNOWN") {
    await updateCampusPresence(client, {
      id: finalEventId, schoolId: num(row.schoolId), personType, personId: studentId ?? employeeId!,
      eventType: type, occurredAt,
    });
    const alertAllowed = type === "ENTRY"
      ? settings.rows[0]?.entryAlerts !== false
      : settings.rows[0]?.exitAlerts !== false;
    if (studentId !== null && alertAllowed) {
      const verb = type === "ENTRY" ? "arrived at school" : "left school";
      const body = `${verb} at ${occurredAt.toISOString()}${row.locationName ? ` (${row.locationName})` : ""}.`;
      await emitDomainParentEvent(client, {
        schoolId: num(row.schoolId),
        studentId,
        eventType: `SECURITY_${type}`,
        eventId: finalEventId,
        category: "SECURITY",
        subject: "School security update",
        body,
        privacy: "PARENT_SAFE",
        link: "/parent/communication",
        channels: ["IN_APP"],
      });
    }
  }
  await client.query(
    `INSERT INTO audit_logs
       ("user",role,school_id,action,module,record_id,severity,event_type,result,metadata)
     VALUES($1,'DEVICE',$2,$3,'School Security',$4,$5,$6,$7,$8::jsonb)`,
    [
      row.deviceName ?? "Authenticated device",row.schoolId,
      identityResult === "CONFIRMED" ? `Recorded ${type.toLowerCase()} identity event` : "Rejected security identity event",
      finalEventId,identityResult === "CONFIRMED" ? "info" : "warning",
      `SECURITY_${type}_${identityResult}`,identityResult,
      JSON.stringify({ attendanceEventId: num(row.id), personType, reasonCode, readerId: row.readerId ?? null }),
    ],
  );
  return { securityEventId: finalEventId, identityResult, reasonCode };
}

/**
 * Use after a device has authenticated but its existing attendance/NFC
 * validation rejects a tap. The caller supplies a stable event key; this
 * persists the denial in its own transaction after the attendance transaction
 * has rolled back, without retaining a plaintext UID.
 */
export async function persistRejectedSecurityTap(input: RejectedTapInput) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const device = await client.query(
      `SELECT d.name FROM platform_devices d
        JOIN device_credentials c ON c.device_id=d.id AND c.school_id=d.school_id
       WHERE d.id=$1 AND d.school_id=$2 AND d.status='ACTIVE'
         AND d.configuration_status='CONFIGURED'
         AND c.id=$3
         AND c.status='ACTIVE' AND (c.expires_at IS NULL OR c.expires_at>NOW())
       FOR UPDATE OF d`,
      [input.deviceId,input.schoolId,input.credentialId],
    );
    if (!device.rows[0]) throw new AuthError(401, "Device credential is no longer authorized");
    if (!/^[A-Za-z0-9:._-]{1,128}$/.test(input.eventKey) || input.uid.length > 160) {
      throw new AuthError(400, "Invalid security tap idempotency key or NFC reference");
    }
    const cardHash = input.uid
      ? createHash("sha256").update(input.uid.toUpperCase()).digest("hex")
      : null;
    const reader = await client.query(
      `SELECT r.id AS "readerId",r.name AS "readerName",r.status AS "readerStatus",
              r.location_id AS "locationId",l.name AS "locationName"
         FROM security_readers r
         JOIN security_locations l ON l.id=r.location_id AND l.school_id=r.school_id
        WHERE r.school_id=$1 AND r.device_id=$2`,
      [input.schoolId,input.deviceId],
    );
    const result = await client.query(
      `INSERT INTO security_events
         (school_id,reader_id,location_id,device_id,nfc_card_id,student_id,employee_id,
          person_type,event_type,identity_result,reason_code,card_uid_sha256,event_key,occurred_at,
          reader_name_snapshot,location_name_snapshot)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'REJECTED',$10,$11,$12,$13,$14,$15)
       ON CONFLICT (school_id,device_id,event_key) DO NOTHING
       RETURNING id`,
      [
        input.schoolId,reader.rows[0]?.readerId ?? null,reader.rows[0]?.locationId ?? null,input.deviceId,
        input.nfcCardId ?? null,input.studentId ?? null,input.employeeId ?? null,
        input.personType ?? "UNKNOWN",input.eventType,input.reasonCode,
         cardHash,
        input.eventKey,input.occurredAt,reader.rows[0]?.readerName ?? null,reader.rows[0]?.locationName ?? null,
      ],
    );
    const wasInserted = Boolean(result.rows[0]);
    const existing = result.rows[0] ?? (await client.query(
      `SELECT id,reason_code AS "reasonCode",card_uid_sha256 AS "cardHash",
              event_type AS "eventType",occurred_at AS "occurredAt"
         FROM security_events
        WHERE school_id=$1 AND device_id=$2 AND event_key=$3`,
      [input.schoolId,input.deviceId,input.eventKey],
    )).rows[0];
    if (!existing || (!wasInserted && (
        existing.reasonCode !== input.reasonCode ||
        (existing.cardHash ?? null) !== cardHash || existing.eventType !== input.eventType ||
        dateTime(existing.occurredAt) !== input.occurredAt.toISOString()))) {
      throw new AuthError(409, "Security event idempotency key conflicts with a different denial");
    }
    if (result.rows[0]) await client.query(
      `INSERT INTO audit_logs
        ("user",role,school_id,action,module,record_id,severity,event_type,result,metadata)
       VALUES($1,'DEVICE',$2,'Rejected NFC security identity','School Security',$3,'warning',
              'SECURITY_ACCESS_DENIED','DENIED',$4::jsonb)`,
      [
        device.rows[0].name,input.schoolId,num(existing.id),
        JSON.stringify({ eventType: input.eventType, reasonCode: input.reasonCode }),
      ],
    );
    await client.query("COMMIT");
    return { securityEventId: num(existing.id), identityResult: "REJECTED" as const, reasonCode: input.reasonCode };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function markSecurityCardLost(
  req: Request,
  schoolId: number,
  cardId: number,
  reason: string,
) {
  const context = getUserContext(req);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT id,uid,status,student_id AS "studentId"
         FROM nfc_cards WHERE id=$1 AND school_id=$2 FOR UPDATE`,
      [cardId,schoolId],
    );
    const card = result.rows[0];
    if (!card) throw new AuthError(404, "NFC card not found in this school");
    if (String(card.status).toLowerCase() === "lost") {
      await client.query("COMMIT");
      return { cardId, schoolId, status: "LOST" as const };
    }
    const employeeBinding = card.studentId == null
      ? await client.query(
          `SELECT id,employee_id AS "employeeId" FROM employee_nfc_card_bindings
            WHERE nfc_card_id=$1 AND school_id=$2 AND status IN ('ASSIGNED','ACTIVE','LOCKED')
            ORDER BY id DESC LIMIT 1 FOR UPDATE`,
          [cardId,schoolId],
        )
      : { rows: [] };
    if (card.studentId == null && !employeeBinding.rows[0]) {
      throw new AuthError(409, "Unassigned NFC cards are managed through existing card provisioning");
    }
    await client.query(`UPDATE nfc_cards SET status='lost',deactivated_at=NOW() WHERE id=$1 AND school_id=$2`, [cardId,schoolId]);
    if (card.studentId != null) {
      await client.query(
        `INSERT INTO nfc_card_history
           (school_id,nfc_card_id,student_id,action,previous_status,new_status,reason,actor_user_id)
         VALUES($1,$2,$3,'LOST',$4,'lost',$5,$6)`,
        [schoolId,cardId,card.studentId,String(card.status),reason,context.user.id],
      );
    } else {
      await client.query(
        `INSERT INTO employee_nfc_card_history
           (school_id,binding_id,nfc_card_id,employee_id,action,previous_status,new_status,reason,actor_user_id)
         VALUES($1,$2,$3,$4,'LOST',$5,'lost',$6,$7)`,
        [
          schoolId,employeeBinding.rows[0].id,cardId,employeeBinding.rows[0].employeeId,
          String(card.status),reason,context.user.id,
        ],
      );
    }
    await auditSecurityAction(client, req, schoolId, "Marked NFC card lost", cardId, {
      personId: card.studentId ?? employeeBinding.rows[0]?.employeeId,
      personType: card.studentId == null ? "STAFF" : "STUDENT",
      cardUidSha256: createHash("sha256").update(String(card.uid).toUpperCase()).digest("hex"),
      reason,
    });
    if (card.studentId != null) {
      await emitDomainParentEvent(client, {
        schoolId,
        studentId: num(card.studentId),
        eventType: "SECURITY_CARD_LOST",
        eventId: `cardlost:${schoolId}:${cardId}`,
        category: "SECURITY",
        subject: "Your child's school NFC card has been marked lost",
        body: "Please contact the school to arrange a replacement through its existing card process.",
        privacy: "PARENT_SAFE",
        link: "/parent/communication",
        channels: ["IN_APP"],
      });
    }
    await client.query("COMMIT");
    return { cardId, schoolId, status: "LOST" as const };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function reviewCampusPresence(
  req: Request,
  schoolId: number,
  presenceId: number,
  input: z.infer<typeof presenceReviewInputSchema>,
) {
  const context = getUserContext(req);
  return withSecurityTransaction(async (client) => {
    const result = await client.query(
      `UPDATE campus_presence
          SET state=$1,review_reason=NULL,resolved_by_user_id=$2,
              resolution_reason=$3,reviewed_at=NOW(),updated_at=NOW()
        WHERE id=$4 AND school_id=$5 AND state='REQUIRES_REVIEW'
        RETURNING id`,
      [input.state,context.user.id,input.reason,presenceId,schoolId],
    );
    if (!result.rows[0]) throw new AuthError(404, "Presence review not found");
    await auditSecurityAction(client, req, schoolId, "Resolved campus presence review", presenceId, {
      state: input.state,reason: input.reason,
    });
    return { id: presenceId,schoolId,state: input.state,status: "REVIEWED" as const };
  });
}

export const securityTestInternals = { nextPresence };