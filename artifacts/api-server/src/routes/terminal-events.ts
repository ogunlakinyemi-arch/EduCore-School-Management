import express, { Router, type Request, type Response, type NextFunction } from "express";
import { pool } from "@workspace/db";
import { AuthError } from "../middlewares/auth";
import { deviceAuth, handleDeviceAttendance } from "./attendance";
import {
  lagosDate, parseTerminalEvent, TERMINAL_MAX_AGE_MS, TERMINAL_RECEIPT_ACTION,
  terminalDirectionSql, type TerminalDirection, type TerminalReceipt,
  terminalInternalId,
} from "../lib/terminal-contract";
import { recordNfcDiagnostic, scanReason } from "../services/nfc-scan-audit";

const router = Router();
const path = "/v1/terminal/events";
const envelope = (message: string, retryable = false): TerminalReceipt => ({
  success: false, duplicate: false, retryable, message, student_name: null, action: null,
});

/** This router is mounted before Clerk and the general JSON parser; device keys are not user tokens. */
router.all(path, (req, res, next) => {
  if (req.method !== "POST") {
    res.set("Allow", "POST").status(405).json(envelope("Method not allowed")); return;
  }
  if (!req.is("application/json")) {
    res.status(415).json(envelope("Content-Type must be application/json")); return;
  }
  next();
});
router.post(path, express.json({ limit: "16kb", strict: true }), async (req, res, next) => {
  try { await ingestTerminalEvent(req, res); } catch (error) { next(error); }
});

async function diagnostic(client: { query: (sql: string, values?: any[]) => Promise<any> },
  device: { deviceId: number; schoolId: number; credentialId: number },
  body: any, kind: "MALFORMED" | "ERROR", reason: string) {
  await client.query("BEGIN");
  try {
    // Recheck under the same row lock as reassignment/revocation; never log a
    // submitted school's identity after its credential has ceased to authorize it.
    const current = await client.query(`SELECT d.id FROM platform_devices d JOIN device_credentials c ON c.device_id=d.id
      WHERE d.id=$1 AND d.school_id=$2 AND c.id=$3 AND c.school_id=d.school_id
        AND d.status='ACTIVE' AND d.configuration_status='CONFIGURED' AND c.status='ACTIVE'
        AND (c.expires_at IS NULL OR c.expires_at>NOW()) FOR UPDATE OF d`,
    [device.deviceId, device.schoolId, device.credentialId]);
    if (current.rows[0]) await recordNfcDiagnostic(client, { ...device, source: "SCHOOL", kind, reason,
      eventId: body?.event_id, occurredAt: body?.timestamp, uid: kind === "ERROR" ? body?.uid : null });
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK"); throw e; }
}

export async function ingestTerminalEvent(req: Request, res: Response) {
  const authorization = req.header("Authorization");
  const match = /^Bearer ([^\s]+)$/i.exec(authorization ?? "");
  if (!match) throw new AuthError(401, "Bearer device credential required");
  const now = Date.now();
  let parsed: ReturnType<typeof parseTerminalEvent>;
  try { parsed = parseTerminalEvent(req.body, now); }
  catch (originalError) {
    // Preserve parsing status/response. Never attribute caller-provided identities
    // until a genuine credential and both IDs have independently matched.
    try {
      const id = terminalInternalId(req.body?.device_id, "device");
      const schoolId = terminalInternalId(req.body?.school_id, "school");
      const device = await deviceAuth(req, match[1]);
      if (device.deviceId === id && device.schoolId === schoolId) {
        const client = await pool.connect();
        try { await diagnostic(client, device, req.body, "MALFORMED", "MALFORMED_REPORT"); }
        finally { client.release(); }
      }
    } catch { /* No diagnostic can authorize a report or replace its original response. */ }
    throw originalError;
  }
  const device = await deviceAuth(req, match[1]);
  if (parsed.event.school_id !== device.schoolId || parsed.event.device_id !== device.deviceId) {
    throw new AuthError(403, "Device and school must match the registered device");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Lock order matches legacy ingestion: device row first, then event locks.
    const active = await client.query(
      `SELECT d.id FROM platform_devices d JOIN device_credentials c ON c.device_id=d.id
       WHERE d.id=$1 AND d.school_id=$2 AND d.status='ACTIVE'
         AND d.configuration_status='CONFIGURED' AND upper(d.device_type) IN ('NFC','HYBRID')
         AND c.id=$3 AND c.school_id=d.school_id AND c.status='ACTIVE'
         AND (c.expires_at IS NULL OR c.expires_at>NOW()) FOR UPDATE OF d`,
      [device.deviceId, device.schoolId, device.credentialId],
    );
    if (!active.rows[0]) throw new AuthError(401, "Invalid or inactive device credential");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`terminal:${parsed.eventKey}`]);
    const prior = await client.query(
      `SELECT metadata FROM audit_logs WHERE action=$1 AND module='Attendance'
       AND record_id=$2 AND metadata->>'eventKey'=$3 ORDER BY id DESC LIMIT 1`,
      [TERMINAL_RECEIPT_ACTION, device.deviceId, parsed.eventKey],
    );
    const saved = prior.rows[0]?.metadata;
    if (saved && saved.fingerprint !== parsed.fingerprint) {
      throw new AuthError(409, "event_id was already used for different data", "TERMINAL_EVENT_CONFLICT");
    }
    // Reassignment cannot move an old event into another school's attendance.
    if (saved && saved.schoolId !== device.schoolId) {
      throw new AuthError(409, "event_id belongs to a previous school assignment", "TERMINAL_EVENT_CONFLICT");
    }
    if (saved && saved.receipt.success === false) {
      await recordNfcDiagnostic(client, { deviceId: device.deviceId, schoolId: device.schoolId,
        source: "SCHOOL", kind: "RETRY", reason: "EXACT_RETRY",
        eventId: parsed.event.event_id, occurredAt: parsed.event.timestamp, uid: parsed.event.uid });
      await client.query("COMMIT");
      res.status(200).json({ ...saved.receipt, duplicate: true }); return;
    }
    const configuration = saved ? null : await client.query(terminalDirectionSql, [device.deviceId, device.schoolId]);
    const direction: TerminalDirection = saved?.direction ?? configuration?.rows[0]?.direction;
    if (!["ENTRY", "EXIT", "ENTRY_EXIT"].includes(direction)) {
      throw new AuthError(503, "Assign an attendance mode to this terminal before use");
    }
    // Delegate to the existing card/policy/security/reconciliation pipeline with one shared transaction.
    const originalBody = req.body;
    req.body = {
      schoolId: device.schoolId, deviceId: device.deviceId, nfcUid: parsed.event.uid,
      eventType: saved?.receipt?.action === "ENTRY" ? "SCHOOL_ENTRY"
        : saved?.receipt?.action === "EXIT" ? "SCHOOL_EXIT"
        : direction === "ENTRY_EXIT" ? "SCHOOL_AUTO" : direction === "ENTRY" ? "SCHOOL_ENTRY" : "SCHOOL_EXIT",
      identificationMethod: "NFC", occurredAt: parsed.occurredAt.toISOString(),
      idempotencyKey: `vendor:${parsed.eventKey}`,
    };
    let status = 200;
    let body: Record<string, any> = {};
    const capture = {
      status(code: number) { status = code; return capture; },
      json(value: Record<string, any>) { body = value; return capture; },
    } as unknown as Response;
    await client.query("SAVEPOINT terminal_attendance");
    let denial: AuthError | null = null;
    try {
      await handleDeviceAttendance(req, capture, {
        device, client, mode: direction, maxAgeMs: TERMINAL_MAX_AGE_MS,
        normalizeUid: true, skipDenialAudit: true,
        nowMs: now,
        suppressNotifications: lagosDate(parsed.occurredAt) !== lagosDate(new Date()),
      });
      if (status === 409 && body.error === "Duplicate event") {
        denial = new AuthError(409, "Duplicate scan suppressed");
      }
    } catch (error) {
      if (error instanceof AuthError && [403, 404, 409].includes(error.statusCode) &&
          !["SUBSCRIPTION_STATUS_UNAVAILABLE", "ATTENDANCE_IDEMPOTENCY_CONFLICT"].includes(error.eventType ?? "")) {
        denial = error;
      } else { throw error; }
    } finally { req.body = originalBody; }
    let receipt: TerminalReceipt;
    if (denial) {
      // Do not retain any partial attendance/security/notification effects of a denied scan.
      await client.query("ROLLBACK TO SAVEPOINT terminal_attendance");
       receipt = { ...envelope(denial.message), action: "DENIED",
         duplicate: Boolean(saved) || status === 409 || /duplicate/i.test(denial.message) };
    } else {
      receipt = {
        success: true, duplicate: status === 200, retryable: false, message: "Attendance recorded",
        student_name: typeof body.studentName === "string" ? body.studentName : null,
        action: body.eventType === "SCHOOL_EXIT" ? "EXIT" : "ENTRY",
      };
    }
    await client.query("RELEASE SAVEPOINT terminal_attendance");
    if (!saved) {
      const context = (await client.query(`SELECT d.name AS "deviceName",s.name AS "schoolName",
        EXISTS(SELECT 1 FROM nfc_cards c WHERE upper(c.uid)=$2) AS "registeredAtScan"
        FROM platform_devices d JOIN schools s ON s.id=d.school_id
        WHERE d.id=$1 AND d.school_id=$3`,
      [device.deviceId, parsed.event.uid, device.schoolId])).rows[0];
      // Durable protocol receipts live in the existing audit store; attendance remains authoritative.
      // Owner-only projection exposes restricted canonical scan evidence, never keys/person payloads.
      await client.query(
        `INSERT INTO audit_logs ("user",role,school_id,action,module,record_id,event_type,result,metadata)
         VALUES('NFC terminal','DEVICE',$1,$2,'Attendance',$3,'NFC_TERMINAL_EVENT',$4,$5::jsonb)`,
        [device.schoolId, TERMINAL_RECEIPT_ACTION, device.deviceId, receipt.success ? "SUCCESS" : "DENIED",
          JSON.stringify({
            eventKey: parsed.eventKey, eventId: parsed.event.event_id, fingerprint: parsed.fingerprint,
            originalTimestamp: parsed.event.timestamp, occurredAt: parsed.occurredAt.toISOString(),
            schoolId: device.schoolId, direction, attendanceEventId: body.id ?? null, receipt,
            scan: { uid: parsed.event.uid, occurredAt: parsed.occurredAt.toISOString(),
              receivedAt: new Date(now).toISOString(),
              deviceName: context?.deviceName ?? null, schoolName: context?.schoolName ?? null,
              registeredAtScan: context?.registeredAtScan ?? null,
              reason: denial ? scanReason(denial) : "ATTENDANCE_ACCEPTED" },
          })],
      );
    } else {
      await recordNfcDiagnostic(client, { deviceId: device.deviceId, schoolId: device.schoolId,
        source: "SCHOOL", kind: "RETRY", reason: "EXACT_RETRY",
        eventId: parsed.event.event_id, occurredAt: parsed.event.timestamp, uid: parsed.event.uid });
    }
    await client.query("COMMIT");
    res.status(200).json(saved && !denial ? { ...saved.receipt, duplicate: true } : receipt);
  } catch (error) {
    await client.query("ROLLBACK");
    try { await diagnostic(client, device, req.body, "ERROR", scanReason(error)); }
    catch { /* Diagnostics do not change an existing protocol error response. */ }
    throw error;
  } finally { client.release(); }
}

router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const parser = error as { type?: string };
  if (parser?.type === "entity.too.large") { res.status(413).json(envelope("Payload too large")); return; }
  if (parser?.type === "entity.parse.failed") { res.status(400).json(envelope("Invalid JSON")); return; }
  if (parser?.type === "charset.unsupported" || parser?.type === "encoding.unsupported") {
    res.status(415).json(envelope("Unsupported JSON encoding")); return;
  }
  const status = error instanceof AuthError ? error.statusCode : 503;
  res.status(status === 503 || status >= 500 ? 503 : status).json({
    ...envelope(error instanceof AuthError ? error.message : "Attendance service unavailable", status >= 500),
    ...(error instanceof AuthError ? { code: error.eventType } : {}),
  });
});
export default router;
