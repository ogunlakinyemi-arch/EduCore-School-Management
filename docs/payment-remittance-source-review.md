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
