import { describe, expect, it, vi } from "vitest";
import { liveOwnerResolutionConfigured, officialOwnerAccountName } from "./owner-receiving-account-policy";
import { FlutterwavePayrollV3Client } from "./flutterwave-payroll-v3";

const live = { NODE_ENV: "production", EDUCORE_FLUTTERWAVE_MODE: "LIVE",
  FLUTTERWAVE_LIVE_SECRET_KEY: "FLWSECK-fictional-owner-only" };
describe("conservative Owner receiving-account policy", () => {
  it.each(["YETENIA TECHNOLOGIES LIMITED", " yetenia   technologies ltd. ", "Yetenia-Technologies-Limited"])(
    "accepts only documented legal-name normalization: %s", name => expect(officialOwnerAccountName(name)).toBe(true));
  it.each(["YETENIA TECHNOLOGY LIMITED", "YETENIA LTD", "TECHNOLOGIES YETENIA LIMITED",
    "YETENIA TECHNOLOGIES LIMITED / Other Person", "YETENIA TECHNOLOGIES LIMITED 1", "", null])(
    "rejects approximate, incomplete or extra names: %s", name => expect(officialOwnerAccountName(name)).toBe(false));
  it.each([
    { ...live, NODE_ENV: "development" }, { ...live, EDUCORE_FLUTTERWAVE_MODE: "TEST" },
    { ...live, FLUTTERWAVE_LIVE_SECRET_KEY: "FLWSECK-TEST-only" },
    { ...live, FLUTTERWAVE_LIVE_SECRET_KEY: "", FLUTTERWAVE_TEST_SECRET_KEY: "FLWSECK_TEST-fictional" },
  ])("never sends an Owner lookup with sandbox or wrong runtime credentials", async env => {
    const fetcher = vi.fn();
    expect(liveOwnerResolutionConfigured(env)).toBe(false);
    await expect(new FlutterwavePayrollV3Client(env, fetcher).resolveNigerianAccount(
      { bankCode: "099", accountNumber: "0123456789" }, { requireOwnerLive: true })).rejects.toThrow("Sandbox");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses LIVE resolution only, accepts a normalized matching number and does not enable transfers", async () => {
    const fetcher = vi.fn(async (_input: unknown, _init?: RequestInit) => new Response(JSON.stringify({
      status: "success", data: { account_number: "012 345-6789", account_name: "YETENIA TECHNOLOGIES LIMITED" },
    })));
    const client = new FlutterwavePayrollV3Client(live, fetcher);
    expect(await client.resolveNigerianAccount({ bankCode: "099", accountNumber: "0123456789" },
      { requireOwnerLive: true })).toMatchObject({ resolvedAccountNumber: "0123456789" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.flutterwave.com/v3/accounts/resolve");
    expect(client.capability().transferCapability).not.toBe("SUPPORTED");
  });
  it.each([
    { status: "success", data: { account_number: "9999999999", account_name: "YETENIA TECHNOLOGIES LIMITED" } },
    { status: "success", data: { account_number: 123456789, account_name: "YETENIA TECHNOLOGIES LIMITED" } },
    { status: "success", data: { account_number: "0123456789extra", account_name: "YETENIA TECHNOLOGIES LIMITED" } },
    { data: { account_number: "0123456789", account_name: "YETENIA TECHNOLOGIES LIMITED" } },
    { status: "success", data: null },
  ])("rejects ambiguous or nonmatching provider bodies", async body => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(body)));
    await expect(new FlutterwavePayrollV3Client(live, fetcher).resolveNigerianAccount(
      { bankCode: "099", accountNumber: "0123456789" }, { requireOwnerLive: true })).rejects.toThrow();
  });
});
