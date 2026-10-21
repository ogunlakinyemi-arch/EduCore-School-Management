# Development attendance and notification controls

## Attendance

Reused `attendance_events`, settings, historical class assignments, discrepancies,
corrections and existing device/security authorization. No schema migration.

- Gate `SCHOOL_ENTRY` (Tag-in), `SCHOOL_EXIT` (Tag-out) and
  `CLASSROOM_ENTRY` remain separate event types, including in filters/reports.
- An accepted, security-validated student NFC morning gate entry creates
  provisional classroom PRESENT with identification/source `NFC_GATE_AUTO`.
  It is **not biometric verification or teacher confirmation**.
- Morning uses Africa/Lagos time: default05:00 until12:00, further constrained by
  the school's configured entry window. Noon and later do not auto-mark present.
- Creation joins the original gate transaction. A per-school/student/day
  transaction lock and existing unique dedupe key prevent repeated/concurrent taps
  from creating duplicate derived class attendance. Existing accepted classroom
  evidence is never overwritten. Exit never creates or deletes class attendance.
- The derived row retains gate timestamp, school/student/card/device identifiers,
  available academic IDs, historical class/section snapshot and a reason naming
  the source gate event. No future-created or foreign-school class assignment is
  used. No historical record is backfilled or reclassified.
- Missing placement, out-of-window missing class presence and a contradictory
  recorded classroom absence are flagged for review. Teacher/manual results are
  retained, not overwritten. Existing delayed reconciliation remains available.
- School attendance retains event/source/subject/date filters and printing.
  Employee NFC monthly reports add Teacher/Other staff filtering, retaining
  separate entry/exit totals. These are software records, not hardware acceptance.
- Existing authorized manual classroom records/corrections provide the roll-call
  path; existing enrollment/device validation remains required for real future
  fingerprint events. No biometric enrollment or verification is invented.

## Owner and school channel controls

Owner notification settings now expose allowed/default channels per event:
entry, exit, absence/attendance, card/NFC reminders, subscription reminders,
emergencies and existing categories. Per-school overrides restrict channels or
disable notifications; they cannot expand global permissions.

- Default SMS permission: attendance and emergencies only. Card/subscription,
  finance, academic and other categories are blocked unless Owner explicitly
  changes that category's global policy. Default channel is in-app.
- School Admin choices must pass current Owner permissions **and configuration
  readiness** on the server. Owner does not gain ordinary school-default writes.
- Queueing intersects global permissions, school permissions, mapped-event
  choices (with legacy category fallback) and existing recipient consent.
  Owner defaults apply without expanding the allowed set.
- Before provider dispatch, current global/school permissions and school choices
  are rechecked. Disallowed queued deliveries become CANCELLED with
  `OWNER_CHANNEL_POLICY`; no provider call is made.
- Existing recipient/tenant/child authorization, consent ordering, idempotency,
  delivery evidence and Termii transport are preserved. Emergency campaigns carry
  an explicit emergency event marker; generic SECURITY is not assumed emergency.
- In-app is available. Email/SMS require configured real adapters; push requires
  existing VAPID configuration. Development send locks remain authoritative.
  Telegram uses the Development-only Bot API integration described below. A
  configured channel does not establish actual delivery or recipient authorization.
- Global settings are append-only snapshots in existing audit metadata; the
  latest successful Owner policy is read, and malformed policy fails closed.
  **Retain these governance snapshots during any future audit-log cleanup.**
  This avoids a new configuration table/migration in this focused Development
  change; no existing audit record is rewritten.

## Verification and limits

**126 distinct targeted API tests passed across seven files:**13 native gate/class,
19 policy unit,11 governance HTTP,40 queue/dispatcher,12 attendance-role,
23 existing attendance-phase and8 attendance-communication tests. Passing
unchanged suites were reused rather than repeatedly rerun. OpenAPI/codegen and
API/frontend typechecks passed.
No broad financial audit or Flutterwave LIVE test was repeated.

Development API and web workflows are running with notification workers paused.
Duplicate-startup port conflicts were cleared only after verifying the older local
listeners had no active connections. API health returned200; anonymous Owner-policy
access returned401. No passing test suite was repeated during that recovery.

No application DB migration, credentials/provider configuration change, real SMS,
real-recipient test message, Production/Publish change or publishing is included.
No real provider delivery, biometric device, NFC hardware or authenticated browser
acceptance is claimed by the isolated tests or public sign-in rendering.

## Telegram in Development

### Setup and policy

1. Keep `TELEGRAM_BOT_TOKEN` in Replit Secrets. Never paste it into a chat, URL
   field, delivery log or screenshot. `SESSION_SECRET` must remain a stable
   secret of at least 32 characters; it derives the AES-256-GCM key used for chat
   storage. Changing it requires parents to link again; undecryptable bindings
   cannot send and are not shown as valid links.
2. Apply the reviewed additive Telegram schema in **verified Development only**:
   three dedicated link/challenge/poll-state tables and expanded existing
   delivery/preference/template channel checks. No historical rows are rewritten.
   No startup DDL or automatic Production migration is installed.
3. `EDUCORE_DEVELOPMENT_TELEGRAM_ENABLED=true` explicitly enables only Telegram
   alongside the existing paused Development workers. Existing
   `EDUCORE_DEVELOPMENT_WORKERS_PAUSED` and
   `EDUCORE_DEVELOPMENT_PAYMENT_TEST_NOTIFICATIONS_DISABLED` remain unchanged and
   continue restricting SMS/email. Without the separate opt-in, their existing
   send lock also keeps Telegram disabled. Set the Telegram flag to false to
   suspend this channel during any further notification/financial QA.
4. The Telegram-only worker checks `getMe` and `getWebhookInfo`; it will not
   delete or replace an existing webhook. Configuration is unavailable for an
   absent/invalid token, missing encryption key/schema, existing webhook,
   unreachable bot, stale health or a deployment/Production runtime.
5. As Platform Owner, open notification settings and choose **Check bot
   configuration**. This is a rate-limited, audited, read-only Bot API check.
   It never sends a message and never returns the token or chat IDs.
6. Permit Telegram for the required event categories in Owner settings, then
   choose it in the relevant school's defaults. School overrides may restrict or
   disable it but cannot expand Owner permissions. No policy is automatically
   relaxed by adding the token or enabling the worker.

Supported existing event mapping includes gate Entry/Tag-in, Exit/Tag-out,
absence/class-attendance updates, emergencies, NFC/card and subscription
reminders. Generic SECURITY is not assumed to be an emergency. Existing
provisional NFC classroom wording and evidence remain unchanged.

### Parent linking and withdrawal

1. Sign in as a Parent with a live, school-scoped linked-child relationship.
   Open the school's notification/preferences page.
2. Read and explicitly check consent for Telegram messages about verified linked
   children. Create the ten-minute link and open it in Telegram. Press Start in
   the bot's **private** chat. No browser endpoint accepts a manually supplied
   chat ID, and the bot sends no automatic acknowledgement or test message.
3. Return to EduCore. Check the pending Telegram account label and explicitly
   confirm that account. A bot start alone is insufficient to activate delivery.
   The random token is single-use; only its hash is persisted. A chat cannot be
   actively bound to another parent account.
4. Consent covers this parent's verified linked children, subject to each
   school's current permissions and category preferences. Relationships,
   active accounts, selected school and category consent are rechecked before
   dispatch. Unscoped notices use generic text rather than exposing student data.
5. **Unlink and withdraw consent** works even when health/policy is unavailable.
   It erases stored chat ciphertext/fingerprint, revokes pending challenges and
   cancels queued/retryable Telegram deliveries. `/stop` or `/unlink` in the
   verified private bot chat also withdraws consent, including pending linking.
   Already accepted/in-flight messages cannot be recalled.

### Safe testing and delivery evidence

- Automated tests use fictional accounts, isolated PostgreSQL and fake HTTPS
  responses. Never send a real-parent test message automatically.
- The Owner configuration check is the offered test path; there is deliberately
  no real-message test form or arbitrary-recipient send endpoint.
- A successful `getMe` check proves the credential identifies a bot, not that a
  parent received a message. A sendMessage acknowledgement is recorded as
  accepted/SENT, never as DELIVERED/read.
- Existing stable event identities, unique per-channel deliveries and committed
  `SKIP LOCKED` claims provide local duplicate protection. Telegram provides no
  sendMessage idempotency key: timeouts, lost responses and abandoned processing
  claims stay held as `PROVIDER_OUTCOME_UNKNOWN` for reconciliation rather than
  being resent. Explicit 429 rejection honors Telegram's retry_after plus bounded
  application backoff, with bot-wide/per-chat pacing.
- Owner/school revocation, missing relationships, consent withdrawal and
  unavailable health fail closed. Delivery logs retain safe provider status,
  message ID and error categories, never recipient chat IDs or credentials.

If `TOKEN_MISSING` or `INVALID_TOKEN` appears, add/correct **only**
`TELEGRAM_BOT_TOKEN` in Development Replit Secrets and restart the API, then
repeat the Owner health check. For `WEBHOOK_CONFLICT`, explicitly resolve the
existing bot webhook before choosing polling; the app does not take it over.
For `DEVELOPMENT_SEND_LOCK`, explicitly enable the separate Telegram Development
opt-in; do not lift SMS/email locks. No Production enablement or publishing is
included.

## Parent onboarding and School Admin invitations

This extension reuses the existing challenge, consent and audit storage.
**No new migration is required or applied. Application database migrations require
explicit approval.** Isolated SQL tests create disposable fictional databases;
they do not apply DDL to the application's Development or Production database.

### School Admin directory

In **Parents & Guardians**, select the correct school and open a parent's
**Telegram status**. Status loads on demand and refreshes while open:

- **Not invited:** no current invitation or valid confirmed link.
- **Invitation pending:** an unexpired invitation exists; generating a refresh
  revokes the previous pending token. The URL is returned once only.
- **Linked:** the parent has completed personal linking and consent. This is not
  proof of receipt.
- **Disabled/consent withdrawn:** only the parent can restart linking; an Admin
  cannot override withdrawal.
- **Delivery unavailable:** current health/policy or the latest delivery failure
  prevents readiness. Resolve the actual cause; do not lift unrelated locks.

Only an active School Admin for that school can generate/copy/refresh invitations.
Platform Owner, Teacher, Parent, other-school and unrelated-parent requests cannot
perform these operations. The parent needs an active EduCore account and live
child relationship in that school. URLs and locally rendered QR codes contain
only the bot's public username and a 32-byte random opaque start token, never
internal school/parent/student IDs, bot tokens or reusable credentials. Server
storage contains its hash only. Tokens expire after ten minutes and cannot be
replayed; refreshing revokes older pending invitations. Generated URLs are held
only in browser memory and removed on expiry or scope change.

### An Admin invitation is not a chat-binding credential

The Admin necessarily knows the link they generated. It must not let the Admin
prepare their own Telegram account for accidental binding to a parent.

1. An Admin invitation/QR can start onboarding in a private bot chat, but cannot
   complete account linking, even with a later direct confirmation request.
2. The parent signs in to EduCore and selects the correct linked child/school.
   The **Connect Telegram** header action opens Communication centre →
   Preferences. School and child context is displayed only after authenticated,
   live parent-relationship verification; it is never sent to an unauthenticated
   bot chat or exposed by a public token-lookup endpoint.
3. The parent checks consent and creates a **personal** link. This replaces the
   Admin-known pending invitation with a fresh token available only to that
   signed-in parent. Open that link/QR, press Start in the private bot chat, then
   return to EduCore. If arriving through an Admin QR first, this is a second,
   intentionally required bot start.
4. Review the pending account and school/child context, check the separate final
   consent box and confirm. Starting the bot, scanning a QR, matching a phone or
   an Admin action alone cannot link the account. Existing consent covers this
   parent's verified linked children, with each school's current policy and
   relationships rechecked before sending.

The bot sends no automatic onboarding acknowledgement, school/child detail or
test message. Parent Portal instructions explain the return-and-confirm step.
Admin refresh requests reserve part of the parent's link-request quota so that
repeated Admin refreshes cannot consume all personal-link attempts.

### Optional contact comparison

Parents may optionally share their **own** Telegram contact during personal
linking. Another person's contact is ignored. An optional phone comparison
accepts international formatting and equivalent Nigerian local/international
formats, comparing against the saved parent/account phone. It does not discover
whether a number uses Telegram and never messages a phone number.

Only an encrypted comparison fingerprint/result is retained, not the shared
contact's raw phone number. A mismatch blocks confirmation and is shown in the
authenticated portal. The parent can supply their own matching contact or
create a fresh personal link without sharing a contact. A match is never proof
of identity; authenticated parent access, live relationships and final consent
are still mandatory. The comparison is revalidated at confirmation.

### In-app notice and conditional push

Creating/refreshing a directory invitation queues a generic parent-facing
in-app notification under current SYSTEM policy. Refreshes within the same
ten-minute window reuse its stable event identity. Its link opens the signed-in
Parent Portal preferences; it contains no invitation token or internal IDs.

Push is offered only when existing VAPID configuration is valid, Development
send locks permit it, Owner policy permits SYSTEM/PUSH and the parent has an
active valid saved push subscription. The existing dispatcher still checks
device/session authorization before sending. Push content remains generic;
configuration or provider acknowledgement does not establish physical receipt.
The immediate push attempt is scoped to this invitation's notification ID and
cannot drain unrelated queued messages. Existing delivery records, retry and
unknown-outcome protection remain authoritative.

When these conditions are absent the UI explicitly reports push unavailable.
No push configuration is enabled by this feature, no SMS/email fallback is used,
and their existing credentials, send restrictions and paused workers are unchanged.
No real test message is sent, no Production/Publish setting is changed, and
nothing is published.
