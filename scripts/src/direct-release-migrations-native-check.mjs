// Syntax/constraint rehearsal ONLY. Never imports the app, loads secrets or calls providers.
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {mkdtempSync,mkdirSync,readFileSync,realpathSync,rmSync} from "node:fs";
import {createRequire} from "node:module";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";

export const migrationPaths=[
  "lib/db/drizzle/0175_owner_subscription_rule_management.sql",
  "lib/db/drizzle/0176_direct_student_live_preparation.sql",
  "lib/db/drizzle/0177_direct_student_live_release_reviews.sql",
  "lib/db/drizzle/0178_independent_bro_term_commissions.sql",
];
export function assertNoDuplicatedChecks(statements){
  assert.ok(Array.isArray(statements)&&statements.length>0,"Expected generated SQL statements");
  for(const statement of statements){
    assert.equal(typeof statement,"string");
    assert.doesNotMatch(statement,/\bCHECK\s*\(\s*CHECK\s*\(/i,"Duplicated CHECK wrapper in generated SQL");
  }
}
const root=fileURLToPath(new URL("../../",import.meta.url));
export const baseline=`
 CREATE TABLE app_users(id integer PRIMARY KEY);
 CREATE TABLE schools(id integer PRIMARY KEY);
 CREATE TABLE students(id integer PRIMARY KEY,school_id integer,status text,admission_status text);
 CREATE TABLE academic_sessions(id integer PRIMARY KEY,school_id integer,status text);
 CREATE TABLE academic_terms(id integer PRIMARY KEY,school_id integer,academic_session_id integer,
   start_date date,end_date date,name text,is_current boolean,status text);
 CREATE TABLE partner_profiles(id integer PRIMARY KEY,status text);
 CREATE TABLE school_partner_attributions(id integer PRIMARY KEY,school_id integer,partner_profile_id integer,
   status text,starts_at timestamptz,ends_at timestamptz);
 CREATE TABLE staff_nfc_billing_rules(id integer PRIMARY KEY,price_minor integer);
 CREATE TABLE student_subscription_payments(id integer PRIMARY KEY,amount_minor integer,status text);
 CREATE TABLE commission_ledger(id integer PRIMARY KEY,amount_minor integer,status text);
 INSERT INTO staff_nfc_billing_rules VALUES(1,200000);
 INSERT INTO student_subscription_payments VALUES(1,500000,'PAID');
 INSERT INTO commission_ledger VALUES(1,10000,'PAID');
 INSERT INTO app_users VALUES(1);
 INSERT INTO schools VALUES(1);
 INSERT INTO students VALUES(1,1,'ACTIVE','ADMITTED');
 INSERT INTO academic_sessions VALUES(1,1,'ACTIVE');
 INSERT INTO academic_terms VALUES(1,1,1,'2027-01-18','2027-04-09','Second Term',true,'ACTIVE');
`;
async function retainedRows(client){
  const rows=[];
  for(const sql of [
    "SELECT id,price_minor FROM staff_nfc_billing_rules ORDER BY id",
    "SELECT * FROM student_subscription_payments ORDER BY id",
    "SELECT * FROM commission_ledger ORDER BY id",
  ])rows.push((await client.query(sql)).rows);
  return rows;
}
async function assertConsent(client){
  await client.query(`INSERT INTO subscription_rule_proposals
    (id,product,amount_minor,effective_at,reason,created_by,updated_by)
    VALUES(1,'STUDENT_PLATFORM',320000,'2027-01-01Z','Fictional syntax fixture',1,1)`);
  const cases=[
    {table:"student_direct_live_reviews",sql:`INSERT INTO student_direct_live_reviews
      (school_id,academic_term_id,rule_id,report_digest,merchant_scope,no_split_confirmed,approved_by,expires_at,reason)
      VALUES(1,1,1,repeat('a',64),'fixture-merchant',$1,1,now()+interval '1 hour','Fictional syntax fixture')`},
    {table:"student_direct_live_release_requests",sql:`INSERT INTO student_direct_live_release_requests
      (school_id,academic_term_id,rule_id,snapshot,facts_digest,evidence_digest,merchant_evidence_reference,
       merchant_evidence_hash,policy,no_split_confirmed,expires_at,created_by,reason)
      VALUES(1,1,1,'{}',repeat('b',64),repeat('c',64),'fixture-evidence',repeat('d',64),
       'NEW_ONLY_PRESERVE_LEGACY',$1,now()+interval '1 hour',1,'Fictional syntax fixture')`},
  ];
  for(const test of cases){
    await client.query(test.sql,[true]);
    for(const value of [false,null]){
      await assert.rejects(client.query(test.sql,[value]),e=>{
        assert.equal(e.code,value===null?"23502":"23514");
        if(value===false)assert.equal(e.constraint,`${test.table}_no_split_confirmed_check`);
        else assert.equal(e.column,"no_split_confirmed");
        return true;
      });
    }
  }
}
export async function runRehearsal(manifestPath){
  assert.equal(process.env.NODE_ENV,"test");
  assert.deepEqual(Object.keys(process.env).filter(k=>/^(?:PG|DATABASE|FLUTTERWAVE|EDUCORE_|REPLIT_)|SECRET|TOKEN|PASSWORD|API_KEY/.test(k)),[]);
  const manifest=JSON.parse(readFileSync(manifestPath,"utf8"));
  assertNoDuplicatedChecks(manifest.statements);
  for(const path of migrationPaths){
    const source=readFileSync(join(root,path),"utf8");
    assert.equal(manifest.migrationHashes?.[path],createHash("sha256").update(source).digest("hex"),
      "Fresh generated-diff manifest must match current migration sources");
  }
  // Only expected schema-diff DDL, never a SQL command imported from operator instructions.
  for(const sql of manifest.statements){
    assert.match(sql,/^\s*(?:CREATE (?:TABLE|(?:UNIQUE )?INDEX)|ALTER TABLE)\s/i);
    assert.doesNotMatch(sql,/\b(?:DROP|TRUNCATE|COPY|PROGRAM)\b/i);
  }
  const {Pool}=createRequire(join(root,"lib/db/package.json"))("pg");
  const scratch=mkdtempSync("/tmp/direct-release-migrations-"),data=join(scratch,"data"),socket=join(scratch,"socket");
  mkdirSync(socket,{mode:0o700});
  const role="migration_fixture",port="56449",env={PATH:process.env.PATH,HOME:scratch,LANG:"C.UTF-8"};
  const run=(command,args)=>execFileSync(command,args,{env,encoding:"utf8",stdio:["ignore","pipe","pipe"]});
  let started=false,admin;
  const pools=[];
  try{
    run("initdb",["-D",data,"-A","trust","-U",role,"--no-locale","--encoding=UTF8","--no-sync"]);
    run("pg_ctl",["-D",data,"-l",join(scratch,"postgres.log"),"-o",`-k ${socket} -h '' -p ${port}`,"-w","-t","30","start"]);
    started=true;
    const pid=readFileSync(join(data,"postmaster.pid"),"utf8").trim().split("\n");
    assert.equal(realpathSync(pid[1]),realpathSync(data));assert.equal(pid[3],port);assert.equal(pid[4],socket);
    admin=new Pool({host:socket,port:Number(port),database:"postgres",user:role,max:1});
    for(const database of ["source_replay","generated_replay"]){
      // These fixed names exist only in the independently verified private cluster.
      await admin.query(`CREATE DATABASE ${database}`);
      const pool=new Pool({host:socket,port:Number(port),database,user:role,max:1,connectionTimeoutMillis:5000});
      pools.push(pool);
      const client=await pool.connect();
      try{
        const identity=(await client.query("SELECT inet_server_addr() AS ip,current_setting('data_directory') AS data,current_database() AS db")).rows[0];
        assert.equal(identity.ip,null);assert.equal(identity.db,database);
        assert.equal(realpathSync(identity.data),realpathSync(data));
        await client.query(baseline);
        const before=await retainedRows(client);
        if(database==="source_replay"){
          // 0178 owns BEGIN/COMMIT: deliberately no outer transaction around unchanged files.
          for(const path of migrationPaths)await client.query(readFileSync(join(root,path),"utf8"));
          const guards=await client.query(`SELECT count(*)::int AS count FROM pg_trigger
            WHERE NOT tgisinternal AND tgenabled='O' AND
              (tgname LIKE 'student_direct_%' OR tgname LIKE 'bro_term_commission_%')`);
          assert.equal(guards.rows[0].count,9);
        }else{
          await client.query("BEGIN");
          for(const sql of manifest.statements)await client.query(sql);
          await client.query("COMMIT");
        }
        assert.deepEqual(await retainedRows(client),before,"Legacy paid snapshots must stay unchanged");
        await assertConsent(client);
        console.log(`PASS ${database}: unchanged legacy paid rows; both mandatory no-split guards accept true, reject false/null`);
      }finally{client.release();}
    }
    console.log(`PASS all four source migrations 0175–0178, nine source history/scope triggers, and ${manifest.statements.length} exact regenerated Publish statements`);
    console.log("Credential-free local fixture only; required baseline dependencies, NOT a full Production clone or LIVE release certification.");
  }finally{
    for(const pool of pools)await pool.end();
    if(admin)await admin.end();
    if(started)run("pg_ctl",["-D",data,"-m","immediate","-w","stop"]);
    rmSync(scratch,{recursive:true,force:true});
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  assert.equal(process.argv.length,3,"Usage: NODE_ENV=test node direct-release-migrations-native-check.mjs <fresh-diff-manifest.json>");
  await runRehearsal(process.argv[2]);
}
