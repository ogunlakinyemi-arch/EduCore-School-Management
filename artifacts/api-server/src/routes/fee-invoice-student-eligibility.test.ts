import express from "express";
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
const state=vi.hoisted(()=>({calls:[] as string[],studentExists:true,eligible:false,existing:false}));
const invoice={id:2,schoolId:1496,studentId:773,invoiceNumber:"EXISTING-INVOICE",studentName:"Existing Student",
  sessionId:1,termId:1,currency:"NGN",subtotalMinor:800000,discountMinor:0,waiverMinor:0,totalMinor:800000,
  paidMinor:800000,outstandingMinor:0,status:"PAID"};
const db=vi.hoisted(()=>{
  const query=vi.fn(async(sql:string,values:unknown[]=[])=>{
    state.calls.push(sql);
    if(["BEGIN","COMMIT","ROLLBACK"].includes(sql))return{rows:[]};
    if(sql.includes("SELECT id FROM fee_invoices"))return{rows:state.existing?[{id:2}]:[]};
    if(sql.includes("FROM fee_invoices i WHERE i.id="))return{rows:[{
      id:2,schoolId:1496,studentId:773,invoiceNumber:"EXISTING-INVOICE",studentName:"Existing Student",
      sessionId:1,termId:1,currency:"NGN",subtotalMinor:800000,discountMinor:0,waiverMinor:0,totalMinor:800000,
      paidMinor:800000,outstandingMinor:0,status:"PAID",
    }]};
    if(sql.includes("FROM fee_structures WHERE"))return{rows:[{id:1,school_id:1496,school_class_id:590,section:"A",status:"PUBLISHED"}]};
    if(sql.includes('AS "eligibleForStructure"'))return{rows:state.studentExists && values[0]===773 && values[1]===1496
      ?[{id:773,first_name:"Existing",last_name:"Student",class_name:"JSS 1",section:"A",eligibleForStructure:state.eligible}]:[]};
    if(sql.includes("FROM fee_receipts r JOIN fee_payments p"))return{rows:values[0]===2 && values[1]===1496
      ?[{receiptNumber:"RCP-1496-00000002",paymentId:2,schoolId:1496,invoiceId:2,
        snapshot:{schoolId:1496,invoiceId:2,studentId:773,studentName:"Existing Student",amountMinor:800000}}]:[]};
    throw Error(`Unexpected focused eligibility query: ${sql}`);
  });
  return{query,connect:vi.fn(async()=>({query,release:vi.fn()}))};
});
vi.mock("@workspace/db",()=>({pool:db}));
vi.mock("../middlewares/auth",async original=>{
  const actual=await original<typeof import("../middlewares/auth")>();
  return{...actual,requireAuthentication:()=> (req:express.Request,_res:express.Response,next:express.NextFunction)=>{
    (req as any).edupulseUser={user:{id:20,clerkUserId:"verified-test",email:"admin@example.test",firstName:"Test",lastName:"Admin",status:"ACTIVE"},
      roles:[{id:1,role:req.header("x-test-role")??"SCHOOL_ADMIN",schoolId:1496,status:"ACTIVE"}]};next();
  }};
});
import router from "./finance";
const app=express();app.use(express.json());app.use(router);
let server:ReturnType<typeof app.listen>,url:string;
beforeAll(async()=>{await new Promise<void>(resolve=>{server=app.listen(0,"127.0.0.1",()=>resolve());});
  url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;});
afterAll(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
beforeEach(()=>{state.calls=[];state.studentExists=true;state.eligible=false;state.existing=false;});
const post=(studentId=773,schoolId=1496,role="SCHOOL_ADMIN")=>fetch(`${url}/school/finance/assignments?schoolId=${schoolId}`,
  {method:"POST",headers:{"Content-Type":"application/json","x-test-role":role},
    body:JSON.stringify({structureId:1,studentId,issueDate:"2026-10-04",dueDate:"2026-10-12"})});
describe("canonical student lookup and invoice/receipt preservation",()=>{
  it("distinguishes an existing but ineligible student from a missing student",async()=>{
    const response=await post();expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).toContain("not enrolled in this fee structure");
    expect(state.calls.some(s=>s.includes("INSERT"))).toBe(false);
  });
  it("keeps missing students rejected as not found",async()=>{
    state.studentExists=false;expect((await post()).status).toBe(404);
    expect(state.calls.some(s=>s.includes("INSERT"))).toBe(false);
  });
  it("keeps foreign-school student IDs rejected",async()=>{
    expect((await post(721)).status).toBe(404);
    expect(state.calls.some(s=>s.includes("INSERT"))).toBe(false);
  });
  it("keeps foreign-school invoice assignment rejected",async()=>{
    expect((await post(773,1393)).status).toBe(404);
    expect(state.calls.some(s=>s.includes("INSERT"))).toBe(false);
  });
  it("returns an already-issued invoice without duplicating or reclassifying it",async()=>{
    state.existing=true;const response=await post();expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject(invoice);
    expect(state.calls.some(s=>s.includes("INSERT"))).toBe(false);
  });
  it("retains authorized same-school receipt access and canonical student mapping",async()=>{
    const response=await fetch(`${url}/finance/payments/2/receipt?schoolId=1496`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({paymentId:2,schoolId:1496,snapshot:{invoiceId:2,studentId:773}});
  });
  it("does not expose a receipt under a foreign school",async()=>{
    expect((await fetch(`${url}/finance/payments/2/receipt?schoolId=1393`)).status).toBe(404);
  });
  it.each(["TEACHER","STUDENT","PLATFORM_OWNER"])("does not grant invoice creation to %s",async(role)=>{
    expect([403,404]).toContain((await post(773,1496,role)).status);
    expect(state.calls.some(s=>s.includes("INSERT"))).toBe(false);
  });
});