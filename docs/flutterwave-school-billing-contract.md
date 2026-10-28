> **ARCHIVED split billing contract.** The old billing-context and split checkout cannot initiate payment. School Admins use the separate direct ₦3,200 platform payment. Current policy: `january-2027-no-split-payment-policy.md`.

# School dashboard LIVE billing contract

## Boundary

`GET /api/flutterwave/live/billing-context?schoolId=…` is authenticated, private
and no-store. Canonical active user, school and membership are checked in SQL;
Owner identities and other schools are refused. Existing school accountants can
read TEST selection only; LIVE student context and issuance require School Admin.
The request cannot select mode, actor, student, term or reference.

Server configuration selects TEST only when no LIVE release is selected.
Credential presence alone never selects LIVE. Partial/invalid LIVE configuration,
missing/disabled release manifest or missing schema/guards return UNAVAILABLE,
never TEST fallback. This endpoint does not enable configuration or call providers.

For a released LIVE runtime, the response supplies:

- current unique active session/term with numeric term ID and valid date range;
- currently active students belonging to the requested school;
- canonical LIVE merchant/school/student/term reference and persisted checkout URL;
- server-owned status and whether new checkout is allowed.

No legacy subscription ID, text-term association, TEST payment or browser return
is used to infer LIVE identity or success. VERIFIED requires the existing full
immutable issuance/evidence/receipt/activation predicate. Holds, incomplete
issuance, invalid authority, ambiguous candidates and uncertain checkout claims
cannot authorize a new charge. Retained ambiguous records are not repaired.

## Dashboard

The subscription page mounts legacy controls only for explicit server TEST mode.
Owner retains the existing read-only historical view. LIVE displays only the
scoped contract's students, numeric term, references and statuses. It polls every
10 seconds and offers manual refresh; failed refreshes disable the view instead
of trusting cached payment status. Cache identity includes the signed-in user.

A start action sends the numeric server identity to the existing LIVE checkout.
An attempt marker is saved before the POST. The UI does not navigate or claim
payment from that response; it reloads scoped server state and offers only a
validated persisted READY URL. Unknown outcomes are not automatically retried.
The marker survives reloads and blocks another POST while no server reference
has appeared. If an interrupted request never created a reference, administrator
reconciliation is required; this change does not invent an unsafe reset control.

The existing database uniqueness constraint prevents different administrators
from creating another intent for the same canonical merchant/school/student/
session/term identity. A new concurrent-administrator regression verifies this
without changing the engine. Existing identical-key replay and permanent
provider claims remain unchanged. Retained inconsistent session/term candidates
are displayed as reconciliation-required rather than offered for payment.
No DDL or history rewrite is needed.

## Refund identity

For standalone and `refund.completed` payloads, `id` is the refund identifier;
`TransactionId` is required as the original collection identity. A valid refund
ID may differ, but is never used as fallback collection identity. Existing
transaction/reference/provider-reference binding and protective hold behavior
remain unchanged. Distinct-ID and wrong/missing-original regression tests cover
this boundary. A refund notification is not proof of completed recovery.

## Verification and prerequisites

Targeted API coverage includes LIVE runtime/config/split authority, HTTP billing
authorization, real disposable PostgreSQL workflow/finalization, recovery and
refund parsing. Frontend coverage includes explicit TEST selection, LIVE/blocked
isolation, numeric identity, unknown/reload recovery, safe links and holds.
See the work report for executed counts; old historical test receipts do not
prove current deployment readiness.

No new migration is required. Existing LIVE schema/runtime migration drafts still
require separately approved installation if absent; none is applied to a shared
database by this work. Actual target readiness was not queried.

Before real operation, independently verify the LIVE merchant, Merchant fee
bearer, genuine school LIVE subaccount/ownership, distinct TEST/LIVE webhook
configuration, public callback/webhook URLs, release approval and transaction-
bound allocation report availability. The callback still returns verification
JSON; returning to the dashboard recovers status from the server. No redirect
creates payment evidence.

No Production access, secret inspection/changes, shared setting changes, LIVE
activation, real provider calls/charges, transfers or publishing are authorized
or performed by this implementation.

## Recorded billing-context/refund verification

Final targeted API pass: **223 passed, 0 failed across 8 files**:

- `lib/flutterwave-live-runtime.test.ts` — 37
- `lib/flutterwave-live-config.test.ts` — 37
- `lib/flutterwave-live-split-authority.test.ts` — 26
- `lib/flutterwave-live-finalization-event.test.ts` — 6
- `routes/flutterwave-school-billing.test.ts` — 4
- `services/flutterwave-live-workflow.e2e.postgres.test.ts` — 88
- `services/flutterwave-live-finalization-design.postgres.test.ts` — 21
- `services/flutterwave-live-lifecycle.recovery.test.ts` — 4

Paths above are under `artifacts/api-server/src/`. PostgreSQL tests create and
remove their own local fixtures; HTTP/provider responses are fictional.

Frontend pass: **27 passed, 0 failed across 4 files**, under
`artifacts/edupulse/src/`:

- `components/school-billing-dashboard.test.tsx` — 6
- `pages/subscriptions.test.tsx` — 9
- `pages/subscription-payment-helpers.test.ts`
- `components/live-subscription-access-status.test.tsx`

OpenAPI generation/shared-library build, API and web TypeScript checks, API build
and diff whitespace check passed. The public sign-in page rendered; this is not
authenticated dashboard/browser or real Flutterwave acceptance. No shared API
restart was requested against an unverified database target; rollout must run
the updated backend before the dashboard can consume the new endpoint. Until
then a missing endpoint safely disables school payment controls.

## Focused split-preservation and blocking follow-up

The user confirms there are currently no real schools. Fictional schools and
reviews used in disposable tests do not establish a real merchant/subaccount
binding or authorize LIVE release.

The model remains NGN 5,000 gross per student per term: NGN 1,900 to the school,
NGN 3,100 to Yetenia before provider fees, and an eligible Partner's NGN 100 only
as an internal accrued liability. Checkout has exactly one school subaccount,
not a third Partner recipient. Accrual is neither a payout nor Paid commission.
Without an eligible Partner, no Partner liability is created.

Existing runtime gates already require selected-school LIVE ownership evidence,
matching immutable review, unexpired authority and passing release/webhook/schema
checks before provider contact. No runtime or migration changes were necessary.
The workflow regressions now cover missing/other-school bindings, unverified
ownership or subaccounts, TEST/placeholder evidence, merchant/subaccount/school
scope mismatch, altered ownership-document hashes, non-merchant fee bearing,
disabled/incomplete release or webhook configuration, and missing/disabled target
release approval. Rejections assert no provider calls or checkout/financial
writes. Positive fictional fixtures assert the exact one-recipient checkout and
separate gross, fees and internal Partner liability, with and without eligibility.

Executed focused pass: **207 passed across 4 files**: workflow PostgreSQL (107),
runtime (37), configuration (37), split authority (26). API TypeScript and
whitespace checks passed. All SQL setup/mutations were confined to the existing
disposable test cluster; no shared database or migration files were changed.
No actual secret values, Production settings, deployments or providers were
accessed. This follow-up changed tests/documentation only, not activation state.

## Exact changed files

Application code:

- `artifacts/api-server/src/routes/flutterwave-school-billing.ts` (new)
- `artifacts/api-server/src/services/flutterwave-school-billing.ts` (new)
- `artifacts/api-server/src/routes/flutterwave-live-runtime.ts` (mount)
- `artifacts/api-server/src/lib/flutterwave-live-finalization-event.ts` (refund identity)
- `artifacts/edupulse/src/components/school-billing-dashboard.tsx` (new)
- `artifacts/edupulse/src/pages/subscriptions.tsx` (server-mode wrapper)

New or extended tests:

- `artifacts/api-server/src/routes/flutterwave-school-billing.test.ts`
- `artifacts/api-server/src/lib/flutterwave-live-finalization-event.test.ts`
- `artifacts/api-server/src/services/flutterwave-live-workflow.e2e.postgres.test.ts`
- `artifacts/api-server/src/services/flutterwave-live-finalization-design.postgres.test.ts`
- `artifacts/edupulse/src/components/school-billing-dashboard.test.tsx`
- `artifacts/edupulse/src/pages/subscriptions.test.tsx`

Contract and generated outputs:

- `lib/api-spec/flutterwave-school-billing.yaml` (new)
- `lib/api-spec/openapi.yaml`
- `lib/api-spec/orval.config.ts`
- `lib/api-client-react/src/generated/api.ts`
- `lib/api-client-react/src/generated/api.schemas.ts`
- `lib/api-zod/src/generated/api.ts`
- `lib/api-zod/src/generated/types/index.ts`
- `lib/api-zod/src/generated/types/getSchoolBillingContextParams.ts`
- `lib/api-zod/src/generated/types/schoolBillingContext.ts`
- `lib/api-zod/src/generated/types/schoolBillingContextMode.ts`
- `lib/api-zod/src/generated/types/schoolBillingStudent.ts`
- `lib/api-zod/src/generated/types/schoolBillingStudentStatus.ts`

This document is new. Existing checkout/verification/finalization engine and
migration files are unchanged.
