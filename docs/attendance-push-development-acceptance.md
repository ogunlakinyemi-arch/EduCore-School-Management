# School attendance and browser Web Push — Development acceptance

## Boundaries

This extension does not publish, migrate Production, replace VAPID keys, enable
financial services, or authorize real notifications. Development worker pause
and payment-test notification suppression remain in force. Tests use synthetic
identities, mocked storage and mocked transports; they do not establish real
database concurrency, vendor firmware compatibility or physical delivery.

## Attendance

The existing Attendance page has a Schedule tab. School Administrators can save
a school-specific schedule/rules revision with a reason. Staff and the Owner can
read it; Teachers cannot configure it. Platform ownership is not school-operation
authority, including on a dual-role account. Saving uses a revision check so an
older form cannot overwrite a newer policy.

Defaults are Africa/Lagos, Monday–Friday, arrival 06:45–07:45, late at 08:00,
absence review at 10:00, Monday–Thursday closing 14:00 and missing-exit review
14:00–16:00; Friday closing 13:00, missing-exit review 14:00. The 07:45–08:00
period is grace, not late. Classroom evidence is reviewed from 08:15.
Closures and student-specific dated exemptions suppress automated assessments
and provisional class presence; authentic factual gate events remain retained.
They do not disable device/card/tenant authorization.

The Owner's existing terminal direction control now offers Entry Only,
Exit Only and Entry and Exit. Combined mode uses the latest accepted school-day
gate state under the same per-school/student/day transaction lock used by
assessments. First scan is entry; an on-campus student's later scan is exit.
The default combined mode rejects early exit, close repeat scans and re-entry.
These policies are configurable; existing fixed readers remain fixed.
An Exit Only reader can still record an exit without entry, using the existing
discrepancy handling rather than inventing an entry.

Offline events require immutable idempotency keys, their original timestamps,
and chronological replay. The default offline window is 72 hours (configurable).
The same event replay retains its original action, even after mode changes.
A scan older than accepted gate state requires review; it never retroactively
toggles the student's state. Delayed events retain attendance/security evidence
but do not send misleading real-time arrival/departure notices. Vendor terminal
denials retain durable receipts in the existing audit store.

Missing arrival, classroom evidence or tag-out creates an idempotent review in
the existing discrepancy workflow, not an authoritative ABSENT event or proof
of physical location. NFC_GATE_AUTO remains provisional and cannot substitute
for teacher/biometric confirmation. Later gate/classroom evidence resolves only
this scheduler's still-open reviews. Approved/dismissed/manual decisions are not
reopened or overwritten. Tag-out never deletes provisional classroom presence.

Background assessments reuse the existing paused worker. Saving a school policy
opts that school into assessments when controlled Development workers are
eventually authorized to run. The School Administrator can also run bounded
500-student assessment batches, with a continuation cursor in the UI.

Schedules/rules use retained append-only Attendance audit snapshots, and
attendance_settings mirrors compatible fields for existing consumers. No
database migration is needed. These snapshots, like terminal direction/receipt
metadata, are operational records and must be preserved during audit cleanup.

## Browser push

The existing browser control obtains permission only on a button click, ensures
the existing scoped service worker is ready, calls PushManager, serializes the
actual endpoint/p256dh/auth material and saves it against the authenticated
user, Clerk session and selected school. An opaque test/readiness reference
without a subscription is not delivery-capable. Expired or old-key browser
subscriptions are replaced. A storage error never reports successful signup.

The existing outbox sender checks current Owner policy, school channels,
recipient preferences, user/school entitlement, and Clerk session validity.
It claims each subscription conditionally before sending. Expired/404/410
subscriptions are revoked. An uncertain transport response retains an uncertain
claim and is not blindly resent. Provider acceptance never means device receipt.
Lock-screen content is generic; clicking opens the authenticated inbox within
the artifact path. The service worker uses a validated notification tag for
replacement/idempotency, never a supplied arbitrary destination or child details.

The real provider uses the existing VAPID secrets; only the public key is exposed
to PushManager. Development sends require explicit approval followed by
EDUCORE_DEVELOPMENT_PUSH_ENABLED, an approved EDUCORE_DEVELOPMENT_PUSH_USER_IDS
allowlist, and unpaused workers with notification suppression removed. None of
these settings has been enabled by this work. Mock transports never send.
The public configuration distinguishes key availability from sending permission.

## Remaining authorized manual acceptance

No real-user notifications or physical reader tests are authorized by these steps.
Use approved test identities/recipients only after explicit authorization.

1. In signed-in School Admin, Staff, Teacher and Owner browsers, verify policy
   edit/read/denial and cross-school isolation, including mobile layout.
2. Confirm a saved policy survives restart and concurrent stale saves return a
   conflict against an independently verified Development database.
3. Use an approved reader simulator/device to confirm the three modes, lost-response
   replay, duplicate scans, ordered offline events, out-of-order review, closures,
   exemptions, Friday times and teacher corrections. Physical hardware remains a
   separate vendor-delivery acceptance gate.
4. In supported HTTPS browsers, check actual permission, service-worker scope,
   PushManager registration, refresh, account/session changes, denial and
   revocation. Include an installed iOS/iPadOS Home Screen app where required.
5. After separate sending approval, send only to the allowlisted test user.
   Check visible generic notification, authenticated inbox navigation, preferences,
   expired endpoints and signed-out sessions. Record browser observation separately
   from provider acceptance. Do not drain old queues or enable Production sending.
