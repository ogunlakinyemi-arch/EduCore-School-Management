---
name: Invitation activation evidence
description: Why recovered invitation acceptance must positively verify the intended role instead of inferring ownership.
---

Require positive, identity-bound evidence of an invitation's kind and permission during activation. A missing or unrecognized staff claim must never fall through to an owner assignment. Recovery must preserve the same role evidence as ordinary successful dispatch.

**Why:** A recovered dispatch introduced a success event that an older acceptance classifier did not recognize. Its fallback treated an opaque staff token as an owner invitation, despite the intended staff permission. Tests of resend success alone missed the acceptance defect.

**How to apply:** Whenever dispatch success, reconciliation, audit evidence, or invitation metadata changes, verify acceptance of recovered links for every permission variant. Match the exact invitation, tenant, and verified recipient; reject absent, mixed, or malformed evidence before assigning a privileged role.