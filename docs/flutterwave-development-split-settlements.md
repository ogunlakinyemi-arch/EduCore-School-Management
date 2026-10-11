# Flutterwave split settlements — Development only

## Scope and verified baseline

This phase does not authorize live credentials, real-money payments/transfers,
live subaccounts, Production changes/migrations or publication.
There are no commercially onboarded schools. No invented school bank details,
demo recipients or platform bank substitutes were provisioned.

The earlier genuine TEST success and failure remain unchanged, including the
original paid receipt, failed-payment nonactivation and allocation history.
The additive initialization preserved all rows/fields of 20 existing financial
tables, with no excluded financial fields. See
`reports/flutterwave-splits/development-ddl.json`.
All five new tables started empty; all school split configurations default off.

## Exact proposed TEST collection model

Each checkout uses one server-frozen NGN 5,000 payment. Its `subaccounts` contain:

```json
[
  {"id":"<verified school RS ID>","transaction_charge_type":"flat_subaccount","transaction_charge":2000},
  {"id":"<verified eligible partner RS ID>","transaction_charge_type":"flat_subaccount","transaction_charge":100}
]
```

The partner entry is omitted only if the authoritative current, active
school/Partner attribution and effective commission rule establish that no
Partner is eligible. An eligible Partner with missing/unverified onboarding
blocks checkout; it does not increase the platform share.

The official detailed `flat_subaccount` example treats these as fixed recipient
amounts and leaves the residual to the main merchant. The documentation's
introductory descriptions are not fully consistent with that example.
**Multiple fixed recipients, actual fee bearing, and resulting disbursements
must still be confirmed with genuine provider evidence.**

School gross is 2,000; Partner gross is 100 where eligible; platform gross is
2,900 or 3,000. **Yetenia covers fees**, as selected by the user.
Checkout does not add a payer surcharge. Successful split finalization requires
independent confirmation that `charged_amount` is exactly NGN 5,000.
`app_fee` and `merchant_fee` are stored separately as platform expenses; platform
net subtracts both and confirmed proportional refund reversals. `merchant_fee`
is not automatically called VAT: VAT inclusion must be checked against provider
statements. Applicable Nigerian VAT on fees is generally 7.5%; do not fabricate
it when TEST reporting does not expose it separately.

This implementation is Nigeria/NGN only, not a claim that all Flutterwave
currencies or countries support this exact bank-recipient arrangement.
Automatic local settlement commonly follows T+1 business-day processing, but
merchant approval, automatic-settlement settings, recipient validation, holidays,
holds and account permissions can delay or prevent it. A paid collection is not
a completed recipient bank transfer.

## Onboarding and ownership

1. An authenticated School Admin or authorized Partner owner/finance member
   submits **their own** bank code, account number and contact phone, and attests
   ownership. The server derives the entity and legal display name from the
   actor's scope, not arbitrary browser recipient/financial instructions.
2. Genuine TEST bank resolution establishes the bank/account response, **not
   legal ownership**. Bank details are encrypted at rest with AES-GCM and a
   scoped key derived from `SESSION_SECRET`; only masked numbers are returned.
   Retain the encryption secret. Production requires reviewed key retention/
   rotation procedures before this design is approved for live use.
3. Owner checks appropriate bank/ownership documentation and that the account
   is distinct from Yetenia's own settlement account. The required review note
   and both confirmations precede a single TEST subaccount creation request.
   Distinct school/Partner recipients cannot reuse an active bank fingerprint.
4. An independent provider read-back must match the stored bank and provider
   identity before `TEST_READY`. Provider/bank resolution alone never claims
   real ownership or physical delivery.
5. A lost creation response becomes `CREATION_UNKNOWN`. Recovery is GET-only,
   requires a unique matching provider record, and never repeats creation.
   Recovery does not silently resume a suspended recipient.
6. Owner confirms automatic settlement and merchant-borne fees in the **TEST**
   dashboard before enabling future school split checkout. Checkout rechecks
   school/eligible-Partner readiness. Retiring preserves history; suspended
   recipients prevent new initialization, but an already-issued provider
   checkout may still complete and requires reconciliation.

The provider subaccount default `split_type: flat` uses a main-account commission
default; the fixed `flat_subaccount` checkout instructions explicitly override
that default. Do not omit the frozen instructions for a split-tagged payment.

## Binding, idempotency and financial integrity

School, student, academic session/term, subscription, payment reference, NGN
amounts, recipient IDs, attribution and rule are frozen together before checkout.
Database triggers protect recipient/snapshot identity and settlement binding.
Browser bank-submission schemas reject injected amounts, IDs and extra fields.

Finalization uses the frozen attribution/rule, checks current eligibility and
independent provider reference/transaction/amount/currency evidence, and requires
complete reported fee components. Missing, changed or mismatched evidence
requires reconciliation rather than activation or new credits.
The original verified finalizer still owns receipts and allocations atomically.
Failures do not create successful allocations; replay cannot duplicate them.
Split-bound Partner commissions are HELD outside the separate manual payout
path, and the Owner status-release endpoint rejects those commissions.
No new provider transfer endpoint is called.

## Settlement, refunds and chargebacks

The scoped page is reachable from Subscriptions/main navigation and Partner
Payouts. It distinguishes collection status, original gross shares, reported
fees/net, recipient expected/observed amounts and reconciliation exceptions.
Dashboard caches are isolated by signed-in identity.

Settlement reconciliation reads provider reports only. Completion requires an
exact transaction/reference, NGN currency, recipient account/code and fixed
recipient amount, plus completed/successful status and processed/disbursement
evidence. Missing reports, ambiguous matches, pagination, failed/flagged batches,
wrong bank/amount or refund/chargeback deductions require review.
Even `TEST_PROVIDER_REPORTED_COMPLETE` is not proof of a real bank deposit.

Owner-only TEST refunds reserve the remaining amount and persist intent before
one provider POST. Same-key retries reuse that intent; pending/unknown refunds
reserve their balance. A lost response is `OUTCOME_UNKNOWN`, never auto-resubmitted.
Owner must reconcile an uncertain refund ID in the TEST dashboard; this phase
does not invent an ID or claim that absence of a response means rejection.

Submission status `completed` is only initiation. Independent refund verification
must match the refund ID, transaction and amount and return a terminal bank/
processor completion before an append-only adjustment is CONFIRMED. Cumulative
proportional rounding conserves every kobo. Full confirmed refund deactivates
only the still-bound subscription; partial refund does not claim full cancellation.
Original receipts/allocations remain historical records, not deleted or rewritten.
The net shown is an allocation calculation after reported costs/policy reversals,
not a verified merchant cash balance. Existing historical financial rollups are
not bank statements. Validate all NFC entitlement views after refunds and add
reviewed recovery/cash reconciliation before any live rollout.

Confirmed customer refunds create school/Partner **recovery review** amounts.
They are not automatic bank clawbacks. Provider refunds can debit the main
merchant balance even after recipients were settled. Before live use, approve
refund authority, merchant liquidity/top-up, recipient recovery/consent,
fee/VAT reversibility and bad-debt accounting procedures.
Chargeback deductions are surfaced for transaction-level reconciliation; do not
guess which payment a batch deduction belongs to or automatically debit unrelated
recipients. Live dispute evidence/deadlines and recovery operations require
separate approved provider/account procedures.

## Evidence and remaining gates

* Standard unit suites: 146 passing tests, provider/SQL mocks explicitly labelled.
* Disposable PostgreSQL-backed unit tests: 12 passing cases against the actual
  schema plus additive DDL. Provider HTTP is mocked **only in those unit tests**.
  They cover eligibility, immutable/foreign bindings, missing recipients, real
  finalizer/replay/failure, reporting mismatch and partial/full refund recovery.
* Genuine read-only TEST probe: settlement listing available with zero records;
  subaccount listing returned **HTTP 400: “Subaccounts not found.”** This is not
  evidence of permission denial or proof that creation will be allowed. No
  recipient creation or money mutation was attempted.
* The repository still has unrelated curriculum/school-messaging type errors;
  the changed split backend/frontend files have no reported type errors.
* Read-only authenticated School Admin browser verification passed through
  Finance → Subscriptions → Split settlements and the More menu at
  `/flutterwave-settlements`. The real scoped dashboard returned HTTP 200.
  TEST warnings/rules, empty recipient/payment views, own-scope school choices
  and blank-form/attestation submission gating were verified at desktop and
  390×844 phone sizes without horizontal overflow or frontend/hook errors.
  The checkbox sizing issue found in that pass was corrected using explicit
  dimensions, and form validation was aligned with the backend. No bank/provider
  writes were made; ordinary sign-in/session audit may have appended.
  Owner/Partner signed-in screens remain unverified in a browser.

Manual/provider prerequisites: obtain each real authorized recipient's own bank
details and ownership evidence; confirm Flutterwave TEST subaccount API access/
merchant KYC/permissions; confirm automatic settlement and merchant-borne fees;
create/read back the authorized TEST recipients; demonstrate one/two-recipient
fixed routing and exact costs using genuine TEST payments; obtain matching
recipient settlement reports. Only then can genuine split verification be claimed.
No Production-ready or real-bank-delivery claim is made.

Official references reviewed: Flutterwave's split-payment, subaccount create/
list/read-back, transaction verification, refund and settlement API documentation,
and Nigerian fees/VAT pricing. Primary entry points:
<https://developer.flutterwave.com/docs/split-payment>,
<https://developer.flutterwave.com/docs/refunds>,
<https://developer.flutterwave.com/reference>,
<https://flutterwave.com/ng/pricing>.
