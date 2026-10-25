---
name: BRO terminology boundary
description: User-facing naming rule for the existing school-referral and commission role.
---

Use “Business Relationship Officer (BRO)” and “BRO” in user-facing copy for the existing referral/commission role. This is a terminology-only change: existing capabilities and payment behavior stay the same. Keep `PARTNER` database values, API contracts, routes, permissions, referral logic, and historical financial records unchanged.

**Why:** The user explicitly confirmed that the renamed role retains its existing functionality and payments.

**How to apply:** Translate user-visible labels, notifications and validation messages, including enum-derived labels. Do not infer authorization to change money movement, payout amounts, provider setup, or existing data.
