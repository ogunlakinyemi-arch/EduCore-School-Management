import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configuredStudentNfcTestAdapter, configuredTestAdapter } from "./factory";
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("REPLIT_DEPLOYMENT", "");
  vi.stubEnv("FLUTTERWAVE_SECRET_Test_Key", "FLWSECK_TEST-nfc-test-only");
  vi.stubEnv("FLUTTERWAVE_TEST_SECRET_KEY", "");
  vi.stubEnv("FLUTTERWAVE_SECRET_KEY", "FLWSECK-live-do-not-use");
  vi.stubEnv("FLUTTERWAVE_WEBHOOK_VERIF_HASH", "nfc-test-webhook-secret");
});
afterEach(() => vi.unstubAllEnvs());
describe("NFC-isolated Development TEST credential", () => {
  it("uses the supplied mixed-case TEST key without selecting a generic live key", () => {
    expect(configuredStudentNfcTestAdapter()?.provider).toBe("flutterwave");
    expect(() => configuredTestAdapter("FLUTTERWAVE")).toThrow();
  });
  it("rejects conflicting TEST aliases", () => {
    vi.stubEnv("FLUTTERWAVE_TEST_SECRET_KEY", "FLWSECK_TEST-different-key");
    expect(configuredStudentNfcTestAdapter()).toBeNull();
  });
  it.each(["FLWSECK-live-nfc", "not-a-key"])("rejects malformed/live dedicated credentials", key => {
    vi.stubEnv("FLUTTERWAVE_SECRET_Test_Key", key);
    expect(() => configuredStudentNfcTestAdapter()).toThrow();
  });
  it.each(["production", "deployment"])("never enables the new alias in %s", target => {
    if (target === "production") vi.stubEnv("NODE_ENV", "production");
    else vi.stubEnv("REPLIT_DEPLOYMENT", "1");
    expect(() => configuredStudentNfcTestAdapter()).toThrow();
  });
});
