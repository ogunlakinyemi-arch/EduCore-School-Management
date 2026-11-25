// OFFLINE COMPILER ONLY: no database, environment, network, subprocess or app imports.
// SQL files are review deliverables, not an installer or a Publish/build hook.
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFileSync,mkdirSync,writeFileSync} from "node:fs";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";

const root=fileURLToPath(new URL("../../",import.meta.url));
const hash=s=>createHash("sha256").update(s).digest("hex");
const sources={
 rules:"lib/db/drizzle/0175_owner_subscription_rule_management.sql",
 direct:"lib/db/drizzle/0176_direct_student_live_preparation.sql",
 reviews:"lib/db/drizzle/0177_direct_student_live_release_reviews.sql",
 bro:"lib/db/drizzle/0178_independent_bro_term_commissions.sql",
 repair:"lib/db/drizzle/0179_restore_direct_and_bro_guards.sql",
 pricing:"lib/db/drizzle/0180_version_split_amounts_check.sql",
 lifecycle:"lib/db/drizzle/0181_current_subscription_lifecycle.sql",
 extensions:"lib/db/drizzle/0182_current_bulk_withdrawals_field_sms.sql",
 free:"lib/db/drizzle/0183_owner_free_academic_terms.sql",
};
const ident="[a-z_][a-z_0-9]*";
const functionPattern=new RegExp(`CREATE (?:OR REPLACE )?FUNCTION (?:public\\.)?(${ident})\\(\\)\\s+RETURNS trigger\\s+LANGUAGE plpgsql AS \\$\\$([\\s\\S]*?)\\$\\$;`,"g");
const triggerPattern=new RegExp(`CREATE (?:OR REPLACE )?TRIGGER (${ident})\\s+BEFORE (INSERT|UPDATE OR DELETE(?: OR TRUNCATE)?)\\s+ON (?:public\\.)?(${ident})\\s+FOR EACH (ROW|STATEMENT) EXECUTE FUNCTION (?:public\\.)?(${ident})\\(\\);`,"g");
const bodyHash=s=>hash(s.replace(/\r\n/g,"\n").trim());
function functions(sql){
 return [...sql.matchAll(functionPattern)].map(m=>({name:m[1],body:m[2],sha256:bodyHash(m[2]),
  sql:`CREATE OR REPLACE FUNCTION public.${m[1]}() RETURNS trigger LANGUAGE plpgsql AS $$${m[2]}$$;`}));
}
function triggers(sql){
 return [...sql.matchAll(triggerPattern)].map(m=>({name:m[1],events:m[2],table:m[3],level:m[4],fn:m[5],
  type:2+(m[4]==="ROW"?1:0)+m[2].split(" OR ").reduce((n,e)=>n+({INSERT:4,DELETE:8,UPDATE:16,TRUNCATE:32}[e]),0)}));
}
const tableNames=sql=>[...sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?([a-z_0-9]+)/g)].map(m=>m[1]);
const jsonSQL=v=>`$inventory$${JSON.stringify(v)}$inventory$::jsonb`;
const fnRows=v=>`jsonb_to_recordset(${jsonSQL(v)}) AS e(name text,body_md5 text)`;
// Same execution-property contract as the existing financial guard inspector.
const fnMatch=`p.oid IS NOT NULL AND p.prokind='f' AND p.pronargs=0 AND p.prorettype='pg_catalog.trigger'::regtype
 AND NOT p.proretset AND NOT p.prosecdef AND p.provolatile='v' AND NOT p.proisstrict
 AND NOT p.proleakproof AND p.proparallel='u' AND p.proconfig IS NULL AND l.lanname='plpgsql'
 AND md5(regexp_replace(replace(p.prosrc,E'\\r\\n',E'\\n'),'^[[:space:]]+|[[:space:]]+$','','g'))=e.body_md5`;
const fnJoin=`LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.'||e.name||'()')
 LEFT JOIN pg_language l ON l.oid=p.prolang`;
function transaction(body){return `BEGIN;\nSET LOCAL lock_timeout='2s';\nSET LOCAL statement_timeout='30s';\nSET LOCAL search_path=public,pg_catalog;
DO $operator$ BEGIN
 IF current_user<>'neondb_owner' OR current_setting('server_version_num')::int<140000 THEN
 RAISE EXCEPTION 'Requires approved managed-database owner and PostgreSQL 14+; target identity still needs independent approval';
 END IF;
END $operator$;
${body}\nCOMMIT;\n`;}

export function compilePackage(read=path=>readFileSync(resolve(root,path),"utf8")){
 const text=Object.fromEntries(Object.entries(sources).map(([k,p])=>[k,read(p)]));
 const groups=[
  {id:"student",functions:functions(text.repair),triggers:triggers(text.repair),
   tables:["rules","direct","reviews","bro"].flatMap(k=>tableNames(text[k]))},
  {id:"current",functions:functions(text.extensions),triggers:[...triggers(text.lifecycle),...triggers(text.extensions)],
   tables:["lifecycle","extensions"].flatMap(k=>tableNames(text[k]))},
  {id:"free-terms",functions:functions(text.free),triggers:triggers(text.free),tables:tableNames(text.free)},
 ];
 // Expand only the reviewed history-trigger loop, not arbitrary procedural SQL.
 const loop=text.extensions.match(/FOREACH tab IN ARRAY ARRAY\[([\s\S]*?)\]\s+LOOP\s+EXECUTE format\('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_student_direct_history\(\)',\s*tab\|\|'_history',tab\);/);
 assert.ok(loop,"Reviewed extension history loop changed; manual review required");
 const historyTables=[...loop[1].matchAll(/'([a-z_0-9]+)'/g)].map(m=>m[1]);
 assert.equal(historyTables.length,12);
 groups[1].triggers.push(...historyTables.map(table=>({table,name:`${table}_history`,events:"UPDATE OR DELETE",level:"ROW",fn:"guard_student_direct_history",type:27})));
 assert.deepEqual(groups.map(g=>[g.functions.length,g.triggers.length,g.tables.length]),[[4,9,10],[1,17,15],[2,3,2]]);
 const allFunctions=groups.flatMap(g=>g.functions);
 assert.equal(new Set(allFunctions.map(f=>f.name)).size,7);
 // Financial body commitments remain byte-equivalent to the original approved DDL.
 const original=["direct","bro"].flatMap(k=>functions(text[k]));
 for(const f of groups[0].functions)assert.equal(f.sha256,original.find(o=>o.name===f.name)?.sha256);
 const files={};
 const banner=`-- REVIEW PACKAGE ONLY. NOT EXECUTED OR CONNECTED BY THIS TOOL.\n-- Separate target, recovery, SQL-console and publication approval required.\n-- Functions/triggers only; structural tables use the reviewed Publish flow.\n-- PostgreSQL 14+; keep release/send gates closed. Never run at startup/build.\n`;
 const manifest={format:1,authority:"REVIEW_ONLY_NO_EXECUTION_AUTHORIZED",
  sources:Object.entries(sources).map(([key,path])=>({key,path,sha256:hash(text[key])})),groups:[]};
 for(const g of groups){
  const prefix=`db/production-activation/${g.id}`;
  files[`${prefix}.functions.sql`]=banner+transaction(g.functions.map(f=>f.sql).join("\n"));
  const requiredFunctions=[...new Set(g.triggers.map(t=>t.fn))].map(name=>{
   const f=allFunctions.find(f=>f.name===name);assert.ok(f);
   return{name,body_md5:createHash("md5").update(f.body.replace(/\r\n/g,"\n").trim()).digest("hex")};
  });
  const preflight=`DO $preflight$ BEGIN
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(${jsonSQL([...new Set(g.triggers.map(t=>t.table))])}) n(name)
   WHERE to_regclass('public.'||name) IS NULL) THEN RAISE EXCEPTION 'Required structural tables missing; no triggers changed'; END IF;
 IF EXISTS(SELECT 1 FROM ${fnRows(requiredFunctions)} ${fnJoin}
   WHERE NOT COALESCE((${fnMatch}),false)) THEN RAISE EXCEPTION 'Approved function body/properties missing; no triggers changed'; END IF;
 END $preflight$;`;
  files[`${prefix}.triggers.sql`]=banner+transaction(preflight+"\n"+g.triggers.map(t=>
   `CREATE OR REPLACE TRIGGER ${t.name} BEFORE ${t.events} ON public.${t.table} FOR EACH ${t.level} EXECUTE FUNCTION public.${t.fn}();\nALTER TABLE public.${t.table} ENABLE TRIGGER ${t.name};`).join("\n"));
  manifest.groups.push({id:g.id,tables:g.tables,functions:g.functions.map(f=>({name:f.name,bodySha256:f.sha256})),triggers:g.triggers});
  // SELECT-only: presence is deliberately not labelled full structural parity.
  files[`${prefix}.verify.sql`]=`-- READ ONLY. Table rows prove presence only, not CHECK/FK/index/column parity.
SELECT 'table_presence' AS kind,name,to_regclass('public.'||name) IS NOT NULL AS matches
 FROM jsonb_array_elements_text(${jsonSQL(g.tables)}) n(name)
UNION ALL SELECT 'function',e.name,COALESCE((${fnMatch}),false)
  FROM ${fnRows(requiredFunctions)} ${fnJoin}
UNION ALL SELECT 'trigger',e.name,COALESCE(t.tgenabled='O' AND t.tgtype=e.type
 AND t.tgfoid=to_regprocedure('public.'||e.fn||'()') AND NOT t.tgisinternal
 AND t.tgnargs=0 AND t.tgconstraint=0 AND t.tgqual IS NULL AND t.tgattr::text='' AND t.tgparentid=0,false)
 FROM jsonb_to_recordset(${jsonSQL(g.triggers)}) e(name text,"table" text,fn text,type int)
 LEFT JOIN pg_trigger t ON t.tgrelid=to_regclass('public.'||e."table") AND t.tgname=e.name
ORDER BY kind,name;
`;
 }
 files["db/production-activation/capture-definitions.sql"]=`-- READ ONLY. Object-definition evidence, NOT a database/data backup.
SELECT 'function' AS kind,p.proname AS name,pg_get_userbyid(p.proowner) AS owner,
 pg_get_functiondef(p.oid) AS definition,NULL::text AS enablement
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.pronargs=0
 AND p.proname=ANY(ARRAY[${allFunctions.map(f=>`'${f.name}'`).join(",")}])
UNION ALL
SELECT 'trigger',c.relname||'.'||t.tgname,pg_get_userbyid(c.relowner),
 pg_get_triggerdef(t.oid),t.tgenabled::text
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
 JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND NOT t.tgisinternal
 AND t.tgname=ANY(ARRAY[${groups.flatMap(g=>g.triggers).map(t=>`'${t.name}'`).join(",")}])
ORDER BY kind,name;
`;
 manifest.files=Object.entries(files).map(([path,content])=>({path,sha256:hash(content)}));
 files["db/production-activation/manifest.json"]=JSON.stringify(manifest,null,2)+"\n";
 return{files,manifest};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.ok(process.argv.length===3&&["--check","--write"].includes(process.argv[2]),"Use --check or --write; no database targets accepted");
 const {files}=compilePackage();
 for(const [path,content]of Object.entries(files)){
  if(process.argv[2]==="--check")assert.equal(readFileSync(resolve(root,path),"utf8"),content,`Stale review artifact: ${path}`);
  else{mkdirSync(dirname(resolve(root,path)),{recursive:true});writeFileSync(resolve(root,path),content);}
 }
 console.log(`${Object.keys(files).length} review files ${process.argv[2]==="--check"?"match unchanged source":"written"}; no SQL executed.`);
}
