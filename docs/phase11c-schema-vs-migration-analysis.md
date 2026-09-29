# Phase 11C — Schema vs. Migration Analysis

**Scope:** Read-only comparison of checked-in `lib/db/drizzle/0000`–`0030` SQL against freshly verified aggregate development-catalog evidence and the more detailed Phase 11B comparison. No database writes, migration replay, or changes to application code were performed for this analysis.

## Executive findings and evidence boundary

The repository contains **31 migrations, numbered 0000–0030**. Fresh independently corroborated development queries report the database identity as `heliumdb`, role `postgres`, with 91 public tables and five migration-ledger rows. Fresh aggregate catalog evidence reports 338 public indexes, 613 constraints, three public functions, six non-internal triggers, zero `information_schema` public views, and exactly one unvalidated named constraint, `platform_devices_class_school_fk`. The fresh ledger aggregate MD5 is `1f7264f0cab648f2aff567ffc0ee3642`. Phase 11B reports that the five rows are IDs 1–5; no later ledger IDs were reported.

The identity and aggregate counts above were freshly verified by the main agent using two independent read-only paths: a shell `DATABASE_URL` identity query and `executeSql(environment:development)`. Both identified `heliumdb` / `postgres`; the development catalog query returned the stated counts and validation state. The shell's `REPLIT_ENVIRONMENT=production` label was misleading for this development shell and was not used to identify the database target. No production database was queried.

The more detailed object-by-object development-vs-clean-replay comparison below is from Phase 11B and was not freshly rerun. The fresh aggregate counts corroborate current totals and the unvalidated-constraint count, but do not independently refresh Phase 11B's exact four-development-only unique-key identities, 14 clean-only FK identities, per-object definitions, or development-vs-replay differences. Those detailed comparisons remain attributed to Phase 11B.

Because final catalog equivalence cannot establish execution history, and no independent development runner logs or equivalent execution record were examined here, each migration from 0005 through 0030 is classified **NOT VERIFIED** as an execution. No migration is classified as confirmed or strongly indicated applied, nor confirmed not applied. The matching objects recorded by Phase 11B establish final-state similarity only.

## Evidence used

- Fresh read-only evidence supplied by the main agent after independently comparing shell `DATABASE_URL` identity with `executeSql(environment:development)`: target identity, aggregate public catalog counts, ledger row count/hash aggregate, public view count, and unvalidated-constraint result.
- `docs/phase11b-migration-reconciliation.md`, especially its detailed schema comparison, per-migration matrix, ledger state, and caveats.
- Checked-in SQL files `lib/db/drizzle/0000_brainy_moon_knight.sql` through `0030_library_loan_copy_integrity.sql`, inspected read-only for expected DDL, data operations, and dependencies.
- Git history for `0005_tenant_reference_keys.sql`, including commit `8320e62` (23 September 2026).

The fresh evidence was a limited aggregate/identity inspection; this subagent did not query the database directly. No fresh per-object diff against a clean replay, runner logs, or development backup was examined. Phase 11B's disposable replay/adoption and synthetic tests are identified as disposable evidence only, not development execution evidence.

## Catalog comparison recorded by Phase 11B

Fresh aggregate evidence and the Phase 11B detailed comparison must be distinguished:

| Fresh read-only development evidence (main-agent cross-check) | Observed |
| --- | --- |
| Identity | Shell `DATABASE_URL` identity query and `executeSql(environment:development)` independently returned database `heliumdb`, role `postgres`. |
| Public tables | 91 |
| Migration ledger | Five rows; aggregate MD5 `1f7264f0cab648f2aff567ffc0ee3642`. |
| Public indexes / constraints | 338 indexes / 613 constraints |
| Public functions / non-internal triggers | Three / six |
| `information_schema` public views | Zero |
| Unvalidated named constraint | Exactly one: `platform_devices_class_school_fk` |

These fresh aggregates **do not constitute a clean-replay comparison** and do not identify individual index/constraint differences, except for the named unvalidated constraint.

Phase 11B reported the following **development vs. clean replay** comparison:

| Catalog area | Phase 11B reported observation |
| --- | --- |
| Public tables / columns | 91 tables and 1,127 columns on both sides; names, types, defaults, and nullability identical, with a few physical column-order differences. |
| Indexes | 338 in development vs. 334 in clean replay. The four development-only indexes back the four development-only `(id, school_id)` unique constraints below. |
| Constraints | 613 in development vs. 623 in clean replay. Differences include 14 clean-only legacy single-column academic foreign keys and four development-only validated tenant unique constraints. |
| Foreign keys | The 14 legacy single-column academic FKs were reported only in the clean replay. Composite school-scoped protections remained in both. Transient dependency/binding order for 0006–0008 cannot be reconstructed from this final catalog. |
| Development-only unique keys | Validated `UNIQUE (id, school_id)` on `attendance_discrepancies`, `attendance_events`, `nfc_cards`, and `student_class_assignments`, with backing indexes. |
| Functions / triggers | Three public functions and six non-internal trigger definitions were reported as matching. Phase 11B identifies matching binding-history, fee-payment-verification, and operations-history protections. |
| Views | Phase 11B does not provide a view-by-view inventory or comparison. View presence/absence is therefore not asserted here. |
| Validation state | Fresh evidence confirms `platform_devices_class_school_fk` is the one unvalidated named constraint in the development aggregate. Phase 11B reported it `NOT VALID` on both development and clean replay. Phase 11B checked a current development device/class pairing, but that does not establish historical-row validity or execution history. |

The development totals are independently corroborated by the fresh aggregate evidence above. The development-vs-clean-replay totals and specific detailed differences in this table are from Phase 11B, not a fresh replay comparison. Neither aggregate nor detailed catalog similarity establishes that a particular migration executed.

## Per-migration expected vs. observed final effects

“Expected” summarizes the checked-in SQL's intended final objects and operations; it is not an exhaustive column-by-column schema dump. “Observed” means only what Phase 11B documented from its earlier comparison. When that report did not provide object-level detail, the gap is called out rather than inferred.

For migrations 0005–0030, the final column gives the required execution classification. The classification is deliberately independent of whether the described end-state objects were observed.

| Migration / file | Expected final effects from checked-in SQL | Phase 11B reported development observation / differences | Execution classification / evidence limit |
| --- | --- | --- | --- |
| **0000** `0000_brainy_moon_knight.sql` | Initial people, schools, classes, memberships, parent/student links, NFC, subscriptions, audit tables; initial FK/index set; parent/student relationship backfill. | Core tables are present. Phase 11B found zero unmatched parent-link candidates and noted an additional named NFC tenant key. | Ledger ID 1 present; hash reported matching. Final-state match does not independently prove all historical backfill details. |
| **0001** `0001_phase3_meta.sql` | Academic sessions/terms, employees, subjects, assignments and class-subject structures; parent/school/student columns; initial unique keys and single-/composite-column FKs. | Objects and composite FKs are present. Phase 11B reports 14 legacy single-column academic FKs only in clean replay and an extra student-assignment tenant key in development. An older checked-in version matches the recorded ID 2 hash; current SQL differs. | Ledger ID 2 present, recorded hash differs from current SQL. Catalog/hash divergence prevents treating the current file alone as a complete history. |
| **0002** `0002_overjoyed_sue_storm.sql` | Partner and commission core objects and their declared keys/relationships. | Phase 11B says objects and definitions are present. | Ledger ID 3 present; hash reported matching. |
| **0003** `0003_phase4_integrity.sql` | Commission integrity constraints and default-rule seed. | Phase 11B says objects are present and reports one development rule. | Ledger ID 4 present; hash reported matching. |
| **0004** `0004_platform_operations.sql` | Platform devices, notifications, and their related references/constraints. | Phase 11B says objects are present; `platform_devices_class_school_fk` remains `NOT VALID` in both compared schemas. Recorded ID 5 hash differs from the current checked-in file; original SQL blob was not identified in Phase 11B. | Ledger ID 5 present, recorded hash differs from current SQL. Historical SQL and exact hash provenance remain unresolved. |
| **0005** `0005_tenant_reference_keys.sql` | Six named `UNIQUE (id, school_id)` constraints on `school_classes`, `academic_sessions`, `academic_terms`, `students`, `employees`, and `subjects`. These are prerequisites for composite tenant FKs. | Phase 11B reports all six named constraints exist and are validated with expected definitions. `school_classes_id_school_tenant_key` is the first duplicate-name conflict in naïve replay. | **NOT VERIFIED.** The six final objects and matching definitions do not prove this SQL was executed. No independent development execution log is available in the cited evidence. |
| **0006** `0006_prepare_tenant_keys_publish.sql` | Drops four composite tenant FKs on student-class assignments, class-subjects, and teacher-class assignments before key/dependency rebinding. This is an intermediate dependency step; it has no intended lasting object addition by itself. | The final catalog cannot reveal whether/when these constraints were transiently dropped. Phase 11B explicitly says intermediate drop/order is not provable. | **NOT VERIFIED.** Final-state equivalence cannot evidence the transient operation. |
| **0007** `0007_restore_tenant_foreign_keys.sql` | Rebinds named tenant keys and restores composite tenant FKs; recreates legacy-name unique indexes on classes/students to preserve the dependency shape expected by the script. | Final tenant protections are reported present. Historical dependency ordering and whether these exact index/FK operations ran are unrecoverable from the final catalog. | **NOT VERIFIED.** |
| **0008** `0008_align_tenant_fk_dependencies.sql` | Drops/recreates affected composite FKs and tenant keys in a specified order to align the FK dependency graph while preserving uniqueness objects. | Composite FKs are reported present, but the precise historical binding sequence is not established. | **NOT VERIFIED.** |
| **0009** `0009_phase5_attendance.sql` | Attendance events, corrections, discrepancies, notification events, device credentials/history, identification policies, biometric enrollments, NFC lifecycle/history fields; related indexes, constraints, and a device/class FK created `NOT VALID`. | Structures are reported present. Phase 11B notes extra attendance tenant keys on `attendance_discrepancies` and `attendance_events`, both contributing to known development-only tenant keys. | **NOT VERIFIED.** Catalog match/extra keys do not establish execution. |
| **0010** `0010_historical_device_school_bindings.sql` | Adds `new_school_id` if absent; creates device-school binding table/index; backfills bindings from current and historical device pairs; defines an append-only function and two triggers; rebinds attendance-event device/school FK. | Phase 11B reports objects/function/triggers matching clean replay and zero missing development device-school pairs. A synthetic pre-migration backfill passed in a disposable database. | **NOT VERIFIED.** Development end-state and pair check do not establish SQL execution; synthetic test is not development evidence. |
| **0011** `0011_historical_device_references.sql` | Backfills further device/school pairs from biometric and card references; adds composite FKs for those references. | Phase 11B reports composite FKs present, no missing development binding pairs, and a passing synthetic pre-migration backfill. | **NOT VERIFIED.** |
| **0012** `0012_phase6_academic_operations.sql` | Academic assignments, assessment types/assessments, grading rules, results, report cards/lines, timetable entries and associated indexes/relationships. | Phase 11B reports final catalog matches. | **NOT VERIFIED.** |
| **0013** `0013_phase7_finance.sql` | Finance settings, categories, fee structures/lines, invoices/lines, adjustments, payments, receipts; indexes; payment-verification metadata protection function/trigger. | Phase 11B reports final catalog/function/trigger match. | **NOT VERIFIED.** |
| **0014** `0014_finance_payment_integrity.sql` | Payment checks and unique indexes; payment/invoice/school key; adds/backfills receipt invoice linkage and snapshot fields, then enforces non-null/FK integrity. | Phase 11B reports final catalog matches. Development had zero receipts, so its receipt data check was vacuous; historical receipt backfill was tested only synthetically. | **NOT VERIFIED.** The empty development receipt set cannot show that a real backfill occurred. |
| **0015** `0015_school_bank_transfer_settings.sql` | Adds bank-transfer fields to fee-school settings and a consistency check. | Phase 11B reports final catalog matches. | **NOT VERIFIED.** |
| **0016** `0016_finance_refunds.sql` | Refund ledger table, school/status and evidence uniqueness/indexing. | Phase 11B reports final catalog matches. | **NOT VERIFIED.** |
| **0017** `0017_fee_provider_payments.sql` | Provider enablement settings, checkout-session and webhook-event tables, open-invoice uniqueness and supporting indexes. | Phase 11B reports final catalog matches; no provider was invoked during the synthetic work. | **NOT VERIFIED.** |
| **0018** `0018_fee_payment_notifications.sql` | School-scoped fee-payment notification table with recipient/school indexes and role-aware event uniqueness. | Phase 11B reports final catalog matches. | **NOT VERIFIED.** |
| **0019** `0019_phase7_finance_ledger_gaps.sql` | Fee-adjustment percentage/balance fields and checks; refund transaction type and check. | Phase 11B reports final catalog matches. | **NOT VERIFIED.** |
| **0020** `0020_finance_payment_notification_events.sql` | Expands payment-notification event constraints; adds event-reference identity and adjusts delivery uniqueness/checks. | Phase 11B reports final catalog matches. | **NOT VERIFIED.** |
| **0021** `0021_fee_payment_notification_outbox.sql` | Durable fee-payment notification outbox and retry index. | Phase 11B reports final catalog matches. | **NOT VERIFIED.** |
| **0022** `0022_payment_bound_notification_events.sql` | Expands and tightens event/reference checks on payment notifications and their outbox. | Phase 11B reports final catalog matches. | **NOT VERIFIED.** |
| **0023** `0023_invoice_generated_notifications.sql` | Invoice-generated notification ledger and outbox with recipient/school/retry indexes. | Phase 11B reports final catalog matches. | **NOT VERIFIED.** |
| **0024** `0024_platform_company_employees.sql` | Company-employee table and email/status indexes, using `IF NOT EXISTS`. | Phase 11B reports final catalog matches and explicitly notes that `IF NOT EXISTS` leaves execution provenance unknown. | **NOT VERIFIED.** Existing equivalent objects could predate this SQL. |
| **0025** `0025_communication.sql` | Communication notifications, deliveries, preferences, templates, campaigns, recipients, and push-device tables with scoped uniqueness and dispatch/retry indexes. | Phase 11B reports final catalog matches. | **NOT VERIFIED.** |
| **0026** `0026_communication_entitlements.sql` | Adds subject student/class references to communication notifications, tenant-scoped FKs and checks, and dispatch indexes. | Phase 11B reports final catalog matches. | **NOT VERIFIED.** |
| **0027** `0027_library.sql` | Library authors, publishers, categories, books, copies, settings, staff, loans, renewals and copy-status history; scoped uniqueness and lending/search indexes. | Phase 11B reports final catalog matches. | **NOT VERIFIED.** |
| **0028** `0028_school_operations.sql` | School operation categories, assets, facilities, maintenance requests, operational tasks and settings; scoped keys and supporting indexes/FKs. | Phase 11B reports final catalog matches. | **NOT VERIFIED.** |
| **0029** `0029_operations_history.sql` | Asset, maintenance-request, and task history tables; timeline indexes; append-only mutation function and three triggers. | Phase 11B reports final catalog/function/trigger match. | **NOT VERIFIED.** |
| **0030** `0030_library_loan_copy_integrity.sql` | Adds unique `(id, school_id)` key on library copies; replaces loan-copy FK with a composite school/book/copy reference. | Phase 11B reports final catalog matches. | **NOT VERIFIED.** |

### Migration 0005 conflict: exact object and provenance

The first failing statement in checked-in `0005_tenant_reference_keys.sql` is:

```sql
ALTER TABLE "school_classes"
  ADD CONSTRAINT "school_classes_id_school_tenant_key" UNIQUE("id","school_id");
```

The conflicting named object is the `school_classes_id_school_tenant_key` unique constraint on `public.school_classes`, with definition `UNIQUE (id, school_id)`. Phase 11B reports that it is validated and identical in definition to the clean replay. A PostgreSQL unique constraint is backed by a unique index; the duplicate-name error during this attempted `ADD CONSTRAINT` is consistent with that already-existing named constraint/index. The disposable replay copied from the development catalog and five-row ledger attempted 0005 and failed on this name. No attempt was made here to re-run that failure against any database.

Git history shows the checked-in 0005 file first appearing in repository history in commit `8320e62` on 23 September 2026, which added the six tenant-key statements; the file is absent from that commit's parent. This dates the checked-in SQL's repository appearance only. It does **not** date creation of the development object. The available evidence does not prove that the object was manually created, created by an older version of 0005, or created by any particular process or person. Nor does equivalence for this one constraint prove the whole migration ran: the migration consists of six statements, and the absent ledger entry provides no execution record. Therefore 0005 is **NOT VERIFIED**, not safe to mark applied solely from catalog equivalence.

## Dependencies and historical ambiguity

- 0005's six `(id, school_id)` unique keys are prerequisites for composite tenant FKs used in academic/attendance relationships. The checked-in 0006–0008 SQL deliberately manipulates FK/index dependencies and operation order.
- PostgreSQL's final catalog can show that keys/FKs exist and whether constraints are validated, but does not record the prior sequence of dropped/re-added constraints. Phase 11B accordingly could not reconstruct 0006–0008 history.
- Checked-in 0009–0011 include historical device-pair backfills and FK replacement; the final rows do not identify which source statements populated them. Phase 11B's synthetic backfill tests establish behavior on test fixtures only.
- 0014 backfills invoice/snapshot information for receipts. The documented live development receipt count was zero, so that target state supplies no positive evidence that populated historical rows were migrated.
- 0024 uses `IF NOT EXISTS`, making identical objects especially non-diagnostic of whether the migration ran.
- 0001's recorded ledger hash was reported to match an earlier checked-in version, while current SQL differs; 0004's recorded hash differs from the current file and the corresponding original SQL was not found in Phase 11B evidence. These facts make a simple current-file-to-final-catalog mapping incomplete.
- The Phase 11B synthetic adoption/audit did not modify or advance the live development ledger. It demonstrates a disposable procedure, not historical development execution.

## Classification summary for 0005–0030

| Required classification | Migrations |
| --- | --- |
| **CONFIRMED APPLIED** | None. No independent development execution record was examined. |
| **STRONGLY INDICATED APPLIED** | None. Catalog similarity alone is insufficient under the evidence rule. |
| **NOT VERIFIED** | 0005–0030, inclusive. |
| **CONFIRMED NOT APPLIED** | None. Absence from the ledger is not proof that SQL did not run outside the ledger. |

These labels describe execution-history confidence in development, not whether objects exist according to the prior Phase 11B comparison.

## Phase 11B synthetic evidence: what it does and does not show

**Proven in the documented disposable environment:** clean empty-database replay of all 31 migrations; expected failure when replaying 0005 against a disposable clone of the pre-reconciliation development schema/ledger; preservation of original five ledger rows during the guarded adoption rehearsal; adoption of entries 6–31 with explicit audit labeling on the disposable clone; no-op runner rechecks; synthetic historical device and receipt backfill exercises; cross-school FK rejection checks; and backup/restore preservation. Phase 11B also reports 595 API/web tests passing and successful typecheck/build checks.

**Not proven in the development database by that rehearsal:** that 0005–0030 were originally executed there; that their historic SQL bytes match current files; that transient 0006–0008 operations occurred in any particular order; that real development receipts were backfilled (there were none); or that the live development ledger is safe to reconcile. No synthetic result is treated as a development execution record.

## Conclusion and safe next evidence step

Fresh independent read-only evidence verifies the current development identity and aggregate catalog state stated above. The last detailed catalog comparison in Phase 11B shows broad agreement between development and clean replay, alongside meaningful differences (14 legacy academic FKs present only in clean replay; four tenant unique constraints/indexes present only in development; differing total constraint/index counts). The object-level differences have not been freshly rerun against a clean replay for this document, and neither aggregate nor detailed catalog evidence attributes those objects to particular migration executions.

**Development migration reconciliation is not established as safe by this analysis.** Before a future inspection, obtain an independently verified development connection/identity through an approved development environment. Then read the database identity and catalogs in a read-only transaction, with an independently reviewed target identity check. Preserve a catalog/validation snapshot and ledger snapshot. Do not infer execution from the presence of equivalent objects, and do not change the ledger or replay SQL against the live database as part of this forensics task.

The main agent's fresh database checks were read-only and independently identified the development target; this subagent made no database query or modification. No migration was executed, and no production query, Publish, or deploy was performed. This document is the only file created or edited for this task.