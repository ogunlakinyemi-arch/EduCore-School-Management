import { IncomingMessage, ServerResponse } from "node:http";
import { PassThrough } from "node:stream";
import { Socket } from "node:net";
import { createHmac } from "node:crypto";
import type { Express } from "express";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
  database: vi.fn(() => { throw new Error("Database access forbidden in offline app tests"); }),
  provider: vi.fn(() => { throw new Error("Provider access forbidden in offline app tests"); }),
  identity: vi.fn(() => { throw new Error("Identity provider access forbidden in offline app tests"); }),
  signature: vi.fn(), webhook: vi.fn(), factory: vi.fn(), clerk: vi.fn(), network: vi.fn(),
}));
vi.mock("@workspace/db", async () => ({
  ...await import("../../../lib/db/src/schema/index"),
  pool: { query: f.database, connect: f.database },
  db: { query: {}, select: f.database, insert: f.database, update: f.database, delete: f.database, transaction: f.database },
  DatabaseClient: f.database, DatabasePool: f.database,
}));
vi.mock("@clerk/express", () => ({
  clerkClient: { users: { getUser: f.identity }, invitations: { createInvitation: f.identity } },
  getAuth: () => ({ userId: null }),
  clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => { f.clerk(); next(); },
}));
vi.mock("./middlewares/clerkProxyMiddleware", () => ({
  CLERK_PROXY_PATH: "/__clerk", getClerkProxyHost: () => null,
  clerkProxyMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("pino-http", () => ({
  default: () => (req: any, _res: unknown, next: () => void) => {
    req.log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }; next();
  },
}));
vi.mock("./lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), child: () => ({}) } }));
vi.mock("./services/subscription-request-access", () => ({ enforceRequestSubscription: vi.fn() }));
vi.mock("./middlewares/auth", async original => {
  const actual = await original<typeof import("./middlewares/auth")>();
  return { ...actual, requireAuthentication: () => (req: any, _res: unknown, next: (e?: unknown) => void) => {
    const role = req.headers["x-offline-role"];
    if (!role) return next(new actual.AuthError(401, "Offline authentication required"));
    req.edupulseUser = { user: { id: 1, status: "ACTIVE" }, roles: [{
      id: 1, role, status: "ACTIVE", schoolId: role === "PLATFORM_OWNER" ? null : 1496,
    }] };
    next();
  } };
});
vi.mock("./lib/fee-providers/factory", () => ({
  configuredTestAdapter: (...args: unknown[]) => { f.factory(...args); return { handleWebhook: f.webhook }; },
  configuredStudentNfcTestAdapter: (...args: unknown[]) => { f.factory(...args); return { provider: "flutterwave", handleWebhook: f.webhook }; },
  configuredFlutterwaveTestAdapter: f.provider,
}));
vi.mock("./services/flutterwave-split-provider", async original => ({
  ...await original<typeof import("./services/flutterwave-split-provider")>(), splitProvider: f.provider,
}));
// Staff raw-webhook routing and signature gate remain REAL; only adapter/config
// dependencies are isolated. No valid signature reaches accounting/dispatch.
vi.mock("./routes/staff-nfc-billing-service", async original => {
  const actual = await original<typeof import("./routes/staff-nfc-billing-service")>();
  return { ...actual,
    makeStaffNfcProviderAdapter: f.factory,
    staffNfcWebhookSigningSecret: () => "offline-synthetic-signing-secret",
    verifyFlutterwaveStaffWebhookSignature: (...args: Parameters<typeof actual.verifyFlutterwaveStaffWebhookSignature>) => {
      f.signature(...args); return actual.verifyFlutterwaveStaffWebhookSignature(...args);
    },
  };
});

import { PaymentProviderError } from "./lib/fee-providers";
let app: Express;
let socketConnect: ReturnType<typeof vi.spyOn>;
beforeAll(async () => {
  vi.stubGlobal("fetch", vi.fn(() => { f.network(); throw new Error("All fetch access forbidden during app import"); }));
  socketConnect = vi.spyOn(Socket.prototype, "connect").mockImplementation((() => {
    f.network(); throw new Error("All socket connections forbidden in offline app tests");
  }) as any);
  app = (await import("./app")).default;
  for (const spy of [f.database, f.provider, f.identity, f.network]) expect(spy).not.toHaveBeenCalled();
});
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("REPLIT_DEPLOYMENT", "");
  vi.stubGlobal("fetch", vi.fn(() => { f.network(); throw new Error("All fetch access forbidden"); }));
  for (const spy of Object.values(f)) spy.mockClear();
  f.factory.mockReturnValue({});
  f.webhook.mockImplementation(async () => { throw new PaymentProviderError("Offline invalid signature control"); });
});
afterEach(() => {
  // These assertions apply to EVERY request, including ordinary controls.
  expect(f.database).not.toHaveBeenCalled();
  expect(f.provider).not.toHaveBeenCalled();
  expect(f.identity).not.toHaveBeenCalled();
  expect(f.network).not.toHaveBeenCalled();
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
});
afterAll(() => socketConnect?.mockRestore());

/** Run the actual Express app in memory. No listener, HTTP client or socket I/O. */
function inject(path: string, {
  method = "POST", body = "", role = "PLATFORM_OWNER", type = "application/json", headers = {},
}: { method?: string; body?: string; role?: string; type?: string; headers?: Record<string, string> } = {}) {
  return new Promise<{ status: number; data: any; headers: Record<string, unknown> }>((resolve, reject) => {
    const req = new IncomingMessage(new PassThrough() as any);
    req.url = path; req.method = method;
    req.headers = { "content-type": type, "content-length": String(Buffer.byteLength(body)), ...(role ? { "x-offline-role": role } : {}), ...headers };
    const res = new ServerResponse(req);
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => reject(new Error(`In-memory app did not finish: ${path}`)), 2000);
    res.write = ((chunk: any) => { chunks.push(Buffer.from(chunk)); return true; }) as any;
    res.end = ((chunk?: any) => {
      clearTimeout(timer);
      if (chunk) chunks.push(Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString("utf8");
      let data: unknown = text;
      try { data = JSON.parse(text); } catch { /* non-JSON control responses */ }
      resolve({ status: res.statusCode, data, headers: res.getHeaders() }); return res;
    }) as any;
    app(req as any, res as any, error => {
      if (error) { clearTimeout(timer); reject(error); } else { res.statusCode = 404; res.end(); }
    });
    req.push(body ? Buffer.from(body) : null);
    if (body) req.push(null);
  });
}
const input = { mode: "LOCAL_SPLIT_SIMULATION", exampleSchoolId: 1496, action: "PREVIEW", acknowledgeFictional: false };
const local = "/api/flutterwave/local-split-simulation";
const webhookPaths = [
  "/api/finance/provider-webhooks/flutterwave",
  "/api/webhooks/flutterwave/staff-nfc",
  "/api/webhooks/flutterwave/student-subscription",
];

describe("Actual app + route registry: offline simulation isolation", () => {
  it.each(["PREVIEW", "REVIEW", "ENABLE", "DISABLE", "RESET"])("handles %s without persistence, dispatch or readiness", async action => {
    const r = await inject(local, { body: JSON.stringify({ ...input, action, acknowledgeFictional: true }) });
    expect(r.status).toBe(200); expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.data.label).toBe("TEST / NOT REAL");
    expect(r.data.recipientState).toBe("LOCAL_ONLY_UNVERIFIED");
    for (const key of ["testReady", "operationalEnabled", "providerVerified", "ownershipVerified", "checkoutAllowed", "webhooksAllowed", "allocationProven", "bankSettlementVerified"]) expect(r.data[key]).toBe(false);
    expect([r.data.simulationTotalMinor, r.data.simulationSchoolMinor, r.data.simulationPlatformGrossMinor]).toEqual([500000, 200000, 300000]);
    expect(f.factory).not.toHaveBeenCalled(); expect(f.webhook).not.toHaveBeenCalled();
  });
  it("resets an enabled simulation on a fresh GET", async () => {
    expect((await inject(local, { body: JSON.stringify({ ...input, action: "ENABLE", acknowledgeFictional: true }) })).data.simulatedEnabled).toBe(true);
    expect((await inject(local, { method: "GET" })).data.simulatedEnabled).toBe(false);
  });
  it.each([{ action: "TEST_READY" }, { testReady: true }, { operationalEnabled: true }, { enabled: true }])("rejects promotion/operational input %j", async extra => {
    expect((await inject(local, { body: JSON.stringify({ ...input, ...extra }) })).status).toBe(400);
  });
  it.each(["", "SCHOOL_ADMIN", "PARTNER"])("does not authorize role %s", async role => {
    expect((await inject(local, { method: "GET", role })).status).toBe(role ? 403 : 401);
  });
  it.each(["production", "test"])("hides simulation for synthetic NODE_ENV=%s without accessing any environment", async env => {
    vi.stubEnv("NODE_ENV", env);
    expect((await inject(local, { method: "GET" })).status).toBe(404);
  });
  it("hides simulation when a synthetic deployment flag is present", async () => {
    vi.stubEnv("REPLIT_DEPLOYMENT", "1");
    expect((await inject(local, { method: "GET" })).status).toBe(404);
  });
  it.each([
    "/api/flutterwave/split-recipients",
    "/api/flutterwave/split-recipients/123/review",
    "/api/flutterwave/split-schools/1496/configuration",
    "/api/subscriptions/123/checkout",
    "/api/flutterwave/split-payments/123/refunds",
  ])("rejects marked input before any operational handler: %s", async path => {
    expect((await inject(path, { method: path.endsWith("configuration") ? "PATCH" : "POST",
      body: JSON.stringify({ mode: input.mode, enabled: true, status: "TEST_READY" }) })).status).toBe(400);
    expect(f.factory).not.toHaveBeenCalled(); expect(f.webhook).not.toHaveBeenCalled();
  });
  it("does not exempt a neighbouring simulation-prefixed path", async () => {
    expect((await inject(`${local}-operational`, { body: JSON.stringify(input) })).status).toBe(400);
  });
  it("keeps the ordinary non-simulation health route functional", async () => {
    expect((await inject("/api/healthz", { method: "GET" })).data).toEqual({ status: "ok" });
  });
  it("rejects malformed JSON through the actual parser", async () => {
    expect((await inject(local, { body: "{" })).data).toEqual({ error: "Invalid request body" });
  });
});
describe("Actual raw payment-webhook mounts: no webhook is sent or dispatched", () => {
  it.each(webhookPaths.flatMap(path => [
    [path, '{"mode":"LOCAL_SPLIT_SIMULATION"}'],
    [path, '{"data":{"label":"TEST / NOT REAL"}}'],
    [path, '{"mode":"\\u004cOCAL_SPLIT_SIMULATION"}'],
  ]))("rejects simulation bytes before provider/signature processing at %s (%s)", async (path, body) => {
    const r = await inject(path, { body, role: "" });
    expect(r.status).toBe(400); expect(r.data.error).toContain("TEST / NOT REAL");
    expect(f.clerk).not.toHaveBeenCalled();
    expect(f.factory).not.toHaveBeenCalled(); expect(f.webhook).not.toHaveBeenCalled(); expect(f.signature).not.toHaveBeenCalled();
  });
  it.each(webhookPaths)("passes ordinary raw bytes unchanged to the signature gate at %s", async path => {
    const body = ' { "event": "charge.completed", "data": { "id": 123, "tx_ref": "ordinary-offline-reference" } }\n';
    const r = await inject(path, { body, role: "" });
    expect(r.status).toBe(401);
    expect(f.clerk).not.toHaveBeenCalled();
    const raw = path.includes("staff-nfc") ? f.signature.mock.calls[0]?.[0] : f.webhook.mock.calls[0]?.[0]?.rawBody;
    expect(Buffer.isBuffer(raw)).toBe(true); expect(raw.equals(Buffer.from(body))).toBe(true);
  });
  it.each(webhookPaths)("preserves the raw 64KiB limit at %s", async path => {
    expect((await inject(path, { body: JSON.stringify({ padding: "x".repeat(65536) }) })).status).toBe(413);
    expect(f.factory).not.toHaveBeenCalled(); expect(f.webhook).not.toHaveBeenCalled();
  });
  it("keeps a genuine synthetic-HMAC ordinary control valid without dispatch/accounting", async () => {
    const body = '{"event":"ordinary.control","data":{}}';
    const signature = createHmac("sha256", "offline-synthetic-signing-secret").update(body).digest("base64");
    expect((await inject(webhookPaths[1], { body, role: "", headers: { "flutterwave-signature": signature } })).status).toBe(202);
    expect(f.signature).toHaveBeenCalledOnce();
  });
  it("rejects tampered bytes using the real HMAC verifier", async () => {
    const body = '{"event":"ordinary.control","data":{}}';
    const signature = createHmac("sha256", "offline-synthetic-signing-secret").update(body).digest("base64");
    expect((await inject(webhookPaths[1], { body: `${body} `, role: "", headers: { "flutterwave-signature": signature } })).status).toBe(401);
  });
  it("rejects a simulation marker even with a matching synthetic signature", async () => {
    const body = '{"event":"ordinary.control","mode":"LOCAL_SPLIT_SIMULATION"}';
    const signature = createHmac("sha256", "offline-synthetic-signing-secret").update(body).digest("base64");
    expect((await inject(webhookPaths[1], { body, role: "", headers: { "flutterwave-signature": signature } })).status).toBe(400);
    expect(f.signature).not.toHaveBeenCalled(); expect(f.factory).not.toHaveBeenCalled();
  });
});
