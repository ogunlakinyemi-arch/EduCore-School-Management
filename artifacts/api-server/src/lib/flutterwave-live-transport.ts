import { timingSafeEqual } from "node:crypto";
import { flutterwaveLiveWebhookVerifier } from "./flutterwave-live-config";
import { liveReleaseConfiguration } from "./flutterwave-live-release";
import { liveAmountMinor } from "./flutterwave-live-finalization-event";
import { LiveFinalizationBlocked, type LiveCollectionVerifier } from "./flutterwave-live-verification";
import type { StudentSubscriptionSqlPool } from "./student-subscription-billing";
import { directLiveConfiguration } from "./flutterwave-direct-live-config";

function fail(code:string):never {throw new LiveFinalizationBlocked(code);}
function object(value:unknown):Record<string,any> {
  if(!value||typeof value!=="object"||Array.isArray(value))return fail("LIVE_PROVIDER_RESPONSE_INVALID");
  return value as Record<string,any>;
}
export function liveCheckoutUrl(value:unknown):value is string {
  if(typeof value!=="string")return false;
  try {
    const u=new URL(value);
    return u.protocol==="https:"&&u.hostname==="checkout.flutterwave.com"&&!u.username&&!u.password&&!u.port
      &&/^\/v3\/hosted\/pay\/[A-Za-z0-9_-]+\/?$/.test(u.pathname)&&!u.search&&!u.hash;
  }catch{return false;}
}
/** V3's documented shared verif-hash, constant-time and LIVE-bound. No TEST fallback. */
export function authenticateLiveWebhook(headers:Record<string,unknown>,env:NodeJS.ProcessEnv=process.env) {
  if(!liveReleaseConfiguration(env).ready)fail("LIVE_RELEASE_CONFIGURATION_BLOCKED");
  const supplied=headers["verif-hash"],expected=flutterwaveLiveWebhookVerifier(env)!;
  if(typeof supplied!=="string"||Buffer.byteLength(supplied)!==Buffer.byteLength(expected)
    ||!timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)))fail("LIVE_WEBHOOK_AUTHENTICATION_FAILED");
}

/** Dedicated V3 LIVE transport. Never shares TEST adapters, endpoints or credentials.
 * Caller must additionally pass the DB release gate before using this transport. */
export class FlutterwaveLiveTransport {
  constructor(private readonly env:NodeJS.ProcessEnv=process.env,
    private readonly fetcher:typeof fetch=fetch,private readonly purpose:"LEGACY_SPLIT"|"DIRECT_STUDENT"="LEGACY_SPLIT") {
    if(!(purpose==="DIRECT_STUDENT"?directLiveConfiguration(env).ready:liveReleaseConfiguration(env).ready))fail("LIVE_RELEASE_CONFIGURATION_BLOCKED");
  }
  private async request(endpoint:string,init:RequestInit,signal?:AbortSignal) {
    const timeout=AbortSignal.timeout(3000);
    try {
      const response=await this.fetcher(`https://api.flutterwave.com/v3/${endpoint}`,{
        ...init,redirect:"error",signal:signal?AbortSignal.any([timeout,signal]):timeout,
        headers:{"Authorization":`Bearer ${this.env.FLUTTERWAVE_LIVE_SECRET_KEY!}`,"Content-Type":"application/json"},
      });
      if(!response.ok || !response.body)fail("LIVE_PROVIDER_UNAVAILABLE");
      const reader=response.body.getReader(),chunks:Uint8Array[]=[];
      let size=0;
      try {
        while(true){
          const part=await reader.read();if(part.done)break;
          size+=part.value.length;
          if(size>65536){await reader.cancel();fail("LIVE_PROVIDER_RESPONSE_TOO_LARGE");}
          chunks.push(part.value);
        }
      }finally{reader.releaseLock();}
      const body=object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      if(body.status!=="success")fail("LIVE_PROVIDER_UNAVAILABLE");
      return object(body.data);
    }catch(error){
      if(error instanceof LiveFinalizationBlocked)throw error;
      // Never propagate request objects, provider bodies, headers or error causes.
      fail("LIVE_PROVIDER_UNAVAILABLE");
    }
  }
  async checkout(input:{reference:string;email:string;schoolSubaccountId:string}):Promise<string> {
    // Signature retained for old callers; only historical GET verification is
    // supported. Even complete old LIVE configuration cannot initiate a split.
    void input;
    return fail("LEGACY_SPLIT_WORKFLOW_ARCHIVED");
  }
  async collection(transactionId:string,reference:string,signal?:AbortSignal) {
    if(this.purpose!=="LEGACY_SPLIT")fail("LIVE_VERIFICATION_INPUT_INVALID");
    if(!/^[1-9][0-9]{0,15}$/.test(transactionId)||BigInt(transactionId)>BigInt(Number.MAX_SAFE_INTEGER)
      ||!/^SCV3_live_[A-Za-z0-9_-]{8,80}$/.test(reference))
      fail("LIVE_VERIFICATION_INPUT_INVALID");
    const d=await this.request(`transactions/${transactionId}/verify`,{method:"GET"},signal);
    if(String(d.id)!==transactionId || d.tx_ref!==reference || d.currency!=="NGN"
      ||liveAmountMinor(d.amount)!==500000 ||liveAmountMinor(d.charged_amount)!==500000)
      fail("LIVE_VERIFICATION_MISMATCH");
    if(d.status!=="successful")fail(d.status==="pending"?"LIVE_COLLECTION_PENDING":"LIVE_COLLECTION_NOT_SUCCESSFUL");
    if(typeof d.flw_ref!=="string"||!d.flw_ref.length||d.flw_ref.length>200)fail("LIVE_VERIFICATION_MISMATCH");
    // app_fee and merchant_fee must both be explicit: never assume unknown fees are zero.
    const providerFeeMinor=liveAmountMinor(d.app_fee),additionalFeeMinor=liveAmountMinor(d.merchant_fee);
    if(providerFeeMinor+additionalFeeMinor>=300000)fail("LIVE_VERIFICATION_MISMATCH");
    return {transactionId,reference,providerReference:d.flw_ref as string,providerFeeMinor,additionalFeeMinor};
  }
  async directStudentCheckout(input:{reference:string;email:string}){
    if(this.purpose!=="DIRECT_STUDENT" || !/^SCV4_live_[A-Za-z0-9_-]{8,80}$/.test(input.reference)
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))fail("LIVE_CHECKOUT_INPUT_INVALID");
    const data=await this.request("payments",{method:"POST",body:JSON.stringify({
      tx_ref:input.reference,amount:3200,currency:"NGN",
      redirect_url:directLiveConfiguration(this.env).callbackUrl,customer:{email:input.email},
    })});
    if(!liveCheckoutUrl(data.link))fail("LIVE_CHECKOUT_LINK_INVALID");
    return data.link as string;
  }
  async directStudentCollection(transactionId:string,reference:string){
    if(this.purpose!=="DIRECT_STUDENT" || !/^[1-9][0-9]{0,15}$/.test(transactionId)
      || BigInt(transactionId)>BigInt(Number.MAX_SAFE_INTEGER)
      || !/^SCV4_live_[A-Za-z0-9_-]{8,80}$/.test(reference))fail("LIVE_VERIFICATION_INPUT_INVALID");
    const d=await this.request(`transactions/${transactionId}/verify`,{method:"GET"});
    if(String(d.id)!==transactionId || d.tx_ref!==reference || d.currency!=="NGN"
      || liveAmountMinor(d.amount)!==320000
      || (d.subaccounts!=null&&(!Array.isArray(d.subaccounts)||d.subaccounts.length>0))
      || ["subaccount_id","subaccount","split","split_ratio","split_type","split_value",
        "transaction_charge","transaction_charge_type"].some(key=>d[key]!=null)
      || (typeof d.flw_ref==="string"&&d.flw_ref.length>200))fail("LIVE_VERIFICATION_MISMATCH");
    if(!["successful","failed","cancelled","pending"].includes(d.status))fail("LIVE_VERIFICATION_MISMATCH");
    // A failed or cancelled attempt is retryable only if the provider explicitly
    // reports zero charged amount; any charged/unknown failure remains uncertain.
    if(d.status==="successful" && (liveAmountMinor(d.charged_amount)!==320000
      || typeof d.flw_ref!=="string" || !d.flw_ref.length))fail("LIVE_VERIFICATION_MISMATCH");
    if(d.status==="failed" || d.status==="cancelled"){
      if(liveAmountMinor(d.charged_amount)!==0)fail("LIVE_VERIFICATION_MISMATCH");
    }
    const providerFeeMinor=d.status==="successful"?liveAmountMinor(d.app_fee):null;
    const additionalFeeMinor=d.status==="successful"?liveAmountMinor(d.merchant_fee):null;
    if(providerFeeMinor!==null && additionalFeeMinor!==null && providerFeeMinor+additionalFeeMinor>=320000)fail("LIVE_VERIFICATION_MISMATCH");
    return {transactionId,reference,providerReference:typeof d.flw_ref==="string"?d.flw_ref:null,providerFeeMinor,additionalFeeMinor,
      status:d.status as "successful"|"failed"|"cancelled"|"pending"};
  }
}

/** V3 collection read + separately reviewed transaction-bound provider allocation.
 * Echoed subaccounts/metadata and browser/webhook claims are NEVER allocation proof.
 * Until real provider report evidence is reviewed the verifier fails closed. */
export function liveCollectionVerifier(pool:StudentSubscriptionSqlPool,transport:FlutterwaveLiveTransport,
  merchantScope:string):LiveCollectionVerifier {
  return {enabled:true,environment:"LIVE",merchantScope,async verify(input){
    const proof=await transport.collection(input.transactionId,input.reference,input.signal);
    const client=await pool.connect();
    let review:any;
    try {
      review=(await client.query(`SELECT * FROM flutterwave_live_allocation_reviews
        WHERE merchant_scope=$1 AND reference=$2 AND transaction_id=$3 AND school_subaccount_id=$4`,
      [merchantScope,input.reference,input.transactionId,input.schoolSubaccountId])).rows[0];
    }finally{client.release();}
    if(!review||review.currency!=="NGN"||review.school_minor!==190000||review.gross_minor!==500000
      ||review.provider_reference!==proof.providerReference||review.provider_fee_minor!==proof.providerFeeMinor
      ||review.additional_fee_minor!==proof.additionalFeeMinor)fail("LIVE_TRANSACTION_ALLOCATION_EVIDENCE_REQUIRED");
    return {environment:"LIVE",merchantScope,...proof,status:"succeeded",currency:"NGN",amountMinor:500000,
      chargedAmountMinor:500000,recipientEvidence:"TRANSACTION_BOUND",
      recipients:[{subaccountId:input.schoolSubaccountId,currency:"NGN",amountMinor:190000}]};
  }};
}
