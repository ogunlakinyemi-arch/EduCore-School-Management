// Isolated schema and Owner-route verification; deliberately inherits no app DB credentials.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync,mkdirSync,readFileSync,realpathSync,rmSync,statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname,join } from "node:path";
import { fileURLToPath } from "node:url";
assert.ok(process.argv.length===2 || process.argv.length===3);
// Optional test-name filter narrows the rehearsal without weakening isolation.
const testName=process.argv[2];
if(testName)assert.ok(testName.length<=300 && !testName.startsWith("-"));
assert.equal(process.env.NODE_ENV,"test");
assert.deepEqual(Object.keys(process.env).filter(k=>/^(?:PG|DATABASE|FLUTTERWAVE|EDUCORE_|REPLIT_)|SECRET|TOKEN|PASSWORD|API_KEY/.test(k)),[]);
const root=fileURLToPath(new URL("../../",import.meta.url));
const api=join(root,"artifacts/api-server"),require=createRequire(join(api,"package.json"));
const vitest=join(dirname(require.resolve("vitest/package.json")),"vitest.mjs");
const scratch=mkdtempSync("/tmp/educore-owner-rules-");
const data=join(scratch,"data"),socket=join(scratch,"socket"),home=join(scratch,"home");
mkdirSync(socket,{mode:0o700});mkdirSync(home,{mode:0o700});
const port="56443",role="owner_rules_qa";
const env={PATH:process.env.PATH,HOME:home,LANG:"C.UTF-8",NODE_ENV:"test",
  EDUCORE_OWNER_RULES_ROOT:scratch,EDUCORE_OWNER_RULES_PORT:port};
const run=(cmd,args)=>execFileSync(cmd,args,{env,encoding:"utf8",stdio:["ignore","pipe","pipe"]});
let started=false;
try{
  run("initdb",["-D",data,"-A","trust","-U",role,"--no-locale","--encoding=UTF8","--no-sync"]);
  run("pg_ctl",["-D",data,"-l",join(scratch,"postgres.log"),"-o",`-k ${socket} -h '' -p ${port}`,"-w","-t","30","start"]);
  started=true;
  const pid=readFileSync(join(data,"postmaster.pid"),"utf8").trim().split("\n");
  assert.equal(realpathSync(pid[1]),realpathSync(data));
  assert.equal(pid[3],port);assert.equal(pid[4],socket);
  const cmd=readFileSync(`/proc/${pid[0]}/cmdline`,"utf8").split("\0");
  assert.equal(cmd[cmd.indexOf("-D")+1],data);assert.equal(cmd[cmd.indexOf("-h")+1],"");
  assert.equal(cmd[cmd.indexOf("-k")+1],socket);
  assert.equal(readFileSync(`/proc/${pid[0]}/comm`,"utf8").trim(),"postgres");
  assert.equal(statSync(join(socket,`.s.PGSQL.${port}`)).isSocket(),true);
  assert.equal(statSync(data).uid,process.getuid());
  console.log("Owner-rule tests: verified private disposable PostgreSQL, no TCP and no application credentials.");
  execFileSync(process.execPath,[vitest,"run","--config","vitest.owner-subscription-rules.config.ts",
    ...(testName?["-t",testName]:[])],{
    cwd:api,env,stdio:"inherit",timeout:120000});
}finally{
  if(started)run("pg_ctl",["-D",data,"-m","immediate","-w","stop"]);
  rmSync(scratch,{recursive:true,force:true});
}
