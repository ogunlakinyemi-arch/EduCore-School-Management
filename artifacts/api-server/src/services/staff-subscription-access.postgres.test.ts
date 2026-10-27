import assert from "node:assert/strict";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readStaffSubscriptionAccess } from "./staff-subscription-access";

const root = process.env.EDUCORE_STAFF_ACCESS_ROOT;
const suite = root ? describe : describe.skip;
suite("staff access SQL on a verified disposable PostgreSQL fixture", () => {
  let pool: Pool;
  beforeAll(async () => {
    assert.equal(process.env.NODE_ENV, "test");
    assert.deepEqual(Object.keys(process.env).filter(k => /^(?:PG|DATABASE|FLUTTERWAVE|REPLIT_)|SECRET|TOKEN|PASSWORD|API_KEY/.test(k)), []);
    assert.match(root!, /^\/tmp\/educore-staff-access-[^/]+$/);
    const data = join(root!, "data"), socket = join(root!, "socket"), port = process.env.EDUCORE_STAFF_ACCESS_PORT!;
    const pid = readFileSync(join(data, "postmaster.pid"), "utf8").trim().split("\n");
    assert.equal(realpathSync(pid[1]), realpathSync(data)); assert.equal(pid[3], port); assert.equal(pid[4], socket);
    const argv = readFileSync(`/proc/${pid[0]}/cmdline`, "utf8").split("\0");
    assert.equal(argv[argv.indexOf("-D") + 1], data); assert.equal(argv[argv.indexOf("-h") + 1], "");
    assert.equal(statSync(join(socket, `.s.PGSQL.${port}`)).isSocket(), true);
    pool = new Pool({host: socket, port: Number(port), user: "staff_access_qa", database: "postgres",
      max: 1, connectionTimeoutMillis: 2000, statement_timeout: 3000});
    const id = (await pool.query(`SELECT current_setting('data_directory') AS data,
      current_setting('listen_addresses') AS listen,current_database() AS db,current_user AS role`)).rows[0];
    assert.equal(realpathSync(id.data), realpathSync(data)); assert.equal(id.listen, "");
    assert.equal(id.db, "postgres"); assert.equal(id.role, "staff_access_qa");
    // Minimal fictional query fixtures, NOT the full application schema/migrations.
    await pool.query(`
      CREATE TABLE employees(id int PRIMARY KEY,user_id int,school_id int,employment_status text,employee_type text);
      CREATE TABLE academic_sessions(id int PRIMARY KEY,school_id int,is_current boolean,status text);
      CREATE TABLE academic_terms(id int PRIMARY KEY,school_id int,academic_session_id int,is_current boolean,status text,start_date date,end_date date);
      CREATE TABLE staff_nfc_subscriptions(id int PRIMARY KEY,employee_id int,school_id int,academic_session_id int,academic_term_id int,status text,price_minor int);
      CREATE TABLE staff_nfc_payments(id int PRIMARY KEY,subscription_id int,employee_id int,school_id int,academic_session_id int,
        academic_term_id int,status text,provider text,provider_mode text,provider_transaction_id text,paid_at timestamptz,currency text,gross_amount_minor int);
      INSERT INTO employees VALUES(1,9,1,'ACTIVE','TEACHER');
      INSERT INTO academic_sessions VALUES(1,1,true,'ACTIVE');
      INSERT INTO academic_terms VALUES(1,1,1,true,'ACTIVE',CURRENT_DATE-1,CURRENT_DATE+1);
      INSERT INTO staff_nfc_subscriptions VALUES(1,1,1,1,1,'PAID',200000);
      INSERT INTO staff_nfc_payments VALUES(1,1,1,1,1,1,'PAID','FLUTTERWAVE','SANDBOX','12345',NOW(),'NGN',200000);
    `);
  });
  afterAll(async () => { if (pool) await pool.end(); });
  const access = () => readStaffSubscriptionAccess(pool, 9, 1);
  async function changed(sql: string, check: () => Promise<void>) {
    await pool.query("BEGIN");
    try { await pool.query(sql); await check(); }
    finally { await pool.query("ROLLBACK"); }
  }
  it("allows only a matching verified current-term employee payment", async () => {
    expect(await access()).toMatchObject({ restricted: false, status: "PAID", termId: 1, priceMinor: 200000 });
    expect((await readStaffSubscriptionAccess(pool, 10, 1)).restricted).toBe(true);
    expect((await readStaffSubscriptionAccess(pool, 9, 2)).restricted).toBe(true);
  });
  it.each([
    "UPDATE staff_nfc_payments SET status='PENDING'",
    "UPDATE staff_nfc_payments SET status='FAILED'",
    "UPDATE staff_nfc_payments SET provider='MOCK'",
    "UPDATE staff_nfc_payments SET academic_term_id=99",
    "UPDATE staff_nfc_payments SET employee_id=99",
    "UPDATE staff_nfc_payments SET school_id=99",
    "UPDATE staff_nfc_payments SET gross_amount_minor=320000",
    "UPDATE staff_nfc_payments SET provider_transaction_id=NULL",
    "UPDATE staff_nfc_subscriptions SET status='REFUNDED'",
    "UPDATE academic_terms SET end_date=CURRENT_DATE-1",
    "UPDATE employees SET employment_status='INACTIVE'",
  ])("denies non-entitlement: %s", async sql => {
    await changed(sql, async () => expect((await access()).restricted).toBe(true));
  });
  it("does not inherit a paid previous term and restores on fresh verified success", async () => {
    await changed(`UPDATE academic_terms SET is_current=false;
      INSERT INTO academic_terms VALUES(2,1,1,true,'ACTIVE',CURRENT_DATE-1,CURRENT_DATE+20)`, async () => {
      expect(await access()).toMatchObject({ restricted: true, termId: 2, status: "UNPAID" });
    });
    expect((await access()).restricted).toBe(false);
  });
  it("never treats SANDBOX as Production coverage", async () => {
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try { expect((await access()).restricted).toBe(true); }
    finally { process.env.NODE_ENV = before; }
  });
});
