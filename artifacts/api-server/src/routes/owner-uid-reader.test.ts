import express from "express";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "PLATFORM_OWNER", device: { id: 1, schoolId: null as number | null, deviceType: "NFC", status: "ACTIVE" },
  binding: null as any, captures: [] as any[], reports: [] as any[], queries: [] as string[], ownerActive: true,
  card: null as any, fail: false,
}));
vi.mock("@workspace/db", () => {
  const query = vi.fn(async (sql: string, values: any[] = []) => {
    state.queries.push(sql);
    const rows = (rows: any[] = []) => ({ rows, rowCount: rows.length });
    if (state.fail && sql.startsWith("SELECT")) throw new Error("Transport unavailable");
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return rows();
    if (sql.includes("pg_advisory_xact_lock")) return rows();
    if (sql.includes("SELECT id,student_id FROM nfc_cards")) return rows(state.card ? [state.card] : []);
    if (sql.includes("SELECT 1 FROM audit_logs WHERE module='UIDInventory'")) return rows(state.captures.filter(c => c.uid === values[1]).map(() => ({ "?column?": 1 })));
    if (sql.includes('d.id AS "deviceId"')) return rows(state.binding ? [{
      deviceId: 1, lastReport: state.reports.at(-1) ?? state.captures.at(-1), lastScan: state.captures.at(-1),
    }] : []);
    if (sql.includes("SELECT captured.metadata")) return rows([...new Map(state.captures.map(c => [c.uid, { uid: c.uid }])).values()]);
    if (sql.includes("FROM platform_devices WHERE id=")) return rows(values[0] === state.device.id ? [{ ...state.device }] : []);
    if (sql.includes("SELECT metadata FROM audit_logs WHERE module='Devices'")) return rows(state.binding ? [{ metadata: state.binding }] : []);
    if (sql.includes("JOIN app_users")) return rows(state.ownerActive ? [{}] : []);
    if (sql.includes("SELECT metadata FROM audit_logs WHERE module='UIDInventory'")) return rows([...state.captures, ...state.reports]
      .filter(c => c.deviceId === values[1] && c.eventId === values[2] && c.credentialIdentifier === values[3]).map(metadata => ({ metadata })));
    if (sql.includes("UPDATE device_credentials SET status='REVOKED'")) return rows();
    if (sql.includes("INSERT INTO audit_logs") && sql.includes("'Devices'")) { state.binding = JSON.parse(values[3]); return rows(); }
    if (sql.includes("INSERT INTO audit_logs") && sql.includes("'UIDInventory'")) {
      (values[1] === "Owner reader UID captured" ? state.captures : state.reports)
        .push({ ...JSON.parse(values[3]), deviceId: values[2] }); return rows();
    }
    throw new Error(`Unhandled mock SQL: ${sql}`);
  });
  return { pool: { query, connect: async () => ({ query, release: vi.fn() }) } };
});
vi.mock("../middlewares/auth", () => {
  class AuthError extends Error { constructor(public statusCode: number, message: string) { super(message); } }
  return { AuthError, requireAuthentication: () => (_req: any, _res: any, next: any) => next(),
    getUserContext: () => ({ user: { id: 77 } }),
    assertRoles: (_req: any, roles: string[]) => { if (!roles.includes(state.role)) throw new AuthError(403, "Forbidden"); } };
});
import router, { ownerUidIngestionRouter } from "./owner-uid-reader";
import platformRouter from "./platform";
import { assertNotOwnerReader, attendanceCardUidSql, parseOwnerUidEvent } from "../services/owner-uid-reader";
import { pool } from "@workspace/db";

let server: ReturnType<ReturnType<typeof express>["listen"]>, base = "";
beforeAll(async () => {
  const app = express();
  app.use("/api", ownerUidIngestionRouter);
  app.use(express.json());
  app.use("/api", router);
  app.use("/api", platformRouter);
  app.use((e: any, _req: any, res: any, _next: any) => res.status(e.statusCode ?? 500).json({ error: e.message }));
  await new Promise<void>((resolve, reject) => { server = app.listen(0, "127.0.0.1", error => error ? reject(error) : resolve()); });
  base = `http://127.0.0.1:${(server.address() as any).port}/api`;
});
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
beforeEach(() => {
  Object.assign(state, { role: "PLATFORM_OWNER", binding: null, captures: [], reports: [], queries: [], ownerActive: true, card: null, fail: false,
    device: { id: 1, schoolId: null, deviceType: "NFC", status: "ACTIVE" } });
});
async function post(path: string, body: unknown, credential?: string) {
  const res = await fetch(`${base}${path}`, { method: "POST",
    headers: { "Content-Type": "application/json", ...(credential ? { Authorization: `Bearer ${credential}` } : {}) },
    body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() as any };
}
const scan = (overrides = {}) => ({ event_id: "read-1", device_id: "EDUCORE01", uid: "aabbccdd",
  timestamp: new Date().toISOString(), event_type: "CARD_SCAN", ...overrides });
const bind = () => post("/platform/devices/1/owner-reader", { reason: "Register inventory desk reader" });

describe("Owner UID-only reader lifecycle (mock persistence, no real events)", () => {
  it("binds to the current Owner without school assignment, stores only a credential hash", async () => {
    const r = await bind();
    expect(r.status).toBe(201);
    expect(state.binding.ownerUserId).toBe(77);
    expect(state.device.schoolId).toBeNull();
    expect(state.binding.secretHash).toBe(createHash("sha256").update(r.body.credential.split(".")[1]).digest("hex"));
    expect(JSON.stringify(state.binding)).not.toContain(r.body.credential);
  });
  it("accepts a UID report only into inventory, preserves duplicate identity, never dispatches attendance", async () => {
    const { body } = await bind(), event = scan();
    const first = await post("/v1/owner-reader/uid-events", event, body.credential);
    expect(first).toMatchObject({ status: 200, body: { uid: "AABBCCDD", rawUid: "aabbccdd",
      scanStatus: "UNKNOWN_UNASSIGNED", purpose: "UID_INVENTORY_ONLY", duplicate: false, duplicateUid: false } });
    expect(await post("/v1/owner-reader/uid-events", event, body.credential)).toMatchObject({ status: 200, body: { duplicate: true } });
    expect(state.captures).toHaveLength(1);
    expect(state.queries.join("\n")).not.toMatch(/attendance_events|attendance_notification|communication_|security_events/);
  });
  it.each([{ id: 8, student_id: 42 }, { id: 8, student_id: null }])("captures registered card %j without attendance validation", async card => {
    state.card = card;
    const { body } = await bind();
    expect(await post("/v1/owner-reader/uid-events", scan(), body.credential)).toMatchObject({
      status: 200, body: { uid: "AABBCCDD", duplicateUid: true, scanStatus: card.student_id ? "ASSIGNED" : "RESERVED" },
    });
    expect(state.queries.join("\n")).not.toMatch(/attendance_events|payments|subscriptions|access_decision|UPDATE nfc_cards|INSERT INTO nfc_cards/);
  });
  it("retains repeated raw UID results with one inventory row, distinguishing a new tap from a transport retry", async () => {
    const { body } = await bind();
    await post("/v1/owner-reader/uid-events", scan(), body.credential);
    const again = await post("/v1/owner-reader/uid-events", scan({ event_id: "read-2", uid: "AABBCCDD" }), body.credential);
    expect(again).toMatchObject({ status: 200, body: { uid: "AABBCCDD", rawUid: "AABBCCDD", duplicate: false, duplicateUid: true } });
    expect(state.captures).toHaveLength(2);
    const inventory = await (await fetch(`${base}/platform/uid-inventory`)).json() as any;
    expect(inventory.inventory).toHaveLength(1);
    expect(inventory.readers[0].lastScan.uid).toBe("AABBCCDD");
    expect(JSON.stringify(inventory)).not.toMatch(/credentialIdentifier|secretHash|fingerprint/);
  });
  it.each(["UNSUPPORTED_CARD", "READER_ERROR", "TRANSPORT_ERROR"])("reports %s without losing the previous UID or writing a card", async error_code => {
    const { body } = await bind();
    await post("/v1/owner-reader/uid-events", scan(), body.credential);
    expect(await post("/v1/owner-reader/uid-events", scan({
      event_id: "error-1", event_type: "CARD_SCAN_ERROR", uid: undefined, error_code,
    }), body.credential)).toMatchObject({ status: 200, body: { uid: null, scanStatus: error_code } });
    expect(state.captures).toHaveLength(1);
    expect(state.reports.at(-1).scanStatus).toBe(error_code);
    const inventory = await (await fetch(`${base}/platform/uid-inventory`)).json() as any;
    expect(inventory.readers[0].lastReport.scanStatus).toBe(error_code);
    expect(inventory.readers[0].lastScan.uid).toBe("AABBCCDD");
  });
  it("records a malformed authenticated scan separately, without accepting its UID", async () => {
    const { body } = await bind();
    expect(await post("/v1/owner-reader/uid-events", scan({ uid: "bad" }), body.credential))
      .toMatchObject({ status: 400, body: { code: "MALFORMED_SCAN" } });
    expect(state.reports[0].scanStatus).toBe("MALFORMED_SCAN");
    expect(state.captures).toHaveLength(0);
    expect(state.reports[0].uid).toBeUndefined();
  });
  it("authenticates before allowing malformed scan reports to affect reader status", async () => {
    await bind();
    expect((await post("/v1/owner-reader/uid-events", scan({ uid: "bad" }), "wrong.secret")).status).toBe(401);
    expect(state.reports).toHaveLength(0);
    expect(state.captures).toHaveLength(0);
  });
  it("requires a dedicated device credential and an active Owner link even for an unknown UID", async () => {
    expect((await post("/v1/owner-reader/uid-events", scan())).status).toBe(401);
    expect((await post("/v1/owner-reader/uid-events", scan(), "unlinked.secret")).status).toBe(401);
    expect(state.captures).toHaveLength(0);
  });
  it("accepts heartbeat and matching retries as connectivity evidence, never as cards", async () => {
    const { body } = await bind();
    const heartbeat = scan({ uid: undefined, event_type: "READER_HEARTBEAT" });
    expect(await post("/v1/owner-reader/uid-events", heartbeat, body.credential)).toMatchObject({
      status: 200, body: { scanStatus: "READY", uid: null },
    });
    expect(await post("/v1/owner-reader/uid-events", heartbeat, body.credential)).toMatchObject({
      status: 200, body: { duplicate: true },
    });
    expect(state.captures).toHaveLength(0);
    expect(state.reports).toHaveLength(1);
  });
  it("reports backend transport failure separately without capturing a UID", async () => {
    const { body } = await bind(); state.fail = true;
    expect(await post("/v1/owner-reader/uid-events", scan(), body.credential)).toMatchObject({
      status: 503, body: { code: "TRANSPORT_ERROR" },
    });
    expect(state.captures).toHaveLength(0);
  });
  it("all capture, heartbeat and error writes are limited to UID inventory audit receipts", async () => {
    const { body } = await bind();
    state.queries = [];
    for (const event of [scan(), scan({ event_id: "heartbeat", uid: undefined, event_type: "READER_HEARTBEAT" }),
      scan({ event_id: "unsupported", uid: undefined, event_type: "CARD_SCAN_ERROR", error_code: "UNSUPPORTED_CARD" }),
      scan({ event_id: "malformed", uid: "not-a-uid" })]) {
      await post("/v1/owner-reader/uid-events", event, body.credential);
    }
    const writes = state.queries.filter(sql => /^\s*(INSERT|UPDATE|DELETE|CALL)\b/i.test(sql));
    expect(writes).toHaveLength(4);
    for (const sql of writes) {
      expect(sql).toMatch(/INSERT INTO audit_logs/);
      expect(sql).toContain("'UIDInventory'");
    }
    expect(state.queries.join("\n")).not.toMatch(/attendance_events|payment|subscription|security_events|entry_exit|notification/);
  });
  it("rejects conflicting reuse of an event ID", async () => {
    const { body } = await bind(), event = scan();
    await post("/v1/owner-reader/uid-events", event, body.credential);
    expect((await post("/v1/owner-reader/uid-events", { ...event, uid: "11223344" }, body.credential)).status).toBe(409);
    expect(state.captures).toHaveLength(1);
  });
  it("requires explicit unlink before a school assignment and invalidates the old reader key", async () => {
    const { body } = await bind();
    await expect(assertNotOwnerReader(pool, 1)).rejects.toMatchObject({ statusCode: 409 });
    expect((await post("/platform/devices/1/owner-reader/unlink", { reason: "Deploy to school" })).status).toBe(200);
    await expect(assertNotOwnerReader(pool, 1)).resolves.toBeUndefined();
    expect((await post("/v1/owner-reader/uid-events", scan(), body.credential)).status).toBe(401);
  });
  it("blocks BOTH existing school assignment APIs while the device is Owner-bound", async () => {
    await bind();
    expect((await post("/platform/devices/1/assign", { schoolId: 5 })).status).toBe(409);
    const response = await fetch(`${base}/platform/devices/1`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ schoolId: 5 }),
    });
    expect(response.status).toBe(409);
    expect(state.device.schoolId).toBeNull();
    expect(state.queries.join("\n")).not.toContain("UPDATE platform_devices");
  });
  it("rejects school-bound hardware for Owner binding and rejects school-context reads", async () => {
    state.device.schoolId = 5;
    expect((await bind()).status).toBe(409);
    expect((await post("/v1/owner-reader/uid-events", scan(), "school.secret")).status).toBe(401);
    expect(state.captures).toHaveLength(0);
  });
  it.each(["SCHOOL_ADMIN", "TEACHER", "STAFF", "PARENT"])("denies %s control of Owner readers", async role => {
    state.role = role;
    expect((await bind()).status).toBe(403);
    expect((await fetch(`${base}/platform/uid-inventory`)).status).toBe(403);
  });
  it("rejects credentials for another device, mismatched IDs, deactivated hardware or revoked Owner authority", async () => {
    const { body } = await bind();
    expect((await post("/v1/owner-reader/uid-events", scan(), "wrong.secret")).status).toBe(401);
    expect((await post("/v1/owner-reader/uid-events", scan({ device_id: "EDUCORE02" }), body.credential)).status).toBe(401);
    state.ownerActive = false;
    expect((await post("/v1/owner-reader/uid-events", scan(), body.credential)).status).toBe(403);
    state.ownerActive = true; state.device.status = "SUSPENDED";
    expect((await post("/v1/owner-reader/uid-events", scan(), body.credential)).status).toBe(401);
  });
  it.each([{ school_id: "SCH01" }, { event_type: "SCHOOL_ENTRY" }, { attendance: true },
    { timestamp: new Date(Date.now() - 600_000).toISOString() }, { uid: "invented" },
    { event_type: "READER_HEARTBEAT" }, { error_code: "UNSUPPORTED_CARD" },
    { event_type: "CARD_SCAN_ERROR", uid: undefined }, { event_type: "CARD_SCAN_ERROR", uid: undefined, error_code: "STUDENT_NOT_FOUND" }])("rejects invalid/read-unrelated fields %j", change => {
    expect(() => parseOwnerUidEvent(scan(change))).toThrow();
  });
  it("requires a reason for unlink and prevents silent credential replacement", async () => {
    await bind();
    expect((await bind()).status).toBe(409);
    expect((await post("/platform/devices/1/owner-reader/unlink", {})).status).toBe(400);
    expect(state.binding.status).toBe("ACTIVE");
  });
});
describe("historical attendance card UID selection", () => {
  it.each(["e", "ae"] as const)("uses event card+school+student, never the replacement card (%s)", alias => {
    const sql = attendanceCardUidSql(alias);
    expect(sql).toContain(`c.id=${alias}.nfc_card_id`);
    expect(sql).toContain(`c.school_id=${alias}.school_id`);
    expect(sql).toContain(`c.student_id=${alias}.student_id`);
    expect(sql).toContain(`h.student_id=${alias}.student_id`);
    expect(sql).toContain(`h.created_at<=${alias}.occurred_at`);
    expect(sql).not.toMatch(/status='active'|replaced_by_card_id/);
  });
});
