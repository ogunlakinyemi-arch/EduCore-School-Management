import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";
import { AuthError } from "../middlewares/auth";
const fakes = vi.hoisted(() => ({ record: vi.fn(), reject: vi.fn() }));
vi.mock("./school-security-core-service", () => ({
  recordSecurityEventFromAttendance: fakes.record,
  persistRejectedSecurityTap: fakes.reject,
}));
import {
  joinSecurityAttendance, recordAuthenticatedNfcDenial, SecurityIdentityRejection,
} from "./security-attendance-integration";

const client = { query: vi.fn() };
const device = { schoolId: 10, deviceId: 20, credentialId: 30 };
const request = () => ({
  body: { identificationMethod: "NFC", eventType: "SCHOOL_ENTRY",
    nfcUid: "QA-NFC-REFERENCE", occurredAt: new Date().toISOString(),
    schoolId: 999, studentId: 999, credentialId: 999 },
}) as unknown as Request;
beforeEach(() => { vi.resetAllMocks(); fakes.reject.mockResolvedValue({}); });
describe("authoritative NFC attendance joins security without duplicate alerts", () => {
  it("preserves the legacy notification path when security is disabled", async () => {
    fakes.record.mockResolvedValue(null);
    expect(await joinSecurityAttendance(client, 100)).toBe(false);
  });
  it("replaces the old notification only after a confirmed security event", async () => {
    fakes.record.mockResolvedValue({ securityEventId: 200, identityResult: "CONFIRMED" });
    expect(await joinSecurityAttendance(client, 100)).toBe(true);
  });
  it("rejects rather than commits a failed security identity check", async () => {
    fakes.record.mockResolvedValue({ identityResult: "REJECTED", reasonCode: "LOST_CARD" });
    await expect(joinSecurityAttendance(client, 100)).rejects.toBeInstanceOf(SecurityIdentityRejection);
  });
  it("records a stable scoped denial without trusting supplied person or tenant IDs", async () => {
    const req = request(), error = new SecurityIdentityRejection("LOST_CARD");
    await recordAuthenticatedNfcDenial(req, device, error);
    await recordAuthenticatedNfcDenial(req, device, error);
    const first = fakes.reject.mock.calls[0][0];
    expect(first).toMatchObject({ ...device, reasonCode: "LOST_CARD", eventType: "ENTRY" });
    expect(first.studentId).toBeUndefined();
    expect(first.employeeId).toBeUndefined();
    expect(first.nfcCardId).toBeUndefined();
    expect(first.eventKey).toMatch(/^[a-f0-9]{64}$/);
    expect(fakes.reject.mock.calls[1][0].eventKey).toBe(first.eventKey);
  });
  it("does not turn fingerprint, invalid timestamps, or credential failures into NFC events", async () => {
    for (const body of [
      { ...request().body, identificationMethod: "FINGERPRINT" },
      { ...request().body, occurredAt: "invalid" },
      { ...request().body, eventType: "CLASSROOM_ENTRY" },
    ]) await recordAuthenticatedNfcDenial({ body } as Request, device, new AuthError(403, "Denied"));
    await recordAuthenticatedNfcDenial(request(), device, new AuthError(401, "Credential denied"));
    expect(fakes.reject).not.toHaveBeenCalled();
  });
});