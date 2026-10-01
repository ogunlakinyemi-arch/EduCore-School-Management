import { AuthError } from "../middlewares/auth";

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
  const existingSecret = env.FLUTTERWAVE_SECRET_KEY?.trim();
  const sameExistingTestCredential =
    !!existingSecret &&
    /^FLWSECK_TEST-[A-Za-z0-9_-]{8,}$/.test(existingSecret) &&
    (!testKey || existingSecret === testKey);
  const safeTestKey = explicitlyTestCredential ? testKey : sameExistingTestCredential ? existingSecret : null;

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
    safeTestKey !== null
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
    env.FLUTTERWAVE_TEST_SECRET_KEY?.trim() ??
    env.FLUTTERWAVE_SECRET_KEY?.trim() ??
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
  } catch {
    // Never include the secret, bank details, provider request, or raw SDK
    // exception in client errors, logs, or the durable audit event.
    throw new FlutterwavePayrollAmbiguousError();
  }
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new FlutterwavePayrollAmbiguousError();
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new FlutterwavePayrollAmbiguousError();
  }
  const body = result as JsonObject;
  if (!response.ok || typeof body.status !== "string") {
    throw new FlutterwavePayrollUnavailableError(
      "Flutterwave could not verify or accept this payroll operation; check the stored provider status before proceeding",
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
    if (!["TEST", "LIVE"].includes(capability.mode)) {
      throw new FlutterwavePayrollUnavailableError(
        "Bank verification requires explicitly configured Flutterwave test credentials or an approved live service",
      );
    }
    const key = providerKey(this.env, capability.mode as "TEST" | "LIVE");
    const body = await v3Request("/accounts/resolve", key, {
      method: "POST",
      body: JSON.stringify({
        account_number: input.accountNumber,
        account_bank: input.bankCode,
      }),
    }, this.fetchImpl);
    const resolved = record(body.data);
    if (
      body.status !== "success" ||
      typeof resolved?.account_number !== "string" ||
      typeof resolved.account_name !== "string" ||
      resolved.account_number !== input.accountNumber ||
      resolved.account_name.trim().length < 2
    ) {
      throw new FlutterwavePayrollUnavailableError(
        "Flutterwave did not return matching verified bank-account details",
      );
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