---
name: Publish boolean CHECK serialization
description: Preserve boolean guard semantics while avoiding malformed generated Publish SQL.
---

For mandatory NOT NULL boolean consent flags, prefer an explicit predicate
such as `CHECK (flag IS TRUE)` rather than a bare `CHECK (flag)` when Publish
introspection generates a duplicated CHECK wrapper.

**Why:** Valid Development constraints using a bare boolean became invalid
`CHECK (CHECK (flag))` statements in both the failed Publish report and a fresh
schema diff. An explicit predicate retained the mandatory consent rule and
produced executable generated SQL. This is generator behavior, not corrupt data.

**How to apply:** Confirm actual Development catalog expressions and column
nullability before changing anything. IS TRUE is equivalent here only because
NOT NULL already rejects NULL; for nullable flags preserve three-valued
semantics instead. Align authoritative schema source and Development through
normal authorized permissions, then inspect the freshly generated diff and
exercise true/false/NULL on a disposable fixture. Never patch Production or add
deployment/startup DDL to work around generated SQL. Minimal dependency fixtures
prove syntax and ordering, not full Production-fork compatibility.
Verify source-defined history/scope functions and triggers separately from
generated statement syntax; a successful Publish SQL replay alone must never
be treated as proof that the source's procedural guards were installed.
