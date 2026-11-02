import {beforeEach,describe,it,expect,vi} from "vitest";
const mocks=vi.hoisted(()=>({subscription:vi.fn(),payment:vi.fn(),device:vi.fn()}));
vi.mock("./subscription-enforcement",()=>({assertSubscriptionAccess:mocks.subscription}));
vi.mock("./student-nfc-payment-evidence",()=>({assertVerifiedStudentNfcPayment:mocks.payment}));
vi.mock("../lib/nfc-device-first",()=>({assertSchoolHasActiveNfcDevice:mocks.device}));
import {AuthError} from "../middlewares/auth";
import {readStudentCardReadiness} from "./student-card-readiness";
let card:any,history:any,policy:string;
const query=vi.fn(async(sql:string)=>{
  if(sql.includes('AS "currentCards"'))return {rows:card?[card]:[]};
  if(sql.includes("SELECT action,reason"))return {rows:history?[history]:[]};
  if(sql.includes("student_identification_policies"))return {rows:[{policy}]};
  throw Error("Unexpected SQL: "+sql);
});
beforeEach(()=>{
  vi.clearAllMocks();mocks.subscription.mockResolvedValue(undefined);mocks.payment.mockResolvedValue(undefined);mocks.device.mockResolvedValue(undefined);
  card={id:101,uid:"NEW12345",status:"locked",studentId:3,studentStatus:"ACTIVE",schoolStatus:"ACTIVE",employeeBindings:0,currentCards:1};
  history={action:"REGISTERED",reason:null};policy="NFC_ONLY";
});
const read=()=>readStudentCardReadiness({query},101,2,3);
describe("authoritative per-card readiness",()=>{
  it("explains the new card's staged lock without reading or copying a previous UID",async()=>{
    expect(await read()).toMatchObject({uid:"NEW12345",status:"locked",stage:"AWAITING_ACTIVATION",canActivate:true,canPrint:false,restrictions:[]});
    expect(query.mock.calls.every(([sql])=>!/UPDATE|INSERT|DELETE/.test(sql))).toBe(true);
  });
  it("distinguishes and retains a security lock's precise recorded reason",async()=>{
    history={action:"STATUS_CHANGED",reason:"Possession disputed"};
    const result=await read();
    expect(result.stage).toBe("SECURITY_LOCK");expect(result.explanation).toContain("Possession disputed");
    expect(result.canPrint).toBe(false);expect(card.status).toBe("locked");
  });
  it("does not invent a reason for legacy locks",async()=>{
    history=null;expect((await read()).explanation).toContain("No reason was recorded");
  });
  it.each(["lost","stolen","blocked","suspended","expired","replaced","inactive","unassigned"])("never offers unlock or print for %s",async status=>{
    card.status=status;card.currentCards=0;
    const result=await read();expect(result.canActivate).toBe(false);expect(result.canPrint).toBe(false);
    expect(result.restrictions.some(item=>item.code==="ASSIGNMENT_CONFLICT")).toBe(false);
  });
  it.each([
    {expiresAt:"2020-01-01"},{replacedAt:"2026-01-01"},{replacedByCardId:55},
    {studentStatus:"SUSPENDED"},{schoolStatus:"LOCKED"},{employeeBindings:1},{currentCards:2},
  ])("preserves lifecycle and identity restrictions %j",async fields=>{
    Object.assign(card,fields);const result=await read();
    expect(result.canActivate).toBe(false);expect(result.canPrint).toBe(false);expect(result.restrictions.length).toBeGreaterThan(0);
  });
  it("exposes exact payment failure and the existing payment resolution",async()=>{
    mocks.payment.mockRejectedValue(new AuthError(409,"Verified ₦3,200 current-term checkout is required","NFC_FLUTTERWAVE_PAYMENT_REQUIRED"));
    const result=await read();expect(result.canActivate).toBe(false);
    expect(result.restrictions[0]).toMatchObject({code:"NFC_FLUTTERWAVE_PAYMENT_REQUIRED",message:"Verified ₦3,200 current-term checkout is required"});
    expect(result.restrictions[0].resolution).toContain("cannot substitute payment");
  });
  it("does not offer printing when an active card has a school restriction",async()=>{
    card.status="active";mocks.subscription.mockRejectedValue(new AuthError(403,"School locked","SCHOOL_SUBSCRIPTION_LOCKED"));
    expect(await read()).toMatchObject({canPrint:false,restrictions:[{code:"SCHOOL_SUBSCRIPTION_LOCKED"}]});
  });
  it("does not override biometric-only identification policy",async()=>{
    policy="BIOMETRIC_ONLY";expect(await read()).toMatchObject({canActivate:false,restrictions:[{code:"IDENTIFICATION_POLICY_RESTRICTED"}]});
  });
  it("allows the saved active identity to be printed only after all guards pass",async()=>{
    card.status="active";expect(await read()).toMatchObject({canActivate:false,canPrint:true,uid:"NEW12345"});
    expect(mocks.subscription).toHaveBeenCalled();expect(mocks.payment).toHaveBeenCalled();expect(mocks.device).toHaveBeenCalled();
  });
  it("fails closed when the selected student changed",async()=>{
    card.studentId=4;await expect(read()).rejects.toMatchObject({statusCode:404});expect(mocks.payment).not.toHaveBeenCalled();
  });
});
