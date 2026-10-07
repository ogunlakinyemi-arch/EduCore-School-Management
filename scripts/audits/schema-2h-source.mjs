// Offline schema metadata inspection. No database client entry point or URL.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const root=process.cwd(),base=await fs.mkdtemp("/tmp/educore-schema-2h-");
assert.match(base,/^\/tmp\/educore-schema-2h-[A-Za-z0-9]+$/);
try {
const requireDb=createRequire(path.join(root,"lib/db/package.json"));
const {build}=createRequire(path.join(root,"artifacts/api-server/package.json"))("esbuild");
const file=path.join(base,"source-model.cjs");
const buildResult=await build({stdin:{resolveDir:path.join(root,"lib/db"),
 contents:"export * from './src/schema/index'; export {getTableConfig,PgDialect} from 'drizzle-orm/pg-core'; export {is,Table} from 'drizzle-orm';"},
 bundle:true,platform:"node",format:"cjs",outfile:file,metafile:true});
assert(!Object.keys(buildResult.metafile.inputs).some(p=>p.endsWith("lib/db/src/index.ts")));
const model=requireDb(file),dialect=new model.PgDialect();
const expression=v=>dialect.sqlToQuery(v).sql;
const lit=v=>typeof v==="string"?"'"+v.replaceAll("'","''")+"'":String(v);
const short=n=>Buffer.byteLength(n)<=63?n:Buffer.from(n).subarray(0,63).toString();
const tables=[...new Set(Object.values(model).filter(v=>model.is(v,model.Table)))];
const out={tables:[],columns:[],constraints:[],indexes:[],limitations:[
 "Offline Drizzle metadata, not a database replay. SQL migrations remain authoritative.",
 "Application functions/triggers and historical data transformations are not declared by the schema barrel.",
 "Source column declaration order is not interpreted as a destructive physical-reordering requirement."]};
for(const t of tables){
 const c=model.getTableConfig(t),schema=c.schema??"public",name=c.name;
 out.tables.push({schema,name,exportNames:Object.entries(model).filter(([,v])=>v===t).map(([k])=>k)});
 c.columns.forEach((col,i)=>{
  let type=col.getSQLType(),defaultExpression;
  if(/^(?:big)?serial$/.test(type)){defaultExpression="nextval('"+name+"_"+col.name+"_seq'::regclass)";type=type==="serial"?"integer":"bigint";}
  else if(col.default===undefined)defaultExpression=null;
  else if(typeof col.default?.toQuery==="function")defaultExpression=expression(col.default);
  else if(typeof col.default?.getSQL==="function")defaultExpression=expression(col.default.getSQL());
  else if(typeof col.default==="object"&&/^jsonb?$/.test(type))defaultExpression=lit(JSON.stringify(col.default))+"::"+type;
  else if(Array.isArray(col.default)&&/\[\]$/.test(type))defaultExpression="ARRAY["+col.default.map(lit).join(",")+"]::"+type;
  else if(typeof col.default==="object")defaultExpression="[NOT ASSESSABLE: type-specific source default]";
  else defaultExpression=lit(col.default);
  out.columns.push({schema,table_name:name,name:col.name,ordinal:i+1,type,nullable:!col.notNull,default_expression:defaultExpression});
 });
 const key=(kind,keyName,cols)=>out.constraints.push({schema,table_name:name,name:short(keyName),kind,columns:cols});
 const prim=c.columns.filter(v=>v.primary).map(v=>v.name);
 if(prim.length)key("p",name+"_pkey",prim);
 for(const p of c.primaryKeys)key("p",p.getName(),p.columns.map(v=>v.name));
 for(const v of c.columns.filter(v=>v.isUnique))key("u",v.uniqueName,[v.name]);
 for(const u of c.uniqueConstraints)key("u",u.getName(),u.columns.map(v=>v.name));
 for(const ch of c.checks)out.constraints.push({schema,table_name:name,name:short(ch.name),kind:"c",check_expression:expression(ch.value)});
 for(const f of c.foreignKeys){const r=f.reference(),p=model.getTableConfig(r.foreignTable);
  out.constraints.push({schema,table_name:name,name:short(f.getName()),kind:"f",columns:r.columns.map(v=>v.name),
   referenced_schema:p.schema??"public",referenced_table:p.name,referenced_columns:r.foreignColumns.map(v=>v.name),
   delete_action:f.onDelete??"no action",update_action:f.onUpdate??"no action"});}
 for(const idx of c.indexes){const x=idx.config;out.indexes.push({schema,table_name:name,name:short(x.name),
  unique_index:!!x.unique,method:x.method??"btree",keys:x.columns.map(v=>v.name??expression(v)),
  predicate:x.where?expression(x.where):null});}
}
await fs.writeFile("reports/schema-2h/source-catalog.json",JSON.stringify(out,null,2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(out).filter(([,v])=>Array.isArray(v)).map(([k,v])=>[k,v.length]))));
} finally {
 await fs.rm(base,{recursive:true,force:true});
}
