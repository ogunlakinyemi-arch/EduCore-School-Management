import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compareTransactionSplits, compareVerificationResponse } from "./flutterwave-split-evidence";
import { businessEmailSchema, existingDiagnosticTestReference, maskedBusinessEmail, schoolTestSplitInput } from "./flutterwave-split-review";
import { FlutterwaveSplitProvider } from "../services/flutterwave-split-provider";

const school = "RS_UNITSchool000001", partner = "RS_UNITPartner00001";
const expected = {
  transactionId:"1234",reference:"unit_split_transaction",currency:"NGN",
  grossAmountMinor:500000,platformGrossMinor:290000,
  recipients:[{subaccountId:school,amountMinor:200000},{subaccountId:partner,amountMinor:10000}],
};
const transaction = {id:1234,tx_ref:expected.reference,currency:"NGN",status:"successful",amount:5000,charged_amount:5000,app_fee:70,merchant_fee:0};
const complete = {recipients:expected.recipients,completeRecipientSet:true};
const bank = {bankCode:"044",accountNumber:"0123456789",accountName:"UNIT ONLY OWNER",entityName:"UNIT ONLY SCHOOL",
  contactPhone:"08000000000",businessEmail:"finance@school.edu.ng"};
const key = "FLWSECK_TEST-unit-only-not-a-real-credential";
const json = (data: unknown) => new Response(JSON.stringify({status:"success",data}),{status:200});
beforeEach(() => { vi.stubEnv("NODE_ENV","development");vi.stubEnv("REPLIT_DEPLOYMENT",""); });
afterEach(() => vi.unstubAllEnvs());

describe("Independent transaction split comparison",() => {
  it.each([true,false])("SCV3 compares school1900 and merchant3100 before actual fees; internal Partner=%s",hasPartner=>{
    // Entitlement does not alter what is settled to the merchant.
    const e={...expected,reference:`SCV3_fixture_${hasPartner}`,platformGrossMinor:310000,
      recipients:[{subaccountId:school,amountMinor:190000}]};
    const tx={...transaction,tx_ref:e.reference,app_fee:65,merchant_fee:5};
    expect(compareVerificationResponse(e,tx)).toMatchObject({
      status:"UNCONFIRMED",evidenceLevel:"PARTIAL",platformGrossMinor:310000,platformNetMinor:303000,bankSettlementVerified:false,
    });
    expect(compareTransactionSplits(e,tx,{recipients:e.recipients,completeRecipientSet:true}).status).toBe("CONFIRMED");
    for(const invalid of [
      {...e,platformGrossMinor:300000},
      {...e,recipients:[{subaccountId:school,amountMinor:200000}]},
      {...e,platformGrossMinor:300000,recipients:[...e.recipients,{subaccountId:partner,amountMinor:10000}]},
    ]) expect(compareVerificationResponse(invalid,tx).status).toBe("MISMATCH");
    expect(compareVerificationResponse(e,{...tx,subaccounts:e.recipients,completeRecipientSet:true}).status).toBe("UNCONFIRMED");
  });
  it.each([true,false])("SCV2 retains its original multi-recipient policy, Partner=%s",hasPartner=>{
    const e={...expected,reference:"SCV2_historical_fixture",platformGrossMinor:hasPartner ? 300000 : 310000,
      recipients:[{subaccountId:school,amountMinor:190000},...(hasPartner ? [{subaccountId:partner,amountMinor:10000}]:[])]};
    expect(compareTransactionSplits(e,{...transaction,tx_ref:e.reference},
      {recipients:e.recipients,completeRecipientSet:true})).toMatchObject({
        status:"CONFIRMED",platformNetMinor:e.platformGrossMinor-7000,bankSettlementVerified:false,
      });
  });
  it("compares the partner allocation and separate platform expenses, never bank settlement",() => {
    const result = compareTransactionSplits(expected,transaction,complete);
    expect(result.status).toBe("CONFIRMED");
    expect(result.evidenceLevel).toBe("COMPLETE_VERIFIED");
    expect(result.platformGrossMinor).toBe(290000);
    expect(result.platformNetMinor).toBe(283000);
    expect(result.bankSettlementVerified).toBe(false);
  });
  it("preserves the no-partner allocation",() => {
    const e = {...expected,platformGrossMinor:300000,recipients:[expected.recipients[0]]};
    expect(compareTransactionSplits(e,transaction,{recipients:e.recipients,completeRecipientSet:true}).status).toBe("CONFIRMED");
  });
  it.each([
    ["id","9999"],["tx_ref","different_reference"],["currency","USD"],["status","pending"],["amount",4999],["charged_amount",5070],
  ])("rejects a mismatching %s", (field,value) => {
    expect(compareTransactionSplits(expected,{...transaction,[field]:value},complete).status).toBe("MISMATCH");
  });
  it.each(["app_fee","merchant_fee","charged_amount"])("leaves missing %s unconfirmed",(field) => {
    expect(compareTransactionSplits(expected,{...transaction,[field]:null},complete).status).toBe("UNCONFIRMED");
  });
  it("does not use request echoes or merchant-controlled metadata as evidence",() => {
    expect(compareTransactionSplits(expected,{...transaction,subaccounts:expected.recipients,meta:{splits:expected.recipients}},null).status).toBe("UNCONFIRMED");
  });
  it("does not claim a complete recipient set from partial reports",() => {
    expect(compareTransactionSplits(expected,transaction,{...complete,completeRecipientSet:false}).status).toBe("UNCONFIRMED");
  });
  it.each([
    [{subaccountId:school,amountMinor:199999},expected.recipients[1]],
    [expected.recipients[0],{subaccountId:"RS_WrongRecipient000",amountMinor:10000}],
    [expected.recipients[0],expected.recipients[0]],
    [expected.recipients[0]],
    [...expected.recipients,{subaccountId:"RS_ExtraRecipient000",amountMinor:100}],
  ])("rejects wrong, duplicate, missing or extra recipients",(...recipients) => {
    expect(compareTransactionSplits(expected,transaction,{recipients,completeRecipientSet:true}).status).toBe("MISMATCH");
  });
  it("leaves malformed fees unconfirmed and rejects excessive costs",() => {
    expect(compareTransactionSplits(expected,{...transaction,app_fee:"bad"},complete).status).toBe("UNCONFIRMED");
    expect(compareTransactionSplits(expected,{...transaction,app_fee:3000},complete).status).toBe("MISMATCH");
  });
  it("separates unavailable, partial collection evidence and contradiction in the supported verify adapter",() => {
    expect(compareVerificationResponse(expected,{}).evidenceLevel).toBe("UNAVAILABLE");
    expect(compareVerificationResponse(expected,transaction).evidenceLevel).toBe("PARTIAL");
    expect(compareVerificationResponse(expected,{...transaction,charged_amount:5001}).evidenceLevel).toBe("MISMATCH");
    expect(compareVerificationResponse(expected,{...transaction,completeRecipientSet:true,recipients:expected.recipients}).status).toBe("UNCONFIRMED");
  });
});

describe("Business contact and truthful TEST authorization",() => {
  it("validates and trims the business email; displays only a masked contact",() => {
    expect(businessEmailSchema.parse(" finance@school.edu.ng ")).toBe(bank.businessEmail);
    expect(maskedBusinessEmail(bank.businessEmail)).toBe("f•••@school.edu.ng");
    expect(maskedBusinessEmail()).toBeNull();
  });
  it.each(["", "not-email", "unit@example.test", "unit@example.com", "unit@localhost", "a@site.invalid", "a".repeat(255)+"@school.edu.ng"])("rejects unusable contacts",(email) => {
    expect(businessEmailSchema.safeParse(email).success).toBe(false);
  });
  it("requires explicit TEST consent and rejects the old automatic-settlement payload",() => {
    expect(schoolTestSplitInput.safeParse({enabled:true,testSplitVerificationAuthorized:false}).success).toBe(false);
    expect(schoolTestSplitInput.safeParse({enabled:true,automaticSettlementConfirmed:true}).success).toBe(false);
    expect(schoolTestSplitInput.parse({enabled:true,testSplitVerificationAuthorized:true}).enabled).toBe(true);
    expect(schoolTestSplitInput.parse({enabled:false,testSplitVerificationAuthorized:false}).enabled).toBe(false);
  });
  it("passes the validated email to the mocked create request",async() => {
    const fetch = vi.fn(async(_url:unknown,init?:RequestInit) => init?.method === "POST"
      ? json({id:12}) : json({id:12,account_number:bank.accountNumber,account_bank:bank.bankCode,subaccount_id:school}));
    await new FlutterwaveSplitProvider(key,{fetch}).createRecipient(bank,"SCHOOL");
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).business_email).toBe(bank.businessEmail);
  });
  it("refuses invalid contact before any mocked HTTP request",async() => {
    const fetch = vi.fn();
    await expect(new FlutterwaveSplitProvider(key,{fetch}).createRecipient({...bank,businessEmail:"unit@example.test"},"SCHOOL")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Existing TEST reference investigation",() => {
  it("uses GET only and verifies the exact reference, entity and owned bank",async() => {
    const fetch = vi.fn(async(url:unknown) => String(url).endsWith("/subaccounts")
      ? json([{id:12,subaccount_id:existingDiagnosticTestReference,business_name:bank.entityName}])
      : json({id:12,business_name:bank.entityName,business_email:bank.businessEmail,account_number:bank.accountNumber,account_bank:bank.bankCode,subaccount_id:existingDiagnosticTestReference}));
    expect((await new FlutterwaveSplitProvider(key,{fetch}).verifyExistingTestReference(existingDiagnosticTestReference,bank)).subaccountId).toBe(existingDiagnosticTestReference);
    expect(fetch.mock.calls.every(c => (c as unknown as [unknown,RequestInit])[1].method === "GET")).toBe(true);
  });
  it("does not equate a generic diagnostic label with the reviewed entity",async() => {
    const fetch = vi.fn(async() => json([{id:12,subaccount_id:existingDiagnosticTestReference,business_name:"Yetenia TEST ONLY"}]));
    await expect(new FlutterwaveSplitProvider(key,{fetch}).verifyExistingTestReference(existingDiagnosticTestReference,bank)).rejects.toThrow("ownership");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects a different reference before any HTTP request",async() => {
    const fetch = vi.fn();
    await expect(new FlutterwaveSplitProvider(key,{fetch}).verifyExistingTestReference(school,bank)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("requires the entity identity to match on individual read-back, not merely the list",async() => {
    const fetch = vi.fn(async(url:unknown) => String(url).endsWith("/subaccounts")
      ? json([{id:12,subaccount_id:existingDiagnosticTestReference,business_name:bank.entityName}])
      : json({id:12,business_name:"UNRELATED ENTITY",account_number:bank.accountNumber,account_bank:bank.bankCode,subaccount_id:existingDiagnosticTestReference}));
    await expect(new FlutterwaveSplitProvider(key,{fetch}).verifyExistingTestReference(existingDiagnosticTestReference,bank)).rejects.toThrow("ownership");
  });
  it.each([null,"other@school.edu.ng"])("requires independently returned matching business contact, not missing/mismatching %s",async(email) => {
    const fetch = vi.fn(async(url:unknown) => String(url).endsWith("/subaccounts")
      ? json([{id:12,subaccount_id:existingDiagnosticTestReference,business_name:bank.entityName}])
      : json({id:12,business_name:bank.entityName,business_email:email,account_number:bank.accountNumber,account_bank:bank.bankCode,subaccount_id:existingDiagnosticTestReference}));
    await expect(new FlutterwaveSplitProvider(key,{fetch}).verifyExistingTestReference(existingDiagnosticTestReference,bank)).rejects.toThrow("ownership");
  });
  it("rejects a bank mismatch and never submits a POST",async() => {
    const fetch = vi.fn(async(url:unknown) => String(url).endsWith("/subaccounts")
      ? json([{id:12,subaccount_id:existingDiagnosticTestReference,business_name:bank.entityName}])
      : json({id:12,account_number:"9999999999",account_bank:bank.bankCode,subaccount_id:existingDiagnosticTestReference}));
    await expect(new FlutterwaveSplitProvider(key,{fetch}).verifyExistingTestReference(existingDiagnosticTestReference,bank)).rejects.toThrow();
  });
  it.each([{NODE_ENV:"production",REPLIT_DEPLOYMENT:""},{NODE_ENV:"development",REPLIT_DEPLOYMENT:"1"}])("blocks outside unpublished Development",(env) => {
    vi.stubEnv("NODE_ENV",env.NODE_ENV);vi.stubEnv("REPLIT_DEPLOYMENT",env.REPLIT_DEPLOYMENT);
    expect(() => new FlutterwaveSplitProvider(key,{fetch:vi.fn()})).toThrow();
  });
});
