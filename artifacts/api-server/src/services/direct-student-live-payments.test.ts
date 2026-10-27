import {describe,expect,it,vi} from "vitest";
import {FlutterwaveLiveTransport} from "../lib/flutterwave-live-transport";
import {directLiveConfiguration} from "../lib/flutterwave-direct-live-config";
import {authenticateDirectStudentWebhook,directAllocation,directStudentReadiness} from "./direct-student-live-payments";

const env={
  NODE_ENV:"production",EDUCORE_FLUTTERWAVE_MODE:"LIVE",
  FLUTTERWAVE_LIVE_SECRET_KEY:"FLWSECK-FAKE-NO-NETWORK",
  FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH:"synthetic-webhook-not-live",
  EDUCORE_FLUTTERWAVE_DIRECT_RELEASE:"STUDENT_DIRECT_3200_V1",
  EDUCORE_FLUTTERWAVE_DIRECT_CALLBACK_URL:"https://example.invalid/api/flutterwave/direct-student/callback",
};
const reference="SCV4_live_fictional_reference_123456";
describe("direct LIVE transport safety (fake transport, no credentials or network)",()=>{
  it("requires a distinct release, LIVE-only server credential, production context and explicit callback",()=>{
    for(const patch of [
      {EDUCORE_FLUTTERWAVE_DIRECT_RELEASE:undefined},{NODE_ENV:"development"},
      {EDUCORE_FLUTTERWAVE_MODE:"TEST"},{FLUTTERWAVE_LIVE_SECRET_KEY:"FLWSECK-TEST-FAKE"},
      {EDUCORE_FLUTTERWAVE_DIRECT_CALLBACK_URL:undefined},
      {EDUCORE_FLUTTERWAVE_DIRECT_CALLBACK_URL:"https://example.replit.dev/api/flutterwave/direct-student/callback"},
    ]){
      const config=directLiveConfiguration({...env,...patch});
      expect(config.ready).toBe(false);
    }
    expect(directAllocation).toMatchObject({amountMinor:320000,platformGrossMinor:320000,schoolShareMinor:0,broShareMinor:0});
  });
  it("never converts old obligations just because a proposed price/report exists",async()=>{
    const scope={schoolId:1,studentId:31,termId:4};
    const connect=vi.fn(async()=>{throw Error("No DB read before a complete review");});
    const pool={connect} as any;
    for(const status of ["OWNER_REVIEW","PRESERVE_COMPLETED_HISTORY","CANDIDATE_AFTER_REVIEW"]){
      const r=await directStudentReadiness(pool,scope,{env,report:async()=>({
        sourceStatus:"COMPLETE",evidenceDigest:"a".repeat(64),rows:[{studentId:31,status}]}) as any});
      expect(r).toMatchObject({ready:false,blockers:["LEGACY_HISTORY_OR_OBLIGATION_REQUIRES_SEPARATE_TRANSITION_APPROVAL"]});
    }
    expect(connect).not.toHaveBeenCalled();
  });
  it("makes only non-split 3200 checkout and checks signed LIVE webhook auth without keys in payload",async()=>{
    const calls:{url:string;init:RequestInit}[]=[];
    const fetcher=vi.fn(async(url:string,init:RequestInit)=>{
      calls.push({url,init});
      return Response.json({status:"success",data:{link:"https://checkout.flutterwave.com/v3/hosted/pay/fake-123"}});
    }) as unknown as typeof fetch;
    const transport=new FlutterwaveLiveTransport(env,fetcher,"DIRECT_STUDENT");
    const url=await transport.directStudentCheckout({reference,email:"fictional@example.test"});
    expect(url).toMatch(/^https:\/\/checkout\.flutterwave\.com/);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.flutterwave.com/v3/payments");
    const payload=JSON.parse(String(calls[0].init.body));
    expect(payload).toMatchObject({amount:3200,currency:"NGN",tx_ref:reference});
    expect(payload).not.toHaveProperty("subaccounts");
    expect(payload).not.toHaveProperty("split");
    expect(payload).not.toHaveProperty("payment_plan");
    expect(JSON.stringify(payload)).not.toContain(env.FLUTTERWAVE_LIVE_SECRET_KEY);
    expect(()=>authenticateDirectStudentWebhook({"verif-hash":"wrong-verifier"},env)).toThrow();
    expect(()=>authenticateDirectStudentWebhook({"verif-hash":env.FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH},env)).not.toThrow();
  });
  it("rejects wrong amount, reference, split details and charged-but-failed response",async()=>{
    for(const override of [
      {amount:5000},{currency:"USD"},{tx_ref:"SCV3_live_old_split_ref"},
      {subaccounts:[{id:"old-school"}]},{status:"failed",charged_amount:3200},
    ]){
      const fetcher=vi.fn(async()=>Response.json({status:"success",data:{
        id:901,tx_ref:reference,currency:"NGN",amount:3200,charged_amount:3200,
        status:"successful",flw_ref:"FICTIONAL-901",app_fee:50,merchant_fee:0,...override,
      }})) as unknown as typeof fetch;
      await expect(new FlutterwaveLiveTransport(env,fetcher,"DIRECT_STUDENT").directStudentCollection("901",reference)).rejects.toThrow();
    }
  });
});
