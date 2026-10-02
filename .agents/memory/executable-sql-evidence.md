---
name: Executable SQL evidence
description: Query mocks cannot establish matching and authorization-expression behavior in PostgreSQL
---

For SQL-dependent matching, authorization, or response projection, verify fragile expressions and result shapes in real PostgreSQL as well as testing the surrounding handler.

**Why:** Query mocks returned the expected rows while a cross-language normalization difference caused valid curriculum parent relationships to fail in the signed-in app. Passing handler tests did not establish that PostgreSQL would return those rows.

Object-shaped mocks can also conceal the driver's handling of duplicate column names and null joined records. A successful SQL statement does not establish that its result satisfies the API contract.

SQL comparisons against nullable values can return NULL rather than false, breaking a required boolean in an otherwise healthy response. Run native projected rows through the actual response schema. Test upstream recipient selection too: downstream child-scoped keys cannot recover sibling contexts already discarded by account-only SQL deduplication.

Native parameter inference and driver types need evidence too: an INSERT target column does not always type a parameter used first by `IS NOT NULL` in a CASE expression, and PostgreSQL bigint identifiers arrive as strings.

**How to apply:** Keep JavaScript and SQL comparisons semantically consistent and exercise mixed-case, punctuation, and negative-scope cases with read-only queries or disposable databases. Prepare fragile parameterized statements in PostgreSQL and normalize bigint identifiers at the response boundary with safe-integer validation. For join-based projections, include missing-related-record cases and inspect native driver field metadata rather than assuming the mocked object is the real result shape. Do not treat mocked query success as database execution evidence.