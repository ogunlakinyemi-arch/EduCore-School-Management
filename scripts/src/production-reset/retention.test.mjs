import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { retentionResolution, retentionRule } from "./retention.mjs";
import { rehearsalSql, rehearsalMain } from "./rehearsal.mjs";
import { preflightSql } from "./sql.mjs";

const table = (name, selectedRows = 0) => ({ name, totalRows: Math.max(1, selectedRows), selectedRows });
const fk = (child, nullable, parent = "schools") => ({
  name: `${child}_fictional_fk`, child, parent, retainedReferencingRows: 1,
  columns: [{ child: "school_id", parent: "id", nullable }],
});
const evidence = references => ({
  tables: [table("schools", 1), table("school_memberships"), table("platform_devices")],
  foreignKeys: references,
});

test("nullable auth, audit and financial relationships never become automatic detachments", () => {
  for (const child of ["school_memberships", "audit_logs", "fee_provider_webhook_events"]) {
    const result = retentionResolution(evidence([fk(child, true)]));
    const relationship = result.hardRelationships[0];
    assert.equal(relationship.classification, "HARD_BLOCKER");
    assert.equal(relationship.automaticDetachAllowed, false);
    assert.equal(relationship.columnEvidence[0].nullable, true);
    assert.equal(result.fullTenantRemovalBlocked, true);
    assert.deepEqual(result.automaticMutations, []);
  }
  assert.match(retentionRule("school_memberships").reason, /platform scope/);
  assert.match(retentionRule("audit_logs").reason, /provenance/);
});

test("device current binding, credentials and durable history preserve original schools", () => {
  const result = retentionResolution(evidence([
    fk("platform_devices", true, "school_classes"), fk("device_credentials", false),
    fk("device_assignment_history", false), fk("device_school_bindings", false),
  ]));
  assert.equal(result.hardRelationships.length, 4);
  assert.ok(result.hardRelationships.every(r => !r.automaticDetachAllowed));
  assert.match(result.hardRelationships.find(r => r.child === "platform_devices").transition, /UNASSIGNED/);
  assert.ok(result.operatorDecisions.some(d => d.includes("DEVICE_CREDENTIAL_AND_REPLAY")));
});

test("unknown references, missing column evidence and inactive memberships stay hard blockers", () => {
  const unknown = fk("unreviewed_history", true);
  delete unknown.columns;
  const input = evidence([unknown]);
  input.tables.push(table("school_memberships", 1));
  const result = retentionResolution(input);
  assert.equal(result.hardRelationships[0].catalogEvidence, "NOT_CAPTURED");
  assert.equal(result.hardRelationships[0].columnEvidence, null);
  assert.equal(result.hardRelationships[0].decision, "KEEP_UNCHANGED_AND_BLOCK");
  assert.ok(result.retainedTenantRows.some(t => t.table === "school_memberships"));
  assert.ok(result.operatorDecisions.some(d => d.includes("TENANT_MEMBERSHIPS_TO_KEEP_ACTIVE")));
});

test("platform-scoped membership rows are preserved without inventing a global count", () => {
  const result = retentionResolution(evidence([]));
  assert.deepEqual(result.automaticMutations, []);
  assert.deepEqual(result.retainedTenantRows, []);
  assert.match(result.platformMemberships, /NEVER_CONVERT_TENANT_MEMBERSHIP_TO_PLATFORM_SCOPE/);
  assert.match(result.schoolStatus, /NOT_A_VERIFIED_ARCHIVE/);
});

test("reports are deterministically sorted and do not echo unreviewed column properties", () => {
  const refs = [fk("platform_devices", true), fk("audit_logs", true)];
  refs[0].columns[0].arbitrary = "DO_NOT_PRINT_FICTIONAL_SECRET";
  const a = retentionResolution(evidence(refs));
  const b = retentionResolution(evidence([...refs].reverse()));
  assert.deepEqual(a, b);
  assert.doesNotMatch(JSON.stringify(a), /DO_NOT_PRINT_FICTIONAL_SECRET/);
});

test("printed preflight captures actual FK column pairs and nullability without mutations", () => {
  const sql = preflightSql("9");
  assert.match(sql, /'nullable',NOT ca\.attnotnull/);
  assert.match(sql, /'child',ca\.attname,'parent',pa\.attname/);
  assert.match(sql, /'columns',columns/);
  assert.doesNotMatch(sql, /\b(DELETE|TRUNCATE|INSERT|UPDATE|ALTER|DROP|CREATE|SET|nextval|setval)\b/i);
});

test("reviewed nullable/required source declarations still support the documented classifications", () => {
  const source = fs.readFileSync(new URL("../../../lib/db/src/schema/edupulse.ts", import.meta.url), "utf8");
  const finance = fs.readFileSync(new URL("../../../lib/db/src/schema/finance.ts", import.meta.url), "utf8");
  const schoolReference = (text, name) => {
    const start = text.indexOf(`"${name}"`);
    assert.ok(start >= 0, `source declaration missing: ${name}`);
    return text.slice(start).match(/schoolId:\s*([^\n]+)/)[1];
  };
  for (const name of ["school_memberships", "audit_logs", "platform_devices"]) {
    assert.doesNotMatch(schoolReference(source, name), /notNull/);
  }
  for (const name of ["device_credentials", "device_assignment_history", "device_school_bindings", "subscriptions"]) {
    assert.match(schoolReference(source, name), /notNull/);
  }
  assert.doesNotMatch(schoolReference(finance, "fee_provider_webhook_events"), /notNull/);
});

test("fictional rehearsal SQL is deterministic, locally guarded and rolls back each transition", () => {
  const sql = rehearsalSql();
  assert.equal(sql, rehearsalSql());
  assert.ok(sql.indexOf("ISOLATION_GUARD_FAILED") < sql.indexOf("CREATE SCHEMA"));
  for (const required of ["reset_rehearsal", "rehearsal_admin", "fixture_data", "fixture_socket",
    "listen_addresses", "inet_server_addr() IS NULL", "55483", "EMPTY_FRESH_DISPOSABLE_DATABASE_REQUIRED",
    "GET STACKED DIAGNOSTICS", "PROTECTED_PARENT_WAS_NOT_BLOCKED", "ROLLBACK_OR_PROTECTED_STATE_CHANGED",
    "SEQUENCE_STATE_CHANGED", "FICTIONAL_RELATIONSHIP_REHEARSAL_PASS_NOT_PRODUCTION_OR_EXECUTOR_CERTIFICATION"]) {
    assert.ok(sql.includes(required), required);
  }
  assert.equal((sql.match(/^BEGIN;/gm) ?? []).length, 3);
  assert.equal((sql.match(/^ROLLBACK;/gm) ?? []).length, 3);
  assert.match(sql, /UPDATE public\.platform_devices d SET school_id=NULL,school_class_id=NULL/);
  assert.doesNotMatch(sql, /(?:DELETE FROM|UPDATE) public\.(?:audit_logs|school_memberships|app_users|device_credentials|device_assignment_history|device_school_bindings|subscriptions|fee_payments|fee_provider_webhook_events)\b/);
  assert.doesNotMatch(sql, /\b(COMMIT|TRUNCATE|DISABLE TRIGGER|setval|nextval)\b/);
});

test("rehearsal printer rejects every execution/target flag without any database work", () => {
  for (const args of [["--run"], ["--execute"], ["--database-url", "fictional"],
    ["--print-sql", "--host", "fictional"], ["--print-sql", "--print-sql"]]) {
    const out = [];
    assert.equal(rehearsalMain(args, text => out.push(text)), 2);
    assert.equal(out[0], "REHEARSAL_SQL_PRINTER_HAS_NO_EXECUTION_OR_CONNECTION_OPTIONS");
  }
  const out = [];
  assert.equal(rehearsalMain(["--print-sql"], text => out.push(text)), 0);
  assert.equal(out[0], rehearsalSql());
  const printer = fs.readFileSync(new URL("./rehearsal.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(printer, /process\.env|child_process|createRequire|import.+from ["']pg["']/);
});

test("documented isolated shell parses offline without executing a command", () => {
  const doc = fs.readFileSync(new URL("./REHEARSAL.md", import.meta.url), "utf8");
  const body = doc.split("<<'ISOLATED_REHEARSAL'\n")[1]?.split("\nISOLATED_REHEARSAL\n")[0];
  assert.ok(body);
  const parsed = spawnSync("bash", ["--noprofile", "--norc", "-n"], {
    input: body, encoding: "utf8", timeout: 5_000, env: { PATH: process.env.PATH },
  });
  assert.ifError(parsed.error);
  assert.equal(parsed.status, 0, parsed.stderr);
  assert.match(doc, /PGPASSFILE=\/dev\/null PGSERVICEFILE=\/dev\/null/);
});
