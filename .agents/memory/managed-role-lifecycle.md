---
name: Managed database role lifecycle
description: Separate PostgreSQL permission capability from documented Replit Publish role and credential lifecycle.
---

Quinn's latest Support guidance, supplied by the user on 2026-10-27:
Replit cannot confirm a separate restricted Production PostgreSQL login is
supported; Publish does not synchronize custom roles, grants, memberships or
default privileges; credential regeneration changes only the Production
connection-string password and redeploys; PITR role/privilege behavior is undocumented.

**Why:** This is the actual supplied Support response, superseding the earlier
open role-lifecycle inquiry. Do not repeat the escalation or infer credential
isolation from password rotation.

**How to apply:** Do not make a custom-role lifecycle a LIVE prerequisite.
Preserve the original trigger-enforced design with documented credentials;
application wrappers are not equivalent all-writer DB enforcement. A missing
supported protected-object installation path remains a distinct release blocker.

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
