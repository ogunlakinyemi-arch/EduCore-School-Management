import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import type { ReportContext, ReportFilters } from "./core";

const state = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: { query: state.query } }));
import { reportFilterOptions } from "./filter-options";

let root: string;
const port = "55487";
function sql(text: string) {
  return execFileSync("psql", ["-X", "-h", root, "-p", port, "-U", "postgres", "-d", "postgres", "-At", "-v", "ON_ERROR_STOP=1", "-c", text], { encoding: "utf8" }).trim();
}
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "educore-report-options-"));
  execFileSync("initdb", ["-D", join(root, "data"), "-U", "postgres", "-A", "trust", "--no-locale"], { stdio: "pipe" });
  execFileSync("pg_ctl", ["-D", join(root,"data"), "-l", join(root,"server.log"), "-o", `-k ${root} -p ${port} -h ''`, "-w", "start"], { stdio: "pipe" });
  sql(`
    CREATE TABLE students(id int,school_id int,first_name text,last_name text,admission_no text,status text);
    CREATE TABLE parent_student_relationships(parent_id int,student_id int,status text);
    CREATE TABLE employees(id int,school_id int,user_id int,employment_status text);
    CREATE TABLE student_class_assignments(student_id int,school_id int,academic_session_id int,academic_term_id int,school_class_id int,section text);
    CREATE TABLE teacher_class_assignments(employee_id int,school_id int,academic_session_id int,school_class_id int,section text,status text);
    CREATE TABLE academic_sessions(id int,school_id int,name text);
    CREATE TABLE academic_terms(id int,school_id int,academic_session_id int,name text);
    CREATE TABLE school_classes(id int,school_id int,name text,section text);
    CREATE TABLE subjects(id int,school_id int,name text);
    CREATE TABLE class_subjects(subject_id int,school_id int,school_class_id int,academic_session_id int);
    CREATE TABLE academic_results(school_id int,student_id int,status text);
    CREATE TABLE nfc_cards(school_id int,student_id int,status text);
    CREATE TABLE attendance_events(school_id int,student_id int,attendance_status text,identification_method text);
    CREATE TABLE fee_invoices(id int,school_id int,student_id int,status text);
    CREATE TABLE fee_payments(school_id int,invoice_id int,status text,method text);
    INSERT INTO students VALUES (1,10,'Child','One','A1','ACTIVE'),(2,10,'Other','Child','A2','ACTIVE'),(3,20,'Foreign','Child','B1','ACTIVE');
    INSERT INTO parent_student_relationships VALUES (51,1,'ACTIVE'),(51,2,'INACTIVE'),(52,2,'ACTIVE');
    INSERT INTO employees VALUES (8,10,77,'ACTIVE');
    INSERT INTO teacher_class_assignments VALUES(8,10,100,11,'Blue','ACTIVE');
    INSERT INTO academic_sessions VALUES(100,10,'Current'),(101,10,'Past'),(200,20,'Foreign year');
    INSERT INTO academic_terms VALUES(1001,10,100,'First'),(1002,10,101,'Second'),(2001,20,200,'Foreign term');
    INSERT INTO school_classes VALUES(11,10,'Class One','Blue'),(12,10,'Class Two','Red'),(21,20,'Foreign Class','Blue');
    INSERT INTO student_class_assignments VALUES(1,10,100,1001,11,'Blue'),(2,10,101,1002,12,'Red'),(3,20,200,2001,21,'Blue');
    INSERT INTO subjects VALUES(31,10,'Math'),(32,10,'Art'),(41,20,'Foreign subject');
    INSERT INTO class_subjects VALUES(31,10,11,100),(32,10,12,101),(41,20,21,200);
    INSERT INTO academic_results VALUES(10,1,'PUBLISHED'),(10,2,'DRAFT'),(20,3,'REVIEWED');
    INSERT INTO nfc_cards VALUES(10,1,'ACTIVE'),(20,3,'REVOKED');
    INSERT INTO attendance_events VALUES(10,1,'PRESENT','NFC'),(10,2,'ABSENT','MANUAL'),(20,3,'LATE','NFC');
    INSERT INTO fee_invoices VALUES(51,10,1,'PAID'),(52,10,2,'UNPAID'),(53,20,3,'CANCELLED');
    INSERT INTO fee_payments VALUES(10,51,'SUCCESS','CARD'),(10,52,'PENDING','BANK_TRANSFER'),(20,53,'FAILED','CASH');
  `);
  state.query.mockImplementation(async (text: string, values: unknown[]) => {
    // Only internally supplied integer/boolean/null fixture parameters are accepted.
    const bound = text.replace(/\$(\d+)/g, (_, index) => {
      const value = values[Number(index)-1];
      if (value === null) return "NULL";
      if (typeof value === "boolean") return String(value);
      if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error("Unexpected fixture parameter");
      return String(value);
    });
    return { rows: JSON.parse(sql(`SELECT COALESCE(json_agg(q),'[]') FROM (${bound}) q`)) };
  });
}, 30_000);
afterAll(() => {
  if (root) {
    try { execFileSync("pg_ctl", ["-D",join(root,"data"),"-m","immediate","-w","stop"], { stdio:"pipe" }); }
    finally { rmSync(root,{recursive:true,force:true}); }
  }
});
const context = (role: ReportContext["role"], extras: Partial<ReportContext> = {}): ReportContext =>
  ({ req: {} as Request, userId:77, schoolId:10, role, ...extras });
const filters = { limit:50,offset:0 } as ReportFilters;
const keys = ["sessionId","termId","classId","section","subjectId","studentId","status"];
const values = (result: Awaited<ReturnType<typeof reportFilterOptions>>, key: string) => result.options[key].map(option => option.value);

describe("report choices executed in disposable PostgreSQL (never application DB)", () => {
  it("scopes Admin catalogs and observed statuses to the authorized school", async () => {
    const result = await reportFilterOptions(context("ADMIN"),filters,"academics",keys);
    expect(values(result,"sessionId").sort()).toEqual(["100","101"]);
    expect(values(result,"studentId").sort()).toEqual(["1","2"]);
    expect(values(result,"status").sort()).toEqual(["DRAFT","PUBLISHED"]);
    expect(values(result,"subjectId").sort()).toEqual(["31","32"]);
  });
  it.each(["PARENT","STUDENT","TEACHER"] as const)("does not expose unrelated pupils, classes or subjects to %s", async role => {
    const result = await reportFilterOptions(context(role, role==="PARENT"?{parentId:51}:role==="STUDENT"?{studentId:1}:{}),filters,"academics",keys);
    expect(values(result,"studentId")).toEqual(["1"]);
    expect(values(result,"classId")).toEqual(["11"]);
    expect(values(result,"subjectId")).toEqual(["31"]);
    expect(values(result,"status")).toEqual(["PUBLISHED"]);
  });
  it("narrows terms, classes, sections and students using real parent selections", async () => {
    const result = await reportFilterOptions(context("ADMIN"),{...filters,sessionId:100,classId:11},"academics",keys);
    expect(values(result,"termId")).toEqual(["1001"]);
    expect(values(result,"classId")).toEqual(["11"]);
    expect(values(result,"section")).toEqual(["Blue"]);
    expect(values(result,"studentId")).toEqual(["1"]);
  });
  it("supports Owner network statuses without disclosing ambiguous cross-school catalogs", async () => {
    const result = await reportFilterOptions(context("OWNER",{schoolId:null}),filters,"academics",keys);
    expect(values(result,"status").sort()).toEqual(["DRAFT","PUBLISHED","REVIEWED"]);
    expect(values(result,"studentId")).toEqual([]);
    expect(result.requiresSchool).toBe(true);
  });
  it("does not query or return keys absent from the report's authorized filter list", async () => {
    const result = await reportFilterOptions(context("ADMIN"),filters,"overview",[]);
    expect(result.options).toEqual({});
  });
  it("keeps family finance status and payment method options within linked invoices", async () => {
    const result=await reportFilterOptions(context("PARENT",{parentId:51}),filters,"finance-payments",["status","method"]);
    expect(values(result,"status")).toEqual(["SUCCESS"]);
    expect(values(result,"method")).toEqual(["CARD"]);
  });
  it("uses NFC card statuses, not unrelated device statuses", async () => {
    const result=await reportFilterOptions(context("ADMIN"),filters,"nfc",["status"]);
    expect(values(result,"status").sort()).toEqual(["ABSENT","ACTIVE","PRESENT"]);
  });
  it("preserves the existing computed OVERDUE loan enum without listing pupils in Teacher personal loans", async () => {
    const result=await reportFilterOptions(context("TEACHER"),filters,"library-loans",["studentId","status"]);
    expect(values(result,"studentId")).toEqual([]);
    expect(values(result,"status").sort()).toEqual(["LOST","OPEN","OVERDUE","RETURNED"]);
  });
});
