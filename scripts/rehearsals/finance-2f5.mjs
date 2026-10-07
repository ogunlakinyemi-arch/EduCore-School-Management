// Disposable-only Finance rehearsal. Never imports @workspace/db or reads DATABASE_URL.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const root = process.cwd();
const requireDb = createRequire(path.join(root, "lib/db/package.json"));
const requireApi = createRequire(path.join(root, "artifacts/api-server/package.json"));
const { Pool, Client } = requireDb("pg");
const { drizzle } = requireDb("drizzle-orm/node-postgres");
const esbuild = requireApi("esbuild");
const base = (await fs.readFile("/tmp/educore-2f5-active-path", "utf8")).trim();
assert.match(base, /^\/tmp\/educore-finance-2f5-[A-Za-z0-9]+$/);
const host = path.join(base, "socket");
const config = { host, port: 55485, user: "finance_rehearsal", password: "", max: 12,
  connectionTimeoutMillis: 4000, options: "-c statement_timeout=30000 -c lock_timeout=10000" };
const reportDir = path.join(root, "reports/finance-2f5");
await fs.mkdir(reportDir, { recursive: true });
const report = { environment: {}, tests: [], catalog: {}, preservation: {}, reconciliation: {},
  safety: { productionConnections: 0, developmentConnections: 0, productionWrites: 0,
    developmentWrites: 0, migration0060Created: false, journalChanged: false,
    applicationChanged: false, published: false, secretsChanged: false, realFinanceChanged: false },
  limitations: ["Minimal synthetic application prerequisites, not a full application migration-chain replay.",
    "Verification/webhook overlap tests their actual shared finalizer, not HTTP authentication/signature handling.",
    "Concurrent checkout tests exercise INSERT uniqueness, not HTTP checkout/provider-initialization leases.",
    "Drizzle migration execution uses its real dialect/session with an in-memory migration payload; no file journal is created or changed."] };
const hash = x => createHash("sha256").update(x).digest("hex");
const qn = x => '"' + x.replaceAll('"', '""') + '"';
const sqlLiteral = x => "'" + x.replaceAll("'", "''") + "'";
const payment = "student_subscription_payments", allocation = "student_subscription_allocations";
const tables = [payment, allocation];
const protectedPaths = ["lib/db/src/schema/student-subscription-billing.ts",
  "lib/db/drizzle/0036_student_subscription_allocations.sql", "lib/db/drizzle/meta/_journal.json",
  "artifacts/api-server/src/lib/student-subscription-billing.ts"];
const beforeHashes = Object.fromEntries(await Promise.all(protectedPaths.map(async p => [p, hash(await fs.readFile(p))])));
const control = new Client({ ...config, database: "postgres" });
await control.connect();
const identity = (await control.query(`SELECT version(),current_setting('data_directory') data,
 current_setting('listen_addresses') listeners,current_setting('port') port,current_database() db`)).rows[0];
assert.equal(identity.data, path.join(base, "data"));
assert.equal(identity.listeners, "");
assert.equal(identity.port, "55485");
report.environment = { ...identity, host, isolated: true, production: false, development: false,
  databases: ["finance_2f5_empty","finance_2f5_historical","finance_2f5_current"] };
const pools = [];
async function createDB(suffix) {
  const database = "finance_2f5_" + suffix;
  assert.match(database, /^finance_2f5_[a-z]+$/);
  await control.query(`CREATE DATABASE ${qn(database)}`);
  const pool = new Pool({ ...config, database });
  pools.push(pool);
  assert.equal((await pool.query("SELECT current_setting('data_directory') data")).rows[0].data, identity.data);
  return pool;
}
async function test(group, name, fn) {
  try { const evidence = await fn(); report.tests.push({ group, name, status: "PASS", evidence: evidence ?? null }); }
  catch (e) { report.tests.push({ group, name, status: "FAIL", expected: "Assertions pass with prescribed PostgreSQL behavior",
    actual: e.message, sqlstate: e.code ?? null, likelyCause: "See assertion and PostgreSQL diagnostics; no application correction applied",
    sourceOnlyCorrectionPossible: "Requires investigation; rehearsal code/schema may be corrected without shared-database access" }); }
  console.log(report.tests.at(-1).status, group, name);
}
async function reject(pool, query, values, code, constraint, message) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    try { await c.query(query, values); assert.fail("Expected rejection: " + query); }
    catch (e) {
      assert.equal(e.code, code);
      if (constraint) assert.equal(e.constraint, constraint);
      if (message) assert.equal(e.message, message);
      return { sqlstate: e.code, constraint: e.constraint ?? null, message: e.message };
    }
  } finally { await c.query("ROLLBACK"); c.release(); }
}
const prerequisite = `
CREATE TABLE app_users(id integer PRIMARY KEY);
CREATE TABLE schools(id integer PRIMARY KEY,name text NOT NULL);
CREATE TABLE students(id integer PRIMARY KEY,school_id integer NOT NULL REFERENCES schools(id),
 first_name text,last_name text,status text NOT NULL DEFAULT 'active',
 CONSTRAINT students_id_school_tenant_key UNIQUE(id,school_id));
CREATE TABLE academic_sessions(id integer PRIMARY KEY,school_id integer NOT NULL REFERENCES schools(id),
 name text,status text,is_current boolean,start_date date,end_date date,
 CONSTRAINT academic_sessions_id_school_tenant_key UNIQUE(id,school_id));
CREATE TABLE academic_terms(id integer PRIMARY KEY,school_id integer NOT NULL REFERENCES schools(id),
 academic_session_id integer NOT NULL REFERENCES academic_sessions(id),name text,status text,is_current boolean,
 start_date date,end_date date,CONSTRAINT academic_terms_id_school_tenant_key UNIQUE(id,school_id),
 CONSTRAINT academic_terms_nfc_session_key UNIQUE(id,school_id,academic_session_id));
CREATE TABLE partner_profiles(id integer PRIMARY KEY,status text);
CREATE TABLE school_partner_attributions(id integer PRIMARY KEY,school_id integer REFERENCES schools(id),
 partner_profile_id integer REFERENCES partner_profiles(id),is_current boolean,status text,starts_at timestamptz,ends_at timestamptz);
CREATE UNIQUE INDEX school_partner_attributions_id_partner_uq ON school_partner_attributions(id,partner_profile_id);
CREATE TABLE commission_rules(id integer PRIMARY KEY,status text,currency text,term text,effective_at timestamptz,
 ends_at timestamptz,allocation_total numeric,school_amount numeric,partner_amount numeric,edupulse_amount numeric);
CREATE TABLE subscriptions(id integer PRIMARY KEY,school_id integer REFERENCES schools(id),student_id integer REFERENCES students(id),
 term text,status text DEFAULT 'pending',verification_status text DEFAULT 'pending',provider text,provider_reference text,
 partner_profile_id integer REFERENCES partner_profiles(id),partner_share numeric,school_share numeric,edupulse_share numeric,
 allocation_snapshot jsonb,expires_at timestamptz,amount numeric(12,2) NOT NULL DEFAULT 5000,
 CONSTRAINT subscriptions_partner_allocation_integrity CHECK(partner_profile_id IS NULL OR
 (partner_share IS NOT NULL AND amount=school_share+edupulse_share+partner_share)));
CREATE UNIQUE INDEX subscriptions_id_school_student_uq ON subscriptions(id,school_id,student_id);
CREATE TABLE commission_ledger(id serial PRIMARY KEY,partner_profile_id integer REFERENCES partner_profiles(id),
 school_id integer REFERENCES schools(id),student_id integer REFERENCES students(id),subscription_id integer REFERENCES subscriptions(id),
 commission_rule_id integer REFERENCES commission_rules(id),academic_session_id integer REFERENCES academic_sessions(id),
 term text,rate numeric,count integer,amount numeric,currency text,status text,created_by integer REFERENCES app_users(id),
 CONSTRAINT commission_ledger_amount_nonnegative CHECK(amount>=0 AND count>0),
 CONSTRAINT commission_ledger_status_check CHECK(status IN ('PENDING','APPROVED','PAYABLE','PAID','HELD','REVERSED','CANCELLED')));
CREATE UNIQUE INDEX commission_ledger_subscription_period_unique ON commission_ledger(subscription_id,term);
CREATE TABLE nfc_cards(id integer PRIMARY KEY,school_id integer REFERENCES schools(id),student_id integer,status text,
 FOREIGN KEY(student_id,school_id) REFERENCES students(id,school_id));
CREATE TABLE school_branding_logos(id integer PRIMARY KEY,school_id integer REFERENCES schools(id),is_current boolean);
CREATE TABLE fee_invoices(id integer PRIMARY KEY,school_id integer REFERENCES schools(id),
 CONSTRAINT fee_invoices_id_school_unique UNIQUE(id,school_id));
`;
const binding = await fs.readFile(path.join(root, "lib/db/drizzle/0058_student_subscription_terms.sql"), "utf8");
async function prerequisites(pool) {
  await pool.query(prerequisite);
  await pool.query(binding.slice(binding.indexOf("CREATE TABLE student_subscription_terms")));
}
const historical = await fs.readFile(path.join(root, "lib/db/drizzle/0036_student_subscription_allocations.sql"), "utf8");
const noParentIndexes = historical.slice(historical.indexOf("CREATE TABLE student_subscription_payments"));
let canonical = noParentIndexes.replaceAll("student_subscription_payments_money_ck", "student_subscription_payments_gross_ck")
  .replace("student_id integer NOT NULL,\n  payer_user_id", "student_id integer NOT NULL REFERENCES students(id) ON DELETE RESTRICT,\n  payer_user_id")
  .replace("attribution_id integer,", "attribution_id integer REFERENCES school_partner_attributions(id) ON DELETE RESTRICT,");
await fs.writeFile(path.join(reportDir, "canonical-disposable-build.sql"), canonical);
// Compile unchanged source without importing the DB entry point or provider runtime.
await esbuild.build({ entryPoints: [path.join(root, "artifacts/api-server/src/lib/student-subscription-billing.ts")],
 bundle: true, platform: "node", format: "cjs", outfile: path.join(base, "writer.cjs") });
const { finalizeVerifiedStudentSubscriptionPayment: finalize } = requireApi(path.join(base, "writer.cjs"));
const schemaBuild = await esbuild.build({ stdin: { resolveDir: path.join(root, "lib/db"),
 contents: `import {studentSubscriptionPayments as p,studentSubscriptionAllocations as a} from './src/schema/student-subscription-billing';
 import {getTableConfig} from 'drizzle-orm/pg-core'; import {PgDialect} from 'drizzle-orm/pg-core';
 export {p,a,getTableConfig,PgDialect};` }, bundle: true, platform: "node", format: "cjs", metafile: true,
 outfile: path.join(base, "schema.cjs") });
assert(!Object.keys(schemaBuild.metafile.inputs).some(p => p.endsWith("lib/db/src/index.ts")));
const schema = requireDb(path.join(base, "schema.cjs")), dialect = new schema.PgDialect();
const expression = v => dialect.sqlToQuery(v).sql.replace(/"student_subscription_(?:payments|allocations)"\./g, "");
function renderCurrent(t) {
  const cfg = schema.getTableConfig(t), lines = cfg.columns.map(c => `${qn(c.name)} ${c.getSQLType()}${c.notNull ? " NOT NULL" : ""}${c.primary ? " PRIMARY KEY" : ""}${c.default === undefined ? "" : " DEFAULT " + (typeof c.default === "string" ? sqlLiteral(c.default) : typeof c.default === "number" ? String(c.default) : expression(c.default))}`);
  for (const c of cfg.checks) lines.push(`CONSTRAINT ${qn(c.name)} CHECK (${expression(c.value)})`);
  for (const f of cfg.foreignKeys) {
    const r = f.reference();
    lines.push(`CONSTRAINT ${qn(f.getName())} FOREIGN KEY (${r.columns.map(c => qn(c.name)).join(",")})
      REFERENCES ${qn(schema.getTableConfig(r.foreignTable).name)} (${r.foreignColumns.map(c => qn(c.name)).join(",")})
      ON DELETE ${f.onDelete ?? "no action"} ON UPDATE ${f.onUpdate ?? "no action"}`);
  }
  let sql = `CREATE TABLE ${qn(cfg.name)} (${lines.join(",\n")});\n`;
  for (const i of cfg.indexes) {
    const x = i.config;
    sql += `CREATE ${x.unique ? "UNIQUE " : ""}INDEX ${qn(x.name)} ON ${qn(cfg.name)} (${x.columns.map(c => `${qn(c.name)} ${c.indexConfig?.order ?? "asc"}`).join(",")})${x.where ? " WHERE " + expression(x.where) : ""};\n`;
  }
  return sql;
}
const currentSQL = renderCurrent(schema.p) + renderCurrent(schema.a);
await fs.writeFile(path.join(reportDir, "current-source-shape.sql"), currentSQL);
async function catalog(pool) {
  const columns = (await pool.query(`SELECT table_name,column_name,ordinal_position,data_type,is_nullable,column_default,is_identity
    FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1) ORDER BY table_name,ordinal_position`, [tables])).rows;
  const constraints = (await pool.query(`SELECT t.relname table_name,c.conname name,c.contype type,pg_get_constraintdef(c.oid) definition,
    c.confdeltype,c.confupdtype,c.confmatchtype,c.condeferrable,c.condeferred,c.convalidated
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname=ANY($1) ORDER BY t.relname,c.conname`, [tables])).rows;
  const indexes = (await pool.query(`SELECT t.relname table_name,x.relname name,pg_get_indexdef(i.indexrelid) definition,
    pg_get_expr(i.indpred,i.indrelid) predicate,i.indisunique,i.indimmediate,i.indisvalid,
    (SELECT c.conname FROM pg_constraint c WHERE c.conindid=i.indexrelid AND c.contype IN ('p','u')) owner
    FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_class x ON x.oid=i.indexrelid
    WHERE t.relname=ANY($1) ORDER BY t.relname,x.relname`, [tables])).rows;
  const functions = (await pool.query(`SELECT proname name,pg_get_functiondef(p.oid) definition,provolatile,proparallel,prosecdef
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
    AND proname LIKE 'protect_student_subscription_%' ORDER BY proname`)).rows;
  const triggers = (await pool.query(`SELECT c.relname table_name,t.tgname name,pg_get_triggerdef(t.oid) definition,t.tgenabled
    FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relname=ANY($1)
    ORDER BY c.relname,t.tgname`, [tables])).rows;
  const sequences = (await pool.query(`SELECT t.relname table_name,a.attname column_name,s.relname sequence_name,d.deptype,a.attidentity
    FROM pg_depend d JOIN pg_class s ON s.oid=d.objid AND s.relkind='S' JOIN pg_class t ON t.oid=d.refobjid
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid
    WHERE t.relname=ANY($1) ORDER BY t.relname`, [tables])).rows;
  return { columns, constraints, indexes, functions, triggers, sequences };
}
async function fingerprint(pool) {
  return Object.fromEntries(await Promise.all(tables.map(async t => [t, hash(JSON.stringify(
    (await pool.query(`SELECT to_jsonb(t) row FROM ${qn(t)} t ORDER BY id`)).rows))])));
}
async function seed(pool) {
  await pool.query(`TRUNCATE student_subscription_allocations,student_subscription_payments,commission_ledger,student_subscription_terms,
   nfc_cards,school_branding_logos,fee_invoices,subscriptions,school_partner_attributions,commission_rules,
   partner_profiles,academic_terms,academic_sessions,students,schools,app_users RESTART IDENTITY CASCADE;
   INSERT INTO app_users VALUES(101),(102);
   INSERT INTO schools VALUES(1,'Synthetic School A'),(2,'Synthetic School B');
   INSERT INTO students VALUES(11,1,'Fixture','A','active'),(12,2,'Fixture','B','active');
   INSERT INTO academic_sessions VALUES(21,1,'Fixture Session A','ACTIVE',true,CURRENT_DATE-10,CURRENT_DATE+40),
     (22,2,'Fixture Session B','ACTIVE',true,CURRENT_DATE-10,CURRENT_DATE+40);
   INSERT INTO academic_terms VALUES(31,1,21,'Fixture Term','ACTIVE',true,CURRENT_DATE-5,CURRENT_DATE+30),
     (32,2,22,'Fixture Term','ACTIVE',true,CURRENT_DATE-5,CURRENT_DATE+30);
   INSERT INTO partner_profiles VALUES(51,'ACTIVE');
   INSERT INTO school_partner_attributions VALUES(71,1,51,true,'ACTIVE',NOW()-INTERVAL '1 day',NULL);
   INSERT INTO commission_rules VALUES(61,'ACTIVE','NGN',NULL,NOW()-INTERVAL '1 day',NULL,5000,2000,100,2900);
   INSERT INTO subscriptions(id,school_id,student_id,term,status,verification_status,provider,school_share,edupulse_share,expires_at)
     VALUES(41,1,11,'Fixture Term','pending','pending','FLUTTERWAVE',2000,3000,NOW()+INTERVAL '31 days'),
           (42,2,12,'Fixture Term','pending','pending','FLUTTERWAVE',2000,3000,NOW()+INTERVAL '31 days');
   INSERT INTO student_subscription_terms(school_id,student_id,academic_session_id,academic_term_id,subscription_id)
     VALUES(1,11,21,31,41),(2,12,22,32,42);
   INSERT INTO nfc_cards VALUES(81,1,11,'unassigned'),(82,2,12,'unassigned');
   INSERT INTO school_branding_logos VALUES(91,1,true),(92,2,true);`);
}
let counter = 0;
async function newPayment(pool, school = 2, overrides = {}) {
  const values = { subscription_id: school === 1 ? 41 : 42, school_id: school, student_id: school === 1 ? 11 : 12,
    academic_session_id: school === 1 ? 21 : 22, academic_term_id: school === 1 ? 31 : 32, payer_user_id: school === 1 ? 101 : 102,
    reference: "SYNTHETIC_" + (++counter).toString().padStart(6, "0"), idempotency_key: "fixture-key-" + counter, ...overrides };
  return (await pool.query(`INSERT INTO ${payment}(${Object.keys(values).map(qn).join(",")})
   VALUES(${Object.keys(values).map((_,i) => "$"+(i+1)).join(",")}) RETURNING *`, Object.values(values))).rows[0];
}
function verified(p, fee) {
  return { reference: p.reference,amountMinor:500000,currency:"NGN",providerTransactionId:String(900000+p.id),
    status:"successful",paidAt:new Date().toISOString(), ...(fee === undefined ? {} : { providerFeeMinor: fee }) };
}
async function insertAllocation(pool, p, overrides = {}) {
  const v = { idempotency_key:"alloc-fixture-"+(++counter),entry_type:"CREDIT",recipient_type:"SCHOOL",school_id:p.school_id,
    student_id:p.student_id,payer_user_id:p.payer_user_id,academic_session_id:p.academic_session_id,
    academic_term_id:p.academic_term_id,subscription_id:p.subscription_id,payment_id:p.id,amount_minor:200000,...overrides };
  return pool.query(`INSERT INTO ${allocation}(${Object.keys(v).map(qn).join(",")})
    VALUES(${Object.keys(v).map((_,i)=>"$"+(i+1)).join(",")}) RETURNING *`, Object.values(v));
}
const empty = await createDB("empty");
await prerequisites(empty);
const migrationObject = sql => [{ sql:[sql], hash:hash(sql),folderMillis:1791336059736,bps:true }];
const orm = drizzle(empty), runnerConfig = {migrationsSchema:"rehearsal_runner",migrationsTable:"applied"};
await orm.dialect.migrate(migrationObject(canonical),orm.session,runnerConfig);
const canonicalCatalog = await catalog(empty);
report.catalog.canonical = canonicalCatalog;
// Reconciliation generated from PostgreSQL's canonical catalog; unexpected differences fail closed.
const functionSQL = canonicalCatalog.functions.map(f => f.definition.replace("CREATE OR REPLACE FUNCTION","CREATE OR REPLACE FUNCTION")).join(";\n");
const triggerStatements = canonicalCatalog.triggers.map(t => `IF NOT EXISTS(SELECT FROM pg_trigger WHERE tgname=${sqlLiteral(t.name)}
 AND tgrelid=${sqlLiteral(t.table_name)}::regclass AND NOT tgisinternal) THEN EXECUTE ${sqlLiteral(t.definition)}; END IF;`).join("\n");
const defs = JSON.stringify(canonicalCatalog.constraints);
const reconciliation = `
DO $finance_reconcile$
DECLARE e jsonb; old record; candidate record; idx regclass; wanted text; normalized text;
BEGIN
 IF to_regclass('student_subscription_payments') IS NULL OR to_regclass('student_subscription_allocations') IS NULL THEN
  RAISE EXCEPTION 'Finance tables must both exist for reconciliation';
 END IF;
 IF EXISTS(SELECT FROM pg_constraint WHERE conrelid='student_subscription_payments'::regclass
   AND conname='student_subscription_payments_money_ck') THEN
  ALTER TABLE student_subscription_payments RENAME CONSTRAINT student_subscription_payments_money_ck TO student_subscription_payments_gross_ck;
 END IF;
 FOR e IN SELECT value FROM jsonb_array_elements(${sqlLiteral(defs)}::jsonb) LOOP
  wanted=e->>'definition';
  SELECT c.*,pg_get_constraintdef(c.oid) def INTO old FROM pg_constraint c
   WHERE c.conrelid=(e->>'table_name')::regclass AND c.conname=e->>'name';
  IF FOUND THEN
   IF old.def<>wanted THEN
    IF e->>'type'='f' AND replace(old.def,' ON DELETE RESTRICT','')=replace(wanted,' ON DELETE RESTRICT','') THEN
     EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',e->>'table_name',e->>'name');
     EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s',e->>'table_name',e->>'name',wanted);
    ELSE RAISE EXCEPTION 'Unexpected constraint mismatch: %',e->>'name'; END IF;
   END IF;
  ELSE
   SELECT c.*,pg_get_constraintdef(c.oid) def INTO candidate FROM pg_constraint c
    WHERE c.conrelid=(e->>'table_name')::regclass AND c.contype::text=e->>'type'
    AND replace(pg_get_constraintdef(c.oid),' ON DELETE RESTRICT','')=replace(wanted,' ON DELETE RESTRICT','')
    ORDER BY c.oid LIMIT 1;
   IF FOUND THEN
    EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I',e->>'table_name',candidate.conname,e->>'name');
    IF candidate.def<>wanted THEN
     EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I',e->>'table_name',e->>'name');
     EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s',e->>'table_name',e->>'name',wanted);
    END IF;
   ELSIF e->>'type'='u' AND to_regclass(e->>'name') IS NOT NULL THEN
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I UNIQUE USING INDEX %I',e->>'table_name',e->>'name',e->>'name');
   ELSE EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I %s',e->>'table_name',e->>'name',wanted);
   END IF;
  END IF;
 END LOOP;
END $finance_reconcile$;
${functionSQL};
DO $finance_triggers$ BEGIN ${triggerStatements} END $finance_triggers$;
`;
await fs.writeFile(path.join(reportDir, "disposable-reconciliation.sql"), reconciliation);
await test(1,"empty build and exact structure",async () => {
  assert.equal(canonicalCatalog.columns.filter(c=>c.table_name===payment).length,26);
  assert.equal(canonicalCatalog.columns.filter(c=>c.table_name===allocation).length,17);
  assert.deepEqual(canonicalCatalog.constraints.reduce((v,c)=>(v[c.table_name+":"+c.type]=(v[c.table_name+":"+c.type]||0)+1,v),{}),
    { [allocation+":c"]:4,[allocation+":f"]:10,[allocation+":p"]:1,[allocation+":u"]:1,
      [payment+":c"]:7,[payment+":f"]:4,[payment+":p"]:1,[payment+":u"]:1 });
  assert.equal(canonicalCatalog.indexes.filter(i=>!i.owner&&i.table_name===payment).length,7);
  assert.equal(canonicalCatalog.indexes.filter(i=>!i.owner&&i.table_name===allocation).length,5);
  for(const c of canonicalCatalog.constraints.filter(c=>c.type==="f")) {
    assert.equal(c.confdeltype,"r");assert.equal(c.confupdtype,"a");assert.equal(c.confmatchtype,"s");
    assert.equal(c.condeferrable,false);assert.equal(c.condeferred,false);assert.equal(c.convalidated,true);
  }
  assert.equal(canonicalCatalog.functions.length,2);assert.equal(canonicalCatalog.triggers.length,2);
  for(const t of canonicalCatalog.triggers) assert.equal(t.tgenabled,"O");
  assert.equal(canonicalCatalog.sequences.length,2);
  for(const s of canonicalCatalog.sequences){ assert.equal(s.deptype,"a");assert.equal(s.attidentity,""); }
  return { columns:43, constraints:29, indexes:16, functions:2,triggers:2 };
});
for(const [group,name,sql] of [[2,"historical",noParentIndexes],[3,"current",currentSQL]]) {
  await test(group,name+" reconciliation and preservation",async () => {
    const pool=await createDB(name); await prerequisites(pool); await pool.query(sql); await seed(pool);
    const p=await newPayment(pool,2); await insertAllocation(pool,p);
    await pool.query(`UPDATE ${payment} SET receipt_snapshot='{"synthetic":true}'::jsonb WHERE id=$1`,[p.id]);
    const before=await fingerprint(pool), old=await catalog(pool);
    await pool.query(reconciliation);
    const after=await fingerprint(pool), result=await catalog(pool);
    assert.deepEqual(after,before); assert.deepEqual(result,canonicalCatalog);
    await pool.query(reconciliation);assert.deepEqual(await catalog(pool),result);assert.deepEqual(await fingerprint(pool),after);
    report.preservation[name]={before,after,rowDifferences:0};
    report.reconciliation[name]={before:old,after:result};
    return {rowDifferences:0,exactCatalog:true,directRerunDrift:0};
  });
}
await test(4,"all composite parent targets immediately unique and non-partial",async () => {
  const rows=(await empty.query(`SELECT c.conname,i.indisunique,i.indimmediate,i.indisvalid,i.indpred IS NULL nonpartial
    FROM pg_constraint c JOIN pg_index i ON i.indexrelid=c.conindid
    WHERE c.conrelid IN ('student_subscription_payments'::regclass,'student_subscription_allocations'::regclass)
    AND c.contype='f'`)).rows;
  assert.equal(rows.length,14);
  for(const r of rows) for(const k of ["indisunique","indimmediate","indisvalid","nonpartial"]) assert.equal(r[k],true);
  return rows;
});
const trace=[];
function instrument(pool,{failAfter,delay=false}={}) {
  return {connect:async()=>{
    const c=await pool.connect();
    return { release:()=>c.release(),query:async(sql,values)=>{
      if(sql.includes("INSERT INTO student_subscription_allocations")) {
        const state=(await c.query(`SELECT status FROM ${payment} WHERE id=$1`,[values[10]])).rows[0].status;
        trace.push({phase:"allocation-insert",paymentStatus:state});
        if(delay) await c.query("SELECT pg_sleep(0.075)");
      }
      const result=await c.query(sql,values);
      if(sql.includes("UPDATE nfc_cards SET status='active'"))
        trace.push({phase:"nfc-activation",rowCount:result.rowCount});
      if(sql.includes("INSERT INTO commission_ledger"))
        trace.push({phase:"commission-insert",rowCount:result.rowCount});
      const match=failAfter && (failAfter==="subscription"&&sql.includes("SET status='active',verification_status='verified'")
       ||failAfter==="allocations"&&sql.includes("INSERT INTO student_subscription_allocations")
       ||failAfter==="ledger"&&sql.includes("INSERT INTO commission_ledger")
       ||failAfter==="nfc"&&sql.includes("UPDATE nfc_cards SET status='active'"));
      if(match) await c.query("SELECT 1/0");
      return result;
    }};
  }};
}
async function finish(pool,p,fee,opts) {
  return finalize(instrument(pool,opts),p.id,verified(p,fee),(school,id)=>`https://synthetic.invalid/logo/${school}/${id}`);
}
async function accounting(pool,p) {
  return (await pool.query(`SELECT entry_type,recipient_type,amount_minor FROM ${allocation} WHERE payment_id=$1 ORDER BY recipient_type`,[p.id])).rows;
}
await test(5,"unchanged finalizer ordering and activation",async()=>{
  await seed(empty);const p=await newPayment(empty);assert.equal(p.status,"PENDING");await finish(empty,p);
  const row=(await empty.query(`SELECT * FROM ${payment} WHERE id=$1`,[p.id])).rows[0];
  assert.equal(row.status,"PAID");assert.equal(row.settlement_status,"PENDING");assert.equal(row.reconciliation_status,"RECONCILED");
  assert(row.receipt_snapshot);assert(trace.length);for(const t of trace.filter(t=>t.phase==="allocation-insert"))assert.equal(t.paymentStatus,"PENDING");
  assert.equal((await empty.query("SELECT status FROM subscriptions WHERE id=42")).rows[0].status,"active");
  assert.equal((await empty.query("SELECT status FROM nfc_cards WHERE id=82")).rows[0].status,"active");
  return trace;
});
await test(6,"non-Partner exact revenue",async()=>{await seed(empty);const p=await newPayment(empty);await finish(empty,p);
  const rows=await accounting(empty,p);assert.deepEqual(rows,[{entry_type:"CREDIT",recipient_type:"PLATFORM",amount_minor:300000},{entry_type:"CREDIT",recipient_type:"SCHOOL",amount_minor:200000}]);return rows;});
await test(7,"Partner revenue and repeat completion",async()=>{await seed(empty);const p=await newPayment(empty,1);await finish(empty,p);const rows=await accounting(empty,p);
  assert.deepEqual(rows.map(r=>r.amount_minor),[10000,290000,200000]);assert.equal(rows.reduce((s,r)=>s+r.amount_minor,0),500000);
  const before=await fingerprint(empty);await finish(empty,p);assert.deepEqual(await fingerprint(empty),before);
  assert.equal((await empty.query("SELECT count(*)::int n FROM commission_ledger")).rows[0].n,1);return rows;});
for(const fee of [1234,0,undefined]) await test(8,"provider fee "+String(fee),async()=>{
  await seed(empty);const p=await newPayment(empty,1);await finish(empty,p,fee);const rows=await accounting(empty,p);
  assert.equal(rows.filter(r=>r.entry_type==="CREDIT").reduce((s,r)=>s+r.amount_minor,0),500000);
  assert.equal(rows.filter(r=>r.entry_type==="EXPENSE").length,fee>0?1:0);
  assert.equal((await empty.query(`SELECT provider_fee_minor n FROM ${payment} WHERE id=$1`,[p.id])).rows[0].n,fee??null);
  if(fee>0)assert.equal(rows.find(r=>r.entry_type==="EXPENSE").amount_minor,fee);return rows;});
await test(9,"receipt assignment equality unrelated updates and exact rejections",async()=>{
  await seed(empty);const p=await newPayment(empty);await empty.query(`UPDATE ${payment} SET receipt_snapshot='{"fixture":1}' WHERE id=$1`,[p.id]);
  await empty.query(`UPDATE ${payment} SET receipt_snapshot=receipt_snapshot,updated_at=NOW() WHERE id=$1`,[p.id]);
  const errors=[];for(const value of ['{"fixture":2}',null])errors.push(await reject(empty,`UPDATE ${payment} SET receipt_snapshot=$1 WHERE id=$2`,[value,p.id],"P0001",null,"Student subscription receipt snapshots are immutable"));return errors;});
await test(10,"allocation insert and immutability exact SQLSTATE",async()=>{
  await seed(empty);const p=await newPayment(empty);await insertAllocation(empty,p);
  const errors=[];for(const sql of [`UPDATE ${allocation} SET amount_minor=1`,`UPDATE ${allocation} SET amount_minor=amount_minor`,`DELETE FROM ${allocation}`])
    errors.push(await reject(empty,sql,[],"P0001",null,"Student subscription allocations are immutable"));return errors;});
await test(11,"all eight uniqueness guards",async()=>{
  await seed(empty);const p=await newPayment(empty);
  const dup=async(overrides,name)=>{const c=await empty.connect();try{await c.query("BEGIN");
    try{await newPayment(c,2,overrides);assert.fail("Duplicate accepted");}catch(e){assert.equal(e.code,"23505");assert.equal(e.constraint,name);}
    finally{await c.query("ROLLBACK");}}finally{c.release();}};
  await dup({reference:p.reference},"student_subscription_payments_reference_uq");
  await dup({idempotency_key:p.idempotency_key},"student_subscription_payments_subscription_idempotency_uq");
  await dup({},"student_subscription_payments_one_open_attempt_uq");
  await empty.query(`UPDATE ${payment} SET status='FAILED',reconciliation_status='RECONCILED',provider_transaction_id='555',failure_code='PROVIDER_VERIFIED_FAILED' WHERE id=$1`,[p.id]);
  await dup({provider_transaction_id:"555"},"student_subscription_payments_provider_transaction_uq");
  await empty.query("INSERT INTO subscriptions(id,school_id,student_id,term,expires_at) VALUES(43,2,12,'Fixture Term',NOW())");
  await empty.query(`UPDATE ${payment} SET status='PAID' WHERE id=$1`,[p.id]);
  await dup({subscription_id:43},"student_subscription_payments_one_business_term_uq");
  const a=(await insertAllocation(empty,p)).rows[0];
  for(const [overrides,name] of [[{idempotency_key:a.idempotency_key},"student_subscription_allocations_idempotency_uq"],
    [{},"student_subscription_allocations_payment_credit_recipient_uq"]]){
    const c=await empty.connect();try{await c.query("BEGIN");try{await insertAllocation(c,p,overrides);assert.fail("Duplicate accepted");}
      catch(e){assert.equal(e.code,"23505");assert.equal(e.constraint,name);}finally{await c.query("ROLLBACK");}}finally{c.release();}}
  await insertAllocation(empty,p,{entry_type:"EXPENSE",recipient_type:"PLATFORM_PROVIDER_FEE",amount_minor:100});
  const c=await empty.connect();try{await c.query("BEGIN");try{await insertAllocation(c,p,{entry_type:"EXPENSE",recipient_type:"PLATFORM_PROVIDER_FEE",amount_minor:100});assert.fail("Duplicate fee accepted");}
    catch(e){assert.equal(e.code,"23505");assert.equal(e.constraint,"student_subscription_allocations_payment_fee_expense_uq");}finally{await c.query("ROLLBACK");}}finally{c.release();}
  return {guards:8};});
await test(12,"uncertain provider mismatch safe retry",async()=>{
  await seed(empty);const p=await newPayment(empty);
  const result=await finalize(empty,p.id,{...verified(p),amountMinor:1});
  assert.equal(result.reconciliationRequired,true);
  const row=(await empty.query(`SELECT status,reconciliation_status FROM ${payment} WHERE id=$1`,[p.id])).rows[0];
  assert.equal(row.status,"RECONCILIATION_REQUIRED");assert.equal(row.reconciliation_status,"RECONCILIATION_REQUIRED");
  assert.equal((await accounting(empty,p)).length,0);
  assert.equal((await empty.query("SELECT status FROM subscriptions WHERE id=42")).rows[0].status,"pending");
  assert.equal((await empty.query("SELECT status FROM nfc_cards WHERE id=82")).rows[0].status,"unassigned");
  await reject(empty,`INSERT INTO ${payment}(subscription_id,school_id,student_id,academic_session_id,academic_term_id,payer_user_id,reference,idempotency_key)
    VALUES(42,2,12,22,32,102,'UNCERTAIN_RETRY','new-key')`,[],"23505");
  await finish(empty,p);assert.equal((await accounting(empty,p)).length,2);return row;});
await test(13,"nine cross-owner and attribution negatives",async()=>{
  await seed(empty);const p=await newPayment(empty);
  const cases=[["payment subscription",`UPDATE ${payment} SET subscription_id=41 WHERE id=$1`],
    ["payment student",`UPDATE ${payment} SET student_id=11 WHERE id=$1`],
    ["payment session",`UPDATE ${payment} SET academic_session_id=21 WHERE id=$1`],
    ["payment term",`UPDATE ${payment} SET academic_term_id=31 WHERE id=$1`]];
  for(const [,sql]of cases)await reject(empty,sql,[p.id],"23503");
  for(const change of [{student_id:11},{academic_session_id:21},{academic_term_id:31},{subscription_id:41},
    {recipient_type:"PARTNER",recipient_id:999,attribution_id:71,commission_rule_id:61}]){
    const c=await empty.connect();try{await c.query("BEGIN");try{await insertAllocation(c,p,change);assert.fail("Ownership accepted");}
      catch(e){assert.equal(e.code,"23503");}finally{await c.query("ROLLBACK");}}finally{c.release();}}
  return {negativeCases:9};});
await test(14,"historical allocation independently blocks student school change",async()=>{
  await seed(empty);const p=await newPayment(empty,1);await finish(empty,p);const before=await fingerprint(empty);
  // Remove the synthetic binding and NFC row in a rolled-back transaction so they do not mask the Finance FK.
  const c=await empty.connect();let error;
  try{await c.query("BEGIN");await c.query("DELETE FROM student_subscription_terms WHERE student_id=11");await c.query("DELETE FROM nfc_cards WHERE student_id=11");
    try{await c.query("UPDATE students SET school_id=2 WHERE id=11");assert.fail("School change accepted");}
    catch(e){assert.equal(e.code,"23503");assert.equal(e.constraint,"student_subscription_allocations_student_school_fk");error={sqlstate:e.code,constraint:e.constraint};}
  }finally{await c.query("ROLLBACK");c.release();}
  assert.deepEqual(await fingerprint(empty),before);assert.equal((await empty.query(`SELECT count(*)::int n FROM ${payment} WHERE school_id=2`)).rows[0].n,0);return error;});
await test(15,"eight parent deletion restrictions",async()=>{
  await seed(empty);const p=await newPayment(empty,1);await finish(empty,p);
  const errors=[];for(const sql of ["DELETE FROM students WHERE id=11","DELETE FROM schools WHERE id=1",
    "DELETE FROM academic_sessions WHERE id=21","DELETE FROM academic_terms WHERE id=31","DELETE FROM subscriptions WHERE id=41",
    "DELETE FROM app_users WHERE id=101","DELETE FROM school_partner_attributions WHERE id=71","DELETE FROM commission_rules WHERE id=61"]) {
    const c=await empty.connect();
    try {
      await c.query("BEGIN");
      // Remove only prerequisite FKs temporarily, so a non-Finance dependency cannot mask this assertion.
      const other=(await c.query(`SELECT t.relname,c.conname FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
        JOIN pg_namespace n ON n.oid=t.relnamespace WHERE c.contype='f' AND n.nspname='public' AND NOT t.relname=ANY($1)`,[tables])).rows;
      for(const r of other)await c.query(`ALTER TABLE ${qn(r.relname)} DROP CONSTRAINT ${qn(r.conname)}`);
      try { await c.query(sql);assert.fail("Referenced parent deletion accepted"); }
      catch(e){ assert.equal(e.code,"23503");assert(e.constraint.startsWith("student_subscription_"));
        errors.push({sqlstate:e.code,constraint:e.constraint}); }
    } finally {await c.query("ROLLBACK");c.release();}
  }
  return errors;
});
for(const phase of ["subscription","allocations","ledger","nfc"]) await test(16,"rollback after "+phase,async()=>{
  await seed(empty);const p=await newPayment(empty,1);const before=await fingerprint(empty);
  const state=async()=>JSON.stringify((await empty.query(`SELECT
    (SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM subscriptions s) subscriptions,
    (SELECT jsonb_agg(to_jsonb(n) ORDER BY id) FROM nfc_cards n) nfc,
    (SELECT jsonb_agg(to_jsonb(l) ORDER BY id) FROM commission_ledger l) ledger`)).rows);
  const beforeState=await state();
  try{await finish(empty,p,100,{failAfter:phase});assert.fail("Failure injection did not fire");}catch(e){assert.equal(e.code,"22012");}
  assert.deepEqual(await fingerprint(empty),before);
  assert.equal((await empty.query("SELECT count(*)::int n FROM commission_ledger")).rows[0].n,0);
  assert.equal((await empty.query("SELECT status FROM subscriptions WHERE id=41")).rows[0].status,"pending");
  assert.equal((await empty.query("SELECT status FROM nfc_cards WHERE id=81")).rows[0].status,"unassigned");
  assert.equal(await state(),beforeState);
  return {sqlstate:"22012",partialChanges:0};});
for(const label of ["simultaneous verification","verification-webhook shared-finalizer overlap"]) await test(17,label,async()=>{
  await seed(empty);const p=await newPayment(empty,1);const start=trace.length;
  const pending=Promise.all([finish(empty,p,undefined,{delay:true}),finish(empty,p)]);
  const waits=[];
  for(let i=0;i<25;i++){
    const rows=(await control.query(`SELECT wait_event_type,wait_event FROM pg_stat_activity
      WHERE datname='finance_2f5_empty' AND wait_event_type='Lock'`)).rows;
    waits.push(...rows);
    if(rows.length)break;
    await new Promise(r=>setTimeout(r,10));
  }
  const outcomes=await pending,events=trace.slice(start);
  assert(outcomes.every(r=>r.status==="PAID"));assert.equal((await accounting(empty,p)).length,3);
  assert.equal((await empty.query("SELECT count(*)::int n FROM commission_ledger")).rows[0].n,1);
  assert.equal(events.filter(e=>e.phase==="nfc-activation").length,1);
  assert.equal(events.filter(e=>e.phase==="commission-insert").length,1);
  assert(waits.length>0,"Expected genuine PostgreSQL serialization wait");
  return {outcomes:outcomes.map(r=>r.status),lockWaits:waits,deadlocks:0,nfcActivationStatements:1,commissionInsertStatements:1};});
for(const scope of ["idempotency","business-term"]) await test(17,"concurrent checkout insert "+scope,async()=>{
  await seed(empty);
  if(scope==="business-term")await empty.query("INSERT INTO subscriptions(id,school_id,student_id,term,expires_at) VALUES(43,2,12,'Fixture Term',NOW())");
  const outcomes=await Promise.allSettled([newPayment(empty,2,{idempotency_key:"concurrent-key"}),
    newPayment(empty,2,scope==="idempotency"?{idempotency_key:"concurrent-key"}:{subscription_id:43})]);
  assert.equal(outcomes.filter(r=>r.status==="fulfilled").length,1);
  const error=outcomes.find(r=>r.status==="rejected").reason;assert.equal(error.code,"23505");return {successes:1,sqlstate:error.code};});
await test(18,"Drizzle runner second execution no drift",async()=>{
  const before=await catalog(empty);
  await orm.dialect.migrate(migrationObject(canonical),orm.session,runnerConfig);
  assert.deepEqual(await catalog(empty),before);
  assert.equal((await empty.query("SELECT count(*)::int n FROM rehearsal_runner.applied")).rows[0].n,1);return {ledgerRows:1,drift:0};});
await test(18,"direct reconciliation rerun no catalog or data drift",async()=>{
  const before=await catalog(empty), rows=await fingerprint(empty);await empty.query(reconciliation);
  assert.deepEqual(await catalog(empty),before);assert.deepEqual(await fingerprint(empty),rows);return {drift:0};});
for(const name of ["historical","current"])await test(18,name+" forward reconciliation through real Drizzle dialect twice",async()=>{
  const pool=pools.find(p=>p.options.database==="finance_2f5_"+name);
  assert(pool,"Disposable case missing");
  const before=await catalog(pool),rows=await fingerprint(pool),db=drizzle(pool);
  await db.dialect.migrate(migrationObject(reconciliation),db.session,runnerConfig);
  await db.dialect.migrate(migrationObject(reconciliation),db.session,runnerConfig);
  assert.deepEqual(await catalog(pool),before);assert.deepEqual(await fingerprint(pool),rows);
  assert.equal((await pool.query("SELECT count(*)::int n FROM rehearsal_runner.applied")).rows[0].n,1);
  return {ledgerRows:1,drift:0};
});
await test(19,"exact final canonical catalog",async()=>{
  const actual=await catalog(empty);assert.deepEqual(actual,canonicalCatalog);
  report.catalog.final=actual;return {financeTables:2,paymentColumns:26,allocationColumns:17,constraints:29,standaloneIndexes:12};});
await test(20,"no added Finance boundary objects; representational REVERSAL only",async()=>{
  await seed(empty);const p=await newPayment(empty);
  await insertAllocation(empty,p,{entry_type:"REVERSAL"});assert.equal((await accounting(empty,p))[0].entry_type,"REVERSAL");
  const allTables=(await empty.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r=>r.tablename);
  assert.deepEqual(allTables.filter(t=>t.startsWith("student_subscription_")),[allocation,payment,"student_subscription_terms"].sort());
  assert(!allTables.some(t=>/refund|settlement/.test(t)));
  for(const c of canonicalCatalog.constraints.filter(c=>c.type==="f")) {
    if(c.table_name===allocation)assert(!c.definition.includes("FOREIGN KEY (attribution_id, school_id)"));
    assert(!c.definition.includes("FOREIGN KEY (academic_term_id, school_id, academic_session_id)"));
  }
  return {unexpectedFinanceObjects:0};
});
await test(19,"hardcoded column names types nullability defaults and source equivalence",async()=>{
  const expectedPayment=["id","subscription_id","school_id","student_id","academic_session_id","academic_term_id","payer_user_id","provider","provider_mode","reference","idempotency_key","gross_amount_minor","provider_fee_minor","settlement_amount_minor","currency","status","settlement_status","reconciliation_status","checkout_url","provider_transaction_id","provider_paid_at","paid_at","failure_code","receipt_snapshot","created_at","updated_at"];
  const expectedAllocation=["id","idempotency_key","entry_type","recipient_type","recipient_id","school_id","student_id","payer_user_id","academic_session_id","academic_term_id","subscription_id","payment_id","attribution_id","commission_rule_id","amount_minor","currency","created_at"];
  for(const [t,names]of [[payment,expectedPayment],[allocation,expectedAllocation]]) {
    const cols=canonicalCatalog.columns.filter(c=>c.table_name===t);assert.deepEqual(cols.map(c=>c.column_name),names);
    assert.deepEqual(report.reconciliation.current.before.columns.filter(c=>c.table_name===t),cols);
    assert.deepEqual(report.reconciliation.historical.before.columns.filter(c=>c.table_name===t),cols);
  }
  return {columnsCompared:43,historicalCurrentFutureEqual:true};});
for(const p of protectedPaths)assert.equal(hash(await fs.readFile(p)),beforeHashes[p]);
report.sourceHashes=beforeHashes;
report.summary={passed:report.tests.filter(t=>t.status==="PASS").length,failed:report.tests.filter(t=>t.status==="FAIL").length};
report.decision=report.summary.failed?"FAIL — DO NOT BUILD MIGRATION 0060 YET":"PASS — READY FOR REAL MIGRATION BUILD";
for(const p of pools)await p.end();
for(const name of ["empty","historical","current"])await control.query(`DROP DATABASE ${qn("finance_2f5_"+name)}`);
assert.equal((await control.query("SELECT count(*)::int n FROM pg_database WHERE datname LIKE 'finance_2f5_%'")).rows[0].n,0);
report.environment.disposableDatabasesDestroyed=true;
await control.end();
await fs.writeFile(path.join(reportDir,"report.json"),JSON.stringify(report,null,2));
console.log(JSON.stringify({summary:report.summary,decision:report.decision,report:reportDir}));
