import express from "express";
import { Pool } from "pg";
import { createHash } from "node:crypto";
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";

const state = vi.hoisted(() => ({ db: null as any, role: "PLATFORM_OWNER", actor: 77, signedIn: true }));
vi.mock("@workspace/db", () => ({ pool: {
  query: (...args: any[]) => state.db.query(...args), connect: () => state.db.connect(),
} }));
vi.mock("../middlewares/auth", () => {
  class AuthError extends Error { constructor(public statusCode: number, message: string) { super(message); } }
  return {
    AuthError,
    requireAuthentication: () => (_req: any, _res: any, next: any) =>
      state.signedIn ? next() : next(new AuthError(401, "Sign in required")),
    assertRoles: () => { if (state.role !== "PLATFORM_OWNER") throw new AuthError(403, "Owner required"); },
    getUserContext: () => ({ user: { id: state.actor } }),
  };
});
import router from "./owner-hardware-correction";
import { previewHardwareCorrection, applyHardwareCorrection, PHYSICAL_SERIAL, HARDWARE_CORRECTION_ACTION } from "../services/owner-hardware-correction";
import { ownerReaderBinding, verifyOwnerReaderSecret } from "../services/owner-uid-reader";

const socket = process.env.OWNER_UID_TEST_SOCKET;
describe.skipIf(!socket)("Atomic Owner identity correction on disposable PostgreSQL", () => {
  let server: ReturnType<ReturnType<typeof express>["listen"]>, base = "";
  const identifier = `owner_uid_${"a".repeat(24)}`, secret = "fixture-only-secret";
  const keptTables = ["queued_terminal_events", "attendance_events", "device_assignment_history",
    "device_school_bindings", "nfc_cards", "payments", "uid_inventory_fixture"];
  beforeAll(async () => {
    if (!socket?.startsWith("/tmp/educore-owner-uid-") || process.env.REPLIT_DEPLOYMENT) throw Error("Disposable fixture only");
    state.db = new Pool({ host: socket, port: 55441, user: "owner_uid_fixture", database: "owner_hardware_fixture", max: 5 });
    const identity = (await state.db.query(`SELECT current_database() db,current_user name,
      inet_server_addr() address,current_setting('data_directory') directory`)).rows[0];
    if (identity.db !== "owner_hardware_fixture" || identity.name !== "owner_uid_fixture" ||
        identity.address !== null || identity.directory !== `${socket}/data`) throw Error("Wrong isolated database");
    // Repeatable only after independently verifying this disposable cluster.
    await state.db.query(`DROP TABLE IF EXISTS serial_reference_fixture,${keptTables.join(",")},
      device_credentials,audit_logs,school_memberships,app_users,platform_devices CASCADE`);
    await state.db.query(`
      CREATE TABLE platform_devices(id int PRIMARY KEY,serial_number text NOT NULL UNIQUE,
        name text,device_type text,status text,school_id int,school_class_id int,location text,
        configuration_status text,updated_at timestamptz DEFAULT now());
      CREATE TABLE device_credentials(id serial PRIMARY KEY,device_id int REFERENCES platform_devices(id),status text);
      CREATE TABLE audit_logs(id serial PRIMARY KEY,"user" text,role text,actor_user_id int,action text,
        module text,record_id int,event_type text,result text,metadata jsonb,"timestamp" timestamptz DEFAULT now());
      CREATE TABLE app_users(id int PRIMARY KEY);
      CREATE TABLE school_memberships(user_id int,role text,status text,school_id int);
    `);
    for (const table of keptTables) await state.db.query(`CREATE TABLE ${table}(id int PRIMARY KEY,
      device_id int REFERENCES platform_devices(id),payload text)`);
    const app = express();
    app.use(express.json()); app.use("/api", router);
    app.use((e: any, _req: any, res: any, _next: any) => res.status(e.statusCode ?? 500).json({ error: e.message }));
    await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as any).port}/api/platform/devices/owner-hardware-correction`;
  });
  afterAll(async () => {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    await state.db?.end();
  });
  beforeEach(async () => {
    state.role = "PLATFORM_OWNER"; state.actor = 77; state.signedIn = true;
    await state.db.query(`DROP TABLE IF EXISTS serial_reference_fixture;
      ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS reject_correction;
      TRUNCATE platform_devices,device_credentials,audit_logs,app_users,school_memberships,${keptTables.join(",")} CASCADE;
      INSERT INTO platform_devices(id,serial_number,name,device_type,status,school_id,school_class_id,location,configuration_status)
        VALUES(3,'DEVICE-1000','Kept reader','NFC','ACTIVE',null,null,'Owner desk','PENDING'),
              (4,'YET-584E10FFC9EC','Historical reader','NFC','ACTIVE',null,null,'History','PENDING');
      INSERT INTO app_users VALUES(77);
      INSERT INTO school_memberships VALUES(77,'PLATFORM_OWNER','ACTIVE',null);`);
    for (const [id, metadata] of [
      [3, { status: "ACTIVE", ownerUserId: 77, credentialIdentifier: identifier,
        secretHash: createHash("sha256").update(secret).digest("hex"), reason: "Original fixture binding" }],
      [4, { status: "RELEASED", ownerUserId: 77, reason: "Original fixture release" }],
    ] as const) await state.db.query(`INSERT INTO audit_logs(action,module,record_id,metadata)
      VALUES('Owner UID reader binding','Devices',$1,$2::jsonb)`, [id, JSON.stringify(metadata)]);
    for (const table of keptTables) await state.db.query(`INSERT INTO ${table} VALUES
      (1,3,'{"event_id":"retained-3","timestamp":"2026-11-02T08:00:00Z"}'),
      (2,4,'{"event_id":"retained-4","school_id":"SCH01"}')`);
  });
  const devices = async () => (await state.db.query("SELECT * FROM platform_devices ORDER BY id")).rows;
  const history = async () => (await state.db.query("SELECT * FROM audit_logs WHERE action='Owner UID reader binding' ORDER BY id")).rows;
  const input = async () => ({ fingerprint: (await previewHardwareCorrection(state.db, 77)).fingerprint,
    confirm: true as const, reason: "Approved exact physical identity correction" });
  const post = (data: unknown) => fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const receipts = async () => Object.fromEntries(await Promise.all(keptTables.map(async table =>
    [table, (await state.db.query(`SELECT * FROM ${table} ORDER BY id`)).rows])));

  it("read-only review exposes the exact mapping without keys or changing records", async () => {
    const before = await devices(), oldHistory = await history();
    const response = await fetch(base), result = await response.json() as any;
    expect(response.status).toBe(200);
    expect(result.after).toEqual([{ deviceId: 3, serialNumber: PHYSICAL_SERIAL, status: "ACTIVE" },
      { deviceId: 4, serialNumber: "", status: "INACTIVE" }]);
    expect(JSON.stringify(result)).not.toMatch(/secretHash|credentialIdentifier|fixture-only-secret/);
    expect(await devices()).toEqual(before); expect(await history()).toEqual(oldHistory);
  });
  it("atomically transfers the unique serial, preserves every other field, binding, key and all event references", async () => {
    const before = await devices(), oldHistory = await history(), retained = await receipts();
    verifyOwnerReaderSecret(`${identifier}.${secret}`, await ownerReaderBinding(state.db, 3));
    const response = await post(await input()), result = await response.json() as any;
    expect(response.status).toBe(200);
    expect(await devices()).toEqual([{ ...before[0], serial_number: PHYSICAL_SERIAL },
      { ...before[1], serial_number: "", status: "INACTIVE" }]);
    expect(await history()).toEqual(oldHistory); expect(await receipts()).toEqual(retained);
    verifyOwnerReaderSecret(`${identifier}.${secret}`, await ownerReaderBinding(state.db, 3));
    expect(await ownerReaderBinding(state.db, 4)).toBeNull();
    const audit = (await state.db.query("SELECT * FROM audit_logs WHERE id=$1", [result.auditId])).rows[0];
    expect(audit).toMatchObject({ actor_user_id: 77, role: "PLATFORM_OWNER", record_id: 3,
      action: HARDWARE_CORRECTION_ACTION, result: "SUCCESS", metadata: { before: result.before,
        after: result.after, credentialPreserved: true, wireDeviceIdUnchanged: "EDUCORE03" } });
    expect(JSON.stringify(audit.metadata)).not.toMatch(/secretHash|credentialIdentifier|fixture-only-secret/);
  });
  it("rolls both device writes back if the required audit insert fails", async () => {
    const data = await input(), before = await devices(), retained = await receipts();
    await state.db.query(`ALTER TABLE audit_logs ADD CONSTRAINT reject_correction CHECK(action<>'Corrected Owner reader hardware identity')`);
    await expect(applyHardwareCorrection(state.db, 77, data)).rejects.toThrow();
    expect(await devices()).toEqual(before); expect(await receipts()).toEqual(retained);
    expect((await state.db.query("SELECT count(*)::int n FROM audit_logs")).rows[0].n).toBe(2);
  });
  it("rejects an occupied blank serial without disturbing uniqueness or either record", async () => {
    await state.db.query(`INSERT INTO platform_devices(id,serial_number) VALUES(5,'')`);
    const before = await devices();
    await expect(input()).rejects.toThrow("blank serial");
    expect(await devices()).toEqual(before);
  });
  it("rejects stale review after an unrelated device edit", async () => {
    const data = await input();
    await state.db.query("UPDATE platform_devices SET name='Concurrent legitimate edit' WHERE id=3");
    const before = await devices();
    await expect(applyHardwareCorrection(state.db, 77, data)).rejects.toThrow("stale");
    expect(await devices()).toEqual(before);
  });
  it("does not apply the same reviewed correction twice under concurrency", async () => {
    const data = await input();
    const result = await Promise.allSettled([applyHardwareCorrection(state.db, 77, data),
      applyHardwareCorrection(state.db, 77, data)]);
    expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((await state.db.query("SELECT count(*)::int n FROM audit_logs WHERE action=$1", [HARDWARE_CORRECTION_ACTION])).rows[0].n).toBe(1);
  });
  it.each(["SCHOOL_ADMIN", "TEACHER", "PARTNER", "STUDENT"])("denies %s before any write", async role => {
    const data = await input(), before = await devices(); state.role = role;
    expect((await post(data)).status).toBe(403); expect((await fetch(base)).status).toBe(403);
    expect(await devices()).toEqual(before);
  });
  it("denies anonymous requests and a different platform Owner", async () => {
    const data = await input(); state.signedIn = false;
    expect((await post(data)).status).toBe(401);
    state.signedIn = true; state.actor = 88;
    expect((await post(data)).status).toBe(403);
  });
  it("requires explicit confirmation, reason, a current token and no extra mutation fields", async () => {
    const data = await input(), before = await devices();
    for (const bad of [{ ...data, confirm: false }, { ...data, reason: " " },
      { ...data, fingerprint: "old" }, { ...data, schoolId: 5 }]) expect((await post(bad)).status).toBe(400);
    expect(await devices()).toEqual(before);
  });
  it("blocks a new binding/credential after review", async () => {
    const data = await input();
    await state.db.query(`UPDATE audit_logs SET metadata=jsonb_set(metadata,'{credentialIdentifier}',$1::jsonb)
      WHERE record_id=3`, [JSON.stringify(`owner_uid_${"b".repeat(24)}`)]);
    await expect(applyHardwareCorrection(state.db, 77, data)).rejects.toThrow("stale");
  });
  it("blocks school assignments, source reactivation and active school keys", async () => {
    await state.db.query("UPDATE platform_devices SET school_id=5 WHERE id=3");
    await expect(input()).rejects.toThrow("assignment");
    await state.db.query("UPDATE platform_devices SET school_id=null WHERE id=3");
    await state.db.query(`UPDATE audit_logs SET metadata=jsonb_set(metadata,'{status}','"ACTIVE"') WHERE record_id=4`);
    await expect(input()).rejects.toThrow("assignment");
    await state.db.query(`UPDATE audit_logs SET metadata=jsonb_set(metadata,'{status}','"RELEASED"') WHERE record_id=4`);
    await state.db.query("INSERT INTO device_credentials(device_id,status) VALUES(4,'ACTIVE')");
    await expect(input()).rejects.toThrow("school credentials");
  });
  it("blocks serial-linked foreign keys instead of cascading identity changes", async () => {
    await state.db.query("CREATE TABLE serial_reference_fixture(serial text REFERENCES platform_devices(serial_number))");
    await expect(input()).rejects.toThrow("Unreviewed serial");
  });
});
