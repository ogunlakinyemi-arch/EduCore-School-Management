import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const f=vi.hoisted(()=>({query:vi.fn(),provider:vi.fn(),read:vi.fn(),payment:{} as any,recipients:[] as any[]}));
vi.mock("@workspace/db",()=>({pool:{query:(...args:any[])=>f.query(...args)}}));
vi.mock("./flutterwave-split-provider",()=>({splitProvider:()=>f.provider()}));
import {transactionSplitEvidence} from "./flutterwave-split-evidence";
import {reconcileSplitPayment} from "./flutterwave-split-reporting";
beforeEach(()=>{
  vi.stubEnv("NODE_ENV","development");vi.stubEnv("REPLIT_DEPLOYMENT","");
  f.payment={payment_id:1,reference:"SCV3_readiness_fixture",provider:"FLUTTERWAVE",provider_mode:"SANDBOX",
    provider_transaction_id:"9231836",collection_status:"PAID",status:"COLLECTION_PAID",
    school_recipient_id:9,partner_recipient_id:null,partner_profile_id:1,
    school_amount_minor:190000,partner_amount_minor:10000,platform_amount_minor:300000,
    instructions:[{id:"RS_UNITSchool000001",transaction_charge_type:"flat_subaccount",transaction_charge:1900}]};
  f.recipients=[];
  f.query.mockReset().mockImplementation(async(sql:string)=>
    ({rows:sql.includes("JOIN flutterwave_split_recipients") ? f.recipients : sql.startsWith("UPDATE") ? [] : [f.payment]}));
  f.read.mockReset().mockResolvedValue({id:9231836,tx_ref:f.payment.reference,status:"successful",currency:"NGN",
    amount:5000,charged_amount:5000,app_fee:65,merchant_fee:5,
    // Echoes and aggregates must not become school/main bank settlement proof.
    subaccounts:f.payment.instructions,amount_settled:4930});
  f.provider.mockReset().mockReturnValue({transactionEvidence:f.read});
});
afterEach(()=>vi.unstubAllEnvs());
describe("Development-only readiness service boundaries with mocked transport",()=>{
  it.each([true,false])("calculates merchant remainder3100 less reported costs without inventing allocation proof; Partner=%s",hasPartner=>{
    if(!hasPartner) Object.assign(f.payment,{partner_profile_id:null,partner_amount_minor:0,platform_amount_minor:310000});
    return expect(transactionSplitEvidence(1)).resolves.toMatchObject({
      status:"UNCONFIRMED",evidenceLevel:"PARTIAL",platformGrossMinor:310000,platformNetMinor:303000,
      bankSettlementVerified:false,recipients:[{subaccountId:"RS_UNITSchool000001",amountMinor:190000,observedAmountMinor:null}],
    });
  });
  it.each(["app_fee","merchant_fee","charged_amount"])("missing %s leaves reconciliation unconfirmed, never fills a tax/fee gap with zero",async field=>{
    f.read.mockResolvedValue({id:9231836,tx_ref:f.payment.reference,status:"successful",currency:"NGN",
      amount:5000,charged_amount:5000,app_fee:65,merchant_fee:5,[field]:null,vat:5,amount_settled:4930});
    expect(await transactionSplitEvidence(1)).toMatchObject({status:"UNCONFIRMED",platformNetMinor:null,bankSettlementVerified:false});
  });
  it("unverified VAT fields, aggregate settled totals and echoed recipient instructions cannot establish merchant bank settlement",async()=>{
    f.read.mockResolvedValue({id:9231836,tx_ref:f.payment.reference,status:"successful",currency:"NGN",
      amount:5000,charged_amount:5000,app_fee:65,merchant_fee:5,vat:100,amount_settled:9999,
      subaccounts:f.payment.instructions,recipients:f.payment.instructions,completeRecipientSet:true});
    const result=await transactionSplitEvidence(1);
    expect(result).toMatchObject({status:"UNCONFIRMED",evidenceLevel:"PARTIAL",platformNetMinor:303000,bankSettlementVerified:false});
    expect(result).not.toHaveProperty("vatMinor");
    expect(result.recipients[0].observedAmountMinor).toBeNull();
  });
  it.each([[],[{id:9,provider_subaccount_id:"RS_UNITSchool000001",expected_amount_minor:200000}],
    [{id:9,provider_subaccount_id:"RS_UNITSchool000001",expected_amount_minor:190000},
     {id:8,provider_subaccount_id:"RS_UNITPartner00001",expected_amount_minor:10000}],
  ])("blocks missing/cross-policy/extra settlement rows before any provider call: %j",async(...rows)=>{
    f.recipients=rows;
    await expect(reconcileSplitPayment(1)).rejects.toThrow("Frozen recipient evidence");
    expect(f.provider).not.toHaveBeenCalled();
    expect(f.query.mock.calls.some(([sql])=>sql.includes("SET status='REPORT_EXCEPTION'"))).toBe(true);
  });
  it("refuses a deployed context before accessing data or provider transport",async()=>{
    vi.stubEnv("REPLIT_DEPLOYMENT","1");
    await expect(transactionSplitEvidence(1)).rejects.toThrow("Development-only");
    await expect(reconcileSplitPayment(1)).rejects.toThrow("Development-only");
    expect(f.query).not.toHaveBeenCalled();expect(f.provider).not.toHaveBeenCalled();
  });
});
