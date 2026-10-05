import { describe, it, expect, vi, beforeEach } from "vitest";
const mock=vi.hoisted(()=>({query:vi.fn()}));
vi.mock("@workspace/db",()=>({pool:mock}));
vi.mock("../middlewares/auth",()=>({
  AuthError:class extends Error {constructor(public statusCode:number,message:string){super(message);}},
  getUserContext:(req:any)=>req.edupulseUser,
  assertSchoolOperationalAccess:()=>{},
}));
import { numericScore, previewResultImport, uploadBytes } from "./exam-record-import";
import { validateComponents, calculateGrade } from "./exam-record-results";
import { schoolRole, requireOperator, assignedTeacher, assertRevision } from "./exam-record-scope";
import { compileStudent } from "./result-compilation";
import { guardManagedLegacyResource } from "./exam-record-legacy-guard";
import { questionDocument } from "./exam-question-documents";
import { serializeReportExport } from "../routes/reporting/exports";
const component={key:"exam",label:"Exam",typeId:1,maxScore:100};
const req=(roles:any[])=>({edupulseUser:{user:{id:1},roles}}) as any;
const membership=(role:string,schoolId:number|null=1)=>({role,schoolId,status:"ACTIVE"});
const roster=[{studentId:10,studentName:"Unit Test",admissionNo:"T10"},{studentId:11,studentName:"Other Test",admissionNo:"T11"}];
const workbook=(rows:any[])=>serializeReportExport("xlsx",{title:"Unit test",columns:[
  {key:"id",label:"Student ID"},{key:"name",label:"Student Name"},{key:"score",label:"Exam"}],rows,total:rows.length}).body as Buffer;
beforeEach(()=>mock.query.mockReset());
describe("Exam/Record bounded entry and imports",()=>{
  it("keeps zero and decimal marks without treating blanks as zero",()=>{
    expect(numericScore(0,100)).toBe(0);expect(numericScore("9.25",10)).toBe(9.25);expect(numericScore("",10)).toBeNull();
  });
  it.each([true,-1,101,Infinity,NaN,"1e2","bad","1.234"])("rejects invalid mark %s",v=>expect(()=>numericScore(v,100)).toThrow());
  it("rejects duplicate columns, arbitrary types and changed revisions",()=>{
    expect(()=>validateComponents([component,component])).toThrow();
    expect(()=>validateComponents([{...component,typeId:0}])).toThrow();
    expect(()=>assertRevision(2,1)).toThrow();expect(()=>assertRevision(2,"2")).toThrow();
  });
  it("accepts both omitted and null identifiers for unsaved components, without accepting invalid saved identifiers",()=>{
    expect(validateComponents([{...component,assessmentId:null}])).toEqual([component]);
    expect(validateComponents([component])).toEqual([component]);
    expect(()=>validateComponents([{...component,assessmentId:0}])).toThrow();
  });
  it("uses the configured school scale and rejects overlaps",()=>{
    expect(calculateGrade(25,50,[{minScore:0,maxScore:59,grade:"C"}]).grade).toBe("C");
    expect(()=>calculateGrade(25,50,[{minScore:0,maxScore:60},{minScore:50,maxScore:100}])).toThrow();
  });
  it("reads exact roster identities and finite score cells from Excel",()=>{
    const preview=previewResultImport(workbook([{id:10,name:"Unit Test",score:85}]),"scores.xlsx",[component],roster);
    expect(preview.validCount).toBe(1);expect(preview.rows[0].scores.exam).toBe(85);expect(preview.missingStudents).toBe(1);
  });
  it("invalidates both duplicate occurrences and foreign identities",()=>{
    const preview=previewResultImport(workbook([{id:10,name:"Unit Test",score:85},{id:10,name:"Unit Test",score:90},{id:99,name:"Foreign",score:80}]),"scores.xlsx",[component],roster);
    expect(preview.validCount).toBe(0);expect(preview.invalidCount).toBe(3);
  });
  it("never guesses a renamed student or unreadable PDF",()=>{
    const preview=previewResultImport(workbook([{id:10,name:"Wrong Name",score:85}]),"scores.xlsx",[component],roster);
    expect(preview.rows[0].issues).toContain("Student name does not match the roster");
    expect(previewResultImport(Buffer.from("%PDF-1.4\nscanned"),"scores.pdf",[component],roster).uncertain).toBe(true);
  });
  it("bounds filenames and upload bytes; rejects legacy documents",()=>{
    expect(()=>uploadBytes({filename:"../scores.xlsx",dataBase64:"YQ=="})).toThrow();
    expect(()=>questionDocument({filename:"paper.doc",dataBase64:Buffer.from("binary").toString("base64")})).toThrow();
  });
});
describe("School and role boundaries (unit contexts, not browser acceptance)",()=>{
  it("keeps a dual-role Owner read-only",()=>{
    const r=req([membership("PLATFORM_OWNER",null),membership("SCHOOL_ADMIN"),membership("TEACHER")]);
    expect(schoolRole(r,1)).toBe("OWNER");expect(()=>requireOperator(r,1,"SCHOOL_ADMIN")).toThrow();
    expect(()=>requireOperator(r,1,"TEACHER")).toThrow();
  });
  it.each(["STUDENT","PARENT","DRIVER","ACCOUNTANT"])("denies private paper/entry surfaces to %s",role=>{
    expect(()=>schoolRole(req([membership(role)]),1)).toThrow();
  });
  it("denies another school's teacher",()=>expect(()=>schoolRole(req([membership("TEACHER",2)]),1)).toThrow());
  it("class-teacher appointment alone cannot authorize subject scores",async()=>{
    mock.query.mockResolvedValueOnce({rows:[{id:9}]}).mockResolvedValueOnce({rows:[]});
    await expect(assignedTeacher(req([membership("TEACHER")]),{schoolId:1,sessionId:2,termId:3,classId:4,section:"A",subjectId:5})).rejects.toThrow();
  });
});
describe("Consolidation completeness and legacy fencing",()=>{
  const scope={schoolId:1,sessionId:2,termId:3};
  const student={id:10,firstName:"Unit",lastName:"Test",classId:4,section:"A",studentClassAssignmentId:9};
  function client(assessmentIds:number[]) {return {query:vi.fn(async(sql:string)=>{
    if(sql.includes("WITH configured"))return {rows:[{subjectId:7,subjectName:"Math",teacherName:"Assigned Teacher"}]};
    if(sql.includes("FROM academic_results r"))return {rows:assessmentIds.map(id=>({id,assessmentId:id,subjectId:7,score:40,maxScore:50,status:"SUBMITTED",reviewStatus:"NOT_REVIEWED"}))};
    if(sql.includes("FROM academic_grading_rules"))return {rows:[{min_score:0,max_score:100,grade:"A"}]};
    if(sql.includes("FROM academic_result_batches"))return {rows:[{subject_id:7,status:"SUBMITTED",components:[{assessmentId:1},{assessmentId:2}]}]};
    return {rows:[{present:1,late:0,absent:0,total:1}]};
  })};}
  it("does not compile a partial submitted component set",async()=>{
    const result=await compileStudent(client([1]),scope,student);
    expect(result.complete).toBe(false);expect(result.average).toBeNull();expect(result.missingSubjects).toEqual(["Math"]);
  });
  it("compiles the complete set automatically using the school scale",async()=>{
    const result=await compileStudent(client([1,2]),scope,student);
    expect(result.complete).toBe(true);expect(result.average).toBe(80);expect(result.subjects[0].score).toBe(80);
  });
  it("serializes legacy writes before rejecting a managed sheet",async()=>{
    const c={query:vi.fn().mockResolvedValueOnce({rows:[{sessionId:2,termId:3,classId:4,section:"A",subjectId:7}]})
      .mockResolvedValueOnce({rows:[]}).mockResolvedValueOnce({rows:[{id:1}]})};
    await expect(guardManagedLegacyResource(c,1,"result",10)).rejects.toThrow("Exam/Record");
    expect(c.query.mock.calls[1][0]).toContain("pg_advisory_xact_lock");
  });
});
