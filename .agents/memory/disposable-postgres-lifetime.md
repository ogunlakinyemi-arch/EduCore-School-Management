---
name: Disposable PostgreSQL process lifetime
description: Shell-launched PostgreSQL may not survive its launching call in this workspace.
---

Keep a temporary PostgreSQL server as a tracked background shell task if later checks must connect to it.

**Why:** A server started with `pg_ctl start` inside a one-off shell invocation stopped when that invocation ended, even though the startup command succeeded. This can masquerade as a migration-driver failure.

**How to apply:** For disposable migration/restore tests, use a unique local data directory and socket/port, run the server through a tracked background shell task, verify the target is the disposable instance, and stop the task after tests. Never substitute the development or production connection simply because the temporary server is unavailable.