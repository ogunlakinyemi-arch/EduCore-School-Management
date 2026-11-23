# Focused Development financial stabilisation

## Execution boundary

Source changes and credential-free, fictional disposable PostgreSQL tests only.
No shared Development or Production database migration, existing-data mutation,
provider request, notification send, setting change or publication is authorised
by these files. Existing LIVE readiness/configuration gates remain unchanged.

## Allocation and transactions

`allocate_verified_fee_lines()` remains the sole fee-line allocation writer.
Cash no longer repeats its INSERTs. Cash, bank verification and provider
settlement require its enabled public trigger binding before making a payment
VERIFIED. Missing protection fails the transaction rather than returning an
apparently successful, unallocated payment. The binding check is not full
function-body certification.

Participating financial transactions acquire the same global transaction-scoped
advisory gate immediately after BEGIN, before domain locks or writes. This covers
fee route transactions, provider settlement/admin reconciliation, student
subscription finalisation, hosted history transactions, deferred approval/export,
signed adverse events, refunds including result/recovery writes, manual payout
updates, independent BRO accrual, calendar edits and subscription enforcement.
Manual fee verification/refunds and adjustment approval also lock the invoice
before its payment/child. Provider settlement and reconciliation explicitly
prelock invoice, payment and checkout in separate statements before joined reads;
they do not rely on the planner's internal multi-table row-lock order.

The global scope is deliberate: a commission batch can cross schools/payments.
It trades write concurrency for a small, auditable application-path correction.
Provider network requests remain outside the initiating/result transactions.
No active writer may hold a row lock and then enter a gated transaction on
another connection. New financial writers must acquire the gate first.

Approval/export prelock the complete existing payout group, in explicit sorted
payment, split, subscription, session, term, Partner and ledger statements.
Eligibility is reread afterward. Export rejects NULL eligibility, a term that no
longer ended, a missing/mismatched payout link and a changed payout amount/status.
An adverse event holds the affected commission and blocks its grouped export;
unaffected sibling entitlements and immutable claims/history are not deleted,
repriced, released or silently reassigned. Regrouping an invalidated payout is a
separate reviewed workflow, not automatic recovery.

## Prepared split CHECK upgrade — not applied to shared databases

0180 adds and validates `flw_split_amounts_v3_ck` before dropping the old
`flw_split_amounts_ck`, in one bounded transaction. It has no row writes and retains
Legacy/SCV2/SCV3 amounts, references and recipient semantics. The Drizzle declaration
uses the new name; the historical reader accepts either name while enforcing its
existing version checks. Older migrations are unchanged.

Recovery plan: before any authorised shared Development application, capture the
exact old CHECK/catalog definition and a suitable database-inclusive checkpoint.
An incompatible row, timeout or pre-commit failure rolls back the whole candidate.
Never recover by imposing an older, narrower CHECK on newer rows. After a commit,
any reverse change needs the captured definition, compatibility validation and
separate approval; this task supplies no destructive downgrade.
The candidate is a one-time upgrade, not an unconditional startup/retry script.

Future Publish acceptance MUST visibly include DROP of the old CHECK and ADD of
the new CHECK with the reviewed full expression. A rename prompt, empty diff or
matching name alone is not acceptance. No Publish preview has been generated or
approved by this implementation, and merely adding this file does not update the
Development database or establish what Publish will emit.

## Release blockers and guarantees not claimed

- Replit Support confirms Publish does not transfer custom functions/triggers or
  non-public schemas. The retained allocation and financial-history guards still
  require an evidenced supported delivery/retention mechanism. None is invented.
- The application gate is not an ACL or SQL firewall. Privileged/direct SQL,
  external writers and unconverted application writers can bypass it; it cannot
  replace database-enforced immutability, cross-table eligibility or serialization.
  Existing database guards are neither removed nor weakened.
- This is not restoration/certification of the 31-function/43-trigger package.
  No trigger-body upgrade is applied; old direct-SQL invalidation limitations
  remain a release blocker outside the participating application protocol.
- Current independent BRO entitlements retain their existing rules, uniqueness,
  policy locks and database-readiness requirements. Historical split commissions
  do not establish current subscription payment or a new entitlement.
- Existing Owner/role/tenant checks, uncertain-provider-outcome reconciliation,
  receipts, audit and current LIVE gates remain mandatory.
- Production needs its own explicit approval, authoritative serving-primary
  binding, actual-role privilege checks, current resource-bound recovery evidence,
  supported schema/procedural delivery and verified retained-record acceptance.
  Passing disposable tests does not satisfy those gates.

## Changed-file manifest

New API service files, under `artifacts/api-server/src/services/`:

- `financial-transaction.ts`
- `financial-transaction.test.ts`
- `fee-payment-locks.ts`
- `deferred-commission-locks.ts`

Modified API source files, under `artifacts/api-server/src/`:

- `lib/student-subscription-billing.ts`
- `routes/academic.ts`
- `routes/fee-provider-webhooks.ts`
- `routes/finance.ts`
- `routes/partners.ts`
- `routes/student-subscription-webhooks.ts`
- `services/bro-commission-policy.ts`
- `services/deferred-commission-adverse-events.ts`
- `services/deferred-partner-commissions.ts`
- `services/direct-student-live-payments.ts`
- `services/direct-student-live-release.ts`
- `services/flutterwave-split-checkout.ts`
- `services/flutterwave-split-refunds.ts`
- `services/hosted-payment-store.ts`
- `services/partner-payout-update.ts`
- `services/subscription-enforcement.ts`

Modified API tests, under `artifacts/api-server/src/`:

- `routes/fee-provider-checkout-safety.test.ts`
- `routes/fee-provider-currency-mismatch.test.ts`
- `routes/fee-provider-webhooks.test.ts`
- `routes/finance-adjustments.test.ts`
- `routes/finance-bank-transfer.test.ts`
- `routes/finance-cash.postgres.test.ts`
- `routes/finance-history.test.ts`
- `routes/finance-provider-checkout.test.ts`
- `routes/finance-refunds.test.ts`
- `routes/partner-commission-feeds.test.ts`
- `services/deferred-partner-commissions.postgres.test.ts`

Other files:

- `lib/db/src/schema/flutterwave-splits.ts` — renamed CHECK declaration only.
- `lib/db/drizzle/0180_version_split_amounts_check.sql` — new un-applied candidate.
- `.agents/memory/development-database-targeting.md` — Support-confirmed workspace
  targeting rule; no environment or credential change.
- `docs/development-financial-stabilisation.md` — this implementation/release note.

## Runtime activation boundary

The shared API was not restarted: normal startup invokes the enabled Telegram
worker before the existing Development-worker pause. Restarting could therefore
perform external communication, which this task forbids. Isolated HTTP/SQL tests
exercise the changed handlers without using that startup path. A controlled
no-send Development restart remains necessary before these changes can be claimed
active in the shared preview. No worker or provider configuration was changed.

## Verification performed

Passing results were assembled from focused runs and targeted reruns, not a
single full-repository test run:

| Coverage | Passing tests/checks |
| --- | ---: |
| Core payment, subscription, allocation-boundary, webhook, refund, adjustment, split and permission regression tests | 294 |
| Additional invoice creation/eligibility, publication, assignment, currency and historical-feed regressions | 55 |
| Real isolated PostgreSQL cash, bank retry/cash competition, refund replay and lock-order HTTP/SQL tests | 27 |
| Real isolated deferred-commission PostgreSQL tests, including deterministic two-order adverse/approval races and CHECK upgrade/failure rollback | 42 |
| Independent current BRO native PostgreSQL checks | 12 |

The targeted follow-up to the payout-eligibility display change also passed.
Library type checks, API type check, local API build and `git diff --check`
passed. Initial runs found missing SQL-mock support, stale bank/history fixtures
and incorrect fixture audit assertions; the affected tests were corrected and
rerun successfully. The build used a clean compiler environment and did not start
a Production application or connect to a Production database.

All PostgreSQL mutations occurred in fictional disposable clusters. No shared
Development/Production SQL was executed. No real provider transport was used.
The public Development sign-in page rendered; this was not authenticated browser
acceptance of the changed financial flows.
