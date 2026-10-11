---
name: Flutterwave capability evidence
description: Keep collection configuration, bank verification, payout permission and actual split settlement separate.
---

TEST payment collections must be reported independently from payroll/payout configuration. Read-only TEST bank-account resolution may use an approved dedicated TEST collection credential without enabling transfers.

**Why:** The user needs Development testing while awaiting the company bank account. A payout-only banner falsely implied the existing TEST collection credential was absent, and tied bank verification to unimplemented subaccounts.

**How to apply:** Never implicitly enable transfers from collection readiness. Preserve explicit transfer-mode gates, Development-only credential isolation, independent webhook authentication and provider verification. A credential passing local format validation is not proof Flutterwave accepts it.

The user reported on 2026-10-11 that the Flutterwave business account is approved and its dashboard exposes API Keys and Payment Links. Treat this as merchant-approval information, not evidence of transfer or split-settlement permissions.

**Why:** Merchant approval must not be confused with either missing integration configuration or verified financial operations.

**How to apply:** Continue ordinary TEST checkout checks without asking for a new business account or implicitly enabling live operations.

Official checkout documentation examples are not necessarily an exhaustive list of sandbox return hosts. Compare the genuine authenticated TEST response with local URL validation before diagnosing initialization as provider failure.

**Why:** A successful provider response was rejected locally because the sandbox returned a different exact host from the documented canonical example. The same rejection also existed in downstream link projection and browser navigation.

**How to apply:** Verify all downstream URL validators together. Allow only the specifically verified HTTPS sandbox origin and hosted-checkout path under Development guards; never permit wildcard domains or relax deployed validation. Retain private reference evidence before an initialization attempt and never automatically retry a POST whose outcome may be uncertain.

Bank-account verification, a stored subaccount identifier and internal commission allocations are distinct evidence, none of which proves automatic provider settlement.

**Why:** Flutterwave documents collection subaccounts, but the current merchant's permissions and per-transaction school/partner settlement must still be established; the user expressly rejects simulated transfers presented as settlement.

**How to apply:** Describe missing application integration as not integrated, not unsupported by Flutterwave. Keep unverified automatic splits disabled. Require current provider contract/permissions, recipient ownership and explicit verified transaction/settlement evidence before claiming school or partner money moved. Do not require recipients for schools that have not joined.
