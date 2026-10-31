---
name: Owner and own-BRO financial visibility
description: Owner oversight and strictly scoped BRO entitlements, without school payment/revenue disclosure or transfers.
---

An active Platform Owner retains authorized overall commission policies and
records. Each relevant BRO may see only their own earned/eligible student-term
commission, using the applicable effective-dated ₦150 rule and independent
verification of attributed student subscriptions. School Admin, Accountant,
Teacher, Staff, Student and Parent roles receive no BRO commission data.
BROs must not receive school platform payment amounts/totals, platform revenue,
other BROs' earnings, or overall Owner policy/report evidence.

**Why:** The user corrected the earlier Owner-only interpretation: "Only platform
Owner and BRO should be able to see BRO commission" and a BRO sees only their own
commission promptly after the school pays for eligible student subscriptions.

**How to apply:** Authorize and shape responses server-side, derive BRO scope
from the authenticated principal rather than caller-selected IDs, and keep
Owner reports separate. Earning follows successful server verification, not an
Owner button or a read of the BRO dashboard. Preserve term rollout/approval
gates, historical earnings, pricing and payouts; retries must not double-credit.
Entitlements are internal ledger entries, never transfers or collection splits.

The Platform Owner controls platform subscription payment configuration.
Schools see only the Owner's current method or an explicit unavailable state;
they cannot choose, enable or switch platform providers. Keep school-controlled
ordinary invoices and parent-facing NFC/card charges distinct.

**Why:** School-level Flutterwave/Paystack choices were presented beside the
fixed platform subscription and confused collection authority.

**How to apply:** Treat this as a visibility/control rule, not permission to
change provider credentials, payment settings, prices, verification or records.
