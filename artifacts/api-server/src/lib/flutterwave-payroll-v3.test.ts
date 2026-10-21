import { describe, expect, it, vi } from "vitest";
import {
  configuredPayrollProviderCapability,
  describeProviderDiagnostic,
  FlutterwaveProviderResponseError,
  FlutterwaveProviderUncertainError,
  FlutterwavePayrollAmbiguousError,
  FlutterwavePayrollPayrollIntegrityError,
  FlutterwavePayrollUnavailableError,
  FlutterwavePayrollV3Client,
} from "./flutterwave-payroll-v3";

const testEnv = (): NodeJS.ProcessEnv => ({
  NODE_ENV: "test",
  PAYROLL_TRANSFER_MODE: "test",
  FLUTTERWAVE_TEST_SECRET_KEY: "FLWSECK_TEST-abcdefgh12345678",
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("Flutterwave v3 payroll transfers", () => {
  it("fails closed in Development for a live mode and does not contact any provider", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const env = {
      NODE_ENV: "development",
      PAYROLL_TRANSFER_MODE: "live",
      FLUTTERWAVE_LIVE_SECRET_KEY: "FLWSECK_LIVE-abcdefgh12345678",
      FLUTTERWAVE_TRANSFER_CAPABILITY_CONFIRMED: "true",
      FLUTTERWAVE_KYC_APPROVED: "true",
      FLUTTERWAVE_SERVER_IP_WHITELIST_CONFIRMED: "true",
      FLUTTERWAVE_NGN_WALLET_FUNDED_CONFIRMED: "true",
    } satisfies NodeJS.ProcessEnv;
    const client = new FlutterwavePayrollV3Client(env, fetchImpl);

    expect(configuredPayrollProviderCapability(env)).toMatchObject({
      mode: "NOT_CONFIGURED",
      transferCapability: "BLOCKED_IN_DEVELOPMENT",
      bankSubaccountsSupported: false,
      liveSettlementVerified: false,
    });
    await expect(client.createNgnTransfer({
      reference: "YMTPAY-1",
      bankCode: "044",
      accountNumber: "1234567890",
      amountNaira: 5000,
      periodMonth: "2025-03",
    })).rejects.toBeInstanceOf(FlutterwavePayrollUnavailableError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses only the configured v3 account-resolution and transfer endpoints and returns no paid claim", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        status: "success",
        data: { account_number: "1234567890", account_name: "Ada Example" },
      }))
      .mockResolvedValueOnce(jsonResponse({
        status: "success",
        data: { id: 3921, reference: "YMTPAY-a1b2", status: "NEW" },
      }));
    const client = new FlutterwavePayrollV3Client(testEnv(), fetchImpl);

    await expect(client.resolveNigerianAccount({
      bankCode: "044",
      accountNumber: "1234567890",
    })).resolves.toEqual({
      resolvedAccountNumber: "1234567890",
      resolvedAccountName: "Ada Example",
    });
    const accepted = await client.createNgnTransfer({
      reference: "YMTPAY-a1b2",
      bankCode: "044",
      accountNumber: "1234567890",
      amountNaira: 25000,
      periodMonth: "2025-03",
    });

    expect(accepted).toEqual({
      providerTransferId: "3921",
      reference: "YMTPAY-a1b2",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://api.flutterwave.com/v3/accounts/resolve");
    expect(String(fetchImpl.mock.calls[1][0])).toBe("https://api.flutterwave.com/v3/transfers");
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toMatchObject({
      amount: 25000,
      currency: "NGN",
      reference: "YMTPAY-a1b2",
      account_number: "1234567890",
      account_bank: "044",
    });
  });

  it("requires exact transfer ID, reference, recipient, currency and whole-naira amount evidence before reporting PAID", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockImplementation(async () => jsonResponse({
        status: "success",
        data: {
          id: 3921,
          reference: "YMTPAY-a1b2",
          amount: 25000,
          fee: 10,
          currency: "NGN",
          account_number: "1234567890",
          bank_code: "044",
          status: "SUCCESSFUL",
          created_at: "2025-03-31T10:00:00.000Z",
        },
      }));
    const client = new FlutterwavePayrollV3Client(testEnv(), fetchImpl);
    const evidence = await client.verifyNgnTransferById({
      transferId: "3921",
      expectedReference: "YMTPAY-a1b2",
      expectedBankCode: "044",
      expectedAccountNumber: "1234567890",
      expectedAmountNaira: 25000,
    });
    expect(evidence).toMatchObject({
      transferId: "3921",
      status: "SUCCESSFUL",
      amountNaira: 25000,
      providerFeeNaira: 10,
      currency: "NGN",
    });
    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://api.flutterwave.com/v3/transfers/3921");

    await expect(client.verifyNgnTransferById({
      transferId: "3921",
      expectedReference: "different",
      expectedBankCode: "044",
      expectedAccountNumber: "1234567890",
      expectedAmountNaira: 25000,
    })).rejects.toBeInstanceOf(FlutterwavePayrollPayrollIntegrityError);
  });

  it("reconciles by exact merchant reference and treats an empty provider index as unknown, not failed", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ status: "success", data: [] }));
    const client = new FlutterwavePayrollV3Client(testEnv(), fetchImpl);
    await expect(client.verifyNgnTransferByReference({
      reference: "YMTPAY-a1b2",
      expectedBankCode: "044",
      expectedAccountNumber: "1234567890",
      expectedAmountNaira: 25000,
    })).resolves.toBeNull();
    expect(String(fetchImpl.mock.calls[0][0])).toContain("/v3/transfers?reference=YMTPAY-a1b2");

    const ambiguousClient = new FlutterwavePayrollV3Client(
      testEnv(),
      vi.fn<typeof fetch>().mockRejectedValue(new Error("network")),
    );
    await expect(ambiguousClient.createNgnTransfer({
      reference: "YMTPAY-a1b2",
      bankCode: "044",
      accountNumber: "1234567890",
      amountNaira: 25000,
      periodMonth: "2025-03",
    })).rejects.toBeInstanceOf(FlutterwavePayrollAmbiguousError);
  });

  describe("sanitized bank-resolution diagnostics (mocked HTTP only)", () => {
    const secret = "FLWSECK_TEST-abcdefgh12345678";
    const accountNumber = "0123456789";
    const leakyMessage = (extra: string) =>
      `${extra} for ${accountNumber} holder Ada Fictional key ${secret} bvn 22222222222`;

    async function diagnose(fetchImpl: typeof fetch) {
      const client = new FlutterwavePayrollV3Client(testEnv(), fetchImpl);
      const error = await client.resolveNigerianAccount({ bankCode: "044", accountNumber })
        .then(() => null, (failure: unknown) => failure);
      expect(fetchImpl).toHaveBeenCalledTimes(1); // no retries
      const serialized = JSON.stringify({ error, message: (error as Error).message, diagnostic: (error as any).diagnostic });
      for (const forbidden of [secret, accountNumber, "Ada Fictional", "22222222222", "holder"]) {
        expect(serialized).not.toContain(forbidden);
      }
      return error as FlutterwaveProviderResponseError | FlutterwaveProviderUncertainError;
    }

    it.each([
      [401, "Invalid authorization key", "PROVIDER_AUTH_REJECTED", "CREDENTIAL_REJECTED"],
      [403, "Forbidden", "PROVIDER_AUTH_REJECTED", "CREDENTIAL_REJECTED"],
      [400, "Sorry, recipient account could not be validated. Please try again", "INVALID_BANK_OR_ACCOUNT", "ACCOUNT_NOT_RESOLVED"],
      [400, "Invalid bank code supplied", "INVALID_BANK_OR_ACCOUNT", "BANK_NOT_SUPPORTED"],
      [422, "Something else entirely", "INVALID_BANK_OR_ACCOUNT", "UNCLASSIFIED"],
      [429, "Too many requests", "PROVIDER_RATE_LIMITED", "UNCLASSIFIED"],
      [500, "Internal server error", "PROVIDER_OUTAGE", "UNCLASSIFIED"],
      [503, "Service unavailable", "PROVIDER_OUTAGE", "UNCLASSIFIED"],
    ])("HTTP %i keeps provider status with category %s/%s", async (status, message, category, reason) => {
      const error = await diagnose(vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({ status: "error", message: leakyMessage(message), data: { account_number: accountNumber } }, status),
      ));
      expect(error).toBeInstanceOf(FlutterwaveProviderResponseError);
      expect(error).toBeInstanceOf(FlutterwavePayrollUnavailableError);
      expect(error.operation).toBe("ACCOUNT_RESOLUTION");
      expect(error.diagnostic).toEqual({ providerHttpStatus: status, category, reason });
      expect(describeProviderDiagnostic(error.diagnostic)).toContain(`provider HTTP ${status}`);
    });

    it("classifies a 200 response without a status field as an unexpected schema", async () => {
      const error = await diagnose(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ data: { account_number: accountNumber } })));
      expect(error.diagnostic).toEqual({
        providerHttpStatus: 200, category: "UNEXPECTED_PROVIDER_RESPONSE", reason: "MISSING_STATUS_FIELD",
      });
    });

    it("classifies a successful response for a different account as unexpected, not verified", async () => {
      const error = await diagnose(vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
        status: "success", data: { account_number: "9999999999", account_name: "Ada Fictional" },
      })));
      expect(error).toBeInstanceOf(FlutterwaveProviderResponseError);
      expect(error.diagnostic.reason).toBe("RESOLVED_DETAILS_DID_NOT_MATCH");
    });

    it("keeps timeouts, network failures and non-JSON bodies as uncertain", async () => {
      const timeout = Object.assign(new Error(`timed out ${secret}`), { name: "TimeoutError" });
      expect((await diagnose(vi.fn<typeof fetch>().mockRejectedValue(timeout))).diagnostic)
        .toEqual({ providerHttpStatus: null, category: "PROVIDER_TIMEOUT", reason: "UNCLASSIFIED" });
      const network = await diagnose(vi.fn<typeof fetch>().mockRejectedValue(new Error(`ECONNRESET ${accountNumber}`)));
      expect(network).toBeInstanceOf(FlutterwaveProviderUncertainError);
      expect(network).toBeInstanceOf(FlutterwavePayrollAmbiguousError);
      expect(network.diagnostic.category).toBe("PROVIDER_NETWORK_FAILURE");
      const html = await diagnose(vi.fn<typeof fetch>().mockResolvedValue(
        new Response(`<html>${accountNumber}</html>`, { status: 502 }),
      ));
      expect(html.diagnostic).toEqual({ providerHttpStatus: 502, category: "NON_JSON_PROVIDER_RESPONSE", reason: "UNCLASSIFIED" });
    });
  });

  it("rejects bank-account mismatches, malformed provider amounts and non-integer transfers", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        status: "success",
        data: { account_number: "9999999999", account_name: "Someone Else" },
      }));
    const client = new FlutterwavePayrollV3Client(testEnv(), fetchImpl);
    await expect(client.resolveNigerianAccount({
      bankCode: "044",
      accountNumber: "1234567890",
    })).rejects.toBeInstanceOf(FlutterwavePayrollUnavailableError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await expect(client.createNgnTransfer({
      reference: "YMTPAY-a1b2",
      bankCode: "044",
      accountNumber: "1234567890",
      amountNaira: 25000.25,
      periodMonth: "2025-03",
    })).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});