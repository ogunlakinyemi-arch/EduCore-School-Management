---
name: School settlement visibility
description: Keep provider configuration and readiness diagnostics out of school-facing account workflows.
---

School Admin settlement screens should show account-linking instructions, masked details, verification status, and the next action—not merchant scope, release identifiers, webhook/KYC state, migration blockers, or provider configuration diagnostics. Keep those details in Platform Owner administration.

**Why:** The user explicitly separated ordinary school account submission from internal provider setup and prohibited fabricated verification, LIVE enablement, Production migrations/data changes, and publishing during this UX work.

**How to apply:** Use current provider bank codes and independent account-resolution evidence; keep account submission pending until checked. Do not treat a passing mocked test or a saved account as evidence of real verification or settlement.
