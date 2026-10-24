import {
  CANDIDATE_TABLES, EXCLUSIONS, MANIFEST_VERSION, dependencyOrder, digest,
} from "./manifest.mjs";
import { retentionResolution } from "./retention.mjs";

const count = value => Number.isSafeInteger(value) && value >= 0;
const fingerprint = value => typeof value === "string" && /^[a-f0-9]{32,64}$/.test(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const candidates = new Set(CANDIDATE_TABLES);

export function validateEvidence(evidence, ids, now = Date.now()) {
  if (!evidence || evidence.environment !== "production") throw new Error("PRODUCTION_EVIDENCE_REQUIRED");
  if (evidence.manifestVersion !== MANIFEST_VERSION) throw new Error("MANIFEST_VERSION_MISMATCH");
  if (!same(evidence.selectedSchoolIds, ids)) throw new Error("SCHOOL_SCOPE_MISMATCH");
  const observed = Date.parse(evidence.observedAt);
  if (!Number.isFinite(observed) || observed > now || now - observed > 15 * 60_000) {
    throw new Error("EVIDENCE_STALE_OR_INVALID");
  }
  if (!Array.isArray(evidence.tables) || !Array.isArray(evidence.foreignKeys)
      || !fingerprint(evidence.schemaFingerprint) || !fingerprint(evidence.migrationFingerprint)
      || !count(evidence.unsupportedForeignKeys)) {
    throw new Error("INCOMPLETE_CATALOG_EVIDENCE");
  }
  const names = new Set();
  for (const table of evidence.tables) {
    if (!/^[a-z][a-z0-9_]*$/.test(table.name) || names.has(table.name)
        || !count(table.totalRows) || typeof table.scopeSupported !== "boolean"
        || (table.scopeSupported ? !count(table.selectedRows) || table.selectedRows > table.totalRows
          : table.selectedRows !== null)
        || !fingerprint(table.fingerprint) || !fingerprint(table.outsideScopeFingerprint)) {
      throw new Error("INVALID_TABLE_EVIDENCE");
    }
    names.add(table.name);
  }
  for (const table of [...CANDIDATE_TABLES, "app_users", "school_memberships",
    "audit_logs", "platform_devices", "device_credentials"]) {
    if (!names.has(table)) throw new Error("REQUIRED_TABLE_EVIDENCE_MISSING");
  }
  const fkNames = new Set();
  for (const fk of evidence.foreignKeys) {
    if (!names.has(fk.child) || !names.has(fk.parent)
        || typeof fk.name !== "string" || !/^[a-zA-Z0-9_]+$/.test(fk.name) || fkNames.has(fk.name)
        || typeof fk.validated !== "boolean" || !["a", "r", "c", "n", "d"].includes(fk.onDelete)
        || !count(fk.orphanRows) || !count(fk.retainedReferencingRows)) {
      throw new Error("INVALID_FOREIGN_KEY_EVIDENCE");
    }
    fkNames.add(fk.name);
    if (fk.columns !== undefined && (!Array.isArray(fk.columns) || fk.columns.length === 0
        || fk.columns.some(column => !column || !/^[a-z][a-z0-9_]*$/.test(column.child)
          || !/^[a-z][a-z0-9_]*$/.test(column.parent) || typeof column.nullable !== "boolean"))) {
      throw new Error("INVALID_FOREIGN_KEY_COLUMN_EVIDENCE");
    }
  }
  // A file is never a trusted primary/backup API response; even plausible
  // operator-entered verified:true flags cannot unlock execution.
  return evidence;
}

export function createReport({ ids, evidence = null, now = Date.now() }) {
  const blockers = [
    "TRUSTED_WRITABLE_PRIMARY_BINDING_API_UNAVAILABLE",
    "TRUSTED_BACKUP_RECOVERY_AND_RESTORE_VERIFICATION_API_UNAVAILABLE",
    "TRUSTED_CONNECTION_HEALTH_VERIFICATION_API_UNAVAILABLE",
    "DESTRUCTIVE_EXECUTOR_NOT_IMPLEMENTED",
    "MAINTENANCE_FREEZE_AND_EXPLICIT_TARGET_AUTHORIZATION_REQUIRED",
  ];
  let order = null, rowCountPreview = null, protectedReferences = null;
  if (evidence) {
    validateEvidence(evidence, ids, now);
    const i = evidence.identity;
    if (!i || i.inRecovery !== false) blockers.push("WRITABLE_PRIMARY_NOT_OBSERVED");
    if (!i || i.transactionReadOnly !== "off") blockers.push("READ_ONLY_SESSION_CANNOT_CERTIFY_WRITABILITY");
    if (!evidence.ownerAccess || !count(evidence.ownerAccess.activeOwners)
        || evidence.ownerAccess.activeOwners < 1) blockers.push("ACTIVE_OWNER_ACCESS_NOT_OBSERVED");
    if (evidence.foreignKeys.length === 0) blockers.push("FOREIGN_KEY_CATALOG_EMPTY");
    if (evidence.unsupportedForeignKeys > 0) blockers.push("CROSS_SCHEMA_DEPENDENCIES_REQUIRE_REVIEW");
    if (evidence.foreignKeys.some(fk => !fk.validated || fk.orphanRows !== 0)) {
      blockers.push("REFERENTIAL_INTEGRITY_CHECK_FAILED");
    }
    const sorted = dependencyOrder(evidence.foreignKeys);
    order = sorted.order;
    if (sorted.unresolved.length) blockers.push("DEPENDENCY_CYCLE_REQUIRES_REVIEW");
    const byName = new Map(evidence.tables.map(t => [t.name, t]));
    if (CANDIDATE_TABLES.some(name => !byName.get(name).scopeSupported)) {
      blockers.push("CANDIDATE_SCOPE_UNSUPPORTED_RETAIN_ROWS");
    }
    rowCountPreview = CANDIDATE_TABLES.map(name => {
      const table = byName.get(name);
      return { table: name, totalRows: table.totalRows,
        proposedRows: table.scopeSupported ? table.selectedRows : null };
    });
    protectedReferences = evidence.foreignKeys.filter(fk =>
      candidates.has(fk.parent) && fk.retainedReferencingRows > 0,
    ).map(fk => ({ constraint: fk.name, retainedChild: fk.child,
      candidateParent: fk.parent, blockingRows: fk.retainedReferencingRows }));
    if (protectedReferences.length) blockers.push("RETAINED_RECORDS_PREVENT_TENANT_DELETION");
    const schools = byName.get("schools");
    if (schools.selectedRows !== ids.length) blockers.push("SELECTED_SCHOOL_ROWS_MISSING");
  } else blockers.push("FRESH_OPERATOR_READ_ONLY_EVIDENCE_REQUIRED");
  const review = { manifestVersion: MANIFEST_VERSION, selectedSchoolIds: ids,
    evidenceDigest: evidence ? digest(evidence) : null };
  return {
    mode: "production-preflight-only", dryRun: true, executionAvailable: false,
    readyForDeletion: false, databaseConnectionsOpened: 0, mutationsPerformed: 0,
    ...review,
    expectedConfirmation: `PRODUCTION-TEST-RESET:${digest(review)}`,
    confirmationIsAuthorization: false,
    evidenceTrust: "OPERATOR_SNAPSHOT_ONLY_NOT_PRIMARY_OR_BACKUP_CERTIFICATION",
    gates: {
      primaryBinding: "BLOCKED_NO_TRUSTED_API",
      backupRecoveryAndRestore: "BLOCKED_NO_TRUSTED_API",
      connectionHealth: "BLOCKED_NO_TRUSTED_API",
      confirmation: "REVIEW_DIGEST_ONLY_NOT_AN_EXECUTION_CAPABILITY",
      writableSessionObserved: evidence?.identity?.inRecovery === false
        && evidence?.identity?.transactionReadOnly === "off",
      databaseWriteTestPerformed: false,
      operatorBackupClaimIgnored: evidence?.backup?.verified === true,
      operatorPrimaryClaimIgnored: evidence?.primaryBinding?.verified === true,
      operatorHealthClaimIgnored: evidence?.connectionHealth?.verified === true,
    },
    blockers, dependencyOrderedCandidateManifest: order,
    manifestWithoutCatalogOrder: order ? undefined : CANDIDATE_TABLES,
    rowCountPreview, protectedReferences, exclusions: EXCLUSIONS,
    retention: evidence ? retentionResolution(evidence) : null,
    postResetVerification: {
      performed: false,
      requirements: [
        "Fresh before/after evidence from the same independently verified primary and explicit school scope.",
        "Zero newly introduced FK orphans; every FK remains validated.",
        "All excluded table fingerprints and migration/schema fingerprints unchanged.",
        "Exact approved candidate row counts, retained-reference resolution and no cross-school deletion.",
        "Owner/admin Production sign-in and role checks independently confirmed.",
        "Provider settings, auth identities, object bytes and sequence positions independently preserved.",
        "No stale test messages, callbacks, links or device assignments can affect new tenants.",
      ],
    },
  };
}

export function compareEvidence(before, after, ids, now = Date.now()) {
  validateEvidence(before, ids, now);
  validateEvidence(after, ids, now);
  const failures = [];
  if (Date.parse(after.observedAt) < Date.parse(before.observedAt)) failures.push("EVIDENCE_ORDER_INVALID");
  if (!same(before.identity, after.identity)) failures.push("OBSERVED_DATABASE_IDENTITY_CHANGED");
  if (before.unsupportedForeignKeys > 0 || after.unsupportedForeignKeys > 0) {
    failures.push("CROSS_SCHEMA_DEPENDENCIES_UNVERIFIED");
  }
  if (after.identity?.inRecovery !== false || after.identity?.transactionReadOnly !== "off") {
    failures.push("WRITABLE_PRIMARY_NOT_OBSERVED");
  }
  if (before.schemaFingerprint !== after.schemaFingerprint) failures.push("SCHEMA_CHANGED");
  if (before.migrationFingerprint !== after.migrationFingerprint) failures.push("MIGRATION_LEDGER_CHANGED");
  const afterTables = new Map(after.tables.map(t => [t.name, t]));
  if (!same(before.tables.map(t => t.name).sort(), after.tables.map(t => t.name).sort())) {
    failures.push("TABLE_INVENTORY_CHANGED");
  }
  for (const table of before.tables) {
    const next = afterTables.get(table.name);
    if (!next) continue;
    if (!candidates.has(table.name) && table.fingerprint !== next.fingerprint) {
      failures.push(`RETAINED_TABLE_CHANGED:${table.name}`);
    }
    if (candidates.has(table.name) && (next.selectedRows !== 0
        || !table.scopeSupported || !next.scopeSupported
        || next.totalRows !== table.totalRows - table.selectedRows)) {
      failures.push(`UNEXPECTED_CANDIDATE_COUNTS:${table.name}`);
    }
    if (candidates.has(table.name) && table.outsideScopeFingerprint !== next.outsideScopeFingerprint) {
      failures.push(`OUT_OF_SCOPE_ROWS_CHANGED:${table.name}`);
    }
  }
  if (after.foreignKeys.some(fk => !fk.validated || fk.orphanRows > 0)) failures.push("POST_RESET_INTEGRITY_FAILED");
  if (!same(before.foreignKeys.map(f => [f.name, f.child, f.parent, f.onDelete]).sort(),
    after.foreignKeys.map(f => [f.name, f.child, f.parent, f.onDelete]).sort())) {
    failures.push("FOREIGN_KEY_INVENTORY_CHANGED");
  }
  if (!(after.ownerAccess?.activeOwners > 0)) failures.push("OWNER_ACCESS_NOT_OBSERVED");
  return {
    observationChecksPassed: failures.length === 0,
    verifiedProductionReset: false,
    failures,
    limitation: "Offline snapshots cannot certify primary binding, restore readiness, external auth, provider settings, sequence positions or real sign-in.",
  };
}
