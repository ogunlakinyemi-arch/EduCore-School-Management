import express from "express";
import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from "vitest";
const state=vi.hoisted(()=>({role:"PLATFORM_OWNER",card:{id:5,school_id:2,student_id:3 as number|null,uid:"AABBCCDD",status:"active",replaced_by_card_id:null as number|null}}));
const mocks=vi.hoisted(()=>({assign:vi.fn(),revoke:vi.fn(),request:vi.fn(),issue:vi.fn()}));
vi.mock("@workspace/db",()=>({pool:{query:async()=>({rows:[state.card]})}}));
vi.mock("../middlewares/auth",()=>({
  AuthError:class extends Error{constructor(public statusCode:number,message:string){super(message);}},
  requireAuthentication:()=> (_q:any,_s:any,n:any)=>n(),
  assertRoles:()=>{if(state.role!=="PLATFORM_OWNER")throw Object.assign(new Error("Forbidden"),{statusCode:403});},
  getUserContext:()=>({user:{id:9}}),
}));
vi.mock("../services/uid-inventory-assignment",()=>({assignCapturedUid:mocks.assign}));
vi.mock("../services/school-security-core-service",()=>({markSecurityCardLost:mocks.revoke}));
vi.mock("../services/student-card-replacement",()=>({requestReplacement:mocks.request,issueReplacement:mocks.issue}));
import router from "./uid-inventory-assignment";
let server:any,base="";
beforeAll(async()=>{
  const app=express();app.use(express.json());app.use(router);
  app.use((e:any,_q:any,s:any,_n:any)=>s.status(e.statusCode??500).json({error:e.message}));
  await new Promise<void>(r=>{server=app.listen(0,"127.0.0.1",()=>r());});
  base=`http://127.0.0.1:${server.address().port}`;
});
afterAll(()=>new Promise<void>(r=>server.close(()=>r())));
beforeEach(()=>{
  vi.clearAllMocks();state.role="PLATFORM_OWNER";state.card={id:5,school_id:2,student_id:3,uid:"AABBCCDD",status:"active",replaced_by_card_id:null};
  mocks.assign.mockResolvedValue({cardId:7});mocks.request.mockResolvedValue({id:11,status:"REQUESTED"});mocks.issue.mockResolvedValue({status:"ISSUED"});
});
const post=(path:string,body:unknown)=>fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
describe("Owner confirmed UID assignment/replacement API",()=>{
  it("requires confirmation before assignment",async()=>{
    expect((await post("/platform/uid-inventory/assign",{uid:"AABBCCDD",schoolId:2,studentId:3})).status).toBe(400);
    expect(mocks.assign).not.toHaveBeenCalled();
  });
  it("sends server-selected school/student and UID through transactional service",async()=>{
    expect((await post("/platform/uid-inventory/assign",{uid:"AABBCCDD",schoolId:2,studentId:3,confirm:true})).status).toBe(201);
    expect(mocks.assign).toHaveBeenCalledWith(expect.anything(),2,3,"AABBCCDD");
  });
  it.each(["LOST","DAMAGED"])("explicitly revokes %s before requesting an invoice and retains reason",async kind=>{
    expect((await post("/platform/uid-inventory/cards/5/unlink",{kind,reason:"Physical card issue",confirm:true})).status).toBe(200);
    expect(mocks.revoke).toHaveBeenCalledWith(expect.anything(),2,5,`${kind}: Physical card issue`,3);
    expect(mocks.request).toHaveBeenCalledWith(expect.anything(),5,`${kind}: Physical card issue`);
    expect(mocks.revoke.mock.invocationCallOrder[0]).toBeLessThan(mocks.request.mock.invocationCallOrder[0]!);
  });
  it.each([{kind:"LOST",reason:" ",confirm:true},{kind:"DAMAGED",reason:"Broken"},{kind:"UNKNOWN",reason:"Broken",confirm:true}])("rejects missing reason/confirmation/kind %j",async body=>{
    expect((await post("/platform/uid-inventory/cards/5/unlink",body)).status).toBe(400);
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it("does not pretend a revoked card remains usable after invoice failure",async()=>{
    mocks.request.mockRejectedValue(Object.assign(new Error("Card revoked; configure finance period"),{statusCode:409}));
    expect((await post("/platform/uid-inventory/cards/5/unlink",{kind:"LOST",reason:"Missing card",confirm:true})).status).toBe(409);
    expect(mocks.revoke).toHaveBeenCalled();
  });
  it("retains employee School Admin request/payment authority",async()=>{
    state.card.student_id=null;
    const response=await post("/platform/uid-inventory/cards/5/unlink",{kind:"DAMAGED",reason:"Chip broken",confirm:true});
    expect(await response.json()).toMatchObject({requiresSchoolAdminRequest:true,status:"lost"});
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("uses existing paid issuance service in strict captured-inventory mode",async()=>{
    expect((await post("/platform/uid-inventory/replacements/11/issue",{uid:"11223344",confirm:true})).status).toBe(200);
    expect(mocks.issue).toHaveBeenCalledWith(expect.anything(),11,"11223344",true);
  });
  it.each(["TEACHER","SCHOOL_ADMIN","PARENT"])("denies %s",async role=>{
    state.role=role;
    expect((await post("/platform/uid-inventory/assign",{uid:"AABBCCDD",schoolId:2,studentId:3,confirm:true})).status).toBe(403);
    expect(mocks.assign).not.toHaveBeenCalled();
  });
});
