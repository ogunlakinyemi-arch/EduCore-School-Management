# Owner Field Operations school reminders

## Outcome — 23 November 2026

Focused source fix: Owners select schools directly in the visited-school list,
open a single-school or multi-school reminder, review the exact editable message
and server-frozen recipients, and explicitly confirm dispatch. No real SMS was
sent, no automatic messaging was enabled, and no shared database, provider,
secret, notification-control or Production setting was changed.

**Operational sending remains blocked by unapplied existing SMS storage and
history-guard dependencies. This is not a LIVE delivery certification.**

## Session failure: evidence and correction

`SESSION_REQUIRED` was the client's generic label for an HTTP 401; it was not a
specific server error establishing that the Owner needed to log out.

Serving logs supplied during verification show:

- 16:07:23 UTC: `GET /api/bro-field/sms` returned 401, immediately followed by
  successful Clerk session touch/token-refresh responses.
- Subsequent authorized-context and Field Operations list/options reads succeeded.
- 16:08:13 and 16:08:31 UTC: SMS reads returned **503**, not 401.

The observed sequence establishes a transient authentication failure followed
by a separate unavailable-service condition. It does not establish invalid
credentials or justify adding bearer-token handling to browser requests.
No raw session cookie/token was captured or exposed, so the exact Clerk-internal
reason for the initial 401 cannot be independently certified.

The old panel enabled its query from `useUser().user`, cached by user only, and
disabled retry. A hydrated user profile is not the same as a loaded active
session, and replacement sessions shared the old query state. The fix:

- Gate SMS reads on loaded, signed-in Clerk auth with user and session IDs.
- Key the cache by user **and session**, discard selection/preview/confirmation
  on session change, and ignore mutation results belonging to an old session.
- Use explicit same-origin cookie credentials on all four SMS operations.
  No browser bearer token, `getToken` or global auth-token getter was introduced.
- Retry only a 401 **read**, once after one second, allowing normal Clerk cookie
  refresh. Never automatically retry permission, preview or dispatch mutations.
  Persistent 401, 403 and schema/transport failures remain visible.
- Send `private, no-store` before authentication, including on unauthorized
  responses. Mount the exact SMS namespace ahead of unrelated generic
  authentication/school-operation routers; retain its own real authentication
  and Platform Owner authorization.

## Interaction and safeguards

- Per-school checkboxes, single-school **Send reminder**, and a multi-school
  **Send reminders** toolbar are beside the original detail controls.
- Select-all selects only server-eligible **visible** schools. A single-school
  action replaces any previous multi-selection with exactly one school.
- The integrated composer has no second recipient selector. Missing consent
  and other exclusions are explained on the school rows.
- **Record permission** opens the existing reason-bearing process. Opt-out is
  also accessible. Selecting or previewing never records permission.
- An editable generic Yetenia visit-follow-up draft contains no invented link,
  contact number or unsupported claim that recipients can reply to the sender.
- Preview records exact message/count/recipients; only the explicit confirmation
  enables dispatch. Dispatch-time eligibility is still rechecked.
- Existing normalized-phone deduplication, permanent processing/unknown holds,
  proven-failure-only retries and bounded explicit continuation are unchanged.
- Existing campaign/recipient/event/audit records retain actor, school/lead,
  phone, message, timestamps and provider reference/outcome.
  **ACCEPTED is not DELIVERED.**
- The existing provider factory, SMS event scope and transport controls are
  reused. No new provider or WhatsApp integration was introduced.

## Files changed

Application:

- `artifacts/edupulse/src/pages/partner/field-operations.tsx`
- `artifacts/edupulse/src/components/field-sms-campaigns.tsx`
- `artifacts/edupulse/src/components/field-lead-reminders.tsx` — new
- `artifacts/edupulse/src/hooks/use-field-sms-controller.ts` — new
- `artifacts/api-server/src/routes/bro-field-sms.ts`
- `artifacts/api-server/src/routes/index.ts`

Tests:

- `artifacts/api-server/src/routes/bro-field-sms.test.ts` — new
- `artifacts/api-server/src/services/current-finance-integration.postgres.test.ts`
- `artifacts/api-server/src/services/communication-providers.test.ts`
- `artifacts/edupulse/src/pages/partner/field-operations-reminders.test.tsx` — new
- `artifacts/edupulse/src/components/current-finance-panel.test.tsx`

No schema/migration, payment or unrelated dashboard implementation was changed.
The provider-test correction supplies both a synthetic Owner transport scope
and matching child-process environment; real delivery protection is unchanged.

## Focused verification

| Check | Result |
|---|---|
| New SMS HTTP boundary | 15 passed: application authentication/role loading with a fake external cookie verifier; no live identity or provider |
| Existing auth regression | 17 passed |
| Current-finance HTTP regression | 6 passed |
| Disposable PostgreSQL integration | 26 passed, including single/multiple exact selection, missing consent/phone/visit, onboarding/opt-out rechecks, exact audit evidence, duplicates/concurrency, failed retry, unknown hold and continuation |
| Existing provider adapters with fake transports | 30 passed |
| Field Operations reminder component interactions | 10 passed |
| Current-finance/component regression | 23 passed |
| Notification continuity | 17 passed |
| API/frontend TypeScript checks | Passed |
| Source whitespace check | Passed |

There are **144 distinct passing checks** across these eight files, not a
claim of 144 real sends. The PostgreSQL fixture is a disposable Unix-socket
cluster with synthetic identities; inherited credentials and external HTTP
are blocked by the test setup.

The Development API was rebuilt/restarted once. Startup confirmed **all
Development background workers paused**; health returned 200 and anonymous SMS
access returned 401. The ordinary app screenshot rendered sign-in, not an
authenticated Owner acceptance pass. The partial browser-fixture results and
skipped mobile coverage are recorded below.

## Remaining runtime/configuration blockers

Read-only checks found these absent in **both** shared Development and the
platform's Production read replica:

- `bro_field_sms_permissions`
- `bro_field_sms_campaigns`
- `bro_field_sms_recipients`
- `bro_field_sms_events`
- `current_subscription_operations`

The service deliberately requires its existing lifecycle/extension/history
guards as well. Applying the existing migration candidates or bypassing those
guards was not part of this fix. Supported delivery and exact catalog
verification require a separately authorized release operation; do not add
startup/build DDL or treat Publish alone as procedural installation.

The SMS provider selector exists as a secret; BulkSMSNigeria credential/sender
entries are present, but their values were not read. The existing approved
provider/sender must be retained. Presence does not prove account credit,
effective runtime selection, provider acceptance or handset delivery.
Development workers remain paused. Owner delivery authorization/activation,
fresh per-contact permission, normal session acceptance and real provider
receipt remain separate runtime prerequisites.

The frontend's managed workflow has a pre-existing port-in-use failure; an
existing Vite process continues serving current source/HMR, confirmed by the
app screenshot. It was not killed or replaced as an unrelated service repair.
Nothing was published by this implementation.

## Browser verification — partial, explicitly stopped

The browser request was manually skipped before completion and was not rerun.
Before stopping, an isolated browser fixture rendered the **actual changed
source components**, actual React and Vite CSS at 1440×900. Its Clerk and API
hooks were synthetic; network interception blocked external traffic. No real
API request or provider request was attempted.

Completed desktop observations:

- Single/multiple eligible list selection; ineligible rows stayed disabled.
- Single-school action replaced multi-selection; neither action sent anything.
- Multi-school action scrolled/focused the composer using normal interactions.
- Exact two-recipient frozen preview; send disabled until confirmation.
- One simulated dispatch; provider acceptance was not labelled delivery.

History appeared after manual refresh in that fixture, but its query stub had
read the options from the wrong argument. The stub was corrected without a
rerun. This is **unconfirmed fixture behavior**, not a certified application
defect or successful live query-invalidation test.

**Not browser-verified:** 390×844 mobile layout/overflow/reachability, missing
session/401 presentation, uncertain dispatch, and permission recording. Those
logic paths have component/HTTP/database evidence as listed above, but no
completed mobile or authenticated running-Owner acceptance is claimed.
Responsive wrapping was implemented; mobile acceptance remains unverified.
