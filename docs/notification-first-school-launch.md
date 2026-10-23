# First real-school notification launch — source preparation only

No release, configuration change, database query/write, provider call or real send
is authorized by this document. The new safeguards are not active in the running
deployment until a separately approved release. Flutterwave/payment settings are
unrelated and unchanged.

## TEST history is retained, never replayed into real-school delivery

The Owner states all existing schools, users and notifications are TEST data; no
live school is onboarded. In-App history remains untouched.

Production external dispatch now fails closed unless the non-secret
`EDUCORE_NOTIFICATION_LIVE_FROM` configuration contains an explicit UTC timestamp
in `YYYY-MM-DDTHH:mm:ss.sssZ` format. It must be at or after the immutable TEST-data
floor `2026-10-23T12:34:38.000Z`, and not in the future at dispatch time.
Missing, invalid, normalized/overflowed, backdated and future values hold delivery
before adapter construction, claims, attempt changes or stale-processing recovery.
Manual notification scopes and injected providers cannot bypass this hold.

After separate launch approval, choose a cutoff **after all TEST onboarding and
before any real-school/user onboarding**. Do not set it to the floor just because
the floor is accepted. Do not move it backwards. Do not reuse TEST school/user
records as real ones or rewrite their creation dates.

Even after a valid cutoff, delivery claims and pre-send reloads require ALL of:

- delivery created at/after the cutoff;
- original notification created at/after the cutoff (a new retry cannot relabel it);
- recipient user created at/after the cutoff;
- school created at/after the cutoff, unless the notification is global.

This intentionally excludes existing TEST identities/schools from external sends,
even if someone edits their email or creates a new delivery later. Their In-App
records remain accessible under existing authorization. Genuine older identities
cannot be enrolled into this initial launch by changing the cutoff or timestamps;
that would require a separately reviewed, explicit promotion mechanism.

Excluded intents are left unchanged, not deleted, cancelled, marked delivered or
charged attempts. Unknown provider outcomes remain held for reconciliation.
The cutoff is not a universal TEST classifier for data created later: after the
boundary, keep QA in Development or keep external delivery held.
This guard covers EduCore communication dispatch, not Clerk identity-provider
email, separate invitations or non-notification provider uses.

## Resilience without a new service

Maintenance (subscription evaluation, attendance assessment and finance intent
reconciliation) and delivery now have independent in-process overlap locks and
failure handling. A maintenance failure/slow run no longer prevents a delivery
tick. Existing durable claims, bounded retries, recipient/policy checks, device
deduplication and uncertain-outcome holds remain in place.

Timers still stop when the process stops/scales to zero. This is not an always-on
worker, a durable scheduler, or a timing guarantee. Existing Autoscale hosting
requires a separately approved hosting/durable-worker decision.

## Email ambiguity: do not overwrite settings

The operator screenshot appeared to show provider/sender configurations, while
Production metadata did not report `COMMUNICATION_EMAIL_PROVIDER` or `EMAIL_FROM`.
This conflict is unresolved; “definitely missing” is not a current finding.
Confirm full key names, intended Production app and saved state without sharing
values. Do not add duplicate settings, infer a sender, replace keys, add a silent
fallback or contact Resend to resolve the display discrepancy.

The adapter still requires explicit provider selection and sender. Key presence
and the launch cutoff do not prove domain verification, sending scope or runtime
configuration. No source fix can establish these provider-side facts.

## Channel/launch gates

- In-App remains available independently of the external launch hold.
- Email and Browser Push now expose separate **setup availability** and **delivery
  availability**. With locally valid runtime configuration, the general notification
  settings and Parent Portal allow preference setup while the launch hold remains
  active. Saving preferences never changes the cutoff or releases queued work.
  Owner/school default validation still uses delivery availability, not setup.
- `/api/communication/channels` is authenticated and returns only fixed status
  text/booleans for readiness; it never returns the sender or credentials. Its
  `setupAvailable` fields and `launchHeld` flag are local configuration evidence,
  not evidence of provider authorization, current recipient eligibility or receipt.
  Email status identifies the exact missing setting without assuming the screenshot
  or presence tool is authoritative. Existing saved settings are not overwritten.
- Browser Push implementation and subscriptions are preserved; external dispatch
  obeys the cutoff. Validate Production VAPID locally, confirm released service
  worker/browser permission and real-user subscriptions before approved tests.
  `/api/communication/push-configuration` now includes the launch guard when
  reporting `deliveryEnabled`, but device setup remains available when its local
  VAPID pair/subject validator passes. Permission remains explicit, subscriptions
  retain school/user/session association, and registration does not imply receipt.
  The intentionally public application-server key is supplied only for browser
  registration; private key and subject are never added to these responses.
- Telegram retains its independent explicit Production opt-in and readiness/
  consent checks. The Owner subsequently approved saving
  `EDUCORE_PRODUCTION_TELEGRAM_ENABLED=true` in Production configuration, and the
  non-secret setting was saved/read back. No restart or publication followed.
  The launch cutoff remains unset: this opt-in cannot bypass the dispatch hold.
  Runtime bot readiness, storage and parent consent remain separate prerequisites.
  A later release must include the launch guard; do not publish an older bundle
  with the new opt-in. Configuration approval is not permission to poll or send.
- SMS remains unavailable and excluded from dispatch.
- Before release review database schema/storage and the approved SQL tool target;
  no Production SQL was run for this work. Unit SQL-shape checks are not live
  database or provider evidence.
- Only after release/configuration approval and all readiness checks, authorize
  one controlled test with a consenting recipient. Acceptance is not receipt.

## Email/Push setup change verification

159 focused API/frontend tests passed, including synthetic VAPID pair matching/
mismatch rejection, the push-configuration launch hold, no-claim launch behavior,
email configuration diagnostics, recipient authorization, preference-setup
selection, explicit browser permission, mocked subscription persistence/revocation,
worker activation and per-device dispatch/retry/session safeguards.
All network adapters used mocks; no real subscription, email or push was created.
Shared code generation/typechecking and frontend typechecking passed. API
typechecking still reports the unrelated attendance-test unknown-to-object error.

The actual saved Production VAPID pair was not accessed or certified: presence
metadata is not key validation. After an approved release, the application can
validate it locally without provider contact and show boolean setup readiness.
Production metadata still did not confirm the email provider/sender, despite
earlier screenshot evidence. The exact email manual blocker is confirmation that
the intended Production app has the saved `COMMUNICATION_EMAIL_PROVIDER=resend`
and approved `EMAIL_FROM` loaded; do not create duplicates or share values.

A new approved publish is required to release these application changes. No
restart/publish or configuration/secret change was performed for this setup work.

Deployment address previously verified: https://educore.yetenia.com.
No URL probe, service restart or publication was performed for this source change.
