/** Authored seam tests of exact binding; canonical SQL is not reproduced here. */
import {beforeEach,it,expect,vi} from "vitest";
const m=vi.hoisted(()=>({
 advanced:vi.fn(),ordinary:vi.fn(),report:vi.fn(),rollout:vi.fn(),
 configuration:vi.fn(),queries:[] as string[],open:true,
 allocations:[] as any[],
}));
vi.mock("./advance-subscription-authorizations",()=>({findAdvanceReview:m.advanced}));
vi.mock("./direct-student-live-release",()=>({findApprovedDirectReview:m.ordinary}));
vi.mock("../lib/flutterwave-direct-live-config",()=>({directLiveConfiguration:m.configuration}));
vi.mock("./student-platform-rollout",()=>({readStudentUsageRollout:m.rollout}));
vi.mock("./student-nfc-reconciliation",()=>({
 NFC_PREVIEW_SOURCES:{students:["id","school_id"]},previewPinnedCurrentReconciliation:m.report,
}));
import {revalidateBulkRetry} from "./bulk-retry-authorization";
const saved={studentId:2,reviewId:10,ruleId:1,reviewDigest:"a".repeat(64),merchantScope:"fixture-merchant",amountMinor:320000};
const review={id:10,rule_id:1,report_digest:saved.reviewDigest,merchant_scope:saved.merchantScope};
const batch={id:1,school_id:1,academic_term_id:1,amount_minor:320000,snapshot:{students:[saved]}};
const c={query:async(sql:string)=>{
 m.queries.push(sql);
 if(sql.includes("FOR SHARE OF t,s"))return {rows:m.open?[{id:1}]:[]};
 if(sql.includes("FROM current_bulk_allocations"))return {rows:m.allocations};
 if(sql.includes("FROM pg_class"))return {rows:[{relname:"students"}]};
 if(sql.startsWith("LOCK TABLE"))return {rows:[]};
 throw Error("Unexpected authorization fixture SQL");
}};
beforeEach(()=>{
 vi.clearAllMocks();m.open=true;m.queries=[];
 m.allocations=[{student_id:2,school_id:1,academic_term_id:1,review_id:10,student_status:"ACTIVE",admission_status:"ADMITTED"}];
 m.configuration.mockReturnValue({ready:true,merchantScope:"fixture-merchant",callbackUrl:"https://example.invalid/callback",webhookUrl:"https://example.invalid/webhook"});
 m.rollout.mockResolvedValue({chargeable:true});m.advanced.mockResolvedValue({...review});
 m.ordinary.mockResolvedValue({...review});m.report.mockResolvedValue({sourceStatus:"COMPLETE",evidenceDigest:saved.reviewDigest});
});
it("uses fresh configured merchant/endpoints and the locked canonical advance evaluator",async()=>{
 await revalidateBulkRetry(c,batch);
 expect(m.advanced).toHaveBeenCalledWith(c,{schoolId:1,termId:1,studentId:2},{configuration:m.configuration.mock.results[0].value},true);
 expect(m.ordinary).not.toHaveBeenCalled();
});
it.each(["withdrawn","expired","materially stale"])("does not fall back to an ordinary/older review for %s advance evidence",async()=>{
 m.advanced.mockResolvedValue(null);
 await expect(revalidateBulkRetry(c,batch)).rejects.toThrow("RETRY_REVIEW_STALE_WITHDRAWN_OR_EXPIRED");
 expect(m.ordinary).not.toHaveBeenCalled();
});
it.each([{id:11},{rule_id:2},{report_digest:"b".repeat(64)},{merchant_scope:"another-merchant"}])(
 "rejects replacement approval or changed exact retained evidence %j",async changed=>{
 m.advanced.mockResolvedValue({...review,...changed});
 await expect(revalidateBulkRetry(c,batch)).rejects.toThrow("RETRY_REVIEW_STALE_WITHDRAWN_OR_EXPIRED");
});
it("reconciles ordinary approvals on the pinned transaction with source table locks",async()=>{
 m.advanced.mockResolvedValue(undefined);await revalidateBulkRetry(c,batch);
 expect(m.queries.some(q=>q.startsWith('LOCK TABLE public."students" IN SHARE MODE'))).toBe(true);
 expect(m.report).toHaveBeenCalledWith(c,{schoolId:1,termId:1});
 expect(m.ordinary).toHaveBeenCalledWith(c,{schoolId:1,termId:1,studentId:2},saved.reviewDigest,expect.anything(),true);
 expect(m.queries.some(q=>q.startsWith("BEGIN"))).toBe(false);
});
it("blocks a changed current calendar before canonical evaluation",async()=>{
 m.open=false;
 await expect(revalidateBulkRetry(c,batch)).rejects.toThrow("RETRY_CALENDAR_NOT_CURRENT_OR_OPEN");
 expect(m.advanced).not.toHaveBeenCalled();
});
it("blocks a free grant or no-longer-chargeable term",async()=>{
 m.rollout.mockResolvedValue({chargeable:false});
 await expect(revalidateBulkRetry(c,batch)).rejects.toThrow("FREE_OR_INELIGIBLE_TERM");
});
it("blocks unavailable release/endpoint configuration and changed merchant scope",async()=>{
 m.configuration.mockReturnValue({ready:false});
 await expect(revalidateBulkRetry(c,batch)).rejects.toThrow("DIRECT_LIVE_RELEASE_NOT_ENABLED");
 m.configuration.mockReturnValue({ready:true,merchantScope:"changed-merchant"});
 await expect(revalidateBulkRetry(c,batch)).rejects.toThrow("RETRY_MERCHANT_EVIDENCE_CHANGED");
});
it("blocks inactive or moved students and incomplete reconciliation",async()=>{
 m.allocations[0].student_status="INACTIVE";
 await expect(revalidateBulkRetry(c,batch)).rejects.toThrow("RETRY_STUDENT_OR_FROZEN_REVIEW_CHANGED");
 m.allocations[0].student_status="ACTIVE";m.advanced.mockResolvedValue(undefined);
 m.report.mockResolvedValue({sourceStatus:"INCOMPLETE"});
 await expect(revalidateBulkRetry(c,batch)).rejects.toThrow("RETRY_RECONCILIATION_INCOMPLETE");
});
