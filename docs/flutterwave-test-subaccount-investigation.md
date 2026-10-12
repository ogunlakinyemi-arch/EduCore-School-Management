# Flutterwave TEST collection-subaccount investigation

## Subsequent support confirmation and current gate

The user subsequently relayed Flutterwave Support confirmation that TEST
collection-subaccount creation needs no special enablement, NGN flat splits are
supported, split payments require automatic settlement, VAT is 7.5% of the fee
on successful split payments, and the earlier no-records HTTP 400 is consistent
with no existing subaccounts. The earlier entitlement uncertainty below records
the investigation before this confirmation, not the current support position.

Current documentation explicitly permits published TEST bank accounts for
collection subaccounts. Access Bank `044` / `0690000031` is explicitly labelled
TEST-only on the official testing page; it is not an invented commercial
recipient. The existing onboarding supplies the required create fields but its
school/Partner ownership review must not be falsified for a provider-only fixture.

Dashboard inspection in this session rendered Flutterwave's sign-in page, not
the merchant's TEST settlement settings. No documented read-only v3 settings
operation was identified in the reviewed references/index. Automatic settlement
therefore remains unchecked; a successful settlement-list API call cannot prove
the setting. Creation is paused for TEST dashboard confirmation. No creation
POST, new authenticated provider probe, recipient read-back, payment, transfer,
EduCore split-mode change or Production action was performed in this follow-up.

The user subsequently reported that TEST settlement mode is still unverified.
Their screenshot shows transfer and collection preferences, not the earnings
settlement selection. Current Flutterwave help guidance directs merchants to
Settings → Business Preference → About → “How do you want to get your earnings?”
The displayed choices are “Settle to my bank account” and “Settle to my payout
balance,” not necessarily literal automatic/manual labels. The official
[manual-settlement guide](https://www.flutterwave.com/ng/support/payments/manual-settlements)
describes payout-balance settlement followed by merchant-initiated transfers as
the alternative to default automatic bank settlement. Inspect the selected choice
in TEST mode without clicking another radio button or saving any change.

## Conclusion and confidence

The list request matches the official v3 collection-subaccount API. Neither a
wrong endpoint/method nor a missing `page` parameter was found. Flutterwave reports
no subaccounts for the supplied dedicated TEST credential. An empty TEST merchant
collection-subaccount scope is the best-supported explanation, **not a proven
permission or API-version blocker**.

This is deliberately narrower than asserting the account is empty with certainty:
the provider returned an error with null data, not a successful array/count. The
official list reference documents HTTP 400 but does not explain this exact message.
No public read-only permission/introspection endpoint was identified in the
reviewed collection-subaccount documentation. Listing cannot establish whether
POST creation will be accepted for this merchant.

## Genuine provider evidence

Read-only observations began at 2026-10-11 20:39:17 UTC. Full safe projection:
`reports/flutterwave-splits/provider-read-investigation.json`.

| Request | Parameters/body | HTTP | Sanitized response |
|---|---|---|---|
| GET `https://api.flutterwave.com/v3/subaccounts` | No query filters; no body | 400 | `{"status":"error","message":"Subaccounts not found","data":null}` |
| GET `https://api.flutterwave.com/v3/subaccounts?page=1` | Only `page=1`; no body | 400 | Same response |
| GET `https://api.flutterwave.com/v3/settlements?page=1` | Only `page=1`; no body | 200 | `{"status":"success","message":"Settlements fetched","data":[]}` |

Headers: `Authorization: Bearer [REDACTED TEST credential]`,
`Content-Type: application/json`, `Accept: application/json`.
Only dedicated Development TEST aliases are accepted; no generic/live credential
is accessed. No bank filters, account numbers, recipient IDs, key values or raw
record payloads are logged. These were actual provider responses, not app mocks.

## Causes assessed

* **Incorrect request:** endpoint/method/auth scheme match v3. Filters
  `account_bank`, `account_number`, `bank_name` are optional in the reference;
  documentation example/default values must not be silently sent as real filters.
  Explicit page 1 did not alter the result.
* **Unsupported version:** no evidence. The adapter uses `/v3/` with a v3 TEST
  secret bearer credential. Version labels v3.0/v3.0.0 in the documentation still
  describe `/v3/subaccounts`. Do not migrate to v4 or replace authentication in
  response to this message. A v4 beta banner is not a v3 deprecation notice.
* **Missing permissions:** unproven. No 401/403 was observed. Settlement-list
  authentication succeeded, but that does not grant/prove subaccount POST rights.
* **Unavailable TEST feature:** not supported as a general conclusion. The
  official split guide explicitly allows TEST subaccount creation with published
  test bank accounts. Account-specific restrictions still require confirmation.
* **Empty account/scope:** most consistent with the provider's no-record message,
  no earlier recipient creation, and the identical unfiltered/page-one responses.
  The merchant's own TEST dashboard or Flutterwave must confirm this interpretation.

## Creation contract

Official v3 operation: POST `https://api.flutterwave.com/v3/subaccounts`, JSON body,
secret bearer authorization. For this Nigeria/NGN bank-recipient implementation:

Required fields in the create reference:
`account_bank`, `account_number`, `business_name`, `country`, `split_value`,
`business_mobile`.

`split_type` is documented as optional (default `percentage`); our payload
explicitly sends `flat`. Optional contact fields include `business_email`,
`business_contact`, `business_contact_mobile`, and `meta`. Other countries can
require extra banking metadata; this code remains Nigeria-only.

The existing create payload supplies all documented required fields. Its default
main-merchant flat commission is 3,000 for a school or 4,900 for a Partner; frozen
checkout instructions override defaults. No missing required create field explains
a prior GET-list result because creation has not been attempted.

The single-recipient detailed override example supports:
`{"id":"<verified TEST RS ID>","transaction_charge_type":"flat_subaccount","transaction_charge":2000}`.
For a TEST 5,000 transaction, expected recipient gross is 2,000 and merchant gross
3,000 before merchant-borne costs. The same guide contains conflicting introductory
descriptions of flat semantics; require a genuine fixed-share report, not merely
a successful checkout. Two fixed recipients (school 2,000/Partner 100) remain a
separate unverified step.

## Development code changes and automated evidence

* Diagnostics now distinguish `NO_RECORDS_REPORTED`, `EMPTY_LIST_REPORTED`,
  `LIST_READ_CONFIRMED` and `UNVERIFIED_ERROR`. None claims creation permission.
  Both original and explicit-page requests are logged as sanitized projections.
  A message allowlist omits unknown/private messages and never emits record data.
* Recovery now prefers the documented `business_name`; `full_name` can be a
  different bank-holder name. The old equality could reject an otherwise matching
  existing recipient after a lost create response. Legacy fallback is used only
  when `business_name` is absent. Incomplete paginated recovery requires review.
  This was a genuine code defect, **not the cause of the empty-list HTTP 400**.
* Added four mocked unit cases for no-record versus permission/error diagnosis,
  secret/bank redaction, different business/bank-holder names, and pagination/
  wrong-business rejection. Accidental default network calls fail in that suite.
* Annotated settlement-read return type to retain its arbitrary provider fields
  when preserving pagination metadata.
* All six existing suites plus new cases: **150 tests passed**. These are
  provider/SQL-mocked unit tests, not genuine onboarding/settlement proof.
  The earlier 12 disposable-PostgreSQL checks were not rerun for this investigation.
  Backend typecheck retains only three unrelated existing curriculum/messaging
  test errors; no split implementation/test errors remain.

No recipients, payment/transfer/refund operations, school flags, financial records,
database schema, Production settings or publication were changed.

## Precise next actions

1. In the merchant's **TEST** Flutterwave dashboard, inspect collection subaccounts
   without creating any. Confirm whether the list is empty.
2. For account-specific certainty, use Flutterwave's official support request
   channel with the merchant ID from the authenticated dashboard, the UTC
   observation time and sanitized responses above—**not API keys or bank details**:

   > Our v3 TEST GET /subaccounts, both unfiltered and with page=1, returns HTTP 400
   > {"status":"error","message":"Subaccounts not found","data":null}; GET
   > /settlements?page=1 succeeds with an empty list. Is this your empty-list
   > response for our TEST merchant? Please confirm POST /v3/subaccounts collection
   > creation and NGN fixed flat_subaccount checkout overrides are available for
   > this TEST merchant. If any merchant entitlement, KYC review or sandbox
   > enablement is required, name the exact requirement and action. Confirm
   > merchant-borne fee/VAT handling, one-recipient fixed gross shares and whether
   > TEST recipient settlement/disbursement reports are simulated/available.
   > Do not change Live settings or credentials.

   This asks whether enablement is needed; it does not falsely assert it is missing.
3. Obtain explicit approval for **one isolated provider-only TEST recipient and
   one sandbox transaction**. A published Flutterwave test bank fixture must be
   labelled as such and kept outside EduCore's real-school/Partner ownership
   records and existing student financial history. Do not invent ownership
   attestations to put a test fixture through the real-entity onboarding form.
   Alternatively, use an authorized pilot's own details and genuine ownership
   review through the existing school/Partner submission flow.
4. Only after approval: make one TEST create POST with the required fields,
   persist its returned numeric ID/RS ID, and independently GET `/subaccounts/{id}`
   to match the bank and business identity. If the POST outcome is uncertain,
   reconcile read-only rather than repeat it.
5. With explicit sandbox-payment approval, use a standalone provider-only
   5,000 NGN TEST checkout with the verified recipient ID and fixed 2,000 override.
   **EduCore school split flags remain off.** Independently verify `tx_ref`,
   transaction ID, currency, amount, charged amount exactly 5,000, fees/VAT and
   recipient report amount 2,000/merchant residual. Do not claim actual bank
   delivery; request provider clarification if TEST reports are unavailable.

## Official references reviewed

* [v3 fetch all collection subaccounts](https://developer.flutterwave.com/v3.0.0/reference/fetch-all-subaccounts)
* [v3 create collection subaccount](https://developer.flutterwave.com/v3.0.0/reference/create-a-sub-account)
* [v3 fetch one collection subaccount](https://developer.flutterwave.com/v3.0.0/reference/fetch-a-single-subaccount)
* [v3 split payments, TEST creation and detailed overrides](https://developer.flutterwave.com/v3.0/docs/split-payments)
* [v3 authentication](https://developer.flutterwave.com/v3.0.0/docs/authentication)
* [v3 testing and published bank fixtures](https://developer.flutterwave.com/v3.0.0/docs/testing)
* [Flutterwave official support request](https://flutterwave.com/support/submit-request)
