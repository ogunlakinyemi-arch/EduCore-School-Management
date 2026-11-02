---
name: NFC discovery without hardware mode changes
description: School scan discovery supplements attendance without converting reader purpose or changing eligibility.
---

The user selected automatic UID discovery from authenticated received school
scan reports as an alternative to switching the same working terminal into
Owner mode. Keep the working school URL, keys and registration intact.

**Why:** The school terminal is working; the business goal is finding unknown
card UIDs without disrupting school attendance. An observation is not an
attendance decision or authorization to enroll, assign or activate a card.

**How to apply:** Separate discovery/audit from attendance effects, retain
Owner-only cross-school UID access, distinguish retries from new taps, and
preserve explicit registration/activation checks. Never promise visibility into
firmware-local or untransmitted taps. New work remains Development-only until
separate release authorization.

The Owner explicitly rejected manually typed School/Device IDs in the scan
audit; use real authorized directory choices instead.

**Why:** Operators recognize school and hardware names, not numeric database
identifiers. The selected school must constrain device choices without
constraining the global “All schools / All devices” view.

**How to apply:** Preserve this boundary in later filter revisions; UID remains
text search and From/To remain date controls. This request does not authorize
changing device assignments, credentials or Production.
