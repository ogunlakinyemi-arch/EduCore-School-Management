import webPush from "web-push";
import { z } from "zod";
import { ECDH } from "node:crypto";
import type { PushProvider, ProviderSendResult, WebPushSubscription } from "./communication-providers";

// Do not permit arbitrary HTTPS targets: subscriptions are server-side egress credentials.
export const pushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2048).refine(value => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash && !url.port &&
      (["fcm.googleapis.com", "web.push.apple.com", "updates.push.services.mozilla.com", "push.services.mozilla.com"].includes(url.hostname)
        || url.hostname.endsWith(".notify.windows.com"));
  }, "Unsupported push service"),
  expirationTime: z.number().int().positive().nullable().optional(),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/).refine(v => {
      try {
        const key=Buffer.from(v,"base64url");
        if(key.length!==65 || key[0]!==4) return false;
        ECDH.convertKey(key,"prime256v1",undefined,undefined,"uncompressed");
        return true;
      } catch { return false; }
    }),
    auth: z.string().regex(/^[A-Za-z0-9_-]+={0,2}$/).refine(v => Buffer.from(v, "base64url").length === 16),
  }).strict(),
}).strict();

export class WebPushProvider implements PushProvider {
  readonly provider = "web-push";
  readonly channel = "push" as const;
  get configured() { return Boolean(this.config.publicKey && this.config.privateKey && this.config.subject); }
  constructor(private readonly config: { publicKey: string; privateKey: string; subject: string },
    private readonly transport: typeof webPush.sendNotification = webPush.sendNotification) {}
  async send(message: { subscription: WebPushSubscription; idempotencyKey: string }): Promise<ProviderSendResult> {
    const failed = (category: "CONFIGURATION" | "INVALID_REQUEST" | "NETWORK" | "RATE_LIMITED" | "PROVIDER_REJECTED", retryable = false): ProviderSendResult =>
      ({ provider: this.provider, channel: this.channel, status: "FAILED", accepted: false, delivered: false, failure: { category, retryable } });
    if (!this.config.publicKey || !this.config.privateKey || !/^(mailto:|https:\/\/)/.test(this.config.subject)) return failed("CONFIGURATION");
    const parsed = pushSubscriptionSchema.safeParse(message.subscription);
    if (!parsed.success || (parsed.data.expirationTime && parsed.data.expirationTime <= Date.now())) return failed("INVALID_REQUEST");
    try {
      // Generic lock-screen content only. No child name, school, medical details or URL credentials.
      await this.transport(parsed.data, JSON.stringify({ title: "Yemait EduCore", body: "You have a new notification. Open EduCore for details.", tag: message.idempotencyKey }), {
        vapidDetails: { subject: this.config.subject, publicKey: this.config.publicKey, privateKey: this.config.privateKey },
        TTL: 300, timeout: 8000,
      });
      return { provider: this.provider, channel: this.channel, status: "ACCEPTED", accepted: true, delivered: false };
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return failed("INVALID_REQUEST");
      if (status === 429) return failed("RATE_LIMITED", true);
      // Missing response or 5xx can mean accepted-but-lost; never blindly resend.
      return failed(!status || status >= 500 ? "NETWORK" : "PROVIDER_REJECTED");
    }
  }
}

/** Test-only controlled transport. Never accesses the network. */
export class MockPushProvider implements PushProvider {
  readonly provider = "mock-push";
  readonly channel = "push" as const;
  readonly attempts: string[] = [];
  constructor(private readonly status: "SIMULATED" | "FAILED" = "SIMULATED") {}
  async send(message: { subscription: WebPushSubscription; idempotencyKey: string }): Promise<ProviderSendResult> {
    this.attempts.push(message.idempotencyKey);
    return { provider: this.provider, channel: this.channel, status: this.status, accepted: false, delivered: false,
      ...(this.status === "FAILED" ? { failure: { category: "RATE_LIMITED" as const, retryable: true } } : {}) };
  }
}