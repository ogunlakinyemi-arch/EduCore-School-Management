import { beforeAll, afterAll } from "vitest";

// Test HTTP servers are loopback only. Provider tests must inject mock transports;
// a missing mock must fail, never send a real charge, invitation or notification.
const originalFetch = globalThis.fetch;
// Remove inherited credentials before test modules are imported. Tests must
// supply their own synthetic credentials and must never inherit the app pool.
for (const key of Object.keys(process.env)) {
  if (/SECRET|TOKEN|PASSWORD|(?:^|_)API_KEY|(?:^|_)PUBLISHABLE_KEY|^FLUTTERWAVE|^EDUPULSE_SETUP_KEY$|^DATABASE_URL$|^PG(?:HOST|PORT|USER|DATABASE|PASSWORD)$/.test(key)) {
    delete process.env[key];
  }
}
process.env.DATABASE_URL = "postgresql://unused:unused@127.0.0.1:1/never_connect";
process.env.CLERK_SECRET_KEY = "sk_test_synthetic_unit_only";
process.env.SESSION_SECRET = "synthetic-unit-session-secret-not-for-runtime";
process.env.NODE_ENV = "test";
beforeAll(() => {
  globalThis.fetch = (async (input, init) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) {
      throw new Error("External network is disabled in API tests; inject a mock provider transport.");
    }
    return originalFetch(input, { ...init, redirect: init?.redirect ?? "error" });
  }) as typeof fetch;
});
afterAll(() => { globalThis.fetch = originalFetch; });
