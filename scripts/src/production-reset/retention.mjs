import { CANDIDATE_TABLES } from "./manifest.mjs";

export const RETENTION_POLICY_VERSION = "preserve-lineage-and-tenant-shells-v1";
const candidates = new Set(CANDIDATE_TABLES);

// Source declarations describe possibilities, not the live catalog or permission
// to mutate. Nullability alone is never a retention/reassignment authorization.
const rules = {
  school_memberships: {
    category: "AUTHORITY_AND_MEMBERSHIP",
    decision: "KEEP_MEMBERSHIP_AND_ITS_TENANT_SCOPE",
    reason: "NULL school_id denotes platform scope; detaching can alter authority and collide with platform-role uniqueness.",
    transition: "Tenant-specific INACTIVE status is representable; preserve platform memberships and legitimate admin access. Not an archive or permission to change membership.",
  },
  audit_logs: {
    category: "AUDIT_HISTORY",
    decision: "KEEP_ORIGINAL_CONTEXT_AND_REFERENCED_ANCESTORS",
    reason: "Nullable school_id does not authorize erasing original audit provenance.",
  },
  platform_devices: {
    category: "DEVICE_INVENTORY",
    decision: "KEEP_INVENTORY_AND_HISTORICAL_BINDINGS",
    reason: "Current school/class references are nullable, but composite references, credentials and replay safety must be resolved together.",
    transition: "Unassigned current binding is representable (school/class NULL, status UNASSIGNED, configuration PENDING). Requires explicit per-device review; historical school references remain unchanged.",
  },
  device_credentials: {
    category: "DEVICE_CREDENTIAL_HISTORY",
    decision: "KEEP_ORIGINAL_SCHOOL_AND_DEVICE",
    reason: "school_id is mandatory; revocation status does not remove the historical FK.",
  },
  device_assignment_history: {
    category: "DEVICE_ASSIGNMENT_HISTORY",
    decision: "KEEP_ORIGINAL_SCHOOL_AND_DEVICE",
    reason: "school_id is mandatory and event-time assignment provenance must not follow a device reassignment.",
  },
  device_school_bindings: {
    category: "DEVICE_SCHOOL_BINDING_HISTORY",
    decision: "KEEP_DURABLE_DEVICE_SCHOOL_RELATIONSHIP",
    reason: "Mandatory device/school columns form the binding identity; historical composite references must remain valid after current-device unassignment.",
  },
  fee_provider_webhook_events: {
    category: "FINANCIAL_HISTORY",
    decision: "KEEP_ORIGINAL_FINANCIAL_LINEAGE",
    reason: "Nullable school_id supports unassociated receipts, not retrospective detachment of an associated payment event.",
  },
};
const financial = /(?:^fee_|subscription|commission|payout|settlement|payroll|refund|payment|flutterwave)/;
export function retentionRule(table) {
  return rules[table] ?? (financial.test(table) ? {
    category: "FINANCIAL_HISTORY", decision: "KEEP_ORIGINAL_FINANCIAL_LINEAGE",
    reason: "Preserve school/student/term/partner attribution and every referenced ancestor; payment state is not permission to detach.",
  } : {
    category: "UNREVIEWED_RETAINED_RELATIONSHIP", decision: "KEEP_UNCHANGED_AND_BLOCK",
    reason: "No reviewed detachment or archive contract exists for this relationship.",
  });
}

export function retentionResolution(evidence) {
  const references = evidence.foreignKeys
    .filter(fk => candidates.has(fk.parent) && fk.retainedReferencingRows > 0)
    .map(fk => ({
      constraint: fk.name, child: fk.child, parent: fk.parent,
      blockingRows: fk.retainedReferencingRows,
      classification: "HARD_BLOCKER",
      ...retentionRule(fk.child),
      columnEvidence: fk.columns?.map(({ child, parent, nullable }) => ({ child, parent, nullable })) ?? null,
      catalogEvidence: fk.columns ? "SUPPLIED_CATALOG_SNAPSHOT_NOT_INDEPENDENT_CERTIFICATION" : "NOT_CAPTURED",
      automaticDetachAllowed: false,
      minimumDecision: fk.child === "platform_devices"
        ? "Retain historical tenant roots; separately authorize a per-device current-binding/credential/replay plan if unassignment is needed."
        : "Keep referenced rows/tenant shells, or commission a separately reviewed archive design preserving original relationships. No NULL/repoint override.",
    })).sort((a, b) => a.child.localeCompare(b.child) || a.parent.localeCompare(b.parent)
      || a.constraint.localeCompare(b.constraint));
  const scopedRows = evidence.tables.filter(t => !candidates.has(t.name) && t.selectedRows > 0)
    .map(t => ({
      table: t.name, rows: t.selectedRows, classification: "HARD_BLOCKER",
      ...retentionRule(t.name), automaticDetachAllowed: false,
    })).sort((a, b) => a.table.localeCompare(b.table));
  return {
    policyVersion: RETENTION_POLICY_VERSION,
    defaultDisposition: "PRESERVE_PROTECTED_ROWS_AND_REQUIRED_TENANT_ANCESTORS",
    platformMemberships: "PRESERVE_UNCHANGED_NEVER_CONVERT_TENANT_MEMBERSHIP_TO_PLATFORM_SCOPE",
    schoolStatus: "INACTIVE_LABEL_IS_REPRESENTABLE_NOT_A_VERIFIED_ARCHIVE_OR_AUTHORIZATION_BARRIER",
    automaticMutations: [],
    fullTenantRemovalBlocked: references.length > 0 || scopedRows.length > 0,
    hardRelationships: references, retainedTenantRows: scopedRows,
    operatorDecisions: [...new Set([
      ...(references.length || scopedRows.length
        ? ["ACCEPT_RETAINED_TEST_TENANT_SHELLS_OR_AUTHORIZE_A_SEPARATE_LINEAGE_PRESERVING_ARCHIVE_DESIGN"] : []),
      ...(references.some(r => r.child === "school_memberships") || scopedRows.some(r => r.table === "school_memberships")
        ? ["IDENTIFY_TENANT_MEMBERSHIPS_TO_KEEP_ACTIVE_WITHOUT_CHANGING_ANY_PLATFORM_OR_OTHER_TENANT_MEMBERSHIP"] : []),
      ...(references.some(r => r.category.startsWith("DEVICE_")) || scopedRows.some(r => r.category.startsWith("DEVICE_"))
        ? ["IF_DEVICE_UNASSIGNMENT_IS_REQUIRED_APPROVE_EACH_DEVICE_CREDENTIAL_AND_REPLAY_PLAN_KEEPING_HISTORICAL_SCHOOLS"] : []),
    ])],
    limitation: "Source-supported transitions are not executed; immutable fingerprints remain required. No current Production state is inferred.",
  };
}
