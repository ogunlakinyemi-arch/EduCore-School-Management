import express from "express";
import {execFileSync,spawn,type ChildProcess} from "node:child_process";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {DatabasePool} from "@workspace/db/driver";
import {beforeAll,afterAll,beforeEach,describe,it,expect,vi} from "vitest";
const state=vi.hoisted(()=>({pool:null as any,role:"PLATFORM_OWNER",status:"ACTIVE",anonymous:false,dual:false}));
vi.mock("@workspace/db",()=>({pool:{query:(...args:any[])=>state.pool.query(...args)}}));
vi.mock("../middlewares/auth",async original=>{
  const actual=await original<typeof import("../middlewares/auth")>();
  return {...actual,requireAuthentication:()=> (_req:any,res:any,next:any)=>state.anonymous?res.status(401).json({error:"Sign in"}):next(),
    getUserContext:()=>({user:{id:1,email:"owner@example.invalid"},roles:[
      {role:state.role,status:state.status,schoolId:state.role==="PLATFORM_OWNER"?null:1},
      ...(state.dual?[{role:"SCHOOL_ADMIN",status:"ACTIVE",schoolId:1}]:[])]})};
});
import router from "./owner-attendance";
let dir:string,postgres:ChildProcess,http:ReturnType<ReturnType<typeof express>["listen"]>,base:string;
beforeAll(async()=>{
  dir=await mkdtemp(path.join(tmpdir(),"owner-attendance-"));
  const env={PATH:process.env.PATH,HOME:process.env.HOME,LANG:"C.UTF-8"};
  execFileSync("initdb",["-D",path.join(dir,"data"),"-U","attendance_owner_fixture","-A","trust","--no-locale"],{env,stdio:"ignore"});
  postgres=spawn("postgres",["-D",path.join(dir,"data"),"-k",dir,"-h","","-p","5432"],{env,stdio:"ignore"});
  state.pool=new DatabasePool({host:dir,port:5432,database:"postgres",user:"attendance_owner_fixture",max:3,connectionTimeoutMillis:500});
  let ready=false;
  for(let i=0;i<100;i++){try{await state.pool.query("SELECT 1");ready=true;break;}catch{await new Promise(r=>setTimeout(r,30));}}
  if(!ready)throw new Error("Disposable PostgreSQL unavailable; application database fallback forbidden");
  await state.pool.query(`
    CREATE TABLE schools(id int PRIMARY KEY,name text);
    CREATE TABLE school_classes(id int PRIMARY KEY,school_id int,name text);
    CREATE TABLE students(id int PRIMARY KEY,school_id int,first_name text,last_name text,admission_no text,class_name text,middle_name text);
    CREATE TABLE employees(id int PRIMARY KEY,school_id int,first_name text,last_name text,employee_no text,employee_type text,middle_name text);
    CREATE TABLE student_class_assignments(id int PRIMARY KEY,school_id int,student_id int,school_class_id int,
      status text,created_at timestamptz,start_date date,end_date date);
    CREATE TABLE attendance_events(id int PRIMARY KEY,school_id int,student_id int,employee_id int,
      school_class_id int,event_date date,event_type text,identification_method text,attendance_status text,result text,occurred_at timestamptz);
    CREATE TABLE attendance_discrepancies(school_id int,attendance_event_id int,discrepancy_type text,status text);
    CREATE TABLE employee_nfc_attendance_discrepancies(school_id int,attendance_event_id int,kind text,status text);
    CREATE TABLE audit_logs(school_id int,actor_user_id int,"user" text,role text,action text,module text,event_type text,result text,metadata jsonb);`);
  const app=express().use(express.json()).use(router);
  app.use((error:any,_req:any,res:any,_next:any)=>res.status(error.statusCode??500).json({error:error.message}));
  await new Promise<void>(resolve=>{http=app.listen(0,"127.0.0.1",()=>resolve());});
  base=`http://127.0.0.1:${(http.address() as any).port}`;
},30000);
afterAll(async()=>{
  if(http)await new Promise<void>(resolve=>http.close(()=>resolve()));
  await state.pool?.end();
  if(postgres&&postgres.exitCode===null){postgres.kill("SIGTERM");await new Promise<void>(resolve=>postgres.once("exit",()=>resolve()));}
  if(dir)await rm(dir,{recursive:true,force:true});
});
beforeEach(async()=>{
  state.role="PLATFORM_OWNER";state.status="ACTIVE";state.anonymous=false;state.dual=false;
  await state.pool.query(`TRUNCATE schools,school_classes,students,employees,student_class_assignments,
    attendance_events,attendance_discrepancies,employee_nfc_attendance_discrepancies,audit_logs;
    INSERT INTO schools VALUES(1,'Alpha School'),(2,'Other School');
    INSERT INTO school_classes VALUES(1,1,'Class A'),(2,2,'Foreign class'),(3,1,'Class B');
    INSERT INTO students(id,school_id,first_name,last_name,admission_no,class_name) VALUES(1,1,'Ada','Example','A-1','Class A'),(2,1,'No','Events','A-2','Class A'),
      (3,2,'Foreign','Student','OTHER-3','Foreign class'),(4,1,'Other','Class','B-4','Class B');
    UPDATE students SET middle_name='Middle' WHERE id=1;
    INSERT INTO employees(id,school_id,first_name,last_name,employee_no,employee_type) VALUES(1,1,'Teacher','One','T-1','TEACHER'),(2,2,'Foreign','Teacher','T-2','TEACHER'),
      (3,1,'Other','Staff','S-3','STAFF');
    INSERT INTO student_class_assignments VALUES
      (1,1,1,1,'ACTIVE','2026-09-01',NULL,NULL),(2,1,2,1,'ACTIVE','2026-09-01',NULL,NULL),
      (3,2,3,2,'ACTIVE','2026-09-01',NULL,NULL),(4,1,4,3,'ACTIVE','2026-09-01',NULL,NULL);
    INSERT INTO attendance_events VALUES
      (1,1,1,NULL,1,'2026-10-21','SCHOOL_ENTRY','NFC','PRESENT','ACCEPTED','2026-10-21T07:00Z'),
      (2,1,1,NULL,1,'2026-10-21','SCHOOL_EXIT','NFC','PRESENT','ACCEPTED','2026-10-21T14:00Z'),
      (3,1,1,NULL,1,'2026-10-21','CLASSROOM_ENTRY','NFC_GATE_AUTO','PRESENT','ACCEPTED','2026-10-21T07:00Z'),
      (4,2,3,NULL,2,'2026-10-21','SCHOOL_ENTRY','NFC','PRESENT','ACCEPTED','2026-10-21T08:00Z'),
      (5,1,NULL,1,NULL,'2026-10-21','SCHOOL_ENTRY','NFC','LATE','ACCEPTED','2026-10-21T06:00Z'),
      (6,1,NULL,1,NULL,'2026-10-21','SCHOOL_EXIT','NFC','PRESENT','ACCEPTED','2026-10-21T15:00Z'),
      (7,2,NULL,2,NULL,'2026-10-21','SCHOOL_ENTRY','NFC','PRESENT','ACCEPTED','2026-10-21T08:00Z'),
      (8,1,NULL,3,NULL,'2026-10-21','SCHOOL_ENTRY','NFC','PRESENT','ACCEPTED','2026-10-21T08:00Z');
    INSERT INTO attendance_discrepancies VALUES(1,1,'SCHOOL_PRESENT_CLASS_ABSENT','OPEN');
    INSERT INTO employee_nfc_attendance_discrepancies VALUES(1,5,'MISSING_TAG_OUT','RESOLVED');`);
});
const params=(extra:Record<string,string>={})=>new URLSearchParams({schoolId:"1",type:"STUDENT",classId:"1",
  from:"2026-10-21",to:"2026-10-21",...extra}).toString();
async function get(extra:Record<string,string>={}){
  const response=await fetch(`${base}/platform/attendance/records?${params(extra)}`);
  return {status:response.status,body:await response.json() as any};
}
describe("Owner attendance: actual SQL and read-only HTTP boundaries",()=>{
  it("scopes class directory and rejects a foreign-school class",async()=>{
    const classes=await (await fetch(`${base}/platform/attendance/classes?schoolId=1`)).json();
    expect(classes).toEqual([{id:1,name:"Class A"},{id:3,name:"Class B"}]);
    expect((await get({classId:"2"})).status).toBe(404);
    expect((await get({schoolId:"999"})).status).toBe(404);
  });
  it.each(["SCHOOL_ADMIN","TEACHER","STAFF","PARENT","STUDENT","PARTNER","COMPANY_ACCOUNTANT"])(
    "denies %s before reading or exporting attendance",async role=>{
      state.role=role;
      expect((await get()).status).toBe(403);
      expect((await get({format:"CSV"})).status).toBe(403);
      expect((await fetch(`${base}/platform/attendance/classes?schoolId=1`)).status).toBe(403);
      expect((await state.pool.query("SELECT * FROM audit_logs")).rows).toHaveLength(0);
    });
  it("denies anonymous and inactive Owner sessions",async()=>{
    state.anonymous=true;expect((await get()).status).toBe(401);
    state.anonymous=false;state.status="INACTIVE";expect((await get()).status).toBe(403);
  });
  it.each(["POST","PUT","PATCH","DELETE"])("rejects %s even for a dual-role Owner",async method=>{
    state.dual=true;
    const before=(await state.pool.query("SELECT * FROM attendance_events ORDER BY id")).rows;
    expect((await fetch(`${base}/platform/attendance/records?${params()}`,{method})).status).toBe(403);
    expect((await state.pool.query("SELECT * FROM attendance_events ORDER BY id")).rows).toEqual(before);
  });
  it("lists the whole class without inventing absence and keeps entry, exit and provisional class distinct",async()=>{
    const result=await get();expect(result.status).toBe(200);expect(result.body.total).toBe(2);
    const [ada,noEvents]=result.body.rows;
    expect(ada).toMatchObject({name:"Ada Middle Example",identifier:"A-1",date:"2026-10-21",
      gateEntries:[{eventType:"SCHOOL_ENTRY",source:"NFC",at:"2026-10-21T07:00:00+00:00"}],
      gateExits:[{eventType:"SCHOOL_EXIT",at:"2026-10-21T14:00:00+00:00"}],
      classroom:[{eventType:"CLASSROOM_ENTRY",source:"NFC_GATE_AUTO",status:"PRESENT"}]});
    expect(ada.anomalies).toContain("SCHOOL_PRESENT_CLASS_ABSENT (OPEN; event 1)");
    expect(noEvents).toMatchObject({name:"No Events",status:"Not recorded",gateEntries:[],gateExits:[],classroom:[]});
    expect(JSON.stringify(result.body)).not.toMatch(/Foreign Student|Other Class|Other School/);
    const audit=(await state.pool.query("SELECT * FROM audit_logs")).rows[0];
    expect(audit).toMatchObject({school_id:1,role:"PLATFORM_OWNER",event_type:"OWNER_ATTENDANCE_VIEWED"});
    expect(audit.metadata).toMatchObject({schoolId:1,classId:1,from:"2026-10-21",returned:2});
  });
  it("teacher records exclude staff and foreign schools and remain gate-only",async()=>{
    const result=await get({type:"TEACHER"});
    // Build without the student-only class parameter.
    const query=new URLSearchParams(params({type:"TEACHER"}));query.delete("classId");
    const response=await fetch(`${base}/platform/attendance/records?${query}`);
    const body=await response.json() as any;expect(response.status).toBe(200);
    expect(body.rows).toHaveLength(1);expect(body.rows[0]).toMatchObject({name:"Teacher One",identifier:"T-1",classroom:[]});
    expect(body.rows[0].gateEntries[0].eventType).toBe("SCHOOL_ENTRY");
    expect(body.rows[0].gateExits[0].eventType).toBe("SCHOOL_EXIT");
    expect(body.rows[0].anomalies).toContain("MISSING_TAG_OUT (RESOLVED; event 5)");
    expect(result.status).toBe(400);
  });
  it("paginates without leaking unselected class records and preserves totals on empty pages",async()=>{
    const first=await get({pageSize:"1"}),second=await get({pageSize:"1",page:"2"}),empty=await get({page:"9"});
    expect(first.body.total).toBe(2);expect(first.body.rows).toHaveLength(1);
    expect(second.body.rows[0].identifier).toBe("A-2");
    expect(empty.body).toMatchObject({total:2,rows:[]});
  });
  it("does not assign an earlier same-day gate event to a newly joined class",async()=>{
    await state.pool.query(`UPDATE attendance_events SET school_class_id=NULL WHERE id=1;
      UPDATE student_class_assignments SET end_date='2026-10-21',status='INACTIVE' WHERE id=1;
      INSERT INTO student_class_assignments VALUES(5,1,1,3,'ACTIVE','2026-10-21T10:00Z','2026-10-21',NULL);`);
    const old=await get(),later=await get({classId:"3"});
    expect(old.body.rows.find((r:any)=>r.personId===1).gateEntries).toHaveLength(1);
    expect(later.body.rows.find((r:any)=>r.personId===1)).toMatchObject({gateEntries:[],classroom:[]});
    expect((await state.pool.query("SELECT identification_method FROM attendance_events WHERE id=3")).rows[0].identification_method).toBe("NFC_GATE_AUTO");
  });
  it("retains explicit absence and a missing timestamp rather than replacing it with gate time",async()=>{
    await state.pool.query(`INSERT INTO attendance_events VALUES(9,1,2,NULL,1,'2026-10-21','CLASSROOM_ENTRY','MANUAL','ABSENT','ACCEPTED',NULL);`);
    const row=(await get()).body.rows.find((r:any)=>r.personId===2);
    expect(row).toMatchObject({gateEntries:[],classroom:[{source:"MANUAL",status:"ABSENT",at:null}],status:"ABSENT"});
  });
  it.each([{from:"2026-02-30"},{from:"2026-12-01"},{from:"2026-01-01"},{classId:""},{pageSize:"101"}] as Record<string,string>[])(
    "rejects invalid filters %j",async filters=>expect((await get(filters)).status).toBe(400));
  it("exports all selected rows, safe cells and scope metadata with no other-school records",async()=>{
    await state.pool.query("UPDATE students SET first_name='=CMD' WHERE id=1");
    const response=await fetch(`${base}/platform/attendance/records?${params({format:"CSV",pageSize:"1",page:"2"})}`);
    const csv=await response.text();expect(response.status).toBe(200);
    for(const value of ["EXPORT_METADATA","Alpha School","2026-10-21","Class A","Africa/Lagos","Export timestamp",
      "Entry Tag-in","Exit Tag-out","NFC_GATE_AUTO","A-1","A-2"])expect(csv).toContain(value);
    expect(csv).toContain("\"'=CMD Middle Example\"");
    expect(csv).not.toMatch(/Foreign Student|Other School|Other Staff|B-4/);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect((await state.pool.query("SELECT event_type FROM audit_logs")).rows[0].event_type).toBe("OWNER_ATTENDANCE_EXPORTED");
  });
  it("refuses over-limit exports instead of silently clipping records",async()=>{
    await state.pool.query(`INSERT INTO students(id,school_id,first_name,last_name,admission_no,class_name)
      SELECT 100+n,1,'Bulk',n::text,'BULK-'||n,'Class A' FROM generate_series(1,5000) n;
      INSERT INTO student_class_assignments SELECT 100+n,1,100+n,1,'ACTIVE','2026-09-01',NULL,NULL FROM generate_series(1,5000) n;`);
    const result=await get({format:"CSV"});expect(result.status).toBe(409);expect(result.body.error).toContain("5000");
    expect((await state.pool.query("SELECT * FROM audit_logs WHERE event_type='OWNER_ATTENDANCE_EXPORTED'")).rows).toHaveLength(0);
  });
});
