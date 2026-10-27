import { createHash } from "node:crypto";
import { hostedConfiguration, HostedPaymentError } from "./hosted-manual-policy";

export type PayoutBank = { bankCode:string; accountNumber:string; accountName:string };
export type PayoutTransfer = {
  id:string; reference:string; status:"PROCESSING"|"SUCCESS"|"FAILED"; amountMinor:number;
  currency:string; debitCurrency:string; bankFingerprint:string; feeMinor:number; feeRaw:string;
};
export const bankFingerprint=(b:Pick<PayoutBank,"bankCode"|"accountNumber">)=>
  createHash("sha256").update(`${b.bankCode}:${b.accountNumber}`).digest("hex");
export const payoutHash=(v:unknown)=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
const blocked=(message:string):never=>{throw new HostedPaymentError(503,"PAYOUT_PROVIDER_UNVERIFIED",message);};
export function providerMinor(v:unknown,fee=false) {
  const s=String(v);
  if(!/^\d+(?:\.\d{1,6})?$/.test(s)) return blocked("Provider returned an invalid amount.");
  const [whole,fraction=""]=s.split(".");
  const minor=Number(whole)*100+Number(fraction.padEnd(2,"0").slice(0,2));
  if(!Number.isSafeInteger(minor)) return blocked("Provider amount exceeds supported limits.");
  // Preserve the original fee decimal as well; conservatively reserve fractional kobo.
  if(/[1-9]/.test(fraction.slice(2))) {
    if(!fee) return blocked("Provider principal has unsupported precision.");
    return minor+1;
  }
  return minor;
}
export function schoolPayoutConfiguration(env:NodeJS.ProcessEnv=process.env) {
  const c=hostedConfiguration(env),blockers=[...c.blockers];
  const readBlockers:string[]=[];
  if(!["TEST","LIVE"].includes(env.EDUCORE_HOSTED_PAYMENTS_MODE??"")) readBlockers.push("An explicit original TEST/LIVE mode is required.");
  if(!c.secret || (c.mode==="TEST"?!/^FLWSECK_TEST-/.test(c.secret):!/^(?:FLWSECK-|FLWSECK_LIVE-)/.test(c.secret)||/TEST/i.test(c.secret)))
    readBlockers.push(`The dedicated ${c.mode} credential is missing or does not identify its mode.`);
  if(c.mode==="LIVE"&&env.NODE_ENV!=="production") readBlockers.push("LIVE transfer reads are forbidden in Development.");
  if(env.EDUCORE_SCHOOL_PAYOUTS_ENABLED!=="true") blockers.push("EDUCORE_SCHOOL_PAYOUTS_ENABLED must explicitly enable school payouts.");
  if(env.EDUCORE_SCHOOL_PAYOUTS_FUNDING_SOURCE!=="MERCHANT_NGN_BALANCE")
    blockers.push("Select MERCHANT_NGN_BALANCE as the reviewed funding source; collection subaccounts are not transfer destinations.");
  if(env[`EDUCORE_SCHOOL_PAYOUTS_${c.mode}_APPROVED`]!=="true")
    blockers.push(`Owner release approval EDUCORE_SCHOOL_PAYOUTS_${c.mode}_APPROVED is missing.`);
  if(c.secret && (c.mode==="TEST"?!/^FLWSECK_TEST-/.test(c.secret):!/^(?:FLWSECK-|FLWSECK_LIVE-)/.test(c.secret)||/TEST/i.test(c.secret)))
    blockers.push(`The dedicated secret does not identify the selected ${c.mode} mode.`);
  if(c.mode==="LIVE") for(const [key,label] of [
    ["FLUTTERWAVE_TRANSFER_CAPABILITY_CONFIRMED","Flutterwave merchant Transfers via API permission"],
    ["FLUTTERWAVE_KYC_APPROVED","merchant KYC approval"],
    ["FLUTTERWAVE_SERVER_IP_WHITELIST_CONFIRMED","server IP allowlisting"],
  ]) if(env[key]!=="true") blockers.push(`Confirm ${label} (${key}).`);
  const fee=Number(env.EDUCORE_SCHOOL_PAYOUTS_MAX_FEE_MINOR);
  if(!/^\d+$/.test(env.EDUCORE_SCHOOL_PAYOUTS_MAX_FEE_MINOR??"")||!Number.isSafeInteger(fee)||fee<0||fee>=300000)
    blockers.push("Configure EDUCORE_SCHOOL_PAYOUTS_MAX_FEE_MINOR as a reviewed non-negative kobo fee ceiling below the platform share.");
  return {mode:c.mode,secret:c.secret,blockers,readBlockers,ready:!blockers.length,maxFeeMinor:Number.isSafeInteger(fee)?fee:0};
}
export interface SchoolPayoutProvider {
  preflight(bank:PayoutBank):Promise<{availableMinor:number; feeMinor:number; verifiedAt:string}>;
  initiate(bank:PayoutBank,reference:string):Promise<{id:string}>;
  find(reference:string):Promise<PayoutTransfer|null>;
}
/** Flutterwave v3 bank transfers; never sends a collection subaccount ID. */
export class FlutterwaveSchoolPayoutProvider implements SchoolPayoutProvider {
  constructor(private secret:string,private http:typeof fetch=fetch) {}
  private async api(path:string,body?:unknown) {
    const response=await this.http(`https://api.flutterwave.com/v3/${path}`,{
      method:body?"POST":"GET",redirect:"error",signal:AbortSignal.timeout(15000),
      headers:{Authorization:`Bearer ${this.secret}`,"Content-Type":"application/json"},
      ...(body?{body:JSON.stringify(body)}:{}),
    });
    if(!response.ok) return blocked(`Flutterwave ${body?"request":"read"} was not confirmed (HTTP ${response.status}); reconcile, never resend.`);
    const r=await response.json() as any;
    if(r?.status!=="success") return blocked("Flutterwave did not confirm the operation; review merchant permissions and reconcile.");
    return r;
  }
  async preflight(bank:PayoutBank) {
    const banks=await this.api("banks/NG");
    const matches=Array.isArray(banks.data)?banks.data.filter((b:any)=>String(b.code)===bank.bankCode):[];
    if(matches.length!==1 || ![undefined,false,0].includes(matches[0].has_branches))
      return blocked("Recipient bank routing is unavailable or requires an unsupported branch configuration.");
    const resolved=await this.api("accounts/resolve",{account_bank:bank.bankCode,account_number:bank.accountNumber});
    const normal=(s:string)=>s.toUpperCase().replace(/[^A-Z0-9]/g,"");
    if(resolved.data?.account_number!==bank.accountNumber ||
      !normal(bank.accountName) || normal(String(resolved.data?.account_name??""))!==normal(bank.accountName))
      return blocked("Fresh provider bank-account resolution does not match the approved school beneficiary.");
    const quote=await this.api("transfers/fee?amount=1900&currency=NGN&type=account");
    const fees=Array.isArray(quote.data)?quote.data.filter((f:any)=>f.currency==="NGN"&&f.fee_type==="value"):[];
    if(fees.length!==1) return blocked("A fixed NGN bank-transfer fee quote is required.");
    const balances=await this.api("balances");
    const ngn=Array.isArray(balances.data)?balances.data.filter((b:any)=>b.currency==="NGN"):[];
    if(ngn.length!==1) return blocked("Flutterwave NGN available transfer balance is unavailable; checkout success is not funding evidence.");
    return {availableMinor:providerMinor(ngn[0].available_balance),feeMinor:providerMinor(fees[0].fee,true),verifiedAt:new Date().toISOString()};
  }
  async initiate(bank:PayoutBank,reference:string) {
    const r=await this.api("transfers",{account_bank:bank.bankCode,account_number:bank.accountNumber,
      beneficiary_name:bank.accountName,amount:1900,currency:"NGN",debit_currency:"NGN",reference,
      narration:"Yetenia EduCore school entitlement",skip_beneficiary_creation:"1"});
    if(!/^\d+$/.test(String(r.data?.id)) || Number(r.data.id)<=0 || r.data.reference!==reference)
      return blocked("Transfer acceptance is uncertain; use saved-reference reconciliation only.");
    // Even SUCCESSFUL in a POST body is not final settlement evidence.
    return {id:String(r.data.id)};
  }
  async find(reference:string):Promise<PayoutTransfer|null> {
    const list=await this.api(`transfers?reference=${encodeURIComponent(reference)}&page=1&page_size=100`);
    if(!Array.isArray(list.data)) return blocked("Transfer lookup response is invalid.");
    const exact=list.data.filter((d:any)=>d.reference===reference);
    if(exact.length>1 || Number(list.meta?.page_info?.total_pages??1)>1)
      return blocked("Transfer reference lookup is ambiguous; do not send again.");
    if(!exact.length) return null; // Not found does NOT authorize a new transfer.
    const id=String(exact[0].id);
    if(!/^\d+$/.test(id)||Number(id)<=0) return blocked("Invalid transfer identifier.");
    const r=await this.api(`transfers/${id}`),d=r.data;
    if(String(d?.id)!==id || d.reference!==reference || !/^\d{10}$/.test(String(d.account_number)) || !/^\d{3,6}$/.test(String(d.bank_code)))
      return blocked("Transfer identity cannot be verified.");
    const status=d.status==="SUCCESSFUL"?"SUCCESS":d.status==="FAILED"?"FAILED":"PROCESSING";
    if(status==="SUCCESS" && (Number(d.requires_approval)!==0 || Number(d.is_approved)!==1))
      return blocked("Transfer approval is not independently confirmed.");
    return {id,reference,status,amountMinor:providerMinor(d.amount),currency:String(d.currency),
      debitCurrency:String(d.debit_currency??""),bankFingerprint:bankFingerprint({bankCode:String(d.bank_code),accountNumber:String(d.account_number)}),
      feeMinor:providerMinor(d.fee,true),feeRaw:String(d.fee)};
  }
}
