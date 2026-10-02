import type { EmailMessage, SmsMessage, EmailProvider, SmsProvider, ProviderSendResult } from "./communication-providers";
/** Inject explicitly in tests only. Never reads credentials or uses a transport. */
class MockProvider<C extends "email" | "sms"> {
  readonly attempts: { id: string; key?: string }[] = [];
  constructor(readonly channel: C, private readonly results: ("success" | "failure" | "retry")[] = ["success"]) {}
  get provider() { return `mock-${this.channel}`; }
  async send(message: EmailMessage | SmsMessage): Promise<ProviderSendResult> {
    const id = `mock-${this.channel}-${this.attempts.length + 1}`;
    this.attempts.push({ id, key: message.idempotencyKey });
    const selected = this.results[Math.min(this.attempts.length - 1, this.results.length - 1)];
    return { provider: this.provider, channel: this.channel, status: selected === "success" ? "SIMULATED" : "FAILED",
      accepted: false, delivered: false, providerMessageId: id,
      ...(selected !== "success" ? { failure: { category: selected === "retry" ? "RATE_LIMITED" as const : "PROVIDER_REJECTED" as const,
        retryable: selected === "retry" } } : {}) };
  }
}
export class MockEmailProvider extends MockProvider<"email"> implements EmailProvider {
  constructor(results?: ("success" | "failure" | "retry")[]) { super("email", results); }
}
export class MockSmsProvider extends MockProvider<"sms"> implements SmsProvider {
  constructor(results?: ("success" | "failure" | "retry")[]) { super("sms", results); }
}