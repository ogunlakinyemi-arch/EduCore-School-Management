/** AUTHORED, NOT EXECUTED. Pure policy expectations do not certify SQL/runtime. */
import {it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {planAcademicCalendarRollover as plan,calendarLagosDay,academicTermOrdinal,calendarDigest} from "./academic-calendar-rollover-policy";
import {calendarFixture,applyCalendarPlan} from "./academic-calendar-rollover.test-support";
import {advanceCheckoutOpen,advanceDigest,materialCalendar,advanceEvidenceMatches} from "./advance-subscription-policy";
it.each([2026,2027,2028].flatMap(year=>[0,1,2].map(term=>({year,term}))))(
 "opens term $term in session starting $year only at its own start",({year,term})=>{
 const f=calendarFixture(1,year),target=f.terms[term],p=plan(1,target.startDate,f.sessions,f.terms);
 expect(p.status).toBe("READY");expect(p.termId).toBe(target.id);expect(p.sessionId).toBe(f.sessions[0].id);
 const result=applyCalendarPlan(f,p.changes);
 expect(result.terms.filter(t=>t.isCurrent)).toEqual([expect.objectContaining({id:target.id,status:"ACTIVE"})]);
 expect(result.sessions[0]).toMatchObject({status:"ACTIVE",isCurrent:true});
 for(const t of result.terms.filter(t=>t.endDate<target.startDate))expect(t.status).toBe("INACTIVE");
});
it("keeps schools with different second-term resumptions independent",()=>{
 const a=calendarFixture(1),b=calendarFixture(2,2026,25);
 expect(plan(1,"2027-01-18",a.sessions,a.terms).termId).toBe(a.terms[1].id);
 expect(plan(2,"2027-01-18",b.sessions,b.terms).termId).toBeNull();
 expect(plan(2,"2027-01-25",b.sessions,b.terms).termId).toBe(b.terms[1].id);
});
it("does not open a session or term before its saved start",()=>{
 const f=calendarFixture();expect(plan(1,"2026-08-31",f.sessions,f.terms)).toMatchObject({termId:null,sessionId:null,changes:[]});
});
it("keeps checkout independently closed before start and after end despite stale markers",()=>{
 for(const day of ["2027-01-17","2027-04-10"])
  expect(advanceCheckoutOpen(day,"2027-01-18","2027-04-09",true,true,"ACTIVE","ACTIVE")).toBe(false);
});
it("closes the last term the day after it ends and keeps the saved session through its end",()=>{
 const f=calendarFixture();applyCalendarPlan(f,plan(1,"2027-07-23",f.sessions,f.terms).changes);
 const p=plan(1,"2027-07-24",f.sessions,f.terms);expect(p.termId).toBeNull();expect(p.sessionId).toBe(f.sessions[0].id);
 expect(p.changes).toContainEqual(expect.objectContaining({id:f.terms[2].id,to:{status:"INACTIVE",isCurrent:false}}));
});
it("closes session after its final day without inventing next-session dates",()=>{
 const f=calendarFixture();applyCalendarPlan(f,plan(1,"2027-07-23",f.sessions,f.terms).changes);
 const p=plan(1,"2027-08-01",f.sessions,f.terms);expect(p.sessionId).toBeNull();
 expect(p.changes).toContainEqual(expect.objectContaining({kind:"SESSION",to:{status:"INACTIVE",isCurrent:false}}));
});
it("catches up several missed terms directly without replaying past activations",()=>{
 const f=calendarFixture();const p=plan(1,"2027-05-01",f.sessions,f.terms);
 expect(p.termId).toBe(f.terms[2].id);
 expect(p.changes.filter(c=>c.kind==="TERM"&&c.to.isCurrent)).toHaveLength(1);
 expect(p.changes.filter(c=>c.kind==="TERM"&&c.to.status==="INACTIVE")).toHaveLength(2);
});
it("is convergent after restart and repeated ticks",()=>{
 const f=calendarFixture();applyCalendarPlan(f,plan(1,"2027-01-18",f.sessions,f.terms).changes);
 expect(plan(1,"2027-01-18",f.sessions,f.terms).changes).toEqual([]);
});
it("closes prior session and opens the next saved complete session",()=>{
 const a=calendarFixture(),b=calendarFixture(1,2027);
 applyCalendarPlan(a,plan(1,"2027-05-01",a.sessions,a.terms).changes);
 const p=plan(1,"2027-09-07",[...a.sessions,...b.sessions],[...a.terms,...b.terms]);
 expect(p.sessionId).toBe(b.sessions[0].id);expect(p.termId).toBe(b.terms[0].id);
 expect(p.changes).toContainEqual(expect.objectContaining({kind:"SESSION",id:a.sessions[0].id,to:{status:"INACTIVE",isCurrent:false}}));
});
it.each(["missing","duplicate-number","reverse-number","overlap","outside-session","impossible-date","reversed-date","unknown-status","empty-name"] as const)(
 "blocks invalid due calendar: %s",issue=>{
 const f=calendarFixture();
 if(issue==="missing")f.terms.pop();
 if(issue==="duplicate-number")f.terms[2].name="Second Academic Term";
 if(issue==="reverse-number"){f.terms[0].name="Third Term";f.terms[2].name="First Term";}
 if(issue==="overlap")f.terms[0].endDate=f.terms[1].startDate;
 if(issue==="outside-session")f.terms[2].endDate="2027-08-01";
 if(issue==="impossible-date")f.terms[2].endDate="2027-02-30";
 if(issue==="reversed-date")f.terms[1].endDate="2027-01-17";
 if(issue==="unknown-status")f.terms[2].status="UNKNOWN";
 if(issue==="empty-name"){f.sessions[0].name=" ";f.terms[2].name=null as unknown as string;}
 const p=plan(1,"2027-01-18",f.sessions,f.terms);
 expect(p.status).toBe("BLOCKED");expect(p.termId).toBeNull();expect(p.sessionId).toBeNull();
 expect(p.changes.every(c=>!c.to.isCurrent)).toBe(true);
});
it("blocks overlapping sessions even when only one has a current marker",()=>{
 const a=calendarFixture(),b=calendarFixture(1,2027);b.sessions[0].startDate="2027-07-01";
 expect(plan(1,"2027-01-18",[...a.sessions,...b.sessions],[...a.terms,...b.terms]).errors.join()).toContain("OVERLAPPING_SESSIONS");
});
it("clears ambiguous current markers instead of selecting an arbitrary term",()=>{
 const f=calendarFixture();f.terms[0].isCurrent=f.terms[1].isCurrent=true;f.terms[0].endDate="2027-01-20";
 const p=plan(1,"2027-01-18",f.sessions,f.terms);expect(p.status).toBe("BLOCKED");
 applyCalendarPlan(f,p.changes);expect(f.terms.some(t=>t.isCurrent)).toBe(false);
});
it("does not silently reopen an explicitly inactive due term",()=>{
 const f=calendarFixture();f.terms[1].status="INACTIVE";
 expect(plan(1,"2027-01-18",f.sessions,f.terms).errors).toContain("DUE_TERM_EXPLICITLY_INACTIVE");
});
it("does not let incomplete future session setup block a valid current session",()=>{
 const a=calendarFixture(),b=calendarFixture(1,2027);
 const p=plan(1,"2027-01-18",[...a.sessions,...b.sessions],a.terms);expect(p.status).toBe("READY");
 expect(plan(1,"2027-09-07",[...a.sessions,...b.sessions],a.terms).status).toBe("BLOCKED");
});
it("revalidates edited dates rather than using a prior cached plan",()=>{
 const f=calendarFixture(),before=plan(1,"2027-01-18",f.sessions,f.terms);
 f.terms[1].startDate="2027-01-25";const after=plan(1,"2027-01-18",f.sessions,f.terms);
 expect(after.termId).toBeNull();expect(after.calendarDigest).not.toBe(before.calendarDigest);
});
it("rejects foreign-school rows and never emits changes for them",()=>{
 const a=calendarFixture(),b=calendarFixture(2),p=plan(1,"2027-01-18",[...a.sessions,...b.sessions],[...a.terms,...b.terms]);
 expect(p.status).toBe("BLOCKED");expect(p.errors).toContain("CALENDAR_TENANT_MISMATCH");
 expect(p.changes.some(c=>[...b.terms,...b.sessions].some(r=>r.id===c.id))).toBe(false);
});
it.each([
 ["2027-01-17T22:59:59.999Z","2027-01-17"],["2027-01-17T23:00:00.000Z","2027-01-18"],
 ["2027-04-09T22:59:59.999Z","2027-04-09"],["2027-04-09T23:00:00.000Z","2027-04-10"],
])("uses Lagos day at %s",(instant,day)=>expect(calendarLagosDay(new Date(instant))).toBe(day));
it.each(["First Academic Term","Term2","3rd Term"])("recognizes school term number: %s",name=>expect(academicTermOrdinal(name)).not.toBeNull());
it("keeps reviewed target material identical across expected rollover",()=>{
 const f=calendarFixture();
 applyCalendarPlan(f,plan(1,"2027-01-18",f.sessions,f.terms).changes);
 // Policy DTO uses camelCase: use the actual database material projection.
 const db=(t:typeof f.terms[number])=>({id:t.id,school_id:t.schoolId,academic_session_id:t.sessionId,
  start_date:t.startDate,end_date:t.endDate,status:t.status,is_current:t.isCurrent});
 const original=calendarFixture();expect(advanceDigest(materialCalendar(db(f.terms[1]))))
  .toBe(advanceDigest(materialCalendar(db(original.terms[1]))));
 expect(advanceCheckoutOpen("2027-01-18",f.terms[1].startDate,f.terms[1].endDate,f.terms[1].isCurrent,f.sessions[0].isCurrent,
  f.terms[1].status,f.sessions[0].status)).toBe(false);
 expect(advanceCheckoutOpen("2027-01-25",f.terms[1].startDate,f.terms[1].endDate,f.terms[1].isCurrent,f.sessions[0].isCurrent,
  f.terms[1].status,f.sessions[0].status)).toBe(true);
});
it("does not make a changed-and-restored financial approval fresh",()=>{
 expect(advanceEvidenceMatches({digest:"same",materialVersion:"7"},{digest:"same",materialVersion:"8"})).toBe(false);
});
it("retains the independent financial checks and imports no charge or entitlement writer",()=>{
 const read=(p:string)=>readFileSync(new URL(p,import.meta.url),"utf8");
 const runtime=read("./academic-calendar-rollover.ts")+read("./academic-calendar-rollover-worker.ts");
 expect(runtime).not.toMatch(/INSERT INTO (?:subscriptions|student_direct_live_|bro_term_commission|staff_nfc)|ensureCurrentStaff|fetch\(/);
 const advance=read("./advance-subscription-authorizations.ts");
 for(const gate of ['sameEvidence(a,fresh)','eligibleStudentIds.includes(scope.studentId)','advanceCheckoutOpen(',
  'Number(rule.amount_minor)!==320000','readFreeTermGrant','readStudentRollout'])expect(advance).toContain(gate);
 expect(read("./direct-student-live-release.ts")).toContain("expiry>Date.now()+7*86400000");
 expect(read("../../../../lib/db/drizzle/0177_direct_student_live_release_reviews.sql")).toContain("expires_at<=created_at+interval '7 days'");
 expect(calendarDigest({fee:320000,bro:15000})).toMatch(/^[a-f0-9]{64}$/);
});
