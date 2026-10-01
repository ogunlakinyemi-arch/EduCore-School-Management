---
name: Provider contract mocks
description: Model external invitation-provider constraints rather than relying on unconditional mocked success.
---

Invitation-provider mocks must enforce the provider's duplicate-email invitation rules, distinguish registered users from pending invitations, and simulate acceptance followed by a lost response.

**Why:** Unconditional mocked creation passed role-by-role resend tests even though the provider would reject a second pending invitation to the same address. Ordinary rejected-promise mocks also hid the difference between a definite rejection and an invitation that was sent before its response was lost.

**How to apply:** Check the installed provider SDK's contract when changing invitation ordering or replacement options. Keep these tests fully mocked; assert durable retry protection, usable persisted activation identity, and no second dispatch after an uncertain outcome.