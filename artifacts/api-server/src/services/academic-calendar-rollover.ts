import {FINANCIAL_TRANSACTION_GATE_SQL} from "./financial-transaction";
import {calendarDigest,planAcademicCalendarRollover,type CalendarPeriod,type CalendarTerm} from "./academic-calendar-rollover-policy";
type Client={query:(sql:string,values?:any[])=>Promise<{rows:any[];rowCount?:number|null}>;release:()=>void};
export type CalendarPool={connect:()=>Promise<Client>};
export class CalendarRolloverUnavailable extends Error{}
async function boundedCalendarTransaction<T>(pool:CalendarPool,run:(c:Client)=>Promise<T>){
 const c=await pool.connect();
 try{
  await c.query("BEGIN");
  await c.query("SET LOCAL lock_timeout='2s'");
  await c.query("SET LOCAL statement_timeout='10s'");
  await c.query(FINANCIAL_TRANSACTION_GATE_SQL);
  const result=await run(c);await c.query("COMMIT");return result;
 }catch(error){await c.query("ROLLBACK").catch(()=>undefined);throw error;}
 finally{c.release();}
}
export async function requireCalendarRolloverSchema(c:Client){
 const ready=(await c.query(`SELECT to_regclass('public.academic_calendar_rollovers') IS NOT NULL AS ready`)).rows[0]?.ready;
 if(!ready)throw new CalendarRolloverUnavailable("CALENDAR_ROLLOVER_SCHEMA_REQUIRED");
 const guards=(await c.query(`SELECT r.relname,t.tgname,p.proname,t.tgtype,t.tgdeferrable,t.tginitdeferred,t.tgconstraint FROM pg_trigger t
  JOIN pg_class r ON r.oid=t.tgrelid JOIN pg_namespace n ON n.oid=r.relnamespace JOIN pg_proc p ON p.oid=t.tgfoid
  WHERE n.nspname='public' AND p.pronamespace=n.oid AND NOT p.prosecdef AND p.pronargs=0 AND t.tgenabled='O' AND NOT t.tgisinternal
   AND t.tgqual IS NULL AND t.tgattr::text='' AND t.tgnargs=0`)).rows;
 const expected=[
  ["academic_sessions","academic_calendar_write_gate","guard_academic_calendar_write_gate",30],
  ["academic_terms","academic_calendar_write_gate","guard_academic_calendar_write_gate",30],
  ["academic_sessions","academic_calendar_current_scope","guard_academic_calendar_current_scope",31],
  ["academic_terms","academic_calendar_current_scope","guard_academic_calendar_current_scope",31],
  ["academic_sessions","academic_calendar_final_state","guard_academic_calendar_final_state",29],
  ["academic_terms","academic_calendar_final_state","guard_academic_calendar_final_state",29],
  ["academic_sessions","academic_calendar_truncate","guard_academic_calendar_truncate",34],
  ["academic_terms","academic_calendar_truncate","guard_academic_calendar_truncate",34],
  ["academic_calendar_rollovers","academic_calendar_rollover_history","guard_academic_calendar_rollover_history",27],
  ["academic_calendar_rollovers","academic_calendar_rollover_truncate","guard_academic_calendar_rollover_history",34],
 ] as const;
 if(expected.some(([table,name,fn,type])=>!guards.some(g=>g.relname===table&&g.tgname===name&&g.proname===fn&&Number(g.tgtype)===type)))
  throw new CalendarRolloverUnavailable("CALENDAR_ROLLOVER_GUARDS_REQUIRED");
 if(["academic_sessions","academic_terms"].some(table=>!guards.some(g=>g.relname===table
   &&g.tgname==="academic_calendar_final_state"&&g.tgdeferrable===true&&g.tginitdeferred===true&&Number(g.tgconstraint)>0)))
  throw new CalendarRolloverUnavailable("CALENDAR_FINAL_STATE_CONSTRAINT_REQUIRED");
 const indexes=(await c.query(`SELECT n.relname,i.indisunique,i.indisvalid,pg_get_indexdef(i.indexrelid) AS definition,
   pg_get_expr(i.indpred,i.indrelid) AS predicate FROM pg_index i JOIN pg_class n ON n.oid=i.indexrelid
   JOIN pg_namespace ns ON ns.oid=n.relnamespace WHERE ns.nspname='public' AND n.relname=ANY($1::text[])`,
  [["academic_sessions_one_current_school","academic_terms_one_current_school"]])).rows;
 if(indexes.length!==2||indexes.some(i=>!i.indisunique||!i.indisvalid||!i.definition.includes("(school_id)")||i.predicate!=="is_current"))
  throw new CalendarRolloverUnavailable("CALENDAR_CURRENT_UNIQUENESS_REQUIRED");
}
/** One fresh transaction per school; no saved test clock or caller-supplied date.
 * Coordinate with academic edits and future-authorization SHARE locks in the
 * existing financial-gate -> school-calendar-lock order. */
export async function rolloverSchoolCalendar(pool:CalendarPool,schoolId:number){
 if(!Number.isSafeInteger(schoolId)||schoolId<1)throw Error("INVALID_SCHOOL_ID");
 return boundedCalendarTransaction(pool,async c=>{
  await requireCalendarRolloverSchema(c);
  const locked=(await c.query("SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked",[`academic-calendar:${schoolId}`])).rows[0]?.locked;
  if(!locked)return {schoolId,status:"BUSY",changes:0};
  const school=(await c.query("SELECT id FROM schools WHERE id=$1 AND upper(status)='ACTIVE' FOR SHARE",[schoolId])).rows[0];
  if(!school)return {schoolId,status:"SCHOOL_UNAVAILABLE",changes:0};
  const sessions=(await c.query(`SELECT id,school_id AS "schoolId",name,to_char(start_date,'YYYY-MM-DD') AS "startDate",to_char(end_date,'YYYY-MM-DD') AS "endDate",
   status,is_current AS "isCurrent",updated_at::text AS "updatedAt" FROM academic_sessions WHERE school_id=$1 ORDER BY id FOR UPDATE`,[schoolId])).rows as CalendarPeriod[];
  const terms=(await c.query(`SELECT id,school_id AS "schoolId",academic_session_id AS "sessionId",name,to_char(start_date,'YYYY-MM-DD') AS "startDate",to_char(end_date,'YYYY-MM-DD') AS "endDate",
   status,is_current AS "isCurrent",updated_at::text AS "updatedAt" FROM academic_terms WHERE school_id=$1 ORDER BY id FOR UPDATE`,[schoolId])).rows as CalendarTerm[];
  const today=(await c.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'Africa/Lagos','YYYY-MM-DD') AS today")).rows[0].today;
  const plan=planAcademicCalendarRollover(schoolId,today,sessions,terms);
  if(!sessions.length&&!terms.length)return {schoolId,status:"CALENDAR_NOT_CONFIGURED",changes:0};
  if(!plan.changes.length&&plan.status==="READY")return {schoolId,status:"UNCHANGED",changes:0};
  // Clear outgoing markers before either target activation. Future dates,
  // placements, subscription rows and financial evidence are never modified.
  const ordered=[...plan.changes.filter(p=>!p.to.isCurrent),
   ...plan.changes.filter(p=>p.to.isCurrent&&p.kind==="SESSION"),
   ...plan.changes.filter(p=>p.to.isCurrent&&p.kind==="TERM")];
  for(const change of ordered){
   const table=change.kind==="TERM"?"academic_terms":"academic_sessions";
   const rows=(await c.query(`UPDATE ${table} SET status=$3,is_current=$4,updated_at=clock_timestamp()
    WHERE id=$1 AND school_id=$2 AND status=$5 AND is_current=$6 RETURNING id`,
    [change.id,schoolId,change.to.status,change.to.isCurrent,change.from.status,change.from.isCurrent])).rows;
   if(rows.length!==1)throw Error("CALENDAR_STATE_CHANGED_DURING_ROLLOVER");
  }
  const afterDay=(await c.query("SELECT to_char(clock_timestamp() AT TIME ZONE 'Africa/Lagos','YYYY-MM-DD') AS today")).rows[0].today;
  if(afterDay!==today)throw Error("CALENDAR_DAY_CHANGED_RETRY_NEXT_TICK");
  // Closing stale markers can change the source on the first blocked tick.
  // The same invalid material is still one observation, not a second event.
  const key=calendarDigest({schoolId,today,material:plan.calendarDigest,
   source:plan.status==="READY"&&plan.changes.length?plan.sourceDigest:null,status:plan.status,errors:plan.errors,
   target:[plan.sessionId,plan.termId]});
  const audit=(await c.query(`INSERT INTO academic_calendar_rollovers(school_id,effective_date,event_key,
   calendar_digest,source_digest,result,academic_session_id,academic_term_id,changes,issues,calendar_snapshot)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb) ON CONFLICT(event_key) DO NOTHING RETURNING id`,
   [schoolId,today,key,plan.calendarDigest,plan.sourceDigest,plan.status==="BLOCKED"?"BLOCKED":"TRANSITIONED",
    plan.sessionId,plan.termId,JSON.stringify(plan.changes),JSON.stringify(plan.errors),JSON.stringify({sessions,terms})])).rows[0];
  if(audit)await c.query(`INSERT INTO audit_logs("user",role,school_id,action,module,record_id,event_type,result,metadata)
   VALUES('Academic calendar scheduler','SYSTEM',$1,'Academic calendar rollover','Academics',$2,
    'ACADEMIC_CALENDAR_ROLLOVER',$3,$4::jsonb)`,[schoolId,audit.id,plan.status==="BLOCKED"?"BLOCKED":"SUCCESS",
    JSON.stringify({effectiveDate:today,timezone:"Africa/Lagos",eventKey:key,changes:plan.changes,issues:plan.errors})]);
  return {schoolId,status:plan.status,changes:plan.changes.length};
 });
}
