-- AUTHORED, NOT EXECUTED. Only inside the combined disposable fixture transaction.
-- Copy the real CHECK/NOT NULL contract, not a rewritten approximation. FK and
-- retry trigger integration are tested separately against the real fixture table.
CREATE TEMP TABLE retry_evidence_case
 (LIKE public.current_bulk_checkout_attempts INCLUDING CONSTRAINTS) ON COMMIT DROP;
DO $$
DECLARE e jsonb; rejected boolean;
BEGIN
 FOR e IN SELECT value FROM (VALUES
  (NULL::jsonb),('null'::jsonb),('{}'::jsonb),('[]'::jsonb),('true'::jsonb),('0'::jsonb),('"failed"'::jsonb),
  ('{"chargedAmountMinor":0}'::jsonb),
  ('{"status":null,"chargedAmountMinor":0}'::jsonb),
  ('{"status":false,"chargedAmountMinor":0}'::jsonb),
  ('{"status":0,"chargedAmountMinor":0}'::jsonb),
  ('{"status":[],"chargedAmountMinor":0}'::jsonb),
  ('{"status":{},"chargedAmountMinor":0}'::jsonb),
  ('{"status":"","chargedAmountMinor":0}'::jsonb),
  ('{"status":"pending","chargedAmountMinor":0}'::jsonb),
  ('{"status":"successful","chargedAmountMinor":0}'::jsonb),
  ('{"status":"failed"}'::jsonb),
  ('{"status":"cancelled","chargedAmountMinor":null}'::jsonb),
  ('{"status":"failed","chargedAmountMinor":"0"}'::jsonb),
  ('{"status":"failed","chargedAmountMinor":"NaN"}'::jsonb),
  ('{"status":"failed","chargedAmountMinor":false}'::jsonb),
  ('{"status":"failed","chargedAmountMinor":[]}'::jsonb),
  ('{"status":"failed","chargedAmountMinor":{}}'::jsonb),
  ('{"status":"failed","chargedAmountMinor":1}'::jsonb),
  ('{"status":"cancelled","chargedAmountMinor":-1}'::jsonb),
  ('{"status":"failed","chargedAmountMinor":0.001}'::jsonb),
  ('{"status":"cancelled","chargedAmountMinor":-0.001}'::jsonb),
  ('{"status":"failed","chargedAmountMinor":100000000000000000000000}'::jsonb)
 ) AS cases(value) LOOP
  rejected:=false;
  BEGIN
   INSERT INTO retry_evidence_case(id,batch_id,reference,request_key,previous_transaction_id,evidence,reason,created_by,created_at)
    VALUES(1,1,'SCV4_live_bulk_fixture_000001','fixture_evidence_case','12345',e,'Fictional strict evidence',1,clock_timestamp());
  EXCEPTION WHEN check_violation OR not_null_violation THEN rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Unsafe retry evidence accepted: %',e; END IF;
 END LOOP;
 FOR e IN SELECT value FROM (VALUES
  ('{"status":"failed","chargedAmountMinor":0}'::jsonb),
  ('{"status":"cancelled","chargedAmountMinor":0.0}'::jsonb)
 ) AS cases(value) LOOP
  INSERT INTO retry_evidence_case(id,batch_id,reference,request_key,previous_transaction_id,evidence,reason,created_by,created_at)
   VALUES(1,1,'SCV4_live_bulk_fixture_000001','fixture_evidence_case','12345',e,'Fictional strict evidence',1,clock_timestamp());
 END LOOP;
END $$;
