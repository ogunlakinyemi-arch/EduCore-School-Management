---
name: Employee deactivation and independent identities
description: Deny deactivated employment permissions without globally removing independent family or other-tenant access.
---

Employee deactivation denies the matching school employment role on subsequent
server authorization. It must not automatically disable unrelated Parent,
Owner or other-school memberships on the same identity.

**Why:** Globally disabling an identity or revoking all Clerk sessions would
also disrupt legitimate independent family and tenant access. An existing
session is not permission to bypass live employment-status checks.

**How to apply:** Test the affected employment role and independent roles
separately. Distinguish server permission denial from physical termination of
an identity-provider session; do not claim the latter without implementing and
verifying it.
