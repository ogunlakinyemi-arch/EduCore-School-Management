# Vendor NFC terminal compatibility

This software adapter adds `POST /api/v1/terminal/events`. It has not been
verified against the vendor's staging service or physical terminal. The vendor
reported testing its own side, not EduCore. No Production operations, real
terminal calls or payment changes are part of this implementation.

## Provisioning

Use existing Platform Owner → Devices → Configure. For an assigned NFC/HYBRID
device, select and **Save terminal direction** separately from other configuration:
`ENTRY` or `EXIT`. There is no default and no alternating-scan inference.
Unconfigured terminals return 503. A direction is scoped to the device's school.
After changing school assignment, reopen Configure and explicitly confirm the
direction for that school before use. Direction changes do not change old receipts.

Use the complete existing generated device credential (`identifier.secret`) as
`Authorization: Bearer identifier.secret`. Existing credential rotation, expiry,
revocation, active/configured-device checks and school association remain enforced.
Clerk/user tokens are not device keys. Keys are never returned by the event API.
The legacy `/api/device/attendance/events` and `X-Device-Credential` remain unchanged.

## Request

`Content-Type: application/json`, maximum **16 KiB**, one JSON object per event:

```json
{
  "event_id": "terminal-100-event-0001",
  "device_id": 100,
  "school_id": 10,
  "terminal_name": "Example entry gate",
  "uid": "A1B2C3D4",
  "event_type": "CARD_SCAN",
  "timestamp": "2026-10-15T08:30:00",
  "firmware": "example"
}
```

IDs above are placeholders, not existing credentials or production identities.
School/device IDs are positive integers (decimal strings also accepted), and must
match the authenticated registered device. The server never trusts `terminal_name`
for identity or direction. Event IDs contain 1–128 letters/digits/`_.:-`; optional
name/firmware strings are at most 128 characters. Unknown fields are rejected.

UIDs are exactly 8, 14 or 20 hex characters, normalized to uppercase. No separator
removal, truncation or byte-order conversion is attempted. Lowercase legacy stored
UIDs match case-insensitively on this endpoint only. The existing active student/card,
school, identification, subscription and security eligibility checks still apply.
The vendor must confirm that its UID byte order matches EduCore enrollment.

Timestamp accepts an ISO date/time with seconds, optional 1–3 fractional digits,
and optional `Z`/`±HH:MM`. Timezone-free timestamps use **Africa/Lagos (UTC+01:00)**.
The accepted inclusive window is **now minus 366 days through now plus 5 minutes**.
Invalid calendar dates are rejected. Store the instant in existing attendance
records and derive `event_date` in Lagos, not UTC. Historical accepted scans use
the existing reconciliation pipeline; they do not send current entry/exit alerts
or mutate current security presence (security validation still runs).
This does not reconstruct historical card/student eligibility; current eligibility
is required. Review historical class attribution separately before bulk backfills.

## Responses and retries

Accepted: HTTP 200, e.g.

```json
{"success":true,"duplicate":false,"retryable":false,"message":"Attendance recorded","student_name":"Example Student","action":"ENTRY"}
```

`action` is `ENTRY` or `EXIT` for acceptance, `DENIED` for business denial, and
`null` for protocol/service errors. `student_name` is null when unavailable.
An identical successful replay returns the saved receipt with `duplicate:true`
after current card/security eligibility is rechecked. Credential rotation does
not change the event identity. Replayed business denials stay denied.

Business denials (unknown/ineligible card, school policy/security rejection) return
HTTP 200 with `success:false`, `retryable:false`, `action:"DENIED"`. Existing rapid
scan suppression with a *different* event ID also returns a denied 200 receipt
with `duplicate:true`; it does not create a second attendance row.

Errors: 400 invalid JSON/fields/UID/time; 401 device credentials; 403 device-school
mismatch; 405 non-POST (`Allow: POST`); **409 conflicting event-ID reuse**;
413 size; 415 content type; 503 unavailable/unconfigured direction.
Only service failures have `retryable:true`. Do not blindly retry business denials
or validation/conflict errors. On network loss/503, preserve the exact event ID,
original timestamp and payload. Never replace the timestamp with retry time.

The normalized payload hash includes both optional fields and the **original
timestamp string**. Equivalent timezone spellings are different payloads; UID
case and numeric ID representations normalize. An event ID is namespaced by
device, not credential, and cannot be reassigned to another payload or school.
Direction is frozen with the first durable receipt.

## Persistence and scope

No new attendance table or schema migration is needed. Successful scans use the
existing attendance, card validation, reconciliation and security pipeline.
The adapter owns one transaction with a device-row lock, an event advisory lock
and a savepoint; attendance and the protocol receipt commit together. Denials
roll back partial attendance effects before recording the denied audit receipt.
Ambiguous/lost commit responses can be retried with the original event.

Direction configuration and durable protocol receipts use the existing
`audit_logs` metadata. **These specific audit entries are operational state:
do not delete, redact away their identity/receipt fields, or expire them while
their devices/events remain eligible for retries.** Receipts retain original
event ID/time, normalized instant, hash, frozen direction and attendance ID;
not the raw UID or device key. Receipts can contain the returned student name,
so apply the same access/retention controls as attendance records.

The device lock serializes ingestion with credential rotation/reassignment.
No external hardware/provider API is called by this adapter.

## Staging and firmware prerequisites — not completed here

For the fail-closed, worker-free local process and its non-secret configuration
requirements, see `nfc-terminal-isolated-startup.md`. It does not provision a
database, build/start a process, or establish real staging readiness.

- Approved isolated staging host/database, verified not Production, and a
  registered, school-bound configured NFC/HYBRID device with a saved direction.
- Stage-only device credential, eligible student/card fixtures, and HTTPS routing
  to the new path. No production DNS, secrets or device setup is changed here.
- Vendor confirmation of ID formatting, UID byte order, timestamp format, action
  values (`ENTRY`/`EXIT`/`DENIED`), maximum body size and the extra 409 conflict error.
- Real terminal test for entry and exit, invalid/other-school cards, credential
  rotation, lost responses, concurrent retries, offline replay within 366 days,
  clock skew, and school attendance/report CSV visibility.
- Firmware must supply a durable queue, stable unique event IDs, original
  timestamps, backoff, protected local storage and explicit response handling.
  **No terminal firmware queue is implemented in the web app.**

Focused automated tests use loopback HTTP and mocked persistence/security.
They do not prove PostgreSQL locking/commit recovery, authenticated Owner UI,
provider connectivity or physical device operation.
