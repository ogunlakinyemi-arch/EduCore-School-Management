import {AuthError} from "../middlewares/auth";
import {requireCalendarRolloverSchema} from "./academic-calendar-rollover";
import type {CurrentSql} from "./current-financial-contract";

/** School Admin's existing transaction/gate/authorization must already be held.
 * Pair a session activation with its saved due term, not a separate HTTP write.
 * Never invent dates, create terms or reopen an explicitly inactive term. */
export async function finalizeCalendarSessionEdit(c:CurrentSql,schoolId:number,sessionId:number,clearSession=false){
 // Preserve pre-candidate CRUD compatibility; never install anything here.
 const installed=(await c.query("SELECT to_regclass('public.academic_calendar_rollovers') IS NOT NULL AS ready")).rows[0]?.ready;
 if(!installed)return [];
 await requireCalendarRolloverSchema(c as CurrentSql&{release():void});
 const session=(await c.query(`SELECT id,status,is_current FROM academic_sessions
  WHERE id=$1 AND school_id=$2 FOR UPDATE`,[sessionId,schoolId])).rows[0];
 if(!session)throw new AuthError(404,"Academic session not found");
 const changes:any[]=[];
 if(clearSession&&session.is_current){
  await c.query("UPDATE academic_sessions SET is_current=false,updated_at=clock_timestamp() WHERE id=$1 AND school_id=$2",[sessionId,schoolId]);
  changes.push({kind:"SESSION",id:sessionId,from:{status:session.status,isCurrent:true},to:{status:session.status,isCurrent:false}});
  session.is_current=false;
 }
 let due:any;
 if(session.is_current){
  const complete=(await c.query("SELECT public.academic_calendar_session_complete($1,$2) AS complete",[schoolId,sessionId])).rows[0]?.complete;
  if(complete!==true)throw new AuthError(409,"Save all three ordered terms before making this session current.");
  const rows=(await c.query(`SELECT id,status,is_current FROM academic_terms WHERE school_id=$1 AND academic_session_id=$2
   AND (clock_timestamp() AT TIME ZONE 'Africa/Lagos')::date BETWEEN start_date AND end_date FOR UPDATE`,[schoolId,sessionId])).rows;
  if(rows.length>1)throw new AuthError(409,"The saved calendar has more than one due term.");
  due=rows[0];
  if(due&&!["ACTIVE","PLANNED"].includes(due.status))throw new AuthError(409,"The saved due term is inactive; review it before activating the session.");
 }
 const outgoing=(await c.query(`SELECT id,status FROM academic_terms WHERE school_id=$1 AND is_current
  AND ($2::integer IS NULL OR id<>$2) AND ($3::boolean OR academic_session_id=$4) FOR UPDATE`,
 [schoolId,due?.id??null,session.is_current,sessionId])).rows;
 for(const term of outgoing){
  await c.query("UPDATE academic_terms SET is_current=false,updated_at=clock_timestamp() WHERE id=$1 AND school_id=$2",[term.id,schoolId]);
  changes.push({kind:"TERM",id:term.id,from:{status:term.status,isCurrent:true},to:{status:term.status,isCurrent:false}});
 }
 if(due&&(due.is_current!==true||due.status!=="ACTIVE")){
  await c.query("UPDATE academic_terms SET is_current=true,status='ACTIVE',updated_at=clock_timestamp() WHERE id=$1 AND school_id=$2",[due.id,schoolId]);
  changes.push({kind:"TERM",id:due.id,from:{status:due.status,isCurrent:due.is_current},to:{status:"ACTIVE",isCurrent:true}});
 }
 return changes;
}
