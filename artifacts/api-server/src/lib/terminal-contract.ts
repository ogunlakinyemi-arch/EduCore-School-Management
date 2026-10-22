import { createHash } from "node:crypto";
import { AuthError } from "../middlewares/auth";

export const TERMINAL_MAX_AGE_MS = 366 * 86_400_000;
export const TERMINAL_DIRECTION_ACTION = "Configured NFC terminal direction";
export const TERMINAL_RECEIPT_ACTION = "NFC terminal event receipt";
export type TerminalDirection = "ENTRY" | "EXIT" | "ENTRY_EXIT";
export type TerminalReceipt = {
  success: boolean;
  duplicate: boolean;
  retryable: boolean;
  message: string;
  student_name: string | null;
  action: "ENTRY" | "EXIT" | "DENIED" | null;
};

export function lagosDate(date: Date) {
  return new Date(date.getTime() + 3_600_000).toISOString().slice(0, 10);
}

export function terminalTimestamp(value: unknown, now = Date.now()) {
  if (typeof value !== "string") throw new AuthError(400, "timestamp is required");
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match) throw new AuthError(400, "timestamp must be an ISO date and time");
  const [, year, month, day, hour, minute, second, , offset] = match;
  const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (Number(year) < 2000 || calendar.getUTCFullYear() !== Number(year) ||
      calendar.getUTCMonth() !== Number(month) - 1 || calendar.getUTCDate() !== Number(day) ||
      Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 ||
      (offset && offset !== "Z" && (Number(offset.slice(1, 3)) > 14 ||
        Number(offset.slice(4)) > 59 || (Number(offset.slice(1, 3)) === 14 && Number(offset.slice(4)) !== 0)))) {
    throw new AuthError(400, "Invalid timestamp");
  }
  // Africa/Lagos is UTC+01:00 throughout the supported recent-history window.
  const date = new Date(value.replace(" ", "T") + (offset ? "" : "+01:00"));
  if (!Number.isFinite(date.getTime()) || date.getTime() > now + 300_000 ||
      date.getTime() < now - TERMINAL_MAX_AGE_MS) {
    throw new AuthError(400, "timestamp is outside the -366 days/+5 minutes window");
  }
  return date;
}

export function parseTerminalEvent(body: unknown, now = Date.now()) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AuthError(400, "JSON object required");
  const value = body as Record<string, unknown>;
  const keys = ["event_id", "device_id", "school_id", "terminal_name", "uid", "event_type", "timestamp", "firmware"];
  if (Object.keys(value).some(key => !keys.includes(key))) throw new AuthError(400, "Unknown terminal event field");
  if (typeof value.event_id !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value.event_id)) {
    throw new AuthError(400, "event_id must contain 1–128 letters, digits, dots, underscores, colons or hyphens");
  }
  for (const key of ["device_id", "school_id"] as const) {
    if (!(typeof value[key] === "number" || (typeof value[key] === "string" && /^[1-9]\d*$/.test(value[key] as string))) ||
        !Number.isSafeInteger(Number(value[key])) || Number(value[key]) < 1) {
      throw new AuthError(400, `${key} must be a positive integer`);
    }
  }
  if (typeof value.uid !== "string" || !/^(?:[a-fA-F0-9]{8}|[a-fA-F0-9]{14}|[a-fA-F0-9]{20})$/.test(value.uid)) {
    throw new AuthError(400, "uid must contain exactly 8, 14 or 20 hexadecimal characters");
  }
  if (value.event_type !== "CARD_SCAN") throw new AuthError(400, "event_type must be CARD_SCAN");
  for (const key of ["terminal_name", "firmware"]) {
    if (value[key] !== undefined && (typeof value[key] !== "string" || (value[key] as string).length > 128)) {
      throw new AuthError(400, `${key} must be a string of at most 128 characters`);
    }
  }
  const occurredAt = terminalTimestamp(value.timestamp, now);
  const event = {
    event_id: value.event_id, device_id: Number(value.device_id), school_id: Number(value.school_id),
    terminal_name: value.terminal_name ?? null, uid: value.uid.toUpperCase(),
    event_type: "CARD_SCAN", timestamp: value.timestamp as string, firmware: value.firmware ?? null,
  };
  return {
    event, occurredAt,
    // Original timestamp is part of the identity: retries must not replace it with "now".
    fingerprint: createHash("sha256").update(JSON.stringify(event)).digest("hex"),
    eventKey: createHash("sha256").update(JSON.stringify([event.device_id, event.event_id])).digest("hex"),
  };
}

export const terminalDirectionSql = `
  SELECT metadata->>'terminalDirection' AS direction FROM audit_logs
   WHERE record_id=$1 AND action='${TERMINAL_DIRECTION_ACTION}' AND module='Devices'
     AND metadata->>'schoolId'=$2::text
   ORDER BY id DESC LIMIT 1`;
