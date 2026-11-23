import {appendFinancialHistory} from "./financial-history-writes";
import {lagosDate} from "./student-platform-rollout";
import {demand,positiveMinor,requestKey,type CurrentCapabilities,type CurrentPool,type CurrentSql} from "./current-financial-contract";
import {appendState,claimReference,createOperation,currentTransaction,digest,operation,paidDirect,
  referenceFor,refundAmounts,state} from "./current-financial-store";

export async function currentBroRoot(c: CurrentSql, entitlementId: number, actorId: number) {
  const e=(await c.query(`SELECT e.*,p.status AS partner_status,t.end_date::text AS term_end
    FROM bro_term_commission_entitlements e
    JOIN partner_profiles p ON p.id=e.partner_profile_id
    JOIN academic_terms t ON t.id=e.academic_term_id AND t.school_id=e.school_id
    WHERE e.id=$1`,[entitlementId])).rows[0];
  demand(e && Number(e.amount_minor)===15000 && e.currency==="NGN","CURRENT_ENTITLEMENT_REQUIRED");
  const a=await paidDirect(c,Number(e.direct_attempt_id));
  demand(Number(a.school_id)===Number(e.school_id) && Number(a.student_id)===Number(e.student_id)
    && Number(a.academic_term_id)===Number(e.academic_term_id),"ENTITLEMENT_SOURCE_MISMATCH");
  const snapshot={entitlementId,partnerId:Number(e.partner_profile_id),studentId:Number(e.student_id),
    policyId:Number(e.policy_id),funding:"SEPARATE_PLATFORM_EXPENSE",collectionBroShareMinor:0};
  const existing=(await c.query(`SELECT * FROM current_subscription_operations
    WHERE kind='BRO' AND entitlement_id=$1`,[entitlementId])).rows[0];
  if(existing) {
    demand(Number(existing.attempt_id)===Number(e.direct_attempt_id)
      && Number(existing.school_id)===Number(e.school_id)
      && Number(existing.academic_term_id)===Number(e.academic_term_id)
      && digest(existing.snapshot)===digest(snapshot),"ENTITLEMENT_JOURNAL_SOURCE_MISMATCH");
    return {root:existing,e,a};
  }
  const root=await createOperation(c,{kind:"BRO",key:`bro_entitlement_${entitlementId}_current`,
    schoolId:Number(e.school_id),termId:Number(e.academic_term_id),attemptId:Number(e.direct_attempt_id),
    entitlementId,amountMinor:15000,actorId,reason:"Current independent BRO entitlement lifecycle",snapshot});
  return {root,e,a};
}
export async function hasCurrentAdverseHold(c: CurrentSql, attemptId: number) {
  return !!(await c.query(`SELECT id FROM student_direct_live_events WHERE attempt_id=$1
    AND kind='CURRENT_ADVERSE_HOLD' LIMIT 1`,[attemptId])).rows[0];
}
/** Explicit Owner review initializes only a journal root, never a new earning. */
export async function reviewCurrentBroEntitlement(pool:CurrentPool,actorId:number,entitlementId:number,
  deps:CurrentCapabilities={}) {
  return currentTransaction(pool,actorId,async c=>{
    const {root,e}=await currentBroRoot(c,entitlementId,actorId);
    const phase=await state(c,Number(root.id));
    const hold=await hasCurrentAdverseHold(c,Number(root.attempt_id));
    const money=await refundAmounts(c,Number(root.attempt_id));
    const rows=(await c.query(`SELECT o.kind,o.amount_minor,e.state FROM current_subscription_operations o
      JOIN LATERAL(SELECT state FROM current_subscription_operation_events
        WHERE operation_id=o.id ORDER BY id DESC LIMIT 1)e ON true
      WHERE o.entitlement_id=$1 AND o.kind IN ('BRO_PAYOUT','BRO_RECOVERY')`,[entitlementId])).rows;
    const paid=rows.filter(r=>r.kind==="BRO_PAYOUT"&&r.state==="SUCCEEDED")
      .reduce((sum,r)=>sum+Number(r.amount_minor),0);
    const recovered=rows.filter(r=>r.kind==="BRO_RECOVERY"&&r.state==="SUCCEEDED")
      .reduce((sum,r)=>sum+Number(r.amount_minor),0);
    const payable=phase==="APPROVED"&&!hold&&money.netPaidMinor===320000&&e.partner_status==="ACTIVE"
      &&e.term_end<lagosDate(deps.now?.()??new Date());
    return {entitlementId,journalId:Number(root.id),state:phase,amountMinor:15000,currency:"NGN",
      funding:"SEPARATE_PLATFORM_EXPENSE",payableMinor:payable?15000:0,
      confirmedPaidMinor:paid,confirmedRecoveredMinor:recovered,
      recoveryReviewExposureMinor:["RECOVERY_REQUIRED","RECOVERY_RECORDED"].includes(phase)
        ?Math.max(0,paid-recovered):0,
      recoveryAmountPolicy:"OWNER_REVIEW_NO_AUTOMATIC_PRORATION_OR_DEBIT"};
  });
}
/** Protective evidence can use the original verified payment without another successful GET. */
export async function holdCurrentBro(c: CurrentSql, attemptId: number, actorId: number,
  key: string, confirmed: boolean, reason: string) {
  await appendFinancialHistory(c,"event",[attemptId,"CURRENT_ADVERSE_HOLD",actorId,
    JSON.stringify({key,confirmed,reason,restoration:"SEPARATE_OWNER_REVIEW_REQUIRED"})]);
  const ent=(await c.query(`SELECT id FROM bro_term_commission_entitlements WHERE direct_attempt_id=$1`,
    [attemptId])).rows[0];
  if (!ent) return;
  const {root}=await currentBroRoot(c,Number(ent.id),actorId);
  const paid=(await c.query(`SELECT p.id FROM current_subscription_operations p
    JOIN LATERAL(SELECT state FROM current_subscription_operation_events
      WHERE operation_id=p.id ORDER BY id DESC LIMIT 1)e ON true
    WHERE p.kind='BRO_PAYOUT' AND p.parent_id=$1 AND e.state='SUCCEEDED' LIMIT 1`,[root.id])).rows[0];
  await appendState(c,Number(root.id),confirmed&&paid?"RECOVERY_REQUIRED":"HELD",
    `hold:${key}`,actorId,{confirmed,reason,recoveryAmountPolicy:"OWNER_REVIEW_NO_AUTOMATIC_PRORATION_OR_DEBIT"});
}
export async function approveCurrentBro(pool: CurrentPool, actorId: number, entitlementId: number, key: string,
  deps: CurrentCapabilities={}) {
  requestKey(key);
  return currentTransaction(pool,actorId,async c=>{
    const {root,e}=await currentBroRoot(c,entitlementId,actorId);
    const current=await state(c,Number(root.id));
    // A replay must not resurrect an approval after a later hold/payout.
    const prior=(await c.query(`SELECT id FROM current_subscription_operation_events
      WHERE event_key=$1`,[`${root.id}:approve:${key}`])).rows[0];
    if (prior) return {id:Number(root.id),state:current};
    demand(e.partner_status==="ACTIVE","BRO_NOT_ACTIVE");
    demand(e.term_end<lagosDate(deps.now?.()??new Date()),"TERM_END_OWNER_REVIEW_REQUIRED");
    demand((await refundAmounts(c,Number(root.attempt_id))).netPaidMinor===320000
      && !await hasCurrentAdverseHold(c,Number(root.attempt_id)),"ADVERSE_PAYMENT_REQUIRES_REVIEW");
    demand(["REQUESTED","FAILED"].includes(current),"ENTITLEMENT_NOT_APPROVABLE");
    await appendState(c,Number(root.id),"APPROVED",`approve:${key}`,actorId,
      {entitlementId,amountMinor:15000,funding:"SEPARATE_PLATFORM_EXPENSE"});
    return {id:Number(root.id),state:"APPROVED"};
  });
}
export async function initiateCurrentBroPayout(pool: CurrentPool, actorId: number, entitlementId: number,
  key: string, reason: string, deps: CurrentCapabilities={}) {
  requestKey(key);
  return currentTransaction(pool,actorId,async c=>{
    const {root,e}=await currentBroRoot(c,entitlementId,actorId);
    const prior=(await c.query(`SELECT * FROM current_subscription_operations
      WHERE kind='BRO_PAYOUT' AND request_key=$1`,[key])).rows[0];
    if (prior) {
      demand(Number(prior.parent_id)===Number(root.id)&&Number(prior.created_by)===actorId
        && prior.reason===reason.trim(),"IDEMPOTENCY_CONTENT_CONFLICT");
      return {id:Number(prior.id),reference:referenceFor(Number(prior.id)),state:await state(c,Number(prior.id))};
    }
    demand(await state(c,Number(root.id))==="APPROVED","INDIVIDUAL_OWNER_APPROVAL_REQUIRED");
    demand(e.partner_status==="ACTIVE" && !await hasCurrentAdverseHold(c,Number(root.attempt_id))
      && (await refundAmounts(c,Number(root.attempt_id))).netPaidMinor===320000,"ENTITLEMENT_NOT_PAYABLE");
    demand(deps.bank,"VERIFIED_BANK_CAPABILITY_REQUIRED");
    const bank=await deps.bank(c,Number(e.partner_profile_id));
    demand(bank?.verified===true && bank.fingerprint && bank.sealed?.ciphertext && bank.sealed.keyVersion,
      "VERIFIED_REGISTERED_PERSON_BANK_REQUIRED");
    const payout=await createOperation(c,{kind:"BRO_PAYOUT",key,schoolId:Number(e.school_id),
      termId:Number(e.academic_term_id),attemptId:Number(e.direct_attempt_id),entitlementId,
      parentId:Number(root.id),amountMinor:15000,actorId,reason,snapshot:{bank}});
    await appendState(c,Number(payout.id),"PENDING","initiated",actorId,{moneyMoved:false});
    await appendState(c,Number(root.id),"PENDING",`payout:${payout.id}`,actorId,{payoutId:Number(payout.id)});
    return {id:Number(payout.id),reference:referenceFor(Number(payout.id)),state:"PENDING"};
  });
}
/** Records independently supplied bank evidence; never calls a transfer API. */
export async function reconcileCurrentBroPayout(pool: CurrentPool, actorId: number, payoutId: number,
  deps: CurrentCapabilities={}) {
  demand(deps.payoutEvidence,"INDEPENDENT_PAYOUT_EVIDENCE_CAPABILITY_REQUIRED");
  // Authorization precedes the capability call; a request body is never evidence.
  const snapshot=await currentTransaction(pool,actorId,async c=>{
    const p=await operation(c,payoutId); demand(p.kind==="BRO_PAYOUT","PAYOUT_REQUIRED"); return p;
  });
  const facts=await deps.payoutEvidence(referenceFor(payoutId));
  return currentTransaction(pool,actorId,async c=>{
    const p=await operation(c,payoutId);
    demand(digest(p.snapshot)===digest(snapshot.snapshot),"PAYOUT_SNAPSHOT_CHANGED");
    demand(facts.requestReference===referenceFor(payoutId) && facts.currency==="NGN"
      && facts.amountMinor===15000 && facts.bankFingerprint===p.snapshot.bank.fingerprint
      && typeof facts.evidenceReference==="string"&&facts.evidenceReference.trim().length>=3,
      "PAYOUT_EVIDENCE_MISMATCH");
    demand(["PENDING","SUCCEEDED","FAILED","REVERSED"].includes(facts.status),"PAYOUT_STATUS_UNSUPPORTED");
    const previous=await state(c,payoutId);
    await claimReference(c,"BRO_PAYOUT",facts.providerReference,payoutId);
    // A bank reversal is terminal for this payout, not permission to resend.
    if (previous==="REVERSED" || (previous==="SUCCEEDED" && facts.status!=="REVERSED"))
      return {id:payoutId,state:previous};
    if (previous==="FAILED" && ["PENDING","FAILED"].includes(facts.status)) return {id:payoutId,state:previous};
    await appendState(c,payoutId,facts.status,`evidence:${digest(facts)}`,actorId,facts);
    const rootId=Number(p.parent_id),prior=await state(c,rootId);
    let next:string=facts.status;
    if (previous==="FAILED" && facts.status==="SUCCEEDED") next="RECOVERY_REQUIRED";
    else if (facts.status==="REVERSED") next="HELD";
    else if (["HELD","RECOVERY_REQUIRED","RECOVERY_RECORDED"].includes(prior)) {
      const outflow=await refundAmounts(c,Number(p.attempt_id));
      next=facts.status==="SUCCEEDED" && (outflow.refundedMinor+outflow.collectionReversedMinor)>0
        ?"RECOVERY_REQUIRED":prior;
    }
    await appendState(c,rootId,next,`payout-evidence:${payoutId}:${digest(facts)}`,actorId,{payoutId,status:facts.status});
    return {id:payoutId,state:facts.status,entitlementState:next};
  });
}
export async function recordCurrentBroRecovery(pool: CurrentPool, actorId: number, payoutId: number,
  amountMinor: number, key: string, evidenceReference: string, deps: CurrentCapabilities={}) {
  requestKey(key); positiveMinor(amountMinor); demand(amountMinor<=15000,"RECOVERY_EXCEEDS_PAYOUT");
  demand(deps.recoveryEvidence,"INDEPENDENT_RECOVERY_EVIDENCE_CAPABILITY_REQUIRED");
  const p=await currentTransaction(pool,actorId,async c=>{
    const row=await operation(c,payoutId);
    demand(row.kind==="BRO_PAYOUT" && await state(c,payoutId)==="SUCCEEDED","PAID_PAYOUT_REQUIRED");
    demand(["RECOVERY_REQUIRED","RECOVERY_RECORDED"].includes(await state(c,Number(row.parent_id))),
      "OWNER_RECOVERY_REVIEW_REQUIRED");return row;
  });
  const facts=await deps.recoveryEvidence(evidenceReference);
  return currentTransaction(pool,actorId,async c=>{
    demand(await state(c,payoutId)==="SUCCEEDED","PAID_PAYOUT_REQUIRED");
    demand(["RECOVERY_REQUIRED","RECOVERY_RECORDED"].includes(await state(c,Number(p.parent_id))),
      "OWNER_RECOVERY_REVIEW_REQUIRED");
    demand(facts.requestReference===evidenceReference && facts.amountMinor===amountMinor && facts.currency==="NGN"
      && facts.bankFingerprint===p.snapshot.bank.fingerprint && facts.status==="SUCCEEDED"
      && facts.evidenceReference.trim().length>=3,"RECOVERY_EVIDENCE_MISMATCH");
    const existing=(await c.query(`SELECT id FROM current_subscription_operations
      WHERE kind='BRO_RECOVERY' AND request_key=$1`,[key])).rows[0];
    const recovered=Number((await c.query(`SELECT COALESCE(sum(amount_minor),0)::bigint AS total
      FROM current_subscription_operations WHERE kind='BRO_RECOVERY' AND parent_id=$1`,[payoutId])).rows[0].total);
    demand(existing || recovered+amountMinor<=15000,"CUMULATIVE_RECOVERY_EXCEEDS_PAYOUT");
    const r=await createOperation(c,{kind:"BRO_RECOVERY",key,schoolId:Number(p.school_id),
      termId:Number(p.academic_term_id),attemptId:Number(p.attempt_id),entitlementId:Number(p.entitlement_id),
      parentId:payoutId,amountMinor,actorId,reason:"Independently reviewed BRO recovery",
      snapshot:{evidenceReference,bankFingerprint:p.snapshot.bank.fingerprint}});
    await claimReference(c,"BRO_RECOVERY",facts.providerReference,Number(r.id));
    await appendState(c,Number(r.id),"SUCCEEDED","verified",actorId,facts);
    await appendState(c,Number(p.parent_id),"RECOVERY_RECORDED",`recovery:${r.id}`,actorId,
      {recoveryId:Number(r.id),amountMinor,noAutomaticReapproval:true});
    return {id:Number(r.id),state:"SUCCEEDED",entitlementState:"RECOVERY_RECORDED"};
  });
}
