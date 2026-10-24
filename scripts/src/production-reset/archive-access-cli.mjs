import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digest, schoolIds as parseIds } from "./manifest.mjs";
import { validateAuthorization, requireSafe, PRIMARY_IDENTITY_SQL, assertPrimary } from "./cleanup-policy.mjs";
import { connectionConfig, privateJson } from "./cleanup-cli.mjs";
import { activeAccessArchives, prepareAccessArchive, applyAccessArchive } from "./access-archive.mjs";

const POLICY = "REVOKE_EXISTING_TEST_ACCOUNTS_PRESERVE_OWNER_AND_LEGITIMATE_TENANTS";
export async function archiveAccessMain(args, output = console.log, dependencies = {}) {
  if (args[0] === "--") args = args.slice(1);
  const flags = new Set(["--help","--dry-run","--preview","--execute"]);
  const values = new Set(["--school-ids","--partner-ids","--authorization","--review","--confirm","--restore-batch"]);
  const opts = new Map();
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    requireSafe((flags.has(key) || values.has(key)) && !opts.has(key), "INVALID_OR_DUPLICATE_ARGUMENT");
    if (flags.has(key)) opts.set(key, true);
    else {
      const value = args[++i];
      requireSafe(value && !value.startsWith("--"), "ARGUMENT_VALUE_REQUIRED");
      opts.set(key, value);
    }
  }
  if (opts.has("--help")) {
    output("Offline by default. --school-ids 9 --partner-ids 3 [--preview | --execute --review /private/review.json --confirm <exact-token>] --authorization /private/owner.json [--restore-batch <reviewed-batch>]. See ACCESS-ARCHIVE.md.");
    return 0;
  }
  requireSafe(["--dry-run","--preview","--execute"].filter(k => opts.has(k)).length <= 1, "CONFLICTING_MODES");
  const scope = {
    schoolIds: opts.has("--school-ids") ? parseIds(opts.get("--school-ids")) : [],
    partnerIds: opts.has("--partner-ids") ? parseIds(opts.get("--partner-ids")) : [],
  };
  requireSafe(scope.schoolIds.length + scope.partnerIds.length > 0, "EXPLICIT_TEST_ARCHIVE_SCOPE_REQUIRED");
  if (!opts.has("--preview") && !opts.has("--execute")) {
    output(JSON.stringify({ dryRun: true, databaseConnectionsOpened: 0, mutationsPerformed: 0,
      scope, policy: POLICY, ready: false, blockers: ["SEPARATE_OWNER_AUTHORIZATION_AND_PRIVATE_PRIMARY_PREVIEW_REQUIRED"] }, null, 2));
    return 2;
  }
  requireSafe(opts.has("--authorization"), "OWNER_AUTHORIZATION_REQUIRED");
  const proof = await privateJson(opts.get("--authorization"));
  validateAuthorization(proof, scope.schoolIds);
  requireSafe(JSON.stringify(proof.authority.testPartnerIds ?? []) === JSON.stringify(scope.partnerIds)
    && proof.authority.accessArchivePolicy === POLICY
    && Number.isSafeInteger(proof.authority.actorUserId) && proof.authority.actorUserId > 0,
  "EXACT_OWNER_ACCESS_REVOCATION_POLICY_REQUIRED");
  const restore = opts.get("--restore-batch") ?? null;
  const batchId = restore ?? digest({ resourceId: proof.resourceId, scope, verifiedAt: proof.verifiedAt, policy: POLICY });
  requireSafe(/^[a-f0-9]{64}$/.test(batchId), "INVALID_ARCHIVE_BATCH");
  const tokenFor = review => `ARCHIVE-ACCESS:${digest({ proof, review })}`;
  let reviewed = null;
  if (opts.has("--execute")) {
    requireSafe(opts.has("--review"), "PRIVATE_REVIEW_REQUIRED");
    reviewed = await privateJson(opts.get("--review"));
    requireSafe(reviewed.batchId === batchId && opts.get("--confirm") === tokenFor(reviewed.review),
      "EXACT_ARCHIVE_CONFIRMATION_REQUIRED");
  } else requireSafe(!opts.has("--confirm") && !opts.has("--review"), "CONFLICTING_MODES");
  // No environment credential is read or client constructed before these gates.
  const make = dependencies.clientFactory ?? (target => {
    const config = connectionConfig(target, process.env);
    const { Client } = createRequire(new URL("../../../lib/db/package.json", import.meta.url))("pg");
    return new Client(config);
  });
  const c = make(proof.target);
  let transaction = false, commitAttempted = false;
  try {
    await c.connect();
    await c.query(opts.has("--execute") ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transaction = true;
    await c.query("SET LOCAL statement_timeout='30s'");
    await c.query("SET LOCAL lock_timeout='2s'");
    await c.query("SET LOCAL idle_in_transaction_session_timeout='30s'");
    assertPrimary((await c.query(PRIMARY_IDENTITY_SQL)).rows[0], proof.target, !opts.has("--execute"));
    const quiet = (await c.query(`SELECT count(*)::int AS others FROM pg_stat_activity
      WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'`)).rows[0];
    requireSafe(quiet?.others === 0, "OTHER_PRIMARY_CLIENT_SESSIONS_PRESENT");
    let plan;
    if (restore) {
      plan = (await activeAccessArchives(c)).find(m => m.batchId === batchId);
      requireSafe(plan && JSON.stringify(plan.schoolIds) === JSON.stringify(scope.schoolIds)
        && JSON.stringify(plan.partnerIds) === JSON.stringify(scope.partnerIds), "EXACT_RESTORE_SCOPE_REQUIRED");
      plan = { ...plan, planDigest: digest(plan) };
    } else plan = await prepareAccessArchive(c, scope);
    const review = { ...scope, operation: restore ? "RESTORE" : "BLOCK", batchId,
      planDigest: plan.planDigest, actorUserId: proof.authority.actorUserId,
      userCount: plan.userIds.length, emailCount: plan.emails.length };
    if (!opts.has("--execute")) {
      await c.query("ROLLBACK"); transaction = false;
      output(JSON.stringify({ dryRun: true, batchId, review, expectedConfirmation: tokenFor(review),
        mutationsPerformed: 0, databaseConnectionsOpened: 1 }, null, 2));
      return 2;
    }
    requireSafe(JSON.stringify(review) === JSON.stringify(reviewed.review), "ARCHIVE_ASSOCIATIONS_CHANGED_SINCE_REVIEW");
    validateAuthorization(proof, scope.schoolIds);
    const result = await applyAccessArchive(c, { plan, actorUserId: proof.authority.actorUserId, batchId, restore: !!restore });
    validateAuthorization(proof, scope.schoolIds);
    commitAttempted = true;
    await c.query("COMMIT"); transaction = false;
    output(JSON.stringify({ transactionCommitted: true, ...result, externalIdentityMutations: 0, automaticRetry: false }, null, 2));
    return 0;
  } catch (error) {
    let rolledBack = false;
    if (transaction && !commitAttempted) {
      try { await c.query("ROLLBACK"); rolledBack = true; } catch { /* Report uncertainty. */ }
    }
    output(JSON.stringify({ outcome: commitAttempted ? "COMMIT_OUTCOME_UNKNOWN_DO_NOT_RETRY"
      : transaction && !rolledBack ? "ROLLBACK_UNCONFIRMED_DO_NOT_RETRY" : "REFUSED_OR_ROLLED_BACK",
    error: /^[A-Z][A-Z_]+$/.test(error.code ?? error.message ?? "") ? error.code ?? error.message : "ARCHIVE_OPERATION_FAILED",
    rollbackConfirmed: rolledBack, automaticRetry: false }));
    return 2;
  } finally { try { await c.end(); } catch { /* Never retry. */ } }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await archiveAccessMain(process.argv.slice(2)); }
  catch { console.error("OFFLINE_ARCHIVE_INPUT_OR_AUTHORIZATION_FAILED_NO_EXECUTION_STARTED"); process.exitCode = 2; }
}
