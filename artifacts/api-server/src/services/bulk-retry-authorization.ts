import {demand,type CurrentSql} from "./current-financial-contract";
import type {BulkDependencies} from "./current-bulk-subscriptions";
import {findAdvanceReview} from "./advance-subscription-authorizations";
import {findApprovedDirectReview} from "./direct-student-live-release";
import {directLiveConfiguration} from "../lib/flutterwave-direct-live-config";
import {readStudentUsageRollout} from "./student-platform-rollout";
import {NFC_PREVIEW_SOURCES,previewPinnedCurrentReconciliation} from "./student-nfc-reconciliation";

/** Revalidate the immutable allocation/review set, never substitute a newer
 * approval. Caller holds the financial gate; provider I/O stays outside it. */
export async function revalidateBulkRetry(c:CurrentSql,b:any,deps:BulkDependencies={}){
 const schoolId=Number(b.school_id),termId=Number(b.academic_term_id);
 const period=(await c.query(`SELECT t.id FROM academic_terms t JOIN academic_sessions s
  ON s.id=t.academic_session_id AND s.school_id=t.school_id
  WHERE t.id=$2 AND t.school_id=$1 AND t.is_current=true AND t.status='ACTIVE'
   AND s.is_current=true AND s.status='ACTIVE'
   AND (clock_timestamp() AT TIME ZONE 'Africa/Lagos')::date BETWEEN t.start_date AND t.end_date
   AND (clock_timestamp() AT TIME ZONE 'Africa/Lagos')::date BETWEEN s.start_date AND s.end_date
   AND (SELECT count(*) FROM academic_terms x WHERE x.school_id=$1 AND x.is_current)=1
   AND (SELECT count(*) FROM academic_sessions x WHERE x.school_id=$1 AND x.is_current)=1
  FOR SHARE OF t,s`,[schoolId,termId])).rows[0];
 demand(period,"RETRY_CALENDAR_NOT_CURRENT_OR_OPEN");
 demand((await readStudentUsageRollout(c,schoolId,termId)).chargeable,"FREE_OR_INELIGIBLE_TERM");
 const allocations=(await c.query(`SELECT a.*,st.status AS student_status,st.admission_status
  FROM current_bulk_allocations a JOIN students st ON st.id=a.student_id AND st.school_id=a.school_id
  WHERE a.batch_id=$1 ORDER BY a.student_id FOR SHARE OF a,st`,[b.id])).rows;
 const expected=b.snapshot.students;
 demand(Array.isArray(expected)&&expected.length>0&&expected.length===allocations.length
  &&new Set(expected.map((s:any)=>s.studentId)).size===expected.length
  &&Number(b.amount_minor)===expected.length*320000,"RETRY_ALLOCATION_EVIDENCE_MISMATCH");
 const config=directLiveConfiguration();
 if(!deps.revalidate)demand(config.ready,"DIRECT_LIVE_RELEASE_NOT_ENABLED");
 const db=c as CurrentSql&{release():void};
 let ordinaryDigest:string|undefined;
 for(const a of allocations){
  const saved=expected.find((s:any)=>s.studentId===Number(a.student_id));
  demand(saved&&Number(a.school_id)===schoolId&&Number(a.academic_term_id)===termId
   &&Number(a.review_id)===saved.reviewId&&saved.amountMinor===320000
   &&String(a.student_status).toLowerCase()==="active"&&a.admission_status==="ADMITTED",
   "RETRY_STUDENT_OR_FROZEN_REVIEW_CHANGED");
  const scope={schoolId,termId,studentId:Number(a.student_id)};
  if(deps.revalidate){
   demand(await deps.revalidate(c,scope,{id:saved.reviewId,rule_id:saved.ruleId,
    report_digest:saved.reviewDigest,merchant_scope:saved.merchantScope}),"RETRY_REVIEW_STALE_WITHDRAWN_OR_EXPIRED");
   continue;
  }
  demand(saved.merchantScope===config.merchantScope,"RETRY_MERCHANT_EVIDENCE_CHANGED");
  // Advance reads perform pinned, locked material/roster/rule/merchant/endpoint
  // reconciliation and expiry/withdrawal checks. No older approval fallback.
  let review=await findAdvanceReview(db,scope,{configuration:config},true);
  if(review===undefined){
   if(ordinaryDigest===undefined){
    const sources=(await c.query(`SELECT relname FROM pg_class r JOIN pg_namespace n ON n.oid=r.relnamespace
     WHERE n.nspname='public' AND r.relkind IN ('r','p') AND
      (relname=ANY($1::text[]) OR relname ~ '^(flutterwave_live_|student_subscription_|hosted_checkout_|deferred_commission_)')
     ORDER BY relname`,[Object.keys(NFC_PREVIEW_SOURCES)])).rows.map(r=>String(r.relname));
    demand(sources.length>0&&sources.every(s=>/^[a-z_]+$/.test(s)),"RETRY_RECONCILIATION_SOURCES_REQUIRED");
    await c.query(`LOCK TABLE ${sources.map(s=>`public."${s}"`).join(",")} IN SHARE MODE`);
    const report=await previewPinnedCurrentReconciliation(db,{schoolId,termId});
    demand(report.sourceStatus==="COMPLETE","RETRY_RECONCILIATION_INCOMPLETE");
    ordinaryDigest=report.evidenceDigest;
   }
   review=await findApprovedDirectReview(db,scope,ordinaryDigest,config,true);
  }
  demand(review&&Number(review.id)===saved.reviewId&&Number(review.rule_id)===saved.ruleId
   &&review.report_digest===saved.reviewDigest&&review.merchant_scope===saved.merchantScope,
   "RETRY_REVIEW_STALE_WITHDRAWN_OR_EXPIRED");
 }
}
