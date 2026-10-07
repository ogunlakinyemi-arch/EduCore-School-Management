-- Stage 2I source-only; NOT journal-registered or authorized for shared execution.
-- functions, phase F. Depends on preceding structural tier; see reports/schema-2i/manifest.json.
-- No data repair/backfill. Same-name different semantics raise an exception.
-- Required Production preflights are NOT RUN; see separate preflight specification.
-- One transaction statement; helper DDL executes only in the temporary session schema.
DO $migration$
DECLARE spec jsonb;
BEGIN
 PERFORM set_config('search_path','pg_catalog,public,pg_temp',true);
 PERFORM set_config('lock_timeout','10s',true);
 EXECUTE '
CREATE OR REPLACE FUNCTION pg_temp.edu2i_catalog(section text, scope text)
RETURNS jsonb LANGUAGE plpgsql AS $catalog$
BEGIN
IF section=''tables'' THEN RETURN (SELECT coalesce(jsonb_agg(x ORDER BY x.schema,x.name),''[]''::jsonb) catalog FROM (
 SELECT n.nspname schema,c.relname name,c.relkind::text kind,c.relpersistence::text persistence,
 EXISTS(SELECT FROM pg_inherits h WHERE h.inhrelid=c.oid) inherited
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relname=scope AND n.nspname=''public'' AND c.relkind IN (''r'',''p'')
) x); END IF;
IF section=''columns'' THEN RETURN (SELECT coalesce(jsonb_agg(x ORDER BY x.schema,x.table_name,x.ordinal),''[]''::jsonb) catalog FROM (
 SELECT n.nspname schema,c.relname table_name,a.attname name,a.attnum ordinal,
 format_type(a.atttypid,a.atttypmod) type,NOT a.attnotnull nullable,
 pg_get_expr(d.adbin,d.adrelid) default_expression,a.attidentity::text identity,a.attgenerated::text generated,
 CASE WHEN a.attcollation<>0 THEN co.collname END collation,
 i.character_maximum_length maximum_length,i.numeric_precision,i.numeric_scale,i.datetime_precision
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
 LEFT JOIN pg_collation co ON co.oid=a.attcollation
 LEFT JOIN information_schema.columns i ON i.table_schema=n.nspname AND i.table_name=c.relname AND i.column_name=a.attname
 WHERE c.relname=scope AND n.nspname=''public'' AND c.relkind IN (''r'',''p'') AND a.attnum>0 AND NOT a.attisdropped
) x); END IF;
IF section=''constraints'' THEN RETURN (SELECT coalesce(jsonb_agg(x ORDER BY x.schema,x.table_name,x.name),''[]''::jsonb) catalog FROM (
 SELECT n.nspname schema,t.relname table_name,c.conname name,c.contype::text kind,
 pg_get_constraintdef(c.oid) definition,pg_get_expr(c.conbin,c.conrelid) check_expression,
 ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(num,ord)
 JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num ORDER BY k.ord) columns,
 rn.nspname referenced_schema,rt.relname referenced_table,
 ARRAY(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY k(num,ord)
 JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.num ORDER BY k.ord) referenced_columns,
 c.confdeltype::text delete_action,c.confupdtype::text update_action,c.confmatchtype::text match_type,
 c.condeferrable deferrable,c.condeferred initially_deferred,c.convalidated validated,
 c.connoinherit no_inherit,ix.relname supporting_index,
 ARRAY(SELECT ct.relname||''.''||cc.conname FROM pg_constraint cc JOIN pg_class ct ON ct.oid=cc.conrelid
 WHERE cc.contype=''f'' AND cc.conindid=c.conindid ORDER BY ct.relname,cc.conname) dependent_fks
 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
 LEFT JOIN pg_class rt ON rt.oid=c.confrelid LEFT JOIN pg_namespace rn ON rn.oid=rt.relnamespace
 LEFT JOIN pg_class ix ON ix.oid=c.conindid
 WHERE t.relname=scope AND n.nspname=''public'' AND t.relkind IN (''r'',''p'') AND c.contype IN (''p'',''u'',''c'',''f'')
) x); END IF;
IF section=''indexes'' THEN RETURN (SELECT coalesce(jsonb_agg(x ORDER BY x.schema,x.table_name,x.name),''[]''::jsonb) catalog FROM (
 SELECT n.nspname schema,t.relname table_name,ix.relname name,am.amname method,
 i.indisunique unique_index,i.indisprimary primary_index,i.indimmediate immediate,
 i.indisvalid valid,i.indisready ready,pg_get_indexdef(i.indexrelid) definition,
 pg_get_expr(i.indpred,i.indrelid) predicate,pg_get_expr(i.indexprs,i.indrelid) expressions,
 ARRAY(SELECT pg_get_indexdef(i.indexrelid,k,true) FROM generate_series(1,i.indnkeyatts) k) keys,
 ARRAY(SELECT pg_get_indexdef(i.indexrelid,k,true) FROM generate_series(i.indnkeyatts+1,i.indnatts) k) included,
 i.indoption::smallint[] ordering_options,
 ARRAY(SELECT co.collname FROM unnest(i.indcollation::oid[]) WITH ORDINALITY k(id,ord)
 LEFT JOIN pg_collation co ON co.oid=k.id ORDER BY ord) collations,
 ARRAY(SELECT op.opcname FROM unnest(i.indclass::oid[]) WITH ORDINALITY k(id,ord)
 JOIN pg_opclass op ON op.oid=k.id ORDER BY ord) operator_classes,
 (SELECT cc.conname FROM pg_constraint cc WHERE cc.conindid=i.indexrelid AND cc.contype IN (''p'',''u'')) owner_constraint,
 ARRAY(SELECT ct.relname||''.''||cc.conname FROM pg_constraint cc JOIN pg_class ct ON ct.oid=cc.conrelid
 WHERE cc.contype=''f'' AND cc.conindid=i.indexrelid ORDER BY ct.relname,cc.conname) dependent_fks
 FROM pg_index i JOIN pg_class t ON t.oid=i.indrelid JOIN pg_class ix ON ix.oid=i.indexrelid
 JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_am am ON am.oid=ix.relam
 WHERE t.relname=scope AND n.nspname=''public'' AND t.relkind IN (''r'',''p'')
) x); END IF;
IF section=''functions'' THEN RETURN (SELECT coalesce(jsonb_agg(x ORDER BY x.schema,x.name,x.identity_arguments),''[]''::jsonb) catalog FROM (
 SELECT n.nspname schema,p.proname name,pg_get_function_identity_arguments(p.oid) identity_arguments,
 pg_get_function_arguments(p.oid) arguments,pg_get_function_result(p.oid) return_type,l.lanname language,
 p.prosrc body,pg_get_functiondef(p.oid) definition,p.provolatile::text volatility,
 p.proparallel::text parallel,p.prosecdef security_definer,p.proisstrict strict,p.proconfig configuration,
 EXISTS(SELECT FROM pg_depend d WHERE d.objid=p.oid AND d.deptype=''e'') extension_owned
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE p.proname=scope AND n.nspname=''public'' AND p.prokind IN (''f'',''p'')
) x); END IF;
IF section=''triggers'' THEN RETURN (SELECT coalesce(jsonb_agg(x ORDER BY x.schema,x.table_name,x.name),''[]''::jsonb) catalog FROM (
 SELECT n.nspname schema,c.relname table_name,t.tgname name,pg_get_triggerdef(t.oid) definition,
 CASE WHEN t.tgtype&2<>0 THEN ''BEFORE'' WHEN t.tgtype&64<>0 THEN ''INSTEAD OF'' ELSE ''AFTER'' END timing,
 array_remove(ARRAY[CASE WHEN t.tgtype&4<>0 THEN ''INSERT'' END,CASE WHEN t.tgtype&8<>0 THEN ''DELETE'' END,
 CASE WHEN t.tgtype&16<>0 THEN ''UPDATE'' END,CASE WHEN t.tgtype&32<>0 THEN ''TRUNCATE'' END],NULL) events,
 CASE WHEN t.tgtype&1<>0 THEN ''ROW'' ELSE ''STATEMENT'' END level,
 pn.nspname function_schema,p.proname function_name,pg_get_function_identity_arguments(p.oid) function_arguments,
 pg_get_expr(t.tgqual,t.tgrelid) condition,t.tgenabled::text enabled,t.tgdeferrable deferrable,t.tginitdeferred initially_deferred
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace pn ON pn.oid=p.pronamespace
 WHERE c.relname=scope AND n.nspname=''public'' AND NOT t.tgisinternal
) x); END IF;
IF section=''sequences'' THEN RETURN (SELECT coalesce(jsonb_agg(x ORDER BY x.schema,x.name),''[]''::jsonb) catalog FROM (
 SELECT n.nspname schema,c.relname name,format_type(s.seqtypid,NULL) type,s.seqstart::text start_value,
 s.seqincrement::text increment,s.seqmin::text minimum,s.seqmax::text maximum,s.seqcache::text cache,s.seqcycle cycle,
 tn.nspname table_schema,t.relname table_name,a.attname column_name,d.deptype::text ownership,
 q.last_value::text observed_last_value
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_sequence s ON s.seqrelid=c.oid
 LEFT JOIN pg_depend d ON d.objid=c.oid AND d.classid=''pg_class''::regclass AND d.deptype IN (''a'',''i'')
 LEFT JOIN pg_class t ON t.oid=d.refobjid LEFT JOIN pg_namespace tn ON tn.oid=t.relnamespace
 LEFT JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=d.refobjsubid
 LEFT JOIN pg_sequences q ON q.schemaname=n.nspname AND q.sequencename=c.relname
 WHERE c.relname=scope AND n.nspname=''public'' AND c.relkind=''S''
) x); END IF;
RAISE EXCEPTION ''2I: unknown catalog section %'',section;
END $catalog$;
CREATE OR REPLACE FUNCTION pg_temp.edu2i_signature(section text,r jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $sig$
DECLARE names text[]; result jsonb;
BEGIN
names := CASE section
WHEN ''tables'' THEN ARRAY[''kind'',''persistence'',''inherited'']
WHEN ''columns'' THEN ARRAY[''type'',''nullable'',''default_expression'',''identity'',''generated'',''collation'',''maximum_length'',''numeric_precision'',''numeric_scale'',''datetime_precision'']
WHEN ''constraints'' THEN ARRAY[''kind'',''columns'',''deferrable'',''initially_deferred'',''no_inherit'']
WHEN ''indexes'' THEN ARRAY[''method'',''unique_index'',''primary_index'',''immediate'',''valid'',''ready'',''keys'',''included'',''predicate'',''expressions'',''ordering_options'',''collations'',''operator_classes'']
WHEN ''functions'' THEN ARRAY[''identity_arguments'',''arguments'',''return_type'',''language'',''body'',''volatility'',''parallel'',''security_definer'',''strict'',''configuration'']
WHEN ''triggers'' THEN ARRAY[''timing'',''events'',''level'',''function_schema'',''function_name'',''function_arguments'',''condition'',''enabled'',''deferrable'',''initially_deferred'']
WHEN ''sequences'' THEN ARRAY[''type'',''start_value'',''increment'',''minimum'',''maximum'',''cache'',''cycle''] END;
IF names IS NULL THEN RAISE EXCEPTION ''2I unknown signature section''; END IF;
SELECT jsonb_object_agg(n,coalesce(r->n,''null''::jsonb)) INTO result FROM unnest(names) n;
IF section=''columns'' AND result->>''default_expression''=''ARRAY[]::text[]'' THEN
 result:=jsonb_set(result,''{default_expression}'',to_jsonb(''''''{}''''::text[]''::text)); END IF;
IF section=''constraints'' THEN
 IF r->>''kind''=''f'' THEN
  SELECT result||jsonb_object_agg(n,coalesce(r->n,''null''::jsonb)) INTO result
   FROM unnest(ARRAY[''referenced_schema'',''referenced_table'',''referenced_columns'',''delete_action'',''update_action'',''match_type'']) n;
 ELSIF r->>''kind''=''c'' THEN result:=result||jsonb_build_object(''check_expression'',
 CASE r->>''check_expression''
 WHEN ''(((length(btrim(event_type)) >= 3) AND (length(btrim(event_type)) <= 80)) AND ((length(btrim(reason)) >= 3) AND (length(btrim(reason)) <= 1000)))'' THEN to_jsonb(''((length(btrim(event_type)) >= 3) AND (length(btrim(event_type)) <= 80) AND ((length(btrim(reason)) >= 3) AND (length(btrim(reason)) <= 1000)))''::text)
WHEN ''(((cardinality(weekdays) >= 1) AND (cardinality(weekdays) <= 7)) AND (weekdays <@ ARRAY[''''MONDAY''''::text, ''''TUESDAY''''::text, ''''WEDNESDAY''''::text, ''''THURSDAY''''::text, ''''FRIDAY''''::text, ''''SATURDAY''''::text, ''''SUNDAY''''::text]))'' THEN to_jsonb(''((cardinality(weekdays) >= 1) AND (cardinality(weekdays) <= 7) AND (weekdays <@ ARRAY[''''MONDAY''''::text, ''''TUESDAY''''::text, ''''WEDNESDAY''''::text, ''''THURSDAY''''::text, ''''FRIDAY''''::text, ''''SATURDAY''''::text, ''''SUNDAY''''::text]))''::text)
 ELSE r->''check_expression'' END);
 END IF;
END IF;
IF section=''constraints'' AND r->>''kind'' IN (''p'',''u'') OR section=''indexes'' THEN
 result:=result||jsonb_build_object(''nulls_not_distinct'',coalesce(r->>''definition'','''') ~* ''NULLS\s+NOT\s+DISTINCT'');
END IF;
IF section=''triggers'' THEN
 result:=result||jsonb_build_object(''call'',substring(r->>''definition'' from ''EXECUTE FUNCTION (.*)$''));
END IF;
RETURN result;
END $sig$;
CREATE OR REPLACE FUNCTION pg_temp.edu2i_apply(section text, spec jsonb)
RETURNS void LANGUAGE plpgsql AS $apply$
DECLARE r jsonb:=spec->''expected''; current jsonb; items jsonb; candidate jsonb; actual_sig jsonb; expected_sig jsonb;
 scope text; rel regclass; occupied regclass; ddl text:=spec->>''ddl''; new_column boolean:=false; any_rows boolean; n text; attached boolean:=false;
BEGIN
scope:=coalesce(r->>''table_name'',r->>''name'');
IF section IN (''tables'',''functions'',''sequences'') THEN scope:=r->>''name''; END IF;
IF section=''ownership'' THEN
 items:=pg_temp.edu2i_catalog(''sequences'',r->>''name''); current:=items->0;
 IF current IS NULL THEN RAISE EXCEPTION ''2I sequence prerequisite missing: %'',r->>''name''; END IF;
 IF (current->>''table_name'',current->>''column_name'',current->>''ownership'')
  IS NOT DISTINCT FROM (r->>''table_name'',r->>''column_name'',r->>''ownership'') THEN RETURN; END IF;
 IF current->>''ownership'' IS NOT NULL THEN RAISE EXCEPTION ''2I differing sequence ownership %'',r->>''name''; END IF;
 IF r->>''ownership'' IS NULL THEN RETURN; END IF;
 IF EXISTS(SELECT FROM pg_depend d JOIN pg_attrdef ad ON ad.oid=d.objid
  JOIN pg_class t ON t.oid=ad.adrelid JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=ad.adnum
  WHERE d.refobjid=to_regclass(format(''public.%I'',r->>''name'')) AND d.classid=''pg_attrdef''::regclass
   AND (t.relname,a.attname) IS DISTINCT FROM (r->>''table_name'',r->>''column_name'')) THEN
  RAISE EXCEPTION ''2I sequence used by unexpected column %'',r->>''name''; END IF;
 EXECUTE ddl; RETURN;
END IF;
items:=pg_temp.edu2i_catalog(section,scope);
SELECT value INTO current FROM jsonb_array_elements(items)
 WHERE value->>''name''=r->>''name'' AND (section<>''functions'' OR value->>''identity_arguments''=r->>''identity_arguments'');
expected_sig:=pg_temp.edu2i_signature(section,r);
IF current IS NOT NULL THEN
 actual_sig:=pg_temp.edu2i_signature(section,current);
 IF section=''columns'' AND actual_sig IS DISTINCT FROM expected_sig THEN
  IF scope IN (''fee_invoices'',''fee_payments'') AND r->>''name''=''student_id''
   AND r->>''nullable''=''true'' AND current->>''nullable''=''false''
   AND actual_sig-''nullable''=expected_sig-''nullable'' THEN
   EXECUTE format(''ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL'',scope,r->>''name'');
   RETURN;
  END IF;
 END IF;
 IF actual_sig IS DISTINCT FROM expected_sig THEN
  RAISE EXCEPTION ''2I ambiguous/different existing %.%: expected %, actual %'',scope,r->>''name'',expected_sig,actual_sig;
 END IF;
 IF section=''constraints'' AND r->>''validated''=''true'' AND current->>''validated''=''false'' THEN
  EXECUTE format(''ALTER TABLE public.%I VALIDATE CONSTRAINT %I'',scope,current->>''name'');
 END IF;
 RETURN; -- preserves stronger validation and every equivalent existing OID
END IF;
IF section IN (''constraints'',''indexes'',''triggers'') THEN
 FOR candidate IN SELECT value FROM jsonb_array_elements(items) LOOP
  IF pg_temp.edu2i_signature(section,candidate)=expected_sig THEN
   IF section=''constraints'' AND r->>''validated''=''true'' AND candidate->>''validated''=''false'' THEN
    EXECUTE format(''ALTER TABLE public.%I VALIDATE CONSTRAINT %I'',scope,candidate->>''name''); END IF;
   RETURN;
  END IF;
 END LOOP;
END IF;
IF section=''columns'' THEN
 rel:=to_regclass(format(''public.%I'',scope));
 IF rel IS NULL THEN RAISE EXCEPTION ''2I missing column table %'',scope; END IF;
 EXECUTE format(''LOCK TABLE %s IN ACCESS EXCLUSIVE MODE'',rel);
 IF r->>''nullable''=''false'' THEN
  EXECUTE format(''SELECT EXISTS(SELECT FROM %s LIMIT 1)'',rel) INTO any_rows;
  IF any_rows THEN RAISE EXCEPTION ''2I preflight gate: required column %.% needs an approved existing-row mapping; no default backfill'',scope,r->>''name''; END IF;
 END IF;
 -- Add nullable fields WITHOUT a default first: old row values remain NULL.
 EXECUTE ddl; new_column:=true;
 IF r->>''default_expression'' IS NOT NULL THEN
  EXECUTE format(''ALTER TABLE %s ALTER COLUMN %I SET DEFAULT %s'',rel,r->>''name'',r->>''default_expression''); END IF;
ELSIF section=''constraints'' AND r->>''kind'' IN (''p'',''u'') THEN
 -- Adopt a qualifying standalone index in place; keep its name and OID.
 FOR candidate IN SELECT value FROM jsonb_array_elements(pg_temp.edu2i_catalog(''indexes'',scope)) LOOP
  IF candidate->>''unique_index''=''true'' AND candidate->>''immediate''=''true''
   AND candidate->>''valid''=''true'' AND candidate->>''ready''=''true'' AND candidate->>''method''=''btree''
   AND candidate->>''owner_constraint'' IS NULL AND candidate->>''predicate'' IS NULL
   AND candidate->>''expressions'' IS NULL AND candidate->''keys''=r->''columns''
   AND candidate->''included''=''[]''::jsonb
   AND NOT EXISTS(SELECT FROM jsonb_array_elements(candidate->''ordering_options'') v WHERE v::text<>''0'')
   AND NOT (candidate->>''definition'' ~* ''NULLS\s+NOT\s+DISTINCT'') THEN
    n:=candidate->>''name'';
    IF EXISTS(SELECT FROM pg_constraint WHERE conrelid=to_regclass(format(''public.%I'',scope)) AND conname=n) THEN
     RAISE EXCEPTION ''2I occupied adopted constraint name %.%'',scope,n; END IF;
    EXECUTE format(''ALTER TABLE public.%I ADD CONSTRAINT %I %s USING INDEX %I'',
     scope,n,CASE WHEN r->>''kind''=''p'' THEN ''PRIMARY KEY'' ELSE ''UNIQUE'' END,n);
    attached:=true;EXIT;
  END IF;
 END LOOP;
 IF NOT attached THEN EXECUTE ddl; END IF;
ELSIF section=''indexes'' AND r->>''owner_constraint'' IS NOT NULL THEN
 RAISE EXCEPTION ''2I missing automatic index %; prerequisite constraint must materialize/adopt it'',r->>''name'';
ELSE
 EXECUTE ddl;
END IF;
-- Re-read PostgreSQL''s own definition, not the proposed text.
items:=pg_temp.edu2i_catalog(section,scope);
IF NOT EXISTS(SELECT FROM jsonb_array_elements(items) v
 WHERE pg_temp.edu2i_signature(section,v)=expected_sig) THEN
 RAISE EXCEPTION ''2I post-create semantic verification failed %.%'',scope,r->>''name'';
END IF;
END $apply$;
';
 FOR spec IN SELECT value FROM jsonb_array_elements($contracts$[{"kind":"functions","expected":{"body":"\nDECLARE inv record; due bigint; count_lines integer; selected_count integer;\nBEGIN\n  IF TG_OP='UPDATE' AND OLD.selected_line_ids IS DISTINCT FROM NEW.selected_line_ids THEN\n    RAISE EXCEPTION 'Payment fee selection is immutable';\n  END IF;\n  IF NEW.status<>'VERIFIED' OR (TG_OP='UPDATE' AND OLD.status='VERIFIED') THEN RETURN NEW; END IF;\n  SELECT * INTO inv FROM fee_invoices WHERE id=NEW.invoice_id AND school_id=NEW.school_id FOR UPDATE;\n  -- Existing discounts or unallocated historical partial receipts are never silently apportioned.\n  SELECT COALESCE(SUM(a.amount_minor),0) INTO due FROM fee_payment_line_allocations a\n    JOIN fee_payments p ON p.id=a.payment_id AND p.school_id=a.school_id\n    WHERE a.invoice_id=inv.id AND a.school_id=inv.school_id AND p.status='VERIFIED';\n  IF inv.discount_minor+inv.waiver_minor>0 OR inv.paid_minor<>due THEN\n    IF NEW.selected_line_ids IS NOT NULL THEN RAISE EXCEPTION 'Fee lines require explicit allocation of existing adjustments/payments'; END IF;\n    RETURN NEW;\n  END IF;\n  SELECT count(*),COALESCE(sum(l.amount_minor-COALESCE(paid.n,0)),0) INTO count_lines,due\n    FROM fee_invoice_lines l LEFT JOIN LATERAL (\n      SELECT sum(a.amount_minor) n FROM fee_payment_line_allocations a JOIN fee_payments p\n      ON p.id=a.payment_id AND p.school_id=a.school_id\n      WHERE a.line_id=l.id AND a.invoice_id=l.invoice_id AND a.school_id=l.school_id AND p.status='VERIFIED'\n    ) paid ON true\n    WHERE l.invoice_id=inv.id AND l.school_id=inv.school_id\n      AND (NEW.selected_line_ids IS NULL OR l.id=ANY(NEW.selected_line_ids))\n      AND l.amount_minor>COALESCE(paid.n,0);\n  IF NEW.selected_line_ids IS NOT NULL THEN\n    SELECT count(DISTINCT x) INTO selected_count FROM unnest(NEW.selected_line_ids) x;\n    IF count_lines<>selected_count OR selected_count<>cardinality(NEW.selected_line_ids) OR selected_count=0 OR due<>NEW.amount_minor THEN\n      RAISE EXCEPTION 'Selected fee line balances do not match this payment';\n    END IF;\n  ELSIF due<>NEW.amount_minor THEN RETURN NEW;\n  END IF;\n  INSERT INTO fee_payment_line_allocations(school_id,invoice_id,payment_id,line_id,amount_minor)\n    SELECT l.school_id,l.invoice_id,NEW.id,l.id,l.amount_minor-COALESCE(paid.n,0)\n    FROM fee_invoice_lines l LEFT JOIN LATERAL (\n      SELECT sum(a.amount_minor) n FROM fee_payment_line_allocations a JOIN fee_payments p\n      ON p.id=a.payment_id AND p.school_id=a.school_id\n      WHERE a.line_id=l.id AND a.invoice_id=l.invoice_id AND a.school_id=l.school_id AND p.status='VERIFIED'\n    ) paid ON true WHERE l.invoice_id=inv.id AND l.school_id=inv.school_id\n      AND (NEW.selected_line_ids IS NULL OR l.id=ANY(NEW.selected_line_ids))\n      AND l.amount_minor>COALESCE(paid.n,0);\n  RETURN NEW;\nEND ","name":"allocate_verified_fee_lines","schema":"public","strict":false,"language":"plpgsql","parallel":"u","arguments":"","definition":"CREATE OR REPLACE FUNCTION public.allocate_verified_fee_lines()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$\nDECLARE inv record; due bigint; count_lines integer; selected_count integer;\nBEGIN\n  IF TG_OP='UPDATE' AND OLD.selected_line_ids IS DISTINCT FROM NEW.selected_line_ids THEN\n    RAISE EXCEPTION 'Payment fee selection is immutable';\n  END IF;\n  IF NEW.status<>'VERIFIED' OR (TG_OP='UPDATE' AND OLD.status='VERIFIED') THEN RETURN NEW; END IF;\n  SELECT * INTO inv FROM fee_invoices WHERE id=NEW.invoice_id AND school_id=NEW.school_id FOR UPDATE;\n  -- Existing discounts or unallocated historical partial receipts are never silently apportioned.\n  SELECT COALESCE(SUM(a.amount_minor),0) INTO due FROM fee_payment_line_allocations a\n    JOIN fee_payments p ON p.id=a.payment_id AND p.school_id=a.school_id\n    WHERE a.invoice_id=inv.id AND a.school_id=inv.school_id AND p.status='VERIFIED';\n  IF inv.discount_minor+inv.waiver_minor>0 OR inv.paid_minor<>due THEN\n    IF NEW.selected_line_ids IS NOT NULL THEN RAISE EXCEPTION 'Fee lines require explicit allocation of existing adjustments/payments'; END IF;\n    RETURN NEW;\n  END IF;\n  SELECT count(*),COALESCE(sum(l.amount_minor-COALESCE(paid.n,0)),0) INTO count_lines,due\n    FROM fee_invoice_lines l LEFT JOIN LATERAL (\n      SELECT sum(a.amount_minor) n FROM fee_payment_line_allocations a JOIN fee_payments p\n      ON p.id=a.payment_id AND p.school_id=a.school_id\n      WHERE a.line_id=l.id AND a.invoice_id=l.invoice_id AND a.school_id=l.school_id AND p.status='VERIFIED'\n    ) paid ON true\n    WHERE l.invoice_id=inv.id AND l.school_id=inv.school_id\n      AND (NEW.selected_line_ids IS NULL OR l.id=ANY(NEW.selected_line_ids))\n      AND l.amount_minor>COALESCE(paid.n,0);\n  IF NEW.selected_line_ids IS NOT NULL THEN\n    SELECT count(DISTINCT x) INTO selected_count FROM unnest(NEW.selected_line_ids) x;\n    IF count_lines<>selected_count OR selected_count<>cardinality(NEW.selected_line_ids) OR selected_count=0 OR due<>NEW.amount_minor THEN\n      RAISE EXCEPTION 'Selected fee line balances do not match this payment';\n    END IF;\n  ELSIF due<>NEW.amount_minor THEN RETURN NEW;\n  END IF;\n  INSERT INTO fee_payment_line_allocations(school_id,invoice_id,payment_id,line_id,amount_minor)\n    SELECT l.school_id,l.invoice_id,NEW.id,l.id,l.amount_minor-COALESCE(paid.n,0)\n    FROM fee_invoice_lines l LEFT JOIN LATERAL (\n      SELECT sum(a.amount_minor) n FROM fee_payment_line_allocations a JOIN fee_payments p\n      ON p.id=a.payment_id AND p.school_id=a.school_id\n      WHERE a.line_id=l.id AND a.invoice_id=l.invoice_id AND a.school_id=l.school_id AND p.status='VERIFIED'\n    ) paid ON true WHERE l.invoice_id=inv.id AND l.school_id=inv.school_id\n      AND (NEW.selected_line_ids IS NULL OR l.id=ANY(NEW.selected_line_ids))\n      AND l.amount_minor>COALESCE(paid.n,0);\n  RETURN NEW;\nEND $function$\n","volatility":"v","return_type":"trigger","configuration":null,"extension_owned":false,"security_definer":false,"identity_arguments":""},"ddl":"CREATE OR REPLACE FUNCTION public.allocate_verified_fee_lines()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$\nDECLARE inv record; due bigint; count_lines integer; selected_count integer;\nBEGIN\n  IF TG_OP='UPDATE' AND OLD.selected_line_ids IS DISTINCT FROM NEW.selected_line_ids THEN\n    RAISE EXCEPTION 'Payment fee selection is immutable';\n  END IF;\n  IF NEW.status<>'VERIFIED' OR (TG_OP='UPDATE' AND OLD.status='VERIFIED') THEN RETURN NEW; END IF;\n  SELECT * INTO inv FROM fee_invoices WHERE id=NEW.invoice_id AND school_id=NEW.school_id FOR UPDATE;\n  -- Existing discounts or unallocated historical partial receipts are never silently apportioned.\n  SELECT COALESCE(SUM(a.amount_minor),0) INTO due FROM fee_payment_line_allocations a\n    JOIN fee_payments p ON p.id=a.payment_id AND p.school_id=a.school_id\n    WHERE a.invoice_id=inv.id AND a.school_id=inv.school_id AND p.status='VERIFIED';\n  IF inv.discount_minor+inv.waiver_minor>0 OR inv.paid_minor<>due THEN\n    IF NEW.selected_line_ids IS NOT NULL THEN RAISE EXCEPTION 'Fee lines require explicit allocation of existing adjustments/payments'; END IF;\n    RETURN NEW;\n  END IF;\n  SELECT count(*),COALESCE(sum(l.amount_minor-COALESCE(paid.n,0)),0) INTO count_lines,due\n    FROM fee_invoice_lines l LEFT JOIN LATERAL (\n      SELECT sum(a.amount_minor) n FROM fee_payment_line_allocations a JOIN fee_payments p\n      ON p.id=a.payment_id AND p.school_id=a.school_id\n      WHERE a.line_id=l.id AND a.invoice_id=l.invoice_id AND a.school_id=l.school_id AND p.status='VERIFIED'\n    ) paid ON true\n    WHERE l.invoice_id=inv.id AND l.school_id=inv.school_id\n      AND (NEW.selected_line_ids IS NULL OR l.id=ANY(NEW.selected_line_ids))\n      AND l.amount_minor>COALESCE(paid.n,0);\n  IF NEW.selected_line_ids IS NOT NULL THEN\n    SELECT count(DISTINCT x) INTO selected_count FROM unnest(NEW.selected_line_ids) x;\n    IF count_lines<>selected_count OR selected_count<>cardinality(NEW.selected_line_ids) OR selected_count=0 OR due<>NEW.amount_minor THEN\n      RAISE EXCEPTION 'Selected fee line balances do not match this payment';\n    END IF;\n  ELSIF due<>NEW.amount_minor THEN RETURN NEW;\n  END IF;\n  INSERT INTO fee_payment_line_allocations(school_id,invoice_id,payment_id,line_id,amount_minor)\n    SELECT l.school_id,l.invoice_id,NEW.id,l.id,l.amount_minor-COALESCE(paid.n,0)\n    FROM fee_invoice_lines l LEFT JOIN LATERAL (\n      SELECT sum(a.amount_minor) n FROM fee_payment_line_allocations a JOIN fee_payments p\n      ON p.id=a.payment_id AND p.school_id=a.school_id\n      WHERE a.line_id=l.id AND a.invoice_id=l.invoice_id AND a.school_id=l.school_id AND p.status='VERIFIED'\n    ) paid ON true WHERE l.invoice_id=inv.id AND l.school_id=inv.school_id\n      AND (NEW.selected_line_ids IS NULL OR l.id=ANY(NEW.selected_line_ids))\n      AND l.amount_minor>COALESCE(paid.n,0);\n  RETURN NEW;\nEND $function$\n","stage":9,"phase":"F","id":"functions:public..allocate_verified_fee_lines."},{"kind":"functions","expected":{"body":"\nDECLARE invoice_student integer; invoice_employee integer;\nBEGIN\n  SELECT student_id,employee_id INTO invoice_student,invoice_employee FROM fee_invoices WHERE id=NEW.invoice_id AND school_id=NEW.school_id;\n  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice identity missing'; END IF;\n  IF NEW.employee_id IS NULL AND NEW.student_id IS NULL THEN NEW.employee_id:=invoice_employee; END IF;\n  IF NEW.student_id IS DISTINCT FROM invoice_student OR NEW.employee_id IS DISTINCT FROM invoice_employee THEN\n    RAISE EXCEPTION 'Payment and invoice cardholder identities must match';\n  END IF;\n  RETURN NEW;\nEND ","name":"preserve_fee_payment_person","schema":"public","strict":false,"language":"plpgsql","parallel":"u","arguments":"","definition":"CREATE OR REPLACE FUNCTION public.preserve_fee_payment_person()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$\nDECLARE invoice_student integer; invoice_employee integer;\nBEGIN\n  SELECT student_id,employee_id INTO invoice_student,invoice_employee FROM fee_invoices WHERE id=NEW.invoice_id AND school_id=NEW.school_id;\n  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice identity missing'; END IF;\n  IF NEW.employee_id IS NULL AND NEW.student_id IS NULL THEN NEW.employee_id:=invoice_employee; END IF;\n  IF NEW.student_id IS DISTINCT FROM invoice_student OR NEW.employee_id IS DISTINCT FROM invoice_employee THEN\n    RAISE EXCEPTION 'Payment and invoice cardholder identities must match';\n  END IF;\n  RETURN NEW;\nEND $function$\n","volatility":"v","return_type":"trigger","configuration":null,"extension_owned":false,"security_definer":false,"identity_arguments":""},"ddl":"CREATE OR REPLACE FUNCTION public.preserve_fee_payment_person()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$\nDECLARE invoice_student integer; invoice_employee integer;\nBEGIN\n  SELECT student_id,employee_id INTO invoice_student,invoice_employee FROM fee_invoices WHERE id=NEW.invoice_id AND school_id=NEW.school_id;\n  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice identity missing'; END IF;\n  IF NEW.employee_id IS NULL AND NEW.student_id IS NULL THEN NEW.employee_id:=invoice_employee; END IF;\n  IF NEW.student_id IS DISTINCT FROM invoice_student OR NEW.employee_id IS DISTINCT FROM invoice_employee THEN\n    RAISE EXCEPTION 'Payment and invoice cardholder identities must match';\n  END IF;\n  RETURN NEW;\nEND $function$\n","stage":9,"phase":"F","id":"functions:public..preserve_fee_payment_person."},{"kind":"functions","expected":{"body":"\nBEGIN\n  RAISE EXCEPTION 'Paid employee payslips are immutable'\n    USING ERRCODE = '55000';\nEND;\n","name":"prevent_payroll_payslip_mutation","schema":"public","strict":false,"language":"plpgsql","parallel":"u","arguments":"","definition":"CREATE OR REPLACE FUNCTION public.prevent_payroll_payslip_mutation()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$\nBEGIN\n  RAISE EXCEPTION 'Paid employee payslips are immutable'\n    USING ERRCODE = '55000';\nEND;\n$function$\n","volatility":"v","return_type":"trigger","configuration":null,"extension_owned":false,"security_definer":false,"identity_arguments":""},"ddl":"CREATE OR REPLACE FUNCTION public.prevent_payroll_payslip_mutation()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$\nBEGIN\n  RAISE EXCEPTION 'Paid employee payslips are immutable'\n    USING ERRCODE = '55000';\nEND;\n$function$\n","stage":9,"phase":"F","id":"functions:public..prevent_payroll_payslip_mutation."},{"kind":"functions","expected":{"body":"\nBEGIN\n  RAISE EXCEPTION 'Settlement and payroll audit records are append-only'\n    USING ERRCODE = '55000';\nEND;\n","name":"prevent_settlement_payroll_audit_mutation","schema":"public","strict":false,"language":"plpgsql","parallel":"u","arguments":"","definition":"CREATE OR REPLACE FUNCTION public.prevent_settlement_payroll_audit_mutation()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$\nBEGIN\n  RAISE EXCEPTION 'Settlement and payroll audit records are append-only'\n    USING ERRCODE = '55000';\nEND;\n$function$\n","volatility":"v","return_type":"trigger","configuration":null,"extension_owned":false,"security_definer":false,"identity_arguments":""},"ddl":"CREATE OR REPLACE FUNCTION public.prevent_settlement_payroll_audit_mutation()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$\nBEGIN\n  RAISE EXCEPTION 'Settlement and payroll audit records are append-only'\n    USING ERRCODE = '55000';\nEND;\n$function$\n","stage":9,"phase":"F","id":"functions:public..prevent_settlement_payroll_audit_mutation."},{"kind":"functions","expected":{"body":"\nBEGIN\n  IF OLD.verification_metadata IS NOT NULL AND (\n    NEW.verification_evidence_ref IS DISTINCT FROM OLD.verification_evidence_ref\n    OR NEW.reviewer_notes IS DISTINCT FROM OLD.reviewer_notes\n    OR NEW.verification_metadata IS DISTINCT FROM OLD.verification_metadata\n    OR NEW.verified_by IS DISTINCT FROM OLD.verified_by\n    OR NEW.verified_at IS DISTINCT FROM OLD.verified_at\n  ) THEN\n    RAISE EXCEPTION 'verified payment metadata is immutable';\n  END IF;\n  RETURN NEW;\nEND;\n","name":"protect_fee_payment_verification_metadata","schema":"public","strict":false,"language":"plpgsql","parallel":"u","arguments":"","definition":"CREATE OR REPLACE FUNCTION public.protect_fee_payment_verification_metadata()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$\nBEGIN\n  IF OLD.verification_metadata IS NOT NULL AND (\n    NEW.verification_evidence_ref IS DISTINCT FROM OLD.verification_evidence_ref\n    OR NEW.reviewer_notes IS DISTINCT FROM OLD.reviewer_notes\n    OR NEW.verification_metadata IS DISTINCT FROM OLD.verification_metadata\n    OR NEW.verified_by IS DISTINCT FROM OLD.verified_by\n    OR NEW.verified_at IS DISTINCT FROM OLD.verified_at\n  ) THEN\n    RAISE EXCEPTION 'verified payment metadata is immutable';\n  END IF;\n  RETURN NEW;\nEND;\n$function$\n","volatility":"v","return_type":"trigger","configuration":null,"extension_owned":false,"security_definer":false,"identity_arguments":""},"ddl":"CREATE OR REPLACE FUNCTION public.protect_fee_payment_verification_metadata()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$\nBEGIN\n  IF OLD.verification_metadata IS NOT NULL AND (\n    NEW.verification_evidence_ref IS DISTINCT FROM OLD.verification_evidence_ref\n    OR NEW.reviewer_notes IS DISTINCT FROM OLD.reviewer_notes\n    OR NEW.verification_metadata IS DISTINCT FROM OLD.verification_metadata\n    OR NEW.verified_by IS DISTINCT FROM OLD.verified_by\n    OR NEW.verified_at IS DISTINCT FROM OLD.verified_at\n  ) THEN\n    RAISE EXCEPTION 'verified payment metadata is immutable';\n  END IF;\n  RETURN NEW;\nEND;\n$function$\n","stage":9,"phase":"F","id":"functions:public..protect_fee_payment_verification_metadata."},{"kind":"functions","expected":{"body":"\nBEGIN\n  RAISE EXCEPTION 'Staff NFC billing rules, allocations, and issued receipts are immutable';\nEND;\n","name":"protect_staff_nfc_financial_snapshots","schema":"public","strict":false,"language":"plpgsql","parallel":"u","arguments":"","definition":"CREATE OR REPLACE FUNCTION public.protect_staff_nfc_financial_snapshots()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$\nBEGIN\n  RAISE EXCEPTION 'Staff NFC billing rules, allocations, and issued receipts are immutable';\nEND;\n$function$\n","volatility":"v","return_type":"trigger","configuration":null,"extension_owned":false,"security_definer":false,"identity_arguments":""},"ddl":"CREATE OR REPLACE FUNCTION public.protect_staff_nfc_financial_snapshots()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$\nBEGIN\n  RAISE EXCEPTION 'Staff NFC billing rules, allocations, and issued receipts are immutable';\nEND;\n$function$\n","stage":9,"phase":"F","id":"functions:public..protect_staff_nfc_financial_snapshots."},{"kind":"functions","expected":{"body":"\nBEGIN\n  IF TG_OP = 'DELETE' THEN\n    RAISE EXCEPTION USING\n      ERRCODE = '55000',\n      MESSAGE = 'Staff NFC subscription financial and ownership snapshots are immutable';\n  END IF;\n\n  IF ROW(\n       NEW.id,NEW.employee_id,NEW.school_id,NEW.academic_session_id,NEW.academic_term_id,\n       NEW.product,NEW.billing_rule_id,NEW.billing_rule_version,NEW.price_minor,\n       NEW.school_share_minor,NEW.platform_share_minor,NEW.partner_share_minor,\n       NEW.partner_profile_id,NEW.attribution_id,NEW.currency,NEW.due_date,\n       NEW.created_by,NEW.created_at\n     ) IS DISTINCT FROM ROW(\n       OLD.id,OLD.employee_id,OLD.school_id,OLD.academic_session_id,OLD.academic_term_id,\n       OLD.product,OLD.billing_rule_id,OLD.billing_rule_version,OLD.price_minor,\n       OLD.school_share_minor,OLD.platform_share_minor,OLD.partner_share_minor,\n       OLD.partner_profile_id,OLD.attribution_id,OLD.currency,OLD.due_date,\n       OLD.created_by,OLD.created_at\n     ) THEN\n    RAISE EXCEPTION 'Staff NFC subscription financial and ownership snapshots are immutable';\n  END IF;\n  RETURN NEW;\nEND;\n","name":"protect_staff_nfc_subscription_snapshot","schema":"public","strict":false,"language":"plpgsql","parallel":"u","arguments":"","definition":"CREATE OR REPLACE FUNCTION public.protect_staff_nfc_subscription_snapshot()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$\nBEGIN\n  IF TG_OP = 'DELETE' THEN\n    RAISE EXCEPTION USING\n      ERRCODE = '55000',\n      MESSAGE = 'Staff NFC subscription financial and ownership snapshots are immutable';\n  END IF;\n\n  IF ROW(\n       NEW.id,NEW.employee_id,NEW.school_id,NEW.academic_session_id,NEW.academic_term_id,\n       NEW.product,NEW.billing_rule_id,NEW.billing_rule_version,NEW.price_minor,\n       NEW.school_share_minor,NEW.platform_share_minor,NEW.partner_share_minor,\n       NEW.partner_profile_id,NEW.attribution_id,NEW.currency,NEW.due_date,\n       NEW.created_by,NEW.created_at\n     ) IS DISTINCT FROM ROW(\n       OLD.id,OLD.employee_id,OLD.school_id,OLD.academic_session_id,OLD.academic_term_id,\n       OLD.product,OLD.billing_rule_id,OLD.billing_rule_version,OLD.price_minor,\n       OLD.school_share_minor,OLD.platform_share_minor,OLD.partner_share_minor,\n       OLD.partner_profile_id,OLD.attribution_id,OLD.currency,OLD.due_date,\n       OLD.created_by,OLD.created_at\n     ) THEN\n    RAISE EXCEPTION 'Staff NFC subscription financial and ownership snapshots are immutable';\n  END IF;\n  RETURN NEW;\nEND;\n$function$\n","volatility":"v","return_type":"trigger","configuration":null,"extension_owned":false,"security_definer":false,"identity_arguments":""},"ddl":"CREATE OR REPLACE FUNCTION public.protect_staff_nfc_subscription_snapshot()\n RETURNS trigger\n LANGUAGE plpgsql\nAS $function$\nBEGIN\n  IF TG_OP = 'DELETE' THEN\n    RAISE EXCEPTION USING\n      ERRCODE = '55000',\n      MESSAGE = 'Staff NFC subscription financial and ownership snapshots are immutable';\n  END IF;\n\n  IF ROW(\n       NEW.id,NEW.employee_id,NEW.school_id,NEW.academic_session_id,NEW.academic_term_id,\n       NEW.product,NEW.billing_rule_id,NEW.billing_rule_version,NEW.price_minor,\n       NEW.school_share_minor,NEW.platform_share_minor,NEW.partner_share_minor,\n       NEW.partner_profile_id,NEW.attribution_id,NEW.currency,NEW.due_date,\n       NEW.created_by,NEW.created_at\n     ) IS DISTINCT FROM ROW(\n       OLD.id,OLD.employee_id,OLD.school_id,OLD.academic_session_id,OLD.academic_term_id,\n       OLD.product,OLD.billing_rule_id,OLD.billing_rule_version,OLD.price_minor,\n       OLD.school_share_minor,OLD.platform_share_minor,OLD.partner_share_minor,\n       OLD.partner_profile_id,OLD.attribution_id,OLD.currency,OLD.due_date,\n       OLD.created_by,OLD.created_at\n     ) THEN\n    RAISE EXCEPTION 'Staff NFC subscription financial and ownership snapshots are immutable';\n  END IF;\n  RETURN NEW;\nEND;\n$function$\n","stage":9,"phase":"F","id":"functions:public..protect_staff_nfc_subscription_snapshot."}]$contracts$::jsonb) LOOP
  PERFORM pg_temp.edu2i_apply(spec->>'kind',spec);
 END LOOP;
END $migration$;
