---
name: Permanent NFC print policy
description: Student card lifetime and separation of printing from NFC activation.
---
Student cards are permanent identification throughout the student's time at a school. Never print class, section, session, term, current academic year, or subject assignments. Resolve current academic data from the backend when an authorized device reads the existing UID.

Printing and reprinting are read-only: no new identity or assignment, activation, unlocking, or lifecycle transition. Teacher cards must be printable immediately after the existing assignment workflow, even before personal activation.

**Why:** The user explicitly requires the same physical student card across academic progression. The existing Teacher assignment and activation stages are separate; downloading must not grant active device access.

**How to apply:** Keep all academic fields out of printable data contracts. Validate current identity and lifecycle on each download; retain existing permissions and tenant scope. Treat optional QR verification as unsupported unless an existing credential-free safe mechanism is confirmed.

Official Student, Teacher and Staff card generation, download, print, issue, reprint, assignment, reassignment, activation and replacement are Platform Owner-only. School Admin access is preview-only. Teachers must not preview Student ID cards.

**Why:** The master correction requirements explicitly separate official card control from normal school operations; older School Admin lifecycle permissions must not be retained.

**How to apply:** Enforce the boundary on the backend as well as every card action in the UI. Do not broaden Owner permissions into ordinary school operations.

Teacher UI status can be an effective payment-blocked status, rather than the stored assignment stage. Offer a download for the payment-blocked assigned card and let the read-only backend validate its underlying lifecycle; never require activation just to print.

**Why:** A real Owner assignment returned an effective locked status while the stored assignment was still awaiting activation. Gating print controls only on the stored-stage names hid all print actions.

An active student's current assigned identity can be previewed before the physical NFC card is activated. Preview must never activate or unlock the card, and preview eligibility must not silently broaden existing download/print eligibility.

**Why:** The Owner's assignment-to-view workflow must work while NFC access is still locked; the requested correction explicitly preserves existing printing permissions and unrelated activation behavior.

**How to apply:** Validate the actual current school/person/card relationship, permit read-only viewing independently of activation, and retain revoked/inactive/conflicting-assignment denials. Treat changes to printing eligibility as a separate request.