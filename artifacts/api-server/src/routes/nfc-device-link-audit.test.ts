import express from "express";
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";

const state=vi.hoisted(()=>({
  role:"PLATFORM_OWNER",schoolId:1,
  queries:[] as Array<{sql:string;values:unknown[]}>,
  bindings:new Set<number>([1]),
}));
const db=vi.hoisted(()=>{
  const query=vi.fn(async(sql:string,values:unknown[]=[])=>{
    state.queries.push({sql,values});
    if(sql.includes("SELECT id,school_id") && sql.includes("FOR UPDATE")) {
      return {rows:Number(values[0])===501?[{id:501,schoolId:state.schoolId}]:[]};
    }
    if(sql.includes("UPDATE platform_devices SET school_id")) state.schoolId=Number(values[0]);
    if(sql.includes("INSERT INTO device_school_bindings")) state.bindings.add(Number(values[1]));
    if(sql.includes("FROM platform_devices d")) return {rows:[{id:501,schoolId:state.schoolId,status:"ACTIVE",configurationStatus:"CONFIGURED"}]};
    return {rows:[]};
  });
  return {query,connect:vi.fn(async()=>({query,release:vi.fn()}))};
});
vi.mock("@workspace/db",()=>({pool:db}));
vi.mock("../middlewares/auth",async original=>{
  const actual=await original<typeof import("../middlewares/auth")>();
  return {...actual,requireAuthentication:()=>(
    req:express.Request,_res:express.Response,next:express.NextFunction
  )=>{
    (req as any).edupulseUser={
      user:{id:12,clerkUserId:"clerk-device-audit-test",email:"fixture@example.test",firstName:"Fixture",lastName:"Owner",status:"ACTIVE"},
      roles:[{id:1,role:state.role,schoolId:state.role==="PLATFORM_OWNER"?null:1,status:"ACTIVE"}],
    };
    next();
  }};
});
import router from "./platform";
const app=express();
app.use(express.json());
app.use(router);
app.use((error:any,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  res.status(error.statusCode??500).json({error:error.message});
});
let server:ReturnType<typeof app.listen>;
let base="";
beforeAll(async()=>new Promise<void>(resolve=>{
  server=app.listen(0,"127.0.0.1",()=>{
    const address=server.address();
    if(address && typeof address!=="string") base=`http://127.0.0.1:${address.port}`;
    resolve();
  });
}));
afterAll(async()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())));
beforeEach(()=>{
  state.role="PLATFORM_OWNER";state.schoolId=1;
  state.queries.length=0;state.bindings=new Set([1]);
});
const link=(schoolId:number,deviceId=501)=>fetch(`${base}/platform/devices/${deviceId}/assign`,{
  method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({schoolId}),
});
describe("Owner NFC reader linking and audit",()=>{
  it("retains historical bindings but only one current school and audits both links",async()=>{
    expect((await link(2)).status).toBe(200);
    expect((await link(3)).status).toBe(200);
    expect(state.schoolId).toBe(3);
    expect([...state.bindings]).toEqual([1,2,3]);
    expect(state.queries.filter(q=>q.sql.includes("INSERT INTO audit_logs"))).toHaveLength(2);
    expect(state.queries.filter(q=>q.sql.includes("INSERT INTO audit_logs")).every(q=>q.values.includes("PLATFORM_DEVICE_CHANGED"))).toBe(true);
    expect(state.queries.some(q=>q.sql.includes("UPDATE device_credentials") && q.sql.includes("REVOKED"))).toBe(true);
  });
  it("does not let a School Admin change the reader-school relationship",async()=>{
    state.role="SCHOOL_ADMIN";
    expect((await link(2)).status).toBe(403);
    expect(state.queries.some(q=>q.sql.includes("UPDATE platform_devices"))).toBe(false);
  });
  it("rejects an unknown Device ID without assigning a reader",async()=>{
    expect((await link(2,999)).status).toBe(404);
    expect(state.schoolId).toBe(1);
  });
});
