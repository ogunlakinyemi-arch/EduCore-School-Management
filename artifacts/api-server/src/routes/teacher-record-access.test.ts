import express from "express";
import { createServer, type Server } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

const f=vi.hoisted(()=>({role:"TEACHER",query:vi.fn()}));
vi.mock("@workspace/db",()=>({pool:{query:f.query,connect:async()=>({query:f.query,release(){}})}}));
vi.mock("../middlewares/auth",async original=>{
  const actual=await original<typeof import("../middlewares/auth")>();
  const context=()=>({user:{id:30,status:"ACTIVE",firstName:"Fixture",lastName:"Teacher"},
    roles:[{role:f.role,status:"ACTIVE",schoolId:f.role==="PLATFORM_OWNER"?null:1}]});
  return {...actual,requireAuthentication:()=> (_req:unknown,_res:unknown,next:()=>void)=>next(),
    getUserContext:context,assertSchoolAccess:(_req:unknown,schoolId:number,roles:readonly string[])=>{
      if((schoolId!==1&&f.role!=="PLATFORM_OWNER")||(!roles.includes(f.role)&&f.role!=="PLATFORM_OWNER"))
        throw new actual.AuthError(404,"School not found");
      return context();
    }};
});
import roster from "./edupulse";
import attendance from "./attendance";
import academicRouter from "./academic";

let client:pg.Client,server:Server,origin:string,root:string,started=false;
const env={PATH:process.env.PATH,LANG:"C",LC_ALL:"C"};
beforeAll(async()=>{
  // Disposable socket-only PostgreSQL; never reads application database credentials.
  root=mkdtempSync(join(tmpdir(),"teacher-scope-"));
  execFileSync("initdb",["-D",join(root,"data"),"-A","trust","-U","fixture","--no-locale"],{env,stdio:"pipe"});
  execFileSync("pg_ctl",["-D",join(root,"data"),"-l",join(root,"server.log"),"-o",`-k ${root} -h '' -p 5432`,"-w","start"],{env,stdio:"pipe"});
  started=true;
  client=new pg.Client({host:root,port:5432,user:"fixture",database:"postgres",password:""});
  await client.connect();
  expect((await client.query("SHOW data_directory")).rows[0].data_directory).toBe(join(root,"data"));
  await client.query(`
    CREATE TABLE academic_sessions(id int,school_id int,status text,is_current boolean);
    CREATE TABLE school_classes(id int,school_id int,name text,section text);
    CREATE TABLE employees(id int,school_id int,user_id int,employee_type text,employment_status text);
    CREATE TABLE teacher_class_assignments(id int,school_id int,employee_id int,academic_session_id int,
      school_class_id int,section text,start_date date,end_date date,status text,
      assignment_type text DEFAULT 'CLASS_TEACHER',subject_id int);
    CREATE TABLE students(id int,school_id int,user_id int,first_name text,last_name text,
      admission_no text,status text,class_name text,section text);
    CREATE TABLE student_class_assignments(id int,school_id int,student_id int,academic_session_id int,
      academic_term_id int,school_class_id int,section text,start_date date,end_date date,status text,is_current boolean);
    CREATE TABLE attendance_events(id int,school_id int,school_class_id int,student_id int,device_id int,
      event_type text,identification_method text,occurred_at timestamptz,event_date date,
      attendance_status text,result text,created_at timestamptz);
  `);
  f.query.mockImplementation(async(sql:string,args:any[]=[])=>{
    // Run the actual route WHERE predicates in PostgreSQL. Roster projections are
    // narrowed to avoid creating unrelated NFC/payment/medical tables in this fixture.
    let projection:string|undefined,from=-1;
    if(sql.includes('st.first_name AS "firstName"')){
      from=sql.lastIndexOf("FROM students st WHERE");
      projection='SELECT st.id,st.school_id AS "schoolId",st.first_name AS "firstName" ';
    }else if(sql.includes('AS "studentCount"')){
      from=sql.lastIndexOf("FROM school_classes c WHERE");
      projection='SELECT c.id,c.school_id AS "schoolId",c.name,c.section ';
    }
    if(projection&&from>=0){
      sql=projection+sql.slice(from).split("ORDER BY")[0];
      // Bind projection-only parameters too, without changing the WHERE result.
      args.forEach((v,i)=>{const p=`$${i+1}::${typeof v==="boolean"?"boolean":typeof v==="number"?"int":"text"}`;
        sql+=` AND (${p} IS NULL OR ${p} IS NOT NULL)`;});
    }
    return client.query(sql,args);
  });
  const app=express();app.use(express.json(),roster,attendance,academicRouter);
  app.use((error:any,_req:any,res:any,_next:any)=>res.status(error.statusCode??500).json({error:error.message}));
  server=createServer(app);await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  const address=server.address();if(!address||typeof address==="string")throw Error("No fixture port");
  origin=`http://127.0.0.1:${address.port}`;
},30000);
afterAll(async()=>{
  if(server)await new Promise<void>(r=>server.close(()=>r()));
  if(client)await client.end();
  if(started)execFileSync("pg_ctl",["-D",join(root,"data"),"-m","immediate","-w","stop"],{env,stdio:"pipe"});
  if(root)rmSync(root,{recursive:true,force:true});
});
beforeEach(async()=>{
  f.role="TEACHER";f.query.mockClear();
  await client.query(`
    TRUNCATE academic_sessions,school_classes,employees,teacher_class_assignments,students,student_class_assignments,attendance_events;
    INSERT INTO academic_sessions VALUES(10,1,'ACTIVE',true),(9,1,'ACTIVE',false),(20,2,'ACTIVE',true);
    INSERT INTO school_classes VALUES(21,1,'Same name','A'),(22,1,'Same name','B'),(23,1,'Future','A'),
      (24,1,'Expired','A'),(25,1,'Old session','A'),(26,1,'Inactive employee','A'),(31,2,'Foreign','A');
    INSERT INTO employees VALUES(10,1,30,'TEACHER','ACTIVE'),(11,1,40,'TEACHER','ACTIVE'),(12,1,30,'TEACHER','INACTIVE');
    INSERT INTO teacher_class_assignments(id,school_id,employee_id,academic_session_id,school_class_id,section,start_date,end_date,status) VALUES
      (1,1,10,10,21,'A',CURRENT_DATE-10,NULL,'ACTIVE'),
      (2,1,11,10,22,'B',CURRENT_DATE-10,NULL,'ACTIVE'),
      (3,1,10,10,23,'A',CURRENT_DATE+1,NULL,'ACTIVE'),
      (4,1,10,10,24,'A',CURRENT_DATE-10,CURRENT_DATE-1,'ACTIVE'),
      (5,1,10,9,25,'A',CURRENT_DATE-10,NULL,'ACTIVE'),
      (6,1,12,10,26,'A',CURRENT_DATE-10,NULL,'ACTIVE');
    INSERT INTO students VALUES(11,1,101,'Assigned','Child','A11','ACTIVE','Same name','A'),
      (12,1,102,'Other','Child','A12','ACTIVE','Same name','B'),(13,1,103,'Unassigned','Child','A13','ACTIVE','Same name','A'),
      (14,1,104,'Stale','Child','A14','ACTIVE','Same name','A'),(15,2,105,'Foreign','Child','A15','ACTIVE','Foreign','A');
    INSERT INTO student_class_assignments VALUES
      (1,1,11,10,1,21,'A',CURRENT_DATE-20,NULL,'ACTIVE',true),
      (2,1,12,10,1,22,'B',CURRENT_DATE-20,NULL,'ACTIVE',true),
      (3,1,14,10,1,21,'A',CURRENT_DATE-20,NULL,'INACTIVE',false),
      (4,2,15,20,2,31,'A',CURRENT_DATE-20,NULL,'ACTIVE',true);
    INSERT INTO attendance_events VALUES
      (101,1,21,11,NULL,'CLASSROOM_ENTRY','MANUAL',now(),'2026-10-28','PRESENT','ACCEPTED',now()),
      (102,1,21,12,NULL,'CLASSROOM_ENTRY','MANUAL',now(),'2026-10-28','PRESENT','ACCEPTED',now()),
      (103,1,21,11,NULL,'CLASSROOM_ENTRY','MANUAL',now(),'2026-10-27','PRESENT','ACCEPTED',now());
  `);
});
const get=(path:string)=>fetch(origin+path);
it("lists only the authenticated teacher's current assigned class, ignoring supplied employee IDs",async()=>{
  const response=await get("/classes?schoolId=1&employeeId=11");expect(response.status).toBe(200);
  expect((await response.json() as any[]).map(r=>r.id)).toEqual([21]);
});
it("returns an empty class list and refuses arbitrary attendance when assignments are absent",async()=>{
  await client.query("DELETE FROM teacher_class_assignments WHERE employee_id=10");
  expect(await (await get("/classes?schoolId=1")).json()).toEqual([]);
  expect((await get("/school/attendance/classes/21?schoolId=1&date=2026-10-28")).status).toBe(404);
});
it("loads only assigned students for the chosen class and day, excluding a misattributed event",async()=>{
  const response=await get("/school/attendance/classes/21?schoolId=1&date=2026-10-28");
  expect(response.status).toBe(200);expect((await response.json() as any[]).map(r=>r.id)).toEqual([101]);
});
it.each([22,23,24,25,26,31])("denies unauthorized, future, expired, old-session or inactive-employee class %i",async id=>{
  expect((await get(`/school/attendance/classes/${id}?schoolId=1&date=2099-01-01`)).status).toBe(404);
});
it("scopes roster and class-filtered pickers by actual assignments, never class names",async()=>{
  expect((await (await get("/students?schoolId=1")).json() as any[]).map(r=>r.id)).toEqual([11]);
  expect(await (await get("/students?schoolId=1&classId=22")).json()).toEqual([]);
  expect((await get("/students/11?schoolId=1")).status).toBe(200);
});
it.each([12,13,14,15])("denies direct student, attendance and class-history access to student %i",async id=>{
  for(const path of [`/students/${id}?schoolId=1`,`/school/attendance/students/${id}?schoolId=1`,
    `/students/${id}/class-assignments?schoolId=1`])expect((await get(path)).status,path).toBe(404);
});
it("denies another school and a forged employee filter on assignment lists",async()=>{
  expect((await get("/classes?schoolId=2")).status).toBe(404);
  const response=await get("/teacher-class-assignments?schoolId=1&employeeId=11");
  expect(response.status).toBe(200);expect(await response.json()).toEqual([]);
});
it("preserves School Admin and Owner school-wide class visibility",async()=>{
  for(const role of ["SCHOOL_ADMIN","PLATFORM_OWNER"]){
    f.role=role;const response=await get("/classes?schoolId=1");
    expect(response.status).toBe(200);expect(await response.json()).toHaveLength(6);
  }
});
