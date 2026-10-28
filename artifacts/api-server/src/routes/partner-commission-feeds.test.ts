import express from "express";
import type {Server} from "node:http";
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
const f=vi.hoisted(()=>({query:vi.fn(),connect:vi.fn(),evidence:[] as any[],batches:[] as any[],payouts:[] as any[]}));
vi.mock("@workspace/db",()=>({pool:{query:f.query,connect:f.connect}}));
vi.mock("@clerk/express",()=>({clerkClient:{}}));
vi.mock("../middlewares/auth",async original=>({
  ...await original<typeof import("../middlewares/auth")>(),
  requireAuthentication:()=> (req:any,res:any,next:()=>void)=>{
    const role=req.header("x-test-role")??"PLATFORM_OWNER";
    if(role==="ANONYMOUS"){res.status(401).json({error:"Authentication required"});return;}
    req.edupulseUser={user:{id:1,clerkUserId:"fictional-owner",email:"owner@example.test",status:"ACTIVE"},
      roles:[{id:1,role,status:"ACTIVE",schoolId:role==="SCHOOL_ADMIN"?7:null}]};
    next();
  },
}));
import router from "./partners";
import {rejectRetiredPaymentWorkflows} from "../services/retired-payment-workflows";
let server:Server,base:string;
const paths=["/platform/partner-term-commissions","/platform/partner-payout-batches","/platform/partner-payouts"];
beforeAll(async()=>{
  const app=express();app.use(express.json());app.use("/api",rejectRetiredPaymentWorkflows,router);
  app.use((_error:unknown,_req:any,res:any,_next:any)=>res.status(500).json({error:"BRO feed unavailable"}));
  server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
  base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
});
afterAll(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
beforeEach(()=>{
  vi.stubEnv("NODE_ENV","production");vi.stubEnv("REPLIT_DEPLOYMENT","1");
  f.evidence=[];f.batches=[];f.payouts=[];f.connect.mockReset();
  f.query.mockReset().mockImplementation(async(sql:string)=>{
    if(sql.includes("FROM deferred_partner_commission_evidence"))return {rows:f.evidence};
    if(sql.includes("FROM partner_payout_batches"))return {rows:f.batches};
    if(sql.includes("FROM partner_payouts"))return {rows:f.payouts};
    throw Error("Unexpected SQL in read-only regression fixture");
  });
});
afterEach(()=>vi.unstubAllEnvs());
describe("published BRO feeds: authorized reads, not split execution",()=>{
  it.each(paths)("allows Production Owner GET %s through the retirement middleware without financial writes",async path=>{
    const response=await fetch(base+path);
    expect(response.status).toBe(200);expect(await response.json()).toEqual([]);
    expect(f.query).toHaveBeenCalledOnce();expect(f.connect).not.toHaveBeenCalled();
    expect(f.query.mock.calls.every(([sql])=>/^\s*SELECT\b/.test(sql))).toBe(true);
  });
  it.each(["ANONYMOUS","PARENT","SCHOOL_ADMIN","PARTNER","TEACHER"])("denies %s on all feeds before SQL",async role=>{
    for(const path of paths)expect((await fetch(base+path,{headers:{"x-test-role":role}})).status).toBe(role==="ANONYMOUS"?401:403);
    expect(f.query).not.toHaveBeenCalled();expect(f.connect).not.toHaveBeenCalled();
  });
  it("retains historical rate, attribution, held status and missing fee evidence without inventing eligibility",async()=>{
    f.evidence=[{id:13,partner_profile_id:2,partner_name:"Fictional BRO",school_id:7,student_id:31,
      academic_session_id:3,academic_term_id:4,term:"First Term",session_name:"2026/2027",
      reference:"LEGACY-FIXTURE",status:"HELD",amount:"100",gross_amount_minor:500000,school_amount_minor:480000,
      provider_fee_minor:null,provider_additional_fee_minor:null,verified_eligible:false,payout_id:null,
      term_ended:true,split_status:"REVIEW_REQUIRED"}];
    const response=await fetch(base+paths[0]);
    expect(await response.json()).toMatchObject([{id:13,partnerId:2,schoolId:7,studentId:31,amountMinor:10000,
      status:"HELD",eligible:false,providerFeeMinor:null,ownerNetMinor:null}]);
    expect(f.connect).not.toHaveBeenCalled();
  });
  it("reads retained approval history and payout records without reapproving or transferring them",async()=>{
    f.batches=[{id:8,status:"APPROVED",approved_at:"2026-01-01T00:00:00Z",approved_by:1,
      snapshot:{amountMinor:10000,currency:"NGN",items:[]},execution_mode:"EXPORT_ONLY"}];
    f.payouts=[{id:9,partnerId:2,amount:100,currency:"NGN",status:"PAID",paymentReference:"FICTIONAL-HISTORY"}];
    expect(await (await fetch(base+paths[1])).json()).toMatchObject([{id:8,status:"APPROVED",amountMinor:10000}]);
    expect(await (await fetch(base+paths[2])).json()).toEqual(f.payouts);
    expect(f.connect).not.toHaveBeenCalled();
  });
  it.each(paths)("surfaces a real read failure for %s and permits a safe GET retry",async path=>{
    f.query.mockRejectedValueOnce(new Error("fixture database failure"));
    expect((await fetch(base+path)).status).toBe(500);
    const retry=await fetch(base+path);expect(retry.status).toBe(200);expect(await retry.json()).toEqual([]);
    expect(f.query).toHaveBeenCalledTimes(2);expect(f.connect).not.toHaveBeenCalled();
  });
  it("does not lift Production guards on legacy approval/export or retired split issuance",async()=>{
    const approval=await fetch(base+paths[1],{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({commissionIds:[13],idempotencyKey:"fixture-approved-identity"})});
    expect(approval.status).toBe(404);
    expect((await fetch(base+paths[1]+"/8")).status).toBe(404);
    expect((await fetch(base+"/flutterwave/split-recipients",{method:"POST"})).status).toBe(410);
    expect(f.query).not.toHaveBeenCalled();expect(f.connect).not.toHaveBeenCalled();
  });
});
