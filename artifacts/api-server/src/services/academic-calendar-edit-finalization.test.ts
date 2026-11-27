/** Authored transaction-coordinator seams. No application pool/auth is loaded. */
import {beforeEach,it,expect,vi} from "vitest";
const m=vi.hoisted(()=>({schema:vi.fn(),installed:true,complete:true,current:true,
 due:[{id:12,status:"PLANNED",is_current:false}] as any[],outgoing:[{id:11,status:"ACTIVE"}] as any[],
 calls:[] as string[]}));
vi.mock("../middlewares/auth",()=>({AuthError:class extends Error{constructor(public status:number,message:string){super(message);}}}));
vi.mock("./academic-calendar-rollover",()=>({requireCalendarRolloverSchema:m.schema}));
import {finalizeCalendarSessionEdit} from "./academic-calendar-edit-finalization";
const c={query:async(sql:string)=>{
 m.calls.push(sql);
 if(sql.includes("to_regclass"))return {rows:[{ready:m.installed}]};
 if(sql.includes("SELECT id,status,is_current FROM academic_sessions"))return {rows:[{id:1,status:"ACTIVE",is_current:m.current}]};
 if(sql.includes("AS complete"))return {rows:[{complete:m.complete}]};
 if(sql.includes("AND (clock_timestamp()"))return {rows:m.due};
 if(sql.includes("SELECT id,status FROM academic_terms"))return {rows:m.outgoing};
 if(sql.startsWith("UPDATE "))return {rows:[]};
 throw Error("Unexpected calendar coordinator SQL");
}};
beforeEach(()=>{
 vi.clearAllMocks();Object.assign(m,{installed:true,complete:true,current:true,
  due:[{id:12,status:"PLANNED",is_current:false}],outgoing:[{id:11,status:"ACTIVE"}],calls:[]});
});
it("pairs current-session activation with the saved due term in the caller transaction",async()=>{
 const changes=await finalizeCalendarSessionEdit(c,1,1);
 expect(changes).toEqual([
  {kind:"TERM",id:11,from:{status:"ACTIVE",isCurrent:true},to:{status:"ACTIVE",isCurrent:false}},
  {kind:"TERM",id:12,from:{status:"PLANNED",isCurrent:false},to:{status:"ACTIVE",isCurrent:true}},
 ]);
 expect(m.calls.some(s=>/BEGIN|COMMIT/.test(s))).toBe(false);
 expect(m.calls.findIndex(s=>s.startsWith("UPDATE academic_terms SET is_current=false")))
  .toBeLessThan(m.calls.findIndex(s=>s.startsWith("UPDATE academic_terms SET is_current=true")));
});
it("requires three saved ordered terms and refuses an explicitly inactive due term",async()=>{
 m.complete=false;
 await expect(finalizeCalendarSessionEdit(c,1,1)).rejects.toThrow("Save all three ordered terms");
 m.complete=true;m.due[0].status="INACTIVE";
 await expect(finalizeCalendarSessionEdit(c,1,1)).rejects.toThrow("due term is inactive");
 expect(m.calls.some(s=>s.startsWith("UPDATE "))).toBe(false);
});
it("allows a saved holiday with no due term without inventing one",async()=>{
 m.due=[];await finalizeCalendarSessionEdit(c,1,1);
 expect(m.calls.some(s=>s.startsWith("UPDATE academic_terms SET is_current=true"))).toBe(false);
});
it("clears the current session and children together for an explicit due-term deactivation",async()=>{
 m.due=[];const changes=await finalizeCalendarSessionEdit(c,1,1,true);
 expect(changes[0]).toMatchObject({kind:"SESSION",id:1,to:{isCurrent:false}});
 expect(changes[1]).toMatchObject({kind:"TERM",id:11,to:{isCurrent:false}});
});
it("preserves pre-candidate behavior without installing or demanding new schema",async()=>{
 m.installed=false;expect(await finalizeCalendarSessionEdit(c,1,1)).toEqual([]);
 expect(m.schema).not.toHaveBeenCalled();expect(m.calls).toHaveLength(1);
});
