import {beforeAll,beforeEach,afterAll,it,expect,vi} from "vitest";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {currentFinancialFixture} from "./current-financial-fixture.test-support";
import {requestCurrentBroWithdrawal,decideCurrentBroWithdrawal} from "./current-bro-withdrawals";
import {createCurrentBulk,verifyCurrentBulk,recoverCurrentBulk,verifyPublicCurrentBulk,type BulkDependencies} from "./current-bulk-subscriptions";
import {readCurrentFinanceOverview,readCurrentBulkReceipt} from "./current-finance-overview";
import {requestCurrentStudentRefund,approveCurrentStudentRefund,dispatchCurrentStudentRefund,reconcileCurrentStudentRefund} from "./current-student-refunds";
import {initiateCurrentBroPayout} from "./current-bro-lifecycle";
import {recordFieldPermission,previewFieldSms,dispatchFieldSms,readFieldSms} from "./bro-field-sms";
import {smsEventAllowed,withFieldSmsCampaignScope} from "./sms-event-policy";
import {verifiedBulkStudentIds} from "./current-bulk-payment-evidence";
import type {CurrentCapabilities} from "./current-financial-contract";
let f:Awaited<ReturnType<typeof currentFinancialFixture>>;
const key=(s:string)=>`integration_fixture_${s}_000000`;
const now=()=>new Date("2027-05-01T12:00:00Z");
let bulk:BulkDependencies;
const input=(s="batch")=>({schoolId:1,termId:1,studentIds:[2,4],key:key(s),reason:"Fictional batch review"});
const caps:CurrentCapabilities={now,bank:async()=>({verified:true,fingerprint:"fixture",
 sealed:{ciphertext:"fixture-sealed",keyVersion:"fixture"},maskedAccountNumber:"****0001"})};
beforeAll(async()=>{
 f=await currentFinancialFixture();
 await f.pool.query(`ALTER TABLE app_users ADD COLUMN email text;
 ALTER TABLE schools ADD COLUMN name text,ADD COLUMN address text,ADD COLUMN phone text;
 ALTER TABLE students ADD COLUMN first_name text,ADD COLUMN last_name text;
 ALTER TABLE partner_profiles ADD COLUMN user_id integer,ADD COLUMN full_name text;
 CREATE TABLE audit_logs(id bigserial PRIMARY KEY,actor_user_id integer,school_id integer,result text,"user" text,
   "timestamp" timestamptz DEFAULT now(),role text,action text,module text,event_type text,record_id bigint,
   metadata jsonb NOT NULL DEFAULT '{}');
 CREATE TABLE bro_field_leads(id bigserial PRIMARY KEY,school_id integer,school_name text,address text,
   contact_phone text,visit_date date,status text);
 INSERT INTO app_users(id,status,email) VALUES(6,'ACTIVE','bro@example.invalid'),(7,'ACTIVE','other@example.invalid');
 INSERT INTO school_memberships VALUES(6,NULL,'PARTNER','ACTIVE'),(7,NULL,'PARTNER','ACTIVE');
 INSERT INTO students(id,school_id,status,admission_status,first_name,last_name) VALUES(4,1,'ACTIVE','ADMITTED','Four','Student');
 UPDATE app_users SET email='owner@example.invalid' WHERE id IN(1,2,3);
 UPDATE partner_profiles SET user_id=6,full_name='Fictional BRO';
 INSERT INTO partner_profiles VALUES(2,'ACTIVE',7,'Other Fictional BRO');
 UPDATE schools SET name='Fictional enrolled school',address='Registered street',phone='08030000000';
 INSERT INTO audit_logs(role,event_type,record_id,metadata) SELECT 'PLATFORM_OWNER','SUBSCRIPTION_RULE_ACTIVATED',id,
   jsonb_build_object('after',jsonb_build_object('product',product,'amountMinor',amount_minor,'version',version,'effectiveAt',effective_at))
 FROM subscription_rule_proposals WHERE product='BRO_COMMISSION';`);
 // Only this disposable DDL's default clock is fixed to the fictional payment
 // date; production candidate SQL and shared settings are never changed.
 await f.pool.query(readFileSync(join(f.root,"lib/db/drizzle/0182_current_bulk_withdrawals_field_sms.sql"),"utf8")
   .replace(/\bnow\(\)/g,"TIMESTAMPTZ '2027-03-01T12:00:00Z'"));
},30000);
afterAll(async()=>{await f?.stop();});
beforeEach(async()=>{
 await f.pool.query(`TRUNCATE current_payment_batches,current_bro_withdrawals,bro_field_sms_permissions,
   bro_field_sms_campaigns,bro_field_leads RESTART IDENTITY CASCADE;`);
 await f.reset(true);
 bulk={
  now:()=>new Date("2027-03-01T12:00:00Z"),
  review:async()=>({id:1,rule_id:1,report_digest:"a".repeat(64),merchant_scope:"fixture-merchant"}),
  revalidate:async()=>true,
  checkout:vi.fn(async()=>"https://checkout.flutterwave.com/fixture"),
  verify:vi.fn(async(transactionId,reference,amountMinor)=>({transactionId,reference,amountMinor,currency:"NGN",
    providerReference:`provider-${transactionId}`,status:"successful" as const,providerFeeMinor:1000,additionalFeeMinor:0})),
 };
});
async function collected(){
 const b=await createCurrentBulk(f.pool,2,input(),bulk);
 await verifyCurrentBulk(f.pool,2,b.id,"998877",bulk);return b;
}
it("BRO requests own entitlements; one Owner line decision unlocks the existing payout preparation",async()=>{
 expect((await readCurrentFinanceOverview(f.pool,6,undefined,undefined,now())).summary).toMatchObject({
   requestedMinor:0,pendingApprovalMinor:0,paidMinor:0,failedMinor:0,reversedMinor:0});
 const r=await requestCurrentBroWithdrawal(f.pool,6,["D:1"],key("withdraw"),"Withdraw my verified earnings");
 expect((await readCurrentFinanceOverview(f.pool,6,undefined,undefined,now())).summary).toMatchObject({
   requestedMinor:15000,pendingApprovalMinor:15000,paidMinor:0});
 await expect(requestCurrentBroWithdrawal(f.pool,7,["D:1"],key("foreign"),"Foreign attempt")).rejects.toThrow("OWN_ENTITLEMENT_REQUIRED");
 await expect(decideCurrentBroWithdrawal(f.pool,6,{requestId:r.id,entitlementKey:"D:1",decision:"APPROVED",
   key:key("notowner"),reason:"Not the Owner"},caps)).rejects.toThrow("FINANCIAL_ACTOR_NOT_AUTHORIZED");
 await decideCurrentBroWithdrawal(f.pool,1,{requestId:r.id,entitlementKey:"D:1",decision:"APPROVED",
   key:key("approve"),reason:"Owner reviewed student"},caps);
 expect((await readCurrentFinanceOverview(f.pool,6,undefined,undefined,now())).summary).toMatchObject({
   requestedMinor:15000,pendingApprovalMinor:0,approvedMinor:15000,availableMinor:15000,paidMinor:0});
 const p=await initiateCurrentBroPayout(f.pool,1,1,key("payout"),"Prepare external payout",caps);
 expect(p.state).toBe("PENDING");
 expect((await readCurrentFinanceOverview(f.pool,6,undefined,undefined,now())).summary).toMatchObject({
   requestedMinor:15000,pendingApprovalMinor:0,availableMinor:0,paidMinor:0});
 expect((await f.pool.query("SELECT count(*) FROM current_subscription_operation_events WHERE state='APPROVED'")).rows[0].count).toBe("1");
});
it("concurrent withdrawal requests cannot claim an entitlement twice",async()=>{
 const results=await Promise.allSettled(["first","second"].map(s=>requestCurrentBroWithdrawal(f.pool,6,["D:1"],key(s),"Withdraw verified earnings")));
 expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
 expect((await f.pool.query("SELECT count(*) FROM current_bro_withdrawal_lines")).rows[0].count).toBe("1");
});
it("request replay binds the same actor, selection and reason",async()=>{
 const a=await requestCurrentBroWithdrawal(f.pool,6,["D:1"],key("same"),"Verified request");
 expect((await requestCurrentBroWithdrawal(f.pool,6,["D:1"],key("same"),"Verified request")).id).toBe(a.id);
 await expect(requestCurrentBroWithdrawal(f.pool,6,["D:1"],key("same"),"Different reason")).rejects.toThrow("IDEMPOTENCY_CONTENT_CONFLICT");
});
it("rejection is audited per entitlement and cannot become approval through another key",async()=>{
 const r=await requestCurrentBroWithdrawal(f.pool,6,["D:1"],key("w"),"Verified request");
 const d={requestId:r.id,entitlementKey:"D:1",decision:"REJECTED" as const,key:key("reject"),reason:"Owner rejected this line"};
 await decideCurrentBroWithdrawal(f.pool,1,d,caps);
 await expect(decideCurrentBroWithdrawal(f.pool,1,{...d,decision:"APPROVED",key:key("another")},caps)).rejects.toThrow("ALREADY_DECIDED");
});
it("bulk starts one aggregate checkout and retrying the same key never POSTs twice",async()=>{
 const b=await createCurrentBulk(f.pool,2,input(),bulk);
 expect(b.amountMinor).toBe(640000);expect(b.state).toBe("READY");
 expect((await createCurrentBulk(f.pool,2,input(),bulk)).id).toBe(b.id);
 expect(bulk.checkout).toHaveBeenCalledTimes(1);
 expect((await f.pool.query("SELECT count(*) FROM student_direct_live_attempts")).rows[0].count).toBe("1");
});
it("concurrent overlapping batches cannot collect the same students",async()=>{
 const r=await Promise.allSettled(["one","two"].map(s=>createCurrentBulk(f.pool,2,input(s),bulk)));
 expect(r.filter(v=>v.status==="fulfilled")).toHaveLength(1);expect(bulk.checkout).toHaveBeenCalledTimes(1);
});
it("lost checkout response is held UNKNOWN with a permanent claim and no resend",async()=>{
 bulk.checkout=vi.fn(async()=>{throw new Error("lost response");});
 expect((await createCurrentBulk(f.pool,2,input(),bulk)).state).toBe("UNKNOWN");
 await createCurrentBulk(f.pool,2,input(),bulk);expect(bulk.checkout).toHaveBeenCalledTimes(1);
});
it("rejects cross-school selection, inactive students, stale reviews and original paid direct sources",async()=>{
 await expect(createCurrentBulk(f.pool,5,input(),bulk)).rejects.toThrow("SCOPE_NOT_AUTHORIZED");
 await expect(createCurrentBulk(f.pool,2,{...input(),studentIds:[1]},bulk)).rejects.toThrow("INELIGIBLE");
 bulk.revalidate=async()=>false;
 await expect(createCurrentBulk(f.pool,2,input(),bulk)).rejects.toThrow("REVIEW_CHANGED");
 expect(bulk.checkout).not.toHaveBeenCalled();
});
it("verification posts exactly once, accrues individual bulk entitlements, and produces both receipt levels",async()=>{
 const b=await collected();await verifyCurrentBulk(f.pool,2,b.id,"998877",bulk);await recoverCurrentBulk(f.pool,2,b.id);
 expect((await f.pool.query("SELECT count(*) FROM current_bulk_confirmations")).rows[0].count).toBe("1");
 expect((await f.pool.query("SELECT count(*) FROM current_bulk_events WHERE state='POSTED'")).rows[0].count).toBe("2");
 expect((await f.pool.query("SELECT sum(amount_minor)::int AS total FROM current_bulk_bro_entitlements")).rows[0].total).toBe(30000);
 const receipt=await readCurrentBulkReceipt(f.pool,2,b.id);
 expect(receipt).toMatchObject({amountMinor:640000,refundedMinor:0});expect(receipt.items).toHaveLength(2);
 expect((await readCurrentBulkReceipt(f.pool,2,b.id,receipt.items[0].id)).amountMinor).toBe(320000);
 await expect(readCurrentBulkReceipt(f.pool,5,b.id)).rejects.toThrow("SCOPE_NOT_AUTHORIZED");
 expect([...(await verifiedBulkStudentIds(f.pool,1,1))].sort()).toEqual([2,4]);
});
it("a public callback retains independent aggregate facts but exposes no student data or anonymous allocation authority",async()=>{
 const b=await createCurrentBulk(f.pool,2,input(),bulk);
 expect(await verifyPublicCurrentBulk(f.pool,b.reference,"998877",bulk)).toEqual({reference:b.reference,state:"VERIFIED",allocationRecoveryRequired:true});
 expect((await f.pool.query("SELECT count(*) FROM current_bulk_events WHERE state='POSTED'")).rows[0].count).toBe("0");
 await recoverCurrentBulk(f.pool,1,b.id);
 expect((await readCurrentBulkReceipt(f.pool,1,b.id)).items).toHaveLength(2);
});
it("rejects aggregate amount mismatch without posting or earning",async()=>{
 const b=await createCurrentBulk(f.pool,2,input(),bulk);
 bulk.verify=async(t,r)=>({transactionId:t,reference:r,amountMinor:320000,currency:"NGN",providerReference:"bad",
  status:"successful",providerFeeMinor:0,additionalFeeMinor:0});
 await expect(verifyCurrentBulk(f.pool,2,b.id,"998877",bulk)).rejects.toThrow("VERIFICATION_MISMATCH");
 expect((await f.pool.query("SELECT count(*) FROM current_bulk_confirmations")).rows[0].count).toBe("0");
});
it("a delayed failed read cannot rewind an independently confirmed aggregate",async()=>{
 const b=await collected();
 bulk.verify=async(t,r,a)=>({transactionId:t,reference:r,amountMinor:a,currency:"NGN",providerReference:"provider-998877",
  status:"failed",providerFeeMinor:null,additionalFeeMinor:null});
 expect(await verifyCurrentBulk(f.pool,2,b.id,"998877",bulk)).toMatchObject({state:"COMPLETED",ignoredStaleProviderOutcome:true});
 expect((await readCurrentBulkReceipt(f.pool,2,b.id)).amountMinor).toBe(640000);
});
it("partial allocation failure retains aggregate success and retries only unresolved work without charging again",async()=>{
 const b=await createCurrentBulk(f.pool,2,input(),bulk);
 await f.pool.query(`CREATE FUNCTION fixture_child_failure() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN IF NEW.student_id=4 THEN RAISE EXCEPTION 'fictional child failure'; END IF; RETURN NEW; END $$;
   CREATE TRIGGER fixture_child_failure BEFORE INSERT ON current_bulk_bro_entitlements
   FOR EACH ROW EXECUTE FUNCTION fixture_child_failure();`);
 try{
  expect(await verifyCurrentBulk(f.pool,2,b.id,"998877",bulk)).toMatchObject({state:"RECOVERY_REQUIRED",unresolved:1});
  expect((await f.pool.query("SELECT count(*) FROM current_bulk_confirmations")).rows[0].count).toBe("1");
  expect((await f.pool.query("SELECT count(*) FROM current_bulk_events WHERE state='POSTED'")).rows[0].count).toBe("1");
  await expect(readCurrentBulkReceipt(f.pool,2,b.id)).rejects.toThrow("MUST_BE_POSTED");
 }finally{await f.pool.query("DROP TRIGGER fixture_child_failure ON current_bulk_bro_entitlements; DROP FUNCTION fixture_child_failure()");}
 expect(await recoverCurrentBulk(f.pool,2,b.id)).toMatchObject({state:"COMPLETED",chargedAgain:false});
 expect((await f.pool.query("SELECT count(*) FROM current_bulk_events WHERE state='POSTED'")).rows[0].count).toBe("2");
 expect(bulk.checkout).toHaveBeenCalledTimes(1);
});
it("bulk BRO sources enter the same one-decision withdrawal and payout lifecycle",async()=>{
 await collected();const e=(await f.pool.query("SELECT id FROM current_bulk_bro_entitlements ORDER BY id LIMIT 1")).rows[0];
 const k=`B:${e.id}`;
 const r=await requestCurrentBroWithdrawal(f.pool,6,[k],key("bulkw"),"Request aggregate-backed earning");
 await decideCurrentBroWithdrawal(f.pool,1,{requestId:r.id,entitlementKey:k,decision:"APPROVED",
  key:key("bulkapprove"),reason:"Owner reviewed aggregate child"},caps);
 expect((await initiateCurrentBroPayout(f.pool,1,{bulkEntitlementId:Number(e.id)},key("bulkpayout"),"Prepare verified beneficiary payout",caps)).state).toBe("PENDING");
});
it("student-specific partial batch refund changes only its own accounting and BRO hold",async()=>{
 const b=await collected(),receipt=await readCurrentBulkReceipt(f.pool,1,b.id),a=receipt.items[0].id;
 const r=await requestCurrentStudentRefund(f.pool,1,{allocationId:a},10000,key("refund"),"Refund selected child");
 const deps:CurrentCapabilities={refunds:{request:async()=>({providerReference:"555"}),
  verify:async ref=>({requestReference:ref,collectionTransactionId:"998877",providerReference:"555",amountMinor:10000,currency:"NGN",status:"SUCCEEDED"})}};
 await approveCurrentStudentRefund(f.pool,1,r.id,key("refundapprove"));
 await dispatchCurrentStudentRefund(f.pool,1,r.id,deps);await reconcileCurrentStudentRefund(f.pool,1,r.id,deps);
 const after=await readCurrentBulkReceipt(f.pool,1,b.id);
 expect(after.refundedMinor).toBe(10000);expect(after.netPaidMinor).toBe(630000);
 expect(after.items.filter(i=>i.refundedMinor===0)).toHaveLength(1);
 expect((await f.pool.query("SELECT count(*) FROM current_bulk_events WHERE state='ADVERSE_HOLD'")).rows[0].count).toBe("2");
});
it("BRO projections exclude other BROs and school collection records; Owner and own totals agree",async()=>{
 await collected();
 const mine=await readCurrentFinanceOverview(f.pool,6,undefined,undefined,now());
 const owner=await readCurrentFinanceOverview(f.pool,1,undefined,undefined,now());
 const other=await readCurrentFinanceOverview(f.pool,7,undefined,undefined,now());
 expect(mine.summary).toEqual(owner.summary);expect(mine.summary.earnedMinor).toBe(45000);
 expect(mine.payments).toEqual([]);expect(mine.schools).toEqual([]);expect(other.entitlements).toEqual([]);
 await expect(readCurrentFinanceOverview(f.pool,4)).rejects.toThrow("ACCESS_DENIED");
});
async function leads(){
 await f.pool.query(`INSERT INTO bro_field_leads(school_name,address,contact_phone,visit_date,status)
   VALUES('Prospect One','Prospect street one','08031111111','2026-11-01','Visited'),
   ('Prospect Two','Prospect street two','08032222222','2026-11-01','Interested')`);
 for(const id of [1,2])await recordFieldPermission(f.pool,1,id,true,"Recorded explicit contact permission");
}
it("campaign preview requires contact permission and Owner confirmation; it sends nothing",async()=>{
 await leads();const p=await previewFieldSms(f.pool,1,{message:"Fictional follow-up",key:key("sms"),all:true});
 expect(p.recipients).toHaveLength(2);
 expect((await f.pool.query("SELECT count(*) FROM bro_field_sms_events")).rows[0].count).toBe("0");
 await expect(dispatchFieldSms(f.pool,1,p.id,p.digest,false,{transportAllowed:async()=>true})).rejects.toThrow("CONFIRMATION_REQUIRED");
 await expect(recordFieldPermission(f.pool,6,1,true,"Unauthorized change")).rejects.toThrow("FINANCIAL_ACTOR_NOT_AUTHORIZED");
});
it("send-time onboarding and opt-out changes exclude recipients before any transport call",async()=>{
 await leads();const p=await previewFieldSms(f.pool,1,{message:"Fictional follow-up",key:key("sms"),all:true});
 await f.pool.query("UPDATE bro_field_leads SET school_id=1 WHERE id=1");
 await recordFieldPermission(f.pool,1,2,false,"Contact withdrew permission");
 const provider={provider:"fixture",channel:"sms" as const,send:vi.fn()};
 const sent=await dispatchFieldSms(f.pool,1,p.id,p.digest,true,{transportAllowed:async()=>true,provider});
 expect(sent.recipients.every(r=>r.state==="EXCLUDED")).toBe(true);expect(provider.send).not.toHaveBeenCalled();
});
it("accepted campaigns never resend successful recipients and timeout/unknown acceptance is held",async()=>{
 await leads();const p=await previewFieldSms(f.pool,1,{message:"Fictional follow-up",key:key("sms"),all:true});
 const provider={provider:"fixture",channel:"sms" as const,send:vi.fn(async({to}:{to:string})=>{
  if(to.endsWith("1111111"))return {provider:"fixture",channel:"sms" as const,status:"ACCEPTED" as const,accepted:true,delivered:false,providerMessageId:"fixture-accepted"};
  throw new Error("response lost");
 })};
 const deps={transportAllowed:async()=>true,provider};
 const sent=await dispatchFieldSms(f.pool,1,p.id,p.digest,true,deps);
 expect(sent.recipients.map(r=>r.state).sort()).toEqual(["ACCEPTED","UNKNOWN"]);
 await dispatchFieldSms(f.pool,1,p.id,p.digest,true,deps);expect(provider.send).toHaveBeenCalledTimes(2);
});
it("SMS extension is scoped, leaves parent notification categories alone and preserves pauses",async()=>{
 expect(smsEventAllowed("BRO_FIELD_FOLLOWUP")).toBe(false);
 expect(await withFieldSmsCampaignScope(async()=>smsEventAllowed("BRO_FIELD_FOLLOWUP"))).toBe(true);
 expect(smsEventAllowed("UNRELATED")).toBe(false);expect(smsEventAllowed("EMERGENCY")).toBe(true);
 await leads();const p=await previewFieldSms(f.pool,1,{message:"Fictional follow-up",key:key("sms"),all:true});
 const provider={provider:"fixture",channel:"sms" as const,send:vi.fn()};
 await expect(dispatchFieldSms(f.pool,1,p.id,p.digest,true,{transportAllowed:async()=>false,provider})).rejects.toThrow("PAUSED");
 expect(provider.send).not.toHaveBeenCalled();
});
it("deduplicates normalized contacts and honors a phone-level opt-out on another lead",async()=>{
 await leads();await f.pool.query("UPDATE bro_field_leads SET contact_phone='+2348031111111' WHERE id=2");
 await recordFieldPermission(f.pool,1,2,true,"Explicit permission on corrected contact");
 const p=await previewFieldSms(f.pool,1,{message:"Fictional follow-up",key:key("dedup"),all:true});
 expect(p.recipients).toHaveLength(1);
 await recordFieldPermission(f.pool,1,1,false,"Recipient opted out of all follow-ups");
 const provider={provider:"fixture",channel:"sms" as const,send:vi.fn()};
 const sent=await dispatchFieldSms(f.pool,1,p.id,p.digest,true,{transportAllowed:async()=>true,provider});
 expect(sent.recipients[0].state).toBe("EXCLUDED");expect(provider.send).not.toHaveBeenCalled();
});
it("retries only proven retryable failures, never accepted recipients, including concurrent dispatch",async()=>{
 const clock=vi.spyOn(Date,"now").mockReturnValue(Date.parse("2027-05-01T12:00:00Z"));
 try{
 await leads();const p=await previewFieldSms(f.pool,1,{message:"Fictional follow-up",key:key("retry"),all:true});
 const seen=new Set<string>();
 const provider={provider:"fixture",channel:"sms" as const,send:vi.fn(async({to}:{to:string})=>{
   if(to.endsWith("2222222")&&!seen.has(to)){seen.add(to);return {provider:"fixture",channel:"sms" as const,status:"FAILED" as const,
     accepted:false,delivered:false,failure:{category:"RATE_LIMITED" as const,retryable:true}};}
   return {provider:"fixture",channel:"sms" as const,status:"ACCEPTED" as const,accepted:true,delivered:false,providerMessageId:`accepted-${to.slice(-4)}`};
 })};
 const deps={transportAllowed:async()=>true,provider};
 await dispatchFieldSms(f.pool,1,p.id,p.digest,true,deps);
 await Promise.all([dispatchFieldSms(f.pool,1,p.id,p.digest,true,deps),dispatchFieldSms(f.pool,1,p.id,p.digest,true,deps)]);
 expect(provider.send).toHaveBeenCalledTimes(3);
 const overview=await readFieldSms(f.pool,1,deps);
 expect(overview.campaigns[0].recipients.every(r=>r.state==="ACCEPTED")).toBe(true);
 }finally{clock.mockRestore();}
});
it("bounded dispatch leaves unsent contacts recoverable and continuation never repeats accepted contacts",async()=>{
 await f.pool.query(`INSERT INTO bro_field_leads(school_name,address,contact_phone,visit_date,status)
   SELECT 'Fictional prospect '||i,'Fictional address '||i,'0803'||(4000000+i)::text,'2026-11-01','Visited'
   FROM generate_series(1,21) AS n(i)`);
 for(let id=1;id<=21;id++)await recordFieldPermission(f.pool,1,id,true,"Recorded explicit contact permission");
 const p=await previewFieldSms(f.pool,1,{message:"Fictional bounded follow-up",key:key("bounded"),all:true});
 const provider={provider:"fixture",channel:"sms" as const,send:vi.fn(async({to}:{to:string})=>({
   provider:"fixture",channel:"sms" as const,status:"ACCEPTED" as const,accepted:true,delivered:false,providerMessageId:`fixture-${to}`,
 }))};
 const deps={transportAllowed:async()=>true,provider};
 const first=await dispatchFieldSms(f.pool,1,p.id,p.digest,true,deps);
 expect(first.recipients.filter(r=>r.state==="ACCEPTED")).toHaveLength(20);
 expect(first.recipients.filter(r=>r.state==="REQUESTED")).toHaveLength(1);
 const second=await dispatchFieldSms(f.pool,1,p.id,p.digest,true,deps);
 expect(second.recipients.every(r=>r.state==="ACCEPTED")).toBe(true);
 expect(provider.send).toHaveBeenCalledTimes(21);
 expect(new Set(provider.send.mock.calls.map(([v])=>v.to)).size).toBe(21);
});
