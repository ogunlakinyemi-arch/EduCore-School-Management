---
name: Restricted internal employee isolation
description: Authorization constraints for school-scoped activation officers and global company accountants
---

A restricted internal officer or company accountant account must not hold another active school or platform role at the same time. Company accountants remain global, not school accountants; activation officers remain school-scoped. Do not treat a restricted portal as the security boundary: enforce exclusivity when granting and reactivating roles, serialize competing grants, and fail closed if conflicting active roles are found at request time. Check that the current verified identity-provider email still matches the active company employee and app account before allowing restricted operations.

**Why:** An inactive owner membership could otherwise be reactivated after an internal employee grant, restoring owner API access while the employee dashboard appeared restricted. A company accountant with a school accountant role could also inherit school financial data. A saved email could outlive an identity-provider email change and continue to authorize internal employee access.

**How to apply:** When adding role-grant or reactivation paths, include restricted-employee conflict checks under the same user lock. For restricted employee data paths, revalidate the live verified identity instead of assuming the stored email remains authoritative.