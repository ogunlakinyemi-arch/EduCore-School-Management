import express from "express";
import type {Server} from "node:http";
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import type {GetOwnerFreeAcademicTermsResponse} from "@workspace/api-zod";
import type {z} from "zod";
type GetOwnerFreeAcademicTerms200=z.infer<typeof GetOwnerFreeAcademicTermsResponse>;
const s=vi.hoisted(()=>({role:"PLATFORM_OWNER",schoolId:null as number|null,query:vi.fn(),change:vi.fn(),
  grant:null as any,ready:true,locked:false,summary:null as any}));
vi.mock("@workspace/db",()=>({pool:{query:s.query}}));
vi.mock("../services/owner-free-academic-terms",()=>({
  changeFreeTermGrant:s.change,freeTermStorageReady:async()=>s.ready,readFreeTermGrant:async()=>s.grant,
}));
vi.mock("../services/subscription-enforcement",()=>({readSchoolSubscription:async()=>s.summary}));
vi.mock("../services/school-subscription-lock",()=>({readManualSchoolState:async()=>({schoolLocked:s.locked})}));
vi.mock("../middlewares/auth",async original=>{
  const actual=await original<typeof import("../middlewares/auth")>();
  return {...actual,requireAuthentication:()=> (req:any,_res:any,next:any)=>{
    if(s.role==="ANONYMOUS")return next(new actual.AuthError(401,"Sign in required"));
    req.edupulseUser={user:{id:7,status:"ACTIVE"},roles:[{role:s.role,status:"ACTIVE",schoolId:s.schoolId}]};
    next();
  }};
});
import {createOwnerFreeAcademicTermsRouter} from "./owner-free-academic-terms";
const terms=[
  {id:2,schoolId:1,sessionId:1,name:"Second Term",sessionName:"2026/2027",startDate:"2027-01-12",endDate:"2027-04-10",status:"ACTIVE",sessionStatus:"ACTIVE",isCurrent:true},
  {id:3,schoolId:1,sessionId:1,name:"Third Term",sessionName:"2026/2027",startDate:"2027-05-03",endDate:"2027-07-24",status:"ACTIVE",sessionStatus:"ACTIVE",isCurrent:false},
];
describe("Owner free-term HTTP boundary / fake identity and database",()=>{
  let server:Server,origin:string;
  beforeAll(async()=>{
    const app=express();app.use(express.json());app.use("/api",createOwnerFreeAcademicTermsRouter());
    app.use((e:any,_req:any,res:any,_next:any)=>res.status(e.statusCode??400).json({error:e.message}));
    server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));
    origin=`http://127.0.0.1:${(server.address() as any).port}/api/owner/free-academic-terms`;
  });
  afterAll(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
  beforeEach(()=>{
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2027-02-01T12:00:00Z"));
    vi.clearAllMocks();s.role="PLATFORM_OWNER";s.schoolId=null;s.grant=null;s.ready=true;s.locked=false;s.summary=null;
    s.query.mockImplementation(async(sql:string,args:any[])=>{
      if(sql==="SELECT id FROM schools WHERE id=$1")return{rows:args[0]===1?[{id:1}]:[]};
      if(sql.includes("FROM academic_terms"))return{rows:terms};
      if(sql.includes("FROM owner_free_academic_term_events"))return{rows:[{schoolId:args[0],reason:"Fixture history"}]};
      throw Error(`Unexpected SQL ${sql}`);
    });
    s.change.mockResolvedValue({schoolId:1,termId:2,action:"grant"});
  });
  afterAll(()=>vi.useRealTimers());
  const get=()=>fetch(`${origin}?schoolId=1`);
  const json=async(response:Response)=>await response.json() as GetOwnerFreeAcademicTerms200;
  const post=(body:any={confirmed:true},action="grant")=>fetch(`${origin}/${action}`,{
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  it.each(["ANONYMOUS","SCHOOL_ADMIN","ACCOUNTANT","TEACHER","STUDENT","PARENT","PARTNER"])("denies %s all-school reads and grants/suspensions",async role=>{
    s.role=role;s.schoolId=1;
    for(const request of [get,()=>post(),()=>post({},"suspend")])expect((await request()).status).toBe(role==="ANONYMOUS"?401:403);
    expect(s.query).not.toHaveBeenCalled();expect(s.change).not.toHaveBeenCalled();
  });
  it("rejects a school-scoped Owner role rather than granting global authority",async()=>{
    s.schoolId=1;expect((await get()).status).toBe(403);
  });
  it("selects the exact school, exposes saved term dates, and never labels unpaid coverage Paid",async()=>{
    const r=await get();expect(r.status).toBe(200);
    const body=await json(r);expect(body.terms[0]).toMatchObject({id:2,sessionId:1,startDate:"2027-01-12",status:"PAYMENT_REQUIRED",grantId:null});
    expect(s.query).toHaveBeenCalledWith(expect.stringContaining("WHERE t.school_id=$1"),[1]);
    expect(body.history[0].schoolId).toBe(1);
  });
  it.each(["TRIAL_GRANTED","ACTIVE","COMPLETED","SUSPENDED"])("returns grant state %s without reinterpreting it as Paid",async status=>{
    s.grant={id:4,status,calendarChanged:false};
    expect((await json(await get())).terms[0]).toMatchObject({status,grantId:4});
  });
  it("uses existing verified school coverage for Paid, while preserving manual suspension",async()=>{
    s.summary={termId:2,studentsTotal:3,studentsPaid:3};
    expect((await json(await get())).terms[0].status).toBe("PAID");
    s.locked=true;expect((await json(await get())).terms[0].status).toBe("SUSPENDED");
  });
  it("exposes unapplied storage as unavailable for writes, not as synthetic grants or history",async()=>{
    s.ready=false;const body=await json(await get());expect(body.ready).toBe(false);
    expect(body.history).toEqual([]);expect(body.terms[0].grantId).toBeNull();
  });
  it("uses the authenticated administrator, not an actor supplied by the client",async()=>{
    const body={schoolId:1,sessionId:1,termId:2,reason:"Reviewed sponsorship",confirmed:true};
    expect((await post(body)).status).toBe(200);
    expect(s.change).toHaveBeenCalledWith(expect.anything(),7,body,"grant");
  });
  it("rejects a nonexistent school or missing school and unsupported mutation actions",async()=>{
    expect((await fetch(`${origin}?schoolId=44`)).status).toBe(404);
    expect((await fetch(origin)).status).toBe(400);
    expect((await post({},"extend")).status).toBe(400);
    expect(s.change).not.toHaveBeenCalled();
  });
});
