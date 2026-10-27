# Owner-authorised daily school settlements

## What is implemented

The existing prospective `HOSTED_MANUAL_V1` Flutterwave checkout still collects
NGN 5,000 into the merchant account without an automatic school split. Its
independently verified payment event records a pending NGN 1,900 school entitlement.
The existing hosted journal is reused; no sandbox-only student payment table is
repurposed for LIVE. Previously split/settled SCV payments are not backfilled or
paid a second time.

The Platform Owner's hosted-payments dashboard, with its existing school selector,
has a per-payment **Pay School Now** action. Its confirmation shows school,
student payment reference, selected TEST/LIVE mode, fixed entitlement, saved
beneficiary name/bank/masked account, subaccount/profile status, fresh bank
resolution, available merchant NGN balance, outstanding reservations and the fee
ceiling. No scheduled job auto-approves daily payouts.

NGN 1,900 school + eligible BRO NGN 100 + platform NGN 3,000 = NGN 5,000 before
fees. Without an eligible BRO, platform allocation is NGN 3,100. BRO entitlement
remains deferred to the existing term-end Owner approval; there is no automatic
BRO payout. Actual provider-reported transfer fees are separately recorded against
the platform, not deducted from the school's NGN 1,900. Fractional-kobo fee reports
are retained as their original decimal; displayed/reserved kobo round upward
conservatively. This is not a full merchant-bank debit/tax reconciliation.

### Transfer states and duplicate protection

- An active Platform Owner is checked from current app user/membership records.
  The payment must be verified, unheld, unpaid to the school and in its original
  configured mode and prospective merchant-collected policy.
- A confirmation token binds the selected beneficiary/profile version and order.
  Account ownership/profile approval is distinct from fresh Flutterwave account
  resolution. LIVE also requires the existing LIVE onboarding binding matching
  the current profile and merchant scope.
- A unique `HSP1_T_…` / `HSP1_L_…` reference and immutable intent are committed
  **before** the sole transfer POST. A row lock prevents concurrent confirmation
  from creating a second intent. An advisory funding lock and conservative
  reservations protect overlapping school payout approvals in this workflow.
- Current authority, payment and profile are checked again and locked through
  dispatch. Only the first confirmed claim may send. A lost commit, timeout,
  acceptance response or later database write leaves the original reference
  reserved. Clicking again never sends it again.
- Initiation, including a POST claiming `SUCCESSFUL`, is only processing evidence.
  Owner **Check original transfer status** looks up the exact reference, then
  independently GETs its transfer ID and checks reference, principal, NGN
  currency, beneficiary fingerprint, known ID and approval.
- Flutterwave's documented NGN response may have a null `debit_currency`. That
  is accepted only for this workflow's frozen merchant-NGN intent, whose POST
  explicitly sets `debit_currency: NGN`. An explicit different debit currency
  is rejected.
- States include pending, processing, reconciliation required, confirmed success
  and confirmed failure. Unknown/not-found/ambiguous results never authorize a
  replacement. Failure remains retained and cannot automatically retry. Success
  is idempotent and consumes the existing school liability once.
- New payout enablement can be switched off without disabling read-only
  reconciliation using the original, correctly configured mode/credential.
  Transfer completion is explicitly reconciled by the Owner; no webhook status
  is trusted as final and no background reconciliation scheduler was added.

### Manual fallback and receipts

Manual external settlement remains available when no provider transfer has been
reserved. It cannot race or override a reserved, processing, failed or uncertain
provider intent; independent provider reconciliation/recovery is required first.
This deliberately avoids authorising a second physical payment.

After independently verified provider success, the Owner can upload a private
JPEG/PNG/PDF receipt with the actual transfer date. The receipt's hash, original
uploader and date are appended as evidence on the existing successful transfer,
without creating another settlement or entitlement. Original manual receipts
remain unchanged. Existing role-scoped downloads and validation continue to apply.

## Required account configuration

No settings or secrets were changed by this implementation.

The existing hosted checkout configuration, dedicated per-mode secret and
verification hash, approved HTTPS return base, additive journal schema and exact
immutable-history guard bindings must already pass their normal checks. The new
school payout event kinds, indexes and CHECK definitions must also be reviewed
and installed; a same-name CHECK change must not be assumed to reach a target
through Publish automatically. There is no startup DDL or Production migration.

New explicit settings:

| Setting | Required purpose |
|---|---|
| `EDUCORE_SCHOOL_PAYOUTS_ENABLED=true` | Enable this separate money-moving feature |
| `EDUCORE_SCHOOL_PAYOUTS_FUNDING_SOURCE=MERCHANT_NGN_BALANCE` | Reviewed v3 NGN wallet funding source |
| `EDUCORE_SCHOOL_PAYOUTS_TEST_APPROVED=true` | Separate TEST approval |
| `EDUCORE_SCHOOL_PAYOUTS_LIVE_APPROVED=true` | Separate LIVE release approval, not inferred from TEST |
| `EDUCORE_SCHOOL_PAYOUTS_MAX_FEE_MINOR` | Reviewed non-negative kobo ceiling below the platform share |

For LIVE, the runtime must be Production, use the dedicated LIVE key/hash, and
have merchant KYC approval, Transfers via API permission and server IP allowlisting
confirmed through existing `FLUTTERWAVE_KYC_APPROVED`,
`FLUTTERWAVE_TRANSFER_CAPABILITY_CONFIRMED` and
`FLUTTERWAVE_SERVER_IP_WHITELIST_CONFIRMED` gates. The school needs a current
verified encrypted bank profile and matching `LIVE_VERIFIED` onboarding binding
under `EDUCORE_FLUTTERWAVE_MERCHANT_SCOPE`, not a TEST subaccount.

Provider reads must actually resolve the beneficiary, recognize its routing,
quote an acceptable fee and show enough **available** NGN transfer balance after
outstanding reservations. Ledger balance, checkout success, credential presence
and a collection subaccount ID do not prove spendable funds or payout permission.
The operator must arrange merchant NGN transfer-wallet funding through their
approved Flutterwave account; this feature does not move checkout settlements
between wallets, sweep bank accounts or create/fund payout subaccounts.

## Documented v3 API contract

Kept on the current integration's v3 API; not mixed with v4 payout orchestration.

- [Nigeria transfer guide](https://developer.flutterwave.com/v3.0/docs/nigerian-bank-account-transfer):
  KYC, API transfers, IP and NGN wallet funding prerequisites.
- [Create transfer](https://developer.flutterwave.com/v3.0/reference/create-a-transfer):
  `POST /v3/transfers`, actual `account_bank` + `account_number`,
  `amount:1900`, `currency:NGN`, `debit_currency:NGN`, unique reference.
  Neither a collection subaccount ID nor a payout subaccount ID is a bank
  destination. `debit_subaccount` would select a different PSA funding wallet;
  that flow is intentionally not implemented.
- [Wallet balances](https://developer.flutterwave.com/reference/get-all-wallet-balances):
  `GET /v3/balances`, use `available_balance`, not `ledger_balance`.
- [Transfer fee](https://developer.flutterwave.com/reference/get-transfer-fee):
  `GET /v3/transfers/fee?amount=1900&currency=NGN&type=account`.
- [Find transfer](https://developer.flutterwave.com/v3.0/reference/get-all-transfers)
  and [verify transfer ID](https://developer.flutterwave.com/v3.0/reference/get-a-transfer):
  reference filtering then independent ID readback.

## Verification limits

Tests use dummy keys, in-memory SQL fixtures and stubbed HTTP only. They cover
authorization/revocation, mode/hold/verification gates, immutable amount,
bank-profile changes, insufficient funding, concurrent confirmations, uncertain
commit/acceptance, reference/ID/currency/bank/amount mismatch, failure/success and
receipt attachment. They do not prove installed PostgreSQL constraints/locks,
actual Flutterwave merchant capability, available funds, bank credit, private
storage configuration or an authenticated-browser acceptance flow.

No new schema was applied, workflow restarted, real provider called, existing
financial record changed, Production data accessed or project published.
