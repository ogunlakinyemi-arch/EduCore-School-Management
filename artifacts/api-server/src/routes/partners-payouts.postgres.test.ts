import express, { type Request, type Response, type NextFunction } from "express";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";
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
import { bankFingerprint, BRO_BANK_POLICY } from "../services/bro-bank-verification";
import { FlutterwavePayrollV3Client } from "../lib/flutterwave-payroll-v3";
vi.mock("../services/test-account-archive-access",()=>({assertTestArchiveAccess:vi.fn(async()=>{})}));

let directory: string;
let postgres: ChildProcess;
let server: ReturnType<express.Express["listen"]>;
let base: string;
let migration: string;
const baseDDL = `
CREATE TABLE app_users(id integer PRIMARY KEY,clerk_user_id text);
INSERT INTO app_users(id) VALUES(1),(2),(3),(4),(5);
CREATE TABLE partner_profiles(id integer PRIMARY KEY,full_name text,user_id integer,status text DEFAULT 'ACTIVE',
 partner_code text,email text,type text DEFAULT 'INDIVIDUAL',business_name text,phone text,address text,state text,lga text,
 registered_at timestamptz,activated_at timestamptz,deactivated_at timestamptz,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
INSERT INTO partner_profiles(id,full_name,user_id,partner_code,email) VALUES(3,'Ada Example',3,'BRO3','ada@payout.invalid'),(4,'Bola Example',4,'BRO4','bola@payout.invalid');
CREATE TABLE partner_profile_users(partner_profile_id integer,user_id integer,role text,status text);
CREATE TABLE partner_payout_information(id serial PRIMARY KEY,partner_profile_id integer UNIQUE,
 method text,bank_name_encrypted text,account_name_encrypted text,account_number_encrypted text,bank_code_encrypted text,
 account_last4 text,encryption_key_version text,status text DEFAULT 'ACTIVE',updated_at timestamptz DEFAULT now());
CREATE TABLE schools(id integer PRIMARY KEY);
CREATE TABLE students(id integer PRIMARY KEY,school_id integer,status text);
CREATE TABLE school_partner_attributions(school_id integer,partner_profile_id integer,is_current boolean);
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
 reversal_reference text,approved_at timestamptz,held_at timestamptz,cancelled_at timestamptz,created_by integer,
 term text,created_at timestamptz DEFAULT now(),payment_id integer);
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
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await state.pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await state.pool.query(baseDDL);
  await state.pool.query(migration);
  await seedBank(3,"Ada Example");
  await seedBank(4,"Bola Example");
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (state.pool) await state.pool.end();
  if (postgres && postgres.exitCode === null) {
    await new Promise<void>((resolve) => { postgres.once("exit", () => resolve()); postgres.kill("SIGTERM"); });
  }
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function seedBank(partnerId:number,name:string) {
  const version="session-hkdf-v1";
  const key=Buffer.from(crypto.hkdfSync("sha256",process.env.SESSION_SECRET!,Buffer.alloc(0),"edupulse-partner-payout-encryption-v1",32));
  const encrypt=(value:string)=>{
    const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",key,iv);
    const data=Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);
    return [iv,data,cipher.getAuthTag()].map(b=>b.toString("base64")).join(".");
  };
  const row=(await state.pool.query(`INSERT INTO partner_payout_information
    (partner_profile_id,method,bank_name_encrypted,account_name_encrypted,account_number_encrypted,bank_code_encrypted,
    account_last4,encryption_key_version) VALUES($1,'BANK_TRANSFER',$2,$3,$4,$5,'6789',$6) RETURNING *`,
    [partnerId,encrypt("Fixture Bank"),encrypt(name),encrypt("0123456789"),encrypt("099"),version])).rows[0];
  await state.pool.query(`INSERT INTO audit_logs(action,module,record_id,metadata) VALUES('Verified BRO bank account','Partner Payout Information',$1,$2)`,
    [row.id,{policy:BRO_BANK_POLICY,fingerprint:bankFingerprint(row),identity:name,ownerId:partnerId}]);
}
const input = (key = "payout-test-key-1", extra = {}) =>
  ({ idempotencyKey: key, partnerId: 3, amount: "300.00", currency: "NGN", ...extra });
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
  it("keeps Owner selection and BRO dashboard balances identical before reservation and after Paid",async()=>{
    await state.pool.query(`INSERT INTO commission_ledger(partner_profile_id,amount,school_id,status)
      VALUES(3,50,10,'PENDING'),(3,25,10,'CANCELLED')`);
    await state.pool.query(`CREATE TABLE bro_term_commission_entitlements(partner_profile_id integer,amount_minor integer,status text);
      INSERT INTO bro_term_commission_entitlements VALUES(3,15000,'PENDING_OWNER_APPROVAL')`);
    const candidates=async()=>await (await fetch(`${base}/platform/partner-payout-candidates`)).json() as any[];
    const dashboard=async()=>await (await fetch(`${base}/partner/dashboard`,{headers:{"x-test-role":"PARTNER","x-test-actor":"3"}})).json() as any;
    const before=(await candidates()).find(p=>p.partnerId===3),own=await dashboard();
    expect(before).toMatchObject({accruedCommission:500,paidCommission:0,outstandingCommission:500,
      payableCommission:300,reservedCommission:0,pendingApprovalCommission:200,bankDetails:{verified:true,maskedAccountNumber:"****6789"}});
    expect(JSON.stringify(before)).not.toContain("0123456789");
    expect(own).toMatchObject({lifetimeCommission:500,paidCommission:0,outstandingCommission:500,payableCommission:300});
    const payout=await payoutBody(await create(input()));
    expect((await candidates()).find(p=>p.partnerId===3)).toMatchObject({payableCommission:0,reservedCommission:300,paidCommission:0});
    expect((await update(payout.id,{status:"PAID",paymentReference:"external-bank-1",confirmExternalTransfer:true})).status).toBe(200);
    expect(await dashboard()).toMatchObject({lifetimeCommission:500,paidCommission:300,outstandingCommission:200,payableCommission:0,reservedCommission:0});
    expect((await candidates()).find(p=>p.partnerId===3)).toMatchObject({accruedCommission:500,paidCommission:300,outstandingCommission:200,pendingApprovalCommission:200});
    const audit=(await state.pool.query(`SELECT actor_user_id,metadata FROM audit_logs WHERE action='Updated partner payout to PAID'`)).rows;
    expect(audit).toHaveLength(1);expect(audit[0]).toMatchObject({actor_user_id:1,metadata:{externalTransferConfirmed:true}});
    expect((await state.pool.query("SELECT paid_at FROM partner_payouts WHERE id=$1",[payout.id])).rows[0].paid_at).toBeInstanceOf(Date);
  });
  it("discloses the frozen verified bank only to Owner after creation and audits reveal",async()=>{
    const payout=await payoutBody(await create(input()));
    await state.pool.query(`UPDATE partner_payout_information SET account_last4='9999',status='INACTIVE' WHERE partner_profile_id=3`);
    const list=await (await fetch(`${base}/platform/partner-payouts`)).json() as any[];
    expect(list[0]).toMatchObject({partnerName:"Ada Example",bankDetailsAvailable:true,bankDetails:{maskedAccountNumber:"****6789"}});
    expect(JSON.stringify(list)).not.toContain("0123456789");
    const url=`${base}/platform/partner-payouts/${payout.id}/bank-details`;
    const reveal=await fetch(url);
    expect(reveal.status).toBe(200);expect(reveal.headers.get("cache-control")).toContain("no-store");
    expect(await reveal.json()).toMatchObject({accountNumber:"0123456789",accountName:"Ada Example",bankName:"Fixture Bank",verified:true});
    expect((await fetch(url,{headers:{"x-test-role":"PARTNER","x-test-actor":"3"}})).status).toBe(403);
    expect((await state.pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE action='Viewed payout bank snapshot'")).rows[0].n).toBe(1);
  });
  it.each(["missing","stale","identity"])("refuses payout from %s verified-bank evidence",async change=>{
    if(change==="missing")await state.pool.query("DELETE FROM audit_logs WHERE module='Partner Payout Information'");
    if(change==="stale")await state.pool.query("UPDATE partner_payout_information SET bank_name_encrypted='changed' WHERE partner_profile_id=3");
    if(change==="identity")await state.pool.query("UPDATE partner_profiles SET full_name='Someone Else' WHERE id=3");
    expect((await create(input())).status).toBe(409);
    expect((await counts()).payouts).toBe(0);
    const hidden=await fetch(`${base}/platform/partners/3/payout-information`);
    expect(hidden.status).toBe(404);
  });
  it.each(["0","-1","299.99","300.01","100","500"])("refuses arbitrary, negative or nonpayable amount %s",async amount=>{
    const r=await create(input("invalid-amount-key",{amount}));
    expect([400,409]).toContain(r.status);expect((await counts()).payouts).toBe(0);
  });
  it("requires external completion confirmation and prevents two concurrent Paid effects",async()=>{
    const p=await payoutBody(await create(input()));
    expect((await update(999,{status:"PAID",paymentReference:"missing",confirmExternalTransfer:true})).status).toBe(404);
    expect((await update(p.id,{status:"PAID",paymentReference:"no-confirm"})).status).toBe(400);
    const r=await Promise.all([1,2].map(()=>update(p.id,{status:"PAID",paymentReference:"one-transfer",confirmExternalTransfer:true})));
    expect(r.map(x=>x.status).sort()).toEqual([200,409]);
    expect((await state.pool.query("SELECT count(*)::int AS n FROM audit_logs WHERE action='Updated partner payout to PAID'")).rows[0].n).toBe(1);
    expect((await state.pool.query("SELECT SUM(amount)::float AS paid FROM commission_ledger WHERE status='PAID'")).rows[0].paid).toBe(300);
  });
  it("fails closed if reserved ledger entries change before Paid",async()=>{
    const p=await payoutBody(await create(input()));
    await state.pool.query("UPDATE commission_ledger SET status='HELD' WHERE id=1");
    expect((await update(p.id,{status:"PAID",paymentReference:"cannot-match",confirmExternalTransfer:true})).status).toBe(409);
    expect((await state.pool.query("SELECT status FROM partner_payouts WHERE id=$1",[p.id])).rows[0].status).toBe("PENDING");
    expect((await state.pool.query("SELECT count(*)::int AS n FROM commission_ledger WHERE status='PAID'")).rows[0].n).toBe(0);
  });
  it("never allocates held, pending, cancelled, deferred or already reserved earnings",async()=>{
    await state.pool.query(`UPDATE commission_ledger SET status='PENDING' WHERE partner_profile_id=3;
      UPDATE commission_ledger SET status='HELD' WHERE id=1;
      UPDATE commission_ledger SET status='PAYABLE',payment_id=999 WHERE id=2;`);
    expect((await create(input())).status).toBe(409);expect((await counts()).payouts).toBe(0);
  });
  it("returns the original durable response after a lost response, even after status changes", async () => {
    const first = await create(input()); // Client discards the result: retry must still be recoverable.
    expect(first.status).toBe(201);
    const original = await payoutBody(first);
    await state.pool.query("UPDATE partner_payouts SET status='PROCESSING' WHERE id=$1", [original.id]);
    const replay = await create(input());
    expect(replay.status).toBe(201);
    expect(replay.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await replay.json()).toEqual(original);
      expect(await counts()).toEqual({ payouts: 1, requests: 1, audits: 1, reserved: 3 });
  });

  it("serializes simultaneous identical keys across connections and platform Owners", async () => {
    const responses = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      create(input(), { "x-test-actor": String(i % 2 + 1) })));
    expect(responses.map((r) => r.status)).toEqual(Array(8).fill(201));
    const bodies = await Promise.all(responses.map((r) => r.json()));
    // jsonb may reorder object keys; JSON values and original timestamps must match.
    for (const body of bodies) expect(body).toEqual(bodies[0]);
    expect(await counts()).toEqual({ payouts: 1, requests: 1, audits: 1, reserved: 3 });
  });

  it.each([
    { partnerId: 4 }, { amount: "200" }, { currency: "USD" }, { periodStart: "2026-01-01" },
    { periodEnd: "2026-12-01" }, { method: "BANK" }, { notes: "different" },
  ])("rejects same-key changed payload %j", async (changed) => {
    expect((await create(input())).status).toBe(201);
    expect((await create(input("payout-test-key-1", changed))).status).toBe(409);
    expect(await counts()).toEqual({ payouts: 1, requests: 1, audits: 1, reserved: 3 });
  });

  it("resolves simultaneous conflicting payloads with only one commit", async () => {
    const responses = await Promise.all([create(input()), create(input("payout-test-key-1", { amount: "200" }))]);
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await counts()).payouts).toBe(1);
    expect((await counts()).audits).toBe(1);
  });

  it("normalizes decimal amounts and currency, excluding server-generated defaults", async () => {
    const first = await create(input("payout-test-key-1", { amount: 300, currency: "ngn" }));
    const second = await create(input());
    expect(await second.json()).toEqual(await first.json());
    expect((await counts()).payouts).toBe(1);
  });

  it("keeps distinct-key commission reservations disjoint and Partner-scoped", async () => {
    const responses = await Promise.all([1, 2, 3, 4].map((i) => create(input(`payout-request-${i}`))));
    expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(3);
    expect(await counts()).toEqual({ payouts: 1, requests: 1, audits: 1, reserved: 3 });
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
    const b = await payoutBody(await create(input("second-request-key",{partnerId:4,amount:"100"})));
    await update(a.id, { status: "PROCESSING" });
    await update(b.id, { status: "PROCESSING" });
    const responses = await Promise.all([
      update(a.id, { status: "PAID", paymentReference: " bank-reference-1 ",confirmExternalTransfer:true }),
      update(b.id, { status: "PAID", paymentReference: "bank-reference-1",confirmExternalTransfer:true }),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const winner = responses[0].status === 200 ? a : b;
    const loser = winner.id === a.id ? b : a;
    expect((await update(winner.id, { status: "REVERSED", paymentReference: "reversal-1" })).status).toBe(200);
    expect((await update(loser.id, { status: "PAID", paymentReference: "bank-reference-1",confirmExternalTransfer:true })).status).toBe(409);
    const loserRow = (await state.pool.query("SELECT status,payment_reference FROM partner_payouts WHERE id=$1", [loser.id])).rows[0];
    expect(loserRow).toEqual({ status: "PROCESSING", payment_reference: null });
    expect((await state.pool.query("SELECT status FROM commission_ledger WHERE payout_id=$1", [loser.id])).rows[0].status).toBe("PAYABLE");
  });

  it("does not overwrite an assigned reference or release it after failure", async () => {
    const a = await payoutBody(await create(input()));
    const b = await payoutBody(await create(input("second-request-key",{partnerId:4,amount:"100"})));
    expect((await update(a.id, { status: "PROCESSING", paymentReference: "reserved-reference" })).status).toBe(200);
    expect((await update(a.id, { status: "PAID", paymentReference: "replacement-reference",confirmExternalTransfer:true })).status).toBe(409);
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

describe("BRO LIVE lookup and proof-backed bank save on isolated PostgreSQL",()=>{
  const selection={bankName:"Fixture Bank",bankCode:"099",accountNumber:"0123456789"};
  const headers={"content-type":"application/json","x-test-role":"PARTNER","x-test-actor":"3"};
  const lookup=(body:any=selection,h=headers)=>fetch(`${base}/partner/payout-information/lookup-account`,{method:"POST",headers:h,body:JSON.stringify(body)});
  const save=(token:string,extra:object={})=>fetch(`${base}/partner/payout-information`,{method:"PATCH",headers,
    body:JSON.stringify({...selection,payoutMethod:"BANK_TRANSFER",accountName:"Ada Example",lookupToken:token,...extra})});
  const live=()=>{
    vi.stubEnv("NODE_ENV","production");vi.stubEnv("EDUCORE_FLUTTERWAVE_MODE","LIVE");
    vi.stubEnv("FLUTTERWAVE_LIVE_SECRET_KEY","FLWSECK-fictional-no-network");
    const directory=vi.spyOn(FlutterwavePayrollV3Client.prototype,"listNigerianBanks").mockResolvedValue({
      environment:"LIVE",banks:[{id:9,code:"099",name:"Fixture Bank"}]});
    const resolve=vi.spyOn(FlutterwavePayrollV3Client.prototype,"resolveNigerianAccount").mockResolvedValue({
      resolvedAccountName:"Ada Example",resolvedAccountNumber:"0123456789"});
    return {directory,resolve};
  };
  it("lookup writes nothing; save stores encrypted bank details with audit proof and masked reads",async()=>{
    const mocks=live();
    const before=(await state.pool.query("SELECT * FROM partner_payout_information ORDER BY id")).rows;
    const result=await lookup();expect(result.status).toBe(200);
    const evidence=await result.json() as any;
    expect(JSON.stringify(evidence)).not.toContain(selection.accountNumber);
    expect((await state.pool.query("SELECT * FROM partner_payout_information ORDER BY id")).rows).toEqual(before);
    expect(mocks.resolve).toHaveBeenCalledWith(selection,{requireOwnerLive:true});
    mocks.resolve.mockClear();
    const saved=await save(evidence.lookupToken);expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({accountName:"Ada Example",verified:true,maskedAccountNumber:"****6789"});
    const own=await fetch(`${base}/partner/payout-information`,{headers});
    const ownText=await own.text();expect(ownText).not.toContain(selection.accountNumber);expect(JSON.parse(ownText).verified).toBe(true);
    const owner=await fetch(`${base}/platform/partners/3/payout-information`);
    expect(await owner.json()).toMatchObject({verified:true,accountNumber:selection.accountNumber});
    expect(mocks.resolve).not.toHaveBeenCalled(); // Save and GET never resolve.
    const raw=await state.pool.query("SELECT account_number_encrypted FROM partner_payout_information WHERE partner_profile_id=3");
    expect(JSON.stringify(raw.rows)).not.toContain(selection.accountNumber);
    expect((await save(evidence.lookupToken)).status).toBe(409); // proof consumed by revision change
  });
  it.each([{NODE_ENV:"development"},{EDUCORE_FLUTTERWAVE_MODE:"TEST"},
    {FLUTTERWAVE_LIVE_SECRET_KEY:"FLWSECK-TEST-only"},{FLUTTERWAVE_LIVE_SECRET_KEY:""}])("rejects non-LIVE configuration before provider access %j",async change=>{
      const mocks=live();for(const [k,v]of Object.entries(change))vi.stubEnv(k,v);
      expect((await lookup()).status).toBe(409);
      expect(mocks.directory).not.toHaveBeenCalled();expect(mocks.resolve).not.toHaveBeenCalled();
    });
  it.each(["Other Person","Example Ada","Ada","Ada Extra Example","Ada Examples"])("rejects nonmatching beneficiary %s",async name=>{
    const {resolve}=live();resolve.mockResolvedValue({resolvedAccountName:name,resolvedAccountNumber:selection.accountNumber});
    expect((await lookup()).status).toBe(409);
  });
  it("leaves saved details intact on timeout and mismatched number",async()=>{
    const {resolve}=live();const before=(await state.pool.query("SELECT * FROM partner_payout_information ORDER BY id")).rows;
    resolve.mockRejectedValue(new Error("sensitive raw provider body"));
    const error=await lookup();expect(error.status).toBe(503);expect(await error.text()).not.toContain("sensitive raw");
    resolve.mockResolvedValue({resolvedAccountName:"Ada Example",resolvedAccountNumber:"9999999999"});
    expect((await lookup()).status).toBe(409);
    expect((await state.pool.query("SELECT * FROM partner_payout_information ORDER BY id")).rows).toEqual(before);
  });
  it.each([{accountNumber:"0123456788"},{bankCode:"098"},{bankName:"Other Bank"},{accountName:"Other Person"}])("rejects changed fields after lookup %j",async change=>{
    live();const proof=await (await lookup()).json() as any;
    expect((await save(proof.lookupToken,change)).status).toBe(409);
  });
  it("rejects stale identity, tampering and expiration",async()=>{
    live();const proof=await (await lookup()).json() as any;
    expect((await save(proof.lookupToken+"changed")).status).toBe(409);
    const clock=vi.spyOn(Date,"now").mockReturnValue(Date.now()+300001);
    expect((await save(proof.lookupToken)).status).toBe(409);clock.mockRestore();
    await state.pool.query("UPDATE partner_profiles SET full_name='Ada Changed' WHERE id=3");
    expect((await save(proof.lookupToken)).status).toBe(409);
  });
  it("serializes two saves and rejects stale evidence after a concurrent successful save",async()=>{
    live();const proof=await (await lookup()).json() as any;
    const results=await Promise.all([save(proof.lookupToken),save(proof.lookupToken)]);
    expect(results.map(r=>r.status).sort()).toEqual([200,409]);
  });
  it("expires proof during bank-directory recheck without saving",async()=>{
    const {directory}=live();const proof=await (await lookup()).json() as any;
    const before=(await state.pool.query("SELECT * FROM partner_payout_information ORDER BY id")).rows;
    const now=Date.now();
    directory.mockImplementationOnce(async()=>{
      vi.spyOn(Date,"now").mockReturnValue(now+300001);
      return {environment:"LIVE",banks:[{id:9,code:"099",name:"Fixture Bank"}]};
    });
    expect((await save(proof.lookupToken)).status).toBe(409);
    expect((await state.pool.query("SELECT * FROM partner_payout_information ORDER BY id")).rows).toEqual(before);
  });
  it("denies staff, unrelated BRO and unauthenticated lookup and hides legacy unverified bank data",async()=>{
    const {resolve}=live();
    await state.pool.query("INSERT INTO partner_profile_users VALUES(3,5,'PARTNER_STAFF','ACTIVE')");
    expect((await lookup(selection,{...headers,"x-test-actor":"5"})).status).toBe(403);
    expect((await lookup(selection,{...headers,"x-test-role":"ANONYMOUS"})).status).toBe(401);
    const proof=await (await lookup()).json() as any;
    const other=await fetch(`${base}/partner/payout-information`,{method:"PATCH",headers:{...headers,"x-test-actor":"4"},
      body:JSON.stringify({...selection,payoutMethod:"BANK_TRANSFER",accountName:"Ada Example",lookupToken:proof.lookupToken})});
    expect(other.status).toBe(409);
    resolve.mockClear();expect((await save("")).status).toBe(400);expect(resolve).not.toHaveBeenCalled();
    await state.pool.query("DELETE FROM audit_logs WHERE module='Partner Payout Information'");
    const hidden=await fetch(`${base}/partner/payout-information`,{headers});
    expect(await hidden.json()).toMatchObject({verified:false,accountName:null,maskedAccountNumber:null});
    expect((await fetch(`${base}/platform/partners/3/payout-information`)).status).toBe(404);
  });
});
