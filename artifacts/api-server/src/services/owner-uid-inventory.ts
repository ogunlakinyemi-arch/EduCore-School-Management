import { AuthError } from "../middlewares/auth";
import { OWNER_UID_ACTION, type ReaderDb } from "./owner-uid-reader";
import { scanEvidenceSql } from "./nfc-scan-audit";

export function inventoryFilters(query: Record<string, unknown>) {
  const integer = (key: string, fallback: number | null, max: number) => {
    const value = query[key];
    if (value === undefined) return fallback;
    if (typeof value !== "string" || !/^[1-9]\d*$/.test(value) ||
        !Number.isSafeInteger(Number(value)) || Number(value) > max) {
      throw new AuthError(400, `Invalid ${key}`);
    }
    return Number(value);
  };
  if (query.q !== undefined && (typeof query.q !== "string" || query.q.length > 128)) {
    throw new AuthError(400, "Search must contain at most 128 characters");
  }
  const status = query.status ?? null;
  if (status !== null && (typeof status !== "string" ||
      !["UNKNOWN_UNASSIGNED", "ASSIGNED", "RESERVED", "DUPLICATE"].includes(status))) {
    throw new AuthError(400, "Invalid capture status");
  }
  return { q: String(query.q ?? "").trim(), status,
    deviceId: integer("deviceId", null, Number.MAX_SAFE_INTEGER),
    page: integer("page", 1, 1_000_000)!, pageSize: integer("pageSize", 500, 500)! };
}

/** All captured cards remain reachable by pagination, including captures before assignment.
 * No card/person/financial state is written by this SELECT-only projection. */
export async function listCapturedUids(db: ReaderDb, filters: ReturnType<typeof inventoryFilters>) {
  const { q, status, deviceId, page, pageSize } = filters;
  const result = await db.query(`WITH evidence AS (${scanEvidenceSql}), captures AS (
    SELECT * FROM evidence WHERE kind='SCAN' AND uid IS NOT NULL
  ), capture_summary AS (
    SELECT uid,min(received_at) AS "firstSeenAt",
      max(received_at) AS "lastSeenAt",count(*)::int AS "scanCount",
      array_agg(DISTINCT device_id) AS sources
    FROM captures GROUP BY uid
  ), projected AS (
    SELECT s.uid,coalesce(latest.raw_uid,s.uid) AS "rawUid",
      latest.device_id AS "readerDeviceId",latest.received_at AS "capturedAt",
      s."firstSeenAt",s."lastSeenAt",s."scanCount",
      (s."scanCount">1) IS TRUE AS duplicate,
      (card.id IS NOT NULL) AS assigned,card.school_id AS "schoolId",
      card.student_id AS "studentId",card.status,d.name AS "deviceName",d.serial_number AS "serialNumber",
      CASE WHEN card.student_id IS NOT NULL THEN 'ASSIGNED'
        WHEN card.id IS NOT NULL THEN 'RESERVED' ELSE 'UNKNOWN_UNASSIGNED' END AS "captureStatus",
      CASE WHEN card.id IS NULL THEN 'Pending Registration' ELSE card.status END AS "registrationStatus",
      latest.source AS "source",latest.school_id AS "sourceSchoolId",
      latest.school_name AS "sourceSchoolName",
      s.sources
    FROM capture_summary s JOIN LATERAL (
      SELECT * FROM captures WHERE uid=s.uid ORDER BY id DESC LIMIT 1
    ) latest ON TRUE
    LEFT JOIN platform_devices d ON d.id=latest.device_id
    LEFT JOIN LATERAL (SELECT id,school_id,student_id,status FROM nfc_cards
      WHERE upper(uid)=s.uid ORDER BY CASE WHEN student_id IS NOT NULL THEN 0 ELSE 1 END,id DESC LIMIT 1) card ON TRUE
  ), filtered AS (
    SELECT * FROM projected WHERE ($1::text IS NOT NULL) AND ($2='' OR uid ILIKE $2 OR "deviceName" ILIKE $2 OR "serialNumber" ILIKE $2)
      AND ($3::bigint IS NULL OR $3=ANY(sources))
      AND ($4::text IS NULL OR "captureStatus"=$4 OR ($4='DUPLICATE' AND duplicate))
  )
  SELECT (SELECT count(*)::int FROM filtered) AS total,
    coalesce((SELECT json_agg(p) FROM (
      SELECT uid,"rawUid","readerDeviceId","capturedAt","firstSeenAt","lastSeenAt","scanCount",
        duplicate,assigned,"schoolId","studentId",status,"deviceName","serialNumber","captureStatus",
        "registrationStatus",source,"sourceSchoolId","sourceSchoolName"
      FROM filtered ORDER BY "lastSeenAt" DESC,uid LIMIT $5 OFFSET $6
    ) p),'[]'::json) AS inventory`,
  [OWNER_UID_ACTION, q ? `%${q.replace(/[\\%_]/g, "\\$&")}%` : "", deviceId, status, pageSize, (page - 1) * pageSize]);
  return { total: result.rows[0].total, inventory: result.rows[0].inventory, page, pageSize };
}
