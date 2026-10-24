import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CANDIDATE_TABLES, MANIFEST_VERSION, dependencyOrder, schoolIds } from "./manifest.mjs";
import { createReport, compareEvidence } from "./preflight.mjs";
import { preflightSql } from "./sql.mjs";
import { main } from "./cli.mjs";

const now = Date.parse("2026-10-24T12:00:00Z");
const hash = "a".repeat(32), changed = "b".repeat(32);
function fixture() {
  return {
    environment: "production", manifestVersion: MANIFEST_VERSION,
    selectedSchoolIds: [9], observedAt: new Date(now).toISOString(),
    identity: { database: "fictional_production", inRecovery: false, transactionReadOnly: "off" },
    primaryBinding: { verified: true }, backup: { verified: true, restoreDrillVerified: true },
    connectionHealth: { verified: true }, ownerAccess: { activeOwners: 1 },
    schemaFingerprint: hash, migrationFingerprint: hash, unsupportedForeignKeys: 0,
    tables: [...CANDIDATE_TABLES, "app_users", "school_memberships", "audit_logs",
      "platform_devices", "device_credentials"].map(name => ({
      name, scopeSupported: true, totalRows: name === "schools" ? 1 : 0,
      selectedRows: name === "schools" ? 1 : 0,
      fingerprint: hash, outsideScopeFingerprint: hash,
    })),
    foreignKeys: [{ name: "fixture_school_fk", child: "students", parent: "schools",
      validated: true, onDelete: "r", orphanRows: 0, retainedReferencingRows: 0 }],
  };
}
const report = evidence => createReport({ ids: [9], evidence, now });

test("default report has no connection, no mutation and no execution capability", () => {
  const result = report();
  assert.equal(result.dryRun, true);
  assert.equal(result.executionAvailable, false);
  assert.equal(result.readyForDeletion, false);
  assert.equal(result.databaseConnectionsOpened, 0);
  assert.equal(result.mutationsPerformed, 0);
  assert.equal(result.rowCountPreview, null);
  assert.equal(result.dependencyOrderedCandidateManifest, null);
});

test("an operator file cannot self-certify primary, backup or health", () => {
  const result = report(fixture());
  assert.equal(result.readyForDeletion, false);
  assert.equal(result.gates.operatorBackupClaimIgnored, true);
  assert.equal(result.gates.operatorPrimaryClaimIgnored, true);
  assert.equal(result.gates.operatorHealthClaimIgnored, true);
  assert.ok(result.blockers.includes("DESTRUCTIVE_EXECUTOR_NOT_IMPLEMENTED"));
});

test("replica and read-only sessions are explicitly blocked", () => {
  const e = fixture();
  e.identity.inRecovery = true; e.identity.transactionReadOnly = "on";
  const result = report(e);
  assert.ok(result.blockers.includes("WRITABLE_PRIMARY_NOT_OBSERVED"));
  assert.ok(result.blockers.includes("READ_ONLY_SESSION_CANNOT_CERTIFY_WRITABILITY"));
});

test("Development, wrong school, stale and future evidence are rejected", () => {
  for (const patch of [
    { environment: "development" }, { selectedSchoolIds: [8] },
    { observedAt: new Date(now - 16 * 60_000).toISOString() },
    { observedAt: new Date(now + 1).toISOString() }, { manifestVersion: "unreviewed" },
  ]) assert.throws(() => report(Object.assign(fixture(), patch)));
});

test("school IDs are explicit canonical positive integers and never SQL fragments", () => {
  assert.deepEqual(schoolIds("9,2,9"), [2, 9]);
  for (const input of [undefined, "", "all", "0", "-1", "1;DELETE", "1 OR 1=1",
    "1, 2", "2147483648", "1e2"]) assert.throws(() => schoolIds(input));
});

test("manifest retains auth, audit, financial, reusable and hardware records", () => {
  for (const table of ["app_users", "school_memberships", "audit_logs",
    "subscriptions", "student_subscription_payments", "commission_ledger", "fee_payments",
    "device_credentials", "platform_devices", "device_assignment_history",
    "curriculum_imports", "curriculum_versions", "school_branding_logos", "nfc_cards",
    "attendance_events", "academic_report_cards", "flutterwave_split_settings"]) {
    assert.ok(!CANDIDATE_TABLES.includes(table), table);
  }
});

test("dependency order is children before parents; cycles never disappear silently", () => {
  const result = dependencyOrder([
    { child: "students", parent: "school_classes" },
    { child: "school_classes", parent: "schools" },
  ]);
  assert.ok(result.order.indexOf("students") < result.order.indexOf("school_classes"));
  assert.ok(result.order.indexOf("school_classes") < result.order.indexOf("schools"));
  assert.deepEqual(result.unresolved, []);
  const cyclic = dependencyOrder([
    { child: "students", parent: "schools" }, { child: "schools", parent: "students" },
  ]);
  assert.ok(cyclic.unresolved.includes("schools"));
});

test("retained children block candidate parents even with ON DELETE CASCADE", () => {
  const e = fixture();
  e.foreignKeys.push({ name: "retained_audit_fk", child: "audit_logs", parent: "schools",
    validated: true, onDelete: "c", orphanRows: 0, retainedReferencingRows: 3 });
  const result = report(e);
  assert.ok(result.blockers.includes("RETAINED_RECORDS_PREVENT_TENANT_DELETION"));
  assert.equal(result.protectedReferences[0].blockingRows, 3);
});

test("bad integrity, cross-schema edges, missing owner and missing schools block planning", () => {
  const e = fixture();
  e.foreignKeys[0].orphanRows = 1;
  e.unsupportedForeignKeys = 1; e.ownerAccess.activeOwners = 0;
  e.tables.find(t => t.name === "schools").selectedRows = 0;
  const result = report(e);
  for (const code of ["REFERENTIAL_INTEGRITY_CHECK_FAILED",
    "CROSS_SCHEMA_DEPENDENCIES_REQUIRE_REVIEW", "ACTIVE_OWNER_ACCESS_NOT_OBSERVED",
    "SELECTED_SCHOOL_ROWS_MISSING"]) assert.ok(result.blockers.includes(code));
});

test("missing tables, malformed counts and duplicate catalogue rows cannot certify scope", () => {
  const missing = fixture(); missing.tables.pop();
  assert.throws(() => report(missing));
  const negative = fixture(); negative.tables[0].selectedRows = -1;
  assert.throws(() => report(negative));
  const duplicate = fixture(); duplicate.tables.push(duplicate.tables[0]);
  assert.throws(() => report(duplicate));
  const unknownFK = fixture(); unknownFK.foreignKeys[0].child = "not_in_catalog";
  assert.throws(() => report(unknownFK));
  const badColumns = fixture();
  badColumns.foreignKeys[0].columns = [{ child: "school_id", parent: "id", nullable: "true" }];
  assert.throws(() => report(badColumns), /INVALID_FOREIGN_KEY_COLUMN_EVIDENCE/);
});

test("unknown tables are retained and unsupported candidate scopes are reported", () => {
  const e = fixture();
  e.tables.push({ name: "future_table", scopeSupported: false, totalRows: 4,
    selectedRows: null, fingerprint: hash, outsideScopeFingerprint: hash });
  e.tables[0].scopeSupported = false; e.tables[0].selectedRows = null;
  assert.ok(report(e).blockers.includes("CANDIDATE_SCOPE_UNSUPPORTED_RETAIN_ROWS"));
  assert.ok(!report(e).rowCountPreview.some(t => t.table === "future_table"));
});

test("confirmation digest changes with counts, scope or snapshot contents", () => {
  const a = fixture(), b = fixture();
  b.tables[0].totalRows = 1;
  assert.notEqual(report(a).expectedConfirmation, report(b).expectedConfirmation);
  assert.equal(report(a).confirmationIsAuthorization, false);
});

test("SQL is SELECT-only and does not generate credentials or deletion commands", () => {
  const sql = preflightSql("9,2");
  assert.match(sql, /t\.school_id IN \(2,9\)/);
  assert.match(sql, /pg_is_in_recovery/);
  assert.match(sql, /retained_referencing_rows/);
  assert.match(sql, /orphan_rows/);
  assert.match(sql, /outside_scope_fingerprint/);
  assert.doesNotMatch(sql, /\b(DELETE|TRUNCATE|INSERT|UPDATE|ALTER|DROP|CREATE|SET|nextval|setval)\b/i);
  assert.doesNotMatch(sql, /DATABASE_URL|SECRET_KEY|FLWSECK|SELECT\s+u\.clerk_user_id/i);
  assert.match(sql, /\(%s\) IS NOT TRUE/); // NULL tenant scope is retained too.
});

test("post-reset observation detects collateral changes and never certifies a Production reset", () => {
  const before = fixture(), after = fixture();
  const school = after.tables.find(t => t.name === "schools");
  school.totalRows = 0; school.selectedRows = 0;
  let result = compareEvidence(before, after, [9], now);
  assert.equal(result.observationChecksPassed, true);
  assert.equal(result.verifiedProductionReset, false);
  after.tables.find(t => t.name === "app_users").fingerprint = changed;
  after.tables.find(t => t.name === "students").outsideScopeFingerprint = changed;
  after.schemaFingerprint = changed;
  after.foreignKeys[0].orphanRows = 1;
  result = compareEvidence(before, after, [9], now);
  for (const failure of ["RETAINED_TABLE_CHANGED:app_users", "OUT_OF_SCOPE_ROWS_CHANGED:students",
    "SCHEMA_CHANGED", "POST_RESET_INTEGRITY_FAILED"]) assert.ok(result.failures.includes(failure));
});

test("CLI hard-stops execute before reading even a nonexistent evidence file", async () => {
  for (const extra of [[], ["--confirm", "PRODUCTION-TEST-RESET:fictional"]]) {
    const output = [];
    const code = await main(["--school-ids", "9", "--execute", "--evidence-file",
      "/nonexistent/evidence.json", ...extra], value => output.push(value));
    assert.equal(code, 2);
    const result = JSON.parse(output[0]);
    assert.equal(result.mutationsPerformed, 0);
    assert.ok(result.blockers.includes("DESTRUCTIVE_EXECUTION_UNAVAILABLE_REGARDLESS_OF_CONFIRMATION"));
  }
});

test("CLI default is blocked offline; unknown flags and confirmation bypasses fail", async () => {
  const output = [];
  assert.equal(await main(["--school-ids", "9"], value => output.push(value)), 2);
  assert.equal(JSON.parse(output[0]).dryRun, true);
  await assert.rejects(main(["--school-ids", "9", "--force"]));
  await assert.rejects(main(["--school-ids", "9", "--confirm", "anything"]));
  await assert.rejects(main(["--school-ids", "9", "--school-ids", "10"]));
});

test("exact pnpm separator invocation produces a blocked dry-run report, not a parsing error", () => {
  const result = spawnSync("pnpm", ["--filter", "@workspace/scripts", "run",
    "production-reset:preflight", "--", "--school-ids", "1,2", "--dry-run"], {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)), encoding: "utf8",
    timeout: 15_000,
  });
  assert.ifError(result.error);
  // pnpm can wrap the CLI's deliberate exit 2 as its own nonzero status.
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout + result.stderr, /INVALID_OR_DUPLICATE_ARGUMENT/);
  const report = JSON.parse(result.stdout.slice(result.stdout.indexOf("{"),
    result.stdout.lastIndexOf("}") + 1));
  assert.deepEqual(report.selectedSchoolIds, [1, 2]);
  assert.equal(report.dryRun, true);
  assert.equal(report.readyForDeletion, false);
  assert.equal(report.executionAvailable, false);
  assert.equal(report.databaseConnectionsOpened, 0);
  assert.equal(report.mutationsPerformed, 0);
});

test("forwarded separator accepts documented modes but never enables execution", async () => {
  for (const prefix of [[], ["--"]]) {
    const output = [];
    assert.equal(await main([...prefix, "--school-ids", "1,2", "--dry-run"],
      value => output.push(value)), 2);
    assert.deepEqual(JSON.parse(output.pop()).selectedSchoolIds, [1, 2]);
    assert.equal(await main([...prefix, "--school-ids", "1,2", "--dry-run", "--print-sql"],
      value => output.push(value)), 0);
    assert.match(output.pop(), /production_reset_preflight/);
    assert.equal(await main([...prefix, "--help"], value => output.push(value)), 0);
    assert.match(output.pop(), /--evidence-file/);
    assert.equal(await main([...prefix, "--school-ids", "1,2", "--execute",
      "--confirm", "PRODUCTION-TEST-RESET:fictional", "--evidence-file", "/nonexistent/file"],
    value => output.push(value)), 2);
    const refused = JSON.parse(output.pop());
    assert.equal(refused.databaseConnectionsOpened, 0);
    assert.equal(refused.mutationsPerformed, 0);
    assert.ok(refused.blockers.includes("DESTRUCTIVE_EXECUTION_UNAVAILABLE_REGARDLESS_OF_CONFIRMATION"));
  }
});

test("leading package separator never conceals duplicate flags or malformed separators", async () => {
  for (const args of [
    ["--school-ids", "1,2", "--dry-run", "--dry-run"],
    ["--school-ids", "1,2", "--school-ids", "3"],
    ["--school-ids", "1,2", "--execute", "--execute"],
    ["--school-ids", "1,2", "--print-sql", "--print-sql"],
    ["--school-ids", "1,2", "--evidence-file", "/unused", "--evidence-file", "/unused"],
    ["--school-ids", "1,2", "--compare-with", "/unused", "--compare-with", "/unused"],
    ["--school-ids", "1,2", "--confirm", "one", "--confirm", "two"],
    ["--help", "--help"],
    ["--", "--", "--school-ids", "1,2"],
    ["--school-ids", "1,2", "--", "--dry-run"],
  ]) {
    for (const prefix of [[], ["--"]]) {
      await assert.rejects(main([...prefix, ...args], () => {
        assert.fail("invalid arguments must not print a plan or read evidence");
      }), /INVALID_OR_DUPLICATE_ARGUMENT/);
    }
  }
});

test("CLI reads only private evidence and never echoes arbitrary secret-like fields", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "reset-offline-test-"));
  const file = path.join(dir, "fixture.json");
  try {
    const e = fixture(); e.observedAt = new Date().toISOString();
    e.arbitrary = "DO_NOT_PRINT_FICTIONAL_SECRET";
    await writeFile(file, JSON.stringify(e), { mode: 0o600 });
    const output = [];
    assert.equal(await main(["--school-ids", "9", "--evidence-file", file],
      value => output.push(value)), 2);
    assert.equal(await main(["--", "--school-ids", "9", "--dry-run", "--evidence-file", file],
      value => output.push(value)), 2);
    assert.ok(!output[0].includes(e.arbitrary));
    await writeFile(path.join(dir, "public.json"), JSON.stringify(e), { mode: 0o644 });
    await assert.rejects(main(["--school-ids", "9", "--evidence-file",
      path.join(dir, "public.json")]), /PRIVATE_OWNED_REGULAR_EVIDENCE_FILE_REQUIRED/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
