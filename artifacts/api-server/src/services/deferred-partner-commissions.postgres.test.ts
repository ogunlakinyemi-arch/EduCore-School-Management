import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { DatabasePool } from "@workspace/db/driver";
import { afterAll, beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  pool: null as unknown as InstanceType<typeof DatabasePool>,
  requestRefund:vi.fn(),verifyRefund:vi.fn(),
}));
vi.mock("@workspace/db", () => ({
  pool: { query: (...args: any[]) => (state.pool.query as any)(...args), connect: () => state.pool.connect() },
}));
vi.mock("@clerk/express",()=>({clerkClient:{}}));
vi.mock("./flutterwave-split-provider",async original=>({
  ...await original<typeof import("./flutterwave-split-provider")>(),
  splitProvider:()=>({requestRefund:state.requestRefund,verifyRefund:state.verifyRefund}),
}));
vi.mock("../middlewares/auth",async original=>{
  const actual=await original<typeof import("../middlewares/auth")>();
  return {...actual,requireAuthentication:()=> (req:any,res:any,next:any)=>{
    const role=req.header("x-test-role") ?? "PLATFORM_OWNER";
    if(role==="ANONYMOUS") return res.status(401).json({error:"Authentication required"});
    req.edupulseUser={user:{id:1,clerkUserId:"synthetic-owner",email:"owner@commission.invalid",status:"ACTIVE"},
      roles:[{id:1,role,status:"ACTIVE",schoolId:role==="SCHOOL_ADMIN" ? 10 : null}]};
    next();
  }};
});
import partnersRouter from "../routes/partners";
import {
  approveCommissionBatch, deferredCommissionEvidence, exportCommissionBatch, ownDeferredCommissionTotals,
} from "./deferred-partner-commissions";
import { updateManualPartnerPayout } from "./partner-payout-update";
import { holdSignedDeferredAdverseEvent } from "./deferred-commission-adverse-events";
import { studentSubscriptionFlutterwaveWebhookRouter } from "../routes/student-subscription-webhooks";
import { FlutterwaveTestAdapter } from "../lib/fee-providers";
import {requestSplitRefund,verifySplitRefund} from "./flutterwave-split-refunds";
let directory: string, postgres: ChildProcess, migration: string;
let server: ReturnType<express.Express["listen"]>,base:string;
// Real PostgreSQL constraints/triggers and transactions. No application database,
// inherited connection strings, external provider transport or financial writes.
const ddl = `
CREATE TABLE app_users(id integer PRIMARY KEY,email text);
INSERT INTO app_users VALUES(1,'owner@commission.invalid');
CREATE TABLE partner_profiles(id integer PRIMARY KEY,full_name text,status text);
INSERT INTO partner_profiles VALUES(1,'Synthetic Partner A','ACTIVE'),(2,'Synthetic Partner B','ACTIVE');
CREATE TABLE academic_sessions(id integer PRIMARY KEY,school_id integer,name text);
INSERT INTO academic_sessions VALUES(1,10,'2026/2027');
CREATE TABLE academic_terms(id integer PRIMARY KEY,school_id integer,name text,end_date date);
INSERT INTO academic_terms VALUES(1,10,'First Term',CURRENT_DATE-1),(2,10,'Second Term',CURRENT_DATE+30);
CREATE TABLE subscriptions(id integer PRIMARY KEY,status text,verification_status text,provider_reference text);
CREATE TABLE student_subscription_payments(
 id integer PRIMARY KEY,reference text,school_id integer,student_id integer,subscription_id integer,
 academic_session_id integer,academic_term_id integer,status text,provider_transaction_id text,
 reconciliation_status text,provider text,provider_mode text,gross_amount_minor integer,currency text,settlement_status text);
CREATE TABLE flutterwave_split_payments(
 payment_id integer PRIMARY KEY,reference text,school_id integer,student_id integer,subscription_id integer,
 session_id integer,term_id integer,school_recipient_id integer,partner_recipient_id integer,partner_profile_id integer,
 attribution_id integer,commission_rule_id integer,partner_amount_minor integer,platform_amount_minor integer,
 school_amount_minor integer,currency text,status text,provider_fee_minor integer,provider_additional_fee_minor integer,reconciliation_note text,
 CONSTRAINT flw_split_amounts_ck CHECK(school_amount_minor IN(190000,200000)));
CREATE TABLE flutterwave_split_adjustments(
 id serial PRIMARY KEY,payment_id integer REFERENCES student_subscription_payments(id),
 idempotency_key text UNIQUE,amount_minor integer,reason text,created_by integer,
 provider_refund_id text,status text DEFAULT 'REQUESTING',recovery_status text DEFAULT 'UNCONFIRMED',
 school_recovery_minor integer,partner_recovery_minor integer,platform_reversal_minor integer,
 updated_at timestamptz DEFAULT now());
CREATE TABLE partner_payouts(
 id serial PRIMARY KEY,partner_profile_id integer,amount numeric(12,2),currency text,status text,
 period_start timestamptz,period_end timestamptz,method text,notes text,payment_reference text,
 paid_at timestamptz,reversed_at timestamptz,reversal_reference text,created_at timestamptz DEFAULT now());
CREATE TABLE commission_ledger(
 id serial PRIMARY KEY,partner_profile_id integer,school_id integer,student_id integer,subscription_id integer,
 academic_session_id integer,term text,amount numeric(12,2),currency text,status text,
 payout_id integer REFERENCES partner_payouts(id),approved_at timestamptz,held_at timestamptz,reversed_at timestamptz,
 UNIQUE(subscription_id,term));
CREATE TABLE audit_logs(
 id serial PRIMARY KEY,"user" text,role text,actor_user_id integer,action text,module text,record_id integer,metadata jsonb);
`;
async function payment(id: number, partnerId: number | null = 1, termId = 1, reference = `SCV3_fixture_payment_${id}`) {
  const version3 = reference.startsWith("SCV3_");
  const school = reference.startsWith("SCV2_") || version3 ? 190000 : 200000;
  const term = termId === 1 ? "First Term" : "Second Term";
  await state.pool.query(`INSERT INTO subscriptions VALUES($1,'active','verified',$2);
  `, [id,reference]);
  await state.pool.query(`INSERT INTO student_subscription_payments VALUES
    ($1,$2,10,$1,$1,1,$3,'PAID',$4,'RECONCILED','FLUTTERWAVE','SANDBOX',500000,'NGN','PENDING')`,
    [id,reference,termId,`transaction-${id}`]);
  await state.pool.query(`INSERT INTO flutterwave_split_payments VALUES
    ($1,$2,10,$1,$1,1,$3,9,$4,$5,$6,$6,$7,$8,$9,'NGN','COLLECTION_PAID',6500,500)`,
    [id,reference,termId,partnerId && !version3 ? 8 : null,partnerId,partnerId ? 1 : null,
      partnerId ? 10000 : 0,500000-school-(partnerId ? 10000 : 0),school]);
  await state.pool.query("UPDATE flutterwave_split_payments SET provider_flw_reference=$1 WHERE payment_id=$2",
    [`FLW-independent-${id}`,id]);
  if (partnerId) await state.pool.query(`INSERT INTO commission_ledger
    (partner_profile_id,school_id,student_id,subscription_id,academic_session_id,term,amount,currency,status,payment_id)
    VALUES($1,10,$2,$2,1,$3,100,'NGN','PENDING',$4)`, [partnerId,id,term,version3 ? id : null]);
}
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(),"educore-deferred-pg-"));
  const data = path.join(directory,"data");
  const env = {PATH:process.env.PATH,LANG:"C.UTF-8",LC_ALL:"C.UTF-8"};
  execFileSync("initdb",["-D",data,"-U","commission_test","-A","trust","--no-locale"],{env,stdio:"ignore"});
  postgres = spawn("postgres",["-D",data,"-k",directory,"-h","","-p","5432"],{env,stdio:"ignore"});
  state.pool = new DatabasePool({host:directory,port:5432,database:"postgres",user:"commission_test",max:8});
  let ready=false;
  for(let i=0;i<100;i++) {
    try {await state.pool.query("SELECT 1");ready=true;break;} catch {await new Promise(r=>setTimeout(r,30));}
  }
  if(!ready) throw new Error("Disposable PostgreSQL unavailable; no fallback database allowed");
  migration=await readFile(new URL("../../../../lib/db/drizzle/0171_deferred_partner_commissions.sql",import.meta.url),"utf8");
  const app=express();
  app.use("/webhook",express.raw({type:"application/json"}),studentSubscriptionFlutterwaveWebhookRouter);
  app.use(express.json());app.use(partnersRouter);
  await new Promise<void>(r=>{server=app.listen(0,"127.0.0.1",()=>r());});
  const address=server.address();
  if(!address||typeof address==="string")throw new Error("Test listener unavailable");
  base=`http://127.0.0.1:${address.port}`;
},20000);
beforeEach(async()=>{
  vi.stubEnv("NODE_ENV","development");vi.stubEnv("REPLIT_DEPLOYMENT","");
  state.requestRefund.mockReset().mockImplementation(async input=>({
    ...input,providerRefundId:String(1000+state.requestRefund.mock.calls.length),status:"pending",
  }));
  state.verifyRefund.mockReset();
  await state.pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await state.pool.query(ddl);await state.pool.query(migration);
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
afterAll(async()=>{
  if(server) await new Promise<void>(r=>server.close(()=>r()));
  await state.pool?.end();
  if(postgres?.exitCode===null) await new Promise<void>(r=>{postgres.once("exit",()=>r());postgres.kill("SIGTERM");});
  if(directory) await rm(directory,{recursive:true,force:true});
});
const approve=(ids:number[],key="commission-bulk-fixture-1")=>approveCommissionBatch({commissionIds:ids,idempotencyKey:key},1);
describe("deferred commission native SQL evidence and atomic batch approval",()=>{
  it("only an authorized Owner can read financial evidence or approve a batch via the real route",async()=>{
    await payment(1);
    for(const role of ["SCHOOL_ADMIN","PARTNER","ANONYMOUS"]) {
      const status=role==="ANONYMOUS" ? 401 : 403;
      expect((await fetch(`${base}/platform/partner-term-commissions`,{headers:{"x-test-role":role}})).status).toBe(status);
      expect((await fetch(`${base}/platform/partner-payout-batches`,{method:"POST",headers:{
        "content-type":"application/json","x-test-role":role},body:JSON.stringify({commissionIds:[1],idempotencyKey:"role-boundary-fixture"})})).status).toBe(status);
    }
    const response=await fetch(`${base}/platform/partner-payout-batches`,{method:"POST",headers:{
      "content-type":"application/json"},body:JSON.stringify({commissionIds:[1],idempotencyKey:"owner-route-fixture"})});
    expect(response.status).toBe(201);expect(await response.json()).toMatchObject({status:"APPROVED",amountMinor:10000});
  });
  it("reconciles actual reported fees without counting liability as a provider split or inventing VAT",async()=>{
    await payment(1);await payment(2,null);
    const rows=await deferredCommissionEvidence();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({grossMinor:500000,schoolMinor:190000,amountMinor:10000,
      providerFeeMinor:6500,providerAdditionalFeeMinor:500,vatMinor:null,
      merchantRemainderMinor:303000,ownerNetMinor:293000,eligible:true,termEnded:true});
    expect(await ownDeferredCommissionTotals(1)).toEqual({earnedMinor:10000,pendingMinor:10000,approvedMinor:0,paidMinor:0,recoveryMinor:0});
    await state.pool.query("UPDATE flutterwave_split_payments SET provider_additional_fee_minor=NULL WHERE payment_id=1");
    expect((await deferredCommissionEvidence())[0]).toMatchObject({merchantRemainderMinor:null,ownerNetMinor:null});
  });
  it("keeps historical payment allocation snapshots and legacy commissions outside the new workflow",async()=>{
    await payment(1,1,1,"fee_legacy_payment_1");await payment(2,1,1,"SCV2_legacy_payment_2");
    const before=(await state.pool.query("SELECT * FROM flutterwave_split_payments ORDER BY payment_id")).rows;
    expect(await deferredCommissionEvidence()).toEqual([]);
    await expect(approve([1,2])).rejects.toThrow("Every selected");
    expect((await state.pool.query("SELECT * FROM flutterwave_split_payments ORDER BY payment_id")).rows).toEqual(before);
  });
  it("enforces a single accrual per payment and per student/partner/session/term",async()=>{
    await payment(1);
    await expect(state.pool.query(`INSERT INTO commission_ledger
      (partner_profile_id,school_id,student_id,subscription_id,academic_session_id,term,amount,currency,status,payment_id)
      SELECT partner_profile_id,school_id,student_id,subscription_id,academic_session_id,term,amount,currency,status,payment_id
      FROM commission_ledger WHERE id=1`)).rejects.toMatchObject({code:"23505"});
    await state.pool.query(`INSERT INTO student_subscription_payments SELECT 2,'SCV3_other_reference',school_id,student_id,2,
      academic_session_id,academic_term_id,status,'other-txn',reconciliation_status,provider,provider_mode,gross_amount_minor,currency,settlement_status
      FROM student_subscription_payments WHERE id=1`);
    await expect(state.pool.query(`INSERT INTO commission_ledger
      (partner_profile_id,school_id,student_id,subscription_id,academic_session_id,term,amount,currency,status,payment_id)
      SELECT partner_profile_id,school_id,student_id,2,academic_session_id,term,amount,currency,status,2 FROM commission_ledger WHERE id=1`))
      .rejects.toMatchObject({code:"23505",constraint:"deferred_commission_student_partner_term_uq"});
  });
  it("approves multiple partners once, groups payout records and audits exports without claiming Paid",async()=>{
    await payment(1);await payment(2,2);await payment(3);
    const result=await approve([1,2,3]);
    expect(result).toMatchObject({status:"APPROVED",executionMode:"EXPORT_ONLY",amountMinor:30000});
    expect(result.items).toHaveLength(3);
    expect((await state.pool.query("SELECT amount::float,status,method FROM partner_payouts ORDER BY id")).rows)
      .toEqual([{amount:200,status:"PENDING",method:"DEFERRED_BATCH_EXPORT"},{amount:100,status:"PENDING",method:"DEFERRED_BATCH_EXPORT"}]);
    expect(await ownDeferredCommissionTotals(1)).toMatchObject({approvedMinor:20000,pendingMinor:0,paidMinor:0});
    expect((await exportCommissionBatch(result.id,1)).id).toBe(result.id);
    expect((await state.pool.query("SELECT count(*)::int n FROM audit_logs")).rows[0].n).toBe(2);
    await expect(updateManualPartnerPayout({params:{payoutId:"1"},body:{status:"PAID",paymentReference:"invented"}} as any,vi.fn()))
      .rejects.toThrow("export only");
  });
  it("concurrent same-key approvals replay; a new key cannot approve a claimed entry",async()=>{
    await payment(1);
    const [a,b]=await Promise.all([approve([1]),approve([1])]);
    expect(a.id).toBe(b.id);
    await expect(approve([1],"different-approval-key")).rejects.toThrow("Every selected");
    expect((await state.pool.query("SELECT count(*)::int n FROM partner_payouts")).rows[0].n).toBe(1);
  });
  it("does not allow an idempotency key to change its selected commissions",async()=>{
    await payment(1);await payment(2);
    await approve([1]);await expect(approve([2])).rejects.toThrow("bound to different");
    expect((await state.pool.query("SELECT status FROM commission_ledger WHERE id=2")).rows[0].status).toBe("PENDING");
  });
  it("term not ended or partially ineligible selection rolls back the entire batch",async()=>{
    await payment(1);await payment(2,1,2);
    await expect(approve([1,2])).rejects.toThrow("past its school term end");
    expect((await state.pool.query("SELECT count(*)::int n FROM partner_payout_batches")).rows[0].n).toBe(0);
    expect((await state.pool.query("SELECT distinct status FROM commission_ledger")).rows).toEqual([{status:"PENDING"}]);
  });
  it.each(["REFUND_REVIEW","REFUNDED","COLLECTION_EXCEPTION","REPORT_EXCEPTION"])("holds %s commissions and blocks duplicate approval/export",async status=>{
    await payment(1);const batch=await approve([1]);
    await state.pool.query("UPDATE flutterwave_split_payments SET status=$1 WHERE payment_id=1",[status]);
    await state.pool.query("UPDATE flutterwave_split_payments SET status=$1 WHERE payment_id=1",[status]);
    expect((await state.pool.query("SELECT status FROM commission_ledger")).rows).toEqual([{status:"HELD"}]);
    expect((await state.pool.query("SELECT status FROM partner_payouts")).rows).toEqual([{status:"FAILED"}]);
    await expect(exportCommissionBatch(batch.id,1)).rejects.toThrow("exception");
    expect((await approve([1])).status).toBe("REVIEW_REQUIRED");
    expect(await ownDeferredCommissionTotals(1)).toMatchObject({earnedMinor:0,approvedMinor:0,paidMinor:0});
  });
  it("refund request/uncertain outcome holds immediately; failed refund is not silently reapproved",async()=>{
    await payment(1);
    await state.pool.query("INSERT INTO flutterwave_split_adjustments(payment_id,status) VALUES(1,'OUTCOME_UNKNOWN')");
    expect((await state.pool.query("SELECT status FROM commission_ledger")).rows[0].status).toBe("HELD");
    await state.pool.query("UPDATE flutterwave_split_adjustments SET status='FAILED'");
    await expect(approve([1])).rejects.toThrow("Every selected");
  });
  it("reversed paid evidence becomes recovery history, never a second payable",async()=>{
    await payment(1);
    // Synthetic verified-transfer history only; there is no app endpoint that can do this.
    await state.pool.query("UPDATE commission_ledger SET status='PAID'");
    await state.pool.query("UPDATE student_subscription_payments SET status='RECONCILIATION_REQUIRED' WHERE id=1");
    expect(await ownDeferredCommissionTotals(1)).toMatchObject({earnedMinor:0,paidMinor:0,recoveryMinor:10000});
    await expect(approve([1])).rejects.toThrow("Every selected");
  });
  it("refuses Production and deployment contexts before querying",async()=>{
    vi.stubEnv("REPLIT_DEPLOYMENT","1");await expect(approve([1])).rejects.toThrow("Development-only");
  });
  it.each(["refund.completed","chargeback.initiated","chargeback.reversed"])("signed %s holds original liability once without trusting webhook amounts",async event=>{
    await payment(1);const batch=await approve([1]);
    const raw=Buffer.from(JSON.stringify({event,data:{flw_ref:"FLW-independent-1",amount:1}}));
    expect(await holdSignedDeferredAdverseEvent(raw)).toBe(true);
    expect(await holdSignedDeferredAdverseEvent(raw)).toBe(true);
    expect((await state.pool.query("SELECT count(*)::int n FROM deferred_commission_adverse_events")).rows[0].n).toBe(1);
    expect((await state.pool.query("SELECT status FROM commission_ledger")).rows[0].status).toBe("HELD");
    expect((await state.pool.query("SELECT amount FROM commission_ledger")).rows[0].amount).toBe("100.00");
    await expect(exportCommissionBatch(batch.id,1)).rejects.toThrow("exception");
    // A later collection webhook never releases a dispute hold.
    expect(await holdSignedDeferredAdverseEvent(Buffer.from(JSON.stringify({event:"charge.completed",
      data:{tx_ref:"SCV3_fixture_payment_1",status:"successful"}})))).toBe(false);
  });
  it("authenticates documented standalone refund callbacks, durably holds once and acknowledges with HTTP200",async()=>{
    const verify=vi.spyOn(FlutterwaveTestAdapter.prototype,"verifyPayment").mockRejectedValue(new Error("Provider transport forbidden"));
    await payment(1);const batch=await approve([1]);
    await state.pool.query("UPDATE student_subscription_payments SET provider_transaction_id='9231836' WHERE id=1");
    vi.stubEnv("FLUTTERWAVE_SECRET_Test_Key","FLWSECK_TEST-synthetic-refund-fixture");
    vi.stubEnv("FLUTTERWAVE_TEST_SECRET_KEY","");
    vi.stubEnv("FLUTTERWAVE_WEBHOOK_VERIF_HASH","synthetic-refund-webhook-hash");
    const raw=JSON.stringify({id:99025,AmountRefunded:100,status:"completed",FlwRef:"FLW-independent-1",
      TransactionId:9231836,meta:'{"disburse_status":"failed"}'});
    const post=(hash?:string,body=raw)=>fetch(`${base}/webhook`,{method:"POST",
      headers:{"content-type":"application/json",...(hash ? {"verif-hash":hash}:{})},body});
    for(const hash of [undefined,"wrong"]) {
      expect((await post(hash)).status).toBe(401);
      expect((await state.pool.query("SELECT status FROM commission_ledger")).rows[0].status).toBe("APPROVED");
    }
    // Every supplied identifier must agree with one independently verified payment.
    expect((await post("synthetic-refund-webhook-hash",raw.replace("9231836","9231837"))).status).toBe(202);
    expect((await state.pool.query("SELECT status FROM commission_ledger")).rows[0].status).toBe("APPROVED");
    for(let i=0;i<2;i++) {
      const response=await post("synthetic-refund-webhook-hash");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({received:true,outcome:"held_for_reconciliation"});
    }
    expect((await state.pool.query("SELECT count(*)::int n FROM deferred_commission_adverse_events")).rows[0].n).toBe(1);
    expect((await state.pool.query("SELECT status,amount FROM commission_ledger")).rows[0]).toMatchObject({status:"HELD",amount:"100.00"});
    expect((await state.pool.query("SELECT count(*)::int n FROM flutterwave_split_adjustments")).rows[0].n).toBe(0);
    await expect(exportCommissionBatch(batch.id,1)).rejects.toThrow("exception");
    expect(verify).not.toHaveBeenCalled();
  });
  it.each(["reversed","refunded","failed"])("signed adverse charge %s cannot finalize again or clear approved liability",async status=>{
    const verify=vi.spyOn(FlutterwaveTestAdapter.prototype,"verifyPayment").mockRejectedValue(new Error("Provider transport forbidden"));
    await payment(1);await approve([1]);
    vi.stubEnv("FLUTTERWAVE_SECRET_Test_Key","FLWSECK_TEST-synthetic-refund-fixture");
    vi.stubEnv("FLUTTERWAVE_TEST_SECRET_KEY","");
    vi.stubEnv("FLUTTERWAVE_WEBHOOK_VERIF_HASH","synthetic-refund-webhook-hash");
    const response=await fetch(`${base}/webhook`,{method:"POST",
      headers:{"content-type":"application/json","verif-hash":"synthetic-refund-webhook-hash"},
      body:JSON.stringify({event:"charge.completed",data:{id:9231836,tx_ref:"SCV3_fixture_payment_1",status}})});
    expect(response.status).toBe(200);
    expect((await state.pool.query("SELECT status FROM commission_ledger")).rows[0].status).toBe("HELD");
    expect((await state.pool.query("SELECT status FROM student_subscription_payments")).rows[0].status).toBe("PAID");
    expect(verify).not.toHaveBeenCalled();
  });
  it("cannot attach mismatched adverse-event identifiers to another payment or treat transfer events as Paid",async()=>{
    await payment(1);
    expect(await holdSignedDeferredAdverseEvent(Buffer.from(JSON.stringify({event:"refund.completed",
      data:{tx_ref:"SCV3_wrong",flw_ref:"FLW-independent-1"}})))).toBe(false);
    expect(await holdSignedDeferredAdverseEvent(Buffer.from(JSON.stringify({event:"transfer.completed",
      data:{flw_ref:"FLW-independent-1",status:"successful"}})))).toBe(false);
    expect((await deferredCommissionEvidence())[0].eligible).toBe(true);
  });
  it("returns500 on a failed adverse audit, rolls back the hold, then safely acknowledges a durable retry once",async()=>{
    await payment(1);await approve([1]);
    vi.stubEnv("FLUTTERWAVE_SECRET_Test_Key","FLWSECK_TEST-durable-ack-fixture");
    vi.stubEnv("FLUTTERWAVE_TEST_SECRET_KEY","");
    vi.stubEnv("FLUTTERWAVE_WEBHOOK_VERIF_HASH","synthetic-durable-ack-hash");
    await state.pool.query(`CREATE FUNCTION reject_adverse_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action='Held deferred commission for adverse event' THEN RAISE EXCEPTION 'synthetic persistence failure'; END IF;
      RETURN NEW; END $$;
      CREATE TRIGGER reject_adverse_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_adverse_audit();`);
    const post=()=>fetch(`${base}/webhook`,{method:"POST",headers:{"content-type":"application/json",
      "verif-hash":"synthetic-durable-ack-hash"},body:JSON.stringify({event:"chargeback.initiated",
        data:{flw_ref:"FLW-independent-1"}})});
    expect((await post()).status).toBe(500);
    expect((await state.pool.query("SELECT count(*)::int n FROM deferred_commission_adverse_events")).rows[0].n).toBe(0);
    expect((await state.pool.query("SELECT status FROM commission_ledger")).rows[0].status).toBe("APPROVED");
    expect((await state.pool.query("SELECT status FROM partner_payout_batches")).rows[0].status).toBe("APPROVED");
    expect((await state.pool.query("SELECT status FROM flutterwave_split_payments")).rows[0].status).toBe("COLLECTION_PAID");
    await state.pool.query("DROP TRIGGER reject_adverse_audit ON audit_logs");
    expect((await post()).status).toBe(200);expect((await post()).status).toBe(200);
    expect((await state.pool.query("SELECT count(*)::int n FROM deferred_commission_adverse_events")).rows[0].n).toBe(1);
    expect((await state.pool.query("SELECT status FROM commission_ledger")).rows[0].status).toBe("HELD");
    expect((await state.pool.query("SELECT count(*)::int n FROM audit_logs WHERE action='Held deferred commission for adverse event'")).rows[0].n).toBe(1);
  });
  it("does not accept alternate signature headers, a missing configured hash, or successful transfer events as Paid evidence",async()=>{
    await payment(1);await approve([1]);
    vi.stubEnv("FLUTTERWAVE_SECRET_Test_Key","FLWSECK_TEST-transfer-denial-fixture");
    vi.stubEnv("FLUTTERWAVE_TEST_SECRET_KEY","");
    vi.stubEnv("FLUTTERWAVE_WEBHOOK_VERIF_HASH","synthetic-transfer-denial-hash");
    const post=(headers:Record<string,string>)=>fetch(`${base}/webhook`,{method:"POST",headers:{
      "content-type":"application/json",...headers},body:JSON.stringify({event:"transfer.completed",
        data:{flw_ref:"FLW-independent-1",reference:"invented-paid-proof",status:"SUCCESSFUL",amount:100,currency:"NGN"}})});
    expect((await post({"flutterwave-signature":"synthetic-transfer-denial-hash"})).status).toBe(401);
    vi.stubEnv("FLUTTERWAVE_WEBHOOK_VERIF_HASH","");
    expect((await post({"verif-hash":"synthetic-transfer-denial-hash"})).status).toBe(401);
    vi.stubEnv("FLUTTERWAVE_WEBHOOK_VERIF_HASH","synthetic-transfer-denial-hash");
    expect((await post({"verif-hash":"synthetic-transfer-denial-hash"})).status).toBe(202);
    await expect(updateManualPartnerPayout({params:{payoutId:"1"},body:{status:"PAID",paymentReference:"invented-paid-proof"}} as any,vi.fn()))
      .rejects.toThrow("export only");
    expect((await state.pool.query("SELECT status FROM commission_ledger")).rows[0].status).toBe("APPROVED");
    expect((await state.pool.query("SELECT status,paid_at FROM partner_payouts")).rows[0]).toMatchObject({status:"PENDING",paid_at:null});
    expect(await ownDeferredCommissionTotals(1)).toMatchObject({approvedMinor:10000,paidMinor:0});
  });
  it("reserves a lost refund POST once, holds approved liability, and never resends or invents recovery on retry",async()=>{
    await payment(1);const batch=await approve([1]);
    state.requestRefund.mockRejectedValueOnce(new Error("Synthetic provider response lost"));
    const input={amountMinor:100000,reason:"Synthetic partial refund",idempotencyKey:"lost-refund-fixture-1"};
    const first=await requestSplitRefund(1,1,input);
    expect(first).toMatchObject({status:"OUTCOME_UNKNOWN",providerRefundId:null,schoolRecoveryMinor:null,partnerRecoveryMinor:null});
    expect(await requestSplitRefund(1,1,input)).toEqual(first);
    expect(state.requestRefund).toHaveBeenCalledOnce();
    await expect(requestSplitRefund(1,1,{...input,amountMinor:100001})).rejects.toThrow("bound to a different");
    await expect(verifySplitRefund(first.id)).rejects.toThrow("without repeating");
    expect(state.verifyRefund).not.toHaveBeenCalled();
    expect((await state.pool.query("SELECT count(*)::int n FROM flutterwave_split_adjustments")).rows[0].n).toBe(1);
    expect((await state.pool.query("SELECT status FROM commission_ledger")).rows[0].status).toBe("HELD");
    await expect(exportCommissionBatch(batch.id,1)).rejects.toThrow("exception");
  });
  it.each([1,2,3])("persists exact cumulative partial-refund recovery once and preserves policy version%s",async version=>{
    const reference=version===1 ? "fee_legacy_refund_fixture" : `SCV${version}_refund_fixture`;
    await payment(1,1,1,reference);
    for(const [i,amountMinor] of [10001,489999].entries()) {
      const row=await requestSplitRefund(1,1,{amountMinor,reason:"Synthetic rounding evidence",
        idempotencyKey:`partial-refund-fixture-${i}`});
      expect(row.status).toBe("PROCESSING");
      state.verifyRefund.mockResolvedValue({providerRefundId:row.providerRefundId,
        providerTransactionId:"transaction-1",amountMinor,status:"succeeded"});
      const [a,b]=await Promise.all([verifySplitRefund(row.id),verifySplitRefund(row.id)]);
      expect(a).toEqual(b);
      expect(a).toMatchObject({status:"CONFIRMED",recoveryStatus:"RECIPIENT_RECOVERY_REVIEW"});
      const calls=state.verifyRefund.mock.calls.length;
      expect(await verifySplitRefund(row.id)).toEqual(a);
      expect(state.verifyRefund.mock.calls.length).toBe(calls);
    }
    const total=(await state.pool.query(`SELECT sum(amount_minor)::int refund,sum(school_recovery_minor)::int school,
      sum(partner_recovery_minor)::int partner,sum(platform_reversal_minor)::int merchant FROM flutterwave_split_adjustments`)).rows[0];
    expect(total).toEqual({refund:500000,school:version===1 ? 200000:190000,
      partner:version===3 ? 0:10000,merchant:version===1 ? 290000:version===2 ? 300000:310000});
    expect((await state.pool.query("SELECT status FROM flutterwave_split_payments")).rows[0].status).toBe("REFUNDED");
    expect((await state.pool.query("SELECT status FROM subscriptions")).rows[0].status).toBe("pending");
    // Original collection history is not rewritten as an unverified payment.
    expect((await state.pool.query("SELECT status,reference FROM student_subscription_payments")).rows[0]).toEqual({status:"PAID",reference});
    if(version===3) expect((await state.pool.query("SELECT status FROM commission_ledger")).rows[0].status).toBe("HELD");
  });
  it.each(["providerRefundId","providerTransactionId","amountMinor"])("rejects mismatched refund %s before confirming any recovery",async field=>{
    await payment(1);
    const row=await requestSplitRefund(1,1,{amountMinor:100000,reason:"Synthetic mismatch test",idempotencyKey:"mismatch-refund-fixture"});
    state.verifyRefund.mockResolvedValue({providerRefundId:row.providerRefundId,providerTransactionId:"transaction-1",
      amountMinor:100000,status:"succeeded",[field]:field==="amountMinor" ? 100001:"different-id"});
    await expect(verifySplitRefund(row.id)).rejects.toThrow("does not match");
    const saved=(await state.pool.query("SELECT status,school_recovery_minor,partner_recovery_minor FROM flutterwave_split_adjustments")).rows[0];
    expect(saved).toEqual({status:"PROCESSING",school_recovery_minor:null,partner_recovery_minor:null});
  });
  it("pending or failed refund read-back never reinstates a held commission or asserts bank recovery",async()=>{
    await payment(1);await approve([1]);
    const row=await requestSplitRefund(1,1,{amountMinor:100000,reason:"Synthetic pending/failed",idempotencyKey:"failed-refund-fixture"});
    for(const status of ["pending","failed"]) {
      state.verifyRefund.mockResolvedValue({providerRefundId:row.providerRefundId,providerTransactionId:"transaction-1",amountMinor:100000,status});
      expect(await verifySplitRefund(row.id)).toMatchObject({status:status==="failed" ? "FAILED":"PROCESSING",
        schoolRecoveryMinor:null,partnerRecoveryMinor:null,platformReversalMinor:null});
      expect((await state.pool.query("SELECT status FROM commission_ledger")).rows[0].status).toBe("HELD");
    }
    await expect(approve([1],"failed-refund-reapproval")).rejects.toThrow("Every selected");
    expect(await ownDeferredCommissionTotals(1)).toMatchObject({pendingMinor:0,approvedMinor:0,paidMinor:0});
  });
});
