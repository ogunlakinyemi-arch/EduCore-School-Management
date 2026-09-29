import { logger } from "../lib/logger";

export type CommunicationChannel = "sms" | "email";
export type ProviderDeliveryStatus = "SIMULATED" | "ACCEPTED" | "DELIVERED" | "FAILED";
export type ProviderFailureCategory =
  | "CONFIGURATION"
  | "AUTHENTICATION"
  | "RATE_LIMITED"
  | "INVALID_REQUEST"
  | "PROVIDER_REJECTED"
  | "TIMEOUT"
  | "NETWORK"
  | "UNKNOWN";

export interface ProviderFailure {
  category: ProviderFailureCategory;
  retryable: boolean;
}

/**
 * ACCEPTED means the provider accepted the request, not that the recipient
 * received it. Only an independently verified delivery receipt may set
 * delivered=true / status=DELIVERED.
 */
export interface ProviderSendResult {
  provider: string;
  channel: CommunicationChannel;
  status: ProviderDeliveryStatus;
  accepted: boolean;
  delivered: boolean;
  providerMessageId?: string;
  failure?: ProviderFailure;
}

export interface SmsMessage {
  to: string;
  body: string;
  idempotencyKey?: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
  html?: string;
  from?: string;
  idempotencyKey?: string;
}

export interface SmsProvider {
  readonly provider: string;
  readonly channel: "sms";
  send(message: SmsMessage): Promise<ProviderSendResult>;
}

export interface EmailProvider {
  readonly provider: string;
  readonly channel: "email";
  send(message: EmailMessage): Promise<ProviderSendResult>;
}

export interface CommunicationProviderAdapters {
  sms: SmsProvider;
  email: EmailProvider;
}

export interface CommunicationProviderLogEvent {
  provider: string;
  channel: CommunicationChannel;
  category: ProviderFailureCategory;
}

export interface CommunicationProviderOptions {
  /** Inject a deterministic transport in tests. Never use live providers in tests. */
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Receives only provider/channel/category; never message, recipient, response or credentials. */
  onFailure?: (event: CommunicationProviderLogEvent) => void;
}

export class CommunicationProviderConfigurationError extends Error {
  readonly code = "COMMUNICATION_PROVIDER_NOT_CONFIGURED";
  readonly category = "CONFIGURATION" as const;
  readonly retryable = false;

  constructor(channel: CommunicationChannel, _provider: string) {
    super(`The selected ${channel} provider is not configured.`);
    this.name = "CommunicationProviderConfigurationError";
  }
}

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_FROM_NAME = "Yemait EduCore";
const SAFE_PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

function emitSafeFailure(
  event: CommunicationProviderLogEvent,
  onFailure?: CommunicationProviderOptions["onFailure"],
): void {
  try {
    if (onFailure) {
      onFailure(event);
    } else {
      logger.warn(event, "Communication provider request failed");
    }
  } catch {
    // A logging adapter failure must not change the delivery result.
  }
}

function failedResult(
  provider: string,
  channel: CommunicationChannel,
  category: ProviderFailureCategory,
  retryable: boolean,
  onFailure?: CommunicationProviderOptions["onFailure"],
): ProviderSendResult {
  emitSafeFailure({ provider, channel, category }, onFailure);
  return {
    provider,
    channel,
    status: "FAILED",
    accepted: false,
    delivered: false,
    failure: { category, retryable },
  };
}

function acceptedResult(
  provider: string,
  channel: CommunicationChannel,
  providerMessageId?: string,
): ProviderSendResult {
  return {
    provider,
    channel,
    status: "ACCEPTED",
    accepted: true,
    delivered: false,
    ...(providerMessageId && SAFE_PROVIDER_ID.test(providerMessageId) ? { providerMessageId } : {}),
  };
}

function isValidMessagePart(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function nonRetryableFailure(status: number): ProviderFailureCategory {
  if (status === 401 || status === 403) return "AUTHENTICATION";
  if (status === 400 || status === 404 || status === 422) return "INVALID_REQUEST";
  return "PROVIDER_REJECTED";
}

function responseFailure(
  provider: string,
  channel: CommunicationChannel,
  status: number,
  onFailure?: CommunicationProviderOptions["onFailure"],
): ProviderSendResult {
  if (status === 401 || status === 403) {
    return failedResult(provider, channel, "AUTHENTICATION", false, onFailure);
  }
  if (status === 429) {
    return failedResult(provider, channel, "RATE_LIMITED", true, onFailure);
  }
  if (status === 408) {
    return failedResult(provider, channel, "TIMEOUT", true, onFailure);
  }
  if (status >= 500 && status <= 599) {
    return failedResult(provider, channel, "PROVIDER_REJECTED", true, onFailure);
  }
  return failedResult(provider, channel, nonRetryableFailure(status), false, onFailure);
}

function transportFailure(
  provider: string,
  channel: CommunicationChannel,
  error: unknown,
  onFailure?: CommunicationProviderOptions["onFailure"],
): ProviderSendResult {
  const timedOut = error instanceof Error && error.name === "AbortError";
  return failedResult(provider, channel, timedOut ? "TIMEOUT" : "NETWORK", true, onFailure);
}

function isSuccessfulTermiiResponse(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const result = payload as Record<string, unknown>;
  return result.code === "ok"
    || result.status === "success"
    || (typeof result.message_id === "string" && result.message_id.length > 0);
}

function readProviderMessageId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const result = payload as Record<string, unknown>;
  const id = result.message_id ?? result.messageId ?? result.id;
  return typeof id === "string" && SAFE_PROVIDER_ID.test(id) ? id : undefined;
}

function createTimeoutSignal(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  timeout.unref?.();
  return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

/** Explicit no-network adapter for local development and automated tests. */
export class DevelopmentCommunicationProvider<Channel extends CommunicationChannel> {
  readonly channel: Channel;

  constructor(channel: Channel) {
    this.channel = channel;
  }

  get provider(): string {
    return `development-${this.channel}`;
  }

  async send(
    _message: Channel extends "sms" ? SmsMessage : EmailMessage,
  ): Promise<ProviderSendResult> {
    return {
      provider: this.provider,
      channel: this.channel,
      status: "SIMULATED",
      accepted: false,
      delivered: false,
    };
  }
}

/**
 * Termii's synchronous send API confirms acceptance only; its message ID is
 * useful for later delivery-status reconciliation, but is not a delivery receipt.
 */
export class TermiiSmsProvider implements SmsProvider {
  readonly provider = "termii";
  readonly channel = "sms" as const;
  private readonly apiKey: string;
  private readonly senderId: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly onFailure?: CommunicationProviderOptions["onFailure"];

  constructor(
    config: { apiKey: string; senderId: string },
    options: CommunicationProviderOptions = {},
  ) {
    if (!isValidMessagePart(config.apiKey) || !isValidMessagePart(config.senderId)) {
      throw new CommunicationProviderConfigurationError("sms", this.provider);
    }
    this.apiKey = config.apiKey;
    this.senderId = config.senderId;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.onFailure = options.onFailure;
  }

  async send(message: SmsMessage): Promise<ProviderSendResult> {
    if (!isValidMessagePart(message.to) || !isValidMessagePart(message.body)) {
      return failedResult(this.provider, this.channel, "INVALID_REQUEST", false, this.onFailure);
    }

    const timeout = createTimeoutSignal(this.timeoutMs);
    try {
      const response = await this.fetchImpl("https://api.ng.termii.com/api/sms/send", {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          to: message.to,
          from: this.senderId,
          sms: message.body,
          type: "plain",
          channel: "generic",
          api_key: this.apiKey,
        }),
        signal: timeout.signal,
      });
      if (!response.ok) {
        return responseFailure(this.provider, this.channel, response.status, this.onFailure);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return failedResult(this.provider, this.channel, "PROVIDER_REJECTED", true, this.onFailure);
      }
      if (!isSuccessfulTermiiResponse(payload)) {
        return failedResult(this.provider, this.channel, "PROVIDER_REJECTED", true, this.onFailure);
      }
      return acceptedResult(this.provider, this.channel, readProviderMessageId(payload));
    } catch (error) {
      return transportFailure(this.provider, this.channel, error, this.onFailure);
    } finally {
      timeout.clear();
    }
  }
}

/**
 * Generic JSON/HTTP mail gateway. It sends a small documented JSON contract:
 * {to, subject, text, html?, from?}. A 2xx response means accepted, never delivered.
 */
export class HttpEmailProvider implements EmailProvider {
  readonly provider = "http-email";
  readonly channel = "email" as const;
  private readonly endpoint: URL;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly onFailure?: CommunicationProviderOptions["onFailure"];

  constructor(
    config: { endpoint: string; apiKey: string },
    options: CommunicationProviderOptions = {},
  ) {
    if (!isValidMessagePart(config.apiKey)) {
      throw new CommunicationProviderConfigurationError("email", this.provider);
    }
    let endpoint: URL;
    try {
      endpoint = new URL(config.endpoint);
    } catch {
      throw new CommunicationProviderConfigurationError("email", this.provider);
    }
    const localHost = endpoint.hostname === "localhost"
      || endpoint.hostname === "127.0.0.1"
      || endpoint.hostname === "::1";
    const localDevelopment = process.env.NODE_ENV !== "production" && localHost && endpoint.protocol === "http:";
    if (
      (endpoint.protocol !== "https:" && !localDevelopment)
      || endpoint.username
      || endpoint.password
      || endpoint.search
      || endpoint.hash
    ) {
      throw new CommunicationProviderConfigurationError("email", this.provider);
    }

    this.endpoint = endpoint;
    this.apiKey = config.apiKey;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.onFailure = options.onFailure;
  }

  async send(message: EmailMessage): Promise<ProviderSendResult> {
    if (
      !isValidMessagePart(message.to)
      || !isValidMessagePart(message.subject)
      || !isValidMessagePart(message.body)
    ) {
      return failedResult(this.provider, this.channel, "INVALID_REQUEST", false, this.onFailure);
    }

    const payload: Record<string, string> = {
      to: message.to,
      subject: message.subject,
      text: message.body,
    };
    if (message.html !== undefined) payload.html = message.html;
    const from = message.from?.trim() || DEFAULT_FROM_NAME;
    payload.from = from;

    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${this.apiKey}`,
    };
    if (message.idempotencyKey) headers["idempotency-key"] = message.idempotencyKey;

    const timeout = createTimeoutSignal(this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        redirect: "error",
        headers,
        body: JSON.stringify(payload),
        signal: timeout.signal,
      });
      if (!response.ok) {
        return responseFailure(this.provider, this.channel, response.status, this.onFailure);
      }

      let providerMessageId: string | undefined;
      try {
        providerMessageId = readProviderMessageId(await response.json());
      } catch {
        // The HTTP status is an acceptance acknowledgement; response-body parsing
        // cannot upgrade or revoke that acknowledgement.
      }
      return acceptedResult(this.provider, this.channel, providerMessageId);
    } catch (error) {
      return transportFailure(this.provider, this.channel, error, this.onFailure);
    } finally {
      timeout.clear();
    }
  }
}

function configuredProviderName(value: string | undefined): string {
  return value?.trim().toLowerCase() || "development";
}

export function createSmsProvider(
  env: NodeJS.ProcessEnv = process.env,
  options: CommunicationProviderOptions = {},
): SmsProvider {
  const selected = configuredProviderName(env.COMMUNICATION_SMS_PROVIDER);
  if (selected === "development" || selected === "dev" || selected === "test") {
    return new DevelopmentCommunicationProvider("sms");
  }
  if (selected !== "termii") {
    throw new CommunicationProviderConfigurationError("sms", selected);
  }
  if (!env.TERMII_API_KEY || !env.TERMII_SENDER_ID) {
    throw new CommunicationProviderConfigurationError("sms", selected);
  }
  return new TermiiSmsProvider(
    { apiKey: env.TERMII_API_KEY, senderId: env.TERMII_SENDER_ID },
    options,
  );
}

export function createEmailProvider(
  env: NodeJS.ProcessEnv = process.env,
  options: CommunicationProviderOptions = {},
): EmailProvider {
  const selected = configuredProviderName(env.COMMUNICATION_EMAIL_PROVIDER);
  if (selected === "development" || selected === "dev" || selected === "test") {
    return new DevelopmentCommunicationProvider("email");
  }
  if (selected !== "http") {
    throw new CommunicationProviderConfigurationError("email", selected);
  }
  if (!env.COMMUNICATION_EMAIL_ENDPOINT || !env.COMMUNICATION_EMAIL_API_KEY) {
    throw new CommunicationProviderConfigurationError("email", selected);
  }
  return new HttpEmailProvider(
    { endpoint: env.COMMUNICATION_EMAIL_ENDPOINT, apiKey: env.COMMUNICATION_EMAIL_API_KEY },
    options,
  );
}

/** Resolve only explicitly configured adapters; defaults are safe no-network simulations. */
export function createCommunicationProviders(
  env: NodeJS.ProcessEnv = process.env,
  options: CommunicationProviderOptions = {},
): CommunicationProviderAdapters {
  return {
    sms: createSmsProvider(env, options),
    email: createEmailProvider(env, options),
  };
}