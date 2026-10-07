-- Stage 2I source-only; NOT journal-registered or authorized for shared execution.
-- table_shells, phase E. Depends on preceding structural tier; see reports/schema-2i/manifest.json.
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
 FOR spec IN SELECT value FROM jsonb_array_elements($contracts$[{"kind":"tables","expected":{"kind":"r","name":"academic_result_batches","schema":"public","inherited":false,"persistence":"p"},"ddl":"CREATE TABLE public.\"academic_result_batches\" (\"id\" integer DEFAULT nextval('academic_result_batches_id_seq'::regclass) NOT NULL, \"school_id\" integer NOT NULL, \"academic_session_id\" integer NOT NULL, \"academic_term_id\" integer NOT NULL, \"school_class_id\" integer NOT NULL, \"section\" text DEFAULT ''::text NOT NULL, \"subject_id\" integer NOT NULL, \"teacher_employee_id\" integer NOT NULL, \"components\" jsonb DEFAULT '[]'::jsonb NOT NULL, \"status\" text DEFAULT 'DRAFT'::text NOT NULL, \"revision\" integer DEFAULT 0 NOT NULL, \"return_comment\" text, \"created_by\" integer NOT NULL, \"submitted_at\" timestamp with time zone, \"created_at\" timestamp with time zone DEFAULT now() NOT NULL, \"updated_at\" timestamp with time zone DEFAULT now() NOT NULL)","stage":2,"phase":"E","id":"tables:public..academic_result_batches."},{"kind":"tables","expected":{"kind":"r","name":"academic_results","schema":"public","inherited":false,"persistence":"p"},"ddl":"CREATE TABLE public.\"academic_results\" (\"id\" integer DEFAULT nextval('academic_results_id_seq'::regclass) NOT NULL, \"school_id\" integer NOT NULL, \"assessment_id\" integer NOT NULL, \"student_id\" integer NOT NULL, \"student_class_assignment_id\" integer NOT NULL, \"teacher_employee_id\" integer NOT NULL, \"academic_session_id\" integer NOT NULL, \"academic_term_id\" integer NOT NULL, \"school_class_id\" integer NOT NULL, \"section_snapshot\" text NOT NULL, \"subject_id\" integer NOT NULL, \"score\" numeric(10,2) NOT NULL, \"max_score\" numeric(10,2) NOT NULL, \"grade\" text, \"grade_point\" numeric(5,2), \"remark\" text, \"status\" text DEFAULT 'DRAFT'::text NOT NULL, \"created_by\" integer NOT NULL, \"published_by\" integer, \"published_at\" timestamp with time zone, \"created_at\" timestamp with time zone DEFAULT now() NOT NULL, \"updated_at\" timestamp with time zone DEFAULT now() NOT NULL, \"review_status\" text DEFAULT 'NOT_REVIEWED'::text NOT NULL, \"review_comment\" text, \"reviewed_by\" integer, \"reviewed_at\" timestamp with time zone)","stage":2,"phase":"E","id":"tables:public..academic_results."},{"kind":"tables","expected":{"kind":"r","name":"curriculum_imports","schema":"public","inherited":false,"persistence":"p"},"ddl":"CREATE TABLE public.\"curriculum_imports\" (\"id\" integer DEFAULT nextval('curriculum_imports_id_seq'::regclass) NOT NULL, \"uploaded_by\" integer NOT NULL, \"filename\" text NOT NULL, \"content_type\" text NOT NULL, \"object_path\" text NOT NULL, \"detected_type\" text NOT NULL, \"preview_rows\" jsonb NOT NULL, \"headers\" jsonb NOT NULL, \"created_at\" timestamp with time zone DEFAULT now() NOT NULL, \"confirmed_version_id\" integer)","stage":2,"phase":"E","id":"tables:public..curriculum_imports."},{"kind":"tables","expected":{"kind":"r","name":"curriculum_progress","schema":"public","inherited":false,"persistence":"p"},"ddl":"CREATE TABLE public.\"curriculum_progress\" (\"id\" integer DEFAULT nextval('curriculum_progress_id_seq'::regclass) NOT NULL, \"school_id\" integer NOT NULL, \"mapping_id\" integer NOT NULL, \"topic_id\" integer NOT NULL, \"progress_status\" text NOT NULL, \"completed_date\" date, \"comment\" text, \"updated_by\" integer NOT NULL, \"updated_at\" timestamp with time zone DEFAULT now() NOT NULL)","stage":2,"phase":"E","id":"tables:public..curriculum_progress."},{"kind":"tables","expected":{"kind":"r","name":"curriculum_topics","schema":"public","inherited":false,"persistence":"p"},"ddl":"CREATE TABLE public.\"curriculum_topics\" (\"id\" integer DEFAULT nextval('curriculum_topics_id_seq'::regclass) NOT NULL, \"curriculum_version_id\" integer, \"school_id\" integer, \"mapping_id\" integer, \"class_level\" text NOT NULL, \"subject_code\" text NOT NULL, \"parent_topic_id\" integer, \"title\" text NOT NULL, \"learning_objectives\" jsonb DEFAULT '[]'::jsonb NOT NULL, \"learning_outcomes\" jsonb DEFAULT '[]'::jsonb NOT NULL, \"suggested_resources\" jsonb DEFAULT '[]'::jsonb NOT NULL, \"source_kind\" text NOT NULL, \"sequence_order\" integer DEFAULT 0 NOT NULL, \"created_at\" timestamp with time zone DEFAULT now() NOT NULL)","stage":2,"phase":"E","id":"tables:public..curriculum_topics."},{"kind":"tables","expected":{"kind":"r","name":"curriculum_versions","schema":"public","inherited":false,"persistence":"p"},"ddl":"CREATE TABLE public.\"curriculum_versions\" (\"id\" integer DEFAULT nextval('curriculum_versions_id_seq'::regclass) NOT NULL, \"title\" text NOT NULL, \"education_level\" text NOT NULL, \"class_levels\" jsonb DEFAULT '[]'::jsonb NOT NULL, \"subject_codes\" jsonb DEFAULT '[]'::jsonb NOT NULL, \"source_kind\" text NOT NULL, \"source_organization\" text NOT NULL, \"source_reference\" text NOT NULL, \"source_version\" text, \"effective_date\" date, \"verified_date\" date, \"description\" text, \"source_document_path\" text, \"derived_from_version_id\" integer, \"status\" text DEFAULT 'DRAFT'::text NOT NULL, \"created_by\" integer NOT NULL, \"created_at\" timestamp with time zone DEFAULT now() NOT NULL, \"published_at\" timestamp with time zone, \"archived_at\" timestamp with time zone)","stage":2,"phase":"E","id":"tables:public..curriculum_versions."},{"kind":"tables","expected":{"kind":"r","name":"exam_question_papers","schema":"public","inherited":false,"persistence":"p"},"ddl":"CREATE TABLE public.\"exam_question_papers\" (\"id\" integer DEFAULT nextval('exam_question_papers_id_seq'::regclass) NOT NULL, \"school_id\" integer NOT NULL, \"academic_session_id\" integer NOT NULL, \"academic_term_id\" integer NOT NULL, \"school_class_id\" integer NOT NULL, \"section\" text DEFAULT ''::text NOT NULL, \"subject_id\" integer NOT NULL, \"teacher_employee_id\" integer NOT NULL, \"examination_name\" text NOT NULL, \"instructions\" text DEFAULT ''::text NOT NULL, \"duration\" text, \"total_marks\" numeric(10,2), \"status\" text DEFAULT 'DRAFT'::text NOT NULL, \"revision\" integer DEFAULT 0 NOT NULL, \"submitted_at\" timestamp with time zone, \"approved_at\" timestamp with time zone, \"created_by\" integer NOT NULL, \"created_at\" timestamp with time zone DEFAULT now() NOT NULL, \"updated_at\" timestamp with time zone DEFAULT now() NOT NULL)","stage":2,"phase":"E","id":"tables:public..exam_question_papers."},{"kind":"tables","expected":{"kind":"r","name":"exam_question_reviews","schema":"public","inherited":false,"persistence":"p"},"ddl":"CREATE TABLE public.\"exam_question_reviews\" (\"id\" integer DEFAULT nextval('exam_question_reviews_id_seq'::regclass) NOT NULL, \"school_id\" integer NOT NULL, \"paper_id\" integer NOT NULL, \"version_id\" integer NOT NULL, \"reviewer_user_id\" integer NOT NULL, \"decision\" text NOT NULL, \"comment\" text DEFAULT ''::text NOT NULL, \"created_at\" timestamp with time zone DEFAULT now() NOT NULL)","stage":2,"phase":"E","id":"tables:public..exam_question_reviews."},{"kind":"tables","expected":{"kind":"r","name":"exam_question_versions","schema":"public","inherited":false,"persistence":"p"},"ddl":"CREATE TABLE public.\"exam_question_versions\" (\"id\" integer DEFAULT nextval('exam_question_versions_id_seq'::regclass) NOT NULL, \"school_id\" integer NOT NULL, \"paper_id\" integer NOT NULL, \"revision\" integer NOT NULL, \"filename\" text NOT NULL, \"mime_type\" text NOT NULL, \"object_path\" text NOT NULL, \"sha256\" text NOT NULL, \"preview_text\" text DEFAULT ''::text NOT NULL, \"created_by\" integer NOT NULL, \"created_at\" timestamp with time zone DEFAULT now() NOT NULL)","stage":2,"phase":"E","id":"tables:public..exam_question_versions."},{"kind":"tables","expected":{"kind":"r","name":"lesson_note_documents","schema":"public","inherited":false,"persistence":"p"},"ddl":"CREATE TABLE public.\"lesson_note_documents\" (\"id\" integer DEFAULT nextval('lesson_note_documents_id_seq'::regclass) NOT NULL, \"school_id\" integer NOT NULL, \"lesson_note_id\" integer NOT NULL, \"note_revision\" integer NOT NULL, \"filename\" text NOT NULL, \"byte_size\" integer NOT NULL, \"staging_path\" text NOT NULL, \"object_path\" text NOT NULL, \"sha256\" text, \"context\" jsonb NOT NULL, \"status\" text DEFAULT 'PENDING'::text NOT NULL, \"uploaded_by\" integer NOT NULL, \"expires_at\" timestamp with time zone NOT NULL, \"created_at\" timestamp with time zone DEFAULT now() NOT NULL, \"ready_at\" timestamp with time zone)","stage":2,"phase":"E","id":"tables:public..lesson_note_documents."},{"kind":"tables","expected":{"kind":"r","name":"lesson_note_reviews","schema":"public","inherited":false,"persistence":"p"},"ddl":"CREATE TABLE public.\"lesson_note_reviews\" (\"id\" integer DEFAULT nextval('lesson_note_reviews_id_seq'::regclass) NOT NULL, \"school_id\" integer NOT NULL, \"lesson_note_id\" integer NOT NULL, \"reviewer_user_id\" integer NOT NULL, \"decision\" text NOT NULL, \"comment\" text, \"note_revision\" integer NOT NULL, \"created_at\" timestamp with time zone DEFAULT now() NOT NULL)","stage":2,"phase":"E","id":"tables:public..lesson_note_reviews."},{"kind":"tables","expected":{"kind":"r","name":"lesson_notes","schema":"public","inherited":false,"persistence":"p"},"ddl":"CREATE TABLE public.\"lesson_notes\" (\"id\" integer DEFAULT nextval('lesson_notes_id_seq'::regclass) NOT NULL, \"school_id\" integer NOT NULL, \"academic_session_id\" integer NOT NULL, \"academic_term_id\" integer NOT NULL, \"school_class_id\" integer NOT NULL, \"subject_id\" integer NOT NULL, \"teacher_employee_id\" integer NOT NULL, \"section\" text, \"week\" integer NOT NULL, \"lesson_date\" date NOT NULL, \"curriculum_mapping_id\" integer, \"curriculum_version_id\" integer, \"topic_id\" integer, \"sub_topic_id\" integer, \"content\" jsonb DEFAULT '{}'::jsonb NOT NULL, \"status\" text DEFAULT 'DRAFT'::text NOT NULL, \"revision\" integer DEFAULT 0 NOT NULL, \"created_by\" integer NOT NULL, \"submitted_at\" timestamp with time zone, \"approved_at\" timestamp with time zone, \"created_at\" timestamp with time zone DEFAULT now() NOT NULL, \"updated_at\" timestamp with time zone DEFAULT now() NOT NULL)","stage":2,"phase":"E","id":"tables:public..lesson_notes."},{"kind":"tables","expected":{"kind":"r","name":"promotion_batch_students","schema":"public","inherited":false,"persistence":"p"},"ddl":"CREATE TABLE public.\"promotion_batch_students\" (\"id\" integer DEFAULT nextval('promotion_batch_students_id_seq'::regclass) NOT NULL, \"school_id\" integer NOT NULL, \"batch_id\" integer NOT NULL, \"student_id\" integer NOT NULL, \"student_name_snapshot\" text NOT NULL, \"admission_no_snapshot\" text NOT NULL, \"source_assignment_id\" integer NOT NULL, \"source_session_id\" integer NOT NULL, \"source_term_id\" integer, \"source_class_id\" integer NOT NULL, \"source_class_name\" text NOT NULL, \"source_section\" text NOT NULL, \"recommendation\" text NOT NULL, \"status\" text DEFAULT 'Pending'::text NOT NULL, \"reason\" text, \"academic_performance\" jsonb NOT NULL, \"attendance_summary\" jsonb NOT NULL, \"target_term_id\" integer, \"target_class_id\" integer, \"target_section\" text, \"reviewed_by\" integer, \"reviewed_at\" timestamp with time zone, \"finalized_at\" timestamp with time zone, \"created_at\" timestamp with time zone DEFAULT now() NOT NULL)","stage":2,"phase":"E","id":"tables:public..promotion_batch_students."},{"kind":"tables","expected":{"kind":"r","name":"promotion_batches","schema":"public","inherited":false,"persistence":"p"},"ddl":"CREATE TABLE public.\"promotion_batches\" (\"id\" integer DEFAULT nextval('promotion_batches_id_seq'::regclass) NOT NULL, \"school_id\" integer NOT NULL, \"source_session_id\" integer NOT NULL, \"target_session_id\" integer NOT NULL, \"status\" text DEFAULT 'PREPARED'::text NOT NULL, \"idempotency_actor_user_id\" integer NOT NULL, \"idempotency_key\" text NOT NULL, \"prepared_by\" integer NOT NULL, \"created_at\" timestamp with time zone DEFAULT now() NOT NULL, \"finalized_by\" integer, \"finalized_at\" timestamp with time zone, \"finalization_actor_user_id\" integer, \"finalization_idempotency_key\" text)","stage":2,"phase":"E","id":"tables:public..promotion_batches."},{"kind":"tables","expected":{"kind":"r","name":"promotion_history","schema":"public","inherited":false,"persistence":"p"},"ddl":"CREATE TABLE public.\"promotion_history\" (\"id\" integer DEFAULT nextval('promotion_history_id_seq'::regclass) NOT NULL, \"school_id\" integer NOT NULL, \"batch_id\" integer, \"batch_student_id\" integer, \"student_id\" integer, \"actor_user_id\" integer, \"event_type\" text NOT NULL, \"result\" text NOT NULL, \"metadata\" jsonb DEFAULT '{}'::jsonb NOT NULL, \"created_at\" timestamp with time zone DEFAULT now() NOT NULL)","stage":2,"phase":"E","id":"tables:public..promotion_history."},{"kind":"tables","expected":{"kind":"r","name":"school_curriculum_assignments","schema":"public","inherited":false,"persistence":"p"},"ddl":"CREATE TABLE public.\"school_curriculum_assignments\" (\"id\" integer DEFAULT nextval('school_curriculum_assignments_id_seq'::regclass) NOT NULL, \"school_id\" integer NOT NULL, \"curriculum_version_id\" integer NOT NULL, \"school_class_id\" integer NOT NULL, \"subject_id\" integer NOT NULL, \"academic_session_id\" integer NOT NULL, \"academic_term_id\" integer NOT NULL, \"status\" text DEFAULT 'ACTIVE'::text NOT NULL, \"confirmed_by\" integer NOT NULL, \"confirmed_at\" timestamp with time zone DEFAULT now() NOT NULL)","stage":2,"phase":"E","id":"tables:public..school_curriculum_assignments."}]$contracts$::jsonb) LOOP
  PERFORM pg_temp.edu2i_apply(spec->>'kind',spec);
 END LOOP;
END $migration$;
