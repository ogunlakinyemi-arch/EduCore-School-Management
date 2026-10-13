# Flutterwave TEST subaccount and checkout identity — 2026-10-13

## Scope and actual operation

This was a read-only investigation. The only new provider request was
`GET https://api.flutterwave.com/v3/subaccounts/26972` using the project's
dedicated Development TEST credential. No credential value was logged.
No subaccount update/creation, checkout initialization, payment, transfer,
school split-flag change, database operation, Live/Production change or
publication was performed.

Sanitized fresh provider evidence:
`reports/flutterwave-splits/subaccount-identity-investigation.json`.

## Exact creation values and provenance

* `business_name`: **Yetenia EduCore TEST ONLY Split Verification**
* `business_email`: **split-probe@example.test**

The saved original report records the fixture entity name and the successful
corrected creation. The executed `onboard-correct-email` path in
`artifacts/api-server/src/tools/flutterwave-sandbox-probe.ts` supplies that
literal reserved-domain email; its persisted private execution marker confirms
the correction path ran. `createRecipient` in
`artifacts/api-server/src/services/flutterwave-split-provider.ts` serializes
`entityName` as `business_name` and the supplied `businessEmail` as
`business_email`. These are traced values, not substitute values.

**Evidence limitation:** the historical HTTP capture saved projected responses,
not the creation request body or business email. The email is therefore
established by the executed deterministic code path, not independently echoed
by the historical provider response or today's GET.

## Fresh provider retrieval

Observed at **2026-10-13 02:29:04 UTC**:

| Field | Actual returned evidence |
|---|---|
| HTTP / envelope | 200 / `status: "success"`, `message: "Subaccount fetched"` |
| Numeric ID | `26972` |
| Subaccount reference | `RS_5F0DB5C736A2550E783A15B9EB9FBF09` |
| `business_name` | `Yetenia EduCore TEST ONLY Split Verification` |
| `business_email` | Field absent; not confirmed, not evidence of an empty/deleted email |
| Bank | `ACCESS BANK NIGERIA`, bank code `044`, country `NG` |
| Masked account | `••••••0031`; matched the original approved TEST fixture in memory |
| Default split | `split_type: "flat"`, `split_value: 3000` |
| Created | `2026-10-12T13:39:46.000Z` |
| Subaccount status / active flags | No such fields returned |
| Metadata | `null` |

The outer API `status: "success"` means the retrieval succeeded. It is not a
subaccount active-status field. The returned `full_name` is a different
bank-holder field and is omitted, not substituted for `business_name`.

## Checkout request versus main merchant identity

The existing initialization called `POST /v3/payments`, authorized by the same
main merchant dedicated TEST secret used for the subaccount API. It did not
authenticate as a subaccount.

The adapter's deterministic payload contains:

* The saved checkout reference, amount `5000`, currency `NGN` and redirect URL.
* `customer.name: "EDUCORE TEST ONLY"` and
  `customer.email: "split-probe@example.test"` — **payer/customer fields**,
  not merchant or subaccount business identity.
* `subaccounts[0].id: "RS_5F0DB5C736A2550E783A15B9EB9FBF09"`,
  `transaction_charge_type: "flat_subaccount"`, `transaction_charge: 2000`.

It sends **no** subaccount `business_name` or `business_email`, no main merchant
business-name field and no `customizations` object. Flutterwave Standard
documentation describes `subaccounts` as split-recipient IDs and `customizations`
as modal appearance options; a customization title would not prove merchant
ownership.

The genuine initialization returned HTTP 200, `status: "success"`,
`message: "Hosted Link"` and a `data` object whose sole key was `link`. It
provided **no merchant name or merchant ID**. Its private hosted URL is not
included here. The prior browser's unlabeled identity row cannot be reliably
classified as merchant versus customer from the saved observations alone.
The main merchant's displayed checkout identity therefore remains unverified.

## Recommendation

**Do not update the subaccount based on the unfamiliar checkout identity.**
Its retrieved business name already matches the submitted TEST label.
Flutterwave Support says that name is separate from the main merchant name;
renaming it would not establish who owns the main merchant checkout.

Next, verify the main merchant's TEST identity through its authenticated
Flutterwave dashboard or obtain provider confirmation linking the existing
checkout reference to the expected merchant. Supply the subaccount ID/reference
and checkout reference, not secret keys or a private hosted-link token.
Keep payment and split-mode enablement paused until that identity is established.

The documented update operation is **PUT `/v3/subaccounts/{id}`**, but no update
is indicated by the current name evidence, and none was called. Use it only
after explicit approval of the precise replacement values if a genuine
subaccount-label correction is later required.

## Official documentation reviewed

* [Fetch a collection subaccount](https://developer.flutterwave.com/v3.0.0/reference/fetch-a-single-subaccount)
* [Update a collection subaccount](https://developer.flutterwave.com/v3.0.0/reference/update-a-subaccount)
* [Flutterwave Standard](https://developer.flutterwave.com/v3.0.0/docs/flutterwave-standard-1)
* [Standard initialization API](https://developer.flutterwave.com/v3.0.0/reference/checkout)
