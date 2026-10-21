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
  Telegram is displayed unavailable because no adapter is configured. A configured
  channel does not establish actual delivery or recipient authorization.
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
