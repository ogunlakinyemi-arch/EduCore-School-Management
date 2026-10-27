import express from "express";
import type {Server} from "node:http";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const f=vi.hoisted(()=>({query:vi.fn(),connect:vi.fn(),adapter:vi.fn(),
  actor:{user:{id:9},roles:[{role:"TEACHER",schoolId:1,status:"ACTIVE"}]}}));
vi.mock("@workspace/db",()=>({pool:{query:f.query,connect:f.connect}}));
vi.mock("../lib/fee-providers/factory",()=>({
  configuredTestAdapter:f.adapter,configuredCheckoutReturnUrl:vi.fn(),
}));
vi.mock("../middlewares/auth",()=>({
  AuthError:class extends Error{constructor(public statusCode:number,message:string,public eventType?:string){super(message);}},
  requireAuthentication:()=> (_req:any,_res:any,next:any)=>next(),
  getUserContext:()=>f.actor,isPlatformOwner:()=>false,hasRole:()=>false,
  assertRoles:vi.fn(),assertSchoolAccess:vi.fn(),assertSchoolOperationalAccess:vi.fn(),
}));
import {staffNfcBillingRouter} from "./staff-nfc-billing";
let server:Server,origin:string;
beforeEach(async()=>{
  vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
  f.query.mockReset().mockResolvedValue({rows:[{id:8,schoolId:1,employeeNo:"FICTIONAL"}]});
  f.connect.mockReset();f.adapter.mockReset();
  const app=express();app.use(express.json());app.use("/api",staffNfcBillingRouter);
  server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
  origin=`http://127.0.0.1:${(server.address() as any).port}`;
});
afterEach(async()=>{vi.useRealTimers();await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));});
describe("free-term checkout denies before reservations or provider initialization",()=>{
  it("returns an explicit no-payment decision and makes no provider or write call",async()=>{
    const response=await fetch(`${origin}/api/staff-nfc/subscriptions/14/checkout?schoolId=1`,{
      method:"POST",headers:{"Idempotency-Key":"free_checkout_fixture","Content-Type":"application/json"},body:"{}",
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({code:"STAFF_FREE_ROLLOUT_NO_PAYMENT"});
    expect(f.adapter).not.toHaveBeenCalled();expect(f.connect).not.toHaveBeenCalled();
    expect(f.query.mock.calls.every(c=>String(c[0]).trim().startsWith("SELECT"))).toBe(true);
  });
  it("keeps neighboring-school scope masked as not found",async()=>{
    const response=await fetch(`${origin}/api/staff-nfc/subscriptions/14/checkout?schoolId=2`,{
      method:"POST",headers:{"Idempotency-Key":"free_checkout_fixture"},
    });
    expect(response.status).toBe(404);
    expect(f.query).not.toHaveBeenCalled();expect(f.adapter).not.toHaveBeenCalled();
  });
});
