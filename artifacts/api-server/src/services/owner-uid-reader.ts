import { createHash, timingSafeEqual } from "node:crypto";
import { AuthError } from "../middlewares/auth";
import { terminalInternalId, terminalTimestamp } from "../lib/terminal-contract";

export const OWNER_READER_ACTION = "Owner UID reader binding";
export const OWNER_UID_ACTION = "Owner reader UID captured";
export const OWNER_READER_STATUS_ACTION = "Owner reader status reported";
export type ReaderDb = { query: (sql: string, values?: any[]) => Promise<{ rows: any[] }> };

/** Durable operational state: retain these audit entries like terminal directions. */
export async function ownerReaderBinding(db: ReaderDb, deviceId: number) {
  const result = await db.query(
    `SELECT metadata FROM audit_logs WHERE module='Devices' AND action=$1 AND record_id=$2 ORDER BY id DESC LIMIT 1`,
    [OWNER_READER_ACTION, deviceId],
  );
  const binding = result.rows[0]?.metadata;
  return binding?.status === "ACTIVE" ? binding : null;
}

export async function assertNotOwnerReader(db: ReaderDb, deviceId: number) {
  if (await ownerReaderBinding(db, deviceId)) {
    throw new AuthError(409, "Unlink the Owner UID reader before assigning it to a school");
  }
}

export function parseOwnerUidEvent(body: unknown, now = Date.now()) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AuthError(400, "JSON object required");
  const b = body as Record<string, unknown>;
  if (Object.keys(b).some(k => !["event_id", "device_id", "uid", "event_type", "timestamp", "error_code"].includes(k))) {
    throw new AuthError(400, "Owner UID reads do not accept school or attendance fields");
  }
  if (typeof b.event_id !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(b.event_id)) throw new AuthError(400, "Invalid event_id");
  if (!["CARD_SCAN", "READER_HEARTBEAT", "CARD_SCAN_ERROR"].includes(String(b.event_type))) {
    throw new AuthError(400, "Unsupported Owner reader event_type");
  }
  const isScan = b.event_type === "CARD_SCAN";
  if (isScan && (typeof b.uid !== "string" || !/^(?:[a-fA-F0-9]{8}|[a-fA-F0-9]{14}|[a-fA-F0-9]{20})$/.test(b.uid))) {
    throw new AuthError(400, "A genuine 8, 14 or 20 hex-character UID is required");
  }
  if (!isScan && b.uid !== undefined) throw new AuthError(400, "Only CARD_SCAN accepts a UID");
  if (b.event_type === "CARD_SCAN_ERROR") {
    if (!["UNSUPPORTED_CARD", "READER_ERROR", "TRANSPORT_ERROR"].includes(String(b.error_code))) {
      throw new AuthError(400, "A supported reader error_code is required");
    }
  } else if (b.error_code !== undefined) throw new AuthError(400, "Only CARD_SCAN_ERROR accepts error_code");
  const occurredAt = terminalTimestamp(b.timestamp, now);
  // Inventory capture is live, unlike the historical school attendance importer.
  if (occurredAt.getTime() < now - 300_000) throw new AuthError(400, "Owner UID reads must be within five minutes");
  const deviceId = terminalInternalId(b.device_id, "device");
  const rawUid = isScan ? b.uid as string : null;
  const uid = rawUid?.toUpperCase() ?? null;
  // Keep the original successful-scan identity compatible with existing receipts.
  const fingerprint = createHash("sha256").update(JSON.stringify(isScan
    ? [deviceId, uid, b.timestamp] : [deviceId, b.event_type, b.error_code ?? null, b.timestamp])).digest("hex");
  return { deviceId, uid, rawUid, eventId: b.event_id, timestamp: b.timestamp, fingerprint,
    scanStatus: isScan ? "CAPTURED" : b.event_type === "READER_HEARTBEAT" ? "READY" : String(b.error_code) };
}

export function verifyOwnerReaderSecret(credential: string, binding: any) {
  const split = credential.indexOf(".");
  const identifier = credential.slice(0, split);
  const secret = credential.slice(split + 1);
  const actual = createHash("sha256").update(secret).digest();
  const stored = Buffer.from(binding?.secretHash ?? "", "hex");
  if (split < 1 || !secret || binding?.credentialIdentifier !== identifier ||
      actual.length !== stored.length || !timingSafeEqual(actual, stored)) {
    throw new AuthError(401, "Invalid or revoked Owner reader credential");
  }
}

/** Resolve the event's card, never the student's current card after replacement.
 * Card history proves student ownership if an old card was subsequently unlinked. */
export function attendanceCardUidSql(alias: "e" | "ae") {
  return `(SELECT c.uid FROM nfc_cards c WHERE c.id=${alias}.nfc_card_id
    AND c.school_id=${alias}.school_id AND ${alias}.student_id IS NOT NULL
    AND (c.student_id=${alias}.student_id OR EXISTS(
      SELECT 1 FROM nfc_card_history h WHERE h.nfc_card_id=c.id
        AND h.school_id=${alias}.school_id AND h.student_id=${alias}.student_id
        AND h.created_at<=${alias}.occurred_at))
    LIMIT 1)`;
}
