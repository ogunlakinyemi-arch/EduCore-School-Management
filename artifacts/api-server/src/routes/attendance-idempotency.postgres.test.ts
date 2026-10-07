import express from "express";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { userInfo } from "node:os";
import type { Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Only the authorization services outside ingestion are stubbed. Authentication,
// card resolution, device transaction locks, dedupe lookup, suppression, and
// insertion run against real PostgreSQL, never the application's database.
const harness = vi.hoisted(() => ({
  pg: null as any,
  notificationWrites: 0,
  subscription: vi.fn(),
  security: vi.fn(async () => true),
  denial: vi.fn(),
}));

vi.mock("../services/subscription-enforcement", () => ({
  assertSubscriptionAccess: harness.subscription,
}));
vi.mock("../services/security-attendance-integration", () => ({
  joinSecurityAttendance: harness.security,
  recordAuthenticatedNfcDenial: harness.denial,
}));
vi.mock("@workspace/db", () => ({
  pool: {
    query: (text: string, values?: unknown[]) => harness.pg.query(text, values),
    connect: async () => {
      const client = await harness.pg.connect();
      return {
        query: async (text: string, values?: unknown[]) => {
          if (text.includes("FROM students st") && text.includes("LEFT JOIN LATERAL")) {
            return { rows: [{
              studentId: values?.[1], studentName: "Development Fixture",
              className: "Fixture Class", section: "A", academicSession: "Fixture Session", term: "Fixture Term",
            }] };
          }
          if (text.startsWith("WITH missing AS")) return { rows: [] };
          if (text.includes("INSERT INTO attendance_notification_events")) {
            harness.notificationWrites++;
            return { rows: [] };
          }
          return client.query(text, values);
        },
        release: () => client.release(),
      };
    },
  },
}));

import attendanceRouter from "./attendance";
import { AuthError } from "../middlewares/auth";

const socket = process.env.NFC_IDEMPOTENCY_PG_SOCKET;
describe.skipIf(!socket)("device attendance idempotency — disposable PostgreSQL", () => {
  let server: Server;
  let baseUrl: string;
  let timestamp: string;

  beforeAll(async () => {
    if (!socket?.startsWith("/tmp/nfc-idempotency.")) {
      throw new Error("Refusing attendance writes outside a disposable local PostgreSQL cluster");
    }
    const { Pool } = createRequire(new URL("../../../../lib/db/package.json", import.meta.url))("pg");
    harness.pg = new Pool({ host: socket, database: "nfc_idempotency_test", user: userInfo().username, max: 16 });
    const check = await harness.pg.query(
      `SELECT current_database() AS name,inet_server_addr() AS tcp,
              current_setting('data_directory') AS data,
              current_setting('unix_socket_directories') AS sockets`,
    );
    expect(check.rows[0]).toEqual({
      name: "nfc_idempotency_test", tcp: null, data: `${socket}/data`, sockets: socket,
    });
    await harness.pg.query(`
      CREATE TABLE platform_devices (
        id integer PRIMARY KEY,school_id integer,status text,configuration_status text,
        device_type text,last_seen_at timestamptz,school_class_id integer
      );
      CREATE TABLE device_credentials (
        id integer PRIMARY KEY,device_id integer,school_id integer,credential_identifier text,
        secret_hash text,status text,expires_at timestamptz,last_used_at timestamptz
      );
      CREATE TABLE students (id integer PRIMARY KEY,school_id integer,status text);
      CREATE TABLE nfc_cards (id integer PRIMARY KEY,school_id integer,student_id integer,uid text,status text);
      CREATE TABLE student_identification_policies (school_id integer,student_id integer,status text,policy text);
      CREATE TABLE attendance_settings (school_id integer,duplicate_suppression_seconds integer);
      CREATE TABLE student_class_assignments (
        id integer,school_id integer,student_id integer,school_class_id integer,section text,
        created_at timestamptz,start_date date,end_date date
      );
      CREATE TABLE biometric_enrollments (
        id integer,school_id integer,student_id integer,provider text,provider_reference text,status text,device_id integer
      );
      CREATE TABLE attendance_events (
        id serial PRIMARY KEY,school_id integer NOT NULL,student_id integer,device_id integer,nfc_card_id integer,
        school_class_id integer,identification_method text,event_type text,result text,
        attendance_status text,event_date date,occurred_at timestamptz,dedupe_key text NOT NULL,
        section_snapshot text,failure_reason text,created_at timestamptz DEFAULT now(),
        UNIQUE(school_id,dedupe_key)
      );
    `);
    const app = express();
    app.use(express.json());
    app.use("/api", attendanceRouter);
    app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (error instanceof AuthError) return res.status(error.statusCode).json({ error: error.message, code: error.eventType });
      return res.status(500).json({ error: "Unexpected test error", detail: String(error) });
    });
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test port");
    baseUrl = `http://127.0.0.1:${address.port}/api/device/attendance/events`;
  });

  beforeEach(async () => {
    harness.notificationWrites = 0;
    harness.subscription.mockReset();
    harness.security.mockReset().mockResolvedValue(true);
    harness.denial.mockReset();
    timestamp = new Date(Date.now() - 60_000).toISOString();
    // The guarded database is a new private cluster. No live fixture is touched.
    await harness.pg.query(`
      TRUNCATE attendance_events,device_credentials,platform_devices,students,nfc_cards,
               student_identification_policies,attendance_settings,student_class_assignments,
               biometric_enrollments RESTART IDENTITY;
      INSERT INTO platform_devices VALUES
        (101,10,'ACTIVE','CONFIGURED','NFC',NULL,NULL),
        (102,10,'ACTIVE','CONFIGURED','HYBRID',NULL,NULL),
        (201,20,'ACTIVE','CONFIGURED','NFC',NULL,NULL);
      INSERT INTO students VALUES (501,10,'ACTIVE'),(502,10,'ACTIVE'),(601,20,'ACTIVE');
      INSERT INTO nfc_cards VALUES
        (701,10,501,'UID-A','ACTIVE'),(702,10,502,'UID-A2','ACTIVE'),(801,20,601,'UID-B','ACTIVE');
      INSERT INTO attendance_settings VALUES (10,30),(20,30);
      INSERT INTO biometric_enrollments VALUES (1,10,501,'fixture','fixture-match','ACTIVE',NULL);
    `);
    const hash = createHash("sha256").update("fixture-secret").digest("hex");
    await harness.pg.query(
      `INSERT INTO device_credentials(id,device_id,school_id,credential_identifier,secret_hash,status)
       VALUES (1,101,10,'fixture-a',$1,'ACTIVE'),(2,102,10,'fixture-a2',$1,'ACTIVE'),(3,201,20,'fixture-b',$1,'ACTIVE')`,
      [hash],
    );
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await harness.pg?.end();
  });

  const event = (overrides: Record<string, unknown> = {}) => ({
    eventType: "SCHOOL_ENTRY", identificationMethod: "NFC", nfcUid: "UID-A",
    occurredAt: timestamp, idempotencyKey: "fixture-key-0001", ...overrides,
  });
  const send = async (body = event(), identifier = "fixture-a") => {
    const response = await fetch(baseUrl, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Device-Credential": `${identifier}.fixture-secret` },
      body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() as Record<string, any> };
  };
  const rows = async () => (await harness.pg.query("SELECT * FROM attendance_events ORDER BY id")).rows;

  it("commits the first submission with the existing receipt and a hashed key", async () => {
    const first = await send();
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ studentId: 501, deviceId: 101, schoolId: 10, result: "ACCEPTED", status: "PRESENT" });
    const saved = await rows();
    expect(saved).toHaveLength(1);
    expect(saved[0].dedupe_key).toMatch(/^device-idempotency:v1:[0-9a-f]{64}$/);
    expect(saved[0].dedupe_key).not.toContain("fixture-key");
  });

  it("returns an identical retry as 200 with the original event ID and no repeated notification", async () => {
    const first = await send();
    const retry = await send();
    expect([first.status, retry.status]).toEqual([201, 200]);
    expect(retry.body).toEqual(first.body);
    expect(retry.body).not.toHaveProperty("nfcCardId");
    expect(await rows()).toHaveLength(1);
    expect(harness.notificationWrites).toBe(1);
    expect(harness.subscription).toHaveBeenCalledTimes(2);
    expect(harness.security).toHaveBeenCalledTimes(2);
    expect(harness.security).toHaveBeenLastCalledWith(expect.anything(), first.body.id, true);
  });

  it("serializes concurrent submissions: one creation and nine replays", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => send()));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 200)).toHaveLength(9);
    expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    expect(await rows()).toHaveLength(1);
    expect(harness.notificationWrites).toBe(1);
  });

  it("rejects conflicting key reuse, including simultaneous different students", async () => {
    const results = await Promise.all([send(), send(event({ nfcUid: "UID-A2" }))]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)?.body.code).toBe("ATTENDANCE_IDEMPOTENCY_CONFLICT");
    expect(await rows()).toHaveLength(1);
  });

  it("rejects a changed timestamp without overwriting the original event", async () => {
    const original = await send();
    const changed = await send(event({ occurredAt: new Date(Date.parse(timestamp) + 60_000).toISOString() }));
    expect(changed.status).toBe(409);
    expect(changed.body.code).toBe("ATTENDANCE_IDEMPOTENCY_CONFLICT");
    expect((await send()).body.id).toBe(original.body.id);
    expect(await rows()).toHaveLength(1);
  });

  it("preserves suppression for different keys and does not consume a suppressed key", async () => {
    expect((await send()).status).toBe(201);
    const secondKey = "fixture-key-0002";
    const suppressed = await send(event({ idempotencyKey: secondKey }));
    expect(suppressed).toEqual({ status: 409, body: { error: "Duplicate event" } });
    const later = await send(event({
      idempotencyKey: secondKey, occurredAt: new Date(Date.parse(timestamp) + 60_000).toISOString(),
    }));
    expect(later.status).toBe(201);
    expect(await rows()).toHaveLength(2);
  });

  it("preserves rolling suppression for concurrent different keys", async () => {
    const results = await Promise.all([send(), send(event({ idempotencyKey: "fixture-key-0002" }))]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await rows()).toHaveLength(1);
  });

  it("keeps the same key independent across two eligible devices in one school", async () => {
    const [a, b] = await Promise.all([send(), send(event(), "fixture-a2")]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.id).not.toBe(b.body.id);
    expect((await send()).body.id).toBe(a.body.id);
    expect((await send(event(), "fixture-a2")).body.id).toBe(b.body.id);
    expect(await rows()).toHaveLength(2);
  });

  it("does not leak or replay another school's event for the same key", async () => {
    const first = await send();
    const wrongSchool = await send(event({ nfcUid: "UID-B" }));
    expect(wrongSchool.status).toBe(403);
    const other = await send(event({ nfcUid: "UID-B" }), "fixture-b");
    expect(other.status).toBe(201);
    expect(other.body).toMatchObject({ schoolId: 20, studentId: 601, deviceId: 201 });
    expect(other.body.id).not.toBe(first.body.id);
    expect(await rows()).toHaveLength(2);
  });

  it("does not replay after card deactivation, credential revocation, or asserted device mismatch", async () => {
    await send();
    expect((await send(event({ deviceId: 102 }))).status).toBe(403);
    await harness.pg.query("UPDATE nfc_cards SET status='inactive' WHERE id=701");
    expect((await send()).status).toBe(403);
    await harness.pg.query("UPDATE nfc_cards SET status='ACTIVE' WHERE id=701");
    await harness.pg.query("UPDATE device_credentials SET status='REVOKED' WHERE id=1");
    expect((await send()).status).toBe(401);
    expect(await rows()).toHaveLength(1);
  });

  it("does not bypass subscription or security authorization on a replay", async () => {
    await send();
    harness.subscription.mockRejectedValueOnce(new AuthError(403, "Fixture subscription restriction", "SUBSCRIPTION_REQUIRED"));
    expect((await send()).body.code).toBe("SUBSCRIPTION_REQUIRED");
    harness.security.mockRejectedValueOnce(new AuthError(403, "Fixture security rejection"));
    expect((await send()).status).toBe(403);
    expect(await rows()).toHaveLength(1);
    expect(harness.notificationWrites).toBe(1);
  });

  it("also replays provider-authorized fingerprint events on the existing handler", async () => {
    await harness.pg.query(
      "INSERT INTO student_identification_policies VALUES (10,501,'ACTIVE','NFC_AND_BIOMETRIC')",
    );
    const body = event({
      identificationMethod: "FINGERPRINT", studentId: 501, nfcUid: undefined,
      provider: "fixture", providerReference: "fixture-match", matchResult: "MATCH",
    });
    const first = await send(body);
    const retry = await send(body);
    expect([first.status, retry.status]).toEqual([201, 200]);
    expect(retry.body.id).toBe(first.body.id);
    expect(await rows()).toHaveLength(1);
  });

  it("keeps the event identity across credential rotation but rejects the old credential", async () => {
    const first = await send();
    await harness.pg.query(`
      UPDATE device_credentials SET status='REVOKED' WHERE id=1;
      INSERT INTO device_credentials(id,device_id,school_id,credential_identifier,secret_hash,status)
      SELECT 4,device_id,school_id,'fixture-rotated',secret_hash,'ACTIVE'
        FROM device_credentials WHERE id=1;
    `);
    expect((await send()).status).toBe(401);
    const retry = await send(event(), "fixture-rotated");
    expect(retry.status).toBe(200);
    expect(retry.body.id).toBe(first.body.id);
    expect(await rows()).toHaveLength(1);
  });

  it.each([null, 123, "", "short", "x".repeat(129)])("rejects invalid keys (%s) before creating an event", async (key) => {
    expect((await send(event({ idempotencyKey: key }))).status).toBe(400);
    expect(await rows()).toHaveLength(0);
  });

  it("preserves legacy behavior when no key is supplied", async () => {
    const body = event({ idempotencyKey: undefined });
    expect((await send(body)).status).toBe(201);
    expect((await send(body)).status).toBe(409);
    expect((await rows())[0].dedupe_key).not.toContain("device-idempotency");
  });
});
