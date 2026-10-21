import type { CommunicationQueryClient } from "./communication-service";
import { familyChildSchoolScope } from "../lib/family-child-school-scope";
import { AuthError } from "../middlewares/auth";
import { readManualSchoolState } from "./school-subscription-lock";
import { subscriptionPolicy } from "./subscription-enforcement-policy";
import {
  assertLiveApplicationContext, liveVerifiedIssuance, readLiveApplicationReceipt,
  type LiveApplicationContext,
} from "./flutterwave-live-application";
import { GetMySubscriptionEnforcementResponseItem } from "@workspace/api-zod";
import { LiveFinalizationBlocked } from "../lib/flutterwave-live-verification";

/** No client school, merchant, session, term, intent or legacy payment IDs.
 * Caller pins a repeatable-read, read-only transaction for identity + evidence.
 * A failed/adverse REPORT never asserts provider disbursement or settlement. */
export async function readLiveFamilyAccess(db: CommunicationQueryClient, actorId: number,
  context: LiveApplicationContext, selection: {studentId?: number; audience?: "student" | "parent"} = {}) {
  assertLiveApplicationContext(context);
  if (!Number.isSafeInteger(actorId) || actorId <= 0) throw new AuthError(401, "Sign-in required");
  const children = (await db.query<{schoolId:number;studentId:number;schoolName:string;studentName:string;isSelf:boolean;isParent:boolean}>(
    `SELECT DISTINCT st.school_id AS "schoolId",st.id AS "studentId",sc.name AS "schoolName",
       st.first_name||' '||st.last_name AS "studentName",st.user_id=actor.id AS "isSelf",
       EXISTS(SELECT 1 FROM parents p JOIN parent_student_relationships rel ON rel.parent_id=p.id
        WHERE p.user_id=actor.id AND p.status='ACTIVE' AND rel.status='ACTIVE'
         AND rel.student_id=st.id AND ${familyChildSchoolScope()}) AS "isParent"
     FROM students st JOIN schools sc ON sc.id=st.school_id
     JOIN app_users actor ON actor.id=$1 AND actor.status='ACTIVE'
     WHERE lower(st.status)='active' AND lower(sc.status)='active'
      AND ($2::integer IS NULL OR st.id=$2) AND (
       ($3::text IS DISTINCT FROM 'parent' AND st.user_id=actor.id)
       OR ($3::text IS DISTINCT FROM 'student' AND EXISTS(
        SELECT 1 FROM parents p JOIN parent_student_relationships rel ON rel.parent_id=p.id
        WHERE p.user_id=actor.id AND p.status='ACTIVE' AND rel.status='ACTIVE'
         AND rel.student_id=st.id AND ${familyChildSchoolScope()}))) ORDER BY st.id`,
    [actorId, selection.studentId ?? null, selection.audience ?? null])).rows;
  if (selection.studentId !== undefined && children.length !== 1) throw new AuthError(404, "Student unavailable");
  const output = [];
  for (const child of children) {
    const {isSelf,isParent,...identity} = child;
    const base = {...identity, environment:"LIVE" as const, liveStatus:"UNAVAILABLE" as string,
      audiences:[...(isSelf?["student"]:[]),...(isParent?["parent"]:[])],
      entitled:false, receiptNumber:null as string|null, termName:null as string|null,
      startDate:null as string|null, enforcementDate:null as string|null,
      state:"UNAVAILABLE", restricted:true, restrictionReason:null as string|null};
    const calendar = (await db.query<{termId:number;sessionId:number;termName:string;startDate:string;endDate:string;today:string}>(
      `SELECT t.id AS "termId",ses.id AS "sessionId",t.name AS "termName",t.start_date::text AS "startDate",
        t.end_date::text AS "endDate",(now() AT TIME ZONE 'Africa/Lagos')::date::text AS today
       FROM academic_terms t JOIN academic_sessions ses ON ses.id=t.academic_session_id AND ses.school_id=t.school_id
       WHERE t.school_id=$1 AND t.is_current AND ses.is_current AND upper(t.status)='ACTIVE'
        AND upper(ses.status)='ACTIVE' AND t.start_date<=(now() AT TIME ZONE 'Africa/Lagos')::date
        AND t.end_date>=(now() AT TIME ZONE 'Africa/Lagos')::date`, [child.schoolId])).rows;
    const manual = await readManualSchoolState(db, child.schoolId);
    if (calendar.length === 1) {
      const term = calendar[0];
      Object.assign(base, {termName:term.termName, startDate:term.startDate});
      // Savepoints allow missing LIVE schema to return explicit unavailable children
      // without aborting the identity snapshot or ever reading TEST finances.
      await db.query("SAVEPOINT live_family_read");
      try {
        const intents = (await db.query<{id:string;session_id:number;state:string;on_hold:boolean;entitled:boolean;failed_report:boolean;authoritative:boolean}>(
          `SELECT i.id::text,i.session_id,i.state,i.on_hold,(${liveVerifiedIssuance}) AS entitled,
           (i.issued_by IS NOT NULL AND i.authority_snapshot IS NOT NULL AND i.authority_review_id IS NOT NULL) AS authoritative,
           EXISTS(SELECT 1 FROM flutterwave_live_webhook_receipts wr WHERE wr.environment='LIVE'
            AND wr.signature_verified AND wr.claims->>'reference'=i.reference
            AND wr.claims->>'event'='charge.completed' AND lower(wr.claims->>'status') IN ('failed','cancelled')
            AND wr.claims->>'currency'='NGN' AND wr.claims->>'amount' IN ('5000','5000.00')) AS failed_report
           FROM flutterwave_live_subscription_intents i WHERE i.environment='LIVE'
            AND i.merchant_scope=$1 AND i.school_id=$2 AND i.student_id=$3 AND i.term_id=$4`,
          [context.merchantScope,child.schoolId,child.studentId,term.termId])).rows;
        if (intents.length === 1 && intents[0].session_id === term.sessionId && intents[0].authoritative) {
          const intent = intents[0];
          base.entitled = intent.entitled;
          base.liveStatus = intent.on_hold ? "REFUNDED_REVERSED" : intent.entitled ? "VERIFIED_ACTIVE"
            : intent.state === "PENDING" ? intent.failed_report ? "FAILED" : "PENDING" : "UNAVAILABLE";
          if (intent.state === "COLLECTION_VERIFIED" || intent.on_hold) {
            try {
              const receipt = await readLiveApplicationReceipt(db, {intentId:Number(intent.id),
                schoolId:child.schoolId,studentId:child.studentId,termId:term.termId},context);
              base.receiptNumber = typeof receipt.receipt.receiptNumber === "string" ? receipt.receipt.receiptNumber : null;
            } catch (error) {
              // Missing issuance is unavailable, not an official receipt or paid state.
              if (!(error instanceof LiveFinalizationBlocked) || error.code !== "LIVE_OFFICIAL_RECEIPT_UNAVAILABLE") throw error;
            }
          }
        }
        const policy = subscriptionPolicy(term,[{studentId:child.studentId,paid:base.entitled,waived:false,pending:base.liveStatus==="PENDING"}],term.today);
        base.enforcementDate = policy.enforcementDate;
        base.restricted = base.liveStatus === "UNAVAILABLE" || policy.restrictedStudentIds.length > 0;
        base.state = base.restricted ? "SUBSCRIPTION_RESTRICTED" : policy.state;
        base.restrictionReason = base.restricted ? "SUBSCRIPTION_RESTRICTED" : null;
      } catch (error) {
        await db.query("ROLLBACK TO SAVEPOINT live_family_read");
        if (!["42P01","42703"].includes(String((error as {code?:string}).code))) throw error;
        Object.assign(base,{liveStatus:"UNAVAILABLE",entitled:false,receiptNumber:null,state:"UNAVAILABLE",restricted:true,restrictionReason:null});
      }
      await db.query("RELEASE SAVEPOINT live_family_read");
    }
    if (manual.schoolLocked) Object.assign(base,{restricted:true,state:"SCHOOL_SUBSCRIPTION_LOCKED",restrictionReason:"SCHOOL_SUBSCRIPTION_LOCKED"});
    output.push(GetMySubscriptionEnforcementResponseItem.parse(base));
  }
  return output;
}
