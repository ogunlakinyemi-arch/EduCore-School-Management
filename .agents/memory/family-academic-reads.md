---
name: Family academic reads
description: Why student and parent academic UI should use self-scoped data rather than school-wide catalog requests.
---

Student and parent academic pages should load from identity-scoped or linked-child endpoints without making their visibility depend on school-wide session, subject, or class listings.

**Why:** The school-wide endpoints correctly deny family roles; a page that waits for them can remain on a loading skeleton even when its self-scoped assignments, results, report cards, or timetable endpoint works.

**How to apply:** When adding family-facing academic context or labels, include the needed safe names in the scoped response rather than broadening catalog authorization or gating the page on manager-only queries.

Authorize the linked child independently from academic placement. A valid child without a class or teacher must produce a normal empty state, not a missing-student error.

**Why:** Legacy children can have valid school profiles and parent relationships without enrollment-history rows. Requiring enrollment in the authorization join incorrectly hides those children; inventing enrollments to fix a read page violates the preservation requirement.

**How to apply:** Prefer authoritative current enrollment. Resolve a legacy profile against an existing exact school/class/section only when no enrollment history exists; never substitute historical rows for a missing current assignment. Require a unique active current-session period. If no term is explicitly marked current, a unique active term containing today's date can supply the period without modifying the calendar. Resolve class teachers from current class-teacher assignments, not subject teaching or free-text names.