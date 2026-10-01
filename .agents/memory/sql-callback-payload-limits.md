---
name: SQL callback payload limits
description: Large SQL requests can fail before execution; chunking calls does not share a transaction.
---

The supported SQL callback can hit its subprocess argument-size limit
(`E2BIG`) for large multi-statement payloads, even when the file fits the
file-reading tool's byte limit.

**Why:** A large reconciliation rehearsal was rejected before SQL execution.
Passing a file-size check did not establish that the database tool could accept
the request.

**How to apply:** Distinguish transport failure from a SQL failure. Separate
SQL callback calls do not share a transaction. If Development-only staging is
needed, chunks must remain inert text until one isolated atomic execution;
verify rollback and complete staging cleanup. Never use Production staging,
automatic hooks or ledger edits to bypass this limitation, and do not claim
execution coverage when the transport rejected the request.