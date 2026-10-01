import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { configuredTestAdapter } from "./factory";
import {
  FlutterwaveTestAdapter,
  PaystackTestAdapter,
  PaymentProviderError,
  RemitaAdapter,
  type ExpectedPayment,
} from "./index";

const expected: ExpectedPayment = {
  reference: "fee_0123456789abcdef",
  amountMinor: 1234,
  currency: "NGN",
};
const paystackSecret = "sk_test_1234567890abcdef";
const flutterwaveSecret = "FLWSECK_TEST-1234567890abcdef";
const flutterwaveWebhookSecret = "local-webhook-signing-secret";
const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
const fetchMock = (handler: (url: URL, init?: RequestInit) => Response) =>
  vi.fn(async (resource: URL | string, init?: RequestInit) =>
    handler(new URL(String(resource)), init)) as unknown as typeof fetch;

function paystackSignature(raw: Uint8Array | string) {
  return createHmac("sha512", paystackSecret)
    .update(typeof raw === "string" ? Buffer.from(raw, "utf8") : raw)
    .digest("hex");
}

describe("fee payment provider adapters", () => {
  it("initializes and independently verifies Paystack using its test API", async () => {
    const fetch = fetchMock((url, init) => {
      expect(url.origin).toBe("https://api.paystack.co");
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${paystackSecret}`);
      if (url.pathname.endsWith("/transaction/initialize")) {
        const body = JSON.parse(String(init?.body));
        expect(body.amount).toBe(1234);
        expect(body.reference).toBe(expected.reference);
        return jsonResponse({ status: true, data: {
          authorization_url: "https://checkout.paystack.com/checkout-test", access_code: "test-code",
          reference: expected.reference,
        } });
      }
      return jsonResponse({ status: true, data: {
        id: 456, status: "success", reference: expected.reference, amount: 1234, currency: "NGN",
        paid_at: "2025-01-01T00:00:00Z",
      } });
    });
    const adapter = new PaystackTestAdapter({ secretKey: paystackSecret }, { fetch });

    await expect(adapter.initializePayment({
      ...expected, email: "parent@example.test", returnUrl: "https://school.example/fees/return",
    })).resolves.toMatchObject({
      reference: expected.reference, checkoutUrl: "https://checkout.paystack.com/checkout-test", accessCode: "test-code",
    });
    await expect(adapter.verifyPayment(expected)).resolves.toMatchObject({
      ...expected, status: "succeeded", providerTransactionId: "456",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("independently confirms terminal Paystack abandonment by the persisted reference", async () => {
    const fetch = fetchMock((url) => {
      expect(url.pathname).toBe(`/transaction/verify/${expected.reference}`);
      return jsonResponse({ status: true, data: {
        id: 457, status: "abandoned", reference: expected.reference, amount: 1234, currency: "NGN",
      } });
    });
    const adapter = new PaystackTestAdapter({ secretKey: paystackSecret }, { fetch });

    await expect(adapter.verifyCheckoutStatus(expected)).resolves.toMatchObject({
      ...expected, status: "failed", providerTransactionId: "457",
    });
  });

  it("looks up Flutterwave by exact tx_ref and then verifies the unique transaction", async () => {
    const fetch = fetchMock((url) => {
      if (url.pathname.endsWith("/transactions")) {
        expect(url.searchParams.get("tx_ref")).toBe(expected.reference);
        return jsonResponse({ status: "success", data: [{
          id: 790, status: "cancelled", tx_ref: expected.reference,
        }] });
      }
      expect(url.pathname).toBe("/v3/transactions/790/verify");
      return jsonResponse({ status: "success", data: {
        id: 790, status: "cancelled", tx_ref: expected.reference, amount: 12.34, currency: "NGN",
      } });
    });
    const adapter = new FlutterwaveTestAdapter({
      secretKey: flutterwaveSecret, webhookSecret: flutterwaveWebhookSecret,
    }, { fetch });

    await expect(adapter.verifyCheckoutStatus(expected)).resolves.toMatchObject({
      ...expected, status: "failed", providerTransactionId: "790",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not infer Flutterwave status when a reference lookup is ambiguous or empty", async () => {
    const adapter = new FlutterwaveTestAdapter({
      secretKey: flutterwaveSecret, webhookSecret: flutterwaveWebhookSecret,
    }, {
      fetch: fetchMock(() => jsonResponse({ status: "success", data: [] })),
    });

    await expect(adapter.verifyCheckoutStatus(expected)).rejects.toThrow(/unknown or ambiguous/);
  });

  it("authenticates and verifies Flutterwave test webhooks by fetching the transaction", async () => {
    const fetch = fetchMock((url, init) => {
      expect(url.origin).toBe("https://api.flutterwave.com");
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${flutterwaveSecret}`);
      return jsonResponse({ status: "success", data: {
        id: 789, status: "successful", tx_ref: expected.reference, amount: 12.34, currency: "NGN",
      } });
    });
    const adapter = new FlutterwaveTestAdapter({
      secretKey: flutterwaveSecret, webhookSecret: flutterwaveWebhookSecret,
    }, { fetch });
    const rawBody = JSON.stringify({ event: "charge.completed", data: { id: 789, tx_ref: expected.reference } });
    const result = await adapter.handleWebhook({
      rawBody,
      headers: { "verif-hash": flutterwaveWebhookSecret },
      resolveExpectedPayment: async (reference) => reference === expected.reference ? expected : null,
    });

    expect(result).toMatchObject({
      outcome: "verified", eventId: "flutterwave:789", payment: { ...expected, status: "succeeded" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects Paystack webhook signature tampering and unrecognized references", async () => {
    const adapter = new PaystackTestAdapter({ secretKey: paystackSecret }, {
      fetch: fetchMock(() => jsonResponse({ status: true, data: {} })),
    });
    const rawBody = JSON.stringify({ event: "charge.success", data: { id: 456, reference: expected.reference } });
    const options = {
      rawBody,
      resolveExpectedPayment: async () => expected,
    };
    await expect(adapter.handleWebhook({ ...options, headers: { "x-paystack-signature": "bad" } }))
      .rejects.toThrow(/signature is invalid/);
    await expect(adapter.handleWebhook({
      ...options,
      headers: { "x-paystack-signature": paystackSignature(rawBody) },
      resolveExpectedPayment: async () => null,
    })).rejects.toThrow(/not recognized/);
  });

  it("rejects amount, currency, and internal-reference mismatches from verification APIs", async () => {
    const adapter = new PaystackTestAdapter({ secretKey: paystackSecret }, {
      fetch: fetchMock(() => jsonResponse({ status: true, data: {
        id: 456, status: "success", reference: expected.reference, amount: 1235, currency: "NGN",
      } })),
    });
    await expect(adapter.verifyPayment(expected)).rejects.toThrow(/amount mismatch/);

    const wrongReferenceAdapter = new PaystackTestAdapter({ secretKey: paystackSecret }, {
      fetch: fetchMock(() => jsonResponse({ status: true, data: {
        id: 456, status: "success", reference: "fee_other123456789", amount: 1234, currency: "NGN",
      } })),
    });
    await expect(wrongReferenceAdapter.verifyPayment(expected)).rejects.toThrow(/reference mismatch/);

    const wrongCurrencyAdapter = new PaystackTestAdapter({ secretKey: paystackSecret }, {
      fetch: fetchMock(() => jsonResponse({ status: true, data: {
        id: 456, status: "success", reference: expected.reference, amount: 1234, currency: "USD",
      } })),
    });
    await expect(wrongCurrencyAdapter.verifyPayment(expected)).rejects.toThrow(/currency mismatch/);
  });

  it("returns stable immutable event identity so caller can settle and dedupe atomically", async () => {
    const fetch = fetchMock(() => jsonResponse({ status: true, data: {
      id: 456, status: "success", reference: expected.reference, amount: 1234, currency: "NGN",
    } }));
    const adapter = new PaystackTestAdapter({ secretKey: paystackSecret }, { fetch });
    const rawBody = JSON.stringify({ event: "charge.success", data: { id: 456, reference: expected.reference } });
    const input = {
      rawBody,
      headers: { "x-paystack-signature": paystackSignature(rawBody) },
      resolveExpectedPayment: async () => expected,
    };
    const firstDelivery = await adapter.handleWebhook(input);

    // Simulate a caller transaction failing before commit. The adapter has no
    // replay state, so a delivery retry yields the same stable identity.
    const settlementKeys = new Set<string>();
    let settlementCount = 0;
    const settleAtomically = (result: typeof firstDelivery, crashBeforeCommit = false) => {
      if (settlementKeys.has(result.eventId)) return;
      if (crashBeforeCommit) throw new Error("simulated crash before commit");
      settlementKeys.add(result.eventId);
      settlementCount += 1;
    };
    expect(() => settleAtomically(firstDelivery, true)).toThrow("simulated crash before commit");
    const retry = await adapter.handleWebhook(input);
    expect(retry.eventId).toBe(firstDelivery.eventId);
    expect(retry).toMatchObject({ outcome: "verified", payment: firstDelivery.payment });

    // This set models the caller's UNIQUE event key in the same transaction as
    // settlement: a post-commit redelivery is idempotently ignored by caller code.
    settleAtomically(retry);
    settleAtomically(await adapter.handleWebhook(input));
    expect(settlementCount).toBe(1);
    expect(firstDelivery.eventId).toBe("paystack:456");
    expect(Object.isFrozen(firstDelivery)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(firstDelivery, "eventId")?.writable).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("verifies Paystack HMAC against exact original raw bytes", async () => {
    const adapter = new PaystackTestAdapter({ secretKey: paystackSecret }, {
      fetch: fetchMock(() => jsonResponse({ status: true, data: {
        id: 456, status: "success", reference: expected.reference, amount: 1234, currency: "NGN",
      } })),
    });
    // An invalid UTF-8 byte in an ignored JSON string is decoded as U+FFFD by
    // UTF-8 parsing. Re-encoding that text changes the signed bytes.
    const rawBody = Buffer.concat([
      Buffer.from(`{"event":"charge.success","data":{"id":456,"reference":"${expected.reference}"},"ignored":"`),
      Buffer.from([0xff]),
      Buffer.from('"}'),
    ]);
    const result = await adapter.handleWebhook({
      rawBody,
      headers: { "x-paystack-signature": paystackSignature(rawBody) },
      resolveExpectedPayment: async () => expected,
    });
    expect(result).toMatchObject({ outcome: "verified", eventId: "paystack:456" });
  });

  it.each([
    { amount: 0.07, expectedMinor: 7, suffix: "numeric-007" },
    { amount: 0.29, expectedMinor: 29, suffix: "numeric-029" },
    { amount: "0.07", expectedMinor: 7, suffix: "string-007" },
    { amount: "0.29", expectedMinor: 29, suffix: "string-029" },
  ])("converts Flutterwave decimal amount $amount exactly to minor units", async ({ amount, expectedMinor, suffix }) => {
    const payment = { reference: `fee_${suffix}`, amountMinor: expectedMinor, currency: "NGN" };
    const adapter = new FlutterwaveTestAdapter({
      secretKey: flutterwaveSecret, webhookSecret: flutterwaveWebhookSecret,
    }, {
      fetch: fetchMock(() => jsonResponse({ status: "success", data: {
        id: 789, status: "successful", tx_ref: payment.reference, amount, currency: "NGN",
      } })),
    });
    await expect(adapter.verifyPayment({ ...payment, providerTransactionId: "789" }))
      .resolves.toMatchObject({ ...payment, status: "succeeded", providerTransactionId: "789" });
  });

  it("rejects webhook transaction ID mismatches and malformed or nonpositive IDs", async () => {
    const rawBody = JSON.stringify({ event: "charge.success", data: { id: 457, reference: expected.reference } });
    const mismatchAdapter = new PaystackTestAdapter({ secretKey: paystackSecret }, {
      fetch: fetchMock(() => jsonResponse({ status: true, data: {
        id: 456, status: "success", reference: expected.reference, amount: 1234, currency: "NGN",
      } })),
    });
    await expect(mismatchAdapter.handleWebhook({
      rawBody,
      headers: { "x-paystack-signature": paystackSignature(rawBody) },
      resolveExpectedPayment: async () => expected,
    })).rejects.toThrow(/transaction ID mismatch/);

    const invalidIdBody = JSON.stringify({ event: "charge.success", data: { id: 0, reference: expected.reference } });
    await expect(mismatchAdapter.handleWebhook({
      rawBody: invalidIdBody,
      headers: { "x-paystack-signature": paystackSignature(invalidIdBody) },
      resolveExpectedPayment: async () => expected,
    })).rejects.toThrow(/transaction ID is invalid/);

    const flutterwave = new FlutterwaveTestAdapter({
      secretKey: flutterwaveSecret, webhookSecret: flutterwaveWebhookSecret,
    }, { fetch: fetchMock(() => jsonResponse({ status: "success", data: {} })) });
    await expect(flutterwave.verifyPayment({ ...expected, providerTransactionId: "0" }))
      .rejects.toThrow(/transaction ID is invalid/);
  });

  it("fails closed for missing or live-mode credentials, unsafe URLs, and failed HTTP calls", async () => {
    expect(() => new PaystackTestAdapter({ secretKey: "sk_live_notallowed" }))
      .toThrow(PaymentProviderError);
    expect(() => new FlutterwaveTestAdapter({ secretKey: "live-key", webhookSecret: flutterwaveWebhookSecret }))
      .toThrow(PaymentProviderError);

    const adapter = new PaystackTestAdapter({ secretKey: paystackSecret }, {
      fetch: fetchMock(() => jsonResponse({ message: "do not expose provider response" }, 500)),
    });
    await expect(adapter.initializePayment({
      ...expected, email: "parent@example.test", returnUrl: "http://unsafe.example/return",
    })).rejects.toThrow(/return URL is invalid/);
    await expect(adapter.verifyPayment(expected)).rejects.toThrow("Payment provider request failed");
  });

  it("retries a timed-out verification GET with a fresh bounded request", async () => {
    const fetch = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("request timed out"), { name: "TimeoutError" }))
      .mockResolvedValueOnce(jsonResponse({ status: true, data: {
        id: 456, status: "success", reference: expected.reference, amount: 1234, currency: "NGN",
      } }));
    const adapter = new PaystackTestAdapter({ secretKey: paystackSecret }, {
      fetch: fetch as unknown as typeof globalThis.fetch, timeoutMs: 1_000,
    });

    await expect(adapter.verifyPayment(expected)).resolves.toMatchObject({
      ...expected, status: "succeeded", providerTransactionId: "456",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [, init] of fetch.mock.calls) {
      expect(init?.method).toBe("GET");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect((init?.signal as AbortSignal).aborted).toBe(false);
    }
  });

  it.each([429, 503])("retries verification GET after transient HTTP %i", async (status) => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ message: "transient" }, status))
      .mockResolvedValueOnce(jsonResponse({ status: true, data: {
        id: 456, status: "success", reference: expected.reference, amount: 1234, currency: "NGN",
      } }));
    const adapter = new PaystackTestAdapter({ secretKey: paystackSecret }, {
      fetch: fetch as unknown as typeof globalThis.fetch,
    });

    await expect(adapter.verifyCheckoutStatus(expected)).resolves.toMatchObject({
      ...expected, status: "succeeded", providerTransactionId: "456",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("stops after the bounded number of transient verification failures", async () => {
    const fetch = fetchMock(() => jsonResponse({ message: "transient" }, 503));
    const adapter = new PaystackTestAdapter({ secretKey: paystackSecret }, { fetch });

    await expect(adapter.verifyPayment(expected)).rejects.toThrow("Payment provider request failed");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("never retries checkout initialization POST requests", async () => {
    const methods: string[] = [];
    const fetch = fetchMock((_, init) => {
      methods.push(init?.method ?? "GET");
      return jsonResponse({ message: "transient" }, 503);
    });
    const adapter = new PaystackTestAdapter({ secretKey: paystackSecret }, { fetch });

    await expect(adapter.initializePayment({
      ...expected, email: "parent@example.test", returnUrl: "https://school.example/fees/return",
    })).rejects.toThrow("Payment provider request failed");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(methods).toEqual(["POST"]);
  });

  it("fails closed for an absent Paystack key without contacting the provider", () => {
    expect(() => new PaystackTestAdapter({ secretKey: "" }))
      .toThrow(PaymentProviderError);
  });

  it("keeps Paystack unavailable when its test secret is absent", () => {
    vi.stubEnv("PAYSTACK_TEST_SECRET_KEY", "");
    try {
      expect(configuredTestAdapter("PAYSTACK")).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("uses FLUTTERWAVE_SECRET_KEY as a strictly validated test key", () => {
    vi.stubEnv("FLUTTERWAVE_TEST_SECRET_KEY", "");
    vi.stubEnv("FLUTTERWAVE_SECRET_KEY", flutterwaveSecret);
    vi.stubEnv("FLUTTERWAVE_WEBHOOK_VERIF_HASH", flutterwaveWebhookSecret);
    try {
      expect(configuredTestAdapter("FLUTTERWAVE")?.provider).toBe("flutterwave");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("preserves the legacy Flutterwave test-key configuration", () => {
    vi.stubEnv("FLUTTERWAVE_TEST_SECRET_KEY", flutterwaveSecret);
    vi.stubEnv("FLUTTERWAVE_SECRET_KEY", "");
    vi.stubEnv("FLUTTERWAVE_WEBHOOK_VERIF_HASH", flutterwaveWebhookSecret);
    try {
      expect(configuredTestAdapter("FLUTTERWAVE")?.provider).toBe("flutterwave");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("fails closed when Flutterwave secret aliases conflict", () => {
    vi.stubEnv("FLUTTERWAVE_TEST_SECRET_KEY", flutterwaveSecret);
    vi.stubEnv("FLUTTERWAVE_SECRET_KEY", `${flutterwaveSecret}_different`);
    vi.stubEnv("FLUTTERWAVE_WEBHOOK_VERIF_HASH", flutterwaveWebhookSecret);
    try {
      expect(configuredTestAdapter("FLUTTERWAVE")).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each(["FLWSECK_LIVE-1234567890abcdef", "not-a-test-secret"])(
    "rejects malformed or live Flutterwave keys configured through the test alias",
    (secretKey) => {
      vi.stubEnv("FLUTTERWAVE_TEST_SECRET_KEY", "");
      vi.stubEnv("FLUTTERWAVE_SECRET_KEY", secretKey);
      vi.stubEnv("FLUTTERWAVE_WEBHOOK_VERIF_HASH", flutterwaveWebhookSecret);
      try {
        expect(() => configuredTestAdapter("FLUTTERWAVE")).toThrow(PaymentProviderError);
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );

  it("allows test payments without a webhook hash and never substitutes public or encryption keys", async () => {
    vi.stubEnv("FLUTTERWAVE_TEST_SECRET_KEY", "");
    vi.stubEnv("FLUTTERWAVE_SECRET_KEY", flutterwaveSecret);
    vi.stubEnv("FLUTTERWAVE_WEBHOOK_VERIF_HASH", "");
    vi.stubEnv("FLUTTERWAVE_PUBLIC_KEY", "FLWPUBK_TEST-1234567890abcdef");
    vi.stubEnv("FLUTTERWAVE_ENCRYPTION_KEY", "FLWSECK_TEST-1234567890abcdef");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    try {
      const adapter = configuredTestAdapter("FLUTTERWAVE");
      expect(adapter?.provider).toBe("flutterwave");
      for (const signature of [
        undefined, "FLWPUBK_TEST-1234567890abcdef", "FLWSECK_TEST-1234567890abcdef",
      ]) {
        await expect(adapter?.handleWebhook({
          rawBody: JSON.stringify({ event: "charge.completed", data: { id: 789, tx_ref: expected.reference } }),
          headers: signature ? { "verif-hash": signature } : {},
          resolveExpectedPayment: async () => expected,
        })).rejects.toThrow(/webhook verification hash is invalid/);
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });

  it("initializes and independently verifies Flutterwave test payments without a webhook hash", async () => {
    const fetch = fetchMock((url, init) => {
      if (init?.method === "POST") {
        return jsonResponse({ status: "success", data: { link: "https://checkout.flutterwave.com/test-session" } });
      }
      if (url.pathname === "/v3/transactions") {
        expect(url.searchParams.get("tx_ref")).toBe(expected.reference);
        return jsonResponse({ status: "success", data: [{ id: 789, tx_ref: expected.reference }] });
      }
      return jsonResponse({ status: "success", data: {
        id: 789, status: "successful", tx_ref: expected.reference, amount: 12.34, currency: "NGN",
      } });
    });
    const adapter = new FlutterwaveTestAdapter({ secretKey: flutterwaveSecret }, { fetch });

    await expect(adapter.initializePayment({
      ...expected, email: "parent@example.test", returnUrl: "https://school.example/fees/return",
    })).resolves.toMatchObject({ reference: expected.reference });
    await expect(adapter.verifyCheckoutStatus(expected)).resolves.toMatchObject({
      ...expected, status: "succeeded", providerTransactionId: "789",
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("rejects Flutterwave webhooks when the dedicated hash is absent, regardless of supplied signature", async () => {
    const fetch = fetchMock(() => {
      throw new Error("Webhook verification must not contact the provider without its dedicated hash");
    });
    const adapter = new FlutterwaveTestAdapter({ secretKey: flutterwaveSecret }, { fetch });
    const resolveExpectedPayment = vi.fn(async () => expected);
    const rawBody = JSON.stringify({ event: "charge.completed", data: { id: 789, tx_ref: expected.reference } });

    await expect(adapter.handleWebhook({
      rawBody, headers: {}, resolveExpectedPayment,
    })).rejects.toThrow(PaymentProviderError);
    await expect(adapter.handleWebhook({
      rawBody, headers: { "verif-hash": flutterwaveSecret }, resolveExpectedPayment,
    })).rejects.toThrow(PaymentProviderError);
    expect(resolveExpectedPayment).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { providerStatus: "successful", expectedStatus: "succeeded" },
    { providerStatus: " SUCCESSFUL ", expectedStatus: "succeeded" },
    { providerStatus: "failed", expectedStatus: "failed" },
    { providerStatus: "cancelled", expectedStatus: "failed" },
    { providerStatus: "abandoned", expectedStatus: "failed" },
    { providerStatus: "processing", expectedStatus: "pending" },
    { providerStatus: "unknown-provider-state", expectedStatus: "pending" },
  ] as const)("normalizes provider-neutral status $providerStatus", async ({ providerStatus, expectedStatus }) => {
    const adapter = new FlutterwaveTestAdapter({
      secretKey: flutterwaveSecret, webhookSecret: flutterwaveWebhookSecret,
    }, {
      fetch: fetchMock(() => jsonResponse({ status: "success", data: {
        id: 789, status: providerStatus, tx_ref: expected.reference, amount: "12.34", currency: "ngn",
      } })),
    });
    await expect(adapter.verifyPayment({ ...expected, currency: " ngn ", providerTransactionId: "789" }))
      .resolves.toMatchObject({
        reference: expected.reference, amountMinor: expected.amountMinor, currency: "NGN",
        status: expectedStatus, providerTransactionId: "789",
      });
  });

  it("enforces the shared reference, amount, and currency contract", async () => {
    const verify = async (payment: ExpectedPayment, response: Record<string, unknown>) => {
      const adapter = new FlutterwaveTestAdapter({
        secretKey: flutterwaveSecret, webhookSecret: flutterwaveWebhookSecret,
      }, {
        fetch: fetchMock(() => jsonResponse({ status: "success", data: {
          id: 789, status: "successful", tx_ref: payment.reference, amount: "12.34", currency: "NGN",
          ...response,
        } })),
      });
      return adapter.verifyPayment({ ...payment, providerTransactionId: "789" });
    };
    await expect(verify(expected, {})).resolves.toMatchObject({
      reference: expected.reference, amountMinor: expected.amountMinor, currency: "NGN", status: "succeeded",
    });
    await expect(verify(expected, { tx_ref: "fee_different_reference" })).rejects.toThrow(/reference mismatch/);
    await expect(verify(expected, { amount: "12.35" })).rejects.toThrow(/amount mismatch/);
    await expect(verify(expected, { currency: "USD" })).rejects.toThrow(/currency mismatch/);
  });

  it("snapshots Flutterwave verification fees and settlement separately from gross allocations", async () => {
    const adapter = new FlutterwaveTestAdapter({
      secretKey: flutterwaveSecret, webhookSecret: flutterwaveWebhookSecret,
    }, {
      fetch: fetchMock(() => jsonResponse({ status: "success", data: {
        id: 789, status: "successful", tx_ref: expected.reference, amount: 12.34, currency: "NGN",
        app_fee: "0.30", merchant_fee: "0.20", amount_settled: "11.84",
      } })),
    });
    await expect(adapter.verifyPayment({ ...expected, providerTransactionId: "789" }))
      .resolves.toMatchObject({
        status: "succeeded",
        amountMinor: 1234,
        providerFeeMinor: 50,
        providerSettlementAmountMinor: 1184,
      });
  });

  it("keeps a provider refund pending until Flutterwave reports the final disbursement state", async () => {
    const adapter = new FlutterwaveTestAdapter({
      secretKey: flutterwaveSecret, webhookSecret: flutterwaveWebhookSecret,
    }, {
      fetch: fetchMock((url) => {
        expect(url.pathname).toBe("/v3/refunds/44");
        return jsonResponse({ status: "success", data: {
          id: 44, transaction_id: 789, amount_refunded: 2, status: "completed",
        } });
      }),
    });
    await expect(adapter.verifyRefund("44")).resolves.toEqual({
      providerRefundId: "44",
      providerTransactionId: "789",
      amountMinor: 200,
      status: "pending",
    });
  });

  it("recognizes only verified final Flutterwave refund payout statuses", async () => {
    const statuses = [
      ["completed-bank-transfer", "succeeded"],
      ["completed-momo", "succeeded"],
      ["failed", "failed"],
      ["pending-momo", "pending"],
      ["provider-new-status", "unknown"],
    ] as const;
    for (const [providerStatus, expectedStatus] of statuses) {
      const adapter = new FlutterwaveTestAdapter({
        secretKey: flutterwaveSecret, webhookSecret: flutterwaveWebhookSecret,
      }, {
        fetch: fetchMock(() => jsonResponse({ status: "success", data: {
          id: 44, transaction_id: 789, amount_refunded: 2, status: providerStatus,
        } })),
      });
      await expect(adapter.verifyRefund("44")).resolves.toMatchObject({ status: expectedStatus });
    }
  });

  it("does not retry ambiguous Flutterwave refund POST outcomes", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("connection closed after provider request");
    }) as unknown as typeof globalThis.fetch;
    const adapter = new FlutterwaveTestAdapter({
      secretKey: flutterwaveSecret, webhookSecret: flutterwaveWebhookSecret,
    }, { fetch });
    await expect(adapter.requestRefund({
      providerTransactionId: "789",
      amountMinor: 200,
      currency: "NGN",
      reason: "Verified fee adjustment",
    })).rejects.toThrow(/request failed or timed out/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("fails closed for Remita and validates only safe common amount primitives", async () => {
    const remita = new RemitaAdapter();
    expect(remita.validateAmount(1234, "NGN")).toBe(true);
    expect(remita.validateAmount(0, "NGN")).toBe(false);
    expect(remita.generateReference()).toMatch(/^fee_[a-f0-9]{32}$/);
    await expect(remita.initializePayment({
      ...expected, email: "parent@example.test", returnUrl: "https://school.example/return",
    })).rejects.toThrow(/Remita payments are disabled/);
    await expect(remita.getPaymentStatus(expected)).rejects.toThrow(/Remita payments are disabled/);
  });

  it("accepts case-insensitive Flutterwave webhook header names", async () => {
    const adapter = new FlutterwaveTestAdapter({
      secretKey: flutterwaveSecret, webhookSecret: flutterwaveWebhookSecret,
    }, {
      fetch: fetchMock(() => jsonResponse({ status: "success", data: {
        id: 789, status: "successful", tx_ref: expected.reference, amount: 12.34, currency: "NGN",
      } })),
    });
    const rawBody = JSON.stringify({ event: "charge.completed", data: { id: 789, tx_ref: expected.reference } });
    await expect(adapter.handleWebhook({
      rawBody,
      headers: { "Verif-Hash": flutterwaveWebhookSecret },
      resolveExpectedPayment: async () => expected,
    })).resolves.toMatchObject({ outcome: "verified", eventId: "flutterwave:789" });
  });

  it("exposes no automatic virtual-account capability and fails closed for Remita verification and webhooks", async () => {
    const remita = new RemitaAdapter();
    expect("createVirtualAccount" in remita).toBe(false);
    await expect(remita.verifyPayment(expected)).rejects.toThrow(/Remita payments are disabled/);
    await expect(remita.handleWebhook({
      rawBody: "{}", headers: {}, resolveExpectedPayment: async () => expected,
    })).rejects.toThrow(/Remita payments are disabled/);
  });
});