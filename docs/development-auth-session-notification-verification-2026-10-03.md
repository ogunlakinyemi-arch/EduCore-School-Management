# Development authentication and notification verification

Date: 2026-10-03, Africa/Lagos.

## Status

The Development sign-in/session-retention blocker is fixed. Notification verification resumed using genuine Clerk test-tenant sessions and owned Development fixtures. Subscription enforcement has not been implemented; the school-wide treatment of partially paid student subscriptions requires a business-policy decision.

Nothing was Published. No Production database, schema, data, secrets, or deployment settings were modified. The Replit Publish-generator issue remains untouched and continues to be handled separately through Replit Support.

## Root cause and correction

A genuine Clerk ticket exchange completed and activated a session. While the sign-in screen was still mounted, its account-switch effect reacted to the newly signed-in state and immediately called Clerk sign-out. A transparent browser observer identified that caller before the code was changed.

The initial anonymous `/api/me/authorized-context` 401 was expected and did not establish failed cookie forwarding. After the fix, the signed-in request returned 200 with a cookie present and no Authorization header. Refresh retained the session; explicit UI logout ended it and protected access returned 401. Cookie presence alone was not treated as proof of authentication.

Changes:

- `artifacts/edupulse/src/pages/auth-screen.tsx`: capture signed-in state once after Clerk loads; distinguish an already-active account-switch session from a newly completed sign-in. Invitation behavior is retained.
- `artifacts/edupulse/src/lib/sign-in-session-policy.ts` and its tests: isolate and test that policy.
- `artifacts/api-server/src/routes/communication-inbox.ts`: fix a separate push-reference revocation failure by aliasing the outer device row and qualifying correlated school references. The original SQL failed with PostgreSQL 42702, ambiguous column.
- `communication-inbox.test.ts` and `external-notifications.postgres.integration.test.ts`: cover the revocation route and executable own-school/cross-school/idempotence SQL regression.
- `artifacts/edupulse/src/pages/communication-inbox.tsx`, `communication-contract.ts`, and `communication-archive.test.ts`: add working Inbox/Archived views and archive/restore controls using the existing API contract. Required ACCOUNT and SECURITY notices are not offered an Archive action.

No browser bearer-token workaround, authentication bypass, SDK upgrade, secret change, or authentication-configuration change was introduced.

## Test results

These subsets overlap; do not add their counts together.

| Check | Result |
|---|---|
| Full backend invocation, disposable full-schema database | 1,260 passed; 1 failed; 37 skipped; 107 files passed, 1 failed, 5 skipped |
| Original Development schema metadata assertion, read-only | 1 passed; 3 deselected |
| Frontend | 311 passed, 54 files |
| Native notification PostgreSQL suite | 22 passed |
| Native NFC current-record check | 1 passed; also included in the disposable full-backend invocation |
| Authentication middleware subset | 12 passed |
| Role-boundary and finance-authorization subsets | 23 passed |
| Communication/notification backend subset | 179 passed, including the provider subsets |
| Provider subsets, no network | 56 passed: communication providers 30; external providers 26 |
| School-security subsets | 39 passed |
| Sign-in entry-state policy | 4 passed; included in frontend total |
| Inbox archive policy | 4 passed; included in frontend total |
| Frontend typecheck | Passed |
| Backend typecheck | Passed |
| Diff whitespace check | Passed |

The full backend invocation is **not reported as completely green**. Its failure was an exact foreign-key referenced-index-name assertion in the schema-only clone: equivalent uniqueness structures bound to a different qualifying index during replay. The same read-only assertion passed against the independently identified, unchanged Development database. No live schema was altered to resolve the clone difference. Authentication, authorization, notification, provider, and school-security subsets passed.

Mock/no-network tests exercise delivery creation, recorded success/failure, retry, duplicate prevention, Nigerian phone normalization, revoked/expired push subscriptions, receipt handling, and recipient/tenant restrictions. They do not establish physical delivery.

## Signed-in browser evidence

- Five requested role flows used genuine sessions: Parent, School Admin, Teacher, Student, and Partner. The Owner flow remains unverified because no safe Owner fixture was available; no Owner membership was fabricated.
- Parent: authorized context 200, server-derived active role, dashboard, retained session after refresh, explicit logout, and protected 401 afterward.
- School Admin: genuine sign-in, verified school role, dashboard, Communications, channel-default controls, and view-only empty histories.
- Parent notification continuation reported 15 passing assertions covering read state, IN_APP preference changes, mandatory security settings, child selection/filtering, owned-child 200/foreign-child 404, synthetic in-app composition, and inbox/preferences viewport checks.
- Ordinary announcement archive removed it from active Inbox; Archived showed Restore; Restore returned it to Inbox. The two unread academic/security items stayed unread throughout.
- Security guard: raw DOM had zero Archive buttons for the mandatory security notice, the runtime policy returned boolean false, and direct PATCH archive returned 400 without changing the row. An earlier tester claim of a visible security Archive button was disproved by exact DOM and database evidence, not by weakening the guard.
- Teacher: an expiring COMMUNICATION_SEND grant was issued through the owned School Admin UI, assigned-child messaging and a synthetic in-app reply worked, and the unassigned child remained inaccessible. Revocation was performed through the UI; subsequent access to the previously permitted thread returned privacy-masked 404.
- Student: authorized context returned active STUDENT; dashboard and three own fixture inbox alerts were visible; private school communications were inaccessible.
- Partner: active reseller profile and dashboard were visible; the account had no school role and private communication access was denied.
- The final focused read-only pass reported exactly seven passing assertions: effective post-revocation denial; Student context/dashboard/inbox; Partner context/dashboard/no-school-role. These overlap the role evidence above.
- Inbox/preferences and School Admin channel-settings measurements at 402, 768, and 1365 pixels showed no document-level horizontal overflow. The 402px family-navigation strip has its own horizontal scrollbar.

The Teacher's earlier 404 was resolved by satisfying the existing delegation requirement, not by changing assignments, roles, or authorization rules.

## Data preservation and cleanup

Before and after verification and cleanup, all 709 baseline rows across 163 original tables retained their full-row fingerprints. Original column layouts were unchanged.

Seven fresh, owned test identities were needed because the earlier fixture identities had already been retired. They were retired afterward: seven Clerk test users deleted, corresponding new app accounts and school memberships made inactive, fixture device credentials revoked, and fixture queued deliveries cancelled. Existing users and schools were not retired. Notification, conversation, delegation, and audit history was retained. Both disposable PostgreSQL processes were stopped.

No real messages, broadcasts, push notifications, or money movements were performed.

## Remaining unverified

- Real Resend delivery: **Not Yet Verified**. RESEND_API_KEY, email sender, and email provider selector were absent in the checked Development configuration.
- Real Termii delivery: **Not Yet Verified**. An API credential existed, but the sender ID and SMS provider selector were absent.
- Physical push delivery: **Not Yet Verified**. VAPID public/private keys and subject were absent.
- Physical PWA installation: **Not Yet Verified**.
- Owner signed-in dashboard and notification permissions, due to no safe Owner fixture.
- A real finance-domain event displayed end to end in the signed-in finance feed; an empty finance panel is not delivery evidence. System finance notices intentionally remain separate from the school-message inbox.
- Emergency broadcast submission, populated delivery-history interactions, and the complete compose/reply/emergency responsive matrix.
- Every remaining Parent Communication Centre tab and additional assigned-child combinations.
- ACCOUNT archive behavior in a real browser; there was no ACCOUNT fixture row. Its UI policy is unit-tested alongside SECURITY.
- Termly subscription enforcement, migration, restrictions/restoration, and Owner bulk controls: not implemented or verified in this authentication phase.