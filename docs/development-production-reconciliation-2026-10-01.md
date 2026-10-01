# Development → Production reconciliation

## Scope and evidence

This corrects the known findings from the completed 30 September baseline
(`reports/production-schema-audit-2026-09-30.html`). It does not replay the
historical migrations or approve Production execution.

The new, actual Replit preview is saved in
`reports/development-production-preview-2026-10-01.json`. It contains **410**
statements, generated after the Development corrections:

| Category | Count |
| --- | ---: |
| New tables | 62 |
| Added columns | 11 |
| Foreign keys | 236 |
| Other added constraints | 2 |
| Non-unique indexes | 70 |
| Unique indexes | 28 |
| Replaced obsolete CHECK constraint | 1 |

There are no table/column drops, truncations, deletes, or data-copy statements.
The one DROP is the old three-status CHECK, replaced by a five-status CHECK
that retains every previously valid value. Replit flags the preview as
potentially non-backwards-compatible; it reports no structural data loss.
The saved positions below belong to this fresh preview, not the old preview.

## Development corrections

- Authoritative Drizzle schema and live Development now contain explicit
  `UNIQUE (id, school_id, category_type)` constraint
  `school_operation_categories_id_school_type_key`. The existing unique index
  is preserved. The new table's creation at position 59 includes the key,
  before category foreign keys at positions 276, 283, and 287.
- The source now explicitly declares the five supported device statuses:
  ACTIVE, INACTIVE, MAINTENANCE, SUSPENDED, UNASSIGNED. Development's already
  five-state CHECK was renamed to `platform_devices_status_supported_check`.
  Without a distinct name, the actual Publish preview omitted the expression
  difference. The fresh preview drops the obsolete CHECK at position 63 and
  adds the desired CHECK at position 410.
- `platform_devices_class_school_fk` is now validated in Development.
  Before validation, the aggregate mismatch count was zero and its referenced
  index was verified unique and valid. New nullable `school_class_id` is added
  before the Production FK at position 407; current Production has no devices.
  Validation must not be used as a repair for mismatching data.
- No equivalent Production unique key is renamed or recreated merely for
  naming consistency. In particular, the existing NFC, academic-session,
  academic-term, employee and subject tenant keys remain suitable prerequisites.
  Attendance-event and discrepancy tables are new, not existing equivalents.
- Neither database migration ledger nor the checked-in Drizzle journal is
  modified. Ledger-neutral Development DDL references are under
  `lib/db/dev-reconciliation/`; they are not automatically executed.

## Schema sync is not a data/protection migration

Replit Publish introspects Development and Production; it does **not** replay
the checked-in migration SQL. Its current preview includes no functions,
triggers or historical backfills. Neither `drizzle-kit push` nor passing a
clean historical replay proves these effects will reach Production.

The documented **Database tool SQL runner** is the separate manual mechanism
for these SQL-only effects, with a verified target, explicit approval and a
controlled release window. This task does not execute that mechanism against
Production. Do not add a startup hook, build hook, custom Production-targeting
runner, or artificial migration-ledger entry.

Use the following existing SQL as the reviewed definition sources, not as
whole files to replay:

| Required protection | Definition source |
| --- | --- |
| `prevent_device_school_binding_mutation`; binding UPDATE/DELETE and TRUNCATE triggers | `0010_historical_device_school_bindings.sql`, function/trigger block |
| `protect_fee_payment_verification_metadata`; fee-payment verification trigger | `0013_phase7_finance.sql`, function/trigger block |
| `prevent_operations_history_mutation`; three operation-history UPDATE/DELETE triggers | `0029_operations_history.sql`, function/trigger block |

These are **three functions and six triggers**. Their referenced new tables
must exist before installation. Protected-table writes must remain paused
between structural publication and protection installation.

## Historical data prerequisites

Focused aggregate-only Production reads on 1 October are saved in
`reports/reconciliation-backfill-preflight-2026-10-01.txt`.
They supplement missing data counts in the baseline; they are not another
broad schema audit.

| Behavior | Current requirement | Existing definition source |
| --- | --- | --- |
| Guardian/student relationship | Four uniquely matched missing links; zero ambiguous matches currently; one unmatched student | `0000_brainy_moon_knight.sql`, relationship INSERT only |
| LEGACY session | Four schools without a LEGACY session | `0001_phase3_meta.sql`, LEGACY INSERT only |
| Class-assignment history | Four exact same-school class matches missing LEGACY history; one unmatched student; zero ambiguous class matches | `0001_phase3_meta.sql`, assignment INSERT only |
| Commission seed | No ACTIVE NULL-term rule exists; reviewed seed remains required | `0003_phase4_integrity.sql`, guarded seed only |
| Historical device-school bindings | No devices and no existing binding, attendance, credential or assignment-history source tables: current backfill is a no-op | `0010_historical_device_school_bindings.sql` |
| Historical biometric/card device references | Biometric source and NFC `last_device_id` column absent: current backfills are no-ops | `0011_historical_device_references.sql` |
| Receipt/payment metadata | Both finance source tables absent: current metadata backfill is a no-op | `0014_finance_payment_integrity.sql` |

Recheck these predicates immediately before any approved execution.
Relationship matching must require meaningful normalized names/phone numbers,
exact same-school matching, **exactly one** candidate, and no existing link.
Multiple candidates stay unlinked for review; never choose the first match.
Class history must require exactly one same-school name/section match and no
existing matching history. Leave unmatched or ambiguous students unchanged.
Use existing historical school evidence for device references; current
ownership cannot establish a prior school's relationship after reassignment.
Absent-source guards must avoid parsing queries against missing tables.
Seeds and inserts must be repeatable without duplicates.

## Rehearsal boundary and release gate

The rehearsal input contains Production **structure only**, not Production
data. An isolated schema inside Development, executed through the supported
Development SQL callback in a transaction ending with ROLLBACK, can test the
fresh statement order, parent keys, columns and synthetic protection/backfill
fixtures. It is not a separate Replit database branch or a live-data clone.
Never report those tests as proof that every actual Production row is valid.

The completed rehearsal passed with exit code 0 (`BEGIN`, `DO`, `ROLLBACK`);
the result is saved in `reports/reconciliation-rehearsal-result-2026-10-01.txt`.
All 410 statements were executed in their generated order, with only schema
qualification changed to the isolated schema. Assertions verified all 91
tables, all 236 new FKs, category prerequisites, existing tenant-key preservation,
five device statuses and same-school class enforcement. The existing three
functions and six triggers were installed in the isolated schema; synthetic
tests exercised their mutation guards. Guardian ambiguity and same-school
matching, LEGACY/class inserts, commission seeds, and historical device binding
inserts were tested for repeatability. Unmatched class records stayed unchanged.

The SQL callback rejected the large direct payload before execution (`E2BIG`).
An isolated Development-only transport table held text chunks; one atomic
rehearsal executed the reconstructed SQL and rolled it back. The transport
schema was then removed. Catalog checks confirmed that neither test schema
remained. The fixture TRUNCATE uses CASCADE solely inside the isolated schema
to get past dependent-FK prechecks and exercise the actual BEFORE TRUNCATE
trigger. No live/public object or migration ledger was changed by these tests.

Before Production: review the fresh preview and the SQL-only supplement,
resolve any remaining rehearsal failures, confirm a recoverable backup and
maintenance window, and obtain separate approval. Only then may the human
operator use Publish for the structural diff and the Database SQL runner for
the reviewed protections/backfills, before resuming protected-table writes.