# Owner notification settings: focused correction

2026-10-23. Source changes only; no service restart or publication.

**Historical correction report:** the Development-only Telegram restriction
described below was subsequently replaced by an explicit Production opt-in.
It is not the current activation policy. See
[Telegram setup](telegram-production-setup.md) and the
[Production Telegram/push activation handoff](notification-production-activation.md)
for current gates, Production presence results and Owner steps. The push
installation analysis below still applies; source preparation is not publication.

## Causes and correction

- **Push installation:** public GET/HEAD observations at the published
  `https://educore.yetenia.com` returned 200 for the service worker, offline page
  and three icons. The offline page and checked icon returned
  `Cache-Control: private`. The served worker matched the pre-change repository
  worker byte-for-byte. Its install handler rejected private responses and
  awaited every cache-warming operation without recovery, making installation
  fail. Cache refusal is correct; treating optional caching as mandatory for
  activation was not. Warming/cleanup are now best-effort, without permitting
  private/no-store/authenticated responses into the cache. The existing
  uncached offline fallback remains available; offline cache population is not
  claimed successful.
- **Readiness:** the push control previously waited on the service-worker
  container's `ready` promise and returned a generic timeout. It now bounds
  registration and observes activation of the specific registered worker,
  reporting registration rejection, redundant installation or timeout with
  fixed next-step messages and cleaned-up listeners.
- **Bot diagnostics:** all HTTP failures were replaced by “Check failed.”
  Provider failures collapsed to invalid token or unavailable; schema inspection
  and audit writes could fail before/after the read-only provider calls.
  Additionally, the current server route explicitly rejects published/non-
  Development use with 404 before Telegram is called. That boundary is
  preserved and is now explained in the UI. It is not evidence of a bad token.
  No authenticated check or Telegram request was performed during this work;
  a particular screenshot's provider response cannot be reconstructed here.

The bot UI now distinguishes session/Owner access, rate limiting, Development-only
availability, storage/audit failure, invalid credentials, timeout, network,
malformed response, provider refusal/outage, and existing webhook conflict.
Logs contain fixed event/method/reason labels and allowlisted HTTP statuses
only, never caught errors, request URLs, tokens, headers or provider bodies.
Existing checks still call only getMe/getWebhookInfo upon explicit Owner action.

Push errors distinguish HTTPS/support, browser permission denial/dismissal,
registration/activation, malformed public VAPID key, browser subscription and
server persistence failures. Permission is requested only after clicking Enable,
not on mount, and not when known-denied or public configuration is invalid.
Existing session revocation and subscription association remain intact. Raw
server/browser errors are not displayed. A saved subscription is not proof of
delivery or of the private VAPID key pair's correctness.

Errors use `#991b1b` on explicit `#fff1f2`, alert semantics and wrapping text;
success/neutral text remains distinct. Buttons retain 44px minimum height and
flex wrapping for narrow screens.

## Focused verification

- **39 frontend tests passed** across the existing Telegram control/DOM,
  web-push control, PWA security and new notification-copy/worker-readiness tests.
  Tests include private-header/storage refusal without failed worker activation,
  redundant/hung registration, no permission before user action, denial,
  server persistence failure, sanitized messages and red alert/success separation.
- **12 Telegram provider tests passed**, fake HTTP only. Logging tests verify
  method/category/status while rejecting token/body leakage.
- Frontend and API typechecks, service-worker syntax and diff checks passed.
  Two old UI assertions were updated for the new alert role and actionable
  wording; they pass. No unrelated suites were run.
- A 390×844 Development screenshot attempt failed because the web workflow is
  stopped (Development HTTP check also returned 502). No workflow was started
  or restarted. Responsive wrapping was reviewed and DOM states tested, but
  updated signed-in desktop/mobile rendering is **not visually verified**.

## Owner follow-through / unchanged limits

These changes are not active on the published site until a separately authorized
release. Production Telegram remains intentionally Development-only; enabling it
is a separate policy/release decision, not a token-reset instruction. Configure
credentials or VAPID keys only through the Owner's secure configuration process
if a future explicit check identifies a configuration failure. No credential
values were inspected or changed here. Do not change an existing webhook merely
to make the diagnostic pass.

No Telegram calls, message sends, browser permission prompts, application data
changes, provider/config changes, worker resumption, service restarts, publication
or Flutterwave gate changes were performed. All provider/browser APIs in tests
were fictional/mocked.
