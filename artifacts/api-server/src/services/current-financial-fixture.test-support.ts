import {execFileSync} from "node:child_process";
import {mkdtempSync,mkdirSync,readFileSync,realpathSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import assert from "node:assert/strict";
import pg from "pg";

/** Unix-socket-only fictional cluster. Never reads DATABASE_URL or app secrets. */
export async function currentFinancialFixture() {
  assert.equal(process.env.NODE_ENV,"test");
  const scratch=mkdtempSync(join(tmpdir(),"educore-current-lifecycle-"));
  const data=join(scratch,"data"),socket=join(scratch,"socket");
  mkdirSync(socket,{mode:0o700});
  const env={PATH:process.env.PATH,HOME:scratch,LANG:"C.UTF-8",NODE_ENV:"test"};
  const run=(cmd:string,args:string[])=>execFileSync(cmd,args,{env,stdio:"pipe",encoding:"utf8"});
  let started=false;
  const pool=new pg.Pool({host:socket,port:56453,user:"current_fixture",database:"postgres",
    max:6,connectionTimeoutMillis:5000});
  const stop=async()=>{
    await pool.end();
    if(started)run("pg_ctl",["-D",data,"-m","immediate","-w","stop"]);
    rmSync(scratch,{recursive:true,force:true});
  };
  try {
    run("initdb",["-D",data,"-A","trust","-U","current_fixture","--no-locale","--encoding=UTF8","--no-sync"]);
    run("pg_ctl",["-D",data,"-l",join(scratch,"postgres.log"),"-o",`-k ${socket} -h '' -p 56453`,"-w","start"]);
    started=true;
    const identity=(await pool.query("SELECT inet_server_addr() AS ip,current_setting('data_directory') AS data")).rows[0];
    assert.equal(identity.ip,null);assert.equal(realpathSync(identity.data),realpathSync(data));
    const root=resolve(process.cwd(),"../..");
    const {baseline,migrationPaths}=await import(pathToFileURL(join(root,"scripts/src/direct-release-migrations-native-check.mjs")).href);
    await pool.query(baseline);
    for(const path of migrationPaths)await pool.query(readFileSync(join(root,path),"utf8"));
    await pool.query(readFileSync(join(root,"lib/db/drizzle/0181_current_subscription_lifecycle.sql"),"utf8"));
    await pool.query(`
      ALTER TABLE app_users ADD COLUMN status text NOT NULL DEFAULT 'ACTIVE';
      ALTER TABLE schools ADD COLUMN status text NOT NULL DEFAULT 'ACTIVE';
      ALTER TABLE commission_ledger ADD COLUMN payment_id integer,
        ADD COLUMN student_id integer,ADD COLUMN school_id integer,ADD COLUMN academic_session_id integer;
      ALTER TABLE student_subscription_payments ADD COLUMN academic_term_id integer;
      CREATE TABLE school_memberships(user_id integer REFERENCES app_users(id),school_id integer,role text,status text);
      CREATE TABLE partner_payouts(id integer PRIMARY KEY,payment_reference text);
      CREATE TABLE student_subscription_terms(student_id integer,school_id integer,academic_term_id integer);
      INSERT INTO app_users(id) VALUES(2),(3),(4),(5);
      INSERT INTO school_memberships VALUES(1,NULL,'PLATFORM_OWNER','ACTIVE'),(2,1,'SCHOOL_ADMIN','ACTIVE'),
        (3,1,'ACCOUNTANT','ACTIVE'),(4,1,'PARENT','ACTIVE'),(5,2,'SCHOOL_ADMIN','ACTIVE');
      INSERT INTO schools(id) VALUES(2);
      INSERT INTO students VALUES(2,1,'ACTIVE','ADMITTED'),(3,2,'ACTIVE','ADMITTED');
      INSERT INTO academic_sessions VALUES(2,2,'ACTIVE');
      INSERT INTO academic_terms VALUES(2,2,2,'2027-01-18','2027-04-09','Second Term',true,'ACTIVE');
      INSERT INTO partner_profiles VALUES(1,'ACTIVE');
      INSERT INTO school_partner_attributions VALUES(1,1,1,'ACTIVE','2026-10-27Z',NULL);
      INSERT INTO subscription_rule_proposals(id,product,status,amount_minor,effective_at,reason,created_by,updated_by,activated_at)
      VALUES(1,'STUDENT_PLATFORM','ACTIVE',320000,'2026-10-27Z','Fictional approved student policy',1,1,'2026-10-27Z'),
        (2,'BRO_COMMISSION','ACTIVE',15000,'2026-10-27Z','Fictional approved BRO policy',1,1,'2026-10-27Z');
    `);
    const reset=async(withEntitlement=true)=>{
      await pool.query(`TRUNCATE current_subscription_operations,student_direct_live_events,
        bro_term_commission_entitlements,student_direct_live_attempts,student_direct_live_obligations,
        student_direct_live_reviews RESTART IDENTITY CASCADE;
        TRUNCATE partner_payouts,student_subscription_terms;
        UPDATE partner_profiles SET status='ACTIVE';
        UPDATE students SET status='ACTIVE';
        INSERT INTO student_direct_live_reviews(id,school_id,academic_term_id,rule_id,report_digest,
          merchant_scope,no_split_confirmed,approved_by,expires_at,reason)
          VALUES(1,1,1,1,repeat('a',64),'fixture-merchant',true,1,now()+interval '2 years','Fictional review');
        INSERT INTO student_direct_live_obligations(id,school_id,student_id,academic_term_id,
          rule_id,review_id,merchant_scope,created_by) VALUES(1,1,1,1,1,1,'fixture-merchant',1);
        INSERT INTO student_direct_live_attempts(id,obligation_id,reference,idempotency_key,state,
          provider_transaction_id,provider_reference,provider_fee_minor,additional_fee_minor,verified_at,created_by)
          VALUES(1,1,'SCV4_live_fixture_1111111111','fixture_current_11111','PAID','12345','fixture-provider',0,0,'2027-03-01Z',1);
        INSERT INTO student_direct_live_events(attempt_id,kind,details)
          VALUES(1,'PROVIDER_PAYMENT_VERIFIED','{"transactionId":"12345"}');
      `);
      if(withEntitlement)await pool.query(`INSERT INTO bro_term_commission_entitlements
        (id,school_id,student_id,academic_term_id,partner_profile_id,attribution_id,policy_id,
         direct_obligation_id,direct_attempt_id,amount_minor,earned_at,evidence,created_by)
        VALUES(1,1,1,1,1,1,2,1,1,15000,'2027-03-01Z',
          '{"funding":"SEPARATE_PLATFORM_EXPENSE","studentCollectionMinor":320000,"collectionBroShareMinor":0}',1)`);
    };
    return {pool,reset,stop,root};
  } catch(error) { await stop();throw error; }
}
