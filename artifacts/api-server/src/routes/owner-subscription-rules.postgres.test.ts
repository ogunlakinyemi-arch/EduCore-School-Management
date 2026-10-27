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
import { readStudentTermPlatformAccess,readStudentPlatformAccess } from "../services/student-platform-access";
import { enforceRequestSubscription } from "../services/subscription-request-access";
import { assertSubscriptionAccess } from "../services/subscription-enforcement";
const suite=process.env.EDUCORE_OWNER_RULES_ROOT?describe:describe.skip;
suite("Owner-only subscription rule management on isolated PostgreSQL",()=>{
  let db:Pool,server:ReturnType<typeof app.listen>,base="";
  const app=express();app.use(express.json());app.use(router);app.use(studentAccessRouter);
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
      CREATE TABLE students(id integer PRIMARY KEY,school_id integer,user_id integer,status text DEFAULT 'ACTIVE');
      CREATE TABLE schools(id integer PRIMARY KEY,status text DEFAULT 'ACTIVE');
      CREATE TABLE academic_sessions(id integer PRIMARY KEY,school_id integer,is_current boolean DEFAULT true,status text DEFAULT 'ACTIVE');
      CREATE TABLE academic_terms(id integer PRIMARY KEY,school_id integer,academic_session_id integer DEFAULT 11,
        name text DEFAULT 'QA Current',is_current boolean DEFAULT true,status text DEFAULT 'ACTIVE',
        start_date date DEFAULT CURRENT_DATE-10,end_date date DEFAULT CURRENT_DATE+20);
      CREATE TABLE app_users(id integer PRIMARY KEY,first_name text,last_name text);
      CREATE TABLE school_subscription_manual_locks(school_id integer PRIMARY KEY,locked boolean,version integer,
        locked_at timestamptz,locked_by_user_id integer,last_unlocked_at timestamptz,last_unlocked_by_user_id integer,reason text);
      CREATE TABLE subscriptions(id integer PRIMARY KEY,school_id integer,student_id integer,term text,
        amount numeric,status text,verification_status text);
      CREATE TABLE student_subscription_payments(id integer PRIMARY KEY,subscription_id integer,school_id integer,
        student_id integer,academic_term_id integer,provider text DEFAULT 'FLUTTERWAVE',provider_mode text DEFAULT 'SANDBOX',
        currency text DEFAULT 'NGN',status text,reconciliation_status text,provider_transaction_id text,paid_at timestamptz,gross_amount_minor integer);
      CREATE TABLE staff_nfc_subscriptions(id integer PRIMARY KEY,price_minor integer,school_share_minor integer);
      CREATE TABLE staff_nfc_payments(id integer PRIMARY KEY,subscription_id integer,amount_minor integer);
      INSERT INTO students(id,school_id,user_id) VALUES(31,1,9),(33,1,10);
      INSERT INTO schools(id) VALUES(1);
      INSERT INTO academic_sessions(id,school_id) VALUES(11,1);
      INSERT INTO academic_terms(id,school_id) VALUES(4,1);
      INSERT INTO staff_nfc_subscriptions VALUES(1,500000,200000);
      INSERT INTO staff_nfc_payments VALUES(1,1,500000);`);
    const migration=readFileSync(join(process.cwd(),"../../lib/db/drizzle/0175_owner_subscription_rule_management.sql"),"utf8");
    await db.query(migration);
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
    for(const table of ["subscription_rule_proposals","subscription_payment_assistance_requests","audit_logs",
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
});
