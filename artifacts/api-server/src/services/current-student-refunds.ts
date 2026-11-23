import {demand,positiveMinor,requestKey,sourceOf,sourceColumns,type CurrentSource,type CurrentCapabilities,type CurrentPool} from "./current-financial-contract";
import {appendState,claimReference,createOperation,currentTransaction,digest,operation,paidDirect,
  referenceFor,refundAmounts,state} from "./current-financial-store";
import {holdCurrentBro} from "./current-bro-lifecycle";

export async function requestCurrentStudentRefund(pool: CurrentPool, actorId: number, attemptId: CurrentSource,
  amountMinor: number, key: string, reason: string) {
  positiveMinor(amountMinor);requestKey(key);
  return currentTransaction(pool,actorId,async c=>{
    const a=await paidDirect(c,attemptId);
    const existing=(await c.query(`SELECT id FROM current_subscription_operations
      WHERE kind='REFUND' AND request_key=$1`,[key])).rows[0];
    if (!existing) demand((await refundAmounts(c,attemptId)).reservedMinor+amountMinor<=320000,
      "CUMULATIVE_REFUNDS_EXCEED_PAYMENT");
    const root=await createOperation(c,{kind:"REFUND",key,schoolId:Number(a.school_id),
       termId:Number(a.academic_term_id),...sourceColumns(attemptId),amountMinor,actorId,reason,
      snapshot:{movement:"REFUND",collectionTransactionId:a.provider_transaction_id,studentId:Number(a.student_id)}});
    if (!existing) {
      await appendState(c,Number(root.id),"REQUESTED","requested",actorId,{moneyMoved:false});
      await holdCurrentBro(c,attemptId,actorId,`refund-request:${root.id}`,false,"REFUND_REVIEW");
    }
    return {id:Number(root.id),state:await state(c,Number(root.id)),...await refundAmounts(c,attemptId)};
  });
}
export async function approveCurrentStudentRefund(pool: CurrentPool, actorId: number, id: number, key: string) {
  requestKey(key);
  return currentTransaction(pool,actorId,async c=>{
    const root=await operation(c,id);demand(root.kind==="REFUND"&&root.snapshot.movement==="REFUND","REFUND_REQUIRED");
    const previous=await state(c,id);
    const prior=(await c.query(`SELECT id FROM current_subscription_operation_events WHERE event_key=$1`,
      [`${id}:approve:${key}`])).rows[0];
    if(prior)return {id,state:previous};
    if (previous==="APPROVED") return {id,state:previous};
    demand(previous==="REQUESTED","REFUND_NOT_APPROVABLE");
    await appendState(c,id,"APPROVED",`approve:${key}`,actorId,{moneyMoved:false});
    return {id,state:"APPROVED"};
  });
}
export async function dispatchCurrentStudentRefund(pool: CurrentPool, actorId: number, id: number,
  deps: CurrentCapabilities={}) {
  demand(deps.refunds,"CORRELATION_CAPABLE_REFUND_PROVIDER_NOT_APPROVED");
  const claim=await currentTransaction(pool,actorId,async c=>{
    const root=await operation(c,id);
    demand(root.kind==="REFUND"&&root.snapshot.movement==="REFUND","REFUND_REQUIRED");
    const previous=await state(c,id);
    // No second POST, even after a crash or lost response.
    if (["PROCESSING","UNKNOWN","PENDING","SUCCEEDED","FAILED","REVERSED"].includes(previous)) return null;
    demand(previous==="APPROVED","REFUND_APPROVAL_REQUIRED");
    deps.refunds!.validate?.({amountMinor:Number(root.amount_minor)});
    demand((await refundAmounts(c,sourceOf(root))).reservedMinor<=320000,
      "ADVERSE_OVERLAP_RECONCILIATION_REQUIRED");
    await appendState(c,id,"PROCESSING","permanent-dispatch-claim",actorId,{moneyMoved:false});
    return root;
  });
  if (!claim) return {id,reconciliationRequired:true};
  try {
    const accepted=await deps.refunds.request({reference:referenceFor(id),
      collectionTransactionId:claim.snapshot.collectionTransactionId,amountMinor:Number(claim.amount_minor)});
    if(accepted) await currentTransaction(pool,actorId,async c=>{
      await claimReference(c,"REFUND",accepted.providerReference,id);
      await appendState(c,id,"PROCESSING","provider-accepted",actorId,{providerRefundId:accepted.providerReference,moneyMoved:false});
    });
  } catch {
    await currentTransaction(pool,actorId,async c=>{
      if (await state(c,id)==="PROCESSING") await appendState(c,id,"UNKNOWN","request-response-uncertain",actorId,
        {moneyMoved:"UNKNOWN",automaticResend:false});
    });
    return {id,state:"UNKNOWN",reconciliationRequired:true};
  }
  // Provider acceptance is not completion. Independent verification is separate.
  return {id,state:"PROCESSING",reconciliationRequired:true};
}
export async function reconcileCurrentStudentRefund(pool: CurrentPool, actorId: number, id: number,
  deps: CurrentCapabilities={}) {
  demand(deps.refunds,"CORRELATION_CAPABLE_REFUND_PROVIDER_NOT_APPROVED");
  await currentTransaction(pool,actorId,async c=>{
    const r=await operation(c,id);
    demand(r.kind==="REFUND"&&r.snapshot.movement==="REFUND","REFUND_REQUIRED");
    demand(["PROCESSING","UNKNOWN","PENDING","SUCCEEDED","FAILED","REVERSED"].includes(await state(c,id)),
      "REFUND_NOT_DISPATCHED");
  });
  const facts=await deps.refunds.verify(referenceFor(id));
  return currentTransaction(pool,actorId,async c=>{
    const r=await operation(c,id),previous=await state(c,id);
    demand(facts.requestReference===referenceFor(id) && facts.collectionTransactionId===r.snapshot.collectionTransactionId
      && facts.amountMinor===Number(r.amount_minor) && facts.currency==="NGN","REFUND_EVIDENCE_MISMATCH");
    demand(["PENDING","SUCCEEDED","FAILED","REVERSED"].includes(facts.status),"REFUND_STATUS_UNSUPPORTED");
    await claimReference(c,"REFUND",facts.providerReference,id);
    if (previous==="REVERSED" || (previous==="SUCCEEDED" && facts.status!=="REVERSED"))
      return {id,state:previous,...await refundAmounts(c,sourceOf(r))};
    if (previous==="FAILED" && facts.status==="PENDING")
      return {id,state:previous,...await refundAmounts(c,sourceOf(r))};
    // Reversal before observed success is valid independent evidence of the
    // refund's final cancellation; it never subtracts an unposted amount.
    await appendState(c,id,facts.status,`provider:${digest(facts)}`,actorId,facts);
    if (facts.status==="SUCCEEDED")
      await holdCurrentBro(c,sourceOf(r),actorId,`refund-confirmed:${id}`,true,"REFUND_SUCCEEDED");
    return {id,state:facts.status,...await refundAmounts(c,sourceOf(r))};
  });
}
export async function recordCurrentCollectionReversal(pool: CurrentPool, actorId: number, attemptId: number,
  eventReference: string, key: string, deps: CurrentCapabilities={}) {
  requestKey(key);demand(deps.collectionReversal,"INDEPENDENT_REVERSAL_CAPABILITY_REQUIRED");
  const a=await currentTransaction(pool,actorId,c=>paidDirect(c,attemptId));
  const facts=await deps.collectionReversal(eventReference);
  demand(facts.requestReference===eventReference && facts.collectionTransactionId===a.provider_transaction_id
    && facts.currency==="NGN" && facts.status==="REVERSED","REVERSAL_EVIDENCE_MISMATCH");
  positiveMinor(facts.amountMinor);demand(facts.amountMinor<=320000,"REVERSAL_EXCEEDS_PAYMENT");
  return currentTransaction(pool,actorId,async c=>{
    await paidDirect(c,attemptId);
    const prior=(await c.query(`SELECT id FROM current_subscription_operations WHERE kind='REFUND' AND request_key=$1`,
      [key])).rows[0];
    const amounts=await refundAmounts(c,attemptId);
    demand(prior || amounts.collectionReversedMinor+facts.amountMinor<=320000,"CUMULATIVE_REVERSALS_EXCEED_PAYMENT");
    const r=await createOperation(c,{kind:"REFUND",key,schoolId:Number(a.school_id),termId:Number(a.academic_term_id),
      attemptId,amountMinor:facts.amountMinor,actorId,reason:"Independently verified collection reversal",
      snapshot:{movement:"COLLECTION_REVERSAL",collectionTransactionId:a.provider_transaction_id,eventReference}});
    await claimReference(c,"COLLECTION_REVERSAL",facts.providerReference,Number(r.id));
    await appendState(c,Number(r.id),"SUCCEEDED","collection-reversal-confirmed",actorId,facts);
    if (!prior) await holdCurrentBro(c,attemptId,actorId,`collection-reversal:${r.id}`,true,"COLLECTION_REVERSED");
    return {id:Number(r.id),...await refundAmounts(c,attemptId)};
  });
}
