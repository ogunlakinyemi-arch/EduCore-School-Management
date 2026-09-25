---
name: Development database targeting
description: Why development-only fixture writes must verify the database they will actually reach.
---

For test-data provisioning, do not infer the database target solely from shell environment labels. Check the database reached by the actual connection against the platform's development and production views before any writes, and fail closed if the target is unfamiliar.

**Why:** In this workspace, an interactive development shell reported a production environment label while its database connection reached the development database. Treating that label as authoritative blocked legitimate setup; ignoring it without checking the database could have been unsafe.

**How to apply:** Before adding or running a one-off fixture or seed command, compare read-only database identity/aggregate queries through the command's connection and the platform's development/production database targets. Keep an explicit development-only guard even after confirming the target.