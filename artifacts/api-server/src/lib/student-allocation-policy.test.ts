import { describe, expect, it } from "vitest";
import { newStudentPaymentReference, studentAllocationPolicy } from "./student-allocation-policy";
import { calculateStudentSubscriptionAllocations } from "./student-subscription-billing";
import { cumulativeRefundShares, fixedSplitInstructions } from "./flutterwave-split-policy";

describe("versioned student subscription allocations", () => {
  const rule = { id: 1, allocationTotal: 5000, schoolAmount: 1900, edupulseAmount: 3000, partnerAmount: 100, currency: "NGN" };
  it("selects the new policy only for newly generated references", () => {
    expect(studentAllocationPolicy(newStudentPaymentReference("FLW_existing_generator")).version).toBe(2);
    expect(studentAllocationPolicy("FLW_legacy_pending_reference").version).toBe(1);
    expect(() => newStudentPaymentReference("bad/ref")).toThrow();
  });
  it("allocates 1900/3100 without a Partner and 1900/3000/100 with one", () => {
    expect(calculateStudentSubscriptionAllocations({ partnerProfileId: null, policyVersion: 2 }).map(x => x.amountMinor))
      .toEqual([190000, 310000]);
    expect(calculateStudentSubscriptionAllocations({ partnerProfileId: 7, policyVersion: 2, commissionRule: rule }).map(x => x.amountMinor))
      .toEqual([190000, 300000, 10000]);
  });
  it("never silently uses a legacy rule or removes an eligible Partner", () => {
    expect(() => calculateStudentSubscriptionAllocations({ partnerProfileId: 7, policyVersion: 2 })).toThrow();
    expect(() => calculateStudentSubscriptionAllocations({
      partnerProfileId: 7, policyVersion: 2, commissionRule: { ...rule, schoolAmount: 2000, edupulseAmount: 2900 },
    })).toThrow();
  });
  it("preserves old amounts for legacy references and existing helper callers", () => {
    expect(calculateStudentSubscriptionAllocations({ partnerProfileId: null }).map(x => x.amountMinor))
      .toEqual([200000, 300000]);
    expect(cumulativeRefundShares(500000, true)).toEqual({ school: 200000, partner: 10000, platform: 290000 });
  });
  it("freezes new provider instructions without changing the payer's gross", () => {
    expect(fixedSplitInstructions("RS_UNITSchool000001", "RS_UNITPartner00001", 2).map(x => x.transaction_charge))
      .toEqual([1900, 100]);
  });
  it.each([true, false])("conserves each kobo over partial-refund replay, Partner=%s", partner => {
    let refunded = 0;
    let totals = { school: 0, platform: 0, partner: 0 };
    for (const amount of [10001, 249999, 240000]) {
      const before = cumulativeRefundShares(refunded, partner, 2);
      const after = cumulativeRefundShares(refunded += amount, partner, 2);
      const delta = { school: after.school - before.school, platform: after.platform - before.platform, partner: after.partner - before.partner };
      expect(delta.school + delta.platform + delta.partner).toBe(amount);
      totals = after;
      expect(cumulativeRefundShares(refunded, partner, 2)).toEqual(after);
    }
    expect(totals).toEqual({ school: 190000, platform: partner ? 300000 : 310000, partner: partner ? 10000 : 0 });
  });
});
