/** AUTHORED, NOT EXECUTED. Transaction protocol mocks are not PostgreSQL proof. */
import {it,expect} from "vitest";
import {rolloverSchoolCalendar} from "./academic-calendar-rollover";
import {createCalendarRolloverTick} from "./academic-calendar-rollover-worker";
import {calendarFixture} from "./academic-calendar-rollover.test-support";
function fixture(){
 const data={...calendarFixture(),ledger:[] as any[],audits:[] as any[]};
 const calls:Array<{sql:string;values:any[]}>=[];
 let baseline:any=null,serial=0;
 const controls={schema:true,locked:true,school:true,failAudit:false,commitLost:false,
  days:["2027-01-18"],beforeRead:null as null|(()=>void)};
 const guards=[
  ...["academic_sessions","academic_terms"].flatMap(relname=>[
   {relname,tgname:"academic_calendar_write_gate",proname:"guard_academic_calendar_write_gate",tgtype:30},
   {relname,tgname:"academic_calendar_current_scope",proname:"guard_academic_calendar_current_scope",tgtype:31}]),
  {relname:"academic_calendar_rollovers",tgname:"academic_calendar_rollover_history",proname:"guard_academic_calendar_rollover_history",tgtype:27},
  {relname:"academic_calendar_rollovers",tgname:"academic_calendar_rollover_truncate",proname:"guard_academic_calendar_rollover_history",tgtype:34},
 ];
 const client={release(){},async query(sql:string,values:any[]=[]):Promise<{rows:any[]}>{
  calls.push({sql,values});const rows=(value:any[])=>({rows:value});
  if(sql==="BEGIN"){baseline=structuredClone(data);return rows([]);}
  if(sql==="ROLLBACK"){if(baseline)Object.assign(data,baseline);baseline=null;return rows([]);}
  if(sql==="COMMIT"){baseline=null;if(controls.commitLost){controls.commitLost=false;throw Error("Fictional lost commit response");}return rows([]);}
  if(sql.startsWith("SET LOCAL")||sql.includes("pg_advisory_xact_lock(1946482034"))return rows([]);
  if(sql.includes("to_regclass"))return rows([{ready:controls.schema}]);
  if(sql.includes("FROM pg_trigger"))return rows(guards);
  if(sql.includes("FROM pg_index"))return rows(["academic_sessions_one_current_school","academic_terms_one_current_school"]
   .map(relname=>({relname,indisunique:true,indisvalid:true,definition:"CREATE UNIQUE INDEX x ON t (school_id)",predicate:"is_current"})));
  if(sql.includes("pg_try_advisory"))return rows([{locked:controls.locked}]);
  if(sql.includes("SELECT id FROM schools WHERE id="))return rows(controls.school?[{id:values[0]}]:[]);
  if(sql.includes("SELECT id FROM schools WHERE upper"))return rows([{id:1},{id:2}]);
  if(sql.includes('FROM academic_sessions WHERE school_id=')){controls.beforeRead?.();controls.beforeRead=null;
   return rows(structuredClone(data.sessions.filter(s=>s.schoolId===values[0])));}
  if(sql.includes("FROM academic_terms WHERE school_id="))return rows(structuredClone(data.terms.filter(t=>t.schoolId===values[0])));
  if(sql.includes("AS today"))return rows([{today:controls.days.length>1?controls.days.shift():controls.days[0]}]);
  if(sql.startsWith("UPDATE academic_")){
   const period=(sql.includes("UPDATE academic_terms")?data.terms:data.sessions).find(p=>p.id===values[0]&&p.schoolId===values[1]
    &&p.status===values[4]&&p.isCurrent===values[5]);if(!period)return rows([]);
   Object.assign(period,{status:values[2],isCurrent:values[3],updatedAt:String(++serial)});return rows([{id:period.id}]);
  }
  if(sql.includes("INSERT INTO academic_calendar_rollovers")){
   if(data.ledger.some(r=>r.key===values[2]))return rows([]);
   const id=data.ledger.length+1;data.ledger.push({id,key:values[2],changes:JSON.parse(values[8]),snapshot:JSON.parse(values[10])});
   return rows([{id}]);
  }
  if(sql.includes("INSERT INTO audit_logs")){if(controls.failAudit)throw Error("Fictional audit failure");data.audits.push(values);return rows([]);}
  throw Error(`Unexpected fixture SQL: ${sql}`);
 }};
 return {data,calls,controls,guards,pool:{connect:async()=>client}};
}
it("performs a scoped activation, retaining exact before images and closing the previous term",async()=>{
 const f=fixture();f.data.terms[0].status="ACTIVE";f.data.terms[0].isCurrent=true;
 const result=await rolloverSchoolCalendar(f.pool,1);expect(result.status).toBe("READY");
 expect(f.data.terms[0]).toMatchObject({status:"INACTIVE",isCurrent:false});
 expect(f.data.terms[1]).toMatchObject({status:"ACTIVE",isCurrent:true});
 expect(f.data.ledger[0].snapshot.terms[0].isCurrent).toBe(true);
 expect(f.data.audits).toHaveLength(1);
 expect(f.calls.filter(c=>c.sql.startsWith("UPDATE")).every(c=>c.sql.includes("school_id=$2")&&c.values[1]===1)).toBe(true);
});
it("does not duplicate transitions or audits on repeated or restarted calls",async()=>{
 const f=fixture();await rolloverSchoolCalendar(f.pool,1);const count=f.calls.filter(c=>c.sql.startsWith("UPDATE")).length;
 expect((await rolloverSchoolCalendar(f.pool,1)).status).toBe("UNCHANGED");
 expect(f.data.ledger).toHaveLength(1);expect(f.data.audits).toHaveLength(1);
 expect(f.calls.filter(c=>c.sql.startsWith("UPDATE"))).toHaveLength(count);
});
it("recovers after a committed transition response is lost without duplicating the transition",async()=>{
 const f=fixture();f.controls.commitLost=true;
 await expect(rolloverSchoolCalendar(f.pool,1)).rejects.toThrow("lost commit response");
 expect((await rolloverSchoolCalendar(f.pool,1)).status).toBe("UNCHANGED");expect(f.data.ledger).toHaveLength(1);
});
it("rolls calendar and ledger back if the public audit cannot be retained",async()=>{
 const f=fixture(),before=structuredClone(f.data);f.controls.failAudit=true;
 await expect(rolloverSchoolCalendar(f.pool,1)).rejects.toThrow("audit failure");expect(f.data).toEqual(before);
});
it("retries a failed school safely after rollback",async()=>{
 const f=fixture();f.controls.failAudit=true;await expect(rolloverSchoolCalendar(f.pool,1)).rejects.toThrow();
 f.controls.failAudit=false;await rolloverSchoolCalendar(f.pool,1);expect(f.data.ledger).toHaveLength(1);
});
it("revalidates calendar edits made before the locked read",async()=>{
 const f=fixture();f.controls.beforeRead=()=>{f.data.terms[1].startDate="2027-01-25";};
 await rolloverSchoolCalendar(f.pool,1);expect(f.data.terms.some(t=>t.isCurrent)).toBe(false);
});
it("never reuses yesterday's plan across a Lagos date change",async()=>{
 const f=fixture(),before=structuredClone(f.data);f.controls.days=["2027-01-18","2027-01-19"];
 await expect(rolloverSchoolCalendar(f.pool,1)).rejects.toThrow("DAY_CHANGED");expect(f.data).toEqual(before);
});
it("fails closed before calendar writes when the candidate schema is absent",async()=>{
 const f=fixture();f.controls.schema=false;
 await expect(rolloverSchoolCalendar(f.pool,1)).rejects.toThrow("SCHEMA_REQUIRED");
 expect(f.calls.some(c=>c.sql.startsWith("UPDATE"))).toBe(false);
});
it("fails closed when native guards are missing",async()=>{
 const f=fixture();f.guards.pop();await expect(rolloverSchoolCalendar(f.pool,1)).rejects.toThrow("GUARDS_REQUIRED");
 expect(f.calls.some(c=>c.sql.startsWith("UPDATE"))).toBe(false);
});
it("does not mutate a busy or inactive school",async()=>{
 const f=fixture();f.controls.locked=false;expect((await rolloverSchoolCalendar(f.pool,1)).status).toBe("BUSY");
 f.controls.locked=true;f.controls.school=false;expect((await rolloverSchoolCalendar(f.pool,1)).status).toBe("SCHOOL_UNAVAILABLE");
 expect(f.data.ledger).toHaveLength(0);
});
it("makes no changes to another school's calendar",async()=>{
 const f=fixture(),b=calendarFixture(2,2026,25);f.data.sessions.push(...b.sessions);f.data.terms.push(...b.terms);
 const before=structuredClone(b);await rolloverSchoolCalendar(f.pool,1);
 expect(f.data.sessions.filter(s=>s.schoolId===2)).toEqual(before.sessions);
 expect(f.data.terms.filter(t=>t.schoolId===2)).toEqual(before.terms);
});
it("deduplicates unchanged invalid-calendar observations",async()=>{
 const f=fixture();f.data.terms.pop();await rolloverSchoolCalendar(f.pool,1);await rolloverSchoolCalendar(f.pool,1);
 expect(f.data.ledger).toHaveLength(1);expect(f.data.terms.some(t=>t.isCurrent)).toBe(false);
});
it("bounds lock waits and reads the clock only after acquiring the calendar lock",async()=>{
 const f=fixture();await rolloverSchoolCalendar(f.pool,1);
 const at=(s:string)=>f.calls.findIndex(c=>c.sql.includes(s));
 expect(at("SET LOCAL lock_timeout")).toBeLessThan(at("pg_advisory_xact_lock(1946482034"));
 expect(at("pg_try_advisory")).toBeLessThan(at("AS today"));
 expect(f.calls.some(c=>c.sql.includes("SET LOCAL statement_timeout='10s'"))).toBe(true);
});
it("lets a healthy school reconcile even if the previous school has invalid calendar data",async()=>{
 const f=fixture(),b=calendarFixture(2);f.data.terms.pop();f.data.sessions.push(...b.sessions);f.data.terms.push(...b.terms);
 const warnings:any[]=[];await createCalendarRolloverTick(f.pool,{warn:(...args)=>warnings.push(args)})();
 expect(f.data.terms.find(t=>t.id===b.terms[1].id)?.isCurrent).toBe(true);expect(warnings.length).toBeGreaterThan(0);
});
it("continues to the next school after a transaction failure without exposing raw errors",async()=>{
 const f=fixture(),b=calendarFixture(2);f.data.sessions.push(...b.sessions);f.data.terms.push(...b.terms);
 const original=f.pool.connect;let connects=0;
 const pool={connect:async()=>{connects++;if(connects===2)throw Object.assign(Error("Private fictional connection detail"),{code:"08006"});
  return original();}};
 const warnings:any[]=[];await createCalendarRolloverTick(pool,{warn:(...args)=>warnings.push(args)})();
 expect(f.data.terms.find(t=>t.id===b.terms[1].id)?.isCurrent).toBe(true);
 expect(warnings[0][0]).toMatchObject({schoolId:1,sqlstate:"08006"});
 expect(JSON.stringify(warnings)).not.toContain("Private fictional");
});
it("keeps worker ticks from overlapping inside one process",async()=>{
 const f=fixture();let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
 const pool={connect:async()=>{await gate;return f.pool.connect();}};
 const tick=createCalendarRolloverTick(pool,{warn(){}});
 const first=tick();await tick();release();await first;
 expect(f.calls.filter(c=>c.sql==="SELECT id FROM schools WHERE upper(status)='ACTIVE' ORDER BY id")).toHaveLength(1);
});
