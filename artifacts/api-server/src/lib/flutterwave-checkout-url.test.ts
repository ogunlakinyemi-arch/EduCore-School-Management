import { afterEach, describe, expect, it, vi } from "vitest";
import { isFlutterwaveTestCheckoutUrl } from "./flutterwave-checkout-url";
import { FlutterwaveTestAdapter } from "./fee-providers";

const sandbox = "https://checkout-v2.dev-flutterwave.com/v3/hosted/pay/fixture-test-link";
const development = { NODE_ENV: "development", REPLIT_DEPLOYMENT: "" };
afterEach(() => vi.unstubAllEnvs());
describe("Flutterwave TEST hosted URL contract", () => {
  it("accepts the exact genuinely observed sandbox host in Development only", () => {
    expect(isFlutterwaveTestCheckoutUrl(sandbox, development)).toBe(true);
    expect(isFlutterwaveTestCheckoutUrl(sandbox, { NODE_ENV: "production" })).toBe(false);
    expect(isFlutterwaveTestCheckoutUrl(sandbox, { ...development, REPLIT_DEPLOYMENT: "1" })).toBe(false);
    expect(isFlutterwaveTestCheckoutUrl(sandbox, { NODE_ENV: "test" })).toBe(false);
  });
  it("preserves the documented canonical checkout host", () => {
    expect(isFlutterwaveTestCheckoutUrl("https://checkout.flutterwave.com/v3/hosted/pay/flwlnk-fixture", { NODE_ENV: "production" })).toBe(true);
  });
  it.each([
    "http://checkout-v2.dev-flutterwave.com/v3/hosted/pay/fixture",
    "https://checkout-v2.dev-flutterwave.com.evil.test/v3/hosted/pay/fixture",
    "https://evil.dev-flutterwave.com/v3/hosted/pay/fixture",
    "https://checkout-v2.dev-flutterwave.com:8443/v3/hosted/pay/fixture",
    "https://key@checkout-v2.dev-flutterwave.com/v3/hosted/pay/fixture",
    "https://checkout-v2.dev-flutterwave.com/other",
    "https://checkout-v2.dev-flutterwave.com/v3/hosted/pay/",
    "https://checkout-v2.dev-flutterwave.com/v3/hosted/pay/fixture/other",
    "javascript:alert(1)",
  ])("rejects an unsafe or unrelated URL: %s", url => {
    expect(isFlutterwaveTestCheckoutUrl(url, development)).toBe(false);
  });
  it("uses the official Standard POST contract and accepts its sandbox success response (mocked)", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("REPLIT_DEPLOYMENT", "");
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: "success", data: { link: sandbox } })));
    const adapter = new FlutterwaveTestAdapter({ secretKey: "FLWSECK_TEST-fixture-only" }, { fetch: transport });
    await expect(adapter.initializePayment({
      reference: "hosted_fixture_1", amountMinor: 500000, currency: "NGN",
      email: "fixture@example.com", returnUrl: "https://fixture.replit.dev/",
    })).resolves.toEqual({ reference: "hosted_fixture_1", checkoutUrl: sandbox });
    expect(String(transport.mock.calls[0][0])).toBe("https://api.flutterwave.com/v3/payments");
    const request = transport.mock.calls[0][1]!;
    expect(request.method).toBe("POST");
    expect(request.headers).toMatchObject({ Authorization: "Bearer FLWSECK_TEST-fixture-only", "Content-Type": "application/json" });
    expect(JSON.parse(String(request.body))).toEqual({
      tx_ref: "hosted_fixture_1", amount: 5000, currency: "NGN",
      redirect_url: "https://fixture.replit.dev/", customer: { email: "fixture@example.com" },
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("does not accept the sandbox response on deployment or leak the returned link in errors", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: "success", data: { link: sandbox } })));
    const adapter = new FlutterwaveTestAdapter({ secretKey: "FLWSECK_TEST-fixture-only" }, { fetch: transport });
    await expect(adapter.initializePayment({ reference: "hosted_fixture_2", amountMinor: 500000, currency: "NGN", email: "fixture@example.com", returnUrl: "https://fixture.test/" })).rejects.toThrow("Flutterwave did not return a valid checkout session");
  });
});
