import { describe, expect, it } from "vitest";
import { safeData, safeEnvelope, safeMessage, sandboxBank } from "./flutterwave-sandbox-evidence";
describe("Sandbox evidence sanitization — mock data only",()=>{
  it("omits credentials, tokens, card/customer data and checkout capability URLs",()=>{
    const out=JSON.stringify(safeEnvelope({status:"success",message:"Transaction fetched successfully",data:{
      id:42,amount:5000,currency:"NGN",customer:{email:"private@example.test"},
      card:{token:"PRIVATE-CARD-TOKEN"},link:"https://checkout.example.test/private",secret:"FLWSECK_TEST-private",
      subaccounts:[{id:"RS_TEST123456789012",transaction_charge_type:"flat_subaccount",transaction_charge:2000,
        bank_account:"PRIVATE-BANK",email:"PRIVATE-EMAIL"}],
    }}));
    for(const value of ["private@example.test","PRIVATE-CARD-TOKEN","https://checkout.example.test/private","FLWSECK_TEST-private","PRIVATE-BANK","PRIVATE-EMAIL"])
      expect(out).not.toContain(value);
    expect(out).toContain("flat_subaccount");
    expect(out).toContain("2000");
  });
  it("lists only matching official-fixture records and does not disclose other recipients",()=>{
    const out=safeEnvelope({status:"success",data:[
      {id:1,account_bank:"044",account_number:sandboxBank.accountNumber,business_name:sandboxBank.entityName},
      {id:2,account_bank:"044",account_number:"1234567890",business_name:"PRIVATE SCHOOL"},
    ]});
    expect((out.data as any).fixtureRecords).toHaveLength(1);
    expect(JSON.stringify(out)).not.toContain("PRIVATE SCHOOL");
    expect(JSON.stringify(out)).not.toContain("1234567890");
  });
  it("redacts unexpected accounts and names but retains status and known split values",()=>{
    expect(safeData({account_number:"1234567890",business_name:"PRIVATE",status:"successful",split_value:3000}))
      .toMatchObject({account_number:"[UNEXPECTED ACCOUNT OMITTED]",business_name:"[NON-FIXTURE NAME OMITTED]",status:"successful",split_value:3000});
    expect(safeMessage("FLWSECK_TEST-private email@example.test 1234567890")).not.toMatch(/FLWSECK|email@|1234567890/);
  });
});
