# Fee payment provider adapter integration

This directory is deliberately separate from finance routes and persistence. It
does not read environment variables, create database records, or make a payment
successful based on a browser redirect or webhook payload alone. No credentials
are committed. Adapter contract tests use mocked HTTP and never contact a
provider; they are not sandbox transaction verification. No Paystack key is
present or required for this development pass.

## Interface

`PaymentProviderAdapter` in `index.ts` exposes:

- `initializePayment(input: InitializePaymentInput): Promise<InitializePaymentResult>`
- `verifyPayment(input: VerifyPaymentInput): Promise<VerifiedPayment>`
- `handleWebhook(input: WebhookInput): Promise<WebhookResult>`
- `getPaymentStatus(input: VerifyPaymentInput): Promise<FeePaymentStatus>`
- `generateReference(): string`
- `validateAmount(amountMinor: number, currency: string): boolean`

`ExpectedPayment` is the application-owned payment tuple: exact internal
`reference`, positive integer `amountMinor`, and `currency`. Persist that tuple
before calling `initializePayment`, and pass the persisted tuple (not values
from the browser or webhook) to `verifyPayment`. Paystack verifies by reference;
Flutterwave additionally requires `providerTransactionId` from its event.
`getPaymentStatus` performs a fresh provider verification and returns its
normalized status.

`handleWebhook` requires the exact raw request body, provider headers, and a
`resolveExpectedPayment(reference)` lookup into application persistence. It
returns an immutable `{ outcome: "verified", eventId, payment }`; it has no
replay store, claim callback, or settlement side effect. `eventId` is
deterministically `paystack:<verified transaction ID>` or
`flutterwave:<verified transaction ID>`. It remains the same for redelivery of
the same provider transaction.

The caller must claim that identity and settle the payment in one database
transaction. A typical contract is: begin transaction; insert
`(provider,eventId)` into a table with a unique constraint; if already present,
commit/no-op; otherwise apply the payment settlement and commit. The event-key
insert and settlement must roll back together. If the process crashes before
commit, both roll back and a provider retry returns the same `eventId`, so the
caller can settle it. If commit succeeds but the response is lost, a retry
returns the same identity and the unique key prevents a second settlement.
Never mark the event consumed before the associated payment settlement commits.
The adapter independently verifies the transaction on every webhook delivery.

## Config and transport

Instantiate `PaystackTestAdapter` with `{ secretKey }` and
`FlutterwaveTestAdapter` with `{ secretKey, webhookSecret }`. The constructors
reject absent, malformed, or live-mode key formats. Supply secrets from the
server's secret manager at adapter construction; never send them to the browser,
log them, or include them in error responses. Paystack accepts the `sk_test_`
key format; Flutterwave accepts `FLWSECK_TEST-`. Paystack signs webhooks with
the same server-side secret key used for API authorization. Flutterwave's
`webhookSecret` is the configured verification hash (`verif-hash`), not an
assumed HMAC key.

The factory returns `null` when the corresponding server-side test secret is
missing. In particular, no Paystack key is requested, fabricated, included in
tests, or needed to load the application. Paystack initialization, verification,
and real webhook verification remain unverified without an externally supplied
test credential and provider sandbox transaction.

Outbound requests use fixed HTTPS API origins only:

- Paystack: `https://api.paystack.co/`
- Flutterwave: `https://api.flutterwave.com/v3/`

Requests reject redirects, use a bounded timeout (8 seconds by default; maximum
30 seconds), and do not expose provider response bodies in errors. Checkout
links are restricted to `checkout.paystack.com` and `checkout.flutterwave.com`.
The adapters only accept supported currency codes (`NGN`, `USD`, `GBP`, `EUR`,
`ZAR`, `GHS`, `KES`, `UGX`, `XAF`, `XOF`). `amountMinor` is an integer in the
currency's minor units; no floating point input is accepted for initialization.

Paystack webhooks validate `x-paystack-signature` as HMAC-SHA512 over the
original raw bytes, then fetch `/transaction/verify/:reference`. Flutterwave
validates `verif-hash`, then fetches `/transactions/:id/verify`. Both paths
compare provider status, the signed webhook transaction ID against the
server-verified transaction ID, exact internal reference, amount, and currency
with the application's persisted expected payment. Flutterwave decimal amounts
are parsed as base-10 decimal strings into integer minor units without binary
floating-point multiplication. Verification failures are errors, not
successful payments.

Configure the webhook route to capture the original bytes before a JSON body
parser consumes them (for Express, mount an `express.raw({ type: "application/json" })`
handler on the webhook path before `express.json()`). Pass those bytes unchanged
as `rawBody`. Never recreate the signed payload by serializing parsed JSON.

## Remita and automatic bank transfer

`RemitaAdapter` preserves the common interface but deliberately rejects
initialization, verification, webhook handling, and status lookup. Enable it
only after independently validating the official Remita integration contract,
signature/verification requirements, and sandbox. It never simulates success.

The current `PaymentProviderAdapter` has no virtual/dedicated-account creation
or account-assignment capability, and no provider implements one. Manual school
bank transfer is a distinct finance workflow; it is not automatic transfer
reconciliation. Do not advertise an automatic bank-transfer capability until a
provider-specific contract, provisioning operation, reference policy, webhook
verification, and independently verified sandbox integration have been added.

## Tests

Run from `artifacts/api-server`:

```sh
pnpm exec vitest run src/lib/fee-providers/index.test.ts
```

Tests inject mock HTTP responses and never contact providers. They cover
Flutterwave verification, case-insensitive header names, normalized
reference/amount/currency/status behavior, decimal amount parsing,
transaction-ID validation, absent Paystack test-secret behavior, and Remita
fail-closed behavior. These tests do not constitute Paystack sandbox
verification; Paystack sandbox verification remains pending an external test
credential.

## Provider references

- [Paystack transaction API](https://paystack.com/docs/api/transaction)
- [Paystack webhooks](https://paystack.com/docs/payments/webhooks)
- [Flutterwave webhooks](https://developer.flutterwave.com/docs/webhooks)
- [Flutterwave transaction verification](https://developer.flutterwave.com/v3.0/docs/transaction-verification)