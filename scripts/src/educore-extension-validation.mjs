#!/usr/bin/env node
/**
 * Development-only evidence and disposable PostgreSQL migration rehearsal.
 * No production target, deployment hook, or live schema write is supported.
 */
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

const root = resolve(import.meta.dirname, "../..");
const require = createRequire(join(root, "lib/db/package.json"));
const { Client } = require("pg");
const mode = process.argv[2];
const evidenceDir = process.argv[3];
const migrationsDir = join(root, "lib/db/drizzle");
const safeIdentifier = (value) => {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw new Error("Unsafe database identifier");
  return `"${value}"`;
};
const identitySql = `SELECT json_build_object(
  'database',current_database(),'databaseOid',(SELECT oid FROM pg_database WHERE datname=current_database()),
  'schoolsOid','public.schools'::regclass::oid,'studentsOid','public.students'::regclass::oid,
  'publicTables',(SELECT count(*) FROM pg_tables WHERE schemaname='public'),
  'schools',(SELECT count(*) FROM public.schools),'students',(SELECT count(*) FROM public.students)) AS identity`;
const fkSql = `SELECT oid::text, conrelid::regclass::text AS relation, conname,
  pg_get_constraintdef(oid) AS definition,convalidated
  FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace ORDER BY oid`;
const fkFingerprintSql = `SELECT count(*) AS foreign_keys,
  md5(string_agg(conrelid::text||':'||oid::text||':'||conname||':'||pg_get_constraintdef(oid)||':'||convalidated::text,
  '|' ORDER BY oid)) AS foreign_key_fingerprint
  FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace`;

async function openDevelopment() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query("BEGIN READ ONLY");
  return client;
}

async function fingerprints(client, originals) {
  const tables = originals ?? (await client.query(`SELECT schemaname AS schema,tablename AS name
    FROM pg_tables WHERE schemaname IN ('public','drizzle') ORDER BY schemaname,tablename`)).rows;
  const output = [];
  for (const table of tables) {
    const columns = table.columns ?? (await client.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position`, [table.schema, table.name]))
      .rows.map((row) => row.column_name);
    const projected = columns.map(safeIdentifier).join(",");
    const result = await client.query(`SELECT count(*)::int AS rows,
      md5(coalesce(string_agg(md5(row_to_json(t)::text),'' ORDER BY md5(row_to_json(t)::text)),'')) AS checksum
      FROM (SELECT ${projected} FROM ${safeIdentifier(table.schema)}.${safeIdentifier(table.name)}) t`);
    output.push({ ...table, columns, ...result.rows[0] });
  }
  return output;
}

function command(name, args, input) {
  const result = spawnSync(name, args, { encoding: "utf8", input, maxBuffer: 32 * 1024 * 1024,
    timeout: 180_000, env: { ...process.env, PGOPTIONS: "-c default_transaction_read_only=on" } });
  if (result.status !== 0) {
    // Never echo arguments, environment, connection strings, or arbitrary live errors.
    throw new Error(`${name} failed (${result.status}); command output withheld`);
  }
  return result.stdout;
}

async function capture() {
  const [oid, schoolsOid, studentsOid, foreignKeyFingerprint] = process.argv.slice(4);
  if (![oid, schoolsOid, studentsOid].every((value) => /^\d+$/.test(value ?? "")) ||
      !/^[a-f0-9]{32}$/.test(foreignKeyFingerprint ?? "")) {
    throw new Error("Requires independently verified Development catalog identifiers and FK fingerprint");
  }
  const client = await openDevelopment();
  try {
    const identity = (await client.query(identitySql)).rows[0].identity;
    const fkFingerprint = (await client.query(fkFingerprintSql)).rows[0];
    if (String(identity.databaseOid) !== oid || String(identity.schoolsOid) !== schoolsOid ||
        String(identity.studentsOid) !== studentsOid ||
        fkFingerprint.foreign_key_fingerprint !== foreignKeyFingerprint) {
      throw new Error("Actual application connection does not match independently verified Development");
    }
    const baseline = { identity, foreignKeys: (await client.query(fkSql)).rows,
      fingerprints: await fingerprints(client) };
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(join(evidenceDir, "baseline.json"), JSON.stringify(baseline, null, 2));
    const schema = command("pg_dump", ["--schema-only", "--no-owner", "--no-privileges",
      "--schema=public", "--schema=drizzle", "--dbname", process.env.DATABASE_URL]);
    await writeFile(join(evidenceDir, "development-schema.sql"), schema);
    console.log(JSON.stringify({ verifiedDevelopment: true, originalTables: baseline.fingerprints.length,
      originalRows: baseline.fingerprints.reduce((sum, table) => sum + table.rows, 0),
      originalForeignKeys: baseline.foreignKeys.length }));
  } finally { await client.query("ROLLBACK"); await client.end(); }
}

async function compare() {
  const baseline = JSON.parse(await readFile(join(evidenceDir, "baseline.json"), "utf8"));
  const client = await openDevelopment();
  try {
    const identity = (await client.query(identitySql)).rows[0].identity;
    for (const key of ["databaseOid", "schoolsOid", "studentsOid"]) {
      if (String(identity[key]) !== String(baseline.identity[key])) throw new Error("Development target changed");
    }
    const actualTables = await fingerprints(client, baseline.fingerprints);
    // Browser verification legitimately appends audit entries. Retain them:
    // compare the original id-ordered rows rather than deleting test history.
    let appendedAuditEntries = 0;
    for (let index = 0; index < actualTables.length; index++) {
      const table = actualTables[index];
      const original = baseline.fingerprints[index];
      if (table.schema !== "public" || table.name !== "audit_logs" || table.rows <= original.rows) continue;
      const projected = original.columns.map(safeIdentifier).join(",");
      const result = await client.query(`SELECT count(*)::int AS rows,
        md5(coalesce(string_agg(md5(row_to_json(t)::text),'' ORDER BY md5(row_to_json(t)::text)),'')) AS checksum
        FROM (SELECT ${projected} FROM public.audit_logs ORDER BY id LIMIT $1) t`, [original.rows]);
      if (result.rows[0].rows === original.rows && result.rows[0].checksum === original.checksum) {
        appendedAuditEntries = table.rows - original.rows;
        table.rows = original.rows;
        table.checksum = original.checksum;
      }
    }
    const changed = actualTables.filter((table, index) =>
      table.rows !== baseline.fingerprints[index].rows || table.checksum !== baseline.fingerprints[index].checksum);
    const foreignKeys = (await client.query(fkSql)).rows;
    const byOid = new Map(foreignKeys.map((fk) => [fk.oid, JSON.stringify(fk)]));
    const altered = baseline.foreignKeys.filter((fk) => byOid.get(fk.oid) !== JSON.stringify(fk));
    const report = { originalRecordsPreserved: changed.length === 0, originalForeignKeysPreserved: altered.length === 0,
      changedTables: changed.map((table) => `${table.schema}.${table.name}`),
      changedForeignKeys: altered.map((fk) => fk.conname),
      originalTables: actualTables.length, originalForeignKeys: baseline.foreignKeys.length,
      appendedAuditEntries,
      currentForeignKeys: foreignKeys.length };
    await writeFile(join(evidenceDir, "preservation.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    if (changed.length || altered.length) process.exitCode = 1;
  } finally { await client.query("ROLLBACK"); await client.end(); }
}

async function rehearse() {
  const [socket, port] = process.argv.slice(4);
  if (!socket?.startsWith("/tmp/") || !/^\d+$/.test(port ?? "")) {
    throw new Error("Rehearsal requires an explicitly started disposable socket under /tmp");
  }
  const client = new Client({ host: socket, port: Number(port), user: "runner", database: "postgres" });
  await client.connect();
  const sqlFiles = (await readdir(migrationsDir)).filter((file) => /^\d{4}_.+\.sql$/.test(file)).sort();
  const suffix = Date.now();
  const databaseNames = { replay: `educore_replay_${suffix}`, clone: `educore_clone_${suffix}` };
  const report = { databaseNames, fromBeginning: [], historicalClone: [], reversibleBeforeUse: false };
  try {
    for (const database of Object.values(databaseNames)) {
      await client.query(`CREATE DATABASE ${safeIdentifier(database)}`);
    }
    const replay = new Client({ host: socket, port: Number(port), user: "runner", database: databaseNames.replay });
    const clone = new Client({ host: socket, port: Number(port), user: "runner", database: databaseNames.clone });
    await replay.connect(); await clone.connect();
    try {
      for (const file of sqlFiles) {
        await replay.query(await readFile(join(migrationsDir, file), "utf8"));
        report.fromBeginning.push(file);
      }
      const originalSchema = await readFile(join(evidenceDir, "development-schema.sql"), "utf8");
      // pg_dump control directives are psql-only; avoid treating them as SQL.
      const schema = originalSchema.split("\n").filter((line) => !line.startsWith("\\"))
        .join("\n").replace(/^CREATE SCHEMA public;\r?\n/gm, "");
      await clone.query(schema);
      // pg_dump intentionally leaves search_path empty; migrations use public.
      await clone.query("SET search_path=public");
      const beforeFks = (await clone.query(fkSql)).rows;
      const additions = sqlFiles.filter((file) => Number(file.slice(0, 4)) >= 39);
      if (!additions.length) throw new Error("No extension migrations found");
      for (const file of additions) {
        const sql = await readFile(join(migrationsDir, file), "utf8");
        const executable = sql.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
        if (/\b(DROP|TRUNCATE|DELETE|DISABLE|RENAME)\b/i.test(executable)) {
          throw new Error(`Non-additive extension migration: ${file}`);
        }
      }
      await clone.query("BEGIN");
      for (const file of additions) await clone.query(await readFile(join(migrationsDir, file), "utf8"));
      await clone.query("ROLLBACK");
      report.reversibleBeforeUse = true;
      for (const file of additions) {
        await clone.query(await readFile(join(migrationsDir, file), "utf8"));
        report.historicalClone.push(file);
      }
      const afterFks = new Map((await clone.query(fkSql)).rows.map((fk) => [fk.oid, JSON.stringify(fk)]));
      if (beforeFks.some((fk) => afterFks.get(fk.oid) !== JSON.stringify(fk))) {
        throw new Error("An extension migration changed an existing FK");
      }
      report.existingCloneForeignKeysPreserved = true;
      report.validatedForeignKeys = (await clone.query(`SELECT count(*)::int AS n
        FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace AND NOT convalidated`)).rows[0].n === 0;
      if (!report.validatedForeignKeys) throw new Error("Unvalidated FK remains after clone upgrade");
      report.sqlHashes = Object.fromEntries(await Promise.all(additions.map(async (file) =>
        [file, createHash("sha256").update(await readFile(join(migrationsDir, file))).digest("hex")])));
      await writeFile(join(evidenceDir, "migration-rehearsal.json"), JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report));
    } finally { await replay.end(); await clone.end(); }
  } finally { await client.end(); }
}

if (!evidenceDir?.startsWith("/tmp/")) throw new Error("Evidence directory must be under /tmp");
try {
  if (mode === "capture") await capture();
  else if (mode === "compare") await compare();
  else if (mode === "rehearse") await rehearse();
  else throw new Error("Supported modes: capture, compare, rehearse (no live migration mode)");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Validation failed");
  process.exitCode = 1;
}