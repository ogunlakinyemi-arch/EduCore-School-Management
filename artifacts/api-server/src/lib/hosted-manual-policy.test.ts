import { describe, expect, it, vi } from "vitest";
import { hostedAmounts, hostedConfiguration } from "./hosted-manual-policy";
import { FlutterwaveHostedAdapter, normalizeHostedVerification } from "./hosted-checkout-adapter";
const env={EDUCORE_HOSTED_PAYMENTS_ENABLED:"true",EDUCORE_HOSTED_PAYMENTS_MODE:"TEST",
  EDUCORE_HOSTED_PAYMENTS_PUBLIC_URL:"https://fixture.example.test",
  FLUTTERWAVE_SECRET_Test_Key:"fixture-test-secret",FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH:"fixture-test-hash"};
describe("hosted collection policy and one provider adapter",()=>{
  it("balances the full charge without subtracting BRO twice",()=>{
    expect(hostedAmounts(true,1000)).toEqual({grossMinor:500000,schoolDueMinor:190000,broDueMinor:10000,platformNetMinor:299000});
    expect(hostedAmounts(false,0).platformNetMinor).toBe(310000);
    expect(()=>hostedAmounts(true,300000)).toThrow();
  });
  it("has explicit mode, distinct credentials and a Development LIVE prohibition",()=>{
    expect(hostedConfiguration(env).blockers).toEqual([]);
    expect(hostedConfiguration({...env,EDUCORE_HOSTED_PAYMENTS_MODE:"LIVE",NODE_ENV:"development"}).blockers.length).toBeGreaterThan(0);
    expect(hostedConfiguration({...env,FLUTTERWAVE_LIVE_SECRET_KEY:env.FLUTTERWAVE_SECRET_Test_Key}).blockers).toContain("TEST and LIVE credentials must be distinct.");
    expect(hostedConfiguration({...env,FLUTTERWAVE_SECRET_Test_Key:undefined,FLUTTERWAVE_SECRET_KEY:"generic-is-not-a-fallback"}).blockers.length).toBeGreaterThan(0);
  });
  it("names the missing dedicated TEST hash without blaming the existing TEST secret",()=>{
    const c=hostedConfiguration({...env,FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH:undefined,
      FLUTTERWAVE_WEBHOOK_VERIF_HASH:"synthetic-generic-not-a-fallback",
      FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH:"synthetic-live-not-a-fallback"});
    expect(c.blockers).toEqual(["Dedicated TEST webhook verification hash FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH is required."]);
    expect(c.webhookHash).toBeUndefined();
  });
  it("never borrows a LIVE or generic secret for TEST",()=>{
    const c=hostedConfiguration({...env,FLUTTERWAVE_SECRET_Test_Key:undefined,
      FLUTTERWAVE_LIVE_SECRET_KEY:"synthetic-live-not-a-fallback",FLUTTERWAVE_SECRET_KEY:"synthetic-generic-not-a-fallback"});
    expect(c.secret).toBeUndefined();
    expect(c.blockers).toEqual(["Dedicated TEST secret FLUTTERWAVE_SECRET_Test_Key is required."]);
  });
  it("does not enable hosted TEST implicitly or borrow separate LIVE billing settings",()=>{
    const c=hostedConfiguration({NODE_ENV:"development",EDUCORE_FLUTTERWAVE_MODE:"LIVE",
      PUBLIC_APP_URL:"https://production.example.test"});
    expect(c.enabled).toBe(false);
    expect(c.blockers).toContain("Select an explicit TEST or LIVE mode.");
    expect(c.blockers).toContain("Configure the approved HTTPS app base URL.");
  });
  it.each(["http://fixture.example.test","https://user:password@fixture.example.test",
    "https://fixture.example.test/?key=value","https://fixture.example.test/#fragment"])("rejects unsafe public base %s",url=>{
    expect(hostedConfiguration({...env,EDUCORE_HOSTED_PAYMENTS_PUBLIC_URL:url}).blockers)
      .toContain("Configure the approved HTTPS app base URL.");
  });
  it("initializes hosted collection with no subaccounts, transfer or split instruction",async()=>{
    const http=vi.fn().mockResolvedValue({ok:true,json:async()=>({status:"success",data:{link:"https://checkout.flutterwave.com/v3/fixture"}})});
    const adapter=new FlutterwaveHostedAdapter("fixture-secret","fixture-hash",http);
    await adapter.initialize({reference:"fixture-ref",email:"fixture@example.test",returnUrl:"https://fixture.example.test/hosted-payments",mode:"TEST"});
    const body=JSON.parse(http.mock.calls[0][1].body);
    expect(body.amount).toBe("5000.00");expect(body.currency).toBe("NGN");
    expect(body).not.toHaveProperty("subaccounts");expect(body).not.toHaveProperty("split");
    expect(adapter.authenticate("fixture-hash")).toBe(true);expect(adapter.authenticate("wrong")).toBe(false);
  });
  it("normalizes server verification and rejects ambiguous IDs/amounts",()=>{
    expect(normalizeHostedVerification({status:"success",data:{id:12,tx_ref:"fixture",amount:"5000.00",currency:"NGN",status:"successful",app_fee:"10.00"}}))
      .toMatchObject({transactionId:"12",amountMinor:500000,feeMinor:1000,status:"successful"});
    expect(()=>normalizeHostedVerification({status:"success",data:{id:"bad",amount:5000}})).toThrow();
    expect(()=>normalizeHostedVerification({status:"success",data:{id:1,amount:"NaN"}})).toThrow();
  });
});
