---
name: Financial verification depth
description: Required evidence for payment, allocation, receipt and refund changes.
---

Financial changes need both executed migration validation and tests through the real settlement/refund handlers. Arithmetic and provider-adapter tests alone do not establish that a payment can finish its database transaction.

**Why:** Passing focused utility tests did not detect mismatches between rule and subscription snapshots, database columns and constraints, or repeated refund accounting after a request was followed by its webhook.

**How to apply:** Exercise both Partner branches, positive and unavailable provider fees, receipt creation, callback-absent webhook completion, callback/webhook races, and partial-refund replay. Validate new DDL against an isolated historical schema, and verify persisted monetary invariants rather than only returned statuses. Keep mock provider evidence distinct from actual provider or bank evidence.

Every supported payment method and fallback must preserve the selected fee lines, not just the selected amount.

**Why:** A parent could select Books and submit a manual transfer for that amount, yet verification only reduced the invoice balance and left Books unallocated. Successful payment and receipt responses alone did not prove fee-selection correctness.

**How to apply:** Test the manual bank-transfer path with online checkout disabled and ordinary partial payments disallowed. Confirm the chosen lines persist, retries cannot change them, verification allocates only those lines, and the refreshed parent view excludes paid lines. Never rewrite earlier verified payments to make an acceptance test pass; retain ambiguous historical allocations and use a pristine controlled invoice.