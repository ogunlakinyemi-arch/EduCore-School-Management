 -- Focused controlled retirement from canonical 0055, not a data migration.
 -- Lock before catalog inspection; every check and DROP is in this DO transaction.
 DECLARE
  fee_checks jsonb; candidate jsonb; legacy_sig jsonb; canonical_sig jsonb;
  obsolete_names text[]:=ARRAY[]::text[]; obsolete_name text;
 BEGIN
  LOCK TABLE public.fee_payments IN ACCESS EXCLUSIVE MODE;
  fee_checks:=pg_temp.edu2i_catalog('constraints','fee_payments');
  legacy_sig:=pg_temp.edu2i_signature('constraints',jsonb_build_object(
   'kind','c','columns',jsonb_build_array('method'),'deferrable',false,
   'initially_deferred',false,'no_inherit',false,
   'check_expression',$legacy_expr$(method = ANY (ARRAY['BANK_TRANSFER'::text, 'REMITA'::text, 'FLUTTERWAVE'::text, 'PAYSTACK'::text]))$legacy_expr$));
  canonical_sig:=pg_temp.edu2i_signature('constraints',jsonb_build_object(
   'kind','c','columns',jsonb_build_array('method'),'deferrable',false,
   'initially_deferred',false,'no_inherit',false,
   'check_expression',$canonical_expr$(method = ANY (ARRAY['BANK_TRANSFER'::text, 'REMITA'::text, 'FLUTTERWAVE'::text, 'PAYSTACK'::text, 'CASH'::text]))$canonical_expr$));
  IF NOT EXISTS(SELECT FROM jsonb_array_elements(fee_checks) c
   WHERE pg_temp.edu2i_signature('constraints',c)=canonical_sig
    AND c->>'validated'='true' AND c->>'name'<>'fee_payments_method_check') THEN
   RAISE EXCEPTION '2I CASH retirement: validated canonical replacement prerequisite missing';
  END IF;
  -- Inspect every candidate BEFORE removing anything. Unknown definitions stop.
  FOR candidate IN SELECT value FROM jsonb_array_elements(fee_checks) LOOP
   IF candidate->>'name'='fee_payments_method_check'
    AND pg_temp.edu2i_signature('constraints',candidate) IS DISTINCT FROM legacy_sig THEN
    RAISE EXCEPTION '2I CASH retirement ambiguity: unexpected definition for fee_payments_method_check';
   END IF;
   IF pg_temp.edu2i_signature('constraints',candidate)=legacy_sig THEN
    obsolete_names:=array_append(obsolete_names,candidate->>'name');
   ELSIF candidate->>'kind'='c' AND candidate->'columns' ? 'method' THEN
    -- Known canonical evidence/method CHECKs remain intact. A differently named
    -- unproven method restriction is NOT guessed equivalent or silently removed.
    IF NOT EXISTS(SELECT FROM pg_constraint pc
     WHERE pc.conrelid='public.fee_payments'::regclass AND pc.conname=candidate->>'name'
      AND EXISTS(SELECT FROM jsonb_array_elements(
       $contracts$[{"kind":"c","columns":["method"],"deferrable":false,"initially_deferred":false,"no_inherit":false,"check_expression":"(method = ANY (ARRAY['BANK_TRANSFER'::text, 'REMITA'::text, 'FLUTTERWAVE'::text, 'PAYSTACK'::text, 'CASH'::text]))"},{"kind":"c","columns":["method","transfer_bank","transfer_reference","transfer_date"],"deferrable":false,"initially_deferred":false,"no_inherit":false,"check_expression":"((method <> 'BANK_TRANSFER'::text) OR ((COALESCE(length(btrim(transfer_bank)), 0) >= 2) AND (COALESCE(length(btrim(transfer_reference)), 0) >= 2) AND (transfer_date IS NOT NULL)))"},{"kind":"c","columns":["method","verified_by","verified_at","verification_evidence_ref","reviewer_notes","verification_metadata"],"deferrable":false,"initially_deferred":false,"no_inherit":false,"check_expression":"((method <> 'CASH'::text) OR ((verified_by IS NOT NULL) AND (verified_at IS NOT NULL) AND (length(btrim(verification_evidence_ref)) >= 3) AND (length(btrim(reviewer_notes)) >= 3) AND (verification_metadata IS NOT NULL)))"},{"kind":"c","columns":["method","status","verification_evidence_ref","reviewer_notes"],"deferrable":false,"initially_deferred":false,"no_inherit":false,"check_expression":"((method <> 'BANK_TRANSFER'::text) OR (status <> 'VERIFIED'::text) OR ((length(btrim(verification_evidence_ref)) >= 3) AND (length(btrim(reviewer_notes)) >= 3)))"},{"kind":"c","columns":["method","status","verified_by","verified_at","verification_evidence_ref","reviewer_notes","verification_metadata"],"deferrable":false,"initially_deferred":false,"no_inherit":false,"check_expression":"((method <> 'BANK_TRANSFER'::text) OR (status <> 'VERIFIED'::text) OR ((verified_by IS NOT NULL) AND (verified_at IS NOT NULL) AND (NULLIF(btrim(verification_evidence_ref), ''::text) IS NOT NULL) AND (NULLIF(btrim(reviewer_notes), ''::text) IS NOT NULL) AND (verification_metadata IS NOT NULL)))"}]$contracts$::jsonb) known
       WHERE pg_temp.edu2i_signature('constraints',known)=pg_temp.edu2i_signature('constraints',candidate))) THEN
     RAISE EXCEPTION '2I CASH retirement ambiguity: unreviewed method CHECK %',candidate->>'name';
    END IF;
   END IF;
  END LOOP;
  FOREACH obsolete_name IN ARRAY obsolete_names LOOP
   EXECUTE format('ALTER TABLE public.fee_payments DROP CONSTRAINT %I',obsolete_name);
  END LOOP;
 END;
