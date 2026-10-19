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

**How to apply:** Require reviewed V3 multi-recipient fee-order semantics and
exact post-fee payout evidence before enabling current-policy TEST collections.
Keep School/Partner gross entitlements intact and expense the total processing
cost once against Owner gross. Never guess percentages or repair prior history
to match dashboard displays.
