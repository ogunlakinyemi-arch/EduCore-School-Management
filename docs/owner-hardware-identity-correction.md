# Exact Owner hardware identity correction

This is a narrowly scoped Owner application workflow, not a general device merge
or serial editor. It changes only:

| Device | Before | After |
| --- | --- | --- |
| 3 | serial `DEVICE-1000`, status `ACTIVE` | serial `YET-584E10FFC9EC`, status unchanged |
| 4 | serial `YET-584E10FFC9EC`, status `ACTIVE` or `INACTIVE` | serial empty, status `INACTIVE` |

An empty string is intentional: the reviewed serial column is non-null text and
globally unique. No schema change or invented replacement hardware identity is
needed. The original serial, both device IDs, exact before/after mapping, reason,
actor and timestamp are retained in the mandatory audit record. An existing blank
serial, serial-linked foreign key, custom trigger or unreviewed serial CHECK
blocks this operation. This is not a reusable blank-serial retirement mechanism.

The Owner opens **Devices → Review Device 3 / 4 identity correction**. A read-only
`GET /api/platform/devices/owner-hardware-correction` reviews the current records,
active bound Owner, binding, credential shape and catalog assumptions. The
confirmed `POST` requires the resulting fingerprint and a reason. Authentication
and current bound-Owner authorization apply to both endpoints.

The transaction serializes device writes, locks both records in numeric order,
rechecks all conditions and the fingerprint, clears the released source identity,
sets its inactive status, and transfers the serial. A full-row postcondition
checks that no other device fields changed; the active target binding is compared
unchanged. Audit insertion must commit in the same transaction. Any failure rolls
back both device writes. No key, binding, school, firmware, queued event,
attendance, UID receipt, card, person, financial record or prior history is
updated. Device timestamps also remain unchanged; the correction has its own
audited timestamp.

The physical protocol still requires `device_id: EDUCORE03` and the same current
dedicated Owner Bearer credential. A serial-label correction does not remap
`EDUCORE04` events, fix an incorrect Authorization header, acknowledge pending
events, or establish physical delivery. Unknown firmware queue behavior must be
reported separately; never rewrite event IDs or timestamps.

After a lost POST response, do not automatically retry. Refresh device state and
review audit evidence. A repeated old preflight is rejected rather than applying
the transfer twice.

## Production execution boundary

Implementation and disposable-fixture tests do not install this workflow in an
already running Production build. Execution requires the supported route to be
present in the serving build, an authenticated bound Owner, verified runtime
database targeting, a fresh safe review, and separately resolved event-reference
questions. No direct SQL execution, application-service invocation against a
Production connection string, credential extraction, republishing without
authorization, or unauthenticated probe can substitute for that workflow.

The user authorized only this exact identity correction, not changing terminal
settings or clearing/synchronizing the terminal's pending events.
