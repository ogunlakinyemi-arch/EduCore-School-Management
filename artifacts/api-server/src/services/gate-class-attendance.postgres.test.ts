import {execFileSync,spawn,type ChildProcess} from "node:child_process";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {DatabasePool,type DatabasePoolClient} from "@workspace/db/driver";
import {beforeAll,afterAll,beforeEach,describe,it,expect} from "vitest";
import {markClassFromGate,isMorningGateEntry} from "./gate-class-attendance";
let dir:string,server:ChildProcess,pool:InstanceType<typeof DatabasePool>,db:DatabasePoolClient;
const rows=async(q:string,v?:unknown[])=>(await db.query(q,v)).rows;
beforeAll(async()=>{
  dir=await mkdtemp(path.join(tmpdir(),"attendance-auto-"));
  const env={PATH:process.env.PATH,HOME:process.env.HOME,LANG:"C.UTF-8"};
  execFileSync("initdb",["-D",path.join(dir,"data"),"-U","attendance_fixture","-A","trust","--no-locale"],{env,stdio:"ignore"});
  server=spawn("postgres",["-D",path.join(dir,"data"),"-k",dir,"-h","","-p","5432"],{env,stdio:"ignore"});
  pool=new DatabasePool({host:dir,port:5432,database:"postgres",user:"attendance_fixture",max:3,connectionTimeoutMillis:1000});
  for(let i=0;i<100;i++){try{db=await pool.connect();break;}catch{await new Promise(r=>setTimeout(r,30));}}
  if(!db)throw new Error("Disposable database unavailable; application DB fallback forbidden");
  await db.query(`CREATE TABLE attendance_settings(school_id int,entry_window_start time,entry_window_end time);
    CREATE TABLE school_classes(id int PRIMARY KEY,school_id int,name text);
    CREATE TABLE student_class_assignments(id int,school_id int,student_id int,school_class_id int,
      section text,created_at timestamptz,start_date date,end_date date,status text DEFAULT 'ACTIVE');
    CREATE TABLE attendance_events(id serial PRIMARY KEY,school_id int NOT NULL,student_id int,device_id int,
      nfc_card_id int,identification_method text,event_type text,result text,attendance_status text,event_date date,
      occurred_at timestamptz,academic_session_id int,academic_term_id int,school_class_id int,
      class_name_snapshot text,section_snapshot text,reason text,actor_user_id int,dedupe_key text NOT NULL,
      UNIQUE(school_id,dedupe_key));
    CREATE TABLE attendance_discrepancies(school_id int,student_id int,attendance_event_id int REFERENCES attendance_events(id),
      discrepancy_type text,details jsonb);`);
},30000);
afterAll(async()=>{
  db?.release();await pool?.end();
  if(server&&server.exitCode===null){server.kill("SIGTERM");await new Promise<void>(r=>server.once("exit",()=>r()));}
  if(dir)await rm(dir,{recursive:true,force:true});
},30000);
beforeEach(async()=>{
  await db.query(`TRUNCATE attendance_discrepancies,attendance_events,school_classes,student_class_assignments,attendance_settings RESTART IDENTITY;
    INSERT INTO school_classes VALUES(30,10,'Historical class');
    INSERT INTO student_class_assignments VALUES(1,10,1,30,'A','2026-09-01',NULL,NULL);`);
});
async function gate(type="SCHOOL_ENTRY",time="2026-10-21T07:00:00Z",school=10){
  return (await rows(`INSERT INTO attendance_events(school_id,student_id,device_id,nfc_card_id,identification_method,
    event_type,result,event_date,occurred_at,dedupe_key) VALUES($1,1,4,9,'NFC',$2,'ACCEPTED','2026-10-21',$3,md5(random()::text)) RETURNING id`,
    [school,type,time]))[0].id as number;
}
const classes=()=>rows("SELECT * FROM attendance_events WHERE event_type='CLASSROOM_ENTRY' ORDER BY id");
async function auto(id:number){await db.query("BEGIN");try{await markClassFromGate(db,id);await db.query("COMMIT");}catch(e){await db.query("ROLLBACK");throw e;}}
describe("provisional gate-to-class presence, isolated PostgreSQL",()=>{
  it("preserves gate event and writes source, original evidence and historical class",async()=>{
    const id=await gate();await auto(id);
    expect((await classes())[0]).toMatchObject({school_id:10,student_id:1,school_class_id:30,
      identification_method:"NFC_GATE_AUTO",attendance_status:"PRESENT",class_name_snapshot:"Historical class",section_snapshot:"A",nfc_card_id:9,device_id:4});
    expect((await classes())[0].reason).toContain(`gate event ${id}`);
    expect((await classes())[0].reason).toContain("not biometric");
    expect((await rows("SELECT event_type FROM attendance_events WHERE id=$1",[id]))[0].event_type).toBe("SCHOOL_ENTRY");
  });
  it("repeated and separate taps cannot duplicate daily class presence",async()=>{
    const a=await gate(),b=await gate("SCHOOL_ENTRY","2026-10-21T08:00:00Z");
    await auto(a);await auto(a);await auto(b);expect(await classes()).toHaveLength(1);
  });
  it("concurrent readers create one class event",async()=>{
    const a=await gate(),b=await gate();
    await Promise.all([a,b].map(async id=>{const c=await pool.connect();try{
      await c.query("BEGIN");await markClassFromGate(c,id);await c.query("COMMIT");
    }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}}));
    expect(await classes()).toHaveLength(1);
  });
  it("Tag-out alone creates no class presence",async()=>{await auto(await gate("SCHOOL_EXIT"));expect(await classes()).toHaveLength(0);});
  it("Tag-out never erases existing class evidence",async()=>{
    await auto(await gate());const before=await classes();await auto(await gate("SCHOOL_EXIT","2026-10-21T14:00:00Z"));
    expect(await classes()).toEqual(before);
  });
  it("afternoon entry flags missing class rather than inventing presence",async()=>{
    await auto(await gate("SCHOOL_ENTRY","2026-10-21T12:00:00Z"));
    expect(await classes()).toHaveLength(0);expect((await rows("SELECT details FROM attendance_discrepancies"))[0].details.note).toContain("roll-call");
  });
  it("respects configured morning window",async()=>{
    await db.query("INSERT INTO attendance_settings VALUES(10,'09:00','11:00')");
    await auto(await gate());expect(await classes()).toHaveLength(0);
  });
  it("missing, future or cross-school placement is not used",async()=>{
    await db.query("UPDATE student_class_assignments SET created_at='2026-10-21T09:00Z'");
    await auto(await gate());expect(await classes()).toHaveLength(0);
    await auto(await gate("SCHOOL_ENTRY","2026-10-21T07:00Z",20));expect(await classes()).toHaveLength(0);
    expect(await rows("SELECT * FROM attendance_discrepancies")).toHaveLength(2);
  });
  it("keeps teacher/manual confirmation instead of adding auto presence",async()=>{
    const id=await gate();await db.query(`INSERT INTO attendance_events(school_id,student_id,identification_method,event_type,result,event_date,dedupe_key)
      VALUES(10,1,'MANUAL','CLASSROOM_ENTRY','ACCEPTED','2026-10-21','teacher-roll-call')`);
    await auto(id);expect(await classes()).toHaveLength(1);expect((await classes())[0].identification_method).toBe("MANUAL");
  });
  it("refuses an inactive placement with no historical closing evidence",async()=>{
    await db.query("UPDATE student_class_assignments SET status='INACTIVE'");
    await auto(await gate());expect(await classes()).toHaveLength(0);
    expect(await rows("SELECT * FROM attendance_discrepancies")).toHaveLength(1);
  });
  it("rolls gate and derived class back together on transaction failure",async()=>{
    const before=(await rows("SELECT count(*)::int AS n FROM attendance_events"))[0].n;
    await db.query("BEGIN");await markClassFromGate(db,await gate());await db.query("ROLLBACK");
    expect((await rows("SELECT count(*)::int AS n FROM attendance_events"))[0].n).toBe(before);
  });
  it("flags contradictory classroom absence without overwriting the teacher's record",async()=>{
    const id=await gate();await db.query(`INSERT INTO attendance_events(school_id,student_id,identification_method,
      event_type,result,attendance_status,event_date,occurred_at,dedupe_key) VALUES(10,1,'MANUAL',
      'CLASSROOM_ENTRY','ACCEPTED','ABSENT','2026-10-21','2026-10-21T06:50Z','teacher-absence')`);
    await auto(id);await auto(id);
    expect(await classes()).toHaveLength(1);expect((await classes())[0].attendance_status).toBe("ABSENT");
    expect((await rows("SELECT * FROM attendance_discrepancies"))[0].discrepancy_type).toBe("GATE_CLASS_STATUS_MISMATCH");
    expect(await rows("SELECT * FROM attendance_discrepancies")).toHaveLength(1);
  });
  it("non-NFC, rejected and invalid inputs are never automatic biometric proof",()=>{
    const event={eventType:"SCHOOL_ENTRY",identificationMethod:"NFC",result:"ACCEPTED",occurredAt:"2026-10-21T07:00Z"};
    expect(isMorningGateEntry(event)).toBe(true);
    expect(isMorningGateEntry({...event,identificationMethod:"FINGERPRINT"})).toBe(false);
    expect(isMorningGateEntry({...event,result:"REJECTED"})).toBe(false);
    expect(isMorningGateEntry({...event,occurredAt:"invalid"})).toBe(false);
  });
});
