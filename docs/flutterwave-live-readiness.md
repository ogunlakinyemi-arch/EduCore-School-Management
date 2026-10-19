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
  Current V3 adapter uses `verif-hash`; current general docs also describe HMAC
  signatures. Confirm deployed configuration rather than assuming equivalence.
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

## Provider references reviewed

- https://developer.flutterwave.com/v3.0/docs/split-payments
- https://developer.flutterwave.com/v3.0.0/docs/webhooks
- https://developer.flutterwave.com/v3.0.0/docs/chargebacks

The split document's explicit override example says `flat_subaccount` gives
the school a fixed amount and the main merchant gets the rest after fees, but
another paragraph on the same page describes it differently. This contradiction
is an unresolved activation blocker, not permission to guess percentages or
remove the guard.
