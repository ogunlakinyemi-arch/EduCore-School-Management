import {studentRolloutDecision,type RolloutTerm,lagosDate} from "./student-platform-rollout";
type Db={query:(sql:string,values?:any[])=>Promise<{rows:any[]}>};
type CalendarRow=RolloutTerm&{schoolName:string;sessionIsCurrent:boolean};
/** Single read for all active school records. No dates, fees or records are changed. */
export async function readPilotCalendars(db:Db,today=lagosDate()){
  const {rows}=await db.query(`SELECT sc.id AS "schoolId",sc.name AS "schoolName",t.id,t.name,
    t.start_date::text AS "startDate",t.end_date::text AS "endDate",t.status,t.is_current AS "isCurrent",
    s.status AS "sessionStatus",s.is_current AS "sessionIsCurrent"
    FROM schools sc LEFT JOIN academic_terms t ON t.school_id=sc.id
    LEFT JOIN academic_sessions s ON s.id=t.academic_session_id AND s.school_id=sc.id
    WHERE upper(sc.status)='ACTIVE' ORDER BY sc.id,t.start_date,t.id`);
  return pilotCalendarChecklist(rows,today);
}
export function pilotCalendarChecklist(rows:CalendarRow[],today:string){
  const schools=new Map<number,CalendarRow[]>();
  for(const row of rows)schools.set(row.schoolId,[...(schools.get(row.schoolId)??[]),row]);
  return [...schools].map(([schoolId,group])=>{
    const valid=group.filter(r=>r.id!=null&&r.sessionStatus!=null);
    const current=valid.filter(t=>t.isCurrent&&t.sessionIsCurrent&&t.status.toUpperCase()==="ACTIVE"
      &&t.sessionStatus.toUpperCase()==="ACTIVE"&&t.startDate<=today&&t.endDate>=today);
    const launch=studentRolloutDecision(valid,schoolId,current.length===1?current[0].id:undefined,today);
    return{schoolId,schoolName:group[0].schoolName,currentTermId:current.length===1?current[0].id:null,
      currentCalendar:current.length===1?"READY":current.length?"AMBIGUOUS":"MISSING",
      januaryCollectionStart:launch.collectionStartDate,
      januaryCalendar:launch.launchTermId===null?"REVIEW_REQUIRED":"CONFIGURED",
      checklist:current.length===1?["Confirm class/teacher assignments and parent links for the pilot."]
        :["School Admin must review saved session/term dates and current flags; do not invent dates."],
    };
  });
}
