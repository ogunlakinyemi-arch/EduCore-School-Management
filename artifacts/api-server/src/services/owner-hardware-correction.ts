import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { AuthError } from "../middlewares/auth";
import { ownerReaderBinding } from "./owner-uid-reader";

export const HARDWARE_CORRECTION_ACTION = "Corrected Owner reader hardware identity";
export const PHYSICAL_SERIAL = "YET-584E10FFC9EC";

/** Deliberately not a general rename/merge tool. No events, keys or bindings are moved. */
async function inspect(client: PoolClient, actor: number, lock: boolean) {
  const devices = (await client.query(
    `SELECT * FROM platform_devices WHERE id IN (3,4) ORDER BY id${lock ? " FOR UPDATE" : ""}`,
  )).rows;
  const target = devices.find(d => d.id === 3), source = devices.find(d => d.id === 4);
  if (!target || !source) throw new AuthError(409, "Both existing device records are required");
  const targetBinding = await ownerReaderBinding(client, 3);
  const sourceBinding = await ownerReaderBinding(client, 4);
  if (!targetBinding || targetBinding.ownerUserId !== actor) {
    throw new AuthError(403, "Only Device 3's currently bound Owner can correct this identity");
  }
  const authority = await client.query(`SELECT 1 FROM school_memberships m JOIN app_users u ON u.id=m.user_id
    WHERE m.user_id=$1 AND m.role='PLATFORM_OWNER' AND m.status='ACTIVE' AND m.school_id IS NULL${lock ? " FOR SHARE OF m,u" : ""}`, [actor]);
  if (!authority.rows.length) throw new AuthError(403, "Active platform Owner authority required");
  if (!/^owner_uid_[a-f0-9]{24}$/.test(targetBinding.credentialIdentifier ?? "") ||
      !/^[a-f0-9]{64}$/.test(targetBinding.secretHash ?? "")) {
    throw new AuthError(409, "Device 3's dedicated Owner credential is not verifiable");
  }
  if (target.serial_number !== "DEVICE-1000" || source.serial_number !== PHYSICAL_SERIAL ||
      target.status !== "ACTIVE" || !["ACTIVE", "INACTIVE"].includes(source.status) ||
      devices.some(d => d.school_id !== null || d.school_class_id !== null || d.device_type !== "NFC") ||
      sourceBinding) {
    throw new AuthError(409, "Device identity, purpose or assignment changed; correction blocked");
  }
  // A missing or unknown source binding is not evidence of an explicit release.
  const sourceHistory = (await client.query(`SELECT metadata FROM audit_logs
    WHERE module='Devices' AND action='Owner UID reader binding' AND record_id=4 ORDER BY id DESC LIMIT 1`)).rows[0];
  if (sourceHistory?.metadata?.status !== "RELEASED") {
    throw new AuthError(409, "Device 4 must have an explicit released Owner binding");
  }
  const keys = await client.query(`SELECT 1 FROM device_credentials WHERE device_id IN (3,4) AND status='ACTIVE' LIMIT 1`);
  if (keys.rows.length) throw new AuthError(409, "Active school credentials block identity correction");
  const blank = await client.query(`SELECT 1 FROM platform_devices WHERE serial_number='' LIMIT 1`);
  if (blank.rows.length) throw new AuthError(409, "Historical blank serial is already occupied");
  // This operation assumes the inspected non-null text serial with an immediate,
  // single-column UNIQUE constraint. Unknown custom triggers or serial FKs fail closed.
  const schema = await client.query(`SELECT
    EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='platform_devices'::regclass
      AND attname='serial_number' AND atttypid='text'::regtype AND attnotnull) AS serial_supported,
    EXISTS(SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attname='serial_number'
      WHERE i.indrelid='platform_devices'::regclass AND i.indisunique AND i.indisvalid
        AND i.indimmediate AND i.indnkeyatts=1 AND i.indkey[0]=a.attnum AND i.indpred IS NULL) AS unique_supported,
    EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid IN ('platform_devices'::regclass,'audit_logs'::regclass)
      AND NOT tgisinternal AND tgenabled<>'D') AS custom_triggers,
    EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attname='serial_number'
      WHERE c.contype='f' AND c.confrelid='platform_devices'::regclass AND a.attnum=ANY(c.confkey)) AS serial_references,
    EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='serial_number'
      WHERE c.contype='c' AND c.conrelid='platform_devices'::regclass AND a.attnum=ANY(c.conkey)) AS serial_checks`);
  const shape = schema.rows[0];
  if (!shape?.serial_supported || !shape.unique_supported || shape.custom_triggers || shape.serial_references || shape.serial_checks) {
    throw new AuthError(409, "Unreviewed serial constraints, references or triggers block correction");
  }
  const fingerprint = createHash("sha256").update(JSON.stringify({
    devices, targetBinding, sourceHistory: sourceHistory.metadata, actor,
  })).digest("hex");
  const mapping = devices.map(d => ({ deviceId: d.id, serialNumber: d.serial_number, status: d.status }));
  return { fingerprint, before: mapping, after: [
    { deviceId: 3, serialNumber: PHYSICAL_SERIAL, status: "ACTIVE" },
    { deviceId: 4, serialNumber: "", status: "INACTIVE" },
  ], target, source, targetBinding };
}

export async function previewHardwareCorrection(pool: Pool, actor: number) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { fingerprint, before, after } = await inspect(client, actor, false);
    await client.query("COMMIT");
    return { fingerprint, before, after };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function applyHardwareCorrection(pool: Pool, actor: number, input: {
  fingerprint: string; reason: string; confirm: true;
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Bound DDL/catalog changes and unique-serial races for this very short operation.
    await client.query("SET LOCAL lock_timeout = '3s'");
    await client.query("LOCK TABLE platform_devices IN SHARE ROW EXCLUSIVE MODE");
    const snapshot = await inspect(client, actor, true);
    if (snapshot.fingerprint !== input.fingerprint) throw new AuthError(409, "Preflight is stale; review fresh device state");
    await client.query(`UPDATE platform_devices SET serial_number='',status='INACTIVE' WHERE id=4`);
    await client.query(`UPDATE platform_devices SET serial_number=$1 WHERE id=3`, [PHYSICAL_SERIAL]);
    const after = (await client.query(`SELECT * FROM platform_devices WHERE id IN (3,4) ORDER BY id`)).rows;
    const expected = [
      { ...snapshot.target, serial_number: PHYSICAL_SERIAL },
      { ...snapshot.source, serial_number: "", status: "INACTIVE" },
    ];
    if (JSON.stringify(after) !== JSON.stringify(expected) ||
        JSON.stringify(await ownerReaderBinding(client, 3)) !== JSON.stringify(snapshot.targetBinding)) {
      throw new AuthError(409, "Post-write preservation check failed");
    }
    const evidence = {
      before: snapshot.before, after: snapshot.after, reason: input.reason,
      credentialPreserved: true, ownershipPreserved: true, eventReferencesUnchanged: true,
      sourceSerialCleared: true, wireDeviceIdUnchanged: "EDUCORE03",
    };
    const audit = await client.query(`INSERT INTO audit_logs
      ("user",role,actor_user_id,action,module,record_id,event_type,result,metadata)
      VALUES('Platform Owner','PLATFORM_OWNER',$1,$2,'Devices',3,'OWNER_HARDWARE_IDENTITY_CORRECTION','SUCCESS',$3::jsonb)
      RETURNING id,"timestamp"`, [actor, HARDWARE_CORRECTION_ACTION, JSON.stringify(evidence)]);
    await client.query("COMMIT");
    return { ...evidence, auditId: audit.rows[0].id, auditedAt: audit.rows[0].timestamp };
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
