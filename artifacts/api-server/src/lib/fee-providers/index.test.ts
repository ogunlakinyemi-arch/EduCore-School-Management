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