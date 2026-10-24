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
Use the actual scan timestamp within five minutes of server time; preserve it
and the event ID on retries. Identical retries do not duplicate inventory audit
records; conflicting reuse returns 409. School IDs, attendance fields, changed
event types and extra properties are rejected. Suspended devices, released
bindings, mismatched device credentials and inactive Owner authority fail closed.

This handler has no attendance/security/notification dispatch path. The Owner
dashboard only reads the inventory—it does not simulate taps or post manual reads.
Registration alone is not physical connectivity. A received UID establishes an
authenticated device report, not hardware attestation or vendor acceptance.

The same reader model must support configuring this callback and dedicated
credential. Until firmware is configured and a card is genuinely tapped, show
**Waiting for authenticated reader**. No USB/browser driver or vendor API is
invented; vendor firmware changes may be required for the separate callback.

Inventory marks a UID already present in card records as assigned/reserved,
including retired card records; capture never assigns or activates a student card.
Use the existing Owner card lifecycle, school-reader prerequisites and replacement
controls for assignment. Do not reuse a retired UID or bypass replacement payment.

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
