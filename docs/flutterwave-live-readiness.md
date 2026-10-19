# Flutterwave deferred Partner commissions — Development review

## Status: NOT authorized or ready for live activation

No live checkout, live transfer, Production migration, Publish configuration,
key change or publishing is part of this implementation. Both SCV2 and SCV3
checkout remain blocked before provider transport. Adding credentials does not
remove these guards. The existing adapter remains TEST-only.

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

- `FLUTTERWAVE_SECRET_KEY`: server-side live merchant API credential. Current
  TEST adapters must never consume a live value. This is **not** an instruction
  to replace any existing value or enable live mode.
- `FLUTTERWAVE_WEBHOOK_VERIF_HASH`: private webhook verifier matching the confirmed
  V3 merchant configuration. A switch to HMAC needs separate reviewed code.
- `FLUTTERWAVE_PUBLIC_KEY`: only needed if a future approved client/Inline checkout
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

## Provider references reviewed

- https://developer.flutterwave.com/v3.0/docs/split-payments
- https://developer.flutterwave.com/v3.0.0/docs/webhooks
- https://developer.flutterwave.com/v3.0.0/docs/chargebacks
- https://developer.flutterwave.com/docs/webhooks
- https://developer.flutterwave.com/v3.0.0/docs/transaction-verification
- https://developer.flutterwave.com/v3.0.0/docs/refunds
- https://developer.flutterwave.com/v3.0.0/reference/get-transaction-refunds

The split document's explicit override example says `flat_subaccount` gives
the school a fixed amount and the main merchant gets the rest after fees, but
another paragraph on the same page describes it differently. This contradiction
is an unresolved activation blocker, not permission to guess percentages or
remove the guard.
