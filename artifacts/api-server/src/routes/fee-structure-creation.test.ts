import express from "express";
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
vi.mock("../lib/student-nfc-obligations",async original=>{
  const actual=await original<typeof import("../lib/student-nfc-obligations")>();
  return{...actual,ensureClassNfcSubscriptions:vi.fn(async()=>undefined)};
});
const state=vi.hoisted(()=>({calls:[] as {sql:string;values:unknown[]}[],period:true,category:true,nfcExisting:false}));
const db=vi.hoisted(()=>{
  const query=vi.fn(async(sql:string,values:unknown[]=[])=>{
    state.calls.push({sql,values});
    if(["BEGIN","COMMIT","ROLLBACK"].includes(sql)||sql.includes("INSERT INTO audit_logs")||sql.includes("INSERT INTO fee_structure_lines"))return{rows:[]};
    if(sql.includes("FROM academic_terms t JOIN school_classes c"))return{rows:state.period?[{}]:[]};
    if(sql.includes("COALESCE(MAX(version)"))return{rows:[{version:1}]};
    if(sql.includes("INSERT INTO fee_structures"))return{rows:[{id:91}]};
    if(sql.includes("pg_advisory_xact_lock"))return{rows:[]};
    if(sql.includes("SELECT id,status FROM fee_categories"))return{rows:state.nfcExisting?[{id:50,status:"ACTIVE"}]:[]};
    if(sql.includes("INSERT INTO fee_categories"))return{rows:[{id:50,status:"ACTIVE"}]};
    if(sql.includes("SELECT name FROM fee_categories"))return{rows:state.category?[{name:values[0]===50?"School NFC Subscription Fee":"Tuition"}]:[]};
    if(sql.includes("FROM fee_structures fs LEFT JOIN"))return{rows:[{
      id:91,schoolId:1393,sessionId:358,termId:20,classId:571,section:"Science",version:1,status:"DRAFT",
      lines:state.calls.filter(c=>c.sql.includes("INSERT INTO fee_structure_lines")).map(c=>({
        categoryId:c.values[2],categoryName:c.values[3],description:c.values[4],amountMinor:c.values[5],
      })),
    }]};
    throw Error(`Unhandled focused structure query: ${sql}`);
  });
  return{query,connect:vi.fn(async()=>({query,release:vi.fn()}))};
});
vi.mock("@workspace/db",()=>({pool:db}));
vi.mock("../middlewares/auth",async original=>{
  const actual=await original<typeof import("../middlewares/auth")>();
  return{...actual,requireAuthentication:()=> (req:express.Request,_res:express.Response,next:express.NextFunction)=>{
    (req as any).edupulseUser={user:{id:20,clerkUserId:"verified-test",email:"admin@example.test",firstName:"Test",lastName:"Admin",status:"ACTIVE"},
      roles:[{id:1,role:req.header("x-test-role")??"SCHOOL_ADMIN",schoolId:1393,status:"ACTIVE"}]};next();
  }};
});
import router from "./finance";
const app=express();app.use(express.json());app.use(router);
let server:ReturnType<typeof app.listen>,url:string;
beforeAll(async()=>{await new Promise<void>(resolve=>{server=app.listen(0,"127.0.0.1",()=>resolve());});
  url=`http://127.0.0.1:${(server.address() as {port:number}).port}`;});
afterAll(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
beforeEach(()=>{state.calls=[];state.period=true;state.category=true;state.nfcExisting=false;});
const body={sessionId:358,termId:20,classId:571,section:"Science",lines:[{categoryId:11,amountMinor:800000,description:""}]};
const post=(payload:unknown=body,schoolId=1393,role="SCHOOL_ADMIN")=>fetch(`${url}/school/finance/structures?schoolId=${schoolId}`,
  {method:"POST",headers:{"Content-Type":"application/json","x-test-role":role},body:JSON.stringify(payload)});
describe("fee structure creation validation and School Admin authorization",()=>{
  it("creates the built-in school NFC category and a draft from an explicit positive school amount, without invoices",async()=>{
    const response=await post({...body,lines:[{builtInCategory:"SCHOOL_NFC",amountMinor:725000}]});
    expect(response.status,await response.clone().text()).toBe(201);
    expect(await response.json()).toMatchObject({status:"DRAFT",lines:[{
      categoryId:50,categoryName:"School NFC Subscription Fee",amountMinor:725000,
    }]});
    expect(state.calls.find(c=>c.sql.includes("INSERT INTO fee_categories"))?.values.slice(0,2))
      .toEqual([1393,"School NFC Subscription Fee"]);
    expect(state.calls.some(c=>/INSERT INTO fee_invoices|UPDATE fee_invoices|flutterwave/i.test(c.sql))).toBe(false);
    expect(state.calls.some(c=>c.sql==="COMMIT")).toBe(true);
  });
  it("reuses the existing school NFC category and retains its records on later drafts",async()=>{
    state.nfcExisting=true;
    expect((await post({...body,lines:[{builtInCategory:"SCHOOL_NFC",amountMinor:150000}]})).status).toBe(201);
    expect(state.calls.some(c=>/INSERT INTO fee_categories|UPDATE fee_categories|DELETE/i.test(c.sql))).toBe(false);
  });
  it.each([undefined,null,0,-1])("blocks a missing/nonpositive built-in school amount %s without writing a category or draft",async amountMinor=>{
    expect((await post({...body,lines:[{builtInCategory:"SCHOOL_NFC",amountMinor}]})).status).toBe(400);
    expect(state.calls.some(c=>/INSERT INTO fee_categories|INSERT INTO fee_structures/.test(c.sql))).toBe(false);
  });
  it("does not allow School Admin to create the built-in category manually",async()=>{
    const response=await fetch(`${url}/school/finance/categories?schoolId=1393`,{method:"POST",
      headers:{"Content-Type":"application/json"},body:JSON.stringify({name:"School NFC Subscription Fee",compulsory:true})});
    expect(response.status).toBe(403);
    expect(state.calls.some(c=>c.sql.includes("INSERT INTO fee_categories"))).toBe(false);
  });
  it("creates a valid draft atomically with the validated category",async()=>{
    const response=await post();expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({schoolId:1393,status:"DRAFT",lines:[{amountMinor:800000}]});
    expect(state.calls.some(c=>c.sql==="COMMIT")).toBe(true);
  });
  it.each([0,-1,2147483648])("rejects invalid amount %s before inserting",async(amountMinor)=>{
    expect((await post({...body,lines:[{categoryId:11,amountMinor}]})).status).toBe(400);
    expect(state.calls.some(c=>c.sql.includes("INSERT INTO fee_structures"))).toBe(false);
  });
  it("rejects a duplicate category",async()=>{
    expect((await post({...body,lines:[body.lines[0],body.lines[0]]})).status).toBe(400);
    expect(state.calls.some(c=>c.sql==="COMMIT")).toBe(false);
  });
  it("rejects a class/term/session relationship outside the requested school",async()=>{
    state.period=false;expect((await post()).status).toBe(404);
    expect(state.calls.some(c=>c.sql.includes("INSERT INTO fee_structures"))).toBe(false);
  });
  it("rolls back when the category is inactive or absent",async()=>{
    state.category=false;expect((await post()).status).toBe(404);
    expect(state.calls.some(c=>c.sql==="ROLLBACK")).toBe(true);expect(state.calls.some(c=>c.sql==="COMMIT")).toBe(false);
  });
  it("rejects a different school's request",async()=>{
    expect((await post(body,1)).status).toBe(404);
    expect(state.calls.some(c=>c.sql.includes("INSERT INTO fee_structures"))).toBe(false);
  });
  it.each(["ACCOUNTANT","TEACHER","PLATFORM_OWNER"])("does not authorize %s to create",async(role)=>{
    expect([403,404]).toContain((await post(body,1393,role)).status);
    expect(state.calls.some(c=>c.sql.includes("INSERT INTO fee_structures"))).toBe(false);
  });
});