---
name: Separate person honorifics
description: Person-title feature withdrawn; preserve plain-name behavior and existing records.
---

The user withdrew the unfinished person-title feature on 2026-10-19 and
explicitly requested removal of the visible controls and migration warning.
Keep ordinary plain-name create/edit behavior; do not reintroduce titles or
make migration 0168 an application prerequisite without a new user request.

**Why:** The unfinished migration-dependent feature was blocking the requested
previous platform behavior, and the user repeated that it must be removed.

**How to apply:** Preserve names and historical snapshots verbatim. Do not
perform database rollback/drop operations as part of this withdrawal. Retain
Owner read-only and school-operation boundaries.
