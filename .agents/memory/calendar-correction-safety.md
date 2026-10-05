---
name: Calendar correction safety
description: Preserve valid concurrent School Admin calendar edits instead of replacing saved dates with illustrative examples.
---

Treat the full session range as an explicit school configuration, distinct from individual term ranges. Example dates in a correction request are not authority to overwrite valid dates subsequently saved by the School Admin.

**Why:** During a calendar investigation, the School Admin corrected the session range and created the missing term before the agent's baseline capture. The capture guard stopped an obsolete correction plan from overwriting those legitimate edits.

**How to apply:** Recheck the target and its audit evidence if a date guard fails. Confirm the same Development database independently, preserve valid new dates and existing term IDs, and capture a fresh baseline only if none already exists. Reuse existing terms rather than delete/recreate them for acceptance. Clearly distinguish observed successful creation from creation actually rerun by the tester.
