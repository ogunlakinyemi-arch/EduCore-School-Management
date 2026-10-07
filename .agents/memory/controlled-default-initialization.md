---
name: Controlled canonical default initialization
description: Scope of the user-approved initialization of empty communication metadata and default-deny Partner NFC permissions.
---

The user approved inline PostgreSQL defaults for newly added delivery-attempt tracking (empty object), receipt-ID tracking (empty list), school communication overrides (empty object), and Partner/Partner-staff NFC permissions (false), including a narrowly scoped populated-table guard exception.

**Why:** These are canonical initial metadata/default-deny values, not reconstructed delivery, receipt or permission history. The blanket rejection of every missing NOT NULL column on populated tables prevented this approved initialization.

**How to apply:** Limit exceptions to the reviewed table, column, type, default and exact ADD COLUMN statement. Unknown/NULL metadata and unrelated required columns must still fail closed. Do not interpret empty tracking as permission to resend or false as historical permission evidence. This approval does not authorize shared-database changes.

Count-only missing-column preflights retain their actual populated-row counts. For these approved fields, clear the conditional gate through the reviewed deterministic mapping, not by claiming that the count query returned zero.

**Why:** The original gate permits zero rows OR a separately approved mapping. Approval and validated inline initialization satisfy the latter without making existing Production rows disappear or adding columns during a read-only review.

**How to apply:** Preserve original queries and raw counts, identify the mapping-based decision explicitly, distinguish refreshed checks from reused results, and retain prerequisite-dependent checks as unassessed rather than passing.

Keep separately reviewed source corrections distinct from historical generation manifests and validation reports.

**Why:** The targeted correction deliberately left the compiler and its historical manifest unchanged. The compiler's ownership check refuses to overwrite changed forward migrations; stale manifest hashes must not be treated as evidence for corrected bytes.

**How to apply:** Before a separately authorized rebuild or release-evidence refresh, preserve reviewed defaults and guard exceptions in generation, reconcile ownership hashes, and retain historical evidence rather than silently replacing its meaning.
