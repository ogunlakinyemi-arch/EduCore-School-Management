---
name: Isolated SQL rehearsal boundaries
description: Credential-free process isolation and lock-observation pitfalls in disposable PostgreSQL checks.
---

For strict credential-free execution, resolve the actual Node executable through
a clean discovery process, then run that executable with an explicit `env -i`
allow-list. Keep rejecting inherited database/provider configuration.

**Why:** This workspace's Nix Node wrapper adds `PWD` and `SHLVL` even after
`env -i`. A strict environment gate rejected that wrapper before any SQL ran.
The unwrapped `process.execPath` avoids adding exceptions to the safety gate.

**How to apply:** Discover only executable identity, not environment values.
Use private empty client configuration/home files, explicit Unix socket,
database and role arguments, and verify the fresh server's data directory and
process identity before SQL. Never substitute an application connection.

Catalog deparsing is not lock-free, and killing a psql client does not imply its
server-side statement has stopped or its transaction locks have been released.

**Why:** Definition inventory timed out behind a deliberately held relation lock;
after the client was killed, its backend could remain in `pg_sleep`, retaining
the lock until the statement completed.

**How to apply:** Capture definitions before contention, allow bounded fixture
sessions to finish their explicit rollback and normal exit, verify their
disappearance, then inspect definitions. Do not relax migration timeouts or
misclassify an instrumentation wait as a draft DDL failure.
