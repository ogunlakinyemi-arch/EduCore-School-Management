# Consolidated Development financial work — partial, inactive implementation

## Result and boundaries

This is **not full operational completion** of the requested payment feature.
It supplies transaction-tested service candidates for direct refunds and current
BRO lifecycle management, a review-only bulk planner and two targeted protections
in existing writers. There are no new routed payment endpoints or screens.
Provider evidence ports have no default HTTP implementation. No existing LIVE,
merchant, financial-rule, free-launch or January/calendar gate was opened.

Baseline evidence reused: documented 418 financial tests and 12 native checks,
71 additional focused tests, and 124 Safe Restart tests. These remain historical
baseline evidence, not a claim that every baseline suite was rerun on this source.
Only the affected three accrual regressions were rerun; new focused checks cover
the actual retained manual-payout writer without an HTTP listener.

## Implementation by stage

1. **Direct refunds/adverse events — service candidate implemented.** Immutable
   requests, separate Owner approval, a permanent pre-POST claim, explicit unknown
   outcomes, no automatic resend, independent evidence binding, partial/full
   cumulative limits, pending/failure/success/refund-reversal handling and
   replay/out-of-order protection. Original PAID records are never edited.
   Verified collection reversals are distinct from reversals of a refund.
   Overlapping refund/collection-reversal outflows are recorded and exposed for
   recovery review, not hidden by a negative balance or an invented refund.
2. **Individual current BRO lifecycle — service candidate implemented.** Individual
   Owner approval after the retained term-end review boundary; exact ₦150 separate
   expense; frozen verified registered-person bank evidence; pending, verified
   paid, failed and reversed payout outcomes; idempotent recovery evidence and
   recovery caps. Approval/initiation does not book bank credit. The bank adapter
   reuses existing verification and requires the existing partner-cipher decrypt
   helper; it does not perform a bank lookup.
3. **Bulk — review-only planning implemented, collection NOT implemented.**
   Database-authoritative role/school checks, one school/term, rollout eligibility,
   exclusion of occupied/legacy obligations, canonical multi-student snapshots,
   amounts/rule evidence and idempotency are tested. Plans do not reserve payments,
   create obligations, issue receipts or contact a payment provider.
4. **Bulk allocation recovery, receipts, refunds and reconciliation — NOT
   implemented.** No collection is accepted without these protections.
5. **Verification — passed for the implemented portion**, detailed below.

Pending refunds/adverse signals hold current BRO approval/release even before an
entitlement exists. An already paid BRO remains recorded as paid; confirmed
adverse money movement creates recovery-review exposure. Failed/reversed refund
evidence does not silently restore an older approval. Partial-refund commission
proration, automatic recovery debt assessment and hold-release/access policies
were not specified sufficiently to invent: the implementation retains review,
does not debit anyone and accepts recovery only from independent evidence.

Ordinary school fee invoices, academic access/lock policies and the existing
legacy BRO dashboard/receipt readers were not rewritten. The new Owner accounting
review functions expose current states separately; connecting those projections
to existing UI/readers is still required before activation.

## Verification and acceptance traceability

| Check | Result |
|---|---|
| New disposable PostgreSQL service suite | 55 distinct tests passed across the full run and targeted final run |
| New retained manual-writer guard tests, in memory | 3 passed |
| Affected existing verified-accrual regressions | 3 passed |
| Distinct tests total | **61 passed; no unresolved failures** |
| Focused API TypeScript check | Passed |
| Complete API build into disposable output | Passed; no bundle executed |
| Five candidate service entry builds | Passed; no bundle executed |
| Tracked and newly created file whitespace checks | Passed |

The initial coherent run passed 54 PostgreSQL tests plus 6 other tests. A final
targeted run passed 5 PostgreSQL tests after the reviewing-Owner audit correction,
including one added test. Four were repeats; 50 were excluded by that selector,
not failed or newly omitted acceptance tests. Initial fixture amount/literal-type
errors were corrected. Do not add repeated executions to the distinct total.

The fixture applied candidate 0181 over the real existing 0175–0178 migrations
inside a new Unix-socket-only disposable cluster and exercised actual service
transactions, existing catalog guards, competing refund/payout requests, journal
immutability and historical-value retention. No HTTP listener was started.
Provider ports were fake functions. The pre-accrual denial test used a fixed
future SQL clock only inside its disposable client to match the fictional 2027
payment/calendar evidence.

Commands, run in clean child environments:

    pnpm --filter @workspace/api-server exec vitest run \
      src/services/current-financial-lifecycle.postgres.test.ts \
      src/services/current-reference-legacy-guard.test.ts \
      src/services/verified-subscription-bro-accrual.test.ts
    pnpm --filter @workspace/api-server exec vitest run \
      src/services/current-financial-lifecycle.postgres.test.ts \
      -t 'C32|C48|C30|C38|actual reviewing Owner'
    pnpm --filter @workspace/api-server run typecheck

Build checks called existing `buildAll()` with a fresh temporary output directory
and esbuild for the five candidate entries. Temporary build output and fictional
database clusters were removed. Shared `dist` output was not replaced.

### Numbered contract limitation

The referenced preceding **65-point specification was not supplied in the visible
context or located in the workspace**. Accordingly, an honest original-case
pass/fail count is unavailable. The following C numbers are a local mapping from
the explicit latest instruction, also used by test names—not invented quotations
or a claim to have certified the missing original contract:

| Local IDs | Explicit requirement and status |
|---|---|
| C01–C03 | Current verified source, legacy exclusion, fresh Owner authority: tested |
| C04–C07, C26 | Request identity, conflict and concurrent cumulative limits: tested |
| C08–C13 | Approval, permanent dispatch claim, uncertain/pending outcomes: tested |
| C14–C21 | Independent binding, replay, reversal and delayed signals: tested |
| C22–C25 | Original-evidence hold, unresolved review, immutable history: tested |
| C27–C31 | Before-accrual/pending/approved/paid adverse handling and failure: tested |
| C32–C36 | Individual ₦150 approval, term-end/source/active-BRO checks: tested |
| C37–C42 | Verified/frozen bank, pending initiation, uniqueness and binding: tested |
| C43–C49 | Failure/pending/reversal, duplicate reference, recovery: tested |
| C50 | Historical ₦5,000/₦100 and separate ₦2,000 staff preservation: tested |
| C51–C59 | Role/school/term/eligibility/immutable-selection controls: tested for REVIEW-ONLY planning, not operational batch checkout |
| C60 | Single aggregate provider collection: omitted; source-contract blocker below |
| C61 | Exactly-once child allocation and individual payment receipts: omitted |
| C62 | Durable retry of unresolved allocations, no second charge: omitted |
| C63 | Bulk-source individual pending BRO accrual: omitted |
| C64 | Student-specific batch refunds preserving unaffected students: omitted |
| C65 | Consolidated receipt and operational batch reconciliation: omitted |

No original 65-case completion percentage is claimed. No browser, shared-runtime,
real provider or real bank acceptance was performed.

## Exact blockers and minimal remaining build

1. The retained BRO root requires a paid direct attempt. Direct attempts require
   unique provider transaction IDs, and their terminal evidence is immutable.
   Copying an aggregate transaction across children, synthesizing child provider
   IDs or bypassing the strict old guards would violate existing protections.
   A separately compatible aggregate-allocation source contract, its pinned
   readiness/eligibility guards and every affected accrual/accounting reader must
   be implemented and tested before batch collection.
2. Add durable batch/obligation claims shared by individual and aggregate
   initiation, a frozen aggregate reference, one approved provider checkout and
   independent aggregate verification. Persist aggregate success before recoverable
   exactly-once child posting, then child receipts, individual BRO source evidence,
   consolidated receipts and student-specific refund reconciliation.
3. No approved, independently verifiable current refund/reversal or payout/
   recovery transport contract was established under the no-external-request
   restriction. The injected ports are deliberate capability gates, not simulated
   LIVE implementations. Connect reviewed provider/bank evidence adapters and
   actual authenticated handlers; do not convert request-body claims into proof.
4. Complete the current subledger/receipt UI, existing-reader integration and
   permission-bound receipt access. Current candidates are not exposed as new
   routes; no frontend build or authenticated browser acceptance is claimed.
5. Complete ORM/schema-delivery integration for the candidate tables before any
   future shared application. 0181 is not registered as an automatic startup,
   migration-runner or Publish action. The previously documented procedural
   delivery/retention blocker is unchanged; application serialization is not an
   all-writer SQL/ACL guarantee.
6. Obtain the original numbered acceptance contract for exact traceability;
   unresolved hold-restoration/access and recovery-amount policy must not be
   silently invented. No follow-up question or default policy was imposed here.

## Exact file manifest

Modified:

- `artifacts/api-server/src/services/bro-commission-policy.ts`
- `artifacts/api-server/src/services/partner-payout-update.ts`
- `.agents/memory/subscription-business-policy.md` — approved product boundaries only.

Added under `artifacts/api-server/src/services/`:

- `current-financial-contract.ts`
- `current-financial-store.ts`
- `current-student-refunds.ts`
- `current-bro-lifecycle.ts`
- `current-bro-bank.ts`
- `current-financial-read-model.ts`
- `current-bulk-subscription-plan.ts`
- `current-financial-fixture.test-support.ts`
- `current-financial-lifecycle.postgres.test.ts`
- `current-reference-legacy-guard.test.ts`

Other additions:

- `lib/db/drizzle/0181_current_subscription_lifecycle.sql`
- `docs/current-payment-completion-checklist.md`
- `docs/current-payment-completion-report.md`

## Activation hold

0181 was applied **only to disposable fictional fixtures**, never shared
Development or Production. No shared data/schema, secrets, settings, environment,
provider configuration, storage, identity or deployment change was made. No real
HTTP/network operation, payment, refund, transfer, bank verification, message or
notification was performed. No shared process was restarted, no Safe Restart Mode
was activated, no preview was activated and nothing was published/deployed.

The implementation is inactive and incomplete as an end-to-end feature. This
report does not request or imply activation. Separate approval remains required
for any shared migration, restart, preview, Safe Restart, publication or deployment.
