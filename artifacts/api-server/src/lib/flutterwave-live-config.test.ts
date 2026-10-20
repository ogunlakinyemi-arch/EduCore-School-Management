import { afterAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { flutterwaveLiveStatus, flutterwaveTestWebhookVerifier } from "./flutterwave-live-config";
import { FlutterwaveLiveAdapter, FlutterwaveTestAdapter } from "./fee-providers";
import { configuredLiveStudentSubscriptionAdapter, configuredTestAdapter } from "./fee-providers/factory";
import { fixedSplitInstructions } from "./flutterwave-split-policy";
import { studentAllocationPolicy, studentPostFeePayouts } from "./student-allocation-policy";
import { studentSubscriptionLiveWebhookRouter } from "../routes/student-subscription-live-webhooks";
import { configuredPayrollProviderCapability } from "./flutterwave-payroll-v3";

// This configuration-only suite must never reach an application database.
vi.mock("../services/flutterwave-live-webhook-inbox", () => ({
  persistAuthenticatedLiveWebhookReceipt: vi.fn().mockRejectedValue(new Error("Synthetic receipt storage unavailable")),
}));

// Entirely fictional inputs. No inherited credentials, application DB or provider calls.
function live(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    EDUCORE_FLUTTERWAVE_MODE: "LIVE",
    EDUCORE_FLUTTERWAVE_LIVE_ENABLED: "true",
    EDUCORE_FLUTTERWAVE_WEBHOOK_ENVIRONMENT: "LIVE",
    FLUTTERWAVE_LIVE_SECRET_KEY: "FLWSECK-fictional-live-credential",
    FLUTTERWAVE_WEBHOOK_VERIF_HASH: "fictional-live-verifier-123",
    FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH: "fictional-test-verifier-456",
  };
}
const input = {
  reference: "SCV3_fictional_payment_123", amountMinor: 500000, currency: "NGN",
  email: "fictional@payment.invalid", returnUrl: "https://payment.invalid/return",
  subaccounts: fixedSplitInstructions("RS_FictionalSchool123", null, 3),
};
describe("isolated LIVE wiring with immutable readiness gate", () => {
  it("is disabled by default, including when only a LIVE secret exists", () => {
    for (const env of [{}, { FLUTTERWAVE_LIVE_SECRET_KEY: live().FLUTTERWAVE_LIVE_SECRET_KEY }]) {
      expect(configuredLiveStudentSubscriptionAdapter(env)).toBeNull();
      expect(flutterwaveLiveStatus(env)).toMatchObject({ configurationReady: false, checkoutEnabled: false });
    }
  });
  it.each([
    ["EDUCORE_FLUTTERWAVE_LIVE_ENABLED", undefined], ["EDUCORE_FLUTTERWAVE_LIVE_ENABLED", "TRUE"],
    ["EDUCORE_FLUTTERWAVE_MODE", "TEST"], ["EDUCORE_FLUTTERWAVE_MODE", undefined],
    ["NODE_ENV", "development"], ["NODE_ENV", "test"],
    ["FLUTTERWAVE_LIVE_SECRET_KEY", undefined], ["FLUTTERWAVE_LIVE_SECRET_KEY", "FLWSECK_TEST-fictional-test-key"],
    ["FLUTTERWAVE_LIVE_SECRET_KEY", "malformed"], ["FLUTTERWAVE_LIVE_SECRET_KEY", " FLWSECK-fictional-live-key"],
    ["FLUTTERWAVE_WEBHOOK_VERIF_HASH", undefined], ["FLUTTERWAVE_WEBHOOK_VERIF_HASH", "short"],
    ["EDUCORE_FLUTTERWAVE_WEBHOOK_ENVIRONMENT", undefined], ["EDUCORE_FLUTTERWAVE_WEBHOOK_ENVIRONMENT", "TEST"],
    ["FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH", "fictional-live-verifier-123"],
  ])("rejects missing/mismatched %s (%s) without transport", (key, value) => {
    const env = { ...live(), [key!]: value };
    expect(configuredLiveStudentSubscriptionAdapter(env)).toBeNull();
    expect(() => new FlutterwaveLiveAdapter(env)).toThrow("disabled, missing or mismatched");
  });
  it("never selects TEST credentials as a substitute for a missing LIVE key", () => {
    const env = { ...live(), FLUTTERWAVE_LIVE_SECRET_KEY: undefined,
      FLUTTERWAVE_SECRET_Test_Key: "FLWSECK_TEST-fictional-test-key", FLUTTERWAVE_TEST_SECRET_KEY: "FLWSECK_TEST-fictional-test-key" };
    expect(configuredLiveStudentSubscriptionAdapter(env)).toBeNull();
  });
  it.each(["FLWSECK-fictional-generic-live-key", "FLWSECK_TEST-fictional-generic-test-key"])(
    "never substitutes a generic credential for the explicit LIVE secret (%s)", generic => {
      const env = { ...live(), FLUTTERWAVE_LIVE_SECRET_KEY: undefined, FLUTTERWAVE_SECRET_KEY: generic,
        FLUTTERWAVE_LIVE_PUBLIC_KEY: "FLWPUBK-fictional-live-public-key" };
      expect(configuredLiveStudentSubscriptionAdapter(env)).toBeNull();
      expect(flutterwaveLiveStatus(env).credentialConfigured).toBe(false);
    },
  );
  it("LIVE construction never reads generic, TEST, public or encryption credentials", () => {
    const env = live();
    for (const key of ["FLUTTERWAVE_SECRET_KEY", "FLUTTERWAVE_TEST_SECRET_KEY",
      "FLUTTERWAVE_SECRET_Test_Key", "FLUTTERWAVE_PUBLIC_KEY", "FLUTTERWAVE_LIVE_PUBLIC_KEY",
      "FLUTTERWAVE_PUBLIC_Test_Key", "FLUTTERWAVE_ENCRYPTION_KEY", "FLUTTERWAVE_Encryption_Test_KEY"]) {
      Object.defineProperty(env, key, { get() { throw new Error("Unrelated credential must not be read"); } });
    }
    expect(flutterwaveLiveStatus(env).configurationReady).toBe(true);
    expect(configuredLiveStudentSubscriptionAdapter(env)).toBeInstanceOf(FlutterwaveLiveAdapter);
  });
  it("TEST construction never reads dedicated LIVE secrets or public credentials", () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: "production", FLUTTERWAVE_TEST_SECRET_KEY: "FLWSECK_TEST-fictional-test-key" };
    for (const key of ["FLUTTERWAVE_LIVE_SECRET_KEY", "FLUTTERWAVE_LIVE_PUBLIC_KEY"]) {
      Object.defineProperty(env, key, { get() { throw new Error("LIVE credential must not be read"); } });
    }
    expect(configuredTestAdapter("FLUTTERWAVE", env)).toBeInstanceOf(FlutterwaveTestAdapter);
    expect(configuredTestAdapter("FLUTTERWAVE", { NODE_ENV: "production",
      FLUTTERWAVE_LIVE_SECRET_KEY: live().FLUTTERWAVE_LIVE_SECRET_KEY })).toBeNull();
  });
  it("TEST factory never reads the generic credential, even outside Development", () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: "production", FLUTTERWAVE_TEST_SECRET_KEY: "FLWSECK_TEST-fictional-test-key" };
    Object.defineProperty(env, "FLUTTERWAVE_SECRET_KEY", { get() { throw new Error("Generic credential must not be read"); } });
    expect(configuredTestAdapter("FLUTTERWAVE", env)).toBeInstanceOf(FlutterwaveTestAdapter);
    expect(configuredTestAdapter("FLUTTERWAVE", { NODE_ENV: "production", FLUTTERWAVE_SECRET_KEY: "FLWSECK_TEST-fictional-test-key" })).toBeNull();
  });
  it("explicit LIVE or invalid selection cannot fall back to a TEST adapter", () => {
    for (const mode of ["LIVE", "live", "INVALID", ""]) {
      expect(configuredTestAdapter("FLUTTERWAVE", { ...live(), EDUCORE_FLUTTERWAVE_MODE: mode,
        FLUTTERWAVE_TEST_SECRET_KEY: "FLWSECK_TEST-fictional-test-key" })).toBeNull();
    }
  });
  it("TEST adapters reject LIVE keys and TEST payroll cannot consume the LIVE credential slot", () => {
    expect(() => new FlutterwaveTestAdapter({ secretKey: live().FLUTTERWAVE_LIVE_SECRET_KEY! })).toThrow();
    const env = { NODE_ENV: "test", PAYROLL_TRANSFER_MODE: "test",
      FLUTTERWAVE_SECRET_KEY: "FLWSECK_TEST-fictional-misplaced-key" };
    expect(configuredPayrollProviderCapability(env)).toMatchObject({ mode: "NOT_CONFIGURED", credentialsConfigured: false });
  });
  it("separates LIVE and TEST webhook verifiers and refuses shared-hash LIVE fallback", () => {
    expect(flutterwaveTestWebhookVerifier(live())).toBe(live().FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH);
    expect(flutterwaveTestWebhookVerifier({ ...live(), FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH: undefined })).toBeUndefined();
    expect(flutterwaveTestWebhookVerifier({ ...live(), FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH: live().FLUTTERWAVE_WEBHOOK_VERIF_HASH })).toBeUndefined();
    expect(flutterwaveTestWebhookVerifier({ FLUTTERWAVE_WEBHOOK_VERIF_HASH: "fictional-legacy-test-verifier" })).toBe("fictional-legacy-test-verifier");
    expect(flutterwaveLiveStatus({ ...live(), FLUTTERWAVE_WEBHOOK_VERIF_HASH: undefined }).configurationReady).toBe(false);
    expect(flutterwaveTestWebhookVerifier({ ...live(), EDUCORE_FLUTTERWAVE_WEBHOOK_ENVIRONMENT: "invalid" })).toBeUndefined();
  });
  it("projects no credentials and never represents configuration as readiness evidence", () => {
    const status = flutterwaveLiveStatus(live());
    expect(status).toMatchObject({ configurationReady: true, checkoutEnabled: false, providerTransportEnabled: false });
    expect(JSON.stringify(status)).not.toContain("fictional");
    expect(flutterwaveLiveStatus({ ...live(), FLUTTERWAVE_LIVE_SETTLEMENT_CONFIRMED: "true",
      EDUCORE_FLUTTERWAVE_CHECKOUT_ENABLED: "true" }).checkoutEnabled).toBe(false);
  });
  it("fully configured LIVE still cannot initialize, verify, refund or resolve a webhook", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const adapter = new FlutterwaveLiveAdapter(live(), { fetch });
    const resolveExpectedPayment = vi.fn();
    expect(adapter.generateReference()).toMatch(/^SCV3_fee_/);
    await expect(adapter.initializePayment(input)).rejects.toThrow("remains blocked");
    await expect(adapter.verifyPayment({ ...input, providerTransactionId: "123456" })).rejects.toThrow("transport remains blocked");
    await expect(adapter.verifyCheckoutStatus(input)).rejects.toThrow("transport remains blocked");
    await expect(adapter.getPaymentStatus({ ...input, providerTransactionId: "123456" })).rejects.toThrow("transport remains blocked");
    await expect(adapter.handleWebhook({ rawBody: '{"event":"charge.completed"}',
      headers: { "verif-hash": live().FLUTTERWAVE_WEBHOOK_VERIF_HASH }, resolveExpectedPayment })).rejects.toThrow("event persistence remains blocked");
    await expect(adapter.requestRefund({ providerTransactionId: "123456", amountMinor: 10000,
      currency: "NGN", reason: "Fictional refund must not execute" })).rejects.toThrow("transport remains blocked");
    expect(fetch).not.toHaveBeenCalled();
    expect(resolveExpectedPayment).not.toHaveBeenCalled();
  });
  it.each([undefined, "incorrect-verifier", "fictional-test-verifier-456"])("rejects wrong LIVE hash %s", hash => {
    const adapter = new FlutterwaveLiveAdapter(live(), { fetch: vi.fn() });
    expect(() => adapter.authenticateWebhook({ "verif-hash": hash })).toThrow("hash is invalid");
    expect(() => adapter.authenticateWebhook({ "flutterwave-signature": live().FLUTTERWAVE_WEBHOOK_VERIF_HASH })).toThrow("hash is invalid");
  });
  it.each([false, true])("keeps school-only fixed V3 allocation, eligible Partner %s", hasPartner => {
    expect(fixedSplitInstructions("RS_FictionalSchool123", hasPartner ? "RS_FictionalPartner12" : null, 3))
      .toEqual([{ id: "RS_FictionalSchool123", transaction_charge_type: "flat_subaccount", transaction_charge: 1900 }]);
    const result = studentPostFeePayouts(input.reference, hasPartner, 7000);
    expect(result).toMatchObject({ schoolMinor: 190000, merchantRemainderMinor: 303000, partnerMinor: hasPartner ? 10000 : 0 });
    expect(result.ownerNetMinor).toBe(hasPartner ? 293000 : 303000);
    expect(studentAllocationPolicy(input.reference).deferredPartner).toBe(true);
  });
  it("retains historical policies rather than reinterpreting old payments", () => {
    expect(studentAllocationPolicy("fee_historical_payment")).toMatchObject({ version: 1, schoolMinor: 200000, deferredPartner: false });
    expect(studentAllocationPolicy("SCV2_historical_payment")).toMatchObject({ version: 2, schoolMinor: 190000, deferredPartner: false });
  });
});

const app = express();
app.use("/live", express.raw({ type: "application/json", limit: "64kb" }), studentSubscriptionLiveWebhookRouter);
const server = app.listen(0, "127.0.0.1");
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });
it("LIVE HTTP ingress rejects wrong/test hashes and never acknowledges unpersisted events as successful", async () => {
  const keys = Object.keys(live());
  for (const key of keys) vi.stubEnv(key, live()[key]!);
  try {
    if (!server.listening) await new Promise<void>(resolve => server.once("listening", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/live`;
    for (const [hash, status] of [[undefined, 401], ["fictional-test-verifier-456", 401], [live().FLUTTERWAVE_WEBHOOK_VERIF_HASH, 503]] as const) {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(hash ? { "verif-hash": hash } : {}) }, body: '{"event":"charge.completed"}' });
      expect(response.status).toBe(status);
      const body = await response.text();
      expect(body).not.toContain("fictional");
      if (status === 503) expect(JSON.parse(body).processed).toBe(false);
    }
    // Authenticated retries, mismatches and adverse events must not bypass the
    // missing LIVE persistence/verification gate, or acknowledge financial work.
    const handleWebhook = vi.spyOn(FlutterwaveLiveAdapter.prototype, "handleWebhook");
    try {
      for (const payload of [
        { event: "charge.completed", data: { id: 123456, tx_ref: input.reference, amount: 5000, currency: "NGN", status: "successful" } },
        { event: "charge.completed", data: { id: 123456, tx_ref: input.reference, amount: 1, currency: "USD", status: "successful" } },
        { event: "charge.completed", data: { id: 123456, tx_ref: "unknown_reference", amount: 5000, currency: "NGN", status: "successful" } },
        { event: "charge.completed", data: { id: 123456, tx_ref: input.reference, status: "reversed" } },
        { TransactionId: 123456, FlwRef: "fictional-provider-reference", AmountRefunded: 100, status: "completed" },
      ]) {
        for (let attempt = 0; attempt < 2; attempt++) {
          const response = await fetch(url, { method: "POST", headers: {
            "content-type": "application/json", "verif-hash": live().FLUTTERWAVE_WEBHOOK_VERIF_HASH!,
          }, body: JSON.stringify(payload) });
          expect(response.status).toBe(503);
          expect(await response.json()).toMatchObject({ processed: false });
        }
      }
      expect(handleWebhook).not.toHaveBeenCalled();
    } finally {
      handleWebhook.mockRestore();
    }
    vi.stubEnv("EDUCORE_FLUTTERWAVE_LIVE_ENABLED", "");
    expect((await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(503);
  } finally { vi.unstubAllEnvs(); }
});
