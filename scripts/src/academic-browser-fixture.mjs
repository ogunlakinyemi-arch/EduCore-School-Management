import {createRequire} from "node:module";
import {readFile,writeFile} from "node:fs/promises";
const requireDb=createRequire(new URL("../../lib/db/package.json",import.meta.url));
const {Client}=requireDb("pg");
const {clerkClient}=createRequire(new URL("../../artifacts/api-server/package.json",import.meta.url))("@clerk/express");
const db=new Client({connectionString:process.env.DATABASE_URL});
if(process.env.REPLIT_DEPLOYMENT||!process.env.REPLIT_DEV_DOMAIN||!process.env.CLERK_SECRET_KEY?.startsWith("sk_test_")) throw Error("Explicit Development only");
const old=JSON.parse(await readFile("artifacts/api-server/.local/test-fixtures/targeted-transport.json","utf8"));
const suffix=String(Date.now());
let fixture={label:"ACADEMIC-QA-"+suffix,actors:{},schoolId:null,classes:[],studentIds:[],employeeIds:[]};
try{fixture=JSON.parse(await readFile("/tmp/educore-academic-browser-fixture-pending.json","utf8"));}catch(error){if(error.code!=="ENOENT")throw error;}
try {
  await db.connect();
  const identity=(await db.query("SELECT current_database() name,pg_postmaster_start_time() started,inet_server_addr() host")).rows[0];
  if(identity.name!=="heliumdb"||new Date(identity.started).toISOString()!=="2026-10-04T10:45:56.703Z"||identity.host!==null) throw Error("Unverified Development database");
  for(const key of ["admin"]){
    const a=old.actors[key];
    const row=(await db.query("SELECT id FROM app_users WHERE id=$1 AND clerk_user_id=$2 AND email=$3",[a.userId,a.clerkUserId,a.email])).rows[0];
    if(!row) throw Error("Development fixture identity changed; reconcile instead of recreating it");
    fixture.actors[key]={...a};
  }
  // No invitation, email or SMS is sent; these are additional Development-only QA identities.
  for(const key of ["parent","student1","student2","teacher","english","science","social"]){
    const role=key==="parent"?"PARENT":key.startsWith("student")?"STUDENT":"TEACHER";
    if(fixture.actors[key]?.role===role && !["parent","student1","student2","teacher"].includes(key)) continue;
    if(fixture.actors[key]?.fixtureCreated)continue;
    const email=`academic-qa-${key}-${suffix}@example.com`;
    const external=await clerkClient.users.createUser({emailAddress:[email],emailAddressIdentificationStatus:["verified"],
      firstName:"Academic QA",lastName:key,skipPasswordRequirement:true,privateMetadata:{edupulseFixture:fixture.label,edupulseFixtureRole:role}});
    const user=(await db.query("INSERT INTO app_users(clerk_user_id,email,first_name,last_name) VALUES($1,$2,'Academic QA',$3) RETURNING id",[external.id,email,key])).rows[0];
    fixture.actors[key]={role,email,clerkUserId:external.id,userId:user.id,fixtureCreated:true};
    await writeFile("/tmp/educore-academic-browser-fixture-pending.json",JSON.stringify(fixture));
  }
  await db.query("BEGIN");
  const school=(await db.query("INSERT INTO schools(code,name,city,state) VALUES($1,$2,'QA','Lagos') RETURNING id",[fixture.label,"Academic Calendar QA "+suffix])).rows[0];
  fixture.schoolId=school.id;
  for(const a of Object.values(fixture.actors))await db.query("INSERT INTO school_memberships(user_id,school_id,role,status) VALUES($1,$2,$3,'ACTIVE')",[a.userId,school.id,a.role]);
  for(const [name,section] of [["JSS1","A"],["SS2","B"]]){
    const row=(await db.query("INSERT INTO school_classes(school_id,name,section) VALUES($1,$2,$3) RETURNING id",[school.id,name,section])).rows[0];
    fixture.classes.push({...row,name,section});
  }
  const parent=(await db.query("INSERT INTO parents(school_id,name,email,phone,user_id) VALUES($1,'Academic QA Parent',$2,'08000000000',$3) RETURNING id",[school.id,fixture.actors.parent.email,fixture.actors.parent.userId])).rows[0];
  fixture.parentId=parent.id;
  for(const key of ["student1","student2"]){
    const a=fixture.actors[key];
    const student=(await db.query("INSERT INTO students(school_id,admission_no,first_name,last_name,gender,class_name,section,user_id) VALUES($1,$2,'Academic QA',$3,'male','SS2','B',$4) RETURNING id",[school.id,fixture.label+"-"+key,key,a.userId])).rows[0];
    fixture.studentIds.push(student.id);a.studentId=student.id;
    await db.query("INSERT INTO parent_student_relationships(parent_id,student_id,status) VALUES($1,$2,'ACTIVE')",[parent.id,student.id]);
  }
  for(const key of ["teacher","english","science","social"]){
    const a=fixture.actors[key];
    const employee=(await db.query("INSERT INTO employees(school_id,employee_no,first_name,last_name,employee_type,user_id,email) VALUES($1,$2,'Academic QA',$3,'TEACHER',$4,$5) RETURNING id",[school.id,fixture.label+"-"+key,key,a.userId,a.email])).rows[0];
    a.employeeId=employee.id;fixture.employeeIds.push(employee.id);
  }
  await db.query("INSERT INTO fee_school_settings(school_id) VALUES($1)",[school.id]);
  await db.query("COMMIT");
  await writeFile("artifacts/api-server/.local/test-fixtures/academic-browser.json",JSON.stringify(fixture,null,2));
  console.log(JSON.stringify({developmentOnly:true,newControlledSchool:school.id,qaIdentities:8,existingDataRewritten:false}));
} catch(error){await db.query("ROLLBACK").catch(()=>{});throw error;}
finally{await db.end();}