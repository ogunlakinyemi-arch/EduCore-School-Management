import { Router, type Request } from "express";
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
const f = vi.hoisted(()=>({query:vi.fn(),connect:vi.fn(),fetch:vi.fn(),operational:vi.fn()}));
vi.mock("@workspace/db",()=>({pool:{query:f.query,connect:f.connect}}));
vi.mock("../services/subscription-request-access",()=>({enforceRequestSubscription:vi.fn()}));
vi.mock("../middlewares/auth",async original=>{
  const actual=await original<typeof import("../middlewares/auth")>();
  return {...actual,requireAuthentication:()=>(req:any,_res:any,next:any)=>{
    try {actual.getUserContext(req);next();}catch(error){next(error);}
  }};
});
import simulationRouter from "./local-split-simulation";
import { buildLocalSplitSimulation, type LocalSplitSimulationInput } from "../lib/local-split-simulation";
import { assertNoLocalSplitSimulation,LOCAL_SPLIT_SIMULATION_PATH as path } from "../lib/local-split-simulation-barrier";
import { rejectOperationalSimulation,rejectSimulationWebhook } from "../middlewares/local-split-simulation";
import { FlutterwaveTestAdapter } from "../lib/fee-providers";
import { FlutterwaveSplitProvider } from "../services/flutterwave-split-provider";
import { submitSplitRecipient,reviewSplitRecipient } from "../services/flutterwave-split-recipients";
import { prepareSplitCheckout,validateSplitCollection } from "../services/flutterwave-split-checkout";

const input:LocalSplitSimulationInput={mode:"LOCAL_SPLIT_SIMULATION",exampleSchoolId:1496,action:"PREVIEW",acknowledgeFictional:false};
const fixture=()=>buildLocalSplitSimulation(input);
beforeEach(()=>{
  vi.stubEnv("NODE_ENV","development");vi.stubEnv("REPLIT_DEPLOYMENT","");
  for(const spy of [f.query,f.connect,f.fetch,f.operational])spy.mockReset();
  for(const spy of [f.query,f.connect,f.fetch])spy.mockImplementation(()=>{throw new Error("Forbidden database/provider access in simulation test");});
});
afterEach(()=>vi.unstubAllEnvs());
async function request(url:string,method="GET",body?:unknown,role:string|null="PLATFORM_OWNER",active=true){
  const router=Router();
  router.use(rejectOperationalSimulation);
  router.use(simulationRouter);
  router.use((_req,res)=>{f.operational();res.json({operational:true});});
  return new Promise<{status:number;body:any}>(resolve=>{
    const req={url,originalUrl:url,method,body,headers:{},query:{},
      ...(role?{edupulseUser:{user:{id:1},roles:[{role,schoolId:role==="SCHOOL_ADMIN"?1496:null,status:active?"ACTIVE":"INACTIVE"}]}}:{})} as unknown as Request;
    const res:any={statusCode:200,set:()=>res,status:(n:number)=>{res.statusCode=n;return res;},
      json:(value:unknown)=>{resolve({status:res.statusCode,body:value});return res;}};
    router(req,res,(error?:any)=>resolve({status:error?.statusCode??500,body:{error:error?.message}}));
  });
}
describe("TEST / NOT REAL stateless split simulation",()=>{
  it.each(["PREVIEW","REVIEW","ENABLE","DISABLE","RESET"] as const)("keeps %s unverified, nonoperational and fictional",action=>{
    const d=buildLocalSplitSimulation({...input,action,acknowledgeFictional:true});
    expect(d.label).toBe("TEST / NOT REAL");expect(d.recipientState).toBe("LOCAL_ONLY_UNVERIFIED");
    for(const key of ["operationalEnabled","testReady","ownershipVerified","providerVerified","checkoutAllowed","webhooksAllowed","allocationProven","bankSettlementVerified","providerFeesIncluded"] as const) expect(d[key]).toBe(false);
    expect(d.simulationSchoolMinor+d.simulationPlatformGrossMinor).toBe(d.simulationTotalMinor);
    expect(d.simulationTotalMinor).toBe(500000);expect(d.simulationSchoolMinor).toBe(200000);expect(d.simulationPlatformGrossMinor).toBe(300000);
    expect(d.fictionalContact).toMatch(/@fixture\.invalid$/);
    expect(d.fictionalAccount).not.toMatch(/^\d{10}$/);
    expect(d.simulationRecipientId).not.toMatch(/^RS_/);
    expect(f.query).not.toHaveBeenCalled();expect(f.connect).not.toHaveBeenCalled();expect(f.fetch).not.toHaveBeenCalled();
  });
  it("does not retain state between enablement and a fresh preview",()=>{
    const enabled=buildLocalSplitSimulation({...input,action:"ENABLE",acknowledgeFictional:true});
    expect(enabled.simulatedEnabled).toBe(true);
    expect(fixture().simulatedEnabled).toBe(false);expect(enabled.simulatedEnabled).toBe(true);
  });
  it("freezes the fixture so local callers cannot mutate readiness in place",()=>{
    const d=fixture();
    expect(Object.isFrozen(d)).toBe(true);
    expect(()=>{(d as any).testReady=true;}).toThrow();
    expect(d.testReady).toBe(false);
  });
  it.each(["REVIEW","ENABLE"] as const)("requires explicit fictional acknowledgement for %s",action=>{
    expect(()=>buildLocalSplitSimulation({...input,action})).toThrow("Acknowledge");
  });
  it.each(["production","test",""])("rejects non-development NODE_ENV=%s",mode=>{
    vi.stubEnv("NODE_ENV",mode);
    expect(()=>fixture()).toThrow("Development");
  });
  it("rejects any deployment flag even when NODE_ENV is development",()=>{
    vi.stubEnv("REPLIT_DEPLOYMENT","1");expect(()=>fixture()).toThrow();
  });
  it.each(["SCHOOL_ADMIN","PARTNER","COMPANY_ACCOUNTANT"])("denies %s simulation access",async role=>{
    expect((await request(path,"GET",undefined,role)).status).toBe(403);
    expect(f.query).not.toHaveBeenCalled();
  });
  it("denies unsigned and inactive Owner access",async()=>{
    expect((await request(path,"GET",undefined,null)).status).toBe(401);
    expect((await request(path,"GET",undefined,"PLATFORM_OWNER",false)).status).toBe(403);
  });
  it("allows active Owner preview and purely simulated enablement without database/provider use",async()=>{
    expect((await request(path)).body.testReady).toBe(false);
    const enabled=await request(path,"POST",{...input,action:"ENABLE",acknowledgeFictional:true});
    expect(enabled.status).toBe(200);expect(enabled.body.simulatedEnabled).toBe(true);expect(enabled.body.operationalEnabled).toBe(false);
    expect(f.query).not.toHaveBeenCalled();expect(f.connect).not.toHaveBeenCalled();expect(f.fetch).not.toHaveBeenCalled();
  });
  it.each([{exampleSchoolId:1},{action:"TEST_READY"},{testReady:true},{providerSubaccountId:"RS_ForbiddenSynthetic000"},{action:"ENABLE"}])("rejects target changes, promotion fields and unacknowledged actions",async change=>{
    expect((await request(path,"POST",{...input,...change})).status).toBe(400);
    expect(f.query).not.toHaveBeenCalled();
  });
  it("hides the simulation endpoint in deployed environments",async()=>{
    vi.stubEnv("REPLIT_DEPLOYMENT","1");
    expect((await request(path)).status).toBe(404);
  });
});
describe("Hard operational barriers",()=>{
  it.each([
    "/flutterwave/split-recipients",
    "/flutterwave/split-recipients/10/review",
    "/flutterwave/split-schools/1496/configuration",
    "/subscriptions/99/checkout",
    "/flutterwave/split-payments/40/refunds",
    "/webhooks/flutterwave/student-subscription",
  ])("rejects copied simulation data before operational handler: %s",async url=>{
    const result=await request(url,"POST",{...fixture(),enabled:true,status:"TEST_READY"});
    expect(result.status).toBe(400);expect(f.operational).not.toHaveBeenCalled();expect(f.query).not.toHaveBeenCalled();
  });
  it.each(["LOCAL_SPLIT_SIMULATION","SIMULATION_NOT_REAL_RECIPIENT_1496","TEST / NOT REAL","qa@fixture.invalid"])("rejects nested marker %s",marker=>{
    expect(()=>assertNoLocalSplitSimulation({a:[{b:marker}]})).toThrow("simulation data");
  });
  it("rejects JSON-escaped raw webhook markers without touching signed bytes",()=>{
    const raw=Buffer.from('{"mode":"\\u004cOCAL_SPLIT_SIMULATION"}');
    const original=Buffer.from(raw),next=vi.fn(),json=vi.fn(),status=vi.fn(()=>({json}));
    rejectSimulationWebhook({body:raw} as any,{status} as any,next);
    expect(status).toHaveBeenCalledWith(400);expect(next).not.toHaveBeenCalled();expect(raw.equals(original)).toBe(true);
  });
  it("leaves ordinary webhook bytes unchanged and continues signature validation",()=>{
    const raw=Buffer.from('{"event":"charge.completed","data":{"id":123}}'),next=vi.fn();
    rejectSimulationWebhook({body:raw} as any,{} as any,next);
    expect(next).toHaveBeenCalledOnce();expect(raw.toString()).toContain("charge.completed");
  });
  it("rejects recipient submission/promotion before database or bank resolution",async()=>{
    await expect(submitSplitRecipient(1,{kind:"SCHOOL",id:1496,name:"TEST / NOT REAL"},{} as any)).rejects.toThrow();
    await expect(reviewSplitRecipient(10,1,{action:"APPROVE_AND_CREATE_TEST",note:"TEST / NOT REAL"})).rejects.toThrow();
    expect(f.connect).not.toHaveBeenCalled();expect(f.query).not.toHaveBeenCalled();
  });
  it("rejects simulation identifiers/snapshots before checkout/collection writes",async()=>{
    await expect(prepareSplitCheckout("SIMULATION_NOT_REAL_PAYMENT" as any)).rejects.toThrow();
    await expect(validateSplitCollection({query:f.query} as any,fixture(),{} as any)).rejects.toThrow();
    expect(f.connect).not.toHaveBeenCalled();expect(f.query).not.toHaveBeenCalled();
  });
  it("blocks decorated Flutterwave checkout input before transport, even if valid-looking payment fields are included",async()=>{
    const adapter=new FlutterwaveTestAdapter({secretKey:"FLWSECK_TEST-unit-only-simulation"},{fetch:f.fetch});
    await expect(adapter.initializePayment({reference:"unit-ref",amountMinor:500000,currency:"NGN",metadata:{simulation:fixture()}} as any)).rejects.toThrow("simulation data");
    expect(f.fetch).not.toHaveBeenCalled();
  });
  it("blocks fictional bank resolution at the outbound transport boundary",async()=>{
    const provider=new FlutterwaveSplitProvider("FLWSECK_TEST-unit-only-simulation",{fetch:f.fetch});
    await expect(provider.resolveBank("SIMULATION_NOT_REAL_BANK","SIMULATION_NOT_REAL_ACCOUNT")).rejects.toThrow("simulation data");
    expect(f.fetch).not.toHaveBeenCalled();
  });
});
