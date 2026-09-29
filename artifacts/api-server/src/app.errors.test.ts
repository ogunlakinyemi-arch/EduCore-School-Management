import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { serializedLogs, providerToken } = vi.hoisted(() => ({
  serializedLogs: [] as string[],
  providerToken: "secret-provider-bearer-token",
}));

vi.mock("@clerk/express", () => ({
  clerkMiddleware:
    () =>
    (_req: any, _res: any, next: (error?: unknown) => void) =>
      next(),
}));

vi.mock("./routes", async () => {
  const express = (await import("express")).default;
  const router = express.Router();
  router.get("/test/unexpected-error", (_req, _res, next) => {
    next(new Error("sensitive internal failure"));
  });
  router.get("/test/provider-error", (_req, _res, next) => {
    const providerError = Object.assign(
      new Error(`Provider failed with Bearer ${providerToken}`),
      {
        code: "ECONNRESET",
        headers: {
          authorization: `Bearer ${providerToken}`,
          "x-provider-private": "private-header-value",
        },
      },
    );
    next(providerError);
  });
  return { default: router };
});

vi.mock("./routes/fee-provider-webhooks", async () => {
  const express = (await import("express")).default;
  return { default: express.Router() };
});

vi.mock("./lib/logger", async () => {
  const pino = (await import("pino")).default;
  return {
    logger: pino({ level: "trace" }, {
      write: (chunk: string) => serializedLogs.push(chunk),
    }),
  };
});

import app from "./app";

let server: ReturnType<typeof app.listen>;
let baseUrl: string;

beforeAll(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected a TCP server address");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe("safe API error responses", () => {
  it("maps malformed JSON to a safe 400 response", async () => {
    const malformedBody = '{"private":"request contents"';
    const response = await fetch(`${baseUrl}/api/test/unexpected-error`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: malformedBody,
    });
    const responseBody = await response.text();

    expect(response.status).toBe(400);
    expect(responseBody).toBe(JSON.stringify({ error: "Invalid request body" }));
    expect(responseBody).not.toContain("private");
    expect(responseBody).not.toContain("SyntaxError");
  });

  it("maps oversized JSON to a safe 413 response", async () => {
    const oversizedBody = JSON.stringify({ payload: "x".repeat(110 * 1024) });
    const response = await fetch(`${baseUrl}/api/test/unexpected-error`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: oversizedBody,
    });
    const responseBody = await response.text();

    expect(response.status).toBe(413);
    expect(responseBody).toBe(JSON.stringify({ error: "Request body too large" }));
    expect(responseBody).not.toContain("payload");
    expect(responseBody).not.toContain("entity.too.large");
  });

  it("keeps unexpected errors generic and does not expose their details", async () => {
    const response = await fetch(`${baseUrl}/api/test/unexpected-error`);
    const responseBody = await response.text();

    expect(response.status).toBe(500);
    expect(responseBody).toBe(JSON.stringify({ error: "Internal server error" }));
    expect(responseBody).not.toContain("sensitive internal failure");
    expect(responseBody).not.toContain("Error:");
  });

  it("logs only safe error fields for provider failures", async () => {
    serializedLogs.length = 0;

    const response = await fetch(`${baseUrl}/api/test/provider-error`);
    const responseBody = await response.text();
    const entries = serializedLogs.map((line) => JSON.parse(line));
    const errorLog = entries.find(
      (entry) => entry.msg === "Unhandled API error",
    );
    const logs = serializedLogs.join("");

    if (!errorLog) {
      throw new Error("Expected the central error log entry");
    }
    expect(response.status).toBe(500);
    expect(responseBody).toBe(JSON.stringify({ error: "Internal server error" }));
    expect(errorLog).toMatchObject({
      category: "unhandled_api_error",
      code: "ECONNRESET",
    });
    expect(errorLog.req.id).toBeTruthy();
    expect(errorLog).not.toHaveProperty("error");
    expect(errorLog).not.toHaveProperty("headers");
    expect(logs).not.toContain(providerToken);
    expect(logs).not.toContain("private-header-value");
    expect(logs).not.toContain("Provider failed");
  });
});