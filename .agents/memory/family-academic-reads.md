---
name: Family academic reads
description: Why student and parent academic UI should use self-scoped data rather than school-wide catalog requests.
---

Student and parent academic pages should load from identity-scoped or linked-child endpoints without making their visibility depend on school-wide session, subject, or class listings.

**Why:** The school-wide endpoints correctly deny family roles; a page that waits for them can remain on a loading skeleton even when its self-scoped assignments, results, report cards, or timetable endpoint works.

**How to apply:** When adding family-facing academic context or labels, include the needed safe names in the scoped response rather than broadening catalog authorization or gating the page on manager-only queries.