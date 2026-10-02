---
name: Schema dump restrict tokens
description: Avoid false schema drift when comparing PostgreSQL plain-text schema dumps
---

Plain-text `pg_dump` can generate different `\restrict` and `\unrestrict` tokens on every invocation. When comparing two schema dumps from the same PostgreSQL state, exclude only those generated delimiter lines before a byte-for-byte comparison.

**Why:** During a failed-migration rollback check, a raw dump comparison reported a difference even though the only changed lines were generated restrict tokens. That false alarm could misclassify a safe transactional failure as schema mutation.

**How to apply:** For controlled schema-diff checks with the same dump options/version, normalize those two delimiter lines on both sides, then compare the remaining complete output. Keep unexpected differences visible; do not use broad textual normalization to hide real DDL drift.

A schema-only dump also deliberately clears the session's search path. If it is replayed through a persistent PostgreSQL client instead of psql, restore the intended schema before executing unqualified application migrations.

**Why:** The dump can load successfully while the next migration fails with “no schema has been selected to create in”; the client's session settings survive the dump replay.

**How to apply:** Keep the dump's safety settings during replay, then explicitly set the application schema for the subsequent migration phase on that same connection.