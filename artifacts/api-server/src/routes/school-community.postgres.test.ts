import express from "express";
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {execFileSync} from "node:child_process";
import {mkdtempSync,mkdirSync,rmSync} from "node:fs";
import {tmpdir,userInfo} from "node:os";
import {join} from "node:path";
import {createRequire} from "node:module";

// Deliberately no application/database environment variables or provider imports.
// The real PostgreSQL client is pointed only at a freshly created private socket.
const state=vi.hoisted(()=>({db:null as any,roles:[] as any[],userId:10,queued:vi.fn()}));
vi.mock("@workspace/db",()=>({pool:{query:(...args:any[])=>state.db.query(...args),
  connect:async()=>({query:(...args:any[])=>state.db.query(...args),release(){}})}}));
vi.mock("../middlewares/auth",()=>{
  class AuthError extends Error{constructor(public status:number,message:string){super(message)}}
  const context=()=>({user:{id:state.userId,email:"fixture@example.invalid",clerkUserId:"fixture"},roles:state.roles});
  const access=(_req:any,id:number,allowed:string[])=>{
    if(state.roles.some(r=>r.role==="PLATFORM_OWNER")||!state.roles.some(r=>r.schoolId===id&&r.status==="ACTIVE"&&allowed.includes(r.role)))
      throw new AuthError(404,"Resource not found");
    return context();
  };
  return {
  AuthError,
  requireAuthentication:()=> (_req:any,_res:any,next:any)=>next(),
  getUserContext:context,assertSchoolAccess:access,assertSchoolOperationalAccess:access,
  assertRoles:()=>context(),isPlatformOwner:()=>state.roles.some(r=>r.role==="PLATFORM_OWNER"),
  handleAuthError:(err:any,_req:any,_res:any,next:any)=>next(err),
}});
vi.mock("../services/communication-service",()=>({queueCommunicationNotification:(...args:any[])=>state.queued(...args)}));
import router from "./school-community";
import transportRouter from "./transport";
import {communityAccess,communityClosing,dutyStatus,parseBusDuty,publishCalendarChanges,requireDriverCalendarSupport} from "../services/school-community";
import {defaultAttendanceSchedule} from "../services/attendance-schedule";
import {createAttendanceScheduleRouter} from "./attendance-schedule";

const role=(name:string,schoolId=1,status="ACTIVE")=>({role:name,schoolId,status});
const now="2026-10-23T09:00:00Z"; // Friday
const duty={startDate:"2026-10-01",endDate:"2026-10-31",startTime:"07:00",endTime:"16:00",instructions:"Accompany this route."};
let dir="",base="",server:any;
const requirePg=createRequire(new URL("../../../../lib/db/package.json",import.meta.url));
beforeAll(async()=>{
  dir=mkdtempSync(join(tmpdir(),"educore-community-"));
  mkdirSync(join(dir,"socket"));
  execFileSync("initdb",["-D",join(dir,"data"),"-A","trust","--no-locale"],{stdio:"ignore"});
  execFileSync("pg_ctl",["-D",join(dir,"data"),"-l",join(dir,"postgres.log"),
    "-o",`-k ${join(dir,"socket")} -h '' -p 56473`,"-w","start"],{stdio:"ignore"});
  const {Client}=requirePg("pg");
  state.db=new Client({host:join(dir,"socket"),port:56473,user:userInfo().username,database:"postgres"});
  await state.db.connect();
  await state.db.query(`
    CREATE TABLE schools(id int PRIMARY KEY,name text);
    CREATE TABLE audit_logs(id serial PRIMARY KEY,"user" text,role text,school_id int,actor_user_id int,
      action text,module text,record_id int,metadata jsonb,"timestamp" timestamptz DEFAULT now(),
      clerk_user_id text,severity text,event_type text,result text);
    CREATE TABLE school_calendar_events(id int PRIMARY KEY,school_id int,title text,category text,
      start_date date,end_date date,audience text[],status text,is_academic boolean,notes text,
      updated_at timestamptz DEFAULT now(),
      CONSTRAINT school_calendar_events_audience_check CHECK(audience <@ ARRAY['TEACHER','STUDENT','PARENT','STAFF']::text[]));
    CREATE TABLE employees(id int,school_id int,user_id int,employment_status text,
      employee_no text DEFAULT 'FIXTURE',first_name text DEFAULT 'Fixture',last_name text DEFAULT 'Employee',employee_type text DEFAULT 'TEACHER');
    CREATE TABLE transport_buses(id int,school_id int,registration_number text);
    CREATE TABLE transport_routes(id int,school_id int,bus_id int,name text,status text,weekdays text[],
      driver_employee_id int DEFAULT 999,departure_time text DEFAULT '07:00:00',arrival_time text DEFAULT '08:00:00');
    CREATE TABLE transport_route_staff(id serial PRIMARY KEY,school_id int,route_id int,employee_id int,role text,is_active boolean DEFAULT true,
      assigned_by int,created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
    -- Match the existing executable transport migration/runtime, not the older ORM aliases.
    CREATE TABLE transport_history(id serial,school_id int,route_staff_id int,after_state jsonb,before_state jsonb,
      student_id int,event_type text,effective_date date,reason text,actor_user_id int,actor_role text);
    CREATE TABLE school_memberships(user_id int,school_id int,role text,status text);
    CREATE TABLE app_users(id int,status text);
    CREATE TABLE students(id int,user_id int,school_id int,status text);
    CREATE TABLE parents(id int,user_id int,school_id int,status text);
    CREATE TABLE parent_student_relationships(parent_id int,student_id int,status text);
    CREATE TABLE communication_notifications(school_id int,event_key text,archived_at timestamptz);
    CREATE TABLE attendance_settings(school_id int PRIMARY KEY,entry_window_start time,entry_window_end time,
      classroom_window_end time,duplicate_suppression_seconds int,notify_on_entry boolean,
      notify_on_exit boolean,notify_on_discrepancy boolean,updated_at timestamptz DEFAULT now());
  `);
  const app=express();app.use(express.json());app.use(router);app.use(transportRouter);
  app.use(createAttendanceScheduleRouter(vi.fn()));
  app.use((err:any,_req:any,res:any,_next:any)=>res.status(err.status??500).json({error:err.message}));
  await new Promise<void>(resolve=>{server=app.listen(0,"127.0.0.1",()=>resolve())});
  base=`http://127.0.0.1:${server.address().port}`;
},30000);
afterAll(async()=>{
  if(server)await new Promise<void>(r=>server.close(()=>r()));
  if(state.db)await state.db.end();
  if(dir){
    try{execFileSync("pg_ctl",["-D",join(dir,"data"),"-m","immediate","-w","stop"],{stdio:"ignore"})}finally{rmSync(dir,{recursive:true,force:true})}
  }
});
beforeEach(async()=>{
  vi.useRealTimers();
  state.roles=[role("TEACHER")];state.userId=10;state.queued.mockReset();
  await state.db.query(`TRUNCATE attendance_settings,schools,audit_logs,school_calendar_events,employees,transport_buses,transport_routes,
    transport_route_staff,transport_history,school_memberships,app_users,students,parents,
    parent_student_relationships,communication_notifications RESTART IDENTITY`);
  await state.db.query("INSERT INTO schools VALUES(1,'Test school one'),(2,'Test school two')");
});
const get=async(path="/schools/1/community-dashboard")=>{
  const response=await fetch(base+path);return {status:response.status,body:await response.json() as any};
};
async function schedule(overrides:Record<string,unknown>={}){
  await state.db.query(`INSERT INTO audit_logs(school_id,action,module,metadata,"timestamp")
    VALUES(1,'Updated school attendance schedule','Attendance',$1,$2)`,
    [JSON.stringify({revision:2,schedule:{...defaultAttendanceSchedule,...overrides}}),now]);
}
async function events(){
  await state.db.query(`INSERT INTO school_calendar_events(id,school_id,title,category,start_date,audience,status,is_academic,notes)
    VALUES(1,1,'Teacher only','OTHER',CURRENT_DATE,ARRAY['TEACHER'],'ACTIVE',true,'PRIVATE ADMIN NOTE'),
    (2,1,'Family only','OTHER',CURRENT_DATE,ARRAY['PARENT','STUDENT'],'ACTIVE',true,'PRIVATE FAMILY NOTE'),
    (3,2,'Another tenant','OTHER',CURRENT_DATE,ARRAY['TEACHER','PARENT'],'ACTIVE',true,'SECRET'),
    (4,1,'Staff only','OTHER',CURRENT_DATE,ARRAY['STAFF'],'ACTIVE',true,NULL)`);
}
describe("school community: real isolated PostgreSQL",()=>{
  it("filters tenant and targeted audiences; never selects private notes",async()=>{
    await events();
    const result=await get();
    expect(result.status).toBe(200);
    expect(result.body.notices.map((n:any)=>n.id)).toEqual([1]);
    expect(JSON.stringify(result.body)).not.toMatch(/PRIVATE|SECRET|notes|Another tenant|Family only/);
  });
  it("separates a teacher's parent portal from their school portal",async()=>{
    await events();state.roles=[role("TEACHER"),role("PARENT")];
    const family=await get("/schools/1/community-dashboard?view=PARENT");
    expect(family.body.notices.map((n:any)=>n.id)).toEqual([2]);
    expect((await get()).body.notices.map((n:any)=>n.id)).toEqual([1]);
  });
  it("masks other schools, revoked memberships and wrong portal views",async()=>{
    expect((await get("/schools/2/community-dashboard")).status).toBe(404);
    expect((await get("/schools/1/community-dashboard?view=PARENT")).status).toBe(404);
    state.roles=[role("TEACHER",1,"INACTIVE")];expect((await get()).status).toBe(404);
    state.roles=[role("DRIVER")];expect((await get("/schools/1/community-dashboard?view=DRIVER")).status).toBe(200);
    expect((await get()).status).toBe(404);
    state.roles=[role("SCHOOL_ADMIN"),{...role("PLATFORM_OWNER"),schoolId:null}];expect((await get()).status).toBe(403);
  });
  it("gives authorized administrators a read-only overview, not a write endpoint",async()=>{
    await events();state.roles=[role("SCHOOL_ADMIN")];
    expect((await get()).body.notices.map((n:any)=>n.id).sort()).toEqual([1,2,4]);
    expect((await fetch(base+"/schools/1/community-dashboard",{method:"POST"})).status).toBe(404);
  });
  it.each([false,true])("loads both endpoints through the shared timestamp reader (saved=%s)",async(saved)=>{
    state.roles=[role("SCHOOL_ADMIN")];
    if(saved)await schedule();
    const attendance=await get("/school/attendance/schedule?schoolId=1");
    expect(attendance.status).toBe(200);
    expect(attendance.body).toMatchObject({revision:saved?2:0,effectiveAt:saved?now.replace("Z",".000Z"):null});
    const community=await get();
    expect(community.body.error).toBeUndefined();
    expect(community.status).toBe(200);
    expect(community.body.closing).toMatchObject({configured:saved,revision:saved?2:0});
    expect(state.queued).not.toHaveBeenCalled();
  });
  it("persists all five weekday closing times through the schedule API and projects them read-only",async()=>{
    state.roles=[role("SCHOOL_ADMIN")];
    const closingByWeekday={'1':'14:00','2':'13:30','3':'13:45','4':'13:15','5':'12:30'};
    const submit=async(revision:number,schedule:any)=>fetch(`${base}/school/attendance/schedule?schoolId=1`,{
      method:"PUT",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({revision,schedule,reason:"Approved individual weekday closing times"}),
    });
    const response=await submit(0,{...structuredClone(defaultAttendanceSchedule),closingByWeekday});
    expect(response.status).toBe(200);
    const read=await get("/school/attendance/schedule?schoolId=1");
    expect(read).toMatchObject({status:200,body:{revision:1,schedule:{closingByWeekday}}});
    for(const [index,date] of ['2026-10-19','2026-10-20','2026-10-21','2026-10-22','2026-10-23'].entries())
      expect(await communityClosing(state.db,1,new Date(`${date}T09:00:00Z`))).toMatchObject({
        configured:true,timezone:"Africa/Lagos",time:closingByWeekday[String(index+1) as keyof typeof closingByWeekday],
      });
    expect(await communityClosing(state.db,2,new Date(now))).toMatchObject({configured:false,time:null});
    // A legacy payload may update other settings, but cannot erase the new map.
    expect((await submit(1,structuredClone(defaultAttendanceSchedule))).status).toBe(200);
    expect((await get("/school/attendance/schedule?schoolId=1")).body.schedule.closingByWeekday).toEqual(closingByWeekday);
    const revised={...closingByWeekday,'2':'13:00'};
    expect((await submit(2,{...structuredClone(defaultAttendanceSchedule),closingByWeekday:revised})).status).toBe(200);
    expect((await communityClosing(state.db,1,new Date("2026-10-20T09:00:00Z"))).time).toBe("13:00");
    expect(state.queued).not.toHaveBeenCalled();
  });
  it("keeps unsaved operational fallback distinct from a configured closing time",async()=>{
    const c=await communityClosing(state.db,1,new Date(now));
    expect(c).toMatchObject({configured:false,dayOpen:false,time:null,revision:0,effectiveAt:null});
    await schedule();
    expect(await communityClosing(state.db,1,new Date(now))).toMatchObject({configured:true,time:"13:00",dayOpen:true,revision:2,effectiveAt:now.replace("Z",".000Z")});
    expect(await communityClosing(state.db,2,new Date(now))).toMatchObject({configured:false,time:null});
  });
  it("uses school-local day, Friday, closures and non-operating days without exposing closure reasons",async()=>{
    await schedule({timezone:"America/Los_Angeles",closures:[{date:"2026-10-22",reason:"Private operational reason"}]});
    expect(await communityClosing(state.db,1,new Date("2026-10-23T02:00:00Z"))).toMatchObject({date:"2026-10-22",time:null,dayOpen:false});
    expect(await communityClosing(state.db,1,new Date("2026-10-23T16:00:00Z"))).toMatchObject({date:"2026-10-23",time:"13:00"});
    expect(await communityClosing(state.db,1,new Date("2026-10-24T16:00:00Z"))).toMatchObject({time:null,dayOpen:false});
  });
  it("reflects revised closing times and fails explicitly for corrupt stored schedules",async()=>{
    await schedule();await schedule({fridayClosing:"12:30"});
    expect((await communityClosing(state.db,1,new Date(now))).time).toBe("12:30");
    await state.db.query(`INSERT INTO audit_logs(school_id,action,module,metadata) VALUES(1,'Updated school attendance schedule','Attendance','{"revision":3,"schedule":{}}')`);
    await expect(communityClosing(state.db,1,new Date(now))).rejects.toThrow("invalid");
  });
  it("shows an assigned employee's duties only, with no student or employee directory data",async()=>{
    await state.db.query(`INSERT INTO employees(id,school_id,user_id,employment_status) VALUES(1,1,10,'ACTIVE'),(2,1,11,'ACTIVE'),(3,2,10,'ACTIVE');
      INSERT INTO transport_buses VALUES(1,1,'TEST-BUS');
      INSERT INTO transport_routes(id,school_id,bus_id,name,status,weekdays) VALUES(1,1,1,'Assigned route','ACTIVE',ARRAY['FRIDAY']);
      INSERT INTO transport_route_staff(id,school_id,route_id,employee_id,role,is_active) VALUES(1,1,1,1,'TEACHER',true),(2,1,1,2,'STAFF',true),(3,1,1,1,'TEACHER',false);
      INSERT INTO transport_history(school_id,route_staff_id,after_state) VALUES(1,1,'{"duty":null}'),(1,2,'{"duty":null}')`);
    const own=(await get()).body;
    expect(own.busDuties.map((d:any)=>d.id)).toEqual([1]);
    expect(own.busDuties[0].status).toBe("PERIOD_NOT_SET");
    expect(JSON.stringify(own.busDuties)).not.toMatch(/student|employeeName|userId|weekdays/);
    state.roles=[role("PARENT")];expect((await get("/schools/1/community-dashboard?view=PARENT")).body.busDuties).toEqual([]);
    state.roles=[role("SCHOOL_ADMIN")];expect((await get()).body.busDuties.map((d:any)=>d.id)).toEqual([2,1]);
    await state.db.query("UPDATE employees SET employment_status='INACTIVE' WHERE id=1");
    state.roles=[role("TEACHER")];expect((await get()).body.busDuties).toEqual([]);
  });
  it("updates and cancels notices, suppresses no-ops/private-note edits and sends IN_APP intents only",async()=>{
    await events();
    await state.db.query(`INSERT INTO app_users VALUES(10,'ACTIVE'),(11,'ACTIVE'),(12,'ACTIVE'),(13,'ACTIVE');
      INSERT INTO school_memberships VALUES(10,1,'TEACHER','ACTIVE'),(10,1,'TEACHER','ACTIVE'),
      (11,1,'PARENT','ACTIVE'),(12,2,'TEACHER','ACTIVE'),(13,1,'TEACHER','INACTIVE')`);
    const before=(await state.db.query("SELECT id,title,category,start_date::text AS \"startDate\",end_date::text AS \"endDate\",audience,status,is_academic AS academic FROM school_calendar_events WHERE id=1")).rows;
    await publishCalendarChanges(state.db,1,99,before,[{...before[0],notes:"changed private note",audience:["TEACHER"]}]);
    expect(state.queued).not.toHaveBeenCalled();
    const updated={...before[0],title:"Changed public title"};
    await publishCalendarChanges(state.db,1,99,before,[updated]);
    expect(state.queued).toHaveBeenCalledTimes(1);
    expect(state.queued.mock.calls[0][1]).toMatchObject({recipientUserId:10,schoolId:1,channels:["IN_APP"],useSchoolDefaults:false});
    expect(JSON.stringify(state.queued.mock.calls[0][1])).not.toContain("Changed public title");
    await state.db.query("UPDATE school_calendar_events SET status='INACTIVE' WHERE id=1");
    await publishCalendarChanges(state.db,1,99,[updated],[{...updated,status:"INACTIVE"}]);
    const latest=(await get()).body.notices.find((n:any)=>n.id===1);
    expect(latest).toMatchObject({status:"INACTIVE",change:"CANCELLED"});
    state.roles=[role("PARENT")];
    expect((await get("/schools/1/community-dashboard?view=PARENT")).body.notices.some((n:any)=>n.id===1)).toBe(false);
  });
  it("leaves the Driver constraint unapplied and clearly reports approval is required",async()=>{
    await requireDriverCalendarSupport(state.db,1,[["TEACHER"]]);
    await expect(requireDriverCalendarSupport(state.db,1,[["DRIVER"]])).rejects.toThrow("separately approved");
  });
  it("persists duty-only edits and preserves the saved period across removal/restoration",async()=>{
    state.roles=[role("SCHOOL_ADMIN")];
    await state.db.query(`INSERT INTO employees(id,school_id,user_id,employment_status) VALUES(1,1,10,'ACTIVE');
      INSERT INTO transport_routes(id,school_id,bus_id,name,status,weekdays) VALUES(1,1,1,'Routed duty','ACTIVE',ARRAY['FRIDAY'])`);
    const write=async(path:string,data:any,method="PATCH")=>{
      const r=await fetch(base+path,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
      return {status:r.status,data:await r.json() as any};
    };
    const created=await write("/transport/routes/1/staff?schoolId=1",{employeeId:1,role:"TEACHER",duty},"POST");
    expect(created.status).toBe(201);const id=created.data.routeStaffId;
    const path=`/transport/routes/1/staff/${id}?schoolId=1`;
    const revised={...duty,endDate:"2026-10-30",instructions:"Updated safe duty instructions"};
    expect((await write(path,{duty:revised}))).toMatchObject({status:200,data:{duty:revised}});
    const listed=await get("/transport/routes/1/staff?schoolId=1");
    expect(listed.body[0].duty).toEqual(revised);
    expect((await write(path,{isActive:false}))).toMatchObject({status:200,data:{duty:revised,isActive:false}});
    expect((await get()).body.busDuties).toEqual([]);
    expect((await write(path,{isActive:true}))).toMatchObject({status:200,data:{duty:revised,isActive:true}});
    state.roles=[role("TEACHER")];expect((await write(path,{duty})).status).toBe(404);
    state.roles=[role("SCHOOL_ADMIN",2)];expect((await write(path,{duty})).status).toBe(404);
  });
});
describe("duty boundaries and portal authorization",()=>{
  it("validates real dates and ordered local time ranges",()=>{
    expect(parseBusDuty(duty)).toEqual(duty);
    for(const patch of [{startDate:"2026-02-30"},{endDate:"2026-09-30"},{startTime:"16:00"},{endTime:"25:00"},{instructions:"x".repeat(1001)}])
      expect(()=>parseBusDuty({...duty,...patch})).toThrow();
  });
  it("distinguishes future, off-duty, non-route days and expired periods",()=>{
    expect(dutyStatus(duty,"2026-09-30","10:00")).toBe("UPCOMING");
    expect(dutyStatus(duty,"2026-10-22","06:59")).toBe("UPCOMING");
    expect(dutyStatus(duty,"2026-10-22","07:00")).toBe("ACTIVE");
    expect(dutyStatus(duty,"2026-10-22","16:00")).toBe("OFF_DUTY");
    expect(dutyStatus(duty,"2026-10-31","16:00")).toBe("EXPIRED");
    expect(dutyStatus(duty,"2026-11-01","10:00")).toBe("EXPIRED");
    expect(dutyStatus(duty,"2026-10-22","10:00",["FRIDAY"],4)).toBe("NOT_SCHEDULED_TODAY");
    expect(dutyStatus(null,"2026-10-22","10:00")).toBe("PERIOD_NOT_SET");
  });
  it("does not use a role from another school to authorize the requested portal",()=>{
    expect(()=>communityAccess([role("TEACHER"),role("PARENT",2)],1,"PARENT")).toThrow();
  });
});
