import {describe,it,expect,vi} from "vitest";
import {validatePeriodDates,validateAcademicPeriod,parseCalendarBody} from "./academic-period-validation";

describe("school academic calendar validation",()=>{
  it.each([
    ["2026-02-30","2026-12-01"],["2026-13-01","2026-12-01"],["not-a-date","2026-12-01"],
    ["2026-12-02","2026-12-01"],["2026-1-01","2026-12-01"],
  ])("rejects invalid or reversed dates %s", (start,end)=>expect(()=>validatePeriodDates(start,end)).toThrow());
  it("accepts exact configurable dates including leap day",()=>expect(()=>validatePeriodDates("2028-02-29","2028-06-12")).not.toThrow());
  it("rejects February 30 before date coercion",()=>expect(()=>parseCalendarBody({parse:vi.fn()},{startDate:"2026-02-30"})).toThrow());
  it("accepts the existing forms' exact midnight UTC serialization",()=>{
    const schema={parse:vi.fn(v=>v)};
    expect(parseCalendarBody(schema,{startDate:"2026-09-01T00:00:00.000Z"})).toEqual({startDate:"2026-09-01T00:00:00.000Z"});
  });
  it("rejects impossible dates even in midnight UTC serialization",()=>expect(()=>parseCalendarBody({parse:vi.fn()},{startDate:"2026-02-30T00:00:00.000Z"})).toThrow());
  it("supports generated Date objects without changing valid dates",async()=>await expect(validateAcademicPeriod(client(),1,{startDate:new Date("2026-09-01"),endDate:new Date("2026-12-01")})).resolves.toBeUndefined());
  const client=(overlap=false)=>({query:vi.fn(async(sql:string)=>({rows:sql.includes("FROM academic_sessions")?
    [{start_date:"2026-09-01",end_date:"2027-07-31",status:"ACTIVE",is_current:true}]:
    sql.includes("AND id<>")&&overlap ? [{id:4}] : []}))});
  it("rejects a term outside its session",async()=>await expect(validateAcademicPeriod(client(),1,{startDate:"2026-08-01",endDate:"2026-12-01"},{},3)).rejects.toThrow("within"));
  it("rejects an implicit overlap",async()=>await expect(validateAcademicPeriod(client(true),1,{startDate:"2026-09-01",endDate:"2026-12-01"},{},3)).rejects.toThrow("Explicitly"));
  it("accepts only explicitly explained overlaps",async()=>await expect(validateAcademicPeriod(client(true),1,{startDate:"2026-09-01",endDate:"2026-12-01",allowOverlap:true,overlapReason:"Intentional school arrangement"},{},3)).resolves.toBeUndefined());
  it("refuses to activate a closed period",async()=>await expect(validateAcademicPeriod(client(),1,{startDate:"2026-09-01",endDate:"2026-12-01",isCurrent:true,status:"COMPLETED"})).rejects.toThrow("active"));
  it("serializes changes by school before checking calendar state",async()=>{
    const db=client();await validateAcademicPeriod(db,19,{startDate:"2026-09-01",endDate:"2026-12-01"});
    expect(db.query.mock.calls[0][0]).toContain("pg_advisory_xact_lock");
  });
});