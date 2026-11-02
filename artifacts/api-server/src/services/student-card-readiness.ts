import {AuthError} from "../middlewares/auth";
import {assertSchoolHasActiveNfcDevice} from "../lib/nfc-device-first";
import {assertVerifiedStudentNfcPayment} from "./student-nfc-payment-evidence";
import {assertSubscriptionAccess} from "./subscription-enforcement";
import {readStudentRollout} from "./student-platform-rollout";
import {assertCardPaymentRestriction,isGraceRestriction,readCardControlEvidence,readStudentCardGrace} from "./student-card-controls";

type Db={query(sql:string,values?:any[]):Promise<{rows:any[]}>};

/** The same independent prerequisites used for attendance; never changes them. */
export async function assertStudentCardUsePrerequisites(db:Db,schoolId:number,studentId:number,cardId?:number){
  const subscription=()=>assertSubscriptionAccess(schoolId,studentId,db);
  const payment=()=>assertVerifiedStudentNfcPayment(db,schoolId,studentId);
  if(cardId!=null){
    await assertCardPaymentRestriction(db,cardId,schoolId,studentId,subscription);
    await assertCardPaymentRestriction(db,cardId,schoolId,studentId,payment);
  }else{await subscription();await payment();}
  await assertSchoolHasActiveNfcDevice(db,schoolId);
  const policy=(await db.query(`SELECT policy FROM student_identification_policies
    WHERE school_id=$1 AND student_id=$2 AND status='ACTIVE'`,[schoolId,studentId])).rows[0]?.policy;
  if(policy==="BIOMETRIC_ONLY")throw new AuthError(409,
    "This student's identification policy is BIOMETRIC_ONLY. Review the existing identification policy workflow; card activation cannot override it.",
    "IDENTIFICATION_POLICY_RESTRICTED");
}

/** Read-only explanation for one exact current assignment, not a person-level lock. */
export async function readStudentCardReadiness(db:Db,cardId:number,schoolId:number,studentId:number){
  const rollout=await readStudentRollout(db,schoolId);
  const card=(await db.query(`SELECT nc.id,nc.uid,nc.status,nc.student_id AS "studentId",
      nc.replaced_by_card_id AS "replacedByCardId",nc.replaced_at AS "replacedAt",nc.expires_at AS "expiresAt",
      st.status AS "studentStatus",sc.status AS "schoolStatus",
      (SELECT count(*)::int FROM employee_nfc_card_bindings b WHERE b.nfc_card_id=nc.id) AS "employeeBindings",
      (SELECT count(*)::int FROM nfc_cards other WHERE other.school_id=nc.school_id
        AND other.student_id=nc.student_id AND lower(other.status) IN ('active','locked')) AS "currentCards"
    FROM nfc_cards nc JOIN schools sc ON sc.id=nc.school_id
    LEFT JOIN students st ON st.id=nc.student_id AND st.school_id=nc.school_id
    WHERE nc.id=$1 AND nc.school_id=$2`,[cardId,schoolId])).rows[0];
  if(!card || Number(card.studentId)!==studentId)throw new AuthError(404,"This is no longer the selected student's current card. Refresh the person and card list.");
  const status=String(card.status).toLowerCase();
   const restrictions:Array<{code:string;message:string;resolution:string;overridable?:boolean;waived?:boolean}>=[];
  const deny=(code:string,message:string,resolution:string)=>restrictions.push({code,message,resolution});
  if(card.employeeBindings || (["active","locked"].includes(status) && Number(card.currentCards)!==1))
    deny("ASSIGNMENT_CONFLICT","The card has conflicting or multiple current assignments.","Owner must review the retained assignment history; do not create another assignment.");
  if(String(card.studentStatus).toUpperCase()!=="ACTIVE")deny("STUDENT_INACTIVE","The selected student's account is not ACTIVE.","Resolve the student's account status through the existing school administration workflow.");
  if(String(card.schoolStatus).toUpperCase()!=="ACTIVE")deny("SCHOOL_INACTIVE","The school is not ACTIVE.","Resolve the school restriction through existing Owner school controls.");
  if(card.replacedByCardId!=null || card.replacedAt!=null)deny("CARD_REPLACED","This UID has been replaced and must not be reactivated.","Use the retained replacement request and its new UID.");
  if(card.expiresAt && new Date(card.expiresAt).getTime()<=Date.now())deny("CARD_EXPIRED","This physical card has expired.","Use the existing renewal/replacement workflow; unlock cannot extend expiry.");
  if(!["active","locked"].includes(status))deny("CARD_RESTRICTED",`This physical card is ${status}, not awaiting ordinary activation.`,"Lost/stolen cards require the paid replacement workflow. Other restrictions require their existing review workflow; this action cannot clear them.");
  const history=status==="locked"?(await db.query(`SELECT action,reason,previous_status AS "previousStatus"
    FROM nfc_card_history WHERE nfc_card_id=$1 AND school_id=$2 AND lower(new_status)='locked'
    ORDER BY id DESC LIMIT 1`,[cardId,schoolId])).rows[0]:null;
  const staged=status==="locked" && ["REGISTERED","REASSIGNED","ASSIGNED"].includes(history?.action);
   const administrative=status==="locked" && history?.action==="OWNER_ADMIN_LOCK";
   const stage=status==="active"?"ACTIVE":status==="locked"?(staged?"AWAITING_ACTIVATION":administrative?"ADMINISTRATIVE_LOCK":"SECURITY_LOCK"):"RESTRICTED";
  const explanation=staged
    ?rollout.chargeable?"This linked card is awaiting initial Owner activation. Current-term subscription and non-payment safeguards apply."
      :"This linked card is awaiting Owner activation. Activation is free for the current pre-subscription term, including newly assigned and reassigned cards."
     :status==="locked"?`This card has an ${administrative?"Owner administrative":"independent security/legacy"} lock. Recorded reason: ${history?.reason || "No reason was recorded in the legacy history; review the card history before unlocking."}`
    :status==="active"?"This UID is active. Reader, account and attendance policy checks still apply.":`This UID is ${status}.`;
   const evidence=await readCardControlEvidence(db,cardId,schoolId,studentId);
   const grace=await readStudentCardGrace(db,cardId,schoolId,studentId,evidence);
   if(stage==="SECURITY_LOCK")deny("SECURITY_LOCK","Security/legacy locks cannot be manually overridden here.","Review the original security incident through its security resolution workflow. Payment grace never clears this lock.");
   const checks=[
     ()=>assertSubscriptionAccess(schoolId,studentId,db),
     ()=>assertVerifiedStudentNfcPayment(db,schoolId,studentId),
     ()=>assertSchoolHasActiveNfcDevice(db,schoolId),
     async()=>{
       const policy=(await db.query(`SELECT policy FROM student_identification_policies
         WHERE school_id=$1 AND student_id=$2 AND status='ACTIVE'`,[schoolId,studentId])).rows[0]?.policy;
       if(policy==="BIOMETRIC_ONLY")throw new AuthError(409,"This student's identification policy is BIOMETRIC_ONLY.","IDENTIFICATION_POLICY_RESTRICTED");
     },
   ];
   for(const check of checks){
     try{await check();}
     catch(error){
       if(!(error instanceof AuthError))throw error;
       const overridable=isGraceRestriction(error);
       const waived=!staged && overridable && grace.state==="ACTIVE" &&
         grace.grant?.details?.restrictions?.includes(error.eventType)===true;
       restrictions.push({code:error.eventType,message:error.message,overridable,waived,
         resolution:overridable
           ?"Complete the existing independently verified payment workflow. Unlock cannot substitute payment; an explicit temporary Owner grace covers only its listed restrictions."
           :error.eventType==="NFC_DEVICE_REQUIRED"?"Link an eligible NFC reader through existing device management."
           :"Resolve this restriction through its existing security, school, account or identification-policy workflow. Owner unlock and grace cannot override it."});
     }
   }
   const blocked=restrictions.filter(r=>!r.waived);
   const canGrace=["ACTIVE","ADMINISTRATIVE_LOCK"].includes(stage) &&
     !restrictions.some(r=>!r.overridable) && restrictions.some(r=>r.overridable) && grace.state!=="ACTIVE";
  return {cardId,schoolId,studentId,uid:String(card.uid),status,stage,explanation,
     subscriptionPolicy:{paymentRequired:rollout.chargeable,collectionStartDate:rollout.collectionStartDate,
       launchTermId:rollout.launchTermId,termId:rollout.termId,reason:rollout.reason,earliestCollectionDate:`${rollout.policy.anchorMonth}-01`},
     canActivate:status==="locked" && stage!=="SECURITY_LOCK" && blocked.length===0,
     canPrint:status==="active" && blocked.length===0,restrictions,
     version:evidence.version,canLock:status==="active",canGrantGrace:canGrace,
     canRevokeGrace:grace.state==="ACTIVE",grace,history:evidence.events,serverNow:evidence.now,
     effectiveStatus:status!=="active"?stage:blocked.length?"INELIGIBLE":restrictions.some(r=>r.waived)?"ELIGIBLE_BY_GRACE":"ELIGIBLE",
     statusSource:status!=="active"?"CARD_STATE":blocked.length?"RESTRICTION":restrictions.some(r=>r.waived)?"OWNER_TEMPORARY_GRACE":"NORMAL_POLICY"};
}
