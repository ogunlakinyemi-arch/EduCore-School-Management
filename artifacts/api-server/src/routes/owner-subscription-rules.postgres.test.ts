import assert from "node:assert/strict";
import { readFileSync,realpathSync,statSync } from "node:fs";
import { join } from "node:path";
import express from "express";
import { Pool } from "pg";
import { afterAll,beforeAll,beforeEach,describe,expect,it,vi } from "vitest";
const state=vi.hoisted(()=>({db:null as any,connections:0,queries:0}));
vi.mock("@workspace/db",()=>({pool:{
  query:async(sql:string,values?:any[])=>{state.queries++;return state.db.query(sql,values);},
  connect:async()=>{state.connections++;return state.db.connect();},
}}));
vi.mock("../middlewares/auth",async original=>{
  const actual=await original<typeof import("../middlewares/auth")>();
  return{...actual,requireAuthentication:()=>(
    req:express.Request,_res:express.Response,next:express.NextFunction)=>{
      const role=req.header("x-role")??"PLATFORM_OWNER";
      (req as any).edupulseUser={user:{id:9,clerkUserId:"owner-rules-fixture",
        email:"fictional-owner@example.test",firstName:"Fictional",lastName:"Owner",status:req.header("x-user-status")??"ACTIVE"},
        roles:[{id:1,role,schoolId:req.header("x-school")?1:role==="PLATFORM_OWNER"?null:1,
          status:req.header("x-role-status")??"ACTIVE"}]};
      next();
    },
  };
});
import router from "./owner-subscription-rules";
import studentAccessRouter from "./student-platform-access";
import nfcFeeOversightRouter from "./nfc-fee-collection-oversight";
import { readStudentTermPlatformAccess,readStudentPlatformAccess } from "../services/student-platform-access";
import { enforceRequestSubscription } from "../services/subscription-request-access";
import { assertSubscriptionAccess } from "../services/subscription-enforcement";
import {readNfcFeeCollectionOversight} from "../services/nfc-fee-collection-oversight";
import {directStudentReadiness,startDirectStudentPayment,verifyDirectStudentPayment,DirectPaymentBlocked} from "../services/direct-student-live-payments";
import directStudentPaymentsRouter from "./direct-student-live-payments";
const suite=process.env.EDUCORE_OWNER_RULES_ROOT?describe:describe.skip;
suite("Owner-only subscription rule management on isolated PostgreSQL",()=>{
  let db:Pool,server:ReturnType<typeof app.listen>,base="";
  const app=express();app.use(express.json());app.use(router);app.use(studentAccessRouter);app.use(nfcFeeOversightRouter);app.use(directStudentPaymentsRouter);
  const path="/platform/subscription-payment-rules",queue="/platform/subscription-payment-assistance";
  const request=(url:string,method="GET",body?:unknown,headers:Record<string,string>={})=>
    fetch(base+url,{method,headers:{"content-type":"application/json",...headers},
      body:body===undefined?undefined:JSON.stringify(body)});
  const draft=(product="TEACHER_STAFF_PLATFORM",time=Date.now()+86400_000)=>({
    product,amountMinor:product==="STUDENT_PLATFORM"?320000:200000,
    currency:"NGN",billingPeriod:"ACADEMIC_TERM",schoolShareMinor:0,
    effectiveAt:new Date(time).toISOString(),endsAt:null,reason:"Reviewed fictional billing change",
  });
  const insert=async(d=draft())=>{
    const r=await request(path,"POST",d);expect(r.status).toBe(201);
    return await r.json() as any;
  };
  beforeAll(async()=>{
    const root=process.env.EDUCORE_OWNER_RULES_ROOT!;
    assert.equal(process.env.NODE_ENV,"test");
    assert.deepEqual(Object.keys(process.env).filter(k=>/^(?:PG|DATABASE|FLUTTERWAVE|REPLIT_)|SECRET|TOKEN|PASSWORD|API_KEY/.test(k)),[]);
    assert.match(root,/^\/tmp\/educore-owner-rules-[^/]+$/);
    const data=join(root,"data"),socket=join(root,"socket"),port=process.env.EDUCORE_OWNER_RULES_PORT!;
    const pid=readFileSync(join(data,"postmaster.pid"),"utf8").trim().split("\n");
    assert.equal(realpathSync(pid[1]),realpathSync(data));assert.equal(pid[3],port);assert.equal(pid[4],socket);
    const argv=readFileSync(`/proc/${pid[0]}/cmdline`,"utf8").split("\0");
    assert.equal(argv[argv.indexOf("-D")+1],data);assert.equal(argv[argv.indexOf("-h")+1],"");
    assert.equal(statSync(join(socket,`.s.PGSQL.${port}`)).isSocket(),true);
    db=new Pool({host:socket,port:Number(port),user:"owner_rules_qa",database:"postgres",
      max:4,connectionTimeoutMillis:1500,statement_timeout:8000});
    const identity=(await db.query("SELECT current_setting('data_directory') AS data,current_setting('listen_addresses') AS listen,current_user AS role")).rows[0];
    assert.equal(realpathSync(identity.data),realpathSync(data));assert.equal(identity.listen,"");assert.equal(identity.role,"owner_rules_qa");
    state.db=db;
    await db.query(`CREATE TABLE staff_nfc_billing_rules(id serial PRIMARY KEY,version integer NOT NULL,
      product text NOT NULL,billing_frequency text NOT NULL,price_minor integer NOT NULL,
      school_share_minor integer NOT NULL,platform_share_minor integer NOT NULL,partner_commission_minor integer NOT NULL,
      no_partner_platform_share_minor integer NOT NULL,currency text NOT NULL,effective_at timestamptz NOT NULL,
      created_by integer,status text NOT NULL DEFAULT 'ACTIVE',UNIQUE(product,version));
      CREATE TABLE commission_rules(id serial PRIMARY KEY,name text,status text,term text,partner_amount numeric,
        school_amount numeric,effective_at timestamptz);
      CREATE TABLE audit_logs(id serial PRIMARY KEY,"user" text,role text,actor_user_id integer,clerk_user_id text,
        action text,module text,record_id integer,event_type text,metadata jsonb,timestamp timestamptz DEFAULT now());
      CREATE TABLE students(id integer PRIMARY KEY,school_id integer,user_id integer,status text DEFAULT 'ACTIVE',
        first_name text DEFAULT 'Fictional',last_name text DEFAULT 'Student',admission_no text DEFAULT 'TEST-ONLY');
      CREATE TABLE schools(id integer PRIMARY KEY,status text DEFAULT 'ACTIVE',name text DEFAULT 'Fictional School');
       CREATE TABLE academic_sessions(id integer PRIMARY KEY,school_id integer,is_current boolean DEFAULT true,status text DEFAULT 'ACTIVE',name text DEFAULT 'Fictional Session');
      CREATE TABLE academic_terms(id integer PRIMARY KEY,school_id integer,academic_session_id integer DEFAULT 11,
        name text DEFAULT 'QA Current',is_current boolean DEFAULT true,status text DEFAULT 'ACTIVE',
        start_date date DEFAULT CURRENT_DATE-10,end_date date DEFAULT CURRENT_DATE+20);
      CREATE TABLE app_users(id integer PRIMARY KEY,first_name text,last_name text,status text DEFAULT 'ACTIVE');
      CREATE TABLE school_subscription_manual_locks(school_id integer PRIMARY KEY,locked boolean,version integer,
        locked_at timestamptz,locked_by_user_id integer,last_unlocked_at timestamptz,last_unlocked_by_user_id integer,reason text);
      CREATE TABLE subscriptions(id integer PRIMARY KEY,school_id integer,student_id integer,term text,
        amount numeric,status text,verification_status text);
      CREATE TABLE student_subscription_payments(id integer PRIMARY KEY,subscription_id integer,school_id integer,
        student_id integer,academic_term_id integer,provider text DEFAULT 'FLUTTERWAVE',provider_mode text DEFAULT 'SANDBOX',
        currency text DEFAULT 'NGN',status text,reconciliation_status text,provider_transaction_id text,paid_at timestamptz,gross_amount_minor integer);
      CREATE TABLE staff_nfc_subscriptions(id integer PRIMARY KEY,price_minor integer,school_share_minor integer);
      CREATE TABLE staff_nfc_payments(id integer PRIMARY KEY,subscription_id integer,amount_minor integer);
      CREATE TABLE fee_invoices(id integer PRIMARY KEY,school_id integer,student_id integer,
        student_name_snapshot text,admission_no_snapshot text,academic_term_id integer,currency text DEFAULT 'NGN',
        status text,total_minor integer,paid_minor integer DEFAULT 0,outstanding_minor integer,
        discount_minor integer DEFAULT 0,waiver_minor integer DEFAULT 0);
      CREATE TABLE fee_invoice_lines(id integer PRIMARY KEY,school_id integer,invoice_id integer,
        category_name_snapshot text,amount_minor integer);
      CREATE TABLE fee_payments(id integer PRIMARY KEY,school_id integer,invoice_id integer,
        selected_line_ids integer[],amount_minor integer,reference text,receipt_number text,
        method text,provider_transaction_id text,verification_evidence_ref text,transfer_reference text,
        status text,submitted_by integer,verified_by integer,verified_at timestamptz,transfer_date date,created_at timestamptz DEFAULT now());
      CREATE TABLE fee_payment_line_allocations(id integer PRIMARY KEY,school_id integer,invoice_id integer,
        line_id integer,payment_id integer,amount_minor integer);
      CREATE TABLE fee_receipts(id integer PRIMARY KEY,school_id integer,invoice_id integer,payment_id integer,receipt_number text);
      CREATE TABLE fee_refunds(id integer PRIMARY KEY,school_id integer,invoice_id integer,status text);
      INSERT INTO app_users VALUES(9,'Fictional','Owner','ACTIVE');
      INSERT INTO students(id,school_id,user_id) VALUES(31,1,9),(33,1,10);
      INSERT INTO schools(id) VALUES(1);
      INSERT INTO academic_sessions(id,school_id) VALUES(11,1);
      INSERT INTO academic_terms(id,school_id) VALUES(4,1);
      INSERT INTO staff_nfc_subscriptions VALUES(1,500000,200000);
      INSERT INTO staff_nfc_payments VALUES(1,1,500000);`);
    const migration=readFileSync(join(process.cwd(),"../../lib/db/drizzle/0175_owner_subscription_rule_management.sql"),"utf8");
    await db.query(migration);
    await db.query(readFileSync(join(process.cwd(),"../../lib/db/drizzle/0176_direct_student_live_preparation.sql"),"utf8"));
    await new Promise<void>(resolve=>{server=app.listen(0,"127.0.0.1",()=>{
      const addr=server.address();assert(addr&&typeof addr==="object");
      base=`http://127.0.0.1:${addr.port}`;resolve();
    });});
  });
  afterAll(async()=>{
    if(server){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
    if(db)await db.end();
  });
  beforeEach(async()=>{
    for(const table of ["fee_refunds","fee_receipts","fee_payment_line_allocations","fee_payments","fee_invoice_lines","fee_invoices",
      "student_direct_live_events","student_direct_live_attempts","student_direct_live_obligations","student_direct_live_reviews",
      "student_subscription_payments","subscriptions","school_subscription_manual_locks",
      "subscription_rule_proposals","subscription_payment_assistance_requests","audit_logs",
      "staff_nfc_billing_rules","commission_rules"])await db.query(`DELETE FROM "${table}"`);
    state.connections=0;state.queries=0;
  });
  it.each(["SCHOOL_ADMIN","ACCOUNTANT","PARTNER","PARENT","TEACHER","STAFF","STUDENT"])("rejects %s before database reads or writes",async role=>{
    const a=await request(path,"GET",undefined,{"x-role":role});
    const b=await request(path,"POST",draft(),{"x-role":role});
    const c=await request(queue,"POST",{schoolId:1,studentId:31,termId:4,amountMinor:320000,requestNote:"Fictional request"},{"x-role":role});
    expect([a.status,b.status,c.status]).toEqual([403,403,403]);expect(state.connections+state.queries).toBe(0);
  });
  it("rejects inactive identities and school-scoped Owner assignments before reading",async()=>{
    for(const headers of [{"x-user-status":"INACTIVE"},{"x-role-status":"INACTIVE"},{"x-school":"1"}] as Record<string,string>[]){
      expect((await request(path,"GET",undefined,headers)).status).toBe(403);
    }
    expect(state.connections+state.queries).toBe(0);
  });
  it("validates amount, effective window, currency, period and zero school allocation",async()=>{
    const cases=[
      {...draft(),schoolShareMinor:100},
      {...draft(),amountMinor:199999},
      {...draft(),amountMinor:-1},
      {...draft(),currency:"USD"},
      {...draft(),billingPeriod:"MONTH"},
      {...draft(),effectiveAt:new Date(Date.now()-60000).toISOString()},
      {...draft(),endsAt:new Date(Date.now()+60000).toISOString()},
      {...draft(),reason:"a"},
    ];
    for(const candidate of cases)expect((await request(path,"POST",candidate)).status).toBeGreaterThanOrEqual(400);
    expect((await db.query("SELECT count(*)::int AS n FROM subscription_rule_proposals")).rows[0].n).toBe(0);
  });
  it("preserves historical staff snapshots, requires a fresh preview, and activates only a future zero-share native version",async()=>{
    const before=JSON.stringify((await db.query("SELECT * FROM staff_nfc_subscriptions s JOIN staff_nfc_payments p ON p.subscription_id=s.id")).rows);
    const r=await insert();expect(r.status).toBe("DRAFT");expect((await db.query("SELECT count(*)::int AS n FROM staff_nfc_billing_rules")).rows[0].n).toBe(0);
    const preview=await (await request(`${path}/${r.id}/preview`,"POST")).json() as any;
    expect(preview.activationAvailable).toBe(true);
    expect((await request(`${path}/${r.id}/activate`,"POST",{version:r.version,previewDigest:"0".repeat(64)})).status).toBe(409);
    expect((await request(`${path}/${r.id}/activate`,"POST",{version:r.version,previewDigest:preview.previewDigest})).status).toBe(200);
    const native=(await db.query("SELECT * FROM staff_nfc_billing_rules")).rows[0];
    expect(native).toMatchObject({price_minor:200000,school_share_minor:0,partner_commission_minor:0,
      platform_share_minor:200000,no_partner_platform_share_minor:200000});
    expect((await request(`${path}/${r.id}/activate`,"POST",{version:r.version,previewDigest:preview.previewDigest})).status).toBe(409);
    expect(JSON.stringify((await db.query("SELECT * FROM staff_nfc_subscriptions s JOIN staff_nfc_payments p ON p.subscription_id=s.id")).rows)).toBe(before);
    const history=(await db.query("SELECT action,metadata,actor_user_id,timestamp FROM audit_logs ORDER BY id")).rows;
    expect(history.map(x=>x.action)).toEqual(["DRAFT_CREATED","ACTIVATED"]);
    expect(history[1]).toMatchObject({actor_user_id:9});
    expect(history[1].metadata.before.status).toBe("DRAFT");
    expect(history[1].metadata.after.status).toBe("SCHEDULED");
    expect(history[1].metadata.reason).toBe(r.reason);
    expect(history[1].timestamp).toBeTruthy();
  });
  it("detects stale edits and previews; clips previous effective windows and prevents overlapping versions",async()=>{
    const first=await insert(draft("TEACHER_STAFF_PLATFORM",Date.now()+2*86400_000));
    const firstPreview=await (await request(`${path}/${first.id}/preview`,"POST")).json() as any;
    expect((await request(`${path}/${first.id}/activate`,"POST",{version:first.version,previewDigest:firstPreview.previewDigest})).status).toBe(200);
    const second=await insert(draft("TEACHER_STAFF_PLATFORM",Date.now()+3*86400_000));
    const secondPreview=await (await request(`${path}/${second.id}/preview`,"POST")).json() as any;
    expect(secondPreview.activationAvailable).toBe(true);
    expect((await request(`${path}/${second.id}/activate`,"POST",{version:second.version,previewDigest:secondPreview.previewDigest})).status).toBe(200);
    const previous=(await db.query("SELECT ends_at FROM staff_nfc_billing_rules WHERE version=1")).rows[0];
    expect(previous.ends_at).not.toBeNull();
    const overlapping=await insert(draft("TEACHER_STAFF_PLATFORM",Date.now()+2*86400_000));
    const blocked=await (await request(`${path}/${overlapping.id}/preview`,"POST")).json() as any;
    expect(blocked.activationAvailable).toBe(false);
    const editable=await insert();
    expect((await request(`${path}/${editable.id}`,"PATCH",{...draft(),version:99})).status).toBe(409);
    const edited=await request(`${path}/${editable.id}`,"PATCH",{...draft("TEACHER_STAFF_PLATFORM",Date.now()+4*86400_000),version:editable.version});
    expect(edited.status).toBe(200);
    expect((await request(`${path}/${editable.id}/activate`,"POST",{version:editable.version,previewDigest:"0".repeat(64)})).status).toBe(409);
  });
  it("blocks student/BRO activation; a configured draft does not create revenue, commission or a payment",async()=>{
    for(const product of ["STUDENT_PLATFORM","BRO_COMMISSION"]){
      const r=await insert(draft(product)),p=await (await request(`${path}/${r.id}/preview`,"POST")).json() as any;
      expect(p.activationAvailable).toBe(false);
      expect((await request(`${path}/${r.id}/activate`,"POST",{version:r.version,previewDigest:p.previewDigest})).status).toBe(409);
    }
    expect((await db.query("SELECT count(*)::int AS n FROM staff_nfc_billing_rules")).rows[0].n).toBe(0);
    expect((await db.query("SELECT count(*)::int AS n FROM commission_rules")).rows[0].n).toBe(0);
  });
  it("retiring the latest staff version stops new checkout without deleting native or audit history",async()=>{
    const r=await insert();
    const p=await (await request(`${path}/${r.id}/preview`,"POST")).json() as any;
    const scheduled=await (await request(`${path}/${r.id}/activate`,"POST",{version:r.version,previewDigest:p.previewDigest})).json() as any;
    expect((await request(`${path}/${r.id}/retire`,"POST",{reason:"Reviewed closure of fictional rule"})).status).toBe(200);
    expect((await db.query("SELECT id,ends_at FROM staff_nfc_billing_rules")).rows[0].ends_at).toBeTruthy();
    expect((await db.query("SELECT action FROM audit_logs WHERE record_id=$1 ORDER BY id",[r.id])).rows.map(x=>x.action)).toEqual(["DRAFT_CREATED","ACTIVATED","RETIRED"]);
    expect((await request(`${path}/${r.id}/retire`,"POST",{reason:"Retry retirement"})).status).toBe(409);
    expect(scheduled.nativeRuleId).toBeGreaterThan(0);
  });
  it("requires Owner-attested independent matching bank credit and does not initiate a provider payment",async()=>{
    const body={schoolId:1,studentId:31,termId:4,amountMinor:320000,requestNote:"Fictional school request"};
    const created=await request(queue,"POST",body);expect(created.status).toBe(201);
    const r=await created.json() as any;
    expect((await request(queue,"POST",body)).status).toBe(409);
    expect((await request(queue,"POST",{...body,studentId:99})).status).toBe(404);
    const creditDate=new Date().toISOString().slice(0,10);
    const verified={bankName:"Fictional Test Bank",bankStatementReference:"QA-UNIQUE-CREDIT-01",
      creditDate,verifiedAmountMinor:320000,independentlyChecked:true};
    expect((await request(`${queue}/${r.id}/verify-bank`,"POST",{...verified,verifiedAmountMinor:100})).status).toBe(409);
    expect((await request(`${queue}/${r.id}/verify-bank`,"POST",{...verified,independentlyChecked:false})).status).toBe(400);
    const yes=await request(`${queue}/${r.id}/verify-bank`,"POST",verified);
    expect(yes.status).toBe(200);
    expect((await yes.json() as any).providerInitiationAvailable).toBe(false);
    expect((await request(`${queue}/${r.id}/verify-bank`,"POST",verified)).status).toBe(409);
    const second=await request(queue,"POST",{...body,studentId:33});
    expect(second.status).toBe(201);
    const secondId=(await second.json() as any).id;
    expect((await request(`${queue}/${secondId}/verify-bank`,"POST",{
      ...verified,bankStatementReference:"qa-unique-credit-01"})).status).toBe(409);
    expect((await request(`${queue}/${r.id}/initiate`,"POST",{})).status).toBe(404);
    const logs=(await db.query("SELECT action,metadata FROM audit_logs ORDER BY id")).rows;
    expect(logs.map(l=>l.action)).toEqual(["ASSISTANCE_REQUESTED","BANK_CREDIT_VERIFIED","ASSISTANCE_REQUESTED"]);
    expect(logs[1].metadata.after.bankStatementReference).toBe("QA-UNIQUE-CREDIT-01");
  });
  it("returns only explicit capabilities and no secrets, with read-only history for Owner",async()=>{
    const r=await request(path);expect(r.status).toBe(200);
    const json=await r.json() as any;
    expect(json).toMatchObject({intendedStudentFeeMinor:320000,intendedStaffFeeMinor:200000,
      studentCheckoutAvailable:false,providerInitiationAvailable:false});
    expect(JSON.stringify(json)).not.toMatch(/(?:SECRET_KEY|sk_live_|publishable_key|encryption_key)/i);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
  it("restricts student core APIs but leaves account/payment/help paths without a subscription lookup",async()=>{
    const ctx={user:{id:9,status:"ACTIVE"},roles:[{role:"STUDENT",status:"ACTIVE",schoolId:1}]} as any;
    await expect(enforceRequestSubscription({originalUrl:"/api/library/books?studentId=33",method:"GET",query:{studentId:"33"}} as any,ctx))
      .rejects.toMatchObject({statusCode:403,eventType:"STUDENT_PLATFORM_SUBSCRIPTION_REQUIRED"});
    const before=state.queries;
    for(const url of ["/api/auth/me","/api/student/platform-subscription-access","/api/communication/inbox","/api/subscriptions/8/payments/9"])
      await enforceRequestSubscription({originalUrl:url,method:"GET",query:{}} as any,ctx);
    expect(state.queries).toBe(before);
  });
  it("binds platform verification to student/school/term and never treats an active flag, school payment or pending evidence as proof",async()=>{
    await db.query(`INSERT INTO subscriptions VALUES(71,1,31,'QA Current',5000,'active','verified')`);
    const historical=(await db.query("SELECT * FROM subscriptions WHERE id=71")).rows;
    expect((await readStudentTermPlatformAccess(db,1,31)).restricted).toBe(true);
    await expect(assertSubscriptionAccess(1,31,db)).rejects.toMatchObject({statusCode:403,eventType:"STUDENT_PLATFORM_SUBSCRIPTION_REQUIRED"});
    await db.query(`INSERT INTO student_subscription_payments
      (id,subscription_id,school_id,student_id,academic_term_id,status,reconciliation_status,provider_transaction_id,paid_at,gross_amount_minor)
      VALUES(81,71,1,31,4,'PENDING','RECONCILED','881',now(),500000)`);
    for(const status of ["PENDING","FAILED","RECONCILIATION_REQUIRED"]){
      await db.query("UPDATE student_subscription_payments SET status=$1 WHERE id=81",[status]);
      expect((await readStudentTermPlatformAccess(db,1,31)).restricted).toBe(true);
    }
    await db.query("UPDATE student_subscription_payments SET status='PAID',academic_term_id=99 WHERE id=81");
    expect((await readStudentTermPlatformAccess(db,1,31)).restricted).toBe(true);
    await db.query("UPDATE student_subscription_payments SET academic_term_id=4,student_id=33 WHERE id=81");
    expect((await readStudentTermPlatformAccess(db,1,31)).restricted).toBe(true);
    await db.query("UPDATE student_subscription_payments SET student_id=31,gross_amount_minor=320000 WHERE id=81");
    expect((await readStudentTermPlatformAccess(db,1,31)).restricted).toBe(true);
    await db.query("UPDATE student_subscription_payments SET gross_amount_minor=500000,reconciliation_status='PENDING' WHERE id=81");
    expect((await readStudentTermPlatformAccess(db,1,31)).restricted).toBe(true);
    await db.query("UPDATE student_subscription_payments SET reconciliation_status='RECONCILED' WHERE id=81");
    expect((await readStudentTermPlatformAccess(db,1,31)).status).toBe("VERIFIED");
    expect((await readStudentPlatformAccess(db,9)).restricted).toBe(false);
    const ctx={user:{id:9,status:"ACTIVE"},roles:[{role:"STUDENT",status:"ACTIVE",schoolId:1}]} as any;
    await expect(enforceRequestSubscription({originalUrl:"/api/library/books",method:"GET",query:{}} as any,ctx)).resolves.toBeUndefined();
    expect((await db.query("SELECT * FROM subscriptions WHERE id=71")).rows).toEqual(historical);
    expect((await readStudentTermPlatformAccess(db,1,33)).restricted).toBe(true);
    await db.query("INSERT INTO school_subscription_manual_locks(school_id,locked,version) VALUES(1,true,1)");
    await expect(readStudentPlatformAccess(db,9)).rejects.toMatchObject({statusCode:403});
  });
  it("keeps the status endpoint Student-only and ignores caller-supplied student identity",async()=>{
    for(const role of ["PLATFORM_OWNER","SCHOOL_ADMIN","PARENT","TEACHER"])
      expect((await request("/student/platform-subscription-access","GET",undefined,{"x-role":role})).status).toBe(403);
    await db.query("UPDATE school_subscription_manual_locks SET locked=false WHERE school_id=1");
    const result=await request("/student/platform-subscription-access?studentId=33","GET",undefined,{"x-role":"STUDENT"});
    expect(result.status).toBe(200);
    expect((await result.json() as any).students.map((s:any)=>s.studentId)).toEqual([31]);
  });
  it("lists immutable school fee snapshots, missing-fee rosters, pending evidence and verified partial/full allocations without touching platform payment",async()=>{
    expect((await request("/platform/nfc-fee-collection-oversight?limit=2","GET",undefined,{"x-role":"PARENT"})).status).toBe(403);
    const before=state.queries;
    const missing=await request("/platform/nfc-fee-collection-oversight?schoolId=1&termId=4");
    expect(missing.status).toBe(200);
    expect((await missing.json() as any).items.map((r:any)=>r.status)).toEqual(["NOT_CONFIGURED","NOT_CONFIGURED"]);
    expect(state.queries-before).toBe(2);
    await db.query(`INSERT INTO fee_invoices(id,school_id,student_id,student_name_snapshot,admission_no_snapshot,
      academic_term_id,status,total_minor,paid_minor,outstanding_minor)
      VALUES(90,1,31,'Historically Named Student','STUDENT-31',4,'UNPAID',850000,0,850000)`);
    await db.query(`INSERT INTO fee_invoice_lines VALUES(91,1,90,'NFC Card & EduCore Subscription Fee',500000),
      (92,1,90,'Ordinary tuition',350000)`);
    await db.query(`INSERT INTO fee_payments(id,school_id,invoice_id,selected_line_ids,amount_minor,reference,method,
      status,submitted_by) VALUES(93,1,90,ARRAY[91],500000,'RECEIPT-PENDING','BANK_TRANSFER','PENDING',9)`);
    const pending=(await readNfcFeeCollectionOversight(db,{schoolId:1,termId:4,limit:100,offset:0})).items;
    const row=pending.find((r:any)=>r.studentId===31)!;
    expect(row).toMatchObject({studentName:"Historically Named Student",admissionNo:"STUDENT-31",
      amountMinor:500000,paidMinor:0,status:"PENDING_EVIDENCE"});
    expect(row.payments[0]).toMatchObject({reference:"RECEIPT-PENDING",status:"PENDING",recordedBy:"Fictional Owner",reviewedBy:null});
    expect(JSON.stringify(row)).not.toMatch(/proofUrl|objectPath|parentEmail|bankAccount|contactPhone/i);
    await db.query(`UPDATE fee_payments SET status='VERIFIED',verified_by=9,verified_at=now(),amount_minor=200000 WHERE id=93;
      INSERT INTO fee_payment_line_allocations VALUES(100,1,90,91,93,200000)`);
    const partial=(await readNfcFeeCollectionOversight(db,{schoolId:1,termId:4,status:"PARTIALLY_PAID",limit:100,offset:0})).items;
    expect(partial).toHaveLength(1);
    expect(partial[0]).toMatchObject({paidMinor:200000,status:"PARTIALLY_PAID"});
    expect(partial[0].payments[0].reviewedBy).toBe("Fictional Owner");
    await db.query(`INSERT INTO fee_payments(id,school_id,invoice_id,selected_line_ids,amount_minor,reference,method,status,submitted_by,verified_by,verified_at)
      VALUES(94,1,90,ARRAY[91],300000,'SCHOOL-CASH-REFERENCE','CASH','VERIFIED',9,9,now());
      INSERT INTO fee_payment_line_allocations VALUES(101,1,90,91,94,300000)`);
    expect((await readNfcFeeCollectionOversight(db,{schoolId:1,termId:4,status:"FULLY_PAID",limit:100,offset:0})).items[0])
      .toMatchObject({paidMinor:500000,status:"FULLY_PAID"});
    await db.query("INSERT INTO fee_refunds VALUES(201,1,90,'APPROVED')");
    expect((await readNfcFeeCollectionOversight(db,{schoolId:1,termId:4,status:"REVIEW_REQUIRED",limit:100,offset:0})).items[0].status)
      .toBe("REVIEW_REQUIRED");
    expect((await db.query("SELECT count(*)::int AS n FROM student_direct_live_obligations")).rows[0].n).toBe(0);
  });
  it("loads existing school/term choices read-only and rejects cross-school or nonexistent term filters",async()=>{
    const endpoint="/platform/nfc-fee-collection-oversight";
    for(const role of ["PARENT","STUDENT","TEACHER","SCHOOL_ADMIN"])
      expect((await request(`${endpoint}/filter-options`,"GET",undefined,{"x-role":role})).status).toBe(403);
    await db.query(`INSERT INTO schools(id,name) VALUES(2,'Other Fictional School');
      INSERT INTO academic_sessions(id,school_id,name) VALUES(12,2,'Fictional Session');
      INSERT INTO academic_terms(id,school_id,academic_session_id,name) VALUES(5,2,12,'QA Current');
      INSERT INTO academic_terms(id,school_id,academic_session_id,name,is_current,status,start_date,end_date)
        VALUES(6,1,11,'QA Current',false,'COMPLETED','2020-01-01','2020-04-01')`);
    try{
      const snapshot=async()=>(await db.query(`SELECT
        (SELECT jsonb_agg(t ORDER BY id) FROM academic_terms t) AS terms,
        (SELECT jsonb_agg(s ORDER BY id) FROM academic_sessions s) AS sessions,
        (SELECT count(*) FROM fee_payments) AS payments,
        (SELECT count(*) FROM student_direct_live_obligations) AS obligations`)).rows[0];
      const before=await snapshot();
      const all=await request(`${endpoint}/filter-options`);
      expect(all.status).toBe(200);
      const options=await all.json() as any;
      expect(options.schools.map((s:any)=>s.id).sort()).toEqual([1,2]);
      expect(options.terms.filter((t:any)=>t.isCurrent).map((t:any)=>t.id).sort()).toEqual([4,5]);
      expect(options.terms.find((t:any)=>t.id===6)).toMatchObject({schoolId:1,isCurrent:false,startDate:"2020-01-01"});
      const scoped=await request(`${endpoint}/filter-options?schoolId=1`);
      expect((await scoped.json() as any).terms.map((t:any)=>t.id).sort()).toEqual([4,6]);
      expect((await request(`${endpoint}/filter-options?schoolId=99999`)).status).toBe(400);
      expect((await request(`${endpoint}/filter-options?schoolId=invalid`)).status).toBe(400);
      expect((await request(`${endpoint}?schoolId=1&termId=5`)).status).toBe(400);
      expect((await request(`${endpoint}?termId=99999`)).status).toBe(400);
      expect((await request(`${endpoint}?schoolId=1&termId=4`)).status).toBe(200);
      expect((await request(`${endpoint}?termId=5`)).status).toBe(200);
      await db.query("UPDATE academic_terms SET end_date=CURRENT_DATE-1 WHERE id=5");
      const expired=await request(`${endpoint}/filter-options?schoolId=2`);
      expect((await expired.json() as any).terms[0].isCurrent).toBe(false);
      await db.query("UPDATE academic_terms SET end_date=CURRENT_DATE+20 WHERE id=5");
      expect(await snapshot()).toEqual(before);
    }finally{
      await db.query("DELETE FROM academic_terms WHERE id IN (5,6); DELETE FROM academic_sessions WHERE id=12; DELETE FROM schools WHERE id=2");
    }
  });
  it("keeps direct LIVE checkout blocked without release evidence or a fresh approved 3200 rule; mock provider is never called",async()=>{
    const mock=vi.fn(async()=>{throw Error("Provider was called");});
    const scope={schoolId:1,studentId:31,termId:4};
    const result=await directStudentReadiness(db as any,scope,{env:{NODE_ENV:"test"},fetcher:mock});
    expect(result).toMatchObject({ready:false});
    await expect(startDirectStudentPayment(db as any,{...scope,actorId:9,email:"fictional@example.test",idempotencyKey:"fictional-key-123456"},
      {env:{NODE_ENV:"test"},fetcher:mock})).rejects.toMatchObject({code:"LIVE_DIRECT_CONFIGURATION_AND_RELEASE_REVIEW_REQUIRED"});
    expect(mock).not.toHaveBeenCalled();
    expect((await db.query("SELECT count(*)::int AS n FROM student_direct_live_attempts")).rows[0].n).toBe(0);
  });
  it("uses only a reviewed direct 3200 scope, stores verified attempts once and reuses a reference without another provider POST",async()=>{
    const approvedDigest="f".repeat(64);
    const env={
      NODE_ENV:"production",EDUCORE_FLUTTERWAVE_MODE:"LIVE",
      FLUTTERWAVE_LIVE_SECRET_KEY:"FLWSECK-FAKE-NO-NETWORK",
      FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH:"synthetic-webhook-not-live",
      EDUCORE_FLUTTERWAVE_DIRECT_RELEASE:"STUDENT_DIRECT_3200_V1",
      EDUCORE_FLUTTERWAVE_DIRECT_CALLBACK_URL:"https://example.invalid/api/flutterwave/direct-student/callback",
    };
    const proposal=await insert(draft("STUDENT_PLATFORM"));
    // Only the disposable fixture simulates the *future* separately approved native
    // student rule. The real Owner endpoint still blocks Student activation.
    await db.query("UPDATE subscription_rule_proposals SET status='ACTIVE',effective_at=now()-interval '1 day' WHERE id=$1",[proposal.id]);
    for(const studentId of [31,33])await db.query(`INSERT INTO student_direct_live_reviews
      (school_id,academic_term_id,rule_id,report_digest,merchant_scope,no_split_confirmed,approved_by,expires_at,reason)
      VALUES(1,4,$1,$2,'FICTIONAL_NON_SPLIT_MERCHANT',true,9,now()+interval '1 day','Reviewed fictional term')`,
      [proposal.id,approvedDigest]);
    const report=async()=>({sourceStatus:"COMPLETE",evidenceDigest:approvedDigest,rows:[
      {studentId:31,status:"NEW_OBLIGATION_AFTER_REVIEW"},{studentId:33,status:"NEW_OBLIGATION_AFTER_REVIEW"}]}) as any;
    const states=new Map<string,"pending"|"failed"|"successful">([["901","pending"],["902","failed"],["903","successful"]]);
    const txReferences=new Map<string,string>();
    const calls:{url:string;body:Record<string,unknown>|null}[]=[];
    const fetcher=vi.fn(async(url:string,init?:RequestInit)=>{
      const body=init?.body?JSON.parse(String(init.body)):null;
      calls.push({url,body});
      const id=url.match(/transactions\/(\d+)\/verify/)?.[1];
      if(id){
        const attempt=(await db.query(`SELECT reference FROM student_direct_live_attempts WHERE provider_transaction_id=$1
          UNION ALL SELECT reference FROM student_direct_live_attempts ORDER BY reference LIMIT 1`,[id])).rows[0];
        const status=states.get(id)??"successful";
        const ref=body?.tx_ref??txReferences.get(id)??attempt?.reference;
        return Response.json({status:"success",data:{id:Number(id),tx_ref:ref,currency:"NGN",amount:3200,
          charged_amount:status==="successful"?3200:0,status,
          ...(status==="successful"?{flw_ref:`FICTIONAL-${id}`,app_fee:55,merchant_fee:0}:{})}});
      }
      return Response.json({status:"success",data:{link:"https://checkout.flutterwave.com/v3/hosted/pay/fictional-123"}});
    });
    const deps={env,report:report as any,fetcher:fetcher as unknown as typeof fetch};
    const scope={schoolId:1,studentId:31,termId:4,actorId:9,email:"fixture@example.test"};
    const first=await startDirectStudentPayment(db as any,{...scope,idempotencyKey:"fictional-checkout-001"},deps);
    assert.ok(first);
    txReferences.set("901",first.reference);
    expect(first.state).toBe("READY");
    expect(first.reference).toMatch(/^SCV4_live_/);
    const paymentPosts=calls.filter(c=>c.url.endsWith("/payments"));
    expect(paymentPosts).toHaveLength(1);
    expect(paymentPosts[0].body).toMatchObject({amount:3200,currency:"NGN",tx_ref:first.reference});
    expect(JSON.stringify(paymentPosts[0].body)).not.toMatch(/subaccount|split|school_share|commission|FLWSECK-/i);
    expect(await startDirectStudentPayment(db as any,{...scope,idempotencyKey:"fictional-checkout-002"},deps)).toMatchObject({reference:first.reference});
    expect(calls.filter(c=>c.url.endsWith("/payments"))).toHaveLength(1);
    // The fake verifier is reference-bound to the stored attempt, not a redirect claim.
    const pending=await verifyDirectStudentPayment(db as any,{reference:first.reference,transactionId:"901",actorId:null},deps);
    expect(pending.state).toBe("PENDING");
    states.set("901","successful");
    const paid=await verifyDirectStudentPayment(db as any,{reference:first.reference,transactionId:"901",actorId:null},deps);
    expect(paid.state).toBe("PAID");
    expect((await verifyDirectStudentPayment(db as any,{reference:first.reference,transactionId:"901",actorId:null},deps)).state).toBe("PAID");
    await expect(verifyDirectStudentPayment(db as any,{reference:first.reference,transactionId:"902",actorId:null},deps))
      .rejects.toMatchObject({code:"VERIFIED_TRANSACTION_CONFLICT"});
    expect((await db.query(`SELECT o.amount_minor,o.school_share_minor,o.bro_share_minor,o.assistance_request_id
      FROM student_direct_live_obligations o WHERE student_id=31`)).rows[0])
      .toMatchObject({amount_minor:320000,school_share_minor:0,bro_share_minor:0,assistance_request_id:null});
    expect((await db.query(`SELECT count(*)::int AS n FROM student_direct_live_events WHERE kind='PROVIDER_PAYMENT_VERIFIED'`)).rows[0].n).toBe(1);
    await expect(db.query("UPDATE student_direct_live_obligations SET amount_minor=500000 WHERE student_id=31"))
      .rejects.toMatchObject({code:"P0001"});

    const assist=await request("/schools/1/platform-subscriptions/assistance","POST",
      {studentId:33,termId:4,requestNote:"Fictional Owner assistance"},{"x-role":"SCHOOL_ADMIN"});
    expect(assist.status).toBe(201);
    const {id:assistanceId}=await assist.json() as {id:number};
    const second={...scope,studentId:33,idempotencyKey:"fictional-assisted-001",assistanceId};
    await expect(startDirectStudentPayment(db as any,second,deps))
      .rejects.toMatchObject({code:"INDEPENDENT_BANK_CREDIT_REQUIRED"});
    const bank=await request(`${queue}/${assistanceId}/verify-bank`,"POST",
      {bankName:"Fictional Test Bank",bankStatementReference:"FICTIONAL-INDEPENDENT-CREDIT-01",
        creditDate:new Date().toISOString().slice(0,10),verifiedAmountMinor:320000,independentlyChecked:true});
    expect(bank.status).toBe(200);
    const bankSnapshot=(await db.query("SELECT * FROM subscription_payment_assistance_requests WHERE id=$1",[assistanceId])).rows;
    const secondAttempt=await startDirectStudentPayment(db as any,second,deps);
    assert.ok(secondAttempt);
    txReferences.set("902",secondAttempt.reference);
    expect(secondAttempt.state).toBe("READY");
    expect((await verifyDirectStudentPayment(db as any,{reference:secondAttempt.reference,transactionId:"902",actorId:null},deps)).state).toBe("FAILED");
    const retry=await startDirectStudentPayment(db as any,{...second,idempotencyKey:"fictional-assisted-002"},deps);
    assert.ok(retry);
    txReferences.set("903",retry.reference);
    expect(retry.reference).not.toBe(secondAttempt.reference);
    expect((await verifyDirectStudentPayment(db as any,{reference:retry.reference,transactionId:"903",actorId:null},deps)).state).toBe("PAID");
    expect((await db.query("SELECT * FROM subscription_payment_assistance_requests WHERE id=$1",[assistanceId])).rows)
      .toEqual(bankSnapshot);
    expect((await db.query("SELECT count(*)::int AS n FROM student_direct_live_obligations WHERE student_id=33")).rows[0].n).toBe(1);
    expect((await db.query("SELECT count(*)::int AS n FROM student_direct_live_attempts WHERE state='PAID' AND obligation_id IN (SELECT id FROM student_direct_live_obligations WHERE student_id=33)")).rows[0].n).toBe(1);
    expect((await db.query("SELECT count(*)::int AS n FROM subscriptions")).rows[0].n).toBe(0);
    expect((await db.query("SELECT count(*)::int AS n FROM student_subscription_payments")).rows[0].n).toBe(0);
    // Test-only configuration never becomes a credential in the application database or UI.
    expect(JSON.stringify((await db.query("SELECT details FROM student_direct_live_events")).rows))
      .not.toContain(env.FLUTTERWAVE_LIVE_SECRET_KEY);
  });
});
