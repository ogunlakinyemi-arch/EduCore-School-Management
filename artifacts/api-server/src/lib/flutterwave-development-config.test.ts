import { describe, expect, it, vi } from "vitest";
import { developmentFlutterwaveCollectionStatus, developmentFlutterwaveCredential } from "./flutterwave-development-config";
import { configuredPayrollProviderCapability, FlutterwavePayrollV3Client, FlutterwavePayrollUnavailableError } from "./flutterwave-payroll-v3";

const env = (): NodeJS.ProcessEnv => ({ NODE_ENV: "development", REPLIT_DEV_DOMAIN: "fixture.replit.dev",
  SESSION_SECRET: "fixture-signing-only", FLUTTERWAVE_SECRET_Test_Key: "FLWSECK_TEST-fixture1234" });

describe("Flutterwave collection configuration is separate from payouts", () => {
  it("recognizes the existing mixed-case TEST secret without enabling transfers", () => {
    expect(developmentFlutterwaveCollectionStatus(env())).toMatchObject({
      mode: "TEST", credentialState: "CONFIGURED", credentialsConfigured: true,
      webhookConfigured: false, checkoutConfigured: true, assistedCheckoutConfigured: false,
      checkoutVerified: false, automaticSplitSettlementEnabled: false, automaticSplitSettlementVerified: false,
    });
    expect(configuredPayrollProviderCapability(env())).toMatchObject({ mode: "NOT_CONFIGURED", transferCapability: "NOT_CONFIGURED" });
  });
  it("enables explicit TEST payouts using the same safe dedicated alias, never implicitly", () => {
    expect(configuredPayrollProviderCapability({ ...env(), PAYROLL_TRANSFER_MODE: "test" })).toMatchObject({ mode: "TEST", credentialsConfigured: true });
  });
  it.each(["FLWSECK_LIVE-not-permitted", "invalid"])("rejects invalid or live dedicated keys without exposing them", key => {
    const configuration = { ...env(), FLUTTERWAVE_SECRET_Test_Key: key };
    expect(developmentFlutterwaveCollectionStatus(configuration)).toMatchObject({ credentialState: "INVALID", credentialsConfigured: false });
    expect(JSON.stringify(developmentFlutterwaveCollectionStatus(configuration))).not.toContain(key);
  });
  it("fails closed for conflicting TEST aliases even with a generic secret present", () => {
    const configuration = { ...env(), FLUTTERWAVE_TEST_SECRET_KEY: "FLWSECK_TEST-another1234", FLUTTERWAVE_SECRET_KEY: "FLWSECK_TEST-generic1234", PAYROLL_TRANSFER_MODE: "test" };
    expect(developmentFlutterwaveCredential(configuration)).toMatchObject({ state: "CONFLICT", secret: null });
    expect(configuredPayrollProviderCapability(configuration)).toMatchObject({ mode: "NOT_CONFIGURED" });
  });
  it("does not consult the generic potentially live key when the dedicated TEST key is valid", () => {
    const configuration = { ...env(), FLUTTERWAVE_SECRET_KEY: "FLWSECK_LIVE-do-not-use" };
    expect(developmentFlutterwaveCollectionStatus(configuration).mode).toBe("TEST");
  });
  it.each([{ NODE_ENV: "production" }, { REPLIT_DEPLOYMENT: "1" }])("never enables the Development alias on deployment", override => {
    expect(developmentFlutterwaveCollectionStatus({ ...env(), ...override })).toMatchObject({ mode: "NOT_CONFIGURED", credentialState: "BLOCKED" });
  });
  it("reports missing credentials and missing return/signing configuration independently", () => {
    expect(developmentFlutterwaveCollectionStatus({ NODE_ENV: "development" })).toMatchObject({ credentialState: "MISSING", checkoutConfigured: false });
    expect(developmentFlutterwaveCollectionStatus({ ...env(), SESSION_SECRET: "" })).toMatchObject({ credentialsConfigured: true, checkoutConfigured: false });
  });
  it("distinguishes webhook configuration from verified webhook delivery and payment", () => {
    const result = developmentFlutterwaveCollectionStatus({ ...env(), FLUTTERWAVE_WEBHOOK_VERIF_HASH: "private-fixture-value" });
    expect(result).toMatchObject({ webhookConfigured: true, assistedCheckoutConfigured: true, checkoutVerified: false });
    expect(JSON.stringify(result)).not.toContain("private-fixture-value");
    expect(JSON.stringify(result)).not.toContain("fixture1234");
  });
  it("permits read-only TEST bank resolution without enabling payroll or subaccounts", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      status: "success", data: { account_number: "1234567890", account_name: "Official Test Fixture" },
    }), { status: 200 }));
    const client = new FlutterwavePayrollV3Client(env(), fetchImpl);
    await expect(client.resolveNigerianAccount({ bankCode: "044", accountNumber: "1234567890" })).resolves.toMatchObject({ resolvedAccountName: "Official Test Fixture" });
    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://api.flutterwave.com/v3/accounts/resolve");
    await expect(client.createNgnTransfer({ reference: "fixture-test-1", bankCode: "044", accountNumber: "1234567890", amountNaira: 5000, periodMonth: "2026-10" })).rejects.toBeInstanceOf(FlutterwavePayrollUnavailableError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
