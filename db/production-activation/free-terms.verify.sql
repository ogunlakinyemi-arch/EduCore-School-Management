-- READ ONLY. Table rows prove presence only, not CHECK/FK/index/column parity.
SELECT 'table_presence' AS kind,name,to_regclass('public.'||name) IS NOT NULL AS matches
 FROM jsonb_array_elements_text($inventory$["owner_free_academic_terms","owner_free_academic_term_events"]$inventory$::jsonb) n(name)
UNION ALL SELECT 'function',e.name,COALESCE((p.oid IS NOT NULL AND p.prokind='f' AND p.pronargs=0 AND p.prorettype='pg_catalog.trigger'::regtype
 AND NOT p.proretset AND NOT p.prosecdef AND p.provolatile='v' AND NOT p.proisstrict
 AND NOT p.proleakproof AND p.proparallel='u' AND p.proconfig IS NULL AND l.lanname='plpgsql'
 AND md5(regexp_replace(replace(p.prosrc,E'\r\n',E'\n'),'^[[:space:]]+|[[:space:]]+$','','g'))=e.body_md5),false)
  FROM jsonb_to_recordset($inventory$[{"name":"reject_free_term_evidence_mutation","body_md5":"4f1dcd3c37f119ee7a85198a96642cbe"},{"name":"validate_free_term_scope","body_md5":"d7d8cef9df3aebc60bde104d87215988"}]$inventory$::jsonb) AS e(name text,body_md5 text) LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.'||e.name||'()')
 LEFT JOIN pg_language l ON l.oid=p.prolang
UNION ALL SELECT 'trigger',e.name,COALESCE(t.tgenabled='O' AND t.tgtype=e.type
 AND t.tgfoid=to_regprocedure('public.'||e.fn||'()') AND NOT t.tgisinternal
 AND t.tgnargs=0 AND t.tgconstraint=0 AND t.tgqual IS NULL AND t.tgattr::text='' AND t.tgparentid=0,false)
 FROM jsonb_to_recordset($inventory$[{"name":"owner_free_terms_immutable","events":"UPDATE OR DELETE OR TRUNCATE","table":"owner_free_academic_terms","level":"STATEMENT","fn":"reject_free_term_evidence_mutation","type":58},{"name":"owner_free_term_events_immutable","events":"UPDATE OR DELETE OR TRUNCATE","table":"owner_free_academic_term_events","level":"STATEMENT","fn":"reject_free_term_evidence_mutation","type":58},{"name":"owner_free_terms_scope","events":"INSERT","table":"owner_free_academic_terms","level":"ROW","fn":"validate_free_term_scope","type":7}]$inventory$::jsonb) e(name text,"table" text,fn text,type int)
 LEFT JOIN pg_trigger t ON t.tgrelid=to_regclass('public.'||e."table") AND t.tgname=e.name
ORDER BY kind,name;
