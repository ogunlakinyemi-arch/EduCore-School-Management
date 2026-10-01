#!/usr/bin/env node
/**
 * Explicit, one-shot Development apply of the rehearsed feedback migrations.
 * Never a startup hook, production runner, schema push, or historical migrator.
 * Requires the independently captured /tmp baseline and exact rehearsal hashes.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(path.join(root, "lib/db/package.json"));
const { Client } = require("pg");

if (process.argv[2] !== "--apply-confirmed-development-only") {
  throw new Error("Explicit Development-only apply flag required; no database contacted.");
}
if (!process.env.DATABASE_URL) {
  throw new Error("Development connection not configured; no database contacted.");
}
const connection = new URL(process.env.DATABASE_URL);
if (!["postgres:", "postgresql:"].includes(connection.protocol)) {
  throw new Error("A PostgreSQL Development connection is required.");
}
const captured = JSON.parse(await readFile("/tmp/feedback-preservation-baselines.json", "utf8"));
const identityValues = captured.identityCsv.trim().split("\n")[1].split(",");
const expectedIdentity = { database: identityValues[0], role: identityValues[1], database_oid: identityValues[2], server_started: identityValues[5] };
const report = await readFile(path.join(root, "docs/feedback-migration-validation.md"), "utf8");
if (!report.includes("**Status:** PASS")) throw new Error("Isolated migration validation has not passed.");
const migrations = [];
for (const match of report.matchAll(/\| `(003[1-6]_[^`]+\.sql)` \| `([a-f0-9]{64})` \|/g)) {
  const sql = await readFile(path.join(root, "lib/db/drizzle", match[1]), "utf8");
  if (createHash("sha256").update(sql).digest("hex") !== match[2]) {
    throw new Error(`${match[1]} changed after its isolated rehearsal; apply refused.`);
  }
  const statements = sql.replace(/--[^\r\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  if (/\b(?:DROP\s+(?:TABLE|INDEX|CONSTRAINT|COLUMN|SCHEMA|TYPE|TRIGGER|FUNCTION)|TRUNCATE\b|DELETE\s+FROM\b)/i.test(statements)) {
    throw new Error(`${match[1]} contains forbidden destructive SQL.`);
  }
  migrations.push({ name: match[1], sql, hash: createHash("sha256").update(sql).digest("hex") });
}
if (migrations.length !== 6) throw new Error("Exactly rehearsed migrations 0031–0036 required.");
const journal = JSON.parse(await readFile(path.join(root, "lib/db/drizzle/meta/_journal.json"), "utf8"));
for (const migration of migrations) {
  const entry = journal.entries.find(entry => `${entry.tag}.sql` === migration.name);
  if (!entry) throw new Error("Selected migration is missing its journal metadata.");
  migration.when = entry.when;
}
const baselineSql = captured.baseline.map(table => {
  if (!/^[a-z0-9_]+$/.test(table.table) ||
      !/^([a-z0-9_]+|"[a-z0-9_]+")(,([a-z0-9_]+|"[a-z0-9_]+"))*$/.test(table.columns)) {
    throw new Error("Unsafe baseline metadata identifier.");
  }
  return `SELECT '${table.table}' AS table_name, count(*)::int AS rows,
    md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'[]')) AS fingerprint
    FROM (SELECT ${table.columns} FROM public.${table.table}) t`;
}).join(" UNION ALL ");
function assertRows(rows) {
  if (rows.length !== 91) throw new Error("Incomplete original-record verification.");
  for (const row of rows) {
    const old = captured.baseline.find(old => old.table === row.table_name);
    if (!old || Number(old.count) !== row.rows || old.fingerprint !== row.fingerprint) {
      throw new Error(`Original Development data changed in ${row.table_name}; transaction refused.`);
    }
  }
}
const metadataSql = `SELECT 'column' AS kind, c.relname AS table_name, a.attname AS name,
  jsonb_build_array(a.attnum,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,
    a.attgenerated,pg_get_expr(d.adbin,d.adrelid))::text AS definition
  FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
  WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'constraint',c.relname,x.conname,jsonb_build_array(x.contype,pg_get_constraintdef(x.oid,true),x.convalidated)::text
  FROM pg_constraint x JOIN pg_class c ON c.oid=x.conrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'`;
const client = new Client({ connectionString: process.env.DATABASE_URL });
let inTransaction = false;
try {
  await client.connect();
  await client.query("BEGIN READ ONLY");
  inTransaction = true;
  const identity = (await client.query(`SELECT current_database() AS database,current_user AS role,
    (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid,
    pg_postmaster_start_time()::text AS server_started`)).rows[0];
  for (const key of Object.keys(expectedIdentity)) {
    if (identity[key] !== expectedIdentity[key]) throw new Error("Independent Development identity mismatch; no DDL run.");
  }
  assertRows((await client.query(baselineSql)).rows);
  await client.query("COMMIT");
  inTransaction = false;
  await client.query("BEGIN");
  inTransaction = true;
  await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('edupulse-development-feedback-migrations'))");
  const beforeTableCount = Number((await client.query("SELECT count(*) FROM pg_tables WHERE schemaname='public'")).rows[0].count);
  if (beforeTableCount !== 91) throw new Error("Development already changed; do not replay these migrations.");
  assertRows((await client.query(baselineSql)).rows);
  const oldMetadata = (await client.query(metadataSql)).rows;
  const oldLedger = (await client.query("SELECT id,hash,created_at::text FROM drizzle.__drizzle_migrations ORDER BY id")).rows;
  if (oldLedger.map(row => row.id).join(",") !== "1,2,3,4,5") throw new Error("Historical ledger changed; no replay permitted.");
  for (const migration of migrations) {
    await client.query(migration.sql);
    await client.query("INSERT INTO drizzle.__drizzle_migrations(hash,created_at) VALUES($1,$2)", [migration.hash, migration.when]);
  }
  assertRows((await client.query(baselineSql)).rows);
  const newMetadata = new Map((await client.query(metadataSql)).rows.map(row =>
    [`${row.kind}:${row.table_name}:${row.name}`, row.definition]));
  for (const row of oldMetadata) {
    if (newMetadata.get(`${row.kind}:${row.table_name}:${row.name}`) !== row.definition) {
      throw new Error("A pre-existing column or constraint changed; transaction rolled back.");
    }
  }
  const newLedger = (await client.query("SELECT id,hash,created_at::text FROM drizzle.__drizzle_migrations ORDER BY id")).rows;
  if (JSON.stringify(newLedger.slice(0, 5)) !== JSON.stringify(oldLedger) || newLedger.length !== 11) {
    throw new Error("Historical migration ledger preservation failed.");
  }
  const counts = (await client.query(`SELECT (SELECT count(*) FROM pg_tables WHERE schemaname='public')::int AS tables,
    (SELECT count(*) FROM schools)::int AS schools,(SELECT count(*) FROM students)::int AS students,
    (SELECT count(*) FROM employees)::int AS employees,(SELECT count(*) FROM nfc_cards)::int AS cards`)).rows[0];
  await client.query("COMMIT");
  inTransaction = false;
  const evidence = { status: "COMMITTED_DEVELOPMENT_ONLY", migrations: migrations.map(({ name, hash }) => ({ name, hash })),
    originalTables: 91, originalRows: 396, originalFingerprintsUnchanged: true,
    historicalLedgerRowsUnchanged: 5, newLedgerRows: 6, oldColumnsAndConstraintsUnchanged: true, counts };
  await writeFile("/tmp/feedback-development-apply-evidence.json", JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} catch (error) {
  if (inTransaction) await client.query("ROLLBACK");
  console.error(error instanceof Error ? error.message.replaceAll(process.env.DATABASE_URL, "[REDACTED]") : "Apply failed; details withheld.");
  process.exitCode = 1;
} finally {
  await client.end();
}