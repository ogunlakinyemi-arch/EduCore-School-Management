import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
const m=vi.hoisted(()=>({persist:vi.fn(),process:vi.fn()}));
vi.mock("@workspace/db",()=>({pool:{connect:vi.fn()}}));
vi.mock("../lib/fee-providers/factory",()=>({configuredLiveStudentSubscriptionAdapter:()=>null}));
vi.mock("../services/flutterwave-live-webhook-inbox",()=>({persistAuthenticatedLiveWebhookReceipt:m.persist}));
vi.mock("../services/flutterwave-live-lifecycle",()=>({processLiveWorkflow:m.process}));
import { createStudentSubscriptionLiveWebhookRouter } from "./student-subscription-live-webhooks";
import { developmentWorkersPaused } from "../lib/development-worker-policy";

describe("mocked LIVE webhook HTTP recovery/authentication boundary",()=>{
  const connect=vi.fn();
  let mode:"missing"|"reject"|"throw"|"valid"="valid";
  const auth=vi.fn((headers:Record<string,unknown>)=>{
    if(mode==="reject"||headers["verif-hash"]!=="fictional_fixture_verifier")throw new Error("synthetic rejection");
  });
  const authenticator=()=>{
    if(mode==="throw")throw new Error("synthetic configuration failure");
    return mode==="missing"?null:{authenticateWebhook:auth};
  };
  let server:ReturnType<ReturnType<typeof express>["listen"]>,base="";
  beforeAll(async()=>{
    const app=express();
    app.use(express.raw({type:"application/json",limit:"70kb"}));
    app.use("/blocked",createStudentSubscriptionLiveWebhookRouter({pool:{connect} as any,authenticator}));
    // Fictional injected capability only. Actual application construction remains disabled.
    app.use("/fixture",createStudentSubscriptionLiveWebhookRouter({pool:{connect} as any,authenticator,
      capability:{enabled:true},verifier:{enabled:true,environment:"LIVE",merchantScope:"fictional_scope",verify:vi.fn()}}));
    server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));
    base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));});
  beforeEach(()=>{vi.clearAllMocks();mode="valid";m.persist.mockResolvedValue(7);m.process.mockReset();});
  const post=(path="/blocked",body="{}",header="fictional_fixture_verifier")=>fetch(base+path,{
    method:"POST",headers:{"Content-Type":"application/json","verif-hash":header},body});
  it.each(["missing","throw","reject"] as const)("refuses %s authentication/configuration before receipt or financial work",async value=>{
    mode=value;const r=await post();
    expect(r.status).toBe(value==="reject"?401:503);
    expect(await r.json()).toMatchObject({processed:false});
    expect(m.persist).not.toHaveBeenCalled();expect(m.process).not.toHaveBeenCalled();expect(connect).not.toHaveBeenCalled();
  });
  it("refuses TEST-labelled/unrecognized fixture verifier before storage",async()=>{
    expect((await post("/blocked","{}","fictional_TEST_verifier")).status).toBe(401);
    expect(m.persist).not.toHaveBeenCalled();
  });
  it.each(["","x".repeat(65_537)])("rejects invalid body size before authentication or persistence",async body=>{
    expect((await post("/blocked",body)).status).toBe(400);expect(auth).not.toHaveBeenCalled();
    expect(m.persist).not.toHaveBeenCalled();
  });
  it("does not acknowledge a receipt COMMIT failure; a later delivery can recover but remains unreleased",async()=>{
    m.persist.mockRejectedValueOnce(new Error("synthetic uncertain COMMIT")).mockResolvedValueOnce(7);
    const first=await post();expect(first.status).toBe(503);expect(await first.json()).toMatchObject({processed:false});
    const second=await post();expect(second.status).toBe(503);
    expect(await second.json()).toMatchObject({processed:false,receiptRecorded:true});
    expect(m.process).not.toHaveBeenCalled();expect(m.persist).toHaveBeenCalledTimes(2);
  });
  it("ignores attempted body-supplied financial/release capabilities",async()=>{
    const r=await post("/blocked",JSON.stringify({enabled:true,processed:true,capability:{enabled:true}}));
    expect(r.status).toBe(503);expect(await r.json()).toMatchObject({processed:false,receiptRecorded:true});
    expect(m.process).not.toHaveBeenCalled();
  });
  it.each(["PENDING","FINALIZED"])("never acknowledges financial success even when fixture processing reports %s",async status=>{
    m.process.mockResolvedValue({status,processed:true});
    const r=await post("/fixture");expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({processed:false,receiptRecorded:true});
  });
  it("holds unresolved fixture finalization for reconciliation, never a success acknowledgement",async()=>{
    m.process.mockRejectedValue(new Error("synthetic financial persistence failure"));
    const r=await post("/fixture");expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({processed:false,receiptRecorded:true,
      error:"LIVE processing unresolved; reconciliation required"});
  });
  it("pause is a supported unpublished-Development control, not authorization to send or pause Production",()=>{
    expect(developmentWorkersPaused({NODE_ENV:"development",EDUCORE_DEVELOPMENT_WORKERS_PAUSED:"true"})).toBe(true);
    expect(developmentWorkersPaused({NODE_ENV:"production",EDUCORE_DEVELOPMENT_WORKERS_PAUSED:"true"})).toBe(false);
    expect(developmentWorkersPaused({NODE_ENV:"development",REPLIT_DEPLOYMENT:"1",EDUCORE_DEVELOPMENT_WORKERS_PAUSED:"true"})).toBe(false);
  });
});
