---
name: Flutterwave fee-order evidence
description: Support-reported fee-first splitting requires exact recipient payout evidence, not percentage guesses.
---

Flutterwave support was reported by the user to deduct processing fees before
splitting, with a reported existing 40% subaccount / 0% merchant configuration.
Treat that as support-reported information, not an independently inspected
external account state or a universal API guarantee.

**Why:** A gross-based fixed school/Partner entitlement cannot be established by
a percentage of a variable post-fee net. Valid local flat instructions and bank
ownership verification do not establish effective provider split semantics.

**How to apply:** For new deferred-commission payments, require reviewed V3
single-school fixed-amount semantics and exact post-fee school/main-merchant
evidence; do not require or add a Partner checkout subaccount. Older frozen
multi-recipient references retain their original policy. Keep the school
entitlement intact, accrue the eligible Partner internally and expense provider
costs once against the merchant remainder. Never guess percentages or repair
prior history to match dashboard displays.

Flutterwave's split documentation contains contradictory descriptions of
`flat_subaccount`, although its explicit override example shows a fixed
subaccount amount with merchant remainder after fees.

**Why:** The reviewed provider page stated both interpretations. Code payload
validity cannot settle that contradiction for this merchant's effective settings.

**How to apply:** Retain fail-closed checkout guards until account-specific
confirmation and independent transaction-level settlement evidence agree.
