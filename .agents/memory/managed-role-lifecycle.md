---
name: Managed database role lifecycle
description: Separate PostgreSQL permission capability from documented Replit Publish role and credential lifecycle.
---

Custom-role migration during an infrastructure upgrade does not establish
normal Publish provisioning or retention of owner/runtime roles and ACLs.
A successful disposable PostgreSQL permission prototype also does not establish
that managed Replit credentials can select and maintain those roles.

**Why:** Official Development/Production documentation explicitly mentions custom
roles/permissions for Neon-to-Helium upgrades, with password reset required.
Connection documentation describes Neon Production password regeneration without
changing the role. Neither statement supplies the separate-runtime/Publish-owner
contract. Search-generated migration advice can conflict with primary pages and
the managed-database rules; do not turn it into a deploy-build migration hook.

**How to apply:** Recheck primary official documentation before capability claims.
Do not say custom roles cannot exist. Require an authoritative workflow covering
role creation, actual DDL creator/ownership, runtime credential isolation, ACLs
after table recreation, rotation and restore before relying on role separation
for a financial release. Keep unresolved platform capability distinct from proven
PostgreSQL DML restrictions and from still-unresolved mutable-state semantics.
