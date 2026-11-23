import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {Pool} from "pg";
import {getTableName} from "drizzle-orm";
import {getTableConfig} from "drizzle-orm/pg-core";
import {ownerFreeAcademicTerms,ownerFreeAcademicTermEvents} from "../../../../lib/db/src/schema/owner-free-academic-terms";
import {readFile} from "node:fs/promises";
import {changeFreeTermGrant,freeTermStorageReady,readFreeTermGrant} from "./owner-free-academic-terms";
import {readStudentRollout,readStudentUsageRollout} from "./student-platform-rollout";
import {readStaffCollection} from "./staff-free-rollout";
import {readStudentTermPlatformAccess} from "./student-platform-access";
import {assertSubscriptionAccess} from "./subscription-enforcement";

const root="/home/runner/workspace/generated-artifacts/free-academic-terms";
const db=new Pool({host:`${root}/socket`,port:55439,user:"runner",database:"free_term_fixture",max:5});
const q=(sql:string,args:any[]=[])=>db.query(sql,args);
const selection={schoolId:1,sessionId:1,termId:2,startDate:"2027-01-12",endDate:"2027-04-10",
  reason:"Owner approved term sponsorship",confirmed:true as const};
describe.skipIf(process.env.RUN_FREE_TERM_POSTGRES!=="1")("Owner free academic terms / disposable PostgreSQL",()=>{
  beforeAll(async()=>{
    const identity=(await q("SELECT current_setting('data_directory') AS dir,inet_server_addr() AS host")).rows[0];
    if(identity.dir!==`${root}/pgdata`||identity.host!==null)throw Error("Refusing non-disposable PostgreSQL");
    await q("DROP SCHEMA public CASCADE;CREATE SCHEMA public");
    await q(`CREATE TABLE schools(id integer PRIMARY KEY,name text,status text);
      CREATE TABLE app_users(id integer PRIMARY KEY,first_name text,last_name text,status text);
      CREATE TABLE school_memberships(id serial PRIMARY KEY,user_id integer,school_id integer,role text,status text);
      CREATE TABLE academic_sessions(id integer PRIMARY KEY,school_id integer,name text,status text,is_current boolean,UNIQUE(id,school_id));
      CREATE TABLE academic_terms(id integer PRIMARY KEY,school_id integer,academic_session_id integer,name text,
        start_date date,end_date date,status text,is_current boolean,UNIQUE(id,school_id));
      CREATE TABLE students(id integer PRIMARY KEY,school_id integer,status text);
      CREATE TABLE school_subscription_manual_locks(school_id integer PRIMARY KEY,locked boolean,version integer,
        locked_at timestamptz,locked_by_user_id integer,last_unlocked_at timestamptz,last_unlocked_by_user_id integer,reason text);
      CREATE TABLE student_direct_live_obligations(id integer PRIMARY KEY,school_id integer,academic_term_id integer,amount_minor integer);
      CREATE TABLE student_direct_live_attempts(id integer PRIMARY KEY,obligation_id integer,state text,provider_reference text);
      CREATE TABLE current_payment_batches(id integer PRIMARY KEY,school_id integer,academic_term_id integer,amount_minor integer);
      CREATE TABLE current_bulk_confirmations(batch_id integer PRIMARY KEY,provider_reference text);
      CREATE TABLE staff_nfc_payments(id integer PRIMARY KEY,school_id integer,academic_term_id integer,status text,gross_amount_minor integer);
      INSERT INTO student_direct_live_obligations VALUES(1,1,2,500000);
      INSERT INTO student_direct_live_attempts VALUES(1,1,'PAID','historic-verified-reference');
      INSERT INTO current_payment_batches VALUES(1,1,2,320000);
      INSERT INTO current_bulk_confirmations VALUES(1,'historic-aggregate-reference');
      INSERT INTO staff_nfc_payments VALUES(1,1,2,'PAID',200000);
      CREATE TABLE retained_financial_evidence(id integer PRIMARY KEY,kind text,evidence jsonb);
      INSERT INTO retained_financial_evidence VALUES
        (1,'invoice','{"status":"UNPAID","price":5000}'),(2,'receipt','{"status":"PAID","price":5000}'),
        (3,'payment','{"status":"PAID","reference":"retained-only"}'),(4,'BRO','{"earned":100}'),
        (5,'ledger','{"schoolLiability":1900}');
      INSERT INTO schools VALUES(1,'Existing school A','active'),(2,'Existing school B','active');
      INSERT INTO app_users VALUES(1,'Fixture','Owner','ACTIVE'),(2,'School','Admin','ACTIVE'),(3,'Inactive','Owner','INACTIVE');
      INSERT INTO school_memberships(user_id,school_id,role,status) VALUES
        (1,null,'PLATFORM_OWNER','ACTIVE'),(2,1,'SCHOOL_ADMIN','ACTIVE'),(3,null,'PLATFORM_OWNER','ACTIVE');
      INSERT INTO academic_sessions VALUES(1,1,'2026/2027','ACTIVE',true),(2,2,'2026/2027','ACTIVE',true);
      INSERT INTO academic_terms VALUES
        (1,1,1,'First Term','2026-09-01','2026-12-18','ACTIVE',false),
        (2,1,1,'Second Term','2027-01-12','2027-04-10','ACTIVE',true),
        (3,1,1,'Third Term','2027-05-03','2027-07-24','ACTIVE',false),
        (4,2,2,'Second Term','2027-01-18','2027-04-15','ACTIVE',true);
      INSERT INTO students VALUES(10,1,'active'),(20,2,'active');`);
    const migration=await readFile("../../lib/db/drizzle/0183_owner_free_academic_terms.sql","utf8");
    await q(migration);await q(migration);
  });
  beforeEach(async()=>{
    vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(new Date("2027-02-01T12:00:00Z"));
    // Cleanup belongs to the isolated fixture only; production has no reset path.
    await q(`ALTER TABLE owner_free_academic_term_events DISABLE TRIGGER owner_free_term_events_immutable;
      ALTER TABLE owner_free_academic_terms DISABLE TRIGGER owner_free_terms_immutable;
      DELETE FROM owner_free_academic_term_events;DELETE FROM owner_free_academic_terms;
      ALTER TABLE owner_free_academic_terms ENABLE TRIGGER owner_free_terms_immutable;
      ALTER TABLE owner_free_academic_term_events ENABLE TRIGGER owner_free_term_events_immutable;
      UPDATE academic_terms SET end_date='2027-04-10',is_current=true,status='ACTIVE' WHERE id=2;
      UPDATE academic_terms SET is_current=false WHERE id=3;`);
    await q("UPDATE schools SET status='active'");
    await q("DELETE FROM school_subscription_manual_locks");
    await q(`UPDATE student_direct_live_attempts SET state='PAID';
      DELETE FROM current_payment_batches WHERE id<>1;
      UPDATE staff_nfc_payments SET status='PAID';`);
  });
  afterAll(async()=>{vi.useRealTimers();await db.end();});
  it("uses the real candidate schema, including enabled immutable-history guards",async()=>{
    expect(await freeTermStorageReady(db)).toBe(true);
  });
  it("matches the review ORM's columns and constraints and the exact SQL function/trigger definitions",async()=>{
    for(const table of [ownerFreeAcademicTerms,ownerFreeAcademicTermEvents]){
      const model=getTableConfig(table),name=getTableName(table);
      const cols=(await q(`SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,
        a.attnotnull AS "notNull",a.atthasdef AS "hasDefault"
        FROM pg_attribute a WHERE a.attrelid=to_regclass($1) AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`,[`public.${name}`])).rows;
      expect(cols).toEqual(model.columns.map(c=>({name:c.name,type:c.getSQLType().replace("serial","integer"),
        notNull:c.notNull,hasDefault:c.hasDefault})));
      const constraints=(await q(`SELECT conname AS name,contype AS type,confdeltype AS "onDelete",convalidated AS valid,
        ARRAY(SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY k(id,n)
          JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.id ORDER BY k.n) AS columns,
        CASE WHEN contype='f' THEN (SELECT relname FROM pg_class WHERE oid=c.confrelid) END AS "foreignTable",
        ARRAY(SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY k(id,n)
          JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.id ORDER BY k.n) AS "foreignColumns"
        FROM pg_constraint c WHERE conrelid=to_regclass($1) ORDER BY conname`,[`public.${name}`])).rows;
      const expectedNames=[`${name}_pkey`,...model.uniqueConstraints.map(c=>c.name),
        ...model.checks.map(c=>c.name),...model.foreignKeys.map(f=>f.getName())].sort();
      expect(constraints.map(c=>c.name)).toEqual(expectedNames);
      expect(constraints.every(c=>c.valid)).toBe(true);
      for(const fk of model.foreignKeys){
        const ref=fk.reference();
        expect(constraints.find(c=>c.name===fk.getName())).toMatchObject({type:"f",onDelete:"r",
          columns:ref.columns.map(c=>c.name),foreignTable:getTableName(ref.foreignTable),
          foreignColumns:ref.foreignColumns.map(c=>c.name)});
      }
      for(const unique of model.uniqueConstraints)
        expect(constraints.find(c=>c.name===unique.name)).toMatchObject({type:"u",columns:unique.columns.map(c=>c.name)});
      const defaults=(await q(`SELECT column_name,column_default FROM information_schema.columns WHERE table_schema='public'
        AND table_name=$1 AND column_default IS NOT NULL ORDER BY ordinal_position`,[name])).rows;
      expect(defaults.find(c=>c.column_name==="id")?.column_default).toContain("nextval(");
      expect(defaults.find(c=>c.column_name==="created_at")?.column_default).toBe("now()");
      if(name==="owner_free_academic_terms")
        expect(defaults.find(c=>c.column_name==="status")?.column_default).toBe("'TRIAL_GRANTED'::text");
      const rights=(await q(`SELECT (has_table_privilege(current_user,$1,'SELECT')
        AND has_table_privilege(current_user,$1,'INSERT')) AS tables,
        has_sequence_privilege(current_user,pg_get_serial_sequence($1,'id'),'USAGE') AS sequence`,[`public.${name}`])).rows[0];
      expect(rights).toEqual({tables:true,sequence:true});
    }
    const migration=await readFile("../../lib/db/drizzle/0183_owner_free_academic_terms.sql","utf8");
    const normal=(s:string)=>s.trim().replace(/\s+/g," ");
    for(const [,name,body] of migration.matchAll(/CREATE OR REPLACE FUNCTION (\w+)\(\) RETURNS trigger[\s\S]*?AS \$\$([\s\S]*?)\$\$/g)){
      const fn=(await q(`SELECT p.prosrc,l.lanname,p.prosecdef,p.provolatile,p.prorettype::regtype::text AS returns
        FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
        WHERE n.nspname='public' AND p.proname=$1 AND p.pronargs=0`,[name])).rows;
      expect(fn).toHaveLength(1);
      expect({...fn[0],prosrc:normal(fn[0].prosrc)}).toEqual({
        prosrc:normal(body),lanname:"plpgsql",prosecdef:false,provolatile:"v",returns:"trigger"});
    }
    const triggers=(await q(`SELECT t.tgname AS name,c.relname AS table,p.proname AS function,t.tgtype AS type,
      t.tgenabled AS enabled FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_proc p ON p.oid=t.tgfoid
      WHERE NOT t.tgisinternal AND t.tgrelid IN (to_regclass('public.owner_free_academic_terms'),
        to_regclass('public.owner_free_academic_term_events')) ORDER BY t.tgname`)).rows;
    expect(triggers).toEqual([
      {name:"owner_free_term_events_immutable",table:"owner_free_academic_term_events",function:"reject_free_term_evidence_mutation",type:58,enabled:"O"},
      {name:"owner_free_terms_immutable",table:"owner_free_academic_terms",function:"reject_free_term_evidence_mutation",type:58,enabled:"O"},
      {name:"owner_free_terms_scope",table:"owner_free_academic_terms",function:"validate_free_term_scope",type:7,enabled:"O"},
    ]);
  });
  it("enforces every candidate CHECK in PostgreSQL, not only in request validation",async()=>{
    for(const [column,value,constraint] of [
      ["reason","bad","owner_free_academic_terms_reason_check"],
      ["status","PAID","owner_free_academic_terms_status_check"],
      ["end_date","2026-01-01","owner_free_academic_terms_check"],
    ]){
      if(column==="end_date")await q("UPDATE academic_terms SET end_date=$1 WHERE id=2",[value]);
      // Quoted identifiers are exclusively the three constant fixture columns above.
      await expect(q(`INSERT INTO owner_free_academic_terms
        (school_id,academic_session_id,academic_term_id,start_date,end_date,actor_user_id,reason${column==="status"?",status":""})
        VALUES(1,1,2,'2027-01-12',${column==="end_date"?"$1":"'2027-04-10'"},1,${column==="reason"?"$1":"'Fixture reason'"}${column==="status"?",$1":""})`,[value]))
        .rejects.toMatchObject({code:"23514",constraint});
      if(column==="end_date")await q("UPDATE academic_terms SET end_date='2027-04-10' WHERE id=2");
    }
    await changeFreeTermGrant(db,1,selection,"grant");
    const id=(await q("SELECT id FROM owner_free_academic_terms")).rows[0].id;
    await expect(q("INSERT INTO owner_free_academic_term_events(grant_id,actor_user_id,status,reason) VALUES($1,1,'PAID','Fixture reason')",[id]))
      .rejects.toMatchObject({code:"23514",constraint:"owner_free_academic_term_events_status_check"});
    await expect(q("INSERT INTO owner_free_academic_term_events(grant_id,actor_user_id,status,reason) VALUES($1,1,'SUSPENDED','bad')",[id]))
      .rejects.toMatchObject({code:"23514",constraint:"owner_free_academic_term_events_reason_check"});
  });
  it("fails closed on partially delivered/disabled guards rather than rebilling an existing free grant",async()=>{
    await changeFreeTermGrant(db,1,selection,"grant");
    await q("ALTER TABLE owner_free_academic_terms DISABLE TRIGGER owner_free_terms_immutable");
    try{
      expect(await freeTermStorageReady(db)).toBe(false);
      await expect(readStudentUsageRollout(db,1)).rejects.toMatchObject({statusCode:503});
      await expect(changeFreeTermGrant(db,1,selection,"suspend")).rejects.toMatchObject({statusCode:503});
    }finally{await q("ALTER TABLE owner_free_academic_terms ENABLE TRIGGER owner_free_terms_immutable");}
  });
  it.each([2,3])("denies non-Owner or inactive actor %s before any grant",async actor=>{
    await expect(changeFreeTermGrant(db,actor,selection,"grant")).rejects.toMatchObject({statusCode:403});
    expect((await q("SELECT * FROM owner_free_academic_terms")).rows).toHaveLength(0);
  });
  it("can record a grant for any existing school without enabling an inactive school",async()=>{
    await q("UPDATE schools SET status='inactive' WHERE id=1");
    await changeFreeTermGrant(db,1,selection,"grant");
    expect(await readFreeTermGrant(db,1,2)).toMatchObject({active:false,status:"SUSPENDED"});
    expect((await q("SELECT status FROM schools WHERE id=1")).rows[0].status).toBe("inactive");
  });
  it.each([{schoolId:2},{sessionId:2},{termId:4}])("rejects mismatched tenant/session/term %o",async mismatch=>{
    await expect(changeFreeTermGrant(db,1,{...selection,...mismatch},"grant")).rejects.toMatchObject({statusCode:404});
  });
  it("requires reason and explicit confirmation and rejects client-supplied audit actors",async()=>{
    for(const bad of [{reason:" "},{confirmed:false},{actorUserId:2}]){
      await expect(changeFreeTermGrant(db,1,{...selection,...bad} as any,"grant")).rejects.toThrow();
    }
  });
  it("grants an existing school and records server actor/time/scope/reason without modifying financial evidence",async()=>{
    const before=JSON.stringify((await q("SELECT * FROM retained_financial_evidence ORDER BY id")).rows);
    const students=JSON.stringify((await q("SELECT * FROM students ORDER BY id")).rows);
    const financialTables=["student_direct_live_obligations","student_direct_live_attempts","current_payment_batches","current_bulk_confirmations","staff_nfc_payments"];
    const financialBefore=await Promise.all(financialTables.map(async t=>JSON.stringify((await q(`SELECT * FROM ${t} ORDER BY 1`)).rows)));
    await changeFreeTermGrant(db,1,selection,"grant");
    const grant=await readFreeTermGrant(db,1,2);
    expect(grant).toMatchObject({status:"ACTIVE",active:true,actorUserId:1,schoolId:1,termId:2,sessionId:1,reason:selection.reason});
    expect((await q("SELECT * FROM owner_free_academic_term_events")).rows[0]).toMatchObject({actor_user_id:1,status:"TRIAL_GRANTED",reason:selection.reason});
    expect(JSON.stringify((await q("SELECT * FROM retained_financial_evidence ORDER BY id")).rows)).toBe(before);
    expect(JSON.stringify((await q("SELECT * FROM students ORDER BY id")).rows)).toBe(students);
    expect(await Promise.all(financialTables.map(async t=>JSON.stringify((await q(`SELECT * FROM ${t} ORDER BY 1`)).rows)))).toEqual(financialBefore);
  });
  it("allows one concurrent grant, rejects the other and appends exactly one granting event",async()=>{
    const results=await Promise.allSettled([changeFreeTermGrant(db,1,selection,"grant"),changeFreeTermGrant(db,1,selection,"grant")]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
    expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);
    expect((await q("SELECT * FROM owner_free_academic_term_events")).rows).toHaveLength(1);
  });
  it("keeps trial, start, inclusive end and next-day completion aligned with WAT calendar dates",async()=>{
    vi.setSystemTime(new Date("2027-01-01T12:00:00Z"));
    await changeFreeTermGrant(db,1,selection,"grant");
    expect((await readFreeTermGrant(db,1,2,"2027-01-11"))?.status).toBe("TRIAL_GRANTED");
    expect((await readFreeTermGrant(db,1,2,"2027-01-12"))?.status).toBe("ACTIVE");
    vi.setSystemTime(new Date("2027-04-10T22:59:59Z"));
    expect((await readFreeTermGrant(db,1,2))?.status).toBe("ACTIVE");
    vi.setSystemTime(new Date("2027-04-10T23:00:00Z"));
    expect((await readFreeTermGrant(db,1,2))?.status).toBe("COMPLETED");
    await q("UPDATE academic_terms SET status='COMPLETED' WHERE id=2");
    expect((await readFreeTermGrant(db,1,2))?.status).toBe("COMPLETED");
  });
  it("suspends without deleting or resurrecting a grant and restores the normal same-term obligation",async()=>{
    const before=JSON.stringify((await q("SELECT * FROM retained_financial_evidence ORDER BY id")).rows);
    await changeFreeTermGrant(db,1,selection,"grant");
    expect((await readStudentUsageRollout(db,1)).chargeable).toBe(false);
    await changeFreeTermGrant(db,1,{...selection,reason:"Owner withdrew term sponsorship"},"suspend");
    expect((await readFreeTermGrant(db,1,2))?.status).toBe("SUSPENDED");
    expect((await readStudentUsageRollout(db,1)).chargeable).toBe(true);
    await expect(changeFreeTermGrant(db,1,selection,"grant")).rejects.toMatchObject({statusCode:409});
    await expect(changeFreeTermGrant(db,1,selection,"suspend")).rejects.toMatchObject({statusCode:409});
    expect((await q("SELECT * FROM owner_free_academic_term_events")).rows).toHaveLength(2);
    expect(JSON.stringify((await q("SELECT * FROM retained_financial_evidence ORDER BY id")).rows)).toBe(before);
    expect((await q("SELECT state FROM student_direct_live_attempts WHERE id=1")).rows[0].state).toBe("PAID");
  });
  it("never lifts an independent manual school lock even during a valid free grant",async()=>{
    await changeFreeTermGrant(db,1,selection,"grant");
    await q("INSERT INTO school_subscription_manual_locks(school_id,locked,version,reason) VALUES(1,true,1,'Existing manual lock')");
    await expect(assertSubscriptionAccess(1,10,db as any,undefined)).rejects.toMatchObject({statusCode:403,eventType:"SCHOOL_SUBSCRIPTION_LOCKED"});
    expect((await q("SELECT locked FROM school_subscription_manual_locks")).rows[0].locked).toBe(true);
  });
  it("preserves free launch and January calendar gates even when a first-term grant is suspended",async()=>{
    vi.setSystemTime(new Date("2026-11-23T12:00:00Z"));
    await q("UPDATE academic_terms SET is_current=(id=1) WHERE school_id=1");
    const first={...selection,termId:1,startDate:"2026-09-01",endDate:"2026-12-18"};
    await changeFreeTermGrant(db,1,first,"grant");
    await changeFreeTermGrant(db,1,first,"suspend");
    expect(await readStudentUsageRollout(db,1)).toMatchObject({chargeable:false,collectionStartDate:"2027-01-12"});
    expect(await readStaffCollection(db,1)).toMatchObject({chargeable:false});
  });
  it("uses the free term for student and staff usage but not as historical payment or BRO eligibility evidence",async()=>{
    await changeFreeTermGrant(db,1,selection,"grant");
    expect(await readStudentUsageRollout(db,1)).toMatchObject({chargeable:false,reason:"OWNER_FREE_ACADEMIC_TERM"});
    expect(await readStaffCollection(db,1)).toMatchObject({chargeable:false});
    expect(await readStudentTermPlatformAccess(db as any,1,10)).toMatchObject({restricted:false,status:"NOT_REQUIRED"});
    expect(await readStudentTermPlatformAccess(db as any,1,20)).toMatchObject({restricted:true,status:"UNAVAILABLE"});
    // Base historical/NFC/commission eligibility is deliberately unaffected.
    expect((await readStudentRollout(db,1)).chargeable).toBe(true);
    expect((await q("SELECT count(*)::int n FROM retained_financial_evidence")).rows[0].n).toBe(5);
  });
  it("does not carry a free second term into the same school's third term or another school's second term",async()=>{
    await changeFreeTermGrant(db,1,selection,"grant");
    expect((await readStudentUsageRollout(db,2)).chargeable).toBe(true);
    await q("UPDATE academic_terms SET is_current=(id=3) WHERE school_id=1");
    vi.setSystemTime(new Date("2027-05-12T12:00:00Z"));
    expect(await readStudentUsageRollout(db,1)).toMatchObject({termId:3,chargeable:true});
    expect((await readFreeTermGrant(db,1,2))?.status).toBe("COMPLETED");
    expect(await readFreeTermGrant(db,1,3)).toBeNull();
  });
  it("rejects stale confirmed dates and never silently extends a grant after calendar edits",async()=>{
    await expect(changeFreeTermGrant(db,1,{...selection,endDate:"2027-04-11"},"grant")).rejects.toMatchObject({statusCode:409});
    await changeFreeTermGrant(db,1,selection,"grant");
    await q("UPDATE academic_terms SET end_date='2027-04-20' WHERE id=2");
    expect(await readFreeTermGrant(db,1,2)).toMatchObject({status:"SUSPENDED",calendarChanged:true,active:false});
    expect((await readStudentUsageRollout(db,1)).chargeable).toBe(true);
  });
  it("protects grants and events from UPDATE, DELETE and TRUNCATE",async()=>{
    await changeFreeTermGrant(db,1,selection,"grant");
    for(const table of ["owner_free_academic_terms","owner_free_academic_term_events"])
      for(const statement of [`UPDATE ${table} SET reason='changed evidence'`,`DELETE FROM ${table}`,`TRUNCATE ${table} CASCADE`])
        await expect(q(statement)).rejects.toThrow("immutable");
  });
  it.each(["direct","bulk","staff"])("refuses to grant over unresolved %s checkout without cancelling it",async channel=>{
    if(channel==="direct")await q("UPDATE student_direct_live_attempts SET state='UNKNOWN'");
    if(channel==="bulk")await q("INSERT INTO current_payment_batches VALUES(2,1,2,320000)");
    if(channel==="staff")await q("UPDATE staff_nfc_payments SET status='RECONCILIATION_REQUIRED'");
    await expect(changeFreeTermGrant(db,1,selection,"grant")).rejects.toMatchObject({statusCode:409});
    expect((await q("SELECT * FROM owner_free_academic_terms")).rows).toHaveLength(0);
  });
  it("rejects mismatched school/session/term dates even through direct SQL",async()=>{
    await expect(q(`INSERT INTO owner_free_academic_terms(school_id,academic_session_id,academic_term_id,start_date,end_date,actor_user_id,reason)
      VALUES(1,2,2,'2027-01-12','2027-04-10',1,'Invalid calendar scope')`)).rejects.toThrow("saved school/session/term");
  });
  it("rejects expired grants and duplicate direct SQL inserts",async()=>{
    await expect(changeFreeTermGrant(db,1,{...selection,termId:1,startDate:"2026-09-01",endDate:"2026-12-18"},"grant")).rejects.toMatchObject({statusCode:409});
    await changeFreeTermGrant(db,1,selection,"grant");
    await expect(q(`INSERT INTO owner_free_academic_terms(school_id,academic_session_id,academic_term_id,start_date,end_date,actor_user_id,reason)
      SELECT school_id,academic_session_id,academic_term_id,start_date,end_date,actor_user_id,reason FROM owner_free_academic_terms`)).rejects.toThrow("unique");
  });
});
