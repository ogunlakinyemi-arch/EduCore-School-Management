# Flutterwave deferred Partner commissions — Development review

**Final minimal Development pass (2026-10-21):** the standard offline
`export:schema:audit` command now produces correctly dependency-ordered SQL after
an explicit current-source ownership-guard correction. Historical UNIQUE INDEX
versus current UNIQUE constraint ownership remains recorded; **the same1,241 SQL
statements are preserved**. No schema declaration or historical migration changed.

Fresh acceptance: **25 export tests + 11 focused native PostgreSQL/HTTP tests
passed**, and API/scripts typechecks and diff checks passed. Added only one
ownership test and one combined lost-commit/duplicate-webhook/later-hold recovery
test. Reused the broader results below;58 non-selected native cases were
deliberately excluded from this small run. Runtime API/UI code did not change,
so no restart or repeated browser test was needed.

The final native pass verified full source-schema initialization and all four
LIVE drafts, unchanged multiset/order, recovery durability without false webhook
acknowledgement, holds and retained original evidence. See
[final recovery acceptance](flutterwave-live-workflow-review.md#final-export-and-operational-recovery-acceptance)
and [migration review](flutterwave-live-migration-review.md).

**External evidence remains unverified:** merchant/recipient reporting authority
and contract, transaction-linked school/main-merchant bank credits, actual costs/
taxes and the unexplained NGN5.25 discrepancy (**not VAT**), authenticated delivery
and actual refund/recovery evidence. Application-target inspection/migration
remains separately approval-gated. No disabled broad rollout is represented as
operationally accepted. All LIVE checkout, verification/refund transport, webhook
delivery and flags stay off; no provider call, money movement, application DB
query/migration, secret/dashboard, Production/Publish or publishing change.

Preserved: NGN5,000 payer charge; NGN1,900 school; NGN3,100 merchant gross before
costs/taxes; eligible NGN100 internal Partner accrual.

**Latest Development review (2026-10-21):** see
[target-schema and family contracts](flutterwave-live-workflow-review.md#target-schema-and-family-contracts-2026-10-21)
and [additive migration review](flutterwave-live-migration-review.md).
Current distinct acceptance is **268 API tests / 11 executed files** and
**55 frontend tests / seven files**;38 existing application-DB opt-in cases
remain skipped. The representative suite's cleanup-timeout correction and
successful eight-test rerun are recorded in both reviews. Actual LIVE
settlement is **UNVERIFIED** and release/transport/dashboard delivery remain off.
Older dated inventories below are historical, not fresh database/provider reads.

### Latest narrow scope and remaining gates

- Rehearsed all four migration drafts against disposable PostgreSQL initialized
  from the full **current source model**:184 tables,690 FKs,1,241 identical
  dependency-ordered statements. All14 LIVE tables,19 new FKs and40 LIVE indexes
  validated; ordering, duplicate-up refusal, empty reverse/reapply, retained-evidence
  rollback refusal and canonical/shared-history preservation passed.
- Raw source export execution still failed on supporting-key ordering. The
  generic guard's historical UNIQUE INDEX versus current UNIQUE constraint
  ownership discrepancy remains explicit; it was not bypassed for a target apply.
  A source-derived representative is not an inspected application catalog,
  historical dump or migration ledger. Actual-target verification, preservation/
  lock review and separately approved migrations remain required.
- Added authenticated family LIVE read and existing-banner contracts for pending,
  verified/active, failure reported, refunded/reversed protective hold and
  unavailable. Exact canonical own-child/parent/tenant/session/term matching,
  complete immutable proof and unexpired activation control entitlement. No
  receipt-only/pending/duplicate/incomplete record, TEST payment or shared waiver
  supplies verified LIVE access. Original receipts remain visible after holds.
- The explicit LIVE endpoint refuses503 while disabled, before any LIVE financial
  DB connection; normal authentication still applies.
  The ordinary family endpoint selects LIVE only through its hard-disabled
  server-owned selector. No browser scope/financial IDs or flag can enable it.
  Gated UI contracts are complete; broad operational checkout, waivers,
  isolated enforcement persistence and real signed-in LIVE acceptance are not.
- Codegen, API/frontend typechecks and diff checks passed; Development API
  rebuilt/restarted and public sign-in rendering was checked. No application
  database was queried/migrated and no provider request was made in this pass.
- No new bank evidence exists. The historical NGN5.25 discrepancy is still
  unexplained, **not VAT**. Exact transaction-linked school NGN1,900/main-merchant
  credits, actual fee/tax reconciliation, reviewed LIVE recipients, a real
  independent recipient reader and evidenced recovery/closure remain blockers.
  NGN5,000 payer charge, NGN1,900 school, NGN3,100 merchant gross before costs/
  taxes and eligible NGN100 internal Partner accrual remain unchanged.

All LIVE checkout/transport/delivery/release gates stay disabled. No payments,
refunds, transfers, secrets, dashboard, Production/Publish settings or publishing
were changed by this continuation.

## Status: NOT authorized or ready for live activation

**Latest coordinated Development-only review:** see
[LIVE workflow implementation and release blockers](flutterwave-live-workflow-review.md).
Earlier dated increments below remain historical evidence, not the current
implementation inventory or permission to enable LIVE operations.

No live checkout, live transfer, Production migration, Publish configuration,
key change or publishing is part of this implementation. Both SCV2 and SCV3
checkout remain blocked before provider transport. Adding credentials does not
remove these guards. Existing collection paths remain TEST-only; the separate
LIVE adapter described below is prepared but all its provider transport is blocked.

## New-payment policy

Only newly generated `SCV3_` references use deferred Partner commission.
Existing legacy and SCV2 references/snapshots keep their original policy.

- Payer: NGN 5,000 per student per school term.
- School: fixed NGN 1,900 through one reviewed school subaccount.
- Checkout instructions: exactly one `flat_subaccount` item with
  `transaction_charge: 1900`. No Partner subaccount or main-account subaccount.
- Main merchant receives the remaining transaction proceeds after actual
  provider expenses/taxes. With total evidenced costs of NGN 70, the calculated
  merchant remainder is NGN 3,030, whether or not there is an eligible Partner.
- Eligible Partner: NGN 100 accrued internally, not a checkout disbursement.
  In that example the Owner's economic net after the liability is NGN 2,930.
  Without an eligible Partner no liability is created, so Owner net is NGN 3,030.
- These calculations are not proof of merchant or school bank settlement.
  Missing fees remain unknown. Additional fees are **not** assumed to be VAT.

## Owner and Partner workflow

Owner: Partners → Term commissions & payouts. Review original-school evidence
grouped by Partner/session/term, select eligible rows, confirm once.
Every selected row must belong to an ended school term and a verified successful,
non-refunded/non-exception payment. The server rechecks this inside a transaction.
Different schools retain their own term IDs/end dates.

Approval creates an immutable selection snapshot and one payout record per
Partner, with an idempotency key and audit entry. Same-key retries replay the
existing batch; changed payloads and already-reserved rows are rejected.
Exports are audited, revalidated JSON recording instructions, not transfers.
They contain internal identifiers and amounts, not bank credentials.

There is intentionally no new transfer-execution endpoint. Deferred batches
cannot be manually marked Paid through the legacy payout editor. They remain
unpaid until a separately reviewed transfer-evidence reconciliation feature
exists. Approval is not proof of disbursement.

Partner finance-authorized users see only their own new-policy earned, pending,
approved, paid and recovery totals, separately from historical totals. Other
recipients' allocations remain Owner-only.

Refund requests, uncertain refund outcomes, refunds and collection exceptions
hold commissions and invalidate unexecuted approval/export batches. A signed
adverse webhook matches the independently verified Flutterwave reference or
exact application reference; webhook amounts never change entitlement or prove
a completed refund. Duplicate adverse events are deduplicated. A later successful
charge event cannot clear a hold. Partial refunds hold the whole commission.
Previously paid synthetic-history liabilities become recovery/reversed history,
not a second payable. SCV3 refund accounting does not claim recovery from a Partner
subaccount that never received a checkout transfer.

Do not execute a previously downloaded batch after its status becomes
REVIEW_REQUIRED. An exported file cannot be recalled; recheck current batch
status immediately before any independently authorized external operation.
No automatic hold release, reapproval or refund/dispute resolution is supplied.

## Evidence required before a separate live-enablement change

- [ ] Provider confirms the account's effective **single school** fixed-amount
  semantics, merchant remainder and fee/VAT ordering in writing.
- [ ] Independently verified bound TEST transactions show payer charged exactly
  NGN 5,000 and school entitled to exactly NGN 1,900 for Partner/no-Partner cases.
- [ ] Transaction-level school settlement statement matches recipient bank,
  transaction ID, reference, currency and exact amount. Merchant statement
  independently proves remainder after each actual expense/tax; aggregate
  settlement totals or echoed checkout metadata are insufficient.
- [ ] Webhook authentication scheme is confirmed for this merchant/API version.
  The freshly reviewed V3 **and general** webhook pages document `verif-hash`,
  consistent with the current adapter's constant-time shared-hash check.
  The actual merchant's selected webhook version and matching private value
  remain unverified. Do not infer dashboard settings from documentation or
  silently accept another signature scheme.
- [ ] Public HTTPS callback/webhook routing, independent GET verification,
  duplicate/out-of-order events and lost responses pass bound in-app acceptance.
- [ ] Real provider refund read-back and transaction-level recipient recovery are
  proven; chargeback event coverage is enabled with Flutterwave. Unmatched/missing
  identifiers, out-of-band refunds and disputes require independent reconciliation.
- [ ] Bulk approval/export and post-export refund/exception handling receive
  authenticated Owner/Partner acceptance. Historical allocations remain unchanged.
- [ ] Separate reviewed, idempotent transfer execution and verified beneficiary,
  currency, amount, reference and successful bank/provider transfer evidence are
  implemented before exposing any Paid action.
- [ ] Live merchant compliance, school account ownership, provider capabilities,
  fee/tax disclosures and reconciliation operations are reviewed.
- [ ] Separate explicit authorization, reviewed Production migration/deployment
  plan and a bounded controlled live-test plan exist. None are authorized here.

## Exact Replit Secret names — enter privately, not in chat

For a future separately approved live hosted-checkout integration:

- `FLUTTERWAVE_LIVE_SECRET_KEY`: dedicated server-side LIVE merchant credential.
  Neither generic `FLUTTERWAVE_SECRET_KEY` nor any TEST credential is a fallback.
  This is **not** an instruction to replace any existing value or enable LIVE.
- `FLUTTERWAVE_WEBHOOK_VERIF_HASH`: private webhook verifier matching the confirmed
  V3 merchant configuration. A switch to HMAC needs separate reviewed code.
- `FLUTTERWAVE_LIVE_PUBLIC_KEY`: only needed if a future approved client/Inline checkout
  actually uses it; current backend-hosted checkout does not require it.
- `FLUTTERWAVE_ENCRYPTION_KEY`: only if a separately approved direct-card API
  requires it; not required for the current hosted checkout.

Dedicated Development TEST aliases remain separate:
`FLUTTERWAVE_SECRET_Test_Key`, `FLUTTERWAVE_PUBLIC_Test_Key`,
`FLUTTERWAVE_Encryption_Test_KEY`. Their capitalization is intentional.
Never paste values into chat, source files, exports or this checklist.
No Secrets or environment settings were changed for this work.

## Development live-readiness review — 2026-10-19

**Decision: NOT READY. Checkout guards remain in place, including for TEST SCV3.**
This review uses public documentation, injected fictional provider responses and
disposable local PostgreSQL tests. It does not execute a sandbox charge, provider
refund, bank transfer, or provider-account mutation. No application database
migration, Production access, secret change or publishing is required.

### Local code findings resolved

| Area | Local verification and limitation |
| --- | --- |
| Fixed school split | Reference-selected comparison now accepts SCV3 school-only NGN 1,900 with NGN 3,100 merchant gross before costs. It rejects a Partner checkout recipient, old school amount, extra recipient, or subtracting the internal liability from merchant cash. Legacy/SCV2 comparisons retain their original policy. Exact instructions are not proof Flutterwave applies them. |
| Fees and taxes | Mocked NGN 65 app fee plus NGN 5 additional fee produce NGN 3,030 calculated merchant remainder in both Partner branches. VAT remains unknown; neither additional fees nor aggregate `amount_settled` prove VAT, a complete cost breakdown, or merchant bank credit. |
| Webhook authentication | Missing/wrong `verif-hash` is rejected before a hold, ledger write or provider verification. No HMAC auto-detection or alternate-secret fallback was added. Actual dashboard version/hash correspondence is not independently verified. |
| Collection verification | Successful notifications still require independent GET verification and exact application reference, provider transaction ID, currency and amount checks; the finalizer requires exact payer charge and fee components. Webhook body amounts and checkout metadata are not proof. |
| Refund notification | Recognizes the documented standalone V3 payload (`TransactionId`, `FlwRef`, `AmountRefunded`, `status`) only after existing authentication. Every supplied identifying reference must agree with one verified original payment. It places a durable hold and invalidates export; `completed` or nested disbursement metadata never proves refund completion. |
| Adverse charge notifications | Signed SCV3 reversed/refunded/failed charge events are held before the collection-success path. A still-successful collection GET cannot override the adverse notification. Existing payment history is retained for separate reconciliation. |
| Delivery acknowledgement | A durably persisted adverse hold returns HTTP 200, as documented by Flutterwave. Unmatched or independently unverified events remain unresolved, not silently accepted as financially reconciled. Duplicate delivery cannot create another payable. |
| Settlement reporting | Missing, extra, wrong-amount or mismatched frozen recipient rows fail before provider reporting; an empty set cannot mark settlement complete. This remains TEST provider-reported evidence, not proof of real bank receipt or main-merchant settlement. |
| Partner payout | Approval, immutable selected-item snapshot, audited export, duplicate/concurrent retries and late exception invalidation are covered. There is still no transfer execution/evidence ingestion, so no new deferred batch can be marked Paid. |

### Remaining blockers and required account evidence

1. **Effective allocation:** Flutterwave's split page still contradicts itself
   about `flat_subaccount`; its explicit override example supports the intended
   fixed school amount. Written merchant-specific confirmation and exact
   transaction-linked school/main-merchant statements are required. Percentage
   defaults, bank ownership checks and successful collection are not substitutes.
2. **Complete costs and settlement:** Need actual app fee, any additional fee,
   tax/VAT treatment and bank-credit evidence for both eligible-Partner and
   no-Partner payments. No full transaction-level split normalizer or independently
   verified main-merchant bank settlement is currently supplied by the adapter.
3. **Dashboard delivery configuration:** Need confirmation of V3 webhook mode,
   configured hash correspondence, retries, refund custom URL and chargeback
   notifications for the intended isolated TEST merchant/environment. Public
   HTTPS callback/webhook routing, event shapes and lost/out-of-order delivery
   still need bounded in-app sandbox acceptance. Unsupported/missing identifiers
   remain a manual reconciliation blocker; no speculative matching is used.
4. **Refund and dispute evidence:** Need independent provider GET refund read-back
   and recipient recovery evidence, including out-of-band and partial refunds.
   A refund POST response, `completed` refund status or chargeback outcome alone
   does not prove customer disbursement, school recovery or commission reinstatement.
5. **Partner transfer evidence:** Automated execution is deliberately absent.
   A separate reviewed idempotent transfer and evidence-reconciliation workflow
   must bind beneficiary, amount, currency, reference and independently successful
   transfer before any Paid capability can be offered.
6. **Operational authorization:** Merchant compliance, school ownership,
   effective capabilities and fee disclosures, exception/recovery operations,
   Production migration/deployment review and explicit controlled-live-test
   authorization remain external release gates. None are authorized by this review.

### What the user needs to change now

- **Replit Secrets: no change is required for this review.** Do not add live
  values or replace existing credentials. Names listed above are configuration
  requirements, not verified contents. Future authorized TEST acceptance requires
  `FLUTTERWAVE_SECRET_Test_Key` and a matching `FLUTTERWAVE_WEBHOOK_VERIF_HASH`.
  The optional legacy TEST alias `FLUTTERWAVE_TEST_SECRET_KEY`, if present, must
  not conflict with the dedicated TEST credential; never fall back to a live key.
- **Flutterwave dashboard: no change is made or requested now.** First confirm,
  privately, the TEST account's selected V3 webhook/hash configuration, retries,
  refund custom URL, chargeback delivery and school-only override behavior.
  Future explicitly authorized setup must use an approved isolated Development
  destination ending `/api/webhooks/flutterwave/student-subscription` for the
  student subscription webhook and refund custom URL. Never point these TEST
  callbacks at Production or initiate a charge to discover their destination.
- Supplying keys alone cannot remove the checkout guard or establish readiness.

### Verification recorded for this review

- 294 focused API tests across 13 files passed, including isolated native
  PostgreSQL constraints/approval histories and real HTTP webhook handlers with
  fictional provider configuration. Six frontend approval tests also passed.
- Frontend/API typechecks and whitespace/diff checks passed.
- Development API and web workflows restarted successfully; the public sign-in
  page rendered. Existing Development subscription/notification workers remain
  paused for controlled verification.
- Separately observed: the NFC Hardware Test workflow is failed because its
  dependency-aware schema export cannot find the required
  `subscriptions_id_school_student_uq` source uniqueness. This is not a passing
  hardware/end-to-end sandbox acceptance result; no schema repair, hardware
  workflow restart or unrelated refactor was attempted in this review.

## Focused TEST-mode acceptance pass — 2026-10-19

**Result: local automated acceptance PASS; provider-backed TEST acceptance BLOCKED;
live activation remains BLOCKED.** This pass adds tests and documentation only.
It does not alter runtime payment code, application data/schema, secrets, provider
settings, checkout guards, historical policy, or the unrelated NFC hardware export.
All new provider responses are fictional mocks. Database evidence comes from an
isolated disposable local PostgreSQL database, never the application's database.

### Acceptance matrix

| Requirement | Local result | External evidence still required |
| --- | --- | --- |
| School-only NGN 1,900 instruction; NGN 3,100 merchant gross | PASS — exact plan, Partner/no-Partner branches, cross-version rejection and before-transport checkout guard | BLOCKED — merchant-specific fixed-amount semantics and transaction-linked recipient allocation |
| Fees/VAT and merchant remainder | PASS — NGN 65 + NGN 5 costs yield NGN 3,030; internal Partner liability never reduces merchant cash. Missing cost/payer fields remain unknown; arbitrary VAT, metadata and aggregate settled amounts are not settlement proof | BLOCKED — complete actual fee/tax breakdown and main-merchant bank credit for the same transaction |
| Webhook authentication | PASS — missing/wrong hash, missing configured verifier and alternate signature header cannot change liabilities | BLOCKED — actual TEST account's selected V3 version and privately matching hash |
| Durable adverse-event acknowledgement | PASS — forced audit failure returns500 and rolls back hold, event claim and batch invalidation; retry returns200 only after commit; duplicate retry retains one event/audit | BLOCKED — public HTTPS delivery and actual merchant retries into the approved isolated Development environment |
| Failed/refunded/reversed event exclusion | PASS — authenticated adverse SCV3 charge notifications cannot finalize collection or erase a hold; successful collection notifications do not resolve disputes | BLOCKED — real account event payloads and enabled chargeback/refund delivery |
| Transaction-linked school settlement | PASS — strict recipient account, currency, amount, transaction ID/reference and complete frozen recipient-set checks; empty/extra/contradictory evidence cannot complete reconciliation | BLOCKED — Flutterwave-issued transaction-linked school statement; local mocked reports do not prove receipt |
| Refund recovery and replay | PASS — actual refund request/verification handlers tested against PostgreSQL with mocked provider responses. Lost POST is reserved once and never resent; mismatched IDs/amounts cannot confirm recovery; concurrent verification cannot apply partial refunds twice | BLOCKED — actual provider refund read-back, final customer disbursement and recipient recovery statements |
| Historical refund policies | PASS — partial NGN 100.01 plus NGN 4,899.99 refunds conserve all kobo for legacy, SCV2 and SCV3. SCV3 full refund records NGN 1,900 school recovery target, zero Partner subaccount recovery and NGN 3,100 merchant reversal target | BLOCKED — these are recorded recovery targets, not evidence of bank clawback |
| Held/refund-failed liabilities | PASS — pending/failed refund read-back does not assert recovery or restore commission eligibility; original collection references and history are preserved | BLOCKED — independent exception resolution; no automatic hold release supplied |
| Partner Paid prevention | PASS — signed successful transfer notification and an invented payment reference cannot mark an approved export-only batch Paid; paid balance stays zero | BLOCKED — separately reviewed beneficiary/amount/currency/reference-bound transfer evidence reconciliation; no transfer is initiated here |
| Dedicated TEST configuration isolation | PASS — synthetic configuration tests exercise dedicated aliases, conflicts/invalid values and no live-key substitution | BLOCKED — existing secret names/presence do not independently prove valid contents, merchant identity or dashboard correspondence |

### Verification

- **314 API tests across 14 files + 6 frontend tests passed (320 total).**
  Fourteen new acceptance cases extend the prior coverage, principally in
  `deferred-partner-commissions.postgres.test.ts` and `flutterwave-readiness.test.ts`.
- Frontend/API typechecks and diff checks passed.
- No runtime restart was required: this pass changes tests/documentation only.
  No hardware workflow restart or schema-export repair was attempted.
- No sandbox payment/refund, external provider account call, financial mutation
  against the app database, actual-secret inspection or provider setting change
  was performed. The local secret strings in tests are fictional fixtures.

### Remaining TEST acceptance requiring user action

**No user action or Secrets change is needed to run this automated suite.**
Unblocking provider-backed TEST acceptance requires user/account-owner evidence:

1. Privately confirm the intended TEST merchant identity, effective school-only
   override/fee settings, V3 webhook mode, retries, refund custom URL and
   chargeback notification delivery. Do not disclose secret values in chat.
2. Confirm the existing `FLUTTERWAVE_SECRET_Test_Key` belongs to that TEST merchant
   and `FLUTTERWAVE_WEBHOOK_VERIF_HASH` matches its selected V3 webhook verifier.
   Presence alone is not validation; no value replacement is requested.
3. Supply transaction-linked provider statements/read-backs for approved existing
   TEST transactions, where available: payer NGN 5,000, exact school NGN 1,900,
   complete fees/taxes, school recipient/account identity, and actual main-merchant
   remainder. Partner/no-Partner branches must be represented. Never retroactively
   attach an unrelated standalone checkout to a student payment.
4. For refund/dispute acceptance, supply original transaction/refund IDs, exact
   refunded amount, independent final-disbursement status, and school/merchant
   recovery evidence. An initiated refund or chargeback notification is insufficient.
5. If suitable existing evidence is unavailable, retain BLOCKED. Any new sandbox
   transaction, refund, callback delivery test or provider setting change requires
   separate bounded authorization and independently confirmed Development isolation;
   it is not authorized by this no-payments/no-refunds acceptance pass.

Live credentials, Production migrations, publishing and removing either checkout
guard are not required to complete the local suite and remain explicitly prohibited.

## Existing TEST configuration and provider-backed read-only review — 2026-10-19

**Result: configured TEST credential and existing collection read-back PASS;
new-policy split/settlement, webhook delivery and recovery acceptance remain
BLOCKED.** This supersedes the earlier absence of actual-secret/configuration
inspection only to the limited extent described below. No secret value was
displayed, requested, written, exported or changed.

### Configuration presence and runtime selection

| Check | Observed result |
| --- | --- |
| `FLUTTERWAVE_SECRET_Test_Key` | Present: **true** |
| `FLUTTERWAVE_WEBHOOK_VERIF_HASH` | Present: **true** |
| Optional alias `FLUTTERWAVE_TEST_SECRET_KEY` | Present: **false**; no alias conflict |
| Existing Development credential selector | `CONFIGURED`, mode `TEST`; no generic/live credential fallback was used |
| Existing student TEST adapter construction | Successful; configuration accepted without revealing values |
| Webhook hash matches selected merchant/dashboard | **UNVERIFIED**; presence/constructor acceptance is not a matching-hash or delivery test |
| Checkout or automatic split settlement enabled/verified | **false**; existing fail-closed guards remain unchanged |

The actual adapter consumes the dedicated TEST key/optional TEST alias above and
`FLUTTERWAVE_WEBHOOK_VERIF_HASH`. No public or encryption key is needed for these
supported server-side GETs. A matching webhook hash cannot be established from
transaction verification or subaccount listings.

### Existing Development evidence

Read-only application-pool access independently matched the Development database
identity before inspecting records. All inspection queries ran in a READ ONLY
transaction. No settlement/finalization/reconciliation service that updates
application records was called.

- Four existing Flutterwave SANDBOX subscription payment records: two PAID,
  one FAILED and one RECONCILIATION_REQUIRED. Three have provider transaction IDs.
- No SCV3 subscription payment records.
- No frozen split payment plans, recipient settlement rows, refund adjustments
  or signed deferred adverse events.
- One generic fee-provider webhook record has status VERIFIED but
  `signature_verified=false`. It is not proof of a signed student-subscription
  delivery, selected dashboard version or matching configured hash.

### Actual provider GET results

The existing TEST adapters were used with an additional process-local transport
allowlist denying every non-GET request, non-Flutterwave host and non-reviewed
API path. No new permanent script or runtime setting was added.

| Existing evidence | Provider-backed read result | Limitation |
| --- | --- | --- |
| Successful legacy collection | Exact original reference/transaction ID, NGN currency and NGN 5,000 amount matched; charged amount NGN 5,000; app fee NGN 70; additional fee NGN 0; aggregate `amount_settled` NGN 4,924.75 | No recipient bank statement. The NGN 5.25 difference from gross less reported fees is unexplained; **not classified as VAT** and not silently subtracted or written back. |
| Successful SCV2 collection | Exact original reference/transaction ID, NGN currency and NGN 5,000 amount matched; charged amount NGN 5,000; app fee NGN 70; additional fee NGN 0; aggregate `amount_settled` NGN 4,930 | Historical policy only. This aggregate is not proof of school NGN 1,900, main-merchant credit, a complete split, or SCV3 deferred commission acceptance. |
| Failed historical collection | Exact original reference/transaction ID, NGN currency and NGN 5,000 amount matched with failed provider status | Does not establish collection, fee expense, entitlement or settlement; no successful collection was created. |
| Existing uncertain record without provider transaction ID | Supported reference lookup did not verify an existing collection; HTTP400 was observed | Remains unresolved. No new checkout, payment retry, database correction or reference reassignment was attempted. |
| Subaccount listing, default and page-one reads | HTTP200/success, one existing entry reported by each read | Does not establish bank ownership, split settings, creation capability or disbursement. No bank/person/account data was disclosed. |
| Supported settlement listing read | UNVERIFIED_ERROR; no usable response/status or statement obtained | Neither absence of settlements nor permission denial can be concluded from this result. No workaround changed settings or bypassed transport protections. |
| Refund/chargeback/recovery | No bound refund IDs, signed adverse events or recipient recovery records were available locally | No refund verification was guessed from another transaction, and no chargeback-listing contract was invented. Existing statements or dashboard delivery/recovery evidence are still required. |

### Remaining action

**The TEST key is already configured and worked for the reads above; do not add
it again. No Replit Secrets change is currently required.**
`FLUTTERWAVE_WEBHOOK_VERIF_HASH` is also present; no mismatch was established,
but correspondence with the dashboard remains unverified. If later matching
evidence shows a missing or mismatched verifier, that exact secret name is the
required configuration item; no automatic edit or secret value request is made.

To continue without new transactions or provider mutations, the account owner
must provide or privately inspect existing Flutterwave evidence:

- V3 webhook selection, selected hash correspondence, enabled retries/refund
  custom URL/chargeback delivery, and authenticated delivery logs for the approved
  isolated Development destination.
- Existing transaction-linked school/main-merchant statements proving the exact
  school NGN 1,900, full fee/tax breakdown, and merchant remainder. Explain the
  observed NGN 5.25 cost/aggregate discrepancy with provider evidence.
- Existing independently bound refund/dispute and customer-disbursement/recipient
  recovery evidence, if any.

No suitable SCV3 transactions or statements currently exist in the inspected
Development records. If the provider has no suitable existing evidence either,
SCV3 provider-backed acceptance cannot be completed under the current no-new-
transactions authorization and must remain BLOCKED.

This pass changes this checklist only. No code changes were needed, so tests,
typechecks, application restarts and the unrelated NFC hardware workflow were
not rerun. The earlier 314 API + 6 frontend passing results remain the local
automated evidence, not proof of actual bank settlement. No Production access,
Publish configuration change, publishing, or payment/refund/payout/provider
mutation was performed.

## Separate LIVE preparation wiring — 2026-10-20

**Wired, but NOT activated.** No secret values were inspected, requested, printed
or changed. No merchant API was called. No migration, Production operation,
Publish-settings change or publishing is part of this work.

### Implemented boundaries

- Separate `FlutterwaveLiveAdapter` and explicit LIVE factory. Presence of a key
  never selects LIVE. The shared V3 parsing/authentication implementation retains
  the existing TEST constructor's TEST-key validation.
- LIVE requires production runtime, exact server-side mode/enablement, a valid
  LIVE-formatted `FLUTTERWAVE_LIVE_SECRET_KEY`, and a valid verifier explicitly labelled
  for the LIVE dashboard. TEST credentials never substitute for any missing LIVE
  configuration. Format checks are not authentication or merchant identity proof.
- TEST factories no longer read `FLUTTERWAVE_SECRET_KEY`, even if it contains a
  TEST-looking value. Use dedicated TEST names. The mixed-case
  `FLUTTERWAVE_SECRET_Test_Key` remains Development-only; deployed TEST uses
  `FLUTTERWAVE_TEST_SECRET_KEY`. The payroll TEST selector's generic-key fallback
  was also removed; independent payroll LIVE authorization is not changed.
- TEST webhook authentication uses `FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH` when
  supplied. Legacy shared `FLUTTERWAVE_WEBHOOK_VERIF_HASH` remains a TEST fallback
  only when not explicitly bound to LIVE. Identical dedicated TEST/LIVE verifiers
  are rejected while LIVE-bound; invalid scope never silently falls back.
- New callback path: **`/api/webhooks/flutterwave/live/student-subscription`**,
  mounted with bounded raw-body parsing before Clerk/JSON parsing, separately
  from existing TEST callbacks. Missing configuration returns503; an incorrect,
  missing or TEST `verif-hash` returns401 when LIVE configuration is ready.
- Even with complete configuration and a correct LIVE hash, the new endpoint
  returns503 / `processed:false`. It does not resolve payments, write financial
  data or return a false successful acknowledgement.
- LIVE checkout, verification/status/refund transport and collection webhook
  processing remain blocked in code. There is no environment-variable override
  for the merchant-evidence/release gate and no new payout/transfer method.
- New LIVE-generated subscription references use SCV3. Existing legacy/SCV2/SCV3
  allocation policy, stored histories and deferred term-end approval/export
  semantics are not migrated or reinterpreted.

### Exact private setup steps — preparation only

**No configuration change is required or recommended now to make checkout work:
this release intentionally cannot process LIVE transactions.**
The following is the preparation checklist for a separately authorized rollout,
not permission to modify Production or activate delivery in this pass:

1. The user reports adding `FLUTTERWAVE_LIVE_SECRET_KEY` and
   `FLUTTERWAVE_LIVE_PUBLIC_KEY` to Replit Secrets. No further secret entry/change
   is requested. The server reads only the dedicated LIVE secret name, never
   generic or TEST credentials. This report is not credential/merchant validation:
   no actual value was inspected. The LIVE public key is intentionally unused by
   this server-hosted flow; do not expose it to the client as part of this work.
2. Preserve the existing isolated TEST environment and its credentials. Before
   assigning the generic verifier slot to LIVE, prepare the TEST-specific
   `FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH` in the TEST runtime to match its own
   TEST dashboard, with a verifier different from LIVE. This pass changes neither.
   Run TEST and LIVE in separately configured runtimes; switching mode disables
   TEST factories rather than rerouting historical TEST callbacks through LIVE.
3. In the intended merchant's Flutterwave dashboard, explicitly select **Live**
   and open webhook settings. Confirm the V3 `verif-hash` contract for that account,
   configure/privately compare the dashboard secret hash with
   `FLUTTERWAVE_WEBHOOK_VERIF_HASH`, and confirm retries and relevant
   refund/chargeback notification settings. Prior TEST hash confirmation is not
   LIVE correspondence. If the account uses a different signature scheme, stop:
   this code does not auto-detect or accept another scheme.
4. Prepare the HTTPS callback as the separately verified published API origin
   plus `/api/webhooks/flutterwave/live/student-subscription`. Obtain the actual
   origin through an authorized release review; none is invented here. Do not use
   a Development preview, the TEST callback, or a URL on another deployment.
   **Do not activate/save this as an operational LIVE delivery destination yet**:
   it deliberately returns503 and cannot durably consume LIVE events. Confirm
   the refund custom-URL contract before directing standalone callbacks there.
5. Only after separate approval, scope these **server-only, non-secret**
   configuration values to the intended LIVE runtime. Leave them unset/disabled
   now; none was added or changed:

   | Setting | Future explicit value | Current/default behavior |
   | --- | --- | --- |
   | `NODE_ENV` | `production` | Development/test runtimes cannot construct LIVE |
   | `EDUCORE_FLUTTERWAVE_MODE` | `LIVE` | Unset preserves TEST selection; invalid/LIVE never falls back to TEST |
   | `EDUCORE_FLUTTERWAVE_LIVE_ENABLED` | `true` (exact lowercase) | Unset/false disables LIVE configuration |
   | `EDUCORE_FLUTTERWAVE_WEBHOOK_ENVIRONMENT` | `LIVE` | Must be attested only after confirming the matching LIVE dashboard hash |

   **Even all these values plus valid credentials do not enable checkout or
   provider transport in this release.** They prepare configuration/authentication
   only. Future production-secret scoping uses the separate Production app secrets
   controls under Publishing settings, but changing them is outside this work.

### V3 allocation terminology and unresolved release gates

Re-fetched the official V3 split and webhook pages for this pass. V3 checkout
override examples explicitly use:

```json
{"amount":5000,"currency":"NGN","subaccounts":[{"id":"RS_REVIEWED_SCHOOL_ID","transaction_charge_type":"flat_subaccount","transaction_charge":1900}]}
```

This is an illustrative blocked instruction, not an existing account or transport
request. `transaction_charge` is NGN major units here, not 190000 kobo.
The explicit override examples describe `flat_subaccount` as the recipient's
fixed amount and `flat` as the merchant's fixed commission. However, the same
page's “Difference Between” section describes `flat_subaccount` inconsistently.
Do **not** substitute `flat`, configure a percentage default, or assume the
subaccount-creation `split_type` field has identical checkout-override semantics.

The server's current SCV3 policy remains: NGN 5,000 gross, exactly one school
recipient at NGN 1,900, NGN 3,100 merchant gross before actual costs, no Partner
checkout subaccount, and an eligible NGN 100 internal liability for term-end
bulk approval/export. Unknown fees/VAT remain unknown. A NGN 70 total-cost
example gives NGN 3,030 merchant remainder and NGN 2,930 Owner economic net
where that liability exists; it is not a settlement promise.

Before a separate code release can remove the hard gate, obtain merchant-specific
written split confirmation, transaction-linked school AND merchant statements,
complete actual costs/tax treatment, matching authenticated webhook delivery,
independent refund/recovery evidence and approved operational reconciliation.
LIVE-mode payment provenance/persistence and durable event acknowledgement need
separate reviewed implementation/acceptance; current SANDBOX-only history is not
relabelled as LIVE. Deferred Partner transfer evidence remains a separate blocker.

### Verification for this wiring

Focused synthetic configuration/adapter/HTTP tests exercise absent and conflicting
configuration, both credential directions, TEST/LIVE hash separation, alternate
signature rejection, hard-gated checkout/reads/refunds, no webhook resolver/provider
transport, exact school-only allocation and historical-policy retention.
These tests are not merchant authentication, settlement, dashboard correspondence,
customer receipt or live operational evidence. Final run results are recorded below.

- **211 focused API tests passed across 11 files**, including 30 new LIVE-wiring
  cases and 33 native disposable-PostgreSQL commission/refund cases. All 11
  explicitly requested test files executed; none was silently omitted.
- API and frontend TypeScript checks passed; diff whitespace check passed.
- Development API built/restarted successfully. Its existing subscription and
  notification worker pause remains active; the unrelated NFC hardware workflow
  was not started.
- Development frontend started successfully; the public sign-in screen rendered.
  No signed-in financial/browser journey is claimed.
- A request through the actual Development proxy to the new LIVE callback
  returned503 with the disabled/missing/mismatched configuration response.
  This verifies route mounting and the default guard, not LIVE credentials or
  provider delivery. Synthetic HTTP tests separately verify incorrect hash401
  and correctly authenticated but unpersisted event503.

## Dedicated LIVE credential update — 2026-10-20

**Result: dedicated-name wiring PASS; durable LIVE processing and activation
BLOCKED.** This section supersedes earlier instructions naming generic
`FLUTTERWAVE_SECRET_KEY` / `FLUTTERWAVE_PUBLIC_KEY` as LIVE inputs. Work was
limited to Development source, synthetic tests and this checklist.

### Credential and webhook contract

- LIVE status and adapter construction now read **`FLUTTERWAVE_LIVE_SECRET_KEY`
  only**. Generic keys, dedicated TEST keys, public keys and encryption keys are
  never credential substitutes. TEST construction does not read the LIVE names.
- The user reports adding `FLUTTERWAVE_LIVE_SECRET_KEY` and
  `FLUTTERWAVE_LIVE_PUBLIC_KEY`. No value was read, inspected, printed, logged,
  requested, edited or exposed. Presence and merchant validity are not verified.
  `FLUTTERWAVE_LIVE_PUBLIC_KEY` is intentionally not consumed: backend-hosted
  checkout needs no public credential. No frontend credential wiring was added.
- The expected LIVE webhook variable remains
  **`FLUTTERWAVE_WEBHOOK_VERIF_HASH`**, explicitly bound by
  `EDUCORE_FLUTTERWAVE_WEBHOOK_ENVIRONMENT=LIVE` only in a separately authorized
  future runtime. There is no new `FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH` selector.
  Actual dashboard correspondence remains unverified.
- TEST uses `FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH` when provided. The legacy shared
  verifier can be a TEST fallback only when not LIVE-bound. Missing dedicated
  TEST verification while LIVE-bound, identical TEST/LIVE hashes while
  LIVE-bound, and invalid environment scope fail closed. No verifier was changed.
- No flags were set. Development still cannot construct LIVE configuration.
  Correct synthetic production-mode configuration cannot bypass the hard-coded
  checkout, verification/status, refund transport or event-processing blocks.

### Why durable LIVE processing was not implemented

The source schema in `lib/db/src/schema/student-subscription-billing.ts` has an
explicit `provider_mode = 'SANDBOX'` CHECK. The finalizer in
`artifacts/api-server/src/lib/student-subscription-billing.ts` also rejects
non-SANDBOX payment provenance. Existing generic event records do not supply a
reviewed environment-bound LIVE acceptance/reconciliation design.

Reusing these paths would require schema and financial workflow changes, not just
an authenticated callback. Migrations are prohibited in this pass. LIVE independent
transaction verification is also deliberately blocked, and merchant-specific
allocation, actual settlement, complete costs/VAT and refund/recovery evidence
remain unavailable. No schema was changed, SANDBOX history relabelled, speculative
event ledger created, or adverse-event financial resolver enabled.

The separate `/api/webhooks/flutterwave/live/student-subscription` therefore
continues to refuse processing: disabled configuration returns503; synthetic
complete configuration rejects missing/wrong/TEST authentication with401; correct
authentication still returns503 with `processed:false`. It never claims durable
acceptance. This is a refusal/retry boundary, **not** implemented LIVE idempotency.
Do not save/configure this callback in the Flutterwave dashboard.

### Verification performed for this update

- **172 focused API tests passed across seven executed files**:
  `flutterwave-live-config.test.ts` (34), `fee-providers/index.test.ts` (45),
  `fee-providers/nfc-config.test.ts` (6), `fee-provider-webhooks.test.ts` (29),
  `services/flutterwave-readiness.test.ts` (10),
  `student-subscription-webhooks.test.ts` (6), and
  `student-subscription-billing.test.ts` (42).
- Added explicit-name-only, generic-LIVE/generic-TEST fallback rejection,
  throwing-getter isolation tests in both directions, and missing/invalid
  webhook-scope checks. Synthetic HTTP tests repeat successful-looking,
  wrong-currency/amount, unknown-reference, reversed and standalone partial-refund
  events; all remain503/unprocessed without invoking the LIVE financial handler.
- Existing tests retain exact reference/amount/currency verification and TEST
  callback coverage, immutable allocation policy and all LIVE transport guards.
  These are synthetic tests, not actual provider verification or LIVE persistence.
- API and frontend TypeScript checks passed. Diff whitespace check passed.
  The first test command named readiness under `src/lib`, so it executed only
  four files; the corrected `src/services` path and two subscription files
  executed in the second run. The seven-file total above excludes no requested file.
- Development API built/restarted successfully; subscription/notification workers
  remain paused. Actual proxied callback POST returned503 with the disabled
  configuration response. No frontend code changed or browser financial flow ran.
  The unrelated failed NFC hardware workflow was not restarted or repaired.
- Current Replit source was compared with freshly fetched GitHub main; existing
  local work was preserved. No push, provider call, application-data mutation,
  migration, secret/flag change, dashboard change, Production operation,
  Publish-setting change or publishing was performed.

### Remaining acceptance before any separately authorized release

Require a reviewed environment-bound payment/event schema and idempotency keys;
transaction-ID/reference/currency/amount and frozen-recipient binding through
independent verification; atomic durable commit before HTTP200; failed-commit
rollback and bounded safe retries; duplicate/out-of-order and unknown-reference
handling; durable refund/adverse-event holds and export invalidation; and no hold
release from later successful collection notifications. Verify these against
disposable PostgreSQL before any authorized external delivery test. Current
refusal tests do not prove those future processing guarantees.

The financial policy is unchanged: NGN5,000 per student/term, exactly one school
allocation of NGN1,900, NGN3,100 merchant gross before actual expenses/taxes, and
eligible NGN100 internal Partner accrual for term-end approval/export only.
Merchant-specific split semantics, school/main-merchant bank settlement,
fees/VAT, refund/recovery and dashboard/version evidence remain separate gates.
No user secret or dashboard change is requested now.

## Development LIVE receipt persistence — 2026-10-20

**Result: isolated durable receipt preparation PASS; end-to-end LIVE payment
persistence, verification, finalization and refund/hold processing remain BLOCKED.**
This supersedes the earlier description of the callback as having no database
path. It does not supersede any activation guard or merchant-evidence gate.

### Inspection and implementation boundary

Reviewed the payment schema, finalizer, TEST callback/reconciliation flow,
split-provider/refund and adverse-event boundaries, deferred commission SQL,
migration conventions and existing disposable-PostgreSQL tests. The financial
schema/finalizer and adverse-event matching remain explicitly SANDBOX-bound.
The existing finalizer also performs shared subscription activation, receipt,
allocation and commission work; replacing its mode check alone is unsafe.
The shared transaction-ID and business-term conflict rules need an explicit
environment-isolation design before LIVE payments can be reserved/finalized.
The commission evidence view is likewise SANDBOX-only.

Independent LIVE GET verification is prohibited by this request and remains
hard-blocked. There is therefore no safe operational path from an incoming
LIVE claim to a verified payment, durable finalization or matched financial
hold. No existing financial CHECK, index, resolver, historical policy, refund
workflow or Partner evidence view was widened or bypassed.

### Additive, review-only SQL — NOT applied to either application database

- `lib/db/dev-reconciliation/flutterwave-live-webhook-inbox.up.sql` creates
  **only** `flutterwave_live_webhook_receipts`. Fixed provider/LIVE constraints,
  a unique provider/environment/body-fingerprint namespace and a
  `BLOCKED_PENDING_REVIEW`-only state prevent confusing receipt records with
  SANDBOX events or processed/paid financial records.
- The matching `.down.sql` reverses an **empty** inbox. It takes an exclusive
  lock and refuses to drop retained evidence. A populated rollback needs a
  separately reviewed preservation plan; there is no destructive automatic
  downgrade or cascade.
- These drafts are **not** registered in the migration journal or ORM schema
  export, and no migration ledger entry was changed. No normal startup applies
  them. The only execution was against fresh disposable native PostgreSQL.
  Actual Development application requires target identity/catalog/ledger review
  and explicit application approval; Production application is not authorized.

### Callback behavior and receipt safety

The existing LIVE-bound adapter authentication must succeed before acquiring a
database client. Disabled/mismatched configuration still returns503 without
storage; missing/wrong/TEST authentication with synthetic ready configuration
returns401 without storage.

Authenticated delivery can attempt an isolated transaction containing a SHA-256
fingerprint, bounded allowlisted **unverified claims**, byte count and delivery
timestamps/count. It stores no headers, raw body, customer/card/bank data or
arbitrary metadata. Local SQL lock/statement timeouts bound database work.
The unique namespace handles concurrent byte-identical delivery retries; retries
only increment the count and do not overwrite original claims.

After COMMIT, the callback may report `receiptRecorded:true`, but **still
returns503 and `processed:false`**. Failed or uncertain COMMIT and missing schema
also return503 without claiming a recorded receipt or leaking database errors.
No provider transaction verification, payment finalizer, hold, refund, commission,
receipt issuance, settlement resolver or automatic replay worker is called.

**This is not financial or semantic event idempotency.** Re-encoded/changed bodies
may create separate receipt fingerprints. Raw payloads are deliberately not
retained for replay; these diagnostic records alone are insufficient for later
financial processing. Actual provider redelivery or separately authorized
evidence ingestion and a reviewed retention design would be required. The
endpoint never returns200 just because a receipt exists. Do not configure/save
it in Flutterwave or rely on provider retries as an operational recovery system.

### Verification for this increment

- **137 targeted tests passed across six executed files**:
  - LIVE inbox PostgreSQL/actual HTTP handler: **12** new tests.
  - Existing LIVE configuration/transport guard tests: **34**.
  - Student subscription billing: **42**.
  - Existing student webhook route: **6**.
  - Readiness/allocation acceptance: **10**.
  - Existing PostgreSQL commission/refund handlers: **33**.
- The 12 new tests execute the real draft up/down SQL and actual LIVE HTTP
  router against an isolated Unix-socket PostgreSQL cluster, using fictional
  authentication and no provider network. They cover committed receipt before
  reporting it, concurrent deduplication, changed-body separation, authentication
  and runtime/scope denials before DB access, failed-commit rollback, response
  loss after successful COMMIT, missing-schema refusal/retry, adverse/refund then
  success ordering, malformed/mismatched/unknown claims, SQL environment/status
  constraints, empty rollback/reapply, and populated rollback refusal.
- The isolated preservation check retains an independent SANDBOX-history sentinel;
  it is **not** a full clone or upgrade rehearsal of an application database.
  Existing 33 PostgreSQL tests separately retain real TEST hold/refund/approval
  regressions. No test result is claimed as LIVE financial finalization evidence.
- API and frontend typechecks passed. Initial API typecheck found a test listener
  callback typing issue; it was corrected and both checks then passed.
  Diff whitespace checks passed.
- Development API built/restarted successfully with existing subscription and
  notification workers paused. An actual proxied callback POST returned503 with
  disabled/mismatched configuration. No application receipt was created by that
  refusal. A public-page screenshot was inconclusive (bootstrap shell only);
  no frontend change or signed-in/browser financial acceptance is claimed.
- Fresh GitHub main was compared with current Replit source; local work was
  preserved. No application DB read/write or migration, actual-secret inspection,
  provider request, transaction/refund/transfer, secret/flag change, dashboard
  change, Production operation, Publish-setting change, push or publishing was
  performed. The unrelated NFC hardware workflow was not restarted.

### Explicit remaining blockers

1. Review the actual target schema/ledger before any application of the staged
   inbox SQL; agree evidence retention and nonempty rollback/preservation.
2. Design and review LIVE payment reservation/provenance, environment-scoped
   transaction and semantic event keys, cross-environment business-term conflict
   rules, frozen recipient snapshots and all dependent foreign keys/financial
   consumers. Preserve every historical allocation and original-school record.
3. Implement independently verified successful transaction binding (exact
   reference/transaction ID, NGN and NGN5,000, exact payer charge/known fees and
   frozen school recipient), then atomic durable finalization and event completion.
   Only a separately reviewed release could permit verification transport.
4. Implement matched, durable adverse/refund/reversal holds, unresolved-event
   reconciliation, export invalidation, safe partial-refund/recovery handling and
   out-of-order protection. A payload's success or refund `completed` claim cannot
   establish collection, disbursement, bank recovery or release a hold.
5. Require crash/race/duplicate/replay and financial-invariant tests through the
   complete LIVE path with mocked transport/disposable PostgreSQL before any
   separately authorized external acceptance. Receipt-only tests are insufficient.
6. Obtain the outstanding merchant-specific school split, transaction-linked
   school/main-merchant settlement, actual costs/VAT, version/hash delivery and
   refund/recovery evidence and a separate release/operational approval.

All LIVE checkout, verification/status/refund transport and LIVE flags remain
disabled. The unchanged policy is NGN5,000 per student/term, exactly NGN1,900
school, NGN3,100 merchant gross before actual costs/taxes, and eligible NGN100
internal Partner liability for term-end approval/export only. No Partner checkout
subaccount and no new Paid/transfer capability were added.

## Offline LIVE finalization design — 2026-10-20

**Result: isolated design implemented and tested; NOT operational LIVE billing.**
No credential isolation or inbox work was repeated. This extends the preceding
receipt-only preparation with a separate, dependency-injected financial design.
The HTTP callback is intentionally unchanged and still returns503.

### Isolation and disabled verification

- `flutterwave-live-verification.ts` defines a normalized independent verification
  interface. Its frozen default implementation is disabled and always refuses.
  No flag, key, adapter factory or environment setting can enable it; no LIVE
  HTTP transport was added or invoked.
- `flutterwave-live-finalization-design.ts` is not imported by any route, worker,
  checkout or provider factory. Only isolated tests inject an enabled fictional
  verifier and disposable SQL pool. The default rejects **before DB access**.
  Even a committed design outcome reports `operationallyProcessed:false`, never
  operational activation or HTTP200 eligibility.
- The design queries only the LIVE receipt inbox and new LIVE-prefixed tables.
  Each table has a fixed LIVE constraint. Merchant scope, original-school/student/
  session/term scope, immutable recipient/Partner snapshots and provider-ID
  uniqueness are explicit. Shared academic, SANDBOX payment, receipt, allocation,
  commission, refund and approval/export records are never read or written.
- The caller must supply the original bounded body matching a signature-verified
  LIVE receipt's SHA-256. Diagnostic receipt claims are not processing authority.
  Every supported supplied transaction/application/provider-reference identifier
  must agree. Missing original bytes, unsupported/malformed event shapes and
  unmatched or contradictory identifiers refuse processing.

### Review-only additive migration drafts

`lib/db/dev-reconciliation/flutterwave-live-finalization.up.sql` creates separate:

1. Frozen LIVE subscription intent snapshots and one-time verified identity binding.
2. Immutable independently verified collection evidence.
3. Semantic collection/whole-liability-hold events.
4. Immutable receipt-to-event results.
5. Internal LIVE Partner accrual projections (`ACCRUED` or `HELD`, never Paid).

It depends on the LIVE inbox draft. It does not widen any existing schema CHECK
or reference shared/SANDBOX tables. Composite foreign keys bind collection and
Partner projection values to the frozen LIVE intent; unique keys prevent a
provider identity or business term from being assigned twice in that namespace.
The `.down.sql` reverses empty design tables but refuses to erase retained intents
or evidence. It leaves the prior inbox intact.

**Neither draft was registered in the migration journal/ORM export or applied to
an application database.** Only fresh disposable Unix-socket PostgreSQL executed
them. No ledger adoption, existing-target upgrade rehearsal or Production
compatibility is claimed.

### Finalization and adverse-event guarantees tested

- Fresh collection evidence requires exact LIVE environment/merchant, reference,
  transaction ID, successful normalized status, NGN currency, NGN5,000 principal
  **and payer charge**, bounded integer fee components and independently
  transaction-bound evidence of exactly one reviewed school subaccount at
  NGN1,900. Echoed checkout metadata, wrong/extra recipients and Partner checkout
  subaccounts fail. Unsupported/missing provider evidence stays blocked.
- The school remains NGN1,900 and merchant gross NGN3,100 before costs, with
  eligible NGN100 accrued internally. Fictional NGN65 + NGN5 costs produce NGN3,030
  calculated merchant remainder, and NGN2,930 Owner economic net with a Partner
  versus NGN3,030 without. Additional fees are not called VAT, and these
  calculations are not bank settlement or complete tax/cost evidence.
- Row locks, unique semantic events and an atomic SQL transaction bind collection,
  internal accrual and receipt result together. Re-encoded successful notifications
  do not accrue twice. Failed COMMIT rolls back; a lost successful COMMIT response
  is safely replayed without rewriting immutable amounts or another payable.
  SQL work and injected verification have bounded timeouts.
- Matched authenticated refund/reversal/chargeback notifications conservatively
  hold the whole internal liability. If original independently verified collection
  evidence already exists, it is reused **for the hold only**: an unavailable or
  now-reversed provider read must not prevent protection of that original record.
  Before such evidence exists, the fictional verification boundary must still
  prove the original transaction; otherwise the design refuses processing.
- Partial, pending/failed refund or chargeback-won claims never prove customer
  disbursement or recovery, reduce historical gross, pay a Partner, or release a
  hold. Reversal before collection prevents a later success creating a payable.
  The generic whole-liability-hold event deduplicates protective actions; it is
  **not** per-refund/cumulative-refund accounting.

### Exact verification results

- **157 distinct focused tests across seven files passed**:
  20 new finalization PostgreSQL tests; 12 LIVE inbox PostgreSQL/HTTP tests;
  34 LIVE configuration/transport guard tests; 42 subscription billing tests;
  6 existing student webhook tests; 10 readiness/allocation tests; and 33
  existing PostgreSQL commission/refund tests.
- Execution detail: the initial seven-file run passed156 tests. After adding
  the hold-only original-evidence case, the changed finalization file alone was
  rerun and all20 passed. The other137 tests were unaffected and not rerun.
- New native tests exercise the actual draft DDL and design function, not just SQL
  mocks, including Partner/no-Partner, 19 independent-proof mismatch variants,
  cross-merchant denial/namespace separation, original-body binding, concurrent
  duplicates, changed encoding, failed/lost commits, atomic adverse holds,
  pre-collection reversal, contradictory refunds, unavailable verification,
  verification timeout, immutability, Paid prevention and safe rollback/reapply.
- API/frontend typechecks passed. Initial typecheck found a synthetic timeout
  Promise missing its generic evidence type; this test-only annotation was fixed.
  Tracked and new-file whitespace checks passed.
- Development API built/restarted successfully; existing subscription/notification
  workers remain paused. Actual proxied LIVE callback returned503 with disabled/
  mismatched configuration, not a financial acknowledgement. No UI or browser
  financial flow changed; prior visual capture was not treated as acceptance.
- Fresh GitHub main was compared with the relevant Replit source. No application
  database access/migration, actual-secret inspection/change, provider request,
  transaction/refund/transfer, LIVE flag or delivery configuration, dashboard
  change, Production/Publish operation, push or publishing occurred.

### Remaining blockers — do not wire the callback to this design

- Independently verify target Development identity/catalog/ledger and rehearse the
  drafts against its existing schema before any separately approved application.
  Establish retention/preservation and nonempty rollback procedures.
- Implement an authorized LIVE intent producer with authoritative original-school,
  student/term, recipient ownership and eligible Partner attribution/rule evidence.
  The test snapshots are fictional, not proof of real eligibility or onboarding.
- Supply a separately authorized LIVE-safe independent verification transport and
  transaction-bound recipient normalizer. There is intentionally no such adapter
  here. Written effective split semantics, actual school/merchant bank statements,
  complete fee/VAT and recovery evidence remain mandatory release gates.
- Review shared subscription activation, official receipt issuance and cross-
  environment business-term conflicts. These separate collection projections
  neither activate an actual student nor replace the SANDBOX finalizer.
- Integrate LIVE-only term-end Owner approval/export and hold invalidation without
  mixing TEST evidence. There is no approval/export/Paid/transfer path for the new
  LIVE accruals; operational integration must enforce the existing policy.
- Review durable adverse-event/reconciliation and refund recovery accounting,
  full-event retention/redelivery, crash recovery and final acknowledgement before
  making any event operational. Unmatched/missing evidence remains unresolved;
  no hold release, refund completion or bank recovery is inferred.
- Only a separate reviewed release can connect the callback and enable anything.
  All LIVE flags, checkout, verification/refund transport and delivery remain
  disabled. Do not save a LIVE dashboard callback or initiate a transaction.

## Provider references reviewed

- https://developer.flutterwave.com/v3.0/docs/split-payments
- https://developer.flutterwave.com/v3.0.0/docs/webhooks
- https://developer.flutterwave.com/v3.0.0/docs/chargebacks
- https://developer.flutterwave.com/docs/webhooks
- https://developer.flutterwave.com/v3.0.0/docs/transaction-verification
- https://developer.flutterwave.com/v3.0.0/docs/refunds
- https://developer.flutterwave.com/v3.0.0/reference/get-transaction-refunds
- https://docs.replit.com/core-concepts/project-editor/app-setup/secrets

The split document's explicit override example says `flat_subaccount` gives
the school a fixed amount and the main merchant gets the rest after fees, but
another paragraph on the same page describes it differently. This contradiction
is an unresolved activation blocker, not permission to guess percentages or
remove the guard.
