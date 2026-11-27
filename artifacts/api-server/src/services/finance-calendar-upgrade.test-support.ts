/** No startup import. Only the dedicated, isolated, fixed-clock test uses this. */
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {currentFinancialFixture} from "./current-financial-fixture.test-support";
import {calendarLagosDay} from "./academic-calendar-rollover-policy";
import type {CurrentSql} from "./current-financial-contract";

export async function seedCombinedCalendar(c:CurrentSql,school:number,stale=false){
 const session=school*10;
 await c.query("INSERT INTO schools(id,status) VALUES($1,'ACTIVE')",[school]);
 await c.query(`INSERT INTO academic_sessions(id,school_id,name,start_date,end_date,status,is_current)
  VALUES($1,$2,'Fictional complete session','2026-09-01','2027-07-31','ACTIVE',true)`,[session,school]);
 for(const [i,name,start,end] of [
  [1,"First Term","2026-09-07","2026-12-18"],
  [2,"Second Term","2027-01-18","2027-04-09"],
  [3,"Third Term","2027-04-26","2027-07-23"],
 ] as const)await c.query(`INSERT INTO academic_terms(id,school_id,academic_session_id,name,start_date,end_date,status,is_current)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[session+i,school,session,name,start,end,
   i===(stale?1:2)?"ACTIVE":"PLANNED",i===(stale?1:2)]);
 return session;
}
export async function retainedCombinedEvidence(c:CurrentSql){
 const result:Record<string,unknown>={};
 for(const table of ["student_subscription_payments","commission_ledger","student_direct_live_reviews",
  "student_direct_live_obligations","student_direct_live_attempts","student_direct_live_events",
  "current_payment_batches","current_bulk_allocations","current_bulk_confirmations","current_bulk_events"]){
  result[table]=(await c.query(`SELECT to_jsonb(r) AS row FROM public.${table} r ORDER BY to_jsonb(r)::text`)).rows;
 }
 return result;
}
export async function combinedUpgradeFixture(installCalendar=true){
 // Deliberately preserve the actual-date requirement. No fake clock injection.
 assert.equal(calendarLagosDay(new Date()),"2027-01-18","Actual opening-day clock required");
 const f=await currentFinancialFixture();
 try{
  assert.equal((await f.pool.query("SELECT (clock_timestamp() AT TIME ZONE 'Africa/Lagos')::date::text AS day")).rows[0].day,"2027-01-18");
  const manifest=JSON.parse(readFileSync(join(f.root,"artifacts/api-server/src/services/fixtures/finance-calendar-upgrade-manifest.json"),"utf8"));
  assert.deepEqual(manifest.candidates,["0185_company_bank_remittance_recovery.sql",
   "0186_advance_subscription_authorizations.sql","0187_automatic_academic_calendar_rollover.sql"]);
  const source=(name:string)=>readFileSync(join(f.root,"lib/db/drizzle",name),"utf8");
  await f.pool.query(`ALTER TABLE academic_sessions ADD UNIQUE(id,school_id);
   ALTER TABLE academic_terms ADD UNIQUE(id,school_id),
    ADD CONSTRAINT combined_calendar_tenant_fk FOREIGN KEY(academic_session_id,school_id) REFERENCES academic_sessions(id,school_id),
    ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp();
   INSERT INTO academic_terms(id,school_id,academic_session_id,name,start_date,end_date,status,is_current)
    VALUES(3,1,1,'First Term','2026-09-07','2026-12-18','INACTIVE',false),
     (4,1,1,'Third Term','2027-04-26','2027-07-23','PLANNED',false),
     (5,2,2,'First Term','2026-09-07','2026-12-18','INACTIVE',false),
     (6,2,2,'Third Term','2027-04-26','2027-07-23','PLANNED',false);
   CREATE TABLE audit_logs(id bigserial PRIMARY KEY,"user" text,role text,school_id integer,action text,
    module text,record_id bigint,event_type text,result text,metadata jsonb);
   -- Minimal optional legacy source: tests revision coverage, not split settlement.
   CREATE TABLE flutterwave_split_payments(id serial PRIMARY KEY,school_id integer REFERENCES schools(id),subscription_id integer,amount_minor integer);
   REVOKE CREATE ON SCHEMA public FROM PUBLIC;
   CREATE ROLE combined_calendar_writer NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;`);
  await seedCombinedCalendar(f.pool,90,true); // Retained missed-run state, before guards.
  await f.reset(false);
  const c=await f.pool.connect();
  try{
   for(const name of manifest.prerequisites){
    const text=source(name);
    await c.query(name.startsWith("0183")?`BEGIN;\n${text}\nCOMMIT;`:text);
   }
   await c.query(`INSERT INTO current_payment_batches(id,school_id,academic_term_id,reference,request_key,amount_minor,created_by,snapshot)
    VALUES(7001,1,1,'SCV4_live_bulk_retained_00001','retained_batch_00000001',320000,2,
     '{"students":[{"studentId":2,"reviewId":1,"ruleId":1,"reviewDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","merchantScope":"fixture-merchant","amountMinor":320000}]}');
    INSERT INTO current_bulk_allocations(id,batch_id,school_id,student_id,academic_term_id,review_id) VALUES(7001,7001,1,2,1,1);
    INSERT INTO current_bulk_confirmations(batch_id,provider_transaction_id,provider_reference,amount_minor,evidence)
     VALUES(7001,'54321','retained-provider-proof',320000,'{"legacy":"retained verbatim"}');
    INSERT INTO current_bulk_events(batch_id,allocation_id,event_key,state,actor_user_id,details)
     VALUES(7001,7001,'retained_post_00000001','POSTED',2,'{"retained":true}');`);
   const retained=await retainedCombinedEvidence(c);
   await c.query(source(manifest.candidates[0]));
   await c.query(source(manifest.candidates[1]));
   if(installCalendar)await c.query(source(manifest.candidates[2]));
   await c.query(`GRANT USAGE ON SCHEMA public TO combined_calendar_writer;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO combined_calendar_writer;
    GRANT UPDATE ON academic_terms,academic_sessions,students TO combined_calendar_writer;`);
   return {...f,source,retained};
  }catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
 }catch(error){await f.stop();throw error;}
}
