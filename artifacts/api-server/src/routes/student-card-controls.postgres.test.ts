import express from "express";
import {Pool} from "pg";
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";

const fixture=vi.hoisted(()=>({db:null as any,role:"PLATFORM_OWNER",paid:true,subscription:true,schoolLocked:false,
  queries:[] as string[]}));
vi.mock("@workspace/db",()=>({pool:{
  query:(sql:string,v?:any[])=>{fixture.queries.push(sql);return fixture.db.query(sql,v);},
  connect:()=>fixture.db.connect(),
}}));
vi.mock("../middlewares/auth",async original=>{
  const actual=await original<typeof import("../middlewares/auth")>();
  return {...actual,requireAuthentication:()=> (req:any,_res:any,next:any)=>{
    req.edupulseUser={user:{id:9,status:"ACTIVE"},roles:[{role:fixture.role,status:"ACTIVE",schoolId:fixture.role==="PLATFORM_OWNER"?null:2}]};
    next();
  }};
});
vi.mock("../services/subscription-enforcement",()=>({assertSubscriptionAccess:async()=>{
  const {AuthError}=await import("../middlewares/auth");
  if(fixture.schoolLocked)throw new AuthError(403,"School manually locked","SCHOOL_SUBSCRIPTION_LOCKED");
  if(!fixture.subscription)throw new AuthError(403,"Student payment required","STUDENT_PLATFORM_SUBSCRIPTION_REQUIRED");
}}));
vi.mock("../services/student-nfc-payment-evidence",()=>({assertVerifiedStudentNfcPayment:async()=>{
  const {AuthError}=await import("../middlewares/auth");
  if(!fixture.paid)throw new AuthError(409,"Current term NFC payment required","NFC_FLUTTERWAVE_PAYMENT_REQUIRED");
}}));
import router from "./uid-inventory-assignment";
import {assertCardPaymentRestriction,readStudentCardGrace} from "../services/student-card-controls";
import {assertVerifiedStudentNfcPayment} from "../services/student-nfc-payment-evidence";
import {studentNfcCardLookupSql} from "../lib/nfc-device-first";
import {AuthError} from "../middlewares/auth";

const socket=process.env.STUDENT_CARD_CONTROLS_TEST_SOCKET;
describe.skipIf(!socket)("Owner card controls on an isolated PostgreSQL fixture",()=>{
  let db:Pool,base:string,server:ReturnType<ReturnType<typeof express>["listen"]>;
  beforeAll(async()=>{
    if(!socket?.startsWith("/tmp/educore-card-controls-") || process.env.REPLIT_DEPLOYMENT)
      throw Error("A disposable, local Unix-socket fixture is required");
    db=new Pool({host:socket,port:55446,user:"card_controls_fixture",database:"card_controls_fixture",max:8});
    const identity=(await db.query(`SELECT current_database() db,current_user role,inet_server_addr() addr,
      current_setting('data_directory') directory`)).rows[0];
    if(identity.db!=="card_controls_fixture" || identity.role!=="card_controls_fixture" ||
        identity.addr!==null || identity.directory!==`${socket}/data`)throw Error("Wrong test database");
    fixture.db=db;
    await db.query(`
      DROP SCHEMA public CASCADE;
      CREATE SCHEMA public;
      CREATE TABLE schools(id int PRIMARY KEY,status text);
      CREATE TABLE students(id int PRIMARY KEY,school_id int REFERENCES schools(id),status text);
      CREATE TABLE nfc_cards(id int PRIMARY KEY,school_id int REFERENCES schools(id),uid text,student_id int REFERENCES students(id),
        status text,replaced_by_card_id int,replaced_at timestamptz,expires_at timestamptz);
      CREATE TABLE employee_nfc_card_bindings(id int PRIMARY KEY,nfc_card_id int REFERENCES nfc_cards(id));
      CREATE TABLE nfc_card_history(id serial PRIMARY KEY,school_id int REFERENCES schools(id),nfc_card_id int REFERENCES nfc_cards(id),
        student_id int REFERENCES students(id),action text,previous_status text,new_status text,actor_user_id int,reason text,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp());
      CREATE INDEX card_history_lookup ON nfc_card_history(nfc_card_id,created_at);
      CREATE TABLE student_identification_policies(school_id int,student_id int,status text,policy text);
      CREATE TABLE platform_devices(id int PRIMARY KEY,serial_number text,name text,device_type text,status text,location text,
        school_id int,configuration_status text);
      CREATE TABLE device_school_bindings(device_id int,school_id int);
      CREATE TABLE academic_sessions(id int PRIMARY KEY,school_id int,status text,is_current boolean);
      CREATE TABLE academic_terms(id int PRIMARY KEY,school_id int,academic_session_id int REFERENCES academic_sessions(id),
        status text,is_current boolean,start_date date,end_date date);
      CREATE TABLE audit_logs(id serial PRIMARY KEY,"user" text,role text,actor_user_id int,school_id int,action text,module text,
        record_id int,event_type text,result text,metadata jsonb);
      CREATE TABLE student_direct_live_obligations(id int PRIMARY KEY,payload jsonb);
      CREATE TABLE student_direct_live_attempts(id int PRIMARY KEY,payload jsonb);
      CREATE TABLE student_direct_live_events(id int PRIMARY KEY,payload jsonb);
      INSERT INTO student_direct_live_obligations VALUES(1,'{"amountMinor":320000,"state":"UNPAID"}');
      INSERT INTO student_direct_live_attempts VALUES(1,'{"state":"PENDING","reference":"fixture-preserve"}');
      INSERT INTO student_direct_live_events VALUES(1,'{"kind":"UNCHANGED"}');
      CREATE FUNCTION immutable_card_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Test evidence is append only'; END $$;
      CREATE TRIGGER retain_history BEFORE UPDATE OR DELETE ON nfc_card_history
        FOR EACH ROW EXECUTE FUNCTION immutable_card_evidence();
      CREATE TRIGGER retain_audit BEFORE UPDATE OR DELETE ON audit_logs
        FOR EACH ROW EXECUTE FUNCTION immutable_card_evidence();
    `);
    const app=express();app.use(express.json());app.use(router);
    app.use((error:any,_req:any,res:any,_next:any)=>res.status(error.statusCode??400).json({error:error.message}));
    await new Promise<void>(resolve=>{server=app.listen(0,"127.0.0.1",()=>resolve());});
    const a=server.address() as {port:number};base=`http://127.0.0.1:${a.port}`;
  });
  afterAll(async()=>{await new Promise<void>(resolve=>server.close(()=>resolve()));await db.end();});
  beforeEach(async()=>{
    fixture.role="PLATFORM_OWNER";fixture.paid=true;fixture.subscription=true;fixture.schoolLocked=false;fixture.queries=[];
    await db.query(`TRUNCATE audit_logs,nfc_card_history,employee_nfc_card_bindings,nfc_cards,students,schools,
      student_identification_policies,platform_devices,device_school_bindings,academic_terms,academic_sessions RESTART IDENTITY CASCADE;
      INSERT INTO schools VALUES(2,'ACTIVE');
      INSERT INTO students VALUES(3,2,'ACTIVE'),(4,2,'ACTIVE');
      INSERT INTO nfc_cards(id,school_id,uid,student_id,status) VALUES(101,2,'AABB1234',3,'active');
      INSERT INTO nfc_card_history(school_id,nfc_card_id,student_id,action,new_status,reason,actor_user_id)
        VALUES(2,101,3,'REGISTERED','locked','Original staged activation',9),(2,101,3,'STATUS_CHANGED','active','Original activation',9);
      INSERT INTO student_identification_policies VALUES(2,3,'ACTIVE','NFC_ONLY');
      INSERT INTO platform_devices VALUES(10,'fixture','Fixture reader','NFC','ACTIVE','Gate',2,'CONFIGURED');
      INSERT INTO device_school_bindings VALUES(10,2);
      INSERT INTO academic_sessions VALUES(20,2,'ACTIVE',true);
      INSERT INTO academic_terms VALUES(30,2,20,'ACTIVE',true,CURRENT_DATE-10,CURRENT_DATE+30);`);
  });
  async function readiness(){
    const r=await fetch(`${base}/platform/uid-inventory/cards/101/readiness?schoolId=2&studentId=3`);
    return {status:r.status,body:await r.json() as any};
  }
  async function act(action:string,extra:Record<string,unknown>={}){
    const before=await readiness();
    const response=await fetch(`${base}/platform/uid-inventory/cards/101/control`,{method:"POST",
      headers:{"Content-Type":"application/json"},body:JSON.stringify({
        schoolId:2,studentId:3,version:before.body.version??2,confirm:true,reason:"Owner reviewed this exact UID",action,...extra,
      })});
    return {status:response.status,body:await response.json() as any};
  }
  const graceInput=()=>({restrictions:["NFC_FLUTTERWAVE_PAYMENT_REQUIRED"],expiresAt:new Date(Date.now()+60_000).toISOString()});
  const attendance=async()=>{
    const card=(await db.query(studentNfcCardLookupSql,["AABB1234",2])).rows[0];
    if(!card)throw new AuthError(403,"NFC card is invalid");
    await assertCardPaymentRestriction(db,101,2,3,()=>assertVerifiedStudentNfcPayment(db,2,3));
    return "ACCEPTED";
  };
  it.each(["SCHOOL_ADMIN","TEACHER","STAFF","PARENT","STUDENT","PARTNER","INTERNAL_OFFICER","COMPANY_ACCOUNTANT"])(
    "denies %s for reads and all four mutations without writes",async role=>{
      fixture.role=role;expect((await readiness()).status).toBe(403);
      for(const action of ["LOCK","UNLOCK","GRANT_GRACE","REVOKE_GRACE"])expect((await act(action)).status).toBe(403);
      expect((await db.query("SELECT count(*)::int n FROM audit_logs")).rows[0].n).toBe(0);
    });
  it("locks immediately, retains the original history, then explicitly unlocks with actor and exact scope",async()=>{
    const original=(await db.query("SELECT * FROM nfc_card_history ORDER BY id")).rows;
    const locked=await act("LOCK");expect(locked.status).toBe(200);
    expect(locked.body).toMatchObject({status:"locked",stage:"ADMINISTRATIVE_LOCK",canActivate:true,canPrint:false});
    await expect(attendance()).rejects.toMatchObject({statusCode:403});
    const unlocked=await act("UNLOCK");expect(unlocked.status).toBe(200);
    expect(unlocked.body).toMatchObject({status:"active",effectiveStatus:"ELIGIBLE"});
    expect(await attendance()).toBe("ACCEPTED");
    const rows=(await db.query("SELECT * FROM nfc_card_history ORDER BY id")).rows;
    expect(rows.slice(0,2)).toEqual(original);expect(rows.slice(2).map(r=>r.action)).toEqual(["OWNER_ADMIN_LOCK","OWNER_ADMIN_UNLOCK"]);
    const audit=(await db.query("SELECT * FROM audit_logs ORDER BY id")).rows;
    expect(audit[0]).toMatchObject({actor_user_id:9,metadata:{uid:"AABB1234",cardId:101,schoolId:2,studentId:3,reason:"Owner reviewed this exact UID",scope:"EXACT_STUDENT_CARD",confirmed:true,previousStatus:"active",newStatus:"locked"}});
  });
  it.each([{reason:" "},{reason:"x"},{reason:"x".repeat(481)},{confirm:false},{studentId:4},{schoolId:5}])(
    "rejects unconfirmed/invalid reasons and stale scope %j",async invalid=>{
      expect((await act("LOCK",invalid)).status).not.toBe(200);
      expect((await db.query("SELECT status FROM nfc_cards")).rows[0].status).toBe("active");
      expect((await db.query("SELECT count(*)::int n FROM audit_logs")).rows[0].n).toBe(0);
    });
  it("serializes conflicting actions and rejects stale reviewed history",async()=>{
    const version=(await readiness()).body.version;
    const results=await Promise.all([act("LOCK",{version}),act("LOCK",{version})]);
    expect(results.map(r=>r.status).sort()).toEqual([200,409]);
    expect((await db.query("SELECT count(*)::int n FROM audit_logs")).rows[0].n).toBe(1);
    expect((await act("UNLOCK",{version})).status).toBe(409);
  });
  it("grants only the exact restriction, expires without a worker and never changes the ledger",async()=>{
    fixture.paid=false;
    const ledger=async()=>Promise.all(["obligations","attempts","events"].map(async t=>
      (await db.query(`SELECT * FROM student_direct_live_${t} ORDER BY id`)).rows));
    const before=await ledger();
    await expect(attendance()).rejects.toMatchObject({eventType:"NFC_FLUTTERWAVE_PAYMENT_REQUIRED"});
    const grant=await act("GRANT_GRACE",{...graceInput(),expiresAt:new Date(Date.now()+800).toISOString()});
    expect(grant.status,JSON.stringify(grant.body)).toBe(200);expect(grant.body).toMatchObject({effectiveStatus:"ELIGIBLE_BY_GRACE",statusSource:"OWNER_TEMPORARY_GRACE",grace:{state:"ACTIVE"}});
    expect(grant.body.grace.grant).toMatchObject({actorUserId:9,details:{termId:30,restrictions:["NFC_FLUTTERWAVE_PAYMENT_REQUIRED"]}});
    expect(await attendance()).toBe("ACCEPTED");
    await db.query("SELECT pg_sleep(0.9)");
    await expect(attendance()).rejects.toMatchObject({eventType:"NFC_FLUTTERWAVE_PAYMENT_REQUIRED"});
    expect((await readiness()).body).toMatchObject({effectiveStatus:"INELIGIBLE",grace:{state:"EXPIRED"}});
    expect(await ledger()).toEqual(before);
    expect((await db.query("SELECT action FROM nfc_card_history ORDER BY id DESC LIMIT 1")).rows[0].action).toBe("OWNER_GRACE_GRANTED");
  });
  it("revokes early with a mandatory reason and keeps the grant immutable",async()=>{
    fixture.paid=false;expect((await act("GRANT_GRACE",graceInput())).status).toBe(200);
    const grant=(await db.query("SELECT * FROM nfc_card_history WHERE action='OWNER_GRACE_GRANTED'")).rows[0];
    expect((await act("REVOKE_GRACE",{reason:" "})).status).toBe(400);
    expect((await act("REVOKE_GRACE",{reason:"Early pardon ended"})).status).toBe(200);
    await expect(attendance()).rejects.toMatchObject({eventType:"NFC_FLUTTERWAVE_PAYMENT_REQUIRED"});
    expect((await readiness()).body.grace.state).toBe("REVOKED");
    expect((await db.query("SELECT * FROM nfc_card_history WHERE action='OWNER_GRACE_GRANTED'")).rows[0]).toEqual(grant);
  });
  it("does not clear an Owner lock by granting grace; unlock and grace stay separate",async()=>{
    expect((await act("LOCK")).status).toBe(200);fixture.paid=false;
    expect((await act("UNLOCK")).status).toBe(409);
    expect((await act("GRANT_GRACE",graceInput())).status).toBe(200);
    await expect(attendance()).rejects.toMatchObject({statusCode:403});
    expect((await act("UNLOCK")).status).toBe(200);expect(await attendance()).toBe("ACCEPTED");
  });
  it.each(["lost","blocked","suspended","expired","replaced","inactive","unassigned"])(
    "never pardons or unlocks a %s card",async status=>{
      fixture.paid=false;await db.query("UPDATE nfc_cards SET status=$1",[status]);
      expect((await act("GRANT_GRACE",graceInput())).status).toBe(409);
      expect((await act("UNLOCK")).status).toBe(409);
      expect((await db.query("SELECT status FROM nfc_cards")).rows[0].status).toBe(status);
    });
  it.each([
    "UPDATE students SET status='INACTIVE'","UPDATE schools SET status='INACTIVE'",
    "UPDATE platform_devices SET status='INACTIVE'","UPDATE student_identification_policies SET policy='BIOMETRIC_ONLY'",
    "UPDATE nfc_cards SET replaced_at=clock_timestamp()","UPDATE nfc_cards SET expires_at=clock_timestamp()-interval '1 second'",
    "INSERT INTO employee_nfc_card_bindings VALUES(1,101)",
  ])("preserves safety restriction: %s",async sql=>{
    fixture.paid=false;await db.query(sql);expect((await act("GRANT_GRACE",graceInput())).status).toBe(409);
    expect((await act("UNLOCK")).status).toBe(409);
  });
  it("preserves a security lock, a school lock and independent unmet payment restrictions",async()=>{
    fixture.paid=false;await db.query(`UPDATE nfc_cards SET status='locked';
      INSERT INTO nfc_card_history(school_id,nfc_card_id,student_id,action,new_status,reason)
      VALUES(2,101,3,'STATUS_CHANGED','locked','Security incident: disputed possession')`);
    expect((await readiness()).body).toMatchObject({stage:"SECURITY_LOCK",canActivate:false,canGrantGrace:false});
    expect((await act("UNLOCK")).status).toBe(409);expect((await act("GRANT_GRACE",graceInput())).status).toBe(409);
    await db.query("UPDATE nfc_cards SET status='active'");fixture.schoolLocked=true;
    expect((await act("GRANT_GRACE",graceInput())).status).toBe(409);
    fixture.schoolLocked=false;fixture.subscription=false;
    const partial=await act("GRANT_GRACE",graceInput());
    expect(partial.status).toBe(200);expect(partial.body.effectiveStatus).toBe("INELIGIBLE");
    expect(partial.body.restrictions).toEqual(expect.arrayContaining([
      expect.objectContaining({code:"NFC_FLUTTERWAVE_PAYMENT_REQUIRED",waived:true}),
      expect.objectContaining({code:"STUDENT_PLATFORM_SUBSCRIPTION_REQUIRED",waived:false}),
    ]));
  });
  it.each([
    {expiresAt:"2026-11-02T12:00"},{expiresAt:"invalid"},{expiresAt:"2020-01-01T00:00:00Z"},
    {expiresAt:"2099-01-01T00:00:00Z"},{restrictions:["SECURITY_LOCK"]},{restrictions:[]},
  ])("rejects invalid or unzoned expiry and prohibited coverage %j",async invalid=>{
    fixture.paid=false;expect((await act("GRANT_GRACE",{...graceInput(),...invalid})).status).toBe(400);
  });
  it("invalidates grace after term or assignment change and cannot resurrect an older grant",async()=>{
    fixture.paid=false;expect((await act("GRANT_GRACE",graceInput())).status).toBe(200);
    expect((await act("GRANT_GRACE",graceInput())).status).toBe(409);
    await db.query(`INSERT INTO nfc_card_history(school_id,nfc_card_id,student_id,action,new_status,reason)
      VALUES(2,101,3,'REASSIGNED','active','Returned and linked again')`);
    expect((await readStudentCardGrace(db,101,2,3)).state).toBe("INVALIDATED");
    await expect(attendance()).rejects.toMatchObject({eventType:"NFC_FLUTTERWAVE_PAYMENT_REQUIRED"});
    expect((await act("GRANT_GRACE",graceInput())).status).toBe(200);
    await db.query("UPDATE academic_terms SET is_current=false");
    expect((await readStudentCardGrace(db,101,2,3)).state).toBe("INVALIDATED");
  });
  it("never treats a UID change, school lock, outage or non-payment restriction as pardoned",async()=>{
    fixture.paid=false;expect((await act("GRANT_GRACE",graceInput())).status).toBe(200);
    for(const error of [
      new AuthError(503,"Payment evidence unavailable","NFC_FLUTTERWAVE_PAYMENT_REQUIRED"),
      new AuthError(403,"School locked","SCHOOL_SUBSCRIPTION_LOCKED"),
      new AuthError(403,"Identity blocked","IDENTITY_RESTRICTED"),
      new Error("Database is unavailable"),
    ]){
      await expect(assertCardPaymentRestriction(db,101,2,3,async()=>{throw error;})).rejects.toBe(error);
    }
    await db.query("UPDATE nfc_cards SET uid='DIFFERENT_UID'");
    expect((await readStudentCardGrace(db,101,2,3)).state).toBe("INVALIDATED");
  });
  it("does not use grace to permanently activate a staged card or guess an academic term",async()=>{
    fixture.paid=false;
    await db.query("UPDATE nfc_cards SET status='locked'");
    // Last locked history is the original REGISTERED record.
    expect((await readiness()).body.stage).toBe("AWAITING_ACTIVATION");
    expect((await act("GRANT_GRACE",graceInput())).status).toBe(409);
    await db.query("UPDATE nfc_cards SET status='active'; UPDATE academic_terms SET is_current=false");
    expect((await act("GRANT_GRACE",graceInput())).status).toBe(409);
  });
  it("refuses ambiguous current terms even if only one overlaps today's date",async()=>{
    fixture.paid=false;
    await db.query(`INSERT INTO academic_terms VALUES(31,2,20,'ACTIVE',true,CURRENT_DATE-100,CURRENT_DATE-50)`);
    expect((await act("GRANT_GRACE",graceInput())).status).toBe(409);
    expect((await db.query("SELECT count(*)::int n FROM audit_logs")).rows[0].n).toBe(0);
  });
});
