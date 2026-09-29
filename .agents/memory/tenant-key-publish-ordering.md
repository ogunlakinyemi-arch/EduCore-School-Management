---
name: Tenant-key publish ordering
description: Why composite tenant foreign keys may require a staged Replit Publish.
---

For existing production tables, publish explicit `UNIQUE (id, school_id)` tenant keys before adding composite foreign keys that reference them.

**Why:** Replit Publish can order separately created unique indexes after foreign keys in a single schema diff. PostgreSQL rejects those foreign keys because referenced uniqueness must already exist. A preparatory publish made the named tenant keys available first; the following publish can then add only the dependent foreign keys.

PostgreSQL may bind a composite foreign key to any matching unique index. Replit's planner can treat an index referenced by a foreign key differently from an otherwise identical standalone index, so matching names and definitions are insufficient when development and production dependencies point at different indexes.

For newly introduced parent tables, a standalone unique index may be omitted from the generated Publish diff even when dependent foreign keys are included. An explicit unique constraint becomes part of the new table's creation statement. For an existing parent table, the planner can put its new unique constraint *after* dependent foreign keys, so adding the constraint alone does not make a single Publish safe.

**How to apply:** Preserve both named tenant constraints and legacy unique indexes. Keep composite foreign keys bound to the same uniqueness objects in development and production, verify `pg_depend` when duplicate equivalent indexes exist, and require a non-destructive Publish diff. Use the read-only `explainSchemaDiff` callback to inspect the actual ordered Publish SQL; a passing checked-in migration replay does not prove that diff is safe. Statement positions may vary between diff previews, so compare the named prerequisite and dependent foreign key in each fresh result rather than relying on fixed statement numbers.

The documented Database UI lets a human select Production, enable Edit, and use its SQL runner; this is distinct from Agent's read-only production database access and from the automatic Publish diff. Do not treat deploy-build database pushes or migration-ledger changes as a supported ordering workaround. A human-applied prerequisite still requires independently confirming the exact production target and a fresh read-only Publish diff before any later publishing.

Publish's schema diff is not a replay of data migrations: database functions, triggers, and historical backfills defined only in checked-in SQL can be absent from the generated plan. **Why:** Table and foreign-key creation can appear structurally safe while required payment immutability or device-school history protections are not deployed. **How to apply:** Review the entire generated SQL against migration-only invariants before approving Publish; do not infer trigger or backfill coverage from passing checked-in migration replay.