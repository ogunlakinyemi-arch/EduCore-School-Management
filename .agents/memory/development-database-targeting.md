---
name: Development database targeting
description: Why development-only fixture writes must verify the database they will actually reach.
---

For test-data provisioning, do not infer the database target solely from shell environment labels. Check the database reached by the actual connection against the platform's development and production views before any writes, and fail closed if the target is unfamiliar.

**Why:** In this workspace, an interactive development shell reported a production environment label while its database connection reached the development database. Treating that label as authoritative blocked legitimate setup; ignoring it without checking the database could have been unsafe.

**How to apply:** Before adding or running a one-off fixture or seed command, compare read-only database identity/aggregate queries through the command's connection and the platform's development database target. If production queries are forbidden for the task, do not query production merely to compare it; use independent development connection paths and fail closed if they disagree. A plain Node import of the TypeScript workspace DB package may fail under ESM directory resolution, and the driver may be installed only in its workspace package. Neither import failure establishes a different database target. Keep an explicit development-only guard even after confirming the target.

The local Development database can restart during a workspace session while retaining its data; an old postmaster timestamp should still fail the guard, not be silently accepted.

**Why:** A subsequent verification encountered a new local PostgreSQL start time after workflow/environment recovery. Independent Development SQL and the application's connection agreed on the new identity and positively owned fixture.

**How to apply:** Revalidate through both Development connection paths and exact owned fixture identifiers before updating a session-bound fingerprint. Never weaken the guard to the database name alone or query Production to resolve it.

Fixtures must also satisfy the actual lifecycle and retained historical tenant scope, not merely the visible current status and school.

**Why:** Raw fixture inserts appeared unassigned in the UI but were not in the prepared lifecycle state. A device passed current authorization yet could not record an event because its historical school binding was absent. These were fixture errors, not permission defects.

**How to apply:** Inspect live CHECK and foreign-key definitions before raw fixture writes, or use the normal lifecycle service. Keep provisioning transactional and clean only explicitly owned test records. Never relax production guards to accommodate incomplete fixtures.

Plan cleanup before inserting live fixtures, including inspecting mutation guards. Ownership of a test row does not mean ordinary deletion is allowed.

**Why:** Historical tenant bindings are deliberately append-only, so a disposable device fixture could not be removed through ordinary deletion. This retention requirement must not be mistaken for an application defect or bypassed for real history.

**How to apply:** Prefer a disposable PostgreSQL cluster for database-only mutation tests. For required live Development UI/device checks, label and bound fixture ownership, verify cleanup prerequisites first, and preserve all original data and historical guards.