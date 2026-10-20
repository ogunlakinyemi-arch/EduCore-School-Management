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

Provider verification of a standalone TEST checkout is not evidence of an EduCore subscription activation or receipt. Never retroactively assign that payment to a student merely to complete a test.

**Why:** Genuine successful and declined sandbox transactions were independently verified, but the checkout links had been initialized outside EduCore's payment reservation flow and had no bound application records. Native database settlement tests with mocked transport established different evidence.

**How to apply:** Use a designated synthetic student and the normal authorized in-app checkout reservation for provider-to-application acceptance. Report standalone provider results, native database tests and in-app end-to-end evidence separately. Missing binding is not permission to fabricate financial history.

Allocation-version acceptance must include the real provider adapter under injected transport, not just arithmetic, planner tests or an initializer with a mocked adapter.

**Why:** A correct new-policy planner was rejected by an adapter retaining the legacy school amount. A separate platform-only fallback could still collect funds, while gross/net fee screenshots could not establish recipient allocation.

**How to apply:** Exercise reference-selected instructions through the adapter, preserve cross-version rejection, test every unavailable-plan fallback before provider transport, and distinguish internal credits from provider recipient settlement.

Financial migration reviews must exercise concurrent inserts/upserts after adding
unique indexes, even when a new key appears logically redundant.

**Why:** A second uniqueness arbiter on an authenticated delivery fingerprint
caused an existing concurrent upsert to raise a duplicate-key error instead of
replaying. Sequential FK/constraint checks did not expose the incompatibility.

**How to apply:** Prefer referencing an existing namespace key over introducing
a competing redundant unique key. Prove the actual concurrent write contract in
disposable PostgreSQL, and drain all concurrent test attempts before fixture reset.