import {readFreeTermGrant} from "./owner-free-academic-term-read";
import {nfcTermWindow,lagosDate} from "./nfc-term-grace";
export {lagosDate} from "./nfc-term-grace";
/** Business approval is not merchant/release approval. Never creates obligations or payments. */
export const STUDENT_LAUNCH_POLICY = Object.freeze({
  approvedOn: "2026-10-27", effectiveOn: "2026-10-27",
  studentAmountMinor: 320000, broAmountMinor: 15000,
  schoolShareMinor: 0, collectionBroShareMinor: 0,
});
export type RolloutTerm = {
  id:number;schoolId:number;name:string;startDate:string;endDate:string;
  isCurrent:boolean;status:string;sessionStatus:string;
};
/** Compatibility export: no national-date free period. Saved calendars and
 * explicit Owner grants now determine prospective NFC access. */
export const initialStudentFreePeriod=(_today=lagosDate())=>false;
const validDates=(t:RolloutTerm)=>/^\d{4}-\d{2}-\d{2}$/.test(t.startDate)
  && /^\d{4}-\d{2}-\d{2}$/.test(t.endDate)
  && Number.isFinite(Date.parse(t.startDate)) && Number.isFinite(Date.parse(t.endDate))
  && t.endDate>=t.startDate;
export function studentRolloutDecision(terms:RolloutTerm[],schoolId:number,termId:number|undefined,today=lagosDate()){
  const scoped=terms.filter(t=>t.schoolId===schoolId);
  const targets=scoped.filter(t=>termId===undefined?t.isCurrent&&t.status.toUpperCase()==="ACTIVE"
    &&t.sessionStatus.toUpperCase()==="ACTIVE"&&t.startDate<=today&&t.endDate>=today:t.id===termId);
  const target=targets.length===1?targets[0]:null;
  const periodEligible=!!target&&validDates(target)&&!["CANCELLED","DELETED","INACTIVE"].includes(target.status.toUpperCase())
    &&!["CANCELLED","DELETED","INACTIVE"].includes(target.sessionStatus.toUpperCase());
  const window=target&&validDates(target)?nfcTermWindow(target.startDate,target.endDate,today):null;
  const chargeable=periodEligible&&target!.isCurrent&&window?.checkoutOpen===true
    &&target!.status.toUpperCase()==="ACTIVE"&&target!.sessionStatus.toUpperCase()==="ACTIVE";
  return {policy:STUDENT_LAUNCH_POLICY,chargeable,periodEligible,freeAccess:!chargeable,
    launchTermId:target?.id??null,collectionStartDate:window?.enforcementDate??null,termId:target?.id??termId??null,
    enforcementDate:window?.enforcementDate??null,inGracePeriod:window?.inGracePeriod??false,
    termStartDate:target?.startDate??null,
    reason:chargeable?"COLLECTION_TERM_ELIGIBLE":!periodEligible?"CURRENT_TERM_UNAVAILABLE"
      :window?.inGracePeriod?"NFC_RESUMPTION_GRACE":today<target!.startDate?"COLLECTION_TERM_NOT_STARTED":"TERM_NOT_OPEN"};
}
export async function readStudentRollout(db:{query:(sql:string,values?:any[])=>Promise<{rows:any[]}>},
  schoolId:number,termId?:number,today=lagosDate()){
  const {rows}=await db.query(`SELECT t.id,t.school_id AS "schoolId",t.name,
    t.start_date::text AS "startDate",t.end_date::text AS "endDate",
    (t.is_current AND s.is_current) AS "isCurrent",t.status,s.status AS "sessionStatus"
    FROM academic_terms t JOIN academic_sessions s ON s.id=t.academic_session_id AND s.school_id=t.school_id
    WHERE t.school_id=$1 ORDER BY t.start_date,t.id`,[schoolId]);
  return studentRolloutDecision(rows,schoolId,termId,today);
}

/** Prospective ordinary platform usage/checkout only. Historical verification,
 * BRO accrual and physical-card payment evidence retain the base rollout above. */
export async function readStudentUsageRollout(db:Parameters<typeof readStudentRollout>[0],
  schoolId:number,termId?:number,today=lagosDate()) {
  const rollout=await readStudentRollout(db,schoolId,termId,today);
  if(!rollout.chargeable||!rollout.termId)return rollout;
  const grant=await readFreeTermGrant(db,schoolId,rollout.termId,today);
  return grant?.active?{...rollout,chargeable:false,freeAccess:true,reason:"OWNER_FREE_ACADEMIC_TERM"}:rollout;
}
