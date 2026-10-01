# Feedback incremental PostgreSQL migration validation

**Status:** PASS  
**Run date:** 2026-10-01  
**Scope:** isolated validation of migrations 0031 onward. No Development DDL/DML was run; Production was not read or written.

## Development preflight and schema-only capture

- Connection target metadata matched the supplied Development fingerprint before schema export: database `heliumdb`, role `postgres`, 91 public tables, 396 public rows, 9 schools, 13 students, migration ledger IDs `[1,2,3,4,5]`.
- Source guard verified `BEGIN READ ONLY` and `transaction_read_only=on` before and after the schema-only export. The `pg_dump` process also received `PGOPTIONS=-c default_transaction_read_only=on`; no source DDL/DML was run.
- Supplied catalog hash: `7eb715d6e59f0774596b45db529d6609`. Its canonicalization algorithm was not provided, so the hash is recorded but not claimed to match the independently computed dump digests below.
- Read-only `pg_dump --schema-only --schema=public` digest: MD5 `384e6b58c82c15ebffabc7f20580844b`, SHA-256 `73187c8d1f71b12bc394562e44d6674fa378d5c53ef9f94d0227b05b6c9ddecc`; dump bytes 306340.
- Observed public catalog counts: `{"views":0,"columns":1127,"indexes":339,"triggers":6,"functions":3,"constraints":614}`. The prior retained Phase 11D report records 338 indexes and 613 constraints; this live preflight observed 339 indexes and 614 constraints, a +1/+1 difference that remains unattributed. The retained report supplies counts but not a name-level catalog inventory, and its temporary schema dump is unavailable, so no exact added index/constraint names can be established against that baseline.
- Existing migration tables already present before this rehearsal: `[]`.
- The ledger was read only and left untouched. No old migration was run against Development.

## SQL review and migration hashes

- Forbidden destructive SQL/DML statements detected in selected new SQL: `[]`.
- `ON DELETE RESTRICT` clauses: 117; `BEFORE ... DELETE ON` immutable-trigger definitions: 7. These are trigger/FK definitions only; no actual `DELETE`, `DROP`, or `TRUNCATE` statement was executed.
- `CREATE TRIGGER ... BEFORE UPDATE OR DELETE` definitions counted in source SQL: 6.
- Pending school-logo versioning was folded into unapplied `0033`: historical logo rows can remain, with a partial unique index limiting each school to one current version. The former `0037` file/journal entry was removed; no `DROP INDEX` or logo-history deletion is part of the selected migrations.
- `0036` adds `student_subscription_payments_one_business_term_uq` on school/student/session/term for payment status `PENDING`, `RECONCILIATION_REQUIRED`, or `PAID`, and for any `reconciliation_status='RECONCILIATION_REQUIRED'`. This is additive and does not rewrite legacy subscription or commission rows; the probes isolate the index using different subscription IDs.

| Migration | SHA-256 of exact SQL file |
| --- | --- |
| `0031_staff_nfc_billing.sql` | `e3f0645715c4cfadf8554649b7c11d7ca7cdbfd2be5c57782b1af5e5e2423b7d` |
| `0032_employee_nfc.sql` | `ba6e6132a43485e9e04e89885e2d118804723ee7039d009f4d8ef3fc3b7ff745` |
| `0033_school_workflows.sql` | `ea294fea7b6e27013c7140215f7e3432e0f5f90566e474a61114494c94154056` |
| `0034_school_transport.sql` | `2660bf9d675ec825c321f16fb0616511a71a031de29a5d83d4026887e991b2a8` |
| `0035_settlement_payroll.sql` | `5e9cd1be6827df50f7cf551cca61df758e7775bc354a1ba9b74ec4d384b70557` |
| `0036_student_subscription_allocations.sql` | `db161286afabfc50b97642f47ac1c2a7329b9b0faf7f9d5113c47891acd27705` |

## Disposable rehearsal

- A new private PostgreSQL 16.10 cluster under `/tmp` was used; all databases and synthetic records were removed with the cluster at completion.
- The live schema was imported with `pg_dump --schema-only` only; both local historical-schema clones had zero application rows before synthetic fixtures.
- Default `public` schema creation from the dump was skipped during clone import because the disposable database already has that standard schema; no source schema object was removed or changed.
- New SQL was applied to the clean clone in one transaction and to the existing-schema fixture clone in one transaction.
- A separate clone deliberately failed after all selected migration SQL in the same transaction; atomic rollback result: **PASS — forced division-by-zero SQLSTATE 22012 rolled back all new DDL and seed data**.
- Incremental baseline fake-fixture preservation: PASS — original synthetic IDs, student admission UID/status, NFC card UID/status/student owner, and academic periods unchanged.
- Existing column/constraint metadata parity after migration: PASS — each database retained all pre-existing columns and constraints; detailed counts in checks above.
- Clean-clone catalog: `{"tables":125,"columns":1644,"indexes":508,"constraints":959,"foreignKeyDeleteActions":{"RESTRICT":117,"NO ACTION":17}}`.
- Incremental-clone catalog: `{"tables":125,"columns":1644,"indexes":508,"constraints":959,"foreignKeyDeleteActions":{"RESTRICT":117,"NO ACTION":17}}`.
- Source schema dump included no application data. No real identity, student, school, payment, payroll, provider, or credential fixture values were copied.

## Database constraint and trigger results (128 passed, 0 failed)

| Result | Check | Evidence |
| --- | --- | --- |
| PASS | feedback_incremental schema-only import has no Development rows | schema-only clone contains 0 public rows before fixtures |
| PASS | feedback_clean schema-only import has no Development rows | schema-only clone contains 0 public rows before fixtures |
| PASS | feedback_rollback schema-only import has no Development rows | schema-only clone contains 0 public rows before fixtures |
| PASS | Incremental clone contains only minimal synthetic school/student/parent/employee/card/period fixtures | verified 18 fake school/student/parent/employee/card/period records |
| PASS | feedback_clean pre-existing columns and constraints unchanged | 1127 existing columns and 614 existing constraints retained |
| PASS | feedback_incremental pre-existing columns and constraints unchanged | 1127 existing columns and 614 existing constraints retained |
| PASS | Original student ID/admission UID/status, student-card UID/status/owner, and academic periods preserved | before/after synthetic baseline JSON identical |
| PASS | billing-rule snapshot BEFORE UPDATE guard exists | enabled row trigger present |
| PASS | allocation snapshot BEFORE UPDATE guard exists | enabled row trigger present |
| PASS | receipt snapshot BEFORE UPDATE guard exists | enabled row trigger present |
| PASS | subscription financial-amount snapshot BEFORE UPDATE guard exists | enabled row trigger present |
| PASS | payroll audit append-only BEFORE UPDATE guard exists | enabled row trigger present |
| PASS | payslip snapshot BEFORE UPDATE guard exists | enabled row trigger present |
| PASS | student subscription allocation snapshot BEFORE UPDATE guard exists | enabled row trigger present |
| PASS | School branding logo permits only one current version per school | SQLSTATE 23505 |
| PASS | Staff NFC subscription employee-term uniqueness | SQLSTATE 23505 |
| PASS | Student subscription payment provider reference unique key | SQLSTATE 23505 |
| PASS | Student subscription payment provider transaction unique key | SQLSTATE 23505 |
| PASS | Student subscription payment idempotency unique key | SQLSTATE 23505 |
| PASS | Student subscription payment cross-school FK | SQLSTATE 23503 |
| PASS | Student subscription one-open-attempt partial unique key | SQLSTATE 23505 |
| PASS | Student subscription business term rejects a second PENDING payment on a different subscription | SQLSTATE 23505 from student_subscription_payments_one_business_term_uq |
| PASS | Student subscription business term rejects a second PAID payment on a different subscription | SQLSTATE 23505 from student_subscription_payments_one_business_term_uq |
| PASS | Student subscription business term rejects a second uncertain payment on a different subscription | SQLSTATE 23505 from student_subscription_payments_one_business_term_uq |
| PASS | Student subscription business term rejects a failed payment still requiring reconciliation | SQLSTATE 23505 from student_subscription_payments_one_business_term_uq |
| PASS | Student subscription allocation global idempotency unique key | SQLSTATE 23505 |
| PASS | Staff NFC subscription cross-school academic-period FK | SQLSTATE 23503 |
| PASS | Staff NFC subscription allocation-total CHECK | SQLSTATE 23514 |
| PASS | Staff NFC payment provider reference unique key | SQLSTATE 23505 |
| PASS | Staff NFC provider transaction unique key | SQLSTATE 23505 |
| PASS | Staff NFC provider event receipt unique key | SQLSTATE 23505 |
| PASS | Staff NFC receipt number unique key | SQLSTATE 23505 |
| PASS | Staff NFC refund idempotency unique key | SQLSTATE 23505 |
| PASS | Staff NFC provider refund ID unique key | SQLSTATE 23505 |
| PASS | Staff NFC commission subscription unique key | SQLSTATE 23505 |
| PASS | Employee NFC one-current-binding unique key | SQLSTATE 23505 |
| PASS | Employee NFC card/employee cross-school FK | SQLSTATE 23503 |
| PASS | Transport normalized duplicate bus registration unique key | SQLSTATE 23505 |
| PASS | Transport bus capacity CHECK | SQLSTATE 23514 |
| PASS | Transport assignment route cross-school FK | SQLSTATE 23503 |
| PASS | Payroll school-profile employee cross-school FK | SQLSTATE 23503 |
| PASS | Payroll school/company tenant scope CHECK | SQLSTATE 23514 |
| PASS | Existing student subscription PENDING/FAILED payment pair remains valid | 41001 PENDING and 41002 FAILED share the business term |
| PASS | Definitive FAILED student payment permits a same-term retry | transactional probe succeeded and rolled back |
| PASS | Student subscription payment on a different business term remains allowed | transactional probe succeeded and rolled back |
| PASS | School logo fixture retains an archived version and one current version | two versions, exactly one current |
| PASS | School logo promotion preserves previous versions | two archived versions and one current version remain |
| PASS | Staff NFC credit allocations balance to immutable subscription price | 200000 minor units |
| PASS | Student subscription credit allocations balance to provider gross amount | 500000 minor units |
| PASS | Payroll company-scope employee profile accepts null school and platform employee | scope/owner aligned |
| PASS | staff_nfc_billing_rules UPDATE rejected by immutable trigger | immutable trigger rejected UPDATE |
| PASS | staff_nfc_allocations UPDATE rejected by immutable trigger | immutable trigger rejected UPDATE |
| PASS | staff_nfc_receipts UPDATE rejected by immutable trigger | immutable trigger rejected UPDATE |
| PASS | settlement_payroll_audit_events UPDATE rejected by immutable trigger | immutable trigger rejected UPDATE |
| PASS | payroll_payslips UPDATE rejected by immutable trigger | immutable trigger rejected UPDATE |
| PASS | student_subscription_allocations UPDATE rejected by immutable trigger | immutable trigger rejected UPDATE |
| PASS | Staff NFC status and verified payment metadata may advance without changing subscription snapshots | subscription status and payment verification fields updated |
| PASS | Staff NFC subscription rejects financial snapshot price change | immutable trigger rejected UPDATE |
| PASS | Staff NFC subscription rejects financial snapshot school share change | immutable trigger rejected UPDATE |
| PASS | Staff NFC subscription rejects financial snapshot platform share change | immutable trigger rejected UPDATE |
| PASS | Staff NFC subscription rejects financial snapshot billing rule ID change | immutable trigger rejected UPDATE |
| PASS | Staff NFC subscription rejects financial snapshot billing rule version change | immutable trigger rejected UPDATE |
| PASS | Staff NFC subscription rejects financial snapshot school identity change | immutable trigger rejected UPDATE |
| PASS | Staff NFC subscription rejects financial snapshot employee identity change | immutable trigger rejected UPDATE |
| PASS | Staff NFC subscription rejects financial snapshot academic session identity change | immutable trigger rejected UPDATE |
| PASS | Staff NFC subscription rejects financial snapshot academic term identity change | immutable trigger rejected UPDATE |
| PASS | New and existing public FKs have no cascading/automatic delete action | {"RESTRICT":117,"NO ACTION":17} |
| PASS | billing-rule snapshot BEFORE UPDATE guard exists | enabled row trigger present |
| PASS | allocation snapshot BEFORE UPDATE guard exists | enabled row trigger present |
| PASS | receipt snapshot BEFORE UPDATE guard exists | enabled row trigger present |
| PASS | subscription financial-amount snapshot BEFORE UPDATE guard exists | enabled row trigger present |
| PASS | payroll audit append-only BEFORE UPDATE guard exists | enabled row trigger present |
| PASS | payslip snapshot BEFORE UPDATE guard exists | enabled row trigger present |
| PASS | student subscription allocation snapshot BEFORE UPDATE guard exists | enabled row trigger present |
| PASS | School branding logo permits only one current version per school | SQLSTATE 23505 |
| PASS | Staff NFC subscription employee-term uniqueness | SQLSTATE 23505 |
| PASS | Student subscription payment provider reference unique key | SQLSTATE 23505 |
| PASS | Student subscription payment provider transaction unique key | SQLSTATE 23505 |
| PASS | Student subscription payment idempotency unique key | SQLSTATE 23505 |
| PASS | Student subscription payment cross-school FK | SQLSTATE 23503 |
| PASS | Student subscription one-open-attempt partial unique key | SQLSTATE 23505 |
| PASS | Student subscription business term rejects a second PENDING payment on a different subscription | SQLSTATE 23505 from student_subscription_payments_one_business_term_uq |
| PASS | Student subscription business term rejects a second PAID payment on a different subscription | SQLSTATE 23505 from student_subscription_payments_one_business_term_uq |
| PASS | Student subscription business term rejects a second uncertain payment on a different subscription | SQLSTATE 23505 from student_subscription_payments_one_business_term_uq |
| PASS | Student subscription business term rejects a failed payment still requiring reconciliation | SQLSTATE 23505 from student_subscription_payments_one_business_term_uq |
| PASS | Student subscription allocation global idempotency unique key | SQLSTATE 23505 |
| PASS | Staff NFC subscription cross-school academic-period FK | SQLSTATE 23503 |
| PASS | Staff NFC subscription allocation-total CHECK | SQLSTATE 23514 |
| PASS | Staff NFC payment provider reference unique key | SQLSTATE 23505 |
| PASS | Staff NFC provider transaction unique key | SQLSTATE 23505 |
| PASS | Staff NFC provider event receipt unique key | SQLSTATE 23505 |
| PASS | Staff NFC receipt number unique key | SQLSTATE 23505 |
| PASS | Staff NFC refund idempotency unique key | SQLSTATE 23505 |
| PASS | Staff NFC provider refund ID unique key | SQLSTATE 23505 |
| PASS | Staff NFC commission subscription unique key | SQLSTATE 23505 |
| PASS | Employee NFC one-current-binding unique key | SQLSTATE 23505 |
| PASS | Employee NFC card/employee cross-school FK | SQLSTATE 23503 |
| PASS | Transport normalized duplicate bus registration unique key | SQLSTATE 23505 |
| PASS | Transport bus capacity CHECK | SQLSTATE 23514 |
| PASS | Transport assignment route cross-school FK | SQLSTATE 23503 |
| PASS | Payroll school-profile employee cross-school FK | SQLSTATE 23503 |
| PASS | Payroll school/company tenant scope CHECK | SQLSTATE 23514 |
| PASS | Existing student subscription PENDING/FAILED payment pair remains valid | 41001 PENDING and 41002 FAILED share the business term |
| PASS | Definitive FAILED student payment permits a same-term retry | transactional probe succeeded and rolled back |
| PASS | Student subscription payment on a different business term remains allowed | transactional probe succeeded and rolled back |
| PASS | School logo fixture retains an archived version and one current version | two versions, exactly one current |
| PASS | School logo promotion preserves previous versions | two archived versions and one current version remain |
| PASS | Staff NFC credit allocations balance to immutable subscription price | 200000 minor units |
| PASS | Student subscription credit allocations balance to provider gross amount | 500000 minor units |
| PASS | Payroll company-scope employee profile accepts null school and platform employee | scope/owner aligned |
| PASS | staff_nfc_billing_rules UPDATE rejected by immutable trigger | immutable trigger rejected UPDATE |
| PASS | staff_nfc_allocations UPDATE rejected by immutable trigger | immutable trigger rejected UPDATE |
| PASS | staff_nfc_receipts UPDATE rejected by immutable trigger | immutable trigger rejected UPDATE |
| PASS | settlement_payroll_audit_events UPDATE rejected by immutable trigger | immutable trigger rejected UPDATE |
| PASS | payroll_payslips UPDATE rejected by immutable trigger | immutable trigger rejected UPDATE |
| PASS | student_subscription_allocations UPDATE rejected by immutable trigger | immutable trigger rejected UPDATE |
| PASS | Staff NFC status and verified payment metadata may advance without changing subscription snapshots | subscription status and payment verification fields updated |
| PASS | Staff NFC subscription rejects financial snapshot price change | immutable trigger rejected UPDATE |
| PASS | Staff NFC subscription rejects financial snapshot school share change | immutable trigger rejected UPDATE |
| PASS | Staff NFC subscription rejects financial snapshot platform share change | immutable trigger rejected UPDATE |
| PASS | Staff NFC subscription rejects financial snapshot billing rule ID change | immutable trigger rejected UPDATE |
| PASS | Staff NFC subscription rejects financial snapshot billing rule version change | immutable trigger rejected UPDATE |
| PASS | Staff NFC subscription rejects financial snapshot school identity change | immutable trigger rejected UPDATE |
| PASS | Staff NFC subscription rejects financial snapshot employee identity change | immutable trigger rejected UPDATE |
| PASS | Staff NFC subscription rejects financial snapshot academic session identity change | immutable trigger rejected UPDATE |
| PASS | Staff NFC subscription rejects financial snapshot academic term identity change | immutable trigger rejected UPDATE |
| PASS | New and existing public FKs have no cascading/automatic delete action | {"RESTRICT":117,"NO ACTION":17} |
| PASS | All selected feedback migrations roll back atomically after forced SQL error | PASS — forced division-by-zero SQLSTATE 22012 rolled back all new DDL and seed data |

## Overall

All scripted isolated checks passed.

This rehearsal is not authorization to apply migrations. Main-agent/operator review and a separately approved Development-only atomic apply remain required.
