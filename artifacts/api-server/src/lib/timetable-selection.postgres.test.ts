import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "@workspace/db";
import { timetableSelectionDiagnosticsSql } from "./timetable-selection-error";

// Opt-in, read-only Development evidence. Never creates or cleans up fixtures.
const enabled = process.env.TIMETABLE_QA_READONLY === "1";
describe.skipIf(!enabled)("timetable native Development assignment predicates", () => {
  const connect = () => pool.connect();
  let client: Awaited<ReturnType<typeof connect>>;
  const selected: unknown[] = [1496,386,27,580,11,205,"B"];
  const foreign: Record<string, number> = {};
  const source=readFileSync(new URL("../routes/academic-timetable.ts",import.meta.url),"utf8");
  const predicates=[...source.matchAll(/const valid = await client\.query\(\s*`([^`]+)`/g)].map(match=>match[1]);
  beforeAll(async()=>{
    client=await pool.connect();
    await client.query("BEGIN READ ONLY");
    const identity=(await client.query("SELECT current_database() name,inet_server_addr() host")).rows[0];
    if(identity.name!=="heliumdb"||identity.host!==null||process.env.REPLIT_DEPLOYMENT)throw Error("Not the verified local Development database");
    expect((await client.query("SELECT id FROM academic_sessions WHERE id=386 AND school_id=1496")).rowCount).toBe(1);
    for(const table of ["school_classes","subjects","employees","academic_sessions","academic_terms"]) {
      const record=(await client.query(`SELECT id FROM ${table} WHERE school_id<>1496 ORDER BY id LIMIT 1`)).rows[0];
      if(!record)throw Error(`No existing cross-school ${table} record for read-only regression`);
      foreign[table]=record.id;
    }
  });
  afterAll(async()=>{
    if(client){await client.query("ROLLBACK");client.release();}
    await pool.end();
  });
  it("executes both unchanged create and edit predicates for the valid QA selection",async()=>{
    expect(predicates).toHaveLength(2);
    for(const sql of predicates)expect((await client.query(sql,selected)).rowCount).toBe(1);
    const diagnostics=(await client.query(timetableSelectionDiagnosticsSql,selected)).rows[0];
    expect(Object.values(diagnostics).every(value=>value===true)).toBe(true);
  });
  it.each([
    ["school_classes",3,"class_valid"],["subjects",4,"subject_valid"],["employees",5,"teacher_valid"],
    ["academic_sessions",1,"session_valid"],["academic_terms",2,"term_valid"],
  ])("rejects an actual other-school %s ID in create and edit",async(table,index,key)=>{
    const values=[...selected];values[index]=foreign[table];
    for(const sql of predicates)expect((await client.query(sql,values)).rowCount).toBe(0);
    expect((await client.query(timetableSelectionDiagnosticsSql,values)).rows[0][key]).toBe(false);
  });
  it("rejects the concrete Maths/English-teacher mismatch and identifies assignment rather than ID",async()=>{
    const values=[...selected];values[5]=206;
    for(const sql of predicates)expect((await client.query(sql,values)).rowCount).toBe(0);
    const checks=(await client.query(timetableSelectionDiagnosticsSql,values)).rows[0];
    expect(checks.teacher_valid).toBe(true);
    expect(checks.subject_assignment_valid).toBe(true);
    expect(checks.teacher_assignment_valid).toBe(false);
  });
  it("rejects a stale section and preserves section-scoped assignments",async()=>{
    const values=[...selected];values[6]="NOT-ASSIGNED";
    for(const sql of predicates)expect((await client.query(sql,values)).rowCount).toBe(0);
    expect((await client.query(timetableSelectionDiagnosticsSql,values)).rows[0].subject_assignment_valid).toBe(false);
  });
});