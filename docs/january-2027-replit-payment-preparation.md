# January 2027 direct-payment preparation — Replit retained

Review: **28 October 2026**. Status: **app hardening verified locally; LIVE remains
blocked**. Application and current database hosting remain on Replit. No
provisioning, credential change, Production connection/SQL/migration, financial
data change, publishing, Production redeployment or real payment occurred.
No Agent task was in progress at the initial check.

The ₦3,200 per-student-per-academic-term direct collection, zero school/BRO split,
independent BRO expense, Option A, school-specific rollout, audit, idempotency
and retained history are unchanged. No readiness gate was relaxed.

## Official Flutterwave requirements checked

Fetched on this review date:

- https://developer.flutterwave.com/v3.0.0/docs/webhooks
- https://developer.flutterwave.com/v3.0.0/docs/transaction-verification

The current V3 webhook guide specifies a shared `verif-hash`, checked with
constant-time comparison; missing or mismatched hashes must be rejected. Do not
replace this with V4 HMAC on the assumption that “signature” means another
version. Actual merchant/dashboard version and secret binding need independent
evidence; no real secret values were inspected.

Before granting value, perform server-side transaction verification and match
transaction reference, successful status, currency and amount. The documented
endpoint is `GET https://api.flutterwave.com/v3/transactions/{id}/verify`,
authenticated with the server's secret key. A browser redirect or authenticated
webhook supplies identifiers, not proof of payment.

The guide requires **HTTP 200** to acknowledge receipt, a **60-second** delivery
timeout, and documents **three retries at 30-minute intervals** when retries
are enabled. It recommends idempotency and an independent fallback for missed
notifications. Its immediate-ack example does not justify acknowledging work
that has not been durably handled; this app retains non-200 responses on failed
verification/persistence instead of pretending it queued work.

Flutterwave permits accepting amounts greater than or equal to the expected
amount. EduCore deliberately remains stricter: successful direct collection
must match **exactly ₦3,200 NGN**, including its existing charged-amount check.
An unexpected amount is held for reconciliation, not automatically credited or
refunded. This preserves the agreed model.

## Concrete fixes

1. **Public ingress validation:** callback and charge-webhook transaction IDs
   now share canonical positive safe-integer validation. Webhooks also require
   the existing direct-payment reference format before invoking the verifier.
   Malformed/foreign-workflow identifiers do not reach database verification.
2. **Malformed authenticated JSON:** now returns controlled
   `400 INVALID_WEBHOOK`, rather than becoming an unexplained 503. Authentication
   still happens first. Failed authentication remains 401 and performs no
   verification.
3. **Non-split evidence shape:** transaction responses with non-null malformed
   `subaccounts` values are rejected, not treated as if they were an empty
   allocation. Absent/null/empty-array metadata remains accepted only alongside
   all other transaction checks and independent release evidence.
4. **Time-sensitive release authority:** matching release-request/review expiry,
   rule effective/end dates and the school's current Lagos term window now use
   PostgreSQL wall-clock time, not transaction-start `NOW()`. A transaction that
   waited for a lock cannot rely on an authorization window that has already
   elapsed. Existing school/student/rule/version, merchant, endpoint,
   reconciliation and latest-decision bindings remain unchanged.
5. **Fixture clock alignment:** the existing isolated Owner fixture recognizes
   wall-clock predicates so its explicitly controlled JS/SQL dates remain
   aligned. No shared database clock or data was changed.

## Existing protections reviewed, not redesigned

- Callback `status`, payload amount and payload currency do not finalize a
  payment. The server GET must supply matching transaction ID/reference,
  currency, exact amount, success status, provider reference and explicit fees.
- Dedicated LIVE configuration, production-context checks, exact configured
  HTTPS endpoints, separate operational release and schema inspection remain
  required. Credentials alone do not establish merchant approval.
- Transaction verification uses the fixed Flutterwave HTTPS origin, rejects
  redirects, bounds transport time to three seconds and bounds response bytes.
- Permanent checkout reservation precedes the provider POST. UNKNOWN/uncertain
  attempts require reconciliation; duplicate requests do not automatically
  initialize another payable checkout.
- The attempt row is locked during finalization. Matching terminal replays
  return existing state without another payment event; conflicting provider
  transaction/status evidence is rejected.
- Checkout rechecks authority under scope/release locks. The latest approved
  authority must still match the school, student, term, rule/version, merchant,
  endpoints and reconciliation. Older approvals do not resurrect after a newer
  authority is withdrawn or expires.
- Owner diagnostics retain non-secret blocker details, show prerequisites
  before a rule is selected and distinguish failed verification from a claim
  that tables are missing. No further diagnostics defect was established.

These source reviews are not new end-to-end accounting, merchant, permission or
Production catalog certifications. Earlier broader tests were not rerun.

## Focused verification

Executed:

```text
pnpm --filter @workspace/api-server exec vitest run \
  src/services/direct-student-live-payments.test.ts \
  src/routes/direct-student-live-public.test.ts
```

**25/25 passed across two files:** seven transport/service tests and 18 loopback
public-route tests. Tests use synthetic configuration, fake provider responses
and mocked persistence; they make no Flutterwave/shared-database calls.
Cases cover malformed JSON/IDs/references, authentication ordering, safe error
responses, HTTP 200 only after verifier success, configuration blocking,
independent verification, exact monetary/transaction matches and split metadata.

```text
env -i PATH="$PATH" HOME="$HOME" LANG=C.UTF-8 NODE_ENV=test \
  node scripts/src/direct-release-expiry-native-check.mjs
```

**3/3 isolated checks passed:** source predicates bind expiry/rule/term checks to
wall-clock time; PostgreSQL rejects an expired timestamp after an in-transaction
wait where frozen `NOW()` would accept it; a future timestamp remains eligible.
The script creates/verifies a private Unix-socket-only disposable cluster with
no application/provider environment, uses no financial tables, then deletes it.
It is a clock-semantics regression, not a full release-query or lock-contention
replay.

API TypeScript and `git diff --check` passed. No broad frontend/backend suite or
full financial fixture was repeated. No authenticated Owner browser check or
Production test was performed.

## What still blocks LIVE on the current Replit infrastructure

1. **Procedural enforcement:** no supported, verified installation/lifecycle
   path for these exact four functions/nine triggers is established for the
   current managed Production database. Prior documented platform confirmation
   says ordinary Publish does not transfer/track them and manual SQL installation
   is unsupported. Application changes cannot close that platform limitation.
   No Support investigation was reopened and no workaround was introduced.
2. **Current primary/permissions/recovery acceptance:** reuse existing Owner-
   reported resource and recovery confirmations, but require evidence bound to
   the actual serving target, current runtime permissions and accepted recovery
   plan. The earlier replica observation is not primary certification; this
   review performed no fresh Production queries.
3. **Merchant and endpoint acceptance:** existing reported merchant approvals
   are not declared absent. Current LIVE merchant binding, independent non-split
   evidence, exact dashboard endpoints and authenticated external delivery/
   replay evidence were not independently verified in this review.
4. **Exact launch scope:** actual school-owned dates, eligible rule/version and
   effective dates, fresh reconciliation and unexpired reviewed release must
   all qualify. Prior empty replica rule/review inventories were not changed.
5. **Operational acceptance:** whole-handler latency under database contention,
   missed/pending-notification recovery and genuine signed-in Owner acceptance
   are not established by these unit/clock tests. No durable direct-webhook
   queue or automatic pending-payment poller was added or claimed here.

As long as the procedural delivery/enforcement gate remains unresolved on the
current managed target, direct LIVE release must remain blocked—even if an
Owner has completed the other steps. Owner approval cannot substitute for the
missing technical capability, and January timing cannot override it.

## Specific Owner-controlled actions before each school's January launch

1. **Keep the hosting decision fixed:** remain on Replit. No external-hosting
   assessment, account, migration or credential change is a required action in
   this launch plan. Do not pursue an unsupported SQL workaround.
2. **Resolve the technical go/no-go:** require an actually supported Replit
   procedural release mechanism and exact primary-bound verification of all
   required guards, permissions and recovery before approving financial release.
   No such mechanism is established here. If none is available, make an explicit
   no-go decision for direct LIVE collection rather than claiming readiness,
   silently changing fees/free periods or bypassing gates.
3. **Review each school's calendar and proposed rule:** preserve its actual
   January 2027 second-term start, ₦3,200 NGN per academic term and zero collection
   split. Do not substitute January 1 for saved school dates or extend one
   school's calendar to another.
4. **Reuse and bind existing merchant approvals:** have the authorized merchant
   administrator confirm the correct LIVE account, V3 webhook contract,
   dedicated server-side configuration and reviewed non-split evidence, without
   exposing secret values. Configuration changes are separately authorized
   operational work, not performed by this review.
5. **Confirm exact public endpoints in the provider dashboard:** the approved
   public HTTPS app origin must use
   `/api/flutterwave/direct-student/callback` and
   `/api/webhooks/flutterwave/direct-student`. Confirm matching private
   `verif-hash` configuration and enable retries. Obtain separately authorized,
   non-charge delivery evidence and a missed-notification recovery procedure.
   Configured URLs/local tests are not proof of provider delivery. Disabled
   gates deliberately reject finalization; do not enable LIVE merely to obtain
   a successful response.
6. **Complete current operational acceptance:** appoint the reviewer/operator,
   establish pending/uncertain attempt reconciliation ownership and bounded
   webhook processing, and perform genuine Owner acceptance using an already
   authorized session. Do not create accounts or repeat unsuccessful login
   attempts for screenshots.
7. **Create/review the exact release only when technically eligible:** use the
   Owner workflow for the precise school/term/rule/version, fresh reconciliation,
   independent merchant evidence, no-split confirmation and explicit decision.
   Reviews expire within at most seven days; an October approval cannot serve
   as a January launch approval. Preserve all legacy obligations and history.
8. **Authorize future software publication and operational activation
   separately:** these Development code fixes do not alter the published app.
   A later approved app Publish still does not install missing database guards.
   Use only the direct-payment release, not archived split/hosted flags. LIVE
   activation must remain off until every independent prerequisite is proven.

No guarantee of January LIVE launch is made. The result is narrower, tested
application hardening plus an explicit Replit-only launch decision boundary.
