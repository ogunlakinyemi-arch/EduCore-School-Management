# Direct Flutterwave LIVE Readiness — preparation, not an operational release

## Entry and authority

An active global Platform Owner can open **Direct Flutterwave LIVE Readiness**
from the sidebar, Finance Workspace or Subscription & Payment Rules.
The new route is `/direct-flutterwave-live-readiness`.

Use existing school and academic-term choices and a Student rule proposal.
The amount is NGN 3,200 per student per academic term, wholly platform gross
revenue, subject to actual provider fees. School and BRO shares are zero.
Teacher/Staff NGN 2,000 rules and school-configured parent-facing fees are
independent and unchanged.

## Recorded workflow

1. **Readiness:** GET inspects public configuration status, exact HTTPS endpoint
   configuration, required schema/history guards, rule version/dates and a fresh
   read-only school/term reconciliation. It never saves, approves or pays.
2. **Create:** submit the current preview digest, an independently reviewed
   merchant evidence reference and SHA-256 commitment, explicit non-split
   confirmation, a reason and an expiry within seven days. The server recomputes
   facts. The request freezes the exact release, merchant/environment, endpoint
   identities, full-precision rule dates/version and reconciliation digest.
3. **Review:** an explicit POST records `REVIEWED`. Missing, mismatched or stale
   evidence cannot be approved.
4. **Final approval:** review the exact scope and explicit confirmations. A
   separate POST records `APPROVED` and binds the existing direct approval table
   to this lifecycle. If the Student proposal is a valid future-dated draft,
   this explicit decision schedules it; ordinary draft activation remains blocked.
   Overlapping Student rule windows are refused. No staff native rule changes.
5. **Withdraw/reject or expire:** decisions append history; nothing is overwritten.
   Expiry blocks checkout immediately even before an explicit expiry event is
   recorded. GET derives expiry without a write. A withdrawn or expired newer
   approval cannot reactivate an older approval.

The only transition policy is `NEW_ONLY_PRESERVE_LEGACY`. Legacy pending,
completed, waived, mixed or otherwise uncertain obligations stay excluded.
This workflow does not authorize converting or rebilling old NGN 5,000 records.

## API

All routes below `/api`, active global Owner only:

- `GET /platform/direct-student-live/readiness?schoolId=…&termId=…&ruleId=…`
- `GET /platform/direct-student-live/reviews?schoolId=…&termId=…&ruleId=…`
- `POST /platform/direct-student-live/reviews`
- `POST /platform/direct-student-live/reviews/:id/decisions`

Decisions require the exact evidence commitment, reason and explicit approval
confirmation. Transport failure is not rollback: refresh history, do not
automatically repeat a decision. Server audit and lifecycle records are saved
atomically. Legacy split approvals have no authority in this workflow.

## Independent operational gates — never set by this workflow

Configuration is inspected inside the server; secret values are never returned
or logged. These are **requirements to review later, not instructions to set
anything during this preparation**:

- Production server context and the existing LIVE mode selector.
- Dedicated LIVE key and dedicated LIVE webhook verifier; no TEST/generic fallback.
- Reviewed `EDUCORE_FLUTTERWAVE_MERCHANT_SCOPE`.
- `EDUCORE_FLUTTERWAVE_DIRECT_CALLBACK_URL`: approved public HTTPS URL ending in
  `/api/flutterwave/direct-student/callback`.
- `EDUCORE_FLUTTERWAVE_DIRECT_WEBHOOK_URL`: exactly the callback origin plus
  `/api/webhooks/flutterwave/direct-student`.
- Separately authorized direct runtime release `STUDENT_DIRECT_3200_V1`.

Merchant evidence must independently establish actual non-split routing and
dashboard webhook registration. Matching configured URLs and sending a payload
without subaccounts do not prove actual merchant settlement.

This is the **V3** API. Flutterwave's V3 documentation uses constant-time
`verif-hash` authentication; the V4 HMAC scheme is a different contract.
The dedicated direct endpoint rejects missing/wrong V3 authentication, then
independently fetches and matches transaction ID/reference, NGN amount and
charged amount. A browser redirect or webhook body alone never marks paid.
Documentation checked: https://developer.flutterwave.com/v3.0.0/docs/webhooks
and https://developer.flutterwave.com/v4/docs/webhooks .

Only verified `PAID` for the exact student/school/term satisfies platform access.
Card registration, school locks and security checks remain independent.
Assistance additionally requires exact saved bank-credit amount/date/reference,
verifier and matching bank-verification audit history. A verified transfer is
retained across controlled failed-attempt retries; uncertain or pending attempts
keep their permanent original reference and must be reconciled, never resent.

## Schema and offline validation

`0177_direct_student_live_release_reviews.sql` extends the existing `0176`
preparation with three append-only lifecycle/binding tables. It does not backfill,
reprice, convert or delete anything. Both drafts require separately authorized
target installation; neither is applied to an application database by this work.

- `env -i PATH="$PATH" HOME=/tmp NODE_ENV=test node scripts/src/owner-subscription-rules-native-check.mjs`
  verifies a private Unix-socket-only disposable PostgreSQL target, applies
  drafts there and exercises routed decisions and engine checks. It inherits
  no app/database/provider credentials. Synthetic reports/transport cannot prove
  actual merchant routing or real bank credit.
- `node scripts/src/direct-student-live-offline-review.mjs` checks the source/DDL
  boundaries and prints SHA-256 commitments without DB or provider access.
- OpenAPI codegen, focused UI/backend tests, package typechecks and builds are
  separate checks, not operational release approval.

Application services are not restarted by this task. New server endpoints require
a separately authorized restart/release after target schema installation. No
Production SQL, schema/data/secrets changes, real provider calls, charges or
publishing are authorized here.
