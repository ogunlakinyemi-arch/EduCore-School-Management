import type {Request} from "express";
import {beforeEach,describe,expect,it,vi} from "vitest";
import {assignPublishedClassFees} from "./fee-publication";
const state={published:true,students:[{id:10},{id:11}],existing:new Set<number>(),calls:[] as {sql:string;values:any[]}[]};
const writer=vi.fn(async()=>99);
const db={query:vi.fn(async(sql:string,values:any[]=[])=>{
  state.calls.push({sql,values});
  if(sql.includes("FROM fee_structures fs"))return {rows:state.published?[{
    id:3,academic_session_id:386,academic_term_id:27,school_class_id:580,section:"B",
    current_period:true,start_date:"2026-10-04",end_date:"2026-12-20",
  }]:[]};
  if(sql.includes("FROM fee_structure_lines l"))return{rows:[{id:1,amount_minor:800000,transport_only:false}]};
  if(sql.includes("SELECT DISTINCT ON (st.id)"))return{rows:state.students};
  if(sql.includes("SELECT id FROM fee_invoices"))return{rows:state.existing.has(values[1])?[{id:42}]:[]};
  throw Error("Unexpected publication query");
})};
beforeEach(()=>{state.published=true;state.students=[{id:10},{id:11}];state.existing=new Set();state.calls=[];writer.mockClear();});
describe("published class fee invoice assignment safeguards",()=>{
  it("does not expose or assign an unpublished draft",async()=>{
    state.published=false;
    await expect(assignPublishedClassFees(db,{} as Request,1496,3,966,writer)).rejects.toMatchObject({statusCode:409});
    expect(writer).not.toHaveBeenCalled();
  });
  it("creates one charge per eligible term/class student using the canonical student ID",async()=>{
    expect(await assignPublishedClassFees(db,{} as Request,1496,3,966,writer)).toEqual({assignedCount:2,eligibleCount:2});
    expect(writer.mock.calls).toHaveLength(2);
    expect((writer.mock.calls as any[]).map(c=>c[4].id)).toEqual([10,11]);
  });
  it("does not duplicate an existing invoice, including already-paid ones",async()=>{
    state.existing.add(10);
    expect(await assignPublishedClassFees(db,{} as Request,1496,3,966,writer)).toEqual({assignedCount:1,eligibleCount:2});
  });
  it("reports zero eligible students without inventing an invoice",async()=>{
    state.students=[];
    expect(await assignPublishedClassFees(db,{} as Request,1393,36,911,writer)).toEqual({assignedCount:0,eligibleCount:0});
    expect(writer).not.toHaveBeenCalled();
  });
  it("keeps school, session, term, class and section bound to the stored structure",async()=>{
    await assignPublishedClassFees(db,{} as Request,1496,3,966,writer);
    expect(state.calls.find(c=>c.sql.includes("SELECT DISTINCT ON"))?.values).toEqual([1496,386,27,580,"B",true]);
  });
  it("does not rewrite any existing payment or invoice",async()=>{
    await assignPublishedClassFees(db,{} as Request,1496,3,966,writer);
    expect(state.calls.some(c=>/\b(UPDATE|DELETE)\b/.test(c.sql))).toBe(false);
  });
});