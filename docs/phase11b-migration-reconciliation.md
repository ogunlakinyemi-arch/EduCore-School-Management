# PHASE 11B — MIGRATION RECONCILIATION & RECOVERY REPORT

**Scope:** 29 September 2026; development catalog/ledger read-only; synthetic records and every database write confined to disposable local PostgreSQL.  
**Result:** Disposable current-schema adoption and recovery rehearsal **passed**. **Live development reconciliation NOT VERIFIED / NOT PERFORMED. Production readiness NOT ESTABLISHED.**

## 1. Root cause and evidence before changes

The live development database has 91 public tables and 1,127 columns but only five `drizzle.__drizzle_migrations` entries (IDs 1–5). Its named `school_classes_id_school_tenant_key` exists as a validated `UNIQUE (id,school_id)` constraint, identical in definition to the clean replay. Migration `0005_tenant_reference_keys.sql` tries to add that same named constraint without an existence guard. With the live schema and five-row ledger copied to a disposable database, the normal runner attempts `0005` and fails on the already-existing relation. This is a **schema/ledger mismatch**, not a failed clean replay.

The first five development ledger entries match the clean replay by ID and timestamp, but the recorded SQL hashes for IDs **2 (`0001`) and 5 (`0004`) differ** from the current checked-in files. ID 2's hash matches the earlier checked-in `0001` file before later SQL was appended. ID 5's original SQL blob has **not been identified** in checked-in history. This establishes that current checked-in SQL is not a complete account of the SQL recorded by those two ledger entries. **Why the subsequent schema changes were made without entries 6–31, and why the historical `0004` hash differs, cannot be established from the available evidence.** Do not call a specific historical tool or person the cause.

Read-only development counts: four schools, 15 users, 13 students, six parents, five employees, six classes, 14 attendance events, two academic results, three subscriptions, one partner, six NFC cards, five device-school bindings and 145 audit records. There were **zero** fee payments or receipts. No development data was copied into the synthetic fixture.

## 2. Schema and ledger reconciliation matrix

`MATCHED` means the migration's **final observable catalog effects** were present in development (and, where stated, the data invariant was checked), **not** that its SQL was historically executed. `DIFFERENT` identifies a proven hash/catalog difference. `UNKNOWN` means the transient dependency or data history cannot be established from the final catalog. Ledger IDs 1–5 correspond to `0000`–`0004`; all later ledger entries were absent before the disposable rehearsal.

The table's migration numbers correspond, in order, to these checked-in SQL files:

| Range | Exact migration filenames (ordered) |
| --- | --- |
| 0000–0007 | `0000_brainy_moon_knight.sql`, `0001_phase3_meta.sql`, `0002_overjoyed_sue_storm.sql`, `0003_phase4_integrity.sql`, `0004_platform_operations.sql`, `0005_tenant_reference_keys.sql`, `0006_prepare_tenant_keys_publish.sql`, `0007_restore_tenant_foreign_keys.sql` |
| 0008–0015 | `0008_align_tenant_fk_dependencies.sql`, `0009_phase5_attendance.sql`, `0010_historical_device_school_bindings.sql`, `0011_historical_device_references.sql`, `0012_phase6_academic_operations.sql`, `0013_phase7_finance.sql`, `0014_finance_payment_integrity.sql`, `0015_school_bank_transfer_settings.sql` |
| 0016–0023 | `0016_finance_refunds.sql`, `0017_fee_provider_payments.sql`, `0018_fee_payment_notifications.sql`, `0019_phase7_finance_ledger_gaps.sql`, `0020_finance_payment_notification_events.sql`, `0021_fee_payment_notification_outbox.sql`, `0022_payment_bound_notification_events.sql`, `0023_invoice_generated_notifications.sql` |
| 0024–0030 | `0024_platform_company_employees.sql`, `0025_communication.sql`, `0026_communication_entitlements.sql`, `0027_library.sql`, `0028_school_operations.sql`, `0029_operations_history.sql`, `0030_library_loan_copy_integrity.sql` |

| Migration | Expected effects | Actual development evidence | Ledger before rehearsal | Status |
| --- | --- | --- | --- | --- |
| 0000 | Core people, schools, NFC, subscriptions, parent-link backfill | Tables present; parent-match candidates without link: 0; additional named NFC tenant key | 1, hash matches | EXTRA |
| 0001 | Academic core, metadata, initial single-column and composite references | Tables/columns and composite FKs present; 14 legacy single-column FKs present only in clean replay; extra student-assignment tenant key; older checked-in SQL matches recorded hash | 2, hash differs from current | DIFFERENT |
| 0002 | Partner and commission core | Objects/definitions present | 3, hash matches | MATCHED |
| 0003 | Commission constraints, default-rule seed | Objects present; one development rule | 4, hash matches | MATCHED |
| 0004 | Devices, platform notifications and related references | Objects present; recorded SQL hash provenance unknown; device-class FK remains `NOT VALID` on both schemas | 5, hash differs from current | DIFFERENT |
| 0005 | Six named `(id,school_id)` tenant constraints | All six exist and are validated with expected definitions; first constraint blocks naive replay | absent | MATCHED |
| 0006 | Drop affected dependencies before rebinding | Final state cannot prove intermediate drop/order | absent | UNKNOWN |
| 0007 | Restore composite tenant FKs/keys | Final protections exist; historical dependency ordering cannot be reconstructed | absent | UNKNOWN |
| 0008 | Align unique-index/FK dependency graph | Composite FKs exist; exact historical binding sequence cannot be proven from the final catalog | absent | UNKNOWN |
| 0009 | Attendance, credentials, history and NFC structures | Structures present; two additional attendance tenant keys | absent | EXTRA |
| 0010 | Historical device bindings, append-only triggers, event FK | Objects/function/triggers match clean replay; referenced development device-school pairs missing: 0; synthetic pre-migration backfill passed | absent | MATCHED |
| 0011 | Additional biometric/card device references and binding backfill | Composite FKs present; no missing development binding pairs; synthetic pre-migration backfill passed | absent | MATCHED |
| 0012 | Assignments, assessments, results, report cards, timetable | Final catalog matches | absent | MATCHED |
| 0013 | Finance core, immutable verification trigger | Final catalog/function/trigger match | absent | MATCHED |
| 0014 | Finance payment constraints, receipt invoice/snapshot backfill | Final catalog matches; development has zero receipts (data check is vacuous); historical synthetic receipt backfill passed | absent | MATCHED |
| 0015 | Bank-transfer settings | Final catalog matches | absent | MATCHED |
| 0016 | Refunds | Final catalog matches | absent | MATCHED |
| 0017 | Provider checkout/webhook tables | Final catalog matches; no provider invoked | absent | MATCHED |
| 0018 | Payment notification ledger | Final catalog matches | absent | MATCHED |
| 0019 | Finance ledger-gap constraints | Final catalog matches | absent | MATCHED |
| 0020 | Payment notification event identity | Final catalog matches | absent | MATCHED |
| 0021 | Payment notification outbox | Final catalog matches | absent | MATCHED |
| 0022 | Payment-bound notification events | Final catalog matches | absent | MATCHED |
| 0023 | Invoice-generated notifications/outbox | Final catalog matches | absent | MATCHED |
| 0024 | Company employees | Final catalog matches; `IF NOT EXISTS` execution provenance unknown | absent | MATCHED |
| 0025 | Communication, campaigns, templates, deliveries | Final catalog matches | absent | MATCHED |
| 0026 | Communication entitlements | Final catalog matches | absent | MATCHED |
| 0027 | Library catalog and lending | Final catalog matches | absent | MATCHED |
| 0028 | Operations assets/facilities/maintenance/tasks | Final catalog matches | absent | MATCHED |
| 0029 | Operations history and append-only triggers | Final catalog/function/triggers match | absent | MATCHED |
| 0030 | Loan/copy integrity | Final catalog matches | absent | MATCHED |

**Full catalog comparison:** 91 tables and 1,127 columns on both sides, with identical column names/types/defaults/nullability (a few physical column orders differ). Three public functions and six non-internal trigger definitions match. Clean replay: 334 indexes, 623 constraints. Development: 338 indexes, 613 constraints. Exact differences: 14 clean-only legacy single-column academic FKs; four development-only validated `(id,school_id)` UNIQUE constraints and their backing indexes on `attendance_discrepancies`, `attendance_events`, `nfc_cards` and `student_class_assignments`. Composite school FKs remain present in both. One `platform_devices_class_school_fk` is `NOT VALID` **on both**, though the one current development device with a class has a matching school; historical rows in an unexamined target must not be assumed valid.

Classification is a mix of **A** (incomplete ledger with equivalent final effects), **B/D** (documented final-catalog and historical-SQL deviations), and **C** not demonstrated for the specific `0005` object—it matches. `0005` is not generally idempotent on an existing schema (**E**); it succeeds in an empty database and fails when the named key already exists.

## 3. Strategy used and audit boundary

**Other — guarded, disposable-only verified ledger adoption.** No historical SQL file, migration ID or existing ledger row was deleted, renamed or rewritten. The live development ledger was not advanced. A clone of its schema and five-row ledger received **26 additional ledger rows copied from an independently clean migrated reference only after catalog, fixture, provenance and data checks**. The audit labels these entries *verified adoption of equivalent observed state*, **not migrations originally executed there**. This is an experiment demonstrating runner mechanics and data preservation, not a recommendation to copy rows to live development or production.

Preflight required the exact known catalog differences; 91 tables/1,127 columns/3 functions/6 triggers; exact original ledger IDs and the documented mismatches at IDs 2 and 5; two synthetic schools and representative domain counts; no missing historical device bindings or invalid receipt mappings. All connections in the adoption script are hardcoded to local `/tmp` Unix socket, port 15439, role `runner`, and `phase11b_disposable_*` databases. It never reads ambient `DATABASE_URL`. Original five rows/hashes were retained. The successful redacted, non-personal audit is `/tmp/phase11b-disposable-adoption-44708.audit`; temporary audit files are not a durable production evidence store.

**No-go for a non-disposable target:** ID 5's original SQL is unknown, transient `0006`–`0008` dependency history is unproven, and the synthetic fixture is not a copy of real historical development data. A reviewed baseline or forward reconciliation might ultimately be preferable; selecting one for live development requires an independent data/provenance review. Never turn this rehearsal script into a production migration step.

## 4. Changes made

- `scripts/sql/phase11b-disposable-fixture.sql` — guarded two-school synthetic fixture with representative academic, attendance/NFC, subscription, unpaid invoice, partner, in-app communication, library, Operations and audit records. No provider calls, real payment, delivery or external identity is created.
- `scripts/sql/phase11b-historical-backfills.sh` — disposable pre-0010/0011 device and pre-0014 receipt backfill tests; creates and removes its own temporary local cluster.
- `scripts/sql/phase11b-disposable-adoption.sh` — **disposable-only** guarded catalog/data comparison, audit and ledger-adoption rehearsal with two no-op migration-runner checks.
- This report. **No checked-in historical migration was modified. No live development schema or ledger was modified.**

## 5. Data integrity and migration tests

| Exercise | Result |
| --- | --- |
| Empty PostgreSQL replay of all checked-in migrations | PASS; 31 ledger entries, 91 tables |
| Empty database second runner invocation | PASS; no new migration |
| Current-schema/ledger clone before reconciliation | EXPECTED FAILURE at `0005`, existing `school_classes_id_school_tenant_key`; original five ledger rows preserved |
| Two-school synthetic fixture on schema/ledger clone | PASS; 42 domain-specific row-count assertions, no real provider work |
| Guarded **disposable** adoption; first and second runner calls | PASS; 31 entries, original five unchanged, both runner calls no-op, synthetic counts digest unchanged |
| Pre-adoption full-data backup/restore | PASS; 91 tables, 338 indexes, 613 constraints, five ledger rows; schools/results/invoices/audit counts match |
| Post-adoption full-data backup/restore and runner | PASS; 91 tables, 338 indexes, 613 constraints, 31 ledger rows, fixture counts match; restored runner no-op |
| Historical device (`0010`/`0011`) and receipt (`0014`) pre-migration synthetic backfills | PASS in separate disposable databases; current development's zero receipts cannot demonstrate real receipt backfill |

Representative fixture counts **before adoption / after adoption / after restore**: schools 2/2/2, students 2/2/2, parents 2/2/2, teachers/employees 2/2/2, classes 2/2/2, attendance events 2/2/2, results 2/2/2, unpaid invoices 2/2/2, subscriptions 2/2/2, partners 1/1/1, in-app notifications 2/2/2, library books/copies 2 each, assets/tasks 2 each, NFC cards 2 and audit rows 2. No payment/provider checkout, webhook, payout, external delivery or outbox row was seeded.

## 6. Constraint and security regression

On the restored pre-adoption fixture, PostgreSQL rejected cross-school updates involving **NFC card history, Operations category/asset, academic class assignment, Finance invoice/student, Library book/copy and device/class**. Each test caught a foreign-key violation in a rolled-back transaction. The historical rehearsal separately rejected an unbound cross-school attendance/device pair. Development read-only checks found zero missing device-school binding source pairs, zero receipt mapping discrepancies (no receipts) and zero legacy parent-link candidates without a link.

The full API suite includes RBAC, Owner boundary, parent/child, student-self, partner, Finance/webhook, report/export and cross-tenant tests: **574 passed, 0 failed, 0 skipped**. Full web suite: **21 passed, 0 failed, 0 skipped**. Total: **595 passed**, matching the Phase 11 baseline. Root typecheck, API build, web build, `git diff --check`, `bash -n` on both shell scripts passed. The web build still warns about its large JavaScript chunk.

## 7. Recovery and application health

The **disposable** full-data backup/restore retained schema, migration ledger, representative records, audit history, and composite tenant constraints. The restored copy accepted the migration runner as a no-op. An API process started against that restored database in development mode with no delivery/outbox rows; `/api/healthz` returned **200** and unauthenticated `/api/reports/catalog` returned **401**. The process was stopped after checking it. The normal development API and frontend remained running; authenticated Clerk browser journeys were **not verified**.

**NOT VERIFIED IN PRODUCTION:** backup scheduling, retention, RPO/RTO, production restore, production data migration, object/file storage recovery, Clerk production settings, actual provider delivery, distributed rate limiting, PWA push and PDF Unicode fidelity. Database backup does not automatically protect any uploaded file bytes.

## 8. Remaining release gates and production status

1. **Migration gate still open:** independently establish the original `0004` SQL/provenance or formally approve its uncertainty; review `0006`–`0008` dependency differences and historical data effects with a representative, properly anonymized development-data copy. Do not insert adopted ledger rows into the live development database from this script. Confirm validated tenant constraints on any future target and inspect the generated Publish diff separately.
2. **Recovery gate still open:** define and approve production database/file backups, retention, monitoring, access, and a real data restore drill.
3. Phase 11 gates remain: production Clerk/CORS and provider credentials/delivery unverified; no distributed upload/export limits; incomplete PWA/push; Unicode PDF limitation.

**Production untouched:** no Publish, deploy, production SQL/migration, production ledger/configuration/user/secret change, real payment, webhook or real notification. This rehearsal **does not declare the system production-ready**.