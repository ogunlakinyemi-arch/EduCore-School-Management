import { beforeAll, afterAll, beforeEach, afterEach, it, expect, vi } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabasePool } from "@workspace/db/driver";
import { teacherPeriodsSql, periodNotices, teacherPeriodStillCurrent, queueTeacherPeriodNotifications } from "./teacher-period-notifications";
import { pushTestCandidates } from "./owner-notification-controls";
let dir:string, postgres:ChildProcess, db:InstanceType<typeof DatabasePool>;
const before = new Date("2026-11-09T06:55:00Z");
beforeAll(async()=>{
  dir=await mkdtemp(path.join(tmpdir(),"teacher-period-fixture-"));
  const env={PATH:process.env.PATH,HOME:process.env.HOME,LANG:"C.UTF-8"};
  execFileSync("initdb",["-D",path.join(dir,"data"),"-U","period_fixture","-A","trust","--no-locale"],{env,stdio:"ignore"});
  postgres=spawn("postgres",["-D",path.join(dir,"data"),"-k",dir,"-h","","-p","5432"],{env,stdio:"ignore"});
  db=new DatabasePool({host:dir,port:5432,user:"period_fixture",database:"postgres",connectionTimeoutMillis:500});
  for(let i=0;i<100;i++){try{await db.query("SELECT 1");break;}catch{if(i===99)throw Error("Isolated fixture unavailable");await new Promise(r=>setTimeout(r,30));}}
  await db.query(`CREATE TABLE schools(id int,status text);
    CREATE TABLE employees(id int,school_id int,user_id int,employment_status text,employee_type text);
    CREATE TABLE app_users(id int,status text);
    CREATE TABLE school_memberships(user_id int,school_id int,role text,status text);
    CREATE TABLE school_classes(id int,school_id int,name text);
    CREATE TABLE subjects(id int,school_id int,name text);
    CREATE TABLE academic_sessions(id int,school_id int,start_date date,end_date date);
    CREATE TABLE academic_terms(id int,school_id int,academic_session_id int,start_date date,end_date date);
    CREATE TABLE teacher_class_assignments(school_id int,employee_id int,academic_session_id int,
      school_class_id int,status text,section text,start_date date,end_date date,assignment_type text,subject_id int);
    CREATE TABLE academic_timetable_entries(id int,school_id int,teacher_employee_id int,school_class_id int,
      subject_id int,academic_session_id int,academic_term_id int,section text,start_time time,end_time time,
      status text,weekday text);
    CREATE TABLE audit_logs(id serial,"timestamp" timestamptz DEFAULT now(),metadata jsonb,school_id int,
      "user" text,action text,module text,event_type text,role text,result text);
    ALTER TABLE schools ADD COLUMN communication_defaults jsonb DEFAULT '{"ACADEMIC":["IN_APP","PUSH"]}';
    ALTER TABLE school_classes ADD COLUMN section text DEFAULT '';
    CREATE TABLE parents(id int,user_id int,school_id int,status text);
    CREATE TABLE students(id int,user_id int,school_id int,status text,class_name text,section text);
    CREATE TABLE parent_student_relationships(parent_id int,student_id int,status text);
    CREATE TABLE communication_preferences(user_id int,school_id int,category text,channel text,enabled boolean);
    CREATE TABLE communication_notifications(id serial,recipient_user_id int,school_id int,
      subject_student_id int,subject_class_id int,category text,event_key text,subject text,body text,link text);
    CREATE UNIQUE INDEX period_event_unique ON communication_notifications(school_id,event_key,recipient_user_id)
      WHERE school_id IS NOT NULL AND event_key IS NOT NULL;
    CREATE TABLE communication_deliveries(id serial,notification_id int,channel text,status text,
      sent_at timestamptz,next_attempt_at timestamptz,UNIQUE(notification_id,channel));
    CREATE TABLE communication_push_devices(user_id int,school_id int,status text,subscription jsonb,session_id text);`);
},30000);
afterAll(async()=>{
  await db?.end();
  if(postgres?.exitCode===null){postgres.kill("SIGTERM");await new Promise<void>(r=>postgres.once("exit",()=>r()));}
  if(dir)await rm(dir,{recursive:true,force:true});
});
beforeEach(async()=>{
  vi.stubEnv("NODE_ENV","development");vi.stubEnv("REPLIT_DEPLOYMENT","");
  vi.stubEnv("EDUCORE_DEVELOPMENT_WORKERS_PAUSED","false");
  vi.stubEnv("EDUCORE_DEVELOPMENT_PAYMENT_TEST_NOTIFICATIONS_DISABLED","false");
  await db.query(`TRUNCATE schools,employees,app_users,school_memberships,school_classes,subjects,
    academic_sessions,academic_terms,teacher_class_assignments,academic_timetable_entries,audit_logs,
    parents,students,parent_student_relationships,communication_preferences,communication_notifications,
    communication_deliveries,communication_push_devices;
    INSERT INTO schools VALUES(1,'ACTIVE');
    INSERT INTO employees VALUES(10,1,100,'ACTIVE','TEACHER');
    INSERT INTO app_users VALUES(100,'ACTIVE'),(200,'ACTIVE'),(300,'ACTIVE');
    INSERT INTO school_memberships VALUES(100,1,'TEACHER','ACTIVE'),(200,1,'STUDENT','ACTIVE'),(300,1,'PARENT','ACTIVE');
    INSERT INTO school_classes VALUES(20,1,'Year 1');
    INSERT INTO subjects VALUES(30,1,'Maths');
    INSERT INTO academic_sessions VALUES(40,1,'2026-09-01','2027-07-31');
    INSERT INTO academic_terms VALUES(50,1,40,'2026-09-01','2026-12-20');
    INSERT INTO teacher_class_assignments VALUES(1,10,40,20,'ACTIVE','','2026-09-01',NULL,'SUBJECT_TEACHER',30);
    INSERT INTO academic_timetable_entries VALUES(60,1,10,20,30,40,50,'','08:00','08:45','ACTIVE','MONDAY');`);
});
afterEach(()=>vi.unstubAllEnvs());
const periods=async(now=before,zone="Africa/Lagos")=>(await db.query(teacherPeriodsSql,[1,now.toISOString(),zone])).rows as any[];
const notices=async(now=before)=>(await periods(now)).flatMap(p=>periodNotices(p,"Africa/Lagos",now));
it("triggers five minutes before and at the end, never outside the due minute",async()=>{
  const first=await notices();
  expect(first).toHaveLength(1);expect(first[0].eventKey).toBe("TEACHER_PERIOD:60:2026-11-09:BEFORE");
  expect(first[0].body).toContain("Maths · Year 1");expect(first[0].body).toContain("08:00–08:45 Africa/Lagos");
  expect(first[0].channels).toEqual(["IN_APP","PUSH","TELEGRAM"]);expect(first[0].useSchoolDefaults).toBe(false);
  expect(await notices(new Date("2026-11-09T06:54:59Z"))).toEqual([]);
  expect(await notices(new Date("2026-11-09T06:56:00Z"))).toEqual([]);
  expect((await notices(new Date("2026-11-09T07:45:00Z")))[0].eventKey).toMatch(/:END$/);
  expect(await notices(new Date("2026-11-09T07:46:00Z"))).toEqual([]);
});
it("supports each assignment role and deduplicates both; excludes parents/students and inactive assignments",async()=>{
  expect((await notices()).map(n=>n.recipientUserId)).toEqual([100]);
  await db.query("UPDATE teacher_class_assignments SET assignment_type='CLASS_TEACHER',subject_id=NULL");
  expect((await notices()).map(n=>n.recipientUserId)).toEqual([100]);
  await db.query(`INSERT INTO teacher_class_assignments VALUES(1,10,40,20,'ACTIVE','','2026-09-01',NULL,'SUBJECT_TEACHER',30)`);
  expect(await notices()).toHaveLength(1);
  await db.query("UPDATE teacher_class_assignments SET status='INACTIVE'");
  expect(await notices()).toEqual([]);
});
it("uses actual school timezone including a reminder across local midnight",async()=>{
  expect(periodNotices((await periods(before,"UTC"))[0],"UTC",before)).toEqual([]);
  const ny=new Date("2026-11-09T12:55:00Z");
  expect(periodNotices((await periods(ny,"America/New_York"))[0],"America/New_York",ny)).toHaveLength(1);
  await db.query("UPDATE academic_timetable_entries SET start_time='00:02',end_time='00:45',weekday='TUESDAY'");
  const now=new Date("2026-11-09T22:57:00Z");
  const n=(await periods(now)).flatMap(p=>periodNotices(p,"Africa/Lagos",now));
  expect(n).toHaveLength(1);expect(n[0].eventKey).toContain("2026-11-10");
});
it.each([
  "UPDATE academic_timetable_entries SET status='CANCELLED'",
  "DELETE FROM academic_timetable_entries",
  "UPDATE academic_timetable_entries SET start_time='08:10'",
  "UPDATE academic_timetable_entries SET end_time='08:50'",
  "UPDATE subjects SET name='Changed subject'",
  "UPDATE employees SET employment_status='INACTIVE'",
  "UPDATE school_memberships SET status='INACTIVE' WHERE user_id=100",
  "UPDATE academic_terms SET end_date='2026-11-08'",
])("invalidates queued push after timetable/eligibility change: %s",async sql=>{
  const record=(await notices())[0];
  expect(await teacherPeriodStillCurrent(db,record,before)).toBe(true);
  await db.query(sql);
  expect(await teacherPeriodStillCurrent(db,record,before)).toBe(false);
});
it("expires held reminders instead of replaying at or after the start",async()=>{
  const record=(await notices())[0];
  expect(await teacherPeriodStillCurrent(db,record,new Date("2026-11-09T07:00:00Z"))).toBe(false);
});
it.each(["EDUCORE_DEVELOPMENT_WORKERS_PAUSED","EDUCORE_DEVELOPMENT_PAYMENT_TEST_NOTIFICATIONS_DISABLED","REPLIT_DEPLOYMENT"])(
  "makes no queue queries when the Development safety guard %s is set",async key=>{
    vi.stubEnv(key,"true");
    const query=vi.fn(),connect=vi.fn();
    await queueTeacherPeriodNotifications({query,connect} as any,before);
    expect(query).not.toHaveBeenCalled();expect(connect).not.toHaveBeenCalled();
  });
it("keeps a paused Owner control closed using the actual audit timestamp column",async()=>{
  const connect=vi.fn();
  await queueTeacherPeriodNotifications({query:db.query.bind(db),connect} as any,before);
  expect(connect).not.toHaveBeenCalled();
});
it("queues each trigger once across repeated/concurrent ticks with independent channels and one audit",async()=>{
  await db.query(`INSERT INTO audit_logs(module,event_type,role,result,metadata) VALUES
    ('OwnerNotificationDelivery','DEVELOPMENT_DELIVERY_CONTROLS_UPDATED','PLATFORM_OWNER','SUCCESS',
    '{"controls":{"paused":false,"smsEnabled":false,"pushEnabled":true,"telegramEnabled":false,"pushParentIds":[100]},"activatedAt":"2026-11-09T00:00:00Z"}')`);
  await Promise.all([queueTeacherPeriodNotifications(db,before),queueTeacherPeriodNotifications(db,before)]);
  await queueTeacherPeriodNotifications(db,before);
  expect((await db.query("SELECT * FROM communication_notifications")).rows).toHaveLength(1);
  const deliveries=(await db.query("SELECT channel,status FROM communication_deliveries ORDER BY channel")).rows;
  expect(deliveries).toEqual([{channel:"IN_APP",status:"SENT"},{channel:"PUSH",status:"QUEUED"}]);
  expect((await db.query("SELECT * FROM audit_logs WHERE event_type='TEACHER_PERIOD_QUEUED'")).rows).toHaveLength(1);
  await queueTeacherPeriodNotifications(db,new Date("2026-11-09T07:45:00Z"));
  expect((await db.query("SELECT * FROM communication_notifications")).rows).toHaveLength(2);
  // A failed push has no effect on the already independently delivered inbox copy.
  await db.query("UPDATE communication_deliveries SET status='FAILED' WHERE channel='PUSH'");
  expect((await db.query("SELECT * FROM communication_deliveries WHERE channel='IN_APP' AND status='SENT'")).rows).toHaveLength(2);
});
it("offers only registered, explicitly consenting active teachers to the existing Owner push selector",async()=>{
  await db.query(`INSERT INTO communication_push_devices VALUES(100,1,'ACTIVE','{}','fixture-session')`);
  expect(await pushTestCandidates(db)).toEqual([]);
  await db.query("INSERT INTO communication_preferences VALUES(100,1,'ACADEMIC','PUSH',true)");
  expect((await pushTestCandidates(db)).map(c=>c.userId)).toEqual([100]);
  await db.query("UPDATE employees SET employment_status='INACTIVE'");
  expect(await pushTestCandidates(db)).toEqual([]);
});
