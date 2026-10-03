---
name: Termly school enforcement policy
description: Business constraints for school subscription restrictions, grace, restoration, and multi-school families
---

School subscription enforcement is term-based, uses the existing automated school calendar, and allows the first seven days of each new term. Subscription restrictions are reversible and independent of permanent NFC revocation, lost-card status, and credential history.

Automatic enforcement is exclusively per student, even when every student in a school is unpaid. Keep paid students active and teachers/readers operational under their existing permissions.

**Why:** On 2026-10-03 the user corrected the earlier design: automatic student enforcement and manual whole-school control are two independent mechanisms.

**How to apply:** Scope automatic enforcement to unpaid student identities, their cards and child-specific parent functions. A paid sibling remains accessible unless the Owner has separately locked that child's school. Never infer an automatic whole-school lock from nonpayment.

Only the Platform Owner can explicitly lock and unlock a whole school. This state persists independently across payments, automatic evaluations, and term changes. Unlock removes only the manual school restriction.

**Why:** The user's correction explicitly requires both controls and prohibits automatic payments or term enforcement from overriding manual school locks.

**How to apply:** Preserve login, account, payment-resolution and inbox access. Restrict parents by child/school. Keep manual school control separate from automatic student reconciliation, sharing existing guards, notifications and audits. Neither payment nor school unlock removes unrelated restrictions or reactivates inactive cards/devices/accounts. Unknown eligibility is not nonpayment; infrastructure errors must not silently bypass a confirmed manual lock.

Family and teaching restrictions must remain separate for people holding both roles; a school restriction in one role must not become a restriction on their children at another school.

**Why:** The user's child-specific policy applies to multi-role people as well as families whose children attend different schools.

**How to apply:** Evaluate both operations and visible warnings in the current audience's child/school scope, not as a global user lock.