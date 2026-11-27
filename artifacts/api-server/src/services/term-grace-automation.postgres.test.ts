import {readFileSync} from "node:fs";
import {join} from "node:path";
import {afterAll,beforeAll,beforeEach,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({db:null as any,notifications:[] as any[]}));
vi.mock("@workspace/db",()=>({pool:{
 query:(...args:any[])=>{if(!state.db)throw Error("Application database forbidden");return state.db.query(...args);},
 connect:()=>{if(!state.db)throw Error("Application database forbidden");return state.db.connect();},
}}));
vi.mock("./communication-service",()=>({queueCommunicationNotification:async(_db:any,input:any)=>{
 state.notifications.push(input);return state.notifications.length;
}}));
import {currentFinancialFixture} from "./current-financial-fixture.test-support";
import {readSchoolSubscription,reconcileSchoolSubscription,assertSubscriptionAccess} from "./subscription-enforcement";
import {readStudentTermPlatformAccess} from "./student-platform-access";
import {readStudentUsageRollout} from "./student-platform-rollout";
import {changeFreeTermGrant} from "./owner-free-academic-terms";

let f:Awaited<ReturnType<typeof currentFinancialFixture>>;
const schoolCalendar=async(school:number,elapsed:number,endOffset=40)=>{
 await f.pool.query(`UPDATE academic_terms SET start_date=(NOW() AT TIME ZONE 'Africa/Lagos')::date-$2::int,
  end_date=(NOW() AT TIME ZONE 'Africa/Lagos')::date+$3::int WHERE school_id=$1`,[school,elapsed,endOffset]);
};
async function financialSnapshot(){
 const result:Record<string,unknown>={};
 for(const table of ["student_direct_live_reviews","student_direct_live_obligations","student_direct_live_attempts",
  "student_direct_live_events","current_payment_batches","current_bulk_allocations","current_bulk_events",
  "student_subscription_payments","commission_ledger","bro_term_commission_entitlements","nfc_cards"])
  result[table]=(await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows;
 return result;
}
beforeAll(async()=>{
 f=await currentFinancialFixture();state.db=f.pool;
 await f.pool.query(`CREATE UNIQUE INDEX grace_term_tenant ON academic_terms(id,school_id);
  CREATE UNIQUE INDEX grace_session_tenant ON academic_sessions(id,school_id);
  ALTER TABLE schools ADD COLUMN name text DEFAULT 'Fictional school';
  ALTER TABLE app_users ADD COLUMN first_name text DEFAULT 'Fictional',ADD COLUMN last_name text DEFAULT 'Person';
  ALTER TABLE students ADD COLUMN user_id integer;
  CREATE TABLE parents(id integer PRIMARY KEY,user_id integer,school_id integer,status text);
  CREATE TABLE parent_student_relationships(parent_id integer,student_id integer,status text);
  INSERT INTO parents VALUES(4,4,1,'ACTIVE');
  INSERT INTO parent_student_relationships VALUES(4,2,'ACTIVE');
  CREATE TABLE nfc_cards(id integer PRIMARY KEY,school_id integer,student_id integer,status text);
  INSERT INTO nfc_cards VALUES(1,1,1,'ACTIVE'),(2,1,2,'ACTIVE'),(3,2,3,'ACTIVE');
  CREATE TABLE employee_nfc_card_bindings(nfc_card_id integer,school_id integer,status text);
  CREATE TABLE platform_devices(id integer PRIMARY KEY,school_id integer,status text);
  CREATE TABLE audit_logs(id bigserial PRIMARY KEY,"user" text,role text,actor_user_id integer,clerk_user_id text,
   school_id integer,action text,module text,record_id integer,severity text,event_type text,result text,metadata jsonb);
  UPDATE academic_sessions SET start_date=(NOW() AT TIME ZONE 'Africa/Lagos')::date-365,
   end_date=(NOW() AT TIME ZONE 'Africa/Lagos')::date+365;`);
 for(const file of ["0182_current_bulk_withdrawals_field_sms.sql","0049_term_subscription_enforcement.sql",
  "0050_independent_owner_school_lock.sql","0183_owner_free_academic_terms.sql"])
  await f.pool.query(readFileSync(join(f.root,"lib/db/drizzle",file),"utf8"));
 await schoolCalendar(1,7);await schoolCalendar(2,6);
 // Independently verified fictional payment evidence, not a paid flag or school
 // receipt. The JS and PostgreSQL clocks stay real; fixture calendars surround it.
 await f.pool.query(`INSERT INTO student_direct_live_reviews(id,school_id,academic_term_id,rule_id,report_digest,
  merchant_scope,no_split_confirmed,approved_by,expires_at,reason)
  VALUES(1,1,1,1,repeat('a',64),'fixture-merchant',true,1,now()+interval '1 year','Fictional review');
  INSERT INTO student_direct_live_obligations(id,school_id,student_id,academic_term_id,rule_id,review_id,merchant_scope,created_by)
   VALUES(1,1,1,1,1,1,'fixture-merchant',1);
  INSERT INTO student_direct_live_attempts(id,obligation_id,reference,idempotency_key,state,provider_transaction_id,
   provider_reference,provider_fee_minor,additional_fee_minor,verified_at,created_by)
   VALUES(1,1,'SCV4_live_fixture_1111111111','fixture_current_11111','PAID','12345','fixture-provider',0,0,now(),1);
  INSERT INTO student_direct_live_events(attempt_id,kind,details)
   VALUES(1,'PROVIDER_PAYMENT_VERIFIED','{"transactionId":"12345"}');`);
},60000);
afterAll(async()=>{state.db=null;await f?.stop();});
beforeEach(async()=>{
 state.notifications=[];
 await f.pool.query("TRUNCATE school_subscription_enforcement,audit_logs,school_subscription_manual_locks");
 await schoolCalendar(1,7);await schoolCalendar(2,6);
});
it.each([
 [-1,null],[0,false],[6,false],[7,true],
] as const)("uses the school's own calendar at D%+d without charging or activating a term",async(elapsed,restricted)=>{
 await schoolCalendar(1,elapsed);
 const before=await financialSnapshot();
 const calendar=(await f.pool.query("SELECT to_jsonb(t) AS row FROM academic_terms t ORDER BY id")).rows;
 const snapshot=await readSchoolSubscription(f.pool,1);
 if(restricted===null)expect(snapshot).toBeNull();
 else{
  expect(snapshot?.restrictedStudentIds).toEqual(restricted?[2]:[]);
  expect(snapshot?.schoolLocked).toBe(false);
 }
 const access=await readStudentTermPlatformAccess(f.pool,1,2);
 expect(access.restricted).toBe(restricted===true);
 await reconcileSchoolSubscription(1,"AUTOMATIC_TERM_ENFORCEMENT");
 expect(await financialSnapshot()).toEqual(before);
 expect((await f.pool.query("SELECT to_jsonb(t) AS row FROM academic_terms t ORDER BY id")).rows).toEqual(calendar);
});
it("keeps two schools' D+6/D+7 transitions independent and verified students entitled",async()=>{
 expect((await readSchoolSubscription(f.pool,1))?.restrictedStudentIds).toEqual([2]);
 expect(await readSchoolSubscription(f.pool,2)).toMatchObject({inGracePeriod:true,restrictedStudentIds:[]});
 expect(await readStudentTermPlatformAccess(f.pool,1,1)).toMatchObject({status:"VERIFIED",restricted:false});
 await expect(assertSubscriptionAccess(1,1,f.pool)).resolves.toBeUndefined();
 await expect(assertSubscriptionAccess(1,2,f.pool)).rejects.toMatchObject({statusCode:403,eventType:"STUDENT_PLATFORM_SUBSCRIPTION_REQUIRED"});
 expect((await f.pool.query("SELECT status FROM nfc_cards ORDER BY id")).rows).toEqual([{status:"ACTIVE"},{status:"ACTIVE"},{status:"ACTIVE"}]);
});
it("enforces through the inclusive term end, but not after expiry or outside a short term's valid dates",async()=>{
 await schoolCalendar(1,20,0);
 expect((await readSchoolSubscription(f.pool,1))?.restrictedStudentIds).toEqual([2]);
 await schoolCalendar(1,20,-1);
 expect(await readSchoolSubscription(f.pool,1)).toBeNull();
 expect(await readStudentTermPlatformAccess(f.pool,1,2)).toMatchObject({status:"NOT_REQUIRED",restricted:false});
 await schoolCalendar(1,7,-2); // A six-day term ended before D+7.
 expect((await readStudentUsageRollout(f.pool,1)).chargeable).toBe(false);
});
it("persists enforcement once per school/term without duplicate notices, obligations, charges or calendar writes",async()=>{
 const before=await financialSnapshot();
 expect(await reconcileSchoolSubscription(1,"AUTOMATIC_TERM_ENFORCEMENT")).toMatchObject({changed:true,state:"SUBSCRIPTION_RESTRICTED"});
 const notes=state.notifications.length,audits=(await f.pool.query("SELECT count(*)::int AS n FROM audit_logs")).rows[0].n;
 expect(notes).toBeGreaterThan(0);
 expect(await reconcileSchoolSubscription(1,"AUTOMATIC_TERM_ENFORCEMENT")).toMatchObject({changed:false});
 expect(state.notifications).toHaveLength(notes);
 expect((await f.pool.query("SELECT count(*)::int AS n FROM audit_logs")).rows[0].n).toBe(audits);
 expect((await f.pool.query("SELECT version,restricted_student_ids FROM school_subscription_enforcement")).rows)
  .toEqual([{version:1,restricted_student_ids:[2]}]);
 expect(await financialSnapshot()).toEqual(before);
});
it("lets a free-term grant restore access without payment claims, new charges or a waiver inherited by another school",async()=>{
 await reconcileSchoolSubscription(1,"AUTOMATIC_TERM_ENFORCEMENT");
 const before=await financialSnapshot();
 const term=(await f.pool.query("SELECT start_date::text AS start,end_date::text AS finish FROM academic_terms WHERE id=1")).rows[0];
 await changeFreeTermGrant(f.pool,1,{schoolId:1,sessionId:1,termId:1,startDate:term.start,endDate:term.finish,
  reason:"Fictional free academic term verification",confirmed:true},"grant");
 state.notifications=[];
 expect(await readSchoolSubscription(f.pool,1)).toMatchObject({status:"NOT_REQUIRED",restrictedStudentIds:[],outstandingMinor:0});
 expect(await readStudentTermPlatformAccess(f.pool,1,2)).toMatchObject({status:"NOT_REQUIRED",restricted:false});
 expect(await reconcileSchoolSubscription(1,"AUTOMATIC_TERM_ENFORCEMENT")).toMatchObject({changed:true});
 const audit=(await f.pool.query(`SELECT metadata FROM audit_logs WHERE event_type='SUBSCRIPTION_ENFORCEMENT' ORDER BY id DESC LIMIT 1`)).rows[0];
 expect(audit.metadata.source).not.toBe("SUBSCRIPTION_PAYMENT_RESTORATION");
 const guardian=state.notifications.find(n=>n.subjectStudentId===2);
 expect(guardian).toBeDefined();expect(guardian.subject+" "+guardian.body).not.toMatch(/verified|paid/i);
 const notes=state.notifications.length;
 expect(await reconcileSchoolSubscription(1,"AUTOMATIC_TERM_ENFORCEMENT")).toMatchObject({changed:false});
 expect(state.notifications).toHaveLength(notes);
 await schoolCalendar(2,7);
 expect((await readSchoolSubscription(f.pool,2))?.restrictedStudentIds).toEqual([3]);
 await changeFreeTermGrant(f.pool,1,{schoolId:1,sessionId:1,termId:1,startDate:term.start,endDate:term.finish,
  reason:"Fictional explicit suspension verification",confirmed:true},"suspend");
 expect(await readStudentTermPlatformAccess(f.pool,1,1)).toMatchObject({status:"VERIFIED",restricted:false});
 expect(await readStudentTermPlatformAccess(f.pool,1,2)).toMatchObject({status:"PAYMENT_REQUIRED",restricted:true});
 expect(await financialSnapshot()).toEqual(before);
});
