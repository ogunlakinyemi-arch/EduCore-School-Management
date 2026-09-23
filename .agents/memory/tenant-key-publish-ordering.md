---
name: Tenant-key publish ordering
description: Why composite tenant foreign keys may require a staged Replit Publish.
---

For existing production tables, publish explicit `UNIQUE (id, school_id)` tenant keys before adding composite foreign keys that reference them.

**Why:** Replit Publish can order separately created unique indexes after foreign keys in a single schema diff. PostgreSQL rejects those foreign keys because referenced uniqueness must already exist. A preparatory publish made the named tenant keys available first; the following publish can then add only the dependent foreign keys.

PostgreSQL may bind a composite foreign key to any matching unique index. Replit's planner can treat an index referenced by a foreign key differently from an otherwise identical standalone index, so matching names and definitions are insufficient when development and production dependencies point at different indexes.

**How to apply:** Preserve both named tenant constraints and legacy unique indexes. Keep composite foreign keys bound to the same uniqueness objects in development and production, verify `pg_depend` when duplicate equivalent indexes exist, and require a non-destructive Publish diff.