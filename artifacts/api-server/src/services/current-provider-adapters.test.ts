import {describe,it,expect,vi} from "vitest";
import {FlutterwaveLiveTransport} from "../lib/flutterwave-live-transport";
import {currentProviderAdapters} from "./current-provider-adapters";
const env={
 NODE_ENV:"production",EDUCORE_FLUTTERWAVE_MODE:"LIVE",FLUTTERWAVE_LIVE_SECRET_KEY:"FLWSECK-FAKE-NO-NETWORK",
 FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH:"fictional-not-live",EDUCORE_FLUTTERWAVE_DIRECT_RELEASE:"STUDENT_DIRECT_3200_V1",
 EDUCORE_FLUTTERWAVE_DIRECT_CALLBACK_URL:"https://example.invalid/api/flutterwave/direct-student/callback",
 EDUCORE_FLUTTERWAVE_DIRECT_WEBHOOK_URL:"https://example.invalid/api/webhooks/flutterwave/direct-student",
 EDUCORE_FLUTTERWAVE_MERCHANT_SCOPE:"FICTIONAL_MERCHANT",
};
const reference="SCV4_live_bulk_fictional_123456789";
const response=(data:object)=>Response.json({status:"success",data});
const source={id:999,tx_ref:reference,currency:"NGN",amount:6400,charged_amount:6400,app_fee:10,merchant_fee:0,
 status:"successful",flw_ref:"fictional-provider"};
describe("real adapter contracts with exclusively fake HTTP functions",()=>{
 it("sends exactly one aggregate amount with no splits, subaccounts or child provider references",async()=>{
  const fetcher=vi.fn(async()=>response({link:"https://checkout.flutterwave.com/v3/hosted/pay/fictional"}));
  const t=new FlutterwaveLiveTransport(env,fetcher as any,"DIRECT_STUDENT");
  expect(await t.bulkStudentCheckout({reference,email:"fixture@example.invalid",amountMinor:640000})).toMatch("checkout.flutterwave.com");
  expect(fetcher).toHaveBeenCalledTimes(1);
  const body=JSON.parse((fetcher.mock.calls as any)[0][1].body);
  expect(body).toMatchObject({tx_ref:reference,amount:6400,currency:"NGN",customer:{email:"fixture@example.invalid"}});
  expect(Object.keys(body).sort()).toEqual(["amount","currency","customer","redirect_url","tx_ref"]);
 });
 it("independently verifies the exact aggregate transaction and fees",async()=>{
  const fetcher=vi.fn(async()=>response(source));
  expect(await new FlutterwaveLiveTransport(env,fetcher as any,"DIRECT_STUDENT")
    .bulkStudentCollection("999",reference,640000)).toMatchObject({amountMinor:640000,providerFeeMinor:1000,status:"successful"});
  expect((fetcher.mock.calls as any)[0][1].method).toBe("GET");
 });
 it.each([{amount:3200},{charged_amount:6401},{tx_ref:"SCV4_live_other"},{currency:"USD"},
   {subaccounts:[{id:"forbidden"}]},{merchant_fee:6400}])("rejects altered aggregate money or recipient evidence %j",async change=>{
  const t=new FlutterwaveLiveTransport(env,vi.fn(async()=>response({...source,...change})) as any,"DIRECT_STUDENT");
  await expect(t.bulkStudentCollection("999",reference,640000)).rejects.toThrow();
 });
 it("requires independently verified zero charged amount before calling a collection failed",async()=>{
  const t=new FlutterwaveLiveTransport(env,vi.fn(async()=>response({...source,status:"failed",charged_amount:5})) as any,"DIRECT_STUDENT");
  await expect(t.bulkStudentCollection("999",reference,640000)).rejects.toThrow();
 });
 it("retains the returned refund ID and verifies it by independent GET rather than guessing an app reference",async()=>{
  const fetcher=vi.fn(async()=>response({id:555,transaction_id:999,amount_refunded:100,status:"completed-bank-transfer"}));
  const fakePool={connect:async()=>({query:async()=>({rows:[{reference:"555"}]}),release(){}})};
  const adapter=currentProviderAdapters(fakePool,env,fetcher as any);
  expect(await adapter.refunds!.request({reference:"YETENIA_CURRENT_1",collectionTransactionId:"999",amountMinor:10000}))
    .toEqual({providerReference:"555"});
  expect(await adapter.refunds!.verify("YETENIA_CURRENT_1")).toMatchObject({providerReference:"555",
    collectionTransactionId:"999",amountMinor:10000,status:"SUCCEEDED"});
  expect((fetcher.mock.calls as any)[0][1].method).toBe("POST");
  expect((fetcher.mock.calls as any)[1][0]).toBe("https://api.flutterwave.com/v3/refunds/555");
 });
 it("an absent refund ID blocks reconciliation without repeating any provider POST",async()=>{
  const fetcher=vi.fn();
  const adapter=currentProviderAdapters({connect:async()=>({query:async()=>({rows:[]}),release(){}})},env,fetcher);
  await expect(adapter.refunds!.verify("YETENIA_CURRENT_1")).rejects.toThrow("PROVIDER_ID_NOT_RETAINED");
  expect(fetcher).not.toHaveBeenCalled();
 });
 it("plain completed is pending, not bank completion",async()=>{
  const t=new FlutterwaveLiveTransport(env,vi.fn(async()=>response({id:555,transaction_id:999,
   amount_refunded:100,status:"completed"})) as any,"DIRECT_STUDENT");
  expect((await t.currentRefundVerification("555")).status).toBe("pending");
 });
 it("checks provider minimum and existing LIVE gates before a refund dispatch claim",()=>{
  const fakePool={connect:vi.fn()};
  expect(()=>currentProviderAdapters(fakePool,env).refunds!.validate!({amountMinor:9999})).toThrow("MINIMUM_NGN_100");
  expect(()=>currentProviderAdapters(fakePool,{}).refunds!.validate!({amountMinor:10000})).toThrow("LIVE_DIRECT_RELEASE_REQUIRED");
 });
 it("does not invent independently bound collection reversal or incoming recovery capabilities",()=>{
  const a=currentProviderAdapters({connect:vi.fn()},env,vi.fn());
  expect(a.collectionReversal).toBeUndefined();expect(a.recoveryEvidence).toBeUndefined();
 });
});
