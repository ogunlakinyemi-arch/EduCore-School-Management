# Owner UID-only NFC readers

One registered NFC/HYBRID reader has exactly one operational context:

* **Unassigned:** no school, no active Owner reader binding.
* **Owner UID reader:** explicitly bound to the currently authenticated Platform
  Owner. Captures card UIDs into inventory only. Not a school attendance device.
* **School attendance:** linked to a school through the existing device assignment
  and credential flow. Its CARD_SCAN events use the existing attendance endpoint.

Device and school primary keys, the `EDUCORE01`/`SCH01` protocol mapping and the
school terminal contract are unchanged. Serial-number uniqueness remains enforced
by the existing database unique index.

## Provisioning

Register the hardware in Platform Owner → Devices. Select an unassigned NFC or
HYBRID serial and **Use as UID reader**, enter a reason and confirm. The operator
is the signed-in Platform Owner, not a school. This creates a dedicated device
credential shown once; store it securely in the reader's approved configuration,
never in a URL or an attendance payload.

* `GET /api/platform/uid-inventory`: Owner-only bindings and captured inventory.
* `POST /api/platform/devices/:deviceId/owner-reader`: Owner-only binding;
  JSON `{ "reason": "Inventory desk reader" }`.
* `POST /api/platform/devices/:deviceId/owner-reader/unlink`: Owner-only explicit
  release, same reason shape. Revokes the binding credential immediately.

The device must first be explicitly unlinked from any school. An Owner reader
must be explicitly released before either school assignment endpoint accepts it.
Changing contexts never changes historical school credentials, attendance or card
ownership. School keys are revoked on Owner binding; an Owner key cannot
authenticate school attendance. Re-pairing requires unlinking first.

## Reader firmware callback

`POST /api/v1/owner-reader/uid-events`

Headers: `Content-Type: application/json` and
`Authorization: Bearer <dedicated Owner reader credential>`.

Illustrative body only—do not submit placeholders:

```json
{
  "event_id": "inventory-read-0001",
  "device_id": "EDUCORE01",
  "uid": "REPLACE_WITH_ACTUAL_CARD_UID",
  "event_type": "CARD_SCAN",
  "timestamp": "REPLACE_WITH_ACTUAL_SCAN_TIMESTAMP"
}
```

Only genuine reader-reported 8/14/20-character hexadecimal UIDs are accepted.
These represent the 4/7/10 UID bytes in antenna/reader order, zero-padded hex.
Capture does not generate a new identifier, reverse bytes, authenticate card
memory or require student enrollment. Firmware in explicit Owner capture mode
must read/report the anticollision UID **before** any attendance, roster, card
inventory, access, subscription or payment validation. Report even a card which
school attendance would reject (unknown, unassigned, locked, revoked, expired,
assigned to another school). Do not send attendance rejection fields to this
endpoint, and do not fall back to a school endpoint on failure.

Successful capture retains `rawUid` exactly as sent and uses uppercase `uid` as
the inventory key. The response includes `scanStatus` (`UNKNOWN_UNASSIGNED`,
`ASSIGNED` or `RESERVED`), `duplicateUid` (already captured or registered),
`duplicate` (same event retry), and `purpose: UID_INVENTORY_ONLY`. A duplicate
never suppresses the raw UID. Inventory lists one row per canonical UID, but
separate genuine taps retain separate receipts. Captures from multiple readers
serialize per UID; requests from one reader serialize with linking/unlinking.

Use the actual scan timestamp within five minutes of server time; preserve it
and the event ID on retries. Identical retries do not duplicate inventory audit
records; conflicting reuse returns 409. School IDs, attendance fields, unsupported
event types and extra properties are rejected. Suspended devices, released
bindings, mismatched device credentials and inactive Owner authority fail closed.

### Connectivity and reader errors

Use the **same authenticated callback and dedicated credential** for:

* `READER_HEARTBEAT`: `event_id`, `device_id`, `event_type`, `timestamp`; no UID
  or error code. Send every 30 seconds with a fresh event ID/timestamp per report.
* `CARD_SCAN_ERROR`: the same envelope plus `error_code`, one of
  `UNSUPPORTED_CARD`, `READER_ERROR`, `TRANSPORT_ERROR`; no UID. Use this only when
  the hardware cannot obtain a valid UID, never for unknown/unassigned cards.
  If a valid UID was obtained, send `CARD_SCAN` instead, irrespective of any
  attendance decision.

The panel distinguishes waiting for a first authenticated report, connected
within 90 seconds, and offline/no recent report. This is a liveness indication,
not proof of a physical outage. Legacy firmware without heartbeats cannot prove
idle connectivity. Releasing and rebinding starts fresh connectivity evidence
without deleting historical UID inventory.

Malformed attributable payloads from an authenticated linked reader return 400
`MALFORMED_SCAN` and update diagnostics, but never add a UID. Invalid credentials
return 401/403 and cannot update diagnostics. Invalid JSON or invalid device
identifiers cannot be attributed safely to hardware and do not update its panel.
503 `TRANSPORT_ERROR` means no confirmed capture: retry the original envelope
within the five-minute window. A terminal which is fully disconnected cannot
report its own transport failure; no recent heartbeat and dashboard fetch errors
are shown separately. Do not claim a server-supplied success while disconnected.

The most recent successful raw UID remains visible with a copy action even after
a later unsupported/malformed scan or dashboard fetch failure. The existing
explicit **Assign to Student** confirmation is a separate registration action.
Capturing alone never invokes it, activates cards, or changes subscriptions.

This handler has no attendance/security/notification dispatch path. The Owner
dashboard only reads the inventory—it does not simulate taps or post manual reads.
Registration alone is not physical connectivity. A received UID establishes an
authenticated device report, not hardware attestation or vendor acceptance.

The same reader model must support configuring this callback and dedicated
credential. Until firmware reports, show **Waiting for authenticated reader**.
No USB/browser driver or vendor API is invented; vendor firmware changes may be
required for the separate callback. The repository contains integration protocol
documentation, not the terminal's firmware source. A hardware photo and a linked
device do not establish installed firmware compatibility or physical acceptance.

Authenticated heartbeat/error receipts use the operational audit action
`Owner reader status reported`. Retain these alongside bindings and capture
receipts. Never use arbitrary client-provided diagnostics as an authentication
substitute; the same device lock, active binding, secret verification and current
Owner-authority checks run before accepting a diagnostic.

### Focused Development verification

Route tests cover authorization, raw unknown and assigned UID capture, duplicates,
malformed/unsupported/error reports and write isolation. The opt-in
`owner-uid-reader.postgres.test.ts` additionally exercises real SQL list queries,
concurrent readers, concurrent retries, status retention and zero attendance/
payment/security writes. It only accepts a verified disposable Unix-socket
cluster under `/tmp/educore-owner-uid-*`, role/database `owner_uid_fixture`, port
55441, through `OWNER_UID_TEST_SOCKET`. It never reads application connection
strings. UI tests cover statuses, preserved raw results, copy success/failure and
dashboard transport errors. These are software checks, not a genuine terminal
or authenticated dashboard acceptance claim.

Inventory marks a UID already present in card records as assigned/reserved,
including retired card records; capture never assigns or activates a student card.
Use the existing Owner card lifecycle, school-reader prerequisites and replacement
controls for assignment. Do not reuse a retired UID or bypass replacement payment.

## Confirmed inventory assignment and replacement

Platform Owner → Devices → a captured **Available** UID → **Assign to Student**
opens a read-only UID form with school/student selection and confirmation.
`POST /api/platform/uid-inventory/assign` accepts
`{uid,schoolId,studentId,confirm:true}`. The transaction locks the student and UID,
checks genuine authenticated capture evidence, rejects every previously reserved,
assigned or retired UID, and requires a currently configured active NFC/HYBRID
attendance reader actually assigned to that school. Assignment is initially
**locked**; activation/subscription/payment rules are unchanged. A student with
any card history must use replacement rather than bypass it as a first assignment.

Platform Owner → Card Replacements → **Unlink old card for replacement** requires
LOST/DAMAGED, a meaningful reason and confirmation. The old UID is revoked before
invoice creation; an invoice failure does not restore a lost/damaged card.
`POST /api/platform/uid-inventory/cards/:cardId/unlink` accepts
`{kind:"LOST"|"DAMAGED",reason,confirm:true}` and audits the old UID, actor and reason.
Students reuse the existing NGN 2,000 replacement invoice. Employee replacement
request/payment remains with the School Admin after Owner revocation.

Only after verified payment may the Owner select a new available captured UID in
the existing replacement request. `POST /api/platform/uid-inventory/replacements/:id/issue`
with `{uid,confirm:true}` reuses existing verified-payment/receipt/refund checks,
checks old-card revocation, and prepares/consumes the new UID in the same issuance
transaction. All failures roll back new UID preparation. Old/new IDs, UIDs, reason,
actor, timestamps and card history remain linked. Prepared legacy card selection
remains supported by the existing issuance path.

School-device release/reassignment also now requires a meaningful server-validated
reason; it is not merely a UI requirement.

## Official ID cards and QR verification

Owner `/cards` includes school-specific primary/secondary color configuration.
Student bands and angular decorations use colors extracted from each school's
logo/crest, not a fixed blue/cyan/green palette. A dominant logo color is darkened
within its hue for at least 4.5:1 white text/icon contrast. Distinct logo accent
colors are retained where possible; single-color crests get related tonal accents.
Transparent/white backgrounds are ignored. If extraction is unavailable, use the
saved primary school color or a restrained default, also contrast-adjusted.
Employee fronts (Teacher, Staff, Driver and Accountant) use another distinct logo
hue rather than the Student dominant hue. Sparse or monochrome logos use a
deterministic complementary fallback; white NFC icons/text retain at least 4.5:1
contrast. Employee labels reflect the current employee type, never a generic
Staff label for every employee. Reverse sides use Yetenia Technologies Limited
ownership, EduCore product/service details and yetenia.com contact details, not
school ownership/contact branding. Student identity details are ONLY name, permanent
registration/admission number and the actual assigned NFC UID. Do not print class,
student role or school registration number on Student fronts. These cards last
until graduation. Employee role/department designation remains unchanged.
No Parent/Guardian template is added.

Both official preview and PDF download use the same CR80 two-page renderer and
the same stable verification QR. Printing remains SELECT-only and does not assign,
activate, unlock or issue a card. School Admin preview and Owner download scopes
remain unchanged. The existing saved school logo/photo loaders remain in use.

QR contents are opaque authenticated encrypted identity references, not NFC UIDs.
No names, contact details, photos or raw card UIDs are encoded.
Paste the QR contents at `/card-verification`, which calls the public read-only
`POST /api/v1/id-cards/verify` with `{token}`. The response reveals only a current/
invalid result and explanatory text, never school/person/card identifiers.
Revoked cards and changed holder bindings invalidate verification. QR copying
does not establish physical-card or holder authenticity and grants no access.

The server derives domain-separated verification keys from `SESSION_SECRET`.
Missing/invalid configuration fails closed. Rotating that secret invalidates old
printed QRs; coordinate key rotation with reprinting. No secret is sent to browsers.
Retain `Official card brand configured` audit entries as operational school
printing settings alongside the reader operational entries.

The supplied Student ID reference defines the front layout: white school-first
header with logo/address/contact, large portrait left, the three Student identity
fields or employee designation in the middle, verification QR right, and a
contactless role footer with layered diagonal accents. Teacher/Staff use the same visual family
with additional secondary-school-color accents. The reference child's image,
sample school details and QR are never reused as actual card data.

## Event-time UID display

Authorized attendance reads resolve `cardUid` from the event's `nfc_card_id`,
restricted to its school and student (or proven earlier ownership history). They
never substitute the student's currently active replacement card. Manual events
or old records without provable card linkage display **Not available**.

Student details separately expose the current assigned `nfcUid`, scoped to that
student and school. Neither field broadens existing record access permissions.
Exports use the same event-time value as the attendance screen.

## Persistence and retention

No schema migration is needed. Owner bindings (including credential hashes, never
raw secrets), releases and UID capture receipts use the existing append-only audit
store as durable operational records. Preserve `Owner UID reader binding` entries
in module `Devices` and `Owner reader UID captured` entries in `UIDInventory` during
audit retention, archival and redaction, just like terminal directions/receipts.
Do not expose binding metadata or UID inventory through unauthenticated endpoints.
