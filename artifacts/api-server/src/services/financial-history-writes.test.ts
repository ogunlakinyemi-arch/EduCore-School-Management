import {describe,expect,it,vi} from "vitest";
import {readFileSync,readdirSync} from "node:fs";
import {join} from "node:path";
import {appendFinancialHistory,requireFinancialActor,transitionDirectAttempt,type AttemptState} from "./financial-history-writes";

const states:AttemptState[]=["RESERVED","READY","UNKNOWN","PENDING","PAID","FAILED"];
const allowed:Record<AttemptState,AttemptState[]>={
  RESERVED:["READY","UNKNOWN","PENDING","PAID","FAILED"],READY:["PENDING","PAID","FAILED"],
  UNKNOWN:["PENDING","PAID","FAILED"],PENDING:["PAID","FAILED"],PAID:[],FAILED:[],
};
const paid={state:"PAID" as const,transactionId:"901",providerReference:"fictional",
  providerFeeMinor:5000,additionalFeeMinor:0};
function client(state:AttemptState){
  const original={id:1,obligation_id:7,reference:"SCV4_live_original_reference",idempotency_key:"original-key",
    created_by:9,created_at:"2027-01-01",state,checkout_url:null,provider_transaction_id:null,
    provider_reference:null,provider_fee_minor:null,additional_fee_minor:null};
  const query=vi.fn(async(sql:string,values?:unknown[])=>{
    if(sql.startsWith("SELECT *"))return{rows:[original]};
    return{rows:[{...original,state:values?.[1]}]};
  });
  return {query,original};
}
describe("application-only financial write boundary",()=>{
  it.each(states.flatMap(from=>states.map(to=>({from,to}))))("enforces $from -> $to",async({from,to})=>{
    const c=client(from);
    const action=transitionDirectAttempt(c,1,{...paid,state:to,checkoutUrl:"https://checkout.flutterwave.com/v3/hosted/pay/fake"});
    if(allowed[from].includes(to)){
      await expect(action).resolves.toMatchObject({state:to});
      const update=c.query.mock.calls.find(([sql])=>sql.startsWith("UPDATE"))!;
      expect(update[0]).not.toMatch(/SET (?:obligation_id|reference|idempotency_key|created_by|created_at)/);
      expect(update[0]).toContain("state NOT IN ('PAID','FAILED')");
      expect(update[1]?.slice(-2)).toEqual([["PAID","FAILED"].includes(to),from]);
    }else{
      await expect(action).rejects.toThrow("ATTEMPT_TRANSITION_FORBIDDEN");
      expect(c.query.mock.calls.some(([sql])=>sql.startsWith("UPDATE"))).toBe(false);
    }
  });
  it.each(["obligation_id","reference","idempotency_key","created_by","created_at","id","verified_at"])(
    "rejects caller-supplied identity/evidence column %s",async key=>{
      const c=client("READY");
      await expect(transitionDirectAttempt(c,1,{...paid,[key]:"tampered"} as any)).rejects.toThrow("IMMUTABLE");
      expect(c.query).not.toHaveBeenCalled();
    });
  it.each([
    {transactionId:undefined},{providerReference:null},{providerFeeMinor:null},
    {providerFeeMinor:-1},{additionalFeeMinor:1.5},{providerFeeMinor:320000},
  ])("rejects incomplete final payment facts %j",async patch=>{
    const c=client("READY");
    await expect(transitionDirectAttempt(c,1,{...paid,...patch})).rejects.toThrow();
    expect(c.query.mock.calls.some(([sql])=>sql.startsWith("UPDATE"))).toBe(false);
  });
  it("rejects replacing an already observed provider transaction",async()=>{
    const c=client("PENDING");(c.original as any).provider_transaction_id="902";
    await expect(transitionDirectAttempt(c,1,paid)).rejects.toThrow("VERIFIED_TRANSACTION_CONFLICT");
  });
  it("fails closed on a lost conditional update rather than returning success",async()=>{
    const c=client("READY"),base=c.query.getMockImplementation()!;
    c.query.mockImplementation((sql,v)=>sql.startsWith("UPDATE")?Promise.resolve({rows:[]}):base(sql,v));
    await expect(transitionDirectAttempt(c,1,paid)).rejects.toThrow("ATTEMPT_TRANSITION_CONFLICT");
  });
  it.each(["UPDATE","DELETE","attemptDelete","toString","__proto__"])("has no history mutation operation %s",async op=>{
    const query=vi.fn();
    await expect(appendFinancialHistory({query},op as any,[])).rejects.toThrow("OPERATION_INVALID");
    expect(query).not.toHaveBeenCalled();
  });
  it.each(["reviewRequest","review","binding","decision","obligation","attempt","event","bro"] as const)(
    "permits only INSERT SQL for %s history",async op=>{
      const query=vi.fn(async(_sql:string,_values?:unknown[])=>({rows:[{id:1,financial_bro_scope_valid:true}]}));
      await appendFinancialHistory({query},op,[]);
      const writes=query.mock.calls.map(([sql])=>sql).filter(sql=>sql.startsWith("INSERT"));
      expect(writes).toHaveLength(1);
      expect(writes[0]).not.toMatch(/\b(?:UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/);
      if(op==="attempt")expect(writes[0]).toContain("'RESERVED'");
    });
  it.each([false,undefined])("requires positive live actor authorization, not absence of a denial (%s)",async flag=>{
    const query=vi.fn(async()=>({rows:[{financial_actor_authorized:flag}]}));
    await expect(requireFinancialActor({query},9)).rejects.toThrow("NOT_AUTHORIZED");
    expect(query.mock.calls[0]).toBeDefined();
  });
  it("uses parameterized school versus Owner authority and restricted-role exclusion",async()=>{
    const query=vi.fn(async(_sql:string,_v?:unknown[])=>({rows:[{financial_actor_authorized:true}]}));
    await requireFinancialActor({query},9);
    await requireFinancialActor({query},10,1);
    expect(query.mock.calls.map(([,v])=>v)).toEqual([[9,null],[10,1]]);
    expect(query.mock.calls[0][0]).toContain("COMPANY_ACCOUNTANT");
    expect(query.mock.calls[0][0]).toContain("FOR SHARE OF u,m");
  });
  it("rechecks the BRO relationship predicate immediately before INSERT",async()=>{
    const query=vi.fn(async()=>({rows:[{financial_bro_scope_valid:false}]}));
    await expect(appendFinancialHistory({query},"bro",Array(12).fill(null))).rejects.toThrow("BRO_EARNING_SCOPE_INVALID");
    expect(query).toHaveBeenCalledTimes(1);
    const sql=(query.mock.calls as unknown as [string][])[0][0];
    for(const fragment of ["a.state='PAID'","a.verified_at=$10","p.activated_at IS NOT NULL",
      "o.school_share_minor=0","o.bro_share_minor=0","Africa/Lagos","FOR SHARE OF o,a,t,at,p"])
      expect(sql).toContain(fragment);
  });
  it("keeps protected SQL mutations centralized across application source",()=>{
    const root=join(import.meta.dirname,"..");
    const violations:string[]=[];
    const protectedTable="(?:student_direct_live_(?:reviews|obligations|attempts|events|release_requests|release_decisions|review_bindings)|bro_term_commission_entitlements)";
    const pattern=new RegExp(`(?:INSERT\\s+INTO|UPDATE|DELETE\\s+FROM|TRUNCATE(?:\\s+TABLE)?)\\s+(?:public\\.)?${protectedTable}\\b`,"i");
    function visit(dir:string){
      for(const item of readdirSync(dir,{withFileTypes:true})){
        const path=join(dir,item.name);
        if(item.isDirectory())visit(path);
        else if(item.name.endsWith(".ts")&&!item.name.includes(".test.")&&item.name!=="financial-history-writes.ts"
          &&pattern.test(readFileSync(path,"utf8")))violations.push(path);
      }
    }
    visit(root);
    expect(violations).toEqual([]);
  });
});
