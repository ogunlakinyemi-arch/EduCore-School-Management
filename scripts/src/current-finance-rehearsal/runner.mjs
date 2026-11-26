// Real PostgreSQL tests, reachable only through the network-namespace gate.
// No DSN argument, DATABASE_URL fallback, app import, ledger edit or provider.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, readlinkSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { read, root, loadContract, requireCleanEnvironment } from "./contract.mjs";
import { inspectIdentity, assertFresh, assertAfter0181 } from "./preflight.mjs";
import { captureCatalog, verifyPackets, verifyStructure, quote } from "./catalog.mjs";
import { baseline, migrationPaths } from "../direct-release-migrations-native-check.mjs";

export async function runPrivateRehearsal(parentNamespace) {
  requireCleanEnvironment(process.env);
  assert.match(parentNamespace, /^net:\[\d+\]$/);
  assert.notEqual(readlinkSync("/proc/self/ns/net"), parentNamespace);
  assert.notEqual(readlinkSync("/proc/self/ns/net"), readlinkSync("/proc/1/ns/net"));
  assert.equal(readFileSync(`/proc/${process.ppid}/comm`, "utf8").trim(), "unshare");
  // Deny all network/providing clients; allow only this closure's private socket.
  const net = await import("node:net"), tls = await import("node:tls");
  const { syncBuiltinESMExports } = await import("node:module");
  const scratch = mkdtempSync("/tmp/educore-finance-"), data = join(scratch, "data"), socket = join(scratch, "socket");
  mkdirSync(socket, { mode: 0o700 });
  const originalConnect = net.default.Socket.prototype.connect;
  net.default.Socket.prototype.connect = function (...args) {
    const value = args[0];
    const path = typeof value === "string" ? value : value?.path;
    assert.equal(path, join(socket, ".s.PGSQL.56457"), "Only the newly-created private socket is allowed");
    return originalConnect.apply(this, args);
  };
  const deny = () => { throw new Error("Provider/TCP network access forbidden"); };
  tls.default.connect = deny; globalThis.fetch = deny; syncBuiltinESMExports();
  const { Pool } = createRequire(join(root, "lib/db/package.json"))("pg");
  const env = { PATH: process.env.PATH, HOME: scratch, LANG: "C.UTF-8" };
  const run = (binary, args) => execFileSync(binary, args, { env, encoding: "utf8", timeout: 45000, stdio: ["ignore", "pipe", "pipe"] });
  const contract = loadContract(), expected = { data: realpathSync(scratch) + "/data", port: "56457" };
  let started = false, pool, c;
  const passed = [];
  const record = title => { passed.push(title); console.log("PASS " + title); };
  try {
    run("initdb", ["-D", data, "-A", "trust", "-U", "neondb_owner", "--no-locale", "--encoding=UTF8", "--no-sync"]);
    run("pg_ctl", ["-D", data, "-l", join(scratch, "postgres.log"), "-o", `-k ${socket} -h '' -p 56457`, "-w", "-t", "30", "start"]);
    started = true;
    const pid = readFileSync(join(data, "postmaster.pid"), "utf8").trim().split("\n");
    assert.equal(realpathSync(pid[1]), realpathSync(data)); assert.equal(pid[3], expected.port); assert.equal(pid[4], socket);
    pool = new Pool({ host: socket, port: 56457, database: "postgres", user: "neondb_owner", max: 1, connectionTimeoutMillis: 5000 });
    const admin = await pool.connect();
    try {
      const r = await inspectIdentity(admin);
      assert.equal(r.ip, null); assert.equal(realpathSync(r.data), realpathSync(data));
      assert.equal(r.db, "postgres"); assert.equal(r.role, "neondb_owner");
      await admin.query("CREATE DATABASE finance_rehearsal");
    } finally { admin.release(); await pool.end(); }
    pool = new Pool({ host: socket, port: 56457, database: "finance_rehearsal", user: "neondb_owner", max: 1, connectionTimeoutMillis: 5000 });
    c = await pool.connect();
    await c.query("SET search_path=public,pg_catalog; SET lock_timeout='3s'; SET statement_timeout='30s'");
    // Verify server identity before even fictional fixture DDL.
    const r = await inspectIdentity(c);
    assert.equal(r.data, expected.data); assert.equal(r.ip, null); assert.equal(r.port, expected.port);
    await c.query(baseline);
    for (const path of migrationPaths) await c.query(read(path));
    await c.query("CREATE TABLE audit_logs(id serial PRIMARY KEY,module text)");
    await c.query(read("lib/db/dev-reconciliation/bro-field-operations.sql"));
    await c.query(`ALTER TABLE academic_terms ADD UNIQUE(id,school_id);
      ALTER TABLE academic_sessions ADD UNIQUE(id,school_id)`);
    await c.query(read("lib/db/drizzle/0183_owner_free_academic_terms.sql"));
    await c.query(`INSERT INTO owner_free_academic_terms
      (school_id,academic_session_id,academic_term_id,start_date,end_date,actor_user_id,reason)
      VALUES(1,1,1,'2027-01-18','2027-04-09',1,'Fictional retained free-term evidence');
      INSERT INTO owner_free_academic_term_events(grant_id,actor_user_id,status,reason)
      VALUES(1,1,'TRIAL_GRANTED','Fictional retained free-term event')`);
    const protectedNames = contract.manifest.groups.filter(g => g.id !== "current").flatMap(g => g.tables);
    const retainedNames = [...protectedNames, "staff_nfc_billing_rules", "student_subscription_payments", "commission_ledger",
      "bro_field_leads", "bro_field_claims", "bro_field_transfers"];
    async function preservation() {
      const catalog = await captureCatalog(c, retainedNames), rows = {};
      for (const name of retainedNames) rows[name] = (await c.query(`SELECT to_jsonb(t) AS row FROM public.${quote(name)} t ORDER BY to_jsonb(t)::text`)).rows;
      const definitions = (await c.query(contract.files["db/production-activation/capture-definitions.sql"])).rows
        .filter(r => r.kind === "function" ? r.name !== "guard_current_bulk_scope" : !r.name.startsWith("current_") && !r.name.startsWith("bro_field_sms_"));
      return { catalog, rows, definitions };
    }
    const retained = await preservation();
    const preserve = async () => assert.deepEqual(await preservation(), retained, "Existing schema, data and protections must be unchanged");
    await assertFresh(c, contract, expected); record("fresh target preflight and existing protections");
    // All adverse mutations below are local fixture tests, never application data.
    for (const [title, mutation] of [
      ["missing prerequisite", "ALTER TABLE schools RENAME TO hidden_schools"],
      ["disabled existing guard", "ALTER TABLE student_direct_live_events DISABLE TRIGGER student_direct_event_history"],
      ["conflicting target table", "CREATE TABLE current_payment_batches(id integer)"],
      ["conflicting row type", "CREATE TYPE current_bulk_events AS (id integer)"],
    ]) {
      await c.query("BEGIN"); await c.query(mutation);
      await assert.rejects(assertFresh(c, contract, expected));
      await c.query("ROLLBACK"); await preserve(); record(title + " refused without retained changes");
    }
    await c.query("SET search_path=pg_catalog,public");
    await assert.rejects(assertFresh(c, contract, expected)); await c.query("SET search_path=public,pg_catalog");
    await c.query("CREATE ROLE fixture_denied NOLOGIN; SET ROLE fixture_denied");
    await assert.rejects(assertFresh(c, contract, expected)); await c.query("RESET ROLE");
    record("wrong role and wrong search_path refused");
    const injectFailure = sql => sql.replace(/\nCOMMIT;\s*$/, "\nSELECT 1/0;\nCOMMIT;\n");
    await assert.rejects(c.query(injectFailure(contract.sources[0])));
    await c.query("ROLLBACK"); await assertFresh(c, contract, expected); await preserve();
    record("0181 failure rolled back all new objects");
    await assert.rejects(c.query(contract.sources[1]));
    await c.query("ROLLBACK"); await assertFresh(c, contract, expected); await preserve();
    record("reversed order failed and rolled back");
    await c.query(contract.sources[0]); await assertAfter0181(c, contract);
    const phaseOne = await captureCatalog(c, [...contract.tables.keys()]);
    await assert.rejects(assertFresh(c, contract, expected)); await preserve();
    record("partial 0181 installation refused by fresh preflight");
    await assert.rejects(c.query(injectFailure(contract.sources[1])));
    await c.query("ROLLBACK"); await assertAfter0181(c, contract);
    assert.deepEqual(await captureCatalog(c, [...contract.tables.keys()]), phaseOne); await preserve();
    record("0182 failure rolled back only 0182; committed 0181 remained");
    await c.query("BEGIN; ALTER TABLE current_subscription_operations RENAME CONSTRAINT current_subscription_operations_check TO wrong_source_check");
    await assert.rejects(assertAfter0181(c, contract)); await c.query("ROLLBACK");
    record("wrong predecessor CHECK name refused");
    // Demonstrate exactly why procedural packets are EXCLUDED from this path.
    await c.query(contract.files["db/production-activation/current.functions.sql"]);
    await assert.rejects(assertAfter0181(c, contract));
    await assert.rejects(c.query(contract.sources[1]), e => e.code === "42723");
    await c.query("ROLLBACK");
    await c.query("DROP FUNCTION public.guard_current_bulk_scope()"); // fixture cleanup only
    await assertAfter0181(c, contract); await preserve();
    record("preinstalled separate bulk function causes the expected duplicate-function rollback");
    await c.query(contract.sources[1]);
    const postverify = async () => {
      await c.query("BEGIN READ ONLY");
      try { await verifyStructure(c, contract); await verifyPackets(c, contract); await preserve(); }
      finally { await c.query("ROLLBACK"); }
    };
    await postverify(); record("0181 then 0182 installed once and passed read-only structural/procedural/preservation checks");
    for (const name of contract.tables.keys()) {
      assert.equal((await c.query(`SELECT count(*)::int AS n FROM public.${quote(name)}`)).rows[0].n, 0);
    }
    // Behavior probes are rolled back entirely; no real financial rule is activated.
    await c.query("BEGIN");
    const rootRow = (await c.query(`INSERT INTO current_subscription_operations
      (kind,request_key,school_id,academic_term_id,amount_minor,reason,created_by,snapshot)
      VALUES('BULK_PLAN','fictional-fixture-request',1,1,320000,'Fictional journal evidence',1,'{}') RETURNING id`)).rows[0];
    const rejectStatement = async (sql, params, pattern) => {
      await c.query("SAVEPOINT rejected_probe");
      await assert.rejects(c.query(sql, params), pattern);
      await c.query("ROLLBACK TO SAVEPOINT rejected_probe; RELEASE SAVEPOINT rejected_probe");
    };
    await rejectStatement("UPDATE current_subscription_operations SET reason='Changed fixture' WHERE id=$1",
      [rootRow.id], /Direct LIVE history is append-only/);
    await rejectStatement("DELETE FROM current_subscription_operations WHERE id=$1",
      [rootRow.id], /Direct LIVE history is append-only/);
    await rejectStatement("UPDATE owner_free_academic_terms SET reason='Changed fixture'", [], /Free academic-term evidence is immutable/);
    await rejectStatement(`INSERT INTO current_subscription_operation_events(operation_id,event_key,state,details)
      VALUES($1,'fictional-invalid-event','INVALID','{}')`, [rootRow.id], /check constraint/);
    await rejectStatement(`INSERT INTO current_bulk_allocations(batch_id,school_id,student_id,academic_term_id,review_id)
      VALUES(999,1,1,1,999)`, [], /Aggregate allocation scope mismatch/);
    await c.query("ROLLBACK"); await preserve();
    record("history/free-term mutations, invalid state and invalid allocation rejected in rolled-back probes");
    const complete = await captureCatalog(c, [...contract.tables.keys()]);
    await assert.rejects(assertFresh(c, contract, expected));
    for (const sql of contract.sources) {
      await assert.rejects(c.query(sql), e => e.code === "42P07");
      await c.query("ROLLBACK");
      assert.deepEqual(await captureCatalog(c, [...contract.tables.keys()]), complete); await preserve();
    }
    record("complete rerun refused and raw reruns rolled back without changes");
    for (const mutation of [
      "ALTER TABLE current_subscription_operations DROP CONSTRAINT current_subscription_source_ck",
      "ALTER TABLE current_bulk_events DISABLE TRIGGER current_bulk_events_history",
      "CREATE INDEX unexpected_fixture_index ON current_bulk_events(state)",
    ]) {
      await c.query("BEGIN"); await c.query(mutation);
      await assert.rejects((async () => { await verifyStructure(c, contract); await verifyPackets(c, contract); })());
      await c.query("ROLLBACK");
    }
    await postverify(); record("missing CHECK, disabled current trigger and extra index detected");
    console.log(JSON.stringify({ realPostgres: true, version: (await inspectIdentity(c)).version,
      cases: passed.length, applicationDatabasesTouched: false, published: false }));
  } finally {
    if (c) { await c.query("ROLLBACK").catch(() => {}); c.release(); }
    if (pool) await pool.end();
    try { if (started) run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "stop"]); }
    finally { rmSync(scratch, { recursive: true, force: true }); }
  }
}
