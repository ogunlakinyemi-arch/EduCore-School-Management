import {readFileSync} from "node:fs";
import {join} from "node:path";
import {afterAll,beforeAll,beforeEach,expect,it,vi} from "vitest";
import {currentFinancialFixture} from "./current-financial-fixture.test-support";

const state=vi.hoisted(()=>({now:new Date("2027-01-25T08:00:00Z")}));
vi.mock("@workspace/db",()=>({pool:{query:()=>{throw Error("Application database forbidden");}}}));
vi.mock("./student-platform-rollout",async original=>({
 ...await original<any>(),readStudentUsageRollout:async()=>({chargeable:false,freeAccess:true}),
}));
// The existing producer, SQL selection and final eligibility are real. Only the
// central notification insert is substituted; transport/consent tests live in
// communication-service.test.ts. No provider or application database is used.
vi.mock("./communication-service",()=>({queueCommunicationNotification:async(c:any,input:any)=>{
 if(!await financialReminderStillCurrent(c,input,state.now))return null;
 return (await c.query(`INSERT INTO communication_notifications
  (school_id,recipient_user_id,event_key,subject_student_id,body)
  VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id`,
  [input.schoolId,input.recipientUserId,input.eventKey,input.subjectStudentId,input.body])).rows[0]?.id??null;
}}));
import {feeReminderDigest,financialReminderStillCurrent,guardianSchoolFeeSql} from "./financial-reminder-eligibility";
import {financialReminderScope} from "./financial-reminder-policy";
import {queueWeeklyFinancialReminders} from "./financial-reminder-worker";
import {linkedGuardianInvoiceSql,publishedSchoolInvoiceSql,schoolFeeCarryForward} from "./school-fee-carry-forward";

let f:Awaited<ReturnType<typeof currentFinancialFixture>>;
const feeRows=()=>f.pool.query(guardianSchoolFeeSql,[1,"2027-01-25"]).then(r=>r.rows);
const familyRows=(user:number)=>f.pool.query(`SELECT i.id,i.student_id AS "studentId",
 i.academic_term_id AS "academicTermId",i.due_date::text AS "dueDate",
 i.outstanding_minor AS "outstandingMinor",i.paid_minor AS "paidMinor",i.status
 FROM fee_invoices i WHERE ${publishedSchoolInvoiceSql()} AND ${linkedGuardianInvoiceSql()} ORDER BY i.id`,[user]).then(r=>r.rows);
const snapshot=async()=>{
 const result:Record<string,unknown>={};
 for(const table of ["fee_invoices","fee_invoice_lines","fee_adjustments","fee_payments","fee_payment_line_allocations","fee_receipts"])
  result[table]=(await f.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY id`)).rows;
 return result;
};
beforeAll(async()=>{
 f=await currentFinancialFixture();
 // Actual fee DDL and allocation trigger, on the helper's verified fresh,
 // socket-only cluster. These statements never target the application database.
 await f.pool.query(`CREATE UNIQUE INDEX fixture_students_tenant ON students(id,school_id);
  CREATE UNIQUE INDEX fixture_sessions_tenant ON academic_sessions(id,school_id);
  CREATE UNIQUE INDEX fixture_terms_tenant ON academic_terms(id,school_id);
  CREATE TABLE school_classes(id integer PRIMARY KEY,school_id integer,UNIQUE(id,school_id));
  INSERT INTO school_classes VALUES(1,1),(2,2);
  ALTER TABLE schools ADD COLUMN name text DEFAULT 'Fictional school';
  ALTER TABLE students ADD COLUMN first_name text DEFAULT 'Fictional',ADD COLUMN last_name text DEFAULT 'Child';
  ALTER TABLE student_subscription_terms ADD COLUMN legacy_invoice_id integer;
  CREATE TABLE parents(id integer PRIMARY KEY,user_id integer REFERENCES app_users(id),school_id integer,status text);
  CREATE TABLE parent_student_relationships(parent_id integer REFERENCES parents(id),student_id integer REFERENCES students(id),status text);
  CREATE TABLE communication_notifications(id serial PRIMARY KEY,school_id integer,recipient_user_id integer,
   event_key text,subject_student_id integer,body text,UNIQUE(school_id,recipient_user_id,event_key));
  INSERT INTO app_users(id) SELECT generate_series(101,110);
  INSERT INTO students(id,school_id,status,admission_status,first_name,last_name)
   VALUES(1001,1,'ACTIVE','ADMITTED','Linked','Child'),(1002,1,'ACTIVE','ADMITTED','Other','Family'),
    (2001,2,'ACTIVE','ADMITTED','Other','School');
  INSERT INTO academic_terms VALUES(3,1,1,'2026-09-07','2026-12-18','First Term',false,'INACTIVE'),
   (4,1,1,'2027-04-26','2027-07-23','Third Term',false,'PLANNED');
  INSERT INTO parents SELECT n,n,CASE WHEN n IN(108,109) THEN 2 ELSE 1 END,'ACTIVE' FROM generate_series(101,110) n;
  UPDATE parents SET status='INACTIVE' WHERE id=106;
  UPDATE app_users SET status='INACTIVE' WHERE id=104;
  INSERT INTO parent_student_relationships SELECT n,CASE WHEN n=103 THEN 1002 ELSE 1001 END,
   CASE WHEN n=105 THEN 'INACTIVE' ELSE 'ACTIVE' END FROM generate_series(101,110) n;
  INSERT INTO school_memberships SELECT n,CASE WHEN n=109 THEN 2 ELSE 1 END,'PARENT',
   CASE WHEN n=107 THEN 'INACTIVE' ELSE 'ACTIVE' END FROM generate_series(101,109) n;
  INSERT INTO school_memberships VALUES(107,1,'TEACHER','ACTIVE');`);
 await f.pool.query(readFileSync(join(f.root,"lib/db/drizzle/0013_phase7_finance.sql"),"utf8"));
 await f.pool.query(`CREATE UNIQUE INDEX fixture_payment_invoice ON fee_payments(id,invoice_id,school_id)`);
 await f.pool.query(readFileSync(join(f.root,"lib/db/drizzle/0055_academic_calendar_fee_lines_cash.sql"),"utf8"));
 // id, child, term, subtotal, discount, waiver, paid, outstanding, status, due.
 const rows=[
  [100,1001,3,100000,10000,5000,25000,60000,"PARTIALLY_PAID","2026-10-01"],
  [101,1001,1,50000,0,0,0,50000,"UNPAID","2027-01-25"],
  [102,1002,3,90000,0,0,0,90000,"UNPAID","2026-10-01"],
  [103,1001,3,50000,0,0,50000,0,"PAID","2026-10-01"],
  [104,1001,3,50000,0,50000,0,0,"WAIVED","2026-10-01"],
  [105,1001,3,1000,0,0,0,1000,"CANCELLED","2026-10-01"],
  [106,1001,3,1000,0,0,0,1000,"UNPAID","2026-10-01"],
  [107,1001,3,320000,0,0,0,320000,"UNPAID","2026-10-01"],
  [108,1001,1,1000,0,0,0,1000,"UNPAID","2027-04-01"],
  [109,1001,3,5000,0,5000,0,0,"WAIVED","2026-10-01"],
  [110,1001,3,5000,5000,0,0,0,"PAID","2026-10-01"],
 ];
 for(const [id,child,term,subtotal,discount,waiver,paid,outstanding,status,due] of rows){
  await f.pool.query(`INSERT INTO fee_structures(id,school_id,academic_session_id,academic_term_id,
   school_class_id,version,status,created_by,published_by) VALUES($1,1,1,$2,1,$1,$3,1,$4)`,
   [id,term,id===106?"DRAFT":"PUBLISHED",id===106?null:1]);
  await f.pool.query(`INSERT INTO fee_invoices(id,school_id,student_id,structure_id,academic_session_id,
   academic_term_id,invoice_number,student_name_snapshot,admission_no_snapshot,class_name_snapshot,section_snapshot,
   issue_date,due_date,subtotal_minor,discount_minor,waiver_minor,total_minor,paid_minor,outstanding_minor,status,created_by)
   VALUES($1,1,$2,$1,1,$3,'FICTIONAL-'||$1::int::text,'Fictional child','FIXTURE','Class','',
   '2026-09-01',$4,$5,$6,$7,$5::int-$6::int-$7::int,$8,$9,$10,1)`,
   [id,child,term,due,subtotal,discount,waiver,paid,outstanding,status]);
 }
 await f.pool.query(`INSERT INTO fee_structures(id,school_id,academic_session_id,academic_term_id,school_class_id,
   version,status,created_by,published_by) VALUES(200,2,2,2,2,1,'PUBLISHED',1,1);
  INSERT INTO fee_invoices SELECT (jsonb_populate_record(NULL::fee_invoices,
   to_jsonb(i)||'{"id":200,"school_id":2,"student_id":2001,"structure_id":200,"academic_session_id":2,
    "academic_term_id":2,"invoice_number":"PRIVATE-OTHER-SCHOOL"}'::jsonb)).* FROM fee_invoices i WHERE id=101;
  INSERT INTO student_subscription_terms(student_id,school_id,academic_term_id,legacy_invoice_id) VALUES(1001,1,3,107);
  INSERT INTO fee_invoice_lines(id,school_id,invoice_id,category_name_snapshot,description_snapshot,amount_minor)
   VALUES(500,1,100,'Tuition','Fictional original line',100000);
  INSERT INTO fee_adjustments(school_id,invoice_id,kind,amount_minor,reason,status,requested_by,approved_by)
   VALUES(1,100,'DISCOUNT',10000,'Fictional discount','APPROVED',1,1),
    (1,100,'WAIVER',5000,'Fictional waiver','APPROVED',1,1),
    (1,109,'SCHOLARSHIP',5000,'Fictional scholarship','APPROVED',1,1);
  INSERT INTO fee_payments(id,school_id,invoice_id,student_id,parent_id,reference,idempotency_key,amount_minor,
   method,status,submitted_by,verified_by,verified_at,verification_evidence_ref,reviewer_notes,verification_metadata)
   VALUES(500,1,100,1001,101,'FICTIONAL-HISTORY','fictional-original-partial',25000,
    'BANK_TRANSFER','VERIFIED',101,1,'2026-10-01Z','FICTIONAL-EVIDENCE','Fictional history only','{"fictional":true}');
  INSERT INTO fee_payment_line_allocations(school_id,invoice_id,payment_id,line_id,amount_minor) VALUES(1,100,500,500,25000);`);
},60000);
afterAll(async()=>{await f?.stop();});
beforeEach(async()=>{
 state.now=new Date("2027-01-25T08:00:00Z");
 await f.pool.query(`TRUNCATE communication_notifications;
  UPDATE school_memberships SET status=CASE WHEN user_id=107 AND role='PARENT' THEN 'INACTIVE' ELSE 'ACTIVE' END;
  UPDATE parent_student_relationships SET status=CASE WHEN parent_id=105 THEN 'INACTIVE' ELSE 'ACTIVE' END;
  UPDATE fee_invoices SET paid_minor=25000,outstanding_minor=60000,status='PARTIALLY_PAID' WHERE id=100;
  UPDATE academic_terms SET is_current=(id=1) WHERE school_id=1;`);
});
it("selects every eligible guardian independently, but never another family's invoice or a revoked Parent role",async()=>{
 const rows=await feeRows();
 expect(rows.map(r=>`${r.id}:${r.recipientUserId}`).sort()).toEqual(
  ["100:101","100:102","100:108","101:101","101:102","101:108","102:103"]);
 expect(rows.filter(r=>Number(r.recipientUserId)===103).every(r=>Number(r.studentId)===1002)).toBe(true);
});
it("lets a guardian read original invoices with an active role in the child's school, not just their profile default",async()=>{
 const ids=async(user:number)=>(await familyRows(user)).map(r=>r.id);
 expect(await ids(108)).toEqual(await ids(101));
 expect(await ids(102)).toEqual(await ids(101));
 expect(await ids(103)).toEqual([102]);
 for(const user of [105,106,107,109,110])expect(await ids(user)).toEqual([]);
 expect(await ids(101)).not.toContain(107);expect(await ids(101)).not.toContain(106);
});
it("keeps reminders independent of a free platform term and deduplicates concurrent ticks per guardian/invoice/day",async()=>{
 const before=await snapshot();
 const results=await Promise.all([queueWeeklyFinancialReminders(f.pool as any,state.now),queueWeeklyFinancialReminders(f.pool as any,state.now)]);
 expect(results.reduce((n,r)=>n+r.queued,0)).toBe(7);
 await queueWeeklyFinancialReminders(f.pool as any,state.now);
 const notes=(await f.pool.query("SELECT * FROM communication_notifications")).rows;
 expect(notes).toHaveLength(7);
 expect(notes.filter(n=>n.recipient_user_id===103).every(n=>n.subject_student_id===1002&&n.body.includes("₦900"))).toBe(true);
 expect(notes.filter(n=>n.recipient_user_id!==103).every(n=>n.subject_student_id===1001&&!n.body.includes("Other Family"))).toBe(true);
 expect(notes.every(n=>!/BRO|commission|remittance|platform|₦3,200/i.test(n.body))).toBe(true);
 state.now=new Date("2027-01-29T08:00:00Z");
 expect(await queueWeeklyFinancialReminders(f.pool as any,state.now)).toEqual({queued:7});
 expect(await snapshot()).toEqual(before);
});
it("rechecks child/guardian authorization, balances and scheduled-day freshness before an external attempt",async()=>{
 const row=(await feeRows()).find(r=>r.id===100&&r.recipientUserId===101)!;
 const record={eventKey:financialReminderScope("2027-01-25","FEE",100,3)+feeReminderDigest(row),
  schoolId:1,recipientUserId:101,subjectStudentId:1001};
 expect(await financialReminderStillCurrent(f.pool,record,state.now)).toBe(true);
 expect(await financialReminderStillCurrent(f.pool,{...record,recipientUserId:103},state.now)).toBe(false);
 expect(await financialReminderStillCurrent(f.pool,{...record,subjectStudentId:1002},state.now)).toBe(false);
 await f.pool.query("UPDATE school_memberships SET status='INACTIVE' WHERE user_id=101 AND role='PARENT'");
 expect(await financialReminderStillCurrent(f.pool,record,state.now)).toBe(false);
 await f.pool.query("UPDATE school_memberships SET status='ACTIVE' WHERE user_id=101 AND role='PARENT'");
 await f.pool.query("UPDATE parent_student_relationships SET status='INACTIVE' WHERE parent_id=101");
 expect(await financialReminderStillCurrent(f.pool,record,state.now)).toBe(false);
 await f.pool.query("UPDATE parent_student_relationships SET status='ACTIVE' WHERE parent_id=101");
 await f.pool.query("UPDATE fee_invoices SET paid_minor=35000,outstanding_minor=50000 WHERE id=100");
 expect(await financialReminderStillCurrent(f.pool,record,state.now)).toBe(false);
 expect(await financialReminderStillCurrent(f.pool,record,new Date("2027-01-25T23:00:00Z"))).toBe(false);
});
it("carries only net unpaid school balances through successive terms without touching original debt or explicit allocations",async()=>{
 const before=await snapshot(),original=await familyRows(101);
 expect(schoolFeeCarryForward(original,1,"2027-01-25")).toMatchObject({outstandingMinor:111000,arrearsMinor:60000});
 await f.pool.query("UPDATE academic_terms SET is_current=(id=4) WHERE school_id=1");
 const next=await familyRows(101);
 expect(schoolFeeCarryForward(next,4,"2027-04-26")).toMatchObject({outstandingMinor:111000,arrearsMinor:111000});
 expect(next).toEqual(original);expect(await snapshot()).toEqual(before);
 expect((await f.pool.query("SELECT invoice_id,line_id,amount_minor FROM fee_payment_line_allocations")).rows)
  .toEqual([{invoice_id:100,line_id:500,amount_minor:25000}]);
});
it("refuses a duplicate debt assignment even with a new invoice id and number, preserving the complete original history",async()=>{
 const before=await snapshot();
 await expect(f.pool.query(`INSERT INTO fee_invoices SELECT (jsonb_populate_record(NULL::fee_invoices,
  to_jsonb(i)||'{"id":300,"invoice_number":"FICTIONAL-DUPLICATE"}'::jsonb)).*
  FROM fee_invoices i WHERE id=100`)).rejects.toThrow(/fee_invoices_assignment_unique/);
 expect(await snapshot()).toEqual(before);
});
