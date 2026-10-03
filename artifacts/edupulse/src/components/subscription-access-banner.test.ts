import { describe, expect, it } from "vitest";
import type { SubscriptionAccessStatus } from "@workspace/api-client-react";
import { describeAccess } from "./subscription-access-banner";

const item = (studentId: number | null, schoolId = 1): SubscriptionAccessStatus => ({
  schoolId, studentId, schoolName: "Fixture", termName: null, startDate: null, enforcementDate: null,
  state: "SCHOOL_SUBSCRIPTION_LOCKED", restricted: true, restrictionReason: "SCHOOL_SUBSCRIPTION_LOCKED",
});
describe("subscription banners preserve the current family or teaching scope", () => {
  it("does not show a teacher-only school lock as a parent's child restriction", () => {
    const ownChild = { ...item(20, 2), restricted: false, state: "ACTIVE", restrictionReason: null };
    expect(describeAccess([item(null), ownChild], "parent")).toMatchObject({ restricted: [], active: [ownChild] });
  });
  it("does not show a child's other-school lock as the teacher's school restriction", () => {
    expect(describeAccess([item(20, 2)], "teacher").restricted).toEqual([]);
    expect(describeAccess([item(null)], "teacher").restricted).toHaveLength(1);
  });
  it("never advertises an automatic teacher lock, even for a stale response", () => {
    expect(describeAccess([{ ...item(null), restrictionReason: "SUBSCRIPTION_RESTRICTED" }], "teacher").restricted).toEqual([]);
  });
  it("keeps paid siblings active under child-specific automatic enforcement", () => {
    const paid = { ...item(20), restricted: false, state: "SUBSCRIPTION_RESTRICTED", restrictionReason: null };
    const unpaid = { ...item(21), state: "SUBSCRIPTION_RESTRICTED", restrictionReason: "SUBSCRIPTION_RESTRICTED" as const };
    expect(describeAccess([paid, unpaid], "parent")).toEqual({ restricted: [unpaid], active: [paid] });
  });
});