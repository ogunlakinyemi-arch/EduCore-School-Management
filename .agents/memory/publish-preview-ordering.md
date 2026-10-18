---
name: Publish preview statement ordering
description: Fresh Publish previews can reorder unchanged SQL; distinguish textual changes from dependency-safe reordering.
---

Do not claim an exact ordered match merely because a fresh Publish preview has
the same statement count or the same SQL contents as a rehearsed preview.

**Why:** Fresh previews have returned identical SQL statements in different
orders, including table creation, foreign keys, indexes and final constraints.
An order-sensitive rehearsal cannot automatically certify any permutation.

**How to apply:** Compare duplicate-aware statement multisets, then compare
phase boundaries, prerequisites and per-table alteration order. Reuse prior
evidence only when the changes are demonstrably independent reorderings.
Report ordering differences explicitly. Changed SQL or moved prerequisites
need focused review; do not automatically repeat the entire audit.
