// Offline planning/reporting only. Production execution uses the supported
// executeSql(environment="production") callback, never a URL or application client.
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
const dir="reports/schema-production-preflight",read=async p=>JSON.parse(await fs.readFile(p,"utf8"));
const sha=x=>createHash("sha256").update(x).digest("hex"),q=s=>'"'+s.replaceAll('"','""')+'"';
function csvJson(response){
 assert(response.success,response.exitReason??response.output);
 let text=response.output.slice(response.output.indexOf("\n")+1).trim();
 if(text.startsWith('"'))text=text.slice(1,-1).replaceAll('""','"');
 return JSON.parse(text);
}
const root=csvJson(await read(dir+"/catalog-root-response.json")),actual={...root,columns:[],constraints:[],indexes:[],sequences:[]};
for(let i=0;i<12;i++){const c=csvJson(await read(dir+`/catalog-slice-${i}.json`));for(const k of ["columns","constraints","indexes","sequences"])actual[k].push(...c[k]);}
const expected=await read("reports/schema-2h/canonical-catalog.json"),manifest=await read("reports/schema-2i/manifest.json");
const preflightBytes=await fs.readFile("reports/schema-2i/preflight-specification.json");
const specs=JSON.parse(preflightBytes);assert.equal(specs.length,1890);
const normalized=await read("reports/schema-2i/check-expression-reparse.json");
const exprMap=new Map(normalized.map(x=>[x.canonicalExpression,x.reparsedExpression]));
const scale=csvJson(await read(dir+"/scale-response.json"));
const key=r=>[r.schema,r.table_name??"",r.name].join(".");
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==="object"?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const fields={
 tables:["kind","persistence","inherited"],
 columns:["type","nullable","default_expression","identity","generated","collation","maximum_length","numeric_precision","numeric_scale","datetime_precision"],
 constraints:["kind","columns","deferrable","initially_deferred","no_inherit"],
 indexes:["method","unique_index","primary_index","immediate","valid","ready","keys","included","predicate","expressions","ordering_options","collations","operator_classes"],
 functions:["identity_arguments","arguments","return_type","language","body","volatility","parallel","security_definer","strict","configuration"],
 triggers:["timing","events","level","function_schema","function_name","function_arguments","condition","enabled","deferrable","initially_deferred"],
 sequences:["type","start_value","increment","minimum","maximum","cache","cycle"]
};
function signature(section,r){
 const o=Object.fromEntries(fields[section].map(k=>[k,r[k]??null]));
 if(section==="columns"&&o.default_expression==="ARRAY[]::text[]")o.default_expression="'{}'::text[]";
 if(section==="constraints"){
  if(r.kind==="f")for(const k of ["referenced_schema","referenced_table","referenced_columns","delete_action","update_action","match_type"])o[k]=r[k]??null;
  if(r.kind==="c")o.check_expression=exprMap.get(r.check_expression)??r.check_expression;
 }
 if(section==="indexes"||section==="constraints"&&["p","u"].includes(r.kind))o.nulls_not_distinct=/NULLS\s+NOT\s+DISTINCT/i.test(r.definition??"");
 if(section==="triggers")o.call=r.definition?.match(/EXECUTE FUNCTION (.*)$/)?.[1]??null;
 return JSON.stringify(stable(o));
}
const objectResults=[];
for(const [section,rows]of Object.entries(expected))for(const r of rows){
 const scope=["tables","functions","sequences"].includes(section)?"name":"table_name";
 const list=actual[section].filter(a=>a[scope]===r[scope]);
 const named=list.find(a=>a.name===r.name&&(section!=="functions"||a.identity_arguments===r.identity_arguments));
 // Mirror the guarded draft: different names are reusable only for
 // constraints, indexes and triggers. Two integer columns are not aliases.
 const equivalent=["constraints","indexes","triggers"].includes(section)?
  list.find(a=>signature(section,a)===signature(section,r)):undefined;
 let severity="GREEN",state="EQUIVALENT",reason="",match=named??equivalent;
 if(named&&signature(section,named)!==signature(section,r)){
  if(section==="columns"&&["fee_invoices","fee_payments"].includes(r.table_name)&&r.name==="student_id"&&named.nullable===false&&r.nullable===true&&
   signature(section,{...named,nullable:true})===signature(section,r)){
   severity="YELLOW";state="CONTROLLED CANONICAL RELAXATION";reason="Draft only relaxes NOT NULL to canonical; no values rewritten.";
  }else{severity="RED";state="UNEXPECTED DIFFERENCE";reason="Same-name semantics differ; draft runtime guard will reject, not repair.";}
 }else if(!match){severity="YELLOW";state="PLANNED MISSING";reason="Forward creation required; data/dependency gates remain separate.";}
 else{
  if(match.name!==r.name){severity="YELLOW";state="PROVEN ALIAS";reason="Retain equivalent name/OID; avoid duplicate indexes or cosmetic renames.";}
  if(section==="constraints"&&match.validated!==r.validated){
   severity="YELLOW";state=match.validated?"STRONGER VALIDATION RETAINED":"VALIDATION PENDING";reason=match.validated?"Do not weaken existing validation.":"Existing NOT VALID constraint requires data preflight before validation.";
  }
  if(section==="sequences"&&["table_schema","table_name","column_name","ownership"].some(k=>match[k]!==r[k])){
   if(!match.ownership){severity="YELLOW";state="OWNERSHIP ATTACHMENT REQUIRED";reason="Only after target column and unexpected default-dependency review.";}
   else{severity="RED";state="UNEXPECTED OWNERSHIP";reason="Existing sequence is owned by a different relation/column.";}
  }
 }
 const id=section+":"+key(r)+"."+(section==="functions"?r.identity_arguments:"");
 objectResults.push({section,kind:r.kind,table:r.table_name,name:r.name,id,severity,state,reason,
  retainedName:match?.name,physicalOrdinalDifference:section==="columns"&&match&&match.ordinal!==r.ordinal,
  migrations:manifest.migrations.filter(m=>m.ids.includes(id)).map(m=>m.name)});
}
const haveTable=name=>actual.tables.some(t=>t.name===name);
const haveCol=(table,name)=>actual.columns.some(c=>c.table_name===table&&c.name===name);
const expectedCols=table=>expected.columns.filter(c=>c.table_name===table).map(c=>c.name);
function mentionedColumns(text,table){
 const tokens=new Set((text.replace(/'(?:[^']|'')*'/g,"").match(/[A-Za-z_][A-Za-z_0-9]*/g)??[]));
 return expectedCols(table).filter(c=>tokens.has(c));
}
const planned=[],ready=[];
for(let id=0;id<specs.length;id++){
 const s=specs[id],record={id,kind:s.kind,table:s.table,object:s.object??null,columns:s.columns,
  querySha256:sha(s.query),status:"PENDING",severity:"YELLOW",violations:null,nullAllowed:s.nullAllowed};
 assert(/^SELECT\s/i.test(s.query)&&!s.query.includes(";"),"Only checked-in single SELECTs are permitted.");
 const needed=s.kind==="required missing column"?[]:s.kind==="unique index"?mentionedColumns(s.query,s.table):s.columns??[];
 const missing=[];
 if(!haveTable(s.table))missing.push("table public."+s.table);
 else for(const c of needed)if(!haveCol(s.table,c))missing.push("column "+s.table+"."+c);
 if(s.kind==="f"){
  if(!haveTable(s.referencedTable))missing.push("referenced table public."+s.referencedTable);
  else for(const c of s.referencedColumns)if(!haveCol(s.referencedTable,c))missing.push("referenced column "+s.referencedTable+"."+c);
 }
 if(s.kind==="sequence position"&&!actual.sequences.some(a=>a.name===s.object))missing.push("sequence public."+s.object);
 if(missing.length){record.status="BLOCKED_PREREQUISITE";record.reason=missing.join("; ");}
 else if(s.kind==="required missing column"&&s.columns.every(c=>haveCol(s.table,c))){record.status="NOT_APPLICABLE";record.reason="Missing-column prerequisite no longer applies; existing column semantics checked separately.";}
 else ready.push(id);
 planned.push(record);
}
// Original queries are embedded unmodified; diagnostic aggregates are separate.
function diagnostics(id){
 const s=specs[id],p="public."+q(s.table);let nullCondition="false",extra="0::bigint AS orphan_rows,0::bigint AS cross_school_mismatches,0::bigint AS other_ownership_mismatches";
 if(s.kind==="f"){
  nullCondition=s.columns.map(c=>"c."+q(c)+" IS NULL").join(" OR ");
  const nonnull=s.columns.map(c=>"c."+q(c)+" IS NOT NULL").join(" AND ");
  const join=s.columns.map((c,i)=>"p."+q(s.referencedColumns[i])+"=c."+q(c)).join(" AND ");
  const pk=s.referencedColumns.indexOf("id");
  if(pk>=0){
   const parent="public."+q(s.referencedTable),identity="p."+q("id")+"=c."+q(s.columns[pk]);
   const bad=`(${nonnull}) AND NOT EXISTS(SELECT FROM ${parent} p WHERE ${join})`;
   const orphan=`(${nonnull}) AND NOT EXISTS(SELECT FROM ${parent} p WHERE ${identity})`;
   const childSchool=s.columns.indexOf("school_id"),parentSchool=s.referencedColumns.indexOf("school_id");
   const cross=childSchool>=0&&parentSchool===childSchool?`(${bad}) AND EXISTS(SELECT FROM ${parent} p WHERE ${identity} AND p.school_id<>c.school_id)`:"false";
   extra=`count(*) FILTER(WHERE ${orphan}) AS orphan_rows,count(*) FILTER(WHERE ${cross}) AS cross_school_mismatches,count(*) FILTER(WHERE (${bad}) AND NOT (${orphan}) AND NOT (${cross})) AS other_ownership_mismatches`;
  }
 }else if(s.kind==="c"){
  const r=expected.constraints.find(c=>c.name===s.object&&c.table_name===s.table);nullCondition=`(${r.check_expression}) IS NULL`;
 }else if(s.kind==="u")nullCondition=s.columns.map(c=>q(c)+" IS NULL").join(" OR ");
 else if(s.kind==="unique index"){
  const index=expected.indexes.find(i=>i.name===s.object&&i.table_name===s.table);
  nullCondition=`(${s.columns.map(c=>"("+c+") IS NULL").join(" OR ")})`+(index.predicate?` AND (${index.predicate}) IS TRUE`:"");
 }
 const alias=s.kind==="f"?" c":"";
 return `SELECT count(*) AS total_rows_examined,count(*) FILTER(WHERE ${nullCondition}) AS null_skipped_rows,${extra} FROM ${p}${alias}`;
}
const seqReady=ready.filter(id=>specs[id].kind==="sequence position");
const dataReady=ready.filter(id=>specs[id].kind!=="sequence position");
function batches(ids,withDiagnostics){
 const out=[];let current={ids:[],params:[],branches:[]};
 for(const id of ids){
  let branch,params=[id];
  const arg=current.params.length+1;
  if(withDiagnostics)branch=`SELECT $${arg}::integer AS id,to_jsonb(original) AS original,to_jsonb(diagnostic) AS diagnostic FROM (${specs[id].query}) original CROSS JOIN LATERAL (${diagnostics(id)}) diagnostic`;
  else branch=`SELECT $${arg}::integer AS id,to_jsonb(original) AS original FROM (${specs[id].query}) original`;
  if(current.branches.join(" UNION ALL ").length+branch.length>48000&&current.ids.length){
   out.push(current);current={ids:[],params:[],branches:[]};branch=branch.replace(`$${arg}::integer`,"$1::integer");
  }
  current.ids.push(id);current.params.push(...params);current.branches.push(branch);
 }
 if(current.ids.length)out.push(current);
 return out.map(b=>({ids:b.ids,params:b.params,sqlQuery:"SELECT jsonb_agg(r ORDER BY id) AS results FROM ("+b.branches.join(" UNION ALL ")+") r"}));
}
const plan={specHash:sha(preflightBytes),specs:planned,dataBatches:batches(dataReady,true),sequenceBatches:batches(seqReady,false),
 sequenceProbe:seqReady.length?{id:seqReady[0],query:specs[seqReady[0]].query}:null,
 rowScale:scale,rootCounts:Object.fromEntries(Object.entries(actual).map(([k,v])=>[k,v.length])),
 targetBinding:"TARGET BINDING UNVERIFIED",notes:["Read-only Production-routed replica, not proven published runtime primary.",
 "Bounded catalog slices and data batches are separate snapshots, not a shared transaction.",
 "A missing prerequisite is not a passing data check. No DDL/backfill is used to make it runnable.",
 "Counts are query-level aggregates; rows may be examined repeatedly across checks."]};
await fs.writeFile(dir+"/current-catalog.json",JSON.stringify(actual,null,2));
await fs.writeFile(dir+"/object-preflight.json",JSON.stringify(objectResults,null,2));
await fs.writeFile(dir+"/suite-plan.json",JSON.stringify(plan,null,2));
for(let i=0;i<plan.dataBatches.length;i++)await fs.writeFile(dir+`/data-batch-${i}-query.json`,JSON.stringify(plan.dataBatches[i]));
await fs.writeFile(dir+"/sequence-query-plan.json",JSON.stringify({probe:plan.sequenceProbe,batches:plan.sequenceBatches}));
console.log({objects:objectResults.length,rootCounts:plan.rootCounts,specs:planned.length,runnableData:dataReady.length,runnableSequences:seqReady.length,
 blocked:planned.filter(x=>x.status==="BLOCKED_PREREQUISITE").length,notApplicable:planned.filter(x=>x.status==="NOT_APPLICABLE").length,
 dataBatches:plan.dataBatches.length,sequenceBatches:plan.sequenceBatches.length,
 redObjects:objectResults.filter(x=>x.severity==="RED"),scaleLargest:scale.slice().sort((a,b)=>b.bytes-a.bytes).slice(0,5)});

if(process.argv.includes("--finish")){
 const observations=[];
 for(let i=0;i<plan.dataBatches.length;i++)observations.push(...csvJson(await read(dir+`/data-batch-${i}-response.json`)));
 const probe=await read(dir+"/sequence-probe-response.json");
 assert(probe.success);const probeValue=Number(probe.output.trim().split("\n").at(-1));assert(Number.isFinite(probeValue));
 observations.push({id:plan.sequenceProbe.id,original:{violations:probeValue}});
 const sequenceResult=await read(dir+"/sequence-batch-response.json");
 observations.push(...csvJson(sequenceResult.response));
 assert.equal(observations.length,884);assert.equal(new Set(observations.map(x=>x.id)).size,884);
 for(const o of observations){
  const r=planned[o.id];assert.equal(r.status,"PENDING");r.violations=Number(o.original.violations);r.diagnostic=o.diagnostic;
  if(r.violations!==0){r.status="FAILED";r.severity="RED";r.reason=r.kind==="required missing column"?
   "Required column is absent on a populated table; the draft refuses to invent an existing-row mapping.":
   "The unchanged read-only violation query found incompatible data. Diagnose; do not repair.";}
  else if(r.kind==="sequence position"){r.status="WARNING";r.severity="YELLOW";r.reason="Original position SELECT returned zero violations on the replica, but the checked-in gate requires verified primary evidence; cache/replica position is not primary certification.";}
  else{r.status="PASSED";r.severity="GREEN";r.reason="Unchanged original aggregate query returned zero violations.";}
 }
 assert(!planned.some(x=>x.status==="PENDING"));
 const supplemental=csvJson(await read(dir+"/supplemental-response.json"));
 assert.equal(supplemental.identity.database,"neondb");assert(supplemental.identity.replica);
 assert.equal(supplemental.identity.transaction_read_only,"on");
 assert.equal(supplemental.relations.filter(x=>["r","p"].includes(x.kind)).length,91);
 assert.equal(supplemental.relations.filter(x=>x.kind==="S").length,86);
 assert(!supplemental.relations.some(x=>x.row_security_active),"RLS visibility would require a RED evidence gap.");
 const counts=new Map(supplemental.exact_row_counts.map(x=>[x.table_name,Number(x.exact_rows)]));
 const summary={total:1890,passed:planned.filter(x=>x.status==="PASSED").length,
  warnings:planned.filter(x=>x.status==="WARNING").length,failed:planned.filter(x=>x.status==="FAILED").length,
  notApplicable:planned.filter(x=>x.status==="NOT_APPLICABLE").length,blocked:planned.filter(x=>x.status==="BLOCKED_PREREQUISITE").length,
  executed:observations.length,notExecuted:planned.filter(x=>x.status==="BLOCKED_PREREQUISITE").length};
 assert.equal(summary.passed+summary.warnings+summary.failed+summary.notApplicable+summary.blocked,1890);
 const byKind={};
 for(const k of [...new Set(planned.map(x=>x.kind))]){
  const subset=planned.filter(x=>x.kind===k);byKind[k]={total:subset.length,passed:subset.filter(x=>x.status==="PASSED").length,
   warnings:subset.filter(x=>x.status==="WARNING").length,failed:subset.filter(x=>x.status==="FAILED").length,
   blocked:subset.filter(x=>x.status==="BLOCKED_PREREQUISITE").length};
 }
 const coverage={};
 for(const k of Object.keys(expected)){const rows=objectResults.filter(x=>x.section===k);
  coverage[k]={total:rows.length,present:rows.filter(x=>x.state!=="PLANNED MISSING").length,
   green:rows.filter(x=>x.severity==="GREEN").length,yellow:rows.filter(x=>x.severity==="YELLOW").length,red:rows.filter(x=>x.severity==="RED").length};
 }
 const constraintCoverage={};
 for(const kind of ["p","u","c","f"]){const rows=objectResults.filter(x=>x.section==="constraints"&&x.kind===kind);
  constraintCoverage[kind]={total:rows.length,present:rows.filter(x=>x.state!=="PLANNED MISSING").length,
   red:rows.filter(x=>x.severity==="RED").length};}
 const foreignKeys=expected.constraints.filter(c=>c.kind==="f");
 const parentKeyAvailable=r=>actual.indexes.some(i=>i.table_name===r.referenced_table&&i.unique_index&&i.valid&&i.ready&&i.immediate&&
  !i.predicate&&!i.expressions&&i.keys.length===r.referenced_columns.length&&
  JSON.stringify([...i.keys].sort())===JSON.stringify([...r.referenced_columns].sort()));
 const actualFkSupports=actual.constraints.filter(c=>c.kind==="f").map(c=>({constraint:c.name,
  validSupport:actual.indexes.some(i=>i.name===c.supporting_index&&i.table_name===c.referenced_table&&i.unique_index&&i.valid&&i.ready&&i.immediate&&
   !i.predicate&&!i.expressions&&i.keys.length===c.referenced_columns.length&&
   JSON.stringify([...i.keys].sort())===JSON.stringify([...c.referenced_columns].sort()))}));
 assert(actualFkSupports.every(x=>x.validSupport),"Unexpected existing FK support dependency");
 const blockers=[{severity:"RED",object:"Production target binding",problem:"Authorized Production-routed replica is verified; binding to the published runtime primary remains unverified.",
  affected:"Entire 0061–0165 chain / 0060",action:"Operator must bind these observations to the intended production resource/primary without exposing credentials; do not apply based only on database name."}];
 for(const r of planned.filter(x=>x.status==="FAILED")){
  const column=expected.columns.find(c=>c.table_name===r.table&&c.name===r.columns[0]);
  const m=objectResults.find(x=>x.section==="columns"&&x.table===r.table&&x.name===r.columns[0]);
  blockers.push({severity:"RED",object:r.table+"."+r.columns.join(","),problem:`Absent required ${column?.type} column on ${r.violations} existing rows; no approved mapping.`,
   affected:m?.migrations.join(", ")||"Forward column tier",
   action:"Separately define and approve values/provenance for every existing row, plus a reviewed staged mapping/enforcement plan. The current draft refuses automatic/default backfill. No data or draft was fixed.",
   rows:r.violations,canonicalDefault:column?.default_expression});
 }
 blockers.push({severity:"RED",object:"Unassessed prerequisite-dependent data gates",problem:`${summary.blocked} original SELECTs cannot execute because required relations, columns or sequences are absent.`,
  affected:"Forward chain, including 0060 Finance-owned tables",action:"Separately authorize a staged plan that supplies prerequisites and runs these unchanged gates before constraints are enabled/validated. Do not mark missing-source checks as passing; no prerequisite DDL is authorized here."});
 const extraConstraints=[];
 const knownLegacy="(method = ANY (ARRAY['BANK_TRANSFER'::text, 'REMITA'::text, 'FLUTTERWAVE'::text, 'PAYSTACK'::text]))";
 for(const c of actual.constraints){
  if(expected.constraints.some(r=>r.table_name===c.table_name&&signature("constraints",r)===signature("constraints",c)))continue;
  const pk=actual.constraints.find(p=>p.table_name===c.table_name&&p.kind==="p");
  if(c.kind==="u"&&pk&&pk.columns.every(x=>c.columns.includes(x)))extraConstraints.push({table:c.table_name,name:c.name,severity:"GREEN",reason:"Redundant UNIQUE contains existing PK; no additional accepted-domain restriction."});
  else if(c.table_name==="fee_payments"&&c.kind==="c"&&c.columns.length===1&&c.columns[0]==="method"&&c.check_expression===knownLegacy&&!c.deferrable&&!c.initially_deferred&&!c.no_inherit)
   extraConstraints.push({table:c.table_name,name:c.name,severity:"YELLOW",reason:"Exact approved obsolete four-method restriction; present until guarded 0149 retirement. CASH is still restricted today."});
  else{extraConstraints.push({table:c.table_name,name:c.name,severity:"RED",reason:"Unreviewed additional behavioral constraint."});blockers.push({severity:"RED",object:c.table_name+"."+c.name,problem:"Unreviewed retained constraint can restrict canonical semantics.",affected:"Full chain",action:"Review semantic restriction; do not automatically drop/repair."});}
 }
 const extraUniqueIndexes=[];
 for(const i of actual.indexes.filter(i=>i.unique_index)){
  if(expected.indexes.some(r=>r.table_name===i.table_name&&signature("indexes",r)===signature("indexes",i)))continue;
  const pk=actual.constraints.find(p=>p.table_name===i.table_name&&p.kind==="p");
  if(pk&&pk.columns.every(c=>i.keys.includes(c)||i.keys.includes(q(c))))extraUniqueIndexes.push({table:i.table_name,name:i.name,severity:"GREEN",reason:"Contains existing primary key; additional UNIQUE index cannot reject a PK-valid row."});
  else{extraUniqueIndexes.push({table:i.table_name,name:i.name,severity:"RED",reason:"Unreviewed extra unique-index restriction."});blockers.push({severity:"RED",object:i.table_name+"."+i.name,problem:"Additional unique index could restrict canonical behavior.",affected:"Index tier",action:"Review exact key, predicate and expression; no automatic drop."});}
 }
 // Namespace collisions can exist outside a target table and are not detected
 // by a table-scoped catalog lookup.
 const collisions=[];
 for(const r of expected.indexes){const occupied=supplemental.relations.find(x=>x.name===r.name);
  if(occupied&&!actual.indexes.some(x=>x.name===r.name&&x.table_name===r.table_name))collisions.push({name:r.name,wanted:"index",kind:occupied.kind});}
 for(const r of expected.tables){const occupied=supplemental.relations.find(x=>x.name===r.name);if(occupied&&!["r","p"].includes(occupied.kind))collisions.push({name:r.name,wanted:"table",kind:occupied.kind});}
 for(const r of expected.sequences){const occupied=supplemental.relations.find(x=>x.name===r.name);if(occupied&&occupied.kind!=="S")collisions.push({name:r.name,wanted:"sequence",kind:occupied.kind});}
 for(const c of collisions)blockers.push({severity:"RED",object:c.name,problem:"Public namespace occupied by incompatible "+c.kind,affected:"Forward creation tier",action:"Review conflicting object and dependencies; no automatic removal."});
 const financeSource=await fs.readFile("lib/db/drizzle/0060_reconcile_student_subscription_finance.sql","utf8");
 const parents=JSON.parse(financeSource.match(/\$parents\$(.*?)\$parents\$/s)[1]);
 const financeParents=parents.map(p=>{
  const pk=actual.constraints.find(c=>c.table_name===p.table_name&&c.kind==="p");
  const indices=actual.indexes.filter(i=>i.table_name===p.table_name&&i.unique_index&&i.immediate&&i.valid&&i.ready&&!i.predicate&&!i.expressions&&
   i.keys.length===p.columns.length&&JSON.stringify([...i.keys].sort())===JSON.stringify([...p.columns].sort()));
  const canonical=expected.constraints.find(c=>c.table_name===p.table_name&&c.kind==="u"&&JSON.stringify(c.columns)===JSON.stringify(p.columns));
  const standalone=expected.indexes.find(i=>i.table_name===p.table_name&&i.unique_index&&!i.owner_constraint&&JSON.stringify(i.keys)===JSON.stringify(p.columns));
  const data=planned.find(s=>s.table===p.table_name&&(s.kind==="u"&&s.object===canonical?.name||s.kind==="unique index"&&s.object===standalone?.name));
  return{table:p.table_name,columns:p.columns,columnsAvailable:p.columns.every(c=>haveCol(p.table_name,c)),qualifyingKeyPresent:indices.length>0,
   existingPrimaryKey:pk?.columns,dataGate:data?.status,violations:data?.violations,
   state:indices.length?"Existing qualifying parent key":"Staged key creation needed; existing PK implies uniqueness if included in the target key."};
 });
 const financeSet=new Set(["subscriptions","student_subscription_payments","student_subscription_allocations","school_partner_attributions","commission_rules","fee_invoices","fee_payments"]);
 const financeSpecs=planned.filter(s=>financeSet.has(s.table));
 const ownership=planned.filter(s=>s.kind==="f"&&s.columns.includes("student_id")&&s.columns.includes("school_id"));
 const financeOwnership=ownership.filter(s=>financeSet.has(s.table));
 const subsetStats=rows=>({total:rows.length,passed:rows.filter(x=>x.status==="PASSED").length,
  warnings:rows.filter(x=>x.status==="WARNING").length,failed:rows.filter(x=>x.status==="FAILED").length,blocked:rows.filter(x=>x.status==="BLOCKED_PREREQUISITE").length});
 const totals={rowsExamined:0,nullSkipped:0,orphans:0,crossSchool:0,otherOwnership:0};
 for(const s of planned)if(s.diagnostic){totals.rowsExamined+=Number(s.diagnostic.total_rows_examined);totals.nullSkipped+=Number(s.diagnostic.null_skipped_rows);
  totals.orphans+=Number(s.diagnostic.orphan_rows);totals.crossSchool+=Number(s.diagnostic.cross_school_mismatches);totals.otherOwnership+=Number(s.diagnostic.other_ownership_mismatches);}
 const cashChecks=actual.constraints.filter(c=>c.table_name==="fee_payments"&&c.kind==="c"&&c.columns.includes("method"));
 const cashUnknown=cashChecks.filter(c=>c.check_expression!==knownLegacy&&!expected.constraints.some(r=>r.table_name==="fee_payments"&&signature("constraints",r)===signature("constraints",c)));
 assert.equal(cashUnknown.length,0);
 const integrity={preflightSourceHash:sha(preflightBytes),preflightLogicUnchanged:true,draftHashesUnchanged:true,historicalHashesUnchanged:true,journalUnchanged:true,applicationProtectedFilesUnchanged:true,finance0060Unchanged:true};
 for(const m of manifest.migrations)assert.equal(sha(await fs.readFile("lib/db/drizzle/"+m.name)),m.sha256);
 for(const [f,h]of Object.entries(manifest.originalHashes))assert.equal(sha(await fs.readFile("lib/db/drizzle/"+f)),h);
 assert.equal(sha(await fs.readFile("lib/db/drizzle/meta/_journal.json")),manifest.journalHash);
 const prior=await read("reports/schema-2i-correction/before.json");assert.equal(sha(preflightBytes),prior.preflightHash);
 assert.equal(sha(financeSource),"a827ad709347eaa22b9bf70a4c2a4012f2c2bd86c5ba3d624623710f98d41f57");
 const protectedFiles=await read("reports/schema-2h/protected-before.json");for(const [f,h]of Object.entries(protectedFiles))assert.equal(sha(await fs.readFile(f)),h);
 const historicalOwnership=csvJson(await read(dir+"/historical-ownership-response.json"));
 if(Number(historicalOwnership.violations)!==0)blockers.push({severity:"RED",object:"subscriptions(student_id,school_id)",problem:"Historical original-school ownership mismatch.",affected:"0060 Finance ownership prerequisites",action:"Review original-school history and retention model; never reparent historical Finance to silently satisfy the current student-school relationship."});
 const result={status:"BLOCKED — DO NOT APPLY MIGRATIONS",summary,byKind,coverage,constraintCoverage,blockers,
  target:{...supplemental.identity,runtimeBinding:"TARGET BINDING UNVERIFIED",resourceIdentity:"Platform callback environment=production; resource/deployment database ID not exposed.",
   authorizedRoute:true,publicTables:91,rlsActiveTables:0},
  extraConstraints,extraUniqueIndexes,namespaceCollisions:collisions,aggregateCompatibility:totals,
  foreignKeyMetadata:{required:foreignKeys.length,currentlyQualifiedParentKeys:foreignKeys.filter(parentKeyAvailable).length,
   actualFkSupportDependenciesVerified:actualFkSupports.length,invalidActualSupportDependencies:0,
   comparisons:"Referenced schema/table/ordered child and parent columns/MATCH/ON DELETE/ON UPDATE/deferrability and validation reviewed; equivalent current OIDs and stronger validation retained."},
  finance:{migration0060Unchanged:true,parents:financeParents,prerequisiteRowsCompatible:financeParents.every(p=>p.columnsAvailable&&p.dataGate==="PASSED"),
   existingQualifyingParentKeys:financeParents.filter(p=>p.qualifyingKeyPresent).length,
   twoOwnedTablesAbsent:true,dataGateStats:subsetStats(financeSpecs),dataGateIds:financeSpecs.map(s=>s.id),status:"YELLOW — forward parent prerequisites needed; absent Finance tables cannot be data-tested in this read-only stage."},
  ownership:{historicalFinanceMustRetainOriginalSchool:true,allStudentSchool:subsetStats(ownership),financeStudentSchool:subsetStats(financeOwnership),
   supplementalHistoricalSubscriptionOwnership:historicalOwnership,
   financeRelationships:financeOwnership.map(s=>({table:s.table,object:s.object,status:s.status,violations:s.violations,...s.diagnostic})),
   rule:"Never fix an ownership mismatch by moving historical payments, allocations, receipt, attribution or commission history to the student's current school."},
  cash:{obsoleteNamedCheckPresent:cashChecks.some(c=>c.name==="fee_payments_method_check"),exactApprovedObsoleteDefinition:true,
   unknownMethodChecks:0,replacementCurrentlyPresent:cashChecks.some(c=>c.name==="fee_payments_method_with_cash_check"),status:"YELLOW — approved controlled retirement still required; no conflicting unreviewed method CHECK observed.",
   migration0149SafeOnlyAfterValidatedCanonicalReplacement:true,productionCashBehaviorRestored:false},
  rowScale:{totalPublicTableRows:[...counts.values()].reduce((a,b)=>a+b,0),counts:supplemental.exact_row_counts,maximumTableBytes:Math.max(...scale.map(s=>s.bytes)),
   sequencesWithObservedCatalogPosition:actual.sequences.filter(s=>s.observed_last_value!==null).length},
  specResults:planned,integrity,scopeNotes:plan.notes,
  safety:{productionWrites:0,productionSchemaChanges:0,developmentWrites:0,sharedDatabaseWrites:0,migrationsExecuted:0,
   dbPush:"NO",publishDeploy:"NO",journalChanges:"NO",secretsEnvironmentChanges:"NO",applicationChanges:"NO",previousDisposableDatabases:"Untouched; no private cluster started or recreated."}};
 await fs.writeFile(dir+"/result.json",JSON.stringify(result,null,2));
 const {specResults:excludedSpecResults,...compactReport}=result;
 compactReport.blockedPrerequisiteGroups=Object.entries(planned.filter(s=>s.status==="BLOCKED_PREREQUISITE").reduce((a,s)=>(a[s.table]=(a[s.table]??0)+1,a),{}))
  .map(([table,checks])=>({table,checks})).sort((a,b)=>b.checks-a.checks);
 await fs.writeFile(dir+"/report-input.json",JSON.stringify(compactReport,null,2));
 console.log("FINAL",result.status,summary,"compatibility",totals,"finance",result.finance,"ownership",result.ownership,"collisions",collisions);
}
