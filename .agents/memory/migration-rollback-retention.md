---
name: Migration rollback retention
description: Empty-parent checks and unlocked emptiness checks do not establish safe rollback.
---

Rollback preservation must cover every independently retainable evidence root
and acquire protective locks before testing emptiness.

**Why:** A valid commission approval/export batch and its audit can exist with
no subscription intents. An emptiness check can also become stale when another
writer commits before DROP obtains its locks. An empty-schema rollback rehearsal
does not cover either situation.

**How to apply:** Review down scripts independently of successful forward DDL.
Exercise retained financial/audit roots and concurrent writers in disposable
PostgreSQL. Treat primary identity, actual recovery availability and target-specific
approval as separate gates; never infer Production readiness from a fixture pass.
