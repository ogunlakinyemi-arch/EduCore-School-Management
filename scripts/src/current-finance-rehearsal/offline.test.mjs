// These are pure/static tests, NOT an executable PostgreSQL rehearsal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadContract, structuralOrder, read, requireCleanEnvironment, requireIdentity } from "./contract.mjs";
const c = loadContract();
test("only unchanged 0181 then 0182 supplies structural/procedural installation", () => {
  assert.deepEqual(structuralOrder, ["lib/db/drizzle/0181_current_subscription_lifecycle.sql",
    "lib/db/drizzle/0182_current_bulk_withdrawals_field_sms.sql"]);
  assert.equal(c.tables.size, 15); assert.equal(c.current.triggers.length, 17);
  assert.match(c.sources[1], /CREATE FUNCTION guard_current_bulk_scope\(/);
  assert.ok(!structuralOrder.some(p => /current\.(functions|triggers)\.sql/.test(p)));
});
test("source keeps exact predecessor and replacement CHECK names", () => {
  assert.match(c.sources[1], /DROP CONSTRAINT current_subscription_operations_check;/);
  assert.match(c.sources[1], /ADD CONSTRAINT current_subscription_source_ck CHECK/);
  assert.ok(c.tables.get("current_subscription_operations").checks.some(x => x.name === "current_subscription_source_ck"));
});
test("descending index null placement matches PostgreSQL source defaults", () => {
  assert.deepEqual(c.tables.get("current_subscription_operation_events").indexes[0].columns,
    [{ name: "operation_id", order: "asc", nulls: "last" }, { name: "id", order: "desc", nulls: "first" }]);
});
test("inherited configuration or connection credentials cannot select a target", () => {
  const clean = { PATH: "/bin", HOME: "/fixture", LANG: "C.UTF-8", NODE_ENV: "test" };
  requireCleanEnvironment(clean);
  for (const key of ["DATABASE_URL", "PGHOST", "REPLIT_DEPLOYMENT", "FLUTTERWAVE_SECRET_KEY", "NODE_OPTIONS", "PGSERVICE"]) {
    assert.throws(() => requireCleanEnvironment({ ...clean, [key]: "fictional" }), /clean-process/);
  }
});
test("identity guard rejects nonlocal, wrong database/role/version and replica contexts", () => {
  const expected = { data: "/tmp/fixture/data", port: "56457" };
  const valid = { ip: null, db: "finance_rehearsal", role: "neondb_owner", session_role: "neondb_owner",
    data: expected.data, port: expected.port, search_path: "public, pg_catalog", read_only: "off", recovery: false, version: "160010" };
  requireIdentity(valid, expected);
  for (const delta of [{ ip: "127.0.0.1" }, { db: "neondb" }, { db: "heliumdb" }, { role: "postgres" },
    { session_role: "other" }, { data: "/tmp/other" }, { port: "5432" }, { search_path: '"$user", public' },
    { read_only: "on" }, { recovery: true }, { version: "150000" }]) {
    assert.throws(() => requireIdentity({ ...valid, ...delta }, expected));
  }
});
test("catalog verifier has no repair/mutation SQL and never uses EXPLAIN ANALYZE", () => {
  const code = read("scripts/src/current-finance-rehearsal/catalog.mjs");
  assert.doesNotMatch(code, /(?:query\(\s*[`"']|const sql = `)\s*(?:CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|CALL)\b/i);
  assert.doesNotMatch(code, /EXPLAIN\s*\([^)]*ANALYZE/i);
  assert.match(code, /SELECT pg|SELECT c|SELECT ix/);
});
test("real runner is gated before initdb and uses no application pool", () => {
  const runner = read("scripts/src/current-finance-rehearsal/runner.mjs");
  assert.ok(runner.indexOf("assert.notEqual(readlinkSync") < runner.indexOf('run("initdb"'));
  assert.doesNotMatch(runner, /@workspace\/db|process\.env\.(?:DATABASE_URL|PG|FLUTTERWAVE)/);
  assert.match(runner, /-h ''/);
  assert.match(runner, /BEGIN READ ONLY/);
});
