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

Owner capture must obtain/report any compatible card's raw UID before any
attendance, inventory, enrollment, subscription or access checks, including cards
that school attendance would reject. Linking does not configure installed firmware.
If the hardware obtained a valid UID despite an attendance error, report a scan,
not a reader failure. Unknown/unassigned UIDs remain visible and available for
explicit inventory registration; capturing alone never assigns or activates them.

**Why:** The user explicitly clarified that the Owner wants to read any presented
compatible card, not only a card already connected to a student. This is an
inventory-purpose operation, not an attendance decision.

**How to apply:** Distinguish raw scan results, duplicate inventory, malformed or
unsupported scans, and connectivity errors. Preserve the latest valid UID across
subsequent failures and maintain trusted-device authentication for diagnostics.
Never claim a physical hardware fix or acceptance without firmware/device evidence.

The Owner expects a clearly named, independently discoverable Card UID Inventory,
including successful captures made before student assignment. A list hidden beneath
device setup or absent until the first scan does not meet that requirement.

**Why:** The user repeated that the terminal displays a UID but the Owner cannot
find an inventory section. They also reported "HTTP 401 - retained"; a displayed
physical UID does not prove successful authenticated platform delivery.

**How to apply:** Keep inventory discoverable in Owner navigation and in reader
setup, with explicit empty/error states. Pair the exact device identity, dedicated
Owner key, Bearer scheme and versioned callback during provisioning/recovery.
Treat screenshot-only 401 evidence as insufficient to identify the exact wire
request or to authorize live credential rotation, publishing or physical tests.

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
