import {AuthError} from "../middlewares/auth";
import {readStudentCardReadiness} from "./student-card-readiness";
import {readCardControlEvidence,readGraceAcademicTerm,type CardSql} from "./student-card-controls";

export type StudentCardControlInput={
  schoolId:number;studentId:number;version:number;confirm:boolean;reason:string;
  action:"LOCK"|"UNLOCK"|"GRANT_GRACE"|"REVOKE_GRACE";expiresAt?:string;restrictions?:string[];
};

/** Caller owns the transaction. The same card-row lock is used by all existing assignment/status writers. */
export async function controlStudentCard(db:CardSql,cardId:number,actorUserId:number,b:StudentCardControlInput){
  const card=(await db.query(`SELECT id,uid,status,student_id AS "studentId"
    FROM nfc_cards WHERE id=$1 AND school_id=$2 FOR UPDATE`,[cardId,b.schoolId])).rows[0];
  if(!card || Number(card.studentId)!==b.studentId)throw new AuthError(404,"The selected student/card assignment changed. Refresh before acting.");
  if(b.confirm!==true || typeof b.reason!=="string" || b.reason.trim().length<3 || b.reason.trim().length>480)
    throw new AuthError(400,"Confirmation and a 3–480 character reason are required");
  const before=await readStudentCardReadiness(db,cardId,b.schoolId,b.studentId);
  if(before.version!==b.version)throw new AuthError(409,"Card history changed since your review. Refresh and confirm the current state; no action was applied.");
  const reason=b.reason.trim();
  let action:string;
  let newStatus:string|null=null;
  let details:Record<string,unknown>={reason,cardId,uid:card.uid,schoolId:b.schoolId,studentId:b.studentId,
    scope:b.action==="LOCK"||b.action==="UNLOCK"?"EXACT_STUDENT_CARD":"EXACT_STUDENT_CARD_CURRENT_TERM",
    priorVersion:b.version,previousStatus:card.status,confirmed:true};
  if(b.action==="LOCK"){
    if(!before.canLock)throw new AuthError(409,"Only an active card can receive an administrative lock. Existing security/legacy locks are preserved.");
    action="OWNER_ADMIN_LOCK";newStatus="locked";
  }else if(b.action==="UNLOCK"){
    if(before.stage!=="ADMINISTRATIVE_LOCK" || !before.canActivate)
      throw new AuthError(409,"Only an Owner administrative lock with satisfied current eligibility may be unlocked. Security/legacy locks require their security resolution workflow; staged cards use activation.");
    action="OWNER_ADMIN_UNLOCK";newStatus="active";
  }else if(b.action==="GRANT_GRACE"){
    if(!before.canGrantGrace)throw new AuthError(409,"Grace requires a confirmed payment restriction and no safety restriction. It cannot activate a staged card, clear a security lock or replace missing reader/account/identity authorization.");
    const eligible=before.restrictions.filter(r=>r.overridable).map(r=>r.code);
    if(!b.restrictions?.length || new Set(b.restrictions).size!==b.restrictions.length ||
        b.restrictions.some(code=>!eligible.includes(code)))
      throw new AuthError(400,"Select only the currently confirmed, eligible payment restrictions to cover");
    if(!b.expiresAt || !/(Z|[+-]\d{2}:\d{2})$/.test(b.expiresAt) || !Number.isFinite(Date.parse(b.expiresAt)))
      throw new AuthError(400,"Expiry must be an ISO date/time with an explicit timezone offset");
    const term=await readGraceAcademicTerm(db,b.schoolId);
    const end=term?Date.parse(`${String(term.endDate).slice(0,10)}T23:59:59.999+01:00`):NaN;
    if(!term || !Number.isFinite(end))throw new AuthError(409,"A unique active current academic term is required for grace");
    if(Date.parse(b.expiresAt)<=Date.parse(before.serverNow) || Date.parse(b.expiresAt)>end)
      throw new AuthError(400,"Grace expiry must be in the future and no later than the current term's end (Africa/Lagos)");
    const evidence=await readCardControlEvidence(db,cardId,b.schoolId,b.studentId);
    action="OWNER_GRACE_GRANTED";
    details={...details,expiresAt:new Date(b.expiresAt).toISOString(),restrictions:b.restrictions,
      termId:Number(term.id),assignmentVersion:evidence.assignmentVersion};
  }else if(b.action==="REVOKE_GRACE"){
    if(!before.canRevokeGrace)throw new AuthError(409,"There is no active grace period to revoke");
    action="OWNER_GRACE_REVOKED";
    details={...details,grantId:before.grace.grant?.id,restrictions:before.grace.grant?.details?.restrictions,
      expiresAt:before.grace.grant?.details?.expiresAt};
  }else throw new AuthError(400,"Unknown card control action");
  if(newStatus){
    details.newStatus=newStatus;
    await db.query(`UPDATE nfc_cards SET status=$1 WHERE id=$2`,[newStatus,cardId]);
  }
  await db.query(`INSERT INTO nfc_card_history
    (school_id,nfc_card_id,student_id,action,previous_status,new_status,actor_user_id,reason)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
    [b.schoolId,cardId,b.studentId,action,newStatus?card.status:null,newStatus,actorUserId,
      newStatus?reason:JSON.stringify(details)]);
  await db.query(`INSERT INTO audit_logs
    ("user",role,actor_user_id,school_id,action,module,record_id,event_type,result,metadata)
    VALUES('Platform Owner','PLATFORM_OWNER',$1,$2,$3,'NFC Cards',$4,$3,'SUCCESS',$5::jsonb)`,
    [actorUserId,b.schoolId,action,cardId,JSON.stringify(details)]);
  return readStudentCardReadiness(db,cardId,b.schoolId,b.studentId);
}
