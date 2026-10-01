-- Represent the existing pair key as a UNIQUE constraint for schema publishing.
-- Reuse its existing index: no DROP, index rebuild, duplicate key or row changes.
-- Applied historical migrations and migration-ledger rows are not rewritten.
DO $$
DECLARE
  relationship_table regclass := 'public.parent_student_relationships'::regclass;
  pair_index regclass := to_regclass('public.parent_student_relationship_unique');
  parent_column smallint;
  student_column smallint;
  existing_constraint record;
BEGIN
  SELECT attnum INTO STRICT parent_column FROM pg_attribute
    WHERE attrelid = relationship_table AND attname = 'parent_id' AND NOT attisdropped;
  SELECT attnum INTO STRICT student_column FROM pg_attribute
    WHERE attrelid = relationship_table AND attname = 'student_id' AND NOT attisdropped;

  SELECT contype, conkey, conindid INTO existing_constraint
    FROM pg_constraint
    WHERE conrelid = relationship_table AND conname = 'parent_student_relationship_unique';
  IF FOUND THEN
    IF existing_constraint.contype <> 'u'
      OR existing_constraint.conkey <> ARRAY[parent_column, student_column]::smallint[]
      OR existing_constraint.conindid IS DISTINCT FROM pair_index::oid THEN
      RAISE EXCEPTION 'Existing parent/student pair constraint does not match the required key';
    END IF;
    RETURN;
  END IF;

  IF pair_index IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_am a ON a.oid = c.relam
    WHERE i.indexrelid = pair_index AND i.indrelid = relationship_table
      AND i.indisunique AND i.indisvalid AND i.indisready
      AND i.indpred IS NULL AND i.indexprs IS NULL
      AND i.indnkeyatts = 2 AND i.indnatts = 2 AND a.amname = 'btree'
      AND i.indkey::text = parent_column::text || ' ' || student_column::text
  ) THEN
    RAISE EXCEPTION 'Required existing parent/student unique index is missing or incompatible';
  END IF;

  ALTER TABLE public.parent_student_relationships
    ADD CONSTRAINT parent_student_relationship_unique
    UNIQUE USING INDEX parent_student_relationship_unique;
END
$$;