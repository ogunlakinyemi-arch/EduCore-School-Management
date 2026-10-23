# Production Telegram and browser push: activation handoff

## Read-only review — 2026-10-23

**Nothing was activated by this review.** No secrets/configuration were changed,
services restarted, release published, provider contacted or notification sent.
Flutterwave LIVE is unrelated and remains untouched.

Production-scoped configuration inspection (including inherited shared settings)
returned the following. Development secret presence was not used as evidence.

| Key | Production result | What this proves |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Present | Existence only |
| `SESSION_SECRET` | Present | Existence only |
| `EDUCORE_PRODUCTION_TELEGRAM_ENABLED` | Absent | Explicit Production opt-in is not configured |
| `EDUCORE_TELEGRAM_ALLOWED_ORIGINS` | Absent | No additional exact-origin allowlist is configured |
| `VAPID_PUBLIC_KEY` | Present | Existence only |
| `VAPID_PRIVATE_KEY` | Present | Existence only |
| `VAPID_SUBJECT` | Present | Existence only |

The secret-inspection interface returns no secret values and offers no
Production-side validation executor. Consequently token syntax, encryption-secret
length/quality and stability, VAPID syntax/subject and key-pair agreement are
**unverified**, not passed and not known-invalid. Do not substitute Development
values or read an authenticated push endpoint to extract keys into a report.
There are no known missing credential keys and no established invalid credentials.

Deployment metadata reports a public, successfully built **Autoscale** deployment:
`https://educore.yetenia.com`, with the additional published address
`https://edu-pulse-school-management--ogunlakinyemi.replit.app`.
This does not prove the published bundle matches the current source.
Current source differs from freshly verified GitHub main; retain local fixes.

## Shortest safe sequence

1. Obtain a **read-only Production readiness review** first. No provider calls or
   sends are needed for the local credential checks described below. Separately
   inspect Production schema, current policies, active subscriptions/consent and
   queued/uncertain deliveries. Do not migrate, cancel or replay records without
   approval. Presence-only results are insufficient for activation.
2. Resolve worker hosting: the API currently polls Telegram every three seconds
   and runs its communication dispatcher every fifteen seconds using in-process
   timers. Autoscale can scale to zero; it does not guarantee background delivery
   while idle. Approve an always-on Reserved VM publishing arrangement, or an
   independently reviewed durable worker architecture, before promising reliable
   notification timing. Do not change deployment type during this review.
3. Review the exact configuration changes with the Owner before saving anything.
   For Telegram the missing opt-in is
   `EDUCORE_PRODUCTION_TELEGRAM_ENABLED=true`. Set the exact published HTTPS
   origin allowlist as described below. No new push enablement flag exists.
4. Only after setup/backlog review and explicit configuration/release approval,
   save the approved Production settings and republish. **This is not a
   send-free release:** startup workers can process eligible existing records
   immediately. Production push has no separate global opt-in; restoring a valid
   key pair or publishing working code can resume existing eligible delivery.
   If existing policy/queue state cannot safely limit this to the approved scope,
   stop and obtain approval for a scoped rollout mechanism before release.
5. After a successful approved release, separately authorize one controlled
   end-to-end test per channel with a consenting recipient. Registration, provider
   acceptance and observed device receipt are distinct results.

## Telegram checklist and exact Owner steps

- Preserve the existing `SESSION_SECRET`; do not regenerate it. Source requires
  at least 32 characters and derives the chat-encryption key from it. A length
  check cannot prove entropy or decryptability of existing links.
- In an approved trusted Production execution context, check credential format
  locally and return only pass/fail: token has a numeric bot identifier followed
  by `:` and a nonempty URL-safe token component, without surrounding whitespace;
  encryption secret meets the source length requirement. Syntax does not prove
  Telegram acceptance or dedicated bot ownership. No such executor is available
  through the current presence-only interface.
- Confirm the bot is dedicated to this Production worker; another poller or an
  existing webhook is a blocker. Real `getMe`/`getWebhookInfo` checks remain
  prohibited until specifically approved.
- Confirm `parent_telegram_links`, `telegram_link_challenges`,
  `telegram_poll_state`, and the Telegram channel CHECK constraints on deliveries,
  preferences and templates in Production. Review audit storage and backlog.
  Do not bypass failed readiness.
- **After approval only:** open the project's **Publishing** tool →
  **Adjust settings** → **Production app secrets**. Preserve the existing token
  and encryption secret. Add `EDUCORE_PRODUCTION_TELEGRAM_ENABLED` with value
  `true`. Add `EDUCORE_TELEGRAM_ALLOWED_ORIGINS` with
  `https://educore.yetenia.com`. If Telegram controls must work on the additional
  published address, use the comma-separated value
  `https://educore.yetenia.com,https://edu-pulse-school-management--ogunlakinyemi.replit.app`.
  No paths, trailing slashes, HTTP or wildcards. The explicit allowlist is only
  necessary when the published host is absent from runtime-provided host lists;
  its absence alone does not prove the current origin is rejected. An explicit
  reviewed list avoids relying on unverified runtime host settings.
- Review publishing settings and any proposed database changes; stop if unrelated
  or unapproved changes appear. Use **Publish/Republish** to load the approved
  configuration and source. Do not manually override runtime host variables.
- Once provider diagnostics are separately authorized, sign in as the active
  Platform Owner at the published app → `/notification-settings` →
  **Check bot configuration**. This makes real diagnostic calls, but never sends,
  polls, changes webhooks or authorizes the worker. The worker independently
  validates readiness after the enabled release.
- Owner event/channel permissions and school choices must permit Telegram.
  Only verified eligible parents can link: in their signed-in Parent Portal
  preferences, consent, create their personal link, start the dedicated bot in
  their own private chat, then confirm in EduCore. A school invitation is not
  final account ownership proof. Other roles are not implicitly subscribed.

See [Telegram setup](telegram-production-setup.md) for dispatch and retry rules.

## VAPID/browser push checklist and exact Owner steps

- No credential is known missing. Do not replace the existing pair just because
  presence-only inspection cannot validate it; rotation invalidates existing
  application-server-key subscriptions.
- A trusted Production-local validator can check the pair without network calls:
  decode URL-safe Base64, require a 32-byte P-256 private scalar and a 65-byte
  uncompressed public point beginning with byte `04`, derive the public point
  with Node `createECDH("prime256v1")` / `setPrivateKey` /
  `getPublicKey(undefined, "uncompressed")`, and compare bytes locally. Validate
  `VAPID_SUBJECT` as an appropriate `mailto:` contact or HTTPS URL. Return only
  booleans/fixed classifications; never print keys, derived points, hashes,
  addresses, environment dumps or caught error objects. This validation has
  **not** run against Production because the current interface supplies no values
  or trusted Production execution facility.
- Presence-only `/api/communication/push-configuration` uses authenticated access
  and returns the intentionally public application-server key to the browser.
  Its `configured`/`deliveryEnabled` results do **not** prove pair agreement,
  subject validity, worker activation or receipt.
- Source registers `/service-worker.js` with scope `/` for the current root
  artifact, only in a secure supported browser. Push setup waits for activation
  of that registration with a bounded timeout. Optional cache warming/cleanup
  failures no longer block activation; private/no-store/authenticated responses
  still cannot be cached. Confirm the approved release serves JavaScript, not
  the SPA fallback, and that the actual worker reaches `activated`.
- Confirm Production push-device storage, actual subscriptions, authenticated
  session association, outbox/per-device attempt storage, Owner event/channel
  policy, school entitlement and recipient preferences. The dispatcher checks
  active Clerk sessions, maintains per-device claims and revokes expired endpoints;
  ambiguous sends are held rather than blindly retried. Lock-screen text is
  generic; clicks open the authenticated inbox within the app scope.
- **After approval only:** if a local validation identifies a missing/invalid
  setting, open **Publishing → Adjust settings → Production app secrets** and
  securely correct only the approved `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` or
  `VAPID_SUBJECT`. Do not enter a private key in chat or a `VITE_*` setting.
  Republish after approved changes. Even with no credential changes, publishing
  is needed to release the prepared service-worker correction if it is not live.
  Do not add Development push flags to Production.
- For the later controlled test, open the published HTTPS app in a full browser
  tab, sign in as the approved recipient, select the intended school (or global
  scope), open `/notification-settings` → **Browser push notifications** →
  **Enable on this device**, and allow notifications. On supported iPhone/iPad versions install
  to the Home Screen and open there. Parent Portal preferences offer the same
  control. Permission is requested only on explicit action. Registration saves
  the real subscription, user, session and school; it is not a delivery test.
- Only after separate sending approval, generate one in-scope notification;
  confirm generic device display and inbox navigation with the recipient. Do not
  drain historical queues or infer physical receipt from provider acceptance.

## Current outcome / next action

Prepared: Production presence inventory, source/deployment gate review and this
activation handoff; earlier Telegram capability and service-worker fixes remain
source-only unless independently shown published.

Activated by this review: **nothing**. Existing Production push activity is
unknown; this review neither enabled nor disabled it. Telegram's opt-in is absent
in the inspected configuration; the running process's loaded revision/settings
were not inspected.

Next single action: approve the **read-only Production readiness review** covering
trusted local credential validation, storage/policy/backlog and always-on hosting.
Approve exact configuration changes and publication only after its results.
