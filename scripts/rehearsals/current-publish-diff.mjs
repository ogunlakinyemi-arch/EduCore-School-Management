// Offline inputs only. The only DB connection is created by createDisposable.
// Never imports app DB clients or accepts a source/restore URL.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createDisposable, databaseClient, verifyToolchain } from "../src/dev-backup/processes.mjs";

const root = process.cwd();
const dir = path.resolve(root, ".local/release-rehearsal/2026-10-18-current-diff");
const read = async name => JSON.parse(await fs.readFile(path.join(dir, name + ".json"), "utf8"));
const write = async (name, value) => fs.writeFile(path.join(dir, name + ".json"),
  JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
const q = value => '"' + value.replaceAll('"', '""') + '"';
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const stable = value => Array.isArray(value) ? value.map(stable) :
  value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])])) : value;
const equal = (a, b) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));
const source = {}, queryText = await fs.readFile("scripts/audits/schema-2h-catalog.sql", "utf8");
const pieces = queryText.split(/-- @([a-z]+)\n/), queries = {};
for (let i = 1; i < pieces.length; i += 2) {
  const section = pieces[i];
  source[section] = await read(section);
  queries[section] = pieces[i + 1];
}
const cleanRows = (section, rows) => rows.map(row => {
  const copy = { ...row };
  delete copy.dependent_fks;
  if (section === "sequences") delete copy.observed_last_value;
  return copy;
});
for (const section of Object.keys(source)) source[section] = cleanRows(section, source[section]);
const preview = await read("preview"), guard = await read("capture-guard"), rebuild = await read("rebuild-metadata");
assert.equal(preview.success, true);
assert.equal(preview.statementsToExecute.length, 646, "Review changed statement count before rerunning");
assert.ok(Object.values(guard.unsupported).every(value => Number(value) === 0));
assert.equal(source.functions.length, 0);
assert.equal(source.triggers.length, 0);
assert.ok(source.tables.every(t => t.kind === "r" && !t.inherited && t.persistence === "p"));
assert.ok(source.columns.every(c => !c.identity && !c.generated && (!c.collation || c.collation === "default")));
assert.ok(source.indexes.every(i => i.valid && i.ready));
assert.ok(source.constraints.every(c => !c.referenced_schema || c.referenced_schema === "public"));
const result = {
  scope: "Exact current diff against reconstructed public Production-routed catalog; synthetic records only",
  capturedAt: guard.captured_at, sourceReplica: guard.replica,
  statementCount: preview.statementsToExecute.length, statementSha256: digest(preview.statementsToExecute),
  liveWrites: 0, applicationRowsReadFromProduction: 0, tests: [],
  limitations: ["Not a Production data backup", "Production route is a replica; deployment-primary binding not certified",
    "Catalog sections were read in separate statements", "Roles/ACLs not reconstructed",
    "No full browser/application runtime compatibility claim", "No Production row samples; five-key uniqueness proven from captured primary keys only",
    "Reported seven-day PITR setting is operator evidence, not a tested recovery"],
};
const pass = (name, details = {}) => { result.tests.push({ name, status: "PASS", ...details }); console.log("PASS", name); };
let cluster;
const clients = [];
async function catalog(client) {
  const out = {};
  for (const [section, sql] of Object.entries(queries)) out[section] = cleanRows(section, (await client.query(sql)).rows[0].catalog);
  return out;
}
async function reconstruct(client) {
  for (const s of source.sequences) {
    await client.query(`CREATE SEQUENCE public.${q(s.name)} AS ${s.type} INCREMENT ${s.increment}
      MINVALUE ${s.minimum} MAXVALUE ${s.maximum} START ${s.start_value} CACHE ${s.cache}${s.cycle ? " CYCLE" : " NO CYCLE"}`);
  }
  for (const t of source.tables) {
    const columns = source.columns.filter(c => c.table_name === t.name);
    await client.query(`CREATE TABLE public.${q(t.name)} (${columns.map(c => q(c.name) + " " + c.type +
      (c.default_expression ? " DEFAULT " + c.default_expression : "") + (c.nullable ? "" : " NOT NULL")).join(",")})`);
  }
  for (const s of source.sequences) if (s.table_name) {
    await client.query(`ALTER SEQUENCE public.${q(s.name)} OWNED BY public.${q(s.table_name)}.${q(s.column_name)}`);
  }
  // Preserve original physical index creation order: PostgreSQL FK lookup can
  // choose among equivalent indexes. Baseline binding equality is mandatory.
  const rank = new Map(rebuild.index_order.map((i, n) => [i.name, n]));
  assert.equal(rank.size, source.indexes.length);
  for (const index of [...source.indexes].sort((a, b) => rank.get(a.name) - rank.get(b.name))) {
    assert.ok(rank.has(index.name));
    await client.query(index.definition);
  }
  for (const c of source.constraints.filter(c => ["p", "u"].includes(c.kind))) {
    await client.query(`ALTER TABLE public.${q(c.table_name)} ADD CONSTRAINT ${q(c.name)}
      ${c.kind === "p" ? "PRIMARY KEY" : "UNIQUE"} USING INDEX ${q(c.supporting_index)}
      ${c.deferrable ? "DEFERRABLE" : "NOT DEFERRABLE"} ${c.initially_deferred ? "INITIALLY DEFERRED" : "INITIALLY IMMEDIATE"}`);
  }
  for (const c of source.constraints.filter(c => c.kind === "c" || c.kind === "f")) {
    await client.query(`ALTER TABLE public.${q(c.table_name)} ADD CONSTRAINT ${q(c.name)} ${c.definition}`);
  }
  const actual = await catalog(client);
  for (const section of Object.keys(source)) {
    assert.ok(equal(source[section], actual[section]), `RECONSTRUCTED_${section.toUpperCase()}_DIFFERS_FROM_CAPTURE`);
  }
}
async function localClient(database, user = "restore_check") {
  const client = databaseClient({ ...cluster.connection, database, user }, false);
  await client.connect(); clients.push(client);
  assert.equal((await client.query("SELECT inet_server_addr() AS address")).rows[0].address, null);
  return client;
}
async function seed(client) {
  await client.query(`INSERT INTO app_users(clerk_user_id,email) VALUES('qa_release_local','release@example.invalid');
    INSERT INTO schools(code,name,city,state) VALUES
      ('QAREL1','Fictional Release School One','Fixture City','Fixture State'),
      ('QAREL2','Fictional Release School Two','Fixture City','Fixture State');
    INSERT INTO parents(school_id,name,email,phone) VALUES
      (1,'Fictional Parent','parent1@example.invalid','00000000001'),
      (2,'Fictional Parent Two','parent2@example.invalid','00000000002');
    INSERT INTO students(school_id,admission_no,first_name,last_name,gender,class_name,section)
      VALUES(1,'QAREL-1','Fictional','Student','Male','Fixture Class','A'),
      (2,'QAREL-2','Fictional','Student Two','Female','Fixture Class','A');
    INSERT INTO academic_sessions(school_id,name,start_date,end_date)
      VALUES(1,'2026/2027','2026-09-01','2027-07-31'),(2,'2026/2027','2026-09-01','2027-07-31');
    INSERT INTO academic_terms(school_id,academic_session_id,name,start_date,end_date)
      VALUES(1,1,'First Term','2026-09-01','2026-12-18'),(2,2,'First Term','2026-09-01','2026-12-18');
    INSERT INTO school_classes(school_id,name,section) VALUES(1,'Fixture Class','A'),(2,'Fixture Class','A');
    INSERT INTO student_class_assignments(school_id,student_id,academic_session_id,school_class_id,section)
      VALUES(1,1,1,1,'A'),(2,2,2,2,'A');
    INSERT INTO partner_profiles(partner_code,full_name,email) VALUES('QA-RELEASE','Fictional Partner','partner@example.invalid');
    INSERT INTO school_partner_attributions(school_id,partner_profile_id) VALUES(1,1);
    INSERT INTO subscriptions(school_id,student_id,term,expires_at) VALUES(1,1,'First Term','2026-12-18'),(2,2,'First Term','2026-12-18');
    INSERT INTO employees(school_id,employee_no,first_name,last_name) VALUES(1,'QAREL-E1','Fictional','Employee');
    INSERT INTO fee_invoices(school_id,student_id,academic_session_id,academic_term_id,invoice_number,
      student_name_snapshot,admission_no_snapshot,class_name_snapshot,section_snapshot,issue_date,due_date,
      subtotal_minor,total_minor,outstanding_minor,created_by)
      VALUES(1,1,1,1,'QA-RELEASE-INV','Fictional Student','QAREL-1','Fixture Class','A','2026-09-01','2026-12-01',10000,10000,10000,1);
    INSERT INTO fee_payments(school_id,invoice_id,student_id,reference,idempotency_key,amount_minor,method,
      submitted_by,transfer_bank,transfer_reference,transfer_date)
      VALUES(1,1,1,'QA-RELEASE-PAY','QA-RELEASE-IDEMPOTENT',10000,'BANK_TRANSFER',1,'Fixture Bank','QA-TRANSFER','2026-09-01');`);
}
async function preservation(client) {
  const relations = (await client.query(`SELECT c.oid::text AS oid,c.relname AS name,c.relkind::text AS kind,
    CASE WHEN c.relkind='i' THEN pg_get_indexdef(c.oid) END AS definition FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','i','S') ORDER BY c.oid`)).rows;
  const fks = (await client.query(`SELECT c.oid::text AS oid,t.relname AS table_name,c.conname AS name,
    c.conindid::text AS index_oid,i.relname AS index_name,pg_get_constraintdef(c.oid) AS definition,
    c.convalidated AS validated FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=c.connamespace JOIN pg_class i ON i.oid=c.conindid
    WHERE n.nspname='public' AND c.contype='f' ORDER BY c.oid`)).rows;
  const data = [];
  for (const t of source.tables) {
    const columns = source.columns.filter(c => c.table_name === t.name).map(c => q(c.name)).join(",");
    const rows = (await client.query(`SELECT md5(row_to_json(v)::text) AS hash FROM
      (SELECT ${columns} FROM public.${q(t.name)}) v ORDER BY hash`)).rows;
    data.push({ table: t.name, count: rows.length, sha256: digest(rows) });
  }
  const sequences = [];
  for (const s of source.sequences) sequences.push({ name: s.name,
    ...(await client.query(`SELECT last_value::text,is_called FROM public.${q(s.name)}`)).rows[0] });
  return { relations, fks, data, sequences };
}
function verifyPreserved(before, after) {
  for (const r of before.relations) assert.ok(after.relations.some(a => equal(a, r)), "EXISTING_RELATION_CHANGED:" + r.name);
  for (const fk of before.fks) assert.ok(after.fks.some(a => equal(a, fk)), "EXISTING_FK_CHANGED:" + fk.name);
  assert.ok(equal(before.data, after.data), "ORIGINAL_COLUMN_DATA_CHANGED");
  assert.ok(equal(before.sequences, after.sequences), "EXISTING_SEQUENCE_STATE_CHANGED");
}
async function behavior(client) {
  const tests = [];
  async function check(name, sql, expectedCode) {
    await client.query("SAVEPOINT behavior_test");
    let code = null, constraint = null;
    try { await client.query(sql); } catch (error) { code = error.code; constraint = error.constraint; }
    await client.query("ROLLBACK TO SAVEPOINT behavior_test");
    await client.query("RELEASE SAVEPOINT behavior_test");
    tests.push({ name, expectedCode: expectedCode ?? null, actualCode: code, constraint,
      status: code === (expectedCode ?? null) ? "PASS" : "FAIL" });
  }
  const payment = (method, student = "1", employee = "NULL", extraColumns = "", extraValues = "", amount = "100") =>
    `INSERT INTO fee_payments(school_id,invoice_id,student_id,employee_id,reference,idempotency_key,amount_minor,method,submitted_by${extraColumns})
     VALUES(1,1,${student},${employee},'QA-PROBE','QA-PROBE-KEY',${amount},'${method}',1${extraValues})`;
  await check("bank transfer with required details", payment("BANK_TRANSFER", "1", "NULL",
    ",transfer_bank,transfer_reference,transfer_date", ",'Fixture Bank','QA-PROBE-REF','2026-09-01'"));
  await check("reject invalid payment method", payment("INVALID"), "23514");
  await check("reject negative amount", payment("FLUTTERWAVE", "1", "NULL", "", "", "-1"), "23514");
  await check("reject payment without person", payment("FLUTTERWAVE", "NULL"), "23514");
  await check("reject payment with both persons", payment("FLUTTERWAVE", "1", "1"), "23514");
  await check("reject CASH without evidence", payment("CASH"), "23514");
  await check("accept evidenced CASH", payment("CASH", "1", "NULL",
    ",verified_by,verified_at,verification_evidence_ref,reviewer_notes,verification_metadata,status",
    ",1,'2026-10-18T00:00:00Z','QA-evidence','QA reviewed','{}'::jsonb,'VERIFIED'"));
  await check("reject cross-school student assignment", `INSERT INTO student_class_assignments
    (school_id,student_id,academic_session_id,school_class_id,section,status)
    VALUES(1,2,1,1,'A','INACTIVE')`, "23503");
  return tests;
}
try {
  const eligibility = ["parents", "academic_terms", "student_class_assignments",
    "school_partner_attributions", "subscriptions"].map(table => {
    const pk = source.constraints.find(c => c.table_name === table && c.kind === "p");
    assert.ok(pk?.validated && equal(pk.columns, ["id"]), "SOURCE_PRIMARY_KEY_REQUIRED:" + table);
    assert.ok(source.indexes.some(i => i.table_name === table && i.primary_index && i.valid && i.ready));
    assert.ok(source.columns.some(c => c.table_name === table && c.name === "id" && !c.nullable));
    return { table, primaryKey: pk.name, proof: "Existing validated non-null PRIMARY KEY(id) implies uniqueness of every proposed tuple containing id" };
  });
  await write("five-key-eligibility", eligibility);
  pass("Five proposed unique keys are eligible by existing captured primary-key enforcement");
  await verifyToolchain();
  cluster = await createDisposable({ collate: rebuild.collate, ctype: rebuild.ctype });
  const admin = await localClient("postgres", "restore_admin");
  const identity = (await admin.query(`SELECT current_setting('data_directory') directory,
    current_setting('listen_addresses') listeners`)).rows[0];
  assert.equal(identity.directory, cluster.data); assert.equal(identity.listeners, "");
  result.isolation = { privateSocket: cluster.connection.host, tcpDisabled: true,
    disposableDirectory: cluster.base, sourceCredentialsRead: false };
  // Check captured slices against a final, single-statement catalog digest read.
  const capturedDigests = await read("source-digests");
  for (const section of Object.keys(source)) {
    if (section === "sequences") continue; // observed sequence state is not schema and may advance on the source.
    const actual = (await admin.query("SELECT md5($1::jsonb::text) AS hash", [JSON.stringify(source[section])])).rows[0].hash;
    assert.equal(actual, capturedDigests[section], "CAPTURE_CHANGED_OR_INCOMPLETE:" + section);
  }
  pass("Captured catalog slices match final source metadata digests");
  for (const label of ["empty", "populated"]) {
    const database = "release_rehearsal_" + label;
    await admin.query(`CREATE DATABASE ${q(database)} OWNER restore_check TEMPLATE template0
      ENCODING 'UTF8' LC_COLLATE '${rebuild.collate.replaceAll("'", "''")}' LC_CTYPE '${rebuild.ctype.replaceAll("'", "''")}'`);
    const client = await localClient(database);
    await reconstruct(client);
    pass(label + ": exact captured schema, index ownership and FK bindings reconstructed");
    if (label === "populated") { await seed(client); pass("Fictional two-school academic and finance fixture seeded"); }
    const before = await preservation(client);
    await client.query("BEGIN");
    let executed = 0;
    try {
      for (const sql of preview.statementsToExecute) {
        await client.query(sql); executed++;
      }
      const after = await preservation(client);
      verifyPreserved(before, after);
      pass(label + ": original relation OIDs, index definitions, FK OIDs/bindings, data and sequence state preserved");
      const actual = await catalog(client);
      const names = ["parents_id_school_unique", "academic_terms_nfc_session_key",
        "student_class_assignments_id_school_publish_key", "school_partner_attributions_id_partner_uq", "subscriptions_id_school_student_uq"];
      for (const name of names) assert.ok(actual.constraints.some(c => c.name === name && c.kind === "u" && c.validated));
      pass(label + ": all five intended UNIQUE constraints validated");
      if (label === "populated") {
        const probes = await behavior(client);
        await write("behavior-tests", probes);
        for (const probe of probes) result.tests.push(probe);
        assert.ok(probes.every(p => p.status === "PASS"), "BEHAVIORAL_PROBE_FAILED");
      }
      await write(label + "-after-catalog", actual);
      await client.query("ROLLBACK");
      pass(label + ": all 646 statements executed in exact order", { executed, transactionRolledBack: true });
    } catch (error) {
      await client.query("ROLLBACK");
      result.tests.push({ name: label + ": exact current diff", status: "FAIL", executed,
        failedStatement: executed < preview.statementsToExecute.length ? executed + 1 : null,
        sqlState: error.code || null, message: error.message, constraint: error.constraint || null });
      // Values and errors below concern fictional local records only.
      console.log("FAIL", label, "after", executed, "SQLSTATE", error.code || "ASSERTION", error.message);
    }
    const rolledBack = await catalog(client);
    for (const section of Object.keys(source)) assert.ok(equal(source[section], rolledBack[section]), "ROLLBACK_CATALOG_DRIFT:" + section);
    pass(label + ": transaction rollback restored source-shaped catalog");
  }
  result.status = result.tests.some(t => t.status === "FAIL") ? "FAIL" : "PASS";
} catch (error) {
  result.status = "FAIL";
  result.setupFailure = { code: error.code || null, message: error.message };
  console.log("FAIL setup", error.code || "ASSERTION", error.message);
} finally {
  for (const client of clients.reverse()) await client.end().catch(() => {});
  if (cluster) {
    try { await cluster.stop(); result.disposableRemoved = true; }
    catch { result.status = "FAIL"; result.disposableRemoved = false; }
  }
  await write("result", result);
  console.log(JSON.stringify({ status: result.status, tests: result.tests.length,
    failures: result.tests.filter(t => t.status === "FAIL").length,
    disposableRemoved: result.disposableRemoved, liveWrites: 0 }));
  if (result.status !== "PASS") process.exitCode = 1;
}
