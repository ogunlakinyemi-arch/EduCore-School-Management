import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { rehearsalSql } from "./rehearsal.mjs";
import { preflightSql } from "./sql.mjs";
import { controlledPlan, PRIMARY_IDENTITY_SQL } from "./cleanup-policy.mjs";
import { runControlledCleanup } from "./cleanup-executor.mjs";

const requireSafe = (condition, message) => assert.ok(condition, message);
const hash = text => createHash("sha256").update(text).digest("hex");

// Opt-in local harness. It has no URL/env credential input and does not import
// the application DB. The Production CLI and all its gates remain unchanged.
export async function isolatedExecutorTests({ data, socket }) {
  const base = path.dirname(data);
  requireSafe(/^\/tmp\/educore-reset-rehearsal\.[A-Za-z0-9]+$/.test(base), "FRESH_PRIVATE_REHEARSAL_PATH_REQUIRED");
  requireSafe(data === path.join(base, "data") && socket === path.join(base, "socket"),
    "EXACT_LOCAL_PATHS_REQUIRED");
  for (const name of [base, data, socket]) {
    const stat = await fs.lstat(name);
    requireSafe(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === process.getuid()
      && (stat.mode & 0o077) === 0 && await fs.realpath(name) === name, "PRIVATE_OWNED_LOCAL_DIRECTORY_REQUIRED");
  }
  const stat = await fs.lstat(path.join(socket, ".s.PGSQL.55483"));
  requireSafe(stat.isSocket() && !stat.isSymbolicLink() && stat.uid === process.getuid(), "OWNED_LOCAL_SOCKET_REQUIRED");
  const { Client } = createRequire(new URL("../../../lib/db/package.json", import.meta.url))("pg");
  const config = {
    host: socket, port: 55483, user: "rehearsal_admin", password: () => "",
    ssl: false, connectionTimeoutMillis: 5000, query_timeout: 35000,
    options: "-c timezone=UTC -c statement_timeout=30000 -c lock_timeout=2000",
  };
  const client = database => new Client({ ...config, database });
  const assertLocal = async connection => {
    const row = (await connection.query(`SELECT current_setting('data_directory') AS data,
      current_setting('unix_socket_directories') AS socket,inet_server_addr() AS network,
      current_setting('listen_addresses') AS listeners,current_user AS role,
      current_setting('server_version_num')::integer AS version`)).rows[0];
    requireSafe(row.data === data && row.socket === socket && row.network === null
      && row.listeners === "" && row.role === "rehearsal_admin"
      && row.version >= 160000 && row.version < 170000, "ISOLATED_SERVER_IDENTITY_MISMATCH");
  };
  const admin = client("postgres");
  await admin.connect();
  try {
    await assertLocal(admin);
    // Never connect to an existing database named neondb, even on this cluster.
    const existing = (await admin.query("SELECT 1 FROM pg_database WHERE datname='neondb'")).rowCount;
    requireSafe(existing === 0, "FRESH_EXECUTOR_FIXTURE_DATABASE_REQUIRED");
    await admin.query("CREATE DATABASE neondb TEMPLATE template0");
  } finally { await admin.end(); }
  const withLocal = async action => {
    const c = client("neondb");
    await c.connect();
    try { await assertLocal(c); return await action(c); } finally { await c.end(); }
  };
  const identity = await withLocal(async c => {
    const sql = rehearsalSql();
    // The schema is generated from the same fictional fixture as the documented
    // rehearsal, without its protected tenant seed data. No record is erased to
    // make a deletion gate pass; each failure below must restore the fixture.
    const ddl = sql.slice(sql.indexOf("CREATE SCHEMA _system;"), sql.indexOf("INSERT INTO public.schools(id)"));
    requireSafe(ddl.startsWith("CREATE SCHEMA") && !ddl.includes("DELETE"), "FICTIONAL_SCHEMA_REQUIRED");
    await c.query(ddl);
    await c.query(`INSERT INTO public.schools(id) VALUES(9);
      INSERT INTO public.students VALUES(1,9);
      INSERT INTO public.app_users VALUES(1,'ACTIVE','fictional-owner-subject');
      INSERT INTO public.school_memberships VALUES(1,1,NULL,'PLATFORM_OWNER','ACTIVE');`);
    return (await c.query(PRIMARY_IDENTITY_SQL)).rows[0];
  });
  const capture = () => withLocal(async c => ({
    evidence: (await c.query(preflightSql("9"))).rows[0].production_reset_preflight,
    sequences: (await c.query("SELECT last_value::text,is_called FROM schools_id_seq")).rows,
  }));
  const baseline = await capture();
  const stamp = delta => new Date(Date.now() + delta).toISOString();
  const proof = {
    version: 1, environment: "production", resourceId: "fictional-isolated-resource",
    appUrl: "https://educore.yetenia.com", verifiedAt: stamp(-1000), bindingEvidenceSha256: hash("fictional"),
    target: { host: "isolated.example.invalid", port: 55483, database: "neondb",
      databaseOid: identity.database_oid, role: identity.role, systemIdentifier: identity.system_identifier },
    authority: { role: "PLATFORM_OWNER", authorizationSha256: hash("fictional"),
      retainedLogicalReferencesReviewed: true, testSchoolIds: [9] },
    maintenance: { resourceId: "fictional-isolated-resource", verifiedAt: stamp(-3000),
      expiresAt: stamp(5 * 60000), evidenceSha256: hash("fictional"),
      ingressBlocked: true, workersStopped: true, devicesStopped: true, callbacksPaused: true,
      authHooksPaused: true, registrationStopped: true },
    backup: { resourceId: "fictional-isolated-resource", kind: "PITR", pointId: "fictional-point",
      recoverableAt: stamp(-2000), verifiedAt: stamp(-1000), retentionUntil: stamp(3600000),
      evidenceSha256: hash("fictional"), restoreDrill: { resourceId: "fictional-isolated-resource",
        pointId: "fictional-point", verifiedAt: stamp(-1000), evidenceSha256: hash("fictional") } },
  };
  const plan = controlledPlan(proof, baseline.evidence, [9]);
  requireSafe(plan.ready, "UNPROTECTED_FICTIONAL_FIXTURE_MUST_BE_READY");
  const passed = [];
  const unchanged = async expected => {
    const actual = await capture();
    assert.deepEqual(actual.evidence.tables, expected.evidence.tables);
    assert.deepEqual(actual.evidence.foreignKeys, expected.evidence.foreignKeys);
    assert.equal(actual.evidence.schemaFingerprint, expected.evidence.schemaFingerprint);
    assert.equal(actual.evidence.migrationFingerprint, expected.evidence.migrationFingerprint);
    assert.deepEqual(actual.evidence.ownerAccess, expected.evidence.ownerAccess);
    assert.deepEqual(actual.sequences, expected.sequences);
  };
  async function executeFailure(kind, expectedError) {
    let deletes = 0, commitSent = false;
    const factory = () => {
      const c = client("neondb");
      return {
        connect: async () => { await c.connect(); await assertLocal(c); },
        end: () => c.end(),
        query: async (sql, parameters) => {
          if (sql === "COMMIT") { commitSent = true; throw new Error("COMMIT_FORBIDDEN_IN_ROLLBACK_HARNESS"); }
          const result = await c.query(sql, parameters);
          if (sql.startsWith("DELETE FROM")) {
            deletes += result.rowCount;
            if (kind === "count") return { ...result, rowCount: result.rowCount + 1 };
          }
          if (kind === "postcheck" && deletes > 0 && sql.includes("AS production_reset_preflight")) {
            result.rows[0].production_reset_preflight.tables.find(t => t.name === "app_users").fingerprint = hash("fictional mismatch");
          }
          return result;
        },
      };
    };
    const result = await runControlledCleanup({
      proof, ids: [9], mode: "execute", reviewedEvidence: baseline.evidence,
      confirmation: plan.expectedConfirmation, clientFactory: factory,
    });
    assert.equal(result.error, expectedError);
    assert.equal(result.rollbackConfirmed, true);
    assert.equal(result.committedMutations, 0);
    assert.equal(commitSent, false);
    requireSafe(deletes > 0, "REAL_LOCAL_DELETE_NOT_REACHED");
    if (kind === "postcheck") assert.equal(deletes, 2, "student and school must both reach real local deletion before rollback");
    await unchanged(baseline);
    passed.push(kind === "count" ? "REAL_DELETE_ROW_COUNT_FAILURE_ROLLED_BACK"
      : "REAL_STUDENT_AND_SCHOOL_DELETES_POSTCHECK_FAILURE_ROLLED_BACK");
  }
  await executeFailure("count", "DELETED_ROW_COUNT_MISMATCH");
  await executeFailure("postcheck", "POST_RESET_INTEGRITY_OR_PRESERVATION_FAILED");

  const peer = client("neondb");
  await peer.connect();
  try {
    const result = await runControlledCleanup({ proof, ids: [9], mode: "execute",
      reviewedEvidence: baseline.evidence, confirmation: plan.expectedConfirmation,
      clientFactory: () => client("neondb") });
    assert.equal(result.error, "OTHER_PRIMARY_CLIENT_SESSIONS_PRESENT");
    assert.equal(result.rollbackConfirmed, true);
  } finally { await peer.end(); }
  await unchanged(baseline);
  passed.push("OTHER_LOCAL_SESSION_REFUSED_WITH_ROLLBACK");

  // Add protected fictional history LAST and never delete/detach it.
  await withLocal(c => c.query(`INSERT INTO public.audit_logs VALUES(1,9,'fictional preserved audit');
    INSERT INTO public.fee_payments VALUES(1,9);
    INSERT INTO public.school_memberships VALUES(2,1,9,'SCHOOL_ADMIN','ACTIVE');
    INSERT INTO public.platform_devices VALUES(1,9,NULL,'ACTIVE','CONFIGURED',NULL);
    INSERT INTO public.device_credentials VALUES(1,1,9);
    INSERT INTO public.device_assignment_history VALUES(1,1,9);
    INSERT INTO public.device_school_bindings VALUES(1,9);`));
  const protectedState = await capture();
  const protectedPlan = controlledPlan(proof, protectedState.evidence, [9]);
  assert.equal(protectedPlan.ready, false);
  requireSafe(protectedPlan.retention.hardRelationships.length >= 6, "PROTECTED_RELATIONSHIPS_NOT_CLASSIFIED");
  let factories = 0;
  await assert.rejects(runControlledCleanup({
    proof, ids: [9], mode: "execute", reviewedEvidence: protectedState.evidence,
    confirmation: protectedPlan.expectedConfirmation,
    clientFactory: () => { factories++; throw new Error("must not connect"); },
  }), /PRESERVED_DEPENDENCIES_OR_PLAN_BLOCKERS/);
  assert.equal(factories, 0);
  await unchanged(protectedState);
  passed.push("AUDIT_FINANCE_MEMBERSHIP_DEVICE_HISTORY_BLOCK_BEFORE_CONNECTION");

  const stale = await runControlledCleanup({
    proof, ids: [9], mode: "execute", reviewedEvidence: baseline.evidence,
    confirmation: plan.expectedConfirmation, clientFactory: () => client("neondb"),
  });
  assert.equal(stale.error, "ROW_COUNTS_OR_PROTECTED_STATE_CHANGED_SINCE_PREVIEW");
  assert.equal(stale.rollbackConfirmed, true);
  await unchanged(protectedState);
  passed.push("NEW_PROTECTED_HISTORY_INVALIDATES_OLD_PREVIEW_WITHOUT_DELETION");
  return {
    status: "PASS", scope: "FRESH_SOCKET_ONLY_FICTIONAL_POSTGRESQL_16",
    passed, productionConnections: 0, productionMutations: 0, commitStatementsSent: 0,
    fixtureSqlSha256: hash(rehearsalSql()),
    executorSha256: hash(await fs.readFile(new URL("./cleanup-executor.mjs", import.meta.url), "utf8")),
    productionCleanupSafe: false, remainingBlocker: "NO_APPROVED_LINEAGE_PRESERVING_PRODUCTION_ARCHIVE_OR_DELETION_PATH",
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== "--data-dir" || args[2] !== "--socket-dir") {
    console.error("EXPLICIT_FRESH_LOCAL_REHEARSAL_PATHS_REQUIRED"); process.exitCode = 2;
  } else {
    try { console.log(JSON.stringify(await isolatedExecutorTests({ data: args[1], socket: args[3] }), null, 2)); }
    catch (error) {
      console.error(JSON.stringify({ status: "FAIL", check: error.code ?? "LOCAL_ASSERTION_FAILED",
        message: error instanceof assert.AssertionError ? error.message : "LOCAL_FIXTURE_OPERATION_FAILED",
        productionConnections: 0 }));
      process.exitCode = 2;
    }
  }
}
