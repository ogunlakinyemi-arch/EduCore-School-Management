# Coordinated LIVE workflow — Development-only review

## Not an operational release

This increment implements the safe code, review-only SQL and isolated tests for
the six requested workstreams. It does **not** complete LIVE acceptance or enable
the product to collect LIVE subscriptions. No migration was applied to the
Development application database or Production. No actual provider request,
payment, refund, transfer, dashboard change, secret access/change, LIVE flag
change, Publish change, publishing or GitHub push was performed.

## Implemented boundaries

| Workstream | Implemented and fixture-tested | Still blocked |
| --- | --- | --- |
| Authoritative intents | Server-generated references; canonical school/student/session/term and active School Admin membership; frozen exact prices, reviewed LIVE school recipient, effective attribution/rule provenance; key-bound idempotency and immutable snapshots | Real recipient/merchant approval evidence; final operational payable-term, onboarding and access-policy acceptance |
| Independent verification | Separate read-only transport interface, hard-coded release gate before either reader, exact transaction and payer normalization, mandatory transaction-bound recipient report, explicit known fee components | Actual independently authenticated recipient-report contract/reader and approved LIVE evidence; transport remains unconditionally disabled |
| Activation and receipts | Same transaction as collection/event/accrual; separate LIVE activations and immutable receipt records; original-school identity; exact-scope, expiry-aware entitlement reader | Mounted LIVE issuer/receipt/access consumers and UI; no shared subscription is activated and no real official receipt is delivered |
| Partner accrual/approval/export | Eligible NGN100 internal accrual only; existing approval/export service dispatch recognizes explicit LIVE scope; Owner-only eligibility checks; current calendar term end; key-bound selections; audited export-only snapshots | LIVE lists/totals, approval UI and operational HTTP export contract; no transfer, Paid state or bank payout |
| Adverse holds/reconciliation | Matched signed adverse events hold activation/accrual, invalidate approved exports, retain original receipts and evidence; late success cannot release a hold; failures retain authenticated receipt-linked reconciliation cases | Operator case-review/resolution workflow, bank recovery/refund accounting and final acknowledgement policy |
| Verification | Native disposable PostgreSQL DDL and loopback HTTP/kernel tests, plus retained billing/provider/inbox/commission regressions | Existing-schema rehearsal and actual provider-to-app/bank acceptance; no authenticated production or Development browser-finance flow was tested |

### Money and disclosure

- Gross: NGN5,000. School checkout recipient: exactly NGN1,900.
- Merchant gross before costs: NGN3,100. Known provider costs are deducted from
  merchant proceeds; missing costs never become zero or invented VAT.
- Eligible Partner: NGN100 internal liability, not a checkout recipient. Without
  eligibility there is no Partner liability. Merchant cash and Owner economic
  net remain distinct.
- Payer-facing receipt snapshots exclude Owner-only allocation details.
- Receipt `verifiedAt` is the local verification timestamp. `paidAt` remains
  null: this implementation does not mislabel verification time as a separately
  evidenced provider payment time.
- Historical shared/SANDBOX payments, subscriptions, allocations and commission
  records are not relabelled or rewritten.

### Isolation and gates

Canonical academic identities, memberships and attribution/rules are read as
environment-neutral business metadata. Financial reads and writes use only the
separate LIVE namespace. TEST_READY recipient rows, SANDBOX collection evidence
and shared subscription financial history never supply LIVE financial authority.

`blockedLiveWorkflow` refuses before DB acquisition. No request parameter or
environment setting can enable the released service entry points. Only the
isolated test module injects a fixture capability. Separately, the verification
transport's hard-coded gate blocks both injected read callbacks, including in
fixture tests. The positive tests use a fictional independent verifier; they do
not unlock the actual transport.

The mounted LIVE callback remains receipt-only and returns a non-2xx refusal:
it is not wired to the coordinated kernel. Even successful fixture finalization
returns `operationallyProcessed: false`. A successful fixture HTTP pipeline
therefore still returns503 rather than claiming that release processing occurred.

Existing commission POST handling dispatches an explicitly LIVE-scoped request
to the blocked LIVE service rather than dropping its environment field in the
SANDBOX parser. The existing batch GET also handles an explicit environment
query: LIVE refuses503, invalid environments refuse400, and ordinary unchanged
requests retain the legacy Development/SANDBOX behavior. There is no LIVE batch
listing or UI selector, and numeric batch IDs alone are not a LIVE namespace.

### Atomicity, retention and holds

The coordinated kernel adds lifecycle callbacks inside the existing finalization
transaction. Collection evidence, semantic event, internal accrual, activation,
official-receipt record and receipt-result binding commit together. No caller
should use the lower-level design finalizer alone for operational processing.
LIVE approval additionally requires the coordinated activation and receipt, not
merely collection/accrual evidence.

Approvals and exports lock original intents before accruals/batches. They require
an active canonical Owner membership, exact LIVE merchant scope, successful
verified collection, no hold, eligible internal accrual, coordinated issuance and
the same authoritative term end still being past. Calendar changes therefore
fail closed rather than rewriting frozen financial history.

Reversal/refund/dispute holds never assert that a refund settled, a recovery
occurred, a payout executed or a chargeback was financially resolved. Already
exported external files cannot be recalled; the next export is blocked and the
stored batch becomes REVIEW_REQUIRED. Reconciliation cases are retained,
unresolved evidence. A successful retry does not silently erase them or release
an adverse hold; operator resolution remains a release blocker.

## Review-only migrations

Order:

1. `lib/db/dev-reconciliation/flutterwave-live-webhook-inbox.up.sql`
2. `lib/db/dev-reconciliation/flutterwave-live-finalization.up.sql`
3. `lib/db/dev-reconciliation/flutterwave-live-workflow.up.sql`

These drafts are not in the automatic migration journal. The third is additive:
new isolated authority reviews, activation/receipt/case/batch/audit tables and
nullable authority-snapshot columns on the isolated intent table. It neither
backfills existing design rows into authoritative operational intents nor changes
shared/SANDBOX tables. Its down draft refuses retained intent/review/case evidence;
empty rollback/reapply was executed only on disposable PostgreSQL.

The disposable canonical identity/calendar fixture is intentionally minimal, not
a rehearsal of the full current Development or Production schema. That rehearsal
and independently verified target approval are still required before applying
anything to an application database.

## Verification

The focused eight-file pass completed179 tests. A final approval eligibility
check additionally required coordinated activation/receipt evidence and exercised
the real legacy export HTTP environment guard; the affected two-file pass
contains56 tests, bringing distinct verified coverage to180 across eight files.

Coverage includes authoritative-scope denials, browser financial input rejection,
missing reviewed LIVE authority, effective-rule failure, Partner/no-Partner
money invariants, concurrent reservations/deliveries, original-school history,
receipt/audit rollback, commit loss before/after durability, term-end and
idempotency binding, wrong webhook authentication, missing/mismatched independent
evidence, refund-before/after-collection holds, batch invalidation, expiry-aware
entitlement, preserved shared history and safe rollback.

API/frontend typechecks and whitespace checks passed. The API workflow was
restarted; public Development sign-in rendering was visually checked. That
screenshot is not authenticated finance-flow or actual payment evidence. The
separate NFC hardware-test workflow was already failed on a required source
uniqueness check; it was not restarted or changed by this work.

## Required separate release decisions

Before any enablement: obtain reviewed merchant/school recipient authority and
transaction-bound provider split evidence; implement the real independent
recipient reader; rehearse against a verified historical schema; explicitly
approve application-target migrations; implement LIVE-aware access/receipt and
Owner/Partner UI consumers without shared-table fallback; complete operator
reconciliation/recovery and acknowledgement acceptance. Actual bank credits,
provider fees/VAT and payout permission need their own evidence.

Code preparation and fictional fixture results authorize none of those actions.
