// Fictional disposable PostgreSQL only. Never imports the application's DB or credentials.
// The clean test environment is NOT a way to bypass the live Development backup guard.
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtempSync,mkdirSync,readFileSync,realpathSync,rmSync} from "node:fs";
import {createRequire} from "node:module";
import {join} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
assert.equal(process.env.NODE_ENV,"test");
assert.equal(process.argv.length,2);
assert.deepEqual(Object.keys(process.env).filter(k=>/^(?:PG|DATABASE|FLUTTERWAVE|EDUCORE_|REPLIT_)|SECRET|TOKEN|PASSWORD|API_KEY/.test(k)),[]);
const root=fileURLToPath(new URL("../../",import.meta.url));
const requireDb=createRequire(join(root,"lib/db/package.json"));
const requireApi=createRequire(join(root,"artifacts/api-server/package.json"));
const {Pool}=requireDb("pg");
const {build}=requireApi("esbuild");
const scratch=mkdtempSync("/tmp/educore-bro-native-");
const data=join(scratch,"data"),socket=join(scratch,"socket"),home=join(scratch,"home");
mkdirSync(socket,{mode:0o700});mkdirSync(home,{mode:0o700});
const role="bro_fixture",port="56444";
const env={PATH:process.env.PATH,HOME:home,LANG:"C.UTF-8",NODE_ENV:"test"};
const run=(cmd,args)=>execFileSync(cmd,args,{env,encoding:"utf8",stdio:["ignore","pipe","pipe"]});
let started=false,pool,passed=0;
const check=async(name,fn)=>{await fn();passed++;console.log(`PASS ${name}`);};
try{
  run("initdb",["-D",data,"-A","trust","-U",role,"--no-locale","--encoding=UTF8","--no-sync"]);
  run("pg_ctl",["-D",data,"-l",join(scratch,"postgres.log"),"-o",`-k ${socket} -h '' -p ${port}`,"-w","-t","30","start"]);
  started=true;
  const pid=readFileSync(join(data,"postmaster.pid"),"utf8").trim().split("\n");
  assert.equal(realpathSync(pid[1]),realpathSync(data));assert.equal(pid[3],port);assert.equal(pid[4],socket);
  pool=new Pool({host:socket,port:Number(port),database:"postgres",user:role,max:12,connectionTimeoutMillis:5000});
  const identity=(await pool.query("SELECT current_database() AS db,inet_server_addr() AS ip,current_setting('data_directory') AS data")).rows[0];
  assert.equal(identity.db,"postgres");assert.equal(identity.ip,null);assert.equal(realpathSync(identity.data),realpathSync(data));
  await pool.query(`
    CREATE TABLE app_users(id integer PRIMARY KEY);
    CREATE TABLE schools(id integer PRIMARY KEY);
    CREATE TABLE students(id integer PRIMARY KEY,school_id integer,status text,admission_status text);
    CREATE TABLE academic_sessions(id integer PRIMARY KEY,school_id integer,status text);
    CREATE TABLE academic_terms(id integer PRIMARY KEY,school_id integer,academic_session_id integer,start_date date,end_date date,
      name text DEFAULT 'Third Term',is_current boolean DEFAULT true,status text DEFAULT 'ACTIVE');
    CREATE TABLE partner_profiles(id integer PRIMARY KEY,status text);
    CREATE TABLE school_partner_attributions(id integer PRIMARY KEY,school_id integer,partner_profile_id integer,
      status text,starts_at timestamptz,ends_at timestamptz);
    CREATE TABLE subscription_rule_proposals(id bigint PRIMARY KEY,product text,status text,amount_minor integer,
      effective_at timestamptz,ends_at timestamptz,activated_at timestamptz,version integer);
    CREATE TABLE audit_logs(id bigserial PRIMARY KEY,"user" text,role text,actor_user_id integer,clerk_user_id text,
      action text,module text,record_id bigint,event_type text,metadata jsonb);
    CREATE TABLE subscription_payment_assistance_requests(id bigint PRIMARY KEY);
    CREATE TABLE student_subscription_payments(id integer PRIMARY KEY,academic_term_id integer);
    CREATE TABLE commission_ledger(id serial PRIMARY KEY,school_id integer,student_id integer,payment_id integer,
      academic_session_id integer,term text,rate numeric,amount numeric,status text);
    INSERT INTO app_users VALUES(9); INSERT INTO schools VALUES(1),(2);
    INSERT INTO academic_sessions VALUES(11,1,'ACTIVE');
    INSERT INTO academic_terms(id,school_id,academic_session_id,start_date,end_date,name)
      VALUES(100,1,11,'2027-01-18','2027-04-01','Second Term');
    INSERT INTO partner_profiles VALUES(4,'ACTIVE');
    INSERT INTO school_partner_attributions VALUES(3,1,4,'ACTIVE','2026-01-01Z',NULL);
    INSERT INTO subscription_rule_proposals VALUES
      (1,'BRO_COMMISSION','SCHEDULED',15000,'2026-10-26T23:00Z',NULL,'2026-10-27Z',2),
      (2,'STUDENT_PLATFORM','ACTIVE',320000,'2026-01-01Z',NULL,'2025-12-01Z',2);
    INSERT INTO audit_logs(role,record_id,event_type,metadata) VALUES('PLATFORM_OWNER',1,'SUBSCRIPTION_RULE_ACTIVATED',
      '{"after":{"product":"BRO_COMMISSION","amountMinor":15000,"version":2,"effectiveAt":"2026-10-26T23:00:00Z"}}');
  `);
  // Applies DDL only to the brand-new fictional cluster, never to Development/Production.
  await pool.query(readFileSync(join(root,"lib/db/drizzle/0176_direct_student_live_preparation.sql"),"utf8"));
  await pool.query(readFileSync(join(root,"lib/db/drizzle/0178_independent_bro_term_commissions.sql"),"utf8"));
  const output=join(scratch,"bro.mjs");
  await build({entryPoints:[join(root,"artifacts/api-server/src/services/bro-commission-policy.ts")],
    bundle:true,platform:"node",format:"esm",outfile:output,logLevel:"silent"});
  const {accrueBroCommission:actualAccrue,broStorageReady}=await import(pathToFileURL(output).href);
  // Fixed future clock ONLY inside the credential-free fictional fixture.
  // SQL, locking, constraints, commit/rollback and audits still use actual PostgreSQL.
  const commissionPool={connect:async()=>{
    const c=await pool.connect();
    return{release:()=>c.release(),query:(sql,args)=>c.query(
      sql.replace(/\bnow\(\)/gi,"'2027-03-01T12:00Z'::timestamptz"),args)};
  }};
  const accrueBroCommission=(_db,scope,actor)=>actualAccrue(commissionPool,scope,actor);
  assert.equal(await broStorageReady(pool),true);
  const actor={id:9,email:"fictional@example.test",clerkUserId:"fixture-only"};
  async function evidence(studentId,termId,start="2027-01-18",status="ACTIVE"){
    await pool.query("INSERT INTO students VALUES($1,1,$2,'ADMITTED')",[studentId,status]);
    await pool.query("INSERT INTO academic_terms(id,school_id,academic_session_id,start_date,end_date) VALUES($1,1,11,$2,'2027-04-01')",[termId,start]);
    const review=(await pool.query(`INSERT INTO student_direct_live_reviews(school_id,academic_term_id,rule_id,
      report_digest,merchant_scope,no_split_confirmed,approved_by,expires_at,reason)
      VALUES(1,$1,2,$2,'fictional-merchant',true,9,'2099-01-01Z','Fictional fixture only') RETURNING id`,
      [termId,"a".repeat(64)])).rows[0];
    const obligation=(await pool.query(`INSERT INTO student_direct_live_obligations
      (school_id,student_id,academic_term_id,rule_id,review_id,merchant_scope,created_by)
      VALUES(1,$1,$2,2,$3,'fictional-merchant',9) RETURNING id`,[studentId,termId,review.id])).rows[0];
    const attempt=(await pool.query(`INSERT INTO student_direct_live_attempts
      (obligation_id,reference,idempotency_key,state,provider_transaction_id,provider_reference,
        provider_fee_minor,additional_fee_minor,verified_at,created_by)
      VALUES($1,$2,$3,'PAID',$4,'fictional-provider',0,0,'2027-01-20T09:00Z',9) RETURNING id`,
      [obligation.id,`SCV4_live_FICTIONAL${studentId}`,`fictional-key-${studentId}`,String(studentId)])).rows[0];
    await pool.query(`INSERT INTO student_direct_live_events(attempt_id,kind,details)
      VALUES($1,'PROVIDER_PAYMENT_VERIFIED',$2::jsonb)`,[attempt.id,JSON.stringify({transactionId:String(studentId)})]);
    return{schoolId:1,studentId,termId};
  }
  const scope=await evidence(31,4);
  await check("eight concurrent calls create one 150 liability and one audit",async()=>{
    const results=await Promise.all(Array.from({length:8},()=>accrueBroCommission(pool,scope,actor)));
    assert.equal(results.filter(r=>!r.existing).length,1);
    assert.equal(new Set(results.map(r=>r.id)).size,1);assert.ok(results.every(r=>r.amountMinor===15000));
    assert.equal((await pool.query("SELECT count(*)::int n FROM audit_logs WHERE event_type='BRO_COMMISSION_EARNED'")).rows[0].n,1);
  });
  await check("replay returns the unchanged earning; collection remains 3200 with zero BRO split",async()=>{
    assert.equal((await accrueBroCommission(pool,scope,actor)).existing,true);
    assert.deepEqual((await pool.query("SELECT amount_minor,school_share_minor,bro_share_minor FROM student_direct_live_obligations WHERE student_id=31")).rows[0],
      {amount_minor:320000,school_share_minor:0,bro_share_minor:0});
  });
  await check("historical paid 100 is preserved and cannot earn again",async()=>{
    const s=await evidence(32,5);
    await pool.query("INSERT INTO student_subscription_payments VALUES(81,5)");
    await pool.query("INSERT INTO commission_ledger VALUES(1,1,32,81,11,'First Term',100,100,'PAID')");
    const before=(await pool.query("SELECT * FROM commission_ledger")).rows;
    await assert.rejects(accrueBroCommission(pool,s,actor),/already earned historically/);
    assert.deepEqual((await pool.query("SELECT * FROM commission_ledger")).rows,before);
  });
  await check("late payment does not reprice a term starting before the boundary",async()=>{
    await assert.rejects(accrueBroCommission(pool,await evidence(33,6,"2026-12-01"),actor),/ineligible/);
  });
  await check("inactive students and cross-school replay are denied",async()=>{
    await assert.rejects(accrueBroCommission(pool,await evidence(34,7,"2027-01-18","INACTIVE"),actor),/unique eligible/);
    await assert.rejects(accrueBroCommission(pool,{...scope,schoolId:2},actor),/another school/);
  });
  await check("audit failure rolls back the actual liability",async()=>{
    const s=await evidence(35,8);
    await pool.query(`CREATE FUNCTION fail_fixture_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.event_type='BRO_COMMISSION_EARNED' AND NEW.metadata->'after'->>'studentId'='35'
        THEN RAISE EXCEPTION 'fixture audit refusal'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER fixture_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_fixture_audit();`);
    await assert.rejects(accrueBroCommission(pool,s,actor),/fixture audit refusal/);
    assert.equal((await pool.query("SELECT count(*)::int n FROM bro_term_commission_entitlements WHERE student_id=35")).rows[0].n,0);
  });
  await check("database rejects editing or deleting frozen earnings",async()=>{
    await assert.rejects(pool.query("UPDATE bro_term_commission_entitlements SET amount_minor=10000"),/append-only/);
    await assert.rejects(pool.query("DELETE FROM bro_term_commission_entitlements"),/append-only/);
  });
  await check("latest unapproved policy never falls back to an older approval",async()=>{
    await pool.query(`INSERT INTO subscription_rule_proposals VALUES
      (3,'BRO_COMMISSION','SCHEDULED',15000,'2027-01-19Z',NULL,'2026-10-27Z',2)`);
    await assert.rejects(accrueBroCommission(pool,await evidence(36,9,"2027-01-20"),actor),/ineligible/);
  });
  console.log(`${passed} isolated PostgreSQL checks passed. No application database or provider accessed.`);
}finally{
  if(pool)await pool.end();
  if(started)run("pg_ctl",["-D",data,"-m","immediate","-w","-t","30","stop"]);
  rmSync(scratch,{recursive:true,force:true});
}
