import express from "express";
import type {Server} from "node:http";
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";

const fixture=vi.hoisted(()=>({
 role:"PLATFORM_OWNER",status:"ACTIVE",schoolId:null as number|null,
 query:vi.fn(),read:vi.fn(),permission:vi.fn(),preview:vi.fn(),dispatch:vi.fn(),
}));
vi.mock("@workspace/db",()=>({pool:{query:fixture.query}}));
// Fake only the external session verifier; exercise the application's real
// requireAuthentication/loadUserContext/assertRoles cookie-session boundary.
vi.mock("@clerk/express",()=>({
 getAuth:(req:any)=>req.headers.cookie==="__session=fictional-owner-session"
  ?{userId:"fixture_clerk_owner",sessionId:"fixture_session"}:{userId:null,sessionId:null},
 clerkClient:{users:{getUser:vi.fn(()=>{throw Error("External identity access forbidden");})}},
}));
vi.mock("../services/subscription-request-access",()=>({enforceRequestSubscription:vi.fn()}));
vi.mock("../services/partner-account-reapplication",()=>({resolveReapplicationUser:async()=>null}));
vi.mock("../services/test-account-archive-access",()=>({assertTestArchiveAccess:async()=>{}}));
vi.mock("../services/bro-field-sms",()=>({
 readFieldSms:fixture.read,recordFieldPermission:fixture.permission,
 previewFieldSms:fixture.preview,dispatchFieldSms:fixture.dispatch,
}));
import {createFieldSmsRouter} from "./bro-field-sms";
import {AuthError} from "../middlewares/auth";
const cookie={cookie:"__session=fictional-owner-session"};
const campaign={id:4,digest:"a".repeat(64),message:"Fictional school reminder",
 createdAt:"2026-11-23T12:00:00.000Z",createdBy:17,
 recipients:[{leadId:2,schoolName:"Fictional visited school",phone:"2348031111111",state:"REQUESTED"}]};
describe("Field SMS real application authentication boundary / no-network fixture",()=>{
 let server:Server,url:string;
 beforeAll(async()=>{
  const app=express();app.use(express.json());app.use("/api",createFieldSmsRouter());
  app.use((e:any,_req:any,res:any,_next:any)=>res.status(e instanceof AuthError?e.statusCode:500).json({error:e.message}));
  server=app.listen(0,"127.0.0.1");
  await new Promise<void>(resolve=>server.once("listening",resolve));
  url=`http://127.0.0.1:${(server.address() as any).port}/api/bro-field/sms`;
 });
 afterAll(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
 beforeEach(()=>{
  vi.clearAllMocks();fixture.role="PLATFORM_OWNER";fixture.status="ACTIVE";fixture.schoolId=null;
  fixture.query.mockImplementation(async(sql:string)=>{
   if(sql.includes("FROM app_users WHERE clerk_user_id"))return {rows:[{
    id:17,clerkUserId:"fixture_clerk_owner",email:"owner@example.invalid",status:fixture.status,
   }]};
   if(sql.includes("FROM account_applications"))return {rows:[]};
   if(sql.includes("FROM school_memberships sm"))return {rows:[{
    id:1,role:fixture.role,status:"ACTIVE",schoolId:fixture.schoolId,
   }]};
   throw Error(`Unexpected fixture SQL: ${sql}`);
  });
  fixture.read.mockResolvedValue({leads:[],campaigns:[],blockedReason:null});
  fixture.permission.mockResolvedValue({leadId:2,allowed:true});
  fixture.preview.mockResolvedValue(campaign);fixture.dispatch.mockResolvedValue(campaign);
 });
 const post=(path:string,body:unknown,authenticated=true)=>fetch(url+path,{
  method:"POST",headers:{"content-type":"application/json",...(authenticated?cookie:{})},body:JSON.stringify(body),
 });
 const previewBody={message:campaign.message,key:"fictional_preview_key_123",all:false,leadIds:[2]};
 it("does not cache a missing-cookie 401 or call any SMS service",async()=>{
  const res=await fetch(url);expect(res.status).toBe(401);
  expect(res.headers.get("cache-control")).toBe("private, no-store");
  expect(fixture.read).not.toHaveBeenCalled();expect(fixture.dispatch).not.toHaveBeenCalled();
 });
 it("uses the replacement cookie session after a prior 401",async()=>{
  expect((await fetch(url)).status).toBe(401);
  const res=await fetch(url,{headers:cookie});expect(res.status).toBe(200);
  expect(fixture.read).toHaveBeenCalledWith(expect.anything(),17,expect.anything());
 });
 it.each(["PARTNER","SCHOOL_ADMIN","ACCOUNTANT","TEACHER","PARENT","STUDENT"])("rejects authenticated %s",async role=>{
  fixture.role=role;expect((await fetch(url,{headers:cookie})).status).toBe(403);
  expect((await post("/preview",previewBody)).status).toBe(403);
  expect((await post("/4/dispatch",{digest:campaign.digest,confirm:true})).status).toBe(403);
  expect(fixture.read).not.toHaveBeenCalled();expect(fixture.preview).not.toHaveBeenCalled();
  expect(fixture.dispatch).not.toHaveBeenCalled();
 });
 it("rejects a school-scoped Owner and an inactive account",async()=>{
  fixture.schoolId=1;expect((await fetch(url,{headers:cookie})).status).toBe(403);
  fixture.schoolId=null;fixture.status="INACTIVE";
  expect((await fetch(url,{headers:cookie})).status).toBe(403);
 });
 it("keeps selection/preview separate from consent and sending",async()=>{
  expect((await post("/preview",previewBody)).status).toBe(200);
  expect(fixture.preview).toHaveBeenCalledWith(expect.anything(),17,previewBody);
  expect(fixture.permission).not.toHaveBeenCalled();expect(fixture.dispatch).not.toHaveBeenCalled();
 });
 it("accepts explicit multi-selection and derives sender from the cookie session",async()=>{
  const data={...previewBody,leadIds:[2,3]};
  expect((await post("/preview",data)).status).toBe(200);
  expect(fixture.preview).toHaveBeenCalledWith(expect.anything(),17,data);
 });
 it("records permission only through the explicit reason-bearing endpoint",async()=>{
  expect((await post("/permission",{leadId:2,allowed:true,reason:"Verified verbal permission on school visit"})).status).toBe(200);
  expect(fixture.permission).toHaveBeenCalledWith(expect.anything(),17,2,true,"Verified verbal permission on school visit");
  expect(fixture.dispatch).not.toHaveBeenCalled();
 });
 it("rejects dispatch without explicit confirmation",async()=>{
  expect((await post("/4/dispatch",{digest:campaign.digest})).status).toBe(400);
  expect(fixture.dispatch).not.toHaveBeenCalled();
 });
 it("passes only server-authenticated sender, frozen digest and explicit confirmation",async()=>{
  expect((await post("/4/dispatch",{digest:campaign.digest,confirm:true})).status).toBe(200);
  expect(fixture.dispatch).toHaveBeenCalledWith(expect.anything(),17,4,campaign.digest,true,expect.anything());
 });
 it("reports absent storage as 503 rather than a fabricated session failure",async()=>{
  fixture.read.mockRejectedValue(Object.assign(new Error("missing table"),{code:"42P01"}));
  const res=await fetch(url,{headers:cookie});expect(res.status).toBe(503);
  expect(await res.json()).toEqual({error:"CURRENT_FINANCIAL_SCHEMA_NOT_APPLIED"});
 });
});
