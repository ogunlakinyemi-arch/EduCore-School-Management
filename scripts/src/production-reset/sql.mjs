import { CANDIDATE_TABLES, MANIFEST_VERSION, schoolIds } from "./manifest.mjs";

// Prints a SELECT only. Never sent to a database by this tool. Identifiers come
// from pg_catalog; the only supplied SQL literals are validated positive IDs.
export function preflightSql(input) {
  const ids = schoolIds(input).join(",");
  const names = CANDIDATE_TABLES.map(name => `'${name}'`).join(",");
  return `-- ${MANIFEST_VERSION}: operator-run READ-ONLY evidence, not primary/backup certification.
-- Use an independently identified Production target. A replica result is blocked.
-- Run in a read-only transaction with an operator-approved statement timeout.
WITH
catalog AS (
 SELECT c.oid,c.relname AS name,
   EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid
     AND a.attname='school_id' AND NOT a.attisdropped) AS scoped,
   (c.relname IN (${names})) AS candidate
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p')
),
scopes AS (
 SELECT *, CASE WHEN name='schools' THEN 't.id IN (${ids})'
   WHEN scoped THEN 't.school_id IN (${ids})' ELSE 'false' END AS predicate
 FROM catalog
),
measured AS MATERIALIZED (
 SELECT *,query_to_xml(format(
   'SELECT count(*)::bigint AS total_rows, count(*) FILTER(WHERE %s)::bigint AS selected_rows, md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'''' ORDER BY md5(to_jsonb(t)::text)),'''')) AS fingerprint, md5(COALESCE(string_agg(md5(to_jsonb(t)::text),'''' ORDER BY md5(to_jsonb(t)::text)) FILTER(WHERE (%s) IS NOT TRUE),'''')) AS outside_scope_fingerprint FROM public.%I t',
   predicate,predicate,name),false,false,'') AS x FROM scopes
),
fks AS (
 SELECT k.oid,k.conname,k.convalidated,c.name AS child,p.name AS parent,
   c.candidate AS child_candidate,p.candidate AS parent_candidate,
   c.scoped AS child_scoped,c.predicate AS child_predicate,p.predicate AS parent_predicate,
   k.confdeltype,
   (SELECT string_agg(format('c.%I=p.%I',ca.attname,pa.attname),' AND ' ORDER BY keys.ord)
    FROM unnest(k.conkey,k.confkey) WITH ORDINALITY keys(ck,pk,ord)
    JOIN pg_attribute ca ON ca.attrelid=k.conrelid AND ca.attnum=keys.ck
    JOIN pg_attribute pa ON pa.attrelid=k.confrelid AND pa.attnum=keys.pk) AS join_predicate,
   (SELECT string_agg(format('c.%I IS NOT NULL',ca.attname),' AND ' ORDER BY keys.ord)
    FROM unnest(k.conkey) WITH ORDINALITY keys(ck,ord)
    JOIN pg_attribute ca ON ca.attrelid=k.conrelid AND ca.attnum=keys.ck) AS nonnull_predicate
 FROM pg_constraint k JOIN scopes c ON c.oid=k.conrelid JOIN scopes p ON p.oid=k.confrelid
 WHERE k.contype='f'
),
fk_measured AS MATERIALIZED (
 SELECT *,query_to_xml(format(
   'SELECT count(*)::bigint AS orphan_rows FROM public.%I c WHERE %s AND NOT EXISTS(SELECT 1 FROM public.%I p WHERE %s)',
   child,nonnull_predicate,parent,join_predicate),false,false,'') AS integrity,
   query_to_xml(format(
   'SELECT count(*)::bigint AS retained_referencing_rows FROM public.%I c JOIN public.%I p ON %s WHERE (%s) AND (%s) IS NOT TRUE',
   child,parent,join_predicate,replace(parent_predicate,'t.','p.'),
   CASE WHEN child_candidate AND (child_scoped OR child='schools')
     THEN replace(child_predicate,'t.','c.') ELSE 'false' END),false,false,'') AS retained
 FROM fks
)
SELECT jsonb_build_object(
 'environment','production',
 'manifestVersion','${MANIFEST_VERSION}',
 'selectedSchoolIds',jsonb_build_array(${ids}),
 'observedAt',now(),
 'identity',jsonb_build_object(
   'database',current_database(),'databaseOid',(SELECT oid FROM pg_database WHERE datname=current_database()),
   'role',current_user,'serverAddress',inet_server_addr(),'serverPort',inet_server_port(),
   'inRecovery',pg_is_in_recovery(),'transactionReadOnly',current_setting('transaction_read_only'),
   'defaultTransactionReadOnly',current_setting('default_transaction_read_only'),
   'serverStartedAt',pg_postmaster_start_time()),
 'primaryBinding',jsonb_build_object('verified',false),
 'backup',jsonb_build_object('verified',false,'restoreDrillVerified',false),
 'connectionHealth',jsonb_build_object('verified',false),
 'ownerAccess',jsonb_build_object(
   'activeOwners',(SELECT count(*) FROM public.school_memberships m JOIN public.app_users u ON u.id=m.user_id
     WHERE m.role='PLATFORM_OWNER' AND m.school_id IS NULL AND m.status='ACTIVE' AND u.status='ACTIVE'
       AND length(u.clerk_user_id)>0)),
 'tables',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'name',name,'scopeSupported',scoped OR name='schools',
   'totalRows',((xpath('/table/row/total_rows/text()',x))[1]::text)::bigint,
   'selectedRows',CASE WHEN scoped OR name='schools'
     THEN ((xpath('/table/row/selected_rows/text()',x))[1]::text)::bigint ELSE NULL END,
   'fingerprint',(xpath('/table/row/fingerprint/text()',x))[1]::text,
   'outsideScopeFingerprint',(xpath('/table/row/outside_scope_fingerprint/text()',x))[1]::text) ORDER BY name)
   FROM measured),'[]'::jsonb),
 'unsupportedForeignKeys',(SELECT count(*) FROM pg_constraint k
   JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace cn ON cn.oid=c.relnamespace
   JOIN pg_class p ON p.oid=k.confrelid JOIN pg_namespace pn ON pn.oid=p.relnamespace
   WHERE k.contype='f' AND (cn.nspname='public' OR pn.nspname='public') AND cn.nspname<>pn.nspname),
 'foreignKeys',COALESCE((SELECT jsonb_agg(jsonb_build_object(
   'name',conname,'child',child,'parent',parent,'validated',convalidated,'onDelete',confdeltype,
   'orphanRows',((xpath('/table/row/orphan_rows/text()',integrity))[1]::text)::bigint,
   'retainedReferencingRows',CASE WHEN parent_candidate
     THEN ((xpath('/table/row/retained_referencing_rows/text()',retained))[1]::text)::bigint ELSE 0 END)
   ORDER BY conname) FROM fk_measured),'[]'::jsonb),
 'schemaFingerprint',(SELECT md5(string_agg(definition,E'\\n' ORDER BY definition)) FROM (
   SELECT to_jsonb(cols)::text AS definition
     FROM information_schema.columns cols WHERE table_schema IN ('public','_system')
   UNION ALL SELECT format('%s:%s:%s:%s',conrelid::regclass,conname,convalidated,pg_get_constraintdef(oid))
     FROM pg_constraint WHERE connamespace='public'::regnamespace
   UNION ALL SELECT indexdef FROM pg_indexes WHERE schemaname IN ('public','_system')
   UNION ALL SELECT format('%s:%s',viewname,definition) FROM pg_views WHERE schemaname='public'
   UNION ALL SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t JOIN catalog c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal
   UNION ALL SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.prokind IN ('f','p')
   UNION ALL SELECT format('%s:%s:%s:%s:%s:%s:%s',schemaname,sequencename,data_type,start_value,min_value,max_value,increment_by)
     FROM pg_sequences WHERE schemaname IN ('public','_system')
 ) definitions),
 'migrationFingerprint',(SELECT md5(COALESCE(string_agg(md5(to_jsonb(m)::text),'' ORDER BY md5(to_jsonb(m)::text)),''))
   FROM _system.replit_database_migrations_v1 m)
) AS production_reset_preflight;
`;
}
