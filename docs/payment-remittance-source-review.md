# Aggregate remittance and payment recovery — source review

## Status and authorization

This is **review-only source**, not an operational release. No application
database connection was used for development or verification, no migration was applied, no account or credential
was changed, and no provider collection/refund/transfer was performed.
Nothing has been enabled, published, merged or pushed.

The implementation keeps the existing ₦3,200 per-student/per-term price,
Flutterwave checkout and verification boundaries, saved school calendars,
free-term grants and separate ₦150 eligible BRO liability. It does not revive
the retired split/subaccount collection model.

## Five corrections

1. **Aggregate school remittance.** One immutable company-bank request reserves
   distinct active/admitted students in one school's eligible term. Its
   amount is exactly count × ₦3,200. The current, independently verified
   company receiving account is read through the existing account workflow.
   Only Owner verification of a matching exact bank credit records payment
   proof; a second explicit Owner step posts each student allocation.
   Partial posting can recover without posting a student twice.
   Uncredited cancellation/rejection retains request/allocation/audit history
   and adds checked release evidence rather than deleting financial rows.
   Credited requests cannot be cancelled or released.
2. **Refund/access policy.** Direct and aggregate access, school enforcement
   and NFC payment readers require positive remaining verified payment.
   Partial refunds retain access; full refunds/reversals remove the paid
   entitlement. BRO adverse holds remain independent. Receipts retain the
   original amount and show current refunded/reversed/net accounting.
3. **BRO isolation.** Allocation posting precedes a savepoint-protected
   commission-accrual attempt. SQL or policy failure rolls back only accrual
   work, records a pending-accrual event and leaves the student's payment
   posted. Owner can retry accrual without charging or duplicating earnings.
4. **Safe no-charge retry.** A failed Flutterwave batch retains its student
   reservations. A new immutable checkout attempt requires a fresh server GET
   proving a retained transaction is terminal failed/cancelled with exactly
   zero charged. A permanent dispatch claim precedes the POST. Replaying the
   same key does not dispatch again. UNKNOWN, timeouts, client assertions and
   stale earlier-attempt callbacks cannot authorize another checkout.
5. **UI and receipts.** School/Owner finance pages expose aggregate requests,
   account instructions, Owner credit checking, explicit posting, safe closure,
   per-student recovery and receipts. Owner-only BRO retry details are withheld
   from schools. Historical REQUESTED assistance cases expose their existing
   checkout route and a guarded Owner cancellation option.

## Historical and capability boundaries

- Retained single-student assistance receipts are not automatically converted,
  reused or relabelled as new bank-payment proof.
- Bank references are normalized and checked against retained credited
  assistance records; guards serialize credit-reference use in both directions.
- Bank receipts never receive fabricated Flutterwave transaction IDs.
- No bank refunds are sent or confirmed by this implementation. The provider
  refund entry point explicitly rejects bank allocations; the UI labels that
  capability unavailable. Independent manual bank-refund reconciliation needs
  its own supported evidence process.
- Collection reversal and BRO recovery remain unavailable without their
  independent server-bound evidence adapters. Request-body claims do not
  substitute for those adapters.
- Application checks are not a promise that a privileged database administrator
  cannot bypass them. Existing procedural-readiness checks remain required.

## Schema review

`0185_company_bank_remittance_recovery.sql` is a new, unapplied candidate.
It adds bank-credit proof, allocation-release evidence and checkout-attempt
history, plus a uniquely keyed active-reservation index. It changes allocation
review nullability only for the bank branch and moves unconditional reservation
uniqueness to that native index. Allocation/release triggers alone maintain the
index, including under repeatable-read concurrency; a query/advisory lock alone
does not replace the unique key. Existing Flutterwave review binding remains required.
The source populates only index entries from retained allocations under a table
lock; it does not update, seed or transform historical financial records.

Review the reservation replacement and trigger behavior with particular care.
Structural export or a successful TypeScript build does **not** establish that
these SQL functions/triggers behave correctly on PostgreSQL. The existing
offline metadata contract reader now understands the reviewed constraint drop
and nullability change; its test source includes the four new tables.

## Verification performed

- Credential-free API generation and shared-library TypeScript build passed.
- Credential-free API-server TypeScript check passed.
- Credential-free web TypeScript check passed.
- No runtime or browser verification is claimed. No app workflow was restarted
  and no running app was requested for a screenshot, because that could query
  an application database or start scheduled work.

## Unexecuted regression source and hard blockers

The dedicated test configuration is
`artifacts/api-server/vitest.bank-remittance-isolated.config.ts`.
Its pre-collection guard requires a distinct no-egress Linux network namespace,
no external interfaces/routes, and no inherited application credentials.
The test also refuses to start its PostgreSQL fixture in the ordinary namespace.
There is no app-database or network-stub fallback.

The no-egress namespace check failed in this environment with
`Operation not permitted`. Therefore **no tests were executed**.

The native fixture additionally refuses to fake PostgreSQL's clock, rewrite
the reviewed SQL, or broaden its saved January-2027 second term. Its JavaScript
and PostgreSQL clocks must match within that fixture term. This workspace's
November-2026 clock does not meet that precondition either; an authorized
isolated lab with an appropriately controlled clock is needed.

Regression source covers unpaid requests, Owner-only exact credit checking,
posting, duplicate-credit rejection, cancellation/release history, partial-allocation
recovery, commission SQL failure/retry, partial/full
refund reads for direct/bulk payments, UNKNOWN no-resend, fresh no-charge retry,
idempotent retries, stale callback handling and legacy cancellation boundaries.
These are authored cases, **not passing-test claims**.

Before any release, run the isolated native suite and offline schema contract
checks in the approved lab, then review routed School/Owner behavior there.
Application migrations and operational activation still need separate approval.

## Focused follow-up review

This follow-up changed only these four source/document files:

- `lib/db/drizzle/0185_company_bank_remittance_recovery.sql`
- `artifacts/api-server/src/services/company-bank-remittances.ts`
- `artifacts/api-server/src/services/company-bank-remittances.isolated.postgres.test.ts`
- `docs/payment-remittance-source-review.md`

### Concurrent reservation regression source

Four parameterized native cases cover READ COMMITTED and REPEATABLE READ, with
each of two independent connections taking the winning role. Each establishes
both transaction snapshots before the first allocation INSERT. The first writer
inserts without committing; the second attempts the same student/term in a
different batch. An observer checks `pg_blocking_pids` before allowing the winner
to commit. The cases then require one retained allocation/claim and no losing
allocation. They bypass the global application transaction gate deliberately.

The expected READ COMMITTED rejection is the reservation guard (`P0001`).
Under REPEATABLE READ the stale guard SELECT cannot see the committed winner;
the native primary key on `current_bulk_term_claims` must reject with `23505`.
These are test assertions, **not observed PostgreSQL results**.

### Direct checkout coordination

Inspected `direct-student-live-payments.ts`: its transaction takes the global
financial gate and school lock, then
`pg_advisory_xact_lock(hashtextextended($1,0))` with
`direct-student:${schoolId}:${studentId}:${termId}`. Both bulk creation services
use that identical string and seed. The new allocation trigger constructs the
same key from `NEW.school_id`, `NEW.student_id`, `NEW.academic_term_id`.
No direct checkout or advisory-key change was necessary. Advisory coordination
does not replace the native bulk uniqueness protection under REPEATABLE READ.

### Actual bank-credit day must belong to the saved term

The intended collection workflow is restricted to the school's saved eligible,
open term, not retrospective payment reconciliation. Accordingly, the actual
statement credit date must fall **between term start and term end, inclusive**,
and must not be in the future. A post-term credit is rejected rather than
silently applied to that term or moved to another term. This does not add a
late-credit reconciliation feature or relax the existing open-term rollout gate.

The service now reports `BANK_CREDIT_OUTSIDE_ACADEMIC_TERM` for out-of-range new
credits. The SQL guard enforces the same inclusive range and school ownership;
previously it checked only term start. Existing immutable proof/idempotent replay
is not retrospectively reclassified. Also removed the stray `any-bank` prefix
already present before this review, which made the candidate's opening comment
invalid SQL.

Four native cases use a separate historical fictional term, without changing
the existing January fixture term or either clock. They test the day before,
start date, end date and day after; the invalid dates also exercise the service.
The historical fixture checks the SQL date boundary, not eligibility to collect
late through the service.

### Refund evidence trace

- Direct ordinary access: `student-platform-access.ts` requires the strict
  `positiveDirectStudentIds` evidence in addition to its existing direct read.
- Aggregate access: `current-bulk-payment-evidence.ts` requires bank/provider
  proof, active allocation and its exactly-once POSTED event, then net payment.
- School enforcement: `subscription-enforcement.ts` uses both of those shared
  student-ID readers when setting paid status.
- NFC: `student-nfc-payment-evidence.ts` uses those same shared readers, retaining
  its additional current-school/calendar/student requirements.
- Both shared readers call `retainsPaidAccess` in `current-payment-evidence.ts`,
  which calls `refundAmounts` in `current-financial-store.ts`. Direct evidence is
  keyed by attempt ID; aggregate evidence is keyed by allocation ID, not batch.

The calculation uses each immutable operation's latest event: only SUCCEEDED
refunds and SUCCEEDED collection reversals reduce the original 320000 minor
units. Net is `max(0, 320000 - refunded - reversed)`; positive net retains paid
entitlement, zero does not. Pending/failed operations do not remove access.
Refund reservation accounting remains separate, as do BRO adverse holds.
The pre-lifecycle compatibility branch is shared too: if the operations table
does not exist, the caller must still prove its original payment; that helper
alone does not establish entitlement.

Two additional native cases (REFUND and COLLECTION_REVERSAL) assert identical
direct/allocation accounting while pending, after partial success and after
full success. These fictional ledger fixtures do not authorize or implement bank
refund reconciliation. No reader inconsistency was found requiring a source
change in this follow-up.

### Additional verification status

- Credential-free API-server TypeScript check: **executed and passed**.
- `git diff --check`: **executed and passed**.
- The 10 newly parameterized native cases: **authored, not executed**.
- No application database, provider, runtime workflow or browser was accessed;
  no migration was applied, including to a disposable fixture in this follow-up.
- No isolation/clock requirements were relaxed. The previously reported
  namespace and clock blockers remain unresolved; no alternative test route was
  attempted. No deployment, publishing, push or merge was performed.
