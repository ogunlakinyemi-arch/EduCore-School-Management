import {financialTransaction} from "./financial-transaction";
import {requireFinancialActor} from "./financial-history-writes";
import {currentFinanceActor,requireCurrentExtensions,parseEntitlementKey} from "./current-finance-access";
import {currentBroRoot,hasCurrentAdverseHold,approveCurrentBroInTransaction} from "./current-bro-lifecycle";
import {demand,requestKey,sourceOf,type CurrentPool,type CurrentCapabilities} from "./current-financial-contract";
import {digest,refundAmounts,state,appendState} from "./current-financial-store";

export async function requestCurrentBroWithdrawal(pool:CurrentPool,actorId:number,keys:string[],key:string,reason:string){
  requestKey(key);demand(reason.trim().length>=3&&reason.trim().length<=500,"REASON_REQUIRED");
  demand(keys.length>0&&keys.length<=500&&new Set(keys).size===keys.length,"DISTINCT_ENTITLEMENTS_REQUIRED");
  const sorted=[...keys].sort();sorted.forEach(parseEntitlementKey);
  return financialTransaction(pool,async c=>{
    await requireCurrentExtensions(c);
    const actor=await currentFinanceActor(c,actorId);
    demand(actor.partnerId&&!actor.owner,"ACTUAL_BRO_PROFILE_OWNER_REQUIRED");
    const old=(await c.query("SELECT * FROM current_bro_withdrawals WHERE request_key=$1",[key])).rows[0];
    const snapshot={entitlementKeys:sorted,amountMinor:sorted.length*15000,reason:reason.trim()};
    if(old){
      demand(Number(old.created_by)===actorId&&digest(old.snapshot)===digest(snapshot),"IDEMPOTENCY_CONTENT_CONFLICT");
      return {id:Number(old.id),amountMinor:Number(old.amount_minor),replayed:true};
    }
    const roots=[];
    for(const k of sorted){
      const {root,e}=await currentBroRoot(c,parseEntitlementKey(k),actorId);
      demand(Number(e.partner_profile_id)===actor.partnerId,"OWN_ENTITLEMENT_REQUIRED");
      demand(await state(c,Number(root.id))==="REQUESTED"
        &&!await hasCurrentAdverseHold(c,sourceOf(root))
        &&(await refundAmounts(c,sourceOf(root))).netPaidMinor===320000,"ENTITLEMENT_NOT_REQUESTABLE");
      roots.push(root);
    }
    const request=(await c.query(`INSERT INTO current_bro_withdrawals
      (partner_profile_id,created_by,request_key,amount_minor,reason,snapshot) VALUES($1,$2,$3,$4,$5,$6::jsonb) RETURNING id`,
      [actor.partnerId,actorId,key,snapshot.amountMinor,reason.trim(),JSON.stringify(snapshot)])).rows[0];
    for(const root of roots)await c.query(`INSERT INTO current_bro_withdrawal_lines
      (request_id,entitlement_id,bulk_entitlement_id,journal_id) VALUES($1,$2,$3,$4)`,
      [request.id,root.entitlement_id,root.bulk_entitlement_id??null,root.id]);
    return {id:Number(request.id),amountMinor:snapshot.amountMinor,state:"PENDING_OWNER_DECISIONS"};
  });
}
export async function decideCurrentBroWithdrawal(pool:CurrentPool,actorId:number,input:{
  requestId:number;entitlementKey:string;decision:"APPROVED"|"REJECTED";key:string;reason:string},deps:CurrentCapabilities={}){
  requestKey(input.key);demand(["APPROVED","REJECTED"].includes(input.decision),"INVALID_DECISION");
  demand(input.reason.trim().length>=3&&input.reason.trim().length<=500,"REASON_REQUIRED");
  const entitlement=parseEntitlementKey(input.entitlementKey);
  return financialTransaction(pool,async c=>{
    await requireFinancialActor(c,actorId);await requireCurrentExtensions(c);
    const line=(await c.query(`SELECT l.* FROM current_bro_withdrawal_lines l
      WHERE request_id=$1 AND ${typeof entitlement==="number"?"entitlement_id":"bulk_entitlement_id"}=$2`,
      [input.requestId,typeof entitlement==="number"?entitlement:entitlement.bulkEntitlementId])).rows[0];
    demand(line,"WITHDRAWAL_ENTITLEMENT_NOT_FOUND");
    const prior=(await c.query("SELECT * FROM current_bro_withdrawal_decisions WHERE line_id=$1",[line.id])).rows[0];
    if(prior){
      demand(prior.request_key===input.key&&prior.decision===input.decision&&prior.reason===input.reason.trim()
        &&Number(prior.decided_by)===actorId,"WITHDRAWAL_ENTITLEMENT_ALREADY_DECIDED");
      return {requestId:input.requestId,entitlementKey:input.entitlementKey,state:prior.decision};
    }
    if(input.decision==="APPROVED"){
      demand((await c.query(`SELECT 1 FROM current_bro_withdrawals w
        JOIN partner_profiles p ON p.id=w.partner_profile_id AND p.user_id=w.created_by AND p.status='ACTIVE'
        JOIN app_users u ON u.id=p.user_id AND u.status='ACTIVE'
        JOIN school_memberships m ON m.user_id=u.id AND m.role='PARTNER' AND m.status='ACTIVE'
        WHERE w.id=$1 FOR SHARE OF p,u,m`,[input.requestId])).rows[0],"REQUESTING_BRO_NO_LONGER_ACTIVE");
      await approveCurrentBroInTransaction(c,actorId,entitlement,input.key,deps);
    }
    else{
      demand(await state(c,Number(line.journal_id))==="REQUESTED","ENTITLEMENT_NO_LONGER_REJECTABLE");
      await appendState(c,Number(line.journal_id),"HELD",`withdraw-reject:${input.key}`,actorId,
        {decision:"REJECTED",requestId:input.requestId,reason:input.reason.trim(),moneyMoved:false});
    }
    await c.query(`INSERT INTO current_bro_withdrawal_decisions(line_id,decision,decided_by,reason,request_key)
      VALUES($1,$2,$3,$4,$5)`,[line.id,input.decision,actorId,input.reason.trim(),input.key]);
    return {requestId:input.requestId,entitlementKey:input.entitlementKey,state:input.decision,moneyMoved:false};
  });
}
