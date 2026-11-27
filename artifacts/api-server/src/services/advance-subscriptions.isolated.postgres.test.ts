/**
 * NOT EXECUTED. Dedicated no-egress configuration only. This fixture requires
 * actual matched JS/PostgreSQL clocks on 2027-01-18 in an approved isolated lab.
 * Never rewrite SQL clocks, broaden calendars or use an application target.
 * Raw evidence here exercises native guards, not full routed service acceptance.
 */
import {beforeAll,beforeEach,afterAll,it,expect} from "vitest";
import assert from "node:assert/strict";
import {readFileSync,readlinkSync} from "node:fs";
import {join} from "node:path";
import {currentFinancialFixture} from "./current-financial-fixture.test-support";
import {advanceWindow,ADVANCE_RELEASE} from "./advance-subscription-policy";
let f:Awaited<ReturnType<typeof currentFinancialFixture>>;
beforeAll(async()=>{
 assert.notEqual(readlinkSync("/proc/self/ns/net"),readlinkSync("/proc/1/ns/net"),"No-egress namespace required");
 f=await currentFinancialFixture();
 const today=(await f.pool.query("SELECT (clock_timestamp() AT TIME ZONE 'Africa/Lagos')::date::text AS day")).rows[0].day;
 assert.equal(today,"2027-01-18","Native boundary fixture requires its actual opening-day clock");
 assert.equal(new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Lagos",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date()),today);
 await f.pool.query(`ALTER TABLE academic_sessions ADD COLUMN is_current boolean NOT NULL DEFAULT true;
  INSERT INTO academic_terms VALUES(3,1,1,'2027-01-19','2027-04-09','Future Term',false,'PLANNED')`);
 await f.pool.query(readFileSync(join(f.root,"lib/db/drizzle/0186_advance_subscription_authorizations.sql"),"utf8"));
},30000);
afterAll(async()=>{await f?.stop();});
beforeEach(async()=>{
 await f.pool.query("TRUNCATE advance_subscription_authorizations,advance_subscription_changes RESTART IDENTITY CASCADE");
 await f.pool.query("DELETE FROM academic_terms WHERE id=4");
 await f.reset(false);
 await f.pool.query("UPDATE academic_terms SET status='PLANNED',is_current=false WHERE id=3");
});
async function authorize(termId=1,reviewed=true,reportDigest="b".repeat(64)){
 const t=(await f.pool.query("SELECT start_date::text AS start,end_date::text AS end FROM academic_terms WHERE id=$1",[termId])).rows[0];
 const version=(await f.pool.query(`SELECT COALESCE(max(id),0)::text AS version FROM advance_subscription_changes
  WHERE school_id IS NULL OR (school_id=1 AND (academic_term_id IS NULL OR academic_term_id=$1)
   AND (academic_session_id IS NULL OR academic_session_id=1))`,[termId])).rows[0].version;
 const window=advanceWindow(t.start,t.end);
 const snapshot={release:ADVANCE_RELEASE,calendar:{start_date:t.start,end_date:t.end,academic_session_id:1},eligibleStudentIds:[2],
  materialVersion:version,reportDigest:"b".repeat(64),merchantScope:"fixture-merchant"};
 const a=Number((await f.pool.query(`INSERT INTO advance_subscription_authorizations
 (school_id,academic_term_id,rule_id,snapshot,facts_digest,evidence_digest,merchant_evidence_reference,merchant_evidence_hash,
  not_before,expires_at,created_by,reason,request_key) VALUES(1,$1,1,$2::jsonb,$3,$4,'Fictional evidence',$3,$5,$6,1,'Fictional native guard probe','native_request_000000000') RETURNING id`,
 [termId,JSON.stringify(snapshot),"a".repeat(64),"c".repeat(64),window.notBefore,window.expiresAt])).rows[0].id);
 if(reviewed)await f.pool.query(`INSERT INTO advance_subscription_decisions(authorization_id,action,actor_user_id,reason)
 VALUES($1,'REVIEWED',1,'Separate native evidence review')`,[a]);
 const review=Number((await f.pool.query(`INSERT INTO student_direct_live_reviews
 (id,school_id,academic_term_id,rule_id,report_digest,merchant_scope,no_split_confirmed,approved_by,expires_at,reason,approved_at)
 VALUES(100+$1,1,$1,1,$2,'fixture-merchant',true,1,$3,'Explicit native fixture approval',LEAST(clock_timestamp(),$4::timestamptz)) RETURNING id`,
 [termId,reportDigest,window.expiresAt,window.notBefore])).rows[0].id);
 await f.pool.query(`INSERT INTO advance_subscription_decisions(authorization_id,action,actor_user_id,reason,review_id)
 VALUES($1,'APPROVED',1,'Approve exact native fixture evidence',$2)`,[a,review]);
 return {a,review,termId};
}
const insertObligation=(r:{review:number;termId:number})=>f.pool.query(`INSERT INTO student_direct_live_obligations
 (school_id,student_id,academic_term_id,rule_id,review_id,merchant_scope,created_by)
 VALUES(1,2,$1,1,$2,'fixture-merchant',2) RETURNING id`,[r.termId,r.review]);
it("native guard rejects early obligation even with an approved future authorization",async()=>{
 const r=await authorize(3);
 await expect(insertObligation(r)).rejects.toThrow("Advance authorization does not permit checkout now");
});
it("advance approval requires a separate reviewed decision",async()=>{
 await expect(authorize(3,false)).rejects.toThrow("Advance approval requires an exact separately reviewed binding");
});
it("advance approval rejects a changed reconciliation digest",async()=>{
 await expect(authorize(3,true,"d".repeat(64))).rejects.toThrow("Advance approval requires an exact separately reviewed binding");
});
it("native guard allows opening-day obligation only with actual current active school term",async()=>{
 const r=await authorize();
 expect((await insertObligation(r)).rowCount).toBe(1);
});
it.each(["start_date","end_date"])("calendar %s edits remain invalid after being changed back",async(field)=>{
 const r=await authorize();
 await f.pool.query(`UPDATE academic_terms SET ${field}=${field}+1 WHERE id=1`);
 await f.pool.query(`UPDATE academic_terms SET ${field}=${field}-1 WHERE id=1`);
 await expect(insertObligation(r)).rejects.toThrow("Advance authorization does not permit checkout now");
});
it("roster changes invalidate retained evidence even if eligibility is later restored",async()=>{
 const r=await authorize();
 await f.pool.query("UPDATE students SET admission_status='PENDING' WHERE id=2");
 await f.pool.query("UPDATE students SET admission_status='ADMITTED' WHERE id=2");
 await expect(insertObligation(r)).rejects.toThrow("Advance authorization does not permit checkout now");
});
it("expected lifecycle transition does not change the retained material revision",async()=>{
 const before=(await f.pool.query("SELECT count(*) FROM advance_subscription_changes")).rows[0].count;
 await f.pool.query("UPDATE academic_terms SET status='ACTIVE',is_current=true WHERE id=3");
 expect((await f.pool.query("SELECT count(*) FROM advance_subscription_changes")).rows[0].count).toBe(before);
});
it("closing the previous term does not invalidate the reviewed target term",async()=>{
 await f.pool.query(`INSERT INTO academic_terms VALUES(4,1,1,'2026-09-01','2026-12-18','Previous Term',true,'ACTIVE')`);
 const r=await authorize();
 await f.pool.query("UPDATE academic_terms SET is_current=false,status='INACTIVE' WHERE id=4");
 expect((await insertObligation(r)).rowCount).toBe(1);
});
it("withdrawal blocks a new attempt for an already created obligation",async()=>{
 const r=await authorize(),o=Number((await insertObligation(r)).rows[0].id);
 await f.pool.query(`INSERT INTO advance_subscription_decisions(authorization_id,action,actor_user_id,reason)
 VALUES($1,'WITHDRAWN',1,'Owner withdrew native fixture approval')`,[r.a]);
 await expect(f.pool.query(`INSERT INTO student_direct_live_attempts(obligation_id,reference,idempotency_key,state,created_by)
 VALUES($1,'SCV4_live_native_advance_00000000','native_advance_fixture_key','RESERVED',2)`,[o]))
  .rejects.toThrow("Advance authorization does not permit checkout now");
});
it("history and the exact term-wide window cannot be rewritten",async()=>{
 await authorize();
 await f.pool.query("INSERT INTO advance_subscription_changes(school_id,source_table) VALUES(1,'fictional_history_probe')");
 await expect(f.pool.query("UPDATE advance_subscription_authorizations SET expires_at=expires_at+interval '1 day'")).rejects.toThrow("append-only");
 await expect(f.pool.query("DELETE FROM advance_subscription_decisions")).rejects.toThrow("append-only");
 await expect(f.pool.query("DELETE FROM advance_subscription_changes")).rejects.toThrow("append-only");
});
it("native guard rejects an expired reviewed term without changing either clock",async()=>{
 await f.pool.query(`INSERT INTO academic_terms VALUES(4,1,1,'2027-01-01','2027-01-17','Ended Term',true,'ACTIVE')`);
 const r=await authorize(4);
 expect((await f.pool.query(`SELECT clock_timestamp()>=expires_at AS expired
  FROM advance_subscription_authorizations WHERE id=$1`,[r.a])).rows[0].expired).toBe(true);
 await expect(insertObligation(r)).rejects.toThrow("Advance authorization does not permit checkout now");
});
it("ordinary current-term requests still reject an expiry exceeding seven days",async()=>{
 await expect(f.pool.query(`INSERT INTO student_direct_live_release_requests
  (school_id,academic_term_id,rule_id,snapshot,facts_digest,evidence_digest,merchant_evidence_reference,
   merchant_evidence_hash,policy,no_split_confirmed,expires_at,created_by,reason)
  VALUES(1,1,1,'{}',$1,$2,'Fictional evidence',$1,'NEW_ONLY_PRESERVE_LEGACY',true,
    clock_timestamp()+interval '8 days',1,'Native current-term seven-day preservation')`,
  ["a".repeat(64),"d".repeat(64)])).rejects.toThrow();
});
