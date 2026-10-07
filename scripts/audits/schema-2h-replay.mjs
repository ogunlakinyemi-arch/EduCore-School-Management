// Existing migrations only; explicit new private-cluster connection, no URL/env.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
const root=process.cwd(),dir=path.join(root,"reports/schema-2h");
await fs.mkdir(dir,{recursive:true});
const digest=v=>createHash("sha256").update(v).digest("hex");
const files=execFileSync("git",["ls-files","lib","artifacts","scripts/src","scripts/post-merge.sh",".replit"],{encoding:"utf8"}).trim().split("\n");
const hashes=Object.fromEntries(await Promise.all(files.map(async p=>[p,digest(await fs.readFile(p))])));
await fs.writeFile(path.join(dir,"protected-before.json"),JSON.stringify(hashes,null,2));
const base=(await fs.readFile("/tmp/educore-2h-active-path","utf8")).trim();
assert.match(base,/^\/tmp\/educore-schema-2h-[A-Za-z0-9]+$/);
const {Client}=createRequire(path.join(root,"lib/db/package.json"))("pg");
const config={host:path.join(base,"socket"),port:55487,user:"schema_2h_audit",
 password:()=>"",ssl:false,options:"-c statement_timeout=60000 -c lock_timeout=10000"};
const admin=new Client({...config,database:"postgres"});
const result={authorization:"User explicitly authorized disposable 0000–0060 replay only",migrations:[],failures:[]};
let client;
try{
 await admin.connect();
 const identity=(await admin.query("SELECT version(),current_setting('data_directory') data_directory,current_setting('listen_addresses') listeners,current_setting('port') port")).rows[0];
 assert.equal(identity.data_directory,path.join(base,"data"));assert.equal(identity.listeners,"");assert.equal(identity.port,"55487");
 result.environment={...identity,architecture:process.arch,privateSocket:config.host,disposable:true,database:"schema_2h_full_replay"};
 await admin.query('CREATE DATABASE "schema_2h_full_replay"');
 client=new Client({...config,database:"schema_2h_full_replay"});await client.connect();
 const migrations=(await fs.readdir("lib/db/drizzle")).filter(f=>/^\d{4}.*\.sql$/.test(f)).sort();
 assert.equal(migrations.length,61);
 for(let i=0;i<migrations.length;i++){
  const name=migrations[i];assert.equal(Number(name.slice(0,4)),i);
  const bytes=await fs.readFile(path.join(root,"lib/db/drizzle",name));
  const started=Date.now();
  try{await client.query("BEGIN");const commands=await client.query(bytes.toString("utf8"));await client.query("COMMIT");
   result.migrations.push({name,sha256:digest(bytes),status:"PASS",milliseconds:Date.now()-started,
    operations:(Array.isArray(commands)?commands:[commands]).map(c=>({command:c.command,rowCount:c.rowCount}))});
   console.log("PASS",name);
  }catch(e){await client.query("ROLLBACK");result.failures.push({name,code:e.code,message:e.message,detail:e.detail,where:e.where});throw e;}
 }
 const sql=await fs.readFile("scripts/audits/schema-2h-catalog.sql","utf8"),catalog={};
 const parts=sql.split(/-- @([a-z]+)\n/);
 for(let i=1;i<parts.length;i+=2)catalog[parts[i]]=(await client.query(parts[i+1])).rows[0].catalog;
 result.counts=Object.fromEntries(Object.entries(catalog).map(([k,v])=>[k,v.length]));
 await fs.writeFile(path.join(dir,"canonical-catalog.json"),JSON.stringify(catalog,null,2));
 await fs.writeFile(path.join(dir,"journal.json"),await fs.readFile("lib/db/drizzle/meta/_journal.json"));
 result.successful=result.migrations.length;result.status="PASS";
}catch(e){result.status="FAIL";result.error={code:e.code,message:e.message};process.exitCode=1;}
finally{
 if(client)await client.end();
 if(result.environment?.disposable){await admin.query('DROP DATABASE IF EXISTS "schema_2h_full_replay"');result.databaseDestroyed=true;}
 await admin.end();
 await fs.writeFile(path.join(dir,"replay.json"),JSON.stringify(result,null,2));
 console.log(JSON.stringify({status:result.status,counts:result.counts,successful:result.successful,databaseDestroyed:result.databaseDestroyed}));
}
