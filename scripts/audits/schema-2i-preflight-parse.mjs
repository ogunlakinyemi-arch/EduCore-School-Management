// Parse/plan read-only specifications against typed empty disposable relations.
// No data preflight result is inferred from EXPLAIN.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const base=(await fs.readFile("/tmp/educore-2i-active-path","utf8")).trim();
assert.match(base,/^\/tmp\/educore-schema-2i-[A-Za-z0-9]+$/);
const {Client}=createRequire(path.resolve("lib/db/package.json"))("pg");
const cfg={host:base+"/socket",port:55488,user:"schema_2i_audit",password:()=>"",ssl:false};
const admin=new Client({...cfg,database:"postgres"});await admin.connect();
assert.equal((await admin.query("SELECT current_setting('data_directory') d")).rows[0].d,base+"/data");
await admin.query("CREATE DATABASE schema_2i_preflight_parse");
const c=new Client({...cfg,database:"schema_2i_preflight_parse"});await c.connect();
const e=JSON.parse(await fs.readFile("reports/schema-2h/canonical-catalog.json","utf8"));
const p=JSON.parse(await fs.readFile("reports/schema-2i/preflight-specification.json","utf8"));
const q=s=>'"'+s.replaceAll('"','""')+'"';
try{
 for(const s of e.sequences)await c.query(`CREATE SEQUENCE public.${q(s.name)}`);
 for(const t of e.tables)await c.query(`CREATE TABLE public.${q(t.name)} (${e.columns.filter(v=>v.table_name===t.name).map(v=>q(v.name)+" "+v.type).join(",")})`);
 for(const spec of p){assert(spec.query.trim().startsWith("SELECT"));await c.query("EXPLAIN (COSTS FALSE) "+spec.query);}
 const proof={queries:p.length,status:"PASS",method:"PostgreSQL EXPLAIN against typed empty isolated relations; specification parsing/planning only",productionQueriesExecuted:0,
  dataPreflightsRun:false,productionPreflightStatus:"NOT RUN",databaseDestroyed:true};
 await fs.writeFile("reports/schema-2i/preflight-syntax-validation.json",JSON.stringify(proof,null,2));
 console.log(proof);
}finally{await c.end();await admin.query("DROP DATABASE schema_2i_preflight_parse");await admin.end();}
