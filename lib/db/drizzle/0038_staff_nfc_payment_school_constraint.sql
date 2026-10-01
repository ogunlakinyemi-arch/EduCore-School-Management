-- Development schema alignment for the composite refund/event payment key.
-- Reuse the existing unique index; preserve its name, OID and dependent FKs.
-- Historical migrations and ledger entries are not rewritten.
DO $$
DECLARE
  payment_table regclass := 'public.staff_nfc_payments'::regclass;
  pair_index regclass := to_regclass('public.staff_nfc_payments_id_school_uq');
  id_column smallint;
  school_column smallint;
BEGIN
  SELECT attnum INTO STRICT id_column FROM pg_attribute
    WHERE attrelid = payment_table AND attname = 'id' AND NOT attisdropped;
  SELECT attnum INTO STRICT school_column FROM pg_attribute
    WHERE attrelid = payment_table AND attname = 'school_id' AND NOT attisdropped;
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = payment_table
      AND conname = 'staff_nfc_payments_id_school_uq' AND contype = 'u'
      AND conkey = ARRAY[id_column, school_column]::smallint[]
      AND conindid = pair_index::oid
  ) THEN
    RETURN;
  END IF;
  IF pair_index IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_am a ON a.oid = c.relam
    WHERE i.indexrelid = pair_index AND i.indrelid = payment_table
      AND i.indisunique AND i.indisvalid AND i.indisready
      AND i.indpred IS NULL AND i.indexprs IS NULL
      AND i.indnkeyatts = 2 AND i.indnatts = 2 AND a.amname = 'btree'
      AND i.indkey::text = id_column::text || ' ' || school_column::text
  ) THEN
    RAISE EXCEPTION 'Existing staff NFC payment school key is missing or incompatible';
  END IF;
  ALTER TABLE public.staff_nfc_payments
    ADD CONSTRAINT staff_nfc_payments_id_school_uq
    UNIQUE USING INDEX staff_nfc_payments_id_school_uq;
END;
$$;