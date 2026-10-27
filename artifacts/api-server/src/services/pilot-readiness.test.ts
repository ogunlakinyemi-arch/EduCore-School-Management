import {describe,expect,it} from "vitest";
import {pilotCalendarChecklist} from "./pilot-readiness";
const t={id:1,schoolId:1,schoolName:"Fictional school",name:"First Term",startDate:"2026-09-07",
  endDate:"2026-12-18",status:"ACTIVE",sessionStatus:"ACTIVE",isCurrent:true,sessionIsCurrent:true};
describe("school-owned pilot calendars",()=>{
  it("shows missing current calendar without substituting another school's dates",()=>{
    expect(pilotCalendarChecklist([t,{...t,schoolId:2,startDate:"2027-01-11"}],"2026-10-27")
      .map(r=>r.currentCalendar)).toEqual(["READY","MISSING"]);
  });
  it("flags ambiguous current flags, inactive sessions and missing January anchors",()=>{
    expect(pilotCalendarChecklist([t,{...t,id:2}],"2026-10-27")[0].currentCalendar).toBe("AMBIGUOUS");
    expect(pilotCalendarChecklist([{...t,sessionIsCurrent:false}],"2026-10-27")[0].currentCalendar).toBe("MISSING");
    expect(pilotCalendarChecklist([t],"2026-10-27")[0].januaryCalendar).toBe("REVIEW_REQUIRED");
  });
  it("shows a real configured January second term without marking future collection active",()=>{
    expect(pilotCalendarChecklist([t,{...t,id:3,name:"Second Term",startDate:"2027-01-11",endDate:"2027-04-09",isCurrent:false}],"2026-10-27")[0])
      .toMatchObject({currentCalendar:"READY",januaryCalendar:"CONFIGURED",januaryCollectionStart:"2027-01-11"});
  });
});
