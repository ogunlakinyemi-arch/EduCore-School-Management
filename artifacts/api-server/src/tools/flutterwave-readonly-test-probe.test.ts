import { describe, expect, it, vi } from "vitest";
import { probeTestBankCatalog } from "./flutterwave-readonly-test-probe";
const env = { NODE_ENV: "development", REPLIT_DEV_DOMAIN: "fixture.replit.dev", FLUTTERWAVE_SECRET_Test_Key: "FLWSECK_TEST-synthetic-only" };
describe("read-only TEST authentication probe safety", () => {
  it.each([{ NODE_ENV: "production" }, { REPLIT_DEPLOYMENT: "1" }, { FLUTTERWAVE_SECRET_Test_Key: "" },
    { FLUTTERWAVE_SECRET_Test_Key: "FLWSECK_LIVE-refuse-this" }, { REPLIT_DEV_DOMAIN: "" }])("refuses unsafe configuration before transport", async override => {
    const transport = vi.fn<typeof fetch>();
    expect(await probeTestBankCatalog({ ...env, ...override }, transport)).toMatchObject({ evidence: "NOT_RUN" });
    expect(transport).not.toHaveBeenCalled();
  });
  it("uses one GET, rejects redirects and returns counts rather than response data or keys", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      status: "success", data: [{ code: "synthetic-bank" }], echoedSecret: env.FLUTTERWAVE_SECRET_Test_Key,
    }), { status: 200 }));
    const result = await probeTestBankCatalog(env, transport);
    expect(result).toMatchObject({ testAuthenticationAccepted: true, catalogEntryCount: 1, providerMutations: 0, paymentVerified: false });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][1]).toMatchObject({ method: "GET", redirect: "error" });
    expect(JSON.stringify(result)).not.toContain("synthetic");
  });
  it("does not expose an upstream rejection body or treat it as authentication evidence", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      status: "error", message: env.FLUTTERWAVE_SECRET_Test_Key,
    }), { status: 401 }));
    const result = await probeTestBankCatalog(env, transport);
    expect(result).toMatchObject({ httpStatus: 401, testAuthenticationAccepted: false });
    expect(JSON.stringify(result)).not.toContain(env.FLUTTERWAVE_SECRET_Test_Key);
  });
  it("does not retry or expose a transport failure", async () => {
    const transport = vi.fn<typeof fetch>().mockRejectedValue(new Error(env.FLUTTERWAVE_SECRET_Test_Key));
    expect(await probeTestBankCatalog(env, transport)).toMatchObject({ evidence: "PROVIDER_READ_UNCONFIRMED" });
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
