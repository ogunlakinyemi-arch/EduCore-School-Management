import { describe, expect, it, vi } from "vitest";
import { attendanceScheduleSchema, defaultAttendanceSchedule, schoolClock,
  attendanceDayOpen, decideGateTransition, readAttendanceSchedule } from "./attendance-schedule";
import { assessAttendanceDay } from "./attendance-assessment";
const defaults = () => structuredClone(defaultAttendanceSchedule);
const at = (time: string, date = "2026-10-22") => new Date(`${date}T${time}:00+01:00`);
const transition = (overrides: Partial<Parameters<typeof decideGateTransition>[0]> = {}) =>
  decideGateTransition({ mode: "ENTRY_EXIT", requested: "SCHOOL_AUTO", latest: null,
    occurredAt: at("07:00"), schedule: defaults(), hasLaterEvent: false, ...overrides });

describe("attendance policy and combined reader (pure, no providers)", () => {
  it("has the requested Nigerian school defaults, including the Friday exception", () => {
    const s = defaults();
    expect(attendanceScheduleSchema.parse(s)).toEqual(s);
    expect([s.timezone,s.arrivalStart,s.arrivalEnd,s.lateCutoff,s.absenceAssessment,
      s.weekdaysClosing,s.missingTagOutStart,s.missingTagOutEnd,s.fridayClosing,s.fridayMissingTagOut])
      .toEqual(["Africa/Lagos","06:45","07:45","08:00","10:00","14:00","14:00","16:00","13:00","14:00"]);
  });
  it.each([
    { timezone: "not/a/timezone" }, { operatingDays: [1,1] }, { arrivalStart: "25:00" },
    { lateCutoff: "06:00" }, { weekdaysClosing: "09:00" }, { missingTagOutEnd: "12:00" },
    { duplicateSeconds: 0 }, { closures: [{date:"2026-02-30",reason:"Holiday"}] },
    { exemptions:[{studentId:1,from:"2026-10-23",to:"2026-10-22",reason:"Leave"}] },
  ])("rejects invalid or contradictory configuration %j", bad => {
    expect(attendanceScheduleSchema.safeParse({...defaults(),...bad}).success).toBe(false);
  });
  it("uses school-local date across UTC midnight and supports other timezones", () => {
    expect(schoolClock(new Date("2026-10-22T23:30:00Z"),"Africa/Lagos"))
      .toEqual({date:"2026-10-23",time:"00:30",weekday:5});
    expect(schoolClock(new Date("2026-10-22T23:30:00Z"),"America/New_York").date).toBe("2026-10-22");
  });
  it("suppresses assessments on holidays, weekends and scoped exemptions", () => {
    const s=defaults();s.closures=[{date:"2026-10-22",reason:"School closure"}];
    expect(attendanceDayOpen(s,"2026-10-22",4,1)).toBe(false);
    expect(attendanceDayOpen(s,"2026-10-24",6,1)).toBe(false);
    s.exemptions=[{studentId:1,from:"2026-10-23",to:"2026-10-23",reason:"Approved leave"}];
    expect(attendanceDayOpen(s,"2026-10-23",5,1)).toBe(false);
    expect(attendanceDayOpen(s,"2026-10-23",5,2)).toBe(true);
  });
  it("records first entry and classifies exact late cutoff without treating 07:45 grace as late", () => {
    expect(transition().eventType).toBe("SCHOOL_ENTRY");
    expect(transition({occurredAt:at("07:45")}).status).toBe("PRESENT");
    expect(transition({occurredAt:at("08:00")}).status).toBe("LATE");
  });
  it("does not blindly turn a repeat morning tag-in into an exit", () => {
    expect(()=>transition({latest:{eventType:"SCHOOL_ENTRY",occurredAt:at("07:00")},
      occurredAt:at("07:10")})).toThrow(/Early exit/);
  });
  it("supports controlled exits after closing, including Friday", () => {
    expect(transition({latest:{eventType:"SCHOOL_ENTRY",occurredAt:at("07:00")},
      occurredAt:at("14:00")}).eventType).toBe("SCHOOL_EXIT");
    expect(transition({latest:{eventType:"SCHOOL_ENTRY",occurredAt:at("07:00","2026-10-23")},
      occurredAt:at("13:00","2026-10-23")}).eventType).toBe("SCHOOL_EXIT");
  });
  it("rejects duplicates, stale state, disabled entry and unapproved re-entry", () => {
    expect(()=>transition({latest:{eventType:"SCHOOL_ENTRY",occurredAt:at("07:00")},
      occurredAt:new Date(at("07:00").getTime()+10_000)})).toThrow(/Duplicate/);
    expect(()=>transition({hasLaterEvent:true})).toThrow(/Out-of-order/);
    const s=defaults();s.rules.entryEnabled=false;
    expect(()=>transition({schedule:s})).toThrow(/disabled/);
    expect(()=>transition({latest:{eventType:"SCHOOL_EXIT",occurredAt:at("14:00")},
      occurredAt:at("15:00")})).toThrow(/re-entry/);
  });
  it("keeps fixed direction readers fixed and permits an explicit early-exit rule", () => {
    expect(()=>transition({mode:"ENTRY",requested:"SCHOOL_EXIT"})).toThrow(/conflicts/);
    expect(transition({mode:"EXIT",requested:"SCHOOL_EXIT"}).eventType).toBe("SCHOOL_EXIT");
    const s=defaults();s.rules.allowEarlyExit=true;
    expect(transition({schedule:s,latest:{eventType:"SCHOOL_ENTRY",occurredAt:at("07:00")},
      occurredAt:at("08:00")}).eventType).toBe("SCHOOL_EXIT");
  });
  it("fails explicitly for a corrupted retained policy rather than silently using defaults",async()=>{
    await expect(readAttendanceSchedule({query:async()=>({rows:[{metadata:{schedule:{},revision:1}}]})},1))
      .rejects.toThrow(/invalid/);
  });
});

function fixture(schedule=defaults()) {
  const notices=vi.fn(async(_db: unknown,_input: any)=>{});
  const events: Record<number,any[]>={};
  const reviews=new Set<string>();
  const query=vi.fn(async(sql:string,values:any[]=[])=>{
    if(sql.includes("SELECT metadata"))return {rows:[{metadata:{schedule,revision:1}}]};
    if(sql.includes("SELECT id FROM students"))return {rows:[{id:11},{id:12}].filter(s=>s.id>values[1])};
    if(sql.includes('attendance_status AS status'))return {rows:events[values[1]]??[]};
    if(sql.includes("INSERT INTO attendance_discrepancies")) {
      const key=`${values[0]}:${values[1]}:${values[3]}:${values[5]}`;
      if(reviews.has(key))return {rows:[]};
      reviews.add(key);return {rows:[{id:reviews.size}]};
    }
    return {rows:[]};
  });
  return {db:{query},query,notices,events,reviews};
}
describe("scheduled reviews with mocked persistence (no school data or sends)",()=>{
  it("creates no absence before 10:00, and repeats create no duplicate reviews or messages",async()=>{
    const f=fixture();
    expect((await assessAttendanceDay(f.db,1,at("09:59"),0,f.notices)).created).toBe(0);
    expect((await assessAttendanceDay(f.db,1,at("10:00"),0,f.notices)).created).toBe(2);
    expect((await assessAttendanceDay(f.db,1,at("10:01"),0,f.notices)).created).toBe(0);
    expect(f.notices).toHaveBeenCalledTimes(2);
    expect(f.notices.mock.calls[0]?.[1]).toEqual(expect.objectContaining({subject:"Attendance needs review"}));
    expect(f.query.mock.calls.some(([sql])=>sql.includes("INSERT INTO attendance_events"))).toBe(false);
  });
  it("uses Friday review at 14:00, never infers physical absence from missing exit",async()=>{
    const f=fixture();
    f.events[11]=[{id:1,eventType:"SCHOOL_ENTRY",status:"PRESENT",method:"NFC"}];
    f.events[12]=[{id:2,eventType:"CLASSROOM_ENTRY",status:"ABSENT",method:"MANUAL"}];
    const before=await assessAttendanceDay(f.db,1,at("13:59","2026-10-23"),0,f.notices);
    expect(before.created).toBe(1); // Classroom review only, never approved absence.
    const after=await assessAttendanceDay(f.db,1,at("14:00","2026-10-23"),0,f.notices);
    expect(after.created).toBe(1);
    const missing=f.notices.mock.calls.map(c=>c[1]).find((n:any)=>n.eventKey.endsWith("MISSING_TAG_OUT"));
    expect(missing?.body).toContain("location is unknown, not absent");
  });
  it("does not assess closures, exempt students, or send when notifications are disabled",async()=>{
    const s=defaults();s.closures=[{date:"2026-10-22",reason:"Holiday"}];
    const f=fixture(s);
    expect((await assessAttendanceDay(f.db,1,at("15:00"),0,f.notices)).reviewed).toBe(0);
    s.closures=[];s.exemptions=[{studentId:11,from:"2026-10-22",to:"2026-10-22",reason:"Leave"}];
    s.rules.notifications=false;
    expect((await assessAttendanceDay(f.db,1,at("15:00"),0,f.notices)).reviewed).toBe(1);
    expect(f.notices).not.toHaveBeenCalled();
  });
  it("resolves only owned open reviews when late evidence arrives and scopes locks/queries by tenant",async()=>{
    const f=fixture();f.events[11]=[{id:1,eventType:"SCHOOL_ENTRY",status:"PRESENT",method:"NFC"},
      {id:2,eventType:"SCHOOL_EXIT",status:"PRESENT",method:"NFC"}];
    await assessAttendanceDay(f.db,2,at("15:00"),0,f.notices);
    const update=f.query.mock.calls.find(([sql])=>sql.includes("UPDATE attendance_discrepancies"))!;
    expect(update[0]).toContain("status='OPEN'");
    expect(update[0]).toContain("source'='SCHOOL_SCHEDULE'");
    expect(update[1]?.slice(0,5)).toEqual([2,11,"2026-10-22",true,true]);
    expect(f.query.mock.calls.some(([,v])=>v?.[0]==="attendance-state:2:11:2026-10-22")).toBe(true);
  });
});
