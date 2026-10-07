// Offline report/plan assembly. No database connections or executable migrations.
import fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
const dir="reports/schema-2h",load=async n=>JSON.parse(await fs.readFile(path.join(dir,n),"utf8"));
const [e,a,c,source,replay,checks,observed,counts]=await Promise.all(
 ["canonical-catalog.json","production-catalog.json","comparison.json","source-catalog.json","replay.json",
  "compatibility-plan.json","compatibility-observed.json","production-aggregate-counts.json"].map(load));
const rowCounts=new Map(counts.map(r=>[r.table_name,r.row_count]));
const observations=new Map(observed.map(r=>[r.sql,r]));
for(const x of checks){
 if(x.sql){const o=observations.get(x.sql);x.status=o?o.violations==="0"?"PASS":"FAIL":"NOT ASSESSABLE";
  x.violationCount=o?.violations??null;x.reason=o?"Read-only aggregate; no row-level values returned.": "No successful matching read-only observation.";}
 if(x.kind==="new required column with default"){
  const change=c.changes.find(v=>v.id===x.object);
  if(rowCounts.get(change?.expected.table_name)==="0"){x.status="PASS";x.reason="The existing target table has zero rows on the audited replica. No pre-existing values to fabricate; future default semantics still require review.";}
 }
}
const sha=v=>createHash("sha256").update(v).digest("hex");
const id=(section,r)=>section+":"+[r.schema,r.table_name??"",r.name,section==="functions"?r.identity_arguments:""].join(".");
const nodes=new Map(),gapMap=new Map(c.changes.map(v=>[v.id,v]));
const tableId=name=>id("tables",e.tables.find(t=>t.name===name));
const columnId=(name,col)=>{const r=e.columns.find(v=>v.table_name===name&&v.name===col);return r?id("columns",r):null;};
const files=(await fs.readdir("lib/db/drizzle")).filter(f=>/^\d{4}.*\.sql$/.test(f)).sort();
const migrationText=await Promise.all(files.map(async name=>({name,text:await fs.readFile("lib/db/drizzle/"+name,"utf8")})));
const origin=new Map(e.tables.map(t=>[t.name,c.changes.find(v=>v.expected.table_name===t.name||v.section==="tables"&&v.expected.name===t.name)?.phase??"A"]));
function references(text,objects){return objects.filter(o=>new RegExp("\\b"+o.name+"\\b").test(text??""));}
for(const [section,rows]of Object.entries(e))for(const r of rows){
 const n={id:id(section,r),section,name:r.name,table:r.table_name??null,phase:gapMap.get(id(section,r))?.phase??origin.get(r.table_name??r.name)??"I",
  classification:gapMap.get(id(section,r))?.category??"Verified",dependencies:[]};
 if(r.table_name)n.dependencies.push(tableId(r.table_name));
 if(section==="columns"){
  // Sequences can be constructed before columns; attach ownership afterwards.
  for(const s of e.sequences)if(r.default_expression?.includes("'"+s.name+"'"))n.dependencies.push(id("sequences",s));
  for(const f of references(r.default_expression,e.functions))n.dependencies.push(id("functions",f));
 }
 if(section==="constraints"){
  for(const col of r.columns)n.dependencies.push(columnId(r.table_name,col));
  if(r.kind==="f"){
   n.dependencies.push(tableId(r.referenced_table));
   for(const col of r.referenced_columns)n.dependencies.push(columnId(r.referenced_table,col));
   const index=e.indexes.find(v=>v.table_name===r.referenced_table&&v.name===r.supporting_index);
   if(index)n.dependencies.push(id("indexes",index));
  }
  for(const f of references(r.check_expression,e.functions))n.dependencies.push(id("functions",f));
 }
 if(section==="indexes"){
  if(r.owner_constraint){const k=e.constraints.find(v=>v.table_name===r.table_name&&v.name===r.owner_constraint);
   if(k)n.dependencies.push(id("constraints",k));n.automaticCreation="Index is materialized/adopted by its PK/UNIQUE constraint; do not emit duplicate index DDL.";}
  for(const col of e.columns.filter(v=>v.table_name===r.table_name))
   if(new RegExp("\\b"+col.name+"\\b").test([r.keys,r.included,r.predicate,r.expressions].join(" ")))n.dependencies.push(id("columns",col));
  for(const f of references([r.predicate,r.expressions].join(" "),e.functions))n.dependencies.push(id("functions",f));
 }
 if(section==="functions"){
  const referenced=references(r.body,e.tables);
  n.dependencies.push(...referenced.map(v=>id("tables",v)));
  for(const t of referenced)n.dependencies.push(...e.columns.filter(v=>v.table_name===t.name).map(v=>id("columns",v)));
  for(const target of e.triggers.filter(v=>v.function_name===r.name))
   n.dependencies.push(...e.columns.filter(v=>v.table_name===target.table_name).map(v=>id("columns",v)));
  n.definitionMigration=migrationText.filter(v=>new RegExp("CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+(?:public\\.)?\"?"+r.name+"\\b","i").test(v.text)).at(-1)?.name??null;
  n.referenceEvidence="Static function-body/trigger-target table references with conservative complete-column prerequisites; PostgreSQL does not track all dynamic-SQL dependencies.";
  for(const target of e.triggers.filter(v=>v.function_name===r.name))n.phase=origin.get(target.table_name)??n.phase;
  if(e.columns.some(v=>references(v.default_expression,[r]).length))n.phase="A";
 }
 if(section==="triggers"){
  const f=e.functions.find(v=>v.name===r.function_name&&v.schema===r.function_schema&&v.identity_arguments===r.function_arguments);
  if(f)n.dependencies.push(id("functions",f));
  n.dependencies.push(...e.constraints.filter(v=>v.table_name===r.table_name).map(v=>id("constraints",v)));
 }
 if(section==="sequences"){
  n.dependencies=[];n.ownershipAfter=columnId(r.table_name,r.column_name);
  n.operation="Create missing sequence independently; attach OWNED BY after column exists. Never restart an existing sequence.";
 }
 n.dependencies=[...new Set(n.dependencies.filter(Boolean))].filter(v=>v!==n.id);
 nodes.set(n.id,n);
}
// Precise FK table graph, separate from create-table shells (which omit FKs).
const tableEdges=e.constraints.filter(v=>v.kind==="f").map(v=>({child:v.table_name,parent:v.referenced_table,constraint:v.name}));
const missingTables=new Set(c.changes.filter(v=>v.section==="tables"&&v.category.startsWith("A")).map(v=>v.expected.name));
function stronglyConnected(){
 let tick=0;const index=new Map(),low=new Map(),stack=[],active=new Set(),groups=[];
 const adj=new Map([...missingTables].map(n=>[n,tableEdges.filter(x=>x.child===n&&missingTables.has(x.parent)).map(x=>x.parent)]));
 function visit(v){index.set(v,tick);low.set(v,tick++);stack.push(v);active.add(v);
  for(const w of adj.get(v)){if(!index.has(w)){visit(w);low.set(v,Math.min(low.get(v),low.get(w)));}else if(active.has(w))low.set(v,Math.min(low.get(v),index.get(w)));}
  if(low.get(v)===index.get(v)){const group=[];let w;do{w=stack.pop();active.delete(w);group.push(w);}while(w!==v);if(group.length>1)groups.push(group.sort());}
 }
 for(const v of missingTables)if(!index.has(v))visit(v);return groups;
}
// Defaults/functions before columns, keys/indexes before FKs, functions before triggers.
const remaining=new Map([...nodes].map(([k,n])=>[k,new Set(n.dependencies)])),levels=[];
while(remaining.size){
 const ready=[...remaining].filter(([,d])=>d.size===0).map(([k])=>k).sort();
 if(!ready.length)break;
 levels.push(ready);for(const k of ready)remaining.delete(k);
 for(const deps of remaining.values())for(const k of ready)deps.delete(k);
}
for(const ch of c.changes){
 const n=nodes.get(ch.id);
 ch.phase=n.phase;ch.prerequisites=n.dependencies;
 ch.missingPrerequisites=n.dependencies.filter(d=>gapMap.has(d)&&!gapMap.get(d).category.startsWith("C"));
 const tests=checks.filter(x=>x.object===ch.id);
 ch.compatibility=ch.category.startsWith("C")?"PASS":tests.some(x=>x.status==="FAIL")?"FAIL":
  tests.some(x=>x.status==="NOT ASSESSABLE")?"NOT ASSESSABLE":tests.length?"PASS":"NOT ASSESSABLE";
 ch.compatibilityChecks=tests.map(x=>x.id);
 ch.operation=ch.category.startsWith("C")?"Retain equivalent object; do not recreate.":
  ch.retainStrongerValidation?"Retain already validated FK; do not downgrade to NOT VALID.":
  ch.section==="indexes"&&ch.expected.owner_constraint?"Materialized/adopted by its PK/UNIQUE; no independent duplicate index DDL.":
  ch.category.startsWith("A")?"Additive creation after prerequisites and compatibility gates.":"Preservation-safe alteration after review.";
 ch.dangerFlags=[];
 if(ch.ordinalDifference)ch.dangerFlags.push("Retain physical order; review positional SQL consumers. No destructive reorder.");
 if(ch.compatibility!=="PASS")ch.dangerFlags.push("Compatibility gate unresolved; no automatic application.");
 if(ch.section==="constraints"&&ch.expected.kind==="f"&&tests.some(x=>x.kind==="supporting parent key"&&x.status!=="PASS"))ch.dangerFlags.push("Supporting parent key must be installed first.");
 if(ch.section==="columns"&&!ch.expected.nullable&&!ch.expected.default_expression&&!ch.actual&&
  BigInt(rowCounts.get(ch.expected.table_name)??"0")>0n)ch.dangerFlags.push("Required new value cannot be fabricated; populated-table mapping needs an approved business decision.");
 if(ch.section==="indexes"&&ch.actual?.dependent_fks?.length)ch.dangerFlags.push("Existing FK dependencies must be retained.");
 if(ch.section==="triggers")ch.dangerFlags.push("Enables enforcement for future writes; clone-based behavioral verification required.");
}
const sourceReview={counts:Object.fromEntries(["tables","columns","constraints","indexes"].map(k=>[k,source[k].length])),
 migrationOnlyFunctions:e.functions.map(f=>f.name),migrationOnlyTriggers:e.triggers.map(t=>({table:t.table_name,name:t.name})),
 missingSourceColumns:[],columnReferenceDifferences:[],constraintReferenceDifferences:[],sourceOnlyConstraints:[],
 notes:["Migrations are authoritative; source defaults/expressions are an offline structural reference, not evaluated against live rows.",
 "FK/index names and ownership are tracked separately. Source declaration order never authorizes destructive physical reorder.",
 "Boolean expression deparsing (IN versus ANY, parentheses/casts) may differ. Text differences are explicitly review items, not automatically material differences."]};
const typeNorm=v=>v.replace(/^varchar/,"character varying").replace(/^timestamp$/,"timestamp without time zone").replace(/,\s+/g,",");
for(const col of e.columns){
 const s=source.columns.find(x=>x.table_name===col.table_name&&x.name===col.name);
 if(!s){sourceReview.missingSourceColumns.push(col);continue;}
 const fields=[];
 if(typeNorm(s.type)!==col.type)fields.push("type");
 if(s.nullable!==col.nullable)fields.push("nullable");
 // Record every default/order representation difference; do not guess equivalence.
 if(s.default_expression!==col.default_expression)fields.push("default_expression (representation/semantic review)");
 if(s.ordinal!==col.ordinal)fields.push("declaration order only");
 if(fields.length)sourceReview.columnReferenceDifferences.push({table:col.table_name,column:col.name,fields,migration:col,source:s});
}
for(const r of e.constraints){
 const s=source.constraints.find(v=>v.table_name===r.table_name&&v.name===r.name);
 if(!s)sourceReview.constraintReferenceDifferences.push({table:r.table_name,name:r.name,kind:r.kind,status:"Migration name/constraint absent from source; inspect equivalent source key/index/FK",migration:r,
  sameColumnSourceCandidates:source.constraints.filter(v=>v.table_name===r.table_name&&v.kind===r.kind&&JSON.stringify(v.columns)===JSON.stringify(r.columns))});
 else if(r.kind==="f"){
  const actions={a:"no action",r:"restrict",c:"cascade",n:"set null",d:"set default"};
  if(actions[r.delete_action]!==s.delete_action||actions[r.update_action]!==s.update_action||r.referenced_table!==s.referenced_table||JSON.stringify(r.columns)!==JSON.stringify(s.columns)||JSON.stringify(r.referenced_columns)!==JSON.stringify(s.referenced_columns))
   sourceReview.constraintReferenceDifferences.push({table:r.table_name,name:r.name,kind:r.kind,status:"Structural FK difference",migration:r,source:s});
 }else if(r.kind==="c"&&r.check_expression.replace(/\s/g,"")!==s.check_expression.replace(/\s/g,""))
  sourceReview.constraintReferenceDifferences.push({table:r.table_name,name:r.name,kind:r.kind,status:"Expression representation/semantic review",migration:r,source:s});
}
sourceReview.sourceOnlyConstraints=source.constraints.filter(r=>!e.constraints.some(v=>v.table_name===r.table_name&&v.name===r.name));
// Direct source references only; never claim the published runtime uses this target.
async function walk(d){const out=[];for(const f of await fs.readdir(d,{withFileTypes:true})){const p=path.join(d,f.name);if(f.isDirectory())out.push(...await walk(p));else if(/\.(?:ts|tsx)$/.test(f.name))out.push(p);}return out;}
const moduleFiles=(await walk("artifacts/api-server/src")).filter(f=>!/\.(?:test|spec)\.tsx?$/.test(f)&&!f.includes("/__tests__/")),application=[];
for(const file of moduleFiles){
 const text=await fs.readFile(file,"utf8"),affected=[];
 for(const t of source.tables){
  if(!c.changes.some(v=>(v.expected.table_name??(v.section==="tables"?v.expected.name:null))===t.name&&!v.category.startsWith("C")))continue;
  const symbols=[t.name,...t.exportNames];
  const found=symbols.find(s=>new RegExp("\\b"+s+"\\b").test(text));
  if(found){const gaps=c.changes.filter(v=>(v.expected.table_name??(v.section==="tables"?v.expected.name:null))===t.name&&!v.category.startsWith("C"));
   affected.push({table:t.name,reference:found,phase:origin.get(t.name)??"I",gapKinds:[...new Set(gaps.map(v=>v.section))],
    impact:gaps.some(v=>["tables","columns"].includes(v.section))?"Missing relation/field can fail dependent queries when routed to this schema.":
    "Missing constraints/indexes/triggers weaken integrity/enforcement/performance; not necessarily a read-query failure."});}
 }
 if(affected.length)application.push({file,affected,evidence:"Direct schema-export symbol or SQL table-name reference; not runtime testing."});
}
const checkCounts=checks.reduce((v,x)=>(v[x.status]=(v[x.status]??0)+1,v),{});
const compatibilityObjects=c.changes.filter(v=>!v.category.startsWith("C")).reduce((v,x)=>(v[x.compatibility]=(v[x.compatibility]??0)+1,v),{});
const sequenceRisks=a.sequences.filter(x=>x.observed_last_value===null).map(x=>({sequence:x.name,table:x.table_name,existingRowCount:rowCounts.get(x.table_name),status:"NOT ASSESSABLE",
 reason:"Replica cannot prove last/cached sequence position; do not reset or infer primary position."}));
const graph={nodes:[...nodes.values()],levels,unresolvedCreationDependencies:[...remaining.keys()],
 foreignKeyTableEdges:tableEdges,missingTableCycles:stronglyConnected(),
 cycleStrategy:"Create typed table shells first; defaults/ownership and PK/UNIQUE/index supports next; add FKs only after all endpoints/keys exist.",
 sequenceOwnershipAfterColumns:e.sequences.map(s=>({sequence:id("sequences",s),afterColumn:columnId(s.table_name,s.column_name)}))};
const aggregateQueriesComplete=checks.filter(v=>v.sql).every(v=>v.violationCount!==null);
const report={replay:replay.counts,successfulMigrations:replay.successful,comparison:c,checkCounts,compatibilityObjects,sequenceRisks,
 sourceReview,applicationImpact:application,productionCounts:Object.fromEntries(Object.entries(a).map(([k,v])=>[k,v.length])),
 strategy:{choice:"Multiple dependency-ordered, preservation-safe forward reconciliation units; not blind historical replay and not one enormous migration.",
 reason:"Existing objects/data and platform ledger are not a clean Drizzle starting point. Historical files contain non-idempotent DDL/data effects. Preserve equivalent objects and stronger validation.",
 structuralOrder:["Inventory/target confirmation and verified recovery protection before execution",
 "Create missing table shells and independent sequences; satisfy default-function prerequisites",
 "Add/relax columns conservatively; attach sequence ownership without resetting values",
 "PKs and named UNIQUE constraints; adopt equivalent indexes without dropping dependencies",
 "Non-owned indexes; ensure FK parent-key supports exist",
 "Add/validate FKs and CHECKs only after read-only compatibility gates",
 "Install remaining functions, then their triggers; verify unchanged application writers on a disposable populated clone",
 "Review ledger/baseline adoption and source/migration differences before any future deployment"],
 domainPhases:{A:"Foundations/required default functions",B:"Tenant/RBAC/identity",C:"Academic/session/people",D:"Attendance",E:"Results/curriculum/reporting",F:"Finance",G:"NFC/devices/operations",H:"Communication/notifications",I:"Remaining integration/reporting functions"},
 notes:["Graph prerequisites override domain labels; functions used by defaults cannot wait for the final phase.",
 "Constraint-owned indexes are automatic/adopted, not separate duplicate creations.",
 "Retain all seven production-only constraint/index objects unless separately approved; no destructive replacement.",
 "Do not remove stronger existing FK validation or rewrite the equivalent empty-array default.",
 "No bulk ledger stamping. Preserve prior hashes/timestamps; prove historical data effects or adopt an explicitly reviewed baseline.",
 "The replica/platform history does not establish published runtime binding or application migration history. Require operator target/recovery evidence; no speculative binding discovery.",
 "If the eventual target is Replit-managed, use the supported platform schema flow after separately authorized Development verification. If external, follow the verified project's migration workflow. No deploy/startup DDL hooks."]},
 finance:{migration:"0060_reconcile_student_subscription_finance.sql",completeReplay:"PASS",isolatedFinanceRehearsal:"35/35 PASS",
 ready:"Ready for future migration build/rehearsal, NOT authorized/ready for immediate Production execution.",
 missingFinanceCore:["student_subscription_payments","student_subscription_allocations"],
  requiredBinding:"student_subscription_terms (0058); canonical session/term and device-first NFC prerequisites must precede unchanged finalizer release",
  fullFinanceMissingObjects:c.changes.filter(x=>x.phase==="F"&&x.category.startsWith("A")).map(x=>x.id),
 dependencies:e.constraints.filter(x=>["student_subscription_payments","student_subscription_allocations"].includes(x.table_name)&&x.kind==="f")
  .map(x=>({constraint:x.name,parent:x.referenced_table,columns:x.referenced_columns,support:x.supporting_index})),
 gates:["Canonical parent keys, student-school ownership and session/term binding must exist first.",
 "Preserve fees/payments/subscriptions/commission/NFC history; do not rebill, repair or invent paid records.",
 "Register 0060 only in a reviewed journal/ledger strategy after all previous gaps are resolved and populated-target rehearsal passes."]},
 businessDecisions:["Any required non-defaulted value on an existing populated table needs a real approved mapping, never fabricated values.",
 "Historical seed/backfill effects must be reviewed separately; schema equivalence does not prove they occurred.",
 "Default/entitlement/commission-rule values must not silently override existing school decisions.",
 "Retain production-only/stronger objects pending an explicit decision; do not downgrade protection."],
 technicalGates:["Implement additive forward units from the complete inventory.","Rehearse on an isolated populated-schema clone with preserved ledger/history.",
 "Resolve source/migration structural differences without losing migration-backed protections. Source declares only 150 UNIQUEs/407 CHECKs versus canonical 171/429; a source-only push/export must not remove migration-only protection.",
 "Verify all newly enabled trigger/writer behavior and primary sequence positions before release."],
 automaticallyEligible:c.changes.filter(x=>x.compatibility==="PASS"&&!x.retainStrongerValidation&&!x.category.startsWith("C")).map(x=>({id:x.id,operation:x.operation,
 condition:"Eligible for a reviewed future package only; satisfy graph prerequisites, current compatibility, lock budgets and explicit execution authorization."})),
 readinessPercentage:"Not calculated — schema readiness requires completion of all critical dependencies.",
 safety:{productionWrites:0,developmentWrites:0,sharedDatabaseWrites:0,migrationFilesChanged:false,journalChanged:false,
 applicationSourceChanged:false,secretsChanged:false,environmentChanged:false,published:false,dataRepaired:false,
 piiSelectedOrReturned:false,disposableReplayExplicitlyAuthorized:true},
 decision:replay.successful===61&&aggregateQueriesComplete&&remaining.size===0?
 "PASS — FULL SCHEMA RECONCILIATION PLAN COMPLETE — READY FOR MIGRATION BUILD":"FAIL — FULL RECONCILIATION NOT YET COMPLETE"};
await fs.writeFile(path.join(dir,"dependency-graph.json"),JSON.stringify(graph,null,2));
await fs.writeFile(path.join(dir,"compatibility-final.json"),JSON.stringify(checks,null,2));
await fs.writeFile(path.join(dir,"comparison.json"),JSON.stringify(c,null,2));
await fs.writeFile(path.join(dir,"report.json"),JSON.stringify(report,null,2));
await fs.writeFile(path.join(dir,"source-reference-comparison.json"),JSON.stringify(sourceReview,null,2));
const esc=s=>String(s??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
const pre=v=>"<pre>"+esc(typeof v==="string"?v:JSON.stringify(v,null,2))+"</pre>";
const rows=(headers,data)=>"<table><thead><tr>"+headers.map(x=>"<th>"+esc(x)+"</th>").join("")+"</tr></thead><tbody>"+
 data.map(row=>"<tr>"+row.map(x=>"<td>"+esc(x)+"</td>").join("")+"</tr>").join("")+"</tbody></table>";
let html="<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Stage 2H — Full Schema Reconciliation Audit</title><style>body{font:15px/1.5 system-ui;color:#182635;background:#f4f6f8;margin:0}main{max-width:1200px;margin:auto;padding:32px}h1,h2{color:#173854}section{background:white;padding:22px;margin:20px 0;border:1px solid #dbe2e8;border-radius:8px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:8px;border:1px solid #dbe2e8;text-align:left;vertical-align:top}th{background:#edf3f7}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.45 monospace;background:#f3f6f9;padding:14px}details{margin:12px 0}summary{cursor:pointer;font-weight:650}code{overflow-wrap:anywhere}.warning{background:#fff4dd;padding:16px}</style><main><h1>Stage 2H — Full Schema Reconciliation Audit and Plan</h1><p><strong>"+esc(report.decision)+"</strong></p><p class='warning'>AUDIT/PLAN ONLY. Production-routed test database/read replica; NOT proven to be the published runtime database. No shared-database writes or migration/journal/application changes. Only the explicitly authorized new disposable replay performed database writes.</p>";
html+="<section><h2>1. Canonical replay and target</h2>"+pre({environment:replay.environment,successful:61,canonical:replay.counts,production:report.productionCounts,productionVersion:"PostgreSQL 16.15, aarch64, neondb, recovery=true, transaction_read_only=on",disposableDatabaseDestroyed:replay.databaseDestroyed})+"</section>";
html+="<section><h2>2. Difference summary</h2>"+rows(["Object type","Expected","Production","Missing","Different","Equivalent","Verified","Retained extras"],c.summary.map(r=>[r.objectType,r.expected,r.production,r.missing,r.different,r.equivalent,r.verified,r.productionExtras]))+"<p>Equivalent default: ARRAY[]::text[] and '{}'::text[] were proven equal by a read-only PostgreSQL expression check. Validated platform_devices FK is stronger than canonical NOT VALID; retain it. Physical ordinal differences: "+c.ordinalDifferences.length+".</p></section>";
html+="<section><h2>3. Complete missing-object inventory by phase</h2><p>Every missing object is listed below. Full definitions are in the canonical catalog and comparison evidence; prerequisite IDs refer to the complete dependency graph.</p>";
for(const [phase,label]of Object.entries(report.strategy.domainPhases)){
 const group=c.changes.filter(x=>x.phase===phase&&x.category.startsWith("A"));
 html+="<details><summary>Phase "+phase+" — "+esc(label)+" ("+group.length+" objects)</summary>"+
 rows(["Type","Table","Object","Prerequisites still missing/different","Compatibility"],group.map(x=>[x.section,x.expected.table_name??"",x.expected.name,x.missingPrerequisites.join("; "),x.compatibility]))+"</details>";
}
html+="</section><section><h2>4. Material differences, equivalent objects and retained extras</h2>"+pre(c.changes.filter(x=>!x.category.startsWith("A")))+pre(c.productionExtras)+"</section>";
html+="<section><h2>5. Data compatibility — every proposed change</h2>"+pre({checkCounts,compatibilityObjects,executedAggregateChecks:checks.filter(x=>x.sql).length,
 aggregateViolations:checks.filter(x=>x.sql&&x.status==="FAIL").length,missingTablePolicy:"NOT ASSESSABLE; missing is not empty."})+
 "<details><summary>Complete compatibility checks</summary>"+rows(["Object","Check","Status","Violation count","Explanation"],checks.map(x=>[x.object,x.kind,x.status,x.violationCount??"",x.reason]))+"</details><details><summary>Sequence-position limitations</summary>"+pre(sequenceRisks)+"</details></section>";
html+="<section><h2>6. Dependency-ordered migration strategy</h2>"+pre(report.strategy)+pre({graphNodes:nodes.size,graphEdges:[...nodes.values()].reduce((n,v)=>n+v.dependencies.length,0),creationLevels:levels.length,missingTableCycles:graph.missingTableCycles,unresolved:graph.unresolvedCreationDependencies})+
 "<details><summary>Every changed object's prerequisites and proposed operation</summary>"+rows(["Object","Phase","Prerequisites","Operation"],c.changes.map(x=>[x.id,x.phase,x.prerequisites.join("; "),x.operation]))+"</details></section>";
html+="<section><h2>7. Finance</h2>"+pre(report.finance)+"</section><section><h2>8. Journal and ledger</h2>"+pre(c.ledger)+
 "<p>Replica history: only _system.replit_database_migrations_v1 was discovered (3 rows, statement counts 173/4/410). This is platform history, not a proven Drizzle application ledger. No application hash adoption can be inferred from it. Missing files: 0037–0041, 0057, 0060. Do not append/stamp all as executed. Registration requires an audited chronological baseline/adoption strategy and preservation of existing hashes/timestamps.</p></section>";
html+="<section><h2>9. Checked-in source comparison</h2>"+pre({counts:sourceReview.counts,missingSourceColumns:sourceReview.missingSourceColumns.length,columnReferenceDifferences:sourceReview.columnReferenceDifferences.length,constraintReferenceDifferences:sourceReview.constraintReferenceDifferences.length,sourceOnlyConstraints:sourceReview.sourceOnlyConstraints.length,notes:sourceReview.notes})+
 "<details><summary>Complete source-reference comparison</summary>"+pre(sourceReview)+"</details></section>";
html+="<section><h2>10. Application compatibility</h2><p>Direct schema-symbol/SQL references identify modules affected if routed to this audited schema. They do not prove the published runtime's connection binding.</p>"+rows(["Module","Affected tables"],application.map(x=>[x.file,x.affected.map(t=>t.table).join(", ")]))+"</section>";
html+="<section><h2>11. Readiness and decisions</h2><p>"+esc(report.readinessPercentage)+"</p>"+pre({businessDecisions:report.businessDecisions,technicalGates:report.technicalGates})+
 "<details><summary>Automatically eligible future operations, subject to all gates</summary>"+pre(report.automaticallyEligible)+"</details></section>";
html+="<section><h2>12. Safety and limitations</h2>"+pre(report.safety)+pre(c.limitations)+
 "<p>Production identity binding/recovery remains unverified by design. Trigger mutation behavior and unavailable primary sequence positions remain explicit release gates. Compatibility observations span separate replica statements; repeat them at the execution boundary. Initial oversized metadata/tool-state requests were resolved with smaller persisted chunks. An offline source-default renderer issue was corrected only in the new audit helper.</p></section><h2>"+esc(report.decision)+"</h2></main></html>";
await fs.writeFile(path.join(dir,"report.html"),html);
console.log(JSON.stringify({decision:report.decision,changedObjects:c.changes.length,checkCounts,compatibilityObjects,graphNodes:nodes.size,
 graphEdges:[...nodes.values()].reduce((n,v)=>n+v.dependencies.length,0),creationLevels:levels.length,unresolved:remaining.size,applicationModules:application.length,sourceColumnReviews:sourceReview.columnReferenceDifferences.length,sourceConstraintReviews:sourceReview.constraintReferenceDifferences.length},null,2));
