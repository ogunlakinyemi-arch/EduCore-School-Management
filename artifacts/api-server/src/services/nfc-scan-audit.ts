import { z } from "zod";
import { AuthError } from "../middlewares/auth";
import { terminalTimestamp } from "../lib/terminal-contract";

type Db = { query: (sql: string, values?: any[]) => Promise<{ rows: any[] }> };
export const NFC_DIAGNOSTIC_ACTION = "Authenticated NFC report diagnostic";
export const canonicalScanUid = (value: unknown): string | null =>
  typeof value === "string" && /^(?:[a-fA-F0-9]{8}|[a-fA-F0-9]{14}|[a-fA-F0-9]{20})$/.test(value)
    ? value.toUpperCase() : null;

/** Fixed reason codes, never arbitrary client payloads or personal validation text. */
export function scanReason(error: unknown): string {
  if (!(error instanceof AuthError)) return "SERVICE_UNAVAILABLE";
  if (error.eventType && error.eventType !== "ACCESS_DENIED" && /^[A-Z_]{1,80}$/.test(error.eventType)) return error.eventType;
  if (error.statusCode === 409) return /event_id|idempotencyKey/.test(error.message) ? "EVENT_CONFLICT" : "DUPLICATE_SUPPRESSED";
  if (error.statusCode === 404) return "PERSON_NOT_FOUND";
  if (error.statusCode === 403) {
    if (/card/i.test(error.message)) return "CARD_INELIGIBLE";
    if (/security/i.test(error.message)) return "SECURITY_DENIED";
    return "ELIGIBILITY_DENIED";
  }
  if (error.statusCode === 400) return "MALFORMED_REPORT";
  if (error.statusCode === 401) return "CREDENTIAL_REJECTED";
  return "CONFIGURATION_UNAVAILABLE";
}

/** Only invoke AFTER authentication AND authoritative device/school attribution. */
export async function recordNfcDiagnostic(db: Db, input: {
  deviceId: number; schoolId: number | null; source: "SCHOOL" | "OWNER";
  kind: "RETRY" | "MALFORMED" | "ERROR"; reason: string; eventId?: unknown;
  occurredAt?: unknown; uid?: unknown;
}) {
  const eventId = typeof input.eventId === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(input.eventId) ? input.eventId : null;
  let time: string | null = null;
  try { time = terminalTimestamp(input.occurredAt).toISOString(); } catch { /* Unusable scan time stays unavailable. */ }
  // Diagnostics never qualify as inventory provenance. Malformed reports never retain UID input.
  await db.query(`INSERT INTO audit_logs("user",role,action,module,record_id,event_type,result,metadata)
    VALUES('Authenticated NFC device','DEVICE',$1,'NFCScanAudit',$2,'NFC_SCAN_DIAGNOSTIC',$3,$4::jsonb)`,
  [NFC_DIAGNOSTIC_ACTION, input.deviceId, input.kind, JSON.stringify({
    source: input.source, kind: input.kind, reason: input.reason, schoolId: input.schoolId,
    eventId, occurredAt: time, uid: input.kind !== "MALFORMED" ? canonicalScanUid(input.uid) : null,
    receivedAt: new Date().toISOString(),
  })]);
}

/** One row per original received report; exact retries remain separate diagnostics.
 * No binding secrets, credential identifiers or person details leave this projection. */
export const scanEvidenceSql = `
  SELECT a.id,a.record_id AS device_id,
    coalesce((a.metadata->'scan'->>'receivedAt')::timestamptz,
      (a.metadata->>'receivedAt')::timestamptz,a."timestamp") AS received_at,
    CASE WHEN a.module='Attendance' THEN 'SCHOOL' ELSE 'OWNER' END AS source,
    CASE WHEN a.module='Attendance' OR a.action='Owner reader UID captured' THEN 'SCAN'
      WHEN a.metadata->>'scanStatus'='MALFORMED_SCAN' THEN 'MALFORMED'
      WHEN a.metadata->>'scanStatus'='READY' THEN 'HEARTBEAT' ELSE 'ERROR' END AS kind,
    CASE WHEN coalesce(a.metadata->'scan'->>'uid',a.metadata->>'uid') ~ '^(?:[A-Fa-f0-9]{8}|[A-Fa-f0-9]{14}|[A-Fa-f0-9]{20})$'
      THEN upper(coalesce(a.metadata->'scan'->>'uid',a.metadata->>'uid')) END AS uid,
    a.metadata->>'rawUid' AS raw_uid,
    coalesce(a.metadata->'scan'->>'occurredAt',a.metadata->>'occurredAt') AS occurred_at,
    a.metadata->>'eventId' AS event_id,
    CASE WHEN a.module='Attendance' THEN a.school_id ELSE NULL END AS school_id,
    a.metadata->'scan'->>'deviceName' AS device_name,
    a.metadata->'scan'->>'schoolName' AS school_name,
    CASE WHEN a.module='Attendance' THEN a.result ELSE coalesce(a.metadata->>'scanStatus',a.result) END AS outcome,
    coalesce(a.metadata->'scan'->>'reason',
      CASE WHEN a.module='Attendance' AND a.result='DENIED' THEN 'LEGACY_DENIAL'
        WHEN a.module='Attendance' THEN 'ATTENDANCE_ACCEPTED'
        ELSE a.metadata->>'scanStatus' END) AS reason,
    CASE WHEN a.metadata->'scan' ? 'registeredAtScan' THEN (a.metadata->'scan'->>'registeredAtScan')::boolean
      WHEN a.metadata ? 'registeredAtScan' THEN (a.metadata->>'registeredAtScan')::boolean END AS registered_at_scan
  FROM audit_logs a WHERE
    (a.module='Attendance' AND a.action='NFC terminal event receipt' AND a.event_type='NFC_TERMINAL_EVENT')
    OR (a.module='UIDInventory' AND a.action IN ('Owner reader UID captured','Owner reader status reported'))
  UNION ALL
  SELECT a.id,a.record_id,a."timestamp",a.metadata->>'source',a.metadata->>'kind',a.metadata->>'uid',NULL,
    a.metadata->>'occurredAt',a.metadata->>'eventId',(a.metadata->>'schoolId')::int,
    NULL,NULL,a.result,a.metadata->>'reason',NULL::boolean
  FROM audit_logs a WHERE a.module='NFCScanAudit' AND a.action='Authenticated NFC report diagnostic'
`;

export const scanAuditFilters = z.object({
  view: z.literal("scans"), q: z.string().trim().max(128).default(""),
  schoolId: z.coerce.number().int().positive().max(2147483647).optional(),
  deviceId: z.coerce.number().int().positive().max(2147483647).optional(),
  from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional(),
  source: z.enum(["SCHOOL", "OWNER"]).optional(),
  registration: z.enum(["REGISTERED", "UNREGISTERED", "UNAVAILABLE"]).optional(),
  result: z.string().regex(/^[A-Z_]{1,80}$/).optional(),
  kind: z.enum(["SCAN", "RETRY", "HEARTBEAT", "MALFORMED", "ERROR"]).optional(),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  format: z.enum(["JSON", "CSV"]).default("JSON"),
}).strict().refine(q => !q.from || !q.to || Date.parse(q.from) <= Date.parse(q.to), "Invalid date range");

export async function listScanAudit(db: Db, q: z.infer<typeof scanAuditFilters>) {
  const result = await db.query(`WITH evidence AS (${scanEvidenceSql}), projected AS (
    SELECT e.id,e.device_id AS "deviceId",coalesce(e.device_name,d.name) AS "deviceName",
      e.school_id AS "schoolId",coalesce(e.school_name,s.name) AS "schoolName",
      e.source,e.kind,e.uid,e.occurred_at AS "occurredAt",e.received_at AS "receivedAt",
      e.event_id AS "eventId",e.outcome,e.reason,e.registered_at_scan AS "registeredAtScan",
      CASE WHEN e.uid IS NULL THEN 'UNAVAILABLE'
        WHEN EXISTS(SELECT 1 FROM nfc_cards c WHERE upper(c.uid)=e.uid) THEN 'REGISTERED'
        ELSE 'UNREGISTERED' END AS registration
    FROM evidence e LEFT JOIN platform_devices d ON d.id=e.device_id
    LEFT JOIN schools s ON s.id=e.school_id
  ), filtered AS (
    SELECT * FROM projected WHERE ($1='' OR uid ILIKE $1 ESCAPE '\\')
      AND ($2::int IS NULL OR "schoolId"=$2) AND ($3::int IS NULL OR "deviceId"=$3)
      AND ($4::timestamptz IS NULL OR coalesce("occurredAt"::timestamptz,"receivedAt") >= $4)
      AND ($5::timestamptz IS NULL OR coalesce("occurredAt"::timestamptz,"receivedAt") <= $5)
      AND ($6::text IS NULL OR source=$6) AND ($7::text IS NULL OR registration=$7)
      AND ($8::text IS NULL OR outcome=$8) AND ($9::text IS NULL OR kind=$9)
  )
  SELECT (SELECT count(*)::int FROM filtered) AS total,
    (SELECT count(*)::int FROM filtered WHERE kind='SCAN') AS "scanTotal",
    coalesce((SELECT json_agg(p) FROM (SELECT * FROM filtered ORDER BY "receivedAt" DESC,id DESC
      LIMIT $10 OFFSET $11) p),'[]'::json) AS rows`,
  [q.q ? `%${q.q.replace(/[\\%_]/g, "\\$&")}%` : "", q.schoolId ?? null, q.deviceId ?? null,
    q.from ?? null, q.to ?? null, q.source ?? null, q.registration ?? null, q.result ?? null,
    q.kind ?? null, q.format === "CSV" ? 5001 : q.pageSize, q.format === "CSV" ? 0 : (q.page - 1) * q.pageSize]);
  const data = result.rows[0];
  if (q.format === "CSV" && data.total > 5000) throw new AuthError(409, "Narrow the filters to at most 5000 reports before exporting");
  return { ...data, page: q.page, pageSize: q.pageSize };
}

export async function recordScanAccess(db: Db, actor: number, exported: boolean, count: number) {
  // Never record UID search text in access logs.
  await db.query(`INSERT INTO audit_logs("user",role,actor_user_id,action,module,event_type,result,metadata)
    VALUES('Platform Owner','PLATFORM_OWNER',$1,'NFC scan audit accessed','NFCScanAudit',$2,'SUCCESS',$3::jsonb)`,
  [actor, exported ? "NFC_SCAN_EXPORTED" : "NFC_SCAN_VIEWED", JSON.stringify({ count, exported })]);
}
