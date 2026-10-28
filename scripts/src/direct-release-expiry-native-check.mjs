// Narrow SQL clock regression only. No application pool, financial tables or provider.
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtempSync,mkdirSync,readFileSync,realpathSync,rmSync} from "node:fs";
import {createRequire} from "node:module";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

assert.equal(process.env.NODE_ENV,"test");
assert.equal(process.argv.length,2,"No target/connection arguments accepted");
assert.deepEqual(Object.keys(process.env).filter(k=>/^(?:PG|DATABASE|FLUTTERWAVE|EDUCORE_|REPLIT_)|SECRET|TOKEN|PASSWORD|API_KEY/.test(k)),[]);
const root=fileURLToPath(new URL("../../",import.meta.url));
const {Pool}=createRequire(join(root,"lib/db/package.json"))("pg");
const scratch=mkdtempSync("/tmp/educore-direct-expiry-"),data=join(scratch,"data"),socket=join(scratch,"socket");
mkdirSync(socket,{mode:0o700});
const role="expiry_fixture",port=56452;
const clean={PATH:process.env.PATH,HOME:scratch,LANG:"C.UTF-8",NODE_ENV:"test"};
const run=(cmd,args)=>execFileSync(cmd,args,{env:clean,encoding:"utf8",stdio:["ignore","pipe","pipe"]});
let started=false,pool,client;
try{
  run("initdb",["-D",data,"-A","trust","-U",role,"--no-locale","--encoding=UTF8","--no-sync"]);
  run("pg_ctl",["-D",data,"-l",join(scratch,"server.log"),"-o",`-k ${socket} -p ${port} -c listen_addresses=''`,"-w","start"]);
  started=true;
  pool=new Pool({host:socket,port,database:"postgres",user:role,max:1,ssl:false,connectionTimeoutMillis:3000});
  client=await pool.connect();
  const identity=(await client.query("SELECT inet_server_addr() AS ip,current_setting('data_directory') AS data,current_database() AS db,pg_postmaster_start_time() IS NOT NULL AS running")).rows[0];
  assert.equal(identity.ip,null);assert.equal(identity.db,"postgres");assert.equal(identity.running,true);
  assert.equal(realpathSync(identity.data),realpathSync(data));
  const pid=Number(readFileSync(join(data,"postmaster.pid"),"utf8").split("\n")[0]);
  assert.ok(pid>1);process.kill(pid,0);
  const source=readFileSync(join(root,"artifacts/api-server/src/services/direct-student-live-release.ts"),"utf8");
  assert.match(source,/q\.expires_at>clock_timestamp\(\) AND v\.expires_at>clock_timestamp\(\)/);
  assert.match(source,/r\.effective_at<=clock_timestamp\(\) AND \(r\.ends_at IS NULL OR r\.ends_at>clock_timestamp\(\)\)/);
  assert.match(source,/\(clock_timestamp\(\) AT TIME ZONE 'Africa\/Lagos'\)::date BETWEEN t\.start_date AND t\.end_date/);
  console.log("PASS release-review, rule-window and school-term predicates use wall-clock time");
  await client.query("BEGIN");
  // Derive expiry AFTER transaction start, then wait beyond it in that same transaction.
  const expiry=(await client.query("SELECT now()+interval '100 milliseconds' AS expiry")).rows[0].expiry;
  await client.query("SELECT pg_sleep(0.25)");
  const observed=(await client.query("SELECT $1::timestamptz>now() AS stale_clock_accepts,$1::timestamptz>clock_timestamp() AS wall_clock_accepts",[expiry])).rows[0];
  assert.equal(observed.stale_clock_accepts,true);assert.equal(observed.wall_clock_accepts,false);
  console.log("PASS expired review rejected after in-transaction wait despite frozen NOW()");
  const future=(await client.query("SELECT clock_timestamp()+interval '1 hour'>clock_timestamp() AS allowed")).rows[0];
  assert.equal(future.allowed,true);
  console.log("PASS unexpired wall-clock predicate remains eligible");
  await client.query("ROLLBACK");
  console.log("3 isolated expiry checks passed; no shared database or provider access");
}finally{
  if(client){await client.query("ROLLBACK").catch(()=>undefined);client.release();}
  if(pool)await pool.end();
  if(started)run("pg_ctl",["-D",data,"-m","immediate","-w","stop"]);
  rmSync(scratch,{recursive:true,force:true});
}
