import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const guards=vi.hoisted(()=>({subscription:vi.fn(),device:vi.fn()}));
vi.mock("./subscription-enforcement",()=>({assertSubscriptionAccess:guards.subscription}));
vi.mock("../lib/nfc-device-first",()=>({assertSchoolHasActiveNfcDevice:guards.device}));
import {AuthError} from "../middlewares/auth";
import {readStudentCardReadiness,assertStudentCardUsePrerequisites} from "./student-card-readiness";
import {assertVerifiedStudentNfcPayment} from "./student-nfc-payment-evidence";

let action:string,status:string,paid:boolean,schoolStatus:string,policy:string;
const terms=[
  {id:19,schoolId:2,name:"First Term",startDate:"2026-09-01",endDate:"2026-12-20",isCurrent:true,status:"ACTIVE",sessionStatus:"ACTIVE"},
  {id:20,schoolId:2,name:"Second Term",startDate:"2027-01-18",endDate:"2027-04-09",isCurrent:false,status:"ACTIVE",sessionStatus:"ACTIVE"},
];
const query=vi.fn(async(sql:string,_values?:unknown[])=>{
  if(sql.includes('s.status AS "sessionStatus"'))return {rows:terms};
  if(sql.includes('AS "currentCards"'))return {rows:[{uid:"6C98EABE",studentId:3,status,
    studentStatus:"ACTIVE",schoolStatus,employeeBindings:0,currentCards:1}]};
  if(sql.includes("SELECT action,reason"))return {rows:[{action,reason:"Synthetic launch fixture"}]};
  if(sql.includes("student_identification_policies"))return {rows:[{policy}]};
  if(sql.includes('AS "assignmentVersion"'))return {rows:[{version:1,assignmentVersion:1,now:new Date().toISOString(),events:[],latestGrace:null}]};
  if(sql.includes("AS nfc_payment_verified"))return {rows:[{nfc_payment_verified:paid}]};
  throw Error("Unexpected SQL: "+sql);
});
const read=()=>readStudentCardReadiness({query},101,2,3);
beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-11-02T12:00:00Z"));
  vi.clearAllMocks();action="REGISTERED";status="locked";paid=false;schoolStatus="ACTIVE";policy="NFC_ONLY";
  terms[0].isCurrent=true;terms[1].isCurrent=false;
  guards.subscription.mockResolvedValue(undefined);guards.device.mockResolvedValue(undefined);
});
afterEach(()=>vi.useRealTimers());
describe("real rollout shared by NFC activation and attendance",()=>{
  it.each(["REGISTERED","ASSIGNED","REASSIGNED"])("permits unpaid %s initial activation during the free term",async history=>{
    action=history;
    expect(await read()).toMatchObject({uid:"6C98EABE",stage:"AWAITING_ACTIVATION",canActivate:true,restrictions:[],
      subscriptionPolicy:{paymentRequired:false,collectionStartDate:"2027-01-18"}});
    expect(query.mock.calls.some(([sql])=>sql.includes("AS nfc_payment_verified"))).toBe(false);
    expect(query.mock.calls.every(([sql])=>!/\b(INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(true);
  });
  it("covers the synthetic Babatunde Solomon / Bobadex linked UID case without any payment or grace",async()=>{
    expect(await read()).toMatchObject({uid:"6C98EABE",studentId:3,schoolId:2,
      effectiveStatus:"AWAITING_ACTIVATION",statusSource:"CARD_STATE",canActivate:true,canGrantGrace:false});
    status="active";
    await expect(assertStudentCardUsePrerequisites({query},2,3,101)).resolves.toBeUndefined();
    expect(await read()).toMatchObject({canPrint:true,effectiveStatus:"ELIGIBLE"});
  });
  it("does not end free access on January 1 when the school's second term starts January 18",async()=>{
    vi.setSystemTime(new Date("2027-01-17T12:00:00Z"));
    await expect(assertVerifiedStudentNfcPayment({query},2,3)).resolves.toBeUndefined();
    expect(query.mock.calls.some(([sql])=>sql.includes("AS nfc_payment_verified"))).toBe(false);
  });
  it("requires verified payment at the configured January start for both activation and attendance",async()=>{
    vi.setSystemTime(new Date("2027-01-17T23:00:00Z")); // January 18 in Lagos
    terms[0].isCurrent=false;terms[1].isCurrent=true;
    expect(await read()).toMatchObject({canActivate:false,subscriptionPolicy:{paymentRequired:true},
      restrictions:[{code:"NFC_FLUTTERWAVE_PAYMENT_REQUIRED"}]});
    await expect(assertStudentCardUsePrerequisites({query},2,3,101)).rejects.toMatchObject({eventType:"NFC_FLUTTERWAVE_PAYMENT_REQUIRED"});
    paid=true;
    expect((await read()).canActivate).toBe(true);
    await expect(assertStudentCardUsePrerequisites({query},2,3,101)).resolves.toBeUndefined();
  });
  it("preserves security locks during free activation",async()=>{
    action="STATUS_CHANGED";
    expect(await read()).toMatchObject({stage:"SECURITY_LOCK",canActivate:false,canGrantGrace:false});
  });
  it("preserves school, identity and reader safeguards during the free term",async()=>{
    schoolStatus="LOCKED";policy="BIOMETRIC_ONLY";
    guards.device.mockRejectedValue(new AuthError(409,"Link a reader","NFC_DEVICE_REQUIRED"));
    const result=await read();
    expect(result.canActivate).toBe(false);
    expect(result.restrictions.map(r=>r.code)).toEqual(expect.arrayContaining(["SCHOOL_INACTIVE","IDENTIFICATION_POLICY_RESTRICTED","NFC_DEVICE_REQUIRED"]));
    await expect(assertStudentCardUsePrerequisites({query},2,3,101)).rejects.toMatchObject({eventType:"NFC_DEVICE_REQUIRED"});
  });
});
