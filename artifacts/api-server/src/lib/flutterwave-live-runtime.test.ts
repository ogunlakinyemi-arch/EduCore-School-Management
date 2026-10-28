import {describe,it,expect,vi} from "vitest";
import {liveReleaseConfiguration,requireLiveRelease} from "./flutterwave-live-release";
import {FlutterwaveLiveTransport,authenticateLiveWebhook,liveCollectionVerifier} from "./flutterwave-live-transport";
import {flutterwaveLiveWebhookVerifier,flutterwaveTestWebhookVerifier} from "./flutterwave-live-config";
import {processReleasedLiveWebhook,verifyLiveCallback} from "../services/flutterwave-live-runtime";

// Fictional configuration and an injected HTTP transport only; never inherited keys.
export const runtimeEnv=():NodeJS.ProcessEnv=>({
  NODE_ENV:"production",EDUCORE_FLUTTERWAVE_MODE:"LIVE",EDUCORE_FLUTTERWAVE_RELEASE:"SCV3_V1",
  EDUCORE_FLUTTERWAVE_MERCHANT_SCOPE:"fictional_merchant",
  FLUTTERWAVE_LIVE_SECRET_KEY:"FLWSECK-fictional-live-key",
  FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH:"fictional-live-verifier-value",
  FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH:"fictional-test-verifier-value",PUBLIC_APP_URL:"https://payment.invalid",
  FLUTTERWAVE_LIVE_WEBHOOK_URL:"https://payment.invalid/api/webhooks/flutterwave/live/student-subscription",
});
const reference="SCV3_live_fictional_payment_123",school="RS_FictionalSchool123";
const data=()=>({id:123,tx_ref:reference,flw_ref:"fictional-provider-123",status:"successful",currency:"NGN",
  amount:5000,charged_amount:5000,app_fee:75,merchant_fee:0});
const response=(value:unknown)=>new Response(JSON.stringify({status:"success",data:value}),{
  status:200,headers:{"content-type":"application/json"}});
describe("default-disabled LIVE runtime and separate webhook secrets",()=>{
  it("cannot acquire a DB or transport under default, TEST or Development configuration",async()=>{
    const pool={connect:vi.fn()};
    for(const env of [{},{...runtimeEnv(),NODE_ENV:"development"},{...runtimeEnv(),EDUCORE_FLUTTERWAVE_MODE:"TEST"}]){
      expect(liveReleaseConfiguration(env).ready).toBe(false);
      await expect(requireLiveRelease(pool as any,env)).rejects.toHaveProperty("code","LIVE_RELEASE_CONFIGURATION_BLOCKED");
      expect(()=>new FlutterwaveLiveTransport(env,vi.fn())).toThrow();
    }
    expect(pool.connect).not.toHaveBeenCalled();
  });
  it.each(["FLUTTERWAVE_LIVE_SECRET_KEY","FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH",
    "FLUTTERWAVE_LIVE_WEBHOOK_URL","PUBLIC_APP_URL","EDUCORE_FLUTTERWAVE_MERCHANT_SCOPE",
    "EDUCORE_FLUTTERWAVE_RELEASE"])("blocks absent %s",key=>{
    expect(liveReleaseConfiguration({...runtimeEnv(),[key]:undefined}).ready).toBe(false);
  });
  it("keeps TEST and LIVE hashes distinct; shared TEST never becomes LIVE evidence",()=>{
    const env=runtimeEnv();
    expect(flutterwaveLiveWebhookVerifier(env)).toBe(env.FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH);
    expect(flutterwaveTestWebhookVerifier(env)).toBeUndefined();
    expect(flutterwaveTestWebhookVerifier({...env,EDUCORE_FLUTTERWAVE_MODE:"TEST"})).toBe(env.FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH);
    expect(liveReleaseConfiguration({...env,FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH:env.FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH}).ready).toBe(false);
    expect(flutterwaveLiveWebhookVerifier({FLUTTERWAVE_WEBHOOK_VERIF_HASH:"legacy-test-hash-value"})).toBeUndefined();
  });
  it("uses only the dedicated LIVE verifier, never the legacy shared slot",()=>{
    const env:NodeJS.ProcessEnv={...runtimeEnv(),FLUTTERWAVE_WEBHOOK_VERIF_HASH:"different-established-live-verifier"};
    expect(flutterwaveLiveWebhookVerifier(env)).toBe(env.FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH);
    expect(liveReleaseConfiguration(env).ready).toBe(true);
    expect(flutterwaveLiveWebhookVerifier({...env,FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH:undefined})).toBeUndefined();
    expect(flutterwaveLiveWebhookVerifier({...env,
      FLUTTERWAVE_WEBHOOK_VERIF_HASH:env.FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH}))
      .toBe(env.FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH);
  });
  it("does not infer the unestablished SECRET_HASH name as TEST or LIVE configuration",()=>{
    const env={EDUCORE_FLUTTERWAVE_WEBHOOK_ENVIRONMENT:"LIVE",
      FLUTTERWAVE_WEBHOOK_SECRET_HASH:"unestablished-secret-name-only"};
    expect(flutterwaveLiveWebhookVerifier(env)).toBeUndefined();
    expect(flutterwaveTestWebhookVerifier(env)).toBeUndefined();
    expect(flutterwaveTestWebhookVerifier({FLUTTERWAVE_WEBHOOK_SECRET_HASH:env.FLUTTERWAVE_WEBHOOK_SECRET_HASH}))
      .toBeUndefined();
  });
  it("dedicated TEST cannot reuse a LIVE-only verifier even in TEST scope",()=>{
    const env={EDUCORE_FLUTTERWAVE_WEBHOOK_ENVIRONMENT:"TEST",
      FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH:"fictional-shared-test-live-hash",
      FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH:"fictional-shared-test-live-hash"};
    expect(flutterwaveTestWebhookVerifier(env)).toBeUndefined();
  });
  it("rejects missing/wrong/array signatures before any DB access",async()=>{
    const pool={connect:vi.fn()};
    for(const hash of [undefined,"wrong",["fictional-live-verifier-value"]]){
      await expect(processReleasedLiveWebhook(pool as any,Buffer.from("{}"),{"verif-hash":hash},runtimeEnv(),vi.fn()))
        .rejects.toHaveProperty("code","LIVE_WEBHOOK_AUTHENTICATION_FAILED");
    }
    expect(pool.connect).not.toHaveBeenCalled();
    expect(()=>authenticateLiveWebhook({"verif-hash":runtimeEnv().FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH},runtimeEnv())).not.toThrow();
  });
  it("requires a DB release manifest and schema before provider access",async()=>{
    const release=vi.fn(),query=vi.fn().mockResolvedValue({rows:[]}),pool={connect:async()=>({query,release})};
    await expect(requireLiveRelease(pool,runtimeEnv())).rejects.toHaveProperty("code","LIVE_TARGET_RELEASE_NOT_APPROVED");
    expect(release).toHaveBeenCalled();
    query.mockRejectedValueOnce(new Error("missing relation"));
    await expect(requireLiveRelease(pool,runtimeEnv())).rejects.toHaveProperty("code","LIVE_TARGET_SCHEMA_UNAVAILABLE");
  });
  it("does not require a separate database role when the original DB guards are verified",async()=>{
    // Fictional approved manifest/catalog responses, never an actual approval.
    // The ordinary application pool suffices; no SET ROLE or ACL mutation occurs.
    const query=vi.fn().mockResolvedValueOnce({rows:[{release_id:"SCV3_V1"}]})
      .mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{ready:true}]}),release=vi.fn();
    const result=await requireLiveRelease({connect:async()=>({query,release})},runtimeEnv());
    expect(result.capability.enabled).toBe(true);
    expect(query).toHaveBeenCalledTimes(3);
    expect(query.mock.calls.every(([sql])=>/^\s*SELECT\b/.test(String(sql)))).toBe(true);
    expect(release).toHaveBeenCalledOnce();
  });
  it.each([false,null,undefined])("rejects a manifest when DB guard readiness is %s",async ready=>{
    const query=vi.fn().mockResolvedValueOnce({rows:[{release_id:"SCV3_V1"}]})
      .mockResolvedValueOnce({rows:[]})
      .mockResolvedValueOnce({rows:ready===undefined?[]:[{ready}]}),release=vi.fn();
    await expect(requireLiveRelease({connect:async()=>({query,release})},runtimeEnv()))
      .rejects.toHaveProperty("code","LIVE_TARGET_SCHEMA_UNAVAILABLE");
    expect(release).toHaveBeenCalledOnce();
  });
  it("blocks malformed, test-host and credential-bearing callback base URLs",()=>{
    for(const url of ["http://payment.invalid","https://localhost","https://test.replit.dev",
      "https://user:password@payment.invalid","https://payment.invalid/?redirect=bad"]){
      expect(liveReleaseConfiguration({...runtimeEnv(),PUBLIC_APP_URL:url}).ready).toBe(false);
    }
  });
});
describe("real V3 request contracts through fictional HTTP only",()=>{
  it("permanently blocks split checkout even with complete legacy LIVE configuration",async()=>{
    const fetcher=vi.fn().mockResolvedValue(response({link:"https://checkout.flutterwave.com/v3/hosted/pay/fictional123"}));
    const transport=new FlutterwaveLiveTransport(runtimeEnv(),fetcher);
    await expect(transport.checkout({reference,email:"payer@example.invalid",schoolSubaccountId:school}))
      .rejects.toHaveProperty("code","LEGACY_SPLIT_WORKFLOW_ARCHIVED");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["","RS_SCHOOL_LIVE_SUBACCOUNT_ID","RS_bad"])("never posts a missing/placeholder school subaccount %s",async id=>{
    const fetcher=vi.fn();
    await expect(new FlutterwaveLiveTransport(runtimeEnv(),fetcher).checkout({
      reference,email:"payer@example.invalid",schoolSubaccountId:id})).rejects.toHaveProperty("code","LEGACY_SPLIT_WORKFLOW_ARCHIVED");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["https://checkout.flutterwave.com/v3/hosted/pay/test?bad=1","https://test.checkout.flutterwave.com/v3/hosted/pay/id",
    "https://evil.invalid/v3/hosted/pay/id","https://checkout.flutterwave.com.evil.invalid/v3/hosted/pay/id"])(
    "cannot reactivate legacy checkout using returned URL %s",async link=>{
      await expect(new FlutterwaveLiveTransport(runtimeEnv(),vi.fn().mockResolvedValue(response({link})))
        .checkout({reference,email:"payer@example.invalid",schoolSubaccountId:school})).rejects.toHaveProperty("code","LEGACY_SPLIT_WORKFLOW_ARCHIVED");
    });
  it.each([{id:124},{tx_ref:"SCV3_live_wrong_reference"},{status:"pending"},{status:"failed"},
    {currency:"USD"},{amount:4999},{amount:5001},{charged_amount:5075},{app_fee:undefined},{merchant_fee:undefined}])(
    "never verifies mismatched, pending, failed or fee-unknown evidence %o",async change=>{
      await expect(new FlutterwaveLiveTransport(runtimeEnv(),vi.fn().mockResolvedValue(response({...data(),...change})))
        .collection("123",reference)).rejects.toThrow();
    });
  it("reads only the V3 transaction endpoint and refuses echoed subaccounts as allocation proof",async()=>{
    const fetcher=vi.fn().mockResolvedValue(response({...data(),subaccounts:[{id:school,transaction_charge:1900}]}));
    const pool={connect:async()=>({query:async()=>({rows:[]}),release:()=>{}})};
    await expect(liveCollectionVerifier(pool,new FlutterwaveLiveTransport(runtimeEnv(),fetcher),"fictional_merchant")
      .verify({transactionId:"123",reference,currency:"NGN",amountMinor:500000,schoolSubaccountId:school,
        signal:AbortSignal.timeout(3000)})).rejects.toHaveProperty("code","LIVE_TRANSACTION_ALLOCATION_EVIDENCE_REQUIRED");
    expect(fetcher.mock.calls[0]![0]).toBe("https://api.flutterwave.com/v3/transactions/123/verify");
  });
  it("returns transaction-bound proof only with matching immutable report evidence",async()=>{
    const pool={connect:async()=>({query:async()=>({rows:[{currency:"NGN",gross_minor:500000,school_minor:190000,
      provider_reference:data().flw_ref,provider_fee_minor:7500,additional_fee_minor:0}]}),release:()=>{}})};
    const result=await liveCollectionVerifier(pool,new FlutterwaveLiveTransport(runtimeEnv(),
      vi.fn().mockResolvedValue(response(data()))),"fictional_merchant").verify({
        transactionId:"123",reference,currency:"NGN",amountMinor:500000,schoolSubaccountId:school,signal:AbortSignal.timeout(3000)});
    expect(result).toMatchObject({amountMinor:500000,chargedAmountMinor:500000,recipientEvidence:"TRANSACTION_BOUND",
      recipients:[{subaccountId:school,currency:"NGN",amountMinor:190000}]});
  });
  it("scrubs historical GET network errors without retry or issuing a checkout POST",async()=>{
    const fetcher=vi.fn().mockRejectedValue(new Error(`Authorization Bearer ${runtimeEnv().FLUTTERWAVE_LIVE_SECRET_KEY}`));
    const error=await new FlutterwaveLiveTransport(runtimeEnv(),fetcher).collection("123",reference).catch(e=>e);
    expect(error.code).toBe("LIVE_PROVIDER_UNAVAILABLE");
    expect(String(error)).not.toContain("FLWSECK");
    expect(error.cause).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("invalid callbacks acquire no DB and cannot become payment evidence",async()=>{
    const pool={connect:vi.fn()};
    await expect(verifyLiveCallback(pool as any,{transactionId:"123",reference:"TEST_ref"},runtimeEnv(),vi.fn()))
      .rejects.toHaveProperty("code","LIVE_CALLBACK_INVALID");
    expect(pool.connect).not.toHaveBeenCalled();
  });
});
