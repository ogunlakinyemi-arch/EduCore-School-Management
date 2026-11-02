import {Pool} from "pg";
import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from "vitest";
import type {Request} from "express";
const state=vi.hoisted(()=>({db:null as any,role:"PLATFORM_OWNER"}));
vi.mock("@workspace/db",()=>({pool:{connect:()=>state.db.connect(),query:(...args:any[])=>state.db.query(...args)}}));
vi.mock("../middlewares/auth",async original=>{
  const actual=await original<typeof import("../middlewares/auth")>();
  return {...actual,getUserContext:()=>({user:{id:9}}),assertRoles:()=>{
    if(state.role!=="PLATFORM_OWNER")throw new actual.AuthError(403,"Forbidden");
  }};
});
import {detachOwnerCard,reusableEmployeeBindingSql} from "./owner-card-detach";
import {assignAvailableStudentCard} from "./student-card-assignment";
const socket=process.env.OWNER_DETACH_TEST_SOCKET;
describe.skipIf(!socket)("ordinary card detach on disposable PostgreSQL",()=>{
  let db:Pool;
  const req={} as Request;
  const input=(personType:"STUDENT"|"TEACHER"|"STAFF"="STUDENT")=>({schoolId:2,personId:personType==="STUDENT"?3:7,personType,reason:"Returned card"});
  beforeAll(async()=>{
    if(!socket?.startsWith("/tmp/educore-owner-detach-")||process.env.REPLIT_DEPLOYMENT)throw Error("Disposable fixture required");
    db=new Pool({host:socket,port:55444,user:"owner_detach_fixture",database:"owner_detach_fixture",max:5});
    const row=(await db.query(`SELECT current_database() db,current_user role,inet_server_addr() address,
      current_setting('data_directory') directory`)).rows[0];
    if(row.db!=="owner_detach_fixture"||row.role!=="owner_detach_fixture"||row.address!==null||
      row.directory!==`${socket}/data`)throw Error("Wrong disposable database");
    state.db=db;
    await db.query(`
      DROP TABLE IF EXISTS employee_nfc_card_history,nfc_card_history,employee_nfc_card_bindings,
        audit_logs,attendance_events,nfc_cards,employees,students,platform_devices CASCADE;
      CREATE TABLE students(id int PRIMARY KEY,school_id int,status text,admission_no text,
        first_name text,middle_name text,last_name text,class_name text,section text,photo text);
      CREATE TABLE employees(id int PRIMARY KEY,school_id int,employee_type text);
      CREATE TABLE platform_devices(id int PRIMARY KEY,school_id int,name text);
      CREATE TABLE nfc_cards(id serial PRIMARY KEY,school_id int,student_id int,uid text UNIQUE,status text,
        scans int DEFAULT 0,last_scan timestamptz,last_device_id int,issued_at timestamptz,
        activated_at timestamptz,deactivated_at timestamptz,replaced_by_card_id int);
      CREATE TABLE employee_nfc_card_bindings(id serial PRIMARY KEY,school_id int,nfc_card_id int UNIQUE REFERENCES nfc_cards,
        employee_id int REFERENCES employees,status text CHECK(status IN('ASSIGNED','ACTIVE','LOCKED','DEACTIVATED','REPLACED')),
        created_by_user_id int,updated_at timestamptz DEFAULT now());
      CREATE UNIQUE INDEX one_current_employee ON employee_nfc_card_bindings(school_id,employee_id)
        WHERE status IN('ASSIGNED','ACTIVE','LOCKED');
      CREATE TABLE nfc_card_history(id serial PRIMARY KEY,school_id int,nfc_card_id int REFERENCES nfc_cards,
        student_id int REFERENCES students,action text,previous_status text,new_status text,reason text,actor_user_id int);
      CREATE TABLE employee_nfc_card_history(id serial PRIMARY KEY,school_id int,binding_id int REFERENCES employee_nfc_card_bindings,
        nfc_card_id int REFERENCES nfc_cards,employee_id int REFERENCES employees,action text,
        previous_status text,new_status text,reason text,actor_user_id int);
      CREATE TABLE audit_logs(id serial PRIMARY KEY,"user" text,role text,actor_user_id int,school_id int,
        action text,module text,record_id int,event_type text,result text,metadata jsonb);
      CREATE TABLE attendance_events(id int PRIMARY KEY,nfc_card_id int,student_id int,employee_id int,device_id int);
      INSERT INTO students(id,school_id,status,first_name) VALUES(3,2,'ACTIVE','Original'),(4,2,'ACTIVE','Next');
      INSERT INTO employees VALUES(7,2,'TEACHER'),(8,2,'STAFF'),(9,4,'TEACHER');
      INSERT INTO platform_devices VALUES(11,2,'Retained hardware');
    `);
  });
  afterAll(async()=>{await db?.end();});
  beforeEach(async()=>{
    state.role="PLATFORM_OWNER";
    await db.query(`TRUNCATE employee_nfc_card_history,nfc_card_history,employee_nfc_card_bindings,
      audit_logs,attendance_events,nfc_cards RESTART IDENTITY;
      INSERT INTO nfc_cards(id,school_id,student_id,uid,status,scans,last_scan,last_device_id,activated_at)
        VALUES(5,2,3,'AABBCCDD','active',12,'2026-10-20T09:00Z',11,'2026-10-01T09:00Z');
      INSERT INTO nfc_card_history(school_id,nfc_card_id,student_id,action,reason)
        VALUES(2,5,3,'ASSIGNED','Original history');
      INSERT INTO attendance_events VALUES(1,5,3,NULL,11)`);
  });
  const before=async()=>({
    history:(await db.query("SELECT * FROM nfc_card_history ORDER BY id")).rows,
    events:(await db.query("SELECT * FROM attendance_events")).rows,
    devices:(await db.query("SELECT * FROM platform_devices")).rows,
  });
  it("detaches without deleting inventory, losing history or creating replacement effects",async()=>{
    const prior=await before();
    expect(await detachOwnerCard(req,5,input())).toMatchObject({detached:true,status:"unassigned",uid:"AABBCCDD"});
    expect((await db.query("SELECT student_id,status,scans,last_device_id,uid FROM nfc_cards")).rows)
      .toEqual([{student_id:null,status:"unassigned",scans:12,last_device_id:11,uid:"AABBCCDD"}]);
    const after=await before();expect(after.history[0]).toEqual(prior.history[0]);
    expect(after.events).toEqual(prior.events);expect(after.devices).toEqual(prior.devices);
    expect(after.history[1]).toMatchObject({student_id:3,action:"UNLINKED",reason:"Returned card",actor_user_id:9});
    expect((await db.query("SELECT event_type,metadata FROM audit_logs")).rows).toMatchObject([{
      event_type:"OWNER_CARD_DETACHED",metadata:{personId:3,personType:"STUDENT",reason:"Returned card",previousStatus:"active",newStatus:"unassigned",confirmed:true},
    }]);
  });
  it.each(["SCHOOL_ADMIN","TEACHER","STAFF","PARENT","STUDENT","PARTNER"])("rejects %s before touching data",async role=>{
    state.role=role;
    await expect(detachOwnerCard(req,5,input())).rejects.toMatchObject({statusCode:403});
    expect((await db.query("SELECT count(*) FROM audit_logs")).rows[0].count).toBe("0");
    expect((await db.query("SELECT student_id FROM nfc_cards")).rows[0].student_id).toBe(3);
  });
  it("rejects unlinked, wrong-person and wrong-school selections",async()=>{
    await expect(detachOwnerCard(req,5,{...input(),personId:4})).rejects.toMatchObject({statusCode:409});
    await expect(detachOwnerCard(req,5,{...input(),schoolId:4})).rejects.toMatchObject({statusCode:404});
    await detachOwnerCard(req,5,input());
    await expect(detachOwnerCard(req,5,input())).rejects.toMatchObject({statusCode:409});
    expect((await db.query("SELECT count(*) FROM audit_logs")).rows[0].count).toBe("1");
  });
  it("serializes concurrent confirmation so only one detach is committed",async()=>{
    const results=await Promise.allSettled([detachOwnerCard(req,5,input()),detachOwnerCard(req,5,input())]);
    expect(results.filter(result=>result.status==="fulfilled")).toHaveLength(1);
    expect((await db.query("SELECT count(*) FROM audit_logs")).rows[0].count).toBe("1");
    expect((await db.query("SELECT count(*) FROM nfc_card_history WHERE action='UNLINKED'")).rows[0].count).toBe("1");
  });
  it.each(["lost","replaced","inactive","suspended"])("never frees a %s UID",async status=>{
    await db.query("UPDATE nfc_cards SET status=$1",[status]);
    await expect(detachOwnerCard(req,5,input())).rejects.toMatchObject({statusCode:409});
    expect((await db.query("SELECT status FROM nfc_cards")).rows[0].status).toBe(status);
  });
  it("lets the existing student assignment service reuse the same physical UID in the same school, locked",async()=>{
    const original=(await before()).events;
    await detachOwnerCard(req,5,input());
    const client=await db.connect();
    try {
      await client.query("BEGIN");
      const result=await assignAvailableStudentCard(client,{schoolId:2,studentId:4,cardNumber:"AABBCCDD",allowCreate:false});
      expect(result.card).toMatchObject({id:5,studentId:4,status:"locked",scans:12});
      await client.query("COMMIT");
    } finally {client.release();}
    expect((await db.query("SELECT * FROM attendance_events")).rows).toEqual(original);
    expect((await db.query("SELECT count(*) FROM nfc_cards")).rows[0].count).toBe("1");
  });
  it.each(["TEACHER","STAFF"] as const)("preserves employee snapshots and allows explicit %s binding reuse without deleting rows",async type=>{
    await db.query("UPDATE employees SET employee_type=$1 WHERE id=7",[type]);
    await db.query(`UPDATE nfc_cards SET student_id=NULL;
      INSERT INTO employee_nfc_card_bindings(id,school_id,nfc_card_id,employee_id,status,created_by_user_id)
        VALUES(10,2,5,7,'ACTIVE',9);
      INSERT INTO employee_nfc_card_history(school_id,binding_id,nfc_card_id,employee_id,action,reason)
        VALUES(2,10,5,7,'ASSIGNED','Original employee snapshot')`);
    await db.query("UPDATE attendance_events SET student_id=NULL,employee_id=7");
    const events=(await db.query("SELECT * FROM attendance_events")).rows;
    const old=(await db.query("SELECT * FROM employee_nfc_card_history")).rows[0];
    await detachOwnerCard(req,5,input(type));
    const binding=await db.query(reusableEmployeeBindingSql,[2,5,8,9]);
    expect(binding.rows).toEqual([{id:10}]);
    const history=(await db.query("SELECT * FROM employee_nfc_card_history ORDER BY id")).rows;
    expect(history[0]).toEqual(old);expect(history[1]).toMatchObject({employee_id:7,action:"UNLINKED"});
    expect((await db.query("SELECT employee_id,status FROM employee_nfc_card_bindings")).rows)
      .toEqual([{employee_id:8,status:"ASSIGNED"}]);
    expect((await db.query("SELECT count(*) FROM nfc_cards")).rows[0].count).toBe("1");
    expect((await db.query("SELECT * FROM attendance_events")).rows).toEqual(events);
  });
  it("does not reuse an ordinary deactivated binding without explicit unlink evidence",async()=>{
    await db.query(`UPDATE nfc_cards SET student_id=NULL,status='unassigned';
      INSERT INTO employee_nfc_card_bindings(school_id,nfc_card_id,employee_id,status) VALUES(2,5,7,'DEACTIVATED')`);
    expect((await db.query(reusableEmployeeBindingSql,[2,5,8,9])).rows).toHaveLength(0);
  });
  it("rolls back the detach if mandatory auditing fails",async()=>{
    await db.query(`CREATE OR REPLACE FUNCTION fixture_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'fixture audit failure'; END $$;
      CREATE TRIGGER fixture_fail_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fixture_fail_audit()`);
    try {
      await expect(detachOwnerCard(req,5,input())).rejects.toThrow('fixture audit failure');
      expect((await db.query("SELECT student_id,status FROM nfc_cards")).rows).toEqual([{student_id:3,status:"active"}]);
      expect((await db.query("SELECT count(*) FROM nfc_card_history")).rows[0].count).toBe("1");
    } finally {await db.query("DROP TRIGGER fixture_fail_audit ON audit_logs; DROP FUNCTION fixture_fail_audit()");}
  });
});
