import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { localPaymentDiagnostic, diagnosticSelector } from "./local-payment-diagnostic";
import { assertDiagnosticDevelopment, assertPaymentBinding, validatePaymentBinding } from "../lib/development-payment-binding";

const identity = {
  database:"fictional_dev", database_oid:"123",system_identifier:"123456",data_directory:"/fictional/dev",
  server_started:"2026-10-19T00:00:00.000000Z",server_address:null,port:"5432",role:"fixture",
  server_version_num:"160000",in_recovery:false,encoding:"UTF8",collate:"C",ctype:"C",locale_provider:"c",
};
const reference = "SCV2_fee_f84ba48e6b8e42959901f2c4eaa9e4e4";
const payment = {id:91,school_id:11,student_id:12,subscription_id:13,status:"PAID",
  provider:"FLUTTERWAVE",provider_mode:"SANDBOX",currency:"NGN",gross_amount_minor:500000,
  provider_fee_minor:7000,settlement_amount_minor:493000,settlement_status:"RECONCILED",
  reconciliation_status:"RECONCILED",failure_code:null,receipt_present:true,
  receipt_snapshot:{name:"PRIVATE"},email:"PRIVATE",bank_account:"PRIVATE"};
beforeEach(() => {
  vi.stubEnv("NODE_ENV","development");
  // Fixtures only; no application connection or deployment flag bypass.
  vi.stubEnv("REPLIT_ENVIRONMENT","development");
  vi.stubEnv("REPLIT_DEPLOYMENT",undefined);
  vi.stubEnv("REPLIT_DEPLOYMENT_ID",undefined);
});
afterEach(() => vi.unstubAllEnvs());
function setup(options: {owner?: boolean; plan?: any; found?: boolean; ledger?: any[]; identity?: any} = {}) {
  const query = vi.fn(async (sql: string, _args?: unknown[]) => {
    if (sql.includes("pg_control_system")) return {rows:[options.identity ?? identity]};
    if (sql.includes("FROM app_users")) return {rows:options.owner === false ? [] : [{id:1}]};
    if (sql.includes("FROM student_subscription_payments")) return {rows:options.found === false ? [] : [payment]};
    if (sql.includes("FROM flutterwave_split_payments")) return {rows:options.plan ? [options.plan] : []};
    if (sql.includes("FROM student_subscription_allocations")) return {rows:options.ledger ?? []};
    if (sql.includes("FROM flutterwave_split_settlements")) return {rows:[{kind:"SCHOOL",
      status:"PENDING",expected_amount_minor:190000,observed_amount_minor:null,provider_record_present:false}]};
    return {rows:[]};
  });
  const release = vi.fn(), connect = vi.fn(async () => ({query,release}));
  const binding = vi.fn(async () => identity);
  const run = (input = {txRef:reference}) => localPaymentDiagnostic({connect} as any,"fictional-clerk",input,binding);
  return {query,release,connect,binding,run};
}
it("reads base payment without a plan, preserves fee/net, and discloses no private snapshots", async () => {
  const s = setup(), result = await s.run();
  expect(result).toMatchObject({outcome:"FOUND",frozenPlan:{present:false},
    payment:{grossMinor:500000,providerFeeMinor:7000,providerNetMinor:493000},
    receipt:{present:true},webhook:{outcome:"UNKNOWN",durableCorrelatedDeliveryEvidence:false}});
  expect(JSON.stringify(result)).not.toContain("PRIVATE");
  expect(s.query.mock.calls[0][0]).toBe("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  expect(s.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  expect(s.release).toHaveBeenCalledOnce();
  expect(s.query.mock.calls.find(c => c[0].includes("FROM student_subscription_payments"))?.[1]).toEqual([reference]);
  expect(s.query.mock.calls.some(c => /\b(INSERT|UPDATE|DELETE|FOR UPDATE)\b/.test(c[0]))).toBe(false);
});
it.each([true,false])("returns saved plan and credits without recomputing Partner=%s", async partner => {
  const plan = {status:"COLLECTION_PAID",school_amount_minor:190000,
    partner_amount_minor:partner ? 10000 : 0,platform_amount_minor:partner ? 300000 : 310000,
    provider_fee_minor:7000,provider_additional_fee_minor:0};
  const s = setup({plan,ledger:[{entry_type:"EXPENSE",recipient_type:"PLATFORM",amount_minor:7000}]});
  expect(await s.run()).toMatchObject({frozenPlan:{present:true,schoolMinor:190000,
    partnerMinor:partner ? 10000 : 0,ownerMinor:partner ? 300000 : 310000},
    ledger:{entries:[{entryType:"EXPENSE",recipientType:"PLATFORM",amountMinor:7000}]},
    settlements:{records:[{kind:"SCHOOL",status:"PENDING"}]}});
});
it("preserves historical saved 2000 policy and exact unversioned references", async () => {
  const s = setup({plan:{school_amount_minor:200000,platform_amount_minor:290000,partner_amount_minor:10000}});
  expect(await s.run({txRef:"fee_historical_123456"})).toMatchObject({
    frozenPlan:{schoolMinor:200000,ownerMinor:290000,partnerMinor:10000}});
});
it("rejects non-owners before payment reads; authorization requires active GLOBAL owner", async () => {
  const s = setup({owner:false});
  await expect(s.run()).rejects.toMatchObject({status:403});
  const auth = s.query.mock.calls.find(c => c[0].includes("FROM app_users"))!;
  expect(auth[0]).toContain("m.school_id IS NULL");
  expect(auth[0]).toContain("u.status='ACTIVE'");
  expect(auth[1]).toEqual(["fictional-clerk"]);
  expect(s.query.mock.calls.some(c => c[0].includes("FROM student_subscription_payments"))).toBe(false);
  expect(s.query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
});
it("binds every child read to the original payment tenant and person, without accepting school overrides", async () => {
  const s = setup({plan:{school_amount_minor:190000}});
  await s.run();
  for (const table of ["flutterwave_split_payments","student_subscription_allocations","flutterwave_split_settlements"]) {
    const call = s.query.mock.calls.find(c => c[0].includes(`FROM ${table}`))!;
    expect(call[1]).toEqual([91,11,12,13]);
    expect(call[0]).toContain("school_id=$2");
  }
  expect(() => diagnosticSelector({txRef:reference,schoolId:"99"})).toThrow("ONE_EXACT_REFERENCE_REQUIRED");
});
it("distinguishes unavailable flw_ref mapping from not found, with no fallback to transaction ID", async () => {
  const s = setup();
  expect(await s.run({flutterwaveReference:"0081341457511792393470202"} as any)).toMatchObject({
    outcome:"LOOKUP_UNAVAILABLE",reason:"FLUTTERWAVE_REFERENCE_NOT_PERSISTED"});
  expect(s.query.mock.calls.some(c => c[0].includes("FROM student_subscription_payments"))).toBe(false);
});
it("reports exact-reference not found without trying prefix search", async () => {
  const s = setup({found:false});
  expect(await s.run()).toMatchObject({outcome:"NOT_FOUND"});
  const sql = s.query.mock.calls.find(c => c[0].includes("FROM student_subscription_payments"))![0];
  expect(sql).toContain("reference=$1");
  expect(sql).toContain("provider_mode='SANDBOX'");
  expect(sql).not.toContain("LIKE");
});
it("does not connect without authentication or independent binding", async () => {
  const s = setup();
  await expect(localPaymentDiagnostic({connect:s.connect} as any,null,{txRef:reference},s.binding))
    .rejects.toMatchObject({status:401});
  expect(s.connect).not.toHaveBeenCalled();
  await expect(localPaymentDiagnostic({connect:s.connect} as any,"id",{txRef:reference},
    async () => {throw new Error("No proof");})).rejects.toThrow("No proof");
  expect(s.connect).not.toHaveBeenCalled();
});
it("rolls back and releases on binding mismatch before even reading authorization", async () => {
  const s = setup({identity:{...identity,system_identifier:"999"}});
  await expect(s.run()).rejects.toMatchObject({code:"DEVELOPMENT_BINDING_MISMATCH"});
  expect(s.query.mock.calls.some(c => c[0].includes("FROM app_users"))).toBe(false);
  expect(s.release).toHaveBeenCalledOnce();
});
it.each([
  {NODE_ENV:"production"},{NODE_ENV:"test"},
  {NODE_ENV:"development",REPLIT_DEPLOYMENT:""},
  {NODE_ENV:"development",REPLIT_DEPLOYMENT_ID:""},
  {NODE_ENV:"development",REPLIT_ENVIRONMENT:"production"},
])("vetoes deployment/environment before connecting: %j", env => {
  expect(() => assertDiagnosticDevelopment(env)).toThrow("DEVELOPMENT_DIAGNOSTIC_UNAVAILABLE");
});
it("requires fresh independent proof and exact restart/role/cluster match", () => {
  const proof = {environment:"development",verifiedBy:"replit-development-read-only",
    verifiedAt:new Date().toISOString(),identity};
  expect(validatePaymentBinding(proof)).toEqual(identity);
  expect(() => validatePaymentBinding({...proof,verifiedAt:"2000-01-01"})).toThrow();
  expect(() => validatePaymentBinding({...proof,verifiedBy:"shell"})).toThrow();
  expect(() => validatePaymentBinding({...proof,identity:{...identity,in_recovery:true}})).toThrow();
  for (const key of ["role","server_started","system_identifier"]) {
    expect(() => assertPaymentBinding(identity,{...identity,[key]:"other"})).toThrow();
  }
});
it.each([{}, {txRef:reference,flutterwaveReference:"0081341457511792393470202"},
  {txRef:"SCV2_%"},{txRef:["x"]},{txRef:"' OR 1=1 --"}])("rejects ambiguous or non-exact selectors %j", input => {
  expect(() => diagnosticSelector(input)).toThrow();
});
