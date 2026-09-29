import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import app from "./app";

const TRUSTED_ORIGINS_ENV = "CORS_ALLOWED_ORIGINS";
const trustedOrigin = "https://trusted.example.test";
const deniedOrigin = "https://untrusted.example.test";

let server: ReturnType<typeof app.listen>;
let baseUrl: string;

beforeAll(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function preflight(origin: string) {
  return fetch(`${baseUrl}/api/healthz`, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "GET",
    },
  });
}

describe("production CORS policy", () => {
  it("allows a configured origin on preflight and includes credentials", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(TRUSTED_ORIGINS_ENV, ` ${trustedOrigin}, https://another.example.test `);

    const response = await preflight(trustedOrigin);

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(trustedOrigin);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("does not grant CORS access to an unconfigured preflight origin", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(TRUSTED_ORIGINS_ENV, trustedOrigin);

    const response = await preflight(deniedOrigin);

    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("fails closed for cross-origin preflight when the allowlist is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(TRUSTED_ORIGINS_ENV, undefined);

    const response = await preflight(trustedOrigin);

    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("allows requests without an Origin header", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(TRUSTED_ORIGINS_ENV, "");

    const response = await fetch(`${baseUrl}/api/healthz`);

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
});