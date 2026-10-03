import { describe, expect, it } from "vitest";
import { subscriptionPolicy, type SubscriptionStudent } from "./subscription-enforcement-policy";
const term = { startDate: "2026-10-01", endDate: "2026-12-31" };
const student = (studentId: number, overrides: Partial<SubscriptionStudent> = {}): SubscriptionStudent =>
  ({ studentId, paid: false, waived: false, pending: false, ...overrides });
describe("termly subscription policy", () => {
  it.each(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07"])("preserves the complete seven-day grace on %s", today => {
    expect(subscriptionPolicy(term, [student(1)], today)).toMatchObject({ inGracePeriod: true, schoolLocked: false, restrictedStudentIds: [] });
  });
  it("enforces on day eight, not day seven", () => {
    expect(subscriptionPolicy(term, [student(1)], "2026-10-08")).toMatchObject({ inGracePeriod: false, schoolLocked: true, restrictedStudentIds: [1], status: "OVERDUE" });
  });
  it("keeps paid siblings, all teachers and readers active for partial payments", () => {
    expect(subscriptionPolicy(term, [student(1, { paid: true }), student(2)], "2026-10-08")).toMatchObject({
      status: "PARTIALLY_PAID", schoolLocked: false, restrictedStudentIds: [2], studentsPaid: 1,
    });
  });
  it("does not treat a pending checkout as paid", () => {
    expect(subscriptionPolicy(term, [student(1, { pending: true })], "2026-10-08")).toMatchObject({ status: "PENDING", schoolLocked: true, restrictedStudentIds: [1] });
  });
  it("restores immediately after verified coverage", () => {
    expect(subscriptionPolicy(term, [student(1, { paid: true })], "2026-10-08")).toMatchObject({ state: "ACTIVE", status: "PAID", schoolLocked: false, restrictedStudentIds: [] });
  });
  it("respects an existing verified waiver", () => {
    expect(subscriptionPolicy(term, [student(1, { waived: true })], "2026-10-08")).toMatchObject({ status: "WAIVED", restrictedStudentIds: [], schoolLocked: false });
  });
  it("keeps readers available for a waived sibling in a partially covered school", () => {
    expect(subscriptionPolicy(term, [student(1, { waived: true }), student(2)], "2026-10-08")).toMatchObject({ status: "PARTIALLY_PAID", schoolLocked: false, restrictedStudentIds: [2] });
  });
  it("does not lock an empty school", () => {
    expect(subscriptionPolicy(term, [], "2026-10-08")).toMatchObject({ status: "NOT_REQUIRED", schoolLocked: false });
  });
  it.each(["2026-09-30", "2027-01-01", "not-a-date"])("rejects an unavailable current calendar: %s", today => {
    expect(() => subscriptionPolicy(term, [student(1)], today)).toThrow("calendar");
  });
  it("does not inherit prior term coverage", () => {
    const next = { startDate: "2027-01-01", endDate: "2027-03-31" };
    expect(subscriptionPolicy(next, [student(1)], "2027-01-01").restrictedStudentIds).toEqual([]);
    expect(subscriptionPolicy(next, [student(1)], "2027-01-08").restrictedStudentIds).toEqual([1]);
  });
  it("is deterministic and does not mutate identity data", () => {
    const input = [student(2), student(1)];
    const before = structuredClone(input);
    expect(subscriptionPolicy(term, input, "2026-10-08")).toEqual(subscriptionPolicy(term, input, "2026-10-08"));
    expect(input).toEqual(before);
  });
});