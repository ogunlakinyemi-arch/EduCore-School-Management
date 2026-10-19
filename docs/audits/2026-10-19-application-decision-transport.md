# Development application decision transport investigation

## Findings and limits

The exact browser client operation is:

    POST /api/platform/account-applications/:applicationId/decision
    {"status":"APPROVED"}

Rejection uses the same route with `status: REJECTED` and a required `reason`.
The generated mutation consumes `{applicationId, data}` correctly. URLs are
same-origin; no localhost URL or cross-origin base override is configured in the
web app. No CORS relaxation or authentication workaround was applied.

The running Development API was healthy. A real authenticated Owner approval
completed with HTTP 200 in 498ms during investigation. Read-only checks against
independently matched Development database connections confirmed Approved,
an active linked school and an active School Admin membership for that
application's user and school. No real decision was submitted by the agent.
The notification status was UNAVAILABLE: real email acceptance/delivery is not
established, and no retry or provider configuration change was made.

A fresh browser had no Owner session. Both native browser fetch and the actual
generated client reached the same-origin decision route for safe invalid ID 0,
returned HTTP 401, and produced no redirect, CORS failure or network request
failure. No existing user's session was obtained or fabricated.

**The original Failed to fetch trigger was not reproduced or proven.** There
was no evidence supporting a broken route/base path, blanket CORS change or
authorization bypass. Current successful traffic does not explain the earlier
failure.

## Confirmed UI recovery defect and fix

Previously a decision transport failure only rendered the error. It did not
immediately determine whether the server had committed the decision.

- Await the per-execution mutation promise; no automatic mutation retry.
- Only accept a response confirming the requested application ID and status.
- Refresh the list and open the confirmed status filter after server confirmation.
- On failure, retain the original error and perform one fresh authorized list read
  after cancelling older list requests. Never resend the decision.
- If the fresh server state is Approved/Rejected, show that exact authoritative
  outcome and explain the response failure rather than silently claiming success.
- If Pending, missing or unreadable, explicitly mark the decision unconfirmed,
  block blind confirmation retries, and require manual refresh and review.
- Own busy cleanup in finally and guard double clicks while the promise resolves.
- Existing transactional activation, global Owner checks, post-commit notification
  claim and uncertain-send safeguards are unchanged.

## Verification

- 29 focused frontend tests passed, including both recovered decision statuses,
  Pending/unreachable checks, manual-refresh gating and existing form/review paths.
- 42 disposable-PostgreSQL routed tests passed.
  - The real generated browser client sends the actual /api-prefixed POST payload.
  - For both applicant types and both decisions, the server commits, the test
    discards its HTTP response with Failed to fetch, and a fresh client GET returns
    the committed outcome. Exactly one decision/email-provider mock call occurs.
  - A request failing before reaching the API leaves Pending and no notification.
  - Forced membership-insert errors after school/profile creation roll back all
    partial activation for both applicant types.
- Frontend and API typechecks passed.
- Web workflow restarted; backend runtime code was not changed.

Database fixtures, trigger injection and notification mocks ran only in a
disposable local cluster, not the shared Development database. No schema migration,
real application write, email send, Production change/query, Publish setting,
publishing, payment change or secrets change was performed.

Authenticated browser confirmation/recovery remains unverified because the tester
had no approved Owner session. Original network root-cause diagnosis remains open;
do not represent the recovery fix as proof of a repaired CORS or network failure.
