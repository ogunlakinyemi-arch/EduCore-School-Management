---
name: Development migration ledger drift
description: Why the development migration ledger cannot be assumed to describe the current schema.
---

The development database can have Finance schema changes that are absent from its migration ledger. Do not blindly replay all migrations from the last ledger entry into an existing development database.

Application database migrations require explicit user approval. Prefer existing
storage when it safely meets a focused extension's requirements. Disposable
fictional database tests do not authorize applying that DDL to the application.

**Why:** The user explicitly required migration approval while requesting the
Telegram parent-onboarding extension.

**How to apply:** Prepare an additive migration only if necessary, explain it and
obtain approval before applying it to any application database.

**Why:** Previously applied changes left the live development schema ahead of the recorded migration history. A normal migration runner can try to recreate existing objects and fail; this is separate from the unresolved production Publish issue. Recorded hashes for some early ledger rows also disagree with current checked-in SQL, so catalog similarity alone cannot prove which historical statements ran.

**How to apply:** Before development-only schema changes, verify the actual development connection, compare live object definitions with the checked-in migration and ledger, and use a safe additive path. A clean replay and a second no-op runner pass prove only the empty-database path; separately rehearse against a disposable clone of the existing schema plus its actual ledger. Preserve original hashes and distinguish an explicitly audited adoption of equivalent state from migrations actually executed; verify catalog objects, dependency/validation state and historical data transformations before any ledger change. Never extrapolate this state to production or run production SQL as part of this check.

Discover migration-history tables independently for each database target instead of carrying a ledger schema/name from one environment to another.

**Why:** The Production replica exposed platform-owned history in `_system`, while Development held application migration history in `drizzle`. A verification summary using the Production table name on Development caused an otherwise valid correction transaction to roll back.

**How to apply:** Query the catalog for ledger tables before constructing baseline or verification SQL. Include the discovered ledger schema in data fingerprints, preserve its existing rows, and do not assume the two environments share a migration-history implementation.

Search retained forensic reports and historical SQL blobs before declaring a
ledger hash's source unknown. Checking only current files and a branch tip is
insufficient. An exact historical hash establishes source text, not execution.

**Why:** Reordering supporting-key declarations changed a checked-in SQL hash;
an older matching blob remained available even when both current branch tips
differed. Journal timestamps could not establish that source identity.

**How to apply:** Verify the full digest against the actual historical blob.
Keep an unrecovered hash explicitly unresolved; never reconstruct its SQL from
timestamps or rewrite the ledger to match current text.

## ORM definitions versus executable storage

Before extending a reader over an existing audit/history store, compare its
column contract with the original executable migration and the existing writer.
Do not build a disposable test fixture solely from the ORM definition.

**Why:** A historical ORM alias can differ from the executable migration and
working SQL routes. A fixture copied from that alias can make a nonexistent
column look verified while failing to exercise the actual save/read cycle.

**How to apply:** Test the routed write and subsequent read together against
isolated PostgreSQL using the established executable contract. Document any
existing drift separately; do not silently rename application database columns
or apply a reconciliation migration without approval.

SQL-read mocks must enforce the selected column contract rather than accept
every query mentioning a known table.

**Why:** A permissive metadata-read mock accepted a nonexistent audit timestamp
column, hiding a regression that failed even for an unsaved schedule.

**How to apply:** Keep mocks consistent with the established table projection,
including timestamp names, and exercise both existing-row and no-row reads.

Verify the full routed response of each affected endpoint, not only its shared
schedule/history helper.

**Why:** A shared-reader correction passed helper-level PostgreSQL checks while
a later query in the dashboard handler still selected the same nonexistent
audit column.

**How to apply:** Reuse realistic disposable fixtures and request both complete
endpoints, including empty-data cases; SQL validates projections even when no
rows match.