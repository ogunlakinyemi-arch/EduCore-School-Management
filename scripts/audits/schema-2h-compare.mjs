// Catalog-only comparison and SELECT-only aggregate compatibility plans.
import fs from "node:fs/promises";
import path from "node:path";
const dir="reports/schema-2h",read=async n=>JSON.parse(await fs.readFile(path.join(dir,n),"utf8"));
const expected=await read("canonical-catalog.json"),actual=await read("production-catalog.json");
const migrations=(await fs.readdir("lib/db/drizzle")).filter(f=>/^\d{4}.*\.sql$/.test(f)).sort();
const texts=await Promise.all(migrations.map(async name=>({name,sql:await fs.readFile(path.join("lib/db/drizzle",name),"utf8")})));
const q=s=>'"'+s.replaceAll('"','""')+'"',table=r=>q(r.schema??"public")+"."+q(r.table_name??r.name);
// Preserve literal contents; normalize only SQL outside quoted literals.
function norm(s){
 if(s==null)return null;
 return s.replace(/'(?:''|[^'])*'|"(?:[^"]|"")*"|--[^\n]*|\/\*[\s\S]*?\*\/|[^'"]+/g,t=>{
  if(t.startsWith("'"))return t;
  if(t.startsWith('"')){const v=t.slice(1,-1);return /^[a-z_][a-z0-9_]*$/.test(v)?v:t;}
  if(t.startsWith("--")||t.startsWith("/*"))return" ";
  return t.replace(/\s+/g," ").toLowerCase().replace(/public\./g,"");
 }).trim();
}
const sections=Object.keys(expected);
function key(section,r){return[r.schema,r.table_name??"",r.name,section==="functions"?r.identity_arguments:""].join(".");}
function semantic(section,r){
 const pick=(...ks)=>Object.fromEntries(ks.map(k=>[k,r[k]??null]));
 let v;
 if(section==="tables")v=pick("kind","persistence","inherited");
 if(section==="columns")v=pick("type","nullable","default_expression","identity","generated","collation","maximum_length","numeric_precision","numeric_scale","datetime_precision");
 if(section==="constraints"){
  v=pick("kind","columns","deferrable","initially_deferred","validated","no_inherit");
  if(r.kind==="f")Object.assign(v,pick("referenced_schema","referenced_table","referenced_columns","delete_action","update_action","match_type"));
  if(r.kind==="c")v.check_expression=norm(r.check_expression);
  if(r.kind==="u"||r.kind==="p")v.nulls_not_distinct=/NULLS\s+NOT\s+DISTINCT/i.test(r.definition);
 }
 if(section==="indexes"){v=pick("method","unique_index","primary_index","immediate","valid","ready","keys","included","predicate","expressions","ordering_options","collations","operator_classes");
  v.nulls_not_distinct=/NULLS\s+NOT\s+DISTINCT/i.test(r.definition);}
 if(section==="functions")v=pick("identity_arguments","arguments","return_type","language","body","volatility","parallel","security_definer","strict","configuration");
 if(section==="triggers")v=pick("timing","events","level","function_schema","function_name","function_arguments","condition","enabled","deferrable","initially_deferred");
 if(section==="sequences")v=pick("type","start_value","increment","minimum","maximum","cache","cycle","table_schema","table_name","column_name","ownership");
 for(const k of ["default_expression","predicate","expressions","body","condition"])if(k in v)v[k]=norm(v[k]);
 if(v.keys)v.keys=v.keys.map(norm);
 return v;
}
function phaseFor(name){
 const first=texts.find(t=>new RegExp('CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:"?public"?\\.)?"?'+name+'"?(?=\\s|\\()',"i").test(t.sql));
 const no=first?Number(first.name.slice(0,4)):null;
 let phase=no===0?"A":no===1?"C":no===2?"B":no===9?"D":no===12||no===39||no===44||no===56||no===57?"E":
   (no>=13&&no<=23)||[31,35,36,49,50,52,54,55,58,60].includes(no)?"F":
  [4,28,29,32,34,45,46].includes(no)?"G":[25,26,47,48].includes(no)?"H":[24,33].includes(no)?"B":[42,43].includes(no)?"C":"I";
 if(/^(schools|app_users|students|teachers|parents|staff|classes|academic_sessions|academic_terms)$/.test(name))phase="A";
 return{phase,createdBy:first?.name??null};
}
const changes=[],matched=new Map(),extras={},summary=[];
for(const section of sections){
 const byName=new Map(actual[section].map(r=>[key(section,r),r])),used=new Set();
 for(const r of expected[section]){
  const id=section+":"+key(section,r),same=byName.get(key(section,r)),sig=JSON.stringify(semantic(section,r));
  const equiv=(!same&&["constraints","indexes","functions","triggers","sequences"].includes(section))?
   actual[section].find(a=>!used.has(key(section,a))&&a.schema===r.schema&&(a.table_name??"")===(r.table_name??"")&&JSON.stringify(semantic(section,a))===sig):null;
  let category,existing=same??equiv;
  if(!existing)category="A — Missing";
  else if(JSON.stringify(semantic(section,existing))!==sig)category="B — Different";
  else if(equiv)category="C — Equivalent";
  else category="Verified";
  const emptyArrayEquivalent=section==="columns"&&same&&r.type==="text[]"&&same.type==="text[]"&&
   new Set([norm(r.default_expression),norm(same.default_expression)]).size===2&&
   [norm(r.default_expression),norm(same.default_expression)].every(v=>["array[]::text[]","'{}'::text[]"].includes(v))&&
   Object.keys(semantic(section,r)).filter(k=>k!=="default_expression").every(k=>JSON.stringify(semantic(section,r)[k])===JSON.stringify(semantic(section,same)[k]));
  if(emptyArrayEquivalent)category="C — Equivalent";
  const ordinalEquivalent=category==="Verified"&&section==="columns"&&same&&r.ordinal!==same.ordinal;
  if(ordinalEquivalent)category="C — Equivalent";
  if(existing){used.add(key(section,existing));matched.set(id,existing);}
  if(category==="Verified")continue;
  const changedFields=existing?Object.keys(semantic(section,r)).filter(k=>JSON.stringify(semantic(section,r)[k])!==JSON.stringify(semantic(section,existing)[k])):[];
  const context=phaseFor(r.table_name??r.name);
  changes.push({id,section,category,...context,expected:r,actual:existing??null,changedFields,
   ordinalDifference:section==="columns"&&existing&&r.ordinal!==existing.ordinal?{expected:r.ordinal,actual:existing.ordinal}:undefined,
   reason:category==="C — Equivalent"?(emptyArrayEquivalent?"Both defaults produce the same empty text array; read-only PostgreSQL proof recorded. Retain existing default.":
    ordinalEquivalent?"Named-column type/default/nullability semantics match; physical ordinal differs. Retain physical order; positional SQL consumers need separate review.":
    "Same semantic catalog signature; name differs. Retain existing object."):undefined,
   retainStrongerValidation:section==="constraints"&&same&&r.kind==="f"&&!r.validated&&same.validated&&changedFields.every(k=>k==="validated")});
 }
 extras[section]=actual[section].filter(r=>!used.has(key(section,r)));
}
// Every expected object accounted for; extras retained, never destructive removal.
for(const section of sections){
 const kinds=section==="constraints"?["p","u","c","f"]:[null];
 for(const kind of kinds){const cs=changes.filter(c=>c.section===section&&(!kind||c.expected.kind===kind));
  summary.push({objectType:kind?({p:"PKs",u:"UNIQUE constraints",c:"CHECK constraints",f:"FKs"})[kind]:section,
   expected:expected[section].filter(r=>!kind||r.kind===kind).length,
   production:actual[section].filter(r=>!kind||r.kind===kind).length,
   missing:cs.filter(c=>c.category.startsWith("A")).length,different:cs.filter(c=>c.category.startsWith("B")).length,
   equivalent:cs.filter(c=>c.category.startsWith("C")).length,verified:expected[section].filter(r=>!kind||r.kind===kind).length-cs.length,
   productionExtras:extras[section].filter(r=>!kind||r.kind===kind).length});
 }
}
const liveTables=new Set(actual.tables.map(t=>t.schema+"."+t.name)),liveColumns=new Set(actual.columns.map(c=>c.schema+"."+c.table_name+"."+c.name));
const hasTable=r=>liveTables.has((r.schema??"public")+"."+(r.table_name??r.name));
const hasCols=(r,cols)=>(cols??[]).every(c=>liveColumns.has((r.schema??"public")+"."+r.table_name+"."+c));
const checks=[],add=(c,kind,sql,status,reason)=>checks.push({id:"check-"+String(checks.length+1).padStart(4,"0"),object:c.id,kind,
 status:status??"PENDING",reason,sql:sql??null});
for(const c of changes.filter(c=>!c.category.startsWith("C"))){
 const r=c.expected;
 if(!hasTable(r)&&["columns","constraints","indexes","triggers","sequences"].includes(c.section)){
  add(c,"data applicability",null,"NOT ASSESSABLE","Target table does not exist; not described as empty. Future creation prerequisite.");continue;
 }
 if(c.section==="tables"){add(c,"new table",null,"NOT ASSESSABLE","Missing table; no existing-table data assertion is possible.");continue;}
 if(c.section==="functions"||c.section==="triggers"){
  add(c,"creation safety",null,"PASS","Creating a function/trigger does not retroactively rewrite/reject existing rows; dependencies must be installed first.");
  add(c,"future behavioral compatibility",null,"NOT ASSESSABLE","Read-only audit cannot simulate future row mutations. Require disposable clone/fixtures and unchanged writer tests before release.");continue;
 }
 if(c.section==="columns"){
  const exists=hasCols(r,[r.name]);
  if(!exists){
   if(!r.nullable&&!r.default_expression)add(c,"new required column on populated table","SELECT count(*)::text AS violations FROM "+table(r));
   else if(!r.nullable)add(c,"new required column with default",null,"NOT ASSESSABLE","Default is defined, but semantic correctness for existing test rows requires policy review; no value fabricated.");
   else add(c,"nullable column",null,"PASS","Nullable additive column does not reject existing rows.");
   continue;
  }
  if(!r.nullable&&c.actual.nullable)add(c,"NOT NULL","SELECT count(*)::text AS violations FROM "+table(r)+" WHERE "+q(r.name)+" IS NULL");
  if(r.nullable&&!c.actual.nullable)add(c,"relax NOT NULL",null,"PASS","Relaxing NOT NULL does not reject or rewrite existing rows; pair with the canonical person/ownership CHECKs.");
  if(c.actual.type!==r.type){
   const bounds={"smallint":["-32768","32767"],integer:["-2147483648","2147483647"],bigint:["-9223372036854775808","9223372036854775807"]};
   const len=/^character varying\((\d+)\)$/.exec(r.type);
   if(bounds[r.type]&&/^(smallint|integer|bigint|numeric(?:\(.*\))?)$/.test(c.actual.type))
    add(c,"numeric type range","SELECT count(*)::text AS violations FROM "+table(r)+" WHERE "+q(r.name)+" IS NOT NULL AND ("+q(r.name)+"::numeric<"+bounds[r.type][0]+" OR "+q(r.name)+"::numeric>"+bounds[r.type][1]+" OR trunc("+q(r.name)+"::numeric)<>"+q(r.name)+"::numeric)");
   else if(len&&/^(text|character varying)/.test(c.actual.type))add(c,"text length","SELECT count(*)::text AS violations FROM "+table(r)+" WHERE length("+q(r.name)+")>"+Number(len[1]));
   else add(c,"type conversion",null,"NOT ASSESSABLE","Lossless conversion/rounding/timezone semantics cannot be established by a generic cast; requires an explicit reviewed conversion policy.");
  }
  if(c.changedFields.includes("default_expression"))add(c,"default change",null,"PASS","Changing a default does not rewrite existing rows. Future generated values and sequence binding need review.");
  if(!checks.some(x=>x.object===c.id))add(c,"metadata difference",null,"NOT ASSESSABLE","Review exact metadata difference; physical column ordinal is not a data migration.");
  continue;
 }
 if(c.section==="constraints"){
  if(!hasCols(r,r.columns)){add(c,"constraint data",null,"NOT ASSESSABLE","One or more required columns are absent.");continue;}
  if(r.kind==="p"||r.kind==="u"){
   const columns=r.columns.map(q).join(","),notNull=r.columns.map(x=>q(x)+" IS NOT NULL").join(" AND ");
   add(c,"duplicate groups","SELECT count(*)::text AS violations FROM (SELECT "+columns+" FROM "+table(r)+(r.kind==="u"?" WHERE "+notNull:"")+" GROUP BY "+columns+" HAVING count(*)>1) d");
   if(r.kind==="p")add(c,"primary-key NULL","SELECT count(*)::text AS violations FROM "+table(r)+" WHERE "+r.columns.map(x=>q(x)+" IS NULL").join(" OR "));
  }else if(r.kind==="f"){
   const parent={schema:r.referenced_schema,table_name:r.referenced_table};
   if(!hasTable(parent)||!hasCols(parent,r.referenced_columns)){add(c,"foreign-key orphans",null,"NOT ASSESSABLE","Referenced table/key columns do not exist.");continue;}
   const nonNull=r.columns.map(x=>"c."+q(x)+" IS NOT NULL").join(" AND ");
   const join=r.columns.map((x,i)=>"p."+q(r.referenced_columns[i])+"=c."+q(x)).join(" AND ");
   add(c,"foreign-key orphans / tenant ownership","SELECT count(*)::text AS violations FROM "+table(r)+" c WHERE "+nonNull+" AND NOT EXISTS(SELECT 1 FROM "+table(parent)+" p WHERE "+join+")");
   const supports=actual.constraints.some(k=>["p","u"].includes(k.kind)&&k.table_name===r.referenced_table&&JSON.stringify(k.columns)===JSON.stringify(r.referenced_columns)&&!k.deferrable)||
    actual.indexes.some(k=>k.table_name===r.referenced_table&&k.unique_index&&k.immediate&&k.valid&&!k.predicate&&!k.expressions&&JSON.stringify(k.keys)===JSON.stringify(r.referenced_columns));
   add(c,"supporting parent key",null,supports?"PASS":"NOT ASSESSABLE",supports?"A usable matching parent key exists.":"Missing supporting parent key must be created before this FK.");
  }else{
   const expression=r.check_expression;
   const referenced=r.columns;
   if(!expression||!hasCols(r,referenced)){add(c,"CHECK",null,"NOT ASSESSABLE","CHECK expression or columns unavailable.");continue;}
   const customFn=expected.functions.find(f=>new RegExp("\\b"+f.name+"\\s*\\(","i").test(expression));
   if(customFn)add(c,"CHECK",null,"NOT ASSESSABLE","Expression invokes migration-defined function; do not execute unverified functions on the replica.");
   else add(c,"CHECK violations","SELECT count(*)::text AS violations FROM "+table(r)+" WHERE NOT ("+expression+")");
  }
  continue;
 }
 if(c.section==="indexes"){
  if(r.unique_index){
   if(r.expressions)add(c,"unique expression index",null,"NOT ASSESSABLE","Expression uniqueness needs separately reviewed evaluation; no user-defined function invoked.");
   else{
    const cols=r.keys.map(x=>norm(x).replace(/ (?:asc|desc)(?: nulls (?:first|last))?$/,"").replace(/ nulls (?:first|last)$/,""));
    if(!hasCols(r,cols))add(c,"unique index",null,"NOT ASSESSABLE","Index key columns are absent.");
    else add(c,"unique index duplicate groups","SELECT count(*)::text AS violations FROM (SELECT "+cols.map(q).join(",")+" FROM "+table(r)+" WHERE "+cols.map(x=>q(x)+" IS NOT NULL").join(" AND ")+(r.predicate?" AND ("+r.predicate+")":"")+" GROUP BY "+cols.map(q).join(",")+" HAVING count(*)>1) d");
   }
  }else add(c,"non-unique index",null,"PASS","Non-unique index creation imposes no row-value constraint; preserve existing dependencies and budget lock/build cost.");
  if(c.actual?.dependent_fks?.length)add(c,"index dependencies",null,"NOT ASSESSABLE","Existing index supports FKs: "+c.actual.dependent_fks.join(", ")+". Do not drop/recreate blindly.");
  continue;
 }
 if(c.section==="sequences")add(c,"sequence definition/ownership",null,"NOT ASSESSABLE","Sequence changes need maximum-ID/cached-position evidence and explicit ownership review.");
}
// Check every existing owned sequence without calling nextval or exposing row values.
for(const s of expected.sequences){
 const a=actual.sequences.find(x=>x.table_name===s.table_name&&x.column_name===s.column_name);
 if(!a||!hasTable({schema:s.table_schema,table_name:s.table_name}))continue;
 const c={id:"sequences:"+key("sequences",s)};
 if(a.observed_last_value===null)add(c,"sequence conflict",null,"NOT ASSESSABLE","Replica reports no sequence last value (unused/unavailable); cannot prove writable-primary cached position.");
 else add(c,"sequence conflict","SELECT CASE WHEN count(*)=0 THEN '0' WHEN max("+q(s.column_name)+")::numeric>"+a.observed_last_value+"::numeric THEN '1' ELSE '0' END AS violations FROM "+q(s.table_schema)+"."+q(s.table_name),null,"Aggregate only; a replica-visible last value is not a recovery/cached-primary guarantee.");
}
const journal=await read("journal.json");
const registration=migrations.filter(n=>!journal.entries.some(e=>e.tag===n.slice(0,-4)));
const result={targetLabel:"Production-routed test database/read replica; published runtime binding unverified",summary,changes,productionExtras:extras,
 ordinalDifferences:expected.columns.flatMap(r=>{const a=actual.columns.find(c=>c.schema===r.schema&&c.table_name===r.table_name&&c.name===r.name);
  return a&&a.ordinal!==r.ordinal?[{table:r.table_name,column:r.name,expected:r.ordinal,actual:a.ordinal,action:"Retain physical order; no destructive reorder"}]:[];}),
 ledger:{journalEntries:journal.entries.length,migrationFiles:migrations.length,unregistered:registration,
  indexGaps:journal.entries.filter((e,i)=>e.idx!==i).map(e=>e.idx),timestampOrder:journal.entries.every((e,i)=>i===0||e.when>journal.entries[i-1].when)},
 limitations:["Column physical ordinal retained as evidence; do not reorder columns destructively.",
 "Equivalence requires complete semantic signatures; no inferred CHECK/FK equivalence based on name.",
 "Replica aggregates are separate read-only statements, not a single cross-query snapshot. Recheck before any future authorized change."]};
await fs.writeFile(path.join(dir,"comparison.json"),JSON.stringify(result,null,2));
await fs.writeFile(path.join(dir,"compatibility-plan.json"),JSON.stringify(checks,null,2));
console.log(JSON.stringify({summary,checks:checks.length,queries:checks.filter(c=>c.sql).length,ledger:result.ledger},null,2));
