import {describe,expect,it,vi} from "vitest";
import {FlutterwaveTestAdapter} from "./index";
const input={reference:"fee_fictional_0123456789",amountMinor:1234,currency:"NGN",
  email:"school@example.test",returnUrl:"https://example.test/return"};
const adapter=(fetcher:ReturnType<typeof vi.fn>)=>new FlutterwaveTestAdapter({
  secretKey:"FLWSECK_TEST-1234567890abcdef",webhookSecret:"fictional-no-network",
},{fetch:fetcher as unknown as typeof fetch});
describe("generic Flutterwave split retirement (no credentials or provider access)",()=>{
  it.each(["SCV2_fixture_reference","SCV3_fixture_reference","SCV3_live_fixture_reference",
    "scv3_fixture_reference"])("rejects retired reference %s before network access",async reference=>{
    const fetcher=vi.fn();
    await expect(adapter(fetcher).initializePayment({...input,reference})).rejects.toThrow("archived");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["subaccounts","subaccount","subaccount_id","split","split_ratio",
    "transaction_charge","transaction_charge_type"])("rejects forbidden %s even when empty",async key=>{
    const fetcher=vi.fn();
    await expect(adapter(fetcher).initializePayment({...input,[key]:undefined})).rejects.toThrow("archived");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("retains ordinary independent non-split checkout without adding split fields",async()=>{
    const fetcher=vi.fn(async(_url:unknown,_init?:RequestInit)=>Response.json({status:"success",data:{
      link:"https://checkout.flutterwave.com/v3/hosted/pay/fixture-only",
    }}));
    await adapter(fetcher).initializePayment(input);
    expect(fetcher).toHaveBeenCalledOnce();
    const payload=JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(payload).toMatchObject({tx_ref:input.reference,amount:12.34,currency:"NGN"});
    for(const key of ["subaccounts","subaccount","subaccount_id","split","split_ratio",
      "transaction_charge","transaction_charge_type"])expect(payload).not.toHaveProperty(key);
  });
});
