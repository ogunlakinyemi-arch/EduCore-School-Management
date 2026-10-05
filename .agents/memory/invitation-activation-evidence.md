---
name: Invitation activation evidence
description: Why recovered invitation acceptance must positively verify the intended role instead of inferring ownership.
---

Require positive, identity-bound evidence of an invitation's kind and permission during activation. A missing or unrecognized staff claim must never fall through to an owner assignment. Recovery must preserve the same role evidence as ordinary successful dispatch.

**Why:** A recovered dispatch introduced a success event that an older acceptance classifier did not recognize. Its fallback treated an opaque staff token as an owner invitation, despite the intended staff permission. Tests of resend success alone missed the acceptance defect.

**How to apply:** Whenever dispatch success, reconciliation, audit evidence, or invitation metadata changes, verify acceptance of recovered links for every permission variant. Match the exact invitation, tenant, and verified recipient; reject absent, mixed, or malformed evidence before assigning a privileged role.

Confirm internal-employee completion with an identity-bound acceptance receipt, not merely the difference between successive authorization reads. Persist the server claim alongside the employee onboarding transaction before reporting successful dispatch.

**Why:** The identity provider can finish password creation while the application is missing its claim evidence. Authorization reads may themselves provision the role, so a later before/after comparison can incorrectly report no new role. Same-account receipt reconciliation is different from letting a consumed invitation grant access to another identity.

**How to apply:** Recover missing legacy evidence only from the original signed claim, verified recipient, matching provider-accepted invitation, and Owner-created employee evidence. Keep role creation and acceptance atomic; reject invalidated claims and inactive or conflicting roles on retry. Preserve the claim identifier in legacy-link continuation before clearing provider signup metadata, so a reload can identify the same account-bound receipt.