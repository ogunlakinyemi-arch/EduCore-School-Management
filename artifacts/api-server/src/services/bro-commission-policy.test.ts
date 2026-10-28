import {describe,it,expect,vi} from "vitest";
import {accrueBroCommission,broEntitlementAmount,broCommissionSnapshot,type BroEligibility,type BroPolicy} from "./bro-commission-policy";
import {financialGuardCatalogFixture} from "../test/financial-guard-catalog-fixture";
const policy:BroPolicy={id:1,status:"SCHEDULED",amountMinor:15000,effectiveAt:"2027-01-04T23:00:00Z",endsAt:null,approved:true};
const eligible:BroEligibility={termStart:"2027-01-04T23:00:00Z",paidAt:"2027-01-05T10:00:00Z",
  verified:true,studentEligible:true,attributionEligible:true,legacyExists:false};
describe("prospective independent BRO policy",()=>{
  it("uses exactly 150 NGN at the inclusive approved term boundary",()=>{
    expect(broEntitlementAmount(policy,eligible)).toBe(15000);
    expect(broEntitlementAmount(policy,{...eligible,termStart:"2027-01-04T22:59:59.999Z"})).toBeNull();
  });
  it("does not reprice an old term after late payment or use an expired/retired policy",()=>{
    expect(broEntitlementAmount(policy,{...eligible,termStart:"2026-10-01T23:00:00Z"})).toBeNull();
    expect(broEntitlementAmount({...policy,endsAt:eligible.termStart},eligible)).toBeNull();
    expect(broEntitlementAmount({...policy,status:"RETIRED"},eligible)).toBeNull();
    expect(broEntitlementAmount({...policy,amountMinor:10000},eligible)).toBeNull();
    expect(broEntitlementAmount({...policy,approved:false},eligible)).toBeNull();
  });
  it.each(["verified","studentEligible","attributionEligible"] as const)("requires %s evidence",key=>{
    expect(broEntitlementAmount(policy,{...eligible,[key]:false})).toBeNull();
  });
  it("excludes existing historical commissions and payment before the effective instant",()=>{
    expect(broEntitlementAmount(policy,{...eligible,legacyExists:true})).toBeNull();
    expect(broEntitlementAmount(policy,{...eligible,paidAt:"2027-01-03T23:00:00Z"})).toBeNull();
  });
});
function database(options:{ready?:boolean;legacy?:boolean;oldEntry?:any;approved?:boolean;termStart?:string;missingGuard?:string}={}){
  const catalog=financialGuardCatalogFixture();
  catalog.functions=catalog.functions.filter(f=>f.proname!==options.missingGuard);
  catalog.triggers=catalog.triggers.filter(t=>t.tgname!==options.missingGuard);
  let saved=options.oldEntry??null;
  const audits:any[]=[];
  const policyRow={id:1,status:"SCHEDULED",amount_minor:15000,effective_at:policy.effectiveAt,ends_at:null,
    version:2,approved:options.approved??true};
  const query=vi.fn(async(sql:string,args?:unknown[])=>{
    if(sql.includes("AS financial_actor_authorized"))return{rows:[{financial_actor_authorized:true}]};
    if(sql.includes("AS financial_bro_scope_valid"))return{rows:[{financial_bro_scope_valid:true}]};
    if(sql.includes("FROM pg_proc"))return{rows:catalog.functions};
    if(sql.includes("FROM pg_trigger tg"))return{rows:catalog.triggers};
    if(sql.includes('t.school_id AS "schoolId"'))return{rows:[{id:4,schoolId:1,name:"Second Term",
      startDate:"2027-01-05",endDate:"2027-04-01",isCurrent:true,status:"ACTIVE",sessionStatus:"ACTIVE"}]};
    if(sql.includes("to_regclass"))return{rows:[{ready:options.ready??true}]};
    if(sql.includes("SELECT * FROM bro_term_commission_entitlements"))return{rows:saved?[saved]:[]};
    if(sql.includes("SELECT o.id AS obligation_id"))return{rows:[{obligation_id:7,attempt_id:8,paid_at:eligible.paidAt,paid_at_exact:eligible.paidAt,
      term_start:options.termStart??eligible.termStart,attribution_id:3,partner_profile_id:4,legacy_exists:options.legacy??false}]};
    if(sql.includes("SELECT p.*"))return{rows:[policyRow]};
    if(sql.includes("INSERT INTO bro_term_commission_entitlements")){
      saved={id:11,school_id:1,amount_minor:args![8]};return{rows:[saved]};
    }
    if(sql.includes("INSERT INTO audit_logs"))audits.push(args);
    return{rows:[]};
  });
  const release=vi.fn();
  return{pool:{query,connect:async()=>({query,release})},query,audits,release,get saved(){return saved;}};
}
const scope={schoolId:1,studentId:31,termId:4},actor={id:9,email:"owner@example.test",clerkUserId:"fictional-owner"};
describe("append-only BRO processing (mocked SQL, no app database)",()=>{
  it("records 150 once and returns the same frozen earning on repeat processing",async()=>{
    const db=database();
    expect(await accrueBroCommission(db.pool,scope,actor)).toEqual({id:11,amountMinor:15000,existing:false});
    expect(await accrueBroCommission(db.pool,scope,actor)).toEqual({id:11,amountMinor:15000,existing:true});
    expect(db.audits).toHaveLength(1);
    const sql=db.query.mock.calls.map(([q])=>q).join("\n");
    expect(sql).toContain("ON CONFLICT ON CONSTRAINT bro_term_commission_scope_uq DO NOTHING");
    expect(sql).toContain("pg_advisory_xact_lock(310031,1)");
    expect(sql).not.toMatch(/UPDATE|DELETE|INSERT INTO (?:commission_ledger|student_direct_live_(?:obligations|attempts))/);
    expect(JSON.stringify(db.audits)).toContain("SEPARATE_PLATFORM_EXPENSE");
    expect(db.release).toHaveBeenCalledTimes(2);
  });
  it("returns an existing independent earning without changing its snapshot",async()=>{
    const old={id:10,school_id:1,amount_minor:15000,status:"PENDING_OWNER_APPROVAL",evidence:{original:true}};
    const db=database({oldEntry:structuredClone(old)});
    expect(await accrueBroCommission(db.pool,scope,actor)).toEqual({id:10,amountMinor:15000,existing:true});
    expect(db.saved).toEqual(old);expect(db.audits).toHaveLength(0);
  });
  it.each(["PENDING","PAID"])("leaves historical 100 ledger evidence in %s status unchanged and refuses a second earning",async status=>{
    const historical={amount:100,rate:100,status,payment_id:81};
    const before=structuredClone(historical),db=database({legacy:true});
    await expect(accrueBroCommission(db.pool,scope,actor)).rejects.toThrow("already earned historically");
    expect(historical).toEqual(before);expect(db.saved).toBeNull();
    expect(db.query.mock.calls.map(([q])=>q).join("\n")).not.toMatch(/UPDATE|DELETE|INSERT INTO commission_ledger/);
  });
  it.each([{legacy:true},{approved:false},{termStart:"2026-10-01T23:00:00Z"}])("does not book a new earning for excluded evidence %j",async options=>{
    const db=database(options);
    await expect(accrueBroCommission(db.pool,scope,actor)).rejects.toThrow("ineligible");
    expect(db.saved).toBeNull();expect(db.audits).toHaveLength(0);
    expect(db.query).toHaveBeenCalledWith("ROLLBACK");
  });
  it("fails closed without installing storage or writing anything while the recovery hold remains",async()=>{
    const db=database({ready:false});
    expect(await broCommissionSnapshot(db.pool)).toEqual({available:false,entries:[]});
    await expect(accrueBroCommission(db.pool,scope,actor)).rejects.toThrow("recovery clearance");
    expect(db.saved).toBeNull();
    expect(db.query.mock.calls.map(([q])=>q).join("\n")).not.toMatch(/CREATE|ALTER|INSERT|UPDATE|DELETE/);
  });
  it.each(["guard_student_direct_history","guard_student_direct_attempt",
    "student_direct_obligation_history","student_direct_attempt_history","student_direct_event_history"])(
    "blocks new accrual with intact BRO guards but missing %s",async missingGuard=>{
      const db=database({missingGuard});
      expect(await broCommissionSnapshot(db.pool)).toEqual({available:true,entries:[]});
      await expect(accrueBroCommission(db.pool,scope,actor)).rejects.toThrow("Direct payment history guards");
      expect(db.saved).toBeNull();expect(db.audits).toHaveLength(0);
      const sql=db.query.mock.calls.map(([q])=>q);
      expect(sql).toContain("ROLLBACK");expect(sql).not.toContain("COMMIT");
      expect(sql.some(q=>q.includes("SELECT o.id AS obligation_id"))).toBe(false);
      expect(sql.some(q=>/^\s*(?:INSERT|UPDATE|DELETE)\b/.test(q))).toBe(false);
    });
  it("preserves readback of a frozen earning when direct guards are missing",async()=>{
    const old={id:10,school_id:1,amount_minor:15000};
    const db=database({oldEntry:old,missingGuard:"guard_student_direct_attempt"});
    expect(await accrueBroCommission(db.pool,scope,actor)).toEqual({id:10,amountMinor:15000,existing:true});
    expect(db.saved).toEqual(old);expect(db.audits).toHaveLength(0);
  });
  it("rolls back the earning if its audit cannot be recorded",async()=>{
    const db=database();
    const base=db.query.getMockImplementation()!;
    db.query.mockImplementation(async(sql,args)=>{
      if(sql.includes("INSERT INTO audit_logs"))throw new Error("fixture audit failure");
      return base(sql,args);
    });
    await expect(accrueBroCommission(db.pool,scope,actor)).rejects.toThrow("fixture audit failure");
    expect(db.query).toHaveBeenCalledWith("ROLLBACK");
    expect(db.query.mock.calls.filter(([q])=>q==="COMMIT")).toHaveLength(0);
  });
  it.each(["financial_actor_authorized","financial_bro_scope_valid"])("rolls back if %s is denied at the centralized boundary",async marker=>{
    const db=database(),base=db.query.getMockImplementation()!;
    db.query.mockImplementation((sql,args)=>sql.includes(`AS ${marker}`)
      ?Promise.resolve({rows:[{[marker]:false}]}):base(sql,args));
    await expect(accrueBroCommission(db.pool,scope,actor)).rejects.toThrow();
    expect(db.saved).toBeNull();expect(db.audits).toHaveLength(0);
    expect(db.query).toHaveBeenCalledWith("ROLLBACK");
    expect(db.query.mock.calls.some(([sql])=>sql==="COMMIT")).toBe(false);
  });
});
