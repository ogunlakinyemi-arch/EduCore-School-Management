import { afterEach, describe, expect, it, vi } from "vitest";
import { developmentPaymentNotificationsSuppressed } from "../lib/development-payment-notification-policy";
import {
  createCommunicationProviders, createDevelopmentCommunicationProviders,
  HttpEmailProvider, ResendEmailProvider, TermiiSmsProvider,
} from "./communication-providers";

vi.mock("../lib/logger", () => ({ logger: { warn: vi.fn() } }));

const email = { to: "parent@example.test", subject: "Test", body: "Test only" };
const sms = { to: "+2348012345678", body: "Test only" };
const env = {
  NODE_ENV: "development",
  EDUCORE_DEVELOPMENT_PAYMENT_TEST_NOTIFICATIONS_DISABLED: "true",
  COMMUNICATION_EMAIL_PROVIDER: "resend",
  RESEND_API_KEY: "synthetic-only",
  EMAIL_FROM: "Test <test@example.test>",
  RESEND_DEVELOPMENT_RECIPIENTS: email.to,
  COMMUNICATION_SMS_PROVIDER: "termii",
  TERMII_API_KEY: "synthetic-only",
  TERMII_SENDER_ID: "Test",
};

afterEach(() => vi.unstubAllEnvs());

describe("Development payment notification safety (mocked transport only)", () => {
  it.each([createCommunicationProviders, createDevelopmentCommunicationProviders])(
    "blocks both channels even with configured providers and approved recipients",
    async factory => {
      const fetch = vi.fn();
      const providers = factory(env, { fetch });
      for (const result of [await providers.email.send(email), await providers.sms.send(sms)]) {
        expect(result).toMatchObject({
          status: "FAILED", accepted: false, delivered: false,
          failure: { category: "CONFIGURATION", retryable: false },
        });
      }
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("also guards manual factory calls while Development workers are paused", async () => {
    const fetch = vi.fn();
    const providers = createCommunicationProviders({
      ...env, EDUCORE_DEVELOPMENT_PAYMENT_TEST_NOTIFICATIONS_DISABLED: "",
      EDUCORE_DEVELOPMENT_WORKERS_PAUSED: "true",
    }, { fetch });
    expect((await providers.email.send(email)).accepted).toBe(false);
    expect((await providers.sms.send(sms)).accepted).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("blocks directly constructed real transports at send time", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("REPLIT_DEPLOYMENT", "");
    vi.stubEnv("EDUCORE_DEVELOPMENT_PAYMENT_TEST_NOTIFICATIONS_DISABLED", "true");
    const fetch = vi.fn();
    const resend = new ResendEmailProvider({ apiKey: "synthetic-only", from: env.EMAIL_FROM }, { fetch });
    const http = new HttpEmailProvider({ endpoint: "https://mail.example.test/send", apiKey: "synthetic-only" }, { fetch });
    const termii = new TermiiSmsProvider({ apiKey: "synthetic-only", senderId: "Test" }, { fetch });
    for (const result of [await resend.send(email), await http.send(email), await termii.send(sms)]) {
      expect(result).toMatchObject({ status: "FAILED", accepted: false, delivered: false });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { ...env, NODE_ENV: "production" },
    { ...env, REPLIT_DEPLOYMENT: "1" },
  ])("does not apply the lock to production or deployment configuration", config => {
    expect(developmentPaymentNotificationsSuppressed(config)).toBe(false);
    expect(createCommunicationProviders(config).email.provider).toBe("resend");
    expect(createCommunicationProviders(config).sms.provider).toBe("termii");
  });

  it("leaves production sending unchanged (mock transport, no real request)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EDUCORE_DEVELOPMENT_PAYMENT_TEST_NOTIFICATIONS_DISABLED", "true");
    const fetch = vi.fn(async () => new Response(JSON.stringify({ id: "mock-message" }), { status: 200 }));
    const provider = new ResendEmailProvider({ apiKey: "synthetic-only", from: env.EMAIL_FROM }, { fetch });
    expect((await provider.send(email)).accepted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
