import {FlutterwaveLiveTransport} from "../lib/flutterwave-live-transport";
import {directLiveConfiguration} from "../lib/flutterwave-direct-live-config";
import {FlutterwavePayrollV3Client} from "../lib/flutterwave-payroll-v3";
import {decryptPartnerPayoutValue} from "../lib/partner-payout-crypto";
import {freezeCurrentBroBank} from "./current-bro-bank";
import {openBroPayoutBank} from "./bro-bank-verification";
import {demand,type CurrentCapabilities,type CurrentPool} from "./current-financial-contract";
import {referenceFor} from "./current-financial-store";

/** Lazy real adapters: constructing this object never calls providers or reads bank data. */
export function currentProviderAdapters(pool:CurrentPool,env:NodeJS.ProcessEnv=process.env,fetcher:typeof fetch=fetch):CurrentCapabilities{
 const transport=()=>new FlutterwaveLiveTransport(env,fetcher,"DIRECT_STUDENT");
 return {
  bank:(c,id)=>freezeCurrentBroBank(c,id,(v,version)=>decryptPartnerPayoutValue(v,version,env)),
  refunds:{
   validate:({amountMinor})=>{
     demand(directLiveConfiguration(env).ready,"CURRENT_LIVE_DIRECT_RELEASE_REQUIRED");
     demand(amountMinor>=10000,"REFUND_MINIMUM_NGN_100");
   },
   request:input=>transport().currentRefundRequest(input),
   async verify(reference){
    demand(/^YETENIA_CURRENT_[1-9][0-9]*$/.test(reference),"INVALID_REFUND_REFERENCE");
    const c=await pool.connect();
    let claim:any;
    try{claim=(await c.query(`SELECT r.reference FROM current_subscription_reference_claims r
      JOIN current_subscription_operations o ON o.id=r.operation_id
      WHERE r.namespace='REFUND' AND o.kind='REFUND' AND o.id=$1`,[reference.slice(16)])).rows[0];}
    finally{c.release();}
    demand(claim,"REFUND_PROVIDER_ID_NOT_RETAINED_MANUAL_RECONCILIATION_REQUIRED");
    const r=await transport().currentRefundVerification(claim.reference);
    demand(r.status!=="unknown","REFUND_PROVIDER_STATUS_NOT_FINAL_OR_UNSUPPORTED");
    return {requestReference:reference,providerReference:r.providerRefundId,collectionTransactionId:r.providerTransactionId,
      amountMinor:r.amountMinor,currency:"NGN",status:r.status==="succeeded"?"SUCCEEDED":r.status==="failed"?"FAILED":"PENDING"};
   },
  },
  // No transfer POST: current product policy is externally completed manual payouts.
  // Only an existing LIVE provider transfer with this exact frozen reference can verify.
  async payoutEvidence(reference){
    demand(/^YETENIA_CURRENT_[1-9][0-9]*$/.test(reference),"INVALID_PAYOUT_REFERENCE");
    const c=await pool.connect();let p:any;
    try{p=(await c.query("SELECT * FROM current_subscription_operations WHERE id=$1 AND kind='BRO_PAYOUT'",
      [reference.slice(16)])).rows[0];}finally{c.release();}
    demand(p&&referenceFor(Number(p.id))===reference,"PAYOUT_REQUIRED");
    const bank=openBroPayoutBank(p.snapshot.bank.sealed);
    demand(bank.fingerprint===p.snapshot.bank.fingerprint&&bank.verified===true,"FROZEN_BANK_INVALID");
    const client=new FlutterwavePayrollV3Client(env,fetcher);
    demand(client.capability().mode==="LIVE","LIVE_INDEPENDENT_PAYOUT_VERIFICATION_NOT_CONFIGURED");
    const r=await client.verifyNgnTransferByReference({reference,expectedAmountNaira:150,
      expectedBankCode:bank.bankCode,expectedAccountNumber:bank.accountNumber});
    demand(r,"EXISTING_TRANSFER_WITH_FROZEN_REFERENCE_REQUIRED_NO_TRANSFER_SENT");
    // Preserve the provider's explicit reversal signal separately from payroll's
    // retained FAILED projection; a reversal is not retry permission.
    return {requestReference:reference,providerReference:r.transferId,amountMinor:15000,currency:"NGN",
      bankFingerprint:p.snapshot.bank.fingerprint,evidenceReference:`flutterwave-transfer:${r.transferId}`,
      status:r.reversed?"REVERSED":r.status==="SUCCESSFUL"?"SUCCEEDED":r.status==="FAILED"?"FAILED":"PENDING"};
  },
  // Incoming bank recoveries and collection reversals lack independently bound
  // evidence contracts. Deliberately absent: request-body assertions are not proof.
 };
}
