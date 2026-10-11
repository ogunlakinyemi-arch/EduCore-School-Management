import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlutterwaveTestAdapter } from "./fee-providers";

const expected = { reference: "sandbox_reference_fixture", amountMinor: 500000, currency: "NGN" };
const transaction = () => ({
  id: 123456, tx_ref: expected.reference, amount: 5000, currency: "NGN",
  status: "successful", created_at: "2026-10-11T12:00:00.000Z",
});
const json = (data: unknown) => new Response(JSON.stringify(data));
beforeEach(() => { vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("REPLIT_DEPLOYMENT", ""); });
afterEach(() => vi.unstubAllEnvs());

describe("Development TEST verification by reference (mocked transport)", () => {
  it("uses the documented direct reference lookup, then verifies by ID without trusting a redirect", async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ status: "success", data: transaction() }))
      .mockResolvedValueOnce(json({ status: "success", data: transaction() }));
    const adapter = new FlutterwaveTestAdapter({ secretKey: "FLWSECK_TEST-fixture-only" }, { fetch: transport });
    await expect(adapter.verifyCheckoutStatus(expected)).resolves.toMatchObject({ ...expected, status: "succeeded", providerTransactionId: "123456" });
    expect(String(transport.mock.calls[0][0])).toBe("https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=sandbox_reference_fixture");
    expect(String(transport.mock.calls[1][0])).toBe("https://api.flutterwave.com/v3/transactions/123456/verify");
    expect(transport.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });
  it.each([
    { status: "error", data: null },
    { status: "success", data: { ...transaction(), tx_ref: "other_student_reference" } },
    { status: "success", data: { ...transaction(), id: 0 } },
    { status: "success", data: [] },
  ])("rejects unknown/mismatched/malformed reference results before ID verification", async response => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json(response));
    const adapter = new FlutterwaveTestAdapter({ secretKey: "FLWSECK_TEST-fixture-only" }, { fetch: transport });
    await expect(adapter.verifyCheckoutStatus(expected)).rejects.toThrow();
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...transaction(), tx_ref: "wrong_reference" },
    { ...transaction(), amount: 4999 },
    { ...transaction(), currency: "USD" },
    { ...transaction(), id: 654321 },
  ])("revalidates the authoritative ID response rather than trusting reference lookup success", async response => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ status: "success", data: transaction() }))
      .mockResolvedValueOnce(json({ status: "success", data: response }));
    const adapter = new FlutterwaveTestAdapter({ secretKey: "FLWSECK_TEST-fixture-only" }, { fetch: transport });
    await expect(adapter.verifyCheckoutStatus(expected)).rejects.toThrow();
  });
  it.each(["failed", "pending"])("never converts a verified %s transaction into success", async status => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ status: "success", data: transaction() }))
      .mockResolvedValueOnce(json({ status: "success", data: { ...transaction(), status } }));
    const adapter = new FlutterwaveTestAdapter({ secretKey: "FLWSECK_TEST-fixture-only" }, { fetch: transport });
    await expect(adapter.verifyCheckoutStatus(expected)).resolves.toMatchObject({ ...expected, status });
  });
  it.each([{ NODE_ENV: "production" }, { REPLIT_DEPLOYMENT: "1" }])("keeps deployed reference-lookup behavior unchanged", async env => {
    Object.entries(env).forEach(([key, value]) => vi.stubEnv(key, value));
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ status: "success", data: [transaction()] }))
      .mockResolvedValueOnce(json({ status: "success", data: transaction() }));
    const adapter = new FlutterwaveTestAdapter({ secretKey: "FLWSECK_TEST-fixture-only" }, { fetch: transport });
    await expect(adapter.verifyCheckoutStatus(expected)).resolves.toMatchObject({ status: "succeeded" });
    expect(new URL(String(transport.mock.calls[0][0])).pathname).toBe("/v3/transactions");
  });
});
