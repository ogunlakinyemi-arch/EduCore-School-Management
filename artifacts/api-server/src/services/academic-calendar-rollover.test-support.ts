/** Fictional in-memory data only; never imports an application pool. */
import type {CalendarPeriod,CalendarTerm,CalendarChange} from "./academic-calendar-rollover-policy";
export function calendarFixture(schoolId=1,year=2026,resumptionDay=18){
 const id=schoolId*100+year-2026;
 const session:CalendarPeriod={id,schoolId,name:`Fictional ${year}/${year+1}`,startDate:`${year}-09-01`,
  endDate:`${year+1}-07-31`,status:"PLANNED",isCurrent:false,updatedAt:"initial"};
 const terms:CalendarTerm[]=[
  {id:id*10+1,schoolId,sessionId:id,name:"First Term",startDate:`${year}-09-07`,endDate:`${year}-12-18`,status:"PLANNED",isCurrent:false,updatedAt:"initial"},
  {id:id*10+2,schoolId,sessionId:id,name:"Second Term",startDate:`${year+1}-01-${resumptionDay}`,endDate:`${year+1}-04-09`,status:"PLANNED",isCurrent:false,updatedAt:"initial"},
  {id:id*10+3,schoolId,sessionId:id,name:"Third Term",startDate:`${year+1}-04-26`,endDate:`${year+1}-07-23`,status:"PLANNED",isCurrent:false,updatedAt:"initial"},
 ];
 return {sessions:[session],terms};
}
export function applyCalendarPlan(f:{sessions:CalendarPeriod[];terms:CalendarTerm[]},changes:CalendarChange[]){
 for(const ch of changes){const p=(ch.kind==="SESSION"?f.sessions:f.terms).find(p=>p.id===ch.id)!;Object.assign(p,ch.to);}
 return f;
}
