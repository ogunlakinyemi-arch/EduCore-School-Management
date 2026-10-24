import assert from "node:assert/strict";
import { test } from "node:test";
import { CANDIDATE_TABLES, MANIFEST_VERSION } from "./manifest.mjs";
import { controlledPlan, validateAuthorization } from "./cleanup-policy.mjs";
import { runControlledCleanup } from "./cleanup-executor.mjs";
import { cleanupMain, connectionConfig } from "./cleanup-cli.mjs";

// Every "database" below is an in-memory protocol stub. No pg client, server,
// connection, real deletion or executor against any database is used by tests.
const now = Date.parse("2026-10-24T12:00:00Z");
const stamp = delta => new Date(now + delta).toISOString();
const hash = "a".repeat(64), changed = "b".repeat(64);
const clone = value => JSON.parse(JSON.stringify(value));
function proof() {
  return {
    version: 1, environment: "production", resourceId: "fictional-resource",
    appUrl: "https://educore.yetenia.com", verifiedAt: stamp(-30_000),
    bindingEvidenceSha256: hash,
    target: { host: "primary.example.invalid", port: 5432, database: "neondb",
      databaseOid: "100", role: "fictional_owner", systemIdentifier: "123456789" },
    authority: { role: "PLATFORM_OWNER", authorizationSha256: hash,
      retainedLogicalReferencesReviewed: true, testSchoolIds: [9] },
    maintenance: {
      resourceId: "fictional-resource", verifiedAt: stamp(-60_000), expiresAt: stamp(5 * 60_000),
      evidenceSha256: hash, ingressBlocked: true, workersStopped: true,
      devicesStopped: true, callbacksPaused: true, authHooksPaused: true, registrationStopped: true,
    },
    backup: {
      resourceId: "fictional-resource", kind: "PITR", pointId: "fictional-point",
      recoverableAt: stamp(-45_000), verifiedAt: stamp(-30_000), retentionUntil: stamp(24 * 3600_000),
      evidenceSha256: hash, restoreDrill: {
        resourceId: "fictional-resource", pointId: "fictional-point",
        verifiedAt: stamp(-20_000), evidenceSha256: hash,
      },
    },
  };
}
function evidence() {
  return {
    environment: "production", manifestVersion: MANIFEST_VERSION, selectedSchoolIds: [9],
    observedAt: stamp(0), identity: { database: "neondb", databaseOid: 100,
      role: "fictional_owner", inRecovery: false,
      transactionReadOnly: "off", defaultTransactionReadOnly: "off" },
    ownerAccess: { activeOwners: 1 }, schemaFingerprint: hash, migrationFingerprint: hash,
    unsupportedForeignKeys: 0,
    tables: [...CANDIDATE_TABLES, "app_users", "school_memberships", "audit_logs",
      "platform_devices", "device_credentials"].map(name => ({
      name, scopeSupported: true, totalRows: name === "schools" ? 1 : 0,
      selectedRows: name === "schools" ? 1 : 0, fingerprint: hash, outsideScopeFingerprint: hash,
    })),
    foreignKeys: [{ name: "fictional_school_fk", child: "students", parent: "schools",
      validated: true, onDelete: "r", orphanRows: 0, retainedReferencingRows: 0 }],
  };
}
function fakeClient(initial, options = {}) {
  const calls = [];
  let state = clone(initial), snapshots = 0, sequenceReads = 0;
  const client = {
    calls,
    async connect() { calls.push("CONNECT_STUB_ONLY"); },
    async end() { calls.push("END_STUB_ONLY"); },
    async query(sql, params) {
      calls.push(sql);
      if (options.failOn && sql.includes(options.failOn)) throw new Error("fictional failure");
      if (sql.includes("system_identifier")) return { rows: [{
        database: "neondb", database_oid: "100", role: "fictional_owner",
        system_identifier: options.wrongCluster ? "999" : "123456789",
        in_recovery: options.replica ?? false,
        transaction_read_only: calls.some(c => c.includes("SERIALIZABLE READ ONLY")) ? "on" : "off",
        default_transaction_read_only: "off", can_observe_sessions: !options.noVisibility,
      }] };
      if (sql.includes("AS others")) return { rows: [{ others: options.busy ? 1 : 0 }] };
      if (sql.includes("AS custom_triggers")) return { rows: [{
        custom_triggers: options.triggers ? 1 : 0, rls_tables: 0, table_rules: 0,
        partitioned_or_foreign: options.partitioned ? 1 : 0,
      }] };
      if (sql.includes("pg_try_advisory_xact_lock")) return { rows: [{ acquired: !options.otherCleanup }] };
      if (sql.includes("AS schema,c.relname AS name")) return { rows: [
        ...initial.tables.map(t => ({ schema: "public", name: t.name, relkind: "r" })),
        { schema: "_system", name: "replit_database_migrations_v1", relkind: "r" },
        { schema: "public", name: "schools_id_seq", relkind: "S" },
      ] };
      if (sql.includes("AS production_reset_preflight")) {
        snapshots++;
        const snapshot = clone(state);
        if (options.drift && snapshots === 1) snapshot.tables[0].fingerprint = changed;
        if (options.postCorruption && snapshots > 1) {
          snapshot.tables.find(t => t.name === "app_users").fingerprint = changed;
        }
        if (options.postOrphan && snapshots > 1) snapshot.foreignKeys[0].orphanRows = 1;
        return { rows: [{ production_reset_preflight: snapshot }] };
      }
      if (sql.startsWith("SELECT last_value::text")) {
        sequenceReads++;
        return { rows: [{ last_value: options.sequenceDrift && sequenceReads > 1 ? "2" : "1",
          is_called: true }] };
      }
      if (sql.startsWith("DELETE FROM")) {
        assert.deepEqual(params, [[9]]);
        const name = sql.match(/public\."([a-z_]+)"/)[1];
        const table = state.tables.find(t => t.name === name);
        const rows = table.selectedRows;
        table.totalRows -= rows; table.selectedRows = 0;
        return { rows: [], rowCount: options.wrongCount ? rows + 1 : rows };
      }
      if (sql === "ROLLBACK") {
        if (options.rollbackFails) throw new Error("fictional rollback lost");
        state = clone(initial);
      }
      if (sql === "COMMIT" && options.commitLost) throw new Error("fictional commit response lost");
      return { rows: [] };
    },
  };
  return client;
}
function setup(options = {}, input = evidence()) {
  const authorization = proof(), client = fakeClient(input, options);
  const token = controlledPlan(authorization, input, [9], now).expectedConfirmation;
  return {
    client, args: { proof: authorization, ids: [9], mode: "execute",
      reviewedEvidence: input, confirmation: token, clientFactory: () => client, now: () => now },
  };
}

test("controlled cleanup defaults to offline and requires fresh Owner evidence", async () => {
  let connections = 0;
  const result = await runControlledCleanup({ proof: proof(), ids: [9], now: () => now,
    clientFactory: () => { connections++; throw new Error("must not connect"); } });
  assert.equal(connections, 0);
  assert.equal(result.databaseConnectionsOpened, 0);
  assert.equal(result.mutationsPerformed, 0);
  const output = [];
  assert.equal(await cleanupMain(["--", "--school-ids", "9", "--dry-run"],
    value => output.push(value)), 2);
  assert.equal(JSON.parse(output[0]).databaseConnectionsOpened, 0);
});

test("wrong environment, resource, stale backup, missing restore/freeze and scope fail offline", () => {
  const cases = [
    p => { p.environment = "development"; },
    p => { p.verifiedAt = stamp(-16 * 60_000); },
    p => { p.backup.resourceId = "other-resource"; },
    p => { p.backup.recoverableAt = stamp(-61_000); },
    p => { p.backup.retentionUntil = stamp(-1); },
    p => { p.backup.restoreDrill = null; },
    p => { p.maintenance.workersStopped = false; },
    p => { p.maintenance.callbacksPaused = false; },
    p => { p.maintenance.authHooksPaused = false; },
    p => { p.maintenance.expiresAt = stamp(-1); },
    p => { p.authority.testSchoolIds = [8]; },
    p => { p.authority.retainedLogicalReferencesReviewed = false; },
  ];
  for (const mutate of cases) {
    const p = proof(); mutate(p);
    assert.throws(() => validateAuthorization(p, [9], now));
  }
});

test("missing exact token/preview prevents client construction", async () => {
  const { args } = setup();
  args.clientFactory = () => { assert.fail("offline gates must precede client construction"); };
  await assert.rejects(runControlledCleanup({ ...args, confirmation: "guessed" }), /EXACT_CONFIRMATION_REQUIRED/);
  await assert.rejects(runControlledCleanup({ ...args, reviewedEvidence: null }), /REVIEWED_ROW_COUNT_PREVIEW_REQUIRED/);
});

test("preserved tenant data and dependencies refuse the entire operation offline", async () => {
  const input = evidence();
  input.tables.find(t => t.name === "school_memberships").totalRows = 1;
  input.tables.find(t => t.name === "school_memberships").selectedRows = 1;
  input.foreignKeys.push({ name: "preserved_membership_fk", child: "school_memberships",
    parent: "schools", validated: true, onDelete: "c", orphanRows: 0, retainedReferencingRows: 1 });
  const plan = controlledPlan(proof(), input, [9], now);
  assert.equal(plan.ready, false);
  assert.ok(plan.blockers.includes("PRESERVED_RECORDS_PREVENT_FULL_TENANT_REMOVAL"));
  assert.ok(plan.blockers.includes("RETAINED_TEST_TENANT_DATA_REQUIRES_RETENTION_DECISION"));
  const { args } = setup({}, input);
  args.clientFactory = () => assert.fail("must not connect for retained records");
  await assert.rejects(runControlledCleanup(args), /PRESERVED_DEPENDENCIES_OR_PLAN_BLOCKERS/);
});

test("all-current scope, missing Owner, unsupported effects and bad integrity are blocked", () => {
  for (const mutate of [
    e => { e.tables.find(t => t.name === "schools").totalRows = 2; },
    e => { e.ownerAccess.activeOwners = 0; },
    e => { e.foreignKeys[0].orphanRows = 1; },
    e => { e.unsupportedForeignKeys = 1; },
  ]) {
    const input = evidence(); mutate(input);
    assert.equal(controlledPlan(proof(), input, [9], now).ready, false);
  }
});

test("primary credential configuration never falls back to workspace connection or unsafe TLS", () => {
  const target = proof().target;
  assert.throws(() => connectionConfig(target, { DATABASE_URL: "fictional" }),
    /DEDICATED_PRODUCTION_CONNECTION_REQUIRED/);
  const prefix = "postgresql://fictional_owner:fictional-password@primary.example.invalid:5432/neondb";
  const config = connectionConfig(target, { PRODUCTION_RESET_DATABASE_URL: prefix });
  assert.equal(config.ssl.rejectUnauthorized, true);
  for (const value of [prefix + "?sslmode=disable", prefix + "?options=unsafe",
    prefix.replace("primary.example.invalid", "other.example.invalid"),
    prefix.replace("/neondb", "/heliumdb")]) {
    assert.throws(() => connectionConfig(target, { PRODUCTION_RESET_DATABASE_URL: value }));
  }
});

test("replica, wrong cluster, insufficient visibility and active peers refuse before deletion", async () => {
  for (const options of [{ replica: true }, { wrongCluster: true }, { noVisibility: true },
    { busy: true }, { triggers: true }, { partitioned: true }, { otherCleanup: true }]) {
    const { args, client } = setup(options);
    const result = await runControlledCleanup(args);
    assert.equal(result.transactionCommitted, false);
    assert.ok(!client.calls.some(q => q.startsWith("DELETE")));
    assert.ok(client.calls.includes("ROLLBACK"));
  }
});

test("protocol stub enforces bounded lock-before-recheck and exact row counts", async () => {
  const { args, client } = setup();
  const result = await runControlledCleanup(args);
  assert.equal(result.transactionCommitted, true);
  assert.equal(result.deletedRows, 1);
  assert.equal(result.sequenceStateUnchanged, true);
  const lock = client.calls.findIndex(q => q.startsWith("LOCK TABLE"));
  const snapshot = client.calls.findIndex(q => q.includes("AS production_reset_preflight"));
  const deletion = client.calls.findIndex(q => q.startsWith("DELETE FROM"));
  assert.ok(lock < snapshot && snapshot < deletion);
  assert.ok(client.calls[deletion].includes('public."schools" WHERE "id" = ANY($1::integer[])'));
  assert.equal(client.calls.filter(q => q === "COMMIT").length, 1);
  assert.ok(client.calls.includes("BEGIN ISOLATION LEVEL READ COMMITTED"));
  assert.ok(!client.calls.some(q => /\b(TRUNCATE|ALTER|DROP|nextval|setval|RESTART IDENTITY)\b/i.test(q)));
});

test("live snapshot drift refuses before deletion; failed locks roll back", async () => {
  for (const options of [{ drift: true }, { failOn: "LOCK TABLE" }]) {
    const { args, client } = setup(options);
    const result = await runControlledCleanup(args);
    assert.equal(result.transactionCommitted, false);
    assert.equal(result.rollbackConfirmed, true);
    assert.ok(!client.calls.some(q => q.startsWith("DELETE")));
  }
});

test("count mismatch, protected corruption, new orphans and sequence drift roll back", async () => {
  for (const options of [{ wrongCount: true }, { postCorruption: true },
    { postOrphan: true }, { sequenceDrift: true }]) {
    const { args, client } = setup(options);
    const result = await runControlledCleanup(args);
    assert.equal(result.rollbackConfirmed, true);
    assert.equal(result.committedMutations, 0);
    assert.ok(!client.calls.includes("COMMIT"));
  }
});

test("preview protocol stub is read-only and cannot lock/delete/commit", async () => {
  const { args, client } = setup();
  const result = await runControlledCleanup({ ...args, mode: "preview" });
  assert.equal(result.mutationsPerformed, 0);
  assert.ok(result.evidence);
  assert.ok(client.calls.includes("BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY"));
  assert.ok(!client.calls.some(q => /^(DELETE|LOCK TABLE|COMMIT)/.test(q)));
  assert.ok(client.calls.includes("ROLLBACK"));
});

test("lost COMMIT and failed ROLLBACK remain uncertain, never retried", async () => {
  const commit = setup({ commitLost: true });
  const committed = await runControlledCleanup(commit.args);
  assert.equal(committed.outcome, "COMMIT_OUTCOME_UNKNOWN_DO_NOT_RETRY");
  assert.equal(committed.committedMutations, "UNKNOWN");
  assert.equal(commit.client.calls.filter(q => q === "COMMIT").length, 1);
  assert.ok(!commit.client.calls.includes("ROLLBACK"));
  const rollback = setup({ wrongCount: true, rollbackFails: true });
  const failed = await runControlledCleanup(rollback.args);
  assert.equal(failed.outcome, "ROLLBACK_UNCONFIRMED_OPERATOR_REVIEW_REQUIRED");
  assert.equal(failed.committedMutations, "UNKNOWN");
});

test("expired authorization during simulated deletion forces rollback", async () => {
  const { args, client } = setup();
  let calls = 0;
  args.now = () => ++calls < 6 ? now : now + 16 * 60_000;
  const result = await runControlledCleanup(args);
  assert.equal(result.transactionCommitted, false);
  assert.equal(result.rollbackConfirmed, true);
  assert.ok(!client.calls.includes("COMMIT"));
});

test("cleanup CLI duplicate/contradictory flags and guessed execution fail without a connection", async () => {
  for (const args of [
    ["--school-ids", "9", "--dry-run", "--execute"],
    ["--school-ids", "9", "--preview", "--execute"],
    ["--school-ids", "9", "--school-ids", "8"],
    ["--school-ids", "9", "--force"],
  ]) await assert.rejects(cleanupMain(["--", ...args], () => {}));
  const output = [];
  assert.equal(await cleanupMain(["--school-ids", "9", "--execute", "--confirm", "guessed"],
    value => output.push(value)), 2);
  assert.equal(JSON.parse(output[0]).databaseConnectionsOpened, 0);
});
