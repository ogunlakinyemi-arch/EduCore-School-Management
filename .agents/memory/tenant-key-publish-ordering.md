---
name: Tenant-key publish ordering
description: Why composite tenant foreign keys may require a staged Replit Publish.
---

For existing production tables, publish explicit `UNIQUE (id, school_id)` tenant keys before adding composite foreign keys that reference them.

**Why:** Replit Publish can order separately created unique indexes after foreign keys in a single schema diff. PostgreSQL rejects those foreign keys because referenced uniqueness must already exist. A preparatory publish made the named tenant keys available first; the following publish can then add only the dependent foreign keys.

**How to apply:** Preserve both named tenant constraints and legacy unique indexes. Before recommending a publish, inspect the actual development-to-production diff and require it to contain only the intended foreign-key additions with no index drops, truncations, table recreation, or column removal.