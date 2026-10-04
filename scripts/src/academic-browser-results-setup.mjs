import {createRequire} from "node:module";
import {readFile,writeFile} from "node:fs/promises";
const {Client}=createRequire(new URL("../../lib/db/package.json",import.meta.url))("pg");
const manifestPath="artifacts/api-server/.local/test-fixtures/academic-browser.json";
const fixture=JSON.parse(await readFile(manifestPath,"utf8"));
const baseline=JSON.parse(await readFile("/tmp/educore-academic-preservation.json","utf8"));
if(process.env.REPLIT_DEPLOYMENT||!process.env.REPLIT_DEV_DOMAIN||fixture.schoolId<=baseline.schools.max) throw Error("New controlled Development school only");
if(fixture.resultSetup) throw Error("Result fixtures already prepared; reuse them");
const db=new Client({connectionString:process.env.DATABASE_URL});
const insert=async(sql,args=[])=>Number((await db.query(sql,args)).rows[0].id);
try {
  await db.connect();
  const target=(await db.query("SELECT current_database() name,pg_postmaster_start_time() started,inet_server_addr() host")).rows[0];
  if(target.name!=="heliumdb"||new Date(target.started).toISOString()!=="2026-10-04T10:45:56.703Z"||target.host!==null)throw Error("Unverified Development target");
  const school=(await db.query("SELECT code FROM schools WHERE id=$1",[fixture.schoolId])).rows[0];
  if(school?.code!==fixture.label)throw Error("Controlled fixture ownership changed");
  const period=(await db.query(`SELECT s.id session,t.id term FROM academic_sessions s JOIN academic_terms t ON t.academic_session_id=s.id AND t.school_id=s.school_id
    WHERE s.school_id=$1 AND s.name='2026/2027' AND s.is_current AND t.name='FIRST' AND t.is_current`,[fixture.schoolId])).rows[0];
  if(!period)throw Error("Finish actual browser Calendar creation first");
  const existing=(await db.query("SELECT count(*)::int n FROM subjects WHERE school_id=$1",[fixture.schoolId])).rows[0];
  if(existing.n!==0)throw Error("Subjects already exist; reconcile an uncertain previous commit instead of duplicating");
  await db.query("BEGIN");
  const currentClass=fixture.classes.find(c=>c.name==="SS2"&&c.section==="B");
  const setup={sessionId:period.session,termId:period.term,classId:currentClass.id,section:"B",subjects:[],assessments:[],historical:null};
  for(const id of fixture.studentIds) {
    const student=(await db.query("SELECT class_name,section FROM students WHERE id=$1 AND school_id=$2 AND admission_no LIKE $3",[id,fixture.schoolId,fixture.label+"-%"])).rows[0];
    if(id<=baseline.students.max||student?.class_name!=="SS2"||student?.section!=="B")throw Error("Preserve current student enrollment");
    await db.query(`INSERT INTO student_class_assignments(school_id,student_id,academic_session_id,academic_term_id,school_class_id,section,status,start_date)
      VALUES($1,$2,$3,$4,$5,'B','ACTIVE','2026-10-04')`,[fixture.schoolId,id,period.session,period.term,currentClass.id]);
  }
  const type=await insert("INSERT INTO academic_assessment_types(school_id,name,code) VALUES($1,'Controlled QA Examination','QA-EXAM') RETURNING id",[fixture.schoolId]);
  // Explicit controlled-school grading configuration; never applied as a fallback to another school.
  for(const [min,max,grade,point,remark] of [[80,100,"A",4,"Excellent"],[70,79.99,"B",3,"Good"],[60,69.99,"C",2,"Satisfactory"],[50,59.99,"D",1,"Pass"],[0,49.99,"F",0,"Needs improvement"]])
    await db.query("INSERT INTO academic_grading_rules(school_id,min_score,max_score,grade,grade_point,remark) VALUES($1,$2,$3,$4,$5,$6)",[fixture.schoolId,min,max,grade,point,remark]);
  for(const [key,name,code] of [["teacher","Mathematics","MATH"],["english","English","ENG"],["science","Basic Science","SCI"],["social","Social Studies","SOC"]]) {
    const employee=fixture.actors[key].employeeId;
    const subject=await insert("INSERT INTO subjects(school_id,name,code) VALUES($1,$2,$3) RETURNING id",[fixture.schoolId,name,code]);
    setup.subjects.push({key,id:subject,name});
    await db.query(`INSERT INTO class_subjects(school_id,school_class_id,subject_id,academic_session_id,academic_term_id,employee_id,section)
      VALUES($1,$2,$3,$4,$5,$6,'B')`,[fixture.schoolId,currentClass.id,subject,period.session,period.term,employee]);
    await db.query(`INSERT INTO teacher_class_assignments(school_id,employee_id,academic_session_id,school_class_id,subject_id,section,assignment_type,start_date)
      VALUES($1,$2,$3,$4,$5,'B','SUBJECT_TEACHER','2026-10-04')`,[fixture.schoolId,employee,period.session,currentClass.id,subject]);
    const assessment=await insert(`INSERT INTO academic_assessments(school_id,academic_session_id,academic_term_id,school_class_id,section,subject_id,teacher_employee_id,title,description,assessment_type_id,max_score,assessment_date,status,created_by)
      VALUES($1,$2,$3,$4,'B',$5,$6,$7,'Controlled Development only',$8,100,'2026-10-04','OPEN',$9) RETURNING id`,
      [fixture.schoolId,period.session,period.term,currentClass.id,subject,employee,name+" QA Term Exam",type,fixture.actors.admin.userId]);
    setup.assessments.push({key,id:assessment,subjectId:subject});
  }
  const oldClass=fixture.classes.find(c=>c.name==="JSS1"&&c.section==="A");
  const oldSession=await insert(`INSERT INTO academic_sessions(school_id,name,start_date,end_date,status,is_current,created_by)
    VALUES($1,'2025/2026 Controlled History','2025-09-01','2026-07-31','COMPLETED',false,$2) RETURNING id`,[fixture.schoolId,fixture.actors.admin.userId]);
  const oldTerm=await insert(`INSERT INTO academic_terms(school_id,academic_session_id,name,start_date,end_date,status,is_current,created_by)
    VALUES($1,$2,'THIRD','2026-05-01','2026-07-25','COMPLETED',false,$3) RETURNING id`,[fixture.schoolId,oldSession,fixture.actors.admin.userId]);
  const assignments=[];
  for(const student of fixture.studentIds)assignments.push(await insert(`INSERT INTO student_class_assignments(school_id,student_id,academic_session_id,academic_term_id,school_class_id,section,status,start_date,end_date)
    VALUES($1,$2,$3,$4,$5,'A','INACTIVE','2026-05-01','2026-07-25') RETURNING id`,[fixture.schoolId,student,oldSession,oldTerm,oldClass.id]));
  for(let i=0;i<setup.subjects.length;i++) {
    const subject=setup.subjects[i],employee=fixture.actors[subject.key].employeeId;
    await db.query(`INSERT INTO class_subjects(school_id,school_class_id,subject_id,academic_session_id,academic_term_id,employee_id,section,status)
      VALUES($1,$2,$3,$4,$5,$6,'A','INACTIVE')`,[fixture.schoolId,oldClass.id,subject.id,oldSession,oldTerm,employee]);
    const assessment=await insert(`INSERT INTO academic_assessments(school_id,academic_session_id,academic_term_id,school_class_id,section,subject_id,teacher_employee_id,title,description,assessment_type_id,max_score,assessment_date,status,created_by)
      VALUES($1,$2,$3,$4,'A',$5,$6,$7,'New synthetic QA history, not original history',$8,100,'2026-06-01','OPEN',$9) RETURNING id`,
      [fixture.schoolId,oldSession,oldTerm,oldClass.id,subject.id,employee,subject.name+" Historical QA",type,fixture.actors.admin.userId]);
    for(let j=0;j<fixture.studentIds.length;j++)await db.query(`INSERT INTO academic_results(school_id,assessment_id,student_id,academic_session_id,academic_term_id,school_class_id,subject_id,teacher_employee_id,student_class_assignment_id,section_snapshot,score,max_score,grade,grade_point,remark,status,review_status,created_by,reviewed_by,reviewed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'A',82,100,'A',4,'Controlled QA','SUBMITTED','APPROVED',$10,$11,NOW())`,
      [fixture.schoolId,assessment,fixture.studentIds[j],oldSession,oldTerm,oldClass.id,subject.id,employee,assignments[j],fixture.actors[subject.key].userId,fixture.actors.admin.userId]);
  }
  setup.historical={sessionId:oldSession,termId:oldTerm,classId:oldClass.id,section:"A"};
  await db.query("COMMIT");
  fixture.resultSetup=setup;await writeFile(manifestPath,JSON.stringify(fixture,null,2));
  console.log(JSON.stringify({developmentOnly:true,newFixtureSchool:fixture.schoolId,resultSetup:setup,currentEnrollmentUntouched:true}));
} catch(error){await db.query("ROLLBACK").catch(()=>{});throw error;} finally{await db.end();}