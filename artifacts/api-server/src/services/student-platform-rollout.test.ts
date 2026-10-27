import {describe,it,expect,vi} from "vitest";
import {studentRolloutDecision,STUDENT_LAUNCH_POLICY,type RolloutTerm} from "./student-platform-rollout";
import {directStudentReadiness,startDirectStudentPayment} from "./direct-student-live-payments";
import {broEntitlementAmount} from "./bro-commission-policy";
const term=(id:number,name:string,startDate:string,endDate:string,schoolId=1):RolloutTerm=>({
  id,name,startDate,endDate,schoolId,isCurrent:true,status:"ACTIVE",sessionStatus:"ACTIVE",
});
const terms=[term(1,"First Term","2026-09-10","2026-12-20"),
  term(2,"Second Term","2027-01-18","2027-04-09"),term(3,"Third Term","2027-05-03","2027-07-30")];
describe("approved free launch and school-owned January collection",()=>{
  it("records policy approval separately from collection and fixes no-split amounts",()=>{
    expect(STUDENT_LAUNCH_POLICY).toMatchObject({approvedOn:"2026-10-27",effectiveOn:"2026-10-27",
      studentAmountMinor:320000,broAmountMinor:15000,schoolShareMinor:0,collectionBroShareMinor:0});
  });
  it("keeps the current term free and refuses advance checkout for January",()=>{
    expect(studentRolloutDecision(terms,1,1,"2026-10-27")).toMatchObject({chargeable:false,freeAccess:true});
    expect(studentRolloutDecision(terms,1,2,"2027-01-17").chargeable).toBe(false);
    expect(studentRolloutDecision(terms,1,2,"2026-10-27").chargeable).toBe(false);
  });
  it("uses the actual school's January 18 start, never January 1 by default",()=>{
    expect(studentRolloutDecision(terms,1,2,"2027-01-18")).toMatchObject({
      chargeable:true,collectionStartDate:"2027-01-18",launchTermId:2});
    expect(studentRolloutDecision(terms,1,3,"2027-05-03").chargeable).toBe(true);
  });
  it("never borrows another school's calendar or guesses missing/ambiguous anchors",()=>{
    expect(studentRolloutDecision(terms,2,2,"2027-01-18").chargeable).toBe(false);
    expect(studentRolloutDecision(terms.filter(t=>t.id!==2),1,3,"2027-05-03").chargeable).toBe(false);
    expect(studentRolloutDecision([...terms,{...terms[1],id:8}],1,2,"2027-01-18").chargeable).toBe(false);
    expect(studentRolloutDecision(terms,1,999,"2027-01-18").chargeable).toBe(false);
  });
  it("refuses stale, ended or inactive term checkout",()=>{
    expect(studentRolloutDecision(terms,1,2,"2027-04-10").chargeable).toBe(false);
    expect(studentRolloutDecision(terms.map(t=>({...t,status:"INACTIVE"})),1,2,"2027-01-18").chargeable).toBe(false);
  });
  it("blocks before any insert or provider access, even with a checkout request",async()=>{
    const query=vi.fn(async()=>({rows:terms}));
    const pool={connect:async()=>({query,release:vi.fn()})},scope={schoolId:1,studentId:31,termId:1};
    expect((await directStudentReadiness(pool,scope)).blockers).toContain("FREE_ROLLOUT_NO_PLATFORM_PAYMENT");
    await expect(startDirectStudentPayment(pool,{...scope,actorId:9,email:"fictional@example.test",
      idempotencyKey:"fictional-key-no-charge"})).rejects.toThrow("FREE_ROLLOUT_NO_PLATFORM_PAYMENT");
    expect(query.mock.calls.every(([sql]:any)=>!/\b(?:INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(true);
  });
  it("cannot award 150 for current-term, unpaid, legacy or unapproved evidence",()=>{
    const p={id:1,status:"ACTIVE",amountMinor:15000,effectiveAt:"2026-10-26T23:00:00Z",endsAt:null,approved:true};
    const e={termStart:"2027-01-17T23:00:00Z",paidAt:"2027-01-18T10:00:00Z",
      verified:true,studentEligible:true,attributionEligible:true,legacyExists:false};
    expect(broEntitlementAmount(p,e)).toBe(15000);
    expect(broEntitlementAmount(p,{...e,termStart:"2026-10-27T00:00Z"})).toBeNull();
    expect(broEntitlementAmount(p,{...e,verified:false})).toBeNull();
    expect(broEntitlementAmount(p,{...e,legacyExists:true})).toBeNull();
    expect(broEntitlementAmount({...p,approved:false},e)).toBeNull();
  });
});
