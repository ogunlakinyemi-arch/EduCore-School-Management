# Supported notification channels — Production setup

> **First-school launch update:** [launch boundary and current gates](notification-first-school-launch.md).
> Production external dispatch now requires an explicit non-secret launch cutoff.
> Nothing is enabled by this source change. The email presence inventory below is
> historical and conflicts with later screenshot evidence; do not overwrite
> provider/sender settings until exact saved keys are confirmed.

## Source corrections, not activation

The Owner requests IN-APP, EMAIL, PUSH and TELEGRAM across notification categories,
with SMS unavailable. No real provider calls, sends, configuration/secret changes,
database changes, service restarts or publication are authorized by this work.
Flutterwave LIVE remains untouched.

Source now uses one capability calculation for Owner/school controls and the
Parent Portal channel list, which previously omitted Telegram. Email uses the
actual selected adapter's local constructor validation; provider selection is
normalized consistently. Push validates the P-256 key pair and contact subject
locally before reporting readiness or invoking transport. Invalid push and
unconfigured production email deliveries are deferred before claiming, not
failed repeatedly. The Parent Portal no longer equates acceptance with receipt.

SMS is unavailable in capability results and blocked in effective channel policy,
preference enabling and communication dispatch, even if legacy policy or
credentials exist. Existing SMS history/configuration is not deleted. Other
non-notification uses of provider adapters are outside this change.

New/absent Owner policies permit all four supported non-SMS channels for every
listed event, including attendance, academics, assignments, finance, payments,
announcements, account, system, subscription, Partner, security, NFC reminders
and emergencies. Only IN-APP is a default: permitting a channel does not opt
people in or create subscription/consent. Existing saved Owner/school policies,
preferences and audience restrictions are not rewritten or broadened.

## Production presence review — 2026-10-23

Production-scoped inspection includes inherited shared configuration, never
Development credentials. Secret values were not returned or inspected.

| Channel | Production evidence | Remaining steps |
| --- | --- | --- |
| IN-APP | Database-backed authenticated inbox exists in source | Existing function; actual published storage was not retested here |
| EMAIL | `RESEND_API_KEY` present; provider/sender screenshot and tool metadata conflict | Confirm full saved keys and approved verified sender before any change |
| PUSH | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` present | Production values/pair remain unverified; release local validator and prepared worker fix after approval |
| TELEGRAM | `TELEGRAM_BOT_TOKEN`, `SESSION_SECRET` present; `EDUCORE_PRODUCTION_TELEGRAM_ENABLED` absent | Reviewed opt-in, origin, storage, bot ownership and always-on hosting |
| SMS | Deliberately not operational | Leave disabled; no setup or sending authorized |

No credential is known invalid. Presence alone does not establish valid
credentials, sender verification, encryption compatibility, delivery or receipt.

## Exact email setup

Only if exact saved configuration confirms a change is needed, and after reviewing
the launch cutoff, backlog, policies and precise changes with the Owner:

1. In **Publishing → Adjust settings → Production app secrets**, preserve the
   existing `RESEND_API_KEY`. Add `COMMUNICATION_EMAIL_PROVIDER=resend`.
2. Add `EMAIL_FROM` using the exact already-authorized Resend-verified sender,
   preferably `Yetenia EduCore <approved-address@verified-domain>`. The bracketed
   address here is a placeholder, not a value to copy. The approved sender address
   and domain verification are not established by this review. Do not invent a
   mailbox or replace the API key solely because email was marked unavailable.
3. A provider-local validity check can confirm syntactic configuration without
   sending; domain authorization and API-key validity still need separately
   approved provider-side verification. Do not call a provider as part of this
   no-network setup review.
4. After explicit release approval, republish to load settings and source. A
   release can immediately process existing eligible queues; it is not a harmless
   send-free configuration check. No release is authorized by these instructions.

The optional HTTP email gateway is not configured (`COMMUNICATION_EMAIL_ENDPOINT`
and `COMMUNICATION_EMAIL_API_KEY` absent); it is not required for the Resend path.
Do not set `COMMUNICATION_EMAIL_PROVIDER=http` without a separately reviewed
HTTPS gateway. A missing provider selection intentionally stays unavailable
rather than silently falling back to simulation or guessing from a secret.

## Push and Telegram setup

Follow [the activation handoff](notification-production-activation.md) for exact
Publishing and recipient UI steps. In particular:

- Telegram needs the missing Production opt-in `true` and the exact trusted
  HTTPS app origin where runtime host coverage is unverified. Diagnostics cannot
  unlock delivery. Preserve the stable `SESSION_SECRET` and dedicated bot
  ownership. Eligible parents must link their own private chat and confirm
  consent; Owner status does not make someone a subscribed Telegram recipient.
- Push needs no new Production flag. Existing keys should not be rotated without
  evidence; the new validator fails closed on invalid/mismatched pairs or subject.
  HTTPS, activated service worker, explicit browser permission, saved real
  subscription, current Clerk session, school entitlement and preferences remain
  required. Registration is not a receipt.
- The current published deployment uses Autoscale. In-process polling and
  dispatcher timers cannot promise delivery while scaled to zero. Approve an
  always-on arrangement or reviewed durable worker architecture before activation.

## Owner/category controls after an approved release

Open the published app as the active Platform Owner at `/notification-settings`.
Under **Owner notification controls**, inspect every category:

1. Allow the intended non-SMS channels. If an older saved policy excludes
   Telegram, explicitly allow it for the intended categories and save the policy.
   Existing policy is never automatically expanded by a release.
2. Choose defaults only for channels with actual delivery readiness. Review
   school-level overrides; a school cannot expand Owner permission. School Admins
   can select permitted, available defaults for their school.
3. Recipients retain their per-category preferences, required account/security
   behavior, browser permission and explicit Telegram consent. Availability
   indicates backend capability, not delivery to every role/device or recipient.

Preserve tenant/audience rechecks, durable deduplication, rate limits, dispatch
claims, uncertain-send holds and audit records. Approve a single controlled
recipient test separately only after all setup checks pass.

**Current result:** source prepared only. The new external launch boundary is
required. Email provider/sender metadata remain unresolved; Telegram's Production
opt-in was not reported present. Push credentials exist but Production readiness
is unverified. SMS remains intentionally disabled. No channel was activated or
physically delivery-tested in this work.
