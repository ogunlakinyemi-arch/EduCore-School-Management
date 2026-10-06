/**
 * Opt-in real PostgreSQL acceptance. Supply a schema-only Development dump.
 * All writes go to a newly created disposable cluster, never the app database.
 */
import {afterAll,beforeAll,expect,it,vi} from "vitest";
import express from "express";
import {mkdtempSync,readFileSync,rmSync} from "node:fs";
import {execFileSync,spawn,type ChildProcess} from "node:child_process";
import {createServer} from "node:net";
import {tmpdir,userInfo} from "node:os";
import {join} from "node:path";
const state=vi.hoisted(()=>({db:null as any,actor:null as any,refs:0,providerCalls:[] as any[],mode:"succeeded",fee:1000 as number|null,onCheckoutLocked:null as null|(()=>void)}));
vi.mock("@workspace/db",()=>({pool:{
  query:(...args:any[])=>state.db.query(...args).catch((error:any)=>{console.error("Native SQL:",error.message,String(args[0]).slice(0,200));throw error;}),
  connect:async()=>{const client=await state.db.connect();return{release:()=>client.release(),query:(...args:any[])=>client.query(...args).then((result:any)=>{if(String(args[0]).includes("OF sub,st"))state.onCheckoutLocked?.();return result;}).catch((error:any)=>{console.error("Native SQL:",error.message,String(args[0]).slice(0,200));throw error;})};},
}}));
vi.mock("../middlewares/auth",async original=>{
  const actual=await original<typeof import("../middlewares/auth")>();
  return {...actual,requireAuthentication:()=> (req:any,_res:any,next:any)=>{req.edupulseUser=state.actor;next();}};
});
vi.mock("../lib/fee-providers/factory",async original=>{
  const actual=await original<typeof import("../lib/fee-providers/factory")>();
  return {...actual,configuredTestAdapter:()=>({
    provider:"flutterwave",generateReference:()=>`FLW-NFC-FIXTURE-${++state.refs}`,
    initializePayment:async(input:any)=>{state.providerCalls.push(input);return{reference:input.reference,checkoutUrl:"https://checkout.flutterwave.com/pay/nfc-fixture"};},
    verifyPayment:async(input:any)=>({...input,status:state.mode,providerTransactionId:input.providerTransactionId??String(90000+state.refs),paidAt:new Date().toISOString(),
      ...(state.fee==null?{}:{providerFeeMinor:state.fee,providerSettlementAmountMinor:500000-state.fee}),raw:{fixture:true}}),
  })};
});
import finance from "./finance";
import obligations from "./student-nfc-obligations";
import subscriptions from "./edupulse";
import {finalizeVerifiedStudentSubscriptionPayment} from "../lib/student-subscription-billing";
import {ensureStudentNfcSubscription} from "../lib/student-nfc-obligations";
import {selectedFeeAmount} from "../services/fee-line-balances";
import {AuthError} from "../middlewares/auth";

let directory:string,postgres:ChildProcess,server:ReturnType<ReturnType<typeof express>["listen"]>,base:string;
const q=(sql:string,values?:any[])=>state.db.query(sql,values);
const snapshot=process.env.EDUCORE_NFC_SCHEMA_SNAPSHOT;
const actor=(user:number,role:string,school:number|null=1)=>({
  user:{id:user,clerkUserId:`nfc-native-${user}`,email:`nfc-native-${user}@example.com`,firstName:"NFC",lastName:"Fixture",phone:null,status:"ACTIVE"},
  roles:[{id:user,role,schoolId:school,status:"ACTIVE"}],
});
const call=async(path:string,body?:unknown,headers:Record<string,string>={})=>{
  const response=await fetch(`${base}/api${path}`,{method:body===undefined?"GET":"POST",headers:{"Content-Type":"application/json",...headers},
    body:body===undefined?undefined:JSON.stringify(body)});
  return{status:response.status,body:await response.json() as any};
};
beforeAll(async()=>{
  if(!snapshot)return;
  directory=mkdtempSync(join(tmpdir(),"nfc-obligations-pg-"));
  execFileSync("initdb",["-D",directory,"-A","trust","--no-locale"],{stdio:"ignore"});
  const socket=createServer();await new Promise<void>(r=>socket.listen(0,"127.0.0.1",()=>r()));
  const port=(socket.address() as {port:number}).port;await new Promise<void>(r=>socket.close(()=>r()));
  postgres=spawn("postgres",["-D",directory,"-p",String(port),"-h","127.0.0.1","-k",directory],{stdio:"ignore"});
  const {default:pg}=await import(new URL("../../../../lib/db/node_modules/pg/lib/index.js",import.meta.url).href);
  state.db=new pg.Pool({host:"127.0.0.1",port,user:userInfo().username,database:"postgres"});
  for(let n=0;;n++){try{await q("SELECT 1");break;}catch(error){if(n>100)throw error;await new Promise(r=>setTimeout(r,50));}}
  const ddl=readFileSync(snapshot,"utf8").replace(/^\\(?:un)?restrict .*$/gm,"");
  await q(ddl);
  // pg_dump deliberately leaves the restoring connection's search path empty.
  await q("SET search_path TO public");
  vi.stubEnv("NODE_ENV","development");
  await q(readFileSync(new URL("../../../../lib/db/drizzle/0058_student_subscription_terms.sql",import.meta.url),"utf8"));
  await q("SET search_path TO public");
  await q(`
    INSERT INTO app_users(id,clerk_user_id,email) SELECT n,'nfc-native-'||n,'nfc-native-'||n||'@example.com' FROM generate_series(1,8)n;
    INSERT INTO schools(id,code,name,city,state,status) VALUES
      (1,'NFC_NATIVE_A','NFC Native A','Test','Test','active'),(2,'NFC_NATIVE_B','NFC Native B','Test','Test','active');
    INSERT INTO academic_sessions(id,school_id,name,start_date,end_date,status,is_current) VALUES
      (1,1,'2026/2027',CURRENT_DATE-20,CURRENT_DATE+300,'ACTIVE',true),(2,2,'2026/2027',CURRENT_DATE-20,CURRENT_DATE+300,'ACTIVE',true);
    INSERT INTO academic_terms(id,school_id,academic_session_id,name,start_date,end_date,status,is_current) VALUES
      (1,1,1,'First Term',CURRENT_DATE-10,CURRENT_DATE+70,'ACTIVE',true),(2,2,2,'First Term',CURRENT_DATE-10,CURRENT_DATE+70,'ACTIVE',true);
    INSERT INTO school_classes(id,school_id,name,section) VALUES(1,1,'SS2','A'),(2,2,'SS2','A');
    INSERT INTO school_memberships(user_id,school_id,role) VALUES(1,NULL,'PLATFORM_OWNER'),(2,1,'SCHOOL_ADMIN'),
      (3,1,'PARENT'),(4,1,'STUDENT'),(5,1,'TEACHER'),(6,2,'SCHOOL_ADMIN'),(7,2,'STUDENT');
    INSERT INTO students(id,school_id,admission_no,first_name,last_name,gender,class_name,section,user_id,status) VALUES
      (1,1,'NFC1','Own','Student','Male','SS2','A',4,'active'),
      (2,1,'NFC2','Legacy','Student','Male','SS2','A',NULL,'active'),
      (3,1,'NFC3','Inactive','Student','Male','SS2','A',NULL,'inactive'),
      (4,1,'NFC4','Waived','Student','Male','SS2','A',NULL,'active'),
      (5,1,'NFC5','Other','Class','Male','SS1','B',NULL,'active'),
      (6,1,'NFC6','Second','Child','Male','SS2','A',NULL,'active'),
      (7,2,'NFC7','Other','School','Male','SS2','A',7,'active');
    INSERT INTO parents(id,school_id,user_id,name,email,phone) VALUES(1,1,3,'NFC Native Parent','nfc-native-3@example.com','08000000000');
    INSERT INTO parent_student_relationships(parent_id,student_id,relationship_type,status) VALUES(1,1,'Guardian','ACTIVE'),(1,6,'Guardian','ACTIVE');
    INSERT INTO employees(id,school_id,user_id,employee_no,first_name,last_name) VALUES(1,1,5,'NFCT','NFC','Teacher');
    INSERT INTO teacher_class_assignments(school_id,employee_id,academic_session_id,school_class_id,section,start_date,status,assignment_type)
      VALUES(1,1,1,1,'A',CURRENT_DATE-20,'ACTIVE','CLASS_TEACHER');
    INSERT INTO subscriptions(id,school_id,student_id,term,status,verification_status,expires_at)
      SELECT 100,1,4,'First Term','waived','verified',(end_date+1)::timestamptz FROM academic_terms WHERE id=1;
    SELECT setval('subscriptions_id_seq',100);
    INSERT INTO fee_categories(id,school_id,name,created_by) VALUES(1,1,'Tuition',2),(2,1,'NfC ID Card subscription',2),(3,2,'Tuition',6);
    INSERT INTO fee_structures(id,school_id,academic_session_id,academic_term_id,school_class_id,section,version,status,created_by)
      VALUES(100,1,1,1,1,'A',1,'PUBLISHED',2);
    SELECT setval('fee_structures_id_seq',100);
    INSERT INTO fee_invoices(id,school_id,student_id,structure_id,academic_session_id,academic_term_id,invoice_number,
      student_name_snapshot,admission_no_snapshot,class_name_snapshot,section_snapshot,issue_date,due_date,
      subtotal_minor,total_minor,paid_minor,outstanding_minor,status,created_by)
      VALUES(100,1,2,100,1,1,'NFC-LEGACY-PAID','Legacy Student','NFC2','SS2','A',CURRENT_DATE,CURRENT_DATE,
        1300000,1300000,1300000,0,'PAID',2);
    INSERT INTO fee_invoice_lines(school_id,invoice_id,category_id,category_name_snapshot,description_snapshot,amount_minor)
      VALUES(1,100,1,'Tuition','Tuition',800000),(1,100,2,'NfC ID Card subscription','NfC ID Card subscription',500000);
    SELECT setval('fee_invoices_id_seq',100);
  `);
  const app=express();app.use(express.json());app.use("/api",finance,subscriptions,obligations);
  app.use((error:any,_req:any,res:any,_next:any)=>res.status(error instanceof AuthError?error.statusCode:500).json({error:error.message}));
  server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",()=>r()));
  base=`http://127.0.0.1:${(server.address() as any).port}`;
},40000);
afterAll(async()=>{
  if(server)await new Promise<void>(r=>{server.close(()=>r());server.closeAllConnections();});
  await state.db?.end();
  if(postgres && postgres.exitCode===null){const stopped=new Promise<void>(r=>postgres.once("exit",()=>r()));postgres.kill("SIGTERM");await stopped;}
  if(directory)rmSync(directory,{recursive:true,force:true});
  vi.unstubAllEnvs();
},15000);

it.skipIf(!snapshot)("executes automatic attachment, scoped views, canonical uniqueness, verified payment/allocation/replay and history preservation",async()=>{
  const history=await q("SELECT md5(row_to_json(i)::text) AS hash FROM fee_invoices i WHERE id=100");
  const waiver=await q("SELECT md5(row_to_json(s)::text) AS hash FROM subscriptions s WHERE id=100");
  state.actor=actor(2,"SCHOOL_ADMIN");
  const structure=await call("/school/finance/structures?schoolId=1",{sessionId:1,termId:1,classId:1,section:"A",lines:[{categoryId:1,amountMinor:800000}]});
  expect(structure.status,JSON.stringify(structure.body)).toBe(201);
  const ledger=await call("/student-nfc/obligations?schoolId=1");
  expect(ledger.status,JSON.stringify(ledger.body)).toBe(200);
  expect(ledger.body.rows.map((r:any)=>r.studentId).sort()).toEqual([1,2,4,6]);
  const first=ledger.body.rows.find((r:any)=>r.studentId===1);
  expect(first).toMatchObject({amountMinor:500000,ordinaryFeesMinor:800000,totalMinor:1300000,status:"UNPAID",canPay:true});
  expect(ledger.body.rows.find((r:any)=>r.studentId===2)).toMatchObject({status:"LEGACY_REVIEW",amountMinor:0,canPay:false});
  expect(ledger.body.rows.find((r:any)=>r.studentId===4)).toMatchObject({status:"EXEMPT",amountMinor:0,canPay:false});
  expect((await call("/subscriptions?schoolId=1",{studentId:1,term:"First Term"})).status).toBe(403);
  expect((await call("/school/finance/categories?schoolId=1",{name:"NFC Card Subscription",description:"tamper",amountMinor:1})).status).toBeGreaterThanOrEqual(400);
  const secondCreate=await call("/school/finance/structures?schoolId=1",{sessionId:1,termId:1,classId:1,section:"A",lines:[{categoryId:1,amountMinor:800000}]});
  expect(secondCreate.status).toBe(201);
  await q("UPDATE students SET section='B' WHERE id=1");
  for(let n=0;n<2;n++){const c=await state.db.connect();try{await c.query("BEGIN");await ensureStudentNfcSubscription(c,1,1,1,1);await c.query("COMMIT");}finally{c.release();}}
  expect(Number((await q("SELECT count(*) FROM subscriptions WHERE student_id=1")).rows[0].count)).toBe(1);
  await q("UPDATE students SET section='A' WHERE id=1");
  await expect(q("INSERT INTO student_subscription_terms SELECT * FROM student_subscription_terms WHERE student_id=1")).rejects.toThrow();
  await expect(q("INSERT INTO student_subscription_terms(school_id,student_id,academic_session_id,academic_term_id,subscription_id) VALUES(1,7,1,1,$1)",[first.subscriptionId])).rejects.toThrow();
  const peer=await call("/student-nfc/obligations?schoolId=2");expect(peer.body.rows).toEqual([]);
  state.actor=actor(3,"PARENT");
  expect((await call("/student-nfc/obligations")).body.rows.map((r:any)=>r.studentId).sort()).toEqual([1,6]);
  expect((await call("/student-nfc/obligations?studentId=2")).body.rows).toEqual([]);
  const denied=await call(`/subscriptions/100/checkout`,{},{"Idempotency-Key":"nfc-no-other-child"});expect(denied.status).toBe(404);
  state.actor=actor(4,"STUDENT");expect((await call("/student-nfc/obligations")).body.rows.map((r:any)=>r.studentId)).toEqual([1]);
  state.actor=actor(3,"PARENT");
  expect((await call(`/subscriptions/${first.subscriptionId}/checkout`,{amount:1,provider:"PAYSTACK",schoolAccount:"tamper"},{"Idempotency-Key":"nfc-tamper-0001"})).status).toBe(400);
  const pending=await call(`/subscriptions/${first.subscriptionId}/checkout`,{},{"Idempotency-Key":"nfc-checkout-0001"});
  expect(pending.status,JSON.stringify(pending.body)).toBe(201);
  expect(pending.body.payment).toMatchObject({provider:"FLUTTERWAVE",providerMode:"SANDBOX",grossAmountMinor:500000,status:"PENDING"});
  expect(state.providerCalls).toHaveLength(1);
  const retry=await call(`/subscriptions/${first.subscriptionId}/checkout`,{},{"Idempotency-Key":"nfc-checkout-0001"});
  expect(retry.body.payment.paymentId).toBe(pending.body.payment.paymentId);expect(state.providerCalls).toHaveLength(1);
  const payment=pending.body.payment;
  const verified={reference:payment.reference,amountMinor:500000,currency:"NGN",status:"succeeded",providerTransactionId:"90001",
    providerFeeMinor:1000,providerSettlementAmountMinor:499000,paidAt:new Date().toISOString(),raw:{fixture:true}} as any;
  await Promise.all([finalizeVerifiedStudentSubscriptionPayment(state.db,payment.paymentId,verified),finalizeVerifiedStudentSubscriptionPayment(state.db,payment.paymentId,verified)]);
  await finalizeVerifiedStudentSubscriptionPayment(state.db,payment.paymentId,verified);
  const paid=await call("/student-nfc/obligations?studentId=1");
  expect(paid.body.rows[0]).toMatchObject({status:"PAID",schoolAllocatedMinor:200000,platformAllocatedMinor:300000,canPay:false});
  const money=await q("SELECT recipient_type,entry_type,amount_minor FROM student_subscription_allocations WHERE payment_id=$1 ORDER BY recipient_type",[payment.paymentId]);
  expect(money.rows.filter((r:any)=>r.entry_type==="CREDIT")).toHaveLength(2);
  expect(money.rows.find((r:any)=>r.recipient_type==="SCHOOL").amount_minor).toBe(200000);
  expect(money.rows.find((r:any)=>r.recipient_type==="PLATFORM").amount_minor).toBe(300000);
  expect((await q("SELECT receipt_snapshot FROM student_subscription_payments WHERE id=$1",[payment.paymentId])).rows[0].receipt_snapshot).toBeTruthy();
  state.actor=actor(2,"SCHOOL_ADMIN");expect((await call("/student-nfc/obligations")).body.summary.paid).toBe(1);
  state.actor=actor(5,"TEACHER");const teacher=await call("/student-nfc/obligations");
  expect(teacher.body.summary.schoolAllocatedMinor).toBe(200000);expect(teacher.body.rows.every((r:any)=>r.ordinaryFeesMinor===0 && !r.canPay)).toBe(true);
  state.actor=actor(6,"SCHOOL_ADMIN",2);
  const b=await call("/school/finance/structures?schoolId=2",{sessionId:2,termId:2,classId:2,section:"A",lines:[{categoryId:3,amountMinor:800000}]});
  expect(b.status,JSON.stringify(b.body)).toBe(201);
  state.actor=actor(1,"PLATFORM_OWNER",null);const owner=await call("/student-nfc/obligations");
  expect(new Set(owner.body.rows.map((r:any)=>r.schoolId))).toEqual(new Set([1,2]));
  expect(owner.body.summary.platformAllocatedMinor).toBe(300000);expect(owner.body.rows.every((r:any)=>!r.canPay)).toBe(true);
  state.actor=actor(3,"PARENT");const second=owner.body.rows.find((r:any)=>r.studentId===6);state.mode="failed";
  const failed=await call(`/subscriptions/${second.subscriptionId}/checkout`,{},{"Idempotency-Key":"nfc-failed-0001"});
  expect(failed.status).toBe(201);
  const failure=await call(`/subscriptions/${second.subscriptionId}/verify`,{paymentReference:failed.body.payment.reference,providerTransactionId:"90002"});
  expect(failure.status,JSON.stringify(failure.body)).toBe(200);
  expect((await call("/student-nfc/obligations?studentId=6")).body.rows[0].status).toBe("FAILED");
  expect(Number((await q("SELECT count(*) FROM student_subscription_allocations WHERE subscription_id=$1",[second.subscriptionId])).rows[0].count)).toBe(0);
  // Existing Partner rules reduce only the platform bucket, never the school share.
  await q(`INSERT INTO partner_profiles(id,partner_code,full_name,email,status) VALUES(11,'NFC_NATIVE_PARTNER','NFC Native Partner','nfc-partner@example.com','ACTIVE');
    INSERT INTO school_partner_attributions(school_id,partner_profile_id,status,is_current,starts_at) VALUES(1,11,'ACTIVE',true,NOW()-interval '1 day');
    INSERT INTO commission_rules(id,name,allocation_total,school_amount,partner_amount,edupulse_amount,currency,status,effective_at)
      VALUES(11,'NFC Native Rule',5000,2000,100,2900,'NGN','ACTIVE',NOW()-interval '1 day')`);
  state.mode="succeeded";state.fee=null;
  const partnerRetry=await call(`/subscriptions/${second.subscriptionId}/checkout`,{},{"Idempotency-Key":"nfc-partner-retry-0001"});
  expect(partnerRetry.status,JSON.stringify(partnerRetry.body)).toBe(201);
  const partnerVerified=await call(`/subscriptions/${second.subscriptionId}/verify`,{paymentReference:partnerRetry.body.payment.reference,providerTransactionId:"90003"});
  expect(partnerVerified.status,JSON.stringify(partnerVerified.body)).toBe(200);
  await finalizeVerifiedStudentSubscriptionPayment(state.db,partnerRetry.body.payment.paymentId,{
    reference:partnerRetry.body.payment.reference,amountMinor:500000,currency:"NGN",status:"succeeded",providerTransactionId:"90003",
  });
  state.actor=actor(1,"PLATFORM_OWNER",null);
  const partnerRow=(await call("/student-nfc/obligations?studentId=6")).body.rows[0];
  expect(partnerRow).toMatchObject({status:"PAID",schoolAllocatedMinor:200000,platformAllocatedMinor:290000,partnerAllocatedMinor:10000});
  expect(Number((await q("SELECT count(*) FROM commission_ledger WHERE subscription_id=$1",[second.subscriptionId])).rows[0].count)).toBe(1);
  expect(Number((await q("SELECT count(*) FROM nfc_cards")).rows[0].count)).toBe(0);
  await Promise.all([1,2,3].map(async()=>{
    const c=await state.db.connect();
    try{await c.query("BEGIN");await ensureStudentNfcSubscription(c,1,5,1,1);await c.query("COMMIT");}finally{c.release();}
  }));
  expect(Number((await q("SELECT count(*) FROM subscriptions WHERE school_id=1 AND student_id=5")).rows[0].count)).toBe(1);
  // FK KEY SHARE must remain compatible with checkout while attachment owns the advisory lock.
  await q(`INSERT INTO students(id,school_id,admission_no,first_name,last_name,gender,class_name,section,status)
      VALUES(8,1,'NFC8','Concurrent','Legacy','Male','SS2','B','active');
    INSERT INTO subscriptions(id,school_id,student_id,term,provider,expires_at)
      SELECT 200,1,8,'First Term','FLUTTERWAVE',(end_date+1)::timestamptz FROM academic_terms WHERE id=1`);
  state.actor=actor(2,"SCHOOL_ADMIN");
  let reached!:()=>void,release!:()=>void;
  const advisoryOwned=new Promise<void>(resolve=>{reached=resolve;});
  const checkoutLocked=new Promise<void>(resolve=>{release=resolve;});
  state.onCheckoutLocked=release;
  const attachment=await state.db.connect();
  const attached=(async()=>{
    try{
      await attachment.query("BEGIN");
      await ensureStudentNfcSubscription({query:async(sql:string,values?:any[])=>{
        if(sql.startsWith("SELECT s.id,s.status")){reached();await checkoutLocked;}
        return attachment.query(sql,values);
      }},1,8,1,1);
      await attachment.query("COMMIT");
    }catch(error){await attachment.query("ROLLBACK");throw error;}finally{attachment.release();}
  })();
  await advisoryOwned;
  const checkout=call("/subscriptions/200/checkout",{},{"Idempotency-Key":"nfc-attachment-race-0001"});
  const [,concurrentCheckout]=await Promise.all([attached,checkout]);
  state.onCheckoutLocked=null;
  expect(concurrentCheckout.status,JSON.stringify(concurrentCheckout.body)).toBe(201);
  expect(Number((await q("SELECT count(*) FROM student_subscription_terms WHERE student_id=8")).rows[0].count)).toBe(1);
  expect((await q("SELECT md5(row_to_json(i)::text) AS hash FROM fee_invoices i WHERE id=100")).rows).toEqual(history.rows);
  expect((await q("SELECT md5(row_to_json(s)::text) AS hash FROM subscriptions s WHERE id=100")).rows).toEqual(waiver.rows);
  const ordinary={id:100,school_id:1};
  const stub={query:async()=>({rows:[]})};
  expect(await selectedFeeAmount(stub,ordinary,undefined)).toBeNull();
},60000);
