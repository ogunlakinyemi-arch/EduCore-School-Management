import express from "express";
import { beforeAll,afterAll,beforeEach,describe,it,expect,vi } from "vitest";

const state=vi.hoisted(()=>({userId:912,schoolId:1393,role:"TEACHER",allowed:true,queries:[] as {sql:string;values:unknown[]}[]}));
vi.mock("@workspace/db",()=>({pool:{query:vi.fn(async(sql:string,values:unknown[]=[])=>{
  state.queries.push({sql,values});
  if(sql.includes("SELECT 1 WHERE"))return{rows:values[0]===721||values[0]===722?[{ok:1}]:[]};
  if(sql.includes("FROM students st JOIN student_class_assignments"))return{rows:[{id:721,admissionNo:"TEST",firstName:"Test",lastName:"Student",className:"JSS2",section:"A"}]};
  if(sql.includes("SELECT id FROM students"))return{rows:[{id:values[0]}]};
  if(sql.includes("FROM parent_student_relationships"))return{rows:values[0]===721?[{userId:914,firstName:"Test",lastName:"Guardian"}]:[]};
  return{rows:[]};
})}}));
vi.mock("../middlewares/auth",()=>({
  AuthError:class extends Error{constructor(public statusCode:number,message:string){super(message);}},
  getUserContext:()=>({user:{id:state.userId},roles:[{role:state.role,schoolId:state.schoolId,status:"ACTIVE"}]}),
  requireAuthentication:()=> (_req:unknown,_res:unknown,next:()=>void)=>next(),
  assertSchoolOperationalAccess:()=>{},
  handleAuthError:(e:any,_req:unknown,res:express.Response)=>res.status(e.statusCode??500).json({error:e.message}),
}));
vi.mock("../services/communication-service",()=>({queueCommunicationNotification:vi.fn()}));
import { createParentCommunicationRouter } from "./parent-communication";
let server:ReturnType<express.Express["listen"]>,base:string;
beforeAll(async()=>{
  const app=express();app.use(express.json());app.use("/api",createParentCommunicationRouter(async()=>{
    if(!state.allowed)throw Object.assign(Error("Permission denied"),{statusCode:404});
    return {} as never;
  }));
  await new Promise<void>(resolve=>{server=app.listen(0,"127.0.0.1",resolve);});
  const address=server.address();if(!address||typeof address==="string")throw Error("No server");
  base=`http://127.0.0.1:${address.port}/api`;
});
afterAll(()=>new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve())));
beforeEach(()=>{state.role="TEACHER";state.schoolId=1393;state.allowed=true;state.queries=[];});
describe("Communication student and guardian route boundaries",()=>{
  it("loads without search and scopes by actor ID, school, active current enrollment and assigned section",async()=>{
    const res=await fetch(`${base}/communication/students?schoolId=1393`);
    expect(res.status).toBe(200);expect((await res.json()).map((s:any)=>s.id)).toEqual([721]);
    const query=state.queries[0];expect(query.values).toEqual([1393,912,false,""]);
    for(const clause of ["sca.is_current=true","tca.academic_session_id=sca.academic_session_id","current_session.is_current=true",
      "tca.section='' OR tca.section=sca.section","teacher.user_id=$2","st.school_id=$1"])expect(query.sql).toContain(clause);
  });
  it("binds searches rather than interpolating them into SQL",async()=>{
    const search="' OR TRUE --";
    const res=await fetch(`${base}/communication/students?schoolId=1393&search=${encodeURIComponent(search)}`);
    expect(res.status).toBe(200);expect(state.queries[0].values[3]).toBe(search);
    expect(state.queries[0].sql).not.toContain(search);
  });
  it("returns only minimal linked guardian details after rechecking assignment",async()=>{
    const res=await fetch(`${base}/communication/students/721/guardians?schoolId=1393`);
    expect(res.status).toBe(200);expect(await res.json()).toEqual([{userId:914,firstName:"Test",lastName:"Guardian"}]);
    expect(state.queries[0].values).toEqual([721,1393,912]);
    expect(state.queries[2].sql).toContain("rel.status='ACTIVE'");
    expect(state.queries[2].sql).toContain("family_school_membership");
  });
  it("returns an empty guardian list for an authorized unlinked student, not Student not found",async()=>{
    const res=await fetch(`${base}/communication/students/722/guardians?schoolId=1393`);
    expect(res.status).toBe(200);expect(await res.json()).toEqual([]);
  });
  it("denies forged student IDs before querying any guardian relationships",async()=>{
    const res=await fetch(`${base}/communication/students/730/guardians?schoolId=1393`);
    expect(res.status).toBe(404);expect(state.queries).toHaveLength(1);
  });
  it("denies forged schools, unsupported roles, and revoked communication permission",async()=>{
    for(const config of [{school:999,role:"TEACHER",allowed:true},{school:1393,role:"PARENT",allowed:true},{school:1393,role:"TEACHER",allowed:false}]){
      state.role=config.role;state.allowed=config.allowed;
      const res=await fetch(`${base}/communication/students?schoolId=${config.school}`);
      expect(res.status).toBe(404);
    }
    expect(state.queries).toHaveLength(0);
  });
});
