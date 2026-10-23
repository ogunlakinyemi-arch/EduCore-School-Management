import {z} from "zod";
import {AuthError} from "../middlewares/auth";
import {queueCommunicationNotification,type CommunicationQueryClient} from "./communication-service";
import {readAttendanceSchedule,schoolClock,attendanceDayOpen,schoolClosingTime} from "./attendance-schedule";
import {familyChildSchoolScope} from "../lib/family-child-school-scope";

type Db={query(sql:string,values?:any[]):Promise<{rows:any[]}>};
export const communityViews=["SCHOOL","PARENT","STUDENT","DRIVER"] as const;
type Membership={schoolId:number|null;role:string;status:string};
export function communityAccess(roles:Membership[],schoolId:number,view:string){
  if(roles.some(r=>r.role==="PLATFORM_OWNER"&&r.status==="ACTIVE"))
    throw new AuthError(403,"School community dashboards are for school members");
  const active=roles.filter(r=>r.schoolId===schoolId&&r.status==="ACTIVE").map(r=>r.role);
  const requested=view==="SCHOOL"?["SCHOOL_ADMIN","TEACHER","STAFF","ACCOUNTANT","LIBRARIAN"]:[view];
  if(!communityViews.includes(view as any)||!active.some(r=>requested.includes(r)))
    throw new AuthError(404,"Resource not found","CROSS_TENANT_ACCESS_ATTEMPT");
  const manager=view==="SCHOOL"&&active.includes("SCHOOL_ADMIN");
  const audience=view==="SCHOOL"?active.filter(r=>requested.includes(r)).map(r=>
    ["ACCOUNTANT","LIBRARIAN"].includes(r)?"STAFF":r):[view];
  return {manager,audience:[...new Set(audience)]};
}
const realDay=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>{
  const d=new Date(s+"T00:00:00Z");return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;
});
const clock=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const busDutySchema=z.object({
  startDate:realDay,endDate:realDay,startTime:clock,endTime:clock,
  instructions:z.string().trim().max(1000).default(""),
}).strict().refine(d=>d.startDate<=d.endDate&&d.startTime<d.endTime,"Duty dates/times must be in order");
export function parseBusDuty(raw:unknown){
  const result=busDutySchema.safeParse(raw);
  if(!result.success)throw new AuthError(400,"Supply a valid bus-duty date range, start/end times and instructions (up to 1000 characters)");
  return result.data;
}
export function dutyStatus(duty:z.infer<typeof busDutySchema>|null,date:string,time:string,routeWeekdays?:string[],weekday?:number){
  if(!duty)return "PERIOD_NOT_SET";
  if(date>duty.endDate||(date===duty.endDate&&time>=duty.endTime))return "EXPIRED";
  if(date<duty.startDate)return "UPCOMING";
  const names=["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY","SATURDAY","SUNDAY"];
  if(routeWeekdays&&weekday&&!routeWeekdays.includes(names[weekday-1]))return "NOT_SCHEDULED_TODAY";
  if(time<duty.startTime)return "UPCOMING";
  if(time>=duty.endTime)return "OFF_DUTY";
  return "ACTIVE";
}
export async function requireDriverCalendarSupport(db:Db,schoolId:number,audiences:string[][]){
  if(!audiences.some(a=>a.includes("DRIVER")))return;
  const check=await db.query(`SELECT pg_get_constraintdef(c.oid) AS definition
    FROM pg_constraint c WHERE c.conrelid='school_calendar_events'::regclass
      AND c.conname='school_calendar_events_audience_check'`,[]);
  if(!check.rows[0]?.definition?.includes("'DRIVER'"))
    throw new AuthError(409,"Driver audience requires the separately approved calendar schema update. No event was saved.");
}
export async function communityClosing(db:Db,schoolId:number,now:Date){
  const saved=await readAttendanceSchedule(db,schoolId);
  const at=schoolClock(now,saved.schedule.timezone);
  const configured=saved.revision>0;
  // Calendar dates don't silently alter attendance policy: closures are decided
  // by the existing authoritative schedule, including operating days.
  const dayOpen=configured&&attendanceDayOpen(saved.schedule,at.date,at.weekday);
  return {configured,date:at.date,timezone:saved.schedule.timezone,
    time:dayOpen?schoolClosingTime(saved.schedule,at.weekday):null,
    dayOpen,effectiveAt:saved.effectiveAt,revision:saved.revision};
}
export async function calendarSnapshot(db:Db,schoolId:number){
  return (await db.query(`SELECT id,title,category,start_date::text AS "startDate",
    end_date::text AS "endDate",audience,status,is_academic AS academic
    FROM school_calendar_events WHERE school_id=$1 ORDER BY id`,[schoolId])).rows;
}
export function publicCalendarState(row:any){
  return {title:row.title,category:row.category,startDate:row.startDate,endDate:row.endDate??null,
    audience:[...row.audience].sort(),status:row.status,academic:row.academic};
}
/** Same caller transaction as calendar writes; IN_APP only, no dispatch.
 * Store public change metadata and leave private notes out of every snapshot.
 */
export async function publishCalendarChanges(db:Db,schoolId:number,actorId:number,before:any[],after:any[]){
  const previous=new Map(before.map(r=>[Number(r.id),r]));
  for(const row of after){
    const old=previous.get(Number(row.id));
    if(old&&JSON.stringify(publicCalendarState(old))===JSON.stringify(publicCalendarState(row)))continue;
    const change=row.status==="INACTIVE"?"CANCELLED":old?"UPDATED":"NEW";
    if(!old&&change==="CANCELLED")continue;
    const record=await db.query(`INSERT INTO audit_logs
      ("user",role,school_id,actor_user_id,action,module,record_id,metadata)
      VALUES('School administrator','SCHOOL_ADMIN',$1,$2,'School calendar notice','Calendar',$3,$4::jsonb)
      RETURNING id`,[schoolId,actorId,row.id,JSON.stringify({change,eventId:row.id,...publicCalendarState(row)})]);
    const revision=record.rows[0]?.id;
    if(!revision)throw new Error("Calendar notice audit was not persisted");
    await db.query(`UPDATE communication_notifications SET archived_at=COALESCE(archived_at,NOW())
      WHERE school_id=$1 AND event_key LIKE $2`,[schoolId,`CALENDAR:${schoolId}:${row.id}:%`]);
    const recipients=await db.query(`SELECT DISTINCT recipient.user_id AS "userId" FROM (
      SELECT sm.user_id FROM school_memberships sm
      WHERE sm.school_id=$1 AND UPPER(sm.status)='ACTIVE'
        AND (CASE WHEN sm.role IN ('ACCOUNTANT','LIBRARIAN') THEN 'STAFF' ELSE sm.role END)=ANY($2::text[])
      UNION SELECT st.user_id FROM students st WHERE st.school_id=$1 AND UPPER(st.status)='ACTIVE'
        AND 'STUDENT'=ANY($2::text[]) AND st.user_id IS NOT NULL
      UNION SELECT p.user_id FROM parents p
        JOIN parent_student_relationships ps ON ps.parent_id=p.id AND UPPER(ps.status)='ACTIVE'
        JOIN students st ON st.id=ps.student_id AND st.school_id=$1 AND UPPER(st.status)='ACTIVE'
        WHERE UPPER(p.status)='ACTIVE' AND 'PARENT'=ANY($2::text[]) AND ${familyChildSchoolScope("p","st")}
      ) recipient JOIN app_users u ON u.id=recipient.user_id AND UPPER(u.status)='ACTIVE'
      WHERE NOT EXISTS(SELECT 1 FROM school_memberships owner WHERE owner.user_id=recipient.user_id
        AND owner.school_id IS NULL AND owner.role='PLATFORM_OWNER' AND UPPER(owner.status)='ACTIVE')`,
      [schoolId,row.audience]);
    for(const recipient of recipients.rows){
      await queueCommunicationNotification(db as CommunicationQueryClient,{
        recipientUserId:Number(recipient.userId),schoolId,category:"ANNOUNCEMENT",
        eventKey:`CALENDAR:${schoolId}:${row.id}:${revision}`,subject:"School calendar notice",
        // Notifications are deliberately generic: current membership/audience
        // is checked again when the recipient opens dashboard details.
        body:"A school calendar notice was published, updated or cancelled. Open your school dashboard for the current details.",
        link:"/",channels:["IN_APP"],useSchoolDefaults:false,
      });
    }
  }
}
