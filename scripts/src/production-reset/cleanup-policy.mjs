import { CANDIDATE_TABLES, dependencyOrder, digest } from "./manifest.mjs";
import { validateEvidence } from "./preflight.mjs";

export class CleanupError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export const requireSafe = (condition, code) => {
  if (!condition) throw new CleanupError(code);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sha = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const fresh = (value, now) => {
  const date = Date.parse(value);
  return Number.isFinite(date) && date <= now && now - date <= 15 * 60_000;
};

// These are explicit, private Owner attestations, NOT Replit API signatures.
// Runtime target/identity checks cannot be replaced by the attestations.
export function validateAuthorization(proof, ids, now = Date.now()) {
  requireSafe(proof?.environment === "production" && proof.version === 1,
    "PRODUCTION_AUTHORIZATION_REQUIRED");
  requireSafe(typeof proof.resourceId === "string" && /^[A-Za-z0-9_-]{8,150}$/.test(proof.resourceId)
    && proof.appUrl === "https://educore.yetenia.com" && fresh(proof.verifiedAt, now)
    && sha(proof.bindingEvidenceSha256), "FRESH_OWNER_RESOURCE_BINDING_REQUIRED");
  const t = proof.target;
  requireSafe(t && typeof t.host === "string" && /^[a-z0-9.-]+$/.test(t.host)
    && t.host.includes(".") && !/localhost|\.local$|^127\.|^0\.|^169\.254\./.test(t.host)
    && Number.isInteger(t.port) && t.port > 0 && t.port < 65536
    && t.database === "neondb" && /^\d+$/.test(t.databaseOid)
    && typeof t.role === "string" && /^[A-Za-z0-9_-]+$/.test(t.role)
    && /^\d+$/.test(t.systemIdentifier), "INDEPENDENT_PRIMARY_IDENTITY_REQUIRED");
  const a = proof.authority;
  requireSafe(a?.role === "PLATFORM_OWNER" && sha(a.authorizationSha256)
    && a.retainedLogicalReferencesReviewed === true
    && same(a.testSchoolIds, ids), "EXACT_TEST_SCHOOL_AUTHORIZATION_REQUIRED");
  const m = proof.maintenance;
  requireSafe(m?.resourceId === proof.resourceId && fresh(m.verifiedAt, now)
    && Date.parse(m.expiresAt) > now
    && Date.parse(m.expiresAt) - Date.parse(m.verifiedAt) <= 30 * 60_000
    && sha(m.evidenceSha256)
    && ["ingressBlocked", "workersStopped", "devicesStopped", "callbacksPaused",
      "authHooksPaused", "registrationStopped"].every(key => m[key] === true),
  "ACTIVE_EXTERNAL_MAINTENANCE_FREEZE_REQUIRED");
  const b = proof.backup;
  requireSafe(b?.resourceId === proof.resourceId && ["PITR", "SCHEDULED"].includes(b.kind)
    && typeof b.pointId === "string" && /^[A-Za-z0-9_.:-]{1,150}$/.test(b.pointId)
    && fresh(b.verifiedAt, now) && fresh(b.recoverableAt, now)
    && Date.parse(b.recoverableAt) >= Date.parse(m.verifiedAt)
    && Date.parse(b.retentionUntil) > Date.parse(m.expiresAt)
    && sha(b.evidenceSha256), "CURRENT_RESOURCE_BOUND_RECOVERY_POINT_REQUIRED");
  const r = b.restoreDrill;
  requireSafe(r?.resourceId === proof.resourceId && r.pointId === b.pointId
    && fresh(r.verifiedAt, now) && sha(r.evidenceSha256),
  "ISOLATED_RESTORE_VERIFICATION_REQUIRED");
  return proof;
}

export function controlledPlan(proof, evidence, ids, now = Date.now()) {
  validateAuthorization(proof, ids, now);
  validateEvidence(evidence, ids, now);
  requireSafe(evidence.identity?.database === proof.target.database
    && String(evidence.identity.databaseOid) === proof.target.databaseOid
    && evidence.identity.role === proof.target.role
    && evidence.identity.inRecovery === false
    && evidence.identity.defaultTransactionReadOnly === "off",
  "REVIEWED_PRIMARY_SNAPSHOT_REQUIRED");
  const blockers = [];
  const byName = new Map(evidence.tables.map(table => [table.name, table]));
  const schools = byName.get("schools");
  if (schools.totalRows !== ids.length || schools.selectedRows !== ids.length) {
    blockers.push("ALL_CURRENT_SCHOOLS_MUST_MATCH_EXPLICIT_TEST_ALLOWLIST");
  }
  if (!(evidence.ownerAccess?.activeOwners > 0)) blockers.push("OWNER_ACCESS_REQUIRED");
  if (evidence.unsupportedForeignKeys > 0 || evidence.foreignKeys.length === 0) {
    blockers.push("COMPLETE_SAME_SCHEMA_DEPENDENCIES_REQUIRED");
  }
  if (evidence.foreignKeys.some(fk => !fk.validated || fk.orphanRows > 0)) {
    blockers.push("PREEXISTING_REFERENTIAL_INTEGRITY_FAILURE");
  }
  if (CANDIDATE_TABLES.some(name => !byName.get(name)?.scopeSupported)) {
    blockers.push("UNREVIEWED_ROW_SCOPE");
  }
  const retained = evidence.foreignKeys.filter(fk =>
    CANDIDATE_TABLES.includes(fk.parent) && fk.retainedReferencingRows > 0);
  if (retained.length) blockers.push("PRESERVED_RECORDS_PREVENT_FULL_TENANT_REMOVAL");
  const retainedScopedRows = evidence.tables.filter(table =>
    !CANDIDATE_TABLES.includes(table.name) && table.selectedRows > 0);
  if (retainedScopedRows.length) blockers.push("RETAINED_TEST_TENANT_DATA_REQUIRES_RETENTION_DECISION");
  const graph = dependencyOrder(evidence.foreignKeys);
  if (graph.unresolved.length) blockers.push("DEPENDENCY_CYCLE");
  const state = {
    ids, manifest: graph.order,
    tables: evidence.tables.map(t => ({
      name: t.name, totalRows: t.totalRows, selectedRows: t.selectedRows,
      fingerprint: t.fingerprint, outsideScopeFingerprint: t.outsideScopeFingerprint,
    })).sort((a, b) => a.name.localeCompare(b.name)),
    foreignKeys: evidence.foreignKeys,
    schema: evidence.schemaFingerprint, migrations: evidence.migrationFingerprint,
  };
  const token = `PRODUCTION-CLEANUP:${digest({ proof, state })}`;
  return {
    ready: blockers.length === 0, blockers, resourceId: proof.resourceId,
    expectedConfirmation: token, planDigest: digest(state),
    orderedManifest: graph.order.map(table => ({
      table, rows: byName.get(table)?.selectedRows ?? null,
    })),
    retainedReferences: retained.map(fk => ({
      constraint: fk.name, child: fk.child, parent: fk.parent, rows: fk.retainedReferencingRows,
    })),
    retainedTenantRows: retainedScopedRows.map(table => ({ table: table.name, rows: table.selectedRows })),
    backupVerification: "OWNER_UI_ATTESTATION_AND_RESOURCE_BOUND_RESTORE_REPORT_NOT_API_CERTIFICATION",
    maintenanceEnforcement: "EXTERNAL_FREEZE_PLUS_DATABASE_SESSION_CHECKS_AND_EXCLUSIVE_TRANSACTION_LOCKS",
  };
}

export const PRIMARY_IDENTITY_SQL = `SELECT current_database() AS database,
 (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid,
 current_user AS role,(SELECT system_identifier::text FROM pg_control_system()) AS system_identifier,
 pg_is_in_recovery() AS in_recovery,
 current_setting('transaction_read_only') AS transaction_read_only,
 current_setting('default_transaction_read_only') AS default_transaction_read_only,
 (SELECT rolsuper FROM pg_roles WHERE rolname=current_user)
   OR pg_has_role(current_user,'pg_read_all_stats','MEMBER') AS can_observe_sessions`;

export function assertPrimary(row, target, readOnly = false) {
  requireSafe(row && row.database === target.database
    && String(row.database_oid) === target.databaseOid && row.role === target.role
    && String(row.system_identifier) === target.systemIdentifier,
  "CONNECTED_PRIMARY_IDENTITY_MISMATCH");
  requireSafe(row.in_recovery === false && row.default_transaction_read_only === "off"
    && row.transaction_read_only === (readOnly ? "on" : "off"), "REPLICA_OR_READ_ONLY_PRIMARY_REFUSED");
  requireSafe(row.can_observe_sessions === true, "COMPLETE_SESSION_VISIBILITY_REQUIRED");
}
