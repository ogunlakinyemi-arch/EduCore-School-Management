import { createECDH } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ pool: {} }));
import { notificationChannelAvailability, notificationChannelConfiguration, emailSetupDetail } from "./notification-channel-policy";
import { validVapidConfiguration } from "./web-push-configuration";
import { WebPushProvider } from "./web-push-provider";
import { dispatchCommunicationDeliveries } from "./communication-service";

function syntheticKeys() {
  const curve = createECDH("prime256v1");
  curve.generateKeys();
  return { publicKey: curve.getPublicKey().toString("base64url"),
    privateKey: curve.getPrivateKey().toString("base64url"), subject: "mailto:fixture@example.invalid" };
}
afterEach(() => vi.unstubAllEnvs());
describe("local notification readiness, no provider network", () => {
  it("does not infer email selection or sender from API key presence", () => {
    const env = { NODE_ENV: "production", RESEND_API_KEY: "synthetic-key" };
    expect(notificationChannelConfiguration(env).EMAIL).toBe(false);
    expect(notificationChannelConfiguration({ ...env, COMMUNICATION_EMAIL_PROVIDER: "resend" }).EMAIL).toBe(false);
    const configured = { ...env, COMMUNICATION_EMAIL_PROVIDER: " ReSeNd ", EMAIL_FROM: "EduCore <fixture@example.invalid>" };
    expect(notificationChannelConfiguration(configured).EMAIL).toBe(true);
    expect(notificationChannelAvailability(configured).EMAIL).toBe(false);
    expect(notificationChannelConfiguration({ ...env, COMMUNICATION_EMAIL_PROVIDER: "resend", EMAIL_FROM: "invalid" }).EMAIL).toBe(false);
  });
  it("SMS stays unavailable even with credentials, and Telegram requires Production enablement", () => {
    expect(notificationChannelAvailability({ NODE_ENV: "production", COMMUNICATION_SMS_PROVIDER: "termii",
      TERMII_API_KEY: "synthetic", TERMII_SENDER_ID: "synthetic", TELEGRAM_BOT_TOKEN: "synthetic",
      SESSION_SECRET: "synthetic-session-value-over-32-characters" }))
      .toMatchObject({ SMS: false, TELEGRAM: false });
  });
  it("validates VAPID key pair and subject locally; nonempty or mismatched keys are not ready", () => {
    const pair = syntheticKeys();
    expect(validVapidConfiguration(pair)).toBe(true);
    expect(validVapidConfiguration({ ...pair, publicKey: syntheticKeys().publicKey })).toBe(false);
    expect(validVapidConfiguration({ ...pair, privateKey: "not-a-private-key" })).toBe(false);
    for (const subject of ["mailto:", "mailto:not-an-email", "https:", "http://example.invalid", "https://user:pass@example.invalid", "mailto:a@example.invalid\n"]) {
      expect(validVapidConfiguration({ ...pair, subject })).toBe(false);
    }
    const env = { NODE_ENV: "production", VAPID_PUBLIC_KEY: pair.publicKey,
      VAPID_PRIVATE_KEY: pair.privateKey, VAPID_SUBJECT: pair.subject };
    expect(notificationChannelConfiguration(env).PUSH).toBe(true);
    expect(notificationChannelAvailability(env).PUSH).toBe(false);
  });
  it("reports exact email setup keys without disclosing sender/credential or inferring readiness", () => {
    expect(emailSetupDetail({})).toContain("COMMUNICATION_EMAIL_PROVIDER");
    expect(emailSetupDetail({ COMMUNICATION_EMAIL_PROVIDER: "resend" })).toContain("EMAIL_FROM");
    const env = { COMMUNICATION_EMAIL_PROVIDER: "resend", EMAIL_FROM: "Fixture <private@example.invalid>",
      RESEND_API_KEY: "synthetic-private-credential" };
    const detail = emailSetupDetail(env);
    expect(detail).toContain("configured for preference setup");
    expect(detail).not.toContain(env.EMAIL_FROM);
    expect(detail).not.toContain(env.RESEND_API_KEY);
  });
  it("invalid VAPID config blocks provider transport and reports unconfigured", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const transport = vi.fn();
    const pair = syntheticKeys();
    const provider = new WebPushProvider({ ...pair, publicKey: syntheticKeys().publicKey }, transport);
    expect(provider.configured).toBe(false);
    expect(await provider.send({ subscription: {} as any, idempotencyKey: "synthetic" }))
      .toMatchObject({ accepted: false, failure: { category: "CONFIGURATION" } });
    expect(transport).not.toHaveBeenCalled();
  });
  it("does not claim SMS or unconfigured push deliveries, so attempts are not exhausted", async () => {
    const query = vi.fn();
    const pool = { query, connect: vi.fn() };
    const result = await dispatchCommunicationDeliveries(pool as any, 1, { channels: ["SMS", "PUSH"],
      providers: { sms: { provider: "mock", channel: "sms", send: vi.fn() },
        email: { provider: "mock", channel: "email", send: vi.fn() },
        push: new WebPushProvider({ publicKey: "invalid", privateKey: "invalid", subject: "mailto:fixture@example.invalid" }) } });
    expect(result.claimed).toBe(0);
    expect(pool.connect).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
});
