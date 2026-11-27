/**
 * NOT EXECUTED. Requires the dedicated no-egress config, a credential-free
 * environment and matched JS/PostgreSQL clocks within the fictional school term.
 * No alternative config or application database is a permitted fallback.
 */
import {beforeAll,beforeEach,afterAll,it,expect,vi} from "vitest";
import assert from "node:assert/strict";
import {readFileSync,readlinkSync} from "node:fs";
import {join} from "node:path";
import {currentFinancialFixture} from "./current-financial-fixture.test-support";
import {requestBankRemittance,verifyBankRemittance,postBankRemittance,closeBankRemittance,cancelLegacyAssistance} from "./company-bank-remittances";
import {createCurrentBulk,verifyCurrentBulk,recoverCurrentBulk,verifyPublicCurrentBulk,type BulkDependencies} from "./current-bulk-subscriptions";
import {retryCurrentBulk} from "./current-bulk-retry";
import {readCurrentBulkReceipt} from "./current-finance-overview";
import {verifiedBulkStudentIds} from "./current-bulk-payment-evidence";
import {positiveDirectStudentIds} from "./current-payment-evidence";
import {createOperation,appendState} from "./current-financial-store";
import {financialTransaction} from "./financial-transaction";
vi.mock("./owner-bank-transfer-instructions",()=>({ownerBankTransferInstructions:vi.fn(async()=>({
 available:true,collectionPeriodEligible:true,message:"Fictional isolated fixture",
 transferReference:"fictional",bank:{businessName:"Fictional school supplier",bankName:"Fictional Bank",
 accountName:"Fictional school supplier",accountNumber:"0000000000"}}))}));
let f:Awaited<ReturnType<typeof currentFinancialFixture>>;
const key=(s:string)=>`isolated_remittance_${s}_000000`;
const input=(s="bank")=>({schoolId:1,termId:1,studentIds:[2,4],reason:"Fictional aggregate school remittance",key:key(s)});
let date:string;
beforeAll(async()=>{
 assert.notEqual(readlinkSync("/proc/self/ns/net"),readlinkSync("/proc/1/ns/net"),"No-egress isolation required");
 f=await currentFinancialFixture();
 date=(await f.pool.query("SELECT current_date::text AS day")).rows[0].day;
 // Do not fake SQL clock_timestamp(), edit source guards, broaden the school's
 // saved calendar, or silently skip eligible-payment cases to make them pass.
 assert.ok(date>="2027-01-18"&&date<="2027-04-09","Fixture clocks must be within its January-2027 second term");
 assert.equal(new Date().toISOString().slice(0,10),date,"JavaScript and PostgreSQL fixture clocks must match");
 await f.pool.query(`ALTER TABLE app_users ADD COLUMN email text,ADD COLUMN clerk_user_id text;
 ALTER TABLE schools ADD COLUMN name text;
 ALTER TABLE students ADD COLUMN first_name text,ADD COLUMN last_name text;
 ALTER TABLE partner_profiles ADD COLUMN user_id integer,ADD COLUMN full_name text;
 CREATE TABLE audit_logs(id bigserial PRIMARY KEY,"user" text,role text,actor_user_id integer,clerk_user_id text,
   action text,module text,record_id bigint,event_type text,metadata jsonb NOT NULL DEFAULT '{}');
 INSERT INTO students(id,school_id,status,admission_status,first_name,last_name)
   VALUES(4,1,'ACTIVE','ADMITTED','Four','Student'),(6,1,'ACTIVE','ADMITTED','Six','Student'),
     (7,1,'ACTIVE','ADMITTED','Seven','Student');
 UPDATE app_users SET email='fixture@example.invalid',clerk_user_id='fictional-'||id;
 UPDATE partner_profiles SET user_id=4,full_name='Fictional BRO';
 UPDATE schools SET name='Fictional school';`);
 for(const file of ["0182_current_bulk_withdrawals_field_sms.sql","0185_company_bank_remittance_recovery.sql"])
   await f.pool.query(readFileSync(join(f.root,"lib/db/drizzle",file),"utf8"));
},30000);
afterAll(async()=>{await f?.stop();});
beforeEach(async()=>{
 await f.pool.query(`ALTER TABLE current_bulk_bro_entitlements DROP CONSTRAINT IF EXISTS fictional_reject_bro;
 ALTER TABLE current_bulk_events DROP CONSTRAINT IF EXISTS fictional_reject_post;`);
 await f.pool.query(`TRUNCATE current_payment_batches,subscription_payment_assistance_requests RESTART IDENTITY CASCADE;
 TRUNCATE audit_logs;`);
 await f.reset(true);
 await f.pool.query(`INSERT INTO audit_logs(role,event_type,record_id,metadata)
 SELECT 'PLATFORM_OWNER','SUBSCRIPTION_RULE_ACTIVATED',id,
 jsonb_build_object('after',jsonb_build_object('product',product,'amountMinor',amount_minor,
   'version',version,'effectiveAt',effective_at)) FROM subscription_rule_proposals;`);
});
const verifyInput=(id:number,s="credit")=>({id,bankName:"Fictional Bank",statementReference:`Fictional credit ${s}`,
 creditDate:date,amountMinor:640000,independentlyChecked:true as const,key:key(s),reason:"Independent statement credit checked"});
async function bankPaid(){
 const b=await requestBankRemittance(f.pool,2,input());
 await verifyBankRemittance(f.pool,1,verifyInput(b.id));await postBankRemittance(f.pool,1,b.id,key("post"),"Post independently checked credit");
 return b;
}
function provider():BulkDependencies{
 return {review:async()=>({id:1,rule_id:1,report_digest:"a".repeat(64),merchant_scope:"fixture-merchant"}),
 revalidate:async()=>true,checkout:vi.fn(async()=>"https://checkout.flutterwave.com/fictional"),
 verify:vi.fn(async(transactionId,reference,amountMinor)=>({transactionId,reference,amountMinor,
 currency:"NGN",providerReference:`fictional-${transactionId}`,providerFeeMinor:0,additionalFeeMinor:0,
 chargedAmountMinor:0,status:"failed" as const}))};
}
it("requests are unpaid; only Owner credit verification plus explicit posting activates each student",async()=>{
 const b=await requestBankRemittance(f.pool,2,input());
 expect((await verifiedBulkStudentIds(f.pool,1,1)).has(2)).toBe(false);
 await expect(verifyBankRemittance(f.pool,2,verifyInput(b.id))).rejects.toThrow("OWNER_BANK_VERIFICATION_REQUIRED");
 await expect(verifyBankRemittance(f.pool,1,{...verifyInput(b.id),amountMinor:320000})).rejects.toThrow("EXACT_AGGREGATE_BANK_AMOUNT_REQUIRED");
 await verifyBankRemittance(f.pool,1,verifyInput(b.id));
 expect((await verifiedBulkStudentIds(f.pool,1,1)).has(2)).toBe(false);
 await postBankRemittance(f.pool,1,b.id,key("post"),"Allocate exact checked bank credit");
 expect([...await verifiedBulkStudentIds(f.pool,1,1)].sort()).toEqual([2,4]);
 expect((await f.pool.query("SELECT count(*) FROM current_bulk_confirmations")).rows[0].count).toBe("0");
 expect((await readCurrentBulkReceipt(f.pool,2,b.id)).paymentMethod).toBe("COMPANY_BANK");
 await expect(closeBankRemittance(f.pool,1,b.id,key("paidclose"),"Attempt paid cancellation","CANCELLED")).rejects.toThrow("VERIFIED_BANK_CREDIT_CANNOT_BE_CANCELLED");
});
it("unpaid cancellation releases only its reservation, retaining both allocations and audit",async()=>{
 const b=await requestBankRemittance(f.pool,2,input());
 await closeBankRemittance(f.pool,2,b.id,key("cancel"),"School cancelled before any credit","CANCELLED");
 const next=await requestBankRemittance(f.pool,2,input("replacement"));
 expect(next.id).not.toBe(b.id);
 expect((await f.pool.query("SELECT count(*) FROM current_bulk_allocation_releases")).rows[0].count).toBe("2");
 expect((await f.pool.query("SELECT count(*) FROM current_bulk_allocations")).rows[0].count).toBe("4");
 await expect(f.pool.query("DELETE FROM current_bulk_allocation_releases")).rejects.toThrow();
 await expect(f.pool.query("DELETE FROM current_bulk_term_claims")).rejects.toThrow("managed only");
 await expect(f.pool.query("UPDATE current_bulk_term_claims SET student_id=student_id")).rejects.toThrow("managed only");
});
it("normalized statement credit cannot pay a second request",async()=>{
 const first=await requestBankRemittance(f.pool,2,input());
 await verifyBankRemittance(f.pool,1,{...verifyInput(first.id),statementReference:"Fictional Credit 123456"});
 const next=await requestBankRemittance(f.pool,2,{...input("secondcredit"),studentIds:[6,7]});
 await expect(verifyBankRemittance(f.pool,1,{...verifyInput(next.id,"reusedcredit"),
   statementReference:"fictionalcredit123456"})).rejects.toThrow("BANK_REFERENCE_ALREADY_USED");
 expect((await f.pool.query("SELECT count(*) FROM current_bank_credits")).rows[0].count).toBe("1");
});
it("BRO SQL failure does not roll back posted entitlement and can be retried without duplication",async()=>{
 await f.pool.query(`ALTER TABLE current_bulk_bro_entitlements ADD CONSTRAINT fictional_reject_bro CHECK(amount_minor<>15000)`);
 const b=await bankPaid();
 expect([...await verifiedBulkStudentIds(f.pool,1,1)].sort()).toEqual([2,4]);
 expect((await f.pool.query("SELECT count(*) FROM current_bulk_events WHERE state='BRO_ACCRUAL_PENDING'")).rows[0].count).toBe("2");
 await f.pool.query(`ALTER TABLE current_bulk_bro_entitlements DROP CONSTRAINT fictional_reject_bro`);
 await recoverCurrentBulk(f.pool,1,b.id);await recoverCurrentBulk(f.pool,1,b.id);
 expect((await f.pool.query("SELECT count(*) FROM current_bulk_bro_entitlements")).rows[0].count).toBe("2");
 expect((await f.pool.query("SELECT count(*) FROM current_bulk_events WHERE state='POSTED'")).rows[0].count).toBe("2");
});
it("one failed allocation recovers without reposting its already paid sibling",async()=>{
 const b=await requestBankRemittance(f.pool,2,input());
 await verifyBankRemittance(f.pool,1,verifyInput(b.id));
 const blocked=Number((await f.pool.query(
   "SELECT id FROM current_bulk_allocations WHERE batch_id=$1 AND student_id=4",[b.id])).rows[0].id);
 assert.ok(Number.isSafeInteger(blocked));
 await f.pool.query(`ALTER TABLE current_bulk_events ADD CONSTRAINT fictional_reject_post
   CHECK(NOT(state='POSTED' AND allocation_id=${blocked}))`);
 expect((await postBankRemittance(f.pool,1,b.id,key("postpartial"),"Post exact checked bank credit")).state).toBe("RECOVERY_REQUIRED");
 expect([...await verifiedBulkStudentIds(f.pool,1,1)]).toEqual([2]);
 await f.pool.query("ALTER TABLE current_bulk_events DROP CONSTRAINT fictional_reject_post");
 await postBankRemittance(f.pool,1,b.id,key("postrecovery"),"Recover the unresolved allocation");
 expect([...await verifiedBulkStudentIds(f.pool,1,1)].sort()).toEqual([2,4]);
 expect((await f.pool.query("SELECT count(*) FROM current_bulk_events WHERE state='POSTED'")).rows[0].count).toBe("2");
});
async function confirmedFixtureRefund(source:number|{allocationId:number},amount:number,s:string){
 // Fictional retained ledger evidence tests shared readers, NOT an adapter for
 // bank refunds. The application explicitly refuses unsupported bank refunds.
 return financialTransaction(f.pool,async c=>{
   const r=await createOperation(c,{kind:"REFUND",key:key(s),schoolId:1,termId:1,
     ...(typeof source==="number"?{attemptId:source}:{allocationId:source.allocationId}),
     amountMinor:amount,actorId:1,reason:"Fictional confirmed refund reader fixture",
     snapshot:{movement:"REFUND",fictionalFixtureOnly:true}});
   await appendState(c,Number(r.id),"SUCCEEDED",key(`confirmed_${s}`),1,{fictionalFixtureOnly:true});
 });
}
it("direct and aggregate access retains positive net after a partial refund but not a full refund",async()=>{
 const b=await bankPaid(),allocation=Number((await f.pool.query(
   "SELECT id FROM current_bulk_allocations WHERE batch_id=$1 AND student_id=2",[b.id])).rows[0].id);
 await confirmedFixtureRefund(1,1000,"directpartial");
 await confirmedFixtureRefund({allocationId:allocation},1000,"bulkpartial");
 expect((await positiveDirectStudentIds(f.pool,1,1)).has(1)).toBe(true);
 expect((await verifiedBulkStudentIds(f.pool,1,1)).has(2)).toBe(true);
 await confirmedFixtureRefund(1,319000,"directrest");
 await confirmedFixtureRefund({allocationId:allocation},319000,"bulkrest");
 expect((await positiveDirectStudentIds(f.pool,1,1)).has(1)).toBe(false);
 expect((await verifiedBulkStudentIds(f.pool,1,1)).has(2)).toBe(false);
 expect((await readCurrentBulkReceipt(f.pool,2,b.id)).netPaidMinor).toBe(320000);
});
it("UNKNOWN never resends, even with a new key or caller intent",async()=>{
 const deps=provider();deps.checkout=vi.fn(async()=>{throw Error("Fictional lost response");});
 const b=await createCurrentBulk(f.pool,2,input("unknown"),deps);
 await expect(retryCurrentBulk(f.pool,2,{id:b.id,key:key("noresend"),reason:"Check original uncertain payment"},deps))
   .rejects.toThrow("ONLY_VERIFIED_FAILED_BATCH_CAN_RETRY");
 expect(deps.checkout).toHaveBeenCalledTimes(1);
});
it("a fresh failed zero-charge GET permits one new attempt; replay and stale old callbacks cannot resend",async()=>{
 const deps=provider(),b=await createCurrentBulk(f.pool,2,input("retry"),deps);
 await verifyCurrentBulk(f.pool,2,b.id,"991122",deps);
 await retryCurrentBulk(f.pool,2,{id:b.id,key:key("retryonce"),reason:"Independently recheck terminal no charge"},deps);
 await retryCurrentBulk(f.pool,2,{id:b.id,key:key("retryonce"),reason:"Independently recheck terminal no charge"},deps);
 expect(deps.checkout).toHaveBeenCalledTimes(2);
 const attempt=(await f.pool.query("SELECT * FROM current_bulk_checkout_attempts WHERE batch_id=$1",[b.id])).rows[0];
 expect(attempt.reference).not.toBe(b.reference);
 await verifyPublicCurrentBulk(f.pool,b.reference,"991122",deps);
 await expect(retryCurrentBulk(f.pool,2,{id:b.id,key:key("staleno"),reason:"Old callback cannot authorize retry"},deps))
   .rejects.toThrow("ONLY_VERIFIED_FAILED_BATCH_CAN_RETRY");
 expect(deps.checkout).toHaveBeenCalledTimes(2);
});
it("a pending or nonzero-charge fresh verification cannot authorize checkout retry",async()=>{
 const deps=provider(),b=await createCurrentBulk(f.pool,2,input("chargedretry"),deps);
 await verifyCurrentBulk(f.pool,2,b.id,"991144",deps);
 deps.verify=vi.fn(async(transactionId,reference,amountMinor)=>({transactionId,reference,amountMinor,currency:"NGN",
   providerReference:"fictional-uncertain",providerFeeMinor:null,additionalFeeMinor:null,
   chargedAmountMinor:1,status:"failed" as const}));
 await expect(retryCurrentBulk(f.pool,2,{id:b.id,key:key("nonzero"),reason:"Never retry a nonzero charge"},deps))
   .rejects.toThrow("FRESH_INDEPENDENT_ZERO_CHARGE_EVIDENCE_REQUIRED");
 expect(deps.checkout).toHaveBeenCalledTimes(1);
});
it("legacy cancellation refuses retained credit and checkout bindings",async()=>{
 await f.pool.query(`INSERT INTO subscription_payment_assistance_requests(id,school_id,student_id,academic_term_id,status)
 VALUES(1,1,2,1,'REQUESTED'),(2,1,4,1,'BANK_VERIFIED')`);
 await cancelLegacyAssistance(f.pool,1,1,key("legacycancel"),"Cancel uncredited legacy request");
 await expect(cancelLegacyAssistance(f.pool,1,2,key("legacykeep"),"Do not reinterpret retained credit")).rejects.toThrow("ASSISTANCE_HAS_CREDIT_OR_CHECKOUT");
});
