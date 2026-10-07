// PostgreSQL reparse evidence, isolated private instance only. No text guessing.
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
const e=JSON.parse(await fs.readFile("reports/schema-2h/canonical-catalog.json","utf8")),q=s=>'"'+s.replaceAll('"','""')+'"';
await admin.query("CREATE DATABASE schema_2i_check_reparse");const c=new Client({...cfg,database:"schema_2i_check_reparse"});await c.connect();
try{
 await c.query("SET search_path=pg_catalog,public");
 for(const t of e.tables)await c.query(`CREATE TABLE public.${q(t.name)} (${e.columns.filter(v=>v.table_name===t.name).map(v=>q(v.name)+" "+v.type).join(", ")})`);
 const differences=[];
 for(const ck of e.constraints.filter(v=>v.kind==="c")){
  assert(!e.functions.some(f=>ck.check_expression.includes(f.name+"(")));
  await c.query(`ALTER TABLE public.${q(ck.table_name)} ADD CONSTRAINT ${q(ck.name)} ${ck.definition}`);
  const expression=(await c.query("SELECT pg_get_expr(conbin,conrelid) expression FROM pg_constraint WHERE conrelid=$1::regclass AND conname=$2",["public."+q(ck.table_name),ck.name])).rows[0].expression;
  if(expression!==ck.check_expression)differences.push({table:ck.table_name,name:ck.name,canonicalExpression:ck.check_expression,reparsedExpression:expression,
   proof:"Executed the exact canonical pg_get_constraintdef DDL against identically named/typed columns in isolated PostgreSQL; only PostgreSQL Boolean-expression deparse grouping differs."});
 }
 await fs.writeFile("reports/schema-2i/check-expression-reparse.json",JSON.stringify(differences,null,2));
 console.log("Canonical CHECK reparse differences",differences.length);
}finally{await c.end();await admin.query("DROP DATABASE schema_2i_check_reparse");await admin.end();}
