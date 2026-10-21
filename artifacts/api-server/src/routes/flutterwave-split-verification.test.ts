import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
const f = vi.hoisted(() => ({ query:vi.fn(), evidence:vi.fn(), review:vi.fn(), submit:vi.fn(), payment:vi.fn(), reconcile:vi.fn(), schoolId:1 }));
vi.mock("@workspace/db", () => ({ pool:{query:f.query} }));
vi.mock("../services/subscription-request-access", () => ({ enforceRequestSubscription:vi.fn() }));
vi.mock("../middlewares/auth", async importOriginal => {
  const actual = await importOriginal<typeof import("../middlewares/auth")>();
  return { ...actual, requireAuthentication:() => (req:any,_res:any,next:any) => {
    // Synthetic authenticated context, not Clerk acceptance. Real role predicates below.
    try { actual.getUserContext(req); next(); } catch(error) { next(error); }
  } };
});
vi.mock("../services/flutterwave-split-evidence", () => ({ transactionSplitEvidence:f.evidence }));
vi.mock("../services/flutterwave-split-recipients", () => ({ recipientView:(x:any)=>x,reviewSplitRecipient:f.review,submitSplitRecipient:f.submit }));
vi.mock("../services/flutterwave-split-reporting", () => ({ splitPaymentView:f.payment,reconcileSplitPayment:f.reconcile }));
vi.mock("../services/flutterwave-split-refunds", () => ({ requestSplitRefund:vi.fn(),verifySplitRefund:vi.fn(),adjustmentView:vi.fn() }));
import router from "./flutterwave-splits";
import { existingDiagnosticTestReference } from "../lib/flutterwave-split-review";

function context(role:string) {
  return { user:{id:1,status:"ACTIVE"},roles:[{id:1,role,status:"ACTIVE",schoolId:role==="SCHOOL_ADMIN"?1:null}] };
}
async function request(role:string|null, path:string, method="GET", body?:unknown) {
  // No listener, service, HTTP request, database, or real identity session.
  return new Promise<{status:number;body:any}>(resolve => {
    const req = { method,url:path,originalUrl:path,headers:{},query:{},body,
      ...(role ? {edupulseUser:context(role)} : {}) } as unknown as Request;
    const res:any = { statusCode:200,set:()=>res,status:(n:number)=>{res.statusCode=n;return res;},
      json:(data:unknown)=>{resolve({status:res.statusCode,body:data});return res;} };
    router(req,res,(error?:any) => resolve({status:error?.statusCode ?? 404,body:{error:error?.message}}));
  });
}
const evidencePath="/flutterwave/split-payments/40/transaction-evidence";
const reviewPath="/flutterwave/split-recipients/10/review";
const reviewBody={action:"VERIFY_EXISTING_TEST",note:"Unit-only owner review",ownershipConfirmed:true,
  distinctFromPlatformAccountConfirmed:true,existingTestReference:existingDiagnosticTestReference};
beforeEach(() => {
  vi.stubEnv("NODE_ENV","development");vi.stubEnv("REPLIT_DEPLOYMENT","");
  f.schoolId=1;for(const fn of [f.query,f.evidence,f.review,f.submit,f.payment,f.reconcile])fn.mockReset();
  f.query.mockImplementation(async(sql:string,args:any[]) => {
    if(sql.includes("FROM schools")) return {rows:args[0]||args[1].includes(1)?[{id:1,name:"UNIT SCHOOL"}]:[]};
    if(sql.includes("FROM partner_profiles")) return {rows:args[0]?[]:[{id:9,name:"UNIT PARTNER"}]};
    if(sql.includes("SELECT school_id")) return {rows:[{school_id:f.schoolId}]};
    if(sql.includes("SELECT payment_id FROM flutterwave_split_payments")) return {rows:[{payment_id:40}]};
    return {rows:[]};
  });
  f.evidence.mockResolvedValue({status:"UNCONFIRMED",evidenceLevel:"PARTIAL"});
  f.review.mockResolvedValue({status:"CREATION_UNKNOWN"});
});
afterEach(()=>vi.unstubAllEnvs());
describe("In-process Development split verification authorization",()=>{
  it("requires authentication before any database/evidence access",async()=>{
    expect((await request(null,evidencePath)).status).toBe(401);
    expect(f.query).not.toHaveBeenCalled();expect(f.evidence).not.toHaveBeenCalled();
  });
  it.each(["PLATFORM_OWNER"])("allows %s to explicitly read its permitted TEST evidence",async role=>{
    const response=await request(role,evidencePath);
    expect(response.status).toBe(200);expect(response.body.status).toBe("UNCONFIRMED");
    expect(f.evidence).toHaveBeenCalledWith(40);
    expect(f.query.mock.calls.every(c=>String(c[0]).trim().startsWith("SELECT"))).toBe(true);
  });
  it("denies non-Owner evidence before inspecting even a foreign-school payment",async()=>{
    f.schoolId=2;
    expect((await request("SCHOOL_ADMIN",evidencePath)).status).toBe(403);
    expect(f.query).not.toHaveBeenCalled();
    expect(f.evidence).not.toHaveBeenCalled();
  });
  it.each([true,false])("reads original saved allocations without repricing historical references (Partner %s)",async partner=>{
    const saved=Object.freeze({payment_id:40,school_id:1,student_id:2,term_id:3,reference:"SC_legacy_original",
      status:"COLLECTION_PAID",collection_status:"PAID",school_amount_minor:200000,
      partner_amount_minor:partner?10000:0,platform_amount_minor:partner?290000:300000,
      provider_fee_minor:7000,provider_additional_fee_minor:0,currency:"NGN"});
    f.query.mockImplementation(async(sql:string)=>({rows:sql.includes("JOIN student_subscription_payments")?[saved]:[]}));
    const { splitPaymentView }=await vi.importActual<typeof import("../services/flutterwave-split-reporting")>("../services/flutterwave-split-reporting");
    const result=await splitPaymentView(40);
    expect(result).toMatchObject({reference:saved.reference,schoolAmountMinor:200000,
      partnerAmountMinor:partner?10000:0,platformAmountMinor:partner?290000:300000,
      providerFeeMinor:7000,platformNetMinor:saved.platform_amount_minor-7000});
    expect(saved.school_amount_minor).toBe(200000);
    expect(f.query.mock.calls.every(c=>String(c[0]).trim().startsWith("SELECT"))).toBe(true);
  });
  it.each([true,false])("returns canonical current policy separately from unchanged saved history (Partner %s)",async partner=>{
    const saved = Object.freeze({ paymentId:40,reference:"SC_original",schoolAmountMinor:200000,
      platformAmountMinor:partner?290000:300000,partnerAmountMinor:partner?10000:0 });
    f.payment.mockResolvedValue(saved);
    const response=await request("PLATFORM_OWNER","/flutterwave/split-dashboard");
    expect(response.status).toBe(200);
    expect(response.body.currentAllocationPolicy).toEqual({version:3,schoolMinor:190000,
      platformWithPartnerMinor:300000,platformWithoutPartnerMinor:310000,partnerMinor:10000,deferredPartner:true});
    expect(JSON.stringify(response.body.currentAllocationPolicy)).not.toMatch(/200000|290000/);
    expect(response.body.payments).toEqual([saved]);
    expect(saved.reference).toBe("SC_original");
    expect(f.query.mock.calls.every(c=>String(c[0]).trim().startsWith("SELECT"))).toBe(true);
  });
  it.each(["SCHOOL_ADMIN","PARTNER","PARENT","STUDENT","TEACHER","STAFF"])("filters the full split from %s dashboard and denies evidence/reconciliation",async role=>{
    const response=await request(role,"/flutterwave/split-dashboard");
    expect(response.status).toBe(200);
    expect(response.body.currentAllocationPolicy).toBeNull();
    expect(response.body.payments).toEqual([]);
    expect(f.payment).not.toHaveBeenCalled();
    expect(f.query.mock.calls.some(c=>String(c[0]).includes("SELECT payment_id FROM flutterwave_split_payments"))).toBe(false);
    expect([403,404]).toContain((await request(role,evidencePath)).status);
    expect([403,404]).toContain((await request(role,"/flutterwave/split-payments/40/reconcile","POST")).status);
    expect(f.evidence).not.toHaveBeenCalled();expect(f.reconcile).not.toHaveBeenCalled();
  });
  it("denies an unauthenticated split dashboard",async()=>{
    expect((await request(null,"/flutterwave/split-dashboard")).status).toBe(401);
    expect(f.query).not.toHaveBeenCalled();
  });
  it.each(["PARTNER","COMPANY_ACCOUNTANT"])("does not disclose school transaction evidence to %s",async role=>{
    expect([403,404]).toContain((await request(role,evidencePath)).status);
    expect(f.evidence).not.toHaveBeenCalled();
  });
  it.each(["SCHOOL_ADMIN","PARTNER","COMPANY_ACCOUNTANT"])("rejects non-Owner %s existing-reference review before persistence",async role=>{
    expect((await request(role,reviewPath,"POST",reviewBody)).status).toBe(403);
    expect(f.query).not.toHaveBeenCalled();expect(f.review).not.toHaveBeenCalled();
  });
  it("passes a validated exact-reference Owner request without promoting an unconfirmed service result",async()=>{
    const response=await request("PLATFORM_OWNER",reviewPath,"POST",reviewBody);
    expect(response.status).toBe(200);expect(response.body.status).toBe("CREATION_UNKNOWN");
    expect(f.review).toHaveBeenCalledWith(10,1,reviewBody);
  });
  it.each([{existingTestReference:"RS_UnapprovedReference000"},{extraField:true}])("rejects wrong reference or injected fields before review",async change=>{
    expect((await request("PLATFORM_OWNER",reviewPath,"POST",{...reviewBody,...change})).status).toBe(400);
    expect(f.review).not.toHaveBeenCalled();
  });
  it.each([evidencePath,reviewPath])("blocks a deployed environment at %s before DB/provider operations",async path=>{
    vi.stubEnv("REPLIT_DEPLOYMENT","1");
    expect((await request("PLATFORM_OWNER",path,path===reviewPath?"POST":"GET",reviewBody)).status).toBe(404);
    expect(f.query).not.toHaveBeenCalled();expect(f.evidence).not.toHaveBeenCalled();expect(f.review).not.toHaveBeenCalled();
  });
});
