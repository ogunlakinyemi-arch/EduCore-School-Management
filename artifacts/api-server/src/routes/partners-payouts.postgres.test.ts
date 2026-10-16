import express, { type Request, type Response, type NextFunction } from "express";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabasePool } from "@workspace/db/driver";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Never import the application's connection or consult DATABASE_URL/PG credentials.
const state = vi.hoisted(() => ({ pool: null as unknown as InstanceType<typeof DatabasePool> }));
vi.mock("@workspace/db", () => ({
  pool: { query: (...args: any[]) => (state.pool.query as any)(...args), connect: () => state.pool.connect() },
}));
vi.mock("@clerk/express", () => ({ clerkClient: {} }));
vi.mock("../middlewares/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return {
    ...actual,
    // Synthetic authentication only; use the REAL role/resource/context helpers.
    requireAuthentication: () => (req: Request, res: Response, next: NextFunction) => {
      const role = req.header("x-test-role") ?? "PLATFORM_OWNER";
      if (role === "ANONYMOUS") return res.status(401).json({ error: "Authentication required" });
      (req as any).edupulseUser = {
        user: { id: Number(req.header("x-test-actor") ?? 1), clerkUserId: "payout-test-owner",
          email: "owner@payout.invalid", status: "ACTIVE" },
        roles: [{ id: 1, role, schoolId: role === "PLATFORM_OWNER" || role === "PARTNER" ? null : 10,
          status: "ACTIVE" }],
      };
      next();
    },
  };
});
import partnersRouter from "./partners";

let directory: string;
let postgres: ChildProcess;
let server: ReturnType<express.Express["listen"]>;
let base: string;
let migration: string;
const baseDDL = `
CREATE TABLE app_users(id integer PRIMARY KEY);
INSERT INTO app_users VALUES(1),(2);
CREATE TABLE partner_profiles(id integer PRIMARY KEY);
INSERT INTO partner_profiles VALUES(3),(4);
CREATE TABLE partner_payouts(
 id serial PRIMARY KEY,partner_profile_id integer NOT NULL REFERENCES partner_profiles(id),
 amount numeric(12,2) NOT NULL CHECK(amount>=0),currency text NOT NULL DEFAULT 'NGN',
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','PROCESSING','PAID','FAILED','REVERSED')),
 period_start timestamptz NOT NULL,period_end timestamptz NOT NULL,method text,notes text,
 payment_reference text,paid_at timestamptz,reversed_at timestamptz,reversal_reference text,
 created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE commission_ledger(
 id serial PRIMARY KEY,partner_profile_id integer NOT NULL REFERENCES partner_profiles(id),
 amount numeric(12,2) NOT NULL,currency text NOT NULL DEFAULT 'NGN',status text NOT NULL DEFAULT 'PAYABLE',
 school_id integer NOT NULL,payout_id integer REFERENCES partner_payouts(id),
 payable_at timestamptz DEFAULT now(),paid_at timestamptz,payment_reference text,reversed_at timestamptz,
 reversal_reference text,approved_at timestamptz,held_at timestamptz,cancelled_at timestamptz,created_by integer);
CREATE TABLE audit_logs(
 id serial PRIMARY KEY,"user" text,role text,actor_user_id integer,clerk_user_id text,
 action text,module text,record_id integer,metadata jsonb);
INSERT INTO commission_ledger(partner_profile_id,amount,school_id)
 VALUES(3,100,10),(3,100,10),(3,100,10),(4,100,20);
`;

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "educore-payout-pg-"));
  const data = path.join(directory, "data");
  const env = { PATH: process.env.PATH, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" };
  execFileSync("initdb", ["-D", data, "-U", "payout_test", "-A", "trust", "--no-locale"], { env, stdio: "ignore" });
  postgres = spawn("postgres", ["-D", data, "-k", directory, "-h", "", "-p", "5432"], { env, stdio: "ignore" });
  state.pool = new DatabasePool({ host: directory, port: 5432, database: "postgres", user: "payout_test", max: 12 });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { await state.pool.query("SELECT 1"); ready = true; break; }
    catch { await new Promise((resolve) => setTimeout(resolve, 30)); }
  }
  if (!ready) throw new Error("Disposable payout PostgreSQL did not start; no fallback database is allowed");
  migration = await readFile(new URL("../../../../lib/db/drizzle/0166_partner_payout_retry_identity.sql", import.meta.url), "utf8");
  const app = express();
  app.use(express.json());
  app.use(partnersRouter);
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) =>
    res.status(error.statusCode ?? 500).json({ error: error.message }));
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test HTTP listener unavailable");
  base = `http://127.0.0.1:${address.port}`;
}, 20000);

beforeEach(async () => {
  await state.pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await state.pool.query(baseDDL);
  await state.pool.query(migration);
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (state.pool) await state.pool.end();
  if (postgres && postgres.exitCode === null) {
    await new Promise<void>((resolve) => { postgres.once("exit", () => resolve()); postgres.kill("SIGTERM"); });
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

const input = (key = "payout-test-key-1", extra = {}) =>
  ({ idempotencyKey: key, partnerId: 3, amount: "100.00", currency: "NGN", ...extra });
const create = (body: unknown, headers = {}) => fetch(`${base}/platform/partner-payouts`, {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
});
const update = (id: number, body: unknown, headers = {}) => fetch(`${base}/platform/partner-payouts/${id}`, {
  method: "PATCH", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
});
const counts = async () => (await state.pool.query(`SELECT
 (SELECT count(*)::int FROM partner_payouts) payouts,
 (SELECT count(*)::int FROM partner_payout_requests) requests,
 (SELECT count(*)::int FROM audit_logs WHERE action='Created partner payout') audits,
 (SELECT count(*)::int FROM commission_ledger WHERE payout_id IS NOT NULL) reserved`)).rows[0];
const payoutBody = async (response: globalThis.Response) => await response.json() as { id: number; status: string };

describe("Partner payout real PostgreSQL request identity and constraints", () => {
  it("returns the original durable response after a lost response, even after status changes", async () => {
    const first = await create(input()); // Client discards the result: retry must still be recoverable.
    expect(first.status).toBe(201);
    const original = await payoutBody(first);
    await state.pool.query("UPDATE partner_payouts SET status='PROCESSING' WHERE id=$1", [original.id]);
    const replay = await create(input());
    expect(replay.status).toBe(201);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await replay.json()).toEqual(original);
    expect(await counts()).toEqual({ payouts: 1, requests: 1, audits: 1, reserved: 1 });
  });

  it("serializes simultaneous identical keys across connections and platform Owners", async () => {
    const responses = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      create(input(), { "x-test-actor": String(i % 2 + 1) })));
    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(201));
    const bodies = await Promise.all(responses.map((r) => r.json()));
    // jsonb may reorder object keys; JSON values and original timestamps must match.
    for (const body of bodies) expect(body).toEqual(bodies[0]);
    expect(await counts()).toEqual({ payouts: 1, requests: 1, audits: 1, reserved: 1 });
  });

  it.each([
    { partnerId: 4 }, { amount: "200" }, { currency: "USD" }, { periodStart: "2026-01-01" },
    { periodEnd: "2026-12-01" }, { method: "BANK" }, { notes: "different" },
  ])("rejects same-key changed payload %j", async (changed) => {
    expect((await create(input())).status).toBe(201);
    expect((await create(input("payout-test-key-1", changed))).status).toBe(409);
    expect(await counts()).toEqual({ payouts: 1, requests: 1, audits: 1, reserved: 1 });
  });

  it("resolves simultaneous conflicting payloads with only one commit", async () => {
    const responses = await Promise.all([create(input()), create(input("payout-test-key-1", { amount: "200" }))]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await counts()).payouts).toBe(1);
    expect((await counts()).audits).toBe(1);
  });

  it("normalizes decimal amounts and currency, excluding server-generated defaults", async () => {
    const first = await create(input("payout-test-key-1", { amount: 100, currency: "ngn" }));
    const second = await create(input());
    expect(await second.json()).toEqual(await first.json());
    expect((await counts()).payouts).toBe(1);
  });

  it("keeps distinct-key commission reservations disjoint and Partner-scoped", async () => {
    const responses = await Promise.all([1, 2, 3, 4].map((i) => create(input(`payout-request-${i}`))));
    expect(responses.filter((r) => r.status === 201)).toHaveLength(3);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(1);
    expect(await counts()).toEqual({ payouts: 3, requests: 3, audits: 3, reserved: 3 });
    expect((await state.pool.query("SELECT payout_id FROM commission_ledger WHERE partner_profile_id=4")).rows[0].payout_id).toBeNull();
  });

  it.each(["audit_logs", "partner_payout_requests"])(
    "rolls back all effects if %s persistence fails, then permits a safe retry", async (table) => {
    await state.pool.query(`CREATE FUNCTION fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic audit failure'; END $$;
      CREATE TRIGGER fail_audit BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_audit();`);
    expect((await create(input())).status).toBe(500);
    expect(await counts()).toEqual({ payouts: 0, requests: 0, audits: 0, reserved: 0 });
    await state.pool.query(`DROP TRIGGER fail_audit ON ${table}`);
    expect((await create(input())).status).toBe(201);
  });

  it.each(["PARTNER", "SCHOOL_ADMIN", "ACCOUNTANT", "COMPANY_ACCOUNTANT", "TEACHER", "PARENT"])(
    "denies %s on both new requests and existing-key replays", async (role) => {
      const first = await create(input());
      const { id } = await payoutBody(first);
      const headers = { "x-test-role": role };
      expect((await create(input(), headers)).status).toBe(403);
      expect((await create(input("new-request-key"), headers)).status).toBe(403);
      expect((await update(id, { status: "PROCESSING" }, headers)).status).toBe(403);
      expect((await counts()).payouts).toBe(1);
    });

  it("requires authentication and a valid client key before allocating anything", async () => {
    expect((await create(input(), { "x-test-role": "ANONYMOUS" })).status).toBe(401);
    expect((await create({ partnerId: 3, amount: 100 })).status).toBe(400);
    expect((await create(input("bad"))).status).toBe(400);
    expect((await create(input("valid-key-1", { amount: "0.1009" }))).status).toBe(400);
    expect(await counts()).toEqual({ payouts: 0, requests: 0, audits: 0, reserved: 0 });
  });

  it("race-protects manual references and retains them after reversal", async () => {
    const a = await payoutBody(await create(input()));
    const b = await payoutBody(await create(input("second-request-key")));
    await update(a.id, { status: "PROCESSING" });
    await update(b.id, { status: "PROCESSING" });
    const responses = await Promise.all([
      update(a.id, { status: "PAID", paymentReference: " bank-reference-1 " }),
      update(b.id, { status: "PAID", paymentReference: "bank-reference-1" }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = responses[0].status === 200 ? a : b;
    const loser = winner.id === a.id ? b : a;
    expect((await update(winner.id, { status: "REVERSED", paymentReference: "reversal-1" })).status).toBe(200);
    expect((await update(loser.id, { status: "PAID", paymentReference: "bank-reference-1" })).status).toBe(409);
    const loserRow = (await state.pool.query("SELECT status,payment_reference FROM partner_payouts WHERE id=$1", [loser.id])).rows[0];
    expect(loserRow).toEqual({ status: "PROCESSING", payment_reference: null });
    expect((await state.pool.query("SELECT status FROM commission_ledger WHERE payout_id=$1", [loser.id])).rows[0].status).toBe("PAYABLE");
  });

  it("does not overwrite an assigned reference or release it after failure", async () => {
    const a = await payoutBody(await create(input()));
    const b = await payoutBody(await create(input("second-request-key")));
    expect((await update(a.id, { status: "PROCESSING", paymentReference: "reserved-reference" })).status).toBe(200);
    expect((await update(a.id, { status: "PAID", paymentReference: "replacement-reference" })).status).toBe(409);
    expect((await update(a.id, { status: "FAILED" })).status).toBe(200);
    expect((await update(b.id, { status: "PROCESSING", paymentReference: "reserved-reference" })).status).toBe(409);
  });

  it("fails the actual migration atomically on legacy duplicate references without editing history", async () => {
    await state.pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await state.pool.query(baseDDL);
    await state.pool.query(`INSERT INTO partner_payouts(partner_profile_id,amount,period_start,period_end,payment_reference)
      VALUES(3,100,now(),now(),'legacy-ref'),(4,100,now(),now(),' legacy-ref ');`);
    const client = await state.pool.connect();
    try {
      await expect(client.query(migration)).rejects.toMatchObject({ code: "23505" });
      await client.query("ROLLBACK");
    } finally { client.release(); }
    expect((await state.pool.query("SELECT to_regclass('public.partner_payout_requests') value")).rows[0].value).toBeNull();
    expect((await state.pool.query("SELECT payment_reference FROM partner_payouts ORDER BY id")).rows)
      .toEqual([{ payment_reference: "legacy-ref" }, { payment_reference: " legacy-ref " }]);
  });

  it("preserves nonduplicate legacy payouts and commissions when applying the actual DDL", async () => {
    await state.pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await state.pool.query(baseDDL);
    await state.pool.query(`INSERT INTO partner_payouts(partner_profile_id,amount,status,period_start,period_end,payment_reference)
      VALUES(3,100,'PAID','2026-01-01','2026-01-31','old-payment-ref');`);
    const payouts = (await state.pool.query("SELECT * FROM partner_payouts ORDER BY id")).rows;
    const commissions = (await state.pool.query("SELECT * FROM commission_ledger ORDER BY id")).rows;
    await state.pool.query(migration);
    expect((await state.pool.query("SELECT * FROM partner_payouts ORDER BY id")).rows).toEqual(payouts);
    expect((await state.pool.query("SELECT * FROM commission_ledger ORDER BY id")).rows).toEqual(commissions);
  });
});
