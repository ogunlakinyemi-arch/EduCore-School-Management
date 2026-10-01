-- Development-only additive DDL for the schema reconciliation.
-- This file is deliberately outside the journaled Drizzle migration stream;
-- verify the live Development catalog before applying it manually.
ALTER TABLE "school_operation_categories"
  ADD CONSTRAINT "school_operation_categories_id_school_type_key"
  UNIQUE ("id", "school_id", "category_type");