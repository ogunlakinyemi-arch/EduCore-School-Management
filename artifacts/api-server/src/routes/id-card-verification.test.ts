import express from "express";
import {beforeAll,afterAll,beforeEach,it,expect,vi} from "vitest";
const state=vi.hoisted(()=>({snapshot:null as any,sql:[] as string[]}));
vi.mock("@workspace/db",()=>({pool:{query:async(sql:string)=>{state.sql.push(sql);return {rows:state.snapshot?[state.snapshot]:[]};}}}));
import {idCardVerificationRouter} from "./id-card-verification";
import {cardVerificationToken} from "../lib/id-card-verification";
let server:any,base="";
beforeAll(async()=>{
  vi.stubEnv("SESSION_SECRET","test-only-public-card-verification-key");
  const app=express();app.use(idCardVerificationRouter);
  await new Promise<void>(r=>{server=app.listen(0,"127.0.0.1",()=>r());});base=`http://127.0.0.1:${server.address().port}`;
});
afterAll(async()=>{await new Promise<void>(r=>server.close(()=>r()));vi.unstubAllEnvs();});
beforeEach(()=>{state.sql=[];state.snapshot={cardId:1,schoolId:2,studentId:3,employeeId:null,employeeBindingCount:0,cardStatus:"active",
  studentStatus:"active",studentName:"PRIVATE PERSON",admissionNo:"PRIVATE-NUMBER",studentPhoto:"PRIVATE-PHOTO"};});
async function verify(token:string) {
  return (await fetch(base+"/v1/id-cards/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token})})).json() as Promise<any>;
}
it("validates current identity without exposing PII, UID or access permission",async()=>{
  const r=await verify(cardVerificationToken({cardId:1,schoolId:2,studentId:3,employeeId:null}));
  expect(r.valid).toBe(true);expect(JSON.stringify(r)).not.toContain("PRIVATE");
  expect(state.sql.every(s=>s.trimStart().startsWith("SELECT"))).toBe(true);
});
it.each(["lost","replaced","inactive","expired"])("revokes verification when card becomes %s",async status=>{
  state.snapshot.cardStatus=status;
  expect((await verify(cardVerificationToken({cardId:1,schoolId:2,studentId:3,employeeId:null}))).valid).toBe(false);
});
it("rejects stale holder and tampered tokens and does not interpret a UID as a verification token",async()=>{
  expect((await verify(cardVerificationToken({cardId:1,schoolId:2,studentId:4,employeeId:null}))).valid).toBe(false);
  expect((await verify("AABBCCDD")).valid).toBe(false);
  expect((await verify("EID1.not-a-valid-token")).valid).toBe(false);
});
