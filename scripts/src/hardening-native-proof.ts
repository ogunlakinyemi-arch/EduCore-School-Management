import {createRequire} from "node:module";
import assert from "node:assert/strict";
const {Client}=createRequire(process.cwd()+"/lib/db/package.json")("pg");
const c=new Client({host:"/tmp",port:55435,user:"postgres",database:"postgres"});
await c.connect();
const target=(await c.query("SELECT current_setting('data_directory') dir,inet_server_addr() host")).rows[0];
assert.equal(target.dir,"/tmp/educore-hardening-pgdata");assert.equal(target.host,null);
// Process-local override, not a workspace secret change. All imported services use the disposable database.
process.env.DATABASE_URL="postgresql://postgres@localhost:55435/postgres?host=%2Ftmp";
const {pool}=await import("../../lib/db/src/index");
assert.equal((await pool.query("SELECT current_setting('data_directory') dir")).rows[0].dir,"/tmp/educore-hardening-pgdata");
const {issueReplacement}=await import("../../artifacts/api-server/src/services/student-card-replacement");
const scalar=async(sql:string,p:any[]=[]) => (await c.query(sql,p)).rows[0].id;
const suffix=String(Date.now());
const cardholderType=process.argv.includes("--teacher")?"TEACHER":"STAFF";
const user=await scalar("INSERT INTO app_users(clerk_user_id,email) VALUES($1,$2) RETURNING id",['native-hardening-owner-'+suffix,'native-'+suffix+'@example.invalid']);
const school=await scalar("INSERT INTO schools(code,name,city,state) VALUES($1,'Disposable fixture','QA','Lagos') RETURNING id",['NH-'+suffix]);
const session=await scalar("INSERT INTO academic_sessions(school_id,name,start_date,end_date,is_current) VALUES($1,'Fixture session','2026-01-01','2026-12-31',true) RETURNING id",[school]);
const term=await scalar("INSERT INTO academic_terms(school_id,academic_session_id,name,start_date,end_date,is_current) VALUES($1,$2,'Fixture term','2026-09-01','2026-12-31',true) RETURNING id",[school,session]);
const employee=await scalar("INSERT INTO employees(school_id,employee_no,first_name,last_name,employee_type) VALUES($1,'NATIVE-EMPLOYEE','Fixture','Employee',$2) RETURNING id",[school,cardholderType]);
const uid='native-new-'+suffix;
const old=await scalar("INSERT INTO nfc_cards(school_id,uid,status) VALUES($1,$2,'lost') RETURNING id",[school,'native-old-'+suffix]);
const fresh=await scalar("INSERT INTO nfc_cards(school_id,uid,status) VALUES($1,$2,'unassigned') RETURNING id",[school,uid]);
await c.query("INSERT INTO employee_nfc_card_bindings(school_id,nfc_card_id,employee_id,status,created_by_user_id) VALUES($1,$2,$3,'ACTIVE',$4)",[school,old,employee,user]);
const invoice=await scalar(`INSERT INTO fee_invoices(school_id,employee_id,academic_session_id,academic_term_id,invoice_number,
 student_name_snapshot,admission_no_snapshot,class_name_snapshot,section_snapshot,issue_date,due_date,subtotal_minor,total_minor,outstanding_minor,created_by)
 VALUES($1,$2,$3,$4,'NATIVE-REPLACEMENT','Fixture Teacher','NATIVE-TEACHER','NFC replacement','','2026-10-04','2026-10-04',200000,200000,200000,$5) RETURNING id`,[school,employee,session,term,user]);
const request=await scalar("INSERT INTO student_nfc_replacement_requests(school_id,employee_id,old_card_id,invoice_id,requested_by,reason) VALUES($1,$2,$3,$4,$5,'Native fixture') RETURNING id",[school,employee,old,invoice,user]);
const ctx=(role:string):any=>({edupulseUser:{user:{id:user,email:"native-owner@example.invalid",clerkUserId:"native-hardening-owner",status:"ACTIVE"},roles:[{role,schoolId:role==="PLATFORM_OWNER"?null:school,status:"ACTIVE"}]}});
await assert.rejects(()=>issueReplacement(ctx("SCHOOL_ADMIN"),request,uid),/not authorized/);
await assert.rejects(()=>issueReplacement(ctx("PLATFORM_OWNER"),request,uid),/verified NGN 2,000/);
const payment=await scalar(`INSERT INTO fee_payments(school_id,invoice_id,reference,idempotency_key,amount_minor,method,submitted_by,status,verified_by,verified_at,verification_evidence_ref,transfer_bank,transfer_reference,transfer_date,reviewer_notes,verification_metadata)
 VALUES($1,$2,$4,$4,200000,'BANK_TRANSFER',$3,'VERIFIED',$3,NOW(),$4,'Synthetic QA Bank',$4,CURRENT_DATE,'Synthetic verified evidence','{"source":"disposable-native-fixture"}') RETURNING id`,[school,invoice,user,'NATIVE-'+suffix]);
assert.equal((await c.query("SELECT employee_id FROM fee_payments WHERE id=$1",[payment])).rows[0].employee_id,employee);
await c.query("INSERT INTO fee_receipts(school_id,payment_id,invoice_id,receipt_number,snapshot) VALUES($1,$2,$3,'NATIVE-RECEIPT','{}')",[school,payment,invoice]);
await c.query("UPDATE fee_invoices SET paid_minor=200000,outstanding_minor=0,status='PAID' WHERE id=$1",[invoice]);
const issued=await issueReplacement(ctx("PLATFORM_OWNER"),request,uid);
assert.equal(issued.status,"ISSUED");assert.equal(issued.employeeId,employee);assert.equal(issued.newCardId,fresh);
assert.equal(issued.cardholderType,cardholderType);
assert.equal((await c.query("SELECT status FROM nfc_cards WHERE id=$1",[old])).rows[0].status,"replaced");
await assert.rejects(()=>c.query("UPDATE nfc_cards SET status='active' WHERE id=$1",[old]),/permanently revoked/);
assert.equal((await issueReplacement(ctx("PLATFORM_OWNER"),request,uid)).id,request);
console.log(JSON.stringify({cardholderType,disposableOnly:true,adminIssuanceDenied:true,unpaidIssuanceDenied:true,employeePaymentIdentity:true,paidOwnerIssuance:true,oldUidRevoked:true,replayIdempotent:true}));
await pool.end();await c.end();