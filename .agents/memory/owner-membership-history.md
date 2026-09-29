---
name: Owner membership history
description: Why an Owner identity correction should retain the previous assignment rather than rewriting its user relationship.
---

When a verified development Owner identity must replace an older test identity, keep the older membership attached to its original user as inactive history and create a separate active global membership for the intended existing user. Enforce exactly one active global Owner at transaction commit and record the reconciliation in the audit trail.

**Why:** Reassigning a membership's user ID changes the apparent meaning of its earlier assignment while audit events remain attributed to the original actor. A test identity can still have meaningful audit history. The project owner explicitly approved preserving the old record rather than transferring it.

**How to apply:** Confirm the signed-in identity, normalized account mapping, original Owner membership, and development database target before touching roles. Use an atomic change with identity and active-Owner-count preconditions; do not infer that a generated-looking email makes the historical records disposable.