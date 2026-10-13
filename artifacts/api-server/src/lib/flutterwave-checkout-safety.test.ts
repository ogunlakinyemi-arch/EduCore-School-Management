import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configuredTestAdapter } from "./fee-providers/factory";
import { FlutterwaveTestAdapter } from "./fee-providers";
import { reviewExistingTestCheckout } from "../tools/flutterwave-existing-checkout-review";

const reference = `fw_split_probe_${"a".repeat(32)}`;
const env = () => ({
  NODE_ENV: "development", REPLIT_DEV_DOMAIN: "fixture.example.invalid",
  FLUTTERWAVE_SECRET_Test_Key: "FLWSECK_TEST-fixture-only",
});
const transaction = () => ({
  id: 123456, tx_ref: reference, amount: 5000, currency: "NGN", status: "successful",
});
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("REPLIT_DEPLOYMENT", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("Development checkout credential isolation", () => {
  it.each([true, false])("never reads the generic key with dedicated credential present=%s", present => {
    const config: NodeJS.ProcessEnv = env();
    if (!present) delete config.FLUTTERWAVE_SECRET_Test_Key;
    Object.defineProperty(config, "FLUTTERWAVE_SECRET_KEY", {
      get: () => { throw new Error("Generic credential must not be accessed"); },
    });
    expect(configuredTestAdapter("FLUTTERWAVE", config)?.provider ?? null)
      .toBe(present ? "flutterwave" : null);
  });
  it("rejects conflicting TEST aliases", () => {
    expect(() => configuredTestAdapter("FLUTTERWAVE", {
      ...env(), FLUTTERWAVE_TEST_SECRET_KEY: "FLWSECK_TEST-different-fixture",
    })).toThrow("Invalid dedicated");
  });
  it.each(["FLWSECK-live-fixture", "bad-key"])("rejects invalid dedicated credentials %s", key => {
    expect(() => configuredTestAdapter("FLUTTERWAVE", {
      ...env(), FLUTTERWAVE_SECRET_Test_Key: key,
    })).toThrow("Invalid dedicated");
  });
  it("retains legacy alias support without generic credentials in Development", () => {
    expect(configuredTestAdapter("FLUTTERWAVE", {
      NODE_ENV: "development", FLUTTERWAVE_TEST_SECRET_KEY: "FLWSECK_TEST-fixture-only",
    })?.provider).toBe("flutterwave");
  });
});

describe("Existing checkout review (mock transport; no application settlement)", () => {
  it("performs exactly two bound GETs and publishes only sanitized verification evidence", async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ status: "success", data: transaction() }))
      .mockResolvedValueOnce(json({ status: "success", data: transaction() }));
    const result = await reviewExistingTestCheckout(reference, env(), transport);
    expect(result).toMatchObject({
      paymentVerified: true, referenceTransactionAmountCurrencyMatched: true,
      providerMutations: 0, databaseAccess: "NONE", applicationSettlementVerified: false,
      receiptCreated: false, subscriptionActivated: false, webhookDeliveryVerified: false,
    });
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls.every(([, init]) => init?.method === "GET" && init.redirect === "error")).toBe(true);
    expect(String(transport.mock.calls[1][0])).toBe("https://api.flutterwave.com/v3/transactions/123456/verify");
    expect(JSON.stringify(result)).not.toContain(reference);
    expect(JSON.stringify(result)).not.toContain("123456");
    expect(JSON.stringify(result)).not.toContain(env().FLUTTERWAVE_SECRET_Test_Key);
  });
  it.each([
    { NODE_ENV: "production" }, { REPLIT_DEPLOYMENT: "1" },
    { FLUTTERWAVE_SECRET_Test_Key: "" }, { FLUTTERWAVE_SECRET_Test_Key: "FLWSECK-live-fixture" },
    { REPLIT_DEV_DOMAIN: "" },
  ])("blocks unsupported execution context before network access: %j", override => {
    const transport = vi.fn<typeof fetch>();
    return reviewExistingTestCheckout(reference, { ...env(), ...override }, transport).then(result => {
      expect(result.evidence).toBe("NOT_RUN");
      expect(transport).not.toHaveBeenCalled();
    });
  });
  it.each(["ordinary-customer-reference", null])("rejects references outside the saved TEST probe scope", async input => {
    const transport = vi.fn<typeof fetch>();
    expect((await reviewExistingTestCheckout(input, env(), transport)).evidence).toBe("NOT_RUN");
    expect(transport).not.toHaveBeenCalled();
  });
  it("does not retry an unconfirmed lookup or print provider error details", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(json({
      status: "error", message: "private upstream fixture", data: null,
    }, 400));
    const result = await reviewExistingTestCheckout(reference, env(), transport);
    expect(result.paymentVerified).toBe(false);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("private upstream");
  });
  it.each([
    { id: 654321 }, { tx_ref: "other-reference" }, { amount: 4999 }, { currency: "USD" },
  ])("rejects independently verified transaction mismatches: %j", change => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ status: "success", data: transaction() }))
      .mockResolvedValueOnce(json({ status: "success", data: { ...transaction(), ...change } }));
    return reviewExistingTestCheckout(reference, env(), transport).then(result => {
      expect(result.paymentVerified).toBe(false);
      expect(result.applicationSettlementVerified).toBe(false);
      expect(transport).toHaveBeenCalledTimes(2);
    });
  });
  it.each(["pending", "failed"])("does not claim paid status for %s", status => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ status: "success", data: transaction() }))
      .mockResolvedValueOnce(json({ status: "success", data: { ...transaction(), status } }));
    return reviewExistingTestCheckout(reference, env(), transport).then(result => {
      expect(result.paymentVerified).toBe(false);
      expect(result.applicationSettlementVerified).toBe(false);
    });
  });
  it("redacts transport exceptions", async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error("private upstream fixture"));
    const result = await reviewExistingTestCheckout(reference, env(), transport);
    expect(result.paymentVerified).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private upstream");
  });
});

describe("Flutterwave webhook hash ambiguity", () => {
  it.each([
    { "verif-hash": ["fixture-webhook-secret", "other-hash"] },
    { "verif-hash": ["fixture-webhook-secret", "fixture-webhook-secret"] },
    { "verif-hash": "fixture-webhook-secret", "Verif-Hash": "fixture-webhook-secret" },
  ])("rejects repeated signature headers before resolving records or contacting Flutterwave", async headers => {
    const transport = vi.fn<typeof fetch>();
    const resolveExpectedPayment = vi.fn().mockResolvedValue(null);
    const adapter = new FlutterwaveTestAdapter({
      secretKey: env().FLUTTERWAVE_SECRET_Test_Key, webhookSecret: "fixture-webhook-secret",
    }, { fetch: transport });
    await expect(adapter.handleWebhook({
      headers, rawBody: JSON.stringify({ event: "charge.completed", data: transaction() }),
      resolveExpectedPayment,
    })).rejects.toThrow("verification hash is invalid");
    expect(transport).not.toHaveBeenCalled();
    expect(resolveExpectedPayment).not.toHaveBeenCalled();
  });
});
