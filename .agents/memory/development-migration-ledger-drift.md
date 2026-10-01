---
name: Development migration ledger drift
description: Why the development migration ledger cannot be assumed to describe the current schema.
---

The development database can have Finance schema changes that are absent from its migration ledger. Do not blindly replay all migrations from the last ledger entry into an existing development database.

**Why:** Previously applied changes left the live development schema ahead of the recorded migration history. A normal migration runner can try to recreate existing objects and fail; this is separate from the unresolved production Publish issue. Recorded hashes for some early ledger rows also disagree with current checked-in SQL, so catalog similarity alone cannot prove which historical statements ran.

**How to apply:** Before development-only schema changes, verify the actual development connection, compare live object definitions with the checked-in migration and ledger, and use a safe additive path. A clean replay and a second no-op runner pass prove only the empty-database path; separately rehearse against a disposable clone of the existing schema plus its actual ledger. Preserve original hashes and distinguish an explicitly audited adoption of equivalent state from migrations actually executed; verify catalog objects, dependency/validation state and historical data transformations before any ledger change. Never extrapolate this state to production or run production SQL as part of this check.

Discover migration-history tables independently for each database target instead of carrying a ledger schema/name from one environment to another.

**Why:** The Production replica exposed platform-owned history in `_system`, while Development held application migration history in `drizzle`. A verification summary using the Production table name on Development caused an otherwise valid correction transaction to roll back.

**How to apply:** Query the catalog for ledger tables before constructing baseline or verification SQL. Include the discovered ledger schema in data fingerprints, preserve its existing rows, and do not assume the two environments share a migration-history implementation.