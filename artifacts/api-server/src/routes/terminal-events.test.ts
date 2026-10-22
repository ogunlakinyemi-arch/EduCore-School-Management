import express from "express";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  direction: "ENTRY" as string | null,
  credentials: true, active: true, card: true, available: true,
  events: [] as any[], receipts: [] as any[], dates: [] as string[],
  queries: [] as string[], cardUids: [] as string[],
  securityDenied: false,
  policy: "NFC_ONLY",
  loseCommitResponse: false,
}));
const mocks = vi.hoisted(() => ({
  query: vi.fn(), release: vi.fn(),
  security: vi.fn(), notifications: vi.fn(),
}));
vi.mock("@workspace/db", () => ({
  pool: { query: (...args: any[]) => mocks.query(...args), connect: async () => {
    if (!fixture.available) throw new Error("unavailable");
    return { query: (...args: any[]) => mocks.query(...args), release: mocks.release };
  } },
}));
vi.mock("../services/security-attendance-integration", () => ({
  joinSecurityAttendance: (...args: any[]) => mocks.security(...args),
  recordAuthenticatedNfcDenial: vi.fn(),
}));
vi.mock("../services/communication-service", () => ({ queueCommunicationNotification: (...args: any[]) => mocks.notifications(...args) }));
vi.mock("../services/subscription-enforcement", () => ({ assertSubscriptionAccess: vi.fn() }));
vi.mock("../services/student-card-replacement", () => ({ issueReplacement: vi.fn() }));
vi.mock("./employee-nfc", async () => ({ default: (await import("express")).Router() }));

import terminalRouter from "./terminal-events";
import { AuthError } from "../middlewares/auth";
import { lagosDate, parseTerminalEvent, terminalTimestamp, TERMINAL_MAX_AGE_MS } from "../lib/terminal-contract";

let base = "";
let server: ReturnType<ReturnType<typeof express>["listen"]>;
let snapshot: { events: any[]; receipts: any[]; dates: string[] } | null = null;
const result = (rows: any[]) => ({ rows, rowCount: rows.length });
const payload = (overrides: Record<string, unknown> = {}) => ({
  event_id: "vendor-event-1", device_id: 100, school_id: 10,
  uid: "a1b2c3d4", event_type: "CARD_SCAN",
  timestamp: new Date(Date.now() - 60_000).toISOString(), ...overrides,
});
async function send(body: any = payload(), options: { key?: string; method?: string; type?: string } = {}) {
  const response = await fetch(`${base}/api/v1/terminal/events`, {
    method: options.method ?? "POST",
    headers: { "Content-Type": options.type ?? "application/json", Authorization: `Bearer ${options.key ?? "terminal.secret"}` },
    ...(options.method === "GET" ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
  return { status: response.status, body: await response.json() as any };
}

beforeAll(async () => {
  const app = express();
  app.use("/api", terminalRouter);
  await new Promise<void>((resolve, reject) => { server = app.listen(0, "127.0.0.1", error => error ? reject(error) : resolve()); });
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});
afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
beforeEach(() => {
  Object.assign(fixture, { direction: "ENTRY", credentials: true, active: true, card: true, available: true,
    securityDenied: false, policy: "NFC_ONLY", loseCommitResponse: false,
    events: [], receipts: [], dates: [], queries: [], cardUids: [] });
  snapshot = null;
  vi.clearAllMocks();
  mocks.security.mockImplementation(async () => {
    if (fixture.securityDenied) throw new AuthError(403, "NFC security identity validation rejected this tap");
    return true;
  });
  mocks.query.mockImplementation(async (sql: string, values: any[] = []) => {
    fixture.queries.push(sql);
    if (!fixture.available) throw new Error("unavailable");
    if (sql === "COMMIT" && fixture.loseCommitResponse) {
      fixture.loseCommitResponse = false;
      throw new Error("synthetic committed response lost");
    }
    if (sql === "SAVEPOINT terminal_attendance") {
      snapshot = structuredClone({ events: fixture.events, receipts: fixture.receipts, dates: fixture.dates }); return result([]);
    }
    if (sql === "ROLLBACK TO SAVEPOINT terminal_attendance" && snapshot) {
      Object.assign(fixture, structuredClone(snapshot)); return result([]);
    }
    if (["BEGIN", "COMMIT", "ROLLBACK", "RELEASE SAVEPOINT terminal_attendance"].includes(sql) || sql.includes("pg_advisory")) return result([]);
    if (sql.includes("FROM device_credentials c")) {
      return result(fixture.credentials && values[0] === "terminal" ? [{
        credentialId: 1, deviceId: 100, schoolId: 10, deviceStatus: "ACTIVE",
        secretHash: createHash("sha256").update("secret").digest("hex"),
      }] : []);
    }
    if (sql.includes("FROM platform_devices WHERE id")) return result(fixture.active ? [{}] : []);
    if (sql.startsWith("UPDATE device_credentials") || sql.startsWith("UPDATE platform_devices")) return result([]);
    if (sql.includes("FROM platform_devices d JOIN device_credentials")) return result(fixture.active ? [{}] : []);
    if (sql.includes("metadata->>'terminalDirection'")) return result(fixture.direction ? [{ direction: fixture.direction }] : []);
    if (sql.includes("SELECT metadata FROM audit_logs")) return result(fixture.receipts
      .filter(item => item.metadata.eventKey === values[2]).map(item => ({ metadata: item.metadata })));
    if (sql.includes("INSERT INTO audit_logs")) {
      fixture.receipts.push({ metadata: JSON.parse(values[4]) }); return result([]);
    }
    if (sql.includes("FROM nfc_cards")) {
      fixture.cardUids.push(values[0]);
      return result(fixture.card ? [{ id: 700, studentId: 501 }] : []);
    }
    if (sql.includes("SELECT id FROM students")) return result([{ id: 501 }]);
    if (sql.includes("FROM student_identification_policies")) return result([{ policy: fixture.policy }]);
    if (sql.includes("FROM attendance_settings")) return result([{ seconds: 30 }]);
    if (sql.includes("SELECT e.*,e.event_date::text")) return result([]);
    if (sql.includes("FROM students st") && sql.includes("student_class_assignments")) return result([{
      studentId: 501, studentName: "Synthetic Student", className: "JSS1", section: "A",
    }]);
    if (sql.includes("FROM attendance_events") && sql.includes("dedupe_key=$3")) {
      return result(fixture.events.filter(item => item.dedupeKey === values[2]));
    }
    if (sql.includes("SELECT EXISTS(")) return result([{ present: true }]);
    if (sql.includes("event_type AS \"eventType\",occurred_at AS \"occurredAt\"")) {
      return result(fixture.events.filter(e=>e.schoolId===values[0] && e.studentId===values[1])
        .sort((a,b)=>new Date(b.occurredAt).getTime()-new Date(a.occurredAt).getTime()).slice(0,1));
    }
    if (sql.includes("UPDATE attendance_discrepancies")) return result([]);
    if (sql.includes("FROM attendance_events") && sql.includes("BETWEEN")) {
      return result(fixture.events.filter(item => item.eventType === values[3] &&
        Math.abs(new Date(item.occurredAt).getTime() - new Date(values[4]).getTime()) <= Number(values[5]) * 1000));
    }
    if (sql.includes("INSERT INTO attendance_events")) {
      const item = { id: fixture.events.length + 1, schoolId: values[0], studentId: values[1],
        deviceId: values[2], nfcCardId: values[3], schoolClassId: values[4],
        identificationMethod: values[5], eventType: values[6], occurredAt: values[8], dedupeKey: values[9],
        result: "ACCEPTED", status: values[10] ?? "PRESENT" };
      fixture.events.push(item); fixture.dates.push(values[7]); return result([item]);
    }
    if (sql.includes("WITH missing AS") || sql.includes("INSERT INTO attendance_notification_events")) return result([]);
    throw new Error(`Unhandled mock SQL: ${sql}`);
  });
});

describe("vendor terminal endpoint with the existing attendance handler (mocked persistence)", () => {
  it.each(["ENTRY", "EXIT"])("records the configured %s direction, normalized UID and original time", async direction => {
    fixture.direction = direction;
    const request = payload();
    const response = await send(request);
    expect(response.status, JSON.stringify(fixture.queries.slice(-5))).toBe(200);
    expect(response.body).toMatchObject({ success: true, duplicate: false, retryable: false, action: direction, student_name: "Synthetic Student" });
    expect(fixture.events).toHaveLength(1);
    expect(fixture.events[0].eventType).toBe(direction === "ENTRY" ? "SCHOOL_ENTRY" : "SCHOOL_EXIT");
    expect(fixture.cardUids).toEqual(["A1B2C3D4"]);
    expect(fixture.receipts[0].metadata).toMatchObject({ eventId: request.event_id, originalTimestamp: request.timestamp });
    expect(fixture.queries.filter(sql => sql === "COMMIT")).toHaveLength(1);
  });
  it.each(["wrong.secret", "terminal.wrong", "malformed"])("rejects credential %s", async key => {
    expect((await send(payload(), { key })).status).toBe(401);
    expect(fixture.events).toHaveLength(0);
  });
  it("rejects revoked credentials and inactive devices", async () => {
    fixture.credentials = false;
    expect((await send()).status).toBe(401);
    fixture.credentials = true; fixture.active = false;
    expect((await send()).status).toBe(401);
  });
  it.each([{ device_id: 101 }, { school_id: 11 }])("rejects mismatched identity %j", async mismatch => {
    expect((await send(payload(mismatch))).status).toBe(403);
    expect(fixture.events).toHaveLength(0);
  });
  it("fails closed when the device has no assigned direction", async () => {
    fixture.direction = null;
    expect(await send()).toMatchObject({ status: 503, body: { success: false, retryable: true } });
  });
  it("replays the identical event without inserting attendance or auditing twice, even after direction changes", async () => {
    const request = payload();
    expect((await send(request)).body.success).toBe(true);
    fixture.direction = "EXIT";
    expect(await send(request)).toMatchObject({ status: 200, body: { success: true, duplicate: true, action: "ENTRY" } });
    expect(fixture.events).toHaveLength(1); expect(fixture.receipts).toHaveLength(1);
  });
  it("recovers a lost commit response using the saved event without a new attendance record", async () => {
    const request = payload(); fixture.loseCommitResponse = true;
    expect(await send(request)).toMatchObject({ status: 503, body: { retryable: true } });
    expect(await send(request)).toMatchObject({ status: 200, body: { success: true, duplicate: true } });
    expect(fixture.events).toHaveLength(1); expect(fixture.receipts).toHaveLength(1);
  });
  it.each([{ uid: "12345678" }, { firmware: "changed" }, { timestamp: new Date().toISOString() }])(
    "rejects conflicting reuse %j", async change => {
      const request = payload();
      await send(request);
      expect(await send({ ...request, ...change })).toMatchObject({ status: 409, body: { success: false, retryable: false } });
      expect(fixture.events).toHaveLength(1);
    });
  it("returns a durable business denial and replays it without later accepting the same event", async () => {
    fixture.card = false;
    const request = payload();
    expect(await send(request)).toMatchObject({ status: 200, body: { success: false, action: "DENIED", duplicate: false, retryable: false } });
    fixture.card = true;
    expect(await send(request)).toMatchObject({ status: 200, body: { success: false, duplicate: true, action: "DENIED" } });
    expect(fixture.events).toHaveLength(0); expect(fixture.receipts).toHaveLength(1);
  });
  it("returns a business denial for an identification policy that disallows NFC", async () => {
    fixture.policy = "BIOMETRIC_ONLY";
    expect(await send()).toMatchObject({ status: 200, body: { success: false, action: "DENIED", retryable: false } });
    expect(fixture.events).toHaveLength(0);
  });
  it("rolls back partial attendance after a security denial and saves only a denied receipt", async () => {
    fixture.securityDenied = true;
    expect(await send()).toMatchObject({ status: 200, body: { success: false, action: "DENIED" } });
    expect(fixture.events).toHaveLength(0);
    expect(fixture.receipts[0].metadata.receipt.success).toBe(false);
  });
  it("rechecks card eligibility on a successful replay", async () => {
    const request = payload(); await send(request); fixture.card = false;
    expect(await send(request)).toMatchObject({ status: 200, body: { success: false, action: "DENIED" } });
    expect(fixture.events).toHaveLength(1);
  });
  it("suppresses a different event ID within the duplicate window without a second attendance row", async () => {
    const request = payload(); await send(request);
    expect(await send({ ...request, event_id: "another-id" })).toMatchObject({
      status: 200, body: { success: false, duplicate: true, action: "DENIED" },
    });
    expect(fixture.events).toHaveLength(1);
  });
  it("stores Lagos calendar date for timezone-free midnight and suppresses historical notifications", async () => {
    // Use a previous school-local day that is safely within the configured
    // 72-hour window, including when this test runs near UTC midnight.
    const day = lagosDate(new Date(Date.now() - 86_400_000));
    const request = payload({ timestamp: `${day}T00:30:00` });
    expect((await send(request)).body.success).toBe(true);
    expect(fixture.events[0].occurredAt).toBe(new Date(`${day}T00:30:00+01:00`).toISOString());
    expect(fixture.dates).toEqual([day]);
    expect(mocks.security.mock.calls[0].slice(2)).toEqual([false,true]);
    expect(mocks.notifications).not.toHaveBeenCalled();
  });
  it.each(["X1234567", "1234", "A1:B2:C3:D4", "A".repeat(16)])("rejects UID %s", async uid => {
    expect((await send(payload({ uid }))).status).toBe(400);
  });
  it.each([8, 14, 20])("accepts a %i-character UID", async count => {
    expect((await send(payload({ uid: "a".repeat(count) }))).body.success).toBe(true);
  });
  it.each([
    { event_id: "" }, { event_type: "SCHOOL_ENTRY" }, { school_id: -1 },
    { timestamp: new Date(Date.now() - TERMINAL_MAX_AGE_MS - 60_000).toISOString() },
    { timestamp: new Date(Date.now() + 360_000).toISOString() },
  ])("rejects invalid documented fields %j", async change => {
    expect((await send(payload(change))).status).toBe(400);
  });
  it("returns 503 for unavailable persistence without exposing database details", async () => {
    fixture.available = false;
    expect(await send()).toMatchObject({ status: 503, body: { retryable: true, message: "Attendance service unavailable" } });
  });
  it("returns 405, 415, 400 and 413 for transport errors", async () => {
    expect((await send({}, { method: "GET" })).status).toBe(405);
    expect((await send({}, { type: "text/plain" })).status).toBe(415);
    expect((await send("{")).status).toBe(400);
    expect((await send(JSON.stringify({ padding: "x".repeat(17_000) }))).status).toBe(413);
  });
});

describe("terminal timestamp and canonical payload validation", () => {
  const now = Date.parse("2026-10-15T12:00:00Z");
  it.each([-TERMINAL_MAX_AGE_MS, 300_000])("accepts the inclusive boundary %i", delta => {
    expect(terminalTimestamp(new Date(now + delta).toISOString(), now).getTime()).toBe(now + delta);
  });
  it.each([-TERMINAL_MAX_AGE_MS - 1, 300_001])("rejects outside the boundary %i", delta => {
    expect(() => terminalTimestamp(new Date(now + delta).toISOString(), now)).toThrow();
  });
  it.each(["2026-02-30T12:00:00", "2026-10-15T24:00:00", "2026-10-15", "2026-10-15T12:00:00+14:30"])(
    "rejects invalid timestamp %s", timestamp => expect(() => terminalTimestamp(timestamp, now)).toThrow());
  it("treats timezone-free Lagos and explicit UTC times as the same instant, while preserving original spelling in retry identity", () => {
    expect(terminalTimestamp("2026-10-15T12:00:00", now).toISOString()).toBe("2026-10-15T11:00:00.000Z");
    expect(lagosDate(new Date("2026-10-14T23:30:00Z"))).toBe("2026-10-15");
    const a = parseTerminalEvent(payload({ timestamp: "2026-10-15T12:00:00" }), now);
    const b = parseTerminalEvent(payload({ timestamp: "2026-10-15T11:00:00Z" }), now);
    expect(a.occurredAt).toEqual(b.occurredAt); expect(a.fingerprint).not.toBe(b.fingerprint);
  });
});
