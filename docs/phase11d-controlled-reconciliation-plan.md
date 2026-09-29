# Phase 11D — Controlled Development Reconciliation Plan

**Yemait EduCore · 29 September 2026 · DESIGN ONLY for a future persistent-development change.**  
**Decision now: STOP before adoption.** See the [disposable rehearsal report](phase11d-disposable-rehearsal-report.md) for observed results. Neither this plan nor the rehearsal authorizes a persistent database change, production work, or Publish.

## 1. Current state and immutable evidence

The journal contains 31 SQL migrations (`0000`–`0030`); development has ledger IDs 1–5 only. The recorded hashes for `0001` and `0004` differ from the current files. The old `0001` Git SQL is known; the SQL matching the `0004` recorded hash was not found. No historical mechanism explains the absent 26 ledger entries. The development constraint `school_classes_id_school_tenant_key` is a validated `UNIQUE (id, school_id)`; replay of `0005` on a disposable copy fails at its first unguarded `ADD CONSTRAINT`. This is **not** proof that `0005` ran historically.

This phase independently cross-checked the shell connection against the platform **development** query: both returned `heliumdb`, `postgres`, 91 public tables, five ledger rows and the same ordered-row MD5 `bb9579f8bcffb9c54d92b432aa215ff1` for `id|hash|created_at` joined with newlines. The read-only capture under the private, temporary `/tmp/phase11d.S7ZGXn92/` directory consists of `development-schema.dump` (schema-only, SHA-256 `931d3f0ba2f525d3c84416db49cfc80b967436c9599fa5c56c6752edf50865e0`) and `development-ledger.csv` (five rows, SHA-256 `19f5defdebdeaad2a5bdae352fe1b70f5eb3ab524f7b582320bf6c46db4f17b9`). Archive and ledger are **temporary test evidence, not a recoverable full-data backup**; a later action must take fresh controlled evidence rather than rely on `/tmp`.

Fresh read-only development counts: 91 tables, 1,127 columns, 338 indexes, 613 constraints, three public functions, six non-internal triggers, zero public views, zero fee receipts, one unvalidated constraint and zero missing referenced device-school binding pairs. The `pg_dump --schema-only` archive includes the column/index/constraint/FK/function/trigger/view definitions and validation state; no development application rows were copied to the disposable database. The existing five row values and all 31 current file hashes are in [Phase 11C's hash table](phase11c-migration-hash-forensics.md#development-ledger-and-complete-hash-comparison). The development connection was used only for read-only SQL and schema-only dump.

## 2. Known uncertainties and comparison baseline

The fresh local clean replay has **91 tables, 334 indexes and 623 constraints**, versus the development-schema clone's **91 tables, 338 indexes and 613 constraints**. An offline catalog diff found exactly **14 clean-only legacy single-column academic FKs** and **four clone-only validated `(id,school_id)` UNIQUE constraints plus their four backing indexes** on `attendance_discrepancies`, `attendance_events`, `nfc_cards` and `student_class_assignments`. The expected composite tenant FKs remain, but final objects cannot prove `0006`–`0008` transient dependency operations. The device/class FK is `NOT VALID`; zero currently observed matching pairs is not a substitute for a target-wide validation. Existing development has zero receipts, so `0014`'s populated-receipt backfill is vacuously satisfied there. Synthetic fixtures do not establish real historical data effects.

The current repo's installed runner executes later journal SQL and inserts each ledger row in one transaction; it does not compare old hashes. A schema push can make equivalent objects without advancing the ledger, but Phase 11C-A/B found **no historical execution record**. Neither path may be selected as the cause by assumption. The mismatching old hashes must remain as historical evidence.

## 3. Baseline reproduction

A private PostgreSQL 16.10 cluster under `/tmp/phase11d.S7ZGXn92/` bound only to its Unix socket on port `15449`, role `runner`, hosted `phase11d_baseline`. The freshly captured development **schema-only** archive was restored there and the five ledger rows imported verbatim; the original ledger digest matched. `phase11d_failing` was cloned from that baseline. The normal migration runner against that **local** clone failed at `0005` with PostgreSQL's `relation "school_classes_id_school_tenant_key" already exists`; the transaction rolled back, retaining all five rows and the same normalized schema dump. A separate clean local database replayed all 31 migrations successfully. No persistent-development runner was invoked.

## 4. Proposed reconciliation method and decision gate

**No migration is authorized for adoption now.** A final catalog match is a *candidate observation*, not proof of execution or enough, by itself, to insert ledger rows. The current clean-vs-clone catalog differences and unverified data/dependency effects prevent the proposed adoption gate from passing. The demonstrated preflight in the disposable clone is deliberately read-only: it checks the five-row ledger fingerprint, exact six named `0005` tenant-key definitions, a required Finance column, a Communication table, the device-binding function/trigger and synthetic historical binding pairs. It does not pretend that these representative checks validate all 26 migrations. A separate approval/equivalence gate **must stop** because the full migration-by-migration data/dependency evidence below remains incomplete. Do not treat Phase 11B's bulk disposable adoption script as authority to adopt live rows.

**`0005` explicitly: SCHEMA-EQUIVALENT** for each of its six named, validated `(id,school_id)` keys, including `school_classes_id_school_tenant_key`; its first statement must **not** be replayed or its constraint dropped simply to make replay succeed. Equivalence for that final object does not date or identify its creator.

An acceptable *future* candidate for “verified adoption” must have independently reviewed **final catalog and data effect** evidence, known allowed deltas, ordered journal/hash reference and an explicit decision for its own row. If any of `0005`–`0030` remains unresolved, do **not** append a partial prefix and then invoke the runner: it could execute the next non-idempotent migration. Preserve all existing five rows, including their IDs, hashes and timestamps, byte-for-byte. Never overwrite the two old hashes to make them match current SQL.

## 5. Migration-by-migration current-state classification

This is a final-state **catalog** classification against the documented clean replay and fresh aggregate/diff, **not historical execution**. `SCHEMA MATCHES` says the final observable schema effects align; it does not approve adoption where data effects, lineage or prerequisites are unverified. All 26 rows have **adoption decision: HOLD**.

| Migration | Catalog class | Evidence / outstanding condition before any future adoption |
| --- | --- | --- |
| `0005` tenant keys | **SCHEMA MATCHES** | All six named validated keys, including the duplicate `school_classes` key, match; creation provenance and dependency review open. |
| `0006` dependency preparation | **CANNOT DETERMINE** | Temporary drops of four FKs leave no lasting object proving the operation/order. |
| `0007` FK restoration | **SCHEMA PARTIALLY MATCHES** | Composite FKs exist; precise rebinding, legacy indexes and dependency provenance need review. |
| `0008` dependency alignment | **SCHEMA PARTIALLY MATCHES** | Final protection exists; intermediate drop/recreate and index bindings remain unknown. |
| `0009` attendance | **SCHEMA PARTIALLY MATCHES** | Attendance structures exist; two extra development tenant keys and `NOT VALID` device/class FK require review. |
| `0010` historical device bindings | **SCHEMA MATCHES** | Table/index/function/triggers and zero missing current pairs; real data/backfill lineage unknown. |
| `0011` historical device references | **SCHEMA MATCHES** | Composite references and current-pair check match; original biometric/card backfill unproven. |
| `0012` academic operations | **SCHEMA MATCHES** | Final assignments, assessments, results, report cards and timetable objects; verify data/tenant invariants. |
| `0013` Finance core | **SCHEMA MATCHES** | Final objects and payment-verification function/trigger; review real financial data before adoption. |
| `0014` payment integrity | **SCHEMA MATCHES** | Final receipt constraints/columns; **zero development receipts**, so populated backfill remains unproven. |
| `0015` bank settings | **SCHEMA MATCHES** | Final columns and bank-transfer check; review existing values. |
| `0016` refunds | **SCHEMA MATCHES** | Refund ledger objects/keys; review financial record invariants. |
| `0017` provider payments | **SCHEMA MATCHES** | Settings, checkout/webhook tables and indexes; provider/session data effects unverified. |
| `0018` payment notifications | **SCHEMA MATCHES** | Notification objects/role-aware uniqueness; event history unverified. |
| `0019` Finance ledger gaps | **SCHEMA MATCHES** | Adjustment fields/checks and refund transaction checks; real-row compliance review needed. |
| `0020` payment notification events | **SCHEMA MATCHES** | Final event references, delivery uniqueness/checks; historical transitions unknown. |
| `0021` payment outbox | **SCHEMA MATCHES** | Table/retry index; existing outbox/retry history unexamined. |
| `0022` payment-bound events | **SCHEMA MATCHES** | Final notification/outbox checks; real event/reference data review needed. |
| `0023` invoice-generated notices | **SCHEMA MATCHES** | Ledger/outbox/indexes; delivery history unexamined. |
| `0024` company employees | **SCHEMA MATCHES** | Table/indexes; `IF NOT EXISTS` cannot establish execution/provenance. |
| `0025` communication | **SCHEMA MATCHES** | Notification/delivery/preference/campaign/template/push objects; real delivery history unreviewed. |
| `0026` communication entitlements | **SCHEMA MATCHES** | Final subject/class references, school FKs/checks and indexes; data/consent review needed. |
| `0027` library | **SCHEMA MATCHES** | Catalog, copies, staff and loans with scoped keys; lending data review needed. |
| `0028` school Operations | **SCHEMA MATCHES** | Asset/facility/maintenance/task objects and scoped FKs; real history/data review needed. |
| `0029` Operations history | **SCHEMA MATCHES** | History tables/function/three triggers; verify existing histories and trigger invariants. |
| `0030` loan/copy integrity | **SCHEMA MATCHES** | Composite loan-copy FK and copy unique key; review real loan/copy pairs and validation. |

There are **0 `SCHEMA DOES NOT MATCH`** classes in the matrix because the observed differences were assigned to partial/unknown categories, not ignored. The clean-only/clone-only delta still prevents claiming the whole schemas are equivalent. Per-migration source/effect details are in [Phase 11C's matrix](phase11c-schema-vs-migration-analysis.md#per-migration-expected-vs-observed-final-effects).

## 6. Hash treatment and reconciliation marker

Keep ledger IDs 1–5 **unchanged**. ID 2 (`0001`) records the SHA-256 of a known old Git blob, while ID 5 (`0004`) records a hash whose source remains unknown; neither is to be “fixed” by replacement. The default Drizzle ledger (`id`, `hash`, `created_at`) has **no field distinguishing execution from adoption**. A future procedure must preserve a separately stored, tamper-evident reviewer-approved **adoption audit** keyed to a ledger/pre-state digest: for each candidate record migration tag and ID, current exact SQL hash/journal time, the old hash if an original row exists (IDs 2/5 remain original, not adopted), observation/data proof, accepted delta, operator/reviewer, UTC reconciliation time, reason, target identity, backup/audit reference and the literal label **“VERIFIED RECONCILIATION OF CURRENT STATE; HISTORICAL EXECUTION NOT VERIFIED.”** Do not add a new production/development table in this phase; decide durable audit storage and access/retention before any live change.

## 7. Idempotency, negative tests and stop-on-failure rules

A completed *future-approved* disposable procedure must retain the original five exact rows, append only individually signed candidate rows in journal order under one atomic guarded transaction, and leave schema and all application data unchanged. Two subsequent normal runner invocations must be verified no-ops (same complete ledger, same schema/catalog and data digests), not merely exit zero. A no-op on a separately clean-replayed 31-row reference is **not** evidence that the current clone was reconciled.

The representative local **read-only** catalog/data preflight was tested against five disposable negative copies, one mutation per copy; each refused before any ledger insertion:

| Negative case | Deliberate isolated change | Rejection category |
| --- | --- | --- |
| A: required column | Drop `fee_school_settings.bank_name` | `required_column_gate` |
| B: different constraint | Replace named class tenant key with different `UNIQUE(id)` | `tenant_key_definition_gate` |
| C: absent backfill | Remove one synthetic historical device-school pair, restoring enabled triggers before checking | `historical_pair_backfill_gate` |
| D: missing trigger | Remove `device_school_bindings_append_only` | `function_trigger_gate` |
| E: partial schema | Remove `communication_notifications` | `partial_schema_gate` |

Each negative copy retained five ledger rows. These representative tests demonstrate refusal for the specified categories; a production-quality per-row validator remains to be designed/reviewed and must not substitute five spot checks for 26 decisions. Stop on changed target or ledger fingerprint, unknown/missing constraint/data effect, unresolved `0004` risk, missing backup/restore, changed audited schema/data, runner DDL attempt, failed test or loss of reviewer approval. Never cure a rejection by dropping tenant constraints or deleting ledger entries.

## 8. Tenant isolation, backup/rollback and application verification

On the restored disposable fixture, six cross-school updates failed with PostgreSQL FK SQLSTATE `23503`, each within a rolled-back transaction: NFC card/student, device/class, Operations asset/category, Finance invoice/student, Library copy/book and Communication notification/student. The original Phase 11B rehearsal also tested additional academic/device relationships. These database checks do not establish *application* Partner/Owner/Parent/Teacher role boundaries; the API suite covers role checks on a separately clean-replayed, seeded disposable target. Authenticated external identity/provider journeys were not run.

A complete custom-format backup of the five-row synthetic current clone was restored to a **separate** disposable database. Original/restored normalized schema dumps matched; five-ledger digest, two schools, two students, two unpaid invoices, two audit rows and the preflight passed. The backup SHA-256 and result are in the rehearsal report. This demonstrates **pre-adoption synthetic recovery**, not a real development backup, post-adoption recovery, uploaded-file recovery or production RPO/RTO. A future recovery decision must restore a verified complete database **and** separately stored files under its own approval; blindly deleting ledger entries after a committed adoption can make the runner replay non-idempotent SQL.

The current-schema clone yielded 572/574 API tests: its actual academic FK index bindings violate a test's clean-replay expectation, and its two-student/two-school fixture violates a parent test's same-school prerequisite. A **separate clean-replayed** local DB, seeded with the fixture plus a same-school student, passed **574/574** API tests. Web tests **21/21**, workspace typecheck and both builds passed. Those clean-reference results cannot be reported as passing tests **on the unreconciled development clone**. No application behavior was changed to force a pass.

## 9. Future development procedure — **NOT AUTHORIZED OR EXECUTABLE NOW**

The following is the exact **sequence of gates and intended effects**, not a runnable SQL/script for the persistent database:

1. Obtain separate explicit approval from the user, accountable operator and independent reviewer for a **development-only** window and write freeze. Independently verify the actual connection against the platform development target and a fresh pre-state identity/catalog/ledger fingerprint; a shell environment label alone is insufficient. Stop if any value changed.
2. Obtain encrypted **full-data** database and separately stored file/config inventory backups without exposing secrets; checksum, retain and successfully restore a copy to a new isolated disposable target. Define access, retention, RPO/RTO and recovery owner before any write.
3. Collect fresh schema/constraint-validation, data-invariant and exact first-five ledger snapshots. Independently investigate `0004`, 14 clean-only academic FKs, four extra tenant keys/indexes, `0006`–`0008` dependency bindings, `NOT VALID` device/class FK and backfills on an approved anonymized development-data copy. Sign an individual decision/audit record for **each** of `0005`–`0030`, including acceptable deltas. If any is HOLD, **STOP without a ledger write**.
4. Rehearse the reviewed complete procedure on a fresh restored **disposable** database, including every negative gate, unchanged original five rows, no unexpected schema/data change, two no-op runner passes, tenant/role tests, and full-data backup/restore. Record audited digests and approvals. Do **not** repurpose the Phase 11B script with a changed connection string.
5. Only under a **new explicit development-change authorization**, prepare a newly reviewed procedure hard-restricted to that verified development identity and exact pre-state digests. In one guarded atomic transaction, append **only** the signed/verified candidate ledger IDs, hashes and journal timestamps in order; retain IDs 1–5 byte-for-byte, keep a separate immutable adoption audit and update the sequence. Separate any forward schema/data repair into its own separately approved, correctly ordered change—never disguise it as adoption.
6. Compare before/after catalog/data and signed audit; require exact approved ledger additions only. Invoke the runner twice and verify both are true no-ops; rerun API/web tests, typecheck, builds, tenant/role checks and health against an appropriate isolated or approved target. Snapshot and retain audit/backup after success.
7. On **any** mismatch/failure, stop writes, preserve evidence, diagnose independently and decide whether a full verified development restore (including associated files/config) is warranted under separate approval. Do not silently edit individual ledger hashes/rows. No production operation or Publish follows automatically.

## 10. Preconditions, risks and remaining blockers

**Blocked now:** No trustworthy historical `0004` SQL; no proven reason for missing entries; `0006`–`0008` transient binding history; 14 missing legacy FKs/four extra keys without signed equivalence decision; real data/backfill effects not demonstrated by the schema-only synthetic copy (zero receipts); `NOT VALID` FK; no approved live full-data/file backup or restore rehearsal; no reviewed durable adoption audit/validator; and two API assertions that fail on the actual current-schema fixture. The procedure therefore **has not been applied even to the disposable current clone**. A later approval must make a fresh target/data assessment, not extrapolate from this date's `/tmp` cluster.

**Status:** A safe refusal and several supporting recovery/security mechanisms were rehearsed; **development reconciliation remains blocked**. A clean-reference no-op and passing clean-reference tests are limited evidence. No development schema, ledger or application functionality was modified; production was not queried or changed; Publish was not executed.