---
name: Bank provider selection policy
description: Cross-role bank dropdown coverage, verified routing-code authority and schema-preserving limits.
---

The user requires bank/provider dropdown selection across Owner, School Admin,
teacher/staff and Partner account-save forms, including Nigerian commercial and
microfinance banks and digital providers such as Moniepoint, OPay and PalmPay.
Use one maintainable directory and shared searchable control, not per-role lists
or a default free-text bank name.

**Why:** The user explicitly requested this platform-wide behavior and rejected
fabricated codes or unsupported transfer claims.

**How to apply:** Persist a stable provider code where the existing schema
supports it; distinguish directory discovery from verified payout routing and
actual transfer capability. Do not substitute another gateway's or a generic
bank-code list for the configured provider's own catalogue. Unavailable routing
must have an explicit safe fallback, never reuse the last selected code.
Preserve account validation, write-only account numbers and unchanged history.

Manual school transfer instructions currently have name-only storage; do not
smuggle codes into the name field or apply an unapproved schema migration to
close that limitation. The user prohibited Production, secret, allocation,
migration and deployment changes for this UI request.
