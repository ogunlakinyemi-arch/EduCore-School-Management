// Offline forward-DDL compiler. Never imports the application's database client.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
const out="reports/schema-2i";
await fs.mkdir(out,{recursive:true});
const read=async p=>JSON.parse(await fs.readFile(p,"utf8"));
const e=await read("reports/schema-2h/canonical-catalog.json");
const baseline=await read("reports/schema-2h/production-catalog.json");
const comparison=await read("reports/schema-2h/comparison.json");
const graph=await read("reports/schema-2h/dependency-graph.json");
const normalized=await read("reports/schema-2i/check-expression-reparse.json").catch(()=>[]);
const prior=await read(out+"/manifest.json").catch(()=>null);
const journal=await read("lib/db/drizzle/meta/_journal.json");
const hash=v=>createHash("sha256").update(v).digest("hex");
const q=v=>'"'+v.replaceAll('"','""')+'"', lit=v=>"'"+v.replaceAll("'","''")+"'";
const table=r=>"public."+q(r.table_name??r.name);
const existing=(await fs.readdir("lib/db/drizzle")).filter(n=>/^\d{4}.*\.sql$/.test(n)).sort();
const history=existing.filter(n=>Number(n.slice(0,4))<=60);
assert.equal(history.length,61);
let next=61; // Verified below, not assumed from attachment.
assert.equal(Math.max(...history.map(n=>Number(n.slice(0,4))))+1,next);
const original=Object.fromEntries(await Promise.all(history.map(async n=>[n,hash(await fs.readFile("lib/db/drizzle/"+n))])));
assert.equal(original["0060_reconcile_student_subscription_finance.sql"],"a827ad709347eaa22b9bf70a4c2a4012f2c2bd86c5ba3d624623710f98d41f57");
const financeTables=new Set(["student_subscription_payments","student_subscription_allocations"]);
const financeFns=new Set(["protect_student_subscription_allocations","protect_student_subscription_receipt_snapshot"]);
const financeObject=(kind,r)=>financeTables.has(r.table_name??(kind==="tables"?r.name:""))||
 kind==="functions"&&financeFns.has(r.name);
const catalogText=await fs.readFile("scripts/audits/schema-2h-catalog.sql","utf8");
const parts=catalogText.split(/-- @([a-z]+)\n/),sqls={};
for(let i=1;i<parts.length;i+=2)sqls[parts[i]]=parts[i+1].trim().replace(/;$/,"");
const scopeField={tables:"c.relname",columns:"c.relname",constraints:"t.relname",indexes:"t.relname",functions:"p.proname",triggers:"c.relname",sequences:"c.relname"};
// Temporary helpers are session-local, not application objects or persistent DDL hooks.
const kernel=`
CREATE OR REPLACE FUNCTION pg_temp.edu2i_catalog(section text, scope text)
RETURNS jsonb LANGUAGE plpgsql AS $catalog$
BEGIN
${Object.entries(sqls).map(([k,s])=>`IF section=${lit(k)} THEN RETURN (${s.replace("WHERE n.nspname='public'",`WHERE ${scopeField[k]}=scope AND n.nspname='public'`)}); END IF;`).join("\n")}
RAISE EXCEPTION '2I: unknown catalog section %',section;
END $catalog$;
CREATE OR REPLACE FUNCTION pg_temp.edu2i_signature(section text,r jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $sig$
DECLARE names text[]; result jsonb;
BEGIN
names := CASE section
WHEN 'tables' THEN ARRAY['kind','persistence','inherited']
WHEN 'columns' THEN ARRAY['type','nullable','default_expression','identity','generated','collation','maximum_length','numeric_precision','numeric_scale','datetime_precision']
WHEN 'constraints' THEN ARRAY['kind','columns','deferrable','initially_deferred','no_inherit']
WHEN 'indexes' THEN ARRAY['method','unique_index','primary_index','immediate','valid','ready','keys','included','predicate','expressions','ordering_options','collations','operator_classes']
WHEN 'functions' THEN ARRAY['identity_arguments','arguments','return_type','language','body','volatility','parallel','security_definer','strict','configuration']
WHEN 'triggers' THEN ARRAY['timing','events','level','function_schema','function_name','function_arguments','condition','enabled','deferrable','initially_deferred']
WHEN 'sequences' THEN ARRAY['type','start_value','increment','minimum','maximum','cache','cycle'] END;
IF names IS NULL THEN RAISE EXCEPTION '2I unknown signature section'; END IF;
SELECT jsonb_object_agg(n,coalesce(r->n,'null'::jsonb)) INTO result FROM unnest(names) n;
IF section='columns' AND result->>'default_expression'='ARRAY[]::text[]' THEN
 result:=jsonb_set(result,'{default_expression}',to_jsonb('''{}''::text[]'::text)); END IF;
IF section='constraints' THEN
 IF r->>'kind'='f' THEN
  SELECT result||jsonb_object_agg(n,coalesce(r->n,'null'::jsonb)) INTO result
   FROM unnest(ARRAY['referenced_schema','referenced_table','referenced_columns','delete_action','update_action','match_type']) n;
 ELSIF r->>'kind'='c' THEN result:=result||jsonb_build_object('check_expression',
 CASE r->>'check_expression'
 ${normalized.map(n=>`WHEN ${lit(n.canonicalExpression)} THEN to_jsonb(${lit(n.reparsedExpression)}::text)`).join("\n")}
 ELSE r->'check_expression' END);
 END IF;
END IF;
IF section='constraints' AND r->>'kind' IN ('p','u') OR section='indexes' THEN
 result:=result||jsonb_build_object('nulls_not_distinct',coalesce(r->>'definition','') ~* 'NULLS\\s+NOT\\s+DISTINCT');
END IF;
IF section='triggers' THEN
 result:=result||jsonb_build_object('call',substring(r->>'definition' from 'EXECUTE FUNCTION (.*)$'));
END IF;
RETURN result;
END $sig$;
CREATE OR REPLACE FUNCTION pg_temp.edu2i_apply(section text, spec jsonb)
RETURNS void LANGUAGE plpgsql AS $apply$
DECLARE r jsonb:=spec->'expected'; current jsonb; items jsonb; candidate jsonb; actual_sig jsonb; expected_sig jsonb;
 scope text; rel regclass; occupied regclass; ddl text:=spec->>'ddl'; new_column boolean:=false; any_rows boolean; n text; attached boolean:=false;
BEGIN
scope:=coalesce(r->>'table_name',r->>'name');
IF section IN ('tables','functions','sequences') THEN scope:=r->>'name'; END IF;
IF section='ownership' THEN
 items:=pg_temp.edu2i_catalog('sequences',r->>'name'); current:=items->0;
 IF current IS NULL THEN RAISE EXCEPTION '2I sequence prerequisite missing: %',r->>'name'; END IF;
 IF (current->>'table_name',current->>'column_name',current->>'ownership')
  IS NOT DISTINCT FROM (r->>'table_name',r->>'column_name',r->>'ownership') THEN RETURN; END IF;
 IF current->>'ownership' IS NOT NULL THEN RAISE EXCEPTION '2I differing sequence ownership %',r->>'name'; END IF;
 IF r->>'ownership' IS NULL THEN RETURN; END IF;
 IF EXISTS(SELECT FROM pg_depend d JOIN pg_attrdef ad ON ad.oid=d.objid
  JOIN pg_class t ON t.oid=ad.adrelid JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=ad.adnum
  WHERE d.refobjid=to_regclass(format('public.%I',r->>'name')) AND d.classid='pg_attrdef'::regclass
   AND (t.relname,a.attname) IS DISTINCT FROM (r->>'table_name',r->>'column_name')) THEN
  RAISE EXCEPTION '2I sequence used by unexpected column %',r->>'name'; END IF;
 EXECUTE ddl; RETURN;
END IF;
items:=pg_temp.edu2i_catalog(section,scope);
SELECT value INTO current FROM jsonb_array_elements(items)
 WHERE value->>'name'=r->>'name' AND (section<>'functions' OR value->>'identity_arguments'=r->>'identity_arguments');
expected_sig:=pg_temp.edu2i_signature(section,r);
IF current IS NOT NULL THEN
 actual_sig:=pg_temp.edu2i_signature(section,current);
 IF section='columns' AND actual_sig IS DISTINCT FROM expected_sig THEN
  IF scope IN ('fee_invoices','fee_payments') AND r->>'name'='student_id'
   AND r->>'nullable'='true' AND current->>'nullable'='false'
   AND actual_sig-'nullable'=expected_sig-'nullable' THEN
   EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL',scope,r->>'name');
   RETURN;
  END IF;
 END IF;
 IF actual_sig IS DISTINCT FROM expected_sig THEN
  RAISE EXCEPTION '2I ambiguous/different existing %.%: expected %, actual %',scope,r->>'name',expected_sig,actual_sig;
 END IF;
 IF section='constraints' AND r->>'validated'='true' AND current->>'validated'='false' THEN
  EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I',scope,current->>'name');
 END IF;
 RETURN; -- preserves stronger validation and every equivalent existing OID
END IF;
IF section IN ('constraints','indexes','triggers') THEN
 FOR candidate IN SELECT value FROM jsonb_array_elements(items) LOOP
  IF pg_temp.edu2i_signature(section,candidate)=expected_sig THEN
   IF section='constraints' AND r->>'validated'='true' AND candidate->>'validated'='false' THEN
    EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I',scope,candidate->>'name'); END IF;
   RETURN;
  END IF;
 END LOOP;
END IF;
IF section='columns' THEN
 rel:=to_regclass(format('public.%I',scope));
 IF rel IS NULL THEN RAISE EXCEPTION '2I missing column table %',scope; END IF;
 EXECUTE format('LOCK TABLE %s IN ACCESS EXCLUSIVE MODE',rel);
 IF r->>'nullable'='false' THEN
  EXECUTE format('SELECT EXISTS(SELECT FROM %s LIMIT 1)',rel) INTO any_rows;
  IF any_rows THEN RAISE EXCEPTION '2I preflight gate: required column %.% needs an approved existing-row mapping; no default backfill',scope,r->>'name'; END IF;
 END IF;
 -- Add nullable fields WITHOUT a default first: old row values remain NULL.
 EXECUTE ddl; new_column:=true;
 IF r->>'default_expression' IS NOT NULL THEN
  EXECUTE format('ALTER TABLE %s ALTER COLUMN %I SET DEFAULT %s',rel,r->>'name',r->>'default_expression'); END IF;
ELSIF section='constraints' AND r->>'kind' IN ('p','u') THEN
 -- Adopt a qualifying standalone index in place; keep its name and OID.
 FOR candidate IN SELECT value FROM jsonb_array_elements(pg_temp.edu2i_catalog('indexes',scope)) LOOP
  IF candidate->>'unique_index'='true' AND candidate->>'immediate'='true'
   AND candidate->>'valid'='true' AND candidate->>'ready'='true' AND candidate->>'method'='btree'
   AND candidate->>'owner_constraint' IS NULL AND candidate->>'predicate' IS NULL
   AND candidate->>'expressions' IS NULL AND candidate->'keys'=r->'columns'
   AND candidate->'included'='[]'::jsonb
   AND NOT EXISTS(SELECT FROM jsonb_array_elements(candidate->'ordering_options') v WHERE v::text<>'0')
   AND NOT (candidate->>'definition' ~* 'NULLS\\s+NOT\\s+DISTINCT') THEN
    n:=candidate->>'name';
    IF EXISTS(SELECT FROM pg_constraint WHERE conrelid=to_regclass(format('public.%I',scope)) AND conname=n) THEN
     RAISE EXCEPTION '2I occupied adopted constraint name %.%',scope,n; END IF;
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s USING INDEX %I',
     scope,n,CASE WHEN r->>'kind'='p' THEN 'PRIMARY KEY' ELSE 'UNIQUE' END,n);
    attached:=true;EXIT;
  END IF;
 END LOOP;
 IF NOT attached THEN EXECUTE ddl; END IF;
ELSIF section='indexes' AND r->>'owner_constraint' IS NOT NULL THEN
 RAISE EXCEPTION '2I missing automatic index %; prerequisite constraint must materialize/adopt it',r->>'name';
ELSE
 EXECUTE ddl;
END IF;
-- Re-read PostgreSQL's own definition, not the proposed text.
items:=pg_temp.edu2i_catalog(section,scope);
IF NOT EXISTS(SELECT FROM jsonb_array_elements(items) v
 WHERE pg_temp.edu2i_signature(section,v)=expected_sig) THEN
 RAISE EXCEPTION '2I post-create semantic verification failed %.%',scope,r->>'name';
END IF;
END $apply$;
`;
const ops=[],preflight=[];
const objectId=(k,r)=>k+":"+[r.schema,r.table_name??"",r.name,k==="functions"?r.identity_arguments:""].join(".");
const phase=r=>graph.nodes.find(x=>x.id===objectId(r.kind,r.value))?.phase??"A";
const add=(kind,r,ddl,stage)=>ops.push({kind,expected:r,ddl,stage,phase:phase({kind:kind==="ownership"?"sequences":kind,value:r}),id:objectId(kind,r)});
const beforeDefault=new Set(e.columns.flatMap(c=>e.functions.filter(f=>(c.default_expression??"").includes(f.name+"(")).map(f=>f.name)));
for(const f of e.functions.filter(f=>beforeDefault.has(f.name)&&!financeObject("functions",f)))add("functions",f,f.definition,0);
for(const s of e.sequences.filter(s=>!financeObject("sequences",s)))add("sequences",s,
 `CREATE SEQUENCE public.${q(s.name)} AS ${s.type} INCREMENT BY ${s.increment} MINVALUE ${s.minimum} MAXVALUE ${s.maximum} START WITH ${s.start_value} CACHE ${s.cache}${s.cycle?" CYCLE":" NO CYCLE"}`,1);
for(const t of e.tables.filter(t=>!financeObject("tables",t))){
 const cols=e.columns.filter(c=>c.table_name===t.name);
 assert(cols.every(c=>!c.identity&&!c.generated&&(c.collation===null||c.collation==="default")));
 add("tables",t,`CREATE TABLE ${table(t)} (${cols.map(c=>q(c.name)+" "+c.type+(c.default_expression?" DEFAULT "+c.default_expression:"")+(!c.nullable?" NOT NULL":"")).join(", ")})`,2);
}
for(const col of e.columns.filter(c=>!financeObject("columns",c))){
 add("columns",col,`ALTER TABLE ${table(col)} ADD COLUMN ${q(col.name)} ${col.type}${col.nullable?"":" NOT NULL"}`,3);
 if(!baseline.columns.some(c=>c.table_name===col.table_name&&c.name===col.name)&&!col.nullable&&baseline.tables.some(t=>t.name===col.table_name))
  preflight.push({kind:"required missing column",table:col.table_name,columns:[col.name],query:`SELECT count(*) AS violations FROM ${table(col)}`,expected:0,
   nullAllowed:false,gate:"Existing target must have zero rows OR a separately approved prior mapping. This package will not invent/default-backfill existing rows.",status:"NOT RUN"});
}
for(const s of e.sequences.filter(s=>!financeObject("sequences",s)))add("ownership",s,
 s.table_name?`ALTER SEQUENCE public.${q(s.name)} OWNED BY public.${q(s.table_name)}.${q(s.column_name)}`:"",4);
for(const c of e.constraints.filter(c=>["p","u"].includes(c.kind)&&!financeObject("constraints",c)))
 add("constraints",c,`ALTER TABLE ${table(c)} ADD CONSTRAINT ${q(c.name)} ${c.definition}`,5);
for(const i of e.indexes.filter(i=>!financeObject("indexes",i)))add("indexes",i,i.definition,6);
// Unchanged 0060 is deliberately scheduled AFTER its forward prerequisites.
for(const c of e.constraints.filter(c=>["c","f"].includes(c.kind)&&!financeObject("constraints",c)))
 add("constraints",c,`ALTER TABLE ${table(c)} ADD CONSTRAINT ${q(c.name)} ${c.definition}`,8);
for(const f of e.functions.filter(f=>!beforeDefault.has(f.name)&&!financeObject("functions",f)))add("functions",f,f.definition,9);
for(const t of e.triggers.filter(t=>!financeObject("triggers",t)))add("triggers",t,t.definition+ (t.enabled==="O"?"":`; ALTER TABLE ${table(t)} ${t.enabled==="D"?"DISABLE":t.enabled==="A"?"ENABLE ALWAYS":"ENABLE REPLICA"} TRIGGER ${q(t.name)}`),10);
// Exact aggregate preflights for every canonical key/check/FK, including unchanged 0060.
for(const c of e.constraints){
 let query, nullAllowed=true;
 if(c.kind==="f"){const nonnull=c.columns.map(x=>"c."+q(x)+" IS NOT NULL").join(" AND ");
  const join=c.columns.map((x,i)=>"p."+q(c.referenced_columns[i])+"=c."+q(x)).join(" AND ");
  query=`SELECT count(*) AS violations FROM ${table(c)} c WHERE ${nonnull} AND NOT EXISTS(SELECT FROM public.${q(c.referenced_table)} p WHERE ${join})`;
 }else if(c.kind==="c")query=`SELECT count(*) AS violations FROM ${table(c)} WHERE NOT (${c.check_expression})`;
 else{const cols=c.columns.map(q).join(",");query=`SELECT count(*) AS violations FROM (SELECT ${cols} FROM ${table(c)}${c.kind==="u"?" WHERE "+c.columns.map(x=>q(x)+" IS NOT NULL").join(" AND "):""} GROUP BY ${cols} HAVING count(*)>1) d`;nullAllowed=c.kind==="u";
  if(c.kind==="p")preflight.push({kind:"primary key NULL",table:c.table_name,columns:c.columns,query:`SELECT count(*) AS violations FROM ${table(c)} WHERE ${c.columns.map(x=>q(x)+" IS NULL").join(" OR ")}`,expected:0,nullAllowed:false,status:"NOT RUN"});}
 preflight.push({kind:c.kind,table:c.table_name,columns:c.columns,referencedTable:c.referenced_table,referencedColumns:c.referenced_columns,
  object:c.name,query,expected:0,nullAllowed,orphanOrCrossTenantBlocks:c.kind==="f",gate:"Run only after all referenced relations/columns exist, before enabling/validating the constraint.",status:"NOT RUN"});
}
for(const i of e.indexes.filter(i=>i.unique_index&&!i.owner_constraint)){
 assert(!e.functions.some(f=>(i.expressions??"").includes(f.name+"(")),"Do not evaluate application functions in a read-only preflight");
 preflight.push({kind:"unique index",table:i.table_name,columns:i.keys,object:i.name,
  query:`SELECT count(*) AS violations FROM (SELECT ${i.keys.join(", ")} FROM ${table(i)} WHERE ${i.keys.map(x=>x+" IS NOT NULL").join(" AND ")}${i.predicate?" AND ("+i.predicate+")":""} GROUP BY ${i.keys.join(", ")} HAVING count(*)>1) d`,
  expected:0,nullAllowed:true,status:"NOT RUN",expression:i.expressions,
  gate:"After prerequisite columns exist. Canonical expressions use built-in immutable COALESCE/lower/btrim, not application functions. No Production execution during Stage 2I."});
}
for(const s of e.sequences){
 assert(s.increment==="1"&&!s.cycle,"Sequence preflight requires a reviewed non-unit/descending/cycling policy");
 preflight.push({kind:"sequence position",table:s.table_name,columns:[s.column_name],object:s.name,
  query:`SELECT CASE WHEN (SELECT max(${q(s.column_name)}) FROM public.${q(s.table_name)}) IS NULL THEN 0 WHEN (CASE WHEN s.is_called THEN (SELECT max(${q(s.column_name)}) FROM public.${q(s.table_name)}) > s.last_value ELSE (SELECT max(${q(s.column_name)}) FROM public.${q(s.table_name)}) >= s.last_value END) THEN 1 ELSE 0 END AS violations FROM public.${q(s.name)} s`,
  expected:0,nullAllowed:false,status:"NOT RUN",
  gate:"Verified writable-primary READ-ONLY sequence relation access required; unavailable replica positions are NOT ASSESSABLE. Never call nextval/setval or reset a sequence. Cached positions/recovery evidence require operator review."});
}
const manifest={originalHashes:original,journalHash:hash(await fs.readFile("lib/db/drizzle/meta/_journal.json")),migrations:[],order:[],preflights:preflight,
 baselineLabel:"Stage 2H Production-routed test replica catalog ONLY; no Stage 2I Production connections",
 financeExclusion:"All objects owned by the two student Finance tables and their two immutability functions are supplied exclusively by unchanged 0060.",
 warnings:["Required missing columns on populated tables fail closed; no implicit backfill.",
 "Forward prerequisite numbers exceed 0060. Use this dependency manifest, NOT lexical order; journal adoption remains separately gated.",
 "Existing equivalent objects/physical ordinals/stronger validation and extra objects are retained.",
 "Temporary guard functions live only in pg_temp; all application functions/triggers use exact canonical bodies."]};
if(prior?.blockers?.length){manifest.blockers=prior.blockers;manifest.releaseStatus="BLOCKED — DO NOT PROCEED";}
let previous=[];
const stageNames={0:"default_function",1:"sequences",2:"table_shells",3:"columns",4:"sequence_ownership",5:"parent_keys",6:"indexes",8:"checks_foreign_keys",9:"functions",10:"triggers"};
for(const stage of [0,1,2,3,4,5,6,7,8,9,10]){
 if(stage===7){manifest.order.push("0060_reconcile_student_subscription_finance.sql");previous=["0060_reconcile_student_subscription_finance.sql"];continue;}
 const group=ops.filter(o=>o.stage===stage);
 const stageFiles=[];
 for(const phase of [...new Set(group.map(o=>o.phase))].sort()){
  const phased=group.filter(o=>o.phase===phase);
  for(let start=0;start<phased.length;start+=90){
   const chunk=phased.slice(start,start+90);
   const name=String(next++).padStart(4,"0")+`_reconcile_${stageNames[stage]}_${phase.toLowerCase()}_${Math.floor(start/90)+1}.sql`;
   const contract=JSON.stringify(chunk);assert(!contract.includes("$contracts$"));
   const sql=`-- Stage 2I source-only; NOT journal-registered or authorized for shared execution.
-- ${stageNames[stage]}, phase ${phase}. Depends on preceding structural tier; see reports/schema-2i/manifest.json.
-- No data repair/backfill. Same-name different semantics raise an exception.
-- Required Production preflights are NOT RUN; see separate preflight specification.
-- One transaction statement; helper DDL executes only in the temporary session schema.
DO $migration$
DECLARE spec jsonb;
BEGIN
 PERFORM set_config('search_path','pg_catalog,public,pg_temp',true);
 PERFORM set_config('lock_timeout','10s',true);
 EXECUTE ${lit(kernel)};
 FOR spec IN SELECT value FROM jsonb_array_elements($contracts$${contract}$contracts$::jsonb) LOOP
  PERFORM pg_temp.edu2i_apply(spec->>'kind',spec);
 END LOOP;
END $migration$;
`;
   const target="lib/db/drizzle/"+name;
   if(existing.includes(name)){
    const current=await fs.readFile(target,"utf8");
    if(current!==sql){const owned=prior?.migrations.find(m=>m.name===name);
     assert(owned&&hash(current)===owned.sha256,"Refuse to overwrite an unowned/changed forward migration");
     await fs.writeFile(target,sql);}
   }
   else{assert(!existing.some(n=>n.slice(0,4)===name.slice(0,4)),"Forward numbering collision");await fs.writeFile(target,sql);}
   const entry={name,purpose:stageNames[stage],phase,objects:chunk.length,statements:1,guarded:true,
    prerequisites:[...previous],requiresPreflight:[3,5,6,8,10].includes(stage),controlledReplacement:false,
    controlledAlterations:stage===3?"Only the canonical fee_invoices/fee_payments student_id NOT NULL relaxation":stage===5?"Qualifying standalone index attachment in place, without rename/rebuild":stage===8?"Validation of an equivalent NOT VALID constraint when canonical requires validation":null,
    sha256:hash(sql),ids:chunk.map(o=>o.id)};
   manifest.migrations.push(entry);manifest.order.push(name);stageFiles.push(name);
  }
 }
 if(stageFiles.length)previous=stageFiles; // Same structural tier is parallel by phase; release scheduling still needs lock budgets.
}
const differences=new Map(comparison.changes.map(v=>[v.id,v]));
manifest.classification=[];
for(const [kind,rows]of Object.entries(e))for(const r of rows){
 const change=differences.get(objectId(kind,r));
 const state=!change?"PRESENT AND EQUIVALENT":change.category.startsWith("C")?"PRESENT WITH PROVEN EQUIVALENT DIFFERENCE":
  change.category.startsWith("A")?"MISSING — SAFE TO CREATE":"PRESENT BUT DIFFERENT — REQUIRES CONTROLLED RECONCILIATION";
 manifest.classification.push({id:objectId(kind,r),state,financeOwned:financeObject(kind,r),conditions:"Runtime semantic guards and documented data/release preflights required.",reason:change?.reason??null});
}
manifest.journal={files:[...history,...manifest.migrations.map(x=>x.name)],registrations:journal.entries,
 missingRegistrations:[...history,...manifest.migrations.map(x=>x.name)].filter(n=>!journal.entries.some(e=>e.tag===n.slice(0,-4))),
 historicalHashDifferences:[],ledgerHashes:"Not inspected: Stage 2I permits no Production connections. Journal entries do not contain executed SQL hashes.",
 procedure:"Preserve existing registrations/hash history; review older unregistered data effects/baseline adoption first. Register approved forward prerequisites in dependency order before 0060, then remaining tiers with monotonic reviewed runner timestamps. Do not bulk-stamp or infer prior execution; do not sort manifest lexically."};
await fs.writeFile(out+"/manifest.json",JSON.stringify(manifest,null,2));
await fs.writeFile(out+"/preflight-specification.json",JSON.stringify(preflight,null,2));
await fs.writeFile(out+"/journal-review.json",JSON.stringify(manifest.journal,null,2));
console.log(JSON.stringify({newFiles:manifest.migrations.length,nextNumber:next,objects:ops.length,preflights:preflight.length,finance:"Unchanged; explicitly scheduled after prerequisites"}));
