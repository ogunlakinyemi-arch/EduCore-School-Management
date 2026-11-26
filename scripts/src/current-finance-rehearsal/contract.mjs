// Pure repository contract. No application imports, credentials or SQL execution.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { readSourceContract } from "../current-finance-source-contract.mjs";
import { compilePackage } from "../production-activation-package.mjs";

export const root = fileURLToPath(new URL("../../../", import.meta.url));
export const read = path => readFileSync(new URL("../../../" + path, import.meta.url), "utf8");
export const structuralOrder = Object.freeze([
  "lib/db/drizzle/0181_current_subscription_lifecycle.sql",
  "lib/db/drizzle/0182_current_bulk_withdrawals_field_sms.sql",
]);
export const hashes = Object.freeze([
  "dd9c559b3d43b18801e090cd567de32d04f605bea2d35987368a1a78bf9273fe",
  "acdcf3d7ef2ad1671be347fc0d4477d72ad7425e66144c2fd779eb14d7dedacf",
]);
export const sha256 = value => createHash("sha256").update(value).digest("hex");
export function loadContract() {
  const sources = structuralOrder.map((path, i) => {
    const sql = read(path); assert.equal(sha256(sql), hashes[i], `Unreviewed structural source: ${path}`);
    assert.equal((sql.match(/^BEGIN;/gm) ?? []).length, 1);
    assert.equal((sql.match(/^COMMIT;/gm) ?? []).length, 1);
    assert.doesNotMatch(sql, /\b(?:COPY|PROGRAM|dblink|http_get|http_post|CREATE EXTENSION)\b/i);
    return sql;
  });
  const { files, manifest } = compilePackage(read);
  for (const [path, contents] of Object.entries(files)) assert.equal(read(path), contents, `Stale packet: ${path}`);
  const tables = readSourceContract(sources);
  assert.equal(tables.size, 15);
  assert.equal((sources.join("\n").match(/CREATE FUNCTION guard_current_bulk_scope\(/g) ?? []).length, 1);
  assert.doesNotMatch(sources[0], /CREATE (?:OR REPLACE )?FUNCTION/);
  const current = manifest.groups.find(g => g.id === "current");
  assert.equal(current.triggers.length, 17);
  for (const group of ["student", "free-terms", "current"]) {
    assert.match(files[`db/production-activation/${group}.verify.sql`], /^--[^\n]*\nSELECT /);
    assert.doesNotMatch(files[`db/production-activation/${group}.verify.sql`], /^(?:CREATE|ALTER|DROP|DO|CALL|INSERT|UPDATE|DELETE|SET|BEGIN)\b/im);
  }
  return { sources, tables, current, files, manifest };
}
export function requireCleanEnvironment(env) {
  const allowed = new Set(["PATH", "HOME", "LANG", "NODE_ENV"]);
  assert.equal(env.NODE_ENV, "test", "NODE_ENV=test is required");
  assert.deepEqual(Object.keys(env).filter(k => !allowed.has(k)), [], "Use the documented clean-process invocation");
}
export function requireIdentity(row, expected) {
  assert.equal(row.ip, null, "Only private Unix sockets are allowed");
  assert.equal(row.db, "finance_rehearsal");
  assert.equal(row.role, "neondb_owner");
  assert.equal(row.session_role, "neondb_owner");
  assert.equal(row.data, expected.data);
  assert.equal(row.port, expected.port);
  assert.equal(row.search_path, "public, pg_catalog");
  assert.equal(row.read_only, "off");
  assert.equal(row.recovery, false);
  assert.equal(Math.floor(Number(row.version) / 10000), 16);
}
