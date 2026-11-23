# Publish validation: class-assignment index dependency

## Diagnosis — 23 November 2026

The attached diagnostic failed on:

```sql
DROP INDEX "student_class_assignments_id_school_unique";
```

Read-only catalog queries established that Production has that standalone
unique btree index on `(id, school_id)`. Three validated foreign keys depend on
the exact index:

- `academic_report_cards_class_assignment_school_fk`
- `academic_results_class_assignment_school_fk`
- `promotion_batch_students_assignment_school_fk`

Development instead had equivalent named UNIQUE constraints, and its foreign
keys depended on `student_class_assignments_id_school_tenant_key`. It lacked
the standalone Production index. Equivalent column uniqueness does not
automatically retarget PostgreSQL foreign-key dependencies. Publish therefore
generated a drop which PostgreSQL correctly rejected on the disposable fork.

## Additive fix

- Declared the original standalone index in the existing Drizzle schema model.
- Added `0184_preserve_class_assignment_reference_index.sql` as the exact SQL
  source record.
- Applied only that CREATE UNIQUE INDEX to Development through the normal
  Development SQL tool, inside a transaction with 5-second lock and 30-second
  statement timeouts.
- Kept both existing Development UNIQUE constraints and every foreign key.
  No DROP/CASCADE, data update, historical migration rewrite, deployment hook,
  application-startup DDL or Production mutation was used.
- No migration-runner journal entry was fabricated: the existing disabled
  push/post-merge policy remains unchanged.

## Verification

- Development index matches Production's definition; unique, valid and ready.
- Fresh `explainSchemaDiff()` result: **24 statements**, no class-assignment
  index drop and no reported structural data loss. Other rollout compatibility
  warnings remain; this is not a claim of an empty or fully rehearsed migration.
- Production's three foreign keys still reference the original index and remain
  validated, verified using SELECT only.
- The three tables affected by pending CHECK replacements (`transport_routes`,
  `transport_history`, `flutterwave_split_payments`) currently each have zero
  rows in the read-only Production view.
- Library TypeScript build and source whitespace checks passed.

Retry Publish **validation** to verify the complete current plan on a fresh
disposable Production fork. This task did not publish or perform that full
fork validation.

## Separate Free Academic Terms release limitation

The remaining generated diff creates the free-term tables and structural
constraints but does not install `reject_free_term_evidence_mutation()`,
`validate_free_term_scope()` or the three guard triggers. Per Replit's
documented Publish limitations, structural validation success alone is not
Production activation evidence for Free Academic Terms. Keep its missing-guard
readiness checks intact; no Production installer or workaround was added.
