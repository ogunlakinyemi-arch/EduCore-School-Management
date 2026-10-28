import {assertVerifiedStudentNfcPayment} from "../services/student-nfc-payment-evidence";
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
import directStudentPaymentsRouter,{directStudentWebhookRouter,directStudentPublicRouter} from "./direct-student-live-payments";
import {appendFinancialHistory,requireFinancialActor,transitionDirectAttempt} from "../services/financial-history-writes";
import {createDirectReleaseRouter} from "./direct-student-live-release";
import {previewDirectRelease,createDirectReleaseReview,decideDirectReleaseReview,inspectDirectReleaseSchema} from "../services/direct-student-live-release";
const releaseEnv:NodeJS.ProcessEnv={
  NODE_ENV:"production",EDUCORE_FLUTTERWAVE_MODE:"LIVE",
  FLUTTERWAVE_LIVE_SECRET_KEY:"FLWSECK-FAKE-NO-NETWORK",
  FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH:"synthetic-webhook-not-live",
  EDUCORE_FLUTTERWAVE_DIRECT_RELEASE:"STUDENT_DIRECT_3200_V1",
  EDUCORE_FLUTTERWAVE_DIRECT_CALLBACK_URL:"https://example.invalid/api/flutterwave/direct-student/callback",
  EDUCORE_FLUTTERWAVE_DIRECT_WEBHOOK_URL:"https://example.invalid/api/webhooks/flutterwave/direct-student",
  EDUCORE_FLUTTERWAVE_MERCHANT_SCOPE:"FICTIONAL_NON_SPLIT_MERCHANT",
};
const fictionalReport=async()=>({sourceStatus:"COMPLETE",evidenceDigest:"f".repeat(64),rows:[
  {studentId:31,status:"NEW_OBLIGATION_AFTER_REVIEW"},{studentId:33,status:"NEW_OBLIGATION_AFTER_REVIEW"}]}) as any;
const releaseDeps={env:releaseEnv,report:fictionalReport};
// Both clocks are fixture-owned. JS-only time travel would disagree with NOW()
// in the real PostgreSQL authorization, grace-period and release queries.
const freeFixtureTime="2026-10-27T12:00:00Z";
function fixtureClockSql(sql:string){
  return sql.replace(/\b(?:now|clock_timestamp)\s*\(\s*\)/gi,"owner_rules_fixture_now()")
    .replace(/\bCURRENT_DATE\b/gi,"(owner_rules_fixture_now() AT TIME ZONE 'Africa/Lagos')::date");
}
function withFixtureClock<T extends {query:any}>(connection:T):T{
  return new Proxy(connection,{
    get(target,key){
      if(key==="query")return(sql:string,...args:any[])=>target.query(fixtureClockSql(sql),...args);
      if(key==="connect")return async()=>withFixtureClock(await (target as any).connect());
      const value=Reflect.get(target,key);
      return typeof value==="function"?value.bind(target):value;
    },
  });
}
const suite=process.env.EDUCORE_OWNER_RULES_ROOT?describe:describe.skip;
suite("Owner-only subscription rule management on isolated PostgreSQL",()=>{
  let db:Pool,server:ReturnType<typeof app.listen>,base="";
  const originalFetch=globalThis.fetch;
  const app=express();
  app.use("/fixture-direct-webhook",express.raw({type:"application/json"}),directStudentWebhookRouter);
  app.use(directStudentPublicRouter);
  app.use(express.json());app.use(router);app.use(studentAccessRouter);app.use(nfcFeeOversightRouter);app.use(directStudentPaymentsRouter);
  app.use(createDirectReleaseRouter(undefined,releaseDeps));
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
  async function setFixtureTime(instant:string){
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date(instant));
    await db.query("UPDATE owner_rules_fixture_clock SET instant=$1",[instant]);
  }
  async function enterCollectionTerm(){
    await setFixtureTime("2027-01-26T12:00:00Z");
    await db.query(`UPDATE academic_terms SET name='Second Term',start_date='2027-01-18',
      end_date='2027-04-09',is_current=true,status='ACTIVE' WHERE id=4 AND school_id=1`);
  }
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
    // Install only AFTER proving this connection belongs to the private cluster.
    await db.query(`CREATE TABLE owner_rules_fixture_clock(instant timestamptz NOT NULL);
      INSERT INTO owner_rules_fixture_clock VALUES('${freeFixtureTime}');
      CREATE FUNCTION owner_rules_fixture_now() RETURNS timestamptz LANGUAGE sql STABLE AS
        $$ SELECT instant FROM owner_rules_fixture_clock $$;`);
    db=withFixtureClock(db);
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date(freeFixtureTime));
    globalThis.fetch=async(input,init)=>{
      const address=new URL(input instanceof Request?input.url:String(input));
      if(!["127.0.0.1","localhost"].includes(address.hostname))
        throw new Error("External network is forbidden in the disposable Owner-rule fixture");
      return originalFetch(input,init);
    };
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
    await db.query(readFileSync(join(process.cwd(),"../../lib/db/drizzle/0177_direct_student_live_release_reviews.sql"),"utf8"));
    await db.query(`CREATE TABLE school_memberships(id serial PRIMARY KEY,user_id integer,school_id integer,role text,status text);
      INSERT INTO school_memberships(user_id,school_id,role,status) VALUES(9,NULL,'PLATFORM_OWNER','ACTIVE')`);
    await new Promise<void>(resolve=>{server=app.listen(0,"127.0.0.1",()=>{
      const addr=server.address();assert(addr&&typeof addr==="object");
      base=`http://127.0.0.1:${addr.port}`;resolve();
    });});
  });
  afterAll(async()=>{
    if(server){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
    if(db)await db.end();
    globalThis.fetch=originalFetch;vi.useRealTimers();
  });
  beforeEach(async()=>{
    await setFixtureTime(freeFixtureTime);
    await db.query(`UPDATE academic_terms SET name='QA Current',start_date='2026-10-17',
      end_date='2026-11-16',is_current=true,status='ACTIVE' WHERE id=4 AND school_id=1`);
    // These are exclusively the independently verified disposable fixture tables.
    await db.query(`TRUNCATE student_direct_live_release_decisions,student_direct_live_review_bindings,
      student_direct_live_release_requests,student_direct_live_events,student_direct_live_attempts,
      student_direct_live_obligations,student_direct_live_reviews`);
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
  async function boundaryAttempt(){
    const rule=await insert(draft("STUDENT_PLATFORM"));
    const review=(await db.query(`INSERT INTO student_direct_live_reviews
      (school_id,academic_term_id,rule_id,report_digest,merchant_scope,no_split_confirmed,approved_by,expires_at,reason)
      VALUES(1,4,$1,$2,'FICTIONAL',true,9,now()+interval '1 day','Boundary fixture') RETURNING id`,
      [rule.id,"a".repeat(64)])).rows[0];
    const obligation=(await db.query(`INSERT INTO student_direct_live_obligations
      (school_id,student_id,academic_term_id,rule_id,review_id,merchant_scope,created_by)
      VALUES(1,31,4,$1,$2,'FICTIONAL',9) RETURNING id`,[rule.id,review.id])).rows[0];
    return(await appendFinancialHistory(db as any,"attempt",
      [obligation.id,"SCV4_live_boundary_fictional_001","boundary-idempotency-key",9])).rows[0];
  }
  it("serializes competing finalizations and never updates the terminal winner",async()=>{
    const a=await boundaryAttempt();
    const finish=async(transactionId:string)=>{
      const c=await db.connect();
      try{
        await c.query("BEGIN");
        const result=await transitionDirectAttempt(c as any,Number(a.id),{state:"PAID",transactionId,
          providerReference:`fictional-${transactionId}`,providerFeeMinor:5500,additionalFeeMinor:0});
        await appendFinancialHistory(c as any,"event",[a.id,"PROVIDER_PAYMENT_VERIFIED",null,
          JSON.stringify({transactionId})]);
        await c.query("COMMIT");return result;
      }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
    };
    const result=await Promise.allSettled([finish("9001"),finish("9002")]);
    expect(result.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    expect(result.filter(r=>r.status==="rejected")).toHaveLength(1);
    const before=(await db.query("SELECT * FROM student_direct_live_attempts WHERE id=$1",[a.id])).rows[0];
    expect(before.state).toBe("PAID");
    expect((await db.query("SELECT count(*)::int AS n FROM student_direct_live_events WHERE attempt_id=$1",[a.id])).rows[0].n).toBe(1);
    await expect(finish(before.provider_transaction_id)).rejects.toThrow("TRANSITION_FORBIDDEN");
    expect((await db.query("SELECT * FROM student_direct_live_attempts WHERE id=$1",[a.id])).rows[0]).toEqual(before);
  });
  it("rolls back a real attempt transition when its event write fails",async()=>{
    const a=await boundaryAttempt(),before=structuredClone(a),c=await db.connect();
    try{
      await c.query("BEGIN");
      await transitionDirectAttempt(c as any,Number(a.id),{state:"UNKNOWN"});
      // Actual FK failure in PostgreSQL, not a mock transaction.
      await expect(appendFinancialHistory(c as any,"event",[-999,"CHECKOUT_RESPONSE_UNCERTAIN",null,"{}"]))
        .rejects.toMatchObject({code:"23503"});
      await c.query("ROLLBACK");
      expect((await db.query("SELECT * FROM student_direct_live_attempts WHERE id=$1",[a.id])).rows[0]).toEqual(before);
    }finally{await c.query("ROLLBACK");c.release();}
  });
  it("rejects unauthorized internal write callers using current database authority",async()=>{
    const c=await db.connect();
    try{
      await c.query("BEGIN");
      await expect(requireFinancialActor(c as any,9,1)).rejects.toThrow("NOT_AUTHORIZED");
      await expect(requireFinancialActor(c as any,999)).rejects.toThrow("NOT_AUTHORIZED");
      await c.query("UPDATE school_memberships SET status='INACTIVE' WHERE user_id=9");
      await expect(requireFinancialActor(c as any,9)).rejects.toThrow("NOT_AUTHORIZED");
      await expect(decideDirectReleaseReview(db as any,999,{action:"APPROVED",
        reason:"Unauthorized fixture",evidenceDigest:"a".repeat(64),confirmScope:true},999,releaseDeps))
        .rejects.toThrow("NOT_AUTHORIZED");
      await c.query("ROLLBACK");
    }finally{await c.query("ROLLBACK");c.release();}
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
  it("keeps the current term free without rewriting history or allowing LIVE payment, while preserving manual locks",async()=>{
    await db.query("INSERT INTO subscriptions VALUES(71,1,31,'Historical term',5000,'active','verified')");
    const before=(await db.query("SELECT * FROM subscriptions ORDER BY id")).rows;
    expect(await readStudentTermPlatformAccess(db,1,31)).toMatchObject({
      status:"NOT_REQUIRED",restricted:false,termId:null,
    });
    const ctx={user:{id:9,status:"ACTIVE"},roles:[{role:"STUDENT",status:"ACTIVE",schoolId:1}]} as any;
    await expect(enforceRequestSubscription({originalUrl:"/api/library/books",method:"GET",query:{}} as any,ctx))
      .resolves.toBeUndefined();
    const provider=vi.fn(async()=>{throw Error("Provider must never be called");});
    expect(await directStudentReadiness(db as any,{schoolId:1,studentId:31,termId:4},
      {...releaseDeps,fetcher:provider})).toMatchObject({
        ready:false,blockers:["FREE_ROLLOUT_NO_PLATFORM_PAYMENT"],
      });
    await expect(startDirectStudentPayment(db as any,{
      schoolId:1,studentId:31,termId:4,actorId:9,email:"fictional@example.test",idempotencyKey:"free-no-charge-001",
    },{...releaseDeps,fetcher:provider})).rejects.toMatchObject({code:"FREE_ROLLOUT_NO_PLATFORM_PAYMENT"});
    expect(provider).not.toHaveBeenCalled();
    expect((await db.query(`SELECT (SELECT count(*)::int FROM student_direct_live_obligations) AS obligations,
      (SELECT count(*)::int FROM student_direct_live_attempts) AS attempts`)).rows[0])
      .toEqual({obligations:0,attempts:0});
    expect((await db.query("SELECT * FROM subscriptions ORDER BY id")).rows).toEqual(before);
    await db.query("INSERT INTO school_subscription_manual_locks(school_id,locked,version) VALUES(1,true,1)");
    await expect(readStudentPlatformAccess(db,9)).rejects.toMatchObject({statusCode:403});
  });
  it("restricts student core APIs but leaves account/payment/help paths without a subscription lookup",async()=>{
    await enterCollectionTerm();
    const ctx={user:{id:9,status:"ACTIVE"},roles:[{role:"STUDENT",status:"ACTIVE",schoolId:1}]} as any;
    await expect(enforceRequestSubscription({originalUrl:"/api/library/books?studentId=33",method:"GET",query:{studentId:"33"}} as any,ctx))
      .rejects.toMatchObject({statusCode:403,eventType:"STUDENT_PLATFORM_SUBSCRIPTION_REQUIRED"});
    const before=state.queries;
    for(const url of ["/api/auth/me","/api/student/platform-subscription-access","/api/communication/inbox","/api/subscriptions/8/payments/9"])
      await enforceRequestSubscription({originalUrl:url,method:"GET",query:{}} as any,ctx);
    expect(state.queries).toBe(before);
  });
  it("binds platform verification to student/school/term and never treats an active flag, school payment or pending evidence as proof",async()=>{
    await enterCollectionTerm();
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
    // A historical split payment is preserved, never converted into direct proof.
    const legacyPayment=(await db.query("SELECT * FROM student_subscription_payments WHERE id=81")).rows;
    expect((await readStudentTermPlatformAccess(db,1,31)).restricted).toBe(true);
    const proposal=await insert(draft("STUDENT_PLATFORM"));
    const review=(await db.query(`INSERT INTO student_direct_live_reviews
      (school_id,academic_term_id,rule_id,report_digest,merchant_scope,no_split_confirmed,approved_by,expires_at,reason)
      VALUES(1,4,$1,repeat('a',64),'FICTIONAL_NON_SPLIT_MERCHANT',true,9,
        now()+interval '1 day','Fictional verified-proof fixture') RETURNING id`,[proposal.id])).rows[0];
    const obligation=(await db.query(`INSERT INTO student_direct_live_obligations
      (school_id,student_id,academic_term_id,rule_id,review_id,merchant_scope,created_by)
      VALUES(1,31,4,$1,$2,'FICTIONAL_NON_SPLIT_MERCHANT',9) RETURNING id`,[proposal.id,review.id])).rows[0];
    const attempt=(await db.query(`INSERT INTO student_direct_live_attempts
      (obligation_id,reference,idempotency_key,state,provider_transaction_id,provider_reference,
        provider_fee_minor,additional_fee_minor,verified_at,created_by)
      VALUES($1,'SCV4_live_fixture_proof_001','fictional-proof-001','PAID','991','FICTIONAL-991',
        55,0,now(),9) RETURNING id`,[obligation.id])).rows[0];
    expect((await readStudentTermPlatformAccess(db,1,31)).restricted).toBe(true);
    await db.query(`INSERT INTO student_direct_live_events(attempt_id,kind,details)
      VALUES($1,'PROVIDER_PAYMENT_VERIFIED','{"transactionId":"wrong"}')`,[attempt.id]);
    expect((await readStudentTermPlatformAccess(db,1,31)).restricted).toBe(true);
    await db.query(`INSERT INTO student_direct_live_events(attempt_id,kind,details)
      VALUES($1,'PROVIDER_PAYMENT_VERIFIED','{"transactionId":"991"}')`,[attempt.id]);
    expect((await readStudentTermPlatformAccess(db,1,31)).status).toBe("VERIFIED");
    expect((await readStudentPlatformAccess(db,9)).restricted).toBe(false);
    const ctx={user:{id:9,status:"ACTIVE"},roles:[{role:"STUDENT",status:"ACTIVE",schoolId:1}]} as any;
    await expect(enforceRequestSubscription({originalUrl:"/api/library/books",method:"GET",query:{}} as any,ctx)).resolves.toBeUndefined();
    expect((await db.query("SELECT * FROM subscriptions WHERE id=71")).rows).toEqual(historical);
    expect((await db.query("SELECT * FROM student_subscription_payments WHERE id=81")).rows).toEqual(legacyPayment);
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
    await enterCollectionTerm();
    const mock=vi.fn(async()=>{throw Error("Provider was called");});
    const scope={schoolId:1,studentId:31,termId:4};
    const result=await directStudentReadiness(db as any,scope,{env:{NODE_ENV:"test"},fetcher:mock});
    expect(result).toMatchObject({ready:false});
    await expect(startDirectStudentPayment(db as any,{...scope,actorId:9,email:"fictional@example.test",idempotencyKey:"fictional-key-123456"},
      {env:{NODE_ENV:"test"},fetcher:mock})).rejects.toMatchObject({code:"LIVE_DIRECT_CONFIGURATION_AND_RELEASE_REVIEW_REQUIRED"});
    expect(mock).not.toHaveBeenCalled();
    expect((await db.query("SELECT count(*)::int AS n FROM student_direct_live_attempts")).rows[0].n).toBe(0);
  });
  const releaseBase="/platform/direct-student-live";
  async function releaseRequest(){
    const proposal=await insert(draft("STUDENT_PLATFORM"));
    const scope={schoolId:1,termId:4,ruleId:proposal.id};
    const preview=await (await request(`${releaseBase}/readiness?${new URLSearchParams(scope as any)}`)).json() as any;
    const response=await request(`${releaseBase}/reviews`,"POST",{...scope,previewDigest:preview.previewDigest,
      merchantEvidenceReference:"Fictional isolated merchant evidence",merchantEvidenceHash:"c".repeat(64),
      noSplitConfirmed:true,policy:"NEW_ONLY_PRESERVE_LEGACY",
      expiresAt:new Date(Date.now()+86400000).toISOString(),reason:"Fictional fixture scope, no live merchant proof"});
    expect(response.status).toBe(201);
    return{review:await response.json() as any,scope,preview};
  }
  const decide=(review:any,action:string,confirmScope=true)=>request(`${releaseBase}/reviews/${review.id}/decisions`,
    "POST",{action,reason:"Explicit fictional decision",evidenceDigest:review.evidenceDigest,confirmScope});
  it.each([
    {"x-role":"SCHOOL_ADMIN"},{"x-role":"PARENT"},{"x-role":"COMPANY_ACCOUNTANT"},
    {"x-user-status":"INACTIVE"},{"x-role-status":"INACTIVE"},{"x-school":"1"},
  ])("denies unauthorized direct release requests without any DB access: %j",async headers=>{
    for(const [url,method] of [[`${releaseBase}/readiness?schoolId=1&termId=4&ruleId=1`,"GET"],
      [`${releaseBase}/reviews?schoolId=1&termId=4&ruleId=1`,"GET"],
      [`${releaseBase}/reviews`,"POST"],[`${releaseBase}/reviews/1/decisions`,"POST"]]){
      expect((await request(url,method,method==="GET"?undefined:{},headers as any)).status).toBe(403);
    }
    expect(state.connections+state.queries).toBe(0);
  });
  it("keeps GET readiness read-only and requires review plus explicit confirmation before rule scheduling",async()=>{
    await enterCollectionTerm();
    const {review,scope,preview}=await releaseRequest();
    expect(preview.approvalReady).toBe(true);expect(preview.checkoutEnabled).toBe(false);
    expect(review.status).toBe("CREATED");
    expect((await decide(review,"APPROVED")).status).toBe(409);
    expect((await decide(review,"REVIEWED")).status).toBe(200);
    expect((await decide(review,"APPROVED",false)).status).toBe(409);
    const before=(await db.query("SELECT count(*)::int AS n FROM audit_logs")).rows[0].n;
    for(let i=0;i<2;i++)expect((await request(`${releaseBase}/readiness?${new URLSearchParams(scope as any)}`)).status).toBe(200);
    expect((await db.query("SELECT count(*)::int AS n FROM audit_logs")).rows[0].n).toBe(before);
    expect((await db.query("SELECT count(*)::int AS n FROM student_direct_live_reviews")).rows[0].n).toBe(0);
    expect((await decide(review,"APPROVED")).status).toBe(200);
    expect((await db.query("SELECT status FROM subscription_rule_proposals WHERE id=$1",[scope.ruleId])).rows[0].status).toBe("SCHEDULED");
    expect((await db.query("SELECT action FROM student_direct_live_release_decisions ORDER BY id")).rows.map(r=>r.action))
      .toEqual(["REVIEWED","APPROVED"]);
    expect((await db.query("SELECT count(*)::int AS n FROM student_direct_live_review_bindings")).rows[0].n).toBe(1);
    expect((await db.query("SELECT count(*)::int AS n FROM student_direct_live_attempts")).rows[0].n).toBe(0);
    expect((await decide(review,"APPROVED")).status).toBe(409);
    expect((await decide(review,"REJECTED")).status).toBe(200);
    expect((await decide(review,"APPROVED")).status).toBe(409);
    await expect(db.query("DELETE FROM student_direct_live_release_requests WHERE id=$1",[review.id])).rejects.toThrow(/append-only/);
    await expect(db.query("UPDATE student_direct_live_release_decisions SET reason='rewrite history'")).rejects.toThrow(/append-only/);
    await expect(db.query("DELETE FROM student_direct_live_review_bindings")).rejects.toThrow(/append-only/);
    const history=await (await request(`${releaseBase}/reviews?${new URLSearchParams(scope as any)}`)).json() as any;
    expect(history.reviews[0].status).toBe("REJECTED");
    expect(history.reviews[0].events).toHaveLength(3);
    expect(JSON.stringify(history)).not.toContain(releaseEnv.FLUTTERWAVE_LIVE_SECRET_KEY);
    expect(JSON.stringify(history)).not.toContain(releaseEnv.FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH);
  });
  it("separates approval from the runtime release switch and rejects stale merchant, rule and evidence commitments",async()=>{
    const {review,scope}=await releaseRequest();
    expect((await decide(review,"REVIEWED")).status).toBe(200);
    const wrong=await decide({...review,evidenceDigest:"0".repeat(64)},"APPROVED");
    expect(await wrong.json()).toMatchObject({error:"REVIEW_EVIDENCE_MISMATCH"});
    const prior=releaseEnv.EDUCORE_FLUTTERWAVE_MERCHANT_SCOPE;
    try{
      releaseEnv.EDUCORE_FLUTTERWAVE_MERCHANT_SCOPE="OTHER_FICTIONAL_MERCHANT";
      expect(await (await decide(review,"APPROVED")).json()).toMatchObject({error:"STALE_REVIEW_EVIDENCE"});
    }finally{releaseEnv.EDUCORE_FLUTTERWAVE_MERCHANT_SCOPE=prior;}
    await db.query("UPDATE subscription_rule_proposals SET version=version+1 WHERE id=$1",[scope.ruleId]);
    expect(await (await decide(review,"APPROVED")).json()).toMatchObject({error:"STALE_REVIEW_EVIDENCE"});
    expect((await db.query("SELECT count(*)::int AS n FROM student_direct_live_reviews")).rows[0].n).toBe(0);
    // No legacy split release marker can replace the direct runtime switch.
    expect(await directStudentReadiness(db as any,{schoolId:1,termId:4,studentId:31},
      {...releaseDeps,env:{...releaseEnv,EDUCORE_FLUTTERWAVE_DIRECT_RELEASE:undefined,EDUCORE_FLUTTERWAVE_RELEASE:"SCV3_V1"}}))
      .toMatchObject({ready:false});
  });
  it("rejects a changed reconciliation digest and incomplete evidence, not just a matching Owner checkbox",async()=>{
    const {review,scope}=await releaseRequest();
    await decide(review,"REVIEWED");
    await expect(decideDirectReleaseReview(db as any,review.id,{
      action:"APPROVED",evidenceDigest:review.evidenceDigest,reason:"Synthetic stale report",confirmScope:true,
    },9,{...releaseDeps,report:async()=>({...await fictionalReport(),evidenceDigest:"d".repeat(64)}) as any}))
      .rejects.toMatchObject({code:"STALE_REVIEW_EVIDENCE"});
    const current=await previewDirectRelease(db as any,scope,{...releaseDeps,
      report:async()=>({...await fictionalReport(),sourceStatus:"INCOMPLETE"}) as any});
    expect(current.approvalReady).toBe(false);
    expect(current.checks.find(c=>c.code==="RECONCILIATION")?.status).toBe("BLOCKED");
    const invalid=await request(`${releaseBase}/reviews`,"POST",{...scope,previewDigest:review.previewDigest,
      merchantEvidenceReference:"short",merchantEvidenceHash:"bad",noSplitConfirmed:false});
    expect(invalid.status).toBe(400);
  });
  it("fails closed when required schema/history protection is missing and never writes on inspection",async()=>{
    await enterCollectionTerm();
    const c=await db.connect();
    try{
      expect((await inspectDirectReleaseSchema(c)).ready).toBe(true);
      await c.query("ALTER TABLE student_direct_live_release_decisions DISABLE TRIGGER student_direct_release_decision_history");
      expect((await inspectDirectReleaseSchema(c)).ready).toBe(false);
      const scope={schoolId:1,studentId:31,termId:4};
      expect(await directStudentReadiness(db as any,scope,releaseDeps)).toMatchObject({
        ready:false,blockers:["DIRECT_RELEASE_SCHEMA_REQUIRED"]});
    }finally{
      await c.query("ALTER TABLE student_direct_live_release_decisions ENABLE TRIGGER student_direct_release_decision_history");
      c.release();
    }
  });
  it.each([
    {action:"REJECTED" as const,missing:false},{action:"REJECTED" as const,missing:true},
    {action:"EXPIRED" as const,missing:false},{action:"EXPIRED" as const,missing:true},
  ])("blocks $action with a missing/disabled decision guard (missing=$missing)",async({action,missing})=>{
    const {review}=await releaseRequest();
    if(action==="EXPIRED")await setFixtureTime(new Date(Date.parse(review.expiresAt)+1).toISOString());
    const before=(await db.query("SELECT * FROM audit_logs ORDER BY id")).rows;
    const c=await db.connect();
    try{
      expect((await inspectDirectReleaseSchema(c)).ready).toBe(true);
      await c.query(missing
        ?"DROP TRIGGER student_direct_release_decision_history ON student_direct_live_release_decisions"
        :"ALTER TABLE student_direct_live_release_decisions DISABLE TRIGGER student_direct_release_decision_history");
      await expect(decideDirectReleaseReview(db as any,review.id,{
        action,reason:"Fixture must fail closed",evidenceDigest:review.evidenceDigest,confirmScope:true,
      },9,releaseDeps)).rejects.toMatchObject({code:"DIRECT_RELEASE_SCHEMA_REQUIRED"});
      expect((await db.query("SELECT * FROM student_direct_live_release_decisions")).rows).toEqual([]);
      expect((await db.query("SELECT * FROM audit_logs ORDER BY id")).rows).toEqual(before);
    }finally{
      await c.query(missing
        ?`CREATE TRIGGER student_direct_release_decision_history BEFORE UPDATE OR DELETE
          ON student_direct_live_release_decisions FOR EACH ROW EXECUTE FUNCTION guard_student_direct_history()`
        :"ALTER TABLE student_direct_live_release_decisions ENABLE TRIGGER student_direct_release_decision_history");
      c.release();
    }
    // With the exact guard restored, the same otherwise-valid decision succeeds.
    expect((await decide(review,action)).status).toBe(200);
  });
  it("blocks callback and webhook for one missing procedural object with the remaining schema valid",async()=>{
    const attempt=await boundaryAttempt(),c=await db.connect();
    const realFetch=globalThis.fetch,provider=vi.fn();
    const spy=vi.spyOn(globalThis,"fetch").mockImplementation(async(url,init)=>{
      if(String(url).startsWith(base+"/"))return realFetch(url,init);
      provider();
      throw new Error("External provider access is forbidden in missing-guard test");
    });
    try{
      for(const [key,value] of Object.entries(releaseEnv))vi.stubEnv(key,value!);
      expect((await inspectDirectReleaseSchema(c)).ready).toBe(true);
      await c.query("DROP TRIGGER student_direct_event_history ON student_direct_live_events");
      expect(await inspectDirectReleaseSchema(c)).toEqual({
        ready:false,issues:["GUARD_TRIGGER_DEFINITION:student_direct_event_history"],
      });
      const before=(await db.query("SELECT * FROM student_direct_live_attempts ORDER BY id")).rows;
      const events=(await db.query("SELECT * FROM student_direct_live_events ORDER BY id")).rows;
      for(const response of [
        await request(`/flutterwave/direct-student/callback?tx_ref=${attempt.reference}&transaction_id=990`),
        await request("/fixture-direct-webhook","POST",
          {event:"charge.completed",data:{id:990,tx_ref:attempt.reference}},
          {"verif-hash":releaseEnv.FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH!}),
      ]){
        expect(response.status).toBe(409);
        expect(await response.json()).toEqual({error:"DIRECT_RELEASE_SCHEMA_REQUIRED"});
      }
      expect(provider).not.toHaveBeenCalled();
      expect((await db.query("SELECT * FROM student_direct_live_attempts ORDER BY id")).rows).toEqual(before);
      expect((await db.query("SELECT * FROM student_direct_live_events ORDER BY id")).rows).toEqual(events);
    }finally{
      await c.query(`CREATE TRIGGER student_direct_event_history BEFORE UPDATE OR DELETE
        ON student_direct_live_events FOR EACH ROW EXECUTE FUNCTION guard_student_direct_history()`);
      c.release();spy.mockRestore();vi.unstubAllEnvs();
    }
  });
  it("derives expiry on GET without a write; an explicit expiry decision appends history",async()=>{
    const proposal=await insert(draft("STUDENT_PLATFORM")),scope={schoolId:1,termId:4,ruleId:proposal.id};
    const preview=await previewDirectRelease(db as any,scope,releaseDeps);
    const review=await createDirectReleaseReview(db as any,{...scope,previewDigest:preview.previewDigest,
      merchantEvidenceReference:"Fictional short-lived evidence",merchantEvidenceHash:"e".repeat(64),
      noSplitConfirmed:true,policy:"NEW_ONLY_PRESERVE_LEGACY",reason:"Fictional expiry fixture",
      expiresAt:new Date(Date.now()+600).toISOString()},9,releaseDeps);
    expect((await decide(review,"EXPIRED")).status).toBe(409);
    await setFixtureTime(new Date(Date.now()+650).toISOString());
    const listed=await (await request(`${releaseBase}/reviews?${new URLSearchParams(scope as any)}`)).json() as any;
    expect(listed.reviews[0].status).toBe("EXPIRED");
    expect((await db.query("SELECT count(*)::int AS n FROM student_direct_live_release_decisions")).rows[0].n).toBe(0);
    expect((await decide(review,"EXPIRED")).status).toBe(200);
    expect((await decide(review,"APPROVED")).status).toBe(409);
  });
  it("keeps a lost checkout response permanently claimed; authenticated webhook readback alone unlocks the exact student-term",async()=>{
    await enterCollectionTerm();
    const proposal=await insert(draft("STUDENT_PLATFORM"));
    await db.query("UPDATE subscription_rule_proposals SET status='ACTIVE',effective_at=now()-interval '1 day' WHERE id=$1",[proposal.id]);
    const scope={schoolId:1,termId:4,ruleId:proposal.id},preview=await previewDirectRelease(db as any,scope,releaseDeps);
    const review=await createDirectReleaseReview(db as any,{...scope,previewDigest:preview.previewDigest,
      merchantEvidenceReference:"Fictional lost-response merchant review",merchantEvidenceHash:"a".repeat(64),
      noSplitConfirmed:true,policy:"NEW_ONLY_PRESERVE_LEGACY",reason:"Isolated concurrency fixture",
      expiresAt:new Date(Date.now()+86400000).toISOString()},9,releaseDeps);
    await decideDirectReleaseReview(db as any,review.id,{action:"REVIEWED",reason:"Fictional review",
      evidenceDigest:review.evidenceDigest,confirmScope:true},9,releaseDeps);
    await decideDirectReleaseReview(db as any,review.id,{action:"APPROVED",reason:"Fictional approval",
      evidenceDigest:review.evidenceDigest,confirmScope:true},9,releaseDeps);
    const lost=vi.fn(async()=>{throw new Error("Synthetic accepted checkout then lost response");});
    await db.query(`INSERT INTO app_users VALUES(10,'Fictional','School Admin','ACTIVE') ON CONFLICT DO NOTHING;
      INSERT INTO school_memberships(user_id,school_id,role,status)
      SELECT 10,1,'SCHOOL_ADMIN','ACTIVE' WHERE NOT EXISTS(SELECT 1 FROM school_memberships WHERE user_id=10)`);
    const input={schoolId:1,studentId:31,termId:4,actorId:10,email:"fictional@example.test"};
    const results=await Promise.allSettled(["uncertain-reference-001","uncertain-reference-002"].map(idempotencyKey=>
      startDirectStudentPayment(db as any,{...input,idempotencyKey},{...releaseDeps,fetcher:lost as any})));
    expect(results.map(r=>r.status)).toEqual(["rejected","rejected"]);expect(lost).toHaveBeenCalledTimes(1);
    const attempt=(await db.query("SELECT * FROM student_direct_live_attempts")).rows[0];
    expect(attempt.state).toBe("UNKNOWN");
    await expect(startDirectStudentPayment(db as any,{...input,idempotencyKey:"uncertain-reference-003"},
      {...releaseDeps,fetcher:lost as any})).rejects.toMatchObject({code:"EXISTING_ATTEMPT_RECONCILIATION_REQUIRED"});
    expect(lost).toHaveBeenCalledTimes(1);
    const realFetch=globalThis.fetch;let verified=false,providerGets=0;
    const spy=vi.spyOn(globalThis,"fetch").mockImplementation(async(url,init)=>{
      const address=String(url);
      if(address.startsWith(base+"/"))return realFetch(url,init);
      if(address!=="https://api.flutterwave.com/v3/transactions/990/verify")throw new Error("Unexpected fixture network request blocked");
      providerGets++;
      return Response.json({status:"success",data:{id:990,tx_ref:attempt.reference,currency:"NGN",
        amount:3200,charged_amount:verified?3200:0,status:verified?"successful":"pending",
        flw_ref:"FICTIONAL-990",app_fee:55,merchant_fee:0}});
    });
    try{
      for(const [key,value] of Object.entries(releaseEnv))vi.stubEnv(key,value!);
      expect(await readStudentTermPlatformAccess(db as any,1,31)).toMatchObject({restricted:true,status:"PAYMENT_REQUIRED"});
      const webhook={event:"charge.completed",data:{id:990,tx_ref:attempt.reference,status:"successful"}};
      expect((await request("/fixture-direct-webhook","POST",webhook,{"verif-hash":"wrong"})).status).toBe(401);
      expect(providerGets).toBe(0);
      expect((await request("/fixture-direct-webhook","POST",webhook,
        {"verif-hash":releaseEnv.FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH!})).status).toBe(200);
      expect((await db.query("SELECT state FROM student_direct_live_attempts")).rows[0].state).toBe("PENDING");
      expect(await readStudentTermPlatformAccess(db as any,1,31)).toMatchObject({restricted:true});
      verified=true;
      const finalizers=await Promise.all([
        request("/fixture-direct-webhook","POST",webhook,{"verif-hash":releaseEnv.FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH!}),
        request(`/flutterwave/direct-student/callback?tx_ref=${attempt.reference}&transaction_id=990`),
      ]);
      expect(finalizers.map(r=>r.status)).toEqual([200,200]);
      expect(await readStudentTermPlatformAccess(db as any,1,31)).toMatchObject({restricted:false,status:"VERIFIED",termId:4});
      expect(await readStudentTermPlatformAccess(db as any,1,33)).toMatchObject({restricted:true});
      expect(providerGets).toBe(3);
      expect((await db.query("SELECT count(*)::int AS n FROM student_direct_live_events WHERE kind='PROVIDER_PAYMENT_VERIFIED'")).rows[0].n).toBe(1);
    }finally{spy.mockRestore();vi.unstubAllEnvs();}
  });
  it("keeps the School Admin platform action TEST-only and blocked without a direct release, rejecting amount and school tampering",async()=>{
    await enterCollectionTerm();
    const prior=process.env.NODE_ENV;process.env.NODE_ENV="development";
    try{
      const url="/schools/1/platform-subscriptions";
      const headers={"x-role":"SCHOOL_ADMIN"};
      const readiness=await request(`${url}/live-readiness?studentId=31&termId=4`,"GET",undefined,headers);
      expect(readiness.status).toBe(200);
      expect(readiness.headers.get("content-type")).toContain("application/json");
      expect(await readiness.json()).toMatchObject({ready:false,amountMinor:320000,currency:"NGN",
        schoolShareMinor:0,broShareMinor:0,mode:"TEST_ONLY",providerValidated:false});
      expect((await request(`${url}/checkout`,"POST",{studentId:31,termId:4,amountMinor:500000},headers)).status).toBe(400);
      expect((await request("/schools/2/platform-subscriptions/checkout","POST",{studentId:31,termId:4},headers)).status).toBe(403);
      const blocked=await request(`${url}/checkout`,"POST",{studentId:31,termId:4},
        {...headers,"Idempotency-Key":"fictional-no-charge-001"});
      expect(blocked.status).toBe(409);
      expect(await blocked.json()).toMatchObject({error:"LIVE_DIRECT_CONFIGURATION_AND_RELEASE_REVIEW_REQUIRED"});
      expect((await db.query("SELECT count(*)::int AS n FROM student_direct_live_obligations")).rows[0].n).toBe(0);
      expect((await db.query("SELECT count(*)::int AS n FROM student_direct_live_attempts")).rows[0].n).toBe(0);
    }finally{process.env.NODE_ENV=prior;}
  });
  it("uses only a reviewed direct 3200 scope, stores verified attempts once and reuses a reference without another provider POST",async()=>{
    await enterCollectionTerm();
    const approvedDigest="f".repeat(64);
    const env={
      NODE_ENV:"production",EDUCORE_FLUTTERWAVE_MODE:"LIVE",
      FLUTTERWAVE_LIVE_SECRET_KEY:"FLWSECK-FAKE-NO-NETWORK",
      FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH:"synthetic-webhook-not-live",
      EDUCORE_FLUTTERWAVE_DIRECT_RELEASE:"STUDENT_DIRECT_3200_V1",
      EDUCORE_FLUTTERWAVE_DIRECT_CALLBACK_URL:"https://example.invalid/api/flutterwave/direct-student/callback",
      EDUCORE_FLUTTERWAVE_DIRECT_WEBHOOK_URL:"https://example.invalid/api/webhooks/flutterwave/direct-student",
      EDUCORE_FLUTTERWAVE_MERCHANT_SCOPE:"FICTIONAL_NON_SPLIT_MERCHANT",
    };
    const proposal=await insert(draft("STUDENT_PLATFORM"));
    // Only the disposable fixture simulates an already effective, separately approved rule.
    await db.query("UPDATE subscription_rule_proposals SET status='ACTIVE',effective_at=now()-interval '1 day' WHERE id=$1",[proposal.id]);
    // An old unbound approval, including a legacy-style inserted record, has no authority.
    await db.query(`INSERT INTO student_direct_live_reviews
      (school_id,academic_term_id,rule_id,report_digest,merchant_scope,no_split_confirmed,approved_by,expires_at,reason)
      VALUES(1,4,$1,$2,'FICTIONAL_NON_SPLIT_MERCHANT',true,9,now()+interval '1 day','Unbound historical fixture review')`,
      [proposal.id,approvedDigest]);
    const report=async()=>({sourceStatus:"COMPLETE",evidenceDigest:approvedDigest,rows:[
      {studentId:31,status:"NEW_OBLIGATION_AFTER_REVIEW"},{studentId:33,status:"NEW_OBLIGATION_AFTER_REVIEW"}]}) as any;
    expect(await directStudentReadiness(db as any,{schoolId:1,studentId:31,termId:4},{env,report}))
      .toMatchObject({ready:false});
    const releaseScope={schoolId:1,termId:4,ruleId:proposal.id};
    const preview=await previewDirectRelease(db as any,releaseScope,{env,report});
    const review=await createDirectReleaseReview(db as any,{...releaseScope,previewDigest:preview.previewDigest,
      merchantEvidenceReference:"Fictional isolated merchant report",merchantEvidenceHash:"b".repeat(64),
      noSplitConfirmed:true,policy:"NEW_ONLY_PRESERVE_LEGACY",expiresAt:new Date(Date.now()+86400000).toISOString(),
      reason:"Synthetic non-split evidence, never actual merchant proof"},9,{env,report});
    const decision={reason:"Reviewed synthetic release",evidenceDigest:review.evidenceDigest,confirmScope:true};
    await decideDirectReleaseReview(db as any,review.id,{...decision,action:"REVIEWED"},9,{env,report});
    await decideDirectReleaseReview(db as any,review.id,{...decision,action:"APPROVED"},9,{env,report});
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
    await db.query(`INSERT INTO app_users VALUES(10,'Fictional','School Admin','ACTIVE') ON CONFLICT DO NOTHING;
      INSERT INTO school_memberships(user_id,school_id,role,status)
      SELECT 10,1,'SCHOOL_ADMIN','ACTIVE' WHERE NOT EXISTS(SELECT 1 FROM school_memberships WHERE user_id=10)`);
    const scope={schoolId:1,studentId:31,termId:4,actorId:10,email:"fixture@example.test"};
    await expect(startDirectStudentPayment(db as any,{...scope,actorId:9,idempotencyKey:"owner-not-school-001"},deps))
      .rejects.toThrow("FINANCIAL_ACTOR_NOT_AUTHORIZED");
    expect(calls).toHaveLength(0);
    await expect(verifyDirectStudentPayment(db as any,{reference:"SCV4_live_unknown_reference_001",
      transactionId:"901",actorId:null},deps)).rejects.toMatchObject({code:"UNKNOWN_REFERENCE"});
    expect(calls).toHaveLength(0);
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
    await expect(assertVerifiedStudentNfcPayment(db as any,1,31)).rejects.toMatchObject({eventType:"NFC_FLUTTERWAVE_PAYMENT_REQUIRED"});
    states.set("901","successful");
    // Observe BOTH independent verifiers waiting on the real attempt row, then
    // release it. Concurrent delivery must commit one terminal result/event.
    const held=await db.connect();
    let concurrent:Promise<any[]>|undefined;
    try{
      await held.query("BEGIN");
      await held.query("SELECT id FROM student_direct_live_attempts WHERE reference=$1 FOR UPDATE",[first.reference]);
      concurrent=Promise.all([1,2].map(()=>verifyDirectStudentPayment(db as any,
        {reference:first.reference,transactionId:"901",actorId:null},deps)));
      void concurrent.catch(()=>undefined);
      let blocked=0;
      const deadline=process.hrtime.bigint()+5_000_000_000n;
      while(blocked<2 && process.hrtime.bigint()<deadline){
        blocked=Number((await db.query(`SELECT count(*) AS n FROM pg_stat_activity
          WHERE datname=current_database() AND state='active' AND wait_event_type='Lock'
            AND query LIKE '%SELECT * FROM student_direct_live_attempts WHERE reference=%FOR UPDATE%'`)).rows[0].n);
      }
      expect(blocked).toBe(2);
      expect((await db.query("SELECT state FROM student_direct_live_attempts WHERE reference=$1",[first.reference])).rows[0].state)
        .toBe("PENDING");
    }finally{
      await held.query("ROLLBACK");held.release();
    }
    const [paid,replayed]=await concurrent!;
    expect(replayed.state).toBe("PAID");
    expect(paid.state).toBe("PAID");
    await expect(assertVerifiedStudentNfcPayment(db as any,1,31)).resolves.toBeUndefined();
    await expect(assertVerifiedStudentNfcPayment(db as any,2,31)).rejects.toMatchObject({eventType:"NFC_FLUTTERWAVE_PAYMENT_REQUIRED"});
    await expect(assertVerifiedStudentNfcPayment(db as any,1,33)).rejects.toMatchObject({eventType:"NFC_FLUTTERWAVE_PAYMENT_REQUIRED"});
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
    const second={...scope,actorId:9,studentId:33,idempotencyKey:"fictional-assisted-001",assistanceId};
    await expect(startDirectStudentPayment(db as any,{...second,actorId:10},deps))
      .rejects.toThrow("FINANCIAL_ACTOR_NOT_AUTHORIZED");
    // Offline/cash help may start a NEW checkout without inventing bank evidence.
    // Merely reserving that checkout must never create a paid entitlement.
    const requestedCheckout=await startDirectStudentPayment(db as any,second,deps);
    expect(requestedCheckout?.state).toBe("READY");
    await expect(assertVerifiedStudentNfcPayment(db as any,1,33)).rejects.toMatchObject({eventType:"NFC_FLUTTERWAVE_PAYMENT_REQUIRED"});
    expect((await db.query("SELECT status FROM subscription_payment_assistance_requests WHERE id=$1",[assistanceId])).rows[0].status)
      .toBe("REQUESTED");
    expect((await db.query(`SELECT count(*)::int AS n FROM student_direct_live_attempts a
      JOIN student_direct_live_obligations o ON o.id=a.obligation_id WHERE o.student_id=33 AND a.state='PAID'`)).rows[0].n).toBe(0);
    const bank=await request(`${queue}/${assistanceId}/verify-bank`,"POST",
      {bankName:"Fictional Test Bank",bankStatementReference:"FICTIONAL-INDEPENDENT-CREDIT-01",
        creditDate:new Date().toISOString().slice(0,10),verifiedAmountMinor:320000,independentlyChecked:true});
    expect(bank.status).toBe(200);
    await expect(assertVerifiedStudentNfcPayment(db as any,1,33)).rejects.toMatchObject({eventType:"NFC_FLUTTERWAVE_PAYMENT_REQUIRED"});
    const bankSnapshot=(await db.query("SELECT * FROM subscription_payment_assistance_requests WHERE id=$1",[assistanceId])).rows;
    // Simulate absent audit authority on this disposable fixture, then restore the original evidence.
    await db.query(`UPDATE audit_logs SET event_type='FICTIONAL_MISSING_AUDIT'
      WHERE record_id=$1 AND event_type='SUBSCRIPTION_RULE_BANK_CREDIT_VERIFIED'`,[assistanceId]);
    await expect(startDirectStudentPayment(db as any,{...scope,actorId:9,studentId:33,assistanceId,idempotencyKey:"no-audit-bank-001"},deps))
      .rejects.toMatchObject({code:"INDEPENDENT_BANK_CREDIT_REQUIRED"});
    await db.query(`UPDATE audit_logs SET event_type='SUBSCRIPTION_RULE_BANK_CREDIT_VERIFIED'
      WHERE record_id=$1 AND event_type='FICTIONAL_MISSING_AUDIT'`,[assistanceId]);
    const secondAttempt=await startDirectStudentPayment(db as any,second,deps);
    assert.ok(secondAttempt);
    txReferences.set("902",secondAttempt.reference);
    expect(secondAttempt.state).toBe("READY");
    expect((await verifyDirectStudentPayment(db as any,{reference:secondAttempt.reference,transactionId:"902",actorId:null},deps)).state).toBe("FAILED");
    await expect(assertVerifiedStudentNfcPayment(db as any,1,33)).rejects.toMatchObject({eventType:"NFC_FLUTTERWAVE_PAYMENT_REQUIRED"});
    const retry=await startDirectStudentPayment(db as any,{...second,idempotencyKey:"fictional-assisted-002"},deps);
    assert.ok(retry);
    txReferences.set("903",retry.reference);
    expect(retry.reference).not.toBe(secondAttempt.reference);
    expect((await verifyDirectStudentPayment(db as any,{reference:retry.reference,transactionId:"903",actorId:null},deps)).state).toBe("PAID");
    await expect(assertVerifiedStudentNfcPayment(db as any,1,33)).resolves.toBeUndefined();
    expect((await db.query("SELECT * FROM subscription_payment_assistance_requests WHERE id=$1",[assistanceId])).rows)
      .toEqual(bankSnapshot);
    expect((await db.query("SELECT count(*)::int AS n FROM student_direct_live_obligations WHERE student_id=33")).rows[0].n).toBe(1);
    expect((await db.query("SELECT count(*)::int AS n FROM student_direct_live_attempts WHERE state='PAID' AND obligation_id IN (SELECT id FROM student_direct_live_obligations WHERE student_id=33)")).rows[0].n).toBe(1);
    expect((await db.query("SELECT count(*)::int AS n FROM subscriptions")).rows[0].n).toBe(0);
    expect((await db.query("SELECT count(*)::int AS n FROM student_subscription_payments")).rows[0].n).toBe(0);
    // Test-only configuration never becomes a credential in the application database or UI.
    expect(JSON.stringify((await db.query("SELECT details FROM student_direct_live_events")).rows))
      .not.toContain(env.FLUTTERWAVE_LIVE_SECRET_KEY);
    expect(await directStudentReadiness(db as any,{schoolId:2,studentId:31,termId:4},deps)).toMatchObject({ready:false});
    expect(await directStudentReadiness(db as any,{schoolId:1,studentId:31,termId:5},deps)).toMatchObject({ready:false});
    expect(await directStudentReadiness(db as any,{schoolId:1,studentId:31,termId:4},{...deps,env:{...env,
      EDUCORE_FLUTTERWAVE_DIRECT_CALLBACK_URL:"https://other.invalid/api/flutterwave/direct-student/callback",
      EDUCORE_FLUTTERWAVE_DIRECT_WEBHOOK_URL:"https://other.invalid/api/webhooks/flutterwave/direct-student"}}))
      .toMatchObject({ready:false});
    const newer=await createDirectReleaseReview(db as any,{...releaseScope,previewDigest:preview.previewDigest,
      merchantEvidenceReference:"Newer fictional merchant report",merchantEvidenceHash:"c".repeat(64),
      noSplitConfirmed:true,policy:"NEW_ONLY_PRESERVE_LEGACY",expiresAt:new Date(Date.now()+3600000).toISOString(),
      reason:"Renewed synthetic approval"},9,{env,report});
    await decideDirectReleaseReview(db as any,newer.id,{...decision,evidenceDigest:newer.evidenceDigest,action:"REVIEWED"},9,{env,report});
    await decideDirectReleaseReview(db as any,newer.id,{...decision,evidenceDigest:newer.evidenceDigest,action:"APPROVED"},9,{env,report});
    expect(await directStudentReadiness(db as any,{schoolId:1,studentId:31,termId:4},deps)).toMatchObject({ready:true});
    await decideDirectReleaseReview(db as any,newer.id,{...decision,evidenceDigest:newer.evidenceDigest,action:"REJECTED"},9,{env,report});
    expect(await directStudentReadiness(db as any,{schoolId:1,studentId:31,termId:4},deps)).toMatchObject({ready:false});
    expect((await db.query("SELECT count(*)::int AS n FROM student_direct_live_attempts WHERE state='PAID'")).rows[0].n).toBe(2);
  });
});
