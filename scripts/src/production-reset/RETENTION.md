# Resolved default retention policy

**Default: retain protected records unchanged, including the tenant/person/class/
term rows they require.** An empty `schools` table is not the default outcome.
The full-deletion executor remains blocked when preserved records depend on it.
No partial reset, detachment, status change, external archival or reassignment is
silently performed. `automaticMutations` in the retention report is always empty.

This resolves the preservation choice without inventing an archive implementation.
The existing source schema supports some nullable references/status labels, but
that is not proof of a safe operational archive. We did not inspect Production.

## Reviewed relationships

| Relationship | Source supports | Default / hard blocker |
| --- | --- | --- |
| `school_memberships.school_id → schools.id` | Nullable; NULL is platform scope; platform-role uniqueness differs from tenant-role uniqueness. | Keep every platform membership/auth binding. Keep legitimate tenant admin access and original scope. Never NULL a tenant membership. Even `INACTIVE` memberships still require their tenant FK. |
| `audit_logs.school_id → schools.id` and logical record/JSON references | School FK nullable. | Preserve original audit context, metadata and referenced ancestors. Nullable does not authorize destroying provenance. |
| `subscriptions.school_id`, most financial school/student/term FKs | Required school/subject relationships; financial history may cross multiple tables. | Keep full original lineage and referenced ancestors. Payment/test/inactive status is not a detach or deletion exception. |
| `fee_provider_webhook_events.school_id` | Nullable for genuinely unassociated events. | Do not retroactively disassociate an event already tied to a school/payment. |
| `platform_devices.school_id`, `school_class_id`, class/school composite FK | Current references nullable; `UNASSIGNED` status and `PENDING` configuration are representable. | Inventory stays. Possible **separately reviewed current-binding transition**, not an automatic detach. Review all inbound/composite references, historical bindings, credentials and replay first. |
| `device_credentials.school_id`, `device_assignment_history.school_id`, `device_school_bindings.school_id` | Mandatory original-school references; durable binding identity includes school/device. | Keep original school and history. Unassigning a current reader or revoking a credential does not eliminate these FKs. |
| `schools.status` | Existing `inactive` label is representable; no distinct archival contract established here. | Retain root rows where required. Do not assume the label blocks all role access, billing, notifications, schedules or callbacks. No automatic mark-inactive action. |
| Other retained/logical/external relationships | No reviewed transition contract. | Hard blocker; keep unchanged. A future nullable/archive field is not automatically allowlisted. |

Source basis: `lib/db/src/schema/edupulse.ts` (schools, memberships, audit,
devices and durable bindings) and `lib/db/src/schema/finance.ts` (financial and
webhook lineage). Declarations are not assertions about the current database.
Future preflight SQL now includes ordered FK column pairs and child nullability
from the supplied catalog. Missing column evidence stays unknown, never
interpreted as nullable. Both NULLABLE and NOT NULL retained references block.

## Exact operator decisions still needed

Only if further cleanup is desired:

1. **Outcome:** accept retained test-tenant shells and their required ancestors
   (the default), or separately authorize/design a lineage-preserving archive or
   fresh operational environment. Physical tenant removal remains blocked under
   today's preserve-in-place policy. Changing the desired outcome is not an
   instruction to delete/repoint financial, audit or auth records.
2. **Tenant access, if inactivity is desired:** identify the exact test-school
   memberships that may be made inactive and which administrators must keep
   access. Platform memberships, unrelated family/other-school access and external
   identities remain unchanged. Review actual application enforcement first.
3. **Devices, only if reuse is desired:** approve specific readers and a current-
   binding transition, including prior-credential revocation and delayed-event/
   callback handling using the existing reassignment safeguards. Preserve device
   inventory, credential history, durable bindings and original historical schools.

Backup/resource/maintenance evidence remains a separate execution prerequisite;
none of these retention decisions asserts readiness for deletion.

## Reporting and verification

`retention.mjs` produces deterministic per-constraint `HARD_BLOCKER` explanations,
exact child/parent names/counts and the applicable decision. Unknown retained
tables block without guessed rules. Both preflight and controlled cleanup plans
include this report. The retention-policy version is bound into the controlled
confirmation digest; old tokens must be regenerated/reviewed.

The current executor's preserved-table fingerprint checks are deliberately
unchanged: they reject modifications to protected records, including hypothetical
NULL/status updates. Enabling an actual current-binding/status transition requires
a separately reviewed operation and acceptance contract, not bypassing those checks.

See [REHEARSAL.md](REHEARSAL.md) for deterministic fictional SQL and exact
disposable-cluster commands. The local relationship and executor rollback checks
have now passed; [REHEARSAL-RESULTS.md](REHEARSAL-RESULTS.md) records their limits.
Passing refusal/rollback checks does not unblock removal of protected tenant roots.
