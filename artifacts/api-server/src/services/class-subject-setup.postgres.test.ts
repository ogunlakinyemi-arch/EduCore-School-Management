import { Pool, type PoolClient } from "pg";
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
vi.mock("../middlewares/auth",()=>({AuthError:class extends Error {
  constructor(public statusCode:number,message:string){super(message);}
}}));
import { saveClassSubjectSetup } from "./class-subject-setup";
import { timetableSelectionSql } from "../lib/timetable-selection-sql";

// Opt-in isolated, credential-free fixture, never an application database.
const socket=process.env.CLASS_SUBJECT_TEST_SOCKET;
const enabled=!!socket;
describe.skipIf(!enabled)("class subject setup on isolated PostgreSQL",()=>{
  let pool:Pool;
  const body=(subjects:Array<{subjectId:number;teacherId?:number|null}>=[],extra:object={})=>({
    schoolId:1,classId:4,sessionId:2,termId:null,subjects,expectedAssignmentIds:[],...extra,
  });
  async function save(b:ReturnType<typeof body>,client?:PoolClient){
    const c=client??await pool.connect();
    try {await c.query("BEGIN");const r=await saveClassSubjectSetup(c,b);await c.query("COMMIT");return r;}
    catch(e){await c.query("ROLLBACK");throw e;}
    finally{if(!client)c.release();}
  }
  const active=async()=> (await pool.query("SELECT * FROM class_subjects WHERE school_id=1 AND school_class_id=4 AND academic_session_id=2 AND academic_term_id IS NULL AND status='ACTIVE' ORDER BY id")).rows;
  beforeAll(async()=>{
    if(!socket?.startsWith("/tmp/educore-class-subject-")||process.env.REPLIT_DEPLOYMENT)
      throw Error("Refusing a non-disposable PostgreSQL target");
    pool=new Pool({host:socket,port:55439,user:"class_setup_fixture",database:"class_setup_fixture",max:4});
    const identity=(await pool.query("SELECT current_database() db,current_user name,inet_server_addr() host,current_setting('data_directory') path")).rows[0];
    if(identity.db!=="class_setup_fixture"||identity.name!=="class_setup_fixture"||identity.host!==null||
      !identity.path.startsWith(`${socket}/data`))throw Error("Wrong isolated database identity");
    await pool.query(`
      DROP TABLE IF EXISTS preserved_marks,academic_timetable_entries,class_subjects,
        teacher_class_assignments,employees,subjects,academic_terms,academic_sessions,school_classes;
      CREATE TABLE school_classes(id int PRIMARY KEY,school_id int,name text,section text NOT NULL);
      CREATE TABLE academic_sessions(id int PRIMARY KEY,school_id int,status text,start_date date,end_date date);
      CREATE TABLE academic_terms(id int PRIMARY KEY,school_id int,academic_session_id int,status text,start_date date,end_date date);
      CREATE TABLE subjects(id int PRIMARY KEY,school_id int,status text);
      CREATE TABLE employees(id int PRIMARY KEY,school_id int,employee_type text,employment_status text);
      CREATE TABLE teacher_class_assignments(id serial PRIMARY KEY,school_id int,employee_id int,
        academic_session_id int,school_class_id int,subject_id int,section text,assignment_type text,
        status text,start_date date,end_date date);
      CREATE UNIQUE INDEX teacher_class_assignments_unique ON teacher_class_assignments(employee_id,
        academic_session_id,school_class_id,section,assignment_type,coalesce(subject_id,0)) WHERE status='ACTIVE';
      CREATE TABLE class_subjects(id serial PRIMARY KEY,school_id int,school_class_id int REFERENCES school_classes(id),
        academic_session_id int REFERENCES academic_sessions(id),academic_term_id int REFERENCES academic_terms(id),
        subject_id int REFERENCES subjects(id),employee_id int REFERENCES employees(id),section text,status text,
        updated_at timestamptz DEFAULT now());
      CREATE UNIQUE INDEX class_subjects_unique ON class_subjects(school_class_id,subject_id,academic_session_id,
        coalesce(academic_term_id,0),coalesce(section,'')) WHERE status='ACTIVE';
      CREATE TABLE academic_timetable_entries(id int PRIMARY KEY,subject_id int,teacher_employee_id int);
      CREATE TABLE preserved_marks(id int PRIMARY KEY,subject_id int,score int);
      INSERT INTO school_classes VALUES(4,1,'Class 4','B'),(14,2,'Other school','C');
      INSERT INTO academic_sessions VALUES(2,1,'ACTIVE',CURRENT_DATE-60,CURRENT_DATE+240),(12,2,'ACTIVE',CURRENT_DATE-60,CURRENT_DATE+240);
      INSERT INTO academic_terms VALUES(3,1,2,'ACTIVE',CURRENT_DATE-60,CURRENT_DATE+40),
        (9,1,2,'ACTIVE',CURRENT_DATE+41,CURRENT_DATE+140),(13,2,12,'ACTIVE',CURRENT_DATE-60,CURRENT_DATE+40);
      INSERT INTO subjects VALUES(5,1,'ACTIVE'),(7,1,'ACTIVE'),(15,2,'ACTIVE'),(17,1,'INACTIVE');
      INSERT INTO employees VALUES(6,1,'TEACHER','ACTIVE'),(8,1,'TEACHER','ACTIVE'),
        (16,2,'TEACHER','ACTIVE'),(18,1,'STAFF','ACTIVE'),(19,1,'TEACHER','INACTIVE');
      INSERT INTO academic_timetable_entries VALUES(71,5,6);
      INSERT INTO preserved_marks VALUES(81,5,79);
    `);
  });
  afterAll(async()=>{if(pool)await pool.end();});
  beforeEach(async()=>{
    await pool.query("UPDATE academic_sessions SET start_date=CURRENT_DATE-60,end_date=CURRENT_DATE+240");
    await pool.query(`TRUNCATE class_subjects,teacher_class_assignments RESTART IDENTITY;
      INSERT INTO teacher_class_assignments(school_id,employee_id,academic_session_id,school_class_id,subject_id,
        section,assignment_type,status,start_date) VALUES
        (1,6,2,4,5,'B','SUBJECT_TEACHER','ACTIVE','2026-09-01'),
        (1,8,2,4,7,'B','SUBJECT_TEACHER','ACTIVE','2026-09-01');`);
  });
  it("links catalogue IDs, saves responsible teacher and supports timetable selection immediately",async()=>{
    expect(await save(body([{subjectId:5,teacherId:6}]))).toEqual({saved:true,linkedSubjectCount:1});
    expect((await active()).map(r=>[r.subject_id,r.employee_id])).toEqual([[5,6]]);
    expect((await pool.query("SELECT count(*)::int n FROM subjects")).rows[0].n).toBe(4);
    expect((await pool.query(timetableSelectionSql,[1,2,3,4,5,6,"B"])).rowCount).toBe(1);
  });
  it("rejects duplicate input before creating records",async()=>{
    await expect(save(body([{subjectId:5},{subjectId:5}]))).rejects.toMatchObject({statusCode:400});
    expect(await active()).toEqual([]);
  });
  it("is repeatable and detects a stale concurrent selection",async()=>{
    await save(body([{subjectId:5}]));
    const links=await active();
    await save(body([{subjectId:5}],{expectedAssignmentIds:links.map(r=>r.id)}));
    expect((await active()).map(r=>r.id)).toEqual(links.map(r=>r.id));
    await expect(save(body([]))).rejects.toMatchObject({statusCode:409});
    expect(await active()).toHaveLength(1);
  });
  it("serializes concurrent saves so only one can replace the original empty selection",async()=>{
    const outcomes=await Promise.allSettled([save(body([{subjectId:5}])),save(body([{subjectId:5}]))]);
    expect(outcomes.filter(o=>o.status==="fulfilled")).toHaveLength(1);
    expect((outcomes.find(o=>o.status==="rejected") as PromiseRejectedResult).reason.statusCode).toBe(409);
    expect(await active()).toHaveLength(1);
  });
  it("removes links without deleting history, timetables, marks or staffing grants",async()=>{
    await save(body([{subjectId:5,teacherId:6}]));
    const prior=(await active())[0];
    await save(body([],{expectedAssignmentIds:[prior.id]}));
    expect(await active()).toEqual([]);
    expect((await pool.query("SELECT status,employee_id FROM class_subjects WHERE id=$1",[prior.id])).rows[0])
      .toMatchObject({status:"INACTIVE",employee_id:6});
    expect((await pool.query("SELECT * FROM academic_timetable_entries")).rows).toEqual([{id:71,subject_id:5,teacher_employee_id:6}]);
    expect((await pool.query("SELECT * FROM preserved_marks")).rows).toEqual([{id:81,subject_id:5,score:79}]);
    expect((await pool.query("SELECT count(*)::int n FROM teacher_class_assignments WHERE status='ACTIVE'")).rows[0].n).toBe(2);
    expect((await pool.query(timetableSelectionSql,[1,2,3,4,5,6,"B"])).rowCount).toBe(0);
  });
  it("relinks an inactive subject without duplicate active links",async()=>{
    await save(body([])); // Explicitly remove staffing-only links.
    expect((await pool.query(timetableSelectionSql,[1,2,3,4,5,6,"B"])).rowCount).toBe(0);
    await save(body([{subjectId:5}]));
    expect(await active()).toHaveLength(1);
    expect((await pool.query(timetableSelectionSql,[1,2,3,4,5,6,"B"])).rowCount).toBe(1);
  });
  it("retains term-specific links while editing session-wide links",async()=>{
    await save(body([{subjectId:5,teacherId:6}],{termId:3}));
    const scoped=(await pool.query("SELECT * FROM class_subjects WHERE academic_term_id=3 AND status='ACTIVE'")).rows[0];
    await save(body([{subjectId:7,teacherId:8}]));
    expect((await pool.query("SELECT * FROM class_subjects WHERE id=$1",[scoped.id])).rows[0]).toEqual(scoped);
    expect((await pool.query(timetableSelectionSql,[1,2,3,4,5,6,"B"])).rowCount).toBe(1);
    expect((await pool.query(timetableSelectionSql,[1,2,9,4,5,6,"B"])).rowCount).toBe(0);
  });
  it("allows an unstaffed subject link but not a timetable without eligible staffing",async()=>{
    await pool.query("DELETE FROM teacher_class_assignments");
    await save(body([{subjectId:5}]));
    expect(await active()).toHaveLength(1);
    expect((await pool.query(timetableSelectionSql,[1,2,3,4,5,6,"B"])).rowCount).toBe(0);
  });
  it.each([15,17])("rejects foreign/inactive catalogue subject %s atomically",async subjectId=>{
    await expect(save(body([{subjectId:5},{subjectId}]))).rejects.toMatchObject({statusCode:404});
    expect(await active()).toEqual([]);
  });
  it.each([16,18,19])("rejects foreign, staff or inactive teacher %s",async teacherId=>{
    await expect(save(body([{subjectId:5,teacherId}]))).rejects.toMatchObject({statusCode:409});
    expect(await active()).toEqual([]);
  });
  it("explicitly assigns an active school teacher and reuses that assignment on repeated saves",async()=>{
    await save(body([{subjectId:5,teacherId:8}]));
    const assignment=(await pool.query(`SELECT * FROM teacher_class_assignments WHERE employee_id=8 AND subject_id=5`)).rows[0];
    expect(assignment).toMatchObject({school_id:1,school_class_id:4,academic_session_id:2,assignment_type:"SUBJECT_TEACHER",status:"ACTIVE"});
    expect((await pool.query(timetableSelectionSql,[1,2,3,4,5,8,"B"])).rowCount).toBe(1);
    const links=await active();
    await save(body([{subjectId:5,teacherId:8}],{expectedAssignmentIds:links.map(r=>r.id)}));
    expect((await pool.query(`SELECT * FROM teacher_class_assignments WHERE employee_id=8 AND subject_id=5`)).rows).toEqual([assignment]);
    expect((await pool.query(`SELECT count(*)::int n FROM teacher_class_assignments WHERE employee_id=8 AND subject_id=7`)).rows[0].n).toBe(1);
  });
  it("does not backdate an unassigned teacher into an ended session",async()=>{
    await pool.query("DELETE FROM teacher_class_assignments");
    await pool.query("UPDATE academic_sessions SET start_date=CURRENT_DATE-500,end_date=CURRENT_DATE-100 WHERE id=2");
    await expect(save(body([{subjectId:5,teacherId:8}]))).rejects.toMatchObject({statusCode:409});
    expect(await active()).toEqual([]);
    expect((await pool.query("SELECT * FROM teacher_class_assignments")).rows).toEqual([]);
  });
  it.each([{classId:14},{sessionId:12},{termId:13}])("rejects other-school scope %j",async extra=>{
    await expect(save(body([{subjectId:5}],extra))).rejects.toMatchObject({statusCode:404});
  });
  it("retains original teacher evidence when an eligible replacement is selected",async()=>{
    await pool.query(`INSERT INTO teacher_class_assignments(school_id,employee_id,academic_session_id,school_class_id,
      section,assignment_type,status,start_date) VALUES(1,8,2,4,'B','CLASS_TEACHER','ACTIVE','2026-09-01')`);
    await save(body([{subjectId:5,teacherId:6}]));
    const prior=(await active())[0];
    await save(body([{subjectId:5,teacherId:8}],{expectedAssignmentIds:[prior.id]}));
    expect((await pool.query("SELECT status,employee_id FROM class_subjects WHERE id=$1",[prior.id])).rows[0])
      .toMatchObject({status:"INACTIVE",employee_id:6});
    expect((await active()).map(r=>r.employee_id)).toEqual([8]);
  });
});
