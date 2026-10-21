---
name: Production DB outage signals
description: How a published-app database outage appears in deployment logs, and why its cause is hard to read there.
---

An administrator-terminated idle PostgreSQL connection can crash the published API (unhandled pool `error` event, exit 1). After restart, database failures look like Clerk sign-out: authenticated endpoints return 401 "Authentication unavailable" while Clerk token minting still succeeds.

**Why:** On 2026-10-21 (11:29:57 UTC) Production saw this, followed by about 2.5 minutes of SQLSTATE 28000 from the communication worker. The worker log keeps only enumerable pg fields (code/severity/length), so the server's message was never recorded and the exact 28000 reason could not be established from logs.

**How to apply:** Do not diagnose Production 401s as Clerk problems before checking for database errors. The worker and request handlers share one pool/DATABASE_URL, so a worker-only "wrong connection" theory needs contrary evidence. Absence of later worker errors is not proof of recovery (the dispatch guard can stay stuck if a connect hangs).
