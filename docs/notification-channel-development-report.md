# Notification-channel integration — Development report

Date: 2026-10-02

## Implementation

Extended the existing notification, preference, Parent Communication Centre and delivery-history architecture. No duplicate centre, outbox, messaging system or preference tables were introduced.

- Resend email adapter; configurable sender and server-only credentials.
- Termii SMS adapter with Nigerian-number normalization.
- Web Push adapter with generic content, vendor endpoint restrictions and P-256 subscription validation.
- No-network email/SMS/push test adapters.
- Per-device durable dispatch claims; accepted/uncertain attempts are not blindly repeated.
- Existing mandatory-category preferences retained; school category defaults add channels without removing the event's existing channels. Explicit campaign channel selections remain explicit.
- Authenticated, session-bound device registration and revocation; lists omit subscription endpoints and keys. Account switching replaces another user's active endpoint ownership while preserving history.
- Existing PWA service worker extended for generic push and authenticated inbox clicks.
- Signed Resend/Svix and Termii/HMAC receipt handlers; acceptance remains distinct from delivery.

## Exact verification results

| Check | Result |
|---|---|
| Backend regression run | 1,259 passed; 36 skipped; 107 passing suites |
| Frontend regression run | 303 passed; 52 passing suites |
| PostgreSQL notification integration | 21 passed |
| PostgreSQL NFC current-record regression | 1 passed |
| Provider-focused tests | 56 passed, included in backend totals |
| Provider/inbox notification-focused run | 75 passed, included in backend totals |
| Mocked push-control UI tests | 4 passed, included in frontend totals |
| API and frontend typechecks | 2 passed |
| Signed-in browser checklist | 0 passed; 1 failed; 16 not tested |

The backend run skipped the 21 notification PostgreSQL cases subsequently run separately, plus 15 other opt-in database cases. The NFC PostgreSQL file was excluded from that run because it requires its own disposable cluster; its single case passed separately. These counts overlap where noted and must not be added as independent checks.

The 22 PostgreSQL tests used disposable local clusters, not Production. Native coverage includes retry/uncertainty protection, multiple devices, tenant and parent isolation, child-context deduplication, mandatory preferences, existing domain-event dispatch, expired/session-invalid subscription revocation, and signed receipt replay with forged payload scope ignored.

## Preservation and cleanup

The additive migration was rehearsed with rollback and replay before applying it in Development. All **163 original tables, 2,180 original columns and 657 original records** were preserved. Existing constraints and triggers were retained. Seven columns were added; no existing tables were replaced.

The final original-column fingerprint comparison passed after fixture retirement. Seven temporary Development Clerk users were deleted. Their app access, school memberships, push devices and NFC credential were revoked/deactivated; immutable school history was retained.

## Remaining limitations

- Real Resend delivery: **Not Yet Verified**.
- Real Termii delivery: **Not Yet Verified**.
- Physical push and physical PWA installation: **Not Yet Verified**.
- Actual provider webhook delivery: **Not Yet Verified**. Signature handling and mocked receipt replay passed.
- Missing configuration: `RESEND_API_KEY`, `EMAIL_FROM`, `RESEND_WEBHOOK_SECRET`, `TERMII_SENDER_ID`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. An existing Termii key does not authorize a real send.
- Signed-in browser verification is blocked. Fresh ticket sign-in returned complete, but the browser did not retain an active session; the authorization endpoint returned 401. The cause is not established. Parent/staff journeys and their responsive sweeps were therefore not verified.
- An anonymous mobile screenshot confirmed the sign-in page renders. It is not evidence for protected notification screens.

No live provider delivery, real emergency broadcast, money movement or contact with real parents occurred.

## Production

**Nothing was Published. No Production database, schema or data was modified.**

The existing Replit Publish-generator issue was not changed; it remains a separate Replit Support matter.