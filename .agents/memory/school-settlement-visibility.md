---
name: School settlement visibility
description: Keep provider configuration and readiness diagnostics out of school-facing account workflows.
---

School Admin settlement screens should show account-linking instructions, masked details, verification status, and the next action—not merchant scope, release identifiers, webhook/KYC state, migration blockers, or provider configuration diagnostics. Keep those details in Platform Owner administration.

**Why:** The user explicitly separated ordinary school account submission from internal provider setup and prohibited fabricated verification, LIVE enablement, Production migrations/data changes, and publishing during this UX work.

**How to apply:** Use current provider bank codes and independent account-resolution evidence; keep account submission pending until checked. Do not treat a passing mocked test or a saved account as evidence of real verification or settlement.

School account-holder lookup must not depend on payroll-transfer activation or fund-movement attestations. A dedicated Production account-resolution credential may support an expressly requested, read-only lookup without authorizing checkout, transfers, subaccounts or settlement. Independently documented Owner review is distinct from provider-resolved evidence and must not claim a provider request occurred.

**Why:** An activated merchant and a genuine pending school submission can coexist with intentionally disabled payroll. Coupling these capabilities incorrectly prevents the Owner from reviewing the bank account.

**How to apply:** Keep evidence sources explicit in decisions and audits; merchant activation by itself is not evidence that a particular school's beneficiary matches. Do not change financial activation settings to make a verification control available.
