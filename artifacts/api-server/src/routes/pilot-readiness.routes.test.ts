import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import express from "express";
import type {Server} from "node:http";
const f=vi.hoisted(()=>({actor:null as any,probe:vi.fn(),calendars:vi.fn()}));
vi.mock("@workspace/db",()=>({pool:{totalCount:2,idleCount:1,waitingCount:0,
  targetDiagnostic:{targetFingerprint:"configuration-only"}}}));
vi.mock("../middlewares/auth",()=>({
  requireAuthentication:()=> (_req:any,res:any,next:any)=>f.actor?next():res.status(401).json({error:"AUTHENTICATION_REQUIRED"}),
  getUserContext:()=>f.actor,
}));
vi.mock("../services/database-readiness",()=>({databaseReadiness:f.probe}));
vi.mock("../services/pilot-readiness",()=>({readPilotCalendars:f.calendars}));
import router from "./pilot-readiness";
import health from "./health";
let server:Server;
let origin:string;
beforeEach(async()=>{
  f.actor=null;f.probe.mockReset().mockResolvedValue({ready:true});
  f.calendars.mockReset().mockResolvedValue([]);
  const app=express();app.use("/api",router);app.use("/api",health);
  server=app.listen(0,"127.0.0.1");
  await new Promise<void>(r=>server.once("listening",r));
  origin=`http://127.0.0.1:${(server.address() as any).port}`;
});
afterEach(()=>new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve())));
describe("read-only readiness route boundaries",()=>{
  it("requires authentication before touching the database",async()=>{
    expect((await fetch(`${origin}/api/platform/pilot-readiness`)).status).toBe(401);
    expect(f.probe).not.toHaveBeenCalled();
  });
  it.each(["SCHOOL_ADMIN","TEACHER","PARENT","COMPANY_ACCOUNTANT"])("denies %s before database access",async(role)=>{
    f.actor={user:{status:"ACTIVE"},roles:[{role,status:"ACTIVE",schoolId:1}]};
    expect((await fetch(`${origin}/api/platform/pilot-readiness`)).status).toBe(403);
    expect(f.probe).not.toHaveBeenCalled();
    expect(f.calendars).not.toHaveBeenCalled();
  });
  it("gives a global Owner calendar evidence but never certifies Production authorization",async()=>{
    f.actor={user:{status:"ACTIVE"},roles:[{role:"PLATFORM_OWNER",schoolId:null,status:"ACTIVE"}]};
    const response=await fetch(`${origin}/api/platform/pilot-readiness`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      productionChangeAllowed:false,targetBindingVerified:false,recoveryVerified:false,calendars:[],
    });
  });
  it("keeps liveness independent and shares a bounded failing readiness probe",async()=>{
    expect((await fetch(`${origin}/api/healthz`)).status).toBe(200);
    expect(f.probe).not.toHaveBeenCalled();
    f.probe.mockResolvedValue({ready:false,category:"CONNECT_TIMEOUT"});
    const response=await fetch(`${origin}/api/readyz`);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ready:false,dependency:"database"});
    expect((await fetch(`${origin}/api/readyz`)).status).toBe(503);
    expect(f.probe).toHaveBeenCalledOnce();
  });
});
