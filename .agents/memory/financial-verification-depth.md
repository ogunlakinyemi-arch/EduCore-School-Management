---
name: Financial verification depth
description: Required evidence for payment, allocation, receipt and refund changes.
---

Financial changes need both executed migration validation and tests through the real settlement/refund handlers. Arithmetic and provider-adapter tests alone do not establish that a payment can finish its database transaction.

**Why:** Passing focused utility tests did not detect mismatches between rule and subscription snapshots, database columns and constraints, or repeated refund accounting after a request was followed by its webhook.

**How to apply:** Exercise both Partner branches, positive and unavailable provider fees, receipt creation, callback-absent webhook completion, callback/webhook races, and partial-refund replay. Validate new DDL against an isolated historical schema, and verify persisted monetary invariants rather than only returned statuses. Keep mock provider evidence distinct from actual provider or bank evidence.

Changes to payment reservation order must satisfy existing database constraints, not just mocked handler behavior.

**Why:** Focused guest-payment tests passed while a real link insert was incompatible with the database's existing isolation CHECK. The mock accepted an insertion PostgreSQL could never accept.

**How to apply:** Inspect the relevant live CHECK and foreign-key definitions read-only before moving reservations. Make regression mocks reject impossible inserts. Never weaken constraints to match the mock. If the user prohibits migrations, resets and seeding, use read-only constraint-expression checks and clearly distinguish them from a genuinely persisted end-to-end payment test.

Every supported payment method and fallback must preserve the selected fee lines, not just the selected amount.

**Why:** A parent could select Books and submit a manual transfer for that amount, yet verification only reduced the invoice balance and left Books unallocated. Successful payment and receipt responses alone did not prove fee-selection correctness.

**How to apply:** Test the manual bank-transfer path with online checkout disabled and ordinary partial payments disallowed. Confirm the chosen lines persist, retries cannot change them, verification allocates only those lines, and the refreshed parent view excludes paid lines. Never rewrite earlier verified payments to make an acceptance test pass; retain ambiguous historical allocations and use a pristine controlled invoice.