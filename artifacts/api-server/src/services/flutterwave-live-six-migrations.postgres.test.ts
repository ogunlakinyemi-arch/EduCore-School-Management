import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabasePool, type DatabasePoolClient } from "@workspace/db/driver";
import { beforeAll, beforeEach, afterAll, afterEach, expect, it } from "vitest";

// No application pool, URL, credentials or provider configuration is imported.
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const order = ["webhook-inbox", "finalization", "workflow", "readiness", "runtime", "school-onboarding"];
const ups = new Map<string, string>(), downs = new Map<string, string>();
const runtimeTables = ["allocation_reviews", "checkout_attempts", "school_configuration", "release_manifests"];
let directory: string, started = false, admin: InstanceType<typeof DatabasePool>;
let pool: InstanceType<typeof DatabasePool>, client: DatabasePoolClient;
let counter = 0, database: string, manifest: any, canonicalBefore: string;
let canonicalNames: string[] = [];
let clean: NodeJS.ProcessEnv;
const prefix = "flutterwave_live_";

async function canonicalSnapshot(db: DatabasePoolClient) {
  const result: unknown[] = [];
  for (const name of canonicalNames) {
    const quoted = `"${name.replaceAll('"', '""')}"`;
    result.push([name, (await db.query(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM public.${quoted} t`)).rows[0].rows]);
  }
  result.push((await db.query(`SELECT tablename,indexname,indexdef FROM pg_indexes
    WHERE schemaname='public' AND tablename NOT LIKE 'flutterwave_live_%' ORDER BY tablename,indexname`)).rows);
  result.push((await db.query(`SELECT t.relname,c.conname,pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    WHERE c.connamespace='public'::regnamespace AND t.relname NOT LIKE 'flutterwave_live_%'
    ORDER BY t.relname,c.conname`)).rows);
  return JSON.stringify(result);
}
async function applyAll(db = client) {
  for (const name of order) await db.query(ups.get(name)!);
}
async function reverseAll(db = client) {
  for (const name of [...order].reverse()) await db.query(downs.get(name)!);
}
async function refused(name: string, pattern: RegExp) {
  await expect(client.query(downs.get(name)!)).rejects.toThrow(pattern);
  // The same pinned connection owns the failed migration transaction.
  await client.query("ROLLBACK");
}
async function workflowReady() {
  for (const name of ["school-onboarding", "runtime", "readiness"]) await client.query(downs.get(name)!);
}
const insertBatch = `INSERT INTO flutterwave_live_commission_batches
  (environment,merchant_scope,idempotency_key,request_hash,approved_by,snapshot)
  VALUES('LIVE','fixture_merchant','fixture_review_key_123','${"a".repeat(64)}',7,'{}')`;
const insertRelease = `INSERT INTO flutterwave_live_release_manifests
  (release_id,merchant_scope,enabled,reviewed_by,evidence_sha256,verified_at)
  VALUES('SCV3_V1','fixture_merchant',false,7,'${"a".repeat(64)}',now())`;
async function seedAuthority() {
  await client.query(`INSERT INTO flutterwave_live_authority_reviews
    (merchant_scope,school_id,school_subaccount_id,evidence_sha256,reviewed_by,expires_at)
    VALUES('fixture_merchant',10,'RS_fixtureowner12345678','${"a".repeat(64)}',7,now()+interval '1 day')`);
}
async function seedIntent() {
  await client.query(`INSERT INTO flutterwave_live_subscription_intents
    (merchant_scope,reference,school_id,student_id,session_id,term_id,term_end_date,school_subaccount_id,partner_accrual_minor)
    VALUES('fixture_merchant','SCV3_live_fixture_12345678',10,1,1,1,current_date+30,'RS_fixtureowner12345678',0)`);
}
async function waitForLock(pid: number, relation: number, mode: string) {
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    const result = await pool.query(`SELECT 1 FROM pg_locks WHERE pid=$1 AND relation=$2 AND mode=$3 AND NOT granted`, [pid, relation, mode]);
    if (result.rows.length) return;
    await new Promise(r => setTimeout(r, 15));
  }
  throw new Error(`Fixture backend did not wait for ${mode}`);
}
async function pid(db: DatabasePoolClient) {
  return Number((await db.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
}
async function relation(name: string) {
  return Number((await client.query("SELECT to_regclass($1)::oid AS oid", [name])).rows[0].oid);
}
function outcome(promise: Promise<any>) {
  return promise.then(() => ({ ok: true, code: "", message: "" }),
    (error: any) => ({ ok: false, code: String(error.code), message: String(error.message) }));
}
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "educore-six-live-pg-"));
  clean = { PATH: process.env.PATH, HOME: directory, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" };
  const target = path.join(directory, "representative.sql");
  execFileSync("pnpm", ["--filter", "@workspace/scripts", "exec", "tsx", "src/live-readiness-target-schema.mjs", "--out", target],
    { cwd: root, env: clean, stdio: "pipe", timeout: 90000 });
  manifest = JSON.parse(await readFile(target + ".json", "utf8"));
  for (const name of order) {
    ups.set(name, await readFile(path.join(root, `lib/db/dev-reconciliation/flutterwave-live-${name}.up.sql`), "utf8"));
    downs.set(name, await readFile(path.join(root, `lib/db/dev-reconciliation/flutterwave-live-${name}.down.sql`), "utf8"));
  }
  const data = path.join(directory, "data");
  execFileSync("initdb", ["-D", data, "-U", "six_fixture", "-A", "trust", "--no-locale", "--encoding=UTF8"], { env: clean, stdio: "ignore" });
  execFileSync("pg_ctl", ["-D", data, "-l", path.join(directory, "server.log"), "-o",
    `-c listen_addresses='' -c unix_socket_directories='${directory}' -p 55436`, "-w", "start"], { env: clean, stdio: "ignore" });
  started = true;
  const config = { host: directory, port: 55436, user: "six_fixture", password: "fixture-only", ssl: false as const };
  admin = new DatabasePool({ ...config, database: "postgres", max: 2 });
  expect((await admin.query("SELECT current_setting('data_directory') AS dir,inet_server_addr() AS addr")).rows[0])
    .toEqual({ dir: data, addr: null });
  await admin.query("CREATE DATABASE six_base");
  const base = new DatabasePool({ ...config, database: "six_base", max: 1 });
  const bootstrap = await base.connect();
  try {
    await bootstrap.query(await readFile(target, "utf8"));
    await bootstrap.query(`INSERT INTO app_users(id,clerk_user_id,email) VALUES(7,'fictional_six_owner','six@example.invalid');
      INSERT INTO schools(id,code,name,city,state) VALUES(10,'FIXTURE-SIX','Fictional migration school','Fixture City','Fixture State');
      INSERT INTO students(id,school_id,admission_no,first_name,last_name,gender,class_name,section)
        VALUES(1,10,'SIX-1','Fictional','Student','other','Fixture Class','A');
      INSERT INTO subscriptions(id,school_id,student_id,term,status,verification_status,provider,provider_reference,expires_at)
        VALUES(1,10,1,'Historical term','active','verified','test','SCV2_preserve_six_history',now()+interval '30 days')`);
    canonicalNames = (await bootstrap.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(r => String(r.tablename));
    expect(canonicalNames.length).toBe(manifest.tables);
    canonicalBefore = await canonicalSnapshot(bootstrap);
  } finally { bootstrap.release(); await base.end(); }
}, 120000);
beforeEach(async () => {
  database = `six_case_${++counter}`;
  await admin.query(`CREATE DATABASE ${database} TEMPLATE six_base`);
  pool = new DatabasePool({ host: directory, port: 55436, user: "six_fixture", password: "fixture-only",
    database, ssl: false, max: 4 });
  client = await pool.connect();
  expect((await client.query("SELECT current_database() AS name,inet_server_addr() AS addr")).rows[0])
    .toEqual({ name: database, addr: null });
  await applyAll();
});
afterEach(async () => {
  if (!client) return;
  try {
    await client.query("ROLLBACK");
    expect(await canonicalSnapshot(client)).toBe(canonicalBefore);
  } finally {
    client.release();
    await pool.end();
    await admin.query(`DROP DATABASE ${database}`);
  }
});
afterAll(async () => {
  await admin?.end();
  if (started) execFileSync("pg_ctl", ["-D", path.join(directory, "data"), "-m", "immediate", "-w", "stop"], { env: clean, stdio: "ignore" });
  if (directory) await rm(directory, { recursive: true, force: true });
});

it("applies all six drafts to the complete current source schema without enabling releases or changing canonical records", async () => {
  expect(manifest.applicationTargetVerified).toBe(false);
  console.info("Disposable six-draft source-schema rehearsal", JSON.stringify({
    canonicalTables: manifest.tables, canonicalForeignKeys: manifest.foreignKeys,
    sourceStatements: manifest.statements, applicationTargetVerified: manifest.applicationTargetVerified,
  }));
  expect((await client.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'flutterwave_live_%'")).rows[0].n).toBe(21);
  expect((await client.query("SELECT count(*)::int AS n FROM pg_constraint WHERE connamespace='public'::regnamespace AND NOT convalidated")).rows[0].n).toBe(0);
  expect((await client.query(`SELECT (SELECT count(*)::int FROM flutterwave_live_release_manifests) AS runtime,
    (SELECT count(*)::int FROM flutterwave_live_school_onboarding_releases) AS onboarding`)).rows[0])
    .toEqual({ runtime: 0, onboarding: 0 });
});
it("executes empty reverse order and complete six-draft reapply", async () => {
  await reverseAll();
  expect((await client.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'flutterwave_live_%'")).rows[0].n).toBe(0);
  await applyAll();
  expect((await client.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'flutterwave_live_%'")).rows[0].n).toBe(21);
});
it.each([false, true])("refuses workflow rollback with a standalone approval batch (audit=%s), with no intent or authority", async audited => {
  await workflowReady();
  await client.query(insertBatch);
  if (audited) await client.query("INSERT INTO flutterwave_live_workflow_audits(actor_id,action,batch_id) VALUES(7,'APPROVE_EXPORT_ONLY',1)");
  const before = (await client.query(`SELECT (SELECT jsonb_agg(to_jsonb(b)) FROM flutterwave_live_commission_batches b) AS batches,
    (SELECT jsonb_agg(to_jsonb(a)) FROM flutterwave_live_workflow_audits a) AS audits`)).rows;
  await refused("workflow", /LIVE workflow evidence retained/);
  expect((await client.query(`SELECT (SELECT jsonb_agg(to_jsonb(b)) FROM flutterwave_live_commission_batches b) AS batches,
    (SELECT jsonb_agg(to_jsonb(a)) FROM flutterwave_live_workflow_audits a) AS audits`)).rows).toEqual(before);
});
it("refuses workflow rollback with an independent authority review", async () => {
  await workflowReady(); await seedAuthority();
  await refused("workflow", /LIVE workflow evidence retained/);
  expect((await client.query("SELECT count(*)::int AS n FROM flutterwave_live_authority_reviews")).rows[0].n).toBe(1);
});
it.each(runtimeTables)("refuses runtime rollback with retained %s", async table => {
  if (table === "release_manifests") await client.query(insertRelease);
  if (table === "school_configuration") {
    await seedAuthority();
    await client.query("INSERT INTO flutterwave_live_school_configuration(school_id,merchant_scope,authority_review_id,authority_evidence) VALUES(10,'fixture_merchant',1,'{}')");
  }
  if (table === "checkout_attempts") {
    await seedIntent();
    await client.query("INSERT INTO flutterwave_live_checkout_attempts(intent_id,state) VALUES(1,'RESERVED')");
  }
  if (table === "allocation_reviews") {
    await seedIntent();
    await client.query(`INSERT INTO flutterwave_live_allocation_reviews
      (merchant_scope,reference,transaction_id,provider_reference,school_subaccount_id,currency,gross_minor,school_minor,
       provider_fee_minor,additional_fee_minor,source,evidence_sha256,reviewed_by)
      VALUES('fixture_merchant','SCV3_live_fixture_12345678','123456','fixture-provider-reference','RS_fixtureowner12345678',
       'NGN',500000,190000,1000,0,'FLUTTERWAVE_TRANSACTION_REPORT','${"a".repeat(64)}',7)`);
  }
  const before = (await client.query(`SELECT to_jsonb(t) AS row FROM ${prefix + table} t`)).rows;
  await refused("runtime", /Preserve populated LIVE runtime history/);
  expect((await client.query(`SELECT to_jsonb(t) AS row FROM ${prefix + table} t`)).rows).toEqual(before);
});
it("waits for an earlier runtime writer and refuses rollback after its committed record becomes visible", async () => {
  const oid = await relation(prefix + "release_manifests"), rollbackPid = await pid(client);
  const writer = await pool.connect();
  let pending: ReturnType<typeof outcome> | undefined;
  try {
    await writer.query("BEGIN"); await writer.query(insertRelease);
    pending = outcome(client.query(downs.get("runtime")!));
    await waitForLock(rollbackPid, oid, "AccessExclusiveLock");
    await writer.query("COMMIT");
    expect(await pending).toMatchObject({ ok: false, message: expect.stringContaining("Preserve populated LIVE runtime history") });
    await client.query("ROLLBACK");
    expect((await client.query("SELECT count(*)::int AS n FROM flutterwave_live_release_manifests")).rows[0].n).toBe(1);
  } finally {
    await writer.query("ROLLBACK"); writer.release();
    if (pending) await pending;
    await client.query("ROLLBACK");
  }
});
it("blocks a later writer until the exact locked rollback finishes; no committed insert is lost", async () => {
  const script = downs.get("runtime")!, boundary = script.indexOf("DO $$");
  expect(boundary).toBeGreaterThan(0);
  const oid = await relation(prefix + "release_manifests");
  // Instrumentation barrier only: concatenating these two chunks is the exact draft.
  await client.query(script.slice(0, boundary));
  const relationOids: number[] = [];
  for (const table of runtimeTables) relationOids.push(await relation(prefix + table));
  const locks = await pool.query("SELECT count(*)::int AS n FROM pg_locks WHERE pid=$1 AND mode='AccessExclusiveLock' AND granted AND relation=ANY($2::oid[])",
    [await pid(client), relationOids]);
  expect(locks.rows[0].n).toBe(4);
  const writer = await pool.connect();
  let pending: ReturnType<typeof outcome> | undefined;
  try {
    const writerPid = await pid(writer);
    pending = outcome(writer.query(insertRelease));
    await waitForLock(writerPid, oid, "RowExclusiveLock");
    await client.query(script.slice(boundary));
    expect(await pending).toMatchObject({ ok: false, code: "42P01" });
    expect((await client.query("SELECT to_regclass('flutterwave_live_release_manifests') AS table_name")).rows[0].table_name).toBeNull();
  } finally {
    await client.query("ROLLBACK");
    if (pending) await pending;
    writer.release();
  }
});
it("fails closed on lock timeout with all runtime tables intact", async () => {
  const holder = await pool.connect();
  try {
    await holder.query("BEGIN; LOCK TABLE flutterwave_live_release_manifests IN ROW EXCLUSIVE MODE");
    const result = await outcome(client.query(downs.get("runtime")!));
    expect(result).toMatchObject({ ok: false, code: "55P03" });
    await client.query("ROLLBACK"); await holder.query("ROLLBACK");
    expect((await client.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='public' AND tablename=ANY($1::text[])",
      [runtimeTables.map(t => prefix + t)])).rows[0].n).toBe(4);
  } finally { await holder.query("ROLLBACK"); holder.release(); }
}, 15000);
it("waits for a concurrent workflow batch writer and then preserves its committed approval", async () => {
  await workflowReady();
  const oid = await relation(prefix + "commission_batches"), rollbackPid = await pid(client);
  const writer = await pool.connect();
  let pending: ReturnType<typeof outcome> | undefined;
  try {
    await writer.query("BEGIN"); await writer.query(insertBatch);
    pending = outcome(client.query(downs.get("workflow")!));
    await waitForLock(rollbackPid, oid, "AccessExclusiveLock");
    await writer.query("COMMIT");
    expect(await pending).toMatchObject({ ok: false, message: expect.stringContaining("LIVE workflow evidence retained") });
    await client.query("ROLLBACK");
    expect((await client.query("SELECT count(*)::int AS n FROM flutterwave_live_commission_batches")).rows[0].n).toBe(1);
  } finally {
    await writer.query("ROLLBACK"); writer.release();
    if (pending) await pending;
    await client.query("ROLLBACK");
  }
});
