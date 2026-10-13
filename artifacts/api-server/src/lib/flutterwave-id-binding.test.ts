import { describe, expect, it, vi } from "vitest";
import { FlutterwaveTestAdapter } from "./fee-providers";

const expected = { reference: "readonly_fixture_payment", amountMinor: 1234, currency: "NGN", providerTransactionId: "123456" };
const response = (id: unknown, status = "successful") => new Response(JSON.stringify({
  status: "success", data: { id, status, tx_ref: expected.reference, amount: "12.34", currency: "NGN" },
}), { status: 200 });

describe("Flutterwave independent verification transaction binding", () => {
  it.each(["successful", "pending", "failed"])("rejects a different transaction ID even when all payment fields match (%s)", async status => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response(654321, status));
    const adapter = new FlutterwaveTestAdapter({ secretKey: "FLWSECK_TEST-synthetic-only" }, { fetch: transport });
    await expect(adapter.verifyPayment(expected)).rejects.toThrow(/transaction ID mismatch/);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(String(transport.mock.calls[0][0])).toBe("https://api.flutterwave.com/v3/transactions/123456/verify");
  });
  it.each([123456, "123456"])("accepts a matching normalized transaction ID (%s)", async id => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response(id));
    const adapter = new FlutterwaveTestAdapter({ secretKey: "FLWSECK_TEST-synthetic-only" }, { fetch: transport });
    await expect(adapter.verifyPayment(expected)).resolves.toMatchObject({ ...expected, status: "succeeded" });
  });
});
