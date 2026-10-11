---
name: Flutterwave capability evidence
description: Keep collection configuration, bank verification, payout permission and actual split settlement separate.
---

TEST payment collections must be reported independently from payroll/payout configuration. Read-only TEST bank-account resolution may use an approved dedicated TEST collection credential without enabling transfers.

**Why:** The user needs Development testing while awaiting the company bank account. A payout-only banner falsely implied the existing TEST collection credential was absent, and tied bank verification to unimplemented subaccounts.

**How to apply:** Never implicitly enable transfers from collection readiness. Preserve explicit transfer-mode gates, Development-only credential isolation, independent webhook authentication and provider verification. A credential passing local format validation is not proof Flutterwave accepts it.

Bank-account verification, a stored subaccount identifier and internal commission allocations are distinct evidence, none of which proves automatic provider settlement.

**Why:** Flutterwave documents collection subaccounts, but the current merchant's permissions and per-transaction school/partner settlement must still be established; the user expressly rejects simulated transfers presented as settlement.

**How to apply:** Describe missing application integration as not integrated, not unsupported by Flutterwave. Keep unverified automatic splits disabled. Require current provider contract/permissions, recipient ownership and explicit verified transaction/settlement evidence before claiming school or partner money moved. Do not require recipients for schools that have not joined.
