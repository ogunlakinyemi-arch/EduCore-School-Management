---
name: Hardware identity correction boundary
description: Duplicate hardware records must be corrected without recreating the primary identity or disturbing terminal events.
---

For the authorized duplicate hardware identity correction, retain both device
records and histories, preserve the primary numeric ID, active Owner binding and
credential, and retire the secondary registry record. Preserve the full
before/after serial mapping in an atomic Owner-authored audit. A serial correction
does not authorize school reassignment, credential rotation, unlink/rebind,
firmware changes, or event/queue reconciliation.

**Why:** The user explicitly chose correction of the existing primary record and
deactivation of the duplicate, not recreation of hardware or deletion of history.
They authorized Production execution only through a supported application
transaction after fresh invariant checks, and prohibited publishing in that
request.

**How to apply:** Treat application implementation, deployment availability and
authorized execution as separate prerequisites. If the serving workflow,
runtime target or event-reference conditions cannot be verified, stop before
Production writes. Never substitute direct database edits or a local invocation
using Production connection credentials.
