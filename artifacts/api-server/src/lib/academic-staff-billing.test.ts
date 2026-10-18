import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import * as billing from "../routes/staff-nfc-billing-service";
import { syncStaffBilling } from "../routes/academic";

vi.mock("@workspace/db", () => ({ pool: {} }));
afterEach(() => vi.restoreAllMocks());

function request() {
  return {
    edupulseUser: { user: { id: 12 }, roles: [] },
    log: { warn: vi.fn() },
  } as unknown as Request;
}

describe("academic save and unconfigured staff billing", () => {
  it("does not block the academic save or invent a rule when billing is unconfigured", async () => {
    const generate = vi.spyOn(billing, "ensureCurrentStaffNfcTermSubscriptions")
      .mockRejectedValueOnce(new billing.StaffNfcDomainError(409, "No effective rule", "BILLING_RULE_REQUIRED"));
    const req = request();
    await expect(syncStaffBilling({ query: vi.fn() }, req, 7)).resolves.toBeUndefined();
    expect(generate).toHaveBeenCalledWith(expect.anything(), 7, 12);
    expect(req.log.warn).toHaveBeenCalledWith(
      { schoolId: 7, code: "BILLING_RULE_REQUIRED" }, expect.any(String));
  });

  it.each([
    new billing.StaffNfcDomainError(409, "Invalid allocation", "ALLOCATION_INVALID"),
    new Error("Database write failed"),
  ])("propagates other failures so the enclosing transaction can roll back", async error => {
    vi.spyOn(billing, "ensureCurrentStaffNfcTermSubscriptions").mockRejectedValueOnce(error);
    await expect(syncStaffBilling({}, request(), 7)).rejects.toBe(error);
  });
});
