---
name: Schema export dependency ordering
description: Distinguish missing source keys from foreign keys emitted before their existing supporting indexes.
---

Preserve migration-backed UNIQUE INDEX versus UNIQUE constraint ownership when correcting schema definitions. Do not convert already declared indexes into constraints merely to work around export ordering.

**Why:** The standalone Drizzle exporter emitted foreign keys before existing supporting unique indexes. Seventeen foreign keys failed in raw order even though their keys were declared. Reordering the identical statements resolved those failures; adding arbitrary constraints would have misrepresented the historical SQL.

**How to apply:** Validate the untouched export and a dependency-ordered copy separately in disposable PostgreSQL. Record both results, verify the statement multiset is identical, and create supporting indexes before dependent foreign keys. A passing reordered export does not make raw-export execution GREEN. Require migration evidence before adding a genuinely absent key.

Match catalog names using PostgreSQL's UTF-8-safe 63-byte identifier form while preserving the original logical names in emitted SQL.

**Why:** Full model FK names can exceed the catalog identifier limit even though PostgreSQL successfully creates the schema. Comparing untruncated model names to catalog names can incorrectly report missing, actually validated FKs.

**How to apply:** Record logical and physical names separately, reject physical-name collisions, and never rename source constraints or historical SQL merely to satisfy an introspection assertion.

Canonical-object coverage alone does not prove schema equivalence. Review every retained extra constraint for restrictions beyond the canonical schema.

**Why:** A legacy payment-method CHECK survived an otherwise passing catalog reconciliation and rejected CASH, which the canonical replacement CHECK allowed. Preserving all extras hid a genuine behavioral difference.

**How to apply:** Compare the combined accepted domain, not just whether each expected CHECK exists. Produce concrete counterexamples for conflicting extras; stop and report rather than silently dropping them or calling the result equivalent.

Treat the original failed Publish payload, the standalone ORM export and a dependency-ordered audit export as separate evidence. A correctly ordered audit file does not establish what the original failing generator emitted.

**Why:** Saved failure attachments paired runtime errors with their actual generated SQL, while a later audit export already placed indexes before foreign keys. Looking only at that audit file would hide the original omission or ordering defect.

**How to apply:** Locate the saved error and SQL together, check equivalent keys as well as names, and separate a confirmed missing usable key from a potential later blocker. An absent CREATE statement is not itself a defect if the same attempt's target already had a suitable key; do not infer the target's current state from older saved evidence.

PostgreSQL-deparsed CHECK DDL is not guaranteed to round-trip to identical expression text.

**Why:** PostgreSQL 16 reparsing of its own constraint DDL flattened nested Boolean AND grouping in two checks without changing the literals or operations.

**How to apply:** Prove such differences by executing the exact canonical definition against matching typed columns in isolated PostgreSQL. Do not normalize arbitrary SQL text or ignore literal differences.
