// One explicitly private, Unix-socket-only PostgreSQL validation.
// Never imports the application DB client, reads credentials or uses shared DBs.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {createHash} from "node:crypto";
const dir="reports/schema-defaults-correction",read=async p=>JSON.parse(await fs.readFile(p,"utf8"));
const before=await read(dir+"/before.json"),original=await read(dir+"/before-sources.json"),targets=await read(dir+"/targets.json");
const canonical=await read("reports/schema-2h/canonical-catalog.json");
const hash=x=>createHash("sha256").update(x).digest("hex"),q=x=>'"'+x.replaceAll('"','""')+'"',lit=x=>"'"+x.replaceAll("'","''")+"'";
const files=[...new Set(targets.map(t=>t.migration))].sort();
const result={status:"BLOCKED — CORRECTION FAILED",tests:[],failures:[],filesModified:files.map(f=>"lib/db/drizzle/"+f),
 safety:{productionConnections:0,productionChanges:0,developmentConnections:0,sharedWrites:0,manualBackfillIntroduced:false,
 destructiveOperationsIntroduced:false,journalChanges:false,applicationChanges:false,publishDeploy:false,secretsEnvironmentChanges:false}};
function passed(name,detail={}){result.tests.push({name,status:"PASS",...detail});console.log("PASS",name);}
function kernel(sql){const m=sql.match(/\n EXECUTE ('(?:[^']|'')*');\n FOR spec/);assert(m);return m[1].slice(1,-1).replaceAll("''","'");}
function contracts(sql){const m=sql.match(/FOR spec IN SELECT value FROM jsonb_array_elements\(\$contracts\$([\s\S]*?)\$contracts\$::jsonb\) LOOP/);assert(m);return JSON.parse(m[1]);}
const currentSources=Object.fromEntries(await Promise.all(files.map(async f=>[f,await fs.readFile("lib/db/drizzle/"+f,"utf8")])));
const allOps=files.flatMap(f=>contracts(currentSources[f]).map(op=>({...op,migration:f})));
assert(allOps.every(op=>op.kind==="columns"));
const tableNames=[...new Set(allOps.map(op=>op.expected.table_name))];
const base=(await fs.readFile("/tmp/educore-defaults-correction-active-path","utf8")).trim();
assert.match(base,/^\/tmp\/educore-defaults-correction-[A-Za-z0-9]+$/);
const {Client}=createRequire(path.resolve("lib/db/package.json"))("pg");
const config={host:base+"/socket",port:55490,user:"schema_defaults_audit",password:()=>"",ssl:false,
 options:"-c statement_timeout=120000 -c lock_timeout=10000"};
const database="schema_defaults_correction",admin=new Client({...config,database:"postgres"});
let db,created=false;
async function fixtureTables(){
 const cols=canonical.columns.filter(c=>tableNames.includes(c.table_name));
 const defaultFunctions=canonical.functions.filter(f=>cols.some(c=>(c.default_expression??"").includes(f.name+"(")));
 for(const f of defaultFunctions)await db.query(f.definition);
 const neededSequences=canonical.sequences.filter(s=>cols.some(c=>(c.default_expression??"").includes(s.name)));
 for(const s of neededSequences)await db.query(`CREATE SEQUENCE public.${q(s.name)} AS ${s.type} INCREMENT ${s.increment} MINVALUE ${s.minimum} MAXVALUE ${s.maximum} START ${s.start_value} CACHE ${s.cache}${s.cycle?" CYCLE":" NO CYCLE"}`);
 for(const table of tableNames){
  const columns=cols.filter(c=>c.table_name===table&&!targets.some(t=>t.table===table&&t.column===c.name));
  assert(columns.every(c=>!c.identity&&!c.generated));
  await db.query(`CREATE TABLE public.${q(table)} (${columns.map(c=>q(c.name)+" "+c.type+(c.default_expression?" DEFAULT "+c.default_expression:"")+(c.nullable?"":" NOT NULL")).join(",")})`);
 }
 const seedCounts={communication_deliveries:4,partner_profile_users:1,partner_profiles:1,schools:6};
 for(const [table,count]of Object.entries(seedCounts)){
  const required=cols.filter(c=>c.table_name===table&&!c.nullable&&!c.default_expression&&!targets.some(t=>t.table===table&&t.column===c.name));
  for(let i=1;i<=count;i++){
   const values=required.map(c=>{
    if(["integer","bigint","smallint"].includes(c.type))return i;
    if(c.type.startsWith("numeric")||["real","double precision"].includes(c.type))return 1;
    if(c.type==="boolean")return false;
    if(c.type==="jsonb")return "{}";
    if(c.type==="date")return "2026-10-07";
    if(c.type.startsWith("timestamp"))return "2026-10-07T00:00:00Z";
    if(c.type.endsWith("[]"))return "{}";
    if(c.type==="text"||c.type.startsWith("character varying"))return "Disposable fixture "+i;
    throw Error("Unreviewed fixture type "+c.type);
   });
   if(required.length)await db.query(`INSERT INTO public.${q(table)} (${required.map(c=>q(c.name)).join(",")}) VALUES (${values.map((_,j)=>"$"+(j+1)).join(",")})`,values);
   else await db.query(`INSERT INTO public.${q(table)} DEFAULT VALUES`);
  }
 }
 return seedCounts;
}
async function preservedRows(){
 const out={};
 for(const table of tableNames){
  const cols=canonical.columns.filter(c=>c.table_name===table&&!targets.some(t=>t.table===table&&t.column===c.name));
  out[table]=(await db.query(`SELECT ${cols.map(c=>q(c.name)).join(",")} FROM public.${q(table)}`)).rows
   .sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 }
 return out;
}
async function negative(spec,name){
 await db.query("BEGIN");
 try{
  let rejected=false;
  try{await db.query("SELECT pg_temp.edu2i_apply('columns',$1::jsonb)",[JSON.stringify(spec)]);}
  catch(error){assert.equal(error.code,"P0001");assert.match(error.message,/preflight gate/);rejected=true;}
  assert(rejected,name+" did not reject");
 }finally{await db.query("ROLLBACK");}
 passed("Guard rejects "+name);
}
try{
 // Reversal proves the only source changes are approved DDLs and guard blocks.
 const originalLine="  IF any_rows THEN RAISE EXCEPTION '2I preflight gate: required column %.% needs an approved existing-row mapping; no default backfill',scope,r->>'name'; END IF;";
 for(const file of files){
  const sql=currentSources[file],oldKernel=kernel(original[file]),newKernel=kernel(sql);
  const start=newKernel.indexOf("  -- Only these five reviewed canonical inline defaults");
  const endMarker=",scope,r->>'name'; END IF;",end=newKernel.indexOf(endMarker,start)+endMarker.length;
  assert(start>=0&&end>start);
  const reversedKernel=newKernel.slice(0,start)+originalLine+newKernel.slice(end);
  assert.equal(reversedKernel,oldKernel);
  const newLiteral=sql.match(/\n EXECUTE ('(?:[^']|'')*');\n FOR spec/)[1];
  let reversed=sql.replace(newLiteral,()=>lit(reversedKernel));
  for(const t of targets.filter(t=>t.migration===file))reversed=reversed.replace(JSON.stringify(t.newDdl),()=>JSON.stringify(t.oldDdl));
  assert.equal(reversed,original[file]);
 }
 passed("Exactly five inline DDL edits and three exact-definition guard exceptions; all other SQL unchanged");
 for(const t of targets){
  const op=allOps.find(o=>o.expected.table_name===t.table&&o.expected.name===t.column);
  assert(op);assert.equal(op.ddl,t.newDdl);assert.equal(op.expected.nullable,false);
  const c=canonical.columns.find(c=>c.table_name===t.table&&c.name===t.column);
  assert.equal(c.type,t.type);assert.equal(c.default_expression,t.default);assert.equal(c.nullable,false);
 }
 await admin.connect();
 result.isolation=(await admin.query("SELECT version(),current_setting('data_directory') AS data_directory,current_setting('listen_addresses') AS listeners")).rows[0];
 assert.equal(result.isolation.data_directory,base+"/data");assert.equal(result.isolation.listeners,"");
 await admin.query("CREATE DATABASE "+q(database));created=true;
 db=new Client({...config,database});await db.connect();
 const seedCounts=await fixtureTables(),priorRows=await preservedRows();
 const priorSequences=(await db.query("SELECT sequencename,last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows;
 await db.query(kernel(currentSources[files[0]]));
 const push=allOps.find(op=>op.expected.table_name==="communication_deliveries"&&op.expected.name==="push_attempts");
 await negative({...push,ddl:targets.find(t=>t.column==="push_attempts").oldDdl},"approved name with missing inline DEFAULT");
 await negative({...push,expected:{...push.expected,default_expression:null}},"NULL default metadata");
 await negative({...push,expected:{...push.expected,default_expression:"'[]'::jsonb"}},"wrong canonical default metadata");
 await negative({...push,expected:{...push.expected,type:"text"}},"wrong canonical type metadata");
 await db.query("CREATE TABLE public.qa_unreviewed_defaults(id integer NOT NULL); INSERT INTO public.qa_unreviewed_defaults(id) VALUES(1)");
 await negative({...push,expected:{...push.expected,table_name:"qa_unreviewed_defaults"},
  ddl:'ALTER TABLE public."qa_unreviewed_defaults" ADD COLUMN "push_attempts" jsonb NOT NULL DEFAULT \'{}\'::jsonb'},"unreviewed table despite an inline default");
 for(const f of files){
  await db.query("BEGIN");
  try{await db.query(currentSources[f]);await db.query("COMMIT");}
  catch(error){await db.query("ROLLBACK");error.migration=f;throw error;}
  passed("Full populated-fixture migration parses and applies: "+f);
 }
 const columnResults=[];
 for(const t of targets){
  const c=(await db.query(`SELECT format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS not_null,
   pg_get_expr(d.adbin,d.adrelid) AS default_expression FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid
   JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
   WHERE n.nspname='public' AND c.relname=$1 AND a.attname=$2 AND NOT a.attisdropped`,[t.table,t.column])).rows[0];
  assert(c);assert.equal(c.type,t.type);assert.equal(c.not_null,true);assert.equal(c.default_expression,t.default);
  const data=(await db.query(`SELECT count(*)::integer AS rows,count(*) FILTER(WHERE ${q(t.column)} IS NULL)::integer AS nulls,
   count(*) FILTER(WHERE ${q(t.column)} IS DISTINCT FROM ${t.default})::integer AS wrong_values FROM public.${q(t.table)}`)).rows[0];
  assert.equal(data.rows,seedCounts[t.table]);assert.equal(data.nulls,0);assert.equal(data.wrong_values,0);
  columnResults.push({table:t.table,column:t.column,migration:t.migration,...c,...data});
 }
 assert.deepEqual(await preservedRows(),priorRows);
 assert.deepEqual((await db.query("SELECT sequencename,last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename")).rows,priorSequences);
 result.columns=columnResults;passed("5/5 exact canonical columns and populated-row initialization; old values and sequence positions preserved",{columns:columnResults});
 const correctedBefore=(await db.query("SELECT attrelid::text,attname,attnum,attnotnull,atthasdef FROM pg_attribute WHERE attrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace) AND attnum>0 ORDER BY attrelid,attnum")).rows;
 for(const f of files)await db.query(currentSources[f]);
 assert.deepEqual((await db.query("SELECT attrelid::text,attname,attnum,attnotnull,atthasdef FROM pg_attribute WHERE attrelid IN (SELECT oid FROM pg_class WHERE relnamespace='public'::regnamespace) AND attnum>0 ORDER BY attrelid,attnum")).rows,correctedBefore);
 assert.deepEqual(await preservedRows(),priorRows);passed("Direct rerun is a no-op for existing columns and old row values");
 const changed=[];
 for(const [f,h]of Object.entries(before.migrationHashes))if(hash(await fs.readFile("lib/db/drizzle/"+f))!==h)changed.push(f);
 assert.deepEqual(changed.sort(),files);
 for(const [p,h]of Object.entries(before.protectedFiles))assert.equal(hash(await fs.readFile(p)),h);
 assert.equal(hash(await fs.readFile("lib/db/drizzle/meta/_journal.json")),before.journalHash);
 assert.equal(hash(await fs.readFile("reports/schema-2i/manifest.json")),before.manifestHash);
 assert.equal(hash(await fs.readFile("reports/schema-2i/preflight-specification.json")),before.preflightHash);
 assert.equal(hash(await fs.readFile("scripts/audits/schema-2i-build.mjs")),before.builderHash);
 assert.deepEqual((await read("reports/schema-2i/manifest.json")).order,before.order);
 const cash=await fs.readFile("lib/db/drizzle/0149_reconcile_checks_foreign_keys_f_1.sql","utf8");
 assert(cash.includes(await fs.readFile("scripts/audits/schema-2i-cash-retirement.sql","utf8")));
 assert.equal(hash(await fs.readFile("lib/db/drizzle/0060_reconcile_student_subscription_finance.sql")),"a827ad709347eaa22b9bf70a4c2a4012f2c2bd86c5ba3d624623710f98d41f57");
 result.sourceIntegrity={changedMigrationFiles:changed,otherMigrationFilesUnchanged:Object.keys(before.migrationHashes).length-changed.length,
  migration0060Unchanged:true,migration0149Unchanged:true,orderingUnchanged:true,journalUnchanged:true,applicationUnchanged:true,
  manifestUnchanged:true,builderUnchanged:true,hashes:Object.fromEntries(files.map(f=>[f,hash(currentSources[f])]))};
 result.metadataNotice="Historical Stage 2I manifest hashes/compiler remain untouched as requested. They describe the pre-correction bytes for these three files; this evidence supplies corrected hashes. Synchronize source-generation/release metadata in a separately authorized step before any rebuild or Production authorization.";
 passed("0060, 0149, other 163 migration files, ordering, journal, application, manifest and compiler unchanged");
 result.status="PASS — FIVE DEFAULTS CORRECTED AND DISPOSABLE VALIDATION PASSED";
}catch(error){
 result.failures.push({migration:error.migration,code:error.code,message:error.message,detail:error.detail});
 console.error(result.failures);process.exitCode=1;
}finally{
 if(db)await db.end();
 if(created)await admin.query("DROP DATABASE "+q(database));
 await admin.end();
 result.disposableDatabaseDestroyed=created;
 await fs.writeFile(dir+"/validation.json",JSON.stringify(result,null,2));
 console.log(result.status);
}
