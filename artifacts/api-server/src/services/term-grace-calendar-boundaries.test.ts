import {expect,it,vi} from "vitest";
import {nfcTermWindow} from "./nfc-term-grace";
import {subscriptionPolicy} from "./subscription-enforcement-policy";
import {studentRolloutDecision,readStudentUsageRollout} from "./student-platform-rollout";
import {planAcademicCalendarRollover} from "./academic-calendar-rollover-policy";
import {calendarFixture,applyCalendarPlan} from "./academic-calendar-rollover.test-support";
const plus=(day:string,n:number)=>new Date(Date.parse(`${day}T00:00:00Z`)+n*86400000).toISOString().slice(0,10);
it.each(["2026-09-07","2027-02-01","2027-04-26","2027-12-28"])(
 "respects all grace and inclusive term boundaries for school resumption %s",start=>{
  const end=plus(start,60),term={id:1,schoolId:1,name:"Any saved term",startDate:start,endDate:end,
   isCurrent:true,status:"ACTIVE",sessionStatus:"ACTIVE"};
  for(const [elapsed,grace,checkout] of [[-1,false,false],[0,true,false],[6,true,false],[7,false,true],[60,false,true],[61,false,false]] as const){
   const today=plus(start,elapsed);
   expect(nfcTermWindow(start,end,today)).toMatchObject({inGracePeriod:grace,checkoutOpen:checkout,enforcementDate:plus(start,7)});
   expect(studentRolloutDecision([term],1,undefined,today).chargeable).toBe(checkout);
   if(elapsed>=0&&elapsed<=60){
    const result=subscriptionPolicy({startDate:start,endDate:end},[
     {studentId:1,paid:true,waived:false,pending:false},
     {studentId:2,paid:false,waived:false,pending:false},
    ],today);
    expect(result.restrictedStudentIds).toEqual(checkout?[2]:[]);
    expect(result.schoolLocked).toBe(false);
   }
  }
 });
it("opens the saved academic term at D, independently of payment/grace, and does not inherit a prior term's free grant",async()=>{
 const f=calendarFixture(),first=f.terms[0],next=f.terms[1];
 const grant={id:1,schoolId:1,termId:first.id,sessionId:first.sessionId,startDate:first.startDate,endDate:first.endDate,
  calendarStart:first.startDate,calendarEnd:first.endDate,schoolStatus:"ACTIVE",termStatus:"ACTIVE",sessionStatus:"ACTIVE",suspended:false};
 const query=vi.fn(async(sql:string,values:any[]=[])=>{
  if(sql.includes("to_regclass"))return {rows:[{ready:true}]};
  if(sql.includes("FROM owner_free_academic_terms g"))return {rows:values[0]===1&&values[1]===first.id?[grant]:[]};
  if(sql.includes("FROM academic_terms t JOIN academic_sessions"))return {rows:f.terms.map(t=>({
   ...t,isCurrent:t.isCurrent&&f.sessions[0].isCurrent,sessionStatus:f.sessions[0].status,
  }))};
  throw Error("Unexpected or non-read-only fixture statement");
 });
 applyCalendarPlan(f,planAcademicCalendarRollover(1,first.startDate,f.sessions,f.terms).changes);
 expect(await readStudentUsageRollout({query},1,undefined,plus(first.startDate,7)))
  .toMatchObject({chargeable:false,freeAccess:true,reason:"OWNER_FREE_ACADEMIC_TERM"});
 const plan=planAcademicCalendarRollover(1,next.startDate,f.sessions,f.terms);
 expect(plan).toMatchObject({status:"READY",termId:next.id});
 applyCalendarPlan(f,plan.changes);
 expect(f.terms.find(t=>t.id===next.id)).toMatchObject({isCurrent:true,status:"ACTIVE"});
 expect(await readStudentUsageRollout({query},1,undefined,next.startDate)).toMatchObject({chargeable:false,inGracePeriod:true});
 expect(await readStudentUsageRollout({query},1,undefined,plus(next.startDate,6))).toMatchObject({chargeable:false,inGracePeriod:true});
 expect(await readStudentUsageRollout({query},1,undefined,plus(next.startDate,7))).toMatchObject({chargeable:true,freeAccess:false});
 expect(query.mock.calls.every(([sql])=>sql.trimStart().startsWith("SELECT"))).toBe(true);
});
