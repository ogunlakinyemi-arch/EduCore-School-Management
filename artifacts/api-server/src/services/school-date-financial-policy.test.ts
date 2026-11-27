import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";
import {nfcTermWindow,lagosDate} from "./nfc-term-grace";
import {studentRolloutDecision} from "./student-platform-rollout";
import {advanceCheckoutOpen} from "./advance-subscription-policy";
import {financialScheduleDay,financialReminderScope,financialSnapshot,parseFinancialReminder} from "./financial-reminder-policy";
import {schoolFeeCarryForward,publishedSchoolInvoiceSql} from "./school-fee-carry-forward";
import {isReservedPlatformNfcCategory,isSystemNfcCategory} from "../lib/student-nfc-policy";
const end="2028-07-31";
describe("school-saved term dates, not a January/second-term anchor",()=>{
 it.each([
  ["First Term","2026-09-07","2026-09-13","2026-09-14"],
  ["Second Term","2027-02-01","2027-02-07","2027-02-08"],
  ["Third Term","2027-04-26","2027-05-02","2027-05-03"],
  ["First Term","2027-12-28","2028-01-03","2028-01-04"],
 ])("%s starts NFC collection only at D+7",(name,start,lastGrace,opens)=>{
  const t={id:12,schoolId:1,name,startDate:start,endDate:end,isCurrent:true,status:"ACTIVE",sessionStatus:"ACTIVE"};
  for(const day of [start,lastGrace]){
   expect(studentRolloutDecision([t],1,12,day)).toMatchObject({chargeable:false,inGracePeriod:true,collectionStartDate:opens});
   expect(advanceCheckoutOpen(day,start,end,true,true,"ACTIVE","ACTIVE")).toBe(false);
  }
  expect(studentRolloutDecision([t],1,12,opens)).toMatchObject({chargeable:true,inGracePeriod:false});
  expect(advanceCheckoutOpen(opens,start,end,true,true,"ACTIVE","ACTIVE")).toBe(true);
 });
 it("keeps schools independent and refuses ambiguous/missing current terms",()=>{
  const a={id:1,schoolId:1,name:"Third Term",startDate:"2027-04-26",endDate:end,isCurrent:true,status:"ACTIVE",sessionStatus:"ACTIVE"};
  const b={...a,id:2,schoolId:2,startDate:"2027-05-03"};
  expect(studentRolloutDecision([a,b],1,undefined,"2027-05-03").chargeable).toBe(true);
  expect(studentRolloutDecision([a,b],2,undefined,"2027-05-03")).toMatchObject({chargeable:false,inGracePeriod:true});
  expect(studentRolloutDecision([a,{...a,id:3}],1,undefined,"2027-05-03").chargeable).toBe(false);
  expect(studentRolloutDecision([],1,undefined,"2027-05-03").chargeable).toBe(false);
 });
 it("rejects impossible dates and expired terms",()=>{
  expect(()=>nfcTermWindow("2027-02-30",end,"2027-03-09")).toThrow("INVALID");
  expect(nfcTermWindow("2027-01-18","2027-04-09","2027-04-10").checkoutOpen).toBe(false);
 });
 it("uses WAT date rollover and has no runtime clock/environment override",()=>{
  expect(lagosDate(new Date("2027-01-24T22:59:59Z"))).toBe("2027-01-24");
  expect(lagosDate(new Date("2027-01-24T23:00:00Z"))).toBe("2027-01-25");
  expect(readFileSync(new URL("./nfc-term-grace.ts",import.meta.url),"utf8")).not.toMatch(/process\.env|clockOverride|FAKE_DATE/);
 });
});
describe("fixed weekly schedule and retained original balances",()=>{
 it.each([
  ["2027-01-24T22:59:59Z",null],["2027-01-24T23:00:00Z","2027-01-25"],
  ["2027-01-25T22:59:59Z","2027-01-25"],["2027-01-25T23:00:00Z",null],
  ["2027-01-28T23:00:00Z","2027-01-29"],["2027-01-29T23:00:00Z",null],
 ])("selects Monday/Friday only at %s",(now,day)=>expect(financialScheduleDay(new Date(now))).toBe(day));
 it("binds day, obligation, term and immutable balance snapshot",()=>{
  const scope=financialReminderScope("2027-01-25","FEE",44,7),digest=financialSnapshot([44,1200,800]);
  expect(parseFinancialReminder(scope+digest)).toMatchObject({kind:"FEE",entity:44,term:7,digest});
  expect(parseFinancialReminder(scope.replace("2027-01-25","2027-01-26")+digest)).toBeNull();
  expect(parseFinancialReminder(scope+"bad")).toBeNull();
  expect(financialSnapshot([44,1200,0])).not.toBe(digest);
 });
 it("carries original adjusted/refunded balances without new invoice ids or a term reset",()=>{
  const input=[
   {id:3,academicTermId:2,dueDate:"2027-01-25",outstandingMinor:900,paidMinor:100,status:"PARTIALLY_PAID"},
   {id:1,academicTermId:1,dueDate:"2026-10-01",outstandingMinor:600,paidMinor:400,status:"PARTIALLY_PAID"},
   {id:2,academicTermId:1,dueDate:"2026-10-01",outstandingMinor:0,paidMinor:1000,status:"PAID"},
   {id:4,academicTermId:1,dueDate:"2026-10-01",outstandingMinor:500,paidMinor:0,status:"CANCELLED"},
  ];
  const before=structuredClone(input),r=schoolFeeCarryForward(input,2,"2027-01-25");
  expect(r).toMatchObject({outstandingMinor:1500,arrearsMinor:600,overdueMinor:600});
  expect(r.invoices.map(i=>i.id)).toEqual([1,2,3]);expect(input).toEqual(before);
  expect(schoolFeeCarryForward(input,3,"2027-04-26").outstandingMinor).toBe(1500);
 });
 it("requires published school provenance, never classifies a fee by its price",()=>{
  expect(publishedSchoolInvoiceSql()).toMatch(/published_by IS NOT NULL/);
  expect(publishedSchoolInvoiceSql()).toMatch(/legacy_invoice_id/);
  expect(publishedSchoolInvoiceSql()).not.toMatch(/320000|500000|15000/);
  expect(isReservedPlatformNfcCategory("School NFC Card & EduCore Subscription Fee")).toBe(false);
  expect(isReservedPlatformNfcCategory("NFC Card Subscription")).toBe(true);
  expect(isSystemNfcCategory("School NFC Subscription")).toBe(true); // old detector retained for history
 });
});
