---
name: Disposable PostgreSQL process lifetime
description: Shell-launched PostgreSQL may not survive its launching call in this workspace.
---

Keep a temporary PostgreSQL server as a tracked background shell task if later checks must connect to it.

**Why:** A server started with `pg_ctl start` inside a one-off shell invocation stopped when that invocation ended, even though the startup command succeeded. This can masquerade as a migration-driver failure.

**How to apply:** For disposable migration/restore tests, use a unique local data directory and socket/port, run the server through a tracked background shell task, verify the target is the disposable instance, and stop the task after tests. Never substitute the development or production connection simply because the temporary server is unavailable.

When `initdb` has no explicit username, connect with the actual OS account, not an assumed ambient `USER`.

**Why:** The environment's `USER` did not identify the account that initialized the disposable cluster, causing PostgreSQL role lookup to fail.

**How to apply:** Use `id -un` or `os.userInfo().username`, or retain the explicitly chosen initialization role. Keep host, socket, port and database explicit.