// Dedicated credential-free PostgreSQL fixture. No app pool, Production target or provider.
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtempSync,mkdirSync,readFileSync,realpathSync,rmSync} from "node:fs";
import {createRequire} from "node:module";
import {join} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {baseline,migrationPaths} from "./direct-release-migrations-native-check.mjs";
import {exerciseFinancialGuards} from "./financial-guards-behavior.mjs";

assert.equal(process.env.NODE_ENV,"test");
assert.equal(process.argv.length,2,"No target or connection arguments accepted");
assert.deepEqual(Object.keys(process.env).filter(k=>/^(?:PG|DATABASE|FLUTTERWAVE|EDUCORE_|REPLIT_)|SECRET|TOKEN|PASSWORD|API_KEY/.test(k)),[]);
const root=fileURLToPath(new URL("../../",import.meta.url));
const requireDb=createRequire(join(root,"lib/db/package.json"));
const requireApi=createRequire(join(root,"artifacts/api-server/package.json"));
const {Pool}=requireDb("pg"),{build}=requireApi("esbuild");
const scratch=mkdtempSync("/tmp/educore-financial-guards-"),data=join(scratch,"data"),socket=join(scratch,"socket");
mkdirSync(socket,{mode:0o700});
const role="guard_fixture",port="56451",env={PATH:process.env.PATH,HOME:scratch,LANG:"C.UTF-8",NODE_ENV:"test"};
const run=(command,args)=>execFileSync(command,args,{env,encoding:"utf8",stdio:["ignore","pipe","pipe"]});
const read=path=>readFileSync(join(root,path),"utf8");
const repair=read("lib/db/drizzle/0179_restore_direct_and_bro_guards.sql");
const functions=sql=>[...sql.matchAll(/CREATE (?:OR REPLACE )?FUNCTION (?:public\.)?(\w+)\(\) RETURNS trigger LANGUAGE plpgsql AS \$\$([\s\S]*?)\$\$;/g)]
  .map(m=>({name:m[1],body:m[2]}));
const triggers=sql=>[...sql.matchAll(/CREATE (?:OR REPLACE )?TRIGGER (\w+)\s+BEFORE (UPDATE OR DELETE|INSERT)\s+ON (?:public\.)?(\w+)\s+FOR EACH ROW EXECUTE FUNCTION (?:public\.)?(\w+)\(\);/g)]
  .map(m=>({name:m[1],table:m[3],fn:m[4],type:m[2]==="INSERT"?7:27})).sort((a,b)=>a.name.localeCompare(b.name));
let started=false,owner,pool,passed=0;
const check=async(name,fn)=>{await fn();passed++;console.log(`PASS ${name}`);};
try{
  run("initdb",["-D",data,"-A","trust","-U",role,"--no-locale","--encoding=UTF8","--no-sync"]);
  run("pg_ctl",["-D",data,"-l",join(scratch,"postgres.log"),"-o",`-k ${socket} -h '' -p ${port}`,"-w","-t","30","start"]);
  started=true;
  const pid=readFileSync(join(data,"postmaster.pid"),"utf8").trim().split("\n");
  assert.equal(realpathSync(pid[1]),realpathSync(data));assert.equal(pid[3],port);assert.equal(pid[4],socket);
  owner=new Pool({host:socket,port:Number(port),database:"postgres",user:role,max:1,connectionTimeoutMillis:5000});
  // Pin the entire test to one client: pg-pool may evict a client on an expected
  // query error, even with max=1, losing transaction/savepoint-local state.
  pool=await owner.connect();
  const identity=(await pool.query("SELECT inet_server_addr() AS ip,current_setting('data_directory') AS data,current_database() AS db")).rows[0];
  assert.equal(identity.ip,null);assert.equal(identity.db,"postgres");assert.equal(realpathSync(identity.data),realpathSync(data));
  const output=join(scratch,"contract.mjs");
  await build({entryPoints:[join(root,"artifacts/api-server/src/services/financial-guard-schema.ts")],
    bundle:true,platform:"node",format:"esm",outfile:output,logLevel:"silent"});
  const contract=await import(pathToFileURL(output).href);
  const {inspectFinancialGuards,financialGuardBodies,financialGuardTriggers,normalizeGuardBody}=contract;
  const approved=migrationPaths.slice(1).map(read).join("\n");
  await check("all four repair bodies and nine trigger definitions match unchanged approved source",async()=>{
    const original=functions(approved),replacement=functions(repair);
    assert.equal(original.length,4);assert.equal(replacement.length,4);
    assert.deepEqual(replacement.map(f=>f.name).sort(),original.map(f=>f.name).sort());
    for(const f of original){
      assert.equal(normalizeGuardBody(replacement.find(r=>r.name===f.name).body),normalizeGuardBody(f.body));
      assert.equal(normalizeGuardBody(financialGuardBodies[f.name]),normalizeGuardBody(f.body));
    }
    assert.equal(triggers(repair).length,9);
    assert.deepEqual(triggers(repair),triggers(approved));
    assert.deepEqual(triggers(repair),[...financialGuardTriggers].sort((a,b)=>a.name.localeCompare(b.name)));
    assert.equal((repair.match(/ ENABLE TRIGGER /g)||[]).length,9);
    assert.doesNotMatch(repair,/^\s*(?:INSERT|UPDATE|DELETE|DROP|TRUNCATE|COPY|GRANT|REVOKE)\b/im);
  });
  await pool.query(baseline);
  for(const path of migrationPaths)await pool.query(read(path));
  const inspect=()=>inspectFinancialGuards(pool);
  const inventory=async()=>({
    functions:(await pool.query(`SELECT proname,pg_get_functiondef(p.oid) definition FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND proname=ANY($1) ORDER BY proname`,
      [Object.keys(financialGuardBodies)])).rows,
    triggers:(await pool.query(`SELECT tgname,tgenabled,pg_get_triggerdef(oid) definition
      FROM pg_trigger WHERE NOT tgisinternal AND tgname=ANY($1) ORDER BY tgname`,
      [financialGuardTriggers.map(t=>t.name)])).rows,
  });
  const approvedInventory=await inventory();
  await check("unchanged source catalog passes strict four-function/nine-trigger verification",async()=>{
    assert.deepEqual(await inspect(),{ready:true,issues:[]});
  });
  await check("repair over installed approved objects preserves definitions and repeats safely",async()=>{
    await pool.query(repair);await pool.query(repair);
    assert.deepEqual(await inventory(),approvedInventory);
    assert.equal((await inspect()).ready,true);
  });
  const reportSql=read("docs/direct-release-schema-preflight.sql");
  const report=async()=>(await pool.query(reportSql)).rows[0];
  await check("read-only preflight explicitly identifies all expected guards",async()=>{
    assert.doesNotMatch(reportSql,/^\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|DO|SET|BEGIN|CALL)\b/im);
    const r=await report();
    assert.equal(r.procedural_guard_inventory.length,9);
    assert.equal(r.procedural_names_and_enablement_match,true);
  });
  await check("same-name weakened bodies, execution properties, wrong events and disabled triggers fail closed",async()=>{
    const variants=[
      `CREATE OR REPLACE FUNCTION public.guard_bro_term_commission_scope() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`,
      `ALTER FUNCTION public.guard_student_direct_history() SECURITY DEFINER`,
      `ALTER FUNCTION public.guard_student_direct_attempt() SET search_path=public`,
      `ALTER TABLE public.student_direct_live_events DISABLE TRIGGER student_direct_event_history`,
      `CREATE OR REPLACE TRIGGER student_direct_review_history BEFORE UPDATE ON public.student_direct_live_reviews FOR EACH ROW EXECUTE FUNCTION public.guard_student_direct_history()`,
      `CREATE OR REPLACE TRIGGER student_direct_review_history BEFORE UPDATE OR DELETE ON public.student_direct_live_reviews FOR EACH ROW WHEN (false) EXECUTE FUNCTION public.guard_student_direct_history()`,
      `CREATE OR REPLACE TRIGGER student_direct_review_history BEFORE UPDATE OR DELETE ON public.student_direct_live_reviews FOR EACH ROW EXECUTE FUNCTION public.guard_student_direct_attempt()`,
    ];
    for(const sql of variants){
      await pool.query("BEGIN");
      try{await pool.query(sql);assert.equal((await inspect()).ready,false,sql);}
      finally{await pool.query("ROLLBACK");}
    }
  });
  await check("repair corrects weakened bodies/properties and re-enables all nine disabled triggers",async()=>{
    for(const t of financialGuardTriggers)await pool.query(`ALTER TABLE public.${t.table} DISABLE TRIGGER ${t.name}`);
    await pool.query(`CREATE OR REPLACE FUNCTION public.guard_student_direct_history()
      RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN RETURN NEW; END $$`);
    assert.equal((await inspect()).ready,false);
    await pool.query(repair);
    assert.equal((await inspect()).ready,true);
    assert.deepEqual(await inventory(),approvedInventory);
  });
  await check("structural-only schema with all tables but no procedural objects fails with 13 explicit issues",async()=>{
    for(const t of financialGuardTriggers)await pool.query(`DROP TRIGGER ${t.name} ON public.${t.table}`);
    for(const name of Object.keys(financialGuardBodies))await pool.query(`DROP FUNCTION public.${name}()`);
    const result=await inspect();
    assert.equal(result.ready,false);assert.equal(result.issues.length,13);
    assert.equal((await report()).procedural_names_and_enablement_match,false);
  });
  await check("missing dependency midway rolls back every repair object without a partial install",async()=>{
    await pool.query("ALTER TABLE public.student_direct_live_review_bindings RENAME TO fixture_missing_bindings");
    try{
      await assert.rejects(pool.query(repair),e=>e.code==="42P01");
      await pool.query("ROLLBACK");
      assert.equal((await inventory()).functions.length,0);
      assert.equal((await inventory()).triggers.length,0);
    }finally{
      await pool.query("ROLLBACK");
      await pool.query("ALTER TABLE public.fixture_missing_bindings RENAME TO student_direct_live_review_bindings");
    }
  });
  await check("missing-only repair creates exact approved four functions and nine enabled triggers",async()=>{
    await pool.query(repair);
    assert.deepEqual(await inventory(),approvedInventory);
    assert.equal((await inspect()).ready,true);
  });
  await exerciseFinancialGuards({pool,check,repair,financialGuardTriggers,inspect});
  console.log(`${passed} isolated PostgreSQL checks passed. No Development/Production database or payment-provider access.`);
}finally{
  if(pool)pool.release();
  if(owner)await owner.end();
  if(started)run("pg_ctl",["-D",data,"-m","immediate","-w","-t","30","stop"]);
  rmSync(scratch,{recursive:true,force:true});
}
