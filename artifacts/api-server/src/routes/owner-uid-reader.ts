import express, { Router, type Request, type Response, type NextFunction } from "express";
import { createHash, randomBytes } from "node:crypto";
import { pool } from "@workspace/db";
import { AuthError, assertRoles, getUserContext, requireAuthentication } from "../middlewares/auth";
import { ownerReaderBinding, parseOwnerUidEvent, verifyOwnerReaderSecret,
  OWNER_READER_ACTION, OWNER_UID_ACTION, type ReaderDb } from "../services/owner-uid-reader";

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
  const readers = await pool.query(`SELECT d.id AS "deviceId",d.serial_number AS "serialNumber",d.name,
    (binding.metadata->>'ownerUserId')::int AS "ownerUserId",
    (SELECT max(a."timestamp") FROM audit_logs a WHERE a.module='UIDInventory'
      AND a.action=$1 AND a.record_id=d.id) AS "lastReadAt"
    FROM platform_devices d JOIN LATERAL (
      SELECT metadata FROM audit_logs WHERE module='Devices' AND action=$2 AND record_id=d.id ORDER BY id DESC LIMIT 1
    ) binding ON binding.metadata->>'status'='ACTIVE'
    WHERE d.school_id IS NULL ORDER BY d.serial_number`, [OWNER_UID_ACTION, OWNER_READER_ACTION]);
  const inventory = await pool.query(`SELECT captured.metadata->>'uid' AS uid,
    captured.record_id AS "readerDeviceId",captured."timestamp" AS "capturedAt",
    (card.id IS NOT NULL) AS assigned,card.school_id AS "schoolId",card.student_id AS "studentId",card.status
    FROM (SELECT DISTINCT ON (metadata->>'uid') metadata,record_id,"timestamp",id FROM audit_logs
      WHERE module='UIDInventory' AND action=$1 ORDER BY metadata->>'uid',id DESC) captured
    LEFT JOIN LATERAL (SELECT id,school_id,student_id,status FROM nfc_cards
      WHERE upper(uid)=captured.metadata->>'uid'
      ORDER BY CASE WHEN student_id IS NOT NULL THEN 0 ELSE 1 END,id DESC LIMIT 1) card ON TRUE
    ORDER BY captured."timestamp" DESC LIMIT 500`, [OWNER_UID_ACTION]);
  res.json({ readers: readers.rows, inventory: inventory.rows });
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
    res.status(201).json({ deviceId: id, purpose: "OWNER_UID_READER", credential: `${identifier}.${secret}` });
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
  const token = /^Bearer ([^\s]+)$/i.exec(req.header("Authorization") ?? "")?.[1];
  if (!token) throw new AuthError(401, "Owner reader credential required");
  const event = parseOwnerUidEvent(req.body);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const device = await client.query(`SELECT id,school_id AS "schoolId",device_type AS "deviceType",status
      FROM platform_devices WHERE id=$1 FOR UPDATE`, [event.deviceId]);
    const row = device.rows[0], binding = await ownerReaderBinding(client, event.deviceId);
    if (!row || row.schoolId != null || row.status !== "ACTIVE" || !["NFC", "HYBRID"].includes(row.deviceType?.toUpperCase()) || !binding) {
      throw new AuthError(401, "Device is not an active Owner UID-only reader");
    }
    verifyOwnerReaderSecret(token, binding);
    const owner = await client.query(`SELECT 1 FROM school_memberships m JOIN app_users u ON u.id=m.user_id
      WHERE m.user_id=$1 AND m.role='PLATFORM_OWNER' AND m.status='ACTIVE' AND m.school_id IS NULL`, [binding.ownerUserId]);
    if (!owner.rows[0]) throw new AuthError(403, "Assigned Owner no longer has active platform authority");
    const prior = await client.query(`SELECT metadata FROM audit_logs WHERE module='UIDInventory'
      AND action=$1 AND record_id=$2 AND metadata->>'eventId'=$3
      AND metadata->>'credentialIdentifier'=$4 ORDER BY id DESC LIMIT 1`,
    [OWNER_UID_ACTION, event.deviceId, event.eventId, binding.credentialIdentifier]);
    if (prior.rows[0] && prior.rows[0].metadata.fingerprint !== event.fingerprint) {
      throw new AuthError(409, "event_id was already used for another UID read");
    }
    if (!prior.rows[0]) {
      await client.query(`INSERT INTO audit_logs
        ("user",role,actor_user_id,action,module,record_id,event_type,result,metadata)
        VALUES('Authenticated Owner reader','DEVICE',$1,$2,'UIDInventory',$3,'OWNER_UID_CAPTURE','SUCCESS',$4::jsonb)`,
      [binding.ownerUserId, OWNER_UID_ACTION, event.deviceId, JSON.stringify({
        uid: event.uid, eventId: event.eventId, fingerprint: event.fingerprint,
        credentialIdentifier: binding.credentialIdentifier, ownerUserId: binding.ownerUserId,
        occurredAt: event.timestamp, purpose: "UID_INVENTORY_ONLY",
      })]);
    }
    await client.query("COMMIT");
    res.json({ success: true, uid: event.uid, duplicate: Boolean(prior.rows[0]), purpose: "UID_INVENTORY_ONLY" });
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
}));
ownerUidIngestionRouter.use((e: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = e instanceof AuthError ? e.statusCode : e.type === "entity.too.large" ? 413 : e.type === "entity.parse.failed" ? 400 : 503;
  res.status(status).json({ success: false, error: e instanceof AuthError ? e.message : "Owner UID reader request failed" });
});
export default router;
