import express from "express";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "PLATFORM_OWNER", device: { id: 1, schoolId: null as number | null, deviceType: "NFC", status: "ACTIVE" },
  binding: null as any, captures: [] as any[], queries: [] as string[], ownerActive: true,
}));
vi.mock("@workspace/db", () => {
  const query = vi.fn(async (sql: string, values: any[] = []) => {
    state.queries.push(sql);
    const rows = (rows: any[] = []) => ({ rows, rowCount: rows.length });
    if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return rows();
    if (sql.includes("FROM platform_devices WHERE id=")) return rows(values[0] === state.device.id ? [{ ...state.device }] : []);
    if (sql.includes("SELECT metadata FROM audit_logs WHERE module='Devices'")) return rows(state.binding ? [{ metadata: state.binding }] : []);
    if (sql.includes("JOIN app_users")) return rows(state.ownerActive ? [{}] : []);
    if (sql.includes("SELECT metadata FROM audit_logs WHERE module='UIDInventory'")) return rows(state.captures
      .filter(c => c.deviceId === values[1] && c.eventId === values[2] && c.credentialIdentifier === values[3]).map(metadata => ({ metadata })));
    if (sql.includes("UPDATE device_credentials SET status='REVOKED'")) return rows();
    if (sql.includes("INSERT INTO audit_logs") && sql.includes("'Devices'")) { state.binding = JSON.parse(values[3]); return rows(); }
    if (sql.includes("INSERT INTO audit_logs") && sql.includes("'UIDInventory'")) {
      state.captures.push({ ...JSON.parse(values[3]), deviceId: values[2] }); return rows();
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
  Object.assign(state, { role: "PLATFORM_OWNER", binding: null, captures: [], queries: [], ownerActive: true,
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
    expect(first).toMatchObject({ status: 200, body: { uid: "AABBCCDD", purpose: "UID_INVENTORY_ONLY", duplicate: false } });
    expect(await post("/v1/owner-reader/uid-events", event, body.credential)).toMatchObject({ status: 200, body: { duplicate: true } });
    expect(state.captures).toHaveLength(1);
    expect(state.queries.join("\n")).not.toMatch(/attendance_events|attendance_notification|communication_|security_events/);
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
    { timestamp: new Date(Date.now() - 600_000).toISOString() }, { uid: "invented" }])("rejects invalid/read-unrelated fields %j", change => {
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
