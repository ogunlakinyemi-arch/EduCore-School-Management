---
name: Internal officer isolation
description: Authorization constraints for restricted company-employee accounts with school-scoped operational access
---

A restricted internal officer account must not hold another active school or platform role at the same time. Do not treat a restricted portal as the security boundary: enforce exclusivity when granting and reactivating roles, serialize competing grants, and fail closed if conflicting active roles are found at request time. Check that the current verified identity-provider email still matches the active company employee and app account before allowing officer operations.

**Why:** An inactive owner membership could otherwise be reactivated after an officer grant, restoring owner API access while the officer dashboard appeared restricted. A saved email could also outlive an identity-provider email change and continue to authorize internal employee access.

**How to apply:** When adding role-grant or reactivation paths, include the internal-officer conflict check under the same user lock. For officer-only data paths, revalidate the live verified identity instead of assuming the stored email remains authoritative.