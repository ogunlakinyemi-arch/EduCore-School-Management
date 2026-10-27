import { describe, expect, it } from "vitest";
import { classifyStudentNfcPreview, subscriptionMinor, reconciliationDigest,
  type ReconciliationEvidence } from "./student-nfc-reconciliation-policy";

function fixture() {
  const student={id:31,school_id:1,first_name:"Fictional",last_name:"Student",admission_no:"QA-31",status:"ACTIVE",admission_status:"ADMITTED"};
  const term={id:4,school_id:1,academic_session_id:3,name:"First term",status:"ACTIVE",start_date:"2026-09-01",end_date:"2026-12-20"};
  const session={id:3,school_id:1,status:"ACTIVE"};
  const evidence: ReconciliationEvidence={
    student_subscription_terms:[{school_id:1,student_id:31,academic_session_id:3,academic_term_id:4,subscription_id:7,legacy_invoice_id:null}],
    subscriptions:[{id:7,school_id:1,student_id:31,term:"First term",amount:"5000.00",status:"pending",verification_status:"pending",
      provider_reference:null,expires_at:"2026-12-21T00:00:00Z"}],
  };
  return {student,term,session,evidence,schoolId:1,complete:true,today:"2026-10-27"};
}
describe("unpaid student NFC reconciliation policy: proposals never apply",()=>{
  it("proposes 3200 for a single unattempted unpaid bound obligation without changing it",()=>{
    const f=fixture(), before=JSON.stringify(f);
    expect(classifyStudentNfcPreview(f)).toMatchObject({status:"CANDIDATE_AFTER_REVIEW",originalAmountMinor:500000,
      originalOutstandingMinor:500000,proposedPlatformAmountMinor:320000});
    expect(JSON.stringify(f)).toBe(before);
  });
  it("labels a genuinely new term obligation separately",()=>{
    const f=fixture(); f.evidence.subscriptions=[];f.evidence.student_subscription_terms=[];
    expect(classifyStudentNfcPreview(f)).toMatchObject({status:"NEW_OBLIGATION_AFTER_REVIEW",originalOutstandingMinor:null,proposedPlatformAmountMinor:320000});
  });
  it("preserves completed and waived history without proposing another charge",()=>{
    for(const state of ["active","waived"]) {
      const f=fixture();Object.assign(f.evidence.subscriptions[0],{status:state,verification_status:"verified",provider_reference:"KEEP-ORIGINAL"});
      expect(classifyStudentNfcPreview(f)).toMatchObject({status:"PRESERVE_COMPLETED_HISTORY",originalOutstandingMinor:0,proposedPlatformAmountMinor:null,
        paymentReferences:["KEEP-ORIGINAL"]});
    }
  });
  it.each(["PENDING","FAILED","RECONCILIATION_REQUIRED"])("holds even a locally %s provider attempt until independently reconciled",status=>{
    const f=fixture(); f.evidence.student_subscription_payments=[{id:1,subscription_id:7,school_id:1,student_id:31,
      academic_session_id:3,academic_term_id:4,status,reference:"ORIGINAL-ATTEMPT",gross_amount_minor:500000}];
    expect(classifyStudentNfcPreview(f)).toMatchObject({status:"OWNER_REVIEW",proposedPlatformAmountMinor:null});
    expect(classifyStudentNfcPreview(f).reasons).toContain("PROVIDER_HISTORY_REQUIRES_INDEPENDENT_RECONCILIATION");
  });
  it("preserves a paid provider record even if its subscription flag is stale",()=>{
    const f=fixture();f.evidence.student_subscription_payments=[{id:1,subscription_id:7,school_id:1,student_id:31,
      academic_session_id:3,academic_term_id:4,status:"PAID",reference:"ORIGINAL-PAID"}];
    expect(classifyStudentNfcPreview(f).status).toBe("PRESERVE_COMPLETED_HISTORY");
  });
  it.each(["duplicate","wrong-school","wrong-term-session","missing-binding","inactive-student","ended-term","missing-source"])("holds unsafe evidence: %s",change=>{
    const f=fixture();
    if(change==="duplicate")f.evidence.subscriptions.push({...f.evidence.subscriptions[0],id:8});
    if(change==="wrong-school")f.evidence.subscriptions[0].school_id=2;
    if(change==="wrong-term-session")f.evidence.student_subscription_terms[0].academic_session_id=2;
    if(change==="missing-binding")f.evidence.student_subscription_terms=[];
    if(change==="inactive-student")f.student.status="INACTIVE";
    if(change==="ended-term")f.term.end_date="2026-09-01";
    if(change==="missing-source")f.complete=false;
    expect(classifyStudentNfcPreview(f)).toMatchObject({status:"OWNER_REVIEW",proposedPlatformAmountMinor:null});
  });
  it("does not subtract parent-to-school payments from the independent platform price",()=>{
    const f=fixture();
    f.evidence.fee_invoices=[{id:11,school_id:1,student_id:31,academic_session_id:3,academic_term_id:4,
      total_minor:900000,paid_minor:400000,outstanding_minor:500000}];
    f.evidence.fee_invoice_lines=[{id:21,school_id:1,invoice_id:11,category_name_snapshot:"NFC Card & EduCore Subscription Fee",amount_minor:900000}];
    f.evidence.fee_payments=[{id:22,school_id:1,invoice_id:11,status:"VERIFIED",amount_minor:400000,reference:"PARENT-SCHOOL-ONLY"}];
    f.evidence.fee_receipts=[{school_id:1,invoice_id:11,payment_id:22,receipt_number:"KEEP-RECEIPT"}];
    expect(classifyStudentNfcPreview(f)).toMatchObject({status:"OWNER_REVIEW",originalAmountMinor:500000,originalOutstandingMinor:null,
      proposedPlatformAmountMinor:null,schoolFeeTotalMinor:900000,schoolFeePaidMinor:400000,schoolFeeOutstandingMinor:500000,
      receiptNumbers:["KEEP-RECEIPT"]});
  });
  it("flags a ledger mismatch and pending parent claim rather than inventing a balance",()=>{
    const f=fixture();f.evidence.student_subscription_terms[0]={...f.evidence.student_subscription_terms[0],subscription_id:null,legacy_invoice_id:11};
    f.evidence.fee_invoices=[{id:11,school_id:1,student_id:31,academic_term_id:4,academic_session_id:3,total_minor:500000,paid_minor:100000,outstanding_minor:500000}];
    f.evidence.fee_payments=[{invoice_id:11,status:"PENDING",amount_minor:100000}];
    const row=classifyStudentNfcPreview(f);
    expect(row.status).toBe("OWNER_REVIEW");expect(row.reasons).toContain("SCHOOL_BALANCE_DOES_NOT_RECONCILE");
    expect(row.reasons).toContain("PENDING_PARENT_PAYMENT_CLAIM");
  });
  it("holds refunds, disputes and allocation remnants",()=>{
    for(const name of ["fee_refunds","deferred_commission_adverse_events","flutterwave_split_adjustments","student_subscription_allocations"]) {
      const f=fixture();f.evidence[name]=[{subscription_id:7,payment_id:1,event_type:"DISPUTE"}];
      expect(classifyStudentNfcPreview(f).status).toBe("OWNER_REVIEW");
    }
  });
  it("does not ignore hosted or LIVE attempts whose original references must be reconciled",()=>{
    for(const name of ["hosted_checkout_orders","flutterwave_live_subscription_intents"]) {
      const f=fixture();f.evidence[name]=[{id:11,school_id:1,student_id:31,term_id:4,reference:"ORIGINAL-EXTERNAL"}];
      expect(classifyStudentNfcPreview(f)).toMatchObject({status:"OWNER_REVIEW",proposedPlatformAmountMinor:null,paymentReferences:["ORIGINAL-EXTERNAL"]});
    }
  });
  it("detects cross-student payment identity and duplicate references",()=>{
    const f=fixture();const p={id:1,subscription_id:7,school_id:1,student_id:32,academic_session_id:3,academic_term_id:4,status:"PENDING",reference:"DUPLICATE"};
    f.evidence.student_subscription_payments=[p,{...p,id:2}];
    const row=classifyStudentNfcPreview(f);
    expect(row.reasons).toContain("PAYMENT_IDENTITY_MISMATCH");expect(row.reasons).toContain("DUPLICATE_PAYMENT_REFERENCE");
  });
  it("uses exact decimal amounts and rejects malformed or unsafe values",()=>{
    expect(subscriptionMinor("5000.00")).toBe(500000);expect(subscriptionMinor("3200")).toBe(320000);
    for(const value of ["32.001","-5000","NaN","1e3","9007199254740991",null])expect(subscriptionMinor(value)).toBeNull();
  });
  it("fingerprints canonical evidence and changes the fingerprint on financial edits",()=>{
    expect(reconciliationDigest({b:2,a:1})).toBe(reconciliationDigest({a:1,b:2}));
    const f=fixture(), before=classifyStudentNfcPreview(f).evidenceDigest;
    f.evidence.subscriptions[0].amount="5100.00";
    expect(classifyStudentNfcPreview(f).evidenceDigest).not.toBe(before);
  });
  it("does not confuse a positively bound prior-year term with an ambiguous duplicate",()=>{
    const f=fixture();
    f.evidence.subscriptions.push({...f.evidence.subscriptions[0],id:6,expires_at:"2025-12-21T00:00:00Z",status:"active",verification_status:"verified"});
    f.evidence.student_subscription_terms.push({school_id:1,student_id:31,academic_session_id:2,academic_term_id:9,subscription_id:6});
    expect(classifyStudentNfcPreview(f).status).toBe("CANDIDATE_AFTER_REVIEW");
  });
});
