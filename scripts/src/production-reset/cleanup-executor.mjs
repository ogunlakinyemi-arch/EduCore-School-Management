import { CANDIDATE_TABLES } from "./manifest.mjs";
import { compareEvidence } from "./preflight.mjs";
import { preflightSql } from "./sql.mjs";
import {
  CleanupError, requireSafe, validateAuthorization, controlledPlan,
  PRIMARY_IDENTITY_SQL, assertPrimary,
} from "./cleanup-policy.mjs";

const quote = value => {
  requireSafe(/^[a-z_][a-z0-9_]*$/.test(value), "UNREVIEWED_IDENTIFIER");
  return `"${value}"`;
};
const SESSION_SQL = `SELECT count(*)::int AS others FROM pg_stat_activity
 WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'`;
const RELATIONS_SQL = `SELECT n.nspname AS schema,c.relname AS name,c.relkind
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','_system') AND c.relkind IN ('r','p','S')
 ORDER BY n.nspname,c.relname`;
const EFFECTS_SQL = `SELECT
 (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','_system')
 AND NOT t.tgisinternal) AS custom_triggers,
 (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','_system') AND c.relrowsecurity) AS rls_tables,
 (SELECT count(*) FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class
 JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','_system') AND c.relkind IN ('r','p')) AS table_rules,
 (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname IN ('public','_system') AND c.relkind IN ('p','f')) AS partitioned_or_foreign`;

async function requireQuiet(client) {
  const row = (await client.query(SESSION_SQL)).rows[0];
  requireSafe(row?.others === 0, "OTHER_PRIMARY_CLIENT_SESSIONS_PRESENT");
}
async function effects(client) {
  const row = (await client.query(EFFECTS_SQL)).rows[0];
  requireSafe(row && ["custom_triggers", "rls_tables", "table_rules", "partitioned_or_foreign"]
    .every(key => Number(row[key]) === 0), "UNREVIEWED_DATABASE_SIDE_EFFECTS");
}
async function snapshot(client, ids) {
  const row = (await client.query(preflightSql(ids.join(",")))).rows[0];
  requireSafe(row?.production_reset_preflight, "LIVE_SNAPSHOT_UNAVAILABLE");
  return row.production_reset_preflight;
}
async function sequences(client, relations) {
  const result = [];
  for (const r of relations.filter(r => r.relkind === "S")) {
    const row = (await client.query(
      `SELECT last_value::text,is_called FROM ${quote(r.schema)}.${quote(r.name)}`,
    )).rows[0];
    result.push([r.schema, r.name, row]);
  }
  return JSON.stringify(result);
}

// No connection is constructed until offline authorization AND, for execution,
// exact reviewed counts/token have passed. A database adapter is injected for
// offline unit tests; the CLI has no adapter/plugin override.
export async function runControlledCleanup({
  proof, ids, mode = "dry-run", reviewedEvidence = null, confirmation,
  clientFactory, now = Date.now,
}) {
  validateAuthorization(proof, ids, now());
  if (mode === "dry-run") return {
    dryRun: true, databaseConnectionsOpened: 0, mutationsPerformed: 0,
    plan: reviewedEvidence ? controlledPlan(proof, reviewedEvidence, ids, now()) : null,
    nextStep: "SEPARATELY_AUTHORIZED_PRIMARY_PREVIEW_REQUIRED",
  };
  requireSafe(["preview", "execute"].includes(mode), "INVALID_CLEANUP_MODE");
  let reviewedPlan;
  if (mode === "execute") {
    requireSafe(reviewedEvidence, "REVIEWED_ROW_COUNT_PREVIEW_REQUIRED");
    reviewedPlan = controlledPlan(proof, reviewedEvidence, ids, now());
    requireSafe(reviewedPlan.ready, "PRESERVED_DEPENDENCIES_OR_PLAN_BLOCKERS");
    requireSafe(confirmation === reviewedPlan.expectedConfirmation, "EXACT_CONFIRMATION_REQUIRED");
  }
  requireSafe(typeof clientFactory === "function", "DEDICATED_PRODUCTION_CONNECTION_REQUIRED");
  const client = clientFactory(proof.target);
  let connected = false, transaction = false, commitAttempted = false, deleted = 0;
  try {
    await client.connect(); connected = true;
    for (let index = 0; index < 3; index++) {
      const start = performance.now();
      await client.query("SELECT 1 AS connection_health");
      requireSafe(performance.now() - start < 2_000, "PRIMARY_CONNECTION_HEALTH_FAILED");
    }
    await client.query(mode === "preview"
      ? "BEGIN ISOLATION LEVEL SERIALIZABLE READ ONLY" : "BEGIN ISOLATION LEVEL READ COMMITTED");
    transaction = true;
    await client.query("SET LOCAL lock_timeout='2s'");
    await client.query("SET LOCAL statement_timeout='30s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout='30s'");
    assertPrimary((await client.query(PRIMARY_IDENTITY_SQL)).rows[0], proof.target, mode === "preview");
    await requireQuiet(client);
    await effects(client);
    if (mode === "preview") {
      const evidence = await snapshot(client, ids);
      const plan = controlledPlan(proof, evidence, ids, now());
      await client.query("ROLLBACK"); transaction = false;
      return { dryRun: true, databaseConnectionsOpened: 1, mutationsPerformed: 0, evidence, plan };
    }
    const lease = (await client.query(
      "SELECT pg_try_advisory_xact_lock(192837465, 20261024) AS acquired",
    )).rows[0];
    requireSafe(lease?.acquired === true, "OTHER_CLEANUP_IN_PROGRESS");
    const relations = (await client.query(RELATIONS_SQL)).rows;
    const tables = relations.filter(r => r.relkind !== "S");
    requireSafe(tables.length > 0 && tables.some(r => r.schema === "_system"
      && r.name === "replit_database_migrations_v1"), "COMPLETE_CATALOG_LOCK_SET_REQUIRED");
    await client.query(`LOCK TABLE ${tables.map(r =>
      `${quote(r.schema)}.${quote(r.name)}`).join(",")} IN ACCESS EXCLUSIVE MODE NOWAIT`);
    await requireQuiet(client);
    await effects(client);
    const before = await snapshot(client, ids);
    const livePlan = controlledPlan(proof, before, ids, now());
    requireSafe(livePlan.ready && livePlan.planDigest === reviewedPlan.planDigest,
      "ROW_COUNTS_OR_PROTECTED_STATE_CHANGED_SINCE_PREVIEW");
    const sequenceBefore = await sequences(client, relations);
    for (const entry of livePlan.orderedManifest) {
      validateAuthorization(proof, ids, now());
      requireSafe(CANDIDATE_TABLES.includes(entry.table) && Number.isSafeInteger(entry.rows),
        "UNREVIEWED_DELETION_MANIFEST");
      if (entry.rows === 0) continue;
      const column = entry.table === "schools" ? "id" : "school_id";
      const result = await client.query(
        `DELETE FROM public.${quote(entry.table)} WHERE ${quote(column)} = ANY($1::integer[])`,
        [ids],
      );
      requireSafe(result.rowCount === entry.rows, "DELETED_ROW_COUNT_MISMATCH");
      deleted += result.rowCount;
    }
    const after = await snapshot(client, ids);
    const verification = compareEvidence(before, after, ids, now());
    requireSafe(verification.observationChecksPassed, "POST_RESET_INTEGRITY_OR_PRESERVATION_FAILED");
    requireSafe(sequenceBefore === await sequences(client, relations), "SEQUENCE_STATE_CHANGED");
    validateAuthorization(proof, ids, now());
    await requireQuiet(client);
    assertPrimary((await client.query(PRIMARY_IDENTITY_SQL)).rows[0], proof.target, false);
    commitAttempted = true;
    await client.query("COMMIT"); transaction = false;
    return {
      dryRun: false, databaseConnectionsOpened: 1, transactionCommitted: true,
      deletedRows: deleted, integrityChecksPassed: true,
      retainedTablesAndOutOfScopeRowsUnchanged: true, sequenceStateUnchanged: true,
      externalAcceptance: "OWNER_ADMIN_SIGN_IN_AND_EXTERNAL_MAINTENANCE_RELEASE_STILL_REQUIRED",
    };
  } catch (error) {
    let rollbackConfirmed = false;
    if (transaction && !commitAttempted) {
      try { await client.query("ROLLBACK"); rollbackConfirmed = true; } catch { /* Report uncertainty. */ }
    }
    return {
      dryRun: mode !== "execute", databaseConnectionsOpened: connected ? 1 : 0,
      transactionCommitted: false,
      outcome: commitAttempted ? "COMMIT_OUTCOME_UNKNOWN_DO_NOT_RETRY"
        : transaction && !rollbackConfirmed ? "ROLLBACK_UNCONFIRMED_OPERATOR_REVIEW_REQUIRED"
          : "REFUSED_OR_ROLLED_BACK",
      error: error instanceof CleanupError ? error.code : "PRIMARY_OPERATION_FAILED_NO_AUTOMATIC_RETRY",
      rollbackConfirmed, automaticRetry: false,
      committedMutations: commitAttempted || transaction && !rollbackConfirmed ? "UNKNOWN" : 0,
    };
  } finally {
    try { await client.end(); } catch { /* No retry or second connection. */ }
  }
}
