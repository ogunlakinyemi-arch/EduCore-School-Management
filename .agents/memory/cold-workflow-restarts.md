---
name: Cold workflow restarts
description: Distinguishing slow cold startup from an incorrect artifact port
---

After a workspace restart, a managed artifact's normal build and startup can exceed the default restart deadline. Inspect build progress and bind configuration before changing ports or run commands. A bounded longer deadline and sequential service restarts may be sufficient.

**Why:** Cold API bundling and frontend startup timed out while using the correct managed configuration. The unchanged services subsequently started successfully with longer deadlines. Replacing the workflows would have introduced an unrelated routing change.

**How to apply:** For a cold restart timeout, check the workflow logs for an unfinished build versus a crash or wrong port. If the build is progressing, restart the existing managed service with a bounded extended deadline. Do not keep retrying after a confirmed forwarding failure.