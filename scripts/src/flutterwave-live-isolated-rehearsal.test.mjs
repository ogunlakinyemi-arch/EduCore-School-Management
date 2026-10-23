import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NativeRehearsal } from "./flutterwave-rehearsal/native.mjs";
import { isolatedCheckoutPolicy } from "./flutterwave-rehearsal/policy.mjs";

const entry=fileURLToPath(new URL("./flutterwave-live-isolated-rehearsal.mjs",import.meta.url));
const env={PATH:process.env.PATH,LANG:"C.UTF-8",LC_ALL:"C.UTF-8"};
test("rejects inherited connection configuration before initialization",()=>{
  const result=spawnSync(process.execPath,[entry],{env:{...env,DATABASE_URL:"forbidden-placeholder"},encoding:"utf8"});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/inherited configuration is forbidden/);
});
test("rejects target/apply options rather than accepting an application resource",()=>{
  for(const option of ["--apply","--database","--approve","--production"]) {
    const result=spawnSync(process.execPath,[entry,option],{env,encoding:"utf8"});
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/No target, URL, apply, approval or credential options/);
  }
});
test("psql arguments are explicit Unix-socket, role and allow-listed database names",()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"fw-rehearsal-guard-"));
  try {
    const runner=new NativeRehearsal(directory,directory,{commands:[],checks:[]});
    assert.deepEqual(runner.args("rehearsal_empty").slice(-8),
      ["-h",directory,"-p","5432","-U","isolated_rehearsal","-d","rehearsal_empty"]);
    for(const name of ["application","DATABASE_URL","postgresql://forbidden","rehearsal_x;drop database other"])
      assert.throws(()=>runner.args(name));
    assert.equal(runner.env.PGPASSFILE,path.join(directory,"empty-pgpass"));
    assert.equal(fs.readFileSync(runner.env.PGPASSFILE,"utf8"),"");
    assert.equal(runner.env.PGSERVICEFILE,"/dev/null");
    assert.ok(!Object.hasOwn(runner.env,"DATABASE_URL"));
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});
test("actual SCV3 policy runs without importing application auth or DB bootstrap",async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"fw-policy-guard-"));
  const root=fileURLToPath(new URL("../../",import.meta.url));
  try {
    const runner=new NativeRehearsal(directory,directory,{commands:[],checks:[]});
    const policy=path.join(root,"artifacts/api-server/src/lib/flutterwave-split-policy.ts");
    const result=await isolatedCheckoutPolicy(root,`import assert from 'node:assert/strict';
      import {fixedSplitInstructions} from ${JSON.stringify(policy)};
      assert.deepEqual(fixedSplitInstructions('RS_FictionalSchool123','RS_FictionalPartner123',3),
        [{id:'RS_FictionalSchool123',transaction_charge_type:'flat_subaccount',transaction_charge:1900}]);
      console.log(JSON.stringify({status:'PASS'}));`,runner);
    assert.equal(result.status,"PASS");
    assert.equal(result.applicationAuthorizationTested,false);
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});
test("policy bundle rejects DB and network dependencies rather than configuring a connection",async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),"fw-policy-reject-"));
  const root=fileURLToPath(new URL("../../",import.meta.url));
  try {
    const runner=new NativeRehearsal(directory,directory,{commands:[],checks:[]});
    for(const module of ["@workspace/db","node:https"])
      await assert.rejects(isolatedCheckoutPolicy(root,`import * as forbidden from '${module}'; console.log(forbidden);`,runner),
        /Forbidden runtime dependency/);
    assert.equal(runner.report.commands.length,0);
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});
