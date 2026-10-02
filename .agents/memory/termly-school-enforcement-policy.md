---
name: Termly school enforcement policy
description: Business constraints for school subscription restrictions, grace, restoration, and multi-school families
---

School subscription enforcement is term-based, uses the existing automated school calendar, and allows the first seven days of each new term. Subscription restrictions are reversible and independent of permanent NFC revocation, lost-card status, and credential history.

**Why:** The user specified school-level restrictions after the grace period and automatic restoration following the existing verified-payment workflow, without changing prices, deleting school data, or permanently revoking cards.

**How to apply:** Preserve login, basic account access, and payment-resolution access. Restrict multi-school parents only for the relevant child's school. Use one idempotent enforcement service for scheduled and explicitly confirmed Owner bulk actions; avoid duplicate notifications/audits. Infrastructure failures must not become evidence of nonpayment. Restoration removes only subscription restrictions, never unrelated card/device restrictions. Do not introduce unlimited manual unpaid-school unlocks.