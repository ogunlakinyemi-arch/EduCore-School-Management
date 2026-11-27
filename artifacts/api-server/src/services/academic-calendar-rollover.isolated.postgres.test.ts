/**
 * AUTHORED, NOT EXECUTED. Explicit no-egress lab configuration only.
 * Actual JS AND PostgreSQL clocks must be 2027-01-18 in Africa/Lagos.
 * No clock rewriting, application credentials, TCP or application DB fallback.
 */
import {beforeAll,afterAll,it,expect} from "vitest";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {join} from "node:path";
// @ts-expect-error Review-only isolation utility has no declaration emit.
import {requireIsolatedFinanceFixture} from "../../../../scripts/src/require-isolated-finance-fixture.mjs";
import {currentFinancialFixture} from "./current-financial-fixture.test-support";
import {calendarFixture} from "./academic-calendar-rollover.test-support";
import {calendarLagosDay,calendarDigest} from "./academic-calendar-rollover-policy";
import {rolloverSchoolCalendar} from "./academic-calendar-rollover";
import {ADVANCE_RELEASE,advanceWindow} from "./advance-subscription-policy";
let f:Awaited<ReturnType<typeof currentFinancialFixture>>;
beforeAll(async()=>{
 requireIsolatedFinanceFixture();assert.equal(calendarLagosDay(new Date()),"2027-01-18","Actual lab opening-day clock required");
 f=await currentFinancialFixture();
 assert.equal((await f.pool.query("SELECT (clock_timestamp() AT TIME ZONE 'Africa/Lagos')::date::text AS day")).rows[0].day,"2027-01-18");
 await f.pool.query(`ALTER TABLE academic_sessions
  ADD COLUMN name text NOT NULL DEFAULT 'Fictional retained session',
  ADD COLUMN start_date date NOT NULL DEFAULT '2026-09-01',ADD COLUMN end_date date NOT NULL DEFAULT '2027-07-31',
  ADD COLUMN is_current boolean NOT NULL DEFAULT false,ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp();
  ALTER TABLE academic_terms ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp();
  CREATE TABLE audit_logs(id bigserial PRIMARY KEY,"user" text,role text,school_id integer,action text,module text,
   record_id bigint,event_type text,result text,metadata jsonb);`);
 // Seed retained stale markers BEFORE installing new guards: represent missed
 // runs, not a privileged bypass of an installed operational calendar contract.
 for(let id=101;id<=112;id++){
  await f.pool.query("INSERT INTO schools(id,status) VALUES($1,'ACTIVE')",[id]);
  await f.pool.query("INSERT INTO students(id,school_id,status,admission_status) VALUES($1,$2,'ACTIVE','ADMITTED')",[id+1000,id]);
  const data=calendarFixture(id,2026,id===103?25:18),s=data.sessions[0];
  if(id===111){
   s.startDate="2027-01-01";s.endDate="2027-12-31";
   [data.terms[0].startDate,data.terms[0].endDate]=["2027-01-18","2027-04-09"];
   [data.terms[1].startDate,data.terms[1].endDate]=["2027-04-26","2027-07-23"];
   [data.terms[2].startDate,data.terms[2].endDate]=["2027-09-07","2027-12-18"];
  }
  if(id===112){
   s.startDate="2026-04-01";s.endDate="2027-03-31";
   [data.terms[0].startDate,data.terms[0].endDate]=["2026-04-26","2026-07-23"];
   [data.terms[1].startDate,data.terms[1].endDate]=["2026-09-07","2026-12-18"];
   [data.terms[2].startDate,data.terms[2].endDate]=["2027-01-18","2027-03-31"];
  }
  if(id===104)data.terms.pop();
  await f.pool.query(`INSERT INTO academic_sessions(id,school_id,name,start_date,end_date,status,is_current)
   VALUES($1,$2,$3,$4,$5,$6,$7)`,[s.id,id,s.name,s.startDate,s.endDate,id===106||id===110?"PLANNED":"ACTIVE",id!==106&&id!==110]);
  for(const [i,t]of data.terms.entries())await f.pool.query(`INSERT INTO academic_terms
   (id,school_id,academic_session_id,name,start_date,end_date,status,is_current) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
   [t.id,id,s.id,t.name,t.startDate,t.endDate,i===0&&id!==111?"ACTIVE":"PLANNED",i===0&&id!==111]);
  if(id===106){
   const old=calendarFixture(id,2025).sessions[0];
   await f.pool.query(`INSERT INTO academic_sessions(id,school_id,name,start_date,end_date,status,is_current)
    VALUES($1,$2,$3,$4,$5,'ACTIVE',true)`,[old.id,id,old.name,old.startDate,old.endDate]);
  }
 }
 await f.pool.query(readFileSync(join(f.root,"lib/db/drizzle/0186_advance_subscription_authorizations.sql"),"utf8"));
 await f.pool.query(readFileSync(join(f.root,"lib/db/drizzle/0187_automatic_academic_calendar_rollover.sql"),"utf8"));
},30000);
afterAll(async()=>{await f?.stop();});
const state=async(id:number)=>(await f.pool.query("SELECT id,status,is_current FROM academic_terms WHERE school_id=$1 ORDER BY id",[id])).rows;
it("activates the due second term and closes the prior term in one audited transition",async()=>{
 await rolloverSchoolCalendar(f.pool,101);const rows=await state(101);
 expect(rows[0]).toMatchObject({status:"INACTIVE",is_current:false});expect(rows[1]).toMatchObject({status:"ACTIVE",is_current:true});
 const audit=(await f.pool.query("SELECT calendar_snapshot,changes FROM academic_calendar_rollovers WHERE school_id=101")).rows;
 expect(audit).toHaveLength(1);expect(audit[0].calendar_snapshot.terms[0].isCurrent).toBe(true);
});
it("is idempotent across independent invocations and new worker instances",async()=>{
 await rolloverSchoolCalendar(f.pool,102);await rolloverSchoolCalendar(f.pool,102);
 expect((await f.pool.query("SELECT count(*)::int AS n FROM academic_calendar_rollovers WHERE school_id=102")).rows[0].n).toBe(1);
 expect((await state(102)).filter(r=>r.is_current)).toHaveLength(1);
});
it("closes expired markers without opening a staggered school's future term or changing another school",async()=>{
 const before=await state(101);await rolloverSchoolCalendar(f.pool,103);
 expect((await state(103)).some(r=>r.is_current)).toBe(false);expect(await state(101)).toEqual(before);
 const t=calendarFixture(103).terms[1];
 await expect(f.pool.query("UPDATE academic_terms SET status='ACTIVE',is_current=true WHERE id=$1",[t.id]))
  .rejects.toThrow("saved WAT dates");
 await expect(f.pool.query("UPDATE academic_terms SET status='ACTIVE',is_current=true WHERE id=$1",[calendarFixture(103).terms[0].id]))
  .rejects.toThrow("saved WAT dates");
});
it("blocks incomplete calendars, clears invalid current markers and deduplicates later observations",async()=>{
 expect((await rolloverSchoolCalendar(f.pool,104)).status).toBe("BLOCKED");
 expect((await state(104)).some(r=>r.is_current)).toBe(false);
 await rolloverSchoolCalendar(f.pool,104);const before=(await f.pool.query("SELECT count(*) FROM academic_calendar_rollovers WHERE school_id=104")).rows[0].count;
 await rolloverSchoolCalendar(f.pool,104);
 expect((await f.pool.query("SELECT count(*) FROM academic_calendar_rollovers WHERE school_id=104")).rows[0].count).toBe(before);
});
it("revalidates a saved overlapping edit rather than activating stale term evidence",async()=>{
 await f.pool.query("UPDATE academic_terms SET start_date='2027-04-01' WHERE id=$1",[calendarFixture(105).terms[2].id]);
 expect((await rolloverSchoolCalendar(f.pool,105)).status).toBe("BLOCKED");expect((await state(105)).some(r=>r.is_current)).toBe(false);
});
it("closes a missed prior session and activates only the due saved session",async()=>{
 await rolloverSchoolCalendar(f.pool,106);
 const sessions=(await f.pool.query("SELECT status,is_current FROM academic_sessions WHERE school_id=106 ORDER BY start_date")).rows;
 expect(sessions).toEqual([{status:"INACTIVE",is_current:false},{status:"ACTIVE",is_current:true}]);
});
it("retains immutable history against update, delete and truncate",async()=>{
 await rolloverSchoolCalendar(f.pool,107);
 await expect(f.pool.query("UPDATE academic_calendar_rollovers SET result='BLOCKED' WHERE school_id=107")).rejects.toThrow("immutable");
 await expect(f.pool.query("DELETE FROM academic_calendar_rollovers WHERE school_id=107")).rejects.toThrow("immutable");
 await expect(f.pool.query("TRUNCATE academic_calendar_rollovers")).rejects.toThrow("immutable");
});
it("rolls calendar and retained transition back together if ordinary audit retention fails",async()=>{
 await f.pool.query(`CREATE FUNCTION fictional_calendar_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
  BEGIN RAISE EXCEPTION 'Fictional audit retention failure'; END $$;
  CREATE TRIGGER fictional_calendar_audit_failure BEFORE INSERT ON audit_logs FOR EACH ROW
   WHEN (NEW.school_id=108) EXECUTE FUNCTION fictional_calendar_audit_failure()`);
 const before=await state(108);
 try{await expect(rolloverSchoolCalendar(f.pool,108)).rejects.toThrow("Fictional audit retention failure");
  expect(await state(108)).toEqual(before);
  expect((await f.pool.query("SELECT count(*)::int AS n FROM academic_calendar_rollovers WHERE school_id=108")).rows[0].n).toBe(0);
 }finally{await f.pool.query("DROP TRIGGER fictional_calendar_audit_failure ON audit_logs; DROP FUNCTION fictional_calendar_audit_failure()");}
});
it("waits for a concurrent calendar writer and plans from its committed dates",async()=>{
 const editor=await f.pool.connect(),target=calendarFixture(109).terms[1].id;
 let ready!:(id:number)=>void;const pidReady=new Promise<number>(r=>{ready=r;});let running:Promise<unknown>|undefined;
 try{
  await editor.query("BEGIN");const editorPid=(await editor.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
  await editor.query("UPDATE academic_terms SET start_date='2027-01-25' WHERE id=$1",[target]);
  running=rolloverSchoolCalendar({connect:async()=>{const c=await f.pool.connect();ready((await c.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);return c;}},109);
  const pid=await pidReady;let blocked=false;
  for(let i=0;i<50;i++){
   const blockers=(await f.pool.query("SELECT pg_blocking_pids($1) AS ids",[pid])).rows[0].ids;
   if(blockers.includes(editorPid)){blocked=true;break;}await new Promise(r=>setTimeout(r,10));
  }
  expect(blocked).toBe(true);await editor.query("COMMIT");await running;
  expect((await state(109)).some(r=>r.is_current)).toBe(false);
 }finally{await editor.query("ROLLBACK").catch(()=>undefined);editor.release();await running?.catch(()=>undefined);}
});
it("preserves native advance approval across rollover but rejects a material calendar edit",async()=>{
 const schoolId=110,term=calendarFixture(schoolId).terms[1],studentId=1110,reviewId=5110,window=advanceWindow(term.startDate,term.endDate);
 const revision=async()=>String((await f.pool.query(`SELECT coalesce(max(id),0)::text AS v FROM advance_subscription_changes
  WHERE school_id IS NULL OR (school_id=$1 AND (academic_term_id IS NULL OR academic_term_id=$2)
   AND (academic_session_id IS NULL OR academic_session_id=$3))`,[schoolId,term.id,term.sessionId])).rows[0].v);
 const version=await revision(),snapshot={release:ADVANCE_RELEASE,calendar:{start_date:term.startDate,end_date:term.endDate,
  academic_session_id:term.sessionId},eligibleStudentIds:[studentId],materialVersion:version,reportDigest:"b".repeat(64),merchantScope:"fixture-merchant"};
 const authorization=(await f.pool.query(`INSERT INTO advance_subscription_authorizations(school_id,academic_term_id,rule_id,snapshot,
  facts_digest,evidence_digest,request_key,merchant_evidence_reference,merchant_evidence_hash,not_before,expires_at,created_by,reason)
  VALUES($1,$2,1,$3::jsonb,$4,$5,'native_calendar_approval_fixture','Fictional reviewed evidence',$4,$6,$7,1,'Fictional native approval') RETURNING id`,
  [schoolId,term.id,JSON.stringify(snapshot),"a".repeat(64),calendarDigest({schoolId}),window.notBefore,window.expiresAt])).rows[0].id;
 await f.pool.query(`INSERT INTO advance_subscription_decisions(authorization_id,action,actor_user_id,reason)
  VALUES($1,'REVIEWED',1,'Separate fictional native review')`,[authorization]);
 await f.pool.query(`INSERT INTO student_direct_live_reviews(id,school_id,academic_term_id,rule_id,report_digest,merchant_scope,
  no_split_confirmed,approved_by,expires_at,reason,approved_at) VALUES($1,$2,$3,1,$4,'fixture-merchant',true,1,$5,'Fictional native approval',
   LEAST(clock_timestamp(),$6::timestamptz))`,[reviewId,schoolId,term.id,"b".repeat(64),window.expiresAt,window.notBefore]);
 await f.pool.query(`INSERT INTO advance_subscription_decisions(authorization_id,action,actor_user_id,reason,review_id)
  VALUES($1,'APPROVED',1,'Approve exact fictional binding',$2)`,[authorization,reviewId]);
 await rolloverSchoolCalendar(f.pool,schoolId);expect(await revision()).toBe(version);
 const obligation=(await f.pool.query(`INSERT INTO student_direct_live_obligations(school_id,student_id,academic_term_id,rule_id,
  review_id,merchant_scope,created_by) VALUES($1,$2,$3,1,$4,'fixture-merchant',1) RETURNING id`,[schoolId,studentId,term.id,reviewId])).rows[0].id;
 await f.pool.query("UPDATE academic_terms SET is_current=false,start_date='2027-01-25' WHERE id=$1",[term.id]);
 expect(await revision()).not.toBe(version);
 await expect(f.pool.query(`INSERT INTO student_direct_live_attempts(obligation_id,reference,idempotency_key,state,created_by)
  VALUES($1,'SCV4_live_calendar_native_00000','calendar_native_material_change','RESERVED',1)`,[obligation]))
  .rejects.toThrow("Advance authorization does not permit checkout now");
});
it.each([[111,0],[112,2]])("opens the actual due term for fictional calendar %s",async(schoolId,ordinal)=>{
 await rolloverSchoolCalendar(f.pool,schoolId);const rows=await state(schoolId);
 expect(rows[ordinal]).toMatchObject({status:"ACTIVE",is_current:true});
 expect(rows.filter(r=>r.is_current)).toHaveLength(1);
});
