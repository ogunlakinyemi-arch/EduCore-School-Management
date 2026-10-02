import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CommunicationProviderConfigurationError,
  createCommunicationProviders,
  createEmailProvider,
  createSmsProvider,
} from "./communication-providers";

function fakeFetch(
  response: Response | (() => Promise<Response>),
): typeof fetch {
  return vi.fn(async () => typeof response === "function" ? response() : response) as unknown as typeof fetch;
}

describe("communication provider adapters", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults to SMS and email development adapters that never invoke fetch", async () => {
    const fetch = vi.fn();
    const providers = createCommunicationProviders({}, { fetch: fetch as unknown as typeof globalThis.fetch });

    const sms = await providers.sms.send({ to: "+2348012345678", body: "Test SMS" });
    const email = await providers.email.send({
      to: "parent@example.test",
      subject: "Test",
      body: "Test email",
    });

    expect(sms).toMatchObject({
      provider: "development-sms",
      channel: "sms",
      status: "SIMULATED",
      accepted: false,
      delivered: false,
    });
    expect(email).toMatchObject({
      provider: "development-email",
      channel: "email",
      status: "SIMULATED",
      accepted: false,
      delivered: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("simulates Termii safely when it is selected without an approved sender ID", async () => {
    const fetch = vi.fn();
    const provider = createSmsProvider({
      COMMUNICATION_SMS_PROVIDER: "termii",
      TERMII_API_KEY: "test-termii-secret",
    }, { fetch: fetch as unknown as typeof globalThis.fetch });

    const result = await provider.send({ to: "+2348012345678", body: "Development update" });

    expect(result).toMatchObject({
      provider: "development-sms",
      status: "SIMULATED",
      accepted: false,
      delivered: false,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("still rejects Termii configuration with a sender ID but no API key", () => {
    expect(() => createSmsProvider({
      COMMUNICATION_SMS_PROVIDER: "termii",
      TERMII_SENDER_ID: "ApprovedSender",
    })).toThrow(CommunicationProviderConfigurationError);
  });

  it("fails closed in production when Termii has no approved sender ID", () => {
    expect(() => createSmsProvider({
      NODE_ENV: "production",
      COMMUNICATION_SMS_PROVIDER: "termii",
      TERMII_API_KEY: "test-termii-secret",
    })).toThrow(CommunicationProviderConfigurationError);
  });

  it("fails closed when the selected email gateway is missing credentials", () => {
    expect(() => createEmailProvider({ COMMUNICATION_EMAIL_PROVIDER: "http" })).toThrow(
      CommunicationProviderConfigurationError,
    );
  });

  it("sends Termii SMS with its configured credential but reports acceptance, not delivery", async () => {
    const fetch = fakeFetch(new Response(JSON.stringify({
      code: "ok",
      message_id: "termii-message-17",
      message: "Successfully Sent",
    }), { status: 200 }));
    const provider = createSmsProvider({
      COMMUNICATION_SMS_PROVIDER: "termii",
      TERMII_API_KEY: "test-termii-secret",
      TERMII_SENDER_ID: "Yemait",
    }, { fetch });

    const result = await provider.send({ to: "+2348012345678", body: "School update" });
    const [url, request] = vi.mocked(fetch).mock.calls[0];
    const sentBody = JSON.parse(String(request?.body));

    expect(url).toBe("https://api.ng.termii.com/api/sms/send");
    expect(sentBody).toMatchObject({ to: "+2348012345678", from: "Yemait", sms: "School update", type: "plain" });
    expect(sentBody.api_key).toBe("test-termii-secret");
    expect(result).toEqual({
      provider: "termii",
      channel: "sms",
      status: "ACCEPTED",
      accepted: true,
      delivered: false,
      providerMessageId: "termii-message-17",
    });
  });

  it.each([
    ["08012345678", "+2348012345678"],
    ["080 1234 5678", "+2348012345678"],
    ["8012345678", "+2348012345678"],
    ["2348012345678", "+2348012345678"],
    ["002348012345678", "+2348012345678"],
  ])("normalizes an approved Nigerian phone format %s before sending", async (phone, expected) => {
    const fetch = fakeFetch(new Response(JSON.stringify({ code: "ok" }), { status: 200 }));
    const provider = createSmsProvider({
      COMMUNICATION_SMS_PROVIDER: "termii",
      TERMII_API_KEY: "test-termii-secret",
      TERMII_SENDER_ID: "ApprovedSender",
    }, { fetch });

    const result = await provider.send({ to: phone, body: "School update" });
    const request = vi.mocked(fetch).mock.calls[0]?.[1];

    expect(result.status).toBe("ACCEPTED");
    expect(JSON.parse(String(request?.body)).to).toBe(expected);
  });

  it.each([
    "not-a-phone",
    "parent@example.test",
    "123",
    "+23408012345678",
    "0023408012345678",
    "++2348012345678",
    "0801234567",
    "080123456789",
    "+0123456789",
  ])("rejects malformed Termii recipient %s without a provider call or recipient leakage", async phone => {
    const fetch = vi.fn();
    const events: unknown[] = [];
    const provider = createSmsProvider({
      COMMUNICATION_SMS_PROVIDER: "termii",
      TERMII_API_KEY: "test-termii-secret",
      TERMII_SENDER_ID: "ApprovedSender",
    }, {
      fetch: fetch as unknown as typeof globalThis.fetch,
      onFailure: event => events.push(event),
    });

    const result = await provider.send({ to: phone, body: "Private message" });
    const safeOutput = JSON.stringify({ result, events });

    expect(result).toMatchObject({
      status: "FAILED",
      failure: { category: "INVALID_REQUEST", retryable: false },
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(safeOutput).not.toContain(phone);
    expect(safeOutput).not.toContain("test-termii-secret");
    expect(safeOutput).not.toContain("Private message");
  });

  it.each([
    [408, "TIMEOUT", true],
    [500, "UNKNOWN", false],
    [422, "INVALID_REQUEST", false],
  ] as const)("classifies Termii HTTP %s safely without response-body leakage", async (status, category, retryable) => {
    const events: unknown[] = [];
    const fetch = fakeFetch(new Response("secret=token; recipient=private", { status }));
    const provider = createSmsProvider({
      COMMUNICATION_SMS_PROVIDER: "termii",
      TERMII_API_KEY: "test-termii-secret",
      TERMII_SENDER_ID: "ApprovedSender",
    }, { fetch, onFailure: event => events.push(event) });

    const result = await provider.send({ to: "+2348012345678", body: "Private message" });
    const safeOutput = JSON.stringify({ result, events });

    expect(result.failure).toEqual({ category, retryable });
    expect(safeOutput).not.toContain("test-termii-secret");
    expect(safeOutput).not.toContain("+2348012345678");
    expect(safeOutput).not.toContain("Private message");
    expect(safeOutput).not.toContain("recipient=private");
  });

  it("does not expose credentials or provider response bodies in failed SMS results or logs", async () => {
    const events: unknown[] = [];
    const fetch = fakeFetch(new Response("token=test-termii-secret; recipient rejected", { status: 401 }));
    const provider = createSmsProvider({
      COMMUNICATION_SMS_PROVIDER: "termii",
      TERMII_API_KEY: "test-termii-secret",
      TERMII_SENDER_ID: "Yemait",
    }, { fetch, onFailure: event => events.push(event) });

    const result = await provider.send({ to: "+2348012345678", body: "Private message" });
    const safeOutput = JSON.stringify({ result, events });

    expect(result).toMatchObject({
      status: "FAILED",
      accepted: false,
      delivered: false,
      failure: { category: "AUTHENTICATION", retryable: false },
    });
    expect(safeOutput).not.toContain("test-termii-secret");
    expect(safeOutput).not.toContain("+2348012345678");
    expect(safeOutput).not.toContain("Private message");
    expect(safeOutput).not.toContain("recipient rejected");
  });

  it("categorizes retryable rate limiting without trusting provider error text", async () => {
    const events: unknown[] = [];
    const fetch = fakeFetch(new Response("token=private", { status: 429 }));
    const provider = createSmsProvider({
      COMMUNICATION_SMS_PROVIDER: "termii",
      TERMII_API_KEY: "private",
      TERMII_SENDER_ID: "Yemait",
    }, { fetch, onFailure: event => events.push(event) });

    const result = await provider.send({ to: "+2348012345678", body: "Message" });

    expect(result.failure).toEqual({ category: "RATE_LIMITED", retryable: true });
    expect(JSON.stringify(events)).not.toContain("private");
  });

  it("classifies transport failures without leaking exception details", async () => {
    const events: unknown[] = [];
    const fetch = vi.fn(async () => {
      throw new Error("request failed using test-termii-secret");
    }) as unknown as typeof globalThis.fetch;
    const provider = createSmsProvider({
      COMMUNICATION_SMS_PROVIDER: "termii",
      TERMII_API_KEY: "test-termii-secret",
      TERMII_SENDER_ID: "Yemait",
    }, { fetch, onFailure: event => events.push(event) });

    const result = await provider.send({ to: "+2348012345678", body: "Message" });

    expect(result.failure).toEqual({ category: "NETWORK", retryable: true });
    expect(JSON.stringify({ result, events })).not.toContain("test-termii-secret");
  });

  it("sends email through an injected HTTP gateway and treats 2xx as accepted only", async () => {
    const fetch = fakeFetch(new Response(JSON.stringify({ id: "mail-job-5" }), { status: 202 }));
    const provider = createEmailProvider({
      COMMUNICATION_EMAIL_PROVIDER: "http",
      COMMUNICATION_EMAIL_ENDPOINT: "https://mail.example.test/send",
      COMMUNICATION_EMAIL_API_KEY: "test-email-secret",
    }, { fetch });

    const result = await provider.send({
      to: "parent@example.test",
      subject: "Attendance",
      body: "Your child arrived.",
      idempotencyKey: "event-53-parent-7",
    });
    const [, request] = vi.mocked(fetch).mock.calls[0];
    const sentBody = JSON.parse(String(request?.body));

    expect(request?.headers).toMatchObject({
      authorization: "Bearer test-email-secret",
      "idempotency-key": "event-53-parent-7",
    });
    expect(sentBody).toMatchObject({
      to: "parent@example.test",
      subject: "Attendance",
      text: "Your child arrived.",
    });
    expect(result).toEqual({
      provider: "http-email",
      channel: "email",
      status: "ACCEPTED",
      accepted: true,
      delivered: false,
      providerMessageId: "mail-job-5",
    });
  });

  it("rejects insecure or credential-bearing email endpoints", () => {
    expect(() => createEmailProvider({
      COMMUNICATION_EMAIL_PROVIDER: "http",
      COMMUNICATION_EMAIL_ENDPOINT: "http://mail.example.test/send",
      COMMUNICATION_EMAIL_API_KEY: "test-email-secret",
    })).toThrow(CommunicationProviderConfigurationError);
    expect(() => createEmailProvider({
      COMMUNICATION_EMAIL_PROVIDER: "http",
      COMMUNICATION_EMAIL_ENDPOINT: "https://user:pass@mail.example.test/send?token=unsafe",
      COMMUNICATION_EMAIL_API_KEY: "test-email-secret",
    })).toThrow(CommunicationProviderConfigurationError);
  });

  it("maps timeout errors to a retryable failure without exposing the thrown error", async () => {
    const fetch = vi.fn(async () => {
      const error = new Error("timed out with secret");
      error.name = "AbortError";
      throw error;
    }) as unknown as typeof globalThis.fetch;
    const provider = createEmailProvider({
      COMMUNICATION_EMAIL_PROVIDER: "http",
      COMMUNICATION_EMAIL_ENDPOINT: "https://mail.example.test/send",
      COMMUNICATION_EMAIL_API_KEY: "email-secret",
    }, { fetch });

    const result = await provider.send({
      to: "parent@example.test",
      subject: "Hello",
      body: "Message",
    });

    expect(result.failure).toEqual({ category: "TIMEOUT", retryable: true });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("rejects invalid message data before calling a real adapter", async () => {
    const fetch = vi.fn();
    const provider = createEmailProvider({
      COMMUNICATION_EMAIL_PROVIDER: "http",
      COMMUNICATION_EMAIL_ENDPOINT: "https://mail.example.test/send",
      COMMUNICATION_EMAIL_API_KEY: "email-secret",
    }, { fetch: fetch as unknown as typeof globalThis.fetch });

    const result = await provider.send({ to: " ", subject: "Hello", body: "Message" });

    expect(result.failure).toEqual({ category: "INVALID_REQUEST", retryable: false });
    expect(fetch).not.toHaveBeenCalled();
  });
});