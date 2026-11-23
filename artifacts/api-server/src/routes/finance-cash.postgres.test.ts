import assert from "node:assert/strict";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const target = vi.hoisted(() => ({ pool: null as any }));
vi.mock("@workspace/db", () => ({ pool: {
  connect: (...args: any[]) => target.pool.connect(...args),
  query: (...args: any[]) => target.pool.query(...args),
} }));
// No Clerk session, provider, real recipient or notification delivery is involved.
// Existing real role/tenant/mutation checks below are NOT mocked.
vi.mock("../middlewares/auth", async importOriginal => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return { ...actual, requireAuthentication: () =>
    (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      const role = req.header("x-test-role") ?? "SCHOOL_ADMIN";
      (req as any).edupulseUser = {
        user: { id: Number(req.header("x-test-user") ?? 9), clerkUserId: "cash-fictional",
          email: "cash@example.test", firstName: "Fictional", lastName: "Accountant", phone: null, status: "ACTIVE" },
        roles: [{ id: 1, role, schoolId: role === "PLATFORM_OWNER" ? null : Number(req.header("x-test-school") ?? 1), status: "ACTIVE" }],
      };
      next();
    } };
});
vi.mock("./finance-notifications-service", () => ({
  enqueueFinancePaymentNotificationsSafely: vi.fn(async () => undefined),
}));
import financeRouter from "./finance";
import { cashCollectionDate } from "../lib/cash-collection-date";
import { beginFinancialTransaction } from "../services/financial-transaction";
import { lockFeePaymentRows } from "../services/fee-payment-locks";

const root = process.env.EDUCORE_CASH_CHECK_ROOT;
const suite = root ? describe : describe.skip;
suite("cash routes against independently verified disposable PostgreSQL", () => {
  let pool: Pool, server: ReturnType<typeof app.listen>, base = "";
  const app = express();
  app.use(express.json()); app.use(financeRouter);
  beforeAll(async () => {
    assert.equal(process.env.NODE_ENV, "test");
    assert.deepEqual(Object.keys(process.env).filter(k =>
      /^(?:PG|DATABASE|FLUTTERWAVE|REPLIT_)|SECRET|TOKEN|PASSWORD|API_KEY/.test(k)), []);
    assert.match(root!, /^\/tmp\/educore-cash-collection-[^/]+$/);
    const data = join(root!, "data"), socket = join(root!, "socket"), port = process.env.EDUCORE_CASH_CHECK_PORT!;
    const pid = readFileSync(join(data, "postmaster.pid"), "utf8").trim().split("\n");
    assert.equal(realpathSync(pid[1]), realpathSync(data)); assert.equal(pid[3], port); assert.equal(pid[4], socket);
    const argv = readFileSync(`/proc/${pid[0]}/cmdline`, "utf8").split("\0");
    assert.equal(argv[argv.indexOf("-D") + 1], data); assert.equal(argv[argv.indexOf("-h") + 1], "");
    assert.equal(statSync(join(socket, `.s.PGSQL.${port}`)).isSocket(), true);
    pool = new Pool({ host: socket, port: Number(port), user: "cash_collection_qa", database: "postgres",
      max: 4, connectionTimeoutMillis: 2000, statement_timeout: 5000 });
    const identity = (await pool.query(`SELECT current_setting('data_directory') AS data,
      current_setting('listen_addresses') AS listen,current_database() AS db,current_user AS role`)).rows[0];
    assert.equal(realpathSync(identity.data), realpathSync(data)); assert.equal(identity.listen, "");
    assert.equal(identity.db, "postgres"); assert.equal(identity.role, "cash_collection_qa");
    target.pool = pool;
    // Fictional minimal SQL fixtures; not a full application migration replay.
    await pool.query(`
      CREATE TABLE schools(id int PRIMARY KEY,name text,logo text);
      CREATE TABLE school_branding_logos(id int,school_id int,is_current boolean);
      CREATE TABLE fee_school_settings(school_id int PRIMARY KEY,partial_payments_enabled boolean);
      CREATE TABLE fee_invoices(id int PRIMARY KEY,school_id int,student_id int,employee_id int,parent_id int,
        invoice_number text,student_name_snapshot text,admission_no_snapshot text,class_name_snapshot text,section_snapshot text,
        academic_session_id int,academic_term_id int,currency text,issue_date date,
        subtotal_minor int,discount_minor int DEFAULT 0,waiver_minor int DEFAULT 0,total_minor int,
        paid_minor int DEFAULT 0,outstanding_minor int,status text,
        CHECK(paid_minor>=0 AND paid_minor<=total_minor AND outstanding_minor=total_minor-paid_minor));
      CREATE TABLE fee_invoice_lines(id int PRIMARY KEY,school_id int,invoice_id int,category_name_snapshot text,
        description_snapshot text,amount_minor int);
      CREATE TABLE fee_provider_checkout_sessions(id serial PRIMARY KEY,invoice_id int,school_id int,payment_id int,state text);
      CREATE TABLE fee_payments(id serial PRIMARY KEY,school_id int,invoice_id int,student_id int,employee_id int,parent_id int,
        reference text UNIQUE,idempotency_key text,amount_minor int CHECK(amount_minor>0),currency text,method text,provider text,
        status text,submitted_by int,verified_by int,verified_at timestamptz,verification_evidence_ref text,
        reviewer_notes text,verification_metadata jsonb,selected_line_ids int[],created_at timestamptz DEFAULT now(),
        transfer_bank text,transfer_reference text,
        UNIQUE(school_id,idempotency_key));
      CREATE UNIQUE INDEX cash_evidence_unique ON fee_payments(school_id,lower(btrim(verification_evidence_ref))) WHERE method='CASH';
      CREATE TABLE fee_payment_line_allocations(id serial PRIMARY KEY,school_id int,invoice_id int,payment_id int REFERENCES fee_payments,
        line_id int REFERENCES fee_invoice_lines,amount_minor int CHECK(amount_minor>0),UNIQUE(payment_id,line_id));
      CREATE TABLE fee_receipts(id serial PRIMARY KEY,school_id int,payment_id int REFERENCES fee_payments,invoice_id int,
        receipt_number text UNIQUE,snapshot jsonb,UNIQUE(payment_id));
      CREATE TABLE fee_refunds(id serial PRIMARY KEY,school_id int,payment_id int REFERENCES fee_payments,
        invoice_id int,reference text UNIQUE,idempotency_key text,transaction_type text,amount_minor int,
        currency text,reason text,requested_by int,status text DEFAULT 'PENDING',approved_by int,
        approved_at timestamptz,evidence_reference text,reviewer_notes text,UNIQUE(school_id,idempotency_key));
      CREATE TABLE audit_logs("user" text,role text,actor_user_id int,clerk_user_id text,school_id int,
        action text,module text,record_id int,severity text,event_type text,result text,metadata jsonb);
      CREATE TABLE parents(id int PRIMARY KEY,school_id int,user_id int,status text,name text DEFAULT 'Fictional Guardian');
      CREATE TABLE parent_student_relationships(parent_id int,student_id int,status text);
      CREATE TABLE students(id int PRIMARY KEY,school_id int,user_id int);
      INSERT INTO schools VALUES(1,'Fictional Cash School',null),(2,'Other Fictional School',null);
      INSERT INTO parents VALUES(21,1,19,'ACTIVE'),(22,2,29,'ACTIVE');
      INSERT INTO parent_student_relationships VALUES(21,31,'ACTIVE'),(22,32,'ACTIVE');
      INSERT INTO students VALUES(31,1,39),(32,2,49);
    `);
    // Exercise the actual sole allocation writer, not an application-only fixture.
    const migration = readFileSync(new URL("../../../../lib/db/drizzle/0055_academic_calendar_fee_lines_cash.sql", import.meta.url), "utf8");
    const start = migration.indexOf("CREATE OR REPLACE FUNCTION allocate_verified_fee_lines()");
    const end = migration.indexOf("FOR EACH ROW EXECUTE FUNCTION allocate_verified_fee_lines();", start);
    assert(start >= 0 && end > start);
    await pool.query(migration.slice(start, end + "FOR EACH ROW EXECUTE FUNCTION allocate_verified_fee_lines();".length));
    await new Promise<void>(resolve => {
      server = app.listen(0, "127.0.0.1", () => {
        const address = server.address();
        assert(address && typeof address === "object");
        base = `http://127.0.0.1:${address.port}`; resolve();
      });
    });
  });
  afterAll(async () => {
    if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    if (pool) await pool.end();
  });
  beforeEach(async () => {
    await pool.query(`
      ALTER TABLE fee_payments ENABLE TRIGGER fee_payment_allocate_lines;
      DROP TRIGGER IF EXISTS fixture_receipt_failure ON fee_receipts;
      DELETE FROM fee_refunds; DELETE FROM fee_receipts; DELETE FROM fee_payment_line_allocations; DELETE FROM fee_payments;
      DELETE FROM fee_provider_checkout_sessions; DELETE FROM fee_invoice_lines; DELETE FROM fee_invoices;
      DELETE FROM audit_logs; DELETE FROM fee_school_settings;
      INSERT INTO fee_school_settings VALUES(1,false),(2,false);
      INSERT INTO fee_invoices(id,school_id,student_id,parent_id,invoice_number,student_name_snapshot,
        admission_no_snapshot,class_name_snapshot,section_snapshot,academic_session_id,academic_term_id,
        currency,issue_date,subtotal_minor,total_minor,outstanding_minor,status) VALUES
        (41,1,31,21,'FICTIONAL-41','Fictional Child','QA-31','Year 1','A',3,4,'NGN','2026-01-01',50000,50000,50000,'UNPAID'),
        (42,1,31,21,'FICTIONAL-42','Fictional Child','QA-31','Year 1','A',3,4,'NGN','2026-01-01',50000,50000,50000,'UNPAID'),
        (43,2,32,22,'FICTIONAL-43','Other Child','QA-32','Year 1','A',3,4,'NGN','2026-01-01',50000,50000,50000,'UNPAID');
      INSERT INTO fee_invoice_lines VALUES(1,1,41,'Tuition','Tuition',30000),(2,1,41,'Transport','Transport',20000),
        (3,1,42,'Tuition','Tuition',50000),(4,2,43,'Tuition','Tuition',50000);
    `);
  });
  const body = { amountMinor: 50000, evidenceReference: "FICTIONAL-CASH-ONE", receivedFrom: "Fictional Guardian",
    receivedOn: "2026-01-02", notes: "Fictional receipt test only" };
  const post = (overrides: Record<string, unknown> = {}, headers: Record<string, string> = {}, invoice = 41, key = "fictional-key") =>
    fetch(`${base}/school/finance/invoices/${invoice}/cash-payments?schoolId=1`, {
      method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key, ...headers },
      body: JSON.stringify({ ...body, ...overrides }),
    });
  const counts = async () => (await pool.query(`SELECT (SELECT count(*)::int FROM fee_payments) AS payments,
    (SELECT count(*)::int FROM fee_receipts) AS receipts,(SELECT count(*)::int FROM audit_logs) AS audits`)).rows[0];
  it("records accountant cash, collection date, immutable receipt details and one ledger credit", async () => {
    const r = await post({}, { "x-test-role": "ACCOUNTANT" });
    expect(r.status).toBe(201);
    const payment = await r.json();
    expect(payment).toMatchObject({ amountMinor: 50000, method: "CASH", status: "VERIFIED" });
    const receipt = (await pool.query("SELECT snapshot FROM fee_receipts")).rows[0].snapshot;
    expect(receipt).toMatchObject({ receivedOn: "2026-01-02", actorName: "Fictional Accountant",
      previousBalanceMinor: 50000, remainingBalanceMinor: 0, allocationScope: "INVOICE_BALANCE",
      schoolName: "Fictional Cash School", admissionNo: "QA-31", parentName: "Fictional Guardian" });
    expect(receipt.feeItems.map((f: any) => f.name)).toEqual(["Tuition", "Transport"]);
    expect(await counts()).toEqual({ payments: 1, receipts: 1, audits: 1 });
    expect((await pool.query("SELECT paid_minor,outstanding_minor,status FROM fee_invoices WHERE id=41")).rows[0])
      .toEqual({ paid_minor: 50000, outstanding_minor: 0, status: "PAID" });
  });
  it.each(["PARENT", "STUDENT", "TEACHER", "STAFF", "PLATFORM_OWNER"])("does not give %s school cash authority", async role => {
    expect((await post({}, { "x-test-role": role })).status).toBe(404);
    expect(await counts()).toEqual({ payments: 0, receipts: 0, audits: 0 });
  });
  it("masks a different school's invoice", async () => {
    expect((await post({}, {}, 43)).status).toBe(404);
    expect((await post({}, { "x-test-school": "2" })).status).toBe(404);
    expect((await counts()).payments).toBe(0);
  });
  it("serializes simultaneous exact retries into a single receipt and balance update", async () => {
    const responses = await Promise.all([post(), post(), post()]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 200, 201]);
    const values = await Promise.all(responses.map(async r => await r.json() as { receiptNumber: string }));
    expect(new Set(values.map(v => v.receiptNumber)).size).toBe(1);
    expect(await counts()).toEqual({ payments: 1, receipts: 1, audits: 1 });
  });
  it("rejects changes to a successful key including the declared collection date", async () => {
    expect((await post()).status).toBe(201);
    expect((await post({ receivedOn: "2026-01-03" })).status).toBe(409);
    expect((await post({ amountMinor: 49999 })).status).toBe(409);
    expect((await counts()).payments).toBe(1);
  });
  it("fails closed if the sole allocation trigger is disabled", async () => {
    await pool.query("ALTER TABLE fee_payments DISABLE TRIGGER fee_payment_allocate_lines");
    expect((await post({ lineIds: [1,2] })).status).toBe(500);
    expect(await counts()).toEqual({ payments: 0, receipts: 0, audits: 0 });
    expect((await pool.query("SELECT count(*)::int n FROM fee_payment_line_allocations")).rows[0].n).toBe(0);
  });
  const pendingTransfer = async () => (await pool.query(`INSERT INTO fee_payments
    (school_id,invoice_id,student_id,parent_id,reference,idempotency_key,amount_minor,currency,method,provider,status,
      transfer_bank,transfer_reference,selected_line_ids)
    VALUES(1,41,31,21,'FICTIONAL-TRANSFER','fictional-transfer-key',50000,'NGN','BANK_TRANSFER','MANUAL_BANK_TRANSFER',
      'PENDING','Fictional Bank','FICTIONAL-BANK-REF',ARRAY[1,2]) RETURNING id`)).rows[0].id;
  const verifyTransfer = (id:number) => fetch(`${base}/school/finance/payments/${id}/verify?schoolId=1`,{
    method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({evidenceReference:"FICTIONAL-VERIFIED-BANK",reviewerNotes:"Fictional bank verification only"}),
  });
  it("prelocks provider/reconciliation rows as invoice then payment then checkout in PostgreSQL",async()=>{
    const paymentId=await pendingTransfer();
    const client=await pool.connect(), statements:string[]=[];
    try {
      await beginFinancialTransaction(client);
      await lockFeePaymentRows({query:async(sql,values)=>{
        statements.push(sql);return client.query(sql,values);
      }},{paymentId,schoolId:1});
      expect(statements).toHaveLength(4);
      expect(statements[1]).toContain("FROM fee_invoices");
      expect(statements[2]).toContain("FROM fee_payments");
      expect(statements[3]).toContain("FROM fee_provider_checkout_sessions");
    } finally {await client.query("ROLLBACK");client.release();}
  });
  it("verifies simultaneous bank-transfer retries with exactly one trigger allocation and receipt",async()=>{
    const id=await pendingTransfer();
    const responses=await Promise.all([verifyTransfer(id),verifyTransfer(id)]);
    expect(responses.map(r=>r.status)).toEqual([200,200]);
    expect(await counts()).toEqual({payments:1,receipts:1,audits:2});
    expect((await pool.query("SELECT count(*)::int n FROM audit_logs WHERE action='payment: verified manual bank transfer'")).rows[0].n).toBe(1);
    expect((await pool.query("SELECT count(*)::int n,sum(amount_minor)::int amount FROM fee_payment_line_allocations")).rows[0])
      .toEqual({n:2,amount:50000});
  });
  it("serializes bank verification against cash without double credit or allocation",async()=>{
    const id=await pendingTransfer();
    const responses=await Promise.all([verifyTransfer(id),post()]);
    expect(responses.filter(r=>r.status<300)).toHaveLength(1);
    expect(responses.filter(r=>r.status>=400)).toHaveLength(1);
    expect((await pool.query("SELECT paid_minor,outstanding_minor FROM fee_invoices WHERE id=41")).rows[0])
      .toEqual({paid_minor:50000,outstanding_minor:0});
    expect((await pool.query("SELECT count(*)::int n,sum(amount_minor)::int amount FROM fee_payment_line_allocations")).rows[0])
      .toEqual({n:2,amount:50000});
    expect((await counts()).receipts).toBe(1);
  });
  it("replays internal refund requests and approval without repeating the invoice debit",async()=>{
    const cash=await post();expect(cash.status).toBe(201);
    const id=(await cash.json() as {id:number}).id;
    const request=()=>fetch(`${base}/school/finance/payments/${id}/refunds?schoolId=1`,{
      method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":"fictional-refund-key"},
      body:JSON.stringify({amountMinor:10000,reason:"Fictional internal refund only",transactionType:"REFUND"}),
    });
    const requested=await Promise.all([request(),request()]);
    expect(requested.map(r=>r.status)).toEqual([201,201]);
    const refund=(await requested[0].json() as {id:number}).id;
    const approve=()=>fetch(`${base}/school/finance/refunds/${refund}/approve?schoolId=1`,{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({evidenceReference:"FICTIONAL-REFUND-EVIDENCE",reviewerNotes:"Fictional independently reviewed refund"}),
    });
    expect((await Promise.all([approve(),approve()])).map(r=>r.status)).toEqual([200,200]);
    expect((await pool.query("SELECT count(*)::int n FROM fee_refunds")).rows[0].n).toBe(1);
    expect((await pool.query("SELECT paid_minor,outstanding_minor FROM fee_invoices WHERE id=41")).rows[0])
      .toEqual({paid_minor:40000,outstanding_minor:10000});
    expect((await counts()).receipts).toBe(1);
    expect((await pool.query("SELECT status FROM fee_payments WHERE id=$1",[id])).rows[0].status).toBe("VERIFIED");
  });
  it("supports legacy omission and safe replay without inventing a new collection date", async () => {
    expect((await post({ receivedOn: undefined })).status).toBe(201);
    expect((await post({ receivedOn: undefined })).status).toBe(200);
  });
  it.each(["2026-02-30", "2099-01-01", "2025-12-31", "not-a-date"])("refuses invalid collection date %s without a write", async receivedOn => {
    expect((await post({ receivedOn })).status).toBe(400);
    expect((await counts()).payments).toBe(0);
  });
  it("uses the Nigerian calendar rather than the UTC date at midnight boundaries", () => {
    expect(cashCollectionDate(undefined, "2026-01-01", new Date("2026-01-01T23:30:00Z"))).toBe("2026-01-02");
  });
  it("honors ordinary fee partial-payment settings", async () => {
    expect((await post({ amountMinor: 10000 })).status).toBe(400);
    await pool.query("UPDATE fee_school_settings SET partial_payments_enabled=true WHERE school_id=1");
    expect((await post({ amountMinor: 10000 })).status).toBe(201);
    expect((await pool.query("SELECT paid_minor,outstanding_minor,status FROM fee_invoices WHERE id=41")).rows[0])
      .toEqual({ paid_minor: 10000, outstanding_minor: 40000, status: "PARTIALLY_PAID" });
  });
  it("retains explicit line allocations for subsequent selections and category receipts", async () => {
    expect((await post({ amountMinor: 30000, lineIds: [1] })).status).toBe(201);
    expect((await pool.query("SELECT line_id,amount_minor FROM fee_payment_line_allocations")).rows)
      .toEqual([{ line_id: 1, amount_minor: 30000 }]);
    expect((await post({ amountMinor: 20000, lineIds: [2], evidenceReference: "FICTIONAL-CASH-TWO" }, {}, 41, "second-key")).status).toBe(201);
    expect((await counts()).receipts).toBe(2);
    expect((await pool.query("SELECT status FROM fee_invoices WHERE id=41")).rows[0].status).toBe("PAID");
  });
  it("rejects selected lines from another invoice and an incorrect selected amount", async () => {
    expect((await post({ lineIds: [3] })).status).toBe(409);
    expect((await post({ amountMinor: 29999, lineIds: [1] })).status).toBe(400);
    expect((await counts()).payments).toBe(0);
  });
  it("does not turn unreconciled historical NFC fee lines into new cash subscriptions", async () => {
    await pool.query("UPDATE fee_invoice_lines SET category_name_snapshot='NFC Card & EduCore Subscription Fee' WHERE id=1");
    expect((await post({ amountMinor: 30000, lineIds: [1] })).status).toBe(403);
    expect((await post()).status).toBe(409);
    expect((await counts()).payments).toBe(0);
  });
  it("does not reuse one cash reference across two invoices, including concurrent requests", async () => {
    const responses = await Promise.all([post(), post({}, {}, 42, "different-key")]);
    expect(responses.map(r => r.status).sort()).toEqual([201, 409]);
    expect((await counts()).payments).toBe(1);
  });
  it("rolls back payment, line allocations, balances and audit if receipt persistence fails", async () => {
    await pool.query(`CREATE OR REPLACE FUNCTION fixture_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'fictional receipt failure'; END $$;
      CREATE TRIGGER fixture_receipt_failure BEFORE INSERT ON fee_receipts FOR EACH ROW EXECUTE FUNCTION fixture_receipt_failure()`);
    expect((await post({ amountMinor: 30000, lineIds: [1] })).status).toBe(500);
    expect(await counts()).toEqual({ payments: 0, receipts: 0, audits: 0 });
    expect((await pool.query("SELECT paid_minor FROM fee_invoices WHERE id=41")).rows[0].paid_minor).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS n FROM fee_payment_line_allocations")).rows[0].n).toBe(0);
  });
  it("exposes the original receipt only to the correct school, parent or student", async () => {
    const payment = await (await post()).json() as { id: number };
    const get = (role: string, user: number, school = 1) => fetch(`${base}/finance/payments/${payment.id}/receipt?schoolId=${school}`, {
      headers: { "x-test-role": role, "x-test-user": String(user), "x-test-school": String(school) },
    });
    expect((await get("ACCOUNTANT", 9)).status).toBe(200);
    expect((await get("PARENT", 19)).status).toBe(200);
    expect((await get("STUDENT", 39)).status).toBe(200);
    expect((await get("PARENT", 29, 2)).status).toBe(404);
    expect((await get("STUDENT", 49, 2)).status).toBe(404);
    expect((await get("ACCOUNTANT", 29, 2)).status).toBe(404);
    await pool.query("UPDATE parent_student_relationships SET status='INACTIVE' WHERE parent_id=21");
    expect((await get("PARENT", 19)).status).toBe(404);
  });
});
