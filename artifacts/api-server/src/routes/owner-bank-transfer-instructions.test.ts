import express from "express";
import type {Server} from "node:http";
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
const f=vi.hoisted(()=>({authenticated:true,role:"SCHOOL_ADMIN",active:true,access:true,
  currentOwner:false,eligible:true,profile:null as any,query:vi.fn(),connect:vi.fn(),decrypt:vi.fn()}));
vi.mock("@workspace/db",()=>({pool:{query:f.query,connect:f.connect}}));
vi.mock("../middlewares/auth",()=>({
  requireAuthentication:()=> (_req:unknown,res:any,next:()=>void)=>f.authenticated?next():res.status(401).json({error:"Authentication required"}),
  getUserContext:()=>({user:{id:9,status:f.active?"ACTIVE":"INACTIVE",email:"fictional@example.test",clerkUserId:"fictional"},
    roles:[{role:f.role,schoolId:f.role==="PLATFORM_OWNER"?null:1,status:"ACTIVE"}]}),
}));
vi.mock("../services/student-platform-rollout",async original=>({
  ...await original<typeof import("../services/student-platform-rollout")>(),
  readStudentRollout:async()=>({chargeable:f.eligible}),
}));
vi.mock("../lib/payroll-bank-encryption",async original=>({
  ...await original<typeof import("../lib/payroll-bank-encryption")>(),decryptPayrollBankValue:f.decrypt,
}));
import router from "./direct-student-live-payments";
let server:Server,base:string;
const verified=()=>({business_name:"Fictional Owner Business",currency:"NGN",verification_status:"VERIFIED",
  verified_at:"2026-01-01T00:00:00Z",verified_by:7,encryption_key_version:"fixture",
  bank_name_encrypted:"cipher-bank",account_name_encrypted:"cipher-name",account_number_encrypted:"cipher-number",
  account_last4:"0001",provider_subaccount_id:"PRIVATE-NOT-RETURNED"});
beforeAll(async()=>{
  const app=express();app.use(express.json());app.use("/api",router);
  server=app.listen(0,"127.0.0.1");
  await new Promise<void>(r=>server.once("listening",r));
  base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api`;
});
afterAll(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));});
beforeEach(()=>{
  Object.assign(f,{authenticated:true,role:"SCHOOL_ADMIN",active:true,access:true,currentOwner:false,eligible:true,profile:null});
  f.query.mockReset().mockImplementation(async(sql:string)=>{
    if(sql.includes('AS "isOwner"'))return {rows:f.access?[{school_name:"Fictional School",term_name:"Second Term",isOwner:f.currentOwner}]:[]};
    if(sql.includes("FROM settlement_payroll_profiles"))return {rows:f.profile?[f.profile]:[]};
    if(sql.includes("SELECT st.id FROM students"))return {rows:[{id:31}]};
    if(sql.includes("INSERT INTO subscription_payment_assistance_requests"))return {rows:[{id:51,status:"REQUESTED"}]};
    return {rows:[]};
  });
  f.connect.mockReset().mockResolvedValue({query:f.query,release:vi.fn()});
  f.decrypt.mockReset().mockImplementation((cipher:string)=>({
    "cipher-bank":"Fictional Bank","cipher-name":"Fictional Business Account","cipher-number":"0000000001",
  } as Record<string,string>)[cipher]);
});
const get=(school=1,query="studentId=31&termId=4")=>fetch(`${base}/schools/${school}/platform-subscriptions/transfer-instructions?${query}`);
const request=(extra:object={})=>fetch(`${base}/schools/1/platform-subscriptions/assistance`,{
  method:"POST",headers:{"Content-Type":"application/json"},
  body:JSON.stringify({studentId:31,termId:4,requestNote:"YETENIA-S1-T4-ST31; fictional transfer evidence",...extra}),
});
describe("private Owner transfer instructions; fictional DB/crypto only",()=>{
  it("requires authentication",async()=>{f.authenticated=false;expect((await get()).status).toBe(401);expect(f.query).not.toHaveBeenCalled();});
  it.each(["PARENT","TEACHER","STAFF","PARTNER"])("denies %s without reading bank settings",async role=>{
    f.role=role;expect((await get()).status).toBe(403);expect(f.query).not.toHaveBeenCalled();
  });
  it("denies inactive actors and foreign-school admins",async()=>{
    expect((await get(2)).status).toBe(403);f.active=false;expect((await get()).status).toBe(403);
    expect(f.query).not.toHaveBeenCalled();
  });
  it("rejects invalid scope before reads",async()=>{
    expect((await get(1,"studentId=0&termId=4")).status).toBe(400);expect(f.query).not.toHaveBeenCalled();
  });
  it("rechecks live membership/student/term ownership before reading or decrypting the account",async()=>{
    f.access=false;expect((await get()).status).toBe(404);
    expect(f.query).toHaveBeenCalledOnce();expect(f.decrypt).not.toHaveBeenCalled();
    expect(f.query.mock.calls[0][0]).toContain("m.school_id=s.id");
  });
  it("reports unavailable without inventing details or exposing the Owner configuration link to schools",async()=>{
    const r=await get(),d=await r.json();
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(d).toMatchObject({available:false,bank:null,amountMinor:320000,transferReference:"YETENIA-S1-T4-ST31",ownerConfigurationPath:null});
    expect(d).toMatchObject({message:expect.stringContaining("Do not transfer")});expect(f.decrypt).not.toHaveBeenCalled();
  });
  it("offers the existing configuration path only to a current global Owner",async()=>{
    f.role="PLATFORM_OWNER";f.currentOwner=true;
    expect(await (await get()).json()).toMatchObject({available:false,ownerConfigurationPath:"/payment-settlement"});
  });
  it.each([{verification_status:"PENDING_VERIFICATION"},{verification_status:"ACTION_REQUIRED"},
    {verified_at:null},{verified_by:null},{currency:"USD"},{business_name:""}])(
    "does not expose unverified/incomplete profile %j",async change=>{
      f.profile={...verified(),...change};
      expect(await (await get()).json()).toMatchObject({available:false,bank:null});
      expect(f.decrypt).not.toHaveBeenCalled();
    });
  it("returns only verified business fields, rate and correct scope; no writes or payment state",async()=>{
    f.profile=verified();
    const d=await (await get()).json();
    expect(d).toMatchObject({available:true,amountMinor:320000,currency:"NGN",bank:{
      businessName:"Fictional Owner Business",bankName:"Fictional Bank",accountName:"Fictional Business Account",accountNumber:"0000000001",
    }});
    expect(f.decrypt).toHaveBeenCalledWith("cipher-number","fixture","settlement:yemait-company:accountNumber");
    expect(JSON.stringify(d)).not.toMatch(/cipher-|PRIVATE-NOT-RETURNED|verified_by|BANK_VERIFIED|PAID/);
    expect(f.query.mock.calls.every(([sql])=>/^\s*SELECT\b/.test(sql))).toBe(true);
    expect(f.connect).not.toHaveBeenCalled();
  });
  it("fails closed on decryption errors or a mismatched full number",async()=>{
    f.profile=verified();f.decrypt.mockImplementation(()=>{throw Error("private-encryption-diagnostic");});
    expect(await (await get()).json()).toMatchObject({available:false,bank:null});
    f.decrypt.mockReturnValue("invalid");
    expect(await (await get()).json()).toMatchObject({available:false,bank:null});
  });
  it("does not leak database errors or old details",async()=>{
    f.query.mockRejectedValue(new Error("private-connection-detail"));
    const r=await get();expect(r.status).toBe(503);expect(JSON.stringify(await r.json())).not.toContain("private-connection");
  });
  it("viewing instructions creates nothing; submitting evidence creates REQUESTED only, never paid or verified",async()=>{
    await get();expect(f.connect).not.toHaveBeenCalled();
    const r=await request();expect(r.status).toBe(201);
    expect(await r.json()).toEqual({id:51,status:"REQUESTED"});
    const sql=f.query.mock.calls.map(([q])=>q).join("\n");
    expect(sql).toContain("INSERT INTO audit_logs");
    expect(sql).not.toMatch(/\bUPDATE\b|INSERT INTO student_direct_live_|INSERT INTO student_subscription_payments/i);
  });
  it.each([{status:"BANK_VERIFIED"},{paid:true},{verifiedAmountMinor:320000}])(
    "rejects client payment-confirmation claims %j",async extra=>{
      expect((await request(extra)).status).toBe(400);expect(f.connect).not.toHaveBeenCalled();
    });
  it("preserves free-period blocking even when company details are verified",async()=>{
    f.profile=verified();f.eligible=false;
    expect(await (await get()).json()).toMatchObject({available:true,collectionPeriodEligible:false});
    expect((await request()).status).toBe(409);
    expect(f.query.mock.calls.some(([sql])=>/^\s*INSERT\b/.test(sql))).toBe(false);
  });
});
