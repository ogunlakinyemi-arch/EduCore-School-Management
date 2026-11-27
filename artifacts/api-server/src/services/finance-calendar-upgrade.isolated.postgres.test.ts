/**
 * AUTHORED, NOT EXECUTED. Dedicated config only; never launch before the actual
 * 2027-01-18 Lagos clock, or outside the existing credential-free no-egress gate.
 * Minimal schema/native regression evidence is NOT routed payment acceptance.
 */
import {beforeAll,afterAll,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {combinedUpgradeFixture,retainedCombinedEvidence,seedCombinedCalendar} from "./finance-calendar-upgrade.test-support";
import {advanceSchema} from "./advance-subscription-authorizations";
import {rolloverSchoolCalendar,requireCalendarRolloverSchema} from "./academic-calendar-rollover";
import {advanceWindow,ADVANCE_RELEASE} from "./advance-subscription-policy";
let f:Awaited<ReturnType<typeof combinedUpgradeFixture>>;
beforeAll(async()=>{f=await combinedUpgradeFixture();},30000);
afterAll(async()=>{await f?.stop();});
async function tx(run:(c:any)=>Promise<unknown>,commit=false){
 const c=await f.pool.connect();
 try{
  await c.query("BEGIN");await c.query("SET LOCAL lock_timeout='2s';SET LOCAL statement_timeout='10s'");
  const out=await run(c);
  if(commit)await c.query("COMMIT");
  else{await c.query("SET CONSTRAINTS ALL IMMEDIATE");await c.query("ROLLBACK");}
  return out;
 }catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
}
it("installs 0185 then 0186 then 0187 without rewriting populated retained financial evidence",async()=>{
 expect(await retainedCombinedEvidence(f.pool)).toEqual(f.retained);
 expect((await f.pool.query("SELECT allocation_id FROM current_bulk_term_claims WHERE student_id=2 AND academic_term_id=1")).rows)
  .toEqual([{allocation_id:"7001"}]);
 const c=await f.pool.connect();
 try{await advanceSchema(c);await requireCalendarRolloverSchema(c);}finally{c.release();}
});
it("rejects incomplete/null/wrong-type/nonterminal/nonzero retry evidence through the real CHECK",async()=>{
 await tx(c=>c.query(readFileSync(join(f.root,"artifacts/api-server/src/services/fixtures/retry-evidence-regressions.sql"),"utf8")));
});
it("keeps the actual 0182 lead foreign key, rejecting a permission for a nonexistent lead",async()=>{
 await expect(tx(c=>c.query(`INSERT INTO bro_field_sms_permissions(lead_id,allowed,phone,reason,actor_user_id)
  VALUES(999999,true,'0000000000','Fictional FK rejection probe',1)`))).rejects.toMatchObject({code:"23503"});
});
it("tracks an optional split source present at installation",async()=>{
 await tx(async c=>{
  const before=Number((await c.query("SELECT count(*) FROM advance_subscription_changes")).rows[0].count);
  await c.query("INSERT INTO flutterwave_split_payments(school_id,amount_minor) VALUES(1,320000)");
  expect(Number((await c.query("SELECT count(*) FROM advance_subscription_changes")).rows[0].count)).toBe(before+1);
 });
});
it("fails readiness for a later-created split source until the explicit installer is run",async()=>{
 await tx(async c=>{
  await c.query("SAVEPOINT later_source");
  await c.query("CREATE TABLE flutterwave_split_adjustments(id serial PRIMARY KEY,payment_id integer REFERENCES flutterwave_split_payments(id))");
  await expect(advanceSchema(c)).rejects.toThrow("ADVANCE_MATERIAL_REVISION_GUARDS_REQUIRED");
  // Readiness throws in JS, not SQL; the transaction remains usable.
  await c.query("SELECT public.install_advance_subscription_guards()");
  await advanceSchema(c);
  const payment=(await c.query("INSERT INTO flutterwave_split_payments(school_id,amount_minor) VALUES(1,320000) RETURNING id")).rows[0].id;
  await c.query("INSERT INTO flutterwave_split_adjustments(payment_id) VALUES($1)",[payment]);
  expect((await c.query("SELECT source_table FROM advance_subscription_changes ORDER BY id DESC LIMIT 1")).rows[0].source_table)
   .toBe("flutterwave_split_adjustments");
  await c.query("SELECT public.install_advance_subscription_guards()"); // Verified idempotent installer.
  expect((await c.query(`SELECT count(*) FROM pg_trigger WHERE tgrelid='flutterwave_split_adjustments'::regclass
   AND tgname='advance_material_revision'`)).rows[0].count).toBe("1");
 });
});
it("does not silently replace a disabled or unexpected existing source guard",async()=>{
 await expect(tx(async c=>{
  await c.query("ALTER TABLE flutterwave_split_payments DISABLE TRIGGER advance_material_revision");
  await c.query("SELECT public.install_advance_subscription_guards()");
 })).rejects.toThrow("Unexpected advance guard");
});
it("permits multi-statement complete current-calendar onboarding at COMMIT",async()=>{
 await tx(c=>seedCombinedCalendar(c,70),true);
 expect((await f.pool.query("SELECT count(*) FROM academic_terms WHERE school_id=70 AND is_current")).rows[0].count).toBe("1");
});
const invalidEdits=[
 ["session marker cleared","UPDATE academic_sessions SET is_current=false WHERE school_id=71"],
 ["due term marker cleared","UPDATE academic_terms SET is_current=false WHERE school_id=71"],
 ["current term deleted","DELETE FROM academic_terms WHERE school_id=71 AND is_current"],
 ["noncurrent sibling deleted","DELETE FROM academic_terms WHERE school_id=71 AND name='Third Term'"],
 ["sibling ordinal invalid","UPDATE academic_terms SET name='Unknown' WHERE school_id=71 AND name='Third Term'"],
 ["sibling dates overlap","UPDATE academic_terms SET start_date='2027-04-01' WHERE school_id=71 AND name='Third Term'"],
 ["session made inactive","UPDATE academic_sessions SET status='INACTIVE' WHERE school_id=71"],
 ["current term made inactive","UPDATE academic_terms SET status='INACTIVE' WHERE school_id=71 AND is_current"],
] as const;
it.each(invalidEdits)("rejects transaction-final %s and rolls back the whole onboarding",async(_name,sql)=>{
 await expect(tx(async c=>{await seedCombinedCalendar(c,71);await c.query(sql);},true)).rejects.toThrow(/Current academic/);
 expect((await f.pool.query("SELECT id FROM schools WHERE id=71")).rows).toHaveLength(0);
});
it("permits repaired intermediate sibling edits but rejects moving one out of the current session",async()=>{
 await tx(async c=>{
  await seedCombinedCalendar(c,72);
  await c.query("UPDATE academic_terms SET name='Temporary incomplete edit' WHERE id=723");
  await c.query("UPDATE academic_terms SET name='Third Term' WHERE id=723");
 });
 await expect(tx(async c=>{
  await seedCombinedCalendar(c,73);
  await c.query(`INSERT INTO academic_sessions(id,school_id,name,start_date,end_date,status,is_current)
   VALUES(739,73,'Future session','2027-09-01','2028-07-31','PLANNED',false);
   UPDATE academic_terms SET academic_session_id=739 WHERE id=733`);
 },true)).rejects.toThrow("complete unambiguous calendar");
});
it("retains parent FK semantics and permits deleting an entire unused calendar atomically",async()=>{
 await expect(tx(async c=>{
  const session=await seedCombinedCalendar(c,74);
  await c.query("DELETE FROM academic_sessions WHERE id=$1",[session]);
 })).rejects.toMatchObject({code:"23503"});
 await tx(async c=>{
  const session=await seedCombinedCalendar(c,75);
  await c.query("DELETE FROM academic_terms WHERE school_id=75");
  await c.query("DELETE FROM academic_sessions WHERE id=$1",[session]);
 });
});
it("allows ordinary rollover to clear outgoing markers then activate the due term atomically",async()=>{
 expect((await rolloverSchoolCalendar(f.pool,90)).status).toBe("READY");
 expect((await f.pool.query("SELECT id FROM academic_terms WHERE school_id=90 AND is_current")).rows).toEqual([{id:902}]);
});
it("requires revision INSERT and sequence privileges from an invoker-role calendar writer",async()=>{
 await expect(tx(c=>c.query(`SET LOCAL ROLE combined_calendar_writer;
  UPDATE academic_terms SET name='Second Academic Term' WHERE id=1`))).rejects.toMatchObject({code:"42501"});
 await expect(tx(c=>c.query(`GRANT INSERT ON advance_subscription_changes TO combined_calendar_writer;
  SET LOCAL ROLE combined_calendar_writer;
  UPDATE academic_terms SET name='Second Academic Term' WHERE id=1`))).rejects.toMatchObject({code:"42501"});
 await tx(async c=>{
  await c.query(`GRANT INSERT ON advance_subscription_changes TO combined_calendar_writer;
   GRANT USAGE ON SEQUENCE advance_subscription_changes_id_seq TO combined_calendar_writer;
   SET LOCAL ROLE combined_calendar_writer;
   UPDATE academic_terms SET name='Second Academic Term' WHERE id=1`);
  expect((await c.query("SELECT source_table FROM advance_subscription_changes ORDER BY id DESC LIMIT 1")).rows[0].source_table).toBe("academic_terms");
 });
});
it("refuses policy-filtered calendar writes instead of certifying a hidden final state",async()=>{
 await expect(tx(c=>c.query(`ALTER TABLE academic_terms ENABLE ROW LEVEL SECURITY;
  CREATE POLICY fictional_hidden_calendar ON academic_terms TO combined_calendar_writer USING(false) WITH CHECK(false);
  SET LOCAL ROLE combined_calendar_writer;
  UPDATE academic_terms SET name=name WHERE id=1`))).rejects.toThrow("unfiltered calendar visibility");
});
it("does not let a filtered role hide an invalid pending calendar at deferred COMMIT validation",async()=>{
 await expect(tx(async c=>{
  await c.query(`ALTER TABLE academic_terms ENABLE ROW LEVEL SECURITY;
   CREATE POLICY fictional_hidden_final_calendar ON academic_terms TO combined_calendar_writer USING(false) WITH CHECK(false);
   UPDATE academic_terms SET is_current=false WHERE id=1;
   SET LOCAL ROLE combined_calendar_writer`);
 },true)).rejects.toThrow(/Current academic|unfiltered calendar visibility/);
});
it("pins candidate function lookup despite a caller-controlled temporary shadow table",async()=>{
 await tx(async c=>{
  await c.query(`CREATE TEMP TABLE advance_subscription_changes (LIKE public.advance_subscription_changes INCLUDING DEFAULTS) ON COMMIT DROP;
   SET LOCAL search_path=pg_temp,public;
   UPDATE public.academic_terms SET name='Second Academic Term' WHERE id=1`);
  expect((await c.query("SELECT count(*) FROM pg_temp.advance_subscription_changes")).rows[0].count).toBe("0");
  expect((await c.query("SELECT source_table FROM public.advance_subscription_changes ORDER BY id DESC LIMIT 1")).rows[0].source_table).toBe("academic_terms");
 });
});
it("denies installer/history truncation to restricted roles and calendar truncation even to the fixture owner",async()=>{
 await expect(tx(c=>c.query("SET LOCAL ROLE combined_calendar_writer;SELECT public.install_advance_subscription_guards()")))
  .rejects.toMatchObject({code:"42501"});
 await expect(tx(c=>c.query("SET LOCAL ROLE combined_calendar_writer;TRUNCATE advance_subscription_changes")))
  .rejects.toMatchObject({code:"42501"});
 // CASCADE avoids the unrelated FK-before-trigger rejection. This is only the
 // private fixture, and the calendar BEFORE TRUNCATE guard must still abort it.
 await expect(tx(c=>c.query("TRUNCATE academic_terms CASCADE"))).rejects.toThrow("Calendar truncation");
});
it.each(["current_bank_credits","current_bulk_allocation_releases","current_bulk_checkout_attempts",
 "advance_subscription_authorizations","advance_subscription_decisions","academic_calendar_rollovers"])(
 "denies restricted-role TRUNCATE on %s",async table=>{
 await expect(tx(c=>c.query(`SET LOCAL ROLE combined_calendar_writer;TRUNCATE public.${table}`))).rejects.toMatchObject({code:"42501"});
});
async function retryBatch(c:any){
 // Financial D+7 scenario only; other calendar rollover fixtures retain their
 // January 18 resumption. The actual-clock/isolation prerequisites are unchanged.
 await c.query("UPDATE academic_terms SET start_date='2027-01-11' WHERE id=1");
 await c.query("INSERT INTO students(id,school_id,status,admission_status) VALUES(40,1,'ACTIVE','ADMITTED')");
 const version=(await c.query(`SELECT COALESCE(max(id),0)::text AS version FROM advance_subscription_changes
  WHERE school_id IS NULL OR (school_id=1 AND (academic_term_id IS NULL OR academic_term_id=1)
   AND (academic_session_id IS NULL OR academic_session_id=1))`)).rows[0].version;
 const window=advanceWindow("2027-01-11","2027-04-09"),hash="c".repeat(64);
 const snapshot={release:ADVANCE_RELEASE,calendar:{start_date:"2027-01-11",end_date:"2027-04-09",academic_session_id:1},
  eligibleStudentIds:[40],materialVersion:version,reportDigest:hash,merchantScope:"fixture-merchant"};
 const a=(await c.query(`INSERT INTO advance_subscription_authorizations
  (school_id,academic_term_id,rule_id,snapshot,facts_digest,evidence_digest,request_key,merchant_evidence_reference,
   merchant_evidence_hash,not_before,expires_at,created_by,reason)
  VALUES(1,1,1,$1,$2,$2,'combined_retry_000000001','Fictional native evidence',$2,$3,$4,1,'Native guard fixture')
  RETURNING id`,[snapshot,hash,window.notBefore,window.expiresAt])).rows[0].id;
 await c.query(`INSERT INTO advance_subscription_decisions(authorization_id,action,actor_user_id,reason)
  VALUES($1,'REVIEWED',1,'Separate fictional review');
 `,[a]);
 await c.query(`INSERT INTO student_direct_live_reviews(id,school_id,academic_term_id,rule_id,report_digest,
  merchant_scope,no_split_confirmed,approved_by,expires_at,reason)
  VALUES(1001,1,1,1,$1,'fixture-merchant',true,1,$2,'Fictional native approval')`,[hash,window.expiresAt]);
 await c.query(`INSERT INTO advance_subscription_decisions(authorization_id,action,review_id,actor_user_id,reason)
  VALUES($1,'APPROVED',1001,1,'Approve exact fictional evidence')`,[a]);
 const students=[{studentId:40,reviewId:1001,ruleId:1,reviewDigest:hash,merchantScope:"fixture-merchant",amountMinor:320000}];
 const batch=(await c.query(`INSERT INTO current_payment_batches(school_id,academic_term_id,reference,request_key,amount_minor,created_by,snapshot)
  VALUES(1,1,'SCV4_live_bulk_combined_000001','combined_retry_batch_001',320000,2,$1) RETURNING id`,[{students}])).rows[0].id;
 await c.query("INSERT INTO current_bulk_allocations(batch_id,school_id,student_id,academic_term_id,review_id) VALUES($1,1,40,1,1001)",[batch]);
 return {a,batch};
}
const insertRetry=(c:any,batch:string)=>c.query(`INSERT INTO current_bulk_checkout_attempts(batch_id,reference,request_key,
 previous_transaction_id,evidence,reason,created_by) VALUES($1,'SCV4_live_bulk_retry_000001','combined_retry_attempt_001',
 '54321','{"status":"failed","chargedAmountMinor":0}','Fictional raw retry',2)`,[batch]);
it("allows an exactly bound approved aggregate retry insertion",async()=>{
 await tx(async c=>{const r=await retryBatch(c);await insertRetry(c,r.batch);});
});
it.each(["withdrawal","expiry decision","roster revision","split revision","pricing revision"] as const)("blocks raw aggregate retry after %s",async change=>{
 await expect(tx(async c=>{
  const r=await retryBatch(c);
  if(change==="withdrawal")await c.query(`INSERT INTO advance_subscription_decisions(authorization_id,action,actor_user_id,reason)
   VALUES($1,'WITHDRAWN',1,'Withdraw fictional authorization')`,[r.a]);
  if(change==="expiry decision")await c.query(`INSERT INTO advance_subscription_decisions(authorization_id,action,reason)
   VALUES($1,'EXPIRED','Retained terminal expiry decision')`,[r.a]);
  if(change==="roster revision")await c.query("UPDATE students SET status='INACTIVE' WHERE id=40");
  if(change==="split revision")await c.query("INSERT INTO flutterwave_split_payments(school_id,amount_minor) VALUES(1,320000)");
  if(change==="pricing revision")await c.query("UPDATE subscription_rule_proposals SET amount_minor=330000 WHERE id=1");
  await insertRetry(c,r.batch);
 })).rejects.toThrow(/Advance authorization|Bulk retry review/);
});
it("recovers forward after a failed 0187 file without replaying committed 0185/0186 or rewriting history",async()=>{
 const partial=await combinedUpgradeFixture(false);
 const c=await partial.pool.connect();
 try{
  const sql=partial.source("0187_automatic_academic_calendar_rollover.sql");
  const injected=sql.replace(/COMMIT;\s*$/,"SELECT 1/0;\nCOMMIT;");
  expect(injected).not.toBe(sql);
  await expect(c.query(injected)).rejects.toMatchObject({code:"22012"});
  await c.query("ROLLBACK");
  expect((await c.query(`SELECT to_regclass('public.academic_calendar_rollovers') AS calendar,
   to_regclass('public.current_bank_credits') IS NOT NULL AS bank,
   to_regclass('public.advance_subscription_authorizations') IS NOT NULL AS advance`)).rows[0])
   .toEqual({calendar:null,bank:true,advance:true});
  expect(await retainedCombinedEvidence(c)).toEqual(partial.retained);
  await c.query(sql);await requireCalendarRolloverSchema(c);
  expect(await retainedCombinedEvidence(c)).toEqual(partial.retained);
 }finally{c.release();await partial.stop();}
},30000);
