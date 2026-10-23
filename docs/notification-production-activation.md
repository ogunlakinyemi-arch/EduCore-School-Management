# Production notifications: final readiness handoff

> **Current source preparation:** see [First real-school launch](notification-first-school-launch.md).
> A new fail-closed Production external-delivery boundary is required; the dated
> review below predates it. Email screenshot and metadata evidence conflict:
> provider/sender absence is not established. Do not overwrite settings.

For email prerequisites, unified channel availability and the SMS-disabled policy,
see [Supported notification channels](notification-supported-channels.md).

## Read-only review — 2026-10-23

**Nothing was activated by this review.** No secrets/configuration were changed,
services restarted, release published, provider contacted or notification sent.
Flutterwave LIVE is unrelated and remains untouched.

### Final permitted review result

Production configuration presence and deployment metadata were rechecked.
Source review is complete within the no-database/no-provider boundary. No
additional code fix was needed; the earlier 96 focused passing tests and
shared/frontend type checks are reused, not rerun. The known unrelated API
attendance-test type error remains. Neither the published source revision nor
live recipient delivery was verified.

| Channel | True readiness and remaining Owner step |
| --- | --- |
| IN-APP | Authenticated database-backed inbox implemented; live storage/access not retested because application DB inspection is prohibited. |
| EMAIL | Real Resend adapter implemented. Screenshot and presence-tool evidence conflict about provider/sender configuration. Confirm exact saved keys before proposing any change; preserve the existing key. |
| Browser PUSH | All VAPID settings present; local pair/subject validation exists and returns only a boolean. Actual Production values and browser subscriptions remain unverified. Do not rotate keys without evidence. |
| TELEGRAM | Token/encryption secret present, but Production opt-in absent. Complete trusted credential/storage/bot ownership and hosting checks before approved enablement; retain parent-owned chat consent. |
| SMS | Unavailable in prepared source policy/capability/dispatch; leave disabled. No claim is made about the revision currently loaded in Production. |

No secrets are accessible through the current presence-only tooling. Therefore
local Production credential validation cannot be completed in this session.
Development values are not substitutes. Existing source validation is a safe
mechanism for a later approved Production runtime, not proof it has run there.

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
| `RESEND_API_KEY` | Present | Existence only; API access/domain authority unverified |
| `COMMUNICATION_EMAIL_PROVIDER` | Not reported by tool | Later screenshot evidence conflicts; exact saved key unresolved |
| `EMAIL_FROM` | Not reported by tool | Later screenshot evidence conflicts; do not overwrite sender |

The secret-inspection interface returns no secret values and offers no
Production-side validation executor. Consequently token syntax, encryption-secret
length/quality and stability, VAPID syntax/subject and key-pair agreement are
**unverified**, not passed and not known-invalid. Do not substitute Development
values or read an authenticated push endpoint to extract keys into a report.
Telegram/VAPID credential keys are present; email selection and sender remain
unresolved because subsequent screenshot evidence conflicts with this inventory.
No credential has been established as invalid.

Deployment metadata reports a public, successfully built **Autoscale** deployment:
`https://educore.yetenia.com`, with the additional published address
`https://edu-pulse-school-management--ogunlakinyemi.replit.app`.
This does not prove the published bundle matches the current source.
The earlier source comparison found differences from GitHub main; that comparison
was not repeated in this documentation-only review.

## Shortest safe sequence

1. The permitted source/configuration-presence review is complete. Obtain separate
   approval and a trusted execution mechanism for Production-local credential
   validation and application schema/policy/subscription/backlog inspection.
   These were not authorized or performed here. No provider calls or sends are
   needed for local checks. Do not migrate, cancel or replay records without
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
   For email, preserve `RESEND_API_KEY` and reconcile screenshot/tool metadata
   before proposing provider/sender changes under **Publishing → Adjust settings
   → Production app secrets**. Do not add duplicates or overwrite existing settings.
   Do not invent a sender or infer domain verification from key presence.
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

### Backlog risk — source evidence only

The normal server invokes its communication dispatcher at startup, then every
15 seconds; the opted-in Telegram worker starts immediately and ticks every
three seconds. The ordinary dispatcher does not restrict itself to newly created
notification IDs: it claims due `QUEUED`/`FAILED` records below the attempt limit,
excluding `PROVIDER_OUTCOME_UNKNOWN`, in due/creation order. That claim has no
general creation-age cutoff. Current recipient, Owner/school policy and dispatch
guards still apply, but do not make a release inherently send-free. Restoring
valid email/push configuration or enabling Telegram may release older eligible
work. Unknown outcomes stay held for reconciliation, not automatic replay.

No application DB was accessed; backlog size, age, actual policies, consents,
subscriptions and existing Production activity are unknown. Do not approve
unrestricted release on the assumption that the queue is empty.

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
- In the updated source, `/api/communication/push-configuration` validates VAPID
  format, P-256 public/private agreement and subject locally before reporting
  `configured`. It uses authenticated access and returns only the intentionally
  public application-server key to the browser. `deliveryEnabled` still does
  **not** prove worker activation, recipient eligibility, provider acceptance or
  receipt. This runtime validator has not been executed against Production by
  the agent; publishing the source is a separate approval.
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

Next single action: approve a separately scoped **trusted Production preflight**
covering local credential validation, storage/policy/backlog inspection and the
always-on hosting decision. This requires permissions/tools beyond this review;
it does not authorize provider calls, configuration changes, sends or publication.
Approve exact configuration changes and publication only after its results.
