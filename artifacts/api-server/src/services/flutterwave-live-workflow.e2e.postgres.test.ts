import { execFileSync,spawn,type ChildProcess } from "node:child_process";
import { mkdtemp,readFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import express from "express";
import { DatabasePool } from "@workspace/db/driver";
import { beforeAll,beforeEach,afterAll,afterEach,describe,it,expect,vi } from "vitest";
vi.mock("@workspace/db",async original=>({...await original<typeof import("@workspace/db")>(),
  pool:{query:()=>{throw new Error("Application DB forbidden in isolated acceptance");},
    connect:()=>{throw new Error("Application DB forbidden in isolated acceptance");}}}));
vi.mock("../middlewares/auth",async original=>{
  const actual=await original<typeof import("../middlewares/auth")>();
  return {...actual,requireAuthentication:()=> (req:any,res:any,next:any)=>{
    const role=req.header("x-test-role")??"PLATFORM_OWNER";
    if(role==="ANONYMOUS"){res.status(401).json({error:"Sign-in required"});return;}
    req.edupulseUser={user:{id:Number(req.header("x-test-actor")??2),status:"ACTIVE"},
      roles:[{role,status:"ACTIVE",schoolId:null}]};next();
  }};
});
import { issueLiveIntent } from "./flutterwave-live-intents";
import { finalizeLiveSubscriptionDesign } from "./flutterwave-live-finalization-design";
import { processLiveWorkflow,hasLiveTermEntitlement } from "./flutterwave-live-lifecycle";
import { approveLiveCommissionBatch,exportLiveCommissionBatch } from "./flutterwave-live-commissions";
import { persistAuthenticatedLiveWebhookReceipt } from "./flutterwave-live-webhook-inbox";
import { IsolatedLiveVerificationTransport,normalizeLiveIndependentRead } from "../lib/flutterwave-live-verification-transport";
import { FlutterwaveLiveAdapter } from "../lib/fee-providers";
import type { LiveCollectionVerifier } from "../lib/flutterwave-live-verification";
import { createLiveReadinessRouter } from "../routes/flutterwave-live-readiness";
import { listLiveOperatorReceipts,reviewLiveReceipt } from "./flutterwave-live-operator";
import { readLiveApplicationReceipt,readLiveSchoolSubscriptionStudents } from "./flutterwave-live-application";
import { readSchoolSubscription,assertSubscriptionAccess } from "./subscription-enforcement";
import { createLiveFamilyAccessRouter } from "../routes/flutterwave-live-family-access";

// Fixture capability is NEVER mounted in the app, stored in env or exported.
const capability={enabled:true},merchant="merchant_fixture_live",school="RS_FictionalSchool123",hash="fictional-workflow-live-verifier";
let pool:InstanceType<typeof DatabasePool>,directory:string,postgres:ChildProcess,server:ReturnType<express.Express["listen"]>,base:string;
let workflowUp:string,workflowDown:string,readinessUp:string,readinessDown:string;
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
ALTER TABLE schools ADD COLUMN status text DEFAULT 'active';
ALTER TABLE academic_sessions ADD COLUMN is_current boolean DEFAULT true,ADD COLUMN status text DEFAULT 'ACTIVE';
ALTER TABLE academic_terms ADD COLUMN is_current boolean DEFAULT true,ADD COLUMN status text DEFAULT 'ACTIVE',
 ADD COLUMN start_date date DEFAULT CURRENT_DATE-14;
ALTER TABLE app_users ADD COLUMN first_name text DEFAULT 'Fixture',ADD COLUMN last_name text DEFAULT 'User';
CREATE TABLE school_subscription_manual_locks(school_id integer PRIMARY KEY,locked boolean,version integer,
 locked_at timestamptz,locked_by_user_id integer,last_unlocked_at timestamptz,last_unlocked_by_user_id integer,reason text);
CREATE TABLE nfc_cards(id integer,school_id integer,student_id integer,status text);
CREATE TABLE employee_nfc_card_bindings(nfc_card_id integer,school_id integer,status text);
CREATE TABLE platform_devices(school_id integer,status text);
CREATE TABLE parents(id integer,user_id integer,school_id integer,status text);
CREATE TABLE parent_student_relationships(parent_id integer,student_id integer,status text);
ALTER TABLE students ADD COLUMN user_id integer;
`;
function proof(scope=merchant):LiveCollectionVerifier{return {enabled:true,environment:"LIVE",merchantScope:scope,verify:vi.fn(async input=>
  normalizeLiveIndependentRead({id:Number(input.transactionId),tx_ref:input.reference,flw_ref:`FLW-${input.transactionId}`,
    status:"successful",currency:"NGN",amount:5000,charged_amount:5000,app_fee:65,merchant_fee:5},
  {environment:"LIVE",merchantScope:scope,transactionId:input.transactionId,reference:input.reference,
    source:"TRANSACTION_BOUND",recipients:[{subaccountId:school,currency:"NGN",amountMinor:190000}]},input,scope))};}
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
  readinessUp=await readFile(new URL("../../../../lib/db/dev-reconciliation/flutterwave-live-readiness.up.sql",import.meta.url),"utf8");
  readinessDown=await readFile(new URL("../../../../lib/db/dev-reconciliation/flutterwave-live-readiness.down.sql",import.meta.url),"utf8");
  await pool.query(readinessUp);
  const adapter=new FlutterwaveLiveAdapter({NODE_ENV:"production",EDUCORE_FLUTTERWAVE_MODE:"LIVE",
    EDUCORE_FLUTTERWAVE_LIVE_ENABLED:"true",EDUCORE_FLUTTERWAVE_WEBHOOK_ENVIRONMENT:"LIVE",
    FLUTTERWAVE_LIVE_SECRET_KEY:"FLWSECK-fictional-workflow-only",FLUTTERWAVE_WEBHOOK_VERIF_HASH:hash});
  // Actual isolated HTTP/kernel pipeline, NOT the mounted app route or browser auth.
  const app=express();
  app.use("/family-disabled",createLiveFamilyAccessRouter({pool,development:true}));
  app.use("/family-non-development",createLiveFamilyAccessRouter({pool,development:false,
    context:()=>({merchantScope:merchant,capability})}));
  app.use(createLiveFamilyAccessRouter({pool,development:true,context:()=>({merchantScope:merchant,capability})}));
  app.use("/disabled",createLiveReadinessRouter({pool,development:true}));
  app.use("/non-development",createLiveReadinessRouter({pool,development:false,capability}));
  app.use(createLiveReadinessRouter({pool,development:true,capability,verifier:proof()}));
  app.post("/webhook",express.raw({type:"application/json"}),async(req,res)=>{
    try{adapter.authenticateWebhook(req.headers);}catch{res.status(401).json({processed:false});return;}
    try{
      const result=await processLiveWorkflow(pool,await receive(req.body),req.body,proof(),capability);
      res.status(503).json({...result,processed:false}); // No release/HTTP200 authority.
    }catch{res.status(503).json({processed:false});}
  });
  app.use(express.json({limit:"100kb"}));
  // The review POST is mounted after JSON parsing below; GETs above need no body.
  app.use("/review-api",createLiveReadinessRouter({pool,development:true,capability,verifier:proof()}));
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
   schools,students,partner_profiles,school_partner_attributions,commission_rules,school_subscription_manual_locks RESTART IDENTITY CASCADE`);
  await pool.query(`INSERT INTO schools(id,name) VALUES(10,'Original School'),(20,'Other School');
   INSERT INTO students(id,school_id,first_name,last_name,status) VALUES(1,10,'Student','One','active'),(2,10,'Student','Two','active');
   INSERT INTO academic_sessions(id,school_id,name) VALUES(1,10,'2026/2027');
   INSERT INTO academic_terms(id,school_id,academic_session_id,name,end_date) VALUES(1,10,1,'First Term',CURRENT_DATE-1);
   INSERT INTO app_users(id,status) VALUES(1,'ACTIVE'),(2,'ACTIVE'),(3,'ACTIVE');
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
    const completed=await Promise.allSettled(Array.from({length:4},()=>complete(intents[0])));
    expect(completed.map(r=>r.status)).toEqual(["fulfilled","fulfilled","fulfilled","fulfilled"]);
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
    await pool.query(readinessDown);await pool.query(workflowDown);await pool.query(workflowUp);await pool.query(readinessUp);
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

const operator=()=>({actorId:2,merchantScope:merchant,development:true,capability});
const liveApp=()=>({merchantScope:merchant,capability});
const reviewInput=(receiptId:number,key="operator-review-key-0001")=>({
  receiptId,action:"CONFIRM_DURABILITY" as const,reason:"UNCERTAIN_COMMIT" as const,idempotencyKey:key,
});
describe("remaining readiness: real gated API/access consumers, operator recovery and additive migration review",()=>{
  it("hard-disabled application/operator paths and non-Development contexts refuse before DB acquisition",async()=>{
    const connect=vi.fn(),query=vi.fn();
    await expect(listLiveOperatorReceipts({connect},{...operator(),capability:undefined})).rejects.toMatchObject({code:"LIVE_WORKFLOW_RELEASE_DISABLED"});
    await expect(listLiveOperatorReceipts({connect},{...operator(),development:false})).rejects.toMatchObject({code:"LIVE_OPERATOR_DEVELOPMENT_ONLY"});
    await expect(readLiveApplicationReceipt({query},{intentId:1,schoolId:10,studentId:1,termId:1},
      {merchantScope:merchant,capability:{enabled:false}})).rejects.toMatchObject({code:"LIVE_WORKFLOW_RELEASE_DISABLED"});
    await expect(readSchoolSubscription({query},10,{merchantScope:merchant,capability:{enabled:false}}))
      .rejects.toMatchObject({code:"LIVE_WORKFLOW_RELEASE_DISABLED"});
    expect(connect).not.toHaveBeenCalled();expect(query).not.toHaveBeenCalled();
  });
  it("mounted Owner API preserves authentication, canonical role and hard release/Development gates",async()=>{
    for(const [role,status] of [["ANONYMOUS",401],["SCHOOL_ADMIN",403],["PARTNER",403],["PLATFORM_OWNER",503]] as const){
      const response=await fetch(`${base}/disabled/platform/live-readiness/receipts?merchantScope=${merchant}`,{headers:{"x-test-role":role}});
      expect(response.status).toBe(status);
    }
    expect((await fetch(`${base}/non-development/platform/live-readiness/receipts?merchantScope=${merchant}`)).status).toBe(503);
    expect((await fetch(`${base}/platform/live-readiness/receipts?merchantScope=${merchant}`,{headers:{"x-test-actor":"1"}})).status).toBe(403);
    expect(await count("flutterwave_live_operator_reviews")).toBe(0);
  });
  it("existing student access enforcement consumes only fully coordinated LIVE issuance for the exact current child",async()=>{
    await pool.query("UPDATE academic_terms SET end_date=CURRENT_DATE+7");
    const intent=await reserve(),scope={intentId:Number(intent.id),schoolId:10,studentId:1,termId:1};
    await expect(assertSubscriptionAccess(10,1,pool,liveApp())).rejects.toMatchObject({statusCode:403});
    await receive(raw(intent)); // Receipt-only is not payment or activation.
    expect((await readSchoolSubscription(pool,10,liveApp()))?.amountPaidMinor).toBe(0);
    await expect(readLiveApplicationReceipt(pool,scope,liveApp())).rejects.toMatchObject({code:"LIVE_OFFICIAL_RECEIPT_UNAVAILABLE"});
    await complete(intent);
    expect((await readSchoolSubscription(pool,10,liveApp()))?.amountPaidMinor).toBe(500000);
    await expect(assertSubscriptionAccess(10,1,pool,liveApp())).resolves.toBeUndefined();
    await expect(assertSubscriptionAccess(10,2,pool,liveApp())).rejects.toMatchObject({statusCode:403});
    const receipt=await readLiveApplicationReceipt(pool,scope,liveApp());
    expect(receipt).toMatchObject({activated:true,recorded:true,held:false});
    await expect(readLiveApplicationReceipt(pool,{...scope,studentId:2},liveApp())).rejects.toThrow();
    await pool.query("INSERT INTO school_subscription_manual_locks(school_id,locked,version) VALUES(10,true,1)");
    await expect(assertSubscriptionAccess(10,1,pool,liveApp())).rejects.toMatchObject({statusCode:403,eventType:"SCHOOL_SUBSCRIPTION_LOCKED"});
    await pool.query("UPDATE school_subscription_manual_locks SET locked=false");
    await complete(intent,"reversed");
    await expect(assertSubscriptionAccess(10,1,pool,liveApp())).rejects.toMatchObject({statusCode:403});
  });
  it("explicit LIVE access never falls back to shared TEST state on missing LIVE tables or ambiguous calendars",async()=>{
    await pool.query("UPDATE academic_terms SET end_date=CURRENT_DATE+7");
    const query=vi.fn(async(statement:string,values?:unknown[])=>{
      if(statement.includes("flutterwave_live_subscription_intents"))throw new Error("Synthetic missing LIVE schema");
      if(statement.includes("FROM subscriptions")||statement.includes("school_subscription_enforcement"))throw new Error("Forbidden TEST financial fallback");
      return pool.query(statement,values);
    });
    await expect(assertSubscriptionAccess(10,1,{query} as any,liveApp())).rejects.toMatchObject({statusCode:503});
    expect(query.mock.calls.some(([q])=>q.includes("FROM subscriptions")||q.includes("school_subscription_enforcement"))).toBe(false);
    await pool.query("UPDATE academic_terms SET is_current=false");
    await expect(assertSubscriptionAccess(10,1,pool,liveApp())).rejects.toMatchObject({statusCode:503});
  });
  it("raw lower-level collection without a coordinated receipt/result cannot grant student access",async()=>{
    await pool.query("UPDATE academic_terms SET end_date=CURRENT_DATE+7");
    const intent=await reserve(),body=raw(intent);
    await finalizeLiveSubscriptionDesign(pool,await receive(body),body,proof());
    const students=await readLiveSchoolSubscriptionStudents(pool,10,1,liveApp());
    expect(students.rows.find(s=>s.studentId===1)).toMatchObject({paid:false,unknown:true});
    await expect(assertSubscriptionAccess(10,1,pool,liveApp())).rejects.toMatchObject({statusCode:403});
  });
  it("pending/uncertain confirmation appends audit exactly once without inventing activation or resolving evidence",async()=>{
    const intent=await reserve(),id=await receive(raw(intent));
    const results=await Promise.all(Array.from({length:3},()=>reviewLiveReceipt(pool,operator(),reviewInput(id))));
    expect(results.filter(r=>!r.duplicate)).toHaveLength(1);
    expect(results[0].currentOutcome).toBe("EVIDENCE_REQUIRED");
    expect(await count("flutterwave_live_operator_reviews")).toBe(1);
    expect(await count("flutterwave_live_subscription_activations")).toBe(0);
    const list=await listLiveOperatorReceipts(pool,operator());
    expect(list).toMatchObject({settlementVerified:false,operationallyProcessed:false});
    expect(list.receipts[0]).not.toHaveProperty("payload_sha256");
    expect(list.receipts[0].verified_merchant_scope).toBeNull();
  });
  it("operator retries require original authenticated bytes, never inbox claims or a second outbound attempt",async()=>{
    const intent=await reserve(),body=raw(intent),id=await receive(body),input={...reviewInput(id),action:"RETRY" as const};
    await expect(reviewLiveReceipt(pool,operator(),input)).rejects.toMatchObject({code:"LIVE_ORIGINAL_BYTES_REQUIRED"});
    await expect(reviewLiveReceipt(pool,operator(),{...input,originalBody:Buffer.from(`${body} `)}))
      .rejects.toMatchObject({code:"LIVE_ORIGINAL_BYTES_MISMATCH"});
    const disabled={...proof(),enabled:false};
    const result=await reviewLiveReceipt(pool,operator(),{...input,originalBody:body},disabled);
    expect(result.currentOutcome).toBe("EVIDENCE_REQUIRED");expect(disabled.verify).not.toHaveBeenCalled();
    expect(await count("flutterwave_live_subscription_activations")).toBe(0);
  });
  it("actual review HTTP retry uses fictional independent evidence and issues correct money/receipt/accrual once",async()=>{
    await pool.query("UPDATE academic_terms SET end_date=CURRENT_DATE+7");
    const intent=await reserve(),body=raw(intent),id=await receive(body);
    const request={action:"RETRY",reason:"PENDING",idempotencyKey:"http-operator-retry-key",originalBodyBase64:body.toString("base64")};
    const url=`${base}/review-api/platform/live-readiness/receipts/${id}/reviews?merchantScope=${merchant}`;
    for(let i=0;i<2;i++){
      const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(request)});
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({duplicate:i===1,currentOutcome:"RECORDED_UNRELEASED",operationallyProcessed:false});
    }
    const financial=(await sql("SELECT * FROM flutterwave_live_collection_evidence"))[0];
    expect(financial).toMatchObject({gross_minor:500000,school_minor:190000,merchant_gross_minor:310000,partner_accrual_minor:10000});
    for(const table of ["flutterwave_live_subscription_activations","flutterwave_live_official_receipts",
      "flutterwave_live_partner_accruals","flutterwave_live_operator_reviews"])expect(await count(table)).toBe(1);
    const response=await fetch(`${base}/platform/live-readiness/receipts/${id}/official-receipt?merchantScope=${merchant}`);
    expect(response.status).toBe(200);const receipt=await response.json();
    expect(receipt).toMatchObject({activated:true,receipt:{grossAmountMinor:500000}});
    expect(receipt).not.toHaveProperty("receipt.allocations");
  });
  it("reusing an operator key for another action or receipt is refused and history cannot be rewritten",async()=>{
    const intent=await reserve(),id=await receive(raw(intent));
    await reviewLiveReceipt(pool,operator(),reviewInput(id));
    await expect(reviewLiveReceipt(pool,operator(),{...reviewInput(id),action:"REVIEW"})).rejects.toMatchObject({code:"LIVE_REVIEW_KEY_CONFLICT"});
    await expect(pool.query("UPDATE flutterwave_live_operator_reviews SET outcome='RECORDED_UNRELEASED'")).rejects.toThrow("immutable");
    await expect(pool.query("DELETE FROM flutterwave_live_operator_reviews")).rejects.toThrow("immutable");
  });
  it.each(["before","after"] as const)("operator audit response loss %s COMMIT replays without duplicate review",async when=>{
    const intent=await reserve(),id=await receive(raw(intent));let fail=true;
    const target={connect:async()=>{
      const client=await pool.connect();return{release:()=>client.release(),query:async(q:string,args?:unknown[])=>{
        if(q==="COMMIT"&&fail){fail=false;if(when==="after")await client.query(q);throw new Error("Synthetic review commit loss");}
        return client.query(q,args);
      }};
    }};
    await expect(reviewLiveReceipt(target,operator(),reviewInput(id))).rejects.toThrow("review commit loss");
    expect(await count("flutterwave_live_operator_reviews")).toBe(when==="after"?1:0);
    await reviewLiveReceipt(pool,operator(),reviewInput(id));expect(await count("flutterwave_live_operator_reviews")).toBe(1);
  });
  it.each(["REFUND","REVERSAL","DISPUTE"] as const)("%s review retains holds, invalidated batches and original receipt",async reason=>{
    const intent=await reserve();await complete(intent);const batch=await approve(intent);
    const before=(await sql("SELECT snapshot FROM flutterwave_live_official_receipts"))[0].snapshot;
    const body=reason==="REFUND"?Buffer.from(JSON.stringify({TransactionId:123456,FlwRef:"FLW-123456",AmountRefunded:100,status:"completed"}))
      :reason==="DISPUTE"?Buffer.from(JSON.stringify({event:"chargeback.initiated",data:{id:123456,tx_ref:intent.reference,flw_ref:"FLW-123456"}}))
      :raw(intent,"reversed");
    const id=await receive(body);await processLiveWorkflow(pool,id,body,proof(),capability);
    const result=await reviewLiveReceipt(pool,operator(),{...reviewInput(id),reason,action:"RETRY",originalBody:body},proof());
    expect(result.currentOutcome).toBe("HELD_RETAINED");
    expect((await sql("SELECT snapshot FROM flutterwave_live_official_receipts"))[0].snapshot).toEqual(before);
    expect((await sql("SELECT status FROM flutterwave_live_commission_batches WHERE id=$1",[batch.id]))[0].status).toBe("REVIEW_REQUIRED");
    expect((await sql("SELECT state FROM flutterwave_live_partner_accruals"))[0].state).toBe("HELD");
    expect(await count("flutterwave_live_reconciliation_cases")).toBe(1);
  });
  it("a pre-hold successful operator review replays with current HELD status, never a stale approval",async()=>{
    const intent=await reserve();await complete(intent);const id=await receive(raw(intent));
    await reviewLiveReceipt(pool,operator(),reviewInput(id));
    await complete(intent,"reversed");
    const replay=await reviewLiveReceipt(pool,operator(),reviewInput(id));
    expect(replay).toMatchObject({duplicate:true,currentOutcome:"HELD_RETAINED",review:{outcome:"RECORDED_UNRELEASED"}});
  });
  it("verified other-merchant evidence cannot be read or reviewed under this merchant scope",async()=>{
    const other="another_fixture_merchant";
    await pool.query(`INSERT INTO flutterwave_live_authority_reviews(merchant_scope,school_id,school_subaccount_id,
      evidence_sha256,reviewed_by,expires_at) VALUES($1,10,$2,repeat('b',64),2,now()+interval '1 day')`,[other,school]);
    const intent=await issueLiveIntent(pool,{actorId:1,schoolId:10,studentId:1,termId:1,merchantScope:other,
      idempotencyKey:"other-merchant-intent-key"},capability),body=raw(intent),id=await receive(body);
    await processLiveWorkflow(pool,id,body,proof(other),capability);
    expect((await listLiveOperatorReceipts(pool,operator())).receipts).toHaveLength(0);
    await expect(reviewLiveReceipt(pool,operator(),reviewInput(id))).rejects.toMatchObject({code:"LIVE_OPERATOR_RECEIPT_UNAVAILABLE"});
  });
  it("stage-4 draft validates all FKs, scope indexes and cross-tenant authority binding",async()=>{
    const constraints=await sql("SELECT conname,convalidated FROM pg_constraint WHERE conname LIKE 'live_%'");
    expect(constraints.every(c=>c.convalidated)).toBe(true);
    expect(constraints.map(c=>c.conname)).toContain("live_collection_verified_identity_fk");
    const indexes=await sql("SELECT indexname FROM pg_indexes WHERE indexname LIKE 'live_%'");
    expect(indexes.map(i=>i.indexname)).toEqual(expect.arrayContaining(["live_application_scope_idx","live_operator_receipt_idx","live_receipt_result_event_idx"]));
    await pool.query(`INSERT INTO flutterwave_live_authority_reviews(merchant_scope,school_id,school_subaccount_id,
      evidence_sha256,reviewed_by,expires_at) VALUES('other_merchant',20,'RS_OtherFictional123',repeat('b',64),2,now()+interval '1 day')`);
    await expect(pool.query(`INSERT INTO flutterwave_live_subscription_intents(merchant_scope,reference,school_id,student_id,
      session_id,term_id,term_end_date,school_subaccount_id,partner_accrual_minor,issued_by,issuer_key,authority_review_id,authority_snapshot)
      VALUES($1,'SCV3_wrong_scope_fixture',10,1,1,1,CURRENT_DATE,$2,0,1,'scope-mismatch-key-01',2,'{}')`,[merchant,school]))
      .rejects.toThrow("live_intent_review_scope_fk");
  });
  it("stage-4 rejects invented collection identities and unauthenticated event sources in SQL",async()=>{
    const intent=await reserve();
    await expect(pool.query(`INSERT INTO flutterwave_live_collection_evidence(intent_id,merchant_scope,school_subaccount_id,
      transaction_id,provider_reference,gross_minor,currency,school_minor,merchant_gross_minor,partner_accrual_minor,
      provider_fee_minor,additional_fee_minor) VALUES($1,$2,$3,'123456','FLW-123456',500000,'NGN',190000,310000,10000,0,0)`,
      [intent.id,merchant,school])).rejects.toThrow("live_collection_verified_identity_fk");
    await pool.query("UPDATE flutterwave_live_subscription_intents SET verified_transaction_id='123456' WHERE id=$1",[intent.id]);
    await expect(pool.query(`INSERT INTO flutterwave_live_finalization_events(intent_id,semantic_key,kind,transaction_id,source_payload_sha256)
      VALUES($1,repeat('c',64),'COLLECTION','123456',repeat('d',64))`,[intent.id])).rejects.toThrow("live_event_authenticated_source_fk");
  });
  it("stage-4 rollback refuses retained evidence without disturbing older financial/history tables",async()=>{
    const client=await pool.connect();
    try{await expect(client.query(readinessDown)).rejects.toThrow("preservation review");await client.query("ROLLBACK");}
    finally{client.release();}
    expect(await count("flutterwave_live_authority_reviews")).toBe(1);
  });
  it("lost durable commit, duplicate webhook retries and a later hold never acknowledge LIVE processing or erase evidence",async()=>{
    const intent=await reserve(),body=raw(intent),id=await receive(body);
    let loseCommit=true;
    const uncertain={connect:async()=>{
      const client=await pool.connect();
      return {release:()=>client.release(),query:async(q:string,args?:unknown[])=>{
        const result=await client.query(q,args);
        if(q.trim()==="COMMIT"&&loseCommit){loseCommit=false;throw new Error("Synthetic durable commit response lost");}
        return result;
      }};
    }};
    await expect(processLiveWorkflow(uncertain,id,body,proof(),capability)).rejects.toThrow("Synthetic durable commit response lost");
    const original=(await sql("SELECT snapshot FROM flutterwave_live_official_receipts"))[0].snapshot;
    for(let attempt=0;attempt<2;attempt++){
      const response=await fetch(base+"/webhook",{method:"POST",
        headers:{"content-type":"application/json","verif-hash":hash},body});
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({processed:false,operationallyProcessed:false});
    }
    const input={receiptId:id,action:"CONFIRM_DURABILITY" as const,reason:"UNCERTAIN_COMMIT" as const,
      idempotencyKey:"combined-recovery-review-0001"};
    const confirmed=await reviewLiveReceipt(pool,{actorId:2,merchantScope:merchant,development:true,capability},input);
    expect(confirmed).toMatchObject({currentOutcome:"RECORDED_UNRELEASED",operationallyProcessed:false});
    const adverse=raw(intent,"reversed");
    await processLiveWorkflow(pool,await receive(adverse),adverse,proof(),capability);
    const replay=await reviewLiveReceipt(pool,{actorId:2,merchantScope:merchant,development:true,capability},input);
    expect(replay).toMatchObject({duplicate:true,currentOutcome:"HELD_RETAINED",operationallyProcessed:false});
    expect((await sql("SELECT snapshot FROM flutterwave_live_official_receipts"))[0].snapshot).toEqual(original);
    expect(await count("flutterwave_live_collection_evidence")).toBe(1);
    expect(await count("flutterwave_live_official_receipts")).toBe(1);
    expect(await count("flutterwave_live_operator_reviews")).toBe(1);
    expect(await count("flutterwave_live_reconciliation_cases")).toBeGreaterThan(0);
    expect((await sql("SELECT state FROM flutterwave_live_partner_accruals"))[0].state).toBe("HELD");
  });
});

describe("gated LIVE family identity and public access contract",()=>{
  const path="/subscription-enforcement/live/me";
  const get=(actor=5,suffix="",prefix="")=>fetch(base+prefix+path+suffix,{headers:{"x-test-actor":String(actor)}});
  async function items(actor=5,suffix=""){
    const response=await get(actor,suffix);expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    return response.json() as Promise<any[]>;
  }
  beforeEach(async()=>{
    await sql(`TRUNCATE parents,parent_student_relationships;
      INSERT INTO app_users(id,status) VALUES(4,'ACTIVE'),(5,'ACTIVE'),(6,'ACTIVE');
      UPDATE students SET user_id=4 WHERE id=1;
      INSERT INTO parents VALUES(1,5,10,'ACTIVE'),(2,6,20,'ACTIVE');
      INSERT INTO parent_student_relationships VALUES(1,1,'ACTIVE'),(1,2,'ACTIVE');
      UPDATE academic_terms SET end_date=CURRENT_DATE+28;`);
  });
  it("does not acquire DB for disabled or non-Development LIVE endpoints",async()=>{
    const connect=vi.spyOn(pool,"connect");
    for(const prefix of ["/family-disabled","/family-non-development"]){
      const response=await get(5,"?enabled=true&environment=LIVE",prefix);
      expect(response.status).toBe(503);expect(response.headers.get("cache-control")).toContain("no-store");
    }
    expect(connect).not.toHaveBeenCalled();
  });
  it("denies anonymous, foreign child and invented/shared financial selectors",async()=>{
    expect((await fetch(base+path,{headers:{"x-test-role":"ANONYMOUS"}})).status).toBe(401);
    expect((await get(6,"?studentId=1")).status).toBe(404);
    expect((await get(5,"?studentId=99999")).status).toBe(404);
    for(const query of ["?merchantScope=forged_scope","?schoolId=10","?paymentId=1","?subscriptionId=1","?studentId=0"]){
      expect((await get(5,query)).status).toBe(400);
    }
  });
  it("matches self and canonical parent relations without leaking other children",async()=>{
    const self=await items(4);expect(self.map(i=>i.studentId)).toEqual([1]);expect(self[0].audiences).toEqual(["student"]);
    const parent=await items();expect(parent.map(i=>i.studentId)).toEqual([1,2]);expect(parent[0].audiences).toEqual(["parent"]);
    expect(await items(4,"?audience=parent")).toEqual([]);
    expect(await items(5,"?audience=student")).toEqual([]);
    expect(parent.every(i=>i.liveStatus==="UNAVAILABLE"&&!i.entitled)).toBe(true);
  });
  it("pending and authenticated receipt-only success do not grant entitlement",async()=>{
    const intent=await reserve();await receive(raw(intent));
    const row=(await items())[0];expect(row.liveStatus).toBe("PENDING");expect(row.entitled).toBe(false);
    expect(row.restricted).toBe(true);expect(row.receiptNumber).toBeNull();
  });
  it("reports failure without mislabelling a diagnostic as independent verification",async()=>{
    const intent=await reserve();await receive(raw(intent,"failed"));
    const row=(await items())[0];expect(row.liveStatus).toBe("FAILED");expect(row.entitled).toBe(false);
    expect(await count("flutterwave_live_collection_evidence")).toBe(0);
  });
  it("requires complete verified issuance; normal /me shares the exact LIVE contract",async()=>{
    const intent=await reserve();await complete(intent);
    const row=(await items())[0];expect(row.liveStatus).toBe("VERIFIED_ACTIVE");expect(row.entitled).toBe(true);
    expect(row.restricted).toBe(false);expect(row.receiptNumber).toContain("LIVE-STUDENT-");
    expect((await items())[1].entitled).toBe(false);
    const response=await fetch(base+"/subscription-enforcement/me",{headers:{"x-test-actor":"5"}});
    expect(await response.json()).toEqual(await items());
    expect(JSON.stringify(row)).not.toMatch(/merchantScope|partner|schoolMinor|payload_sha256|transactionId/);
  });
  it("preserves independent manual locks even for verified LIVE students",async()=>{
    const intent=await reserve();await complete(intent);
    await sql("INSERT INTO school_subscription_manual_locks(school_id,locked,version) VALUES(10,true,1)");
    const row=(await items())[0];expect(row.entitled).toBe(true);expect(row.restricted).toBe(true);
    expect(row.restrictionReason).toBe("SCHOOL_SUBSCRIPTION_LOCKED");
  });
  it.each(["reversed","refund","dispute"])("retains receipts and refuses entitlement after %s",async kind=>{
    const intent=await reserve();await complete(intent);
    const body=kind==="refund"?Buffer.from(JSON.stringify({
      TransactionId:123456,FlwRef:"FLW-123456",status:"completed",AmountRefunded:5000}))
      :kind==="dispute"?Buffer.from(JSON.stringify({event:"chargeback.initiated",data:{id:123456,tx_ref:intent.reference,flw_ref:"FLW-123456"}}))
      :raw(intent,"reversed");
    await processLiveWorkflow(pool,await receive(body),body,proof(),capability);
    const row=(await items())[0];expect(row.liveStatus).toBe("REFUNDED_REVERSED");expect(row.entitled).toBe(false);
    expect(row.restricted).toBe(true);expect(row.receiptNumber).toContain("LIVE-STUDENT-");
    await complete(intent);expect((await items())[0].entitled).toBe(false);
  });
  it("never uses other-merchant financial evidence",async()=>{
    await sql(`INSERT INTO flutterwave_live_authority_reviews(merchant_scope,school_id,school_subaccount_id,evidence_sha256,reviewed_by,expires_at)
      VALUES('other_merchant_live',10,$1,repeat('b',64),2,now()+interval '1 day')`,[school]);
    const intent=await issueLiveIntent(pool,{actorId:1,schoolId:10,studentId:1,termId:1,merchantScope:"other_merchant_live",idempotencyKey:"other-merchant-key-0001"},capability);
    await complete(intent,"successful",proof("other_merchant_live"));
    expect((await items())[0].liveStatus).toBe("UNAVAILABLE");
  });
  it("checks cross-school membership and relationship status separately",async()=>{
    await sql("UPDATE students SET school_id=20 WHERE id=2");
    expect((await items()).map(i=>i.studentId)).toEqual([1]);
    await sql("INSERT INTO school_memberships VALUES(5,20,'PARENT','ACTIVE')");
    expect((await items()).map(i=>i.studentId)).toEqual([1,2]);
    await sql("UPDATE parent_student_relationships SET status='INACTIVE' WHERE student_id=2");
    expect((await items()).map(i=>i.studentId)).toEqual([1]);
    await sql("UPDATE parents SET status='INACTIVE' WHERE user_id=5");
    expect(await items()).toEqual([]);
  });
  it("does not move original-school verified history when a student transfers",async()=>{
    const intent=await reserve();await complete(intent);
    await sql(`UPDATE students SET school_id=20 WHERE id=1;
      INSERT INTO school_memberships VALUES(5,20,'PARENT','ACTIVE');
      INSERT INTO academic_sessions(id,school_id,name) VALUES(2,20,'2026/2027');
      INSERT INTO academic_terms(id,school_id,academic_session_id,name,end_date) VALUES(2,20,2,'First Term',CURRENT_DATE+28)`);
    const row=(await items())[0];expect(row.schoolId).toBe(20);expect(row.liveStatus).toBe("UNAVAILABLE");
    expect(row.entitled).toBe(false);expect(row.receiptNumber).toBeNull();
    expect((await sql("SELECT school_id FROM flutterwave_live_subscription_intents"))[0].school_id).toBe(10);
    expect(await count("flutterwave_live_official_receipts")).toBe(1);
  });
  it("fails closed for missing, ambiguous or mismatched current calendars",async()=>{
    const intent=await reserve();await complete(intent);
    await sql("UPDATE academic_terms SET is_current=false");
    expect((await items())[0].liveStatus).toBe("UNAVAILABLE");
    await sql(`UPDATE academic_terms SET is_current=true;
      INSERT INTO academic_terms(id,school_id,academic_session_id,name,end_date) VALUES(2,10,1,'Duplicate current',CURRENT_DATE+28)`);
    expect((await items())[0].liveStatus).toBe("UNAVAILABLE");
    await sql(`DELETE FROM academic_terms WHERE id=2;
      INSERT INTO academic_sessions(id,school_id,name) VALUES(2,10,'Other session');
      UPDATE academic_terms SET academic_session_id=2`);
    expect((await items())[0].entitled).toBe(false);
  });
  it("does not grant collection-only, incomplete or duplicate LIVE issuance",async()=>{
    const intent=await reserve(),body=raw(intent);
    await finalizeLiveSubscriptionDesign(pool,await receive(body),body,proof());
    expect((await items())[0].liveStatus).toBe("UNAVAILABLE");
    await complete(intent);
    expect((await items())[0].entitled).toBe(true);
    // Corrupt duplicate term binding in disposable fixture only: detect ambiguity
    // even if different session IDs evade the per-session database uniqueness.
    await sql(`INSERT INTO flutterwave_live_subscription_intents(merchant_scope,reference,school_id,student_id,session_id,term_id,term_end_date,
      school_subaccount_id,partner_accrual_minor) VALUES($1,'SCV3_duplicate_fixture_123',10,1,999,1,CURRENT_DATE+28,$2,0)`,[merchant,school]);
    expect((await items())[0].liveStatus).toBe("UNAVAILABLE");
    expect((await readLiveSchoolSubscriptionStudents(pool,10,1,{merchantScope:merchant,capability})).rows[0].paid).toBe(false);
  });
  it("does not extend frozen expired activations after calendar edits",async()=>{
    await sql("UPDATE academic_terms SET end_date=CURRENT_DATE-1");
    const intent=await reserve();await complete(intent);
    await sql("UPDATE academic_terms SET end_date=CURRENT_DATE+28");
    const row=(await items())[0];expect(row.liveStatus).toBe("UNAVAILABLE");expect(row.entitled).toBe(false);
  });
  it("requires complete matching receipt snapshots, not just a receipt row",async()=>{
    const intent=await reserve();await complete(intent);
    // Deliberate corruption in disposable fixtures only, not an application repair.
    await sql(`TRUNCATE flutterwave_live_official_receipts;
      INSERT INTO flutterwave_live_official_receipts(intent_id,receipt_number,snapshot)
      VALUES(${Number(intent.id)},'LIVE-STUDENT-incomplete-fixture','{}')`);
    const row=(await items())[0];expect(row.liveStatus).toBe("UNAVAILABLE");expect(row.entitled).toBe(false);
    expect((await readLiveSchoolSubscriptionStudents(pool,10,1,{merchantScope:merchant,capability})).rows[0].paid).toBe(false);
  });
  it("returns unavailable on missing LIVE schema without using retained TEST history",async()=>{
    await sql("ALTER TABLE flutterwave_live_subscription_intents RENAME TO fixture_missing_live_intents");
    try{const rows=await items();expect(rows.every(i=>i.liveStatus==="UNAVAILABLE"&&!i.entitled)).toBe(true);}
    finally{await sql("ALTER TABLE fixture_missing_live_intents RENAME TO flutterwave_live_subscription_intents");}
  });
  it("does not trust stale authentication context after canonical deactivation",async()=>{
    const intent=await reserve();await complete(intent);await sql("UPDATE app_users SET status='INACTIVE' WHERE id=5");
    expect(await items()).toEqual([]);expect((await get(5,"?studentId=1")).status).toBe(404);
  });
});
