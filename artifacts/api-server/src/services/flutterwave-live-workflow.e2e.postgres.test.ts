import { execFileSync,spawn,type ChildProcess } from "node:child_process";
import { mkdtemp,readFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import express from "express";
import { DatabasePool } from "@workspace/db/driver";
import { beforeAll,beforeEach,afterAll,afterEach,describe,it,expect,vi } from "vitest";
import { issueLiveIntent } from "./flutterwave-live-intents";
import { finalizeLiveSubscriptionDesign } from "./flutterwave-live-finalization-design";
import { processLiveWorkflow,hasLiveTermEntitlement } from "./flutterwave-live-lifecycle";
import { approveLiveCommissionBatch,exportLiveCommissionBatch } from "./flutterwave-live-commissions";
import { persistAuthenticatedLiveWebhookReceipt } from "./flutterwave-live-webhook-inbox";
import { IsolatedLiveVerificationTransport,normalizeLiveIndependentRead } from "../lib/flutterwave-live-verification-transport";
import { FlutterwaveLiveAdapter } from "../lib/fee-providers";
import type { LiveCollectionVerifier } from "../lib/flutterwave-live-verification";

// Fixture capability is NEVER mounted in the app, stored in env or exported.
const capability={enabled:true},merchant="merchant_fixture_live",school="RS_FictionalSchool123",hash="fictional-workflow-live-verifier";
let pool:InstanceType<typeof DatabasePool>,directory:string,postgres:ChildProcess,server:ReturnType<express.Express["listen"]>,base:string;
let workflowUp:string,workflowDown:string;
const fixtures=`
CREATE TABLE schools(id integer PRIMARY KEY,name text);
CREATE TABLE students(id integer PRIMARY KEY,school_id integer,first_name text,last_name text,status text);
CREATE TABLE academic_sessions(id integer PRIMARY KEY,school_id integer,name text);
CREATE TABLE academic_terms(id integer PRIMARY KEY,school_id integer,academic_session_id integer,name text,end_date date);
CREATE TABLE app_users(id integer PRIMARY KEY,status text);
CREATE TABLE school_memberships(user_id integer,school_id integer,role text,status text);
CREATE TABLE partner_profiles(id integer PRIMARY KEY,status text);
CREATE TABLE school_partner_attributions(id integer PRIMARY KEY,school_id integer,partner_profile_id integer,
 is_current boolean,status text,starts_at timestamptz,ends_at timestamptz);
CREATE TABLE commission_rules(id integer PRIMARY KEY,status text,currency text,allocation_total numeric,school_amount numeric,
 partner_amount numeric,edupulse_amount numeric,term text,effective_at timestamptz,ends_at timestamptz);
CREATE TABLE subscriptions(id integer,status text,provider_reference text);
CREATE TABLE commission_ledger(id integer,amount numeric,status text);
INSERT INTO subscriptions VALUES(1,'active','SCV2_unchanged_history');
INSERT INTO commission_ledger VALUES(1,100,'PAID');
`;
function proof():LiveCollectionVerifier{return {enabled:true,environment:"LIVE",merchantScope:merchant,verify:vi.fn(async input=>
  normalizeLiveIndependentRead({id:Number(input.transactionId),tx_ref:input.reference,flw_ref:`FLW-${input.transactionId}`,
    status:"successful",currency:"NGN",amount:5000,charged_amount:5000,app_fee:65,merchant_fee:5},
  {environment:"LIVE",merchantScope:merchant,transactionId:input.transactionId,reference:input.reference,
    source:"TRANSACTION_BOUND",recipients:[{subaccountId:school,currency:"NGN",amountMinor:190000}]},input,merchant))};}
async function sql(query:string,values?:unknown[]){return (await pool.query(query,values)).rows;}
async function count(table:string){return Number((await sql(`SELECT count(*) n FROM ${table}`))[0].n);}
async function reserve(actorId=1,key="workflow-intent-key-0001",studentId=1){
  return issueLiveIntent(pool,{actorId,schoolId:10,studentId,termId:1,merchantScope:merchant,idempotencyKey:key},capability);
}
function raw(intent:any,status="successful",tx=123456){return Buffer.from(JSON.stringify({
  event:"charge.completed",data:{id:tx,tx_ref:intent.reference,flw_ref:`FLW-${tx}`,status,amount:5000,currency:"NGN"},
}));}
async function receive(body:Buffer){
  await persistAuthenticatedLiveWebhookReceipt(pool,body);
  return Number((await sql("SELECT id FROM flutterwave_live_webhook_receipts WHERE payload_sha256=$1",
    [createHash("sha256").update(body).digest("hex")]))[0].id);
}
async function complete(intent:any,status="successful",verifier=proof()){
  const body=raw(intent,status);return processLiveWorkflow(pool,await receive(body),body,verifier,capability);
}
async function approve(intent:any,actorId=2,key="workflow-approval-key-0001"){
  return approveLiveCommissionBatch(pool,{actorId,merchantScope:merchant,intentIds:[Number(intent.id)],idempotencyKey:key},capability);
}
beforeAll(async()=>{
  directory=await mkdtemp(path.join(tmpdir(),"educore-live-workflow-pg-"));
  const data=path.join(directory,"data"),env={PATH:process.env.PATH,LANG:"C.UTF-8",LC_ALL:"C.UTF-8"};
  execFileSync("initdb",["-D",data,"-U","live_workflow_test","-A","trust","--no-locale"],{env,stdio:"ignore"});
  postgres=spawn("postgres",["-D",data,"-k",directory,"-h","","-p","5432"],{env,stdio:"ignore"});
  pool=new DatabasePool({host:directory,port:5432,database:"postgres",user:"live_workflow_test",max:8,connectionTimeoutMillis:1000});
  let ready=false;for(let i=0;i<100;i++){try{await pool.query("SELECT 1");ready=true;break;}catch{await new Promise(r=>setTimeout(r,30));}}
  if(!ready) throw new Error("Disposable PostgreSQL unavailable; no app database fallback");
  await pool.query(fixtures);
  for(const name of ["flutterwave-live-webhook-inbox","flutterwave-live-finalization"]){
    await pool.query(await readFile(new URL(`../../../../lib/db/dev-reconciliation/${name}.up.sql`,import.meta.url),"utf8"));
  }
  workflowUp=await readFile(new URL("../../../../lib/db/dev-reconciliation/flutterwave-live-workflow.up.sql",import.meta.url),"utf8");
  workflowDown=await readFile(new URL("../../../../lib/db/dev-reconciliation/flutterwave-live-workflow.down.sql",import.meta.url),"utf8");
  await pool.query(workflowUp);
  const adapter=new FlutterwaveLiveAdapter({NODE_ENV:"production",EDUCORE_FLUTTERWAVE_MODE:"LIVE",
    EDUCORE_FLUTTERWAVE_LIVE_ENABLED:"true",EDUCORE_FLUTTERWAVE_WEBHOOK_ENVIRONMENT:"LIVE",
    FLUTTERWAVE_LIVE_SECRET_KEY:"FLWSECK-fictional-workflow-only",FLUTTERWAVE_WEBHOOK_VERIF_HASH:hash});
  // Actual isolated HTTP/kernel pipeline, NOT the mounted app route or browser auth.
  const app=express();
  app.post("/webhook",express.raw({type:"application/json"}),async(req,res)=>{
    try{adapter.authenticateWebhook(req.headers);}catch{res.status(401).json({processed:false});return;}
    try{
      const result=await processLiveWorkflow(pool,await receive(req.body),req.body,proof(),capability);
      res.status(503).json({...result,processed:false}); // No release/HTTP200 authority.
    }catch{res.status(503).json({processed:false});}
  });
  app.use(express.json());
  app.post("/intent",async(req,res)=>{
    try{res.json(await reserve(Number(req.header("x-fixture-actor")??1),req.body.key,req.body.studentId??1));}
    catch{res.status(503).json({created:false});}
  });
  await new Promise<void>(r=>{server=app.listen(0,"127.0.0.1",()=>r());});
  const address=server.address();if(!address||typeof address==="string")throw new Error("Fixture HTTP unavailable");
  base=`http://127.0.0.1:${address.port}`;
},20000);
beforeEach(async()=>{
  await pool.query(`TRUNCATE flutterwave_live_workflow_audits,flutterwave_live_commission_items,
   flutterwave_live_commission_batches,flutterwave_live_subscription_intents,flutterwave_live_authority_reviews,
   flutterwave_live_webhook_receipts,school_memberships,app_users,academic_terms,academic_sessions,
   schools,students,partner_profiles,school_partner_attributions,commission_rules RESTART IDENTITY CASCADE`);
  await pool.query(`INSERT INTO schools VALUES(10,'Original School'),(20,'Other School');
   INSERT INTO students VALUES(1,10,'Student','One','active'),(2,10,'Student','Two','active');
   INSERT INTO academic_sessions VALUES(1,10,'2026/2027');
   INSERT INTO academic_terms VALUES(1,10,1,'First Term',CURRENT_DATE-1);
   INSERT INTO app_users VALUES(1,'ACTIVE'),(2,'ACTIVE'),(3,'ACTIVE');
   INSERT INTO school_memberships VALUES(1,10,'SCHOOL_ADMIN','ACTIVE'),(2,NULL,'PLATFORM_OWNER','ACTIVE'),(3,20,'SCHOOL_ADMIN','ACTIVE');
   INSERT INTO partner_profiles VALUES(1,'ACTIVE');
   INSERT INTO school_partner_attributions VALUES(1,10,1,true,'ACTIVE',now()-interval '1 day',NULL);
   INSERT INTO commission_rules VALUES(1,'ACTIVE','NGN',5000,1900,100,3000,'First Term',now()-interval '1 day',NULL);
   INSERT INTO flutterwave_live_authority_reviews(merchant_scope,school_id,school_subaccount_id,evidence_sha256,reviewed_by,expires_at)
    VALUES('merchant_fixture_live',10,'RS_FictionalSchool123',repeat('a',64),2,now()+interval '1 day');`);
});
afterEach(async()=>{
  expect(await sql("SELECT * FROM subscriptions")).toEqual([{id:1,status:"active",provider_reference:"SCV2_unchanged_history"}]);
  expect(await sql("SELECT * FROM commission_ledger")).toEqual([{id:1,amount:"100",status:"PAID"}]);
  vi.restoreAllMocks();
});
afterAll(async()=>{
  if(server)await new Promise<void>(r=>server.close(()=>r()));await pool?.end();
  if(postgres?.exitCode===null)await new Promise<void>(r=>{postgres.once("exit",()=>r());postgres.kill("SIGTERM");});
  if(directory)await rm(directory,{recursive:true,force:true});
});

describe("coordinated LIVE workflow isolated HTTP/SQL E2E; no real provider or release",()=>{
  it("hard-disabled capability and transport cannot acquire DB or invoke any outbound reader",async()=>{
    const connect=vi.fn(),transactionGet=vi.fn(),recipientReport=vi.fn();
    await expect(issueLiveIntent({connect},{actorId:1,schoolId:10,studentId:1,termId:1,merchantScope:merchant,idempotencyKey:"disabled-intent-key-0001"}))
      .rejects.toMatchObject({code:"LIVE_WORKFLOW_RELEASE_DISABLED"});
    await expect(processLiveWorkflow({connect},1,Buffer.from("{}"),proof())).rejects.toMatchObject({code:"LIVE_WORKFLOW_RELEASE_DISABLED"});
    await expect(approveLiveCommissionBatch({connect},{actorId:2,merchantScope:merchant,intentIds:[1],idempotencyKey:"disabled-approval-key"}))
      .rejects.toMatchObject({code:"LIVE_WORKFLOW_RELEASE_DISABLED"});
    await expect(exportLiveCommissionBatch({connect},{actorId:2,merchantScope:merchant,batchId:1}))
      .rejects.toMatchObject({code:"LIVE_WORKFLOW_RELEASE_DISABLED"});
    const transport=new IsolatedLiveVerificationTransport(merchant,{transactionGet,recipientReport});
    await expect(transport.verify({reference:"SCV3_fixture_request",transactionId:"123456",currency:"NGN",amountMinor:500000,
      schoolSubaccountId:school,signal:new AbortController().signal})).rejects.toMatchObject({code:"LIVE_VERIFICATION_TRANSPORT_DISABLED"});
    expect(connect).not.toHaveBeenCalled();expect(transactionGet).not.toHaveBeenCalled();expect(recipientReport).not.toHaveBeenCalled();
  });
  it("HTTP intent → authenticated verified delivery → activation/official receipt → Owner approval/export",async()=>{
    const response=await fetch(`${base}/intent`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      key:"http-workflow-intent-key",amountMinor:1,partnerId:999,schoolSubaccountId:"RS_AttackerForbidden",environment:"SANDBOX",
    })});
    expect(response.status).toBe(200);const intent=await response.json();
    expect(intent).toMatchObject({environment:"LIVE",gross_minor:500000,school_minor:190000,merchant_gross_minor:310000,
      partner_profile_id:1,school_subaccount_id:school});
    const delivery=await fetch(`${base}/webhook`,{method:"POST",headers:{"content-type":"application/json","verif-hash":hash},body:raw(intent)});
    expect(delivery.status).toBe(503);expect(await delivery.json()).toMatchObject({outcome:"COLLECTION_VERIFIED",processed:false});
    expect((await sql("SELECT * FROM flutterwave_live_subscription_activations"))[0].status).toBe("ACTIVE");
    const receipt=(await sql("SELECT * FROM flutterwave_live_official_receipts"))[0];
    expect(receipt.snapshot).toMatchObject({environment:"LIVE",grossAmountMinor:500000,schoolName:"Original School",studentName:"Student One"});
    expect(receipt.snapshot.paidAt).toBeNull();expect(receipt.snapshot.verifiedAt).toBeTruthy();
    expect(receipt.snapshot).not.toHaveProperty("allocations");
    const batch=await approve(intent);
    const exported=await exportLiveCommissionBatch(pool,{actorId:2,merchantScope:merchant,batchId:Number(batch.id)},capability);
    expect(exported).toMatchObject({environment:"LIVE",executionMode:"EXPORT_ONLY",amountMinor:10000});
    expect(await count("flutterwave_live_workflow_audits")).toBe(2);
  });
  it("rejects wrong/TEST webhook authentication before any receipt or activation",async()=>{
    const intent=await reserve();
    for(const value of ["","fictional-test-verifier"]){
      expect((await fetch(`${base}/webhook`,{method:"POST",headers:{"content-type":"application/json","verif-hash":value},body:raw(intent)})).status).toBe(401);
    }
    expect(await count("flutterwave_live_webhook_receipts")).toBe(0);
    expect(await count("flutterwave_live_subscription_activations")).toBe(0);
  });
  it("canonical authority prevents cross-school/inactive/Owner operational issuance and missing LIVE review",async()=>{
    for(const actor of [2,3,999])await expect(reserve(actor)).rejects.toMatchObject({code:"LIVE_INTENT_AUTHORITY_DENIED"});
    await pool.query("UPDATE school_memberships SET status='INACTIVE' WHERE user_id=1");
    await expect(reserve()).rejects.toMatchObject({code:"LIVE_INTENT_AUTHORITY_DENIED"});
    await pool.query("UPDATE school_memberships SET status='ACTIVE' WHERE user_id=1");
    await pool.query("TRUNCATE flutterwave_live_authority_reviews CASCADE");
    await expect(reserve()).rejects.toMatchObject({code:"LIVE_RECIPIENT_REVIEW_MISSING"});
    expect(await count("flutterwave_live_subscription_intents")).toBe(0);
  });
  it("concurrent reservations and deliveries are idempotent through official receipt/accrual issuance",async()=>{
    const intents=await Promise.all(Array.from({length:4},()=>reserve()));
    expect(new Set(intents.map(i=>i.id)).size).toBe(1);
    await Promise.all(Array.from({length:4},()=>complete(intents[0])));
    for(const table of ["flutterwave_live_subscription_intents","flutterwave_live_collection_evidence",
      "flutterwave_live_subscription_activations","flutterwave_live_official_receipts","flutterwave_live_partner_accruals"])
      expect(await count(table)).toBe(1);
    await expect(reserve(1,"workflow-intent-key-0001",2)).rejects.toMatchObject({code:"LIVE_INTENT_KEY_CONFLICT"});
  });
  it("no-Partner issuance retains school/merchant cash and creates no Partner payable",async()=>{
    await pool.query("TRUNCATE school_partner_attributions");
    const intent=await reserve();await complete(intent);
    expect(intent.partner_profile_id).toBeNull();
    expect((await sql("SELECT * FROM flutterwave_live_collection_evidence"))[0]).toMatchObject({
      school_minor:190000,merchant_gross_minor:310000,calculated_merchant_remainder_minor:303000,calculated_owner_net_minor:303000});
    expect(await count("flutterwave_live_partner_accruals")).toBe(0);
  });
  it("eligible Partner without the effective exact rule cannot silently become a no-Partner payment",async()=>{
    await pool.query("UPDATE commission_rules SET school_amount=2000");
    await expect(reserve()).rejects.toMatchObject({code:"LIVE_PARTNER_RULE_MISSING"});
  });
  it("original-school identity and receipts survive canonical profile/school changes after issuance",async()=>{
    const intent=await reserve();
    await pool.query("UPDATE students SET school_id=20,first_name='Changed' WHERE id=1");
    await complete(intent);
    expect((await sql("SELECT school_id FROM flutterwave_live_subscription_intents"))[0].school_id).toBe(10);
    expect((await sql("SELECT snapshot FROM flutterwave_live_official_receipts"))[0].snapshot)
      .toMatchObject({schoolName:"Original School",studentName:"Student One"});
  });
  it("receipt failure rolls activation, evidence, accrual and event back and records unresolved reconciliation",async()=>{
    const intent=await reserve();
    await pool.query(`CREATE FUNCTION fixture_receipt_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Synthetic receipt failure';END $$;
      CREATE TRIGGER fixture_fail BEFORE INSERT ON flutterwave_live_official_receipts FOR EACH ROW EXECUTE FUNCTION fixture_receipt_failure()`);
    try{await expect(complete(intent)).rejects.toThrow("Synthetic receipt failure");}
    finally{await pool.query("DROP TRIGGER fixture_fail ON flutterwave_live_official_receipts;DROP FUNCTION fixture_receipt_failure()");}
    for(const table of ["flutterwave_live_collection_evidence","flutterwave_live_subscription_activations",
      "flutterwave_live_official_receipts","flutterwave_live_partner_accruals","flutterwave_live_receipt_results"])
      expect(await count(table)).toBe(0);
    expect(await count("flutterwave_live_reconciliation_cases")).toBe(1);
    await complete(intent);expect(await count("flutterwave_live_official_receipts")).toBe(1);
  });
  it("refund/reversal after export holds activation/accrual, invalidates batch and preserves original receipt",async()=>{
    const intent=await reserve();await complete(intent);const batch=await approve(intent);
    await exportLiveCommissionBatch(pool,{actorId:2,merchantScope:merchant,batchId:Number(batch.id)},capability);
    const original=(await sql("SELECT snapshot FROM flutterwave_live_official_receipts"))[0].snapshot;
    const refund=Buffer.from(JSON.stringify({TransactionId:123456,FlwRef:"FLW-123456",AmountRefunded:"100.01",status:"completed"}));
    await processLiveWorkflow(pool,await receive(refund),refund,proof(),capability);
    await complete(intent);
    expect((await sql("SELECT status FROM flutterwave_live_subscription_activations"))[0].status).toBe("HELD");
    expect((await sql("SELECT state FROM flutterwave_live_partner_accruals"))[0].state).toBe("HELD");
    expect((await sql("SELECT status FROM flutterwave_live_commission_batches"))[0].status).toBe("REVIEW_REQUIRED");
    await expect(exportLiveCommissionBatch(pool,{actorId:2,merchantScope:merchant,batchId:Number(batch.id)},capability))
      .rejects.toMatchObject({code:"LIVE_EXPORT_REVIEW_REQUIRED"});
    expect((await sql("SELECT snapshot FROM flutterwave_live_official_receipts"))[0].snapshot).toEqual(original);
    expect(await count("flutterwave_live_reconciliation_cases")).toBe(1);
  });
  it("reversal-before-success creates no activation, receipt or payable",async()=>{
    const intent=await reserve();await complete(intent,"reversed");await complete(intent);
    for(const table of ["flutterwave_live_subscription_activations","flutterwave_live_official_receipts","flutterwave_live_partner_accruals"])
      expect(await count(table)).toBe(0);
  });
  it("term-end approval checks current calendar, Owner role, key binding and existing reservations",async()=>{
    const intent=await reserve();await complete(intent);
    await expect(approve(intent,1)).rejects.toMatchObject({code:"LIVE_OWNER_APPROVAL_REQUIRED"});
    await pool.query("UPDATE academic_terms SET end_date=CURRENT_DATE+7");
    await expect(approve(intent)).rejects.toMatchObject({code:"LIVE_COMMISSION_NOT_ELIGIBLE"});
    await pool.query("UPDATE academic_terms SET end_date=CURRENT_DATE-1");
    const batches=await Promise.all([approve(intent),approve(intent)]);
    expect(batches[0].id).toBe(batches[1].id);
    await expect(approve(intent,2,"different-approval-key-0002")).rejects.toThrow();
    expect(await count("flutterwave_live_commission_batches")).toBe(1);
  });
  it("unverified mismatched currency/amount/provider/recipient cannot activate; reconciliation is durable",async()=>{
    const intent=await reserve(),body=raw(intent),id=await receive(body);
    const invalid=proof();invalid.verify=vi.fn().mockResolvedValue({environment:"SANDBOX"});
    await expect(processLiveWorkflow(pool,id,body,invalid,capability)).rejects.toMatchObject({code:"LIVE_VERIFICATION_MISMATCH"});
    expect(await count("flutterwave_live_subscription_activations")).toBe(0);
    expect(await count("flutterwave_live_reconciliation_cases")).toBe(1);
  });
  it("review-only workflow rollback refuses retained evidence",async()=>{
    const client=await pool.connect();
    try{await expect(client.query(workflowDown)).rejects.toThrow("preservation review");await client.query("ROLLBACK");}
    finally{client.release();}
  });
  it.each(["before","after"] as const)("full workflow commit loss %s COMMIT cannot duplicate activation/receipt/accrual",async when=>{
    const intent=await reserve(),body=raw(intent),id=await receive(body);let fail=true;
    const target={connect:async()=>{
      const client=await pool.connect();
      return {release:()=>client.release(),query:async(query:string,values?:unknown[])=>{
        if(query==="COMMIT"&&fail){fail=false;if(when==="after")await client.query("COMMIT");throw new Error("Fictional commit response loss");}
        return client.query(query,values);
      }};
    }};
    await expect(processLiveWorkflow(target,id,body,proof(),capability)).rejects.toThrow("commit response loss");
    expect(await count("flutterwave_live_official_receipts")).toBe(when==="after"?1:0);
    await processLiveWorkflow(pool,id,body,proof(),capability);
    for(const table of ["flutterwave_live_subscription_activations","flutterwave_live_official_receipts",
      "flutterwave_live_partner_accruals","flutterwave_live_finalization_events"])
      expect(await count(table)).toBe(1);
    expect(await count("flutterwave_live_reconciliation_cases")).toBe(1);
  });
  it("an approval key is permanently bound to its exact LIVE intent selection",async()=>{
    const first=await reserve();await complete(first);await approve(first);
    const second=await reserve(1,"second-workflow-intent-key",2),body=raw(second,"successful",123457);
    await processLiveWorkflow(pool,await receive(body),body,proof(),capability);
    await expect(approve(second)).rejects.toMatchObject({code:"LIVE_APPROVAL_KEY_CONFLICT"});
    expect(await count("flutterwave_live_commission_batches")).toBe(1);
  });
  it("failed approval audit rolls batch and item reservations back before safe retry",async()=>{
    const intent=await reserve();await complete(intent);
    await pool.query(`CREATE FUNCTION fixture_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'Synthetic approval audit failure';END $$;
      CREATE TRIGGER fixture_fail BEFORE INSERT ON flutterwave_live_workflow_audits FOR EACH ROW EXECUTE FUNCTION fixture_audit_failure()`);
    try{await expect(approve(intent)).rejects.toThrow("Synthetic approval audit failure");}
    finally{await pool.query("DROP TRIGGER fixture_fail ON flutterwave_live_workflow_audits;DROP FUNCTION fixture_audit_failure()");}
    expect(await count("flutterwave_live_commission_batches")).toBe(0);
    expect(await count("flutterwave_live_commission_items")).toBe(0);
    await approve(intent);expect(await count("flutterwave_live_commission_items")).toBe(1);
  });
  it("independent read normalizer refuses missing fees, payer mismatches and invented recipient evidence",async()=>{
    const expected={reference:"SCV3_read_fixture",transactionId:"123456",currency:"NGN" as const,
      amountMinor:500000 as const,schoolSubaccountId:school,signal:new AbortController().signal};
    const data={id:123456,tx_ref:expected.reference,flw_ref:"FLW-123456",status:"successful",
      currency:"NGN",amount:5000,charged_amount:5000,app_fee:65,merchant_fee:5};
    const report={environment:"LIVE" as const,merchantScope:merchant,transactionId:"123456",reference:expected.reference,
      source:"TRANSACTION_BOUND" as const,recipients:[{subaccountId:school,currency:"NGN",amountMinor:190000}]};
    expect(normalizeLiveIndependentRead(data,report,expected,merchant).providerFeeMinor).toBe(6500);
    for(const change of [{merchant_fee:undefined},{charged_amount:5001},{id:999},{status:"pending"},{currency:"USD"}])
      expect(()=>normalizeLiveIndependentRead({...data,...change},report,expected,merchant)).toThrow();
    expect(()=>normalizeLiveIndependentRead(data,{...report,merchantScope:"wrong_merchant"},expected,merchant)).toThrow();
    expect(()=>normalizeLiveIndependentRead(data,{...report,recipients:[]},expected,merchant)).toThrow();
  });
  it("empty workflow rollback/reapply preserves original LIVE design and SANDBOX history",async()=>{
    await pool.query("TRUNCATE flutterwave_live_authority_reviews,flutterwave_live_subscription_intents CASCADE");
    await pool.query(workflowDown);await pool.query(workflowUp);
    expect(await count("flutterwave_live_subscription_intents")).toBe(0);
    expect(await count("flutterwave_live_authority_reviews")).toBe(0);
  });
  it("LIVE entitlement checks require exact original-school scope, unexpired term and no hold",async()=>{
    await pool.query("UPDATE academic_terms SET end_date=CURRENT_DATE+7");
    const intent=await reserve();await complete(intent);
    const scope={merchantScope:merchant,schoolId:10,studentId:1,termId:1};
    expect(await hasLiveTermEntitlement(pool,scope,capability)).toBe(true);
    expect(await hasLiveTermEntitlement(pool,{...scope,schoolId:20},capability)).toBe(false);
    await expect(approve(intent)).rejects.toMatchObject({code:"LIVE_COMMISSION_NOT_ELIGIBLE"});
    await complete(intent,"reversed");
    expect(await hasLiveTermEntitlement(pool,scope,capability)).toBe(false);
  });
  it("collection/accrual evidence alone cannot approve without coordinated activation and official receipt",async()=>{
    const intent=await reserve(),body=raw(intent);
    await finalizeLiveSubscriptionDesign(pool,await receive(body),body,proof());
    expect(await count("flutterwave_live_partner_accruals")).toBe(1);
    expect(await count("flutterwave_live_official_receipts")).toBe(0);
    await expect(approve(intent)).rejects.toMatchObject({code:"LIVE_COMMISSION_NOT_ELIGIBLE"});
  });
});
