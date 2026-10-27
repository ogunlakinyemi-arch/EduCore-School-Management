import express from "express";
import type {Server} from "node:http";
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
vi.mock("@workspace/db",()=>({pool:{connect:()=>{throw Error("Shared database forbidden");}}}));
vi.mock("../middlewares/auth",()=>{
  class AuthError extends Error{constructor(public statusCode:number,message:string){super(message)}}
  return {AuthError,getUserContext:(req:any)=>({user:{id:Number(req.header("x-actor")??1)}}),
    requireAuthentication:()=>(req:any,res:any,next:any)=>req.header("x-anonymous")?res.sendStatus(401):next()};
});
import {createSchoolBillingContextRouter} from "./flutterwave-school-billing";
let server:Server,url:string;
const env:NodeJS.ProcessEnv={};
const query=vi.fn(async(sql:string,values?:any[])=>({rows:sql.includes("SELECT bool_or")&&values?.[0]===1&&values?.[1]===10?[{admin:true}]:[]}));
const release=vi.fn(),connect=vi.fn(async()=>({query,release}));
beforeEach(async()=>{
  query.mockClear();release.mockClear();connect.mockClear();
  for(const key of Object.keys(env))delete env[key];
  const app=express();app.use(createSchoolBillingContextRouter({pool:{connect} as any,env}));
  await new Promise<void>(r=>{server=app.listen(0,"127.0.0.1",()=>r())});
  url=`http://127.0.0.1:${(server.address() as any).port}/flutterwave/live/billing-context`;
});
afterEach(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()))});
describe("authenticated school billing HTTP boundary without shared databases",()=>{
  it("rejects anonymous access and browser mode/identity overrides before database access",async()=>{
    expect((await fetch(`${url}?schoolId=10`,{headers:{"x-anonymous":"yes"}})).status).toBe(401);
    for(const suffix of ["&mode=LIVE","&studentId=1","&actorId=2","&reference=other"]){
      expect((await fetch(`${url}?schoolId=10${suffix}`)).status).toBe(400);
    }
    expect(connect).not.toHaveBeenCalled();
  });
  it("returns only server TEST context with no credential data, privately and without caching",async()=>{
    const response=await fetch(`${url}?schoolId=10`);
    expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({schoolId:10,actorId:1,mode:"TEST",reason:"TEST_RUNTIME",termId:null,termName:null,students:[]});
    expect(query.mock.calls.some(([sql])=>/INSERT|UPDATE|DELETE/.test(sql))).toBe(false);
  });
  it("rejects other schools and canonical non-admin/Owner identities",async()=>{
    expect((await fetch(`${url}?schoolId=20`)).status).toBe(403);
    expect((await fetch(`${url}?schoolId=10`,{headers:{"x-actor":"2"}})).status).toBe(403);
  });
  it("fails closed on incomplete LIVE release instead of exposing TEST context",async()=>{
    env.EDUCORE_FLUTTERWAVE_MODE="LIVE";
    const response=await fetch(`${url}?schoolId=10`);
    expect(await response.json()).toMatchObject({mode:"UNAVAILABLE",reason:"LIVE_RELEASE_UNAVAILABLE",students:[]});
  });
  it("uses only the mode selector despite stale legacy LIVE flags or release metadata",async()=>{
    env.EDUCORE_FLUTTERWAVE_MODE="TEST";
    env.EDUCORE_FLUTTERWAVE_LIVE_ENABLED="true";
    env.EDUCORE_FLUTTERWAVE_RELEASE="SCV3_V1";
    env.EDUCORE_FLUTTERWAVE_WEBHOOK_ENVIRONMENT="LIVE";
    expect(await (await fetch(`${url}?schoolId=10`)).json()).toMatchObject({mode:"TEST",reason:"TEST_RUNTIME"});
  });
  it.each(["live","", "INVALID", " LIVE"])("invalid mode %s cannot select either payment runtime",async mode=>{
    env.EDUCORE_FLUTTERWAVE_MODE=mode;
    expect(await (await fetch(`${url}?schoolId=10`)).json()).toMatchObject({mode:"UNAVAILABLE",students:[]});
  });
});
