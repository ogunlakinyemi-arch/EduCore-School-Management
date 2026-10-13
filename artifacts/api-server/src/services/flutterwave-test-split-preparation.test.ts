import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  query:vi.fn(), transactionEvidence:vi.fn(), verifyRecipient:vi.fn(), settlementCandidates:vi.fn(), settlement:vi.fn(),
  existing:vi.fn(), create:vi.fn(), resolve:vi.fn(), row:{} as any, payment:{} as any,
}));
vi.mock("@workspace/db",() => ({pool:{query:f.query,connect:async() => ({query:f.query,release:vi.fn()})}}));
vi.mock("./flutterwave-split-provider",() => ({splitProvider:() => ({
  transactionEvidence:f.transactionEvidence,verifyRecipient:f.verifyRecipient,settlementCandidates:f.settlementCandidates,
  settlement:f.settlement,verifyExistingTestReference:f.existing,createRecipient:f.create,resolveBank:f.resolve,
})}));
vi.mock("./flutterwave-split-crypto",() => ({
  decryptSplitBank:() => ({bankCode:"044",accountNumber:"0123456789",entityName:"UNIT ONLY SCHOOL",
    businessEmail:"finance@school.edu.ng",accountName:"UNIT OWNER",contactPhone:"08000000000"}),
  encryptSplitBank:vi.fn(() => "unit-only-encrypted"),splitBankFingerprint:vi.fn(() => "unit-only-fingerprint"),
}));
import { transactionSplitEvidence } from "./flutterwave-split-evidence";
import { reviewSplitRecipient, submitSplitRecipient, recipientView } from "./flutterwave-split-recipients";
import { existingDiagnosticTestReference } from "../lib/flutterwave-split-review";

beforeEach(() => {
  vi.stubEnv("NODE_ENV","development");vi.stubEnv("REPLIT_DEPLOYMENT","");
  for (const mock of [f.query,f.transactionEvidence,f.verifyRecipient,f.settlementCandidates,f.settlement,f.existing,f.create,f.resolve]) mock.mockReset();
  f.row={id:10,kind:"SCHOOL",school_id:1,status:"BANK_RESOLVED",entity_name:"UNIT ONLY SCHOOL",bank_ciphertext:"unit-only-encrypted",
    account_last4:"6789",bank_name:"UNIT BANK",provider_id:12,provider_subaccount_id:"RS_UNITSchool000001"};
  f.payment={payment_id:40,provider:"FLUTTERWAVE",provider_mode:"SANDBOX",collection_status:"PAID",provider_transaction_id:"1234",
    status:"COLLECTION_PAID",reference:"unit_split_transaction",platform_amount_minor:300000,school_amount_minor:200000,partner_amount_minor:0,
    created_at:"2026-10-13T00:00:00Z",instructions:[{id:"RS_UNITSchool000001",transaction_charge_type:"flat_subaccount",transaction_charge:2000}]};
  f.query.mockImplementation(async(sql:string) => {
    if(sql.includes("SELECT s.*,p.status")) return {rows:[f.payment]};
    if(sql.includes("SELECT r.* FROM flutterwave_split_settlements")) return {rows:[f.row]};
    if(sql.includes("SELECT * FROM flutterwave_split_recipients")) return {rows:[f.row]};
    if(sql.includes("RETURNING *")) return {rows:[f.row]};
    return {rows:[]};
  });
  f.transactionEvidence.mockResolvedValue({id:1234,tx_ref:f.payment.reference,currency:"NGN",status:"successful",
    amount:5000,charged_amount:5000,app_fee:70,merchant_fee:0});
  f.verifyRecipient.mockResolvedValue({providerId:12,subaccountId:f.row.provider_subaccount_id});
  f.settlementCandidates.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

describe("Read-only TEST transaction evidence service",() => {
  it("returns unconfirmed when actual split records are absent, without any accounting writes",async() => {
    const result=await transactionSplitEvidence(40);
    expect(result.status).toBe("UNCONFIRMED");
    expect(result.bankSettlementVerified).toBe(false);
    expect(result.platformNetMinor).toBe(293000);
    expect(f.query.mock.calls.every(c => String(c[0]).trim().startsWith("SELECT"))).toBe(true);
    expect(f.create).not.toHaveBeenCalled();
  });
  it("does not treat echoed instructions as actual provider allocation",async() => {
    f.transactionEvidence.mockResolvedValue({id:1234,tx_ref:f.payment.reference,currency:"NGN",status:"successful",
      amount:5000,charged_amount:5000,app_fee:0,merchant_fee:0,subaccounts:f.payment.instructions,meta:{splits:f.payment.instructions}});
    expect((await transactionSplitEvidence(40)).status).toBe("UNCONFIRMED");
  });
  it("leaves failed provider read-back explicitly unconfirmed without fabricating fees",async() => {
    f.transactionEvidence.mockRejectedValue(new Error("unit only"));
    const r=await transactionSplitEvidence(40);
    expect(r.status).toBe("UNCONFIRMED");expect(r.appFeeMinor).toBeNull();
    expect(f.settlementCandidates).not.toHaveBeenCalled();
  });
  it("stops on transaction mismatch before more provider reads",async() => {
    f.transactionEvidence.mockResolvedValue({id:9999,tx_ref:f.payment.reference,currency:"NGN",status:"successful"});
    expect((await transactionSplitEvidence(40)).status).toBe("MISMATCH");
    expect(f.verifyRecipient).not.toHaveBeenCalled();
  });
  it("compares independent matching recipient transaction amounts but never invents a complete split set",async() => {
    f.settlementCandidates.mockResolvedValue([{id:90}]);
    f.settlement.mockResolvedValue({subaccount_id:f.row.provider_subaccount_id,currency:"NGN",bank_code:"044",settlement_account:"0123456789",
      transactions:[{id:1234,tx_ref:f.payment.reference,currency:"NGN",status:"successful",settlement_amount:2000}]});
    const result=await transactionSplitEvidence(40);
    expect(result.recipients[0].observedAmountMinor).toBe(200000);
    expect(result.status).toBe("UNCONFIRMED");
    f.settlement.mockResolvedValue({subaccount_id:f.row.provider_subaccount_id,currency:"NGN",bank_code:"044",settlement_account:"0123456789",
      transactions:[{id:1234,tx_ref:f.payment.reference,currency:"NGN",status:"successful",settlement_amount:1900}]});
    expect((await transactionSplitEvidence(40)).status).toBe("MISMATCH");
  });
  it.each([{provider_mode:"LIVE"},{collection_status:"PENDING"},{status:"REFUND_REVIEW"},{school_amount_minor:199999}])("blocks unsuitable records before provider contact",(change) => {
    Object.assign(f.payment,change);
    return expect(transactionSplitEvidence(40)).rejects.toThrow().then(() => expect(f.transactionEvidence).not.toHaveBeenCalled());
  });
  it.each([{subaccount_id:null},{subaccount_id:"RS_AnotherRecipient000"},{settlement_account:"9999999999"}])("does not attribute unidentified or foreign settlement records",(change) => {
    f.settlementCandidates.mockResolvedValue([{id:90}]);
    f.settlement.mockResolvedValue({subaccount_id:f.row.provider_subaccount_id,currency:"NGN",bank_code:"044",settlement_account:"0123456789",
      transactions:[{id:1234,tx_ref:f.payment.reference,currency:"NGN",status:"successful",settlement_amount:2000}],...change});
    return transactionSplitEvidence(40).then(result => {
      expect(result.status).toBe("UNCONFIRMED");
      expect(result.recipients[0].observedAmountMinor).toBeNull();
    });
  });
  it("blocks deployed environments before any database or provider operation",async() => {
    vi.stubEnv("REPLIT_DEPLOYMENT","1");
    await expect(transactionSplitEvidence(40)).rejects.toThrow();
    expect(f.query).not.toHaveBeenCalled();expect(f.transactionEvidence).not.toHaveBeenCalled();
  });
});

describe("Contact and existing recipient review controls",() => {
  it("masks the encrypted contact rather than exposing it in recipient views",() => {
    expect(recipientView(f.row).maskedBusinessEmail).toBe("f•••@school.edu.ng");
    expect(JSON.stringify(recipientView(f.row))).not.toContain("finance@school.edu.ng");
  });
  it("requires both ownership confirmations before any reuse investigation",async() => {
    await expect(reviewSplitRecipient(10,1,{action:"VERIFY_EXISTING_TEST",note:"Unit-only reviewed note",
      existingTestReference:existingDiagnosticTestReference,ownershipConfirmed:true,distinctFromPlatformAccountConfirmed:false})).rejects.toThrow();
    expect(f.existing).not.toHaveBeenCalled();expect(f.create).not.toHaveBeenCalled();
  });
  it("requires unresolved bank review state, not a shortcut for an already-ready recipient",async() => {
    f.row.status="TEST_READY";
    await expect(reviewSplitRecipient(10,1,{action:"VERIFY_EXISTING_TEST",note:"Unit-only reviewed note",
      existingTestReference:existingDiagnosticTestReference,ownershipConfirmed:true,distinctFromPlatformAccountConfirmed:true})).rejects.toThrow();
    expect(f.existing).not.toHaveBeenCalled();
  });
  it("never calls create while investigating the explicitly reviewed existing reference",async() => {
    f.existing.mockResolvedValue({providerId:12,subaccountId:existingDiagnosticTestReference,bankName:"UNIT BANK"});
    await reviewSplitRecipient(10,1,{action:"VERIFY_EXISTING_TEST",note:"Unit-only reviewed note",
      existingTestReference:existingDiagnosticTestReference,ownershipConfirmed:true,distinctFromPlatformAccountConfirmed:true});
    expect(f.existing).toHaveBeenCalledOnce();expect(f.create).not.toHaveBeenCalled();
    expect(f.query.mock.calls.find(c => String(c[0]).includes("reviewed_by=$1"))?.[1]).toEqual([1,"Unit-only reviewed note",10]);
  });
  it("does not mark readiness when independent read-back fails",async() => {
    f.existing.mockRejectedValue(new Error("unit-only ownership mismatch"));
    await reviewSplitRecipient(10,1,{action:"VERIFY_EXISTING_TEST",note:"Unit-only reviewed note",
      existingTestReference:existingDiagnosticTestReference,ownershipConfirmed:true,distinctFromPlatformAccountConfirmed:true});
    expect(f.query.mock.calls.some(c => String(c[0]).includes("THEN 'TEST_READY'"))).toBe(false);
    expect(f.create).not.toHaveBeenCalled();
  });
  it("refuses an invalid business email before bank resolution or inserts",async() => {
    await expect(submitSplitRecipient(1,{kind:"SCHOOL",id:1,name:"UNIT ONLY SCHOOL"},{
      bankCode:"044",accountNumber:"0123456789",contactPhone:"08000000000",businessEmail:"bad",
    })).rejects.toThrow();
    expect(f.resolve).not.toHaveBeenCalled();expect(f.query).not.toHaveBeenCalled();
  });
});
