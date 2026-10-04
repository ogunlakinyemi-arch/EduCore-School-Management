import express from "express";
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
const state=vi.hoisted(()=>({calls:[] as {sql:string;values:unknown[]}[],period:true,category:true}));
const db=vi.hoisted(()=>{
  const query=vi.fn(async(sql:string,values:unknown[]=[])=>{
    state.calls.push({sql,values});
    if(["BEGIN","COMMIT","ROLLBACK"].includes(sql)||sql.includes("INSERT INTO audit_logs")||sql.includes("INSERT INTO fee_structure_lines"))return{rows:[]};
    if(sql.includes("FROM academic_terms t JOIN school_classes c"))return{rows:state.period?[{}]:[]};
    if(sql.includes("COALESCE(MAX(version)"))return{rows:[{version:1}]};
    if(sql.includes("INSERT INTO fee_structures"))return{rows:[{id:91}]};
    if(sql.includes("SELECT name FROM fee_categories"))return{rows:state.category?[{name:"Tuition"}]:[]};
    if(sql.includes("FROM fee_structures fs LEFT JOIN"))return{rows:[{
      id:91,schoolId:1393,sessionId:358,termId:20,classId:571,section:"Science",version:1,status:"DRAFT",
      lines:[{categoryId:11,categoryName:"Tuition",description:"",amountMinor:800000}],
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
beforeEach(()=>{state.calls=[];state.period=true;state.category=true;});
const body={sessionId:358,termId:20,classId:571,section:"Science",lines:[{categoryId:11,amountMinor:800000,description:""}]};
const post=(payload:unknown=body,schoolId=1393,role="SCHOOL_ADMIN")=>fetch(`${url}/school/finance/structures?schoolId=${schoolId}`,
  {method:"POST",headers:{"Content-Type":"application/json","x-test-role":role},body:JSON.stringify(payload)});
describe("fee structure creation validation and School Admin authorization",()=>{
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