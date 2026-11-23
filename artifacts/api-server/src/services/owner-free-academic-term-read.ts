import {lagosDate} from "./student-platform-rollout";
type Db={query:(sql:string,values?:any[])=>Promise<{rows:any[]}>};
export type FreeTermState="TRIAL_GRANTED"|"ACTIVE"|"COMPLETED"|"PAYMENT_REQUIRED"|"PAID"|"SUSPENDED";
export async function freeTermStorageReady(db:Db) {
  const r=(await db.query(`SELECT to_regclass('public.owner_free_academic_terms') IS NOT NULL
    AND to_regclass('public.owner_free_academic_term_events') IS NOT NULL
    AND (SELECT count(*)=2 FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='O'
      AND ((tgrelid=to_regclass('public.owner_free_academic_terms') AND tgname='owner_free_terms_immutable')
        OR (tgrelid=to_regclass('public.owner_free_academic_term_events') AND tgname='owner_free_term_events_immutable')))
    AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid=to_regclass('public.owner_free_academic_terms')
      AND tgname='owner_free_terms_scope' AND tgenabled='O' AND NOT tgisinternal) AS ready`)).rows[0];
  return r?.ready===true;
}
/** Read-only entitlement evidence. Absence never invents free access or payment. */
export async function readFreeTermGrant(db:Db,schoolId:number,termId:number,today=lagosDate()) {
  if(!await freeTermStorageReady(db)){
    const present=(await db.query(`SELECT to_regclass('public.owner_free_academic_terms') IS NOT NULL
      OR to_regclass('public.owner_free_academic_term_events') IS NOT NULL AS present`)).rows[0]?.present;
    if(present){
      const {AuthError}=await import("../middlewares/auth");
      throw new AuthError(503,"Free-term entitlement guards are unavailable. No new payment or grant is authorized.","FREE_TERM_SCHEMA_UNAVAILABLE");
    }
    return null;
  }
  const r=(await db.query(`SELECT g.id,g.school_id AS "schoolId",g.academic_term_id AS "termId",
    g.academic_session_id AS "sessionId",g.start_date::text AS "startDate",g.end_date::text AS "endDate",
    g.reason,g.actor_user_id AS "actorUserId",g.created_at::text AS "createdAt",
    t.start_date::text AS "calendarStart",t.end_date::text AS "calendarEnd",
    t.status AS "termStatus",s.status AS "sessionStatus",sc.status AS "schoolStatus",
    EXISTS(SELECT 1 FROM owner_free_academic_term_events e WHERE e.grant_id=g.id AND e.status='SUSPENDED') AS suspended
    FROM owner_free_academic_terms g
    JOIN academic_terms t ON t.id=g.academic_term_id AND t.school_id=g.school_id AND t.academic_session_id=g.academic_session_id
    JOIN academic_sessions s ON s.id=g.academic_session_id AND s.school_id=g.school_id
    JOIN schools sc ON sc.id=g.school_id
    WHERE g.school_id=$1 AND g.academic_term_id=$2`,[schoolId,termId])).rows[0];
  if(!r)return null;
  const calendarChanged=r.startDate!==r.calendarStart||r.endDate!==r.calendarEnd;
  const invalid=calendarChanged||r.schoolStatus.toLowerCase()!=="active"
    ||!["ACTIVE","PLANNED"].includes(r.termStatus)||!["ACTIVE","PLANNED"].includes(r.sessionStatus)
    ||(today>=r.startDate&&today<=r.endDate&&(r.termStatus!=="ACTIVE"||r.sessionStatus!=="ACTIVE"));
  const status:FreeTermState=r.suspended?"SUSPENDED":today>r.endDate?"COMPLETED":
    invalid?"SUSPENDED":today<r.startDate?"TRIAL_GRANTED":"ACTIVE";
  return {...r,status,calendarChanged,active:status==="ACTIVE"};
}
