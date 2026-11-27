import {currentTransaction,operation,state,appendState,claimReference,digest} from "./current-financial-store";
import {currentBroRoot,hasCurrentAdverseHold} from "./current-bro-lifecycle";
import {refundAmounts} from "./current-financial-store";
import {openBroPayoutBank} from "./bro-bank-verification";
import {demand,requestKey,sourceOf,type CurrentPool,type CurrentCapabilities} from "./current-financial-contract";
import {lagosDate} from "./student-platform-rollout";

type Bank = {verified:boolean;fingerprint:string;bankName:string;accountName:string;accountNumber:string};
type Dependencies = CurrentCapabilities & {openBank?:(sealed:{ciphertext:string;keyVersion:string})=>Bank};
const open = (p:any,deps:Dependencies) => {
  const bank:Bank=(deps.openBank??openBroPayoutBank)(p.snapshot.bank.sealed);
  demand(bank.verified===true&&bank.fingerprint===p.snapshot.bank.fingerprint
    &&/^\d{10}$/.test(bank.accountNumber),"FROZEN_BANK_INVALID");
  return bank;
};

/** Audited disclosure of the frozen payout destination, never the mutable profile. */
export async function revealCurrentBroPayoutBank(pool:CurrentPool,actorId:number,id:number,key:string,reason:string,deps:Dependencies={}){
  requestKey(key);demand(reason.trim().length>=3&&reason.trim().length<=500,"REASON_REQUIRED");
  return currentTransaction(pool,actorId,async c=>{
    const p=await operation(c,id);demand(p.kind==="BRO_PAYOUT","PAYOUT_REQUIRED");
    const bank=open(p,deps);
    await appendState(c,id,await state(c,id),`bank-reveal:${key}`,actorId,
      {action:"FROZEN_BANK_REVEALED",reason:reason.trim(),bankFingerprint:bank.fingerprint,moneyMoved:false});
    return {id,bankName:bank.bankName,accountName:bank.accountName,accountNumber:bank.accountNumber,moneyMoved:false};
  });
}

export type ExternalBroTransfer = {
  ids:number[];key:string;reason:string;transferReference:string;statementReference:string;
  transferDate:string;amountMinor:number;confirmExternalTransfer:true;independentlyChecked:true;
};
/**
 * Owner bookkeeping of an independently completed and statement-checked transfer.
 * This is deliberately NOT automatic provider verification and never calls a bank.
 * A single external transfer can settle several already-reserved approved lines,
 * without a second ledger or reusing its reference for a different group.
 */
export async function recordCurrentExternalBroTransfer(pool:CurrentPool,actorId:number,input:ExternalBroTransfer,deps:Dependencies={}){
  requestKey(input.key);
  demand(input.ids.length>0&&input.ids.length<=500&&new Set(input.ids).size===input.ids.length,"DISTINCT_PAYOUTS_REQUIRED");
  demand(input.confirmExternalTransfer===true&&input.independentlyChecked===true,"EXTERNAL_TRANSFER_AND_STATEMENT_CONFIRMATION_REQUIRED");
  demand(input.reason.trim().length>=3&&input.reason.trim().length<=500,"REASON_REQUIRED");
  const validRef=(s:string)=>typeof s==="string"&&s.trim().length>=6&&s.length<=120&&!/[\u0000-\u001f\u007f-\u009f]/.test(s);
  demand(validRef(input.transferReference)&&validRef(input.statementReference),"BANK_TRANSFER_EVIDENCE_REQUIRED");
  const now=deps.now?.()??new Date();
  demand(/^\d{4}-\d{2}-\d{2}$/.test(input.transferDate)
    &&!Number.isNaN(Date.parse(`${input.transferDate}T12:00:00Z`))
    &&new Date(`${input.transferDate}T12:00:00Z`).toISOString().slice(0,10)===input.transferDate
    &&input.transferDate<=lagosDate(now),"VALID_COMPLETED_TRANSFER_DATE_REQUIRED");
  const ids=[...input.ids].sort((a,b)=>a-b);
  const evidence={action:"EXTERNAL_BANK_TRANSFER_RECORDED",operationIds:ids,amountMinor:input.amountMinor,
    transferReference:input.transferReference.trim(),statementReference:input.statementReference.trim(),
    transferDate:input.transferDate,reason:input.reason.trim(),recordedBy:actorId,
    verificationMethod:"OWNER_REVIEWED_BANK_STATEMENT",automaticVerification:false,moneySentByApp:false};
  return currentTransaction(pool,actorId,async c=>{
    const prior=(await c.query(`SELECT * FROM current_subscription_operation_events WHERE event_key=$1`,
      [`${ids[0]}:external-paid:${input.key}`])).rows[0];
    if(prior){
      demand(digest(prior.details)===digest(evidence),"IDEMPOTENCY_CONTENT_CONFLICT");
      return {ids,state:await state(c,ids[0]),replayed:true,moneySentByApp:false};
    }
    demand(Number.isSafeInteger(input.amountMinor)&&input.amountMinor===ids.length*15000,"TRANSFER_AMOUNT_MUST_EQUAL_RESERVED_PAYOUTS");
    const payouts=[];let beneficiary:number|undefined,fingerprint:string|undefined;
    for(const id of ids){
      const p=await operation(c,id);
      demand(p.kind==="BRO_PAYOUT"&&Number(p.amount_minor)===15000&&await state(c,id)==="PENDING","REVIEWED_PENDING_PAYOUT_REQUIRED");
      const entitlement=p.bulk_entitlement_id?{bulkEntitlementId:Number(p.bulk_entitlement_id)}:Number(p.entitlement_id);
      const {root,e}=await currentBroRoot(c,entitlement,actorId);
      demand(Number(p.parent_id)===Number(root.id)&&await state(c,Number(root.id))==="PENDING","PAYOUT_RESERVATION_NOT_CURRENT");
      demand((await c.query(`SELECT 1 FROM current_bro_withdrawal_lines l JOIN current_bro_withdrawal_decisions d
        ON d.line_id=l.id AND d.decision='APPROVED' WHERE l.journal_id=$1`,[root.id])).rows[0],"APPROVED_WITHDRAWAL_REQUIRED");
      const bank=open(p,deps);
      demand(beneficiary===undefined||beneficiary===Number(e.partner_profile_id),"SINGLE_BRO_TRANSFER_REQUIRED");
      demand(fingerprint===undefined||fingerprint===bank.fingerprint,"SAME_FROZEN_BANK_REQUIRED");
      beneficiary=Number(e.partner_profile_id);fingerprint=bank.fingerprint;
      demand((await c.query(`SELECT 1 FROM partner_profiles p JOIN app_users u ON u.id=p.user_id
        WHERE p.id=$1 AND p.status='ACTIVE' AND u.status='ACTIVE' AND EXISTS(
          SELECT 1 FROM school_memberships m WHERE m.user_id=u.id AND m.role='PARTNER' AND m.status='ACTIVE')
        FOR SHARE OF p,u`,[beneficiary])).rows[0],"BRO_NO_LONGER_ACTIVE");
      demand(e.partner_status==="ACTIVE"&&e.term_end<lagosDate(now)
        &&!await hasCurrentAdverseHold(c,sourceOf(root))
        &&(await refundAmounts(c,sourceOf(root))).netPaidMinor===320000,"ENTITLEMENT_NOT_PAYABLE");
      demand(input.transferDate>=lagosDate(new Date(p.created_at)),"TRANSFER_PREDATES_PAYOUT_RESERVATION");
      payouts.push(p);
    }
    // Shared financial transaction gate + existing unique reference claims protect
    // against concurrent/current/historical duplicate external payout recording.
    await claimReference(c,"BRO_PAYOUT",input.transferReference,ids[0]);
    for(const p of payouts){
      await appendState(c,Number(p.id),"SUCCEEDED",`external-paid:${input.key}`,actorId,evidence);
      await appendState(c,Number(p.parent_id),"SUCCEEDED",`external-payout:${p.id}`,actorId,
        {payoutId:Number(p.id),transferReference:input.transferReference.trim(),transferDate:input.transferDate,
          verificationMethod:evidence.verificationMethod,moneySentByApp:false});
    }
    return {ids,state:"SUCCEEDED",verificationMethod:evidence.verificationMethod,moneySentByApp:false};
  });
}
