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
        nfc_cards,audit_logs,attendance_events,payments,security_events;
      CREATE TABLE platform_devices(id int PRIMARY KEY,school_id int,device_type text,status text,serial_number text,name text);
      CREATE TABLE device_credentials(device_id int,status text,revoked_at timestamptz);
      CREATE TABLE app_users(id int PRIMARY KEY);
      CREATE TABLE school_memberships(user_id int,role text,status text,school_id int);
      CREATE TABLE nfc_cards(id serial PRIMARY KEY,uid text,school_id int,student_id int,status text);
      CREATE TABLE audit_logs(id serial PRIMARY KEY,"user" text,role text,actor_user_id int,action text,
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
});
