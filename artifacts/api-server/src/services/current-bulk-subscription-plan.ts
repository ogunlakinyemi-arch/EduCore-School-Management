import {financialTransaction} from "./financial-transaction";
import {readStudentRollout} from "./student-platform-rollout";
import {demand,requestKey,type CurrentPool,type CurrentSql} from "./current-financial-contract";
import {appendState,createOperation,digest,requireCurrentLifecycle} from "./current-financial-store";

type BulkInput={schoolId:number;termId:number;studentIds:number[];key:string;reason:string};
async function schoolAuthority(c: CurrentSql, actorId: number, schoolId: number) {
  const ok=(await c.query(`SELECT EXISTS(SELECT 1 FROM app_users u
    JOIN school_memberships m ON m.user_id=u.id
    JOIN schools s ON s.id=$2 AND lower(s.status)='active'
    WHERE u.id=$1 AND u.status='ACTIVE' AND m.status='ACTIVE'
      AND ((m.role IN ('SCHOOL_ADMIN','ACCOUNTANT') AND m.school_id=$2
        AND NOT EXISTS(SELECT 1 FROM school_memberships own WHERE own.user_id=u.id AND own.role='PLATFORM_OWNER'))
        OR (m.role='PLATFORM_OWNER' AND m.school_id IS NULL))
      AND NOT EXISTS(SELECT 1 FROM school_memberships restricted WHERE restricted.user_id=u.id
        AND restricted.status='ACTIVE' AND restricted.role IN ('DEVICE_ACTIVATION_OFFICER','COMPANY_ACCOUNTANT'))
    FOR SHARE OF u,m,s) AS authorized`,[actorId,schoolId])).rows[0]?.authorized;
  demand(ok===true,"SCHOOL_FINANCIAL_SCOPE_NOT_AUTHORIZED");
}
/**
 * Persisted REVIEW-ONLY plan, not a reservation, payment or receipt.
 * Real checkout is deliberately absent until aggregate evidence can satisfy the
 * retained direct-attempt/BRO guards. Never fans out individual provider POSTs.
 */
export async function planCurrentBulkSubscriptions(pool: CurrentPool, actorId: number,input: BulkInput,
  deps: {now?:()=>Date; review:(c:CurrentSql,scope:{schoolId:number;studentId:number;termId:number})=>
    Promise<{ready:boolean;ruleId:number;ruleVersion:number;reviewId:number;digest:string}>}) {
  requestKey(input.key);
  demand(Number.isSafeInteger(input.schoolId)&&input.schoolId>0&&Number.isSafeInteger(input.termId)
    &&input.termId>0,"EXPLICIT_SCHOOL_AND_TERM_REQUIRED");
  demand(input.studentIds.length>0&&input.studentIds.every(id=>Number.isSafeInteger(id)&&id>0)
    &&new Set(input.studentIds).size===input.studentIds.length,"DISTINCT_STUDENT_SELECTION_REQUIRED");
  const ids=[...input.studentIds].sort((a,b)=>a-b);
  return financialTransaction(pool,async c=>{
    await schoolAuthority(c,actorId,input.schoolId);
    await requireCurrentLifecycle(c);
    const rollout=await readStudentRollout(c,input.schoolId,input.termId,
      deps.now?new Intl.DateTimeFormat("en-CA",{timeZone:"Africa/Lagos",year:"numeric",month:"2-digit",day:"2-digit"})
        .format(deps.now()):undefined);
    demand(rollout.chargeable,"FREE_OR_INELIGIBLE_TERM");
    const selected=[];
    for (const studentId of ids) {
      const row=(await c.query(`SELECT st.id,o.id AS obligation_id,o.amount_minor,
        EXISTS(SELECT 1 FROM student_direct_live_attempts a WHERE a.obligation_id=o.id
          AND a.state<>'FAILED') AS occupied,
        EXISTS(SELECT 1 FROM student_subscription_terms legacy WHERE legacy.student_id=st.id
          AND legacy.academic_term_id=$3) AS legacy_obligation
        FROM students st LEFT JOIN student_direct_live_obligations o ON o.student_id=st.id
          AND o.school_id=st.school_id AND o.academic_term_id=$3
        WHERE st.id=$1 AND st.school_id=$2 AND lower(st.status)='active'
          AND upper(st.admission_status)='ADMITTED' FOR SHARE OF st`,
        [studentId,input.schoolId,input.termId])).rows[0];
      demand(row&&!row.occupied&&!row.legacy_obligation
        &&(row.obligation_id===null||Number(row.amount_minor)===320000),"STUDENT_NOT_ELIGIBLE_FOR_ORDINARY_BULK");
      const review=await deps.review(c,{schoolId:input.schoolId,studentId,termId:input.termId});
      demand(review.ready && Number.isSafeInteger(review.ruleId)&&review.ruleId>0
        &&Number.isSafeInteger(review.ruleVersion)&&review.ruleVersion>0
        &&Number.isSafeInteger(review.reviewId)&&review.reviewId>0
        &&/^[a-f0-9]{64}$/.test(review.digest),"MATCHING_RULE_RELEASE_REVIEW_REQUIRED");
      selected.push({studentId,obligationId:row.obligation_id===null?null:Number(row.obligation_id),
        amountMinor:320000,currency:"NGN",schoolShareMinor:0,broShareMinor:0,review});
    }
    const total=selected.length*320000;
    demand(Number.isSafeInteger(total),"AGGREGATE_AMOUNT_OVERFLOW");
    const snapshot={schoolId:input.schoolId,termId:input.termId,students:selected,totalMinor:total,
      currency:"NGN",initiator:actorId,policy:"REVIEW_ONLY_NO_PAYMENT_RESERVATION"};
    const root=await createOperation(c,{kind:"BULK_PLAN",key:input.key,schoolId:input.schoolId,
      termId:input.termId,amountMinor:total,actorId,reason:input.reason,snapshot});
    await appendState(c,Number(root.id),"REVIEW_ONLY","plan",actorId,{digest:digest(snapshot),moneyMoved:false});
    return {id:Number(root.id),snapshot:root.snapshot,digest:digest(root.snapshot),
      checkoutEnabled:false as const,blocker:"AGGREGATE_ALLOCATION_SOURCE_CONTRACT_REQUIRED"};
  });
}
