import { describe, expect, it } from "vitest";
import { visibleSubscription } from "./subscription-visibility";

const snapshot = {
  schoolId: 7, amountMinor: 500000, schoolShareMinor: 190000,
  platform_share_minor: 300000, edupulseShare: 3000, partnerAllocatedMinor: 10000,
  providerFeeMinor: 500, allocationSnapshot: { school: 1900, platform: 3000, partner: 100 },
  nested: { commissionRule: { schoolAmount: 1900, edupulseAmount: 3000 }, schoolName: "School" },
  allocations: [
    { recipientType: "SCHOOL", amountMinor: 190000 },
    { recipientType: "PLATFORM", amountMinor: 300000 },
    { recipient_type: "PARTNER", amountMinor: 10000 },
  ],
};

describe("subscription response privacy", () => {
  it("leaves the Owner response unchanged", () => {
    expect(visibleSubscription(snapshot, true)).toBe(snapshot);
  });
  it("allows a school only its own allocation and preserves identity and gross", () => {
    const response = visibleSubscription(snapshot, false, "SCHOOL");
    expect(response).toEqual({
      schoolId: 7, amountMinor: 500000, schoolShareMinor: 190000,
      nested: { schoolName: "School" },
      allocations: [{ recipientType: "SCHOOL", amountMinor: 190000 }],
    });
    expect(snapshot.platform_share_minor).toBe(300000);
    expect(snapshot.allocations).toHaveLength(3);
  });
  it("gives a Partner only its own allocation, not the rule or other recipients", () => {
    const response = visibleSubscription(snapshot, false, "PARTNER");
    expect(response).toEqual({
      schoolId: 7, amountMinor: 500000, partnerAllocatedMinor: 10000,
      nested: { schoolName: "School" },
      allocations: [{ recipient_type: "PARTNER", amountMinor: 10000 }],
    });
  });
  it("removes all recipient allocations from family/teacher responses", () => {
    expect(visibleSubscription(snapshot, false)).toEqual({
      schoolId: 7, amountMinor: 500000, nested: { schoolName: "School" }, allocations: [],
    });
  });
});
