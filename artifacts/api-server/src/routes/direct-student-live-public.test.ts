import express from "express";
import type {Server} from "node:http";
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";

const f=vi.hoisted(()=>({ready:true,authenticate:vi.fn(),verify:vi.fn()}));
vi.mock("@workspace/db",()=>({pool:{}}));
vi.mock("../middlewares/auth",()=>({
  requireAuthentication:()=> (_req:unknown,_res:unknown,next:()=>void)=>next(),
  getUserContext:()=>{throw new Error("No signed-in financial route is exercised");},
}));
vi.mock("../lib/flutterwave-direct-live-config",()=>({directLiveConfiguration:()=>({ready:f.ready})}));
vi.mock("../services/direct-student-live-payments",async original=>{
  const actual=await original<typeof import("../services/direct-student-live-payments")>();
  return{...actual,authenticateDirectStudentWebhook:f.authenticate,verifyDirectStudentPayment:f.verify};
});
import {directStudentPublicRouter,directStudentWebhookRouter} from "./direct-student-live-payments";
import {DirectPaymentBlocked} from "../services/direct-student-live-payments";

const reference="SCV4_live_fictional_reference_123456";
let server:Server,base:string;
beforeAll(async()=>{
  const app=express();
  app.use("/hook",express.raw({type:"application/json",limit:"64kb"}),directStudentWebhookRouter);
  app.use("/api",directStudentPublicRouter);
  server=app.listen(0,"127.0.0.1");
  await new Promise<void>(resolve=>server.once("listening",resolve));
  base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
});
afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));});
beforeEach(()=>{
  f.ready=true;f.authenticate.mockReset();f.verify.mockReset();
  f.verify.mockResolvedValue({reference,state:"PAID",checkoutUrl:null});
});
const post=(body:string)=>fetch(`${base}/hook`,{
  method:"POST",headers:{"Content-Type":"application/json","verif-hash":"fictional-only"},body,
});
const payload=(id:unknown=901,tx_ref:unknown=reference)=>JSON.stringify({
  event:"charge.completed",data:{id,tx_ref,status:"successful",amount:1,currency:"USD"},
});

describe("direct public ingress (loopback, synthetic service, no database/provider access)",()=>{
  it("authenticates before parsing and does not verify an unauthenticated event",async()=>{
    f.authenticate.mockImplementation(()=>{throw new DirectPaymentBlocked("WEBHOOK_AUTHENTICATION_FAILED",401);});
    expect((await post("{bad-json")).status).toBe(401);
    expect(f.verify).not.toHaveBeenCalled();
  });
  it("returns a controlled 400 for authenticated malformed JSON rather than a retryable server error",async()=>{
    const r=await post("{bad-json");
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({error:"INVALID_WEBHOOK"});
    expect(f.authenticate).toHaveBeenCalledOnce();expect(f.verify).not.toHaveBeenCalled();
  });
  it.each([0,-1,1.5,9007199254740992,"9007199254740992","../901","0","",null])(
    "rejects invalid webhook transaction ID %s before verification",async id=>{
      expect((await post(payload(id))).status).toBe(400);expect(f.verify).not.toHaveBeenCalled();
    });
  it("rejects another workflow's reference before verification",async()=>{
    expect((await post(payload(901,"SCV3_live_retired_split_123"))).status).toBe(400);
    expect(f.verify).not.toHaveBeenCalled();
  });
  it.each([901,"901"])("uses identifiers only and acknowledges verified completion with HTTP 200: %s",async id=>{
    const r=await post(payload(id));
    expect(r.status).toBe(200);expect(r.headers.get("cache-control")).toBe("no-store");
    expect(f.verify).toHaveBeenCalledWith({}, {reference,transactionId:"901",actorId:null});
  });
  it("does not acknowledge failed persistence or schema verification as success",async()=>{
    f.verify.mockRejectedValue(new DirectPaymentBlocked("DIRECT_RELEASE_SCHEMA_REQUIRED"));
    expect((await post(payload())).status).toBe(409);
  });
  it("keeps unexpected verification errors non-secret and retryable",async()=>{
    f.verify.mockRejectedValue(new Error("fictional-private-provider-detail"));
    const r=await post(payload());expect(r.status).toBe(503);
    expect(await r.json()).toEqual({error:"DIRECT_LIVE_PAYMENT_UNAVAILABLE"});
  });
  it("rejects an unsafe callback transaction ID without calling the verifier",async()=>{
    const r=await fetch(`${base}/api/flutterwave/direct-student/callback?tx_ref=${reference}&transaction_id=9007199254740992`);
    expect(r.status).toBe(400);expect(f.verify).not.toHaveBeenCalled();
  });
  it("never trusts callback status and keeps the independent LIVE configuration gate",async()=>{
    const path=`${base}/api/flutterwave/direct-student/callback?tx_ref=${reference}&transaction_id=901&status=successful`;
    f.ready=false;expect((await fetch(path)).status).toBe(409);expect(f.verify).not.toHaveBeenCalled();
    f.ready=true;expect((await fetch(path)).status).toBe(200);
    expect(f.verify).toHaveBeenCalledWith({}, {reference,transactionId:"901",actorId:null});
  });
});
