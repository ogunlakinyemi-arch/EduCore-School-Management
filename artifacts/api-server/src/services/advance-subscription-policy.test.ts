/** Authored only in this change; no tests were executed. Pure policy/source
 * contracts do not establish PostgreSQL trigger or deployed runtime behavior. */
import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {advanceDigest,advanceWindow,advanceCheckoutOpen,materialCalendar,advanceEvidenceMatches} from "./advance-subscription-policy";
import {studentRolloutDecision} from "./student-platform-rollout";
const school=(id:number,startDate:string)=>({id,schoolId:id,name:"Second Term",startDate,endDate:"2027-04-09",
 isCurrent:true,status:"ACTIVE",sessionStatus:"ACTIVE"});
describe("advance authorization policy",()=>{
 it("defines a separate term-wide WAT window, not a seven-day extension",()=>{
  expect(advanceWindow("2027-01-18","2027-04-09")).toEqual({
   notBefore:"2027-01-17T23:00:00.000Z",expiresAt:"2027-04-09T23:00:00.000Z"});
 });
 it.each(["2026-11-27","2027-01-01","2027-01-17"])("refuses early checkout on %s",day=>{
  expect(advanceCheckoutOpen(day,"2027-01-18","2027-04-09",true,true,"ACTIVE","ACTIVE")).toBe(false);
 });
 it("opens only the eligible school's term on opening day",()=>{
  const terms=[school(1,"2027-01-18"),school(2,"2027-01-25")];
  expect(studentRolloutDecision(terms,1,1,"2027-01-18").chargeable).toBe(true);
  expect(studentRolloutDecision(terms,2,2,"2027-01-18").chargeable).toBe(false);
  expect(advanceCheckoutOpen("2027-01-18","2027-01-18","2027-04-09",true,true,"ACTIVE","ACTIVE")).toBe(true);
 });
 it.each([
  [false,true,"ACTIVE","ACTIVE"],[true,false,"ACTIVE","ACTIVE"],
  [true,true,"PLANNED","ACTIVE"],[true,true,"ACTIVE","PLANNED"],
 ] as const)("requires both current active lifecycle records: %s %s %s %s",(tc,sc,ts,ss)=>{
  expect(advanceCheckoutOpen("2027-01-18","2027-01-18","2027-04-09",tc,sc,ts,ss)).toBe(false);
 });
 it("allows the final day, expires after it, and never assumes a missing January anchor",()=>{
  expect(advanceCheckoutOpen("2027-04-09","2027-01-18","2027-04-09",true,true,"ACTIVE","ACTIVE")).toBe(true);
  expect(advanceCheckoutOpen("2027-04-10","2027-01-18","2027-04-09",true,true,"ACTIVE","ACTIVE")).toBe(false);
  expect(studentRolloutDecision([school(1,"2027-02-01")],1,1,"2027-02-01").chargeable).toBe(false);
 });
 it("does not invalidate solely for the expected lifecycle transition",()=>{
  const material={id:1,school_id:1,academic_session_id:1,start_date:"2027-01-18",end_date:"2027-04-09"};
  expect(advanceDigest(materialCalendar({...material,status:"PLANNED",is_current:false,updated_at:"before"})))
   .toBe(advanceDigest(materialCalendar({...material,status:"ACTIVE",is_current:true,updated_at:"opening"})));
 });
 it.each(["start_date","end_date","academic_session_id","version"])("binds calendar field %s",field=>{
  const base={id:1,start_date:"2027-01-18",end_date:"2027-04-09",academic_session_id:1,version:1};
  expect(advanceDigest(materialCalendar({...base,[field]:"changed"}))).not.toBe(advanceDigest(materialCalendar(base)));
 });
 it.each(["eligibleStudentIds","reportDigest","rule","merchantScope","callbackUrl","webhookUrl"])("binds exact %s",field=>{
  const facts={eligibleStudentIds:[1,2],reportDigest:"a".repeat(64),rule:{id:1,version:1,amount_minor:320000},
   merchantScope:"fictional",callbackUrl:"https://example.invalid/callback",webhookUrl:"https://example.invalid/webhook"};
  expect(advanceDigest({...facts,[field]:"changed"})).not.toBe(advanceDigest(facts));
 });
 it("retained revision change invalidates even when values were changed back",()=>{
  expect(advanceEvidenceMatches({digest:"same",materialVersion:"10"},{digest:"same",materialVersion:"11"})).toBe(false);
 });
 it("preserves the original SQL and service seven-day current-term limits",()=>{
  const sql=readFileSync(new URL("../../../../lib/db/drizzle/0177_direct_student_live_release_reviews.sql",import.meta.url),"utf8");
  const service=readFileSync(new URL("./direct-student-live-release.ts",import.meta.url),"utf8");
  expect(sql).toContain("expires_at<=created_at+interval '7 days'");
  expect(service).toContain("expiry>Date.now()+7*86400000");
  expect(service).toContain("if(input.action===\"APPROVED\"&&v.status!==\"REVIEWED\")");
  expect(service).toContain('if(advance!==undefined)return advance');
 });
});
