# Owner UID delivery and inventory — Development

## What is known about the reported failure

The terminal display establishes that a card UID was read locally. “HTTP 401 -
retained” establishes that a request was not authenticated, not that the UID was
accepted by EduCore. The screenshot does not reveal the request URL, header,
device identity or installed key. No terminal firmware source or redacted wire
trace was supplied. Do not claim that a specific physical request was inspected
or that hardware delivery has been verified.

Source inspection confirms two intentionally incompatible provisioning paths:

| Purpose | Provisioning | Device authentication | Event route |
|---|---|---|---|
| Owner UID capture | `POST /api/platform/devices/:id/owner-reader` | Dedicated Owner binding key, SHA-256 hash stored in the active binding | `POST /api/v1/owner-reader/uid-events` |
| School attendance | Existing school credential endpoints | School-bound `device_credentials` record | Existing school attendance / terminal endpoints |

Both Owner heartbeat and scan use **the same** callback, `Authorization: Bearer
<dedicated Owner key>`, and the exact canonical `device_id` issued in the
configuration. Neither a school key, an old Owner key, a serial number substituted
for the device ID, nor a browser session authenticates Owner scans.

The Owner callback is mounted before Clerk and human API authorization middleware.
The version is `v1`; incorrect routes are not silently redirected or exempted from
their normal authorization. There is no cross-purpose credential fallback.

The confirmed software recovery gap was the absence of an explicit Owner-key
rotation/handoff action. Previously the Owner could only release/rebind to replace
a lost or mismatched one-time key. Repairing provisioning does not configure
installed firmware remotely.

## Safe recovery

1. In Development, open **Devices → Owner UID reader → Repair / rotate Owner
   credential**. Verify the displayed device name/serial/ID.
2. Confirm the warning and reason. Rotation invalidates this reader's previous
   Owner key immediately; it does not change ownership or allow school use.
3. Save the one-time replacement on **that physical terminal only**. Configure
   the displayed full callback URL, `Authorization` header with `Bearer` scheme,
   exact `EDUCORE…` device ID, and 30-second heartbeat interval.
4. Send a fresh heartbeat, then make a fresh physical tap in Owner capture mode.
   Read/report UID bytes before any student, card-inventory or attendance checks.
5. Open **Card UID Inventory** from Owner navigation or the reader panel. An
   authenticated scan appears on the next three-second refresh with its raw UID,
   source device, received timestamp and status.

Rotation is Owner-only, bound to the currently owning user, row-locked against
link changes and guarded by the displayed non-secret credential version.
Concurrent/stale requests cannot silently replace a newly provisioned key.
Neither existing keys nor hashes are exposed in inventory. Do not retry a
provisioning request automatically after a lost response; refresh and review the
binding before another explicit rotation. No operational keys were rotated by
the development verification.

Use a fresh event ID/time for a new physical event. On an uncertain HTTP response,
retry the same event ID/time unchanged. A retained event older than the existing
five-minute window cannot be made valid by relabelling its timestamp; reconcile
the receipt or present the physical card again. Do not convert attendance payloads
into capture events or remove signatures/ownership checks.

## Owner-visible inventory

`/card-uid-inventory` is Platform Owner-only, with an always-visible empty/loading/
error state. `/api/platform/uid-inventory` supports parameterized `q`, `status`,
`deviceId`, `page` and `pageSize` filters, a total count, and bounded pages. All
successful captured UIDs are reachable, not just the first 500.

One row per UID includes canonical UID, latest raw reader representation, latest
source device/name/serial, first/last authenticated receipt times, distinct
successful event receipt count and duplicate status. Same-event transport retries
do not increase this count; later genuine reports retain their own receipts.
Device filtering includes any source which captured that UID; the source shown
on the row is explicitly the latest source. Search matches the UID or latest
source name/serial. Failed/unsupported scans never invent inventory UIDs.

Unknown/unassigned cards remain visible before student linkage. The registration
action opens the existing explicit confirmed assignment flow; it is not performed
by capture or copying. Existing card/replacement/payment prerequisites remain
unchanged. Heartbeats do not erase the latest successful UID or latest trusted
failure indication. Unauthenticated errors cannot safely update device status.

## Verification and boundaries

The local-only `OwnerReaderProtocolHarness` refuses non-loopback targets. With a
verified disposable PostgreSQL fixture, the routed integration test reproduces a
wrong-key 401 with a retained event, provisions the exact linked Owner device,
loads its replacement key, delivers the retained heartbeat, submits a synthetic
raw scan, reads it back through inventory, and rejects the old key and wrong
device identity. This is software protocol evidence, not a physical card test.

Focused tests also cover wrong scheme, revoked/unlinked readers, stale
provisioning, concurrent duplicates, pagination/search, retained failure states,
copy success/failure, explicit registration and zero attendance/payment/security
effects. The fixture uses only an independently checked disposable Unix socket,
database and role described in `owner-uid-reader.md`, never application connection
strings. No Production settings/data/secrets, physical access actions, payments,
external message sends or publication are part of this work.
