import assert from "node:assert/strict";
import {createRequire} from "node:module";
const {Client}=createRequire(process.cwd()+"/lib/db/package.json")("pg");
const db=new Client({host:"/tmp",port:55435,user:"postgres",database:"postgres"});
await db.connect();
assert.equal((await db.query("SELECT current_setting('data_directory') dir")).rows[0].dir,"/tmp/educore-academic-pgdata");
if(process.env.REPLIT_DEPLOYMENT) throw Error("Native Development tests only");
process.env.DATABASE_URL="postgresql://postgres@localhost:55435/postgres?host=%2Ftmp";
const {pool}=await import(new URL("../../lib/db/src/index.ts",import.meta.url).href);
assert.equal((await pool.query("SELECT current_setting('data_directory') dir")).rows[0].dir,"/tmp/educore-academic-pgdata");
const express=createRequire(process.cwd()+"/artifacts/api-server/package.json")("express");
const {default:academic}=await import(new URL("../../artifacts/api-server/src/routes/academic.ts",import.meta.url).href);
const {default:academicWork}=await import(new URL("../../artifacts/api-server/src/routes/academic-work.ts",import.meta.url).href);
const {default:results}=await import(new URL("../../artifacts/api-server/src/routes/academic-results.ts",import.meta.url).href);
const {default:finance}=await import(new URL("../../artifacts/api-server/src/routes/finance.ts",import.meta.url).href);
// Native route tests use explicit synthetic authenticated identities, not real Clerk sessions.
// All downstream authorization, SQL, transactions, audits and receipts are the real implementation.
for(const router of [academic,academicWork,results,finance]) (router as any).stack[0].handle=(_req:any,_res:any,next:any)=>next();
const insert=async(sql:string,p:any[]=[])=>Number((await db.query(sql,p)).rows[0].id);
const suffix=String(Date.now());
const school=await insert("INSERT INTO schools(code,name,city,state) VALUES($1,'Native academic QA','QA','Lagos') RETURNING id",["ACA-"+suffix]);
const otherSchool=await insert("INSERT INTO schools(code,name,city,state) VALUES($1,'Native other QA','QA','Lagos') RETURNING id",["ACB-"+suffix]);
const actors:Record<string,any>={};
async function actor(key:string,role:string,schoolId=school) {
  const id=await insert("INSERT INTO app_users(clerk_user_id,email) VALUES($1,$2) RETURNING id",[`native-${suffix}-${key}`,`${key}-${suffix}@example.invalid`]);
  await db.query("INSERT INTO school_memberships(user_id,school_id,role,status) VALUES($1,$2,$3,'ACTIVE')",[id,schoolId,role]);
  actors[key]={user:{id,email:`${key}-${suffix}@example.invalid`,clerkUserId:`native-${suffix}-${key}`,status:"ACTIVE"},roles:[{role,schoolId,status:"ACTIVE"}]};
  return id;
}
const admin=await actor("admin","SCHOOL_ADMIN");
await actor("other","SCHOOL_ADMIN",otherSchool);
const teacherUsers=[];for(let i=0;i<4;i++) teacherUsers.push(await actor(`teacher${i}`,"TEACHER"));
const studentUser=await actor("student","STUDENT"),parentUser=await actor("parent","PARENT");
const app=express();app.use(express.json());app.use((req:any,_res:any,next:any)=>{req.edupulseUser=actors[String(req.headers["x-native-actor"]??"admin")];next();});
app.use(academic,academicWork,results,finance);app.use((error:any,_req:any,res:any,_next:any)=>res.status(error.statusCode??error.status??500).json({error:error.message}));
const server=app.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
const base=`http://127.0.0.1:${(server.address() as any).port}`;
let passed=0;const evidence:string[]=[];
function check(name:string,fn:()=>void){fn();passed++;evidence.push(name);}
async function request(path:string,body?:any,who="admin",method=body===undefined?"GET":"POST",headers:Record<string,string>={}) {
  const response=await fetch(base+path,{method,headers:{"x-native-actor":who,...(body!==undefined?{"Content-Type":"application/json"}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const json:any=await response.json();
  return {status:response.status,body:json};
}
try {
  const session=await request(`/academic-sessions?schoolId=${school}`,{name:"2026/2027 QA "+suffix,startDate:"2026-09-01",endDate:"2027-07-31",status:"ACTIVE"});
  check("session creation and creator persist",()=>{assert.equal(session.status,201,JSON.stringify(session.body));assert.equal(session.body.createdBy,admin);});
  const sid=session.body.id;
  const term=await request(`/academic-sessions/${sid}/terms?schoolId=${school}`,{name:"FIRST",startDate:"2026-09-01",endDate:"2026-12-20",status:"ACTIVE"});
  check("term belongs to its own session",()=>{assert.equal(term.status,201);assert.equal(term.body.sessionId,sid);});
  const tid=term.body.id;
  const duplicate=await request(`/academic-sessions/${sid}/terms?schoolId=${school}`,{name:"FIRST",startDate:"2026-09-02",endDate:"2026-12-19"});
  check("duplicate First Term rejected",()=>assert.equal(duplicate.status,409));
  const disjointDuplicate=await request(`/academic-sessions/${sid}/terms?schoolId=${school}`,{name:"FIRST",startDate:"2026-12-21",endDate:"2026-12-28"});
  check("duplicate term with non-overlapping dates returns a conflict, not a server error",()=>assert.equal(disjointDuplicate.status,409));
  const bad=await request(`/academic-sessions/${sid}/terms?schoolId=${school}`,{name:"SECOND",startDate:"2027-02-30",endDate:"2027-04-01"});
  check("invalid date rejected",()=>assert.equal(bad.status,400));
  const overlap=await request(`/academic-sessions/${sid}/terms?schoolId=${school}`,{name:"SECOND",startDate:"2026-12-01",endDate:"2027-04-01"});
  check("implicit overlap rejected",()=>assert.equal(overlap.status,409));
  const explicit=await request(`/academic-sessions/${sid}/terms?schoolId=${school}`,{name:"SECOND",startDate:"2026-12-01",endDate:"2027-04-01",allowOverlap:true,overlapReason:"Controlled QA explicit authorization"});
  check("explicit overlap and audit allowed",()=>assert.equal(explicit.status,201));
  const next=await request(`/academic-sessions?schoolId=${school}`,{name:"2027/2028 QA "+suffix,startDate:"2027-09-01",endDate:"2028-07-31",status:"INACTIVE"});
  const nextTerm=await request(`/academic-sessions/${next.body.id}/terms?schoolId=${school}`,{name:"FIRST",startDate:"2027-09-01",endDate:"2027-12-20",status:"INACTIVE"});
  check("next session First Term is separate",()=>{assert.equal(nextTerm.status,201);assert.notEqual(nextTerm.body.id,tid);});
  const cls=await insert("INSERT INTO school_classes(school_id,name,section) VALUES($1,'JSS1','A') RETURNING id",[school]);
  const current=await insert("INSERT INTO school_classes(school_id,name,section) VALUES($1,'SS2','B') RETURNING id",[school]);
  const students:{student:number;assignment:number}[]=[];for(let i=0;i<2;i++){
    const student=await insert("INSERT INTO students(school_id,admission_no,first_name,last_name,gender,class_name,section,user_id) VALUES($1,$2,'Native','Student','male','SS2','B',$3) RETURNING id",[school,`QA-${suffix}-${i}`,i===0?studentUser:null]);
    const assignment=await insert(`INSERT INTO student_class_assignments(school_id,student_id,academic_session_id,academic_term_id,school_class_id,section,status,start_date)
      VALUES($1,$2,$3,$4,$5,'A','INACTIVE','2026-09-01') RETURNING id`,[school,student,sid,tid,cls]);
    students.push({student,assignment});
  }
  const parent=await insert("INSERT INTO parents(school_id,name,email,phone,user_id) VALUES($1,'Native Parent',$2,'08000000000',$3) RETURNING id",[school,`parent-${suffix}@example.invalid`,parentUser]);
  await db.query("INSERT INTO parent_student_relationships(parent_id,student_id,status) VALUES($1,$2,'ACTIVE')",[parent,students[0].student]);
  await db.query("INSERT INTO academic_grading_rules(school_id,min_score,max_score,grade,grade_point,remark) VALUES($1,0,100,'QA',1,'Configured QA policy')",[school]);
  const subjects:number[]=[],assessments:number[]=[],employees:number[]=[];
  const type=await insert("INSERT INTO academic_assessment_types(school_id,name,code) VALUES($1,'QA Exam','QA-EXAM') RETURNING id",[school]);
  for(let i=0;i<4;i++){
    const employee=await insert("INSERT INTO employees(school_id,employee_no,first_name,last_name,employee_type,user_id) VALUES($1,$2,'Native','Teacher','TEACHER',$3) RETURNING id",[school,`EMP-${suffix}-${i}`,teacherUsers[i]]);
    employees.push(employee);
    const subject=await insert("INSERT INTO subjects(school_id,name,code) VALUES($1,$2,$3) RETURNING id",[school,["Mathematics","English","Basic Science","Social Studies"][i],`S-${i}`]);
    subjects.push(subject);
    await db.query("INSERT INTO class_subjects(school_id,school_class_id,subject_id,academic_session_id,academic_term_id,employee_id,section) VALUES($1,$2,$3,$4,$5,$6,'A')",[school,cls,subject,sid,tid,employee]);
    await db.query("INSERT INTO teacher_class_assignments(school_id,employee_id,academic_session_id,school_class_id,subject_id,section,assignment_type,start_date) VALUES($1,$2,$3,$4,$5,'A','SUBJECT_TEACHER','2026-09-01')",[school,employee,sid,cls,subject]);
    const assessment=await insert(`INSERT INTO academic_assessments(school_id,academic_session_id,academic_term_id,school_class_id,section,subject_id,teacher_employee_id,title,description,assessment_type_id,max_score,assessment_date,status,created_by)
      VALUES($1,$2,$3,$4,'A',$5,$6,'Term examination','Controlled QA',$8,100,'2026-10-01','OPEN',$7) RETURNING id`,[school,sid,tid,cls,subject,employee,admin,type]);
    assessments.push(assessment);
  }
  const scope=`schoolId=${school}&sessionId=${sid}&termId=${tid}&classId=${cls}&section=A`;
  const teacherAssessments=await request(`/academic/assessments?schoolId=${school}&sessionId=${sid}&termId=${tid}`,undefined,"teacher0");
  check("teacher receives admin-created assessments assigned to that teacher, not another subject",()=>{assert.equal(teacherAssessments.status,200);assert.deepEqual(teacherAssessments.body.map((a:any)=>a.id),[assessments[0]]);});
  const roster=await request("/academic/period-students?"+scope);
  check("historical picker returns two past-class students",()=>assert.equal(roster.body.length,2));
  const wrong=await request("/academic/period-students?"+scope,undefined,"other","GET");
  check("cross-school compilation access denied",()=>assert.equal(wrong.status,404));
  const unauthorized=await request("/academic/results",{schoolId:school,assessmentId:assessments[1],studentId:students[0].student,score:82},"teacher0");
  check("teacher cannot enter another subject",()=>assert.equal(unauthorized.status,403));
  const resultIds:number[][]=[[],[]];
  for(let i=0;i<3;i++)for(let j=0;j<2;j++){
    const entered=await request("/academic/results",{schoolId:school,assessmentId:assessments[i],studentId:students[j].student,score:[78,82,75][i],remark:""},"teacher"+i);
    assert.equal(entered.status,201,JSON.stringify(entered.body));resultIds[j][i]=entered.body.id;
    assert.equal((await request(`/academic/results/${entered.body.id}/submit`,{schoolId:school},"teacher"+i)).status,200);
  }
  const partial=await request("/academic/result-compilation?"+scope);
  check("different teachers retain their subjects in one context",()=>{assert.equal(partial.body.students.length,2);assert.equal(partial.body.students[0].subjects.filter((s:any)=>!s.missing).length,3);});
  check("missing subject is named and never zero",()=>{const missing=partial.body.students[0].subjects.find((s:any)=>s.missing);assert.equal(missing.subjectName,"Social Studies");assert.equal(missing.score,null);assert.equal(partial.body.students[0].average,null);});
  const card=await request("/academic/report-cards",{schoolId:school,studentId:students[0].student,sessionId:sid,termId:tid,classId:cls,section:"A"});
  check("historical draft uses the original class",()=>{assert.equal(card.status,201);assert.equal(card.body.className,"JSS1");});
  const early=await request(`/academic/report-cards/${card.body.id}/publish`,{schoolId:school,decision:"APPROVE"});
  check("missing curriculum subject blocks final approval",()=>assert.equal(early.status,409));
  const returned=await request(`/academic/results/${resultIds[0][0]}/review`,{schoolId:school,decision:"RETURN",comment:"Check Mathematics total"});
  check("only selected subject is returned",()=>assert.equal(returned.status,200));
  assert.equal((await request(`/academic/results/${resultIds[0][0]}`,{schoolId:school,score:79,remark:""},"teacher0","PATCH")).status,200);
  assert.equal((await request(`/academic/results/${resultIds[0][0]}/submit`,{schoolId:school},"teacher0")).status,200);
  const resubmitted=await request("/academic/result-compilation?"+scope);
  check("resubmission updates same subject without replacing English",()=>{
    const subjects=resubmitted.body.students[0].subjects;
    assert.equal(Number(subjects.find((s:any)=>s.subjectName==="English").score),82);
    assert.equal(Number(subjects.find((s:any)=>s.subjectName==="Mathematics").score),79);
  });
  for(let j=0;j<2;j++){
    const entered=await request("/academic/results",{schoolId:school,assessmentId:assessments[3],studentId:students[j].student,score:80},"teacher3");
    assert.equal(entered.status,201,JSON.stringify(entered.body));resultIds[j][3]=entered.body.id;
    assert.equal((await request(`/academic/results/${entered.body.id}/submit`,{schoolId:school},"teacher3")).status,200);
    for(const rid of resultIds[j])assert.equal((await request(`/academic/results/${rid}/review`,{schoolId:school,decision:"APPROVE"})).status,200);
  }
  assert.equal((await request("/academic/report-cards",{schoolId:school,studentId:students[0].student,sessionId:sid,termId:tid})).status,201);
  const approved=await request(`/academic/report-cards/${card.body.id}/publish`,{schoolId:school,decision:"APPROVE"});
  check("complete consolidated result approves",()=>assert.equal(approved.status,200));
  const published=await request(`/academic/report-cards/${card.body.id}/publish`,{schoolId:school});
  check("School Admin publishes consolidated result",()=>assert.equal(published.status,200));
  const teacherPublication=await request(`/academic/report-cards/${card.body.id}/publish`,{schoolId:school},"teacher0");
  check("teacher cannot publish the consolidated student result",()=>assert.equal(teacherPublication.status,403));
  const child=await request(`/academic/parents/children/${students[0].student}/report-cards?schoolId=${school}`,undefined,"parent");
  const own=await request(`/academic/students/me/report-cards?schoolId=${school}`,undefined,"student");
  check("parent sees published child's consolidated report",()=>{assert.equal(child.status,200,JSON.stringify(child.body));assert.equal(child.body[0].lines.length,4);});
  check("student sees published consolidated report",()=>{assert.equal(own.status,200,JSON.stringify(own.body));assert.equal(own.body[0].lines.length,4);});
  const currentAfter=(await db.query("SELECT class_name,section FROM students WHERE id=$1",[students[0].student])).rows[0];
  check("current enrollment unchanged by historical generation",()=>{assert.equal(currentAfter.class_name,"SS2");assert.equal(currentAfter.section,"B");});
  const denied=await request(`/academic/results/${resultIds[0][0]}`,{schoolId:school,score:99},"teacher0","PATCH");
  check("published marks stay locked",()=>assert.equal(denied.status,409));
  const invoice=await insert(`INSERT INTO fee_invoices(school_id,student_id,parent_id,academic_session_id,academic_term_id,invoice_number,
    student_name_snapshot,admission_no_snapshot,class_name_snapshot,section_snapshot,issue_date,due_date,subtotal_minor,total_minor,outstanding_minor,created_by)
    VALUES($1,$2,$3,$4,$5,$6,'Native Student','QA','JSS1','A',CURRENT_DATE,CURRENT_DATE,300000,300000,300000,$7) RETURNING id`,
    [school,students[0].student,parent,sid,tid,"INV-"+suffix,admin]);
  const line1=await insert("INSERT INTO fee_invoice_lines(school_id,invoice_id,category_name_snapshot,description_snapshot,amount_minor) VALUES($1,$2,'Tuition','Tuition',200000) RETURNING id",[school,invoice]);
  const line2=await insert("INSERT INTO fee_invoice_lines(school_id,invoice_id,category_name_snapshot,description_snapshot,amount_minor) VALUES($1,$2,'Books','Books',100000) RETURNING id",[school,invoice]);
  const cashBody={amountMinor:100000,lineIds:[line2],evidenceReference:"CASH-QA-"+suffix,receivedFrom:"Native QA Parent",notes:"Controlled cash evidence"};
  const headers={"Idempotency-Key":"native-cash-"+suffix};
  const cash=await request(`/school/finance/invoices/${invoice}/cash-payments?schoolId=${school}`,cashBody,"admin","POST",headers);
  check("selected bundled fee cash payment persists with receipt",()=>{assert.equal(cash.status,201,JSON.stringify(cash.body));assert.equal(cash.body.status,"VERIFIED");assert.ok(cash.body.receiptNumber);});
  const replay=await request(`/school/finance/invoices/${invoice}/cash-payments?schoolId=${school}`,cashBody,"admin","POST",headers);
  check("cash replay never charges or records twice",()=>{assert.equal(replay.status,200);assert.equal(replay.body.id,cash.body.id);});
  const lines=await request(`/parent/fees/invoices/${invoice}/lines`,undefined,"parent");
  check("only paid fee line is excluded, other bundled fee remains",()=>{assert.equal(lines.body.lines.find((l:any)=>l.id===line2).outstandingMinor,0);assert.equal(lines.body.lines.find((l:any)=>l.id===line1).outstandingMinor,200000);});
  const forbidden=await request(`/school/finance/invoices/${invoice}/cash-payments?schoolId=${school}`,cashBody,"other","POST",headers);
  check("cross-school cash write denied",()=>assert.equal(forbidden.status,404));
  const audit=(await db.query("SELECT count(*)::int n FROM audit_logs WHERE school_id=$1 AND action='payment: recorded cash received' AND record_id=$2",[school,cash.body.id])).rows[0];
  check("cash evidence has exactly one audit record",()=>assert.equal(audit.n,1));
  const changedReplay=await request(`/school/finance/invoices/${invoice}/cash-payments?schoolId=${school}`,{...cashBody,lineIds:[line1]},"admin","POST",headers);
  check("cash replay rejects changed fee selection",()=>assert.equal(changedReplay.status,409));
  for(const role of ["parent","teacher0"]) {
    const deniedCash=await request(`/school/finance/invoices/${invoice}/cash-payments?schoolId=${school}`,cashBody,role,"POST",headers);
    check(`${role} cannot record cash`,()=>assert.equal(deniedCash.status,404));
  }
  const allCash=await request(`/school/finance/invoices/${invoice}/cash-payments?schoolId=${school}`,
    {...cashBody,amountMinor:200000,lineIds:undefined,evidenceReference:"CASH-ALL-"+suffix},"admin","POST",{"Idempotency-Key":"all-"+suffix});
  check("Pay All records only the remaining outstanding fees",()=>assert.equal(allCash.status,201,JSON.stringify(allCash.body)));
  const allLines=await request(`/parent/fees/invoices/${invoice}/lines`,undefined,"parent");
  check("Pay All leaves both lines fully paid without double allocation",()=>assert.ok(allLines.body.lines.every((line:any)=>line.outstandingMinor===0)));
  const third=await insert("INSERT INTO students(school_id,admission_no,first_name,last_name,gender,class_name,section) VALUES($1,$2,'Native','Bus Student','male','SS2','B') RETURNING id",[school,"BUS-"+suffix]);
  await db.query(`INSERT INTO student_class_assignments(school_id,student_id,academic_session_id,academic_term_id,school_class_id,section,status,start_date)
    VALUES($1,$2,$3,$4,$5,'B','ACTIVE','2026-09-01')`,[school,third,sid,tid,current]);
  const deniedClassAssessment=await insert(`INSERT INTO academic_assessments(school_id,academic_session_id,academic_term_id,school_class_id,section,subject_id,teacher_employee_id,title,description,assessment_type_id,max_score,assessment_date,status,created_by)
    VALUES($1,$2,$3,$4,'B',$5,$6,'Unassigned class QA','Controlled negative test',$7,100,'2026-10-01','OPEN',$8) RETURNING id`,[school,sid,tid,current,subjects[0],employees[0],type,admin]);
  const deniedClass=await request("/academic/results",{schoolId:school,assessmentId:deniedClassAssessment,studentId:third,score:40},"teacher0");
  check("teacher cannot enter marks for an unassigned class",()=>assert.equal(deniedClass.status,404));
  await db.query(`INSERT INTO student_class_assignments(school_id,student_id,academic_session_id,academic_term_id,school_class_id,section,status,start_date)
    VALUES($1,$2,$3,$4,$5,'B','INACTIVE','2026-09-01')`,[school,third,sid,tid,cls]);
  const deniedSectionAssessment=await insert(`INSERT INTO academic_assessments(school_id,academic_session_id,academic_term_id,school_class_id,section,subject_id,teacher_employee_id,title,description,assessment_type_id,max_score,assessment_date,status,created_by)
    VALUES($1,$2,$3,$4,'B',$5,$6,'Unassigned section QA','Controlled negative test',$7,100,'2026-10-01','OPEN',$8) RETURNING id`,[school,sid,tid,cls,subjects[0],employees[0],type,admin]);
  const deniedSection=await request("/academic/results",{schoolId:school,assessmentId:deniedSectionAssessment,studentId:third,score:40},"teacher0");
  check("teacher cannot enter marks for an unassigned section of the same class",()=>assert.equal(deniedSection.status,404));
  await db.query(`INSERT INTO student_class_assignments(school_id,student_id,academic_session_id,academic_term_id,school_class_id,section,status,start_date)
    VALUES($1,$2,$3,$4,$5,'A','INACTIVE','2027-09-01')`,[school,third,next.body.id,nextTerm.body.id,cls]);
  const deniedPeriodAssessment=await insert(`INSERT INTO academic_assessments(school_id,academic_session_id,academic_term_id,school_class_id,section,subject_id,teacher_employee_id,title,description,assessment_type_id,max_score,assessment_date,status,created_by)
    VALUES($1,$2,$3,$4,'A',$5,$6,'Unassigned period QA','Controlled negative test',$7,100,'2027-10-01','OPEN',$8) RETURNING id`,[school,next.body.id,nextTerm.body.id,cls,subjects[0],employees[0],type,admin]);
  const deniedPeriod=await request("/academic/results",{schoolId:school,assessmentId:deniedPeriodAssessment,studentId:third,score:40},"teacher0");
  check("teacher cannot enter marks for an unassigned academic period",()=>assert.equal(deniedPeriod.status,404));
  const deniedSchool=await request("/academic/results",{schoolId:otherSchool,assessmentId:assessments[0],studentId:third,score:40},"teacher0");
  check("teacher cannot enter marks for another school",()=>assert.equal(deniedSchool.status,404));
  await db.query("INSERT INTO parent_student_relationships(parent_id,student_id,status) VALUES($1,$2,'ACTIVE')",[parent,third]);
  const driverUser=await actor("driver","DRIVER");
  const driver=await insert("INSERT INTO employees(school_id,employee_no,first_name,last_name,employee_type,user_id) VALUES($1,$2,'Native','Driver','STAFF',$3) RETURNING id",[school,"DRIVER-"+suffix,driverUser]);
  const bus=await insert("INSERT INTO transport_buses(school_id,name,registration_number,capacity,created_by) VALUES($1,'QA Bus',$2,20,$3) RETURNING id",[school,"BUS-"+suffix,admin]);
  const route=await insert(`INSERT INTO transport_routes(school_id,bus_id,driver_employee_id,name,weekdays,departure_time,arrival_time,fare_minor,created_by)
    VALUES($1,$2,$3,'QA Route',ARRAY['MONDAY'],'07:30:00','08:00:00',100000,$4) RETURNING id`,[school,bus,driver,admin]);
  const pickup=await insert("INSERT INTO transport_route_stops(school_id,route_id,name,stop_type,sequence,created_by) VALUES($1,$2,'QA Pickup','PICKUP',1,$3) RETURNING id",[school,route,admin]);
  const dropoff=await insert("INSERT INTO transport_route_stops(school_id,route_id,name,stop_type,sequence,created_by) VALUES($1,$2,'QA School','DROPOFF',2,$3) RETURNING id",[school,route,admin]);
  const busAssignment=await insert(`INSERT INTO transport_student_assignments(school_id,student_id,route_id,pickup_stop_id,dropoff_stop_id,effective_date,reason,created_by)
    VALUES($1,$2,$3,$4,$5,'2026-09-01','Controlled QA bus enrollment',$6) RETURNING id`,[school,third,route,pickup,dropoff,admin]);
  const categories:number[]=[];
  for(const [name,transportOnly] of [["Tuition",false],["Books",false],["Exam",false],["Bus",true]] as const) {
    const category=await request(`/school/finance/categories?schoolId=${school}`,{name,transportOnly});
    assert.equal(category.status,201,JSON.stringify(category.body));categories.push(category.body.id);
  }
  const structures:number[]=[];
  const nonexistentFeeTerm=await request(`/school/finance/structures?schoolId=${school}`,{
    sessionId:sid,termId:2147483647,classId:cls,section:"A",lines:[{categoryId:categories[0],amountMinor:1000}]});
  check("fees cannot reference a nonexistent academic term",()=>assert.equal(nonexistentFeeTerm.status,404));
  for(const [classId,section,amounts] of [[cls,"A",[200000,100000,50000]],[current,"B",[300000,100000,50000,150000]]] as const) {
    const created=await request(`/school/finance/structures?schoolId=${school}`,{sessionId:sid,termId:tid,classId,section,
      lines:amounts.map((amountMinor,i)=>({categoryId:categories[i],amountMinor}))});
    assert.equal(created.status,201,JSON.stringify(created.body));structures.push(created.body.id);
    const published=await request(`/school/finance/structures/${created.body.id}/publish?schoolId=${school}`,{});
    assert.equal(published.status,200,JSON.stringify(published.body));
  }
  const classInvoices=(await db.query("SELECT student_id,academic_session_id,academic_term_id,total_minor,structure_id FROM fee_invoices WHERE school_id=$1 AND structure_id=ANY($2::int[])",[school,structures])).rows;
  check("class fee publication assigns only matching period/class rosters",()=>{assert.equal(classInvoices.length,3);assert.ok(classInvoices.every((r:any)=>r.academic_session_id===sid&&r.academic_term_id===tid));});
  check("different classes preserve different ordinary fee totals",()=>{
    assert.equal(classInvoices.filter((r:any)=>r.structure_id===structures[0]).length,2);
    assert.ok(classInvoices.filter((r:any)=>r.structure_id===structures[0]).every((r:any)=>r.total_minor===350000));
    assert.equal(classInvoices.find((r:any)=>r.structure_id===structures[1]).total_minor,450000);
  });
  const transportFees=(await db.query("SELECT * FROM transport_fee_invoices WHERE school_id=$1",[school])).rows;
  check("transport auto-assignment charges only the actual bus user in the same term",()=>{
    assert.equal(transportFees.length,1);assert.equal(transportFees[0].assignment_id,busAssignment);
    assert.equal(transportFees[0].academic_session_id,sid);assert.equal(transportFees[0].academic_term_id,tid);
  });
  check("transport pricing uses the configured class fee rather than route fallback",()=>assert.equal(transportFees[0].amount_minor,150000));
  await db.query(`INSERT INTO fee_school_settings(school_id,bank_transfer_enabled,bank_name,bank_account_name,bank_account_number)
    VALUES($1,true,'Controlled QA bank','DO NOT TRANSFER REAL FUNDS','0000000000')`,[school]);
  const bankInvoice=classInvoices.find((r:any)=>r.student_id===students[0].student);
  const bankInvoiceId=(await db.query("SELECT id FROM fee_invoices WHERE school_id=$1 AND student_id=$2 AND structure_id=$3",[school,students[0].student,bankInvoice.structure_id])).rows[0].id;
  const bankLines=(await db.query("SELECT id,category_name_snapshot FROM fee_invoice_lines WHERE invoice_id=$1 AND school_id=$2",[bankInvoiceId,school])).rows;
  const bankBookLine=bankLines.find((l:any)=>l.category_name_snapshot==="Books").id;
  const bankExamLine=bankLines.find((l:any)=>l.category_name_snapshot==="Exam").id;
  const bankHeaders={"Idempotency-Key":"native-bank-"+suffix};
  const bankBody={amountMinor:100000,lineIds:[bankBookLine],bank:"Controlled QA bank",transferReference:"QA-BANK-"+suffix,transferDate:"2026-10-04"};
  const bankClaim=await request(`/parent/fees/invoices/${bankInvoiceId}/bank-transfer`,bankBody,"parent","POST",bankHeaders);
  check("parent manual bank claim preserves the selected bundled fee without live funds",()=>assert.equal(bankClaim.status,201,JSON.stringify(bankClaim.body)));
  const sameBankClaim=await request(`/parent/fees/invoices/${bankInvoiceId}/bank-transfer`,bankBody,"parent","POST",bankHeaders);
  check("identical manual bank claim replay returns the original payment",()=>{assert.equal(sameBankClaim.status,201);assert.equal(sameBankClaim.body.id,bankClaim.body.id);});
  const changedBankClaim=await request(`/parent/fees/invoices/${bankInvoiceId}/bank-transfer`,{...bankBody,lineIds:[bankExamLine]},"parent","POST",bankHeaders);
  check("manual bank claim replay rejects changed fee selection",()=>assert.equal(changedBankClaim.status,409));
  const bankEvidence={evidenceReference:"QA-EVIDENCE-"+suffix,reviewerNotes:"Controlled native fixture only; no real bank transfer"};
  const bankVerified=await request(`/school/finance/payments/${bankClaim.body.id}/verify?schoolId=${school}`,bankEvidence);
  check("school verification allocates only the parent's selected bundled fee",()=>assert.equal(bankVerified.status,200,JSON.stringify(bankVerified.body)));
  const bankVerifiedAgain=await request(`/school/finance/payments/${bankClaim.body.id}/verify?schoolId=${school}`,bankEvidence);
  check("manual bank verification replay preserves the same receipt",()=>{assert.equal(bankVerifiedAgain.status,200);assert.equal(bankVerifiedAgain.body.receiptNumber,bankVerified.body.receiptNumber);});
  const bankAllocation=(await db.query("SELECT line_id,amount_minor FROM fee_payment_line_allocations WHERE payment_id=$1 AND school_id=$2",[bankClaim.body.id,school])).rows;
  check("selected bank payment has one exact line allocation and excludes paid Books",()=>{assert.deepEqual(bankAllocation,[{line_id:bankBookLine,amount_minor:100000}]);});
  await insert(`INSERT INTO staff_nfc_billing_rules(version,price_minor,school_share_minor,platform_share_minor,
    partner_commission_minor,no_partner_platform_share_minor,effective_at)
    VALUES((SELECT COALESCE(max(version),0)+1 FROM staff_nfc_billing_rules),200000,100000,80000,20000,100000,NOW()) RETURNING id`);
  const activated=await request(`/academic-sessions/${sid}?schoolId=${school}`,{isCurrent:true},"admin","PATCH");
  check("current academic session activation persists",()=>assert.equal(activated.status,200,JSON.stringify(activated.body)));
  const activatedTerm=await request(`/academic-terms/${tid}?schoolId=${school}`,{isCurrent:true,allowOverlap:true,overlapReason:"Controlled QA overlap remains explicitly authorized"},"admin","PATCH");
  check("current term activation generates staff subscriptions without aborting calendar creation",()=>assert.equal(activatedTerm.status,200,JSON.stringify(activatedTerm.body)));
  const staffAudit=(await db.query("SELECT count(*)::int n FROM audit_logs WHERE school_id=$1 AND event_type='STAFF_NFC_TERM_SUBSCRIPTIONS_GENERATED' AND actor_user_id=$2 AND record_id=$3",[school,admin,tid])).rows[0];
  check("staff billing activation audit retains the correct actor, school and term",()=>assert.equal(staffAudit.n,1));
  process.stdout.write(JSON.stringify({nativePostgresPassed:passed,failed:0,syntheticAuthenticatedIdentity:true,actualClerkBrowser:false,evidence})+"\n");
} finally {await new Promise<void>(r=>server.close(()=>r()));await pool.end();await db.end();}