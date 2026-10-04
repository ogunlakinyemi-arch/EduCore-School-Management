import {beforeEach,describe,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({children:[{studentId:730,schoolId:1393}],placement:[] as any[],teachers:[] as any[],calls:[] as any[]}));
vi.mock("@workspace/db",()=>({pool:{query:vi.fn(async(sql:string,values:any[])=>{
  state.calls.push({sql,values});
  if(sql.includes("FROM parents p"))return{rows:state.children.filter(c=>c.studentId===values[1])};
  if(sql.includes("FROM students st"))return{rows:state.placement};
  if(sql.includes("FROM teacher_class_assignments t"))return{rows:state.teachers};
  throw Error("Unexpected scoped context query");
})}}));
import {parentChildAcademicContext,currentChildPlacementSql,currentClassTeacherSql} from "./parent-child-academic-context";
const placement={sessionId:358,termId:20,classId:538,className:"Prep 1",section:"A",sessionName:"2026/2027",termName:"FIRST"};
beforeEach(()=>{state.children=[{studentId:730,schoolId:1393}];state.placement=[placement];state.teachers=[];state.calls=[];});
describe("authorized parent child academic context",()=>{
  it("resolves canonical linked student ID before considering enrollment",async()=>{
    expect(await parentChildAcademicContext(914,730,1393)).toMatchObject({studentId:730,schoolId:1393,enrollment:placement,classTeacher:null});
    expect(state.calls[0].values).toEqual([914,730]);
  });
  it("returns an empty placement for an existing linked child instead of student404",async()=>{
    state.placement=[];expect(await parentChildAcademicContext(914,730)).toMatchObject({enrollment:null,classTeacher:null});
  });
  it("rejects unrelated, parent-user and admission-number identifiers",async()=>{
    for(const id of[773,914,2147483647]) await expect(parentChildAcademicContext(914,id)).rejects.toMatchObject({statusCode:404});
  });
  it("rejects a school parameter inconsistent with the linked child",async()=>{
    await expect(parentChildAcademicContext(914,730,1496)).rejects.toMatchObject({statusCode:404});
    expect(state.calls).toHaveLength(1);
  });
  it("uses child-specific scope when switching between children in different schools",async()=>{
    state.children.push({studentId:12,schoolId:1496});
    await parentChildAcademicContext(914,730);await parentChildAcademicContext(914,12);
    expect(state.calls.filter(c=>c.sql.includes("FROM students st")).map(c=>c.values)).toEqual([[730,1393],[12,1496]]);
  });
  it("rejects ambiguous current enrollment instead of picking historical or arbitrary rows",async()=>{
    state.placement=[placement,placement];await expect(parentChildAcademicContext(914,730)).rejects.toMatchObject({statusCode:409});
  });
  it("returns only authorized safe class-teacher fields",async()=>{
    state.teachers=[{employeeId:183,name:"Current Teacher"}];
    expect((await parentChildAcademicContext(914,730)).classTeacher).toEqual({employeeId:183,name:"Current Teacher"});
    expect(state.calls.at(-1).values).toEqual([1393,358,538,"A"]);
  });
  it("deduplicates a teacher with overlapping current authorized scopes",async()=>{
    state.teachers=[{employeeId:183,name:"Teacher"},{employeeId:183,name:"Teacher"}];
    expect((await parentChildAcademicContext(914,730)).classTeacher?.employeeId).toBe(183);
  });
  it("rejects conflicting teacher assignments rather than disclosing the wrong teacher",async()=>{
    state.teachers=[{employeeId:183,name:"A"},{employeeId:184,name:"B"}];
    await expect(parentChildAcademicContext(914,730)).rejects.toMatchObject({statusCode:409});
  });
  it("resolves legacy profiles only when no authoritative enrollment history exists",()=>{
    expect(currentChildPlacementSql).toContain("NOT EXISTS(SELECT 1 FROM student_class_assignments history");
    expect(currentChildPlacementSql).toContain("at.is_current=true");
    expect(currentChildPlacementSql).toContain("a.academic_term_id=at.id");
  });
  it("does not substitute an old profile section for an explicit current enrollment",()=>{
    expect(currentChildPlacementSql).toContain("WHEN a.id IS NOT NULL THEN COALESCE(a.section,c.section,'')");
  });
  it("never treats a subject teacher or historical assignment as current class teacher",()=>{
    expect(currentClassTeacherSql).toContain("t.assignment_type='CLASS_TEACHER'");
    expect(currentClassTeacherSql).toContain("t.start_date<=CURRENT_DATE");
    expect(currentClassTeacherSql).toContain("t.end_date>=CURRENT_DATE");
  });
});