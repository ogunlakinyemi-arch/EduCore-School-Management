// ONE focused private-cluster pass. Never imports an application DB client.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {createHash} from "node:crypto";
const dir="reports/schema-2i-correction",read=async p=>JSON.parse(await fs.readFile(p,"utf8"));
const hash=v=>createHash("sha256").update(v).digest("hex"),q=s=>'"'+s.replaceAll('"','""')+'"';
const manifest=await read("reports/schema-2i/manifest.json"),before=await read(dir+"/before.json");
const expected=await read("reports/schema-2h/canonical-catalog.json"),replica=await read("reports/schema-2h/production-catalog.json");
const target="0149_reconcile_checks_foreign_keys_f_1.sql";
const result={status:"BLOCKED — DO NOT PROCEED",tests:[],failures:[],productionPreflights:{count:1890,status:"NOT RUN"},
 safety:{productionConnections:0,productionWrites:0,developmentWrites:0,sharedDatabaseWrites:0,publishDeploy:"NO",dbPush:"NO",
 journalChanges:"NO",secretsEnvChanges:"NO",applicationChanges:"NO"}};
const passed=(name,details={})=>{result.tests.push({name,status:"PASS",...details});console.log("PASS",name);};
const sql=(await fs.readFile("scripts/audits/schema-2h-catalog.sql","utf8")).split(/-- @([a-z]+)\n/);
const base=(await fs.readFile("/tmp/educore-2i-cash-active-path","utf8")).trim();
assert.match(base,/^\/tmp\/educore-schema-2i-cash-[A-Za-z0-9]+$/);
const {Client}=createRequire(path.resolve("lib/db/package.json"))("pg");
const config={host:base+"/socket",port:55489,user:"schema_2i_cash_audit",password:()=>"",ssl:false,
 options:"-c statement_timeout=120000 -c lock_timeout=10000"};
const admin=new Client({...config,database:"postgres"}),dbName="schema_2i_cash_correction";
let client,created=false;
async function apply(name){
 await client.query("BEGIN");
 try{await client.query(await fs.readFile("lib/db/drizzle/"+name,"utf8"));await client.query("COMMIT");}
 catch(error){await client.query("ROLLBACK");error.migration=name;throw error;}
}
async function catalog(){const c={};for(let i=1;i<sql.length;i+=2)c[sql[i]]=(await client.query(sql[i+1])).rows[0].catalog;return c;}
async function legacy(){
 for(const s of replica.sequences)await client.query(`CREATE SEQUENCE public.${q(s.name)} AS ${s.type} INCREMENT ${s.increment} MINVALUE ${s.minimum} MAXVALUE ${s.maximum} START ${s.start_value} CACHE ${s.cache}${s.cycle?" CYCLE":" NO CYCLE"}`);
 for(const t of replica.tables)await client.query(`CREATE TABLE public.${q(t.name)} (${replica.columns.filter(c=>c.table_name===t.name).map(c=>q(c.name)+" "+c.type+(c.default_expression?" DEFAULT "+c.default_expression:"")+(c.nullable?"":" NOT NULL")).join(",")})`);
 for(const s of replica.sequences)if(s.table_name)await client.query(`ALTER SEQUENCE public.${q(s.name)} OWNED BY public.${q(s.table_name)}.${q(s.column_name)}`);
 for(const c of replica.constraints.filter(c=>c.kind!=="f"))await client.query(`ALTER TABLE public.${q(c.table_name)} ADD CONSTRAINT ${q(c.name)} ${c.definition}`);
 for(const i of replica.indexes.filter(i=>!i.owner_constraint))await client.query(i.definition);
 for(const c of replica.constraints.filter(c=>c.kind==="f"))await client.query(`ALTER TABLE public.${q(c.table_name)} ADD CONSTRAINT ${q(c.name)} ${c.definition}`);
}
async function snapshot(){
 const rows={};for(const t of ["app_users","schools","students","academic_sessions","academic_terms","subscriptions","fee_invoices","fee_payments"])
  rows[t]=(await client.query(`SELECT ${replica.columns.filter(c=>c.table_name===t).map(c=>q(c.name)).join(",")} FROM public.${q(t)} ORDER BY id`)).rows;
 return rows;
}
async function signature(section,r){return(await client.query("SELECT pg_temp.edu2i_signature($1,$2::jsonb) s",[section,JSON.stringify(r)])).rows[0].s;}
async function finalComparison(){
 const actual=await catalog(),missing=[],differences=[],equivalences=[];
 for(const [section,rows]of Object.entries(expected))for(const r of rows){
  const field=["tables","sequences","functions"].includes(section)?"name":"table_name";
  const sig=await signature(section,r);let match;
  for(const a of actual[section].filter(a=>a[field]===r[field])){
   if(JSON.stringify(await signature(section,a))===JSON.stringify(sig)){match=a;if(a.name===r.name)break;}
  }
  if(!match){missing.push({section,table:r.table_name,name:r.name});continue;}
  if(section==="constraints"&&r.validated&&!match.validated)differences.push({section,name:r.name,reason:"validation"});
  if(section==="sequences"&&["table_schema","table_name","column_name","ownership"].some(k=>match[k]!==r[k]))
   differences.push({section,name:r.name,reason:"ownership"});
  if(match.name!==r.name||section==="columns"&&match.ordinal!==r.ordinal||section==="constraints"&&match.validated!==r.validated)
   equivalences.push({section,table:r.table_name,name:r.name,retainedName:match.name});
 }
 assert.equal(missing.length,0,JSON.stringify(missing));assert.equal(differences.length,0,JSON.stringify(differences));
 // Review extras rather than treating target coverage as semantic equivalence.
 const extraConstraints=[];
 for(const c of actual.constraints){
  const sig=await signature("constraints",c);let known=false;
  for(const r of expected.constraints.filter(r=>r.table_name===c.table_name))
   if(JSON.stringify(sig)===JSON.stringify(await signature("constraints",r))){known=true;break;}
  if(known)continue;
  const pk=actual.constraints.find(p=>p.table_name===c.table_name&&p.kind==="p");
  if(c.kind==="u"&&pk&&pk.columns.every(x=>c.columns.includes(x)))extraConstraints.push({table:c.table_name,name:c.name,
   proof:"Redundant UNIQUE includes the existing primary key; no additional accepted-domain restriction."});
  else throw Error("Additional semantic mismatch: "+c.table_name+"."+c.name);
 }
 const data={counts:Object.fromEntries(Object.entries(actual).map(([k,v])=>[k,v.length])),
  constraintKinds:Object.fromEntries(["p","u","c","f"].map(k=>[k,actual.constraints.filter(c=>c.kind===k).length])),
  missing,differences,equivalences,extraConstraints,semanticBlockerResolved:true};
 result.catalog=data;passed("5 final catalog and retained-extra semantic review",data);
}
async function payment(method,{missingEvidence=false}={}){
 const cash=method==="CASH",ref="QA-CORRECTION-"+method+(missingEvidence?"-NO-EVIDENCE":"");
 return client.query(`INSERT INTO fee_payments(school_id,invoice_id,student_id,reference,idempotency_key,amount_minor,method,
 submitted_by,transfer_bank,transfer_reference,transfer_date,status,verified_by,verified_at,
 verification_evidence_ref,reviewer_notes,verification_metadata)
 VALUES(1,1,1,$1,$1,10000,$2,1,'Fixture bank',$1,'2026-09-01',$3,$4,$5,$6,$7,$8::jsonb) RETURNING method`,
 [ref,method,cash?"VERIFIED":"PENDING",cash&&!missingEvidence?1:null,cash&&!missingEvidence?"2026-10-07T00:00:00Z":null,
 cash&&!missingEvidence?"QA cash receipt":null,cash&&!missingEvidence?"Disposable verified cash":null,cash&&!missingEvidence?'{"fixture":true}':null]);
}
try{
 // Reuse the already successful canonical replay only after all 61 hashes match.
 const historical=await read("reports/schema-2h/replay.json");assert.equal(historical.status,"PASS");assert.equal(historical.successful,61);
 for(const f of historical.migrations)assert.equal(hash(await fs.readFile("lib/db/drizzle/"+f.name)),f.sha256);
 assert.equal(hash(await fs.readFile("lib/db/drizzle/meta/_journal.json")),before.journalHash);
 assert.equal(hash(await fs.readFile("reports/schema-2i/preflight-specification.json")),before.preflightHash);
 assert.equal(manifest.preflights.length,1890);
 const changed=[];
 for(const [name,h]of Object.entries(before.drafts))if(hash(await fs.readFile("lib/db/drizzle/"+name))!==h)changed.push(name);
 assert.deepEqual(changed,[target]);assert.deepEqual(manifest.order,before.order);
 passed("1 unchanged canonical 0000–0060 replay evidence reused",{files:61,counts:historical.counts,noReplayRepeated:true});
 result.changedDrafts=changed;
 await admin.connect();
 result.isolation=(await admin.query("SELECT version(),current_setting('data_directory') data_directory,current_setting('listen_addresses') listeners")).rows[0];
 assert.equal(result.isolation.data_directory,base+"/data");assert.equal(result.isolation.listeners,"");
 await admin.query(`CREATE DATABASE ${q(dbName)}`);created=true;
 client=new Client({...config,database:dbName});await client.connect();
 await legacy();
 // Reuse the exact previously validated, clearly labelled synthetic partial-legacy seed.
 const harness=await fs.readFile("scripts/audits/schema-2i-rehearse.mjs","utf8");
 const seedBody=harness.slice(harness.indexOf(' await client.query("ALTER TABLE schools ADD COLUMN communication_defaults'),
  harness.indexOf("\n}\nasync function verifyCanonical"));
 assert(seedBody.includes("QA2I-PAY-1")&&seedBody.startsWith(" await client.query"));
 const seed=new Function("client","return (async()=>{"+seedBody+"})()");await seed(client);
 const originalRows=await snapshot();
 const originalObjects=(await client.query(`SELECT c.oid::text oid,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','i','S') ORDER BY c.oid`)).rows;
 const originalBindings=(await client.query(`SELECT c.oid::text oid,c.conname,c.conindid::text support FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' ORDER BY c.oid`)).rows;
 const old=replica.constraints.find(c=>c.table_name==="fee_payments"&&c.name==="fee_payments_method_check");
 assert(old);assert((await client.query("SELECT FROM pg_constraint WHERE conrelid='fee_payments'::regclass AND conname=$1",[old.name])).rowCount);
 for(const name of manifest.order)await apply(name);
 assert.deepEqual(await snapshot(),originalRows);
 const currentObjects=(await client.query(`SELECT c.oid::text oid,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN('r','i','S') ORDER BY c.oid`)).rows;
 for(const o of originalObjects)assert(currentObjects.some(c=>JSON.stringify(c)===JSON.stringify(o)),"Original object changed: "+o.relname);
 const currentBindings=(await client.query(`SELECT c.oid::text oid,c.conname,c.conindid::text support FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public' ORDER BY c.oid`)).rows;
 for(const c of originalBindings.filter(c=>c.conname!==old.name))assert(currentBindings.some(x=>JSON.stringify(x)===JSON.stringify(c)),"Unexpected constraint/FK replacement: "+c.conname);
 assert.equal((await client.query("SELECT FROM pg_constraint WHERE conrelid='fee_payments'::regclass AND conname=$1",[old.name])).rowCount,0);
 passed("2 corrected reconciliation: all 105 drafts plus unchanged 0060",{files:manifest.order.length,dataPreserved:true,originalOidsAndFkBindingsPreserved:true,onlyApprovedLegacyCheckRetired:true});
 // Absent state was produced by the real retirement, not by a test-only DROP.
 const state=await catalog();await apply(target);assert.deepEqual(await catalog(),state);
 passed("4 absent-state direct rerun is a catalog no-op");
 await client.query(`ALTER TABLE fee_payments ADD CONSTRAINT qa_equivalent_obsolete_method ${old.definition}`);
 await apply(target);
 assert.equal((await client.query("SELECT FROM pg_constraint WHERE conrelid='fee_payments'::regclass AND conname='qa_equivalent_obsolete_method'")).rowCount,0);
 passed("4 proven equivalent differently named restriction safely retired");
 await client.query(`ALTER TABLE fee_payments ADD CONSTRAINT ${q(old.name)} ${old.definition}`);
 await apply(target);assert.deepEqual(await snapshot(),originalRows);
 passed("4 existing obsolete definition retired idempotently without changing payment rows");
 for(const [name,definition]of [[old.name,"CHECK (method='BANK_TRANSFER')"],["qa_uncertain_method_check","CHECK (method<>'CASH')"]]){
  await client.query("BEGIN");
  try{
   await client.query(`ALTER TABLE fee_payments ADD CONSTRAINT ${q(name)} ${definition}`);
   await client.query("SAVEPOINT before_retirement");
   let rejected=false;
   try{await client.query(await fs.readFile("lib/db/drizzle/"+target,"utf8"));}
   catch(error){assert.match(error.message,/CASH retirement ambiguity/);rejected=true;}
   assert(rejected);await client.query("ROLLBACK TO SAVEPOINT before_retirement");
   assert((await client.query("SELECT FROM pg_constraint WHERE conrelid='fee_payments'::regclass AND conname=$1",[name])).rowCount);
  }finally{await client.query("ROLLBACK");}
  passed("4 unexpected definition preserved and STOP: "+name);
 }
 for(const method of ["BANK_TRANSFER","REMITA","FLUTTERWAVE","PAYSTACK","CASH"]){assert.equal((await payment(method)).rows[0].method,method);}
 passed("3 actual payment INSERTs accept CASH and all four other canonical methods",{cashStatus:"VERIFIED",syntheticOnly:true,methods:["BANK_TRANSFER","REMITA","FLUTTERWAVE","PAYSTACK","CASH"]});
 let invalidRejected=false;try{await payment("CHEQUE");}catch(error){assert.equal(error.code,"23514");assert.equal(error.constraint,"fee_payments_method_with_cash_check");invalidRejected=true;}assert(invalidRejected);
 let cashEvidenceRejected=false;try{await payment("CASH",{missingEvidence:true});}catch(error){assert.equal(error.code,"23514");assert.equal(error.constraint,"fee_payments_cash_evidence_check");cashEvidenceRejected=true;}assert(cashEvidenceRejected);
 passed("3 invalid method and CASH without canonical verification evidence remain rejected");
 await finalComparison();
 const finance=await read("reports/finance-2g1/report.json");
 assert.deepEqual(finance.summary,{passed:35,failed:0});
 assert.equal(hash(await fs.readFile("lib/db/drizzle/0060_reconcile_student_subscription_finance.sql")),before.historical["0060_reconcile_student_subscription_finance.sql"]);
 passed("0060 unchanged; prior 35/35 evidence retained; all 1890 preflights still NOT RUN");
 result.status="PASS — READY FOR PRODUCTION PREFLIGHT";
}catch(error){
 result.failures.push({migration:error.migration,code:error.code,message:error.message,detail:error.detail});
 console.error(result.failures);process.exitCode=1;
}finally{
 if(client)await client.end();
 if(created)await admin.query(`DROP DATABASE ${q(dbName)}`);
 await admin.end();
 result.databaseDestroyed=created;
 await fs.writeFile(dir+"/validation.json",JSON.stringify(result,null,2));console.log(result.status);
}
