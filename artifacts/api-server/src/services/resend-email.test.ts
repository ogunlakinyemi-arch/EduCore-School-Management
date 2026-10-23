import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  createEmailProvider, createCommunicationProviders,
  createDevelopmentCommunicationProviders, CommunicationProviderConfigurationError, ResendEmailProvider,
} from "./communication-providers";
import { logger } from "../lib/logger";

vi.mock("../lib/logger", () => ({ logger: { warn: vi.fn() } }));
const env = {
  NODE_ENV: "development", COMMUNICATION_EMAIL_PROVIDER: "resend",
  RESEND_API_KEY: "synthetic-resend-test-secret",
  EMAIL_FROM: "Yemait EduCore <notifications@yetenia.com>",
  RESEND_DEVELOPMENT_RECIPIENTS: "parent@example.test",
};
const message = {
  to: "parent@example.test", subject: "School update", body: "A test update.",
  idempotencyKey: "communication-51-email",
};
const transport = (status: number, payload: unknown = { id: "resend-message-51" }) =>
  vi.fn(async () => new Response(JSON.stringify(payload), { status }));

describe("Resend transactional email integration (no live network)", () => {
  afterEach(() => vi.clearAllMocks());

  it("dispatches with the configured sender, recipient, server credential and stable provider key", async () => {
    const fetch = transport(200);
    const result = await createEmailProvider(env, { fetch }).send(message);
    expect(result).toEqual({
      provider: "resend", channel: "email", status: "ACCEPTED",
      accepted: true, delivered: false, providerMessageId: "resend-message-51",
    });
    const [url, request] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(request.redirect).toBe("error");
    expect(request.headers).toMatchObject({
      authorization: "Bearer synthetic-resend-test-secret",
      "Idempotency-Key": message.idempotencyKey,
    });
    expect(JSON.parse(String(request.body))).toEqual({
      from: "Yetenia EduCore <notifications@yetenia.com>", to: [message.to], subject: message.subject, text: message.body,
      reply_to: "ogunlakinyemi@gmail.com",
    });
    expect(JSON.stringify(result)).not.toContain(env.RESEND_API_KEY);
  });

  it("allows a replaceable configured sender and sends optional HTML", async () => {
    const fetch = transport(200);
    await createEmailProvider({ ...env, EMAIL_FROM: "School <updates@example.test>" }, { fetch })
      .send({ ...message, html: "<p>Update</p>" });
    const request = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(request.body))).toMatchObject({
      from: "School <updates@example.test>", html: "<p>Update</p>", reply_to: "ogunlakinyemi@gmail.com",
    });
  });

  it("keeps the company contact as Reply-To without allowing per-message From overrides", async () => {
    const fetch = transport(200);
    await createEmailProvider(env, { fetch }).send({ ...message, from: "ogunlakinyemi@gmail.com" });
    const request = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(request.body))).toMatchObject({
      from: "Yetenia EduCore <notifications@yetenia.com>",
      reply_to: "ogunlakinyemi@gmail.com",
    });
  });

  it.each(["fixture@gmail.com", "Company <fixture@GMAIL.COM>", "Company <fixture@googlemail.com>"])(
    "fails closed on a Google-owned Resend From domain: %s", sender => {
      const fetch = transport(200);
      expect(() => createEmailProvider({ ...env, EMAIL_FROM: sender }, { fetch }))
        .toThrow(CommunicationProviderConfigurationError);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each(["not-an-address", "fixture@example.test\r\nBcc: other@example.test"])(
    "rejects an invalid Reply-To without contacting Resend: %s", replyTo => {
      const fetch = transport(200);
      expect(() => new ResendEmailProvider({
        apiKey: "synthetic-only", from: "sender@example.test", replyTo,
      }, { fetch })).toThrow(CommunicationProviderConfigurationError);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("does not impose a company Reply-To on independently constructed Resend adapters", async () => {
    const fetch = transport(200);
    await new ResendEmailProvider({ apiKey: "synthetic-only", from: "sender@example.test" }, { fetch }).send(message);
    const request = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(String(request.body))).not.toHaveProperty("reply_to");
  });

  it.each(["RESEND_API_KEY", "EMAIL_FROM"])("fails closed with missing %s and never calls the network", async key => {
    const fetch = transport(200);
    expect(() => createEmailProvider({ ...env, [key]: "" }, { fetch }))
      .toThrow(CommunicationProviderConfigurationError);
    const provider = createCommunicationProviders({ ...env, [key]: "" }, { fetch });
    expect((await provider.email.send(message)).failure?.category).toBe("CONFIGURATION");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["invalid", "Sender <a@example.test>\r\nBcc: victim@example.test"])(
    "rejects an invalid sender without exposing config", sender => {
      expect(() => createEmailProvider({ ...env, EMAIL_FROM: sender })).toThrow("not configured");
    },
  );

  it.each([
    [401, "AUTHENTICATION", false], [403, "AUTHENTICATION", false],
    [422, "INVALID_REQUEST", false], [429, "RATE_LIMITED", true],
    [500, "UNKNOWN", false], [503, "UNKNOWN", false],
  ])("classifies HTTP %s without disclosing the response or secret", async (status, category, retryable) => {
    const fetch = transport(Number(status), { message: `Private provider detail ${env.RESEND_API_KEY}` });
    const failure = vi.fn();
    const result = await createEmailProvider(env, { fetch, onFailure: failure }).send(message);
    expect(result.failure).toEqual({ category, retryable });
    expect(result.accepted).toBe(false);
    const publicOutput = JSON.stringify({ result, failures: failure.mock.calls, logs: vi.mocked(logger.warn).mock.calls });
    expect(publicOutput).not.toContain(env.RESEND_API_KEY);
    expect(publicOutput).not.toContain("Private provider detail");
    expect(publicOutput).not.toContain(message.to);
  });

  it.each(["AbortError", "Error"])("contains transport error %s and returns an uncertain outcome", async name => {
    const error = new Error(`Private ${env.RESEND_API_KEY}`); error.name = name;
    const fetch = vi.fn(async () => { throw error; });
    const result = await createEmailProvider(env, { fetch }).send(message);
    expect(result.failure?.category).toBe(name === "AbortError" ? "TIMEOUT" : "NETWORK");
    expect(JSON.stringify({ result, logs: vi.mocked(logger.warn).mock.calls })).not.toContain(env.RESEND_API_KEY);
  });

  it("holds a malformed accepted response instead of inventing a delivery receipt", async () => {
    expect((await createEmailProvider(env, { fetch: transport(200, {}) }).send(message)).failure)
      .toEqual({ category: "UNKNOWN", retryable: false });
  });

  it("preserves the same provider key and payload on repeated dispatch attempts", async () => {
    const fetch = transport(200);
    const provider = createEmailProvider(env, { fetch });
    await provider.send(message); await provider.send(message);
    const requests = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(requests[0][1].headers).toEqual(requests[1][1].headers);
    expect(requests[0][1].body).toBe(requests[1][1].body);
    // Provider-side deduplication is enforced by Resend, not a mock transport.
  });

  it.each(["", "other@example.test"])("blocks unapproved Development recipients (%s)", async allowed => {
    const fetch = transport(200);
    const provider = createEmailProvider({ ...env, RESEND_DEVELOPMENT_RECIPIENTS: allowed }, { fetch });
    expect((await provider.send(message)).failure?.category).toBe("CONFIGURATION");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("permits only approved Development email while keeping SMS simulated", async () => {
    const fetch = transport(200);
    const providers = createDevelopmentCommunicationProviders({
      ...env, RESEND_DEVELOPMENT_RECIPIENTS: " Parent@Example.Test ,second@example.test",
      COMMUNICATION_SMS_PROVIDER: "termii", TERMII_API_KEY: "synthetic-sms-secret", TERMII_SENDER_ID: "Test",
    }, { fetch });
    expect((await providers.email.send(message)).accepted).toBe(true);
    expect((await providers.sms.send({ to: "+2348012345678", body: "test" })).status).toBe("SIMULATED");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the worker no-network until a controlled Development recipient is approved", async () => {
    const fetch = transport(200);
    const providers = createDevelopmentCommunicationProviders({ ...env, RESEND_DEVELOPMENT_RECIPIENTS: "" }, { fetch });
    expect((await providers.email.send(message)).status).toBe("SIMULATED");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not impose the Development allowlist on the production factory", async () => {
    const fetch = transport(200);
    expect((await createEmailProvider({ ...env, NODE_ENV: "production", RESEND_DEVELOPMENT_RECIPIENTS: "" }, { fetch })
      .send(message)).accepted).toBe(true);
  });

  it("has no Resend credential references or fixture secrets in browser source", () => {
    const root = fileURLToPath(new URL("../../../edupulse/src/", import.meta.url));
    function inspect(dir: string) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) inspect(path);
        else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
          expect(readFileSync(path, "utf8")).not.toMatch(/RESEND_API_KEY|VITE_RESEND|synthetic-resend-test-secret/);
        }
      }
    }
    inspect(root);
  });
});
