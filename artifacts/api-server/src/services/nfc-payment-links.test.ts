import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  expectedNfcAllocations, nfcLinkStatus, nfcLinkToken, nfcLinkTokenHash,
  publicNfcLink, requireNfcLinkDevelopment, simulateNfcLink,
} from "./nfc-payment-links";

const row = (overrides = {}) => ({
  id: 1, reference: "NFC_fixture", mode: "DEVELOPMENT_SIMULATION", status: "PENDING",
  expires_at: new Date(Date.now() + 3600000), subscriptionStatus: "pending", verificationStatus: "pending",
  schoolName: "QA School", studentIdentifier: "QA-1", termName: "First term", sessionName: "2026/27",
  expected_allocations: [{ recipientType: "SCHOOL", recipientId: 12, amountMinor: 200000 },
    { recipientType: "PLATFORM", recipientId: null, amountMinor: 300000 }],
  ...overrides,
});
describe("Development guest NFC link isolation", () => {
  beforeEach(() => { vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("REPLIT_DEPLOYMENT", ""); vi.stubEnv("SESSION_SECRET", "private-test-signing-secret-not-a-live-credential"); });
  afterEach(() => vi.unstubAllEnvs());
  it("derives an opaque purpose-specific token and stores only its hash", () => {
    const token = nfcLinkToken("NFC_fixture");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token).not.toContain("fixture");
    expect(nfcLinkToken("NFC_other")).not.toBe(token);
    expect(nfcLinkTokenHash(token)).toMatch(/^[a-f0-9]{64}$/);
  });
  it("fails closed without signing configuration", () => {
    vi.stubEnv("SESSION_SECRET", ""); expect(() => nfcLinkToken("ref")).toThrow();
  });
  it.each(["production", "test"])("rejects %s simulation mode", mode => {
    vi.stubEnv("NODE_ENV", mode); expect(requireNfcLinkDevelopment).toThrow();
  });
  it("rejects a deployment even if NODE_ENV says development", () => {
    vi.stubEnv("REPLIT_DEPLOYMENT", "1"); expect(requireNfcLinkDevelopment).toThrow();
  });
  it.each(["CANCELLED", "SIMULATED_SUCCESS", "SIMULATED_FAILED"])("retains terminal %s", status => {
    expect(nfcLinkStatus(row({ status }))).toBe(status);
  });
  it("expires independently of browser parameters", () => {
    expect(nfcLinkStatus(row({ expires_at: new Date(0) }))).toBe("EXPIRED");
  });
  it("recognizes actual verified subscription payment without trusting simulated success", () => {
    expect(publicNfcLink(row({ status: "SIMULATED_SUCCESS" })).subscriptionActivated).toBe(false);
    expect(nfcLinkStatus(row({ subscriptionStatus: "active", verificationStatus: "verified" }))).toBe("PAID");
  });
  it("never exposes recipient ids or fabricates a simulation receipt", () => {
    const result = publicNfcLink(row({ status: "SIMULATED_SUCCESS", checkoutUrl: "https://checkout.flutterwave.com/fake" }));
    expect(result.checkoutUrl).toBeNull(); expect(result.receiptReference).toBeNull();
    expect(result.settlementStatus).toBe("UNVERIFIED");
    expect(result.amountDueMinor).toBe(500000);
    expect(result.expectedAllocations).toEqual([{ recipientType: "SCHOOL", amountMinor: 200000 }, { recipientType: "PLATFORM", amountMinor: 300000 }]);
  });
  it.each(["https://evil.test", "https://user:secret@checkout.flutterwave.com/pay", "http://checkout.flutterwave.com/pay"])("does not expose unsafe checkout %s", checkoutUrl => {
    expect(publicNfcLink(row({ mode: "FLUTTERWAVE_SANDBOX", payment_id: 17, paymentReference: "student_fixture", checkoutUrl })).checkoutUrl).toBeNull();
  });
  it.each(["SUCCESS", "FAILED"] as const)("simulates %s by modifying only the link", async outcome => {
    const r = row();
    const query = vi.fn().mockResolvedValueOnce({ rows: [r] }).mockResolvedValueOnce({ rows: [] });
    const result = await simulateNfcLink({ query }, "t".repeat(43), outcome);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0][0]).toContain("FOR UPDATE OF l");
    expect(query.mock.calls[1][0]).toMatch(/^UPDATE nfc_payment_links /);
    expect(result.status).toBe(outcome === "SUCCESS" ? "SIMULATED_SUCCESS" : "SIMULATED_FAILED");
    expect(result.subscriptionActivated).toBe(false);
  });
  it("duplicate callbacks and changed retry outcomes cannot repeat or replace success", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row({ status: "SIMULATED_SUCCESS" })] });
    expect((await simulateNfcLink({ query }, "t".repeat(43), "FAILED")).status).toBe("SIMULATED_SUCCESS");
    expect(query).toHaveBeenCalledTimes(1);
  });
  it.each(["CANCELLED", "EXPIRED"])("blocks %s attempts", async status => {
    const query = vi.fn().mockResolvedValue({ rows: [row(status === "EXPIRED" ? { expires_at: new Date(0) } : { status })] });
    await expect(simulateNfcLink({ query }, "t".repeat(43), "SUCCESS")).rejects.toThrow();
    expect(query).toHaveBeenCalledTimes(1);
  });
  it("cannot simulate a provider checkout", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row({ mode: "FLUTTERWAVE_SANDBOX" })] });
    await expect(simulateNfcLink({ query }, "t".repeat(43), "SUCCESS")).rejects.toThrow();
    expect(query).toHaveBeenCalledTimes(1);
  });
  it("handles invalid tokens without touching any records", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await expect(simulateNfcLink({ query }, "t".repeat(43), "SUCCESS")).rejects.toThrow("Invalid payment link");
  });
  it("reuses the existing allocation calculator without an eligible Partner", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    expect(await expectedNfcAllocations({ query }, { schoolId: 1 })).toEqual([
      { recipientType: "SCHOOL", recipientId: null, amountMinor: 200000 },
      { recipientType: "PLATFORM", recipientId: null, amountMinor: 300000 },
    ]);
  });
  it("uses the existing eligible Partner rule and handles numeric PostgreSQL values", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ partnerProfileId: 4 }] }).mockResolvedValueOnce({
      rows: [{ id: 2, allocationTotal: "5000", schoolAmount: "2000", partnerAmount: "100", edupulseAmount: "2900", currency: "NGN" }],
    });
    const allocations = await expectedNfcAllocations({ query }, { schoolId: 1, subscriptionTerm: "FIRST" });
    expect(allocations.map(a => a.amountMinor)).toEqual([200000, 290000, 10000]);
    expect(allocations.reduce((n, a) => n + a.amountMinor, 0)).toBe(500000);
  });
  it("fails closed rather than inventing a missing eligible Partner rule", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ partnerProfileId: 4 }] }).mockResolvedValueOnce({ rows: [] });
    await expect(expectedNfcAllocations({ query }, { schoolId: 1 })).rejects.toThrow();
  });
});
