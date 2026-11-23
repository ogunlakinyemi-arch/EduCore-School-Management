import {financialTransaction} from "./financial-transaction";
import {currentFinanceActor,currentSchoolAuthority,requireCurrentExtensions} from "./current-finance-access";
import {demand,sourceOf,type CurrentPool,type CurrentSql} from "./current-financial-contract";
import {refundAmounts,state,referenceFor} from "./current-financial-store";
import {hasCurrentAdverseHold} from "./current-bro-lifecycle";
import {lagosDate,readStudentRollout} from "./student-platform-rollout";
import {batchState,batchRoot} from "./current-bulk-subscriptions";
import {directLiveConfiguration} from "../lib/flutterwave-direct-live-config";
const name=(r:any)=>[r.first_name,r.last_name].filter(Boolean).join(" ")||`Student #${r.student_id??r.id}`;
const studentName=`COALESCE(NULLIF(concat_ws(' ',to_jsonb(st)->>'first_name',to_jsonb(st)->>'last_name'),''),'Student #'||st.id::text)`;
export async function readCurrentFinanceOverview(pool:CurrentPool,actorId:number,schoolId?:number,termId?:number,now=new Date()){
 return financialTransaction(pool,async(c:CurrentSql)=>{
  const actor=await currentFinanceActor(c,actorId);
  const schools=(await c.query(`SELECT s.id,COALESCE(to_jsonb(s)->>'name','School #'||s.id::text) AS name FROM schools s
    WHERE lower(s.status)='active' AND ($2::boolean OR EXISTS(SELECT 1 FROM school_memberships m
      WHERE m.user_id=$1 AND m.school_id=s.id AND m.status='ACTIVE' AND m.role IN ('SCHOOL_ADMIN','ACCOUNTANT'))) ORDER BY s.id`,
    [actorId,actor.owner])).rows.map(r=>({id:Number(r.id),name:r.name}));
  demand(actor.owner||actor.partnerId||schools.length>0,"CURRENT_FINANCE_ACCESS_DENIED");
  if(schoolId)await currentSchoolAuthority(c,actorId,schoolId);
  await requireCurrentExtensions(c);
  const terms=(await c.query(`SELECT t.id,t.school_id AS "schoolId",t.name FROM academic_terms t
    WHERE t.school_id=ANY($1::int[]) AND ($2::int IS NULL OR t.school_id=$2) ORDER BY t.id`,
    [schools.map(s=>s.id),schoolId??null])).rows.map(r=>({id:Number(r.id),schoolId:Number(r.schoolId),name:r.name}));
  if(termId)demand(schoolId&&terms.some(t=>t.id===termId&&t.schoolId===schoolId),"EXPLICIT_SCHOOL_TERM_SCOPE_REQUIRED");
  const allEntitlements=(actor.owner||actor.partnerId)?(await c.query(`SELECT 'D:'||e.id AS key,e.id,e.school_id,e.student_id,e.academic_term_id,
    e.partner_profile_id,COALESCE(to_jsonb(p)->>'full_name','BRO #'||p.id::text) AS bro_name,
    e.amount_minor,e.direct_attempt_id AS attempt_id,NULL::bigint AS allocation_id,
    ${studentName} AS student_name,COALESCE(to_jsonb(s)->>'name','School #'||s.id::text) AS school_name,t.name AS term_name,
    t.end_date::text AS term_end,p.status AS partner_status,o.id AS journal_id,l.request_id,d.decision
    FROM bro_term_commission_entitlements e JOIN partner_profiles p ON p.id=e.partner_profile_id
    JOIN students st ON st.id=e.student_id JOIN schools s ON s.id=e.school_id
    JOIN academic_terms t ON t.id=e.academic_term_id
    LEFT JOIN current_subscription_operations o ON o.entitlement_id=e.id AND o.kind='BRO'
    LEFT JOIN current_bro_withdrawal_lines l ON l.entitlement_id=e.id
    LEFT JOIN current_bro_withdrawal_decisions d ON d.line_id=l.id
    WHERE ($1::boolean OR e.partner_profile_id=$2) AND ($3::int IS NULL OR e.school_id=$3)
    AND ($4::int IS NULL OR e.academic_term_id=$4)
    UNION ALL SELECT 'B:'||e.id,e.id,e.school_id,e.student_id,e.academic_term_id,e.partner_profile_id,
    COALESCE(to_jsonb(p)->>'full_name','BRO #'||p.id::text),e.amount_minor,NULL::bigint,e.allocation_id,
    ${studentName},COALESCE(to_jsonb(s)->>'name','School #'||s.id::text),t.name,t.end_date::text,p.status,o.id,l.request_id,d.decision
    FROM current_bulk_bro_entitlements e JOIN partner_profiles p ON p.id=e.partner_profile_id
    JOIN students st ON st.id=e.student_id JOIN schools s ON s.id=e.school_id JOIN academic_terms t ON t.id=e.academic_term_id
    LEFT JOIN current_subscription_operations o ON o.bulk_entitlement_id=e.id AND o.kind='BRO'
    LEFT JOIN current_bro_withdrawal_lines l ON l.bulk_entitlement_id=e.id
    LEFT JOIN current_bro_withdrawal_decisions d ON d.line_id=l.id
    WHERE ($1::boolean OR e.partner_profile_id=$2) AND ($3::int IS NULL OR e.school_id=$3)
    AND ($4::int IS NULL OR e.academic_term_id=$4)`,[actor.owner,actor.partnerId,schoolId??null,termId??null])).rows:[];
  const entitlements:any[]=[];
  const summary={studentCount:allEntitlements.length,earnedMinor:allEntitlements.length*15000,pendingMinor:0,approvedMinor:0,availableMinor:0,paidMinor:0,
    requestedMinor:0,pendingApprovalMinor:0,failedMinor:0,reversedMinor:0};
  const payouts=[];
  for(const e of allEntitlements){
   const phase=e.journal_id?await state(c,Number(e.journal_id)):"REQUESTED";
   const held=await hasCurrentAdverseHold(c,sourceOf(e));
   const money=await refundAmounts(c,sourceOf(e));
   const activeBro=(await c.query(`SELECT 1 FROM partner_profiles p JOIN app_users u ON u.id=p.user_id
     WHERE p.id=$1 AND p.status='ACTIVE' AND u.status='ACTIVE' AND EXISTS(SELECT 1 FROM school_memberships m
       WHERE m.user_id=u.id AND m.role='PARTNER' AND m.status='ACTIVE')`,[e.partner_profile_id])).rows[0];
   const available=["APPROVED","FAILED"].includes(phase)&&e.decision==="APPROVED"&&!held&&money.netPaidMinor===320000
     &&!!activeBro&&e.term_end<lagosDate(now);
   if(phase==="REQUESTED"&&!held)summary.pendingMinor+=15000;
   if(e.request_id)summary.requestedMinor+=15000;
   if(e.request_id&&phase==="REQUESTED"&&!held&&e.decision==null)summary.pendingApprovalMinor+=15000;
   if(phase==="APPROVED")summary.approvedMinor+=15000;
   if(available)summary.availableMinor+=15000;
   entitlements.push({key:e.key,studentId:Number(e.student_id),studentName:e.student_name,
     schoolId:Number(e.school_id),schoolName:e.school_name,termId:Number(e.academic_term_id),termName:e.term_name,
     amountMinor:15000,state:held&&phase==="REQUESTED"?"HELD":phase,requestId:e.request_id?Number(e.request_id):null,available});
   let latestPayout:{state:string;amount:number}|null=null;
   if(e.journal_id)for(const p of (await c.query(`SELECT * FROM current_subscription_operations
     WHERE parent_id=$1 AND kind='BRO_PAYOUT' ORDER BY id`,[e.journal_id])).rows){
     const phase=await state(c,Number(p.id));if(phase==="SUCCEEDED")summary.paidMinor+=Number(p.amount_minor);
     latestPayout={state:phase,amount:Number(p.amount_minor)};
     payouts.push({id:Number(p.id),entitlementKey:e.key,amountMinor:Number(p.amount_minor),state:phase,
       reference:referenceFor(Number(p.id)),maskedAccountNumber:p.snapshot.bank?.maskedAccountNumber??null});
   }
   // Count only the latest attempt per entitlement, not every historical failed retry.
   if(latestPayout?.state==="FAILED")summary.failedMinor+=latestPayout.amount;
   if(latestPayout?.state==="REVERSED")summary.reversedMinor+=latestPayout.amount;
  }
  const requests=[];
  for(const r of (actor.owner||actor.partnerId)?(await c.query(`SELECT r.*,COALESCE(to_jsonb(p)->>'full_name','BRO #'||p.id::text) AS bro_name
    FROM current_bro_withdrawals r JOIN partner_profiles p ON p.id=r.partner_profile_id
    WHERE $1::boolean OR r.partner_profile_id=$2 ORDER BY r.id DESC`,[actor.owner,actor.partnerId])).rows:[]){
    const allLines=(await c.query(`SELECT l.*,d.decision,d.reason FROM current_bro_withdrawal_lines l
      LEFT JOIN current_bro_withdrawal_decisions d ON d.line_id=l.id WHERE request_id=$1 ORDER BY l.id`,[r.id])).rows;
    const lines=schoolId||termId?allLines.filter(l=>entitlements.some(e=>e.key===(l.bulk_entitlement_id?`B:${l.bulk_entitlement_id}`:`D:${l.entitlement_id}`))):allLines;
    if(!lines.length)continue;
    requests.push({id:Number(r.id),partnerId:Number(r.partner_profile_id),broName:r.bro_name,totalMinor:lines.length*15000,
      createdAt:new Date(r.created_at).toISOString(),lines:lines.map(l=>{
        const key=l.bulk_entitlement_id?`B:${l.bulk_entitlement_id}`:`D:${l.entitlement_id}`;
        return {entitlementKey:key,studentName:entitlements.find(e=>e.key===key)?.studentName??"Retained entitlement",
          state:l.decision??"REQUESTED",reason:l.reason??null};
      })});
  }
  const payments:any[]=[],refunds:any[]=[],batches:any[]=[],eligibleStudents:any[]=[];
  if(schoolId){
    const direct=(await c.query(`SELECT a.id,o.student_id,o.school_id,o.academic_term_id,a.reference,${studentName} AS student_name
      FROM student_direct_live_attempts a JOIN student_direct_live_obligations o ON o.id=a.obligation_id
      JOIN students st ON st.id=o.student_id WHERE a.state='PAID' AND o.amount_minor=320000 AND o.school_id=$1
      AND ($2::int IS NULL OR o.academic_term_id=$2) ORDER BY a.id DESC`,[schoolId,termId??null])).rows;
    const allocated=(await c.query(`SELECT a.id,a.student_id,a.school_id,a.academic_term_id,b.reference,${studentName} AS student_name
      FROM current_bulk_allocations a JOIN current_payment_batches b ON b.id=a.batch_id
      JOIN current_bulk_confirmations cf ON cf.batch_id=b.id AND cf.amount_minor=b.amount_minor
      JOIN students st ON st.id=a.student_id WHERE a.school_id=$1 AND ($2::int IS NULL OR a.academic_term_id=$2)
      AND EXISTS(SELECT 1 FROM current_bulk_events ev WHERE ev.allocation_id=a.id AND ev.state='POSTED')`,[schoolId,termId??null])).rows;
    for(const [source,rows] of [["DIRECT",direct],["BULK",allocated]] as const)for(const row of rows){
      const money=await refundAmounts(c,source==="DIRECT"?Number(row.id):{allocationId:Number(row.id)});
      payments.push({id:Number(row.id),source,studentId:Number(row.student_id),studentName:row.student_name,schoolId,
        termId:Number(row.academic_term_id),reference:row.reference,amountMinor:320000,state:money.refundedMinor===320000?"REFUNDED":
          money.refundedMinor?"PARTIALLY_REFUNDED":"PAID",...money});
    }
    if(actor.owner)for(const r of (await c.query(`SELECT * FROM current_subscription_operations
      WHERE kind='REFUND' AND school_id=$1 AND ($2::int IS NULL OR academic_term_id=$2) ORDER BY id DESC`,[schoolId,termId??null])).rows){
      const source=r.allocation_id?"BULK":"DIRECT",sourceId=Number(r.allocation_id??r.attempt_id);
      refunds.push({id:Number(r.id),studentName:payments.find(p=>p.source===source&&p.id===sourceId)?.studentName??"Retained payment",
        amountMinor:Number(r.amount_minor),state:await state(c,Number(r.id)),source,sourceId});
    }
    for(const b of (await c.query(`SELECT * FROM current_payment_batches WHERE school_id=$1
      AND ($2::int IS NULL OR academic_term_id=$2) ORDER BY id DESC`,[schoolId,termId??null])).rows){
      const phase=await batchState(c,Number(b.id));
      const checkout=(await c.query(`SELECT details->>'checkoutUrl' AS url FROM current_bulk_events
        WHERE batch_id=$1 AND state='READY' ORDER BY id DESC LIMIT 1`,[b.id])).rows[0];
      const items=(await c.query(`SELECT a.*,EXISTS(SELECT 1 FROM current_bulk_events ev WHERE ev.allocation_id=a.id AND ev.state='POSTED') AS posted,
        (SELECT details->>'code' FROM current_bulk_events WHERE allocation_id=a.id AND state='ALLOCATION_ERROR' ORDER BY id DESC LIMIT 1) AS error
        FROM current_bulk_allocations a WHERE batch_id=$1 ORDER BY id`,[b.id])).rows.map(a=>({
          id:Number(a.id),studentId:Number(a.student_id),
          studentName:b.snapshot.students.find((s:any)=>s.studentId===Number(a.student_id))?.studentName??`Student #${a.student_id}`,
          state:a.posted?"POSTED":"UNRESOLVED",error:phase==="COMPLETED"?null:a.error??null}));
      batches.push({id:Number(b.id),reference:b.reference,state:phase,amountMinor:Number(b.amount_minor),
        checkoutUrl:phase==="READY"?checkout?.url??null:null,items});
    }
    if(termId){
      const rollout=await readStudentRollout(c,schoolId,termId,lagosDate(now));
      for(const st of (await c.query(`SELECT st.*,EXISTS(SELECT 1 FROM student_subscription_terms l WHERE l.student_id=st.id AND l.academic_term_id=$2)
        OR EXISTS(SELECT 1 FROM student_direct_live_obligations o WHERE o.student_id=st.id AND o.academic_term_id=$2 AND (
          o.amount_minor<>320000 OR o.assistance_request_id IS NOT NULL OR EXISTS(SELECT 1 FROM student_direct_live_attempts a
            WHERE a.obligation_id=o.id AND a.state<>'FAILED')))
        OR EXISTS(SELECT 1 FROM current_bulk_allocations a WHERE a.student_id=st.id AND a.academic_term_id=$2) AS occupied
        FROM students st WHERE st.school_id=$1 ORDER BY st.id`,[schoolId,termId])).rows){
        const reason=!rollout.chargeable?"FREE_OR_INELIGIBLE_TERM":st.occupied?"PAYMENT_OR_RESERVATION_EXISTS":
          String(st.status).toLowerCase()!=="active"||String(st.admission_status).toUpperCase()!=="ADMITTED"?"STUDENT_NOT_ACTIVE_ADMITTED":null;
        eligibleStudents.push({id:Number(st.id),name:name(st),eligible:!reason,reason});
      }
    }
  }
  return {owner:actor.owner,bro:!!actor.partnerId,schools,terms,summary,entitlements,requests,payments,refunds,payouts,batches,eligibleStudents,
    blockers:[...(!directLiveConfiguration().ready?["LIVE direct-payment configuration and reviewed release remain required."]:[]),
      "Collection reversals and incoming BRO recoveries require an independently bound bank/provider evidence feed; request-body claims cannot confirm them.",
      "Payout verification reads existing matching LIVE transfers only; this workflow never sends a transfer."]};
 });
}
export async function readCurrentBulkReceipt(pool:CurrentPool,actorId:number,id:number,allocationId?:number){
 return financialTransaction(pool,async(c:CurrentSql)=>{
  await requireCurrentExtensions(c);const b=await batchRoot(c,id);
  await currentSchoolAuthority(c,actorId,Number(b.school_id));
  const confirmation=(await c.query("SELECT * FROM current_bulk_confirmations WHERE batch_id=$1",[id])).rows[0];
  demand(confirmation,"VERIFIED_AGGREGATE_REQUIRED");
  const rows=(await c.query(`SELECT a.*,EXISTS(SELECT 1 FROM current_bulk_events ev
    WHERE ev.allocation_id=a.id AND ev.state='POSTED') AS posted FROM current_bulk_allocations a
    WHERE a.batch_id=$1 AND ($2::bigint IS NULL OR a.id=$2) ORDER BY a.id`,[id,allocationId??null])).rows;
  demand(rows.length>0&&rows.every(r=>r.posted),"ALL_SELECTED_ALLOCATIONS_MUST_BE_POSTED");
  if(!allocationId)demand(rows.length*320000===Number(confirmation.amount_minor),"CONSOLIDATED_RECEIPT_ALLOCATION_SUM_MISMATCH");
  const items=[];
  for(const r of rows){
    const money=await refundAmounts(c,{allocationId:Number(r.id)});
    items.push({id:Number(r.id),studentId:Number(r.student_id),
      studentName:b.snapshot.students.find((s:any)=>s.studentId===Number(r.student_id))?.studentName??`Student #${r.student_id}`,
      receiptNumber:`YEC-B${id}-S${r.student_id}`,amountMinor:320000,...money});
  }
  const labels=(await c.query(`SELECT COALESCE(to_jsonb(s)->>'name','School #'||s.id::text) AS school_name,t.name AS term_name
    FROM schools s JOIN academic_terms t ON t.school_id=s.id WHERE s.id=$1 AND t.id=$2`,[b.school_id,b.academic_term_id])).rows[0];
  return {id,reference:b.reference,schoolName:labels.school_name,termName:labels.term_name,currency:"NGN",
    amountMinor:items.length*320000,refundedMinor:items.reduce((s,r)=>s+r.refundedMinor,0),
    netPaidMinor:items.reduce((s,r)=>s+r.netPaidMinor,0),items,verifiedAt:new Date(confirmation.verified_at).toISOString()};
 });
}
