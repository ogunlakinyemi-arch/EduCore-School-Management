/** UNIT TEST: SQL responses are mocks, not PostgreSQL or genuine provider proof. */
import { beforeEach,afterEach,expect,it,vi } from "vitest";
const f = vi.hoisted(() => ({
  enabled:true,schoolReady:true,partnerEligible:false,partnerReady:true,snapshot:null as any,query:vi.fn(),
}));
vi.mock("@workspace/db",() => ({pool:{connect:async() => ({query:f.query,release:vi.fn()})}}));
import { prepareSplitCheckout,validateSplitCollection } from "./flutterwave-split-checkout";
const school = {id:10,provider_subaccount_id:"RS_UNITSchool000001"};
const partner = {id:11,provider_subaccount_id:"RS_UNITPartner00001"};
const payment = {id:40,school_id:1,student_id:2,subscription_id:3,academic_session_id:4,academic_term_id:5,
  reference:"fee_unit_split_checkout",gross_amount_minor:500000,currency:"NGN",provider:"FLUTTERWAVE",provider_mode:"SANDBOX",status:"PENDING",term:"FIRST"};
beforeEach(() => {
  vi.stubEnv("NODE_ENV","development"); vi.stubEnv("REPLIT_DEPLOYMENT","");
  Object.assign(f,{enabled:true,schoolReady:true,partnerEligible:false,partnerReady:true,snapshot:null});
  f.query.mockReset().mockImplementation(async(sql: string,args: any[]) => {
    if (sql.includes("SELECT p.*,sub.term")) return {rows:[payment]};
    if (sql.includes("FROM flutterwave_split_settings")) return {rows:f.enabled ? [{enabled:true,automatic_settlement_confirmed:true}] : []};
    if (sql.startsWith("SELECT * FROM flutterwave_split_payments")) return {rows:f.snapshot ? [f.snapshot] : []};
    if (sql.includes("FROM school_partner_attributions")) return {rows:f.partnerEligible ? [{id:20,partner_profile_id:6}] : []};
    if (sql.includes("FROM commission_rules")) return {rows:[{id:21}]};
    if (sql.includes("FROM flutterwave_split_recipients WHERE school_id")) return {rows:f.schoolReady ? [school] : []};
    if (sql.includes("FROM flutterwave_split_recipients WHERE partner_profile_id")) return {rows:f.partnerReady ? [partner] : []};
    if (sql.includes("INSERT INTO flutterwave_split_payments")) f.snapshot = {
      payment_id:args[0],school_id:args[1],student_id:args[2],subscription_id:args[3],session_id:args[4],term_id:args[5],
      reference:args[6],school_recipient_id:args[7],partner_recipient_id:args[8],partner_profile_id:args[9],
      attribution_id:args[10],commission_rule_id:args[11],instructions:JSON.parse(args[12]),platform_amount_minor:args[14],status:"CHECKOUT_FROZEN",
    };
    return {rows:[]};
  });
});
afterEach(() => vi.unstubAllEnvs());
it.each([
  ["fee_legacy_fixture",true,false],["fee_legacy_fixture",false,true],
  ["SCV2_fixture",true,true],["SCV2_fixture",false,false],
  ["SCV3_fixture",true,true],["SCV3_fixture",false,false],
] as const)("never prepares split issuance or a platform-only fallback: %s enabled=%s BRO=%s",async(reference,enabled,bro)=>{
  f.enabled=enabled;f.partnerEligible=bro;
  const original=payment.reference;payment.reference=reference;
  try{
    for(let retry=0;retry<2;retry++)await expect(prepareSplitCheckout(40))
      .rejects.toHaveProperty("code","LEGACY_SPLIT_WORKFLOW_ARCHIVED");
    expect(f.query).not.toHaveBeenCalled();expect(f.snapshot).toBeNull();
  }finally{payment.reference=original;}
});
it("historical SCV3 cannot finalize without its original frozen plan",async()=>{
  const reference=payment.reference;
  try {
    payment.reference=`SCV3_${reference}`;f.enabled=false;
    await expect(validateSplitCollection({query:f.query},{id:40,reference:payment.reference},{} as any))
      .rejects.toThrow("original school-only frozen");
  } finally {payment.reference=reference;}
});
// Seed retained evidence directly; no retired issuance is used to prepare history.
function historicalSnapshot(status="CHECKOUT_FROZEN"){
  return {payment_id:40,school_id:1,student_id:2,subscription_id:3,session_id:4,term_id:5,
    reference:payment.reference,school_recipient_id:10,partner_recipient_id:null,partner_profile_id:null,
    attribution_id:null,commission_rule_id:null,platform_amount_minor:300000,status,
    instructions:[{id:school.provider_subaccount_id,transaction_charge_type:"flat_subaccount",transaction_charge:2000}]};
}
it("paid replay with a different provider transaction cannot justify a credit",async() => {
  f.snapshot=historicalSnapshot();
  await expect(validateSplitCollection({query:f.query},{
    id:40,schoolId:1,studentId:2,subscriptionId:3,sessionId:4,termId:5,status:"PAID",providerTransactionId:"77",
  },{reference:payment.reference,amountMinor:500000,currency:"NGN",providerTransactionId:"78",status:"succeeded"})).rejects.toThrow();
});
it("refunded paid replay cannot justify a new credit",async() => {
  f.snapshot=historicalSnapshot("REFUNDED");
  await expect(validateSplitCollection({query:f.query},{
    id:40,schoolId:1,studentId:2,subscriptionId:3,sessionId:4,termId:5,status:"PAID",providerTransactionId:"77",
  },{reference:payment.reference,amountMinor:500000,currency:"NGN",providerTransactionId:"77",status:"succeeded"})).rejects.toThrow("refund");
});
