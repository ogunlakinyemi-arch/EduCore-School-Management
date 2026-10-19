# Development invitation reliability sweep

## Root cause and actual request path

The Owner Partners & Resellers UI calls
`POST /api/platform/partners/:partnerId/invitations/resend` with JSON
`{ invitationId: <selected local invitation ID> }`. The client surfaces the
server's sanitized error, which explains the screenshot's generic toast.

The request passes authentication, global Platform Owner authorization, numeric
ID validation, a session advisory lock, selected-source checks and a Partner row
lock. Its recovery checks join invitation audit metadata through LATERAL
subqueries. A bound Partner ID appeared first as `$1::text` or `$2::text` in those
subqueries and later in `partner_profile_id = $1/$2`. PostgreSQL inferred text
before reaching the integer predicate and rejected the statement with
`operator does not exist: integer = text`.

A read-only Development reproduction confirmed that exact failure. This occurs
before a new invitation/provider request; it is not evidence of a bad email
credential, expired token or missing Partner role. Existing statement-matching
mocks hid the database parser failure.

## Fix

Numeric Partner IDs now use explicit `::integer::text` when compared with JSON
audit metadata. The same narrow correction covers related Owner email-correction,
resend/recovery/acceptance queries and Partner staff list/dispatch/recovery
queries. No unrelated queries or financial logic were refactored.

The corrected Owner resend, email correction, Partner staff list and all three
staff-permission resends execute successfully on a disposable PostgreSQL copy of
the complete current Development schema. Existing mock expectations were updated
to recognize the explicitly typed expressions, without weakening authorization
or recipient/attempt matching.

## Token, provider and error handling

- Replacement tokens remain 32 cryptographically random bytes, URL-safe encoded;
  only SHA-256 hashes are stored locally. New links expire after seven days.
- A valid but expired local source can request a replacement; an unknown,
  revoked or foreign source cannot. Acceptance still checks expiry and verified
  identity; no expiry bypass was introduced.
- Invitation emails are dispatched by Clerk with `notify: true`, seven-day
  provider expiry, the canonical acceptance redirect and durable attempt
  metadata. They do not use the application's Resend email adapter.
- `ignoreExisting: true` is retained for replacement invitations. Mocks enforce
  pending-email duplicate behavior instead of blindly returning success.
- New attempts commit before dispatch. Previous local/provider links are not
  superseded until replacement acceptance is confirmed. Definite rejection
  leaves the old local invitation unchanged.
- Lost responses persist UNKNOWN_PROVIDER_STATE. Subsequent recovery matches the
  exact attempt across all provider statuses/pages without another create call.
  Session locking prevents concurrent requests from creating duplicate sends.
- Known errors remain actionable, sanitized 4xx/503 responses (including retry
  or reconciliation guidance and rate-limit delay). Unexpected exceptions still
  return generic 500 responses rather than leaking SQL, tokens, keys or provider
  exception bodies. The fix removes the SQL failure; it does not replace it with
  a false-success response.
- Successful provider acceptance remains delivery-unverified. No inbox-delivery
  claim was added.

## Bounded dashboard/action matrix

| Dashboard / actions | Checks and outcome |
|---|---|
| Owner — Partners & Resellers create/list, selected resend, email correction, recovery and acceptance | Traced frontend request/body through backend, tokens, Clerk dispatch, locks and safe errors. Fixed numeric/text inference. Real routed PostgreSQL checks confirm normal/expired resends, invalid/revoked IDs, Owner-only access, rejection, concurrent retries, lost-response recovery and email correction. Existing dispatch/activation and row-isolation tests pass. |
| Partner — STANDARD, FINANCE and ADMIN staff invitation list/create/resend/recovery/revoke/acceptance | Found the equivalent inference defect in shared staff recovery and list queries; corrected numeric ID typing. Real PostgreSQL list and resend checks pass for all three permissions. Existing API tests cover creation/acceptance, permission denials, provider failures, recovery, revoke and concurrency; frontend staff-action tests pass. |
| Owner — School Admin invitation list/resend/email correction/reconciliation | Reviewed the dedicated routes and shared school replacement service. Existing API and frontend tests pass. No equivalent mixed numeric/JSON parameter defect or confirmed contract mismatch found; unchanged. |
| School — user invitations, resend/email correction/reconciliation, existing-user activation and related Parent/Student invitation UI | Reviewed the shared school-user component's exact encoded-ID POST/PATCH contracts and school-scoped backend authorization. Focused API tests and School Users component tests pass, including recipient selection/reuse. No confirmed related defect; unchanged. |
| Owner — company employee invitation/retry and internal employee acceptance | Reviewed Owner checks, durable claims, Clerk notify integration and recovery/error behavior. Existing API and frontend resend tests pass. No equivalent SQL parameter defect; unchanged. |
| Owner/applicant — account approval/rejection and decision notifications | Reviewed transactional decisions, post-commit notification claim and Resend/HTTP adapters. All 18 isolated routed PostgreSQL tests pass, including unavailable infrastructure, failed/uncertain notification and prevention of repeat sends. Approval is not undone by notification failure. UI accurately distinguishes provider acceptance from delivery. No confirmed related defect; unchanged. |

No duplicate route registrations were found for these actions. Owner School
Admin replacement and School user replacement are intentionally separate
authorized routes using the same replacement service, not conflicting handlers.
Owner Partner and Partner staff routes preserve distinct eligibility and audit
claims; they were not consolidated.

## Verification performed

- 11 new real-PostgreSQL routed regression cases:
  `node scripts/src/invitation-resend-check.mjs`.
  The runner captures schema only, restores under `/tmp`, mocks Clerk, runs the
  selected file and destroys the disposable cluster. It never copies live rows
  or writes to the source database.
- 166 existing focused API tests across Partner invitations, Owner school
  invitation management, School user invitation management and internal employee
  invitations pass. The Partner suite was rerun after updating SQL-shape mock
  expectations; the other suites were unchanged and passed their first run.
- 18 isolated PostgreSQL application/notification tests pass; the accompanying
  migration replay was only in the disposable database.
- 39 focused frontend tests pass across Owner Partner resend, Partner staff,
  Owner School Admin invitations, Owner company employee resend, account
  notification copy and School Users invitation UI.
- API and frontend typechecks pass; whitespace check passes.
- The managed API workflow was restarted once after the source changes.
- Initial new-test failures were incorrect expected HTTP statuses/query-key
  spelling and fixture reuse violating Partner's unique user constraint. The
  assertions/fixture isolation were corrected; no business rules were weakened.

## Preservation and verification limits

Development only. No Production operations, publishing, Publish configuration,
payment changes, secret/provider configuration changes, migrations on the
shared database or mutations of existing Partners/invitations/roles were made.
Pre-existing uncommitted registration work was preserved. No GitHub push.

No authenticated browser session was available for a real Owner/Partner/School
click-through, and no real invitation or decision email was sent. Live Clerk
readiness, recipient delivery and emailed-link activation therefore remain
unverified. Component mocks and disposable SQL fixtures establish behavior, not
live delivery or preservation comparisons against a signed-in browser session.
