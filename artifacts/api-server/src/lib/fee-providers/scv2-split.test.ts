import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FlutterwaveTestAdapter } from "./index";
import { studentPostFeePayouts } from "../student-allocation-policy";

// All transport responses are fictional and injected. No provider calls/credentials.
beforeEach(() => {
  vi.stubEnv("NODE_ENV","development");
  vi.stubEnv("REPLIT_DEPLOYMENT","");
});
afterEach(() => vi.unstubAllEnvs());
const reference = "SCV2_fee_0123456789abcdef0123456789abcdef";
const school = {id:"RS_UNITSchool000001",transaction_charge_type:"flat_subaccount" as const,transaction_charge:1900};
const partner = {id:"RS_UNITPartner00001",transaction_charge_type:"flat_subaccount" as const,transaction_charge:100};
function setup() {
  const transport=vi.fn(async (_url: Parameters<typeof fetch>[0], _init?: RequestInit) =>
    new Response(JSON.stringify({status:"success",data:{link:"https://checkout.flutterwave.com/v3/hosting/test"}}),
      {headers:{"content-type":"application/json"}}));
  return {transport,adapter:new FlutterwaveTestAdapter({secretKey:"FLWSECK_TEST-1234567890abcdef"},{fetch:transport})};
}
it.each([true,false])("blocks unproven post-fee payouts before provider transport, Partner=%s", async eligible => {
  const {transport,adapter}=setup();
  const subaccounts=eligible?[school,partner]:[school];
  const input = {reference,amountMinor:500000,currency:"NGN",email:"payer@example.test",
    returnUrl:"https://example.test/return",subaccounts};
  // Repeated attempts cannot initiate duplicate collection or settlement.
  for (let attempt=0;attempt<2;attempt++) {
    await expect(adapter.initializePayment(input)).rejects.toThrow("exact post-fee");
  }
  expect(transport).not.toHaveBeenCalled();
});
it("also blocks a new-policy platform-only fallback before transport", async () => {
  const {transport,adapter}=setup();
  await expect(adapter.initializePayment({reference,amountMinor:500000,currency:"NGN",email:"payer@example.test",
    returnUrl:"https://example.test/return"})).rejects.toThrow("nonzero merchant remainder");
  expect(transport).not.toHaveBeenCalled();
});
it.each([true,false])("models the 70 fee once with positive Owner remainder, Partner=%s", eligible => {
  const p = studentPostFeePayouts(reference,eligible,7000);
  expect(p).toMatchObject({schoolMinor:190000,partnerMinor:eligible ? 10000 : 0,
    ownerGrossMinor:eligible ? 300000 : 310000,ownerNetMinor:eligible ? 293000 : 303000,
    providerNetMinor:493000,totalFeeMinor:7000});
  expect(p.schoolMinor+p.partnerMinor+p.ownerNetMinor).toBe(p.providerNetMinor);
  expect(p.ownerNetMinor).toBeGreaterThan(0);
});
it("preserves historical gross policy and rejects fees that consume merchant share", () => {
  expect(studentPostFeePayouts("fee_legacy_12345678",true,7000)).toMatchObject({
    schoolMinor:200000,partnerMinor:10000,ownerGrossMinor:290000,ownerNetMinor:283000});
  for (const fee of [-1,0.5,NaN,300000,500000]) {
    expect(() => studentPostFeePayouts(reference,true,fee)).toThrow("positive merchant share");
  }
});
it.each([
  {reference,charge:2000},
  {reference:"fee_0123456789abcdef",charge:1900},
])("rejects cross-version school amounts before transport: $reference / $charge", async item => {
  const {transport,adapter}=setup();
  await expect(adapter.initializePayment({reference:item.reference,amountMinor:500000,currency:"NGN",
    email:"payer@example.test",returnUrl:"https://example.test/return",subaccounts:[{...school,transaction_charge:item.charge}]}))
    .rejects.toThrow("Invalid Development split instructions");
  expect(transport).not.toHaveBeenCalled();
});
it("preserves the legacy fee_ school2000 instruction", async () => {
  const {transport,adapter}=setup();
  await adapter.initializePayment({reference:"fee_0123456789abcdef",amountMinor:500000,currency:"NGN",
    email:"payer@example.test",returnUrl:"https://example.test/return",subaccounts:[{...school,transaction_charge:2000}]});
  expect(transport).toHaveBeenCalledTimes(1);
});
