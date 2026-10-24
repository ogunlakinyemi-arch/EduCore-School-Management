---
name: Owner reader purpose and historical UIDs
description: Same NFC hardware in mutually exclusive Owner UID inventory and school attendance contexts.
---

The Owner uses the same physical reader model intended for schools, registered
under the Owner as operator rather than a school. Owner mode is solely for
genuine reader-reported UID inventory; it must never dispatch attendance.
Explicitly unlink before switching between Owner and school contexts.

**Why:** The user clarified that a separate or simulated desktop reader workflow
is not the intended product, and explicitly prohibited treating Owner taps as
school attendance.

**How to apply:** Preserve the existing shared registration inventory and school
attendance pipeline. Device registration does not prove hardware connectivity;
report firmware/callback configuration and genuine tap verification separately.
Never introduce a manual/simulated UID read presented as physical evidence.

Captured UID inventory must have a complete Owner-confirmed assignment path, not
just a read-only list. Only an available reader-captured UID may be selected in
that path. Lost/damaged replacement requires explicit old-UID revocation and the
existing verified replacement payment; employee request/payment remains with
the School Admin.

**Why:** The user repeated that displaying captured UIDs alone is not a completed
workflow, and explicitly required inventory selection through replacement.

Attendance displays the UID associated with the event, not a later replacement.
Where the event's card ownership cannot be proven, show unavailable rather than
substituting the student's current card. Current card details are a separate view.

**Why:** The user explicitly requested UID visibility after tag-in/tag-out without
exposing another student's UID or rewriting attendance after replacement.

**How to apply:** Preserve event card linkage and old ownership history through
unlink/replacement. Retain UID-reader bindings and capture receipts as operational
state rather than disposable audit telemetry.
