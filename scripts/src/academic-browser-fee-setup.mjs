import {createRequire} from "node:module";
import {readFile,writeFile} from "node:fs/promises";
const {Client}=createRequire(new URL("../../lib/db/package.json",import.meta.url))("pg");
const file="artifacts/api-server/.local/test-fixtures/academic-browser.json";
const fixture=JSON.parse(await readFile(file,"utf8"));
const baseline=JSON.parse(await readFile("/tmp/educore-academic-preservation.json","utf8"));
if(process.env.REPLIT_DEPLOYMENT||!process.env.REPLIT_DEV_DOMAIN||fixture.schoolId<=baseline.schools.max||fixture.feeSetup)throw Error("New unprepared Development QA school only");
const db=new Client({connectionString:process.env.DATABASE_URL});
try {
  await db.connect();
  const identity=(await db.query("SELECT current_database() name,pg_postmaster_start_time() started,inet_server_addr() host")).rows[0];
  if(identity.name!=="heliumdb"||new Date(identity.started).toISOString()!=="2026-10-04T10:45:56.703Z"||identity.host!==null)throw Error("Unverified Development target");
  if((await db.query("SELECT code FROM schools WHERE id=$1",[fixture.schoolId])).rows[0]?.code!==fixture.label)throw Error("Fixture ownership changed");
  await db.query("BEGIN");
  const otherClass=fixture.classes.find(c=>c.name==="JSS1"&&c.section==="A");
  const third=(await db.query(`INSERT INTO students(school_id,admission_no,first_name,last_name,gender,class_name,section)
    VALUES($1,$2,'Finance QA','Sibling','male','JSS1','A') RETURNING id`,[fixture.schoolId,fixture.label+"-finance-sibling"])).rows[0].id;
  await db.query(`INSERT INTO student_class_assignments(school_id,student_id,academic_session_id,academic_term_id,school_class_id,section,status,start_date)
    VALUES($1,$2,$3,$4,$5,'A','ACTIVE','2026-10-04')`,[fixture.schoolId,third,fixture.resultSetup.sessionId,fixture.resultSetup.termId,otherClass.id]);
  await db.query("INSERT INTO parent_student_relationships(parent_id,student_id,status) VALUES($1,$2,'ACTIVE')",[fixture.parentId,third]);
  await db.query(`UPDATE fee_school_settings SET bank_transfer_enabled=true,
    bank_name='Controlled Development fixture only',bank_account_name='DO NOT TRANSFER REAL FUNDS',
    bank_account_number='0000000000',updated_by=$2,updated_at=NOW() WHERE school_id=$1`,[fixture.schoolId,fixture.actors.admin.userId]);
  await db.query("COMMIT");
  fixture.feeSetup={otherStudentId:third,otherClassId:otherClass.id,otherSection:"A",bankFixtureOnly:true,noRealBankTransferAllowed:true};
  await writeFile(file,JSON.stringify(fixture,null,2));
  console.log(JSON.stringify({developmentOnly:true,schoolId:fixture.schoolId,newFinanceSibling:third,currentOriginalEnrollmentUntouched:true,noProviderRequests:true}));
} catch(error){await db.query("ROLLBACK").catch(()=>{});throw error;}finally{await db.end();}