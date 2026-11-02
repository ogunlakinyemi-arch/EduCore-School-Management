import express from "express";
import { Pool } from "pg";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("@workspace/db", () => ({ pool: {
  query: (...args: any[]) => state.db.query(...args),
  connect: () => state.db.connect(),
} }));
vi.mock("../middlewares/auth", () => {
  class AuthError extends Error { constructor(public statusCode: number, message: string) { super(message); } }
  return { AuthError, requireAuthentication: () => (_req: any, _res: any, next: any) => next(),
    getUserContext: () => ({ user: { id: 77 } }), assertRoles: () => undefined };
});
import router, { ownerUidIngestionRouter } from "./owner-uid-reader";
import { OwnerReaderProtocolHarness } from "../test/owner-reader-protocol-harness";
import { ownerCredentialVersion, ownerReaderConfiguration } from "../services/owner-uid-reader";

const socket = process.env.OWNER_UID_TEST_SOCKET;
// Opt-in only: never consume application connection strings or a shared database.
describe.skipIf(!socket)("Owner capture SQL on disposable PostgreSQL", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]>, base = "";
  const credential = "fixture_owner_reader.fixture-only-secret";
  beforeAll(async () => {
    if (!socket?.startsWith("/tmp/educore-owner-uid-") || process.env.REPLIT_DEPLOYMENT) {
      throw Error("Refusing non-disposable Owner UID database");
    }
    state.db = new Pool({ host: socket, port: 55441, user: "owner_uid_fixture", database: "owner_uid_fixture", max: 5 });
    const identity = (await state.db.query(`SELECT current_database() db,current_user name,
      inet_server_addr() address,current_setting('data_directory') directory`)).rows[0];
    if (identity.db !== "owner_uid_fixture" || identity.name !== "owner_uid_fixture" ||
        identity.address !== null || identity.directory !== `${socket}/data`) {
      throw Error("Wrong disposable database identity");
    }
    await state.db.query(`
      DROP TABLE IF EXISTS platform_devices,device_credentials,app_users,school_memberships,
        nfc_cards,audit_logs,attendance_events,payments,security_events,schools;
      CREATE TABLE schools(id int PRIMARY KEY,name text);
      CREATE TABLE platform_devices(id int PRIMARY KEY,school_id int,device_type text,status text,serial_number text,name text);
      CREATE TABLE device_credentials(device_id int,status text,revoked_at timestamptz);
      CREATE TABLE app_users(id int PRIMARY KEY);
      CREATE TABLE school_memberships(user_id int,role text,status text,school_id int);
      CREATE TABLE nfc_cards(id serial PRIMARY KEY,uid text,school_id int,student_id int,status text);
      CREATE TABLE audit_logs(id serial PRIMARY KEY,"user" text,role text,actor_user_id int,school_id int,action text,
        module text,record_id int,event_type text,result text,metadata jsonb,"timestamp" timestamptz DEFAULT now());
      CREATE TABLE attendance_events(id serial PRIMARY KEY);
      CREATE TABLE payments(id serial PRIMARY KEY);
      CREATE TABLE security_events(id serial PRIMARY KEY);
      INSERT INTO app_users VALUES(77);
      INSERT INTO school_memberships VALUES(77,'PLATFORM_OWNER','ACTIVE',null);
      INSERT INTO platform_devices VALUES(1,null,'NFC','ACTIVE','fixture-1','Reader one'),
        (2,null,'HYBRID','ACTIVE','fixture-2','Reader two');
    `);
    const app = express();
    app.use("/api", ownerUidIngestionRouter);
    app.use(express.json());
    app.use("/api", router);
    app.use((e: any, _req: any, res: any, _next: any) => res.status(e.statusCode ?? 500).json({ error: e.message }));
    await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  });
  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    await state.db?.end();
  });
  beforeEach(async () => {
    await state.db.query("TRUNCATE audit_logs,nfc_cards");
    for (const id of [1, 2]) {
      await state.db.query(`INSERT INTO audit_logs(action,module,record_id,metadata)
        VALUES('Owner UID reader binding','Devices',$1,$2::jsonb)`, [id, JSON.stringify({
        status: "ACTIVE", ownerUserId: 77, credentialIdentifier: "fixture_owner_reader",
        secretHash: createHash("sha256").update("fixture-only-secret").digest("hex"),
      })]);
    }
  });
  const scan = (extra = {}) => ({ event_id: "scan-1", device_id: 1, uid: "aabbccdd",
    timestamp: new Date().toISOString(), event_type: "CARD_SCAN", ...extra });
  async function send(event: unknown, key = credential) {
    const response = await fetch(`${base}/v1/owner-reader/uid-events`, { method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify(event) });
    return { status: response.status, body: await response.json() as any };
  }
  async function inventory() {
    return await (await fetch(`${base}/platform/uid-inventory`)).json() as any;
  }
  it("captures an unknown raw UID and returns it from the Owner list with no student/card creation", async () => {
    expect(await send(scan())).toMatchObject({ status: 200,
      body: { uid: "AABBCCDD", rawUid: "aabbccdd", scanStatus: "UNKNOWN_UNASSIGNED", duplicateUid: false } });
    const data = await inventory();
    expect(data.inventory).toHaveLength(1);
    expect(data.inventory[0]).toMatchObject({ uid: "AABBCCDD", assigned: false, studentId: null });
    expect(data.readers[0].lastScan.rawUid).toBe("aabbccdd");
    expect(JSON.stringify(data)).not.toMatch(/secretHash|credentialIdentifier|fingerprint/);
    expect((await state.db.query("SELECT count(*) FROM nfc_cards")).rows[0].count).toBe("0");
  });
  it("captures an assigned revoked card without activating it or performing attendance checks", async () => {
    await state.db.query("INSERT INTO nfc_cards(uid,school_id,student_id,status) VALUES('AABBCCDD',5,9,'revoked')");
    expect(await send(scan())).toMatchObject({ status: 200, body: { uid: "AABBCCDD", scanStatus: "ASSIGNED", duplicateUid: true } });
    expect((await state.db.query("SELECT status FROM nfc_cards")).rows[0].status).toBe("revoked");
  });
  it("serializes simultaneous readers, preserves both tap results and deduplicates inventory", async () => {
    const results = await Promise.all([send(scan()), send(scan({ device_id: 2 }))]);
    expect(results.map(r => r.status)).toEqual([200, 200]);
    expect(results.map(r => r.body.duplicateUid).sort()).toEqual([false, true]);
    expect(results.every(r => r.body.rawUid === "aabbccdd")).toBe(true);
    expect((await inventory()).inventory).toHaveLength(1);
  });
  it("serializes identical transport retries and rejects changed event identity", async () => {
    const event = scan();
    const results = await Promise.all([send(event), send(event)]);
    expect(results.map(r => r.body.duplicate).sort()).toEqual([false, true]);
    expect((await state.db.query("SELECT count(*) FROM audit_logs WHERE module='UIDInventory'")).rows[0].count).toBe("1");
    expect((await send({ ...event, uid: "11223344" })).status).toBe(409);
  });
  it("keeps the last successful UID while reporting malformed and unsupported scans separately", async () => {
    await send(scan());
    expect((await send(scan({ event_id: "bad", uid: "invalid" }))).status).toBe(400);
    expect((await inventory()).readers[0].lastReport.scanStatus).toBe("MALFORMED_SCAN");
    await send(scan({ event_id: "unsupported", uid: undefined, event_type: "CARD_SCAN_ERROR", error_code: "UNSUPPORTED_CARD" }));
    const data = await inventory();
    expect(data.readers[0].lastReport.scanStatus).toBe("UNSUPPORTED_CARD");
    expect(data.readers[0].lastScan.uid).toBe("AABBCCDD");
    expect(data.inventory).toHaveLength(1);
    await send(scan({ event_id: "after-error-heartbeat", uid: undefined, event_type: "READER_HEARTBEAT" }));
    const afterHeartbeat = await inventory();
    expect(afterHeartbeat.readers[0].lastReport.scanStatus).toBe("READY");
    expect(afterHeartbeat.readers[0].lastFailure.scanStatus).toBe("UNSUPPORTED_CARD");
    expect(afterHeartbeat.readers[0].lastFailureAt).toBeTruthy();
  });
  it("heartbeat establishes connectivity but never populates UID inventory", async () => {
    expect((await send(scan({ uid: undefined, event_type: "READER_HEARTBEAT" }))).status).toBe(200);
    const data = await inventory();
    expect(data.inventory).toHaveLength(0);
    expect(data.readers[0].lastSeenAt).toBeTruthy();
    expect(data.readers[0].lastReadAt).toBeNull();
  });
  it("a fresh binding does not borrow old-key connectivity or lose retained inventory", async () => {
    await send(scan());
    const metadata = (await state.db.query(`SELECT metadata FROM audit_logs
      WHERE action='Owner UID reader binding' AND record_id=1 ORDER BY id DESC LIMIT 1`)).rows[0].metadata;
    await state.db.query(`INSERT INTO audit_logs(action,module,record_id,metadata)
      VALUES('Owner UID reader binding','Devices',1,$1::jsonb)`,
    [JSON.stringify({ ...metadata, credentialIdentifier: "new-fixture-reader" })]);
    const data = await inventory();
    expect(data.readers[0]).toMatchObject({ lastSeenAt: null, lastReadAt: null, lastScan: null });
    expect(data.inventory).toHaveLength(1);
    expect((await send(scan())).status).toBe(401);
  });
  it("rejects untrusted and released readers without capture, and keeps all non-capture tables empty", async () => {
    expect((await send(scan(), "wrong.secret")).status).toBe(401);
    await state.db.query(`INSERT INTO audit_logs(action,module,record_id,metadata)
      VALUES('Owner UID reader binding','Devices',1,'{"status":"RELEASED"}')`);
    expect((await send(scan())).status).toBe(401);
    expect((await inventory()).inventory).toHaveLength(0);
    for (const table of ["attendance_events", "payments", "security_events"]) {
      expect((await state.db.query(`SELECT count(*) FROM ${table}`)).rows[0].count).toBe("0");
    }
  });
  it("successful scans and hardware errors do not create attendance, security or payment events", async () => {
    await send(scan());
    await send(scan({ event_id: "hardware-error", uid: undefined, event_type: "CARD_SCAN_ERROR", error_code: "READER_ERROR" }));
    for (const table of ["attendance_events", "payments", "security_events"]) {
      expect((await state.db.query(`SELECT count(*) FROM ${table}`)).rows[0].count).toBe("0");
    }
  });
  it("reproduces HTTP 401 retained, provisions this exact linked device, and delivers heartbeat then raw scan", async () => {
    const original = (await inventory()).readers.find((r: any) => r.deviceId === 1);
    const configuration = ownerReaderConfiguration(1);
    const terminal = new OwnerReaderProtocolHarness(base.replace(/\/api$/, ''), configuration, "school-key.wrong-secret");
    terminal.enqueue("retained-heartbeat", "READER_HEARTBEAT");
    const retained = terminal.retainedEvent();
    expect((await terminal.deliver()).status).toBe(401);
    expect(terminal.retainedEvent()).toEqual(retained);
    const rotation = await fetch(`${base}/platform/devices/1/owner-reader/credential`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        reason: "Fixture 401 repair", confirm: true, expectedCredentialVersion: original.credentialVersion,
      }),
    });
    expect(rotation.status).toBe(200);
    const provisioned = await rotation.json() as any;
    expect(provisioned.configuration).toEqual(configuration);
    terminal.loadCredential(provisioned.credential);
    expect(await terminal.deliver()).toMatchObject({ status: 200, body: { scanStatus: "READY" } });
    terminal.enqueue("physical-scan-fixture", "CARD_SCAN", "04a1b2c3d4e5f6");
    expect(await terminal.deliver()).toMatchObject({ status: 200, body: {
      uid: "04A1B2C3D4E5F6", rawUid: "04a1b2c3d4e5f6", scanStatus: "UNKNOWN_UNASSIGNED",
    } });
    const data = await inventory();
    expect(data.inventory[0]).toMatchObject({ uid: "04A1B2C3D4E5F6", rawUid: "04a1b2c3d4e5f6",
      readerDeviceId: 1, deviceName: "Reader one", scanCount: 1, assigned: false });
    expect(data.inventory[0].firstSeenAt).toBeTruthy();
    expect(data.inventory[0].lastSeenAt).toBeTruthy();
    expect(data.readers[0].lastScan.uid).toBe("04A1B2C3D4E5F6");
    expect((await send(scan(), credential)).status).toBe(401);
    expect((await send(scan({ device_id: 2 }), provisioned.credential)).status).toBe(401);
    for (const table of ["attendance_events", "payments", "security_events", "nfc_cards"]) {
      expect((await state.db.query(`SELECT count(*) FROM ${table}`)).rows[0].count).toBe("0");
    }
  });
  it("inventory is searchable and paginated across every capture, with first/last seen and safe duplicate counts", async () => {
    await send(scan({ uid: "11223344" }));
    await send(scan({ event_id: "second-uid", uid: "AABBCCDD" }));
    const repeat = scan({ event_id: "repeat", uid: "aabbccdd" });
    await send(repeat); await send(repeat);
    const read = async (query: string) => (await fetch(`${base}/platform/uid-inventory?${query}`)).json() as any;
    const all = await read("pageSize=1");
    expect(all.total).toBe(2); expect(all.inventory).toHaveLength(1);
    expect((await read("pageSize=1&page=2")).inventory).toHaveLength(1);
    expect((await read("pageSize=1&page=3")).total).toBe(2);
    const duplicates = await read("status=DUPLICATE&q=aabb");
    expect(duplicates.total).toBe(1);
    expect(duplicates.inventory[0]).toMatchObject({ uid: "AABBCCDD", scanCount: 2, duplicate: true, captureStatus: "UNKNOWN_UNASSIGNED" });
    expect((await read("q=fixture-1&deviceId=1")).total).toBe(2);
    expect((await read("q=%25")).total).toBe(0);
    expect((await read("status=ASSIGNED")).total).toBe(0);
  });
  it("new Owner provisioning returns the exact endpoint and key, and school key/incorrect scheme cannot authenticate", async () => {
    await state.db.query("TRUNCATE audit_logs");
    const response = await fetch(`${base}/platform/devices/1/owner-reader`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason: "Fixture Owner provisioning" }),
    });
    expect(response.status).toBe(201);
    const provisioned = await response.json() as any;
    const binding = (await state.db.query("SELECT metadata FROM audit_logs ORDER BY id DESC LIMIT 1")).rows[0].metadata;
    expect(provisioned.credentialVersion).toBe(ownerCredentialVersion(binding));
    expect((await send(scan(), provisioned.credential)).status).toBe(200);
    const wrongScheme = await fetch(`${base}/v1/owner-reader/uid-events`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Basic ${provisioned.credential}` }, body: JSON.stringify(scan()),
    });
    expect(wrongScheme.status).toBe(401);
    expect((await send(scan(), credential)).status).toBe(401);
  });
  it("concurrent rotation cannot silently replace a newly issued Owner key", async () => {
    const original = (await inventory()).readers.find((r: any) => r.deviceId === 1);
    const rotate = async () => {
      const response = await fetch(`${base}/platform/devices/1/owner-reader/credential`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          reason: "Concurrent fixture provisioning", confirm: true, expectedCredentialVersion: original.credentialVersion,
        }),
      });
      return { status: response.status, body: await response.json() as any };
    };
    const results = await Promise.all([rotate(), rotate()]);
    expect(results.map(r => r.status).sort()).toEqual([200, 409]);
    const issued = results.find(r => r.status === 200)!;
    expect((await send(scan(), issued.body.credential)).status).toBe(200);
    expect((await send(scan(), credential)).status).toBe(401);
  });
});
