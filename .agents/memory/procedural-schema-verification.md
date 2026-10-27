---
name: Procedural schema verification
description: Structural Publish diffs and migration-ledger counts do not certify financial guard functions or triggers.
---

Treat procedural objects as a separate schema verification contract. A zero
structural diff and a successful statement-count ledger entry do not prove
repository SQL functions/triggers were installed.

**Why:** Actual Publish SQL included structural objects but omitted financial
guard functions/triggers; subsequent structural comparison was empty despite
their absence. Repository migration filenames were not an execution ledger.

**How to apply:** Compare actual public catalog function bodies, execution
properties, trigger events, table/function binding and enablement with approved
source. Validate repair semantics on an isolated PostgreSQL fixture. Keep
procedural release delivery blocked until supported platform tooling demonstrably
includes the exact reviewed objects; never add startup/build DDL or a custom
managed-Production migration runner as a workaround.
