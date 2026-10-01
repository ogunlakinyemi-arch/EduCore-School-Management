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

Inspect every SQL statement, not just the diff's structural-data-loss flag and table-removal lists. A plan flagged as non-destructive can still contain `DROP INDEX` that removes the sole uniqueness required by a later foreign key.

**Why:** The table-drop summary did not expose a planned removal of an existing parent/student pair's unique index, while a new transport foreign key still referenced that pair and no replacement uniqueness was present.

**How to apply:** Enumerate all DROP operations, inspect existing supporting indexes/constraints, and check that each referenced key remains unique at the point its foreign key is created. Stop on a missing prerequisite; do not silently skip or reorder the publishing plan.

A verified operator prerequisite that attaches a sole legacy unique index as the same-named UNIQUE constraint can align Production with Development without rebuilding the index or adding duplicate uniqueness.

**Why:** Converting only Development exposed a replacement constraint but left Publish dropping the Production index before a dependent foreign key. After the operator attached the Production index, the fresh plan omitted both the drop and replacement, retaining the existing prerequisite.

**How to apply:** Rehearse index attachment before foreign-key creation in disposable PostgreSQL. Require verified Production targeting and recovery protection for the operator step, then inspect a fresh Publish diff; do not assume that changing Development alone fixes ordering or ask the operator to repeat an already successful attachment.

Non-destructive SQL is not sufficient evidence that all composite foreign-key prerequisites were generated.

**Why:** A disposable Publish validation rejected a new table's `(id, school_id)` foreign key even though Development had its valid supporting index. The planner omitted that FK-bound standalone index; the parent's single-column primary key and a different three-column UNIQUE constraint did not satisfy the requested composite reference.

**How to apply:** Check exact referenced column sets for newly created parent tables. When a required standalone key is omitted, align both the ORM declaration and Development catalog as an explicit UNIQUE constraint by reusing the original index, then require a fresh Publish validation. Do not rebuild the index, add duplicate uniqueness, or infer migration safety solely from an absence of DROP operations.

A valid standalone unique index can legitimately support a foreign key without a corresponding UNIQUE constraint. Its omission from Publish does not by itself establish an invalid Development schema.

**Why:** Live Development foreign keys were validated and bound to valid, ready, immediate, non-partial unique indexes, while Production lacked those keys and a fresh Publish diff omitted their creation entirely. The observed defect was an incomplete generated plan, not missing Development integrity.

**How to apply:** Compare both live catalogs with the complete ordered diff. Distinguish an omitted prerequisite from one emitted too late. Treat conversion to an explicit constraint as a proposed planner-compatibility workaround, not an inherently required integrity repair. Under read-only instructions, prepare a prerequisite-first plan for review without changing source, attaching indexes, or removing foreign keys.