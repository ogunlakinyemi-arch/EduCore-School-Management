# Development TEST transaction evidence contract

## Sources and limits

This is an application contract, not a new Flutterwave response schema.
No documentation or provider endpoint was fetched during this restricted task.
The workspace's prior investigation documents reference official v3 transaction
verification and split/settlement documentation:

- https://developer.flutterwave.com/v3.0.0/reference/verify-transaction
- https://developer.flutterwave.com/v3.0/docs/split-payments
- Prior local context: `flutterwave-development-split-settlements.md`,
  `flutterwave-test-subaccount-investigation.md`.

Links are references, not evidence of a current endpoint response. This task
does not establish that Flutterwave never exposes allocation reports. It
establishes that no reliable complete allocation/report schema has been
substantiated in the available offline material. Do not invent one.

## Supported current reader

Only the existing v3 `GET /transactions/{id}/verify` adapter is used.
It unwraps the successful `data` envelope and consumes:

| Provider data field | What it can establish |
|---|---|
| `id`, `tx_ref` | Independent transaction identity and payment reference |
| `currency`, `status` | NGN and successful collection status |
| `amount` | Recorded NGN collection amount; must equal 5,000 |
| `charged_amount` | Exact payer charge; must equal 5,000 when present |
| `app_fee`, `merchant_fee` | Separately reported costs, only if valid monetary values |

Missing fees are not silently zero. Fees are not automatically called VAT, and
their sum/net calculation is not proof of merchant cash balance or actual fee
bearing. Missing exact charge/cost components prevent even a complete normalized
comparison from confirming allocation. The current reader never confirms it.

These fields provide **collection evidence, not recipient allocation evidence**.
`subaccounts`, `meta`, checkout instructions/links, success callbacks, locally
computed merchant remainder and locally frozen expected shares are not proof.
Unknown `recipients`, `allocations`, `completeRecipientSet`, or nested settlement
fields in verification data are ignored, even if they match the frozen plan.

No settlement GETs are made by this new reader. Earlier speculative mappings
using `report.subaccount_id`, `report.transactions` and transaction
`settlement_amount` were removed from this reader: their exact supported
semantics and completeness cannot be substantiated from this offline material.
The separate pre-existing legacy reconciliation/refund code was not changed;
its TEST report status is not promoted to complete transaction allocation proof.

## Classification returned to the UI

`evidenceLevel` is application-owned, never read from a provider payload:

| Evidence level | Status | Meaning |
|---|---|---|
| `UNAVAILABLE` | `UNCONFIRMED` | Provider read/configuration failure or insufficient valid transaction fields |
| `PARTIAL` | `UNCONFIRMED` | Matching independent collection identity/currency/status/amount; allocation remains unknown, even with reported fees |
| `MISMATCH` | `MISMATCH` | An observed contradiction in identity, charge, currency, amounts or normalized allocation; or inconsistent frozen policy |
| `COMPLETE_VERIFIED` | `CONFIRMED` | Reserved for a future substantiated complete independent allocation report plus matching charge/cost evidence |

The transaction-verification endpoint cannot emit `COMPLETE_VERIFIED` or `CONFIRMED`.
The internal normalized comparator can exercise those cases with explicitly
synthetic unit inputs. Its `completeRecipientSet` flag is not a Flutterwave
field, not an HTTP input, and is never constructed by the current adapter.
Passing synthetic tests is not evidence of provider allocation. A separate TEST
settlement-report reader may return `TEST_PROVIDER_REPORTED_COMPLETE` after exact
recipient/transaction matching; that label is provider-reported TEST evidence,
not actual bank credit. `bankSettlementVerified` always remains false.

## Evidence to obtain from Flutterwave before extending the mapper

Before treating report mapping as independently verified, obtain official
API/report documentation and a redacted genuine TEST transaction-linked report
establishing:

1. Its provider-owned transaction ID and reference and NGN currency.
2. For current SCV3, the unique school subaccount and fixed NGN 1,900 allocation,
   with no Partner checkout recipient; plus the NGN 3,100 merchant gross remainder
   from a genuinely complete recipient set. Historical SCV2 records remain separate.
3. A documented guarantee of complete recipient coverage (including pagination,
   extra/duplicate recipients and reversals), not an inferred completeness flag.
4. Exact payer charge, merchant-borne provider costs, and separately defined tax
   treatment. Support confirms the Merchant-borne fee model; the account's actual
   dashboard setting and whether tax is included remain unverified.
5. Report provenance and unambiguous distinction between allocated amount,
   settlement-net amount, refund/reversal and actual bank disbursement status.

A Support statement confirms the relevant report capabilities, but it does not
establish the exact record format or a specific transaction's allocations. A
merchant dashboard export must not be automatically ingested until its format,
authority, completeness and transaction linkage are documented and implemented
with negative tests.
Do not enable positive confirmation by simply accepting echoed `subaccounts`
or setting an internal completeness boolean to true.

## Fixed policy and permissions

Current SCV3 payer total remains NGN 5,000: school fixed checkout allocation
NGN 1,900 and merchant gross remainder NGN 3,100 before costs. An eligible
Partner's NGN 100 is an internal accrued payable, not a checkout recipient or
immediate payout; Owner economic share before provider costs is NGN 3,000 with
an eligible Partner and NGN 3,100 without one. Provider costs are Merchant-borne
per written support confirmation. The app does not inspect the actual merchant
dashboard setting or infer tax/VAT when it is not reported. Historical SCV2
allocations are preserved and are not reinterpreted as SCV3.
Support describes local settlement as typically T+1; this is a timing estimate,
not a guarantee or evidence that a specific bank credit arrived.

Authentication and Development gates precede access. Owner can read TEST
evidence; school financial readers are restricted to their school's payment.
Partner-only users cannot read the whole school's transaction evidence.
Owner-only existing-reference investigation requires both attestations, a review
note, BANK_RESOLVED state and exact supplied reference. Independent list and
individual entity/bank/reference/contact read-back must match. Missing contact
fails closed. Recovery of this intent remains pinned to the same reference via
a server prefix in the existing review note; it never becomes generic recovery
or a creation retry. Bank identity/ciphertext and historical bindings are not
rewritten. No migration is needed.

## Acceptance boundary

Offline React DOM tests render the actual screen with mocked signed-in identities
and API responses, exercising its query/cache and interaction behavior. Route
tests invoke Express in-process with synthetic identity, mocked persistence and
mocked provider responses. No Flutterwave calls, transactions, refunds, transfers,
application database writes or migrations were performed. Neither test type is
real Clerk/browser acceptance or proof of provider/bank behavior. The queried
Development schema was not independently matched to the running app's pool
target; verify that target and schema before any migration approval.
The UI also rejects unexpected/cached `CONFIRMED` or `COMPLETE_VERIFIED` results
from this collection-only contract, and hides stale details during refresh or
read failure. A future supported complete-report mapper requires explicit UI
contract review too, not just changing a backend flag.
