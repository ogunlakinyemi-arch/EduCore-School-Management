# NFC Card Scan Audit and automatic UID discovery

This application update is implemented in Development. It does not configure
physical hardware, change keys/registrations, publish, or establish physical
acceptance. Only authenticated reports actually transmitted to EduCore can be
shown. Firmware-local rejections and unreadable cards cannot yield invented UIDs.

## Existing contracts and storage

School terminals retain `POST /api/v1/terminal/events`, their school credentials,
normal CARD_SCAN body and response/replay semantics. Owner readers retain
`POST /api/v1/owner-reader/uid-events` and their dedicated credentials.

The existing `audit_logs` schema already has the JSONB metadata and event identity
needed for this extension. Schema and reconciliation migrations were inspected;
no schema migration or shared Development/Production database mutation is needed.
No inventory table or duplicate `nfc_cards` rows are created by discovery.

School terminal receipts retain canonical UID, original scan time, server receive
time, processing-time registration evidence, stable reason and terminal/school
snapshots. Evidence is written outside the attendance savepoint but in the same
transaction as the durable receipt. A business denial rolls back partial
attendance, notifications and security effects before saving the denied receipt.
A failed mandatory receipt rolls back accepted attendance too.

Unknown/expired/inactive/other-school cards still fail the existing eligibility
rules. Discovery does not assign, activate, enroll, charge or notify anyone.

Malformed reports are only attributed after a real credential and both supplied
device/school IDs match. Authority is rechecked under the device row lock.
Malformed UID input is never persisted. Missing/unusable original timestamps
remain unavailable. Unauthenticated/misattributed input is not stored.
Diagnostics are best-effort and cannot replace original protocol errors.
Invalid JSON that cannot be safely attributed remains outside the scan ledger.

Accepted Owner captures reuse their original individual receipts; heartbeats,
errors, malformed reports and exact retries are separately classified. Owner
receipt/credential identities and timestamps are never rewritten.

## Inventory and registration

The Card UID Inventory derives one row per canonical valid UID across genuine
Owner capture receipts and new school receipts. First/last seen are server
receipt times; detection count excludes retry and diagnostic rows. Source school
is event-time attribution, never a device's later assignment.

Unregistered UIDs display **Pending Registration**. Existing cards remain
registered/reserved/assigned/retired with their original state untouched. The
same UID from several readers remains one inventory entry.

**Add to Registration** opens the existing UID-prefilled student assignment
confirmation. Its server checks are unchanged: Platform Owner authority,
authenticated discovery provenance, valid UID, active student, school-owned NFC
reader eligibility, no prior student card history, no existing UID reservation,
and the existing transaction/UID lock. Initial assignment stays locked; normal
activation and replacement/payment rules still apply.

## Restricted read contract

`GET /api/platform/uid-inventory?view=scans` extends the existing Owner-only read
endpoint. Filters: q (literal UID substring), schoolId, deviceId, from/to (ISO
instants), source SCHOOL/OWNER, registration REGISTERED/UNREGISTERED/UNAVAILABLE,
result, kind SCAN/RETRY/HEARTBEAT/MALFORMED/ERROR, page and pageSize (max 100).
Dates filter scan time when available, otherwise server receipt time.

`format=CSV` exports the selected evidence with a 5,000-row maximum, refusing
truncation. Formula-leading CSV cells are escaped. Every scan-view/export records
Owner access without logging UID search strings. Responses use no-store.
The general school-scoped audit API is unchanged and does not expose metadata.
The Owner page uses no student names or credential values.

The default view is card scans, not all physical taps. `scanTotal` excludes
retries, heartbeats and diagnostics. Separate taps retain separate events;
identical device/event/payload retries retain one capture plus retry diagnostics.
Conflicting event-ID reuse stays a conflict and never replaces original evidence.
“Registered now” and processing-time registration evidence are distinct; older
receipts can have unavailable historical registration/UID fields.

## Privacy and retention boundary

UIDs are sensitive persistent identifiers, not public data or authorization
secrets. Do not send UID/body/credential details to ordinary HTTP logs. The
existing request logger strips query strings and response bodies.

Do not delete/rewrite receipt event IDs, fingerprints, binding history or replay
state to implement privacy retention. No automatic deletion period is invented
by this update: an approved policy must decide scan-detail retention separately
from operational receipt retention. Any future expiry must remove only approved
sensitive detail fields or archive them privately while preserving replay safety,
and must account for inventory/registration provenance. Diagnostic storage is
bounded per record but is not a claim of bounded lifetime.

## Verification boundaries

Focused route/unit tests cover permissions, malformed reports, unknown denials,
unchanged responses, retry/conflict semantics and no automatic card creation.
Opt-in PostgreSQL tests use only explicitly verified disposable Unix-socket
databases and synthetic identities. They exercise projections, pagination,
registration provenance, event-time reassignment, rollback of attendance/security/
notification writes, and mandatory receipt failure. No physical terminal,
Production event, provider send or credential operation is part of these tests.
