import { describe, expect, it } from "vitest";
import {
  employeeNfcCardActionStatus,
  employeeNfcIdentityMatches,
  employeeNfcPersonType,
  isVerifiedCurrentTermNfcEntitlement,
  validEmployeeNfcIsoDate,
} from "./employee-nfc-policy";

describe("employee NFC identity and entitlement policy", () => {
  it("identifies only an employee's actual Teacher or Staff classification", () => {
    expect(employeeNfcPersonType("teacher")).toBe("TEACHER");
    expect(employeeNfcPersonType("Staff")).toBe("STAFF");
    expect(employeeNfcPersonType("STUDENT")).toBeNull();
    expect(employeeNfcPersonType("")).toBeNull();
    expect(employeeNfcPersonType(null)).toBeNull();
    expect(employeeNfcIdentityMatches("TEACHER", "teacher")).toBe(true);
    expect(employeeNfcIdentityMatches("STAFF", "TEACHER")).toBe(false);
    expect(employeeNfcIdentityMatches("STUDENT", "STAFF")).toBe(false);
  });

  it("requires both a paid status and a server-verified provider result", () => {
    expect(isVerifiedCurrentTermNfcEntitlement({
      paymentStatus: "PAID",
      verificationStatus: "VERIFIED",
    })).toBe(true);
    expect(isVerifiedCurrentTermNfcEntitlement({
      paymentStatus: "PENDING",
      verificationStatus: "VERIFIED",
    })).toBe(false);
    expect(isVerifiedCurrentTermNfcEntitlement({
      paymentStatus: "PAID",
      verificationStatus: "PENDING",
    })).toBe(false);
    expect(isVerifiedCurrentTermNfcEntitlement({
      paymentStatus: "PAID",
      verificationStatus: "FAILED",
    })).toBe(false);
    expect(isVerifiedCurrentTermNfcEntitlement({
      paymentStatus: "PAID",
      verificationStatus: null,
    })).toBe(false);
    expect(isVerifiedCurrentTermNfcEntitlement({
      paymentStatus: "PAID",
      verificationStatus: "RECONCILIATION_REQUIRED",
      providerVerifiedAt: "2026-06-22T12:00:00Z",
    })).toBe(false);
  });

  it("separates physical-card activation state from paid service entitlement", () => {
    expect(employeeNfcCardActionStatus("ACTIVATE")).toBe("ACTIVE");
    expect(employeeNfcCardActionStatus("LOCK")).toBe("LOCKED");
    expect(employeeNfcCardActionStatus("DEACTIVATE")).toBe("DEACTIVATED");
    expect(employeeNfcCardActionStatus("STUDENT_ATTENDANCE")).toBeNull();
  });

  it("accepts only real, round-tripped ISO attendance report dates", () => {
    expect(validEmployeeNfcIsoDate("2026-06-22")).toBe("2026-06-22");
    expect(validEmployeeNfcIsoDate("2026-02-30")).toBeNull();
    expect(validEmployeeNfcIsoDate("2026-06-22T03:00:00Z")).toBeNull();
    expect(validEmployeeNfcIsoDate("../term")).toBeNull();
  });
});