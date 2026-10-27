import express from "express";
import {createServer,type Server} from "node:http";
import {beforeEach,afterAll,beforeAll,describe,it,expect,vi} from "vitest";
import {HOSTED_HISTORY_GUARD_BODY,HOSTED_POLICY} from "../lib/hosted-manual-policy";
import {bankFingerprint} from "../lib/flutterwave-school-payout";

const state=vi.hoisted(()=>({events:[] as any[],ownerActive:true,role:"PLATFORM_OWNER",profileVersion:"one",
  paid:true,manual:false,held:false,commitLost:false,mode:"TEST",bankStatus:"VERIFIED",guard:true}));
const reference=`HCM1_T_${"a".repeat(32)}`;
const actor={id:20,email:"owner@fixture.example.test",owner:true,schoolIds:[]};
const bank={bankCode:"044",accountNumber:"0123456789",accountName:"Fixture School"};
let unlock:(()=>void)|undefined,tail=Promise.resolve();
function client() {
  let release:(()=>void)|undefined;
  return {release(){release?.();release=undefined;},async query(sql:string,p:any[]=[]):Promise<any>{
    const s=sql.replace(/\s+/g," ").trim();
    if(s==="BEGIN") return{rows:[]};
    if(s==="COMMIT"||s==="ROLLBACK") {release?.();release=undefined;if(s==="COMMIT"&&state.commitLost){state.commitLost=false;throw new Error("Commit acknowledgement lost");}return{rows:[]};}
    if(s.startsWith("SELECT c.relname")) return{rows:state.guard?["hosted_checkout_orders","hosted_checkout_events"].map(relname=>({relname,tgtype:58,prosrc:HOSTED_HISTORY_GUARD_BODY})):[]};
    if(s.startsWith("SELECT u.id")) return{rows:state.ownerActive?[{id:20}]:[]};
    if(s.startsWith("SELECT o.*")) {
      if(s.includes("FOR UPDATE")) {const previous=tail;tail=new Promise<void>(r=>{unlock=r;});const ownUnlock=unlock;await previous;release=ownUnlock;}
      return{rows:[{reference,environment:state.mode,provider:"FLUTTERWAVE",policy:HOSTED_POLICY.code,school_id:7,
        school_name:"Fixture School",student_id:8,term_id:9,subscription_id:10,bro_profile_id:11,snapshot:{studentName:"Fixture Student",termName:"Term"},created_at:new Date()}]};
    }
    if(s.startsWith("SELECT * FROM hosted_checkout_events")) return{rows:[
      ...(state.paid?[{kind:"PAYMENT_VERIFIED",fee_minor:1500,created_at:new Date()}]:[]),
      ...(state.manual?[{kind:"SCHOOL_SETTLED",data:{},external_reference:"manual-fixture"}]:[]),
      ...(state.held?[{kind:"RECONCILIATION_HOLD"}]:[]),...state.events]};
    if(s.startsWith("SELECT p.*")) return{rows:[{id:3,school_id:7,school_name:"Fixture School",school_status:"ACTIVE",
      verification_status:state.bankStatus,verified_at:new Date(),verified_by:20,currency:"NGN",provider:"FLUTTERWAVE",
      bank_name_encrypted:"Fixture Bank",bank_code_encrypted:bank.bankCode,account_name_encrypted:bank.accountName,
      account_number_encrypted:bank.accountNumber,provider_subaccount_id:"RS_TEST_FIXTURE_METADATA",
      updated_at:state.profileVersion}]};
    if(s.startsWith("SELECT pg_get_constraintdef")) return{rows:[{definition:"SCHOOL_PAYOUT_RECEIPT"}]};
    if(s.startsWith("SELECT COALESCE")) return{rows:[{reserved:state.events.some(e=>e.kind==="SCHOOL_PAYOUT_CLAIMED")&&
      !state.events.some(e=>["SCHOOL_PAYOUT_SUCCESS","SCHOOL_PAYOUT_FAILED"].includes(e.kind))?200000:0}]};
    if(s.startsWith("SELECT pg_advisory")) return{rows:[]};
    if(s.startsWith("INSERT INTO hosted_checkout_events")) {
      if(state.events.some(e=>e.idempotency_key===p[4])) return{rows:[]};
      state.events.push({id:p[0],order_reference:p[1],environment:p[2],kind:p[3],idempotency_key:p[4],
        actor_id:p[5],provider_transaction_id:p[6],amount_minor:p[7],fee_minor:p[8],external_reference:p[9],
        proof_sha256:p[10],data:JSON.parse(p[11]),created_at:new Date()});
      return{rows:[{id:p[0]}]};
    }
    if(s.startsWith("SELECT * FROM payment_receipt_uploads")) return{rows:[{id:p[0],kind:"SCHOOL_SETTLEMENT",target_id:reference,
      school_id:7,amount_minor:190000,transfer_date:new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Lagos"}).format(new Date()),
      sha256:"c".repeat(64),uploaded_by:21}]};
    throw new Error(`Unexpected fixture SQL: ${s}`);
  }};
}
vi.mock("@workspace/db",()=>({pool:{connect:async()=>client()}}));
vi.mock("../lib/payroll-bank-encryption",()=>({decryptPayrollBankValue:(v:string)=>v}));
vi.mock("./flutterwave-live-school-onboarding",()=>({sourceHash:(r:any)=>String(r.updated_at)}));
vi.mock("../middlewares/auth",()=>({
  requireAuthentication:()=> (_req:any,_res:any,next:any)=>next(),
  getUserContext:()=>({user:{id:20,email:"fixture@example.test"},roles:[{role:state.role,schoolId:state.role==="PLATFORM_OWNER"?null:7,status:"ACTIVE"}]}),
}));
import {HostedSchoolPayouts} from "./hosted-school-payouts";
import {HostedManualPayments} from "./hosted-manual-payments";
import {createHostedManualRouter} from "../routes/hosted-manual-payments";
const pool={connect:async()=>client()};
const env=()=>({NODE_ENV:"test",EDUCORE_HOSTED_PAYMENTS_ENABLED:"true",EDUCORE_HOSTED_PAYMENTS_MODE:"TEST",
  EDUCORE_HOSTED_PAYMENTS_PUBLIC_URL:"https://fixture.example.test",FLUTTERWAVE_SECRET_Test_Key:"FLWSECK_TEST-fixture-not-a-real-key",
  FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH:"fixture-hash",EDUCORE_SCHOOL_PAYOUTS_ENABLED:"true",
  EDUCORE_SCHOOL_PAYOUTS_FUNDING_SOURCE:"MERCHANT_NGN_BALANCE",EDUCORE_SCHOOL_PAYOUTS_TEST_APPROVED:"true",
  EDUCORE_SCHOOL_PAYOUTS_MAX_FEE_MINOR:"10000"});
const provider=()=>({
  preflight:vi.fn(async()=>({availableMinor:1_000_000,feeMinor:5000,verifiedAt:new Date().toISOString()})),
  initiate:vi.fn(async(_b:any,_r:string)=>({id:"91"})),
  find:vi.fn(async(ref:string)=>({id:"91",reference:ref,status:"SUCCESS" as "SUCCESS"|"FAILED"|"PROCESSING",
    amountMinor:190000,currency:"NGN",debitCurrency:"NGN",bankFingerprint:bankFingerprint(bank),feeMinor:5000,feeRaw:"50"})),
});
beforeEach(()=>{Object.assign(state,{events:[],ownerActive:true,role:"PLATFORM_OWNER",profileVersion:"one",paid:true,manual:false,
  held:false,commitLost:false,mode:"TEST",bankStatus:"VERIFIED",guard:true});tail=Promise.resolve();});
describe("Owner school payouts with mocked provider and database only",()=>{
  it("previews fixed entitlement and masked bank details without sending funds",async()=>{
    const p=provider(),s=new HostedSchoolPayouts(pool,env(),p),v=await s.preview(actor,reference);
    expect(v).toMatchObject({ready:true,amountMinor:190000,status:"PENDING_SETTLEMENT",schoolName:"Fixture School"});
    expect(JSON.stringify(v)).not.toContain(bank.accountNumber);expect(p.initiate).not.toHaveBeenCalled();
  });
  it("rejects non-Owners and revoked Owner authority before provider I/O",async()=>{
    const p=provider(),s=new HostedSchoolPayouts(pool,env(),p);
    await expect(s.pay({...actor,owner:false},reference,{confirmed:true,confirmationToken:"x"})).rejects.toMatchObject({statusCode:403});
    state.ownerActive=false;
    await expect(s.preview(actor,reference)).rejects.toMatchObject({statusCode:403});
    expect(p.preflight).not.toHaveBeenCalled();expect(p.initiate).not.toHaveBeenCalled();
  });
  it.each(["paid","held","manual","bankStatus","mode","guard"])("blocks ineligible %s without a transfer",async field=>{
    if(field==="paid")state.paid=false;if(field==="held")state.held=true;if(field==="manual")state.manual=true;
    if(field==="bankStatus")state.bankStatus="PENDING_VERIFICATION";if(field==="mode")state.mode="LIVE";if(field==="guard")state.guard=false;
    const p=provider(),s=new HostedSchoolPayouts(pool,env(),p),v=await s.preview(actor,reference);
    expect(v.ready).toBe(false);
    await expect(s.pay(actor,reference,{confirmed:true,confirmationToken:"x"})).rejects.toThrow();
    expect(p.initiate).not.toHaveBeenCalled();
  });
  it("requires enablement and mode-specific approval; TEST approval cannot authorize LIVE",async()=>{
    const e=env(),p=provider();e.EDUCORE_SCHOOL_PAYOUTS_ENABLED="false";
    await expect(new HostedSchoolPayouts(pool,e,p).pay(actor,reference,{confirmed:true,confirmationToken:"x"})).rejects.toThrow();
    expect(p.preflight).not.toHaveBeenCalled();expect(p.initiate).not.toHaveBeenCalled();
  });
  it("rechecks funding and profile after confirmation, refusing changed beneficiaries and insufficient balance",async()=>{
    const p=provider(),s=new HostedSchoolPayouts(pool,env(),p),v=await s.preview(actor,reference);
    state.profileVersion="two";
    await expect(s.pay(actor,reference,{confirmed:true,confirmationToken:v.confirmationToken!})).rejects.toThrow("changed");
    state.profileVersion="one";p.preflight.mockResolvedValue({availableMinor:190000,feeMinor:5000,verifiedAt:"fixture"});
    await expect(s.pay(actor,reference,{confirmed:true,confirmationToken:v.confirmationToken!})).rejects.toThrow("funding");
    expect(p.initiate).not.toHaveBeenCalled();
  });
  it("serializes concurrent confirmations, reserves before send and never settles on POST acceptance",async()=>{
    const p=provider(),s=new HostedSchoolPayouts(pool,env(),p),v=await s.preview(actor,reference);
    p.initiate.mockImplementation(async()=>{expect(state.events.some(e=>e.kind==="SCHOOL_PAYOUT_CLAIMED")).toBe(true);return{id:"91"};});
    await Promise.all([s.pay(actor,reference,{confirmed:true,confirmationToken:v.confirmationToken!}),s.pay(actor,reference,{confirmed:true,confirmationToken:v.confirmationToken!})]);
    expect(p.initiate).toHaveBeenCalledTimes(1);expect(state.events.filter(e=>e.kind==="SCHOOL_PAYOUT_CLAIMED")).toHaveLength(1);
    expect((await s.preview(actor,reference)).status).toBe("PROCESSING");expect(state.events.some(e=>e.kind==="SCHOOL_PAYOUT_SUCCESS")).toBe(false);
  });
  it("retains a lost acceptance reference; empty reconciliation and button retries never resend",async()=>{
    const p=provider(),s=new HostedSchoolPayouts(pool,env(),p),v=await s.preview(actor,reference);
    p.initiate.mockRejectedValue(new Error("provider accepted then response was lost"));
    await s.pay(actor,reference,{confirmed:true,confirmationToken:v.confirmationToken!});
    (p.find as any).mockResolvedValue(null);
    expect((await s.reconcile(actor,reference)).status).toBe("RECONCILIATION_REQUIRED");
    await s.pay(actor,reference,{confirmed:true,confirmationToken:v.confirmationToken!});
    expect(p.initiate).toHaveBeenCalledTimes(1);
  });
  it("does not send after an uncertain database commit",async()=>{
    const p=provider(),s=new HostedSchoolPayouts(pool,env(),p),v=await s.preview(actor,reference);
    // Lose the claim COMMIT, not the preliminary authority read COMMIT.
    p.preflight.mockImplementation(async()=>{state.commitLost=true;return{availableMinor:1_000_000,feeMinor:5000,verifiedAt:"fixture"};});
    await expect(s.pay(actor,reference,{confirmed:true,confirmationToken:v.confirmationToken!})).rejects.toThrow("Commit");
    p.preflight.mockResolvedValue({availableMinor:1_000_000,feeMinor:5000,verifiedAt:"fixture"});
    await s.pay(actor,reference,{confirmed:true,confirmationToken:v.confirmationToken!});
    expect(p.initiate).not.toHaveBeenCalled();
  });
  it.each([{reference:"wrong"},{amountMinor:190001},{currency:"USD"},{debitCurrency:"USD"},{bankFingerprint:"wrong"},{id:"92"}])("requires exact GET identity/amount/currency/beneficiary: %j",async patch=>{
    const p=provider(),s=new HostedSchoolPayouts(pool,env(),p),v=await s.preview(actor,reference);
    await s.pay(actor,reference,{confirmed:true,confirmationToken:v.confirmationToken!});
    const original=await p.find("fixture");p.find.mockImplementation(async ref=>({...original,reference:ref,...patch}));
    expect((await s.reconcile(actor,reference)).status).toBe("RECONCILIATION_REQUIRED");
    expect(state.events.some(e=>e.kind==="SCHOOL_PAYOUT_SUCCESS")).toBe(false);
  });
  it("reconciles success once even after sends are disabled; receipt attachment does not settle twice",async()=>{
    const e=env(),p=provider(),s=new HostedSchoolPayouts(pool,e,p),v=await s.preview(actor,reference);
    await expect(s.attachReceipt(actor,reference,{proofReceiptId:"a",settlementDate:"2026-01-01"})).rejects.toThrow("success");
    await s.pay(actor,reference,{confirmed:true,confirmationToken:v.confirmationToken!});
    e.EDUCORE_SCHOOL_PAYOUTS_ENABLED="false";
    expect((await s.reconcile(actor,reference)).status).toBe("SUCCESS");
    await s.reconcile(actor,reference);
    const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Lagos"}).format(new Date());
    const proof={proofReceiptId:"11111111-1111-4111-8111-111111111111",settlementDate:today};
    await s.attachReceipt(actor,reference,proof);await s.attachReceipt(actor,reference,proof);
    expect(state.events.filter(e=>e.kind==="SCHOOL_PAYOUT_SUCCESS")).toHaveLength(1);
    expect(state.events.filter(e=>e.kind==="SCHOOL_PAYOUT_RECEIPT")).toHaveLength(1);
    expect(state.events.filter(e=>e.kind==="SCHOOL_SETTLED")).toHaveLength(0);
    expect(state.events.find(e=>e.kind==="SCHOOL_PAYOUT_RECEIPT")?.data.receiptUploadedBy).toBe(21);
    expect(p.initiate).toHaveBeenCalledTimes(1);
  });
  it("records confirmed failure without settling or offering an automatic retry",async()=>{
    const p=provider(),s=new HostedSchoolPayouts(pool,env(),p),v=await s.preview(actor,reference);
    await s.pay(actor,reference,{confirmed:true,confirmationToken:v.confirmationToken!});
    const original=await p.find("fixture");p.find.mockImplementation(async ref=>({...original,reference:ref,status:"FAILED"}));
    expect((await s.reconcile(actor,reference)).status).toBe("FAILED");
    await s.pay(actor,reference,{confirmed:true,confirmationToken:v.confirmationToken!});
    expect(p.initiate).toHaveBeenCalledTimes(1);
  });
});
describe("Owner school payout HTTP authorization and contract",()=>{
  let server:Server,base:string;
  beforeAll(async()=>{const app=express();app.use(express.json());app.use("/",
    createHostedManualRouter(new HostedManualPayments(pool,env()),new HostedSchoolPayouts(pool,env(),provider())));
    server=createServer(app);await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));base=`http://127.0.0.1:${(server.address() as any).port}/orders/${reference}/school-payout`;});
  afterAll(async()=>new Promise<void>(r=>server.close(()=>r())));
  it("denies School Admin access and rejects overriding the server-owned amount",async()=>{
    state.role="SCHOOL_ADMIN";expect((await fetch(base)).status).toBe(403);
    state.role="PLATFORM_OWNER";
    expect((await fetch(base,{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({confirmed:true,confirmationToken:"a".repeat(64),amountMinor:1})})).status).toBe(400);
    const preview=await(await fetch(base)).json() as {confirmationToken:string};
    const sent=await fetch(base,{method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({confirmed:true,confirmationToken:preview.confirmationToken})});
    expect(sent.status).toBe(200);expect((await sent.json() as {status:string}).status).toBe("PROCESSING");
  });
});
