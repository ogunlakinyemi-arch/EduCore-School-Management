import { AuthError } from "../middlewares/auth";
import { developmentFlutterwaveCredential } from "./flutterwave-development-config";

export type PayrollProviderMode = "TEST" | "LIVE" | "MOCK" | "NOT_CONFIGURED";
export type PayrollTransferCapability =
  | "SUPPORTED"
  | "MOCK_ONLY"
  | "NOT_CONFIGURED"
  | "BLOCKED_IN_DEVELOPMENT";

export interface PayrollProviderCapability {
  provider: "FLUTTERWAVE";
  mode: PayrollProviderMode;
  credentialsConfigured: boolean;
  transferCapability: PayrollTransferCapability;
  /**
   * This backend deliberately does not create subaccounts: its supported
   * collection products have different school allocations, so a fixed
   * provider subaccount split could settle the wrong contractual amounts.
   */
  bankSubaccountsSupported: false;
  liveSettlementVerified: false;
}

export class FlutterwavePayrollUnavailableError extends Error {
  constructor(message = "Flutterwave payroll transfer capability is unavailable") {
    super(message);
    this.name = "FlutterwavePayrollUnavailableError";
  }
}

export class FlutterwavePayrollAmbiguousError extends Error {
  constructor(message = "Flutterwave payroll transfer outcome is uncertain and needs reconciliation") {
    super(message);
    this.name = "FlutterwavePayrollAmbiguousError";
  }
}

/**
 * Sanitized provider-diagnostic categories. These are the only values that
 * may leave this module: never the raw provider body, message, key or bank data.
 */
export type ProviderDiagnosticCategory =
  | "PROVIDER_AUTH_REJECTED"
  | "INVALID_BANK_OR_ACCOUNT"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_OUTAGE"
  | "UNEXPECTED_PROVIDER_RESPONSE"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_NETWORK_FAILURE"
  | "NON_JSON_PROVIDER_RESPONSE";

/** Fixed, allowlisted reason codes derived from (never copied from) provider text. */
export type ProviderDiagnosticReason =
  | "CREDENTIAL_REJECTED"
  | "ACCOUNT_NOT_RESOLVED"
  | "BANK_NOT_SUPPORTED"
  | "TEST_MODE_ACCOUNT_RESTRICTION"
  | "MISSING_STATUS_FIELD"
  | "RESOLVED_DETAILS_DID_NOT_MATCH"
  | "UNCLASSIFIED";

export interface ProviderDiagnostic {
  providerHttpStatus: number | null;
  category: ProviderDiagnosticCategory;
  reason: ProviderDiagnosticReason;
}

const DIAGNOSTIC_REASON_TEXT: Record<ProviderDiagnosticReason, string> = {
  CREDENTIAL_REJECTED: "the provider rejected the configured credential",
  ACCOUNT_NOT_RESOLVED: "the provider could not resolve this account number at this bank",
  BANK_NOT_SUPPORTED: "the provider did not accept this bank code",
  TEST_MODE_ACCOUNT_RESTRICTION: "the provider's TEST mode does not resolve this account",
  MISSING_STATUS_FIELD: "the provider response did not include a recognised status",
  RESOLVED_DETAILS_DID_NOT_MATCH: "the provider did not return matching account details",
  UNCLASSIFIED: "no further reason could be safely classified",
};

/** Plain-language, secret-free description of a diagnostic, safe for logs and the Owner UI. */
export function describeProviderDiagnostic(diagnostic: ProviderDiagnostic): string {
  const status = diagnostic.providerHttpStatus === null
    ? "no provider HTTP status"
    : `provider HTTP ${diagnostic.providerHttpStatus}`;
  return `${status}; ${DIAGNOSTIC_REASON_TEXT[diagnostic.reason]}`;
}

function classifyProviderReason(message: unknown, httpStatus: number): ProviderDiagnosticReason {
  if (httpStatus === 401 || httpStatus === 403) return "CREDENTIAL_REJECTED";
  // Pattern-match only; the provider text itself is discarded.
  const text = typeof message === "string" ? message.slice(0, 300).toLowerCase() : "";
  if (!text) return "UNCLASSIFIED";
  if (/\b(secret|api) ?key\b|unauthori[sz]ed|invalid authorization/.test(text)) return "CREDENTIAL_REJECTED";
  if (/test ?mode|sandbox|test account/.test(text)) return "TEST_MODE_ACCOUNT_RESTRICTION";
  if (/bank/.test(text) && /invalid|not (found|supported|available)|unsupported|unknown/.test(text)) {
    return "BANK_NOT_SUPPORTED";
  }
  if (/account/.test(text) && /could not|cannot|unable|invalid|not (found|valid|resolved)|failed/.test(text)) {
    return "ACCOUNT_NOT_RESOLVED";
  }
  return "UNCLASSIFIED";
}

function categoryForHttpStatus(httpStatus: number): ProviderDiagnosticCategory {
  if (httpStatus === 401 || httpStatus === 403) return "PROVIDER_AUTH_REJECTED";
  if (httpStatus === 429) return "PROVIDER_RATE_LIMITED";
  if (httpStatus >= 500) return "PROVIDER_OUTAGE";
  if (httpStatus >= 400) return "INVALID_BANK_OR_ACCOUNT";
  return "UNEXPECTED_PROVIDER_RESPONSE";
}

/** A readable provider rejection/unexpected schema, with only sanitized diagnostics. */
export class FlutterwaveProviderResponseError extends FlutterwavePayrollUnavailableError {
  /** Set only by read-only bank-account resolution; payroll transfer errors keep their existing handling. */
  operation: "ACCOUNT_RESOLUTION" | null = null;
  constructor(message: string, readonly diagnostic: ProviderDiagnostic) {
    super(message);
    this.name = "FlutterwaveProviderResponseError";
  }
}

/** Transport/parse uncertainty, with only sanitized diagnostics. */
export class FlutterwaveProviderUncertainError extends FlutterwavePayrollAmbiguousError {
  operation: "ACCOUNT_RESOLUTION" | null = null;
  constructor(readonly diagnostic: ProviderDiagnostic) {
    super();
    this.name = "FlutterwaveProviderUncertainError";
  }
}

export interface BankResolution {
  resolvedAccountNumber: string;
  resolvedAccountName: string;
}

export interface FlutterwaveVerifiedTransfer {
  transferId: string;
  reference: string;
  amountNaira: number;
  providerFeeNaira: number;
  status: "SUCCESSFUL" | "FAILED" | "PENDING";
  currency: "NGN";
  accountLast4: string;
  bankCode: string;
  occurredAt: string | null;
}

function explicitMode(env: NodeJS.ProcessEnv): string {
  return (env.PAYROLL_TRANSFER_MODE ?? "").trim().toLowerCase();
}

export function configuredPayrollProviderCapability(
  env: NodeJS.ProcessEnv = process.env,
): PayrollProviderCapability {
  const nodeEnvironment = env.NODE_ENV;
  const configuredMode = explicitMode(env);
  const testKey = env.FLUTTERWAVE_TEST_SECRET_KEY?.trim();
  const explicitlyTestCredential =
    !!testKey && /^FLWSECK_TEST-[A-Za-z0-9_-]{8,}$/.test(testKey);
  const safeTestKey = explicitlyTestCredential ? testKey : null;
  const developmentCredential = developmentFlutterwaveCredential(env);
  const resolvedTestKey = env.NODE_ENV === "development" && developmentCredential.state !== "MISSING"
    ? developmentCredential.secret : safeTestKey;

  if (configuredMode === "mock" && nodeEnvironment !== "production") {
    return {
      provider: "FLUTTERWAVE",
      mode: "MOCK",
      credentialsConfigured: false,
      transferCapability: "MOCK_ONLY",
      bankSubaccountsSupported: false,
      liveSettlementVerified: false,
    };
  }
  if (
    configuredMode === "test" &&
    nodeEnvironment !== "production" &&
    resolvedTestKey !== null
  ) {
    return {
      provider: "FLUTTERWAVE",
      mode: "TEST",
      credentialsConfigured: true,
      transferCapability: "SUPPORTED",
      bankSubaccountsSupported: false,
      liveSettlementVerified: false,
    };
  }
  if (configuredMode === "live" && nodeEnvironment !== "production") {
    return {
      provider: "FLUTTERWAVE",
      mode: "NOT_CONFIGURED",
      credentialsConfigured: false,
      transferCapability: "BLOCKED_IN_DEVELOPMENT",
      bankSubaccountsSupported: false,
      liveSettlementVerified: false,
    };
  }

  // Live payouts are fail-closed even in production unless live transfers,
  // merchant KYC approval, IP allowlisting and NGN funding were each separately
  // attested by the operator and an explicit live transfer key was supplied.
  const liveKey = env.FLUTTERWAVE_LIVE_SECRET_KEY?.trim();
  const liveCapabilityAttestations = [
    env.FLUTTERWAVE_TRANSFER_CAPABILITY_CONFIRMED === "true",
    env.FLUTTERWAVE_KYC_APPROVED === "true",
    env.FLUTTERWAVE_SERVER_IP_WHITELIST_CONFIRMED === "true",
    env.FLUTTERWAVE_NGN_WALLET_FUNDED_CONFIRMED === "true",
  ].every(Boolean);
  if (
    configuredMode === "live" &&
    nodeEnvironment === "production" &&
    !!liveKey &&
    /^FLWSECK_LIVE-[A-Za-z0-9_-]{8,}$/.test(liveKey) &&
    liveCapabilityAttestations
  ) {
    return {
      provider: "FLUTTERWAVE",
      mode: "LIVE",
      credentialsConfigured: true,
      transferCapability: "SUPPORTED",
      bankSubaccountsSupported: false,
      liveSettlementVerified: false,
    };
  }

  return {
    provider: "FLUTTERWAVE",
    mode: "NOT_CONFIGURED",
    credentialsConfigured: false,
    transferCapability: "NOT_CONFIGURED",
    bankSubaccountsSupported: false,
    liveSettlementVerified: false,
  };
}

function providerKey(
  env: NodeJS.ProcessEnv,
  mode: "TEST" | "LIVE",
): string {
  const capability = configuredPayrollProviderCapability(env);
  if (capability.mode !== mode || capability.transferCapability !== "SUPPORTED") {
    throw new FlutterwavePayrollUnavailableError(
      "An explicitly configured, provider-approved Flutterwave payroll transfer mode is required",
    );
  }
  return mode === "TEST" ? (
    (env.NODE_ENV === "development" && developmentFlutterwaveCredential(env).state !== "MISSING"
      ? developmentFlutterwaveCredential(env).secret
      : null) ??
    env.FLUTTERWAVE_TEST_SECRET_KEY?.trim() ??
    ""
  ) : (
    env.FLUTTERWAVE_LIVE_SECRET_KEY?.trim() ?? ""
  );
}

type JsonObject = Record<string, unknown>;

async function v3Request(
  pathAndQuery: string,
  key: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<JsonObject> {
  let response: Response;
  try {
    response = await fetchImpl(`https://api.flutterwave.com/v3${pathAndQuery}`, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(12_000),
      headers: {
        accept: "application/json",
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        ...init.headers,
      },
    });
  } catch (error) {
    // Never include the secret, bank details, provider request, or raw SDK
    // exception in client errors, logs, or the durable audit event.
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    throw new FlutterwaveProviderUncertainError({
      providerHttpStatus: null,
      category: timedOut ? "PROVIDER_TIMEOUT" : "PROVIDER_NETWORK_FAILURE",
      reason: "UNCLASSIFIED",
    });
  }
  const httpStatus = response.status;
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new FlutterwaveProviderUncertainError({
      providerHttpStatus: httpStatus,
      category: "NON_JSON_PROVIDER_RESPONSE",
      reason: "UNCLASSIFIED",
    });
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new FlutterwaveProviderUncertainError({
      providerHttpStatus: httpStatus,
      category: "NON_JSON_PROVIDER_RESPONSE",
      reason: "UNCLASSIFIED",
    });
  }
  const body = result as JsonObject;
  if (!response.ok || typeof body.status !== "string") {
    throw new FlutterwaveProviderResponseError(
      "Flutterwave could not verify or accept this payroll operation; check the stored provider status before proceeding",
      {
        providerHttpStatus: httpStatus,
        category: response.ok ? "UNEXPECTED_PROVIDER_RESPONSE" : categoryForHttpStatus(httpStatus),
        reason: response.ok ? "MISSING_STATUS_FIELD" : classifyProviderReason(body.message, httpStatus),
      },
    );
  }
  return body;
}

function record(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

/**
 * Documented Flutterwave v3 endpoints:
 * POST /accounts/resolve, POST /transfers, GET /transfers?reference=...
 * No other provider API versions or inferred recipient/subaccount API are used.
 */
export class FlutterwavePayrollV3Client {
  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  capability(): PayrollProviderCapability {
    return configuredPayrollProviderCapability(this.env);
  }

  async resolveNigerianAccount(input: {
    bankCode: string;
    accountNumber: string;
  }): Promise<BankResolution> {
    const capability = this.capability();
    const developmentKey = developmentFlutterwaveCredential(this.env).secret;
    if (!developmentKey && !["TEST", "LIVE"].includes(capability.mode)) {
      throw new FlutterwavePayrollUnavailableError(
        "Bank verification requires explicitly configured Flutterwave test credentials or an approved live service",
      );
    }
    // Read-only account resolution must not enable payroll transfers or create subaccounts.
    const key = developmentKey ?? providerKey(this.env, capability.mode as "TEST" | "LIVE");
    let body: JsonObject;
    try {
      body = await v3Request("/accounts/resolve", key, {
        method: "POST",
        body: JSON.stringify({
          account_number: input.accountNumber,
          account_bank: input.bankCode,
        }),
      }, this.fetchImpl);
    } catch (error) {
      if (error instanceof FlutterwaveProviderResponseError || error instanceof FlutterwaveProviderUncertainError) {
        error.operation = "ACCOUNT_RESOLUTION";
      }
      throw error;
    }
    const resolved = record(body.data);
    if (
      body.status !== "success" ||
      typeof resolved?.account_number !== "string" ||
      typeof resolved.account_name !== "string" ||
      resolved.account_number !== input.accountNumber ||
      resolved.account_name.trim().length < 2
    ) {
      const mismatch = new FlutterwaveProviderResponseError(
        "Flutterwave did not return matching verified bank-account details",
        {
          providerHttpStatus: 200,
          category: "UNEXPECTED_PROVIDER_RESPONSE",
          reason: body.status === "success" ? "RESOLVED_DETAILS_DID_NOT_MATCH" : classifyProviderReason(body.message, 200),
        },
      );
      mismatch.operation = "ACCOUNT_RESOLUTION";
      throw mismatch;
    }
    return {
      resolvedAccountNumber: resolved.account_number,
      resolvedAccountName: resolved.account_name.trim(),
    };
  }

  async createNgnTransfer(input: {
    reference: string;
    bankCode: string;
    accountNumber: string;
    amountNaira: number;
    periodMonth: string;
  }): Promise<{ providerTransferId: string | null; reference: string }> {
    const capability = this.capability();
    if (capability.mode !== "TEST" && capability.mode !== "LIVE") {
      throw new FlutterwavePayrollUnavailableError();
    }
    const key = providerKey(this.env, capability.mode);
    // Flutterwave v3 explicitly accepts integer NGN payout amounts. Refuse
    // amounts with unrepresentable fractions before any transfer is submitted.
    if (!Number.isSafeInteger(input.amountNaira) || input.amountNaira < 1) {
      throw new AuthError(
        400,
        "Flutterwave requires an integer NGN transfer amount; adjust the salary amount to a whole naira",
      );
    }
    let body: JsonObject;
    try {
      body = await v3Request("/transfers", key, {
        method: "POST",
        body: JSON.stringify({
          account_bank: input.bankCode,
          account_number: input.accountNumber,
          amount: input.amountNaira,
          currency: "NGN",
          reference: input.reference,
          narration: `Yemait payroll ${input.periodMonth}`,
        }),
      }, this.fetchImpl);
    } catch (error) {
      if (error instanceof FlutterwavePayrollAmbiguousError) throw error;
      throw new FlutterwavePayrollAmbiguousError(
        "Flutterwave did not confirm whether this payout request was queued",
      );
    }

    const transfer = record(body.data);
    const bodyStatus = typeof body.status === "string" ? body.status.toLowerCase() : "";
    // Even a 'queued' create response is not accepted as evidence that salary
    // money left the platform; every external state is checked separately.
    if (bodyStatus !== "success" || !transfer) {
      throw new FlutterwavePayrollAmbiguousError();
    }
    const providerTransferId =
      typeof transfer.id === "number" && Number.isSafeInteger(transfer.id) && transfer.id > 0
        ? String(transfer.id)
        : null;
    if (transfer.reference !== input.reference) {
      throw new FlutterwavePayrollAmbiguousError(
        "Flutterwave returned an unmatched transfer reference; reconciliation is required",
      );
    }
    return { providerTransferId, reference: input.reference };
  }

  /**
   * A paged, exact-reference query is required for reconciliation because a
   * lost create response can leave only the merchant's idempotent reference.
   * Returned employee account details are compared in memory and never stored.
   */
  async verifyNgnTransferByReference(input: {
    reference: string;
    expectedBankCode: string;
    expectedAccountNumber: string;
    expectedAmountNaira: number;
  }): Promise<FlutterwaveVerifiedTransfer | null> {
    const capability = this.capability();
    if (capability.mode !== "TEST" && capability.mode !== "LIVE") {
      throw new FlutterwavePayrollUnavailableError();
    }
    const key = providerKey(this.env, capability.mode);
    const query = new URLSearchParams({
      reference: input.reference,
      page: "1",
      page_size: "10",
      include_provider_ref: "true",
    });
    const body = await v3Request(`/transfers?${query.toString()}`, key, {
      method: "GET",
    }, this.fetchImpl);
    if (body.status !== "success" || !Array.isArray(body.data)) {
      throw new FlutterwavePayrollUnavailableError(
        "Flutterwave could not verify the existing payroll transfer; no retry was sent",
      );
    }
    const matches = body.data.map(record).filter(
      (item): item is JsonObject => item !== null && item.reference === input.reference,
    );
    if (matches.length === 0) return null;
    if (matches.length !== 1) {
      throw new FlutterwavePayrollPayrollIntegrityError(
        "Flutterwave returned multiple rows for a unique payroll transfer reference",
      );
    }
    const item = matches[0];
    const amount = Number(item.amount);
    const id = item.id;
    const currency = item.currency;
    const account = item.account_number;
    const bankCode = item.bank_code ?? item.account_bank;
    if (
      typeof id !== "number" ||
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      !Number.isSafeInteger(amount) ||
      amount !== input.expectedAmountNaira ||
      currency !== "NGN" ||
      account !== input.expectedAccountNumber ||
      bankCode !== input.expectedBankCode
    ) {
      throw new FlutterwavePayrollPayrollIntegrityError(
        "Flutterwave transfer evidence did not match the approved payroll amount and beneficiary",
      );
    }
    const providerStatus = typeof item.status === "string" ? item.status.toUpperCase() : "";
    const status: FlutterwaveVerifiedTransfer["status"] =
      providerStatus === "SUCCESSFUL"
        ? "SUCCESSFUL"
        : providerStatus === "FAILED" || providerStatus === "REVERSED"
          ? "FAILED"
          : "PENDING";
    const rawFee = Number(item.fee ?? 0);
    if (!Number.isFinite(rawFee) || rawFee < 0) {
      throw new FlutterwavePayrollPayrollIntegrityError(
        "Flutterwave returned an invalid provider transfer fee",
      );
    }
    return verifiedTransferProjection(item, {
      expectedReference: input.reference,
      expectedBankCode: input.expectedBankCode,
      expectedAccountNumber: input.expectedAccountNumber,
      expectedAmountNaira: input.expectedAmountNaira,
    });
  }

  async verifyNgnTransferById(input: {
    transferId: string;
    expectedReference: string;
    expectedBankCode: string;
    expectedAccountNumber: string;
    expectedAmountNaira: number;
  }): Promise<FlutterwaveVerifiedTransfer> {
    if (!/^[1-9][0-9]{0,15}$/.test(input.transferId)) {
      throw new FlutterwavePayrollPayrollIntegrityError(
        "Stored Flutterwave transfer identifier is invalid",
      );
    }
    const capability = this.capability();
    if (capability.mode !== "TEST" && capability.mode !== "LIVE") {
      throw new FlutterwavePayrollUnavailableError();
    }
    const key = providerKey(this.env, capability.mode);
    const body = await v3Request(`/transfers/${encodeURIComponent(input.transferId)}`, key, {
      method: "GET",
    }, this.fetchImpl);
    const item = record(body.data);
    if (body.status !== "success" || !item) {
      throw new FlutterwavePayrollUnavailableError(
        "Flutterwave could not retrieve the prior transfer; no retry was sent",
      );
    }
    const transfer = verifiedTransferProjection(item, {
      expectedReference: input.expectedReference,
      expectedBankCode: input.expectedBankCode,
      expectedAccountNumber: input.expectedAccountNumber,
      expectedAmountNaira: input.expectedAmountNaira,
    });
    if (transfer.transferId !== input.transferId) {
      throw new FlutterwavePayrollPayrollIntegrityError(
        "Flutterwave transfer verification returned an unmatched transfer ID",
      );
    }
    return transfer;
  }
}

function verifiedTransferProjection(
  item: JsonObject,
  input: {
    expectedReference: string;
    expectedBankCode: string;
    expectedAccountNumber: string;
    expectedAmountNaira: number;
  },
): FlutterwaveVerifiedTransfer {
  const amount = Number(item.amount);
  const id = item.id;
  if (
    typeof id !== "number" ||
    !Number.isSafeInteger(id) ||
    id <= 0 ||
    !Number.isSafeInteger(amount) ||
    amount !== input.expectedAmountNaira ||
    item.reference !== input.expectedReference ||
    item.currency !== "NGN" ||
    item.account_number !== input.expectedAccountNumber ||
    (item.bank_code ?? item.account_bank) !== input.expectedBankCode
  ) {
    throw new FlutterwavePayrollPayrollIntegrityError(
      "Flutterwave transfer evidence did not match the frozen employee, amount and bank destination",
    );
  }
  const providerStatus = typeof item.status === "string" ? item.status.toUpperCase() : "";
  const status: FlutterwaveVerifiedTransfer["status"] =
    providerStatus === "SUCCESSFUL"
      ? "SUCCESSFUL"
      : providerStatus === "FAILED" || providerStatus === "REVERSED"
        ? "FAILED"
        : "PENDING";
  const rawFee = Number(item.fee ?? 0);
  if (!Number.isFinite(rawFee) || rawFee < 0) {
    throw new FlutterwavePayrollPayrollIntegrityError(
      "Flutterwave returned an invalid provider transfer fee",
    );
  }
  return {
    transferId: String(id),
    reference: input.expectedReference,
    amountNaira: amount,
    providerFeeNaira: rawFee,
    status,
    currency: "NGN",
    accountLast4: input.expectedAccountNumber.slice(-4),
    bankCode: input.expectedBankCode,
    occurredAt: typeof item.created_at === "string" ? item.created_at : null,
  };
}

export class FlutterwavePayrollPayrollIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlutterwavePayrollIntegrityError";
  }
}