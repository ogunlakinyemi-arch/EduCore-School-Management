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

Concurrency probes must recognize earlier application serialization gates,
not require every competing request to reach the final row lock.

**Why:** A correctly serialized pair of payment verifiers can wait at different
layers. Counting only the final row/commission lock falsely reports that one
verifier never arrived, even though it is waiting at the shared financial gate.

**How to apply:** Observe only the relevant, explicitly identified query/gate
shapes and retain the terminal-state, event-count and exactly-once assertions.
Fix stale fixture instrumentation rather than removing production serialization.

PostgreSQL binary availability does not establish OS network-isolation capability.

**Why:** On 2026-11-26 PostgreSQL tools were installed, but the workspace denied
`unshare --net` with `Operation not permitted`.

**How to apply:** When a rehearsal requires network-namespace isolation, check
that capability before creating a cluster. Report the rehearsal blocked if it
is unavailable; do not substitute a socket-only or mocked run for that evidence.

Offline test safety must cover test discovery and process creation, not only
database connections.

**Why:** Native PostgreSQL tests can initialize a cluster in setup before opening
a client socket. An accidentally unfiltered Vitest invocation did this even
though its database connections were blocked.

**How to apply:** Pass validated, explicit file arrays instead of relying on a
multiline CLI argument. Exclude native cases from mixed offline/native files.
For offline-only runs, reject native PostgreSQL child processes as well as
database/outbound sockets. Connection rejection is not namespace isolation.
