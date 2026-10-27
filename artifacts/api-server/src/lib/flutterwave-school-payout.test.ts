import {describe,it,expect,vi} from "vitest";
import {FlutterwaveSchoolPayoutProvider,schoolPayoutConfiguration,providerMinor} from "./flutterwave-school-payout";
const bank={bankCode:"044",accountNumber:"0123456789",accountName:"Fixture School"};
const reply=(data:any)=>new Response(JSON.stringify({status:"success",data}),{status:200,headers:{"content-type":"application/json"}});
describe("Documented Flutterwave v3 bank payout contract with fake HTTP only",()=>{
  it("uses verified bank routing and available_balance, not ledger_balance or a subaccount",async()=>{
    const http=vi.fn(async(url:any,init:any)=>{
      const p=String(url).split("/v3/")[1];
      if(p==="banks/NG")return reply([{code:"044",has_branches:false}]);
      if(p==="accounts/resolve") {expect(JSON.parse(init.body)).toEqual({account_bank:"044",account_number:"0123456789"});return reply({account_number:"0123456789",account_name:"Fixture School"});}
      if(p.startsWith("transfers/fee"))return reply([{currency:"NGN",fee_type:"value",fee:26.875}]);
      if(p==="balances")return reply([{currency:"NGN",available_balance:0,ledger_balance:900000}]);
      if(p==="transfers") {
        const body=JSON.parse(init.body);
        expect(body).toMatchObject({account_bank:"044",account_number:"0123456789",currency:"NGN",debit_currency:"NGN",amount:1900,reference:"unique-fixture"});
        expect(body).not.toHaveProperty("debit_subaccount");expect(body).not.toHaveProperty("subaccount_id");
        return reply({id:91,reference:"unique-fixture",status:"SUCCESSFUL"});
      }
      throw new Error("Unexpected mock request");
    });
    const api=new FlutterwaveSchoolPayoutProvider("fixture-not-a-credential",http as typeof fetch);
    expect(await api.preflight(bank)).toMatchObject({availableMinor:0,feeMinor:2688});
    expect(await api.initiate(bank,"unique-fixture")).toEqual({id:"91"});
    expect(http).toHaveBeenCalledTimes(5);
  });
  it("independently GETs exact reference and ID, requiring approval and preserving raw fees",async()=>{
    const http=vi.fn(async(url:any)=>String(url).includes("transfers?")?reply([{id:91,reference:"original"}]):
      reply({id:91,reference:"original",status:"SUCCESSFUL",currency:"NGN",debit_currency:null,amount:1900,
        account_number:"0123456789",bank_code:"044",requires_approval:0,is_approved:1,fee:26.875}));
    const r=await new FlutterwaveSchoolPayoutProvider("fake",http as typeof fetch).find("original");
    expect(r).toMatchObject({status:"SUCCESS",id:"91",amountMinor:190000,feeMinor:2688,feeRaw:"26.875"});
    expect(http.mock.calls[1][0]).toBe("https://api.flutterwave.com/v3/transfers/91");
  });
  it("treats missing transfer as uncertain and does not create a replacement",async()=>{
    const http=vi.fn(async()=>reply([]));
    expect(await new FlutterwaveSchoolPayoutProvider("fake",http as typeof fetch).find("original")).toBeNull();
    expect(http).toHaveBeenCalledTimes(1);
  });
  it("refuses unrecognized fee/amount schemas and blocks LIVE without all account prerequisites",()=>{
    expect(()=>providerMinor(1900.001)).toThrow();expect(()=>providerMinor(-1)).toThrow();
    const c=schoolPayoutConfiguration({NODE_ENV:"development",EDUCORE_HOSTED_PAYMENTS_MODE:"LIVE",
      FLUTTERWAVE_LIVE_SECRET_KEY:"FLWSECK-fixture-only",EDUCORE_SCHOOL_PAYOUTS_TEST_APPROVED:"true"});
    expect(c.ready).toBe(false);expect(c.blockers.join(" ")).toContain("KYC");expect(c.blockers.join(" ")).toContain("LIVE_APPROVED");
    expect(schoolPayoutConfiguration({EDUCORE_SCHOOL_PAYOUTS_MAX_FEE_MINOR:""}).blockers.join(" ")).toContain("fee ceiling");
  });
});
