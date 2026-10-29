---
name: Owner-only BRO financial visibility and school payment method
description: BRO commission data is restricted to the Platform Owner; school users see only the Owner's effective platform payment method.
---

Only an active Platform Owner may view BRO commission/entitlement information,
share amounts, policy/rate details, ledger balances and financial exports.
School Admin, Accountant, Teacher, Staff, Student, Parent and even BRO roles
must not see those details or retrieve them by URL or API. Keep internal
calculations, eligibility, historical liabilities and Owner oversight unchanged.

**Why:** The user explicitly withdrew prior BRO and school-facing commission
visibility on 2026-10-29; hiding a widget alone is not an authorization boundary.

**How to apply:** Check role authorization at the serving API and in exports as
well as UI and navigation. Continue to show ordinary referral/school
relationships without attaching confidential commission figures. Do not infer
Owner eligibility from being a BRO owner or school administrator.

The Platform Owner controls platform subscription payment configuration.
Schools see only the Owner's current method or an explicit unavailable state;
they cannot choose, enable or switch platform providers. Keep school-controlled
ordinary invoices and parent-facing NFC/card charges distinct.

**Why:** School-level Flutterwave/Paystack choices were presented beside the
fixed platform subscription and confused collection authority.

**How to apply:** Treat this as a visibility/control rule, not permission to
change provider credentials, payment settings, prices, verification or records.
