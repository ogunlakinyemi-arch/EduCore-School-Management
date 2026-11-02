import express, { Router, type Request, type Response, type NextFunction } from "express";
import { createHash, randomBytes } from "node:crypto";
import { pool } from "@workspace/db";
import { AuthError, assertRoles, getUserContext, requireAuthentication } from "../middlewares/auth";
import { ownerReaderBinding, parseOwnerUidEvent, verifyOwnerReaderSecret,
  OWNER_READER_ACTION, OWNER_UID_ACTION, OWNER_READER_STATUS_ACTION, ownerCredentialVersion,
  ownerReaderConfiguration, type ReaderDb } from "../services/owner-uid-reader";
import { terminalInternalId } from "../lib/terminal-contract";
import { inventoryFilters, listCapturedUids } from "../services/owner-uid-inventory";
import { listScanAudit, recordScanAccess, recordNfcDiagnostic, scanAuditFilters, scanReason } from "../services/nfc-scan-audit";

const run = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => void fn(req, res).catch(next);
const router = Router();
router.use(requireAuthentication());
function deviceId(req: Request) {
  const id = Number(req.params.deviceId);
  if (!Number.isSafeInteger(id) || id < 1) throw new AuthError(400, "Valid device ID required");
  return id;
}
function reason(req: Request) {
  const text = req.body?.reason;
  if (typeof text !== "string" || text.trim().length < 3 || text.length > 500) throw new AuthError(400, "A reason of 3–500 characters is required");
  return text.trim();
}
async function recordBinding(db: ReaderDb, actor: number, id: number, metadata: Record<string, unknown>) {
  await db.query(`INSERT INTO audit_logs
    ("user",role,actor_user_id,action,module,record_id,event_type,result,metadata)
    VALUES('Platform Owner','PLATFORM_OWNER',$1,$2,'Devices',$3,'OWNER_UID_READER_BINDING','SUCCESS',$4::jsonb)`,
  [actor, OWNER_READER_ACTION, id, JSON.stringify(metadata)]);
}

router.get("/platform/uid-inventory", run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]);
  res.set("Cache-Control", "no-store");
  if (req.query.view === "scans") {
    const parsed = scanAuditFilters.safeParse(req.query);
    if (!parsed.success) throw new AuthError(400, "Invalid scan audit filters");
    const data = await listScanAudit(pool, parsed.data);
    const csv = parsed.data.format === "CSV";
    await recordScanAccess(pool, getUserContext(req).user.id, csv, data.rows.length);
    if (csv) {
      const fields = ["uid","occurredAt","receivedAt","deviceId","deviceName","schoolId","schoolName",
        "source","kind","registration","registeredAtScan","outcome","reason"];
      const cell = (v: unknown) => `"${String(v ?? "").replace(/^(?:[=+@\-\t\r\n]|\s+[=+@-])/, "'$&").replace(/"/g, '""')}"`;
      res.set("Content-Disposition", 'attachment; filename="nfc-scan-audit.csv"').type("text/csv")
        .send([fields.join(","), ...data.rows.map((r: Record<string, unknown>) => fields.map(f => cell(r[f])).join(","))].join("\r\n"));
    } else res.json({ ...data, readers: [], inventory: [] });
    return;
  }
  const filters = inventoryFilters(req.query);
  const readers = await pool.query(`SELECT d.id AS "deviceId",d.serial_number AS "serialNumber",d.name,
    binding.metadata->>'credentialIdentifier' AS "internalCredentialIdentifier",
    (binding.metadata->>'ownerUserId')::int AS "ownerUserId",
    (SELECT max(a."timestamp") FROM audit_logs a WHERE a.module='UIDInventory'
      AND a.action=$1 AND a.record_id=d.id
      AND a.metadata->>'credentialIdentifier'=binding.metadata->>'credentialIdentifier') AS "lastReadAt",
    report."timestamp" AS "lastSeenAt", report.metadata AS "lastReport",
    failure."timestamp" AS "lastFailureAt", failure.metadata AS "lastFailure",
    (SELECT a.metadata FROM audit_logs a WHERE a.module='UIDInventory'
      AND a.action=$1 AND a.record_id=d.id
      AND a.metadata->>'credentialIdentifier'=binding.metadata->>'credentialIdentifier'
      ORDER BY a.id DESC LIMIT 1) AS "lastScan"
    FROM platform_devices d JOIN LATERAL (
      SELECT metadata FROM audit_logs WHERE module='Devices' AND action=$2 AND record_id=d.id ORDER BY id DESC LIMIT 1
    ) binding ON binding.metadata->>'status'='ACTIVE'
    LEFT JOIN LATERAL (SELECT a.metadata,a."timestamp" FROM audit_logs a
      WHERE a.module='UIDInventory' AND a.action IN ($1,$3) AND a.record_id=d.id
        AND a.metadata->>'credentialIdentifier'=binding.metadata->>'credentialIdentifier'
      ORDER BY a.id DESC LIMIT 1) report ON TRUE
    LEFT JOIN LATERAL (SELECT a.metadata,a."timestamp" FROM audit_logs a
      WHERE a.module='UIDInventory' AND a.action=$3 AND a.record_id=d.id
        AND a.metadata->>'credentialIdentifier'=binding.metadata->>'credentialIdentifier'
        AND a.metadata->>'scanStatus' IN ('UNSUPPORTED_CARD','MALFORMED_SCAN','READER_ERROR','TRANSPORT_ERROR')
      ORDER BY a.id DESC LIMIT 1) failure ON TRUE
    WHERE d.school_id IS NULL ORDER BY d.serial_number`, [OWNER_UID_ACTION, OWNER_READER_ACTION, OWNER_READER_STATUS_ACTION]);
  const inventory = await listCapturedUids(pool, filters);
  // Never expose credential identifiers, hashes, or internal receipt fingerprints.
  const publicReport = (value: any) => value ? {
    uid: value.uid ?? null, rawUid: value.rawUid ?? value.uid ?? null,
    scanStatus: value.scanStatus ?? "CAPTURED", duplicateUid: value.duplicateUid === true,
  } : null;
  res.json({ readers: readers.rows.map(({ internalCredentialIdentifier, ...r }) => ({ ...r,
    credentialVersion: ownerCredentialVersion({ credentialIdentifier: internalCredentialIdentifier }),
    lastReport: publicReport(r.lastReport), lastScan: publicReport(r.lastScan), lastFailure: publicReport(r.lastFailure),
  })), ...inventory });
}));

router.post("/platform/devices/:deviceId/owner-reader", run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]);
  const id = deviceId(req), why = reason(req), actor = getUserContext(req).user.id;
  const identifier = `owner_uid_${randomBytes(12).toString("hex")}`;
  const secret = randomBytes(32).toString("base64url");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const device = await client.query(`SELECT id,school_id AS "schoolId",device_type AS "deviceType",status
      FROM platform_devices WHERE id=$1 FOR UPDATE`, [id]);
    const row = device.rows[0];
    if (!row) throw new AuthError(404, "Device not found");
    if (row.schoolId != null) throw new AuthError(409, "Explicitly unlink the school before using this device as an Owner reader");
    if (!["NFC", "HYBRID"].includes(row.deviceType?.toUpperCase()) || row.status !== "ACTIVE") {
      throw new AuthError(409, "An active NFC-capable device is required");
    }
    if (await ownerReaderBinding(client, id)) throw new AuthError(409, "Unlink the existing Owner reader binding before pairing again");
    await client.query(`UPDATE device_credentials SET status='REVOKED',revoked_at=NOW() WHERE device_id=$1 AND status='ACTIVE'`, [id]);
    await recordBinding(client, actor, id, { status: "ACTIVE", ownerUserId: actor,
      purpose: "OWNER_UID_READER", credentialIdentifier: identifier,
      secretHash: createHash("sha256").update(secret).digest("hex"), reason: why });
    await client.query("COMMIT");
    res.status(201).json({ deviceId: id, purpose: "OWNER_UID_READER", credential: `${identifier}.${secret}`,
      credentialVersion: ownerCredentialVersion({ credentialIdentifier: identifier }), configuration: ownerReaderConfiguration(id) });
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}));

router.post("/platform/devices/:deviceId/owner-reader/credential", run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]);
  const id = deviceId(req), why = reason(req), actor = getUserContext(req).user.id;
  if (req.body.confirm !== true || typeof req.body.expectedCredentialVersion !== "string" ||
      !/^[a-f0-9]{16}$/.test(req.body.expectedCredentialVersion)) {
    throw new AuthError(400, "Explicit confirmation and the current Owner credential version are required");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const device = (await client.query(`SELECT id,school_id AS "schoolId",device_type AS "deviceType",status
      FROM platform_devices WHERE id=$1 FOR UPDATE`, [id])).rows[0];
    const binding = await ownerReaderBinding(client, id);
    if (!device || device.schoolId != null || device.status !== "ACTIVE" ||
        !["NFC", "HYBRID"].includes(device.deviceType?.toUpperCase()) || !binding) {
      throw new AuthError(409, "An active Owner-bound NFC reader is required; school credentials cannot be used");
    }
    if (binding.ownerUserId !== actor) throw new AuthError(403, "Only this reader's bound Owner can rotate its credential");
    if (req.body.expectedCredentialVersion !== ownerCredentialVersion(binding)) {
      throw new AuthError(409, "Reader credential changed. Refresh before explicitly rotating again");
    }
    const identifier = `owner_uid_${randomBytes(12).toString("hex")}`;
    const secret = randomBytes(32).toString("base64url");
    await recordBinding(client, actor, id, {
      ...binding, credentialIdentifier: identifier, secretHash: createHash("sha256").update(secret).digest("hex"),
      reason: why, previousCredentialVersion: ownerCredentialVersion(binding),
    });
    await client.query("COMMIT");
    res.json({ deviceId: id, purpose: "OWNER_UID_READER", credential: `${identifier}.${secret}`,
      credentialVersion: ownerCredentialVersion({ credentialIdentifier: identifier }), configuration: ownerReaderConfiguration(id) });
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}));

router.post("/platform/devices/:deviceId/owner-reader/unlink", run(async (req, res) => {
  assertRoles(req, ["PLATFORM_OWNER"]);
  const id = deviceId(req), why = reason(req), actor = getUserContext(req).user.id;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const device = await client.query(`SELECT id FROM platform_devices WHERE id=$1 FOR UPDATE`, [id]);
    if (!device.rows[0]) throw new AuthError(404, "Device not found");
    const binding = await ownerReaderBinding(client, id);
    if (!binding) throw new AuthError(409, "Device is not an Owner UID reader");
    await recordBinding(client, actor, id, { status: "RELEASED", ownerUserId: binding.ownerUserId,
      previousCredentialIdentifier: binding.credentialIdentifier, reason: why });
    await client.query("COMMIT");
    res.json({ deviceId: id, purpose: "UNASSIGNED" });
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}));

/** Deliberately separate from Clerk sessions AND from attendance ingestion. */
export const ownerUidIngestionRouter = Router();
ownerUidIngestionRouter.post("/v1/owner-reader/uid-events", express.json({ limit: "16kb", strict: true }), run(async (req, res) => {
  const receivedAt = new Date().toISOString();
  const token = /^Bearer ([^\s]+)$/i.exec(req.header("Authorization") ?? "")?.[1];
  if (!token) throw new AuthError(401, "Authorization: Bearer <dedicated Owner reader credential> required. Do not use a school key or browser session");
  const id = terminalInternalId(req.body?.device_id, "device");
  const client = await pool.connect();
  let authenticatedIdentifier: string | null = null;
  try {
    await client.query("BEGIN");
    const device = await client.query(`SELECT id,school_id AS "schoolId",device_type AS "deviceType",status
      FROM platform_devices WHERE id=$1 FOR UPDATE`, [id]);
    const row = device.rows[0], binding = await ownerReaderBinding(client, id);
    if (!row || row.schoolId != null || row.status !== "ACTIVE" || !["NFC", "HYBRID"].includes(row.deviceType?.toUpperCase()) || !binding) {
      throw new AuthError(401, "Device is not an active Owner UID-only reader");
    }
    verifyOwnerReaderSecret(token, binding);
    const owner = await client.query(`SELECT 1 FROM school_memberships m JOIN app_users u ON u.id=m.user_id
      WHERE m.user_id=$1 AND m.role='PLATFORM_OWNER' AND m.status='ACTIVE' AND m.school_id IS NULL`, [binding.ownerUserId]);
    if (!owner.rows[0]) throw new AuthError(403, "Assigned Owner no longer has active platform authority");
    authenticatedIdentifier = binding.credentialIdentifier;
    let event: ReturnType<typeof parseOwnerUidEvent>;
    try { event = parseOwnerUidEvent(req.body); }
    catch (e) {
      if (!(e instanceof AuthError) || e.statusCode !== 400) throw e;
      // Only authenticated hardware can report malformed scans to the Owner.
      // Do not persist arbitrary invalid payloads or turn them into captured cards.
      await client.query(`INSERT INTO audit_logs
        ("user",role,actor_user_id,action,module,record_id,event_type,result,metadata)
        VALUES('Authenticated Owner reader','DEVICE',$1,$2,'UIDInventory',$3,'OWNER_UID_READER_STATUS','FAILURE',$4::jsonb)`,
      [binding.ownerUserId, OWNER_READER_STATUS_ACTION, id, JSON.stringify({
        credentialIdentifier: binding.credentialIdentifier, scanStatus: "MALFORMED_SCAN",
        purpose: "UID_INVENTORY_ONLY",
      })]);
      await client.query("COMMIT");
      res.status(400).json({ success: false, code: "MALFORMED_SCAN", error: e.message });
      return;
    }
    const prior = await client.query(`SELECT metadata FROM audit_logs WHERE module='UIDInventory'
      AND action IN ($1,$5) AND record_id=$2 AND metadata->>'eventId'=$3
      AND metadata->>'credentialIdentifier'=$4 ORDER BY id DESC LIMIT 1`,
    [OWNER_UID_ACTION, event.deviceId, event.eventId, binding.credentialIdentifier, OWNER_READER_STATUS_ACTION]);
    if (prior.rows[0] && prior.rows[0].metadata.fingerprint !== event.fingerprint) {
      throw new AuthError(409, "event_id was already used for another UID read");
    }
    let receipt = prior.rows[0]?.metadata;
    if (receipt) await recordNfcDiagnostic(client, { deviceId: id, schoolId: null, source: "OWNER",
      kind: "RETRY", reason: "EXACT_RETRY", eventId: event.eventId, occurredAt: event.timestamp, uid: event.uid });
    if (!receipt) {
      let scanStatus = event.scanStatus, duplicateUid = false;
      if (event.uid) {
        // Different readers capturing the same UID serialize before checking inventory.
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`owner-uid:${event.uid}`]);
        const existing = await client.query(`SELECT id,student_id FROM nfc_cards WHERE upper(uid)=$1 ORDER BY id LIMIT 1`, [event.uid]);
        const captured = await client.query(`SELECT 1 FROM audit_logs WHERE module='UIDInventory'
          AND action=$1 AND metadata->>'uid'=$2 LIMIT 1`, [OWNER_UID_ACTION, event.uid]);
        duplicateUid = Boolean(captured.rows[0] || existing.rows[0]);
        scanStatus = existing.rows[0] ? (existing.rows[0].student_id ? "ASSIGNED" : "RESERVED") : "UNKNOWN_UNASSIGNED";
      }
      receipt = {
        uid: event.uid, rawUid: event.rawUid, scanStatus, duplicateUid,
        eventId: event.eventId, fingerprint: event.fingerprint,
        credentialIdentifier: binding.credentialIdentifier, ownerUserId: binding.ownerUserId,
        occurredAt: event.timestamp, purpose: "UID_INVENTORY_ONLY",
        receivedAt,
        registeredAtScan: scanStatus === "ASSIGNED" || scanStatus === "RESERVED",
      };
      await client.query(`INSERT INTO audit_logs
        ("user",role,actor_user_id,action,module,record_id,event_type,result,metadata)
        VALUES('Authenticated Owner reader','DEVICE',$1,$2,'UIDInventory',$3,'OWNER_UID_READER_REPORT','SUCCESS',$4::jsonb)`,
      [binding.ownerUserId, event.uid ? OWNER_UID_ACTION : OWNER_READER_STATUS_ACTION, event.deviceId, JSON.stringify(receipt)]);
    }
    await client.query("COMMIT");
    res.json({ success: true, uid: receipt.uid, rawUid: receipt.rawUid ?? receipt.uid,
      scanStatus: receipt.scanStatus ?? "CAPTURED", duplicateUid: receipt.duplicateUid === true,
      duplicate: Boolean(prior.rows[0]), purpose: "UID_INVENTORY_ONLY" });
  } catch (e) {
    await client.query("ROLLBACK");
    if (authenticatedIdentifier) {
      try {
        await client.query("BEGIN");
        const currentDevice = (await client.query(`SELECT id,school_id AS "schoolId",device_type AS "deviceType",status
          FROM platform_devices WHERE id=$1 FOR UPDATE`, [id])).rows[0];
        const currentBinding = await ownerReaderBinding(client, id);
        const authority = currentBinding && await client.query(`SELECT 1 FROM school_memberships m JOIN app_users u ON u.id=m.user_id
          WHERE m.user_id=$1 AND m.role='PLATFORM_OWNER' AND m.status='ACTIVE' AND m.school_id IS NULL`, [currentBinding.ownerUserId]);
        if (currentDevice?.status === "ACTIVE" && currentDevice.schoolId == null &&
            currentBinding?.credentialIdentifier === authenticatedIdentifier && authority?.rows[0]) {
          await recordNfcDiagnostic(client, { deviceId: id, schoolId: null, source: "OWNER",
            kind: "ERROR", reason: scanReason(e), eventId: req.body?.event_id,
            occurredAt: req.body?.timestamp, uid: req.body?.uid });
        }
        await client.query("COMMIT");
      } catch { await client.query("ROLLBACK"); }
    }
    throw e;
  }
  finally { client.release(); }
}));
ownerUidIngestionRouter.use((e: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = e instanceof AuthError ? e.statusCode : e.type === "entity.too.large" ? 413 : e.type === "entity.parse.failed" ? 400 : 503;
  res.status(status).json({ success: false,
    code: status === 401 || status === 403 ? "READER_UNAUTHORIZED" : status === 409 ? "EVENT_CONFLICT" :
      status === 400 || status === 413 ? "MALFORMED_SCAN" : "TRANSPORT_ERROR",
    error: e instanceof AuthError ? e.message : "Owner UID reader request failed" });
});
export default router;
