import type {CurrentSql,FrozenBank} from "./current-financial-contract";
import {decryptPartnerPayoutValue} from "../lib/partner-payout-crypto";
import {verifiedBroBank,maskedBroBank} from "./bro-bank-verification";

/** Current saved profile, masked and separately labelled from frozen payouts. */
export async function currentBroSavedBank(c:CurrentSql,partnerId:number){
  const exists=(await c.query(`SELECT to_regclass('public.partner_payout_information') IS NOT NULL AS present`)).rows[0]?.present;
  if(!exists)return null;
  const identity=(await c.query(`SELECT id,full_name,user_id,status FROM partner_profiles WHERE id=$1`,[partnerId])).rows[0];
  if(!identity)return null;
  return maskedBroBank(await verifiedBroBank(c,identity,decryptPartnerPayoutValue));
}
/**
 * Existing verified registered-person workflow only. No lookup/verification API
 * is called, and raw account details are never returned by this adapter.
 */
export async function freezeCurrentBroBank(c: CurrentSql, partnerId: number,
  decryptExistingPartnerValue: (value:string,version:string)=>string): Promise<FrozenBank|null> {
  const identity=(await c.query(`SELECT p.id,p.full_name,p.user_id,p.status
    FROM partner_profiles p JOIN app_users u ON u.id=p.user_id
    WHERE p.id=$1 AND p.status='ACTIVE' AND u.status='ACTIVE' FOR SHARE OF p,u`,[partnerId])).rows[0];
  if (!identity) return null;
  const {verifiedBroBank,bankFingerprint,broBankRow,sealBroPayoutBank}=await import("./bro-bank-verification");
  // Partner storage uses its existing cipher format, not payroll's AAD format.
  // The existing server-side caller must supply its established decrypt helper.
  const bank=await verifiedBroBank(c,identity,decryptExistingPartnerValue);
  if (!bank) return null;
  const fingerprint=bankFingerprint(await broBankRow(c,partnerId));
  return {verified:true,fingerprint,maskedAccountNumber:bank.maskedAccountNumber,
    bankName:bank.bankName,accountName:bank.accountName,
    sealed:sealBroPayoutBank({...bank,fingerprint,purpose:"CURRENT_INDIVIDUAL_BRO"})};
}
