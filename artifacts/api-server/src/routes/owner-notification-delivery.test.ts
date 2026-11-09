import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from "vitest";
import express from "express";
import {createECDH} from "node:crypto";
const state=vi.hoisted(()=>({role:"PLATFORM_OWNER",anonymous:false,queries:[] as Array<{sql:string;values?:any[]}>,
  saved:null as any,connect:vi.fn(),query:vi.fn()}));
vi.mock("@workspace/db",()=>({pool:{query:(...args:any[])=>state.query(...args),connect:()=>state.connect()}}));
vi.mock("../middlewares/auth",()=>({
  AuthError:class extends Error{constructor(readonly statusCode:number,message:string){super(message);}},
  getUserContext:()=>({user:{id:17,email:"fixture@example.invalid"},roles:[{role:state.role,status:"ACTIVE"}]}),
  requireAuthentication:()=> (_req:any,res:any,next:any)=>state.anonymous?res.status(401).end():next(),
}));
import router from "./owner-notification-delivery";
let server:any,url:string;
beforeAll(async()=>{
  const app=express();app.use(express.json());app.use(router);
  server=await new Promise<any>(resolve=>{const s=app.listen(0,"127.0.0.1",()=>resolve(s));});
  url=`http://127.0.0.1:${server.address().port}/communication/owner-delivery-controls`;
});
afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));vi.unstubAllEnvs();});
beforeEach(()=>{
  vi.stubEnv("NODE_ENV","development");vi.stubEnv("REPLIT_DEPLOYMENT","");
  vi.stubEnv("COMMUNICATION_SMS_PROVIDER","bulksmsnigeria");vi.stubEnv("BULKSMSNIGERIA_API_TOKEN","synthetic-only");
  vi.stubEnv("BULKSMSNIGERIA_SENDER_ID","FixtureSMS");
  const e=createECDH("prime256v1");e.generateKeys();
  vi.stubEnv("VAPID_PUBLIC_KEY",e.getPublicKey().toString("base64url"));vi.stubEnv("VAPID_PRIVATE_KEY",e.getPrivateKey().toString("base64url"));
  vi.stubEnv("VAPID_SUBJECT","mailto:fixture@example.invalid");
  state.role="PLATFORM_OWNER";state.anonymous=false;state.saved=null;state.queries=[];
  state.query.mockReset().mockImplementation(async(sql:string,values?:any[])=>{
    state.queries.push({sql,values});
    if(sql.includes("SELECT id,metadata,"))return {rows:state.saved&&state.saved.eventType===values?.[0]?[state.saved]:[]};
    if(sql.includes("INSERT INTO audit_logs"))state.saved={id:101,eventType:values![3],metadata:JSON.parse(values![2]),created_at:new Date()};
    return {rows:[]};
  });
  state.connect.mockReset().mockResolvedValue({query:state.query,release:vi.fn()});
});
const input=(extra:Record<string,unknown>={})=>({paused:true,smsEnabled:false,pushEnabled:false,telegramEnabled:false,
  pushParentIds:[],expectedVersion:0,reason:"Controlled fixture change",...extra});
const put=(body:unknown)=>fetch(url,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
describe("Owner-only notification delivery controls, no sends",()=>{
  it("exposes paused Production controls without inheriting Development activation",async()=>{
    vi.stubEnv("NODE_ENV","production");vi.stubEnv("REPLIT_DEPLOYMENT","1");
    state.saved={id:99,eventType:"DEVELOPMENT_DELIVERY_CONTROLS_UPDATED",
      metadata:{controls:{paused:false,smsEnabled:true,pushEnabled:true,telegramEnabled:true,pushParentIds:[17]},
        activatedAt:new Date().toISOString()}};
    const result=await fetch(url);
    expect(result.status).toBe(200);
    expect(((await result.json()) as {controls:unknown}).controls).toMatchObject({paused:true,smsEnabled:false,
      pushEnabled:false,telegramEnabled:false,pushParentIds:[],activatedAt:null,version:0});
    expect((await put(input())).status).toBe(200);
    expect(state.saved.eventType).toBe("PRODUCTION_DELIVERY_CONTROLS_UPDATED");
    expect(((await (await fetch(url)).json()) as {controls:unknown}).controls).toMatchObject({paused:true,version:101});
    state.role="PARTNER";expect((await fetch(url)).status).toBe(403);
    state.anonymous=true;expect((await fetch(url)).status).toBe(401);
  });
  it("GET is read-only and reports disabled defaults without contact or credential values",async()=>{
    const response=await fetch(url),data=await response.json() as any;
    expect(response.status).toBe(200);expect(data.controls.paused).toBe(true);
    expect(data.controls.pushEnabled).toBe(false);expect(data.candidates).toEqual([]);
    expect(state.queries.every(q=>q.sql.trim().startsWith("SELECT"))).toBe(true);
    expect(JSON.stringify(data)).not.toContain("synthetic-only");
  });
  it.each(["SCHOOL_ADMIN","PARENT","TEACHER"])("denies %s both reads and writes",async role=>{
    state.role=role;expect((await fetch(url)).status).toBe(403);expect((await put(input())).status).toBe(403);
    expect(state.queries).toEqual([]);
  });
  it("requires authentication",async()=>{state.anonymous=true;expect((await fetch(url)).status).toBe(401);});
  it("refuses Production without accessing data",async()=>{
    vi.stubEnv("REPLIT_DEPLOYMENT","1");
    expect((await put(input())).status).toBe(404);expect(state.queries).toEqual([]);
  });
  it("requires reason and current version; never invents a consenting push parent",async()=>{
    expect((await put(input({reason:""}))).status).toBe(400);
    expect((await put(input({pushEnabled:true}))).status).toBe(400);
    expect((await put(input({pushEnabled:true,pushParentIds:[99]}))).status).toBe(400);
    expect((await put(input({expectedVersion:99}))).status).toBe(409);
    expect(state.saved).toBeNull();
  });
  it("persists an actor-bound reasoned audit, but never starts a worker or calls a provider",async()=>{
    const response=await put(input({smsEnabled:true}));
    expect(response.status).toBe(200);
    const audit=state.queries.find(q=>q.sql.includes("INSERT INTO audit_logs"))!;
    expect(audit.values?.[0]).toBe(17);
    expect(state.saved.metadata.reason).toBe("Controlled fixture change");
    expect(state.saved.metadata.activatedAt).toMatch(/Z$/);
    expect(state.saved.metadata.controls.paused).toBe(true);
    expect(state.queries.some(q=>/UPDATE communication_deliveries|INSERT INTO communication_deliveries/.test(q.sql))).toBe(false);
  });
});
