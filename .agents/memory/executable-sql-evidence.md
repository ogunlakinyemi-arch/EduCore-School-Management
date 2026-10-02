---
name: Executable SQL evidence
description: Query mocks cannot establish matching and authorization-expression behavior in PostgreSQL
---

For SQL-dependent matching or authorization, verify fragile expressions in real PostgreSQL as well as testing the surrounding handler.

**Why:** Query mocks returned the expected rows while a cross-language normalization difference caused valid curriculum parent relationships to fail in the signed-in app. Passing handler tests did not establish that PostgreSQL would return those rows.

**How to apply:** Keep JavaScript and SQL comparisons semantically consistent and exercise mixed-case, punctuation, and negative-scope cases with read-only queries or disposable databases. Do not treat mocked query success as database execution evidence.