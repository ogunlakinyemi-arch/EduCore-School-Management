import { describe,expect,it,vi } from "vitest";
import { isStudentCoreOperation } from "./student-platform-access";
import { ensureStudentNfcSubscription } from "../lib/student-nfc-obligations";
describe("student essential and core access paths",()=>{
  it.each(["/api/academic/students/me/assignments","/academic/assessments","/library/books","/reports/exam/export","/student/attendance","/exam-record/results","/API/ACADEMIC/students/me/assignments","/api/%6cibrary/books"])("protects %s",path=>expect(isStudentCoreOperation(path)).toBe(true));
  it.each(["/auth/me","/student/platform-subscription-access","/student/profile","/parent/fees/invoices","/subscriptions/7/payments/9","/communication/inbox","/academic/calendar","/transport/me","/student-care/me","/notification-preferences"])("preserves essential route %s",path=>expect(isStudentCoreOperation(path)).toBe(false));
  it("retains an existing term binding without modifying or repricing it",async()=>{
    const existing={subscriptionId:8,legacyInvoiceId:null};
    const query=vi.fn(async(_text:string)=>({rows:[existing]}));
    expect(await ensureStudentNfcSubscription({query},1,2,3,4)).toEqual(existing);
    expect(query).toHaveBeenCalledTimes(1);expect(query.mock.calls[0]?.[0]).toMatch(/^SELECT/);
  });
  it("does not create or convert a legacy split obligation without an approved engine",async()=>{
    const sql:string[]=[];const query=vi.fn(async(text:string)=>{sql.push(text);return{rows:[]};});
    expect(await ensureStudentNfcSubscription({query},1,2,3,4)).toBeNull();
    expect(sql.length).toBe(1);expect(sql[0]).toMatch(/^SELECT/);
    expect(sql.join(" ")).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/);
  });
});
