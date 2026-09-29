import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type FeePaymentStatus = "pending" | "succeeded" | "failed";

export interface ExpectedPayment {
  /** The exact reference generated and persisted by the application. */
  reference: string;
  /** Integer minor currency units (for example, kobo for NGN). */
  amountMinor: number;
  currency: string;
}

export interface InitializePaymentInput extends ExpectedPayment {
  email: string;
  returnUrl: string;
  customerName?: string;
}

export interface InitializePaymentResult {
  reference: string;
  checkoutUrl: string;
  accessCode?: string;
}

export interface VerifiedPayment extends ExpectedPayment {
  status: FeePaymentStatus;
  providerTransactionId: string;
  paidAt?: string;
}

export interface VerifyPaymentInput extends ExpectedPayment {
  /** Flutterwave verification requires the transaction ID returned by its event. */
  providerTransactionId?: string;
}

export interface WebhookInput {
  rawBody: Uint8Array | string;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  /** Resolve expected data from the application's persisted payment, never from the event. */
  resolveExpectedPayment: (reference: string) => Promise<ExpectedPayment | null>;
}

export interface WebhookResult {
  readonly outcome: "verified";
  /** Stable provider + transaction identity; claim this atomically with settlement in caller persistence. */
  readonly eventId: string;
  readonly payment: Readonly<VerifiedPayment>;
}

export interface PaymentProviderAdapter {
  readonly provider: "paystack" | "flutterwave" | "remita";
  initializePayment(input: InitializePaymentInput): Promise<InitializePaymentResult>;
  verifyPayment(input: VerifyPaymentInput): Promise<VerifiedPayment>;
  verifyCheckoutStatus(input: ExpectedPayment): Promise<VerifiedPayment>;
  handleWebhook(input: WebhookInput): Promise<WebhookResult>;
  getPaymentStatus(input: VerifyPaymentInput): Promise<FeePaymentStatus>;
  generateReference(): string;
  validateAmount(amountMinor: number, currency: string): boolean;
}

export class PaymentProviderError extends Error {
  signatureVerified = false;

  constructor(message: string) {
    super(message);
    this.name = "PaymentProviderError";
  }
}

export interface AdapterHttpOptions {
  /** Injection point for deterministic tests; production defaults to global fetch. */
  fetch?: typeof fetch;
  timeoutMs?: number;
}

type JsonObject = Record<string, unknown>;

const CURRENCY_DECIMALS: Readonly<Record<string, number>> = {
  NGN: 2, USD: 2, GBP: 2, EUR: 2, ZAR: 2, GHS: 2, KES: 2, UGX: 0, XAF: 0, XOF: 0,
};
const REFERENCE_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_GET_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 100;
const RETRY_MAX_DELAY_MS = 500;

function isTransientHttpStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function retryDelay(attempt: number): Promise<void> {
  const delayMs = Math.min(RETRY_BASE_DELAY_MS * 2 ** attempt, RETRY_MAX_DELAY_MS);
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function normalizeCurrency(value: string): string {
  return value.trim().toUpperCase();
}

function validExpected(expected: ExpectedPayment): boolean {
  return REFERENCE_PATTERN.test(expected.reference)
    && Number.isSafeInteger(expected.amountMinor)
    && expected.amountMinor > 0
    && Object.hasOwn(CURRENCY_DECIMALS, normalizeCurrency(expected.currency));
}

function headerValue(headers: WebhookInput["headers"], name: string): string | undefined {
  const normalizedName = name.toLowerCase();
  const value = Object.entries(headers)
    .find(([headerName]) => headerName.toLowerCase() === normalizedName)?.[1];
  return Array.isArray(value) ? value[0] : value;
}

function bodyBytes(rawBody: Uint8Array | string): Buffer {
  return typeof rawBody === "string" ? Buffer.from(rawBody, "utf8") : Buffer.from(rawBody);
}

function bodyString(rawBody: Uint8Array | string): string {
  return bodyBytes(rawBody).toString("utf8");
}

function parseBody(rawBody: Uint8Array | string): JsonObject {
  try {
    const value: unknown = JSON.parse(bodyString(rawBody));
    if (value && typeof value === "object" && !Array.isArray(value)) return value as JsonObject;
  } catch {
    // Replaced below with a generic error; do not include attacker-controlled body content.
  }
  throw new PaymentProviderError("Provider returned an invalid payment payload");
}

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function compareTextConstantTime(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function hmacSha512Hex(secret: string, payload: Uint8Array): string {
  return createHmac("sha512", secret).update(payload).digest("hex");
}

function normalizeProviderTransactionId(value: unknown, providerName: string): string {
  if ((typeof value !== "string" && typeof value !== "number")
      || (typeof value === "number" && !Number.isSafeInteger(value))) {
    throw new PaymentProviderError(`${providerName} transaction ID is invalid`);
  }
  const text = String(value);
  if (!/^[0-9]+$/.test(text)) throw new PaymentProviderError(`${providerName} transaction ID is invalid`);
  const id = BigInt(text);
  if (id <= 0n || id > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new PaymentProviderError(`${providerName} transaction ID is invalid`);
  }
  return id.toString();
}

function assertTestSecret(secret: string, provider: "paystack" | "flutterwave"): void {
  const valid = provider === "paystack"
    ? /^sk_test_[A-Za-z0-9_-]{8,}$/.test(secret)
    : /^FLWSECK_TEST-[A-Za-z0-9_-]{8,}$/.test(secret);
  if (!valid) throw new PaymentProviderError(`${provider} requires a valid test-mode secret key`);
}

abstract class HttpPaymentAdapter implements PaymentProviderAdapter {
  abstract readonly provider: "paystack" | "flutterwave" | "remita";
  protected abstract readonly baseUrl: string;
  protected readonly fetchImpl: typeof fetch;
  protected readonly timeoutMs: number;

  constructor(options: AdapterHttpOptions = {}) {
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!this.fetchImpl || !Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > 30_000) {
      throw new PaymentProviderError("Payment provider HTTP configuration is invalid");
    }
  }

  generateReference(): string {
    return `fee_${randomUUID().replaceAll("-", "")}`;
  }

  validateAmount(amountMinor: number, currency: string): boolean {
    return Number.isSafeInteger(amountMinor)
      && amountMinor > 0
      && Object.hasOwn(CURRENCY_DECIMALS, normalizeCurrency(currency));
  }

  protected assertExpected(expected: ExpectedPayment): void {
    if (!validExpected(expected)) throw new PaymentProviderError("Payment amount, currency, or reference is invalid");
  }

  protected async request(path: string, init: RequestInit, retrySafeRead = false): Promise<JsonObject> {
    const target = new URL(path, this.baseUrl);
    const configured = new URL(this.baseUrl);
    if (target.protocol !== "https:" || target.origin !== configured.origin || target.username || target.password) {
      throw new PaymentProviderError("Payment provider URL is not allowed");
    }
    // Test adapters enforce test-mode credentials and can use either the real
    // provider API or an injected test transport. Retry is explicitly opted into
    // only by verification/status reads; checkout initialization POSTs are never
    // retried because their outcome may be unknown.
    const retryableMethod = retrySafeRead && (init.method ?? "GET").toUpperCase() === "GET";
    let attempt = 0;
    while (true) {
      try {
        const response = await this.fetchImpl(target, {
          ...init,
          redirect: "error",
          signal: AbortSignal.timeout(this.timeoutMs),
        });
        if (!response.ok) {
          if (retryableMethod && isTransientHttpStatus(response.status) && attempt < MAX_GET_ATTEMPTS - 1) {
            await retryDelay(attempt);
            attempt += 1;
            continue;
          }
          throw new PaymentProviderError("Payment provider request failed");
        }
        return parseBody(await response.text());
      } catch (error) {
        if (error instanceof PaymentProviderError) throw error;
        if (retryableMethod && attempt < MAX_GET_ATTEMPTS - 1) {
          await retryDelay(attempt);
          attempt += 1;
          continue;
        }
        throw new PaymentProviderError("Payment provider request failed or timed out");
      }
    }
  }

  abstract initializePayment(input: InitializePaymentInput): Promise<InitializePaymentResult>;
  abstract verifyPayment(input: VerifyPaymentInput): Promise<VerifiedPayment>;
  abstract verifyCheckoutStatus(input: ExpectedPayment): Promise<VerifiedPayment>;
  abstract handleWebhook(input: WebhookInput): Promise<WebhookResult>;

  async getPaymentStatus(input: VerifyPaymentInput): Promise<FeePaymentStatus> {
    return (await this.verifyPayment(input)).status;
  }
}

export interface PaystackAdapterConfig {
  secretKey: string;
}

export class PaystackTestAdapter extends HttpPaymentAdapter {
  readonly provider = "paystack" as const;
  protected readonly baseUrl = "https://api.paystack.co/";
  private readonly secretKey: string;

  constructor(config: PaystackAdapterConfig, options: AdapterHttpOptions = {}) {
    super(options);
    if (!config || typeof config.secretKey !== "string") {
      throw new PaymentProviderError("Paystack test-mode configuration is required");
    }
    assertTestSecret(config.secretKey, "paystack");
    this.secretKey = config.secretKey;
  }

  async initializePayment(input: InitializePaymentInput): Promise<InitializePaymentResult> {
    this.assertExpected(input);
    if (!input.email.includes("@") || !isHttpsUrl(input.returnUrl)) {
      throw new PaymentProviderError("Payment customer email or return URL is invalid");
    }
    const body: JsonObject = {
      email: input.email,
      amount: input.amountMinor,
      currency: normalizeCurrency(input.currency),
      reference: input.reference,
      callback_url: input.returnUrl,
      metadata: { payment_reference: input.reference },
    };
    const result = await this.request("transaction/initialize", {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify(body),
    });
    const data = asObject(result.data);
    const checkoutUrl = data && stringField(data.authorization_url);
    const accessCode = data && stringField(data.access_code);
    const reference = data && stringField(data.reference);
    if (result.status !== true || !checkoutUrl || !reference || reference !== input.reference
        || !isProviderCheckoutUrl(checkoutUrl, "checkout.paystack.com")) {
      throw new PaymentProviderError("Paystack did not return a valid checkout session");
    }
    return { reference, checkoutUrl, ...(accessCode ? { accessCode } : {}) };
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifiedPayment> {
    this.assertExpected(input);
    const result = await this.request(`transaction/verify/${encodeURIComponent(input.reference)}`, {
      method: "GET",
      headers: this.authHeaders(),
    }, true);
    const data = asObject(result.data);
    if (result.status !== true || !data) throw new PaymentProviderError("Paystack could not verify the payment");
    return verifyFields({
      expected: input,
      providerStatus: stringField(data.status),
      providerReference: stringField(data.reference),
      providerCurrency: stringField(data.currency),
      providerAmountMinor: data.amount,
      providerTransactionId: data.id,
      paidAt: data.paid_at,
      successfulStatus: "success",
      providerName: "Paystack",
    });
  }

  async verifyCheckoutStatus(input: ExpectedPayment): Promise<VerifiedPayment> {
    return this.verifyPayment(input);
  }

  async handleWebhook(input: WebhookInput): Promise<WebhookResult> {
    const raw = bodyBytes(input.rawBody);
    const signature = headerValue(input.headers, "x-paystack-signature");
    if (!signature || !/^[a-fA-F0-9]{128}$/.test(signature)
        || !compareTextConstantTime(hmacSha512Hex(this.secretKey, raw), signature.toLowerCase())) {
      throw new PaymentProviderError("Paystack webhook signature is invalid");
    }
    try {
      const event = parseBody(input.rawBody);
      if (event.event !== "charge.success") throw new PaymentProviderError("Paystack webhook event is not a successful charge");
      const data = asObject(event.data);
      const reference = data && stringField(data.reference);
      if (!reference || !REFERENCE_PATTERN.test(reference) || !data) {
        throw new PaymentProviderError("Paystack webhook reference is invalid");
      }
      const webhookTransactionId = normalizeProviderTransactionId(data.id, "Paystack");
      const expected = await input.resolveExpectedPayment(reference);
      if (!expected) throw new PaymentProviderError("Payment reference is not recognized");
      const payment = await this.verifyPayment(expected);
      if (payment.providerTransactionId !== webhookTransactionId) {
        throw new PaymentProviderError("Paystack webhook transaction ID mismatch");
      }
      const eventId = `paystack:${payment.providerTransactionId}`;
      return Object.freeze({ outcome: "verified", eventId, payment: Object.freeze(payment) });
    } catch (error) {
      if (error instanceof PaymentProviderError) error.signatureVerified = true;
      throw error;
    }
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.secretKey}`, "Content-Type": "application/json" };
  }
}

export interface FlutterwaveAdapterConfig {
  secretKey: string;
  webhookSecret: string;
}

export class FlutterwaveTestAdapter extends HttpPaymentAdapter {
  readonly provider = "flutterwave" as const;
  protected readonly baseUrl = "https://api.flutterwave.com/v3/";
  private readonly secretKey: string;
  private readonly webhookSecret: string;

  constructor(config: FlutterwaveAdapterConfig, options: AdapterHttpOptions = {}) {
    super(options);
    if (!config || typeof config.secretKey !== "string") {
      throw new PaymentProviderError("Flutterwave test-mode configuration is required");
    }
    assertTestSecret(config.secretKey, "flutterwave");
    if (typeof config.webhookSecret !== "string" || config.webhookSecret.length < 16) {
      throw new PaymentProviderError("Flutterwave webhook verification hash is required");
    }
    this.secretKey = config.secretKey;
    this.webhookSecret = config.webhookSecret;
  }

  async initializePayment(input: InitializePaymentInput): Promise<InitializePaymentResult> {
    this.assertExpected(input);
    if (!input.email.includes("@") || !isHttpsUrl(input.returnUrl)) {
      throw new PaymentProviderError("Payment customer email or return URL is invalid");
    }
    const amount = minorToMajor(input.amountMinor, input.currency);
    const result = await this.request("payments", {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify({
        tx_ref: input.reference,
        amount,
        currency: normalizeCurrency(input.currency),
        redirect_url: input.returnUrl,
        customer: { email: input.email, ...(input.customerName ? { name: input.customerName } : {}) },
      }),
    });
    const data = asObject(result.data);
    const link = data && stringField(data.link);
    if (result.status !== "success" || !link || !isProviderCheckoutUrl(link, "checkout.flutterwave.com")) {
      throw new PaymentProviderError("Flutterwave did not return a valid checkout session");
    }
    return { reference: input.reference, checkoutUrl: link };
  }

  async verifyPayment(input: VerifyPaymentInput): Promise<VerifiedPayment> {
    this.assertExpected(input);
    if (!input.providerTransactionId) {
      throw new PaymentProviderError("Flutterwave transaction ID is required for verification");
    }
    const requestTransactionId = normalizeProviderTransactionId(input.providerTransactionId, "Flutterwave");
    const result = await this.request(`transactions/${encodeURIComponent(requestTransactionId)}/verify`, {
      method: "GET",
      headers: this.authHeaders(),
    }, true);
    const data = asObject(result.data);
    if (result.status !== "success" || !data) throw new PaymentProviderError("Flutterwave could not verify the payment");
    return verifyFields({
      expected: input,
      providerStatus: stringField(data.status),
      providerReference: stringField(data.tx_ref),
      providerCurrency: stringField(data.currency),
      providerAmountMinor: majorToMinor(data.amount, input.currency),
      providerTransactionId: data.id,
      paidAt: data.created_at,
      successfulStatus: "successful",
      providerName: "Flutterwave",
    });
  }

  async verifyCheckoutStatus(input: ExpectedPayment): Promise<VerifiedPayment> {
    this.assertExpected(input);
    const result = await this.request(`transactions?tx_ref=${encodeURIComponent(input.reference)}`, {
      method: "GET",
      headers: this.authHeaders(),
    }, true);
    if (result.status !== "success" || !Array.isArray(result.data)) {
      throw new PaymentProviderError("Flutterwave could not establish checkout status by reference");
    }
    const matches = result.data.filter((entry) => asObject(entry)?.tx_ref === input.reference);
    if (matches.length !== 1) {
      throw new PaymentProviderError("Flutterwave checkout status is unknown or ambiguous");
    }
    const transaction = asObject(matches[0]);
    if (!transaction) throw new PaymentProviderError("Flutterwave checkout status is invalid");
    const transactionId = normalizeProviderTransactionId(transaction.id, "Flutterwave");
    return this.verifyPayment({ ...input, providerTransactionId: transactionId });
  }

  async handleWebhook(input: WebhookInput): Promise<WebhookResult> {
    const signature = headerValue(input.headers, "verif-hash");
    if (!signature || !compareTextConstantTime(signature, this.webhookSecret)) {
      throw new PaymentProviderError("Flutterwave webhook verification hash is invalid");
    }
    try {
      const event = parseBody(input.rawBody);
      if (event.event !== "charge.completed") {
        throw new PaymentProviderError("Flutterwave webhook event is not a completed charge");
      }
      const data = asObject(event.data);
      const txRef = data && stringField(data.tx_ref);
      const id = data && data.id;
      if (!txRef || !REFERENCE_PATTERN.test(txRef) || !data) {
        throw new PaymentProviderError("Flutterwave webhook transaction details are invalid");
      }
      const webhookTransactionId = normalizeProviderTransactionId(id, "Flutterwave");
      const expected = await input.resolveExpectedPayment(txRef);
      if (!expected) throw new PaymentProviderError("Payment reference is not recognized");
      const payment = await this.verifyPayment({ ...expected, providerTransactionId: webhookTransactionId });
      if (payment.providerTransactionId !== webhookTransactionId) {
        throw new PaymentProviderError("Flutterwave webhook transaction ID mismatch");
      }
      const eventId = `flutterwave:${payment.providerTransactionId}`;
      return Object.freeze({ outcome: "verified", eventId, payment: Object.freeze(payment) });
    } catch (error) {
      if (error instanceof PaymentProviderError) error.signatureVerified = true;
      throw error;
    }
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.secretKey}`, "Content-Type": "application/json" };
  }
}

/**
 * Remita's official integration contract and sandbox have not been verified.
 * This adapter intentionally cannot create or confirm a payment.
 */
export class RemitaAdapter implements PaymentProviderAdapter {
  readonly provider = "remita" as const;
  generateReference(): string {
    return `fee_${randomUUID().replaceAll("-", "")}`;
  }
  validateAmount(amountMinor: number, currency: string): boolean {
    return Number.isSafeInteger(amountMinor) && amountMinor > 0
      && Object.hasOwn(CURRENCY_DECIMALS, normalizeCurrency(currency));
  }
  async initializePayment(_input: InitializePaymentInput): Promise<InitializePaymentResult> {
    return this.unavailable();
  }
  async verifyPayment(_input: VerifyPaymentInput): Promise<VerifiedPayment> {
    return this.unavailable();
  }
  async verifyCheckoutStatus(_input: ExpectedPayment): Promise<VerifiedPayment> {
    return this.unavailable();
  }
  async handleWebhook(_input: WebhookInput): Promise<WebhookResult> {
    return this.unavailable();
  }
  async getPaymentStatus(_input: VerifyPaymentInput): Promise<FeePaymentStatus> {
    return this.unavailable();
  }
  private unavailable(): never {
    throw new PaymentProviderError("Remita payments are disabled until its official integration contract and sandbox are verified");
  }
}

function verifyFields(input: {
  expected: ExpectedPayment;
  providerStatus?: string;
  providerReference?: string;
  providerCurrency?: string;
  providerAmountMinor: unknown;
  providerTransactionId: unknown;
  paidAt: unknown;
  successfulStatus: string;
  providerName: string;
}): VerifiedPayment {
  const { expected } = input;
  if (input.providerReference !== expected.reference) throw new PaymentProviderError(`${input.providerName} payment reference mismatch`);
  if (!input.providerCurrency || normalizeCurrency(input.providerCurrency) !== normalizeCurrency(expected.currency)) {
    throw new PaymentProviderError(`${input.providerName} payment currency mismatch`);
  }
  if (!Number.isSafeInteger(input.providerAmountMinor) || input.providerAmountMinor !== expected.amountMinor) {
    throw new PaymentProviderError(`${input.providerName} payment amount mismatch`);
  }
  const transactionId = normalizeProviderTransactionId(input.providerTransactionId, input.providerName);
  const providerStatus = input.providerStatus?.trim().toLowerCase();
  const successfulStatus = input.successfulStatus.toLowerCase();
  const status: FeePaymentStatus = providerStatus === successfulStatus
    ? "succeeded"
    : providerStatus === "failed" || providerStatus === "cancelled" || providerStatus === "abandoned"
      ? "failed"
      : "pending";
  return {
    reference: expected.reference,
    amountMinor: expected.amountMinor,
    currency: normalizeCurrency(expected.currency),
    status,
    providerTransactionId: transactionId,
    ...(typeof input.paidAt === "string" ? { paidAt: input.paidAt } : {}),
  };
}

function minorToMajor(amountMinor: number, currency: string): number {
  const decimals = CURRENCY_DECIMALS[normalizeCurrency(currency)];
  return Number((amountMinor / 10 ** decimals).toFixed(decimals));
}

function majorToMinor(amount: unknown, currency: string): number {
  const decimal = typeof amount === "number" && Number.isFinite(amount)
    ? amount.toString()
    : typeof amount === "string" ? amount.trim() : "";
  const decimals = CURRENCY_DECIMALS[normalizeCurrency(currency)];
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(decimal);
  if (!match || match[1] === "-") return Number.NaN;
  const integerDigits = match[2];
  const fractionalDigits = match[3] ?? "";
  const exponent = Number(match[4] ?? "0");
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) return Number.NaN;
  const digits = BigInt(`${integerDigits}${fractionalDigits}`);
  const shift = exponent - fractionalDigits.length + decimals;
  let minor: bigint;
  if (shift >= 0) {
    if (shift > 100) return Number.NaN;
    minor = digits * 10n ** BigInt(shift);
  } else {
    const divisor = 10n ** BigInt(-shift);
    if (digits % divisor !== 0n) return Number.NaN;
    minor = digits / divisor;
  }
  if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER)) return Number.NaN;
  return Number(minor);
}

function isHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function isProviderCheckoutUrl(value: string, allowedHost: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname === allowedHost
      && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}