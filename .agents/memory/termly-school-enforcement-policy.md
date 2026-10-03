---
name: Termly school enforcement policy
description: Business constraints for school subscription restrictions, grace, restoration, and multi-school families
---

School subscription enforcement is term-based, uses the existing automated school calendar, and allows the first seven days of each new term. Subscription restrictions are reversible and independent of permanent NFC revocation, lost-card status, and credential history.

For a PARTIALLY_PAID school, keep paid students active. Restrict only unpaid students and their related parent access; do not impose whole-school, all-teacher, or reader restrictions because some students have not paid.

**Why:** On 2026-10-03 the user explicitly chose “Keep paid students active” after the collateral effect of whole-school restrictions was explained.

**How to apply:** Scope partial-payment enforcement and Owner bulk actions to unpaid student identities, including their cards and child-specific parent functions. A paid sibling must remain accessible, including within the same school. Do not interpret a school summary of PARTIALLY_PAID as permission to lock its teachers or readers.

**Why:** The user specified school-level restrictions after the grace period and automatic restoration following the existing verified-payment workflow, without changing prices, deleting school data, or permanently revoking cards.

**How to apply:** Preserve login, basic account access, and payment-resolution access. Restrict multi-school parents only for the relevant child's school. Use one idempotent enforcement service for scheduled and explicitly confirmed Owner bulk actions; avoid duplicate notifications/audits. Infrastructure failures must not become evidence of nonpayment. Restoration removes only subscription restrictions, never unrelated card/device restrictions. Do not introduce unlimited manual unpaid-school unlocks.