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
it("preserves the default-off unsplit checkout",async() => {
  f.enabled=false; expect(await prepareSplitCheckout(40)).toBeUndefined();
  expect(f.query.mock.calls.some(c => c[0].includes("INSERT"))).toBe(false);
});
it("freezes only school2000 without an eligible Partner",async() => {
  expect((await prepareSplitCheckout(40))!.map(s => s.transaction_charge)).toEqual([2000]);
  expect(f.snapshot.partner_profile_id).toBeNull(); expect(f.snapshot.platform_amount_minor).toBe(300000);
});
it("freezes school2000 and eligible Partner100 against active attribution and rule",async() => {
  f.partnerEligible=true;
  expect((await prepareSplitCheckout(40))!.map(s => s.transaction_charge)).toEqual([2000,100]);
  expect(f.snapshot).toMatchObject({partner_profile_id:6,attribution_id:20,commission_rule_id:21,platform_amount_minor:290000});
});
it("blocks missing school recipient",async() => {
  f.schoolReady=false; await expect(prepareSplitCheckout(40)).rejects.toThrow("School needs");
});
it("blocks a missing eligible-partner recipient without rerouting commission",async() => {
  f.partnerEligible=true; f.partnerReady=false;
  await expect(prepareSplitCheckout(40)).rejects.toThrow("Eligible partner");
  expect(f.snapshot).toBeNull();
});
it("reuses the same immutable snapshot on replay",async() => {
  await prepareSplitCheckout(40); await prepareSplitCheckout(40);
  expect(f.query.mock.calls.filter(c => c[0].includes("INSERT INTO flutterwave_split_payments"))).toHaveLength(1);
});
it("fails closed when an originally ineligible Partner becomes eligible before retry",async() => {
  await prepareSplitCheckout(40); f.partnerEligible=true;
  await expect(prepareSplitCheckout(40)).rejects.toThrow("Frozen split");
});
it("paid replay with a different provider transaction cannot justify a credit",async() => {
  await prepareSplitCheckout(40);
  await expect(validateSplitCollection({query:f.query},{
    id:40,schoolId:1,studentId:2,subscriptionId:3,sessionId:4,termId:5,status:"PAID",providerTransactionId:"77",
  },{reference:payment.reference,amountMinor:500000,currency:"NGN",providerTransactionId:"78",status:"succeeded"})).rejects.toThrow();
});
it("refunded paid replay cannot justify a new credit",async() => {
  await prepareSplitCheckout(40); f.snapshot.status="REFUNDED";
  await expect(validateSplitCollection({query:f.query},{
    id:40,schoolId:1,studentId:2,subscriptionId:3,sessionId:4,termId:5,status:"PAID",providerTransactionId:"77",
  },{reference:payment.reference,amountMinor:500000,currency:"NGN",providerTransactionId:"77",status:"succeeded"})).rejects.toThrow("refund");
});
