---
name: Financial verification depth
description: Required evidence for payment, allocation, receipt and refund changes.
---

Financial changes need both executed migration validation and tests through the real settlement/refund handlers. Arithmetic and provider-adapter tests alone do not establish that a payment can finish its database transaction.

**Why:** Passing focused utility tests did not detect mismatches between rule and subscription snapshots, database columns and constraints, or repeated refund accounting after a request was followed by its webhook.

**How to apply:** Exercise both Partner branches, positive and unavailable provider fees, receipt creation, callback-absent webhook completion, callback/webhook races, and partial-refund replay. Validate new DDL against an isolated historical schema, and verify persisted monetary invariants rather than only returned statuses. Keep mock provider evidence distinct from actual provider or bank evidence.