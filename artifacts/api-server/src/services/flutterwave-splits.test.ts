/**
 * UNIT TESTS ONLY. Every bank/subaccount/report below is synthetic; provider
 * HTTP is mocked. These fixtures must never be provisioned in Development.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlutterwaveSplitProvider } from "./flutterwave-split-provider";
import { FlutterwaveTestAdapter } from "../lib/fee-providers";
import { fixedSplitInstructions, ngnMinor, cumulativeRefundShares, requireSplitDevelopment } from "../lib/flutterwave-split-policy";
import { inspectRecipientSettlement } from "./flutterwave-split-reporting";
import { decryptSplitBank, encryptSplitBank, splitBankFingerprint } from "./flutterwave-split-crypto";

const school = "RS_UNITSchool000001", partner = "RS_UNITPartner00001";
const key = "FLWSECK_TEST-unit-test-not-real-credential";
const bank = {bankCode:"044",accountNumber:"0123456789",accountName:"UNIT BANK OWNER",contactPhone:"08000000000",entityName:"UNIT ONLY SCHOOL"};
const charge = {reference:"fee_unit_split_checkout",amountMinor:500000,currency:"NGN",
  email:"unit@example.test",returnUrl:"https://example.test/nfc/pay"};
const json = (data: unknown) => new Response(JSON.stringify({status:"success",data}),{status:200});
beforeEach(() => {
  vi.stubEnv("NODE_ENV","development"); vi.stubEnv("REPLIT_DEPLOYMENT","");
  vi.stubEnv("SESSION_SECRET","unit-test-session-secret-at-least-32-characters");
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("Development-only fixed amounts and transparent fees",() => {
  it("keeps gross shares with and without an eligible partner",() => {
    expect(fixedSplitInstructions(school,null)).toEqual([{id:school,transaction_charge_type:"flat_subaccount",transaction_charge:2000}]);
    expect(fixedSplitInstructions(school,partner).map(s => s.transaction_charge)).toEqual([2000,100]);
    expect(cumulativeRefundShares(500000,true)).toEqual({school:200000,partner:10000,platform:290000});
    expect(cumulativeRefundShares(500000,false)).toEqual({school:200000,partner:0,platform:300000});
  });
  it("rejects duplicate or unverified IDs",() => {
    expect(() => fixedSplitInstructions(school,school)).toThrow();
    expect(() => fixedSplitInstructions("unverified",null)).toThrow();
  });
  it.each(["production","test"])("cannot operate outside Development (%s)",mode => {
    vi.stubEnv("NODE_ENV",mode);
    expect(() => requireSplitDevelopment()).toThrow();
    expect(() => new FlutterwaveSplitProvider(key)).toThrow();
  });
  it("blocks published deployments even with Development environment",() => {
    vi.stubEnv("REPLIT_DEPLOYMENT","1"); expect(() => requireSplitDevelopment()).toThrow();
  });
  it.each(["1.001","-1","NaN","Infinity","1e3","9007199254740993"])("rejects inexact amounts %s",value => {
    expect(() => ngnMinor(value)).toThrow();
  });
  it("conserves every kobo across uneven successive partial refunds",() => {
    let total = 0, shares = {school:0,partner:0,platform:0};
    for (const refund of [10001,249999,240000]) {
      const before = cumulativeRefundShares(total,true);
      total += refund;
      const after = cumulativeRefundShares(total,true);
      const delta = {school:after.school-before.school,partner:after.partner-before.partner,platform:after.platform-before.platform};
      expect(delta.school+delta.partner+delta.platform).toBe(refund);
      shares = {school:shares.school+delta.school,partner:shares.partner+delta.partner,platform:shares.platform+delta.platform};
    }
    expect(shares).toEqual({school:200000,partner:10000,platform:290000});
    expect(() => cumulativeRefundShares(500001,true)).toThrow();
  });
  it("encrypts all bank details and detects ciphertext tampering",() => {
    const encoded = encryptSplitBank(bank);
    expect(encoded).not.toContain(bank.accountNumber);
    expect(decryptSplitBank(encoded)).toEqual(bank);
    const parts = encoded.split(".");
    parts[parts.length-1] = (parts.at(-1)!.startsWith("a") ? "b" : "a") + parts.at(-1)!.slice(1);
    expect(() => decryptSplitBank(parts.join("."))).toThrow();
    expect(splitBankFingerprint("044",bank.accountNumber)).toBe(splitBankFingerprint("044",bank.accountNumber));
    expect(splitBankFingerprint("033",bank.accountNumber)).not.toBe(splitBankFingerprint("044",bank.accountNumber));
  });
});
describe("Mocked provider contracts — not genuine sandbox evidence",() => {
  it("sends exact fixed instructions without surcharging the payer",async() => {
    const fetch = vi.fn(async() => json({link:"https://checkout.flutterwave.com/v3/hosted/pay/unit-test"}));
    await new FlutterwaveTestAdapter({secretKey:key},{fetch:fetch as any}).initializePayment({...charge,subaccounts:fixedSplitInstructions(school,partner)});
    const input = JSON.parse((fetch.mock.calls[0] as any)[1].body);
    expect(input.amount).toBe(5000);
    expect(input.subaccounts).toEqual(fixedSplitInstructions(school,partner));
    expect(input).not.toHaveProperty("fee");
  });
  it("rejects injected percentages, amounts, currency and extra recipients before HTTP",async() => {
    const fetch = vi.fn(), adapter = new FlutterwaveTestAdapter({secretKey:key},{fetch});
    for (const input of [
      {...charge,subaccounts:[{id:school,transaction_charge_type:"percentage",transaction_charge:40}]},
      {...charge,amountMinor:510000,subaccounts:fixedSplitInstructions(school,null)},
      {...charge,currency:"USD",subaccounts:fixedSplitInstructions(school,null)},
      {...charge,subaccounts:[...fixedSplitInstructions(school,partner),{id:"RS_UNITthird000001",transaction_charge_type:"flat_subaccount",transaction_charge:10}]},
    ]) await expect(adapter.initializePayment(input as any)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("creates one TEST subaccount and verifies bank identity by independent read-back",async() => {
    const fetch = vi.fn().mockResolvedValueOnce(json({id:88})).mockResolvedValueOnce(json({
      id:88,subaccount_id:school,account_number:bank.accountNumber,account_bank:bank.bankCode,bank_name:"UNIT BANK",
    }));
    expect(await new FlutterwaveSplitProvider(key,{fetch}).createRecipient(bank,"SCHOOL")).toMatchObject({providerId:88,subaccountId:school});
    expect(fetch.mock.calls).toHaveLength(2);
    expect(fetch.mock.calls[0][1].method).toBe("POST");
    expect(fetch.mock.calls[1][1].method).toBe("GET");
    expect(JSON.parse(fetch.mock.calls[0][1].body).split_value).toBe(3000);
  });
  it("rejects a provider recipient with mismatched bank details",async() => {
    const fetch = vi.fn(async() => json({id:88,subaccount_id:school,account_number:"9999999999",account_bank:"044"}));
    await expect(new FlutterwaveSplitProvider(key,{fetch:fetch as any}).verifyRecipient(88,bank)).rejects.toThrow();
  });
  it("does not repeat recipient creation after a lost provider response",async() => {
    const fetch = vi.fn(async() => { throw new Error("MOCK accepted then response lost"); });
    await expect(new FlutterwaveSplitProvider(key,{fetch:fetch as any}).createRecipient(bank,"SCHOOL")).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("recipient recovery uses GET only",async() => {
    const fetch = vi.fn().mockResolvedValueOnce(json([{id:88,full_name:bank.entityName,account_bank:"044",account_number:bank.accountNumber}]))
      .mockResolvedValueOnce(json({id:88,subaccount_id:school,account_bank:"044",account_number:bank.accountNumber}));
    await new FlutterwaveSplitProvider(key,{fetch}).recoverRecipient(bank);
    expect(fetch.mock.calls.every(c => c[1].method === "GET")).toBe(true);
  });
  it("completed refund submission is pending customer disbursement",async() => {
    const fetch = vi.fn(async() => json({id:66,transaction_id:77,amount_refunded:100,status:"completed"}));
    expect((await new FlutterwaveSplitProvider(key,{fetch:fetch as any}).requestRefund({
      providerTransactionId:"77",amountMinor:10000,currency:"NGN",reason:"UNIT only partial refund",
    })).status).toBe("pending");
  });
  it("refund POST is never automatically repeated",async() => {
    const fetch = vi.fn(async() => { throw new Error("MOCK ambiguous refund"); });
    await expect(new FlutterwaveSplitProvider(key,{fetch:fetch as any}).requestRefund({
      providerTransactionId:"77",amountMinor:10000,currency:"NGN",reason:"UNIT only refund",
    })).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
describe("Mocked settlement evidence",() => {
  const report = {currency:"NGN",bank_code:"044",settlement_account:bank.accountNumber,status:"completed",
    disburse_ref:"UNIT-DISBURSE",processed_date:"2026-10-11T08:00:00Z",refund:0,chargeback:0};
  const tx = {id:77,tx_ref:"fee_unit_split_checkout",currency:"NGN",status:"successful",settlement_amount:2000};
  const expected = {transactionId:"77",reference:tx.tx_ref,amountMinor:200000};
  it("accepts TEST provider-reported completion only with exact recipient evidence",() => {
    expect(inspectRecipientSettlement(report,tx,bank,expected).status).toBe("TEST_PROVIDER_REPORTED_COMPLETE");
  });
  it.each([
    {status:"pending"}, {disburse_ref:null}, {processed_date:null},
  ])("pending/incomplete reports do not prove disbursement: %o",overrides => {
    expect(inspectRecipientSettlement({...report,...overrides},tx,bank,expected).status).toBe("PENDING");
  });
  it("flags wrong amount, wrong account, foreign reference, failed settlement and chargeback",() => {
    expect(inspectRecipientSettlement(report,{...tx,settlement_amount:1999},bank,expected).status).toBe("MISMATCH");
    expect(inspectRecipientSettlement({...report,settlement_account:"9999999999"},tx,bank,expected).status).toBe("MISMATCH");
    expect(inspectRecipientSettlement(report,{...tx,tx_ref:"fee_foreign"},bank,expected).status).toBe("MISMATCH");
    expect(inspectRecipientSettlement({...report,status:"failed"},tx,bank,expected).status).toBe("FAILED");
    expect(inspectRecipientSettlement({...report,chargeback:100},tx,bank,expected).status).toBe("MISMATCH");
  });
});
