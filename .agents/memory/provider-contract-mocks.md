When testing multiple provider attempts, pair each transaction ID with its own
durable attempt reference. A mock that guesses the first or most recent
reference can reject a correct second attempt or falsely allow an unrelated
one. Model pending, terminal success and a true no-charge failure distinctly;
never infer a retryable failure from a lost checkout response.

**Why:** During isolated direct-payment verification, a generic fake verifier
served the first attempt's reference for a later attempt and gave a misleading
amount/reference mismatch.

**How to apply:** Map transaction IDs to frozen references in provider fakes,
including controlled retry cases, and assert no second provider POST after an
uncertain initialization response.
---
name: Provider contract mocks
description: Model external invitation-provider constraints rather than relying on unconditional mocked success.
---

Invitation-provider mocks must enforce the provider's duplicate-email invitation rules, distinguish registered users from pending invitations, and simulate acceptance followed by a lost response.

**Why:** Unconditional mocked creation passed role-by-role resend tests even though the provider would reject a second pending invitation to the same address. Ordinary rejected-promise mocks also hid the difference between a definite rejection and an invitation that was sent before its response was lost.

**How to apply:** Check the installed provider SDK's contract when changing invitation ordering or replacement options. Keep these tests fully mocked; assert durable retry protection, usable persisted activation identity, and no second dispatch after an uncertain outcome.