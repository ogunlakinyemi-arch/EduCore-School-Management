import {AuthError} from "../middlewares/auth";

export type CardSql={query(sql:string,values?:any[]):Promise<{rows:any[]}>};
export const graceRestrictionCodes=[
  "NFC_FLUTTERWAVE_PAYMENT_REQUIRED","STUDENT_PLATFORM_SUBSCRIPTION_REQUIRED","SUBSCRIPTION_REQUIRED",
] as const;
export function isGraceRestriction(error:unknown):boolean {
  return error instanceof AuthError && [403,409].includes(error.statusCode) &&
    (graceRestrictionCodes as readonly string[]).includes(error.eventType);
}
export type CardControlEvent={
  id:number;action:string;reason:string;actorUserId:number|null;createdAt:string;
  details:Record<string,any>|null;
};

/** Append-only existing card history is the authority. No parallel payment or mutable grace balance. */
export async function readCardControlEvidence(db:CardSql,cardId:number,schoolId:number,studentId:number){
  const row=(await db.query(`SELECT
    clock_timestamp() AS "now",
    (SELECT uid FROM nfc_cards WHERE id=$1 AND school_id=$2 AND student_id=$3) AS "currentUid",
    COALESCE((SELECT max(id) FROM nfc_card_history WHERE nfc_card_id=$1 AND school_id=$2),0)::int AS version,
    COALESCE((SELECT max(id) FROM nfc_card_history WHERE nfc_card_id=$1 AND school_id=$2
      AND action IN ('REGISTERED','ASSIGNED','REASSIGNED','UNLINKED','OWNER_DETACHED')),0)::int AS "assignmentVersion",
    (SELECT row_to_json(g) FROM (
      SELECT id,action,reason,actor_user_id AS "actorUserId",created_at AS "createdAt",student_id AS "studentId"
      FROM nfc_card_history WHERE nfc_card_id=$1 AND school_id=$2
        AND action IN ('OWNER_GRACE_GRANTED','OWNER_GRACE_REVOKED') ORDER BY id DESC LIMIT 1
    ) g) AS "latestGrace",
    COALESCE((SELECT json_agg(e ORDER BY e.id DESC) FROM (
      SELECT id,action,reason,actor_user_id AS "actorUserId",created_at AS "createdAt"
      FROM nfc_card_history WHERE nfc_card_id=$1 AND school_id=$2 AND student_id=$3
      ORDER BY id DESC LIMIT 30
    ) e),'[]'::json) AS events`,[cardId,schoolId,studentId])).rows[0];
  if(!row)throw new AuthError(503,"Card control evidence is unavailable");
  const parse=(event:any):CardControlEvent=>{
    let details:Record<string,any>|null=null;
    if(String(event.action).startsWith("OWNER_")){
      try{const value=JSON.parse(event.reason);if(value && typeof value==="object")details=value;}catch{/* Legacy text remains visible, never grants grace. */}
    }
    return {...event,createdAt:new Date(event.createdAt).toISOString(),
      reason:details?.reason??event.reason??"No recorded reason",details};
  };
  return {version:Number(row.version),assignmentVersion:Number(row.assignmentVersion),currentUid:row.currentUid,
    now:new Date(row.now).toISOString(),events:(row.events??[]).map(parse),
    latestGrace:row.latestGrace?{...parse(row.latestGrace),studentId:Number(row.latestGrace.studentId)}:null};
}

export async function readGraceAcademicTerm(db:CardSql,schoolId:number){
  const rows=(await db.query(`SELECT t.id,t.end_date::text AS "endDate" FROM academic_terms t
    JOIN academic_sessions s ON s.id=t.academic_session_id AND s.school_id=t.school_id
    WHERE t.school_id=$1 AND t.is_current=true AND upper(t.status)='ACTIVE'
      AND s.is_current=true AND upper(s.status)='ACTIVE'
      AND (SELECT count(*) FROM academic_terms current_term WHERE current_term.school_id=$1
        AND current_term.is_current=true AND upper(current_term.status)='ACTIVE')=1
      AND (clock_timestamp() AT TIME ZONE 'Africa/Lagos')::date BETWEEN t.start_date AND t.end_date`,
  [schoolId])).rows;
  return rows.length===1?rows[0]:null;
}

export async function readStudentCardGrace(db:CardSql,cardId:number,schoolId:number,studentId:number,
  evidence?:Awaited<ReturnType<typeof readCardControlEvidence>>){
  const e=evidence??await readCardControlEvidence(db,cardId,schoolId,studentId);
  const last=e.latestGrace;
  if(!last)return {state:"NONE",grant:null};
  const d=last.details;
  if(last.action==="OWNER_GRACE_REVOKED")return {state:"REVOKED",grant:last};
  if(!d || last.studentId!==studentId || d.assignmentVersion!==e.assignmentVersion ||
      d.cardId!==cardId || d.schoolId!==schoolId || d.studentId!==studentId || d.uid!==e.currentUid ||
      !Array.isArray(d.restrictions) || !d.restrictions.length ||
      d.restrictions.some((code:unknown)=>typeof code!=="string" || !(graceRestrictionCodes as readonly string[]).includes(code)))
    return {state:"INVALIDATED",grant:last};
  if(!Number.isFinite(Date.parse(d.expiresAt)) || Date.parse(d.expiresAt)<=Date.parse(e.now))
    return {state:"EXPIRED",grant:last};
  const term=await readGraceAcademicTerm(db,schoolId);
  if(!term || Number(term.id)!==d.termId)return {state:"INVALIDATED",grant:last};
  return {state:"ACTIVE",grant:last};
}

/** Only confirmed payment denials can be waived. Outages/unknown status and all safety denials fail closed. */
export async function assertCardPaymentRestriction(db:CardSql,cardId:number,schoolId:number,studentId:number,
  check:()=>Promise<void>){
  try{await check();}
  catch(error){
    if(!(error instanceof AuthError) || !isGraceRestriction(error))throw error;
    const grace=await readStudentCardGrace(db,cardId,schoolId,studentId);
    if(grace.state!=="ACTIVE" || !grace.grant?.details?.restrictions?.includes(error.eventType))throw error;
  }
}
