---
name: Canonical onboarding policy
description: Production invitation and referral domains, with Development identity and payment isolation.
---

Production Partner/school invitations, referrals and signup destinations must use
the verified canonical custom portal domain, currently
`https://educore.yetenia.com`, never a `*.replit.app` destination.
Development identity invitations must remain in their own identity environment.

**Why:** The user explicitly reported live invitations returning to a Replit
hostname and required canonical custom-domain links without changing payment
settings or silently regenerating tokens.

**How to apply:** Reverify deployment metadata before changing the canonical
domain. Preserve paths and opaque tokens and use the shared onboarding resolver.
Audit application templates and provider redirect inputs; source tests do not
prove the final link in a recipient's inbox. Keep payment URL behavior isolated
unless separately authorized.
