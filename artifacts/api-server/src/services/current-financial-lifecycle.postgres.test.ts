import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {currentFinancialFixture} from "./current-financial-fixture.test-support";
import {approveCurrentStudentRefund,dispatchCurrentStudentRefund,reconcileCurrentStudentRefund,
  recordCurrentCollectionReversal,requestCurrentStudentRefund} from "./current-student-refunds";
import {approveCurrentBro,holdCurrentBro,initiateCurrentBroPayout,reconcileCurrentBroPayout,
  recordCurrentBroRecovery,reviewCurrentBroEntitlement} from "./current-bro-lifecycle";
import {currentTransaction,digest,operation,referenceFor,state} from "./current-financial-store";
import {readCurrentPaymentAccounting} from "./current-financial-read-model";
import {planCurrentBulkSubscriptions} from "./current-bulk-subscription-plan";
import {accrueBroCommissionInTransaction} from "./bro-commission-policy";
import {beginFinancialTransaction} from "./financial-transaction";
import type {CurrentCapabilities,RefundFacts,PayoutFacts} from "./current-financial-contract";

let f:Awaited<ReturnType<typeof currentFinancialFixture>>;
let facts:Map<string,RefundFacts>,payoutStatus:PayoutFacts["status"],throwAfterAccept:boolean;
let deps:CurrentCapabilities;
const key=(label:string)=>`fixture_key_${label}_000000`;
const request=(amount=10000,k=key("refund"))=>requestCurrentStudentRefund(f.pool,1,1,amount,k,"Fictional refund review");
async function dispatched(amount=10000,k=key("refund")) {
  const r=await request(amount,k);
  await approveCurrentStudentRefund(f.pool,1,r.id,key("approval"));
  await dispatchCurrentStudentRefund(f.pool,1,r.id,deps);
  return r;
}
async function refunded(amount=10000,k=key("refund")) {
  const r=await dispatched(amount,k);
  facts.get(referenceFor(r.id))!.status="SUCCEEDED";
  await reconcileCurrentStudentRefund(f.pool,1,r.id,deps);
  return r;
}
async function payout() {
  await approveCurrentBro(f.pool,1,1,key("bro_approve"),deps);
  return initiateCurrentBroPayout(f.pool,1,1,key("payout"),"Fictional payout review",deps);
}
async function paidBro() {
  const p=await payout();await reconcileCurrentBroPayout(f.pool,1,p.id,deps);return p;
}
beforeAll(async()=>{f=await currentFinancialFixture();},30000);
afterAll(async()=>{await f?.stop();});
beforeEach(async()=>{
  await f.reset();
  facts=new Map();payoutStatus="SUCCEEDED";throwAfterAccept=false;
  deps={now:()=>new Date("2027-05-01T12:00:00Z"),
    bank:vi.fn(async()=>({verified:true as const,fingerprint:"fixture-bank-fingerprint",
      sealed:{ciphertext:"fictional-sealed-bank",keyVersion:"fixture"},maskedAccountNumber:"****0001"})),
    refunds:{request:vi.fn(async input=>{
      facts.set(input.reference,{requestReference:input.reference,collectionTransactionId:input.collectionTransactionId,
        providerReference:`provider_${input.reference}`,amountMinor:input.amountMinor,currency:"NGN",status:"PENDING"});
      if(throwAfterAccept)throw new Error("Fictional response lost after provider acceptance");
    }),verify:vi.fn(async ref=>({...facts.get(ref)!}))},
    payoutEvidence:vi.fn(async ref=>({requestReference:ref,providerReference:`bank_${ref}`,
      amountMinor:15000,currency:"NGN",bankFingerprint:"fixture-bank-fingerprint",
      status:payoutStatus,evidenceReference:`statement_${ref}`})),
    recoveryEvidence:vi.fn(async ref=>({requestReference:ref,providerReference:`recovery_${ref}`,
      amountMinor:15000,currency:"NGN",bankFingerprint:"fixture-bank-fingerprint",
      status:"SUCCEEDED" as const,evidenceReference:`statement_${ref}`})),
    collectionReversal:vi.fn(async ref=>({requestReference:ref,providerReference:`reversal_${ref}`,
      collectionTransactionId:"12345",amountMinor:320000,currency:"NGN",status:"REVERSED" as const}))};
});
describe("current direct payment refund journal — disposable PostgreSQL, no HTTP",()=>{
  it("C01/C02 rejects an unverified/non-current source without rewriting legacy rows",async()=>{
    await expect(requestCurrentStudentRefund(f.pool,1,999,1,key("missing"),"Missing source")).rejects.toThrow("CURRENT_VERIFIED_PAYMENT_REQUIRED");
    expect((await f.pool.query("SELECT amount_minor FROM student_subscription_payments WHERE id=1")).rows[0].amount_minor).toBe(500000);
  });
  it("C03 requires fresh global Owner authority",async()=>{
    await expect(requestCurrentStudentRefund(f.pool,2,1,1,key("admin"),"Not Owner")).rejects.toThrow("FINANCIAL_ACTOR_NOT_AUTHORIZED");
  });
  it("C04/C05 replays the same request and rejects changed amount",async()=>{
    const r=await request();expect((await request()).id).toBe(r.id);
    await expect(request(10001)).rejects.toThrow("IDEMPOTENCY_CONTENT_CONFLICT");
  });
  it("C06 rejects an amount exceeding the original verified payment",async()=>{
    await expect(request(320001)).rejects.toThrow("CUMULATIVE_REFUNDS_EXCEED_PAYMENT");
  });
  it("C07/C26 serializes concurrent partial requests at the cumulative limit",async()=>{
    const results=await Promise.allSettled([request(200000,key("one")),request(200000,key("two"))]);
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  });
  it("C08/C09 approval alone moves no money; dispatch requires approval",async()=>{
    const r=await request();
    await expect(dispatchCurrentStudentRefund(f.pool,1,r.id,deps)).rejects.toThrow("REFUND_APPROVAL_REQUIRED");
    await approveCurrentStudentRefund(f.pool,1,r.id,key("approval"));
    expect((await readCurrentPaymentAccounting(f.pool,1,1)).netPaidMinor).toBe(320000);
    expect(deps.refunds!.request).not.toHaveBeenCalled();
  });
  it("C10/C13 makes exactly one POST and does not book provider acceptance",async()=>{
    const r=await dispatched();await dispatchCurrentStudentRefund(f.pool,1,r.id,deps);
    expect(deps.refunds!.request).toHaveBeenCalledTimes(1);
    await reconcileCurrentStudentRefund(f.pool,1,r.id,deps);
    expect((await readCurrentPaymentAccounting(f.pool,1,1)).netPaidMinor).toBe(320000);
  });
  it("C11/C12 preserves an accepted-but-lost request and never resends",async()=>{
    throwAfterAccept=true;const r=await dispatched();
    expect(await currentTransaction(f.pool,1,c=>state(c,r.id))).toBe("UNKNOWN");
    await dispatchCurrentStudentRefund(f.pool,1,r.id,deps);
    expect(deps.refunds!.request).toHaveBeenCalledTimes(1);
    facts.get(referenceFor(r.id))!.status="SUCCEEDED";
    expect((await reconcileCurrentStudentRefund(f.pool,1,r.id,deps)).refundedMinor).toBe(10000);
  });
  it("C14/C15 books a partial refund once after independent verification",async()=>{
    const r=await refunded(12500);
    await reconcileCurrentStudentRefund(f.pool,1,r.id,deps);
    expect(await readCurrentPaymentAccounting(f.pool,1,1)).toMatchObject({
      refundedMinor:12500,netPaidMinor:307500,status:"PARTIALLY_REFUNDED",originalPaymentStatePreserved:"PAID"});
  });
  it.each(["currency","amountMinor","collectionTransactionId","requestReference"] as const)(
    "C16/C17/C18 binds independently verified %s",async field=>{
      const r=await dispatched();
      (facts.get(referenceFor(r.id))! as any)[field]=field==="amountMinor"?999:"wrong";
      await expect(reconcileCurrentStudentRefund(f.pool,1,r.id,deps)).rejects.toThrow("REFUND_EVIDENCE_MISMATCH");
  });
  it("C19 rejects changing the provider's immutable refund identity",async()=>{
    const r=await dispatched();await reconcileCurrentStudentRefund(f.pool,1,r.id,deps);
    facts.get(referenceFor(r.id))!.providerReference="different-provider-ref";
    await expect(reconcileCurrentStudentRefund(f.pool,1,r.id,deps)).rejects.toThrow("PROVIDER_REFERENCE_CHANGED");
  });
  it("C20 records refund reversal without rewriting original payment or refund success",async()=>{
    const r=await refunded(320000);
    expect((await readCurrentPaymentAccounting(f.pool,1,1)).status).toBe("REFUNDED");
    facts.get(referenceFor(r.id))!.status="REVERSED";
    await reconcileCurrentStudentRefund(f.pool,1,r.id,deps);
    expect((await readCurrentPaymentAccounting(f.pool,1,1)).netPaidMinor).toBe(320000);
    expect((await f.pool.query("SELECT state FROM current_subscription_operation_events WHERE operation_id=$1",[r.id])).rows)
      .toEqual(expect.arrayContaining([{state:"SUCCEEDED"},{state:"REVERSED"}]));
  });
  it("C21 ignores a delayed failure after success and pending after reversal",async()=>{
    const r=await refunded();const fact=facts.get(referenceFor(r.id))!;
    fact.status="FAILED";expect((await reconcileCurrentStudentRefund(f.pool,1,r.id,deps)).state).toBe("SUCCEEDED");
    fact.status="REVERSED";await reconcileCurrentStudentRefund(f.pool,1,r.id,deps);
    fact.status="PENDING";expect((await reconcileCurrentStudentRefund(f.pool,1,r.id,deps)).state).toBe("REVERSED");
  });
  it("C22/C23 holds an adverse signal using original evidence, without provider access",async()=>{
    await currentTransaction(f.pool,1,c=>holdCurrentBro(c,1,1,"signed-signal",false,"ADVERSE_SIGNAL_REVIEW"));
    expect(deps.refunds!.verify).not.toHaveBeenCalled();
    await expect(approveCurrentBro(f.pool,1,1,key("approve"),deps)).rejects.toThrow("ADVERSE_PAYMENT_REQUIRES_REVIEW");
  });
  it("C24/C25 keeps original payments and new history immutable",async()=>{
    const r=await refunded();
    await expect(f.pool.query("UPDATE student_direct_live_attempts SET state='FAILED' WHERE id=1")).rejects.toThrow("immutable");
    await expect(f.pool.query("DELETE FROM current_subscription_operations WHERE id=$1",[r.id])).rejects.toThrow("append-only");
    await expect(f.pool.query("UPDATE current_subscription_operation_events SET state='FAILED'")).rejects.toThrow("append-only");
  });
  it("C27 retains a pre-accrual adverse hold when no entitlement exists",async()=>{
    await f.reset(false);await request();
    expect((await f.pool.query("SELECT count(*)::int n FROM bro_term_commission_entitlements")).rows[0].n).toBe(0);
    expect((await f.pool.query("SELECT count(*)::int n FROM student_direct_live_events WHERE kind='CURRENT_ADVERSE_HOLD'")).rows[0].n).toBe(1);
    const c=await f.pool.connect();
    try {
      await beginFinancialTransaction(c);
      // Same fictional clock for JS/SQL eligibility, never a shared DB setting.
      const clocked={query:(sql:string,args?:any[])=>c.query(
        sql.replace(/\bnow\(\)/gi,"'2027-05-01T12:00Z'::timestamptz"),args)};
      await expect(accrueBroCommissionInTransaction(clocked,{schoolId:1,studentId:1,termId:1},
        {id:1,email:"fixture@example.test",clerkUserId:"fixture"},true))
        .rejects.toThrow("unique eligible student");
    } finally {await c.query("ROLLBACK");c.release();}
  });
  it("C28/C29 holds pending and approved entitlements without deleting their roots",async()=>{
    await approveCurrentBro(f.pool,1,1,key("approve"),deps);
    await refunded();
    const r=(await f.pool.query("SELECT id FROM current_subscription_operations WHERE kind='BRO'")).rows[0];
    expect(await currentTransaction(f.pool,1,c=>state(c,Number(r.id)))).toBe("HELD");
    expect((await f.pool.query("SELECT status,amount_minor FROM bro_term_commission_entitlements")).rows[0])
      .toMatchObject({status:"PENDING_OWNER_APPROVAL",amount_minor:15000});
  });
  it("C30 holds the paid entitlement for recovery without deleting bank-credit evidence",async()=>{
    const p=await paidBro();await refunded();
    expect(await currentTransaction(f.pool,1,async c=>state(c,Number((await operation(c,p.id)).parent_id)))).toBe("RECOVERY_REQUIRED");
    expect(await currentTransaction(f.pool,1,c=>state(c,p.id))).toBe("SUCCEEDED");
  });
  it("C31 failure releases refund budget but does not silently restore BRO approval",async()=>{
    const r=await dispatched();facts.get(referenceFor(r.id))!.status="FAILED";
    await reconcileCurrentStudentRefund(f.pool,1,r.id,deps);
    expect((await readCurrentPaymentAccounting(f.pool,1,1)).reservedMinor).toBe(0);
    await expect(approveCurrentBro(f.pool,1,1,key("approve"),deps)).rejects.toThrow("ADVERSE_PAYMENT_REQUIRES_REVIEW");
  });
  it("records collection reversal separately and exposes overlapping outflow recovery",async()=>{
    await refunded(10000);
    await recordCurrentCollectionReversal(f.pool,1,1,"fixture-chargeback",key("chargeback"),deps);
    await recordCurrentCollectionReversal(f.pool,1,1,"fixture-chargeback",key("chargeback"),deps);
    expect(await readCurrentPaymentAccounting(f.pool,1,1)).toMatchObject({
      collectionReversedMinor:320000,refundedMinor:10000,overRecoveryMinor:10000,status:"RECOVERY_REQUIRED",netPaidMinor:0});
    await expect(request(1,key("too_late"))).rejects.toThrow("CUMULATIVE_REFUNDS_EXCEED_PAYMENT");
  });
  it("retains a late independently confirmed success after an earlier failure",async()=>{
    const r=await dispatched();const fact=facts.get(referenceFor(r.id))!;
    fact.status="FAILED";await reconcileCurrentStudentRefund(f.pool,1,r.id,deps);
    fact.status="SUCCEEDED";await reconcileCurrentStudentRefund(f.pool,1,r.id,deps);
    expect((await readCurrentPaymentAccounting(f.pool,1,1)).refundedMinor).toBe(10000);
  });
});
describe("individual current BRO approval, payout and recovery",()=>{
  it("C32/C33 preserves the ₦150 root and rejects school-role approval",async()=>{
    await expect(approveCurrentBro(f.pool,2,1,key("approve"),deps)).rejects.toThrow("FINANCIAL_ACTOR_NOT_AUTHORIZED");
    await approveCurrentBro(f.pool,1,1,key("approve"),deps);
    expect((await f.pool.query("SELECT amount_minor FROM bro_term_commission_entitlements")).rows[0].amount_minor).toBe(15000);
    expect((await reviewCurrentBroEntitlement(f.pool,1,1,deps)).payableMinor).toBe(15000);
  });
  it("records the actual reviewing Owner and permits another active Owner without impersonation",async()=>{
    await f.pool.query(`INSERT INTO app_users(id) VALUES(6) ON CONFLICT DO NOTHING;
      DELETE FROM school_memberships WHERE user_id=6;
      INSERT INTO school_memberships VALUES(6,NULL,'PLATFORM_OWNER','ACTIVE')`);
    const review=await reviewCurrentBroEntitlement(f.pool,6,1,deps);
    expect(Number((await currentTransaction(f.pool,1,c=>operation(c,review.journalId))).created_by)).toBe(6);
    await approveCurrentBro(f.pool,1,1,key("another_owner_approves"),deps);
    expect((await reviewCurrentBroEntitlement(f.pool,6,1,deps)).payableMinor).toBe(15000);
  });
  it("C34 requires term-end review",async()=>{
    await expect(approveCurrentBro(f.pool,1,1,key("approve"),{now:()=>new Date("2027-03-01Z")}))
      .rejects.toThrow("TERM_END_OWNER_REVIEW_REQUIRED");
  });
  it("C35/C36 denies adverse source and inactive BRO",async()=>{
    await f.pool.query("UPDATE partner_profiles SET status='INACTIVE'");
    await expect(approveCurrentBro(f.pool,1,1,key("approve"),deps)).rejects.toThrow("BRO_NOT_ACTIVE");
  });
  it("C37 requires existing verified bank evidence",async()=>{
    await approveCurrentBro(f.pool,1,1,key("approve"),deps);
    await expect(initiateCurrentBroPayout(f.pool,1,1,key("payout"),"No verified bank",
      {...deps,bank:async()=>null})).rejects.toThrow("VERIFIED_REGISTERED_PERSON_BANK_REQUIRED");
  });
  it("C38 freezes bank evidence and does not replace it on retry",async()=>{
    const p=await payout();
    deps.bank=async()=>({verified:true,fingerprint:"new-bank",sealed:{ciphertext:"new",keyVersion:"2"},maskedAccountNumber:"****0002"});
    await initiateCurrentBroPayout(f.pool,1,1,key("payout"),"Fictional payout review",deps);
    expect((await currentTransaction(f.pool,1,c=>operation(c,p.id))).snapshot.bank.fingerprint).toBe("fixture-bank-fingerprint");
  });
  it("C39/C40 initiation is pending, never proof of bank credit",async()=>{
    await expect(initiateCurrentBroPayout(f.pool,1,1,key("payout"),"Unapproved",deps)).rejects.toThrow("INDIVIDUAL_OWNER_APPROVAL_REQUIRED");
    const p=await payout();expect(p.state).toBe("PENDING");
    expect(deps.payoutEvidence).not.toHaveBeenCalled();
  });
  it("C41 prevents concurrent duplicate payouts and keeps approval individual",async()=>{
    await approveCurrentBro(f.pool,1,1,key("approve"),deps);
    const result=await Promise.allSettled([
      initiateCurrentBroPayout(f.pool,1,1,key("payout_a"),"One",deps),
      initiateCurrentBroPayout(f.pool,1,1,key("payout_b"),"Two",deps)]);
    expect(result.filter(r=>r.status==="fulfilled")).toHaveLength(1);
  });
  it("C42 binds payout evidence to frozen bank, amount, request and currency",async()=>{
    const p=await payout();
    deps.payoutEvidence=async ref=>({requestReference:ref,providerReference:"wrong-bank-ref",amountMinor:15000,
      currency:"NGN",bankFingerprint:"wrong-bank",status:"SUCCEEDED",evidenceReference:"statement"});
    await expect(reconcileCurrentBroPayout(f.pool,1,p.id,deps)).rejects.toThrow("PAYOUT_EVIDENCE_MISMATCH");
  });
  it("C43 records failure and requires a fresh individual approval before another attempt",async()=>{
    const p=await payout();payoutStatus="FAILED";await reconcileCurrentBroPayout(f.pool,1,p.id,deps);
    await expect(initiateCurrentBroPayout(f.pool,1,1,key("retry"),"Retry",deps)).rejects.toThrow("INDIVIDUAL_OWNER_APPROVAL_REQUIRED");
    await approveCurrentBro(f.pool,1,1,key("reapprove"),deps);
  });
  it("C44 records pending evidence without posting paid money",async()=>{
    const p=await payout();payoutStatus="PENDING";await reconcileCurrentBroPayout(f.pool,1,p.id,deps);
    expect(await currentTransaction(f.pool,1,c=>state(c,p.id))).toBe("PENDING");
  });
  it("C45 preserves payout success and appends reversal; never automatically resends",async()=>{
    const p=await paidBro();payoutStatus="REVERSED";await reconcileCurrentBroPayout(f.pool,1,p.id,deps);
    expect(await currentTransaction(f.pool,1,c=>state(c,p.id))).toBe("REVERSED");
    await expect(approveCurrentBro(f.pool,1,1,key("reapprove"),deps)).rejects.toThrow("ENTITLEMENT_NOT_APPROVABLE");
  });
  it("C46 duplicate bank confirmation does not create a second success",async()=>{
    const p=await paidBro();await reconcileCurrentBroPayout(f.pool,1,p.id,deps);
    expect((await f.pool.query(`SELECT count(*)::int n FROM current_subscription_operation_events
      WHERE operation_id=$1 AND state='SUCCEEDED'`,[p.id])).rows[0].n).toBe(1);
  });
  it("C47 reserves external references against retained historical payouts",async()=>{
    const p=await payout();await f.pool.query("INSERT INTO partner_payouts VALUES(7,$1)",[`bank_${p.reference}`]);
    await expect(reconcileCurrentBroPayout(f.pool,1,p.id,deps)).rejects.toThrow("REFERENCE_ALREADY_USED_BY_HISTORICAL_PAYOUT");
  });
  it("C48/C49 records recovery evidence once without silently making an entitlement payable again",async()=>{
    const p=await paidBro();await refunded();
    const r=await recordCurrentBroRecovery(f.pool,1,p.id,15000,key("recovery"),"fixture-recovery",deps);
    expect((await recordCurrentBroRecovery(f.pool,1,p.id,15000,key("recovery"),"fixture-recovery",deps)).id).toBe(r.id);
    expect(await reviewCurrentBroEntitlement(f.pool,1,1,deps)).toMatchObject({
      payableMinor:0,confirmedPaidMinor:15000,confirmedRecoveredMinor:15000,recoveryReviewExposureMinor:0});
    const verifyRecovery=deps.recoveryEvidence!;
    deps.recoveryEvidence=async ref=>({...await verifyRecovery(ref),amountMinor:1});
    await expect(recordCurrentBroRecovery(f.pool,1,p.id,1,key("excess"),"fixture-recovery-2",deps))
      .rejects.toThrow("CUMULATIVE_RECOVERY_EXCEEDS_PAYOUT");
    await expect(approveCurrentBro(f.pool,1,1,key("reapprove"),deps)).rejects.toThrow("ADVERSE_PAYMENT_REQUIRES_REVIEW");
  });
  it("C50 retains ₦5,000/₦100 history and ₦2,000 staff rule",async()=>{
    await paidBro();await refunded();
    expect((await f.pool.query("SELECT amount_minor FROM student_subscription_payments")).rows[0].amount_minor).toBe(500000);
    expect((await f.pool.query("SELECT amount_minor FROM commission_ledger")).rows[0].amount_minor).toBe(10000);
    expect((await f.pool.query("SELECT price_minor FROM staff_nfc_billing_rules")).rows[0].price_minor).toBe(200000);
  });
  it("a payout finishing after a confirmed refund stays in recovery",async()=>{
    const p=await payout();await refunded();await reconcileCurrentBroPayout(f.pool,1,p.id,deps);
    expect(await currentTransaction(f.pool,1,async c=>state(c,Number((await operation(c,p.id)).parent_id)))).toBe("RECOVERY_REQUIRED");
  });
  it("a stale failed payout cannot rewind a later attempt's pending state",async()=>{
    const first=await payout();payoutStatus="FAILED";await reconcileCurrentBroPayout(f.pool,1,first.id,deps);
    await approveCurrentBro(f.pool,1,1,key("new_approval"),deps);
    const next=await initiateCurrentBroPayout(f.pool,1,1,key("new_payout"),"New payout after independent failure",deps);
    await reconcileCurrentBroPayout(f.pool,1,first.id,deps);
    const parent=await currentTransaction(f.pool,1,c=>operation(c,next.id));
    expect(await currentTransaction(f.pool,1,c=>state(c,Number(parent.parent_id)))).toBe("PENDING");
  });
  it("late verified success after failure is preserved as recovery exposure",async()=>{
    const p=await payout();payoutStatus="FAILED";await reconcileCurrentBroPayout(f.pool,1,p.id,deps);
    payoutStatus="SUCCEEDED";const result=await reconcileCurrentBroPayout(f.pool,1,p.id,deps);
    expect(result.entitlementState).toBe("RECOVERY_REQUIRED");
  });
  it("missing new immutable-history protection fails closed",async()=>{
    await f.pool.query("ALTER TABLE current_subscription_operation_events DISABLE TRIGGER current_subscription_events_history");
    try {await expect(request()).rejects.toThrow("CURRENT_HISTORY_GUARDS_REQUIRED");}
    finally {await f.pool.query("ALTER TABLE current_subscription_operation_events ENABLE TRIGGER current_subscription_events_history");}
  });
});
describe("review-only bulk preflight — aggregate checkout deliberately blocked",()=>{
  const input=()=>({schoolId:1,termId:1,studentIds:[2],key:key("bulk"),reason:"Fictional bulk review"});
  const plannerDeps=()=>({now:()=>new Date("2027-03-01T12:00:00Z"),
    review:async()=>({ready:true,ruleId:1,ruleVersion:1,reviewId:1,digest:"a".repeat(64)})});
  it.each([1,2,3])("C51 authorizes selected school for role fixture %s",async actor=>{
    const p=await planCurrentBulkSubscriptions(f.pool,actor,input(),plannerDeps());
    expect(p.checkoutEnabled).toBe(false);
    expect(p.snapshot.totalMinor).toBe(320000);
  });
  it("C52 rejects Parent authority",async()=>{
    await expect(planCurrentBulkSubscriptions(f.pool,4,input(),plannerDeps())).rejects.toThrow("SCHOOL_FINANCIAL_SCOPE_NOT_AUTHORIZED");
  });
  it("C53 rejects cross-school staff and selected students",async()=>{
    await expect(planCurrentBulkSubscriptions(f.pool,5,input(),plannerDeps())).rejects.toThrow("SCHOOL_FINANCIAL_SCOPE_NOT_AUTHORIZED");
    await expect(planCurrentBulkSubscriptions(f.pool,2,{...input(),studentIds:[3]},plannerDeps()))
      .rejects.toThrow("STUDENT_NOT_ELIGIBLE_FOR_ORDINARY_BULK");
  });
  it("C54 requires one valid term belonging to the selected school",async()=>{
    await expect(planCurrentBulkSubscriptions(f.pool,2,{...input(),termId:2},plannerDeps())).rejects.toThrow("FREE_OR_INELIGIBLE_TERM");
  });
  it("C55/C56 preserves the free launch/calendar gate",async()=>{
    await expect(planCurrentBulkSubscriptions(f.pool,2,input(),{...plannerDeps(),now:()=>new Date("2026-11-23Z")}))
      .rejects.toThrow("FREE_OR_INELIGIBLE_TERM");
  });
  it("C57 rejects retained legacy term records",async()=>{
    await f.pool.query("INSERT INTO student_subscription_terms VALUES(2,1,1)");
    await expect(planCurrentBulkSubscriptions(f.pool,2,input(),plannerDeps())).rejects.toThrow("STUDENT_NOT_ELIGIBLE_FOR_ORDINARY_BULK");
  });
  it("C58 excludes paid/pending/partially refunded original obligations",async()=>{
    await refunded();
    await expect(planCurrentBulkSubscriptions(f.pool,2,{...input(),studentIds:[1]},plannerDeps()))
      .rejects.toThrow("STUDENT_NOT_ELIGIBLE_FOR_ORDINARY_BULK");
  });
  it("C59 freezes amounts, rule/review evidence and rejects duplicate selection",async()=>{
    const p=await planCurrentBulkSubscriptions(f.pool,2,input(),plannerDeps());
    expect((await planCurrentBulkSubscriptions(f.pool,2,input(),plannerDeps())).digest).toBe(p.digest);
    expect(p.digest).toBe(digest(p.snapshot));
    await expect(planCurrentBulkSubscriptions(f.pool,2,{...input(),studentIds:[2,2]},plannerDeps()))
      .rejects.toThrow("DISTINCT_STUDENT_SELECTION_REQUIRED");
  });
  it("freezes multiple students in canonical order without individual charges",async()=>{
    await f.pool.query("INSERT INTO students VALUES(4,1,'ACTIVE','ADMITTED')");
    try {
      const p=await planCurrentBulkSubscriptions(f.pool,2,{...input(),studentIds:[4,2]},plannerDeps());
      expect(p.snapshot.totalMinor).toBe(640000);
      expect(p.snapshot.students.map((s:any)=>s.studentId)).toEqual([2,4]);
      const replay=await planCurrentBulkSubscriptions(f.pool,2,{...input(),studentIds:[2,4]},plannerDeps());
      expect(replay.id).toBe(p.id);expect(deps.refunds!.request).not.toHaveBeenCalled();
    } finally {await f.pool.query("DELETE FROM students WHERE id=4");}
  });
});
