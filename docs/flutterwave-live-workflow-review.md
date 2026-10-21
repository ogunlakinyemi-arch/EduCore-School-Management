# Coordinated LIVE workflow — Development-only review

**Confirmed split follow-up (2026-10-21):** support's written fixed-subaccount /
Merchant fee-bearer model is accepted without changing deferred Partner policy.
Issuance and first activation now verify a canonical account-evidence document
against the immutable authority-review hash. No new migration is needed and
all operational gates remain closed. See the
[current activation checklist](flutterwave-live-confirmed-split-activation.md);
older "written split confirmation pending" statements below are superseded for
provider semantics only, not account settings or actual settlement evidence.

**Final minimal Development pass (2026-10-21):** see
“Final export and operational-recovery acceptance” below. Fresh checks:
**25 export tests and 11 focused native tests passed**, plus API/scripts
typechecks. The broader results below are reused baseline evidence, not a newly
rerun broad suite. LIVE remains disabled and settlement remains unverified.

**Latest review (2026-10-21):** see “Target-schema and family contracts” below and
[migration review](flutterwave-live-migration-review.md). Distinct acceptance:
**268 API tests / 11 executed files; 55 frontend tests / seven files**, with
38 existing opt-in API cases skipped. The earlier inventories and180/221-test
results below are historical preparation evidence, not current release permission.

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
4. `lib/db/dev-reconciliation/flutterwave-live-readiness.up.sql`

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

## Remaining workstreams 1–5 — 2026-10-20

### 1. Available settlement evidence — insufficient

Inspected existing local provider-evidence records/reviews and current
reconciliation/refund logic read-only. No provider request or application-database
query was made in this pass. This is not a fresh current-database inventory.

| Available evidence | Established | Not established |
| --- | --- | --- |
| `reports/software-remediation/flutterwave-readonly-evidence.json`, 2026-10-13 | Bank-catalog GET200, unauthenticated401; explicitly `settlementVerified:false` | Collection, beneficiary ownership, bank credit or refund/transfer permission |
| Archived Development inventory, reviewed2026-10-19 | Four historical SANDBOX payments: two PAID, one FAILED, one uncertain; no SCV3/frozen split evidence in that inspected inventory | Current inventory or any LIVE settlement |
| Archived TEST legacy read-back | NGN5,000 charge, NGN70 app fee, zero additional fee, aggregate NGN4,924.75 | Unexplained NGN5.25 difference; **not labelled VAT** |
| Archived TEST SCV2 read-back | NGN5,000 charge, aggregate NGN4,930 | NGN1,900 school credit, merchant credit, SCV3 policy or LIVE settlement |
| Archived settlement-list read | No usable response/statement obtained | Absence of settlements, permission denial or completed credits |
| Current split reconciliation/refund code | Separates expected allocation, provider reports, customer refund and recipient recovery | Real bank recovery from calculations or customer refund status alone |

Required external evidence: authenticated LIVE merchant identity; linked provider
transaction ID, application reference and provider reference; successful NGN5,000
principal **and payer charge**; transaction-bound report showing exactly one
approved school recipient receiving NGN1,900 and no Partner checkout recipient;
written merchant-specific fixed-charge/fee-order semantics; school/main-merchant
bank credits linked through transaction/settlement batches; complete actual fee,
tax/VAT, reserve and adjustment reconciliation from NGN3,100 merchant gross to
credited net. The historical NGN5.25 discrepancy requires actual provider evidence.

Refund/dispute closure additionally needs bound refund/dispute IDs, exact amounts,
currency, dates/status, customer disbursement and **separate** recipient recovery/
merchant adjustment evidence. Approval/export is not a transfer or Paid evidence.
No suitable transaction-linked LIVE bank evidence was found in the local material.
**Settlement remains unverified.**

### 2. Migration review

Added review-only stage4 after inbox → finalization → workflow. It strengthens
authority school/merchant/recipient FKs, verified collection/event identities and
authenticated event sources; adds access/FK-support indexes and immutable
operator-review audits. No shared-table DDL, status backfill or application-target
apply occurred.

A disposable concurrency test found a redundant fingerprint uniqueness constraint
conflicting with concurrent inbox upserts. The corrected FK uses the existing
provider/environment/fingerprint key, with a fixed FLUTTERWAVE event discriminator,
not a competing second uniqueness arbiter. Concurrent delivery then passed.
All new FKs validated in PostgreSQL; cross-school authority and invented sources
were rejected. Empty reverse stage4 → stage3/reapply passed; retained evidence
refused rollback. See the separate migration review for compatibility limits.

### 3. Gated application integration

Existing `readSchoolSubscription` and `assertSubscriptionAccess` accept an
explicit server-owned LIVE context. The released selector supplies none, and
cannot be enabled by env, HTTP, headers or school settings. Fixture injection
exercises the existing access-enforcement functions with actual SQL.

LIVE paid/access requires exact original school/student/term/merchant, authoritative
intent, successful collection, coordinated receipt, unexpired ACTIVE activation,
authenticated result/event binding and no hold. Receipt-only, pending and
collection-only records cannot grant paid status. Missing LIVE schema or ambiguous
calendar refuses access without shared TEST financial/cached-restriction fallback.
Independent manual locks still win; existing term grace policy remains.

The old persistent automatic-enforcement writer is explicitly blocked if a future
released selector chooses LIVE; it must not persist LIVE restrictions to an
unscoped shared store. LIVE waivers are not borrowed from shared financial rows.

The official-receipt reader is connected to the gated Owner API below. It whitelists
payer-safe fields, reports current hold/entitlement and preserves original receipts.
Legacy shared subscription/payment IDs and public student/parent UI routes cannot
be reused safely without explicit LIVE identity/authorization contracts. Those
public UI paths remain disabled. Universal app-wide LIVE activation is not claimed.

### 4. Development-only Owner review/recovery API

Paths relative to the API base; all require authenticated Owner permission and
remain hard-disabled in normal application construction:

- `GET /platform/live-readiness/receipts?merchantScope=...`
- `POST /platform/live-readiness/receipts/:receiptId/reviews?merchantScope=...`
- `GET /platform/live-readiness/receipts/:receiptId/official-receipt?merchantScope=...`

Actions: `REVIEW`, `CONFIRM_DURABILITY`, `RETRY`. Reasons cover pending, duplicate,
uncertain commit, refund, reversal and dispute. There is no Paid/transfer,
hold-release or financial-case-close action. This is an API surface, not an
enabled operator UI.

Bounded no-store reads recheck canonical active Owner authority. Other-merchant
verified records are excluded. Unmatched receipts have no verified merchant;
their audit namespace records the Owner's selection, not financial attribution.
Keys bind actor, receipt, action, reason and original-byte fingerprint. Audits are
append-only; concurrent/repeated keys create one record. Replays report **current**
protection, including holds occurring after an earlier successful review.

Retry requires original bytes matching the authenticated fingerprint, supplied
as canonical base64 and never stored as raw replay data. Claims cannot reconstruct
or authorize replay. Default independent verification remains disabled: retry
records `EVIDENCE_REQUIRED` without outbound calls. Only fixtures inject a fictional
verifier. Already complete results are confirmed without another verification;
held results stay held.

Finalization and operator audit have separate transactions. If finalization
commits but audit/response fails, retry independently reads the durable result
before recording confirmation. It never assumes rollback or repeats money
movement. Reconciliation cases are not erased. Operator API200 means a review
completed, **not** webhook acknowledgement or operational LIVE processing;
responses retain `operationallyProcessed:false`.

### 5. Final isolated acceptance

**221 tests passed across nine files** in one final relevant suite:

| Suite | Tests |
| --- | ---: |
| Coordinated LIVE workflow/application/operator/migration PostgreSQL and HTTP | 41 |
| LIVE finalization PostgreSQL | 20 |
| LIVE inbox PostgreSQL/HTTP | 12 |
| LIVE configuration/transport guards | 34 |
| Subscription billing | 42 |
| Existing subscription webhooks | 6 |
| Provider readiness | 10 |
| Deferred commissions PostgreSQL/HTTP | 34 |
| Term-enforcement policy | 22 |

The coordinated suite grew from22 to41 tests. It proves correct-child activation
once, receipt once, eligible NGN100 internal accrual, NGN5,000 principal/payer
charge, NGN1,900 school and NGN3,100 merchant gross before costs. It exercises the
actual gated router with fixture authentication and canonical SQL authority, not
a signed-in real Clerk finance browser.

Included: TEST/LIVE and merchant isolation, wrong-child denial, receipt/collection-
only refusal, pending/unknown state, missing schema, manual-lock precedence,
concurrent delivery/review, lost commits, exact-byte replay, adverse holds/export
invalidation, immutable history, FK validation and safe rollback.
API/frontend typechecks and diff checks passed. Development API restarted and
public sign-in rendering was checked. No unrelated whole-repository audit,
provider transaction, authenticated financial browser acceptance or bank
verification is claimed.

Remaining gates: real provider/recipient/bank evidence and reader; historical
target-schema rehearsal and separately approved migrations; explicit public LIVE
identity/UI/waiver/enforcement-persistence contracts; independently evidenced
financial case closure/recovery and final webhook acknowledgement acceptance.
Checkout, outbound verification/refund transport, dashboard delivery and LIVE flags
remain disabled. No secret, Production/Publish configuration or publishing change.

## Target-schema and family contracts (2026-10-21)

### Representative target migration safety

The new eight-test native suite initializes disposable PostgreSQL from the full
current source model: **184 tables, 690 FKs, 1,241 statements**. This replaces the
minimal-only compatibility gap with a source-derived representative rehearsal,
not certification of any application's actual catalog or migration ledger.

Untouched raw SQL **failed** at the `staff_nfc_subscriptions` supporting key.
Reordering the identical statement multiset passed. The separate historical
ownership guard still rejects three expected UNIQUE INDEX declarations now
declared as same-name/same-column UNIQUE constraints. Neither source declarations
nor that generic guard was changed. Exact fingerprints and limits are in
`flutterwave-live-migration-review.md`.

The four-stage stack adds14 LIVE tables,19 validated FKs and40 LIVE indexes.
Wrong ordering and duplicate up applies fail atomically; these remain one-shot,
unjournalled drafts. Empty stage4 → stage1 reverse/reapply passed. Retained
receipt/design-intent upgrade preserved all prior values, leaving new authority
fields null. All four downs refused retained evidence, and immutable review
audits refused update/deletion. Canonical columns/defaults, constraints/validation,
indexes and fictional shared history rows remained identical.

No application database was queried or migrated. Real target catalog/ledger/
historical-key compatibility and lock/preservation review still require a
separately authorized procedure and approval.

### Authenticated student/parent LIVE contracts

New explicit read: `GET /subscription-enforcement/live/me`, relative to API base.
The existing `GET /subscription-enforcement/me` uses the same contract **only**
when its server-owned source selects LIVE. The released selector still returns
no LIVE context. Requests, environment variables and dashboard settings cannot
enable it. An explicit disabled LIVE read returns503 before acquiring the LIVE
financial reader's DB connection; normal authentication still applies. It does
not dispatch to TEST.

Optional `studentId` and `audience=student|parent` narrow selection only. Browser
school/merchant/session/term/intent/shared-payment/shared-subscription IDs are
not accepted. Positive current canonical authority is mandatory: active app user;
own active student profile, or active parent profile and active child relationship.
Cross-school children additionally require the existing active PARENT membership
rule. Inaccessible and invented selected children both return404.

A pinned repeatable-read, read-only transaction binds identity, the child's
current-school/current-session/term, LIVE proof and manual lock. Missing or
ambiguous calendars, mismatched session, incomplete/missing/duplicate financial
records or missing LIVE schema cannot grant entitlement. School transfers never
move original-school money or receipts. Missing schema returns explicit unavailable
children without shared financial reads. Reads are no-store.

Family, school-enforcement and internal term-entitlement readers now share the
same proof predicate: one unambiguous LIVE intent in exact merchant/school/student/
term scope; matching canonical session and frozen authority; matching verified
collection amounts/reference; complete matching immutable official-receipt
snapshot; authenticated coordinated event/result; unexpired ACTIVE activation
and no hold. Neither an authenticated success receipt alone nor a collection-only
row is sufficient. Eligible Partner accounting remains in the atomic kernel.

Response extends the existing access DTO with explicit LIVE namespace, authorized
audiences, student name, `liveStatus`, `entitled` and payer-safe retained receipt
number. It does not expose provider IDs, fingerprints, merchant allocation,
Partner details or other children. Identity remains canonical student identity;
no legacy numeric payment/subscription ID translation was introduced.

| LIVE state | Meaning and UI behavior |
| --- | --- |
| PENDING | Authoritative intent awaiting complete verification; no paid entitlement; no “pay again” action |
| VERIFIED_ACTIVE | Full proof succeeds; independent manual school lock can still restrict use |
| FAILED | Authenticated failure **report** matching the intent reference; not independent financial verification, and never paid entitlement |
| REFUNDED_REVERSED | Adverse-event protective hold, including disputes; retained original receipt remains visible; not evidence of refund disbursement/recovery |
| UNAVAILABLE | Missing/ambiguous/incomplete/expired identity/calendar/proof/schema; cannot confirm verified entitlement |

The existing Student and Parent banner now renders these LIVE-specific states
instead of legacy unpaid/fully-active copy once LIVE data is selected. Audience
filtering uses server-authorized audiences. Query errors show unavailable and
hide stale success; existing refetch-on-mount/polling refreshes external changes.
Receipts alone never produce success. There is no checkout or retry-payment button.
Seven-day policy grace remains distinct from paid entitlement; manual locks still
win. No shared TEST waiver or persistent enforcement record supplies LIVE access.

This completes the **gated read-only family identity/state UI contract**, not an
operational public checkout/issuer, receipt PDF, LIVE waiver system or broad
school/Owner/Partner dashboard rollout. The shared automatic-enforcement writer
remains blocked for future LIVE selection until isolated persistence is approved.

### Exact verification

| API suite | Passed |
| --- | ---: |
| Coordinated workflow/application/operator/family PostgreSQL + HTTP | 60 |
| Representative target-schema migration PostgreSQL | 8 |
| LIVE finalization PostgreSQL | 20 |
| LIVE inbox PostgreSQL/HTTP | 12 |
| LIVE configuration/transport guards | 34 |
| Subscription billing | 42 |
| Existing subscription webhooks | 6 |
| Provider readiness | 10 |
| Deferred commissions PostgreSQL/HTTP | 34 |
| Term-enforcement policy | 22 |
| Existing enforcement routes | 20 |
| **Distinct API total** | **268** |

Nineteen new family tests cover self/parent matching, canonical deactivation,
cross-school memberships, relationship status, inaccessible404 masking, forbidden
selectors, disabled/non-Development/anonymous paths, proof completion, sibling/
merchant isolation, manual locks, refund/reversal/dispute holds and retained
receipts, transfer history, ambiguous calendars, wrong sessions, duplicate intents,
expiry, incomplete receipt snapshots and missing schema.

The selected twelve-file API run passed all268 assertions but the representative
suite exceeded its default ten-second cleanup hook. The test-only teardown
deadline was extended to60 seconds and its eight tests reran successfully; the
ten unaffected passing suites were not rerun. The twelfth file contains38 existing
application-database opt-in cases, deliberately skipped without enabling its
application-pool fixture.

Frontend: **55 tests across seven files**: seven LIVE state tests, four existing
banner tests,14 enforcement render tests, five enforcement helper tests,11 Parent
routing tests, nine subscriptions tests and five payment-helper tests. LIVE cases
include both audiences, contradictory entitlement, retained receipts, manual
locks, TEST exclusion, refreshed adverse status and query-error stale-data refusal.

Codegen, API/frontend typechecks, diff checks and Development API build/restart
passed. Public Development sign-in rendering was checked; no real signed-in
LIVE browser-finance flow or bank/provider acceptance is claimed.

### Unchanged external and release gates

No provider calls or new settlement evidence. The historical NGN5.25 difference
remains unexplained, **not VAT**. Required bank/provider evidence remains linked
school NGN1,900 and merchant credits, transaction/settlement IDs, actual fee/tax/
reserve reconciliation from NGN3,100 gross, merchant-specific fee ordering,
reviewed recipient authority and independently evidenced refund/recovery closure.

NGN5,000 payer charge, NGN1,900 school, NGN3,100 merchant gross before costs/taxes
and eligible NGN100 internal Partner accrual remain unchanged. Actual-target
migration approval, real recipient reader, operational enforcement/waiver policy,
financial recovery/closure and final webhook acknowledgement acceptance remain
separate gates. Checkout, provider verification/refund transport, webhook delivery
and every LIVE release flag remain hard-disabled. No secret/dashboard,
Production/Publish configuration, publishing or GitHub push change.

## Final export and operational-recovery acceptance

### Minimal software correction

The standard offline `export:schema:audit` command already used the existing
dependency-ordering graph. A stale prerequisite guard stopped it before that
ordering could run: three current same-name/same-column UNIQUE constraints were
still expected as historical UNIQUE indexes. Updated only those explicit expected
kinds, retained `historicalKind: unique_index` metadata, and kept strict rejection
of missing keys, wrong columns and unexpected future ownership changes. Neither
database schema declarations nor historical DDL were converted.

The standard command now exports **1,241 statements, 184 tables, 432 CHECKs and
690 FKs** successfully. All supporting keys precede dependent FKs. The exact
duplicate-aware statement multiset matches the earlier successful representative
rehearsal. Direct upstream raw output still has the known ordering defect and is
diagnostic only; no third-party library or Publish generator was patched.

### Small, targeted acceptance

- **25 tests passed** in the two existing export/required-key test files, including
  one added historical-ownership regression. Existing tests prove prerequisite
  order and unchanged statement multiplicity/semantics.
- **11 native tests passed across two files**;58 non-selected tests were skipped
  by the name filter, not failed or claimed as newly executed.
- Two native selections regenerated the full current representative schema,
  validated all690 canonical FKs, and applied the four drafts with14 LIVE tables,
  19 validated LIVE FKs and40 LIVE indexes.
- Nine workflow selections covered concurrent delivery, pending/uncertain review,
  exact-byte retry protection, operator audit loss before/after COMMIT,
  refund/reversal/dispute holds, and one new combined recovery case.
- The new case commits coordinated issuance but loses the COMMIT response.
  Duplicate HTTP webhook retries still return503 with `processed:false` and
  `operationallyProcessed:false`; confirmation records durability, not release
  acknowledgement. A later reversal holds the same liability; replayed review
  returns current HELD status. One collection, one original receipt and one review
  remain, unresolved reconciliation evidence is retained, and accrual stays HELD.
- API and scripts typechecks and diff checks passed. Reused the earlier268 API/
  55 frontend baseline and full rollback/preservation results; no redundant broad
  suite or unrelated audit. No runtime API/frontend code or schema draft changed,
  so the running Development API was not restarted.

### Remaining external inputs and authorization boundaries

For this final narrow scope, export ordering and isolated operational-recovery
acceptance are complete. External LIVE acceptance still needs authenticated
merchant/approved-school recipient evidence and the provider-owned transaction/
recipient reporting contract; transaction-linked school/main-merchant bank credits;
actual costs/taxes/reserves and an evidenced explanation of the historical
NGN5.25 discrepancy (**not assumed VAT**); and genuine refund/dispute disbursement/
recipient recovery and authenticated delivery evidence.

Actual-target catalog/ledger verification and any application migration require
separate authorization. These are approval boundaries, not proof of a software
failure. No unimplemented broad rollout is relabelled as an external blocker:
this pass does not claim provider-backed transport, waiver/persistence rollout
or LIVE enablement. Their intentional hard-disabled state remains unchanged.

NGN5,000 payer charge, NGN1,900 school, NGN3,100 merchant gross before costs/taxes
and eligible NGN100 internal Partner liability are unchanged. No application DB
was queried/migrated; no provider calls, money movement, secret/dashboard changes,
Production/Publish changes or publishing occurred.
