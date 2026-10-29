import express from "express";
import {createServer,type Server} from "node:http";
import {afterAll,beforeAll,beforeEach,expect,it,vi} from "vitest";
import {financialGuardCatalogFixture} from "../test/financial-guard-catalog-fixture";
const db=vi.hoisted(()=>({ready:false,missingCatalog:null as "functions"|"triggers"|null,
  role:"PLATFORM_OWNER",row:{} as any,audits:[] as any[],query:vi.fn()}));
vi.mock("@workspace/db",()=>({pool:{query:db.query,connect:async()=>({query:db.query,release:()=>{}})}}));
vi.mock("../middlewares/auth",()=>({
  requireAuthentication:()=>((_req:unknown,_res:unknown,next:()=>void)=>next()),
  getUserContext:()=>({user:{id:9,status:"ACTIVE",firstName:"Fictional",lastName:"Owner",
    email:"owner@example.test",clerkUserId:"fixture-only"},roles:[{role:db.role,status:"ACTIVE",schoolId:db.role==="PLATFORM_OWNER"?null:1}]}),
}));
import router from "./owner-subscription-rules";
let server:Server,origin:string;
beforeAll(async()=>{
  const app=express();app.use(express.json());app.use(router);server=createServer(app);
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  const address=server.address();if(!address||typeof address==="string")throw new Error("fixture server missing");
  origin=`http://127.0.0.1:${address.port}`;
});
afterAll(async()=>new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve())));
beforeEach(()=>{
  db.ready=false;db.missingCatalog=null;db.role="PLATFORM_OWNER";db.audits=[];db.query.mockReset();
  const catalog=financialGuardCatalogFixture();
  db.row={id:71,product:"BRO_COMMISSION",status:"DRAFT",amount_minor:15000,currency:"NGN",
    billing_period:"ACADEMIC_TERM",school_share_minor:0,effective_at:"2099-01-05T23:00:00Z",
    ends_at:null,reason:"Prospective BRO policy approval",version:1,native_rule_id:null};
  db.query.mockImplementation(async(sql:string,args?:unknown[])=>{
    if(sql.includes("to_regclass"))return{rows:[{ready:db.ready}]};
    if(sql.includes("FROM pg_proc"))return{rows:db.missingCatalog==="functions"?[]:catalog.functions};
    if(sql.includes("FROM pg_trigger tg"))return{rows:db.missingCatalog==="triggers"?[]:catalog.triggers};
    if(sql.includes("SELECT * FROM subscription_rule_proposals"))return{rows:[structuredClone(db.row)]};
    if(sql.includes("UPDATE subscription_rule_proposals SET status='SCHEDULED'")){
      db.row={...db.row,status:"SCHEDULED",version:db.row.version+1};return{rows:[structuredClone(db.row)]};
    }
    if(sql.includes("INSERT INTO audit_logs"))db.audits.push(args);
    return{rows:[]};
  });
});
const preview=()=>fetch(`${origin}/platform/subscription-payment-rules/71/preview`,{method:"POST"});
const activate=(version:number,previewDigest:string)=>fetch(`${origin}/platform/subscription-payment-rules/71/activate`,
  {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({version,previewDigest})});
it("blocks BRO activation without reviewed storage and makes no policy or legacy writes",async()=>{
  const response=await preview();expect(response.status).toBe(200);
  const p=await response.json() as any;
  expect(p.activationAvailable).toBe(false);expect(p.blocker).toContain("recovery safety");
  expect((await activate(1,p.previewDigest)).status).toBe(409);
  expect(db.row.status).toBe("DRAFT");expect(db.audits).toEqual([]);
  expect(db.query.mock.calls.map(([q])=>q).join("\n")).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER)\b/m);
});
it.each(["functions","triggers"] as const)("blocks BRO activation when tables exist but guard %s are missing",async missing=>{
  db.ready=true;db.missingCatalog=missing;
  const response=await preview();expect(response.status).toBe(200);
  const p=await response.json() as any;
  expect(p.activationAvailable).toBe(false);expect(p.blocker).toContain("recovery safety");
  expect((await activate(1,p.previewDigest)).status).toBe(409);
  expect(db.row.status).toBe("DRAFT");expect(db.audits).toEqual([]);
  expect(db.query.mock.calls.map(([q])=>q).join("\n")).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|CREATE|ALTER)\b/m);
});
it("requires an exact preview and audits an Owner-approved future 150 policy without touching native split rules",async()=>{
  db.ready=true;
  const p=await (await preview()).json() as any;
  expect(p).toMatchObject({activationAvailable:true,blocker:null});
  expect((await activate(99,p.previewDigest)).status).toBe(409);
  const response=await activate(1,p.previewDigest);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({status:"SCHEDULED",amountMinor:15000,nativeRuleId:null});
  expect(db.audits).toHaveLength(1);
  expect(JSON.stringify(db.audits)).toContain("SEPARATE_PLATFORM_EXPENSE");
  expect((await activate(1,p.previewDigest)).status).toBe(409);
  expect(db.audits).toHaveLength(1);
  const mutations=db.query.mock.calls.map(([q])=>q).filter(q=>/INSERT|UPDATE|DELETE/.test(q)).join("\n");
  expect(mutations).not.toMatch(/commission_rules|commission_ledger|staff_nfc_billing_rules|student_direct_live/);
});
it.each(["SCHOOL_ADMIN","PARTNER","ACCOUNTANT"])("rejects %s policy and accrual requests before SQL",async role=>{
  db.role=role;
  expect((await preview()).status).toBe(403);
  expect((await fetch(`${origin}/platform/bro-commissions/accruals`,{method:"POST",
    headers:{"content-type":"application/json"},body:JSON.stringify({schoolId:1,studentId:31,termId:4})})).status).toBe(403);
  expect(db.query).not.toHaveBeenCalled();
});
it.each([10000,14999,15001])("will not activate a draft at %i kobo",async amount=>{
  db.ready=true;db.row.amount_minor=amount;
  const p=await (await preview()).json() as any;
  expect(p.activationAvailable).toBe(false);expect(p.blocker).toContain("₦150");
});
it("rejects a past effective date and rejects client commission overrides",async()=>{
  db.ready=true;db.row.effective_at="2000-01-01T00:00:00Z";
  const p=await (await preview()).json() as any;
  expect(p.activationAvailable).toBe(false);expect(p.blocker).toContain("future");
  db.query.mockClear();
  expect((await fetch(`${origin}/platform/bro-commissions/accruals`,{method:"POST",
    headers:{"content-type":"application/json"},body:JSON.stringify({schoolId:1,studentId:31,termId:4,amountMinor:15000})})).status).toBe(400);
  expect(db.query).not.toHaveBeenCalled();
});
