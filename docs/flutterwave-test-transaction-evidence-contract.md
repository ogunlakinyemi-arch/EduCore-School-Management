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

The **current provider adapter cannot emit `COMPLETE_VERIFIED` or `CONFIRMED`**.
The internal normalized comparator can exercise those cases with explicitly
synthetic unit inputs. Its `completeRecipientSet` flag is not a Flutterwave
field, not an HTTP input, and is never constructed by the current adapter.
Passing synthetic tests is not evidence of provider allocation.
`bankSettlementVerified` always remains false.

## Evidence to obtain from Flutterwave before extending the mapper

Under separate authorization, obtain official API/report documentation and a
redacted genuine TEST transaction-linked allocation report establishing:

1. Its provider-owned transaction ID and reference and NGN currency.
2. The unique school/eligible Partner subaccount identities and fixed allocated
   amounts, plus the merchant's own gross remainder or documented accounting
   identity establishing that remainder from a genuinely complete recipient set.
3. A documented guarantee of complete recipient coverage (including pagination,
   extra/duplicate recipients and reversals), not an inferred completeness flag.
4. Exact payer charge and separately defined fee/merchant-cost/VAT treatment,
   fee bearer and any deductions affecting recipient shares.
5. Report provenance and unambiguous distinction between allocated amount,
   settlement-net amount, refund/reversal and actual bank disbursement status.

A merchant dashboard export or Support statement can guide investigation, but
must not be automatically ingested until its format, authority, completeness
and transaction linkage are documented and implemented with negative tests.
Do not enable positive confirmation by simply accepting echoed `subaccounts`
or setting an internal completeness boolean to true.

## Fixed policy and permissions

Payer total remains NGN 5,000: school gross NGN 2,000; eligible Partner NGN 100
and platform gross NGN 2,900; without an eligible Partner, platform gross
NGN 3,000. Reported costs are separate platform expenses. No reader accounting,
allocation, receipt or payment-history writes occur.

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
tests invoke Express in-process with synthetic identity and mocked persistence.
Neither is real Clerk/browser acceptance or proof of provider/bank behavior.
Services, external calls and database writes remain prohibited in this task.
Actual signed-in browser acceptance requires separate permission to run services
and approved identities/fixtures; genuine TEST payment authorization is separate.
The UI also rejects unexpected/cached `CONFIRMED` or `COMPLETE_VERIFIED` results
from this collection-only contract, and hides stale details during refresh or
read failure. A future supported complete-report mapper requires explicit UI
contract review too, not just changing a backend flag.
