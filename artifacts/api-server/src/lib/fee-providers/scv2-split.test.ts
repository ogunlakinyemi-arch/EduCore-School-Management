import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FlutterwaveTestAdapter } from "./index";

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
it.each([true,false])("sends the exact SCV2_fee reference and fixed 1900/100 instructions, Partner=%s", async eligible => {
  const {transport,adapter}=setup();
  const subaccounts=eligible?[school,partner]:[school];
  await adapter.initializePayment({reference,amountMinor:500000,currency:"NGN",email:"payer@example.test",
    returnUrl:"https://example.test/return",subaccounts});
  expect(transport).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(transport.mock.calls[0][1]?.body))).toMatchObject({
    tx_ref:reference,amount:5000,currency:"NGN",subaccounts,
  });
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
