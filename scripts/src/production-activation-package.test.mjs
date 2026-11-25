// One disposable, credential-free rehearsal of NEW packet assembly, not a broad payment retest.
import assert from "node:assert/strict";
import {test} from "node:test";
import {execFileSync} from "node:child_process";
import {mkdtempSync,mkdirSync,readFileSync,realpathSync,rmSync} from "node:fs";
import {createRequire} from "node:module";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {compilePackage} from "./production-activation-package.mjs";
import {baseline,migrationPaths} from "./direct-release-migrations-native-check.mjs";

const root=fileURLToPath(new URL("../../",import.meta.url));
const read=path=>readFileSync(join(root,path),"utf8");
test("offline packet exactly matches source, with no structural/row/privilege/activation commands",()=>{
 const {files,manifest}=compilePackage();
 assert.equal(manifest.groups.flatMap(g=>g.functions).length,7);
 assert.equal(manifest.groups.flatMap(g=>g.triggers).length,29);
 for(const [path,sql]of Object.entries(files)){
  assert.equal(read(path),sql,path);
  if(path.endsWith(".sql")){
   assert.doesNotMatch(sql,/^\s*(?:CREATE TABLE|DROP |GRANT |REVOKE |INSERT INTO|UPDATE |DELETE FROM|TRUNCATE |ALTER[^\n]*\sOWNER\s+TO\b|COPY )/im,path);
   if(path.endsWith(".verify.sql"))assert.doesNotMatch(sql,/^\s*(?:BEGIN|SET|DO |ALTER|CREATE|CALL)/im,path);
  }
 }
});
test("changed loop or source contracts fail closed instead of silently producing partial delivery",()=>{
 assert.throws(()=>compilePackage(p=>read(p).replace("FOREACH tab IN ARRAY ARRAY","FOREACH tab IN ARRAY OTHER")));
 assert.throws(()=>compilePackage(p=>p.includes("0179")?read(p).replace("Direct LIVE history is append-only","changed"):read(p)));
});
test("isolated PostgreSQL: phased packet is idempotent, verifies exact objects and aborts invalid delivery",{timeout:60000},async()=>{
 assert.equal(process.env.NODE_ENV,"test");
 assert.deepEqual(Object.keys(process.env).filter(k=>/^(?:PG|DATABASE|FLUTTERWAVE|EDUCORE_|REPLIT_)|SECRET|TOKEN|PASSWORD|API_KEY/.test(k)),[]);
 const scratch=mkdtempSync("/tmp/educore-activation-package-"),data=join(scratch,"data"),socket=join(scratch,"socket");
 mkdirSync(socket,{mode:0o700});
 const role="neondb_owner",port="56453",env={PATH:process.env.PATH,HOME:scratch,LANG:"C.UTF-8",NODE_ENV:"test"};
 const run=(cmd,args)=>execFileSync(cmd,args,{env,encoding:"utf8",stdio:["ignore","pipe","pipe"]});
 const require=createRequire(join(root,"lib/db/package.json")),{Pool}=require("pg");
 let started=false,pool,c;
 try{
  run("initdb",["-D",data,"-A","trust","-U",role,"--no-locale","--encoding=UTF8","--no-sync"]);
  run("pg_ctl",["-D",data,"-l",join(scratch,"server.log"),"-o",`-k ${socket} -h '' -p ${port}`,"-w","-t","30","start"]);started=true;
  const pid=readFileSync(join(data,"postmaster.pid"),"utf8").trim().split("\n");
  assert.equal(realpathSync(pid[1]),realpathSync(data));assert.equal(pid[3],port);assert.equal(pid[4],socket);
  pool=new Pool({host:socket,port:Number(port),user:role,database:"postgres",max:1,connectionTimeoutMillis:5000});
  c=await pool.connect();
  const identity=(await c.query("SELECT inet_server_addr() AS ip,current_setting('data_directory') AS data")).rows[0];
  assert.equal(identity.ip,null);assert.equal(realpathSync(identity.data),realpathSync(data));
  const {files}=compilePackage();
  const sql=(g,p)=>files[`db/production-activation/${g}.${p}.sql`];
  const verify=async g=>(await c.query(sql(g,"verify"))).rows;
  await c.query("CREATE ROLE packet_unapproved_operator NOLOGIN; SET ROLE packet_unapproved_operator");
  await assert.rejects(c.query(sql("student","functions")),/Requires approved managed-database owner/);
  await c.query("ROLLBACK");await c.query("RESET ROLE");
  // Prove the documented pre-Publish phase against an empty schema, then undo
  // it. Strip only the outer packet transaction to keep this rehearsal atomic.
  const unwrapped=s=>s.replace("\nBEGIN;\n","\n").replace(/\nCOMMIT;\n$/,"\n");
  await c.query("BEGIN");
  for(const g of ["student","current","free-terms"]){
   await c.query(unwrapped(sql(g,"functions")));
   assert.ok((await verify(g)).filter(r=>r.kind==="function").every(r=>r.matches));
  }
  await assert.rejects(c.query(unwrapped(sql("student","triggers"))),/Required structural tables/);
  await c.query("ROLLBACK");
  assert.ok((await verify("student")).filter(r=>r.kind==="function").every(r=>!r.matches));
  // Deliberately minimal fake parent contracts; never a Production clone.
  await c.query(baseline);
  for(const p of migrationPaths)await c.query(read(p));
  await c.query(`ALTER TABLE academic_terms ADD UNIQUE(id,school_id);
    ALTER TABLE academic_sessions ADD UNIQUE(id,school_id);
    CREATE TABLE bro_field_leads(id serial PRIMARY KEY);`);
  // 0181/0182 are allowed HERE only: freshly-created, independently pinned disposable fixture.
  await c.query(read("lib/db/drizzle/0181_current_subscription_lifecycle.sql"));
  await c.query(read("lib/db/drizzle/0182_current_bulk_withdrawals_field_sms.sql"));
  await c.query(read("lib/db/drizzle/0183_owner_free_academic_terms.sql"));
  const before=(await c.query("SELECT pg_get_functiondef('guard_student_direct_history()'::regprocedure) AS definition")).rows[0];
  for(let pass=0;pass<2;pass++){
   for(const g of ["student","current","free-terms"]){
    await c.query(sql(g,"functions"));await c.query(sql(g,"triggers"));
    const rows=await verify(g);assert.ok(rows.length>0);assert.deepEqual(rows.filter(r=>!r.matches),[],`${g} parity`);
   }
  }
  const captured=(await c.query(files["db/production-activation/capture-definitions.sql"])).rows;
  assert.equal(captured.length,36);
  assert.ok(captured.every(r=>r.owner==="neondb_owner"&&r.definition));
  assert.deepEqual((await c.query("SELECT pg_get_functiondef('guard_student_direct_history()'::regprocedure) AS definition")).rows[0],before);
  await c.query("CREATE OR REPLACE FUNCTION guard_student_direct_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;");
  assert.ok((await verify("student")).some(r=>r.name==="guard_student_direct_history"&&!r.matches));
  assert.ok((await verify("current")).some(r=>r.name==="guard_student_direct_history"&&!r.matches));
  await assert.rejects(c.query(sql("current","triggers")),/Approved function body/);
  await c.query("ROLLBACK");
  await c.query(sql("student","functions"));await c.query(sql("student","triggers"));
  await c.query("ALTER TABLE student_direct_live_events DISABLE TRIGGER student_direct_event_history");
  assert.ok((await verify("student")).some(r=>r.name==="student_direct_event_history"&&!r.matches));
  await c.query(sql("student","triggers"));
  await c.query("ALTER TABLE current_bulk_events RENAME TO packet_fixture_hidden_events");
  await assert.rejects(c.query(sql("current","triggers")),/Required structural tables/);
  await c.query("ROLLBACK");
  await c.query("ALTER TABLE packet_fixture_hidden_events RENAME TO current_bulk_events");
  // Verify delivery adds no financial/grant/SMS records to the empty fixture.
  for(const g of compilePackage().manifest.groups)for(const table of g.tables)
   assert.equal(Number((await c.query(`SELECT count(*) AS n FROM public.${table}`)).rows[0].n),0,table);
 }finally{
  c?.release();if(pool)await pool.end();
  if(started)run("pg_ctl",["-D",data,"-m","immediate","-w","stop"]);
  rmSync(scratch,{recursive:true,force:true});
 }
});
