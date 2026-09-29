---
name: Development database targeting
description: Why development-only fixture writes must verify the database they will actually reach.
---

For test-data provisioning, do not infer the database target solely from shell environment labels. Check the database reached by the actual connection against the platform's development and production views before any writes, and fail closed if the target is unfamiliar.

**Why:** In this workspace, an interactive development shell reported a production environment label while its database connection reached the development database. Treating that label as authoritative blocked legitimate setup; ignoring it without checking the database could have been unsafe.

**How to apply:** Before adding or running a one-off fixture or seed command, compare read-only database identity/aggregate queries through the command's connection and the platform's development database target. If production queries are forbidden for the task, do not query production merely to compare it; use independent development connection paths and fail closed if they disagree. A plain Node import of the TypeScript workspace DB package may fail under ESM directory resolution, and the driver may be installed only in its workspace package. Neither import failure establishes a different database target. Keep an explicit development-only guard even after confirming the target.