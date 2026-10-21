import express from "express";
import type {Server} from "node:http";
import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from "vitest";
const h=vi.hoisted(()=>({role:"SCHOOL_ADMIN",schoolId:9,status:"ACTIVE",anonymous:false,policy:null as any,
  defaults:{} as Record<string,string[]>,writes:[] as any[]}));
vi.mock("@workspace/db",()=>{
  const query=vi.fn(async(sql:string,values?:unknown[])=>{
    if(sql.includes("FROM audit_logs"))return {rows:h.policy?[{policy:h.policy}]:[]};
    if(sql.includes("SELECT communication_defaults"))return {rows:[{defaults:h.defaults}]};
    if(sql.includes("UPDATE schools")){h.defaults=JSON.parse(String(values?.[1]));h.writes.push({sql,values});}
    if(sql.includes("INSERT INTO audit_logs")){
      h.writes.push({sql,values});
      if(sql.includes("GLOBAL_CHANNEL_POLICY_UPDATED"))h.policy=JSON.parse(String(values?.[2])).policy;
    }
    return {rows:[]};
  });
  return {pool:{query,connect:async()=>({query,release:vi.fn()})}};
});
vi.mock("../services/telegram-provider",()=>({
  getTelegramHealth:()=>({ready:false,status:"DEVELOPMENT_ONLY"}),
}));
vi.mock("../middlewares/auth",async original=>{
  const actual=await original<typeof import("../middlewares/auth")>();
  const ctx=()=>({user:{id:17,email:"fictional@example.invalid"},roles:[{role:h.role,schoolId:h.schoolId,status:h.status}]});
  return {...actual,requireAuthentication:()=> (_req:any,res:any,next:any)=>h.anonymous?res.status(401).json({error:"Authentication required"}):next(),
    getUserContext:()=>ctx(),assertSchoolAccess:(_req:any,id:number)=>{
      if(h.status!=="ACTIVE"||!["SCHOOL_ADMIN","PLATFORM_OWNER"].includes(h.role)||(h.role!=="PLATFORM_OWNER"&&id!==h.schoolId))
        throw new actual.AuthError(403,"School access denied");
      return ctx();
    }};
});
import router from "./communication-policy";
import {defaultNotificationPolicy} from "../services/notification-channel-policy";
let server:Server,base:string;
beforeAll(async()=>{
  const app=express();app.use(express.json());app.use(router);
  await new Promise<void>(r=>{server=app.listen(0,"127.0.0.1",()=>r());});
  const address=server.address();if(!address||typeof address==="string")throw new Error("No fixture port");
  base=`http://127.0.0.1:${address.port}`;
});
afterAll(async()=>{await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));});
beforeEach(()=>{h.role="SCHOOL_ADMIN";h.schoolId=9;h.status="ACTIVE";h.anonymous=false;h.policy=null;h.defaults={};h.writes=[];});
const put=(url:string,body:unknown)=>fetch(base+url,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
describe("Owner/school channel policy HTTP boundaries; no delivery",()=>{
  it.each(["SCHOOL_ADMIN","TEACHER","STAFF","PARENT","STUDENT"])("%s cannot edit global policy",async role=>{
    h.role=role;expect((await put("/communication/channel-policy",defaultNotificationPolicy())).status).toBe(403);
    expect(h.writes).toHaveLength(0);
  });
  it("requires authentication and active Owner role",async()=>{
    h.anonymous=true;expect((await fetch(base+"/communication/channel-policy")).status).toBe(401);
    h.anonymous=false;h.role="PLATFORM_OWNER";h.status="INACTIVE";
    expect((await put("/communication/channel-policy",defaultNotificationPolicy())).status).toBe(403);
  });
  it("Owner saves a durable audited category and school restriction without sending",async()=>{
    h.role="PLATFORM_OWNER";const p=defaultNotificationPolicy();
    p.events.SUBSCRIPTION!.allowed.push("SMS");p.schools["9"]={enabled:true,allowed:["IN_APP"]};
    const r=await put("/communication/channel-policy",p);expect(r.status).toBe(200);
    const restored=await (await fetch(base+"/communication/channel-policy")).json() as {policy:unknown};
    expect(restored.policy).toEqual(p);
    expect(h.writes).toHaveLength(1);expect(h.writes[0].sql).toContain("GLOBAL_CHANNEL_POLICY_UPDATED");
  });
  it("Owner may permit unavailable Telegram globally and for an opted-in school without delivering messages",async()=>{
    h.role="PLATFORM_OWNER";
    const p=defaultNotificationPolicy();
    for(const rule of Object.values(p.events))rule!.allowed.push("TELEGRAM");
    p.schools["9"]={enabled:true,allowed:["IN_APP","TELEGRAM"]};
    const r=await put("/communication/channel-policy",p);
    expect(r.status).toBe(200);
    expect((await r.json() as {policy:typeof p}).policy).toEqual(p);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0].sql).toContain("GLOBAL_CHANNEL_POLICY_UPDATED");
    expect(h.writes.some(write=>/communication_deliveries|outbox|messages/i.test(write.sql))).toBe(false);
  });
  it("rejects setting unavailable Telegram as a default",async()=>{
    h.role="PLATFORM_OWNER";
    const p=defaultNotificationPolicy();
    p.events.FINANCE!.allowed.push("TELEGRAM");
    p.events.FINANCE!.defaults.push("TELEGRAM");
    const r=await put("/communication/channel-policy",p);
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({code:"UNAVAILABLE_DEFAULT"});
    expect(h.writes).toHaveLength(0);
  });
  it("rejects a new school Telegram override until the global policy allows it",async()=>{
    h.role="PLATFORM_OWNER";
    const p=defaultNotificationPolicy();
    p.schools["9"]={enabled:true,allowed:["IN_APP","TELEGRAM"]};
    const rejected=await put("/communication/channel-policy",p);
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toMatchObject({code:"OVERRIDE_NOT_GLOBALLY_ALLOWED"});
    expect(h.writes).toHaveLength(0);
    p.events.FINANCE!.allowed.push("TELEGRAM");
    const accepted=await put("/communication/channel-policy",p);
    expect(accepted.status).toBe(200);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0].sql).toContain("GLOBAL_CHANNEL_POLICY_UPDATED");
  });
  it("School Admin cannot select SMS for reminders or unavailable channels",async()=>{
    expect((await put("/communication/schools/9/defaults",{SUBSCRIPTION:["SMS"]})).status).toBe(403);
    expect((await put("/communication/schools/9/defaults",{ATTENDANCE_ENTRY:["PUSH"]})).status).toBe(403);
    expect(h.writes).toHaveLength(0);
  });
  it("school delivery defaults still reject Telegram when Owner permits it globally",async()=>{
    const p=defaultNotificationPolicy();
    p.events.ATTENDANCE_ENTRY!.allowed.push("TELEGRAM");
    h.policy=p;
    expect((await put("/communication/schools/9/defaults",{ATTENDANCE_ENTRY:["TELEGRAM"]})).status).toBe(403);
    expect(h.writes).toHaveLength(0);
  });
  it("school choices are tenant-bound, audited and constrained by Owner",async()=>{
    expect((await put("/communication/schools/10/defaults",{ATTENDANCE_ENTRY:["IN_APP"]})).status).toBe(403);
    expect((await put("/communication/schools/9/defaults",{ATTENDANCE_ENTRY:["IN_APP"],ATTENDANCE_EXIT:[]})).status).toBe(200);
    const r=await fetch(base+"/communication/schools/9/defaults");
    expect((await r.json() as {defaults:unknown}).defaults).toEqual({ATTENDANCE_ENTRY:["IN_APP"],ATTENDANCE_EXIT:[]});
    expect(h.writes).toHaveLength(2);
    const p=defaultNotificationPolicy();p.schools["9"]={enabled:false,allowed:[]};h.policy=p;
    expect((await put("/communication/schools/9/defaults",{ATTENDANCE_ENTRY:["IN_APP"]})).status).toBe(403);
  });
  it("Owner governance does not grant write access to ordinary school defaults",async()=>{
    h.role="PLATFORM_OWNER";
    expect((await put("/communication/schools/9/defaults",{ATTENDANCE_ENTRY:["IN_APP"]})).status).toBe(403);
    expect(h.writes).toHaveLength(0);
  });
  it("rejects defaults not allowed by the global policy",async()=>{
    h.role="PLATFORM_OWNER";const p=defaultNotificationPolicy();p.events.SUBSCRIPTION!.defaults=["SMS"];
    expect((await put("/communication/channel-policy",p)).status).toBe(400);
    expect(h.writes).toHaveLength(0);
  });
});
