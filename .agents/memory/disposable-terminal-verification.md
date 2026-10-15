---
name: Disposable terminal verification
description: Safe local build and schema boundaries for real terminal HTTP tests against disposable PostgreSQL.
---

Use the application's standard bundling configuration, with only the terminal entry and a separate ignored output directory, when an isolated runtime blocks outbound sockets. Do not broaden the network allowance just to run the TypeScript CLI.

**Why:** The source-runner launch failed to become ready under the strict socket guard. Ad hoc externalization then lost workspace dependency resolution and selected a CommonJS PostgreSQL entry without its ESM named exports. The existing bundler correctly handles these dependencies and logging workers without requiring changes to the preview build.

**How to apply:** Keep normal dist untouched and run the terminal-only build in a clean child environment. Limit application connections to the exact private PostgreSQL socket. A successful localhost test is neither a deployed staging host nor physical terminal evidence.

Source schema exports alone do not necessarily include retained raw-migration indexes required by runtime conflict clauses.

**Why:** A real scan rolled back with HTTP 503 because the source-only disposable schema lacked the existing attendance discrepancy unique index used by ON CONFLICT. Applying the exact retained migration definition to the disposable database restored the real request path.

**How to apply:** Check genuine migration definitions when preparing disposable schemas; never invent or weaken constraints to make a test pass. Report schema setup corrections and distinguish targeted local route verification from a full migration-chain rehearsal.
