import {describe,it,expect} from "vitest";
import {financialGuardBodies,financialGuardTriggers,inspectFinancialGuards} from "./financial-guard-schema";
import {financialGuardCatalogFixture} from "../test/financial-guard-catalog-fixture";

function fixture(){
  const {functions,triggers}=financialGuardCatalogFixture();
  const queries:string[]=[];
  const client={query:async(sql:string,values?:unknown[])=>{
    queries.push(sql);
    const names=values?.[0] as string[];
    return{rows:sql.includes("FROM pg_proc")?functions.filter(f=>names.includes(f.proname))
      :triggers.filter(t=>names.includes(t.tgname))};
  }};
  return{functions,triggers,queries,client};
}
describe("definition-level financial guard verification",()=>{
  it("verifies four functions/nine triggers with two parameterized SELECT-only queries",async()=>{
    const f=fixture();
    expect(f.functions).toHaveLength(4);expect(f.triggers).toHaveLength(9);
    expect(await inspectFinancialGuards(f.client)).toEqual({ready:true,issues:[]});
    expect(f.queries).toHaveLength(2);
    for(const sql of f.queries){expect(sql.trim()).toMatch(/^SELECT /);expect(sql).toContain("$1");}
  });
  for(const name of Object.keys(financialGuardBodies)){
    it(`rejects missing and same-name no-op ${name}`,async()=>{
      const f=fixture(),fn=f.functions.find(p=>p.proname===name)!;
      fn.prosrc="BEGIN RETURN NEW; END";
      expect((await inspectFinancialGuards(f.client)).issues).toContain(`GUARD_FUNCTION_DEFINITION:${name}`);
      f.functions.splice(f.functions.indexOf(fn),1);
      expect((await inspectFinancialGuards(f.client)).issues).toContain(`GUARD_FUNCTION_DEFINITION:${name}`);
    });
  }
  for(const t of financialGuardTriggers){
    it(`rejects missing and disabled ${t.name}`,async()=>{
      const f=fixture(),tg=f.triggers.find(g=>g.tgname===t.name)!;
      tg.tgenabled="D";
      expect((await inspectFinancialGuards(f.client)).issues).toContain(`GUARD_TRIGGER_DEFINITION:${t.name}`);
      f.triggers.splice(f.triggers.indexOf(tg),1);
      expect((await inspectFinancialGuards(f.client)).issues).toContain(`GUARD_TRIGGER_DEFINITION:${t.name}`);
    });
  }
  for(const [property,value] of Object.entries({
    tgtype:19,tgnargs:1,unconditional:false,unconstrained:false,columns:"1",tgparentid:9,
    function_schema:"attacker",function_oid:999,proname:"other_function",
  })){
    it(`rejects trigger drift in ${property}`,async()=>{
      const f=fixture();Object.assign(f.triggers[0],{[property]:value});
      expect((await inspectFinancialGuards(f.client)).ready).toBe(false);
    });
  }
  for(const [property,value] of Object.entries({
    returns_trigger:false,lanname:"sql",prokind:"p",prosecdef:true,provolatile:"i",
    proisstrict:true,proleakproof:true,proconfig:["search_path=attacker"],proparallel:"s",proretset:true,
  })){
    it(`rejects function drift in ${property}`,async()=>{
      const f=fixture();Object.assign(f.functions[0],{[property]:value});
      expect((await inspectFinancialGuards(f.client)).ready).toBe(false);
    });
  }
  it("does not ignore modified strings or predicates inside an otherwise matching body",async()=>{
    const f=fixture(),fn=f.functions.find(p=>p.proname==="guard_bro_term_commission_scope")!;
    fn.prosrc=fn.prosrc.replace("a.state='PAID'","a.state='PENDING'");
    expect((await inspectFinancialGuards(f.client)).ready).toBe(false);
  });
  it("normalizes only line endings and surrounding whitespace",async()=>{
    const f=fixture();
    for(const fn of f.functions)fn.prosrc=` \n${fn.prosrc.replace(/\n/g,"\r\n")}  `;
    expect((await inspectFinancialGuards(f.client)).ready).toBe(true);
  });
  it("keeps each financial path independent of unrelated guard objects",async()=>{
    const f=fixture();
    f.triggers.splice(f.triggers.findIndex(t=>t.tgname==="bro_term_commission_scope_guard"),1);
    expect((await inspectFinancialGuards(f.client,"direct")).ready).toBe(true);
    expect((await inspectFinancialGuards(f.client,"bro")).ready).toBe(false);
  });
});
