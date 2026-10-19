# SCV2_fee TEST checkout investigation

## Evidence boundary

The user reported NGN 5,000 charged, NGN 70 merchant-paid fee and NGN 4,930 net,
with an SCV2_fee reference and a dashboard retry error. No matching reference
was found in the existing local log files searched. No database records or
provider API were consulted. Therefore the actual transaction's internal
allocation, webhook outcome, frozen-plan existence and recipient settlements
remain **unverified**. The retry error cannot be assigned an exact cause from
this evidence. A screenshot of gross/net totals cannot prove split allocation.

## Proven code defects and correction

1. The planner used reference-versioned school1900 instructions, but the
   Flutterwave adapter's instruction validator still required school2000.
   An enabled new-policy split therefore failed locally before provider POST.
   Validation now uses the same immutable-reference policy as the planner.
   Legacy unversioned references retain school2000 and cannot use new amounts.
2. The shared authenticated/guest hosted initializer accepted an undefined
   split plan. That return is possible with default-off settings or outside
   the Development-only split context, silently producing a platform-only
   provider checkout. New SCV2 checkouts now fail closed before initialization
   unless the existing preparation step supplies a frozen split plan.
   Legacy checkout fallback is unchanged. Existing migration, recipient,
   Partner eligibility and commission-rule guards are not bypassed.

This second correction intentionally blocks new-policy payments until reviewed
TEST split setup is ready; it does not enable settings, manufacture subaccounts,
apply migration 0167, retry a previously charged payment, issue transfers or
reassign an existing charge. The pre-provider failure retains the existing
safe reservation retry handling.

## Trace

- Authenticated subscription checkout and guest reservation generate
  SCV2_fee references from the adapter's fee_ reference, persist them in
  student_subscription_payments and call the same hosted initializer.
- prepareSplitCheckout locks the payment, checks settings/recipient approval,
  checks the version-aware database constraint and eligible effective-dated
  Partner rule, then freezes the exact plan. The adapter sends that reference
  unchanged as tx_ref and the plan as subaccounts, without accepting browser
  allocation metadata.
- Browser return processing and signed subscription webhooks resolve the
  persisted reference and independently verify the provider transaction.
  Both reach finalizeVerifiedStudentSubscriptionPayment. Return parameters
  and webhook payloads alone do not authorize an allocation.
- Finalization selects the policy from the locked persisted reference,
  validates any frozen split/provider evidence, and transactionally records
  credits, receipt, subscription snapshot and Partner ledger. Replays are
  idempotent. A missing effective Partner rule requires reconciliation.
- The NGN 70 is a separate PLATFORM_PROVIDER_FEE expense. School/Owner/Partner
  credits still total NGN 5,000: 1900/3000/100 or 1900/3100/0. Owner after this
  fee is 2930 or 3030 respectively. NGN 4,930 is the overall provider net,
  not the Owner's allocation. School and Partner must not bear another fee.
- The Owner split dashboard already uses server-supplied current-policy
  metadata and saved frozen rows. Its summary correction was not repeated.
  A platform-only payment without a flutterwave_split_payments row is not
  evidence of a settled recipient plan and will not appear in that list.
  Existing paid/internal-only records are not retroactively given a plan.

## Verification and remaining work

Focused tests exercise the real adapter with injected transport for exact
SCV2_fee instructions, eligible/no-Partner cases, rejection of cross-version
amounts and preservation of legacy amounts. Shared initializer tests cover
the unavailable-plan and missing-migration barriers without a provider call.
Finalization tests use the exact fee_ prefix, NGN 70 expense, NGN 4,930 provider
net, both allocation cases and replay preservation.

These are local regression tests with fictional database/provider responses,
not genuine provider or application-database acceptance. Existing migration
DDL evidence remains in the earlier subscription-policy handoff; no DDL or
financial schema changed here.

Verification completed: 129 tests across the six focused suites passed; API
typecheck and diff whitespace checks passed. Two stale test assertions were
aligned with the existing Owner-only disclosure boundary (empty public guest
allocations and omitted non-Owner subscription allocation snapshots); no server
visibility rule was relaxed.

The earlier Reporting Library/title-warning correction is present and its
completed tests/handoff were inspected, not repeated. Migration 0168 remains
unapplied. No publishing, Production data, payroll, secrets or Live keys were
changed by this investigation.

Before claiming recovery of the reported charge, an authorized later pass
must correlate its complete tx_ref and provider transaction ID with payment
state, frozen plan, persisted allocations/receipt, and signed verification
outcome. Actual disbursements require separate approved provider/recipient
evidence. Do not ask the payer to pay again or rewrite saved allocations to
make the dashboard look correct.
