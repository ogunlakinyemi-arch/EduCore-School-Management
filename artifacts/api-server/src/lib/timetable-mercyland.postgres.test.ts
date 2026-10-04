import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import { timetableSelectionSql } from "./timetable-selection-sql";
import { timetableSelectionDiagnosticsSql } from "./timetable-selection-error";

describe.skipIf(process.env.TIMETABLE_QA_READONLY !== "1")("actual Mercyland timetable assignment authorization", () => {
  const connect = () => pool.connect();
  let client: Awaited<ReturnType<typeof connect>>;
  const biology = [1393,358,20,571,15,183,"Science"];
  beforeAll(async () => {
    client=await pool.connect(); await client.query("BEGIN READ ONLY");
    const identity=(await client.query("SELECT current_database() name,inet_server_addr() host")).rows[0];
    if(process.env.REPLIT_DEPLOYMENT || identity.name!=="heliumdb" || identity.host!==null) throw Error("Not local Development");
    expect((await client.query("SELECT id FROM schools WHERE id=1393 AND code='MEL'")).rowCount).toBe(1);
    expect((await client.query("SELECT id FROM class_subjects WHERE school_id=1393")).rowCount).toBe(0);
  });
  afterAll(async()=>{if(client){await client.query("ROLLBACK");client.release();} await pool.end();});
  it("accepts existing Biology/Science teaching assignment without writing duplicate enrollment",async()=>{
    expect((await client.query(timetableSelectionSql,biology)).rowCount).toBe(1);
    expect(Object.values((await client.query(timetableSelectionDiagnosticsSql,biology)).rows[0]).every(Boolean)).toBe(true);
  });
  it("accepts the existing English/Prep1/A teaching assignment",async()=>{
    expect((await client.query(timetableSelectionSql,[1393,358,20,538,6,183,"A"])).rowCount).toBe(1);
  });
  it.each([
    ["subject on wrong class",4,6],["wrong section",6,"Commercial"],["other-school teacher",5,205],
    ["other-school subject",4,11],["other-school class",3,580],["other-school session",1,386],
    ["other-school term",2,27],
  ])("rejects %s",async(_label,index,value)=>{
    const params=[...biology];params[index as number]=value;
    expect((await client.query(timetableSelectionSql,params)).rowCount).toBe(0);
  });
  it("does not introduce Mathematics through a class-teacher-only Commercial assignment",async()=>{
    const params=[1393,358,20,573,5,183,"Commercial"];
    expect((await client.query(timetableSelectionSql,params)).rowCount).toBe(0);
    expect((await client.query(timetableSelectionDiagnosticsSql,params)).rows[0].subject_assignment_valid).toBe(false);
  });
  // SELECT-only CTEs exercise explicit-enrollment precedence without inserting,
  // updating, or deleting even temporary fixture rows in the school database.
  it.each(["INACTIVE","ACTIVE"])("does not override an explicit %s enrollment for a different term",async(status)=>{
    const restricted=`WITH class_subjects AS (
      SELECT $1::integer school_id,$2::integer academic_session_id,$4::integer school_class_id,
        $5::integer subject_id,999999::integer academic_term_id,$7::text section,
        NULL::integer employee_id,$8::text status
    ) ${timetableSelectionSql}`;
    expect((await client.query(restricted,[...biology,status])).rowCount).toBe(0);
  });
});