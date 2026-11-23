import { beforeEach, describe, expect, it, vi } from "vitest";
import { bootstrapApi } from "./api-bootstrap";
import { safeRestartRequested, SAFE_RESTART_FLAG } from "./safe-restart-policy";
import { safeRestartHandler, startSafeRestartServer } from "../safe-restart-server";

const listener = vi.hoisted(() => ({
  on: vi.fn(), once: vi.fn(), listen: vi.fn(),
}));
const createServer = vi.hoisted(() => vi.fn(() => listener));
vi.mock("node:http", async original => ({
  ...await original<typeof import("node:http")>(), createServer,
}));
const env = { NODE_ENV: "development", PORT: "8080" };
const guard = { status: () => ({
  installed: true as const, isolation: "in-process-not-os" as const, rejectedAttempts: 0,
}) };
const evidence = { bundleSha256: "a".repeat(64), normalBundleSha256: "b".repeat(64) };
function loaders() {
  return { normal: vi.fn(async () => undefined), safe: vi.fn(async () => undefined),
    terminal: vi.fn(async () => undefined), checked: vi.fn(async () => undefined) };
}
function response() {
  return { statusCode: 0, setHeader: vi.fn(), end: vi.fn() };
}
beforeEach(() => {
  vi.clearAllMocks();
  listener.listen.mockImplementation((_port, ready) => ready());
});

describe("Development Safe Restart startup gate", () => {
  it.each([
    env, { NODE_ENV: "production", REPLIT_DEPLOYMENT: "1" },
    { NODE_ENV: "development", EDUCORE_DEVELOPMENT_WORKERS_PAUSED: "true",
      EDUCORE_DEVELOPMENT_TELEGRAM_ENABLED: "true" },
  ])("keeps ordinary startup unchanged without an opt-in for %j", async ordinary => {
    const load = loaders(), install = vi.fn(() => guard);
    await bootstrapApi(ordinary, [], load, vi.fn(), install);
    expect(load.normal).toHaveBeenCalledOnce();
    expect(load.safe).not.toHaveBeenCalled(); expect(install).not.toHaveBeenCalled();
  });
  it("installs guards before the safe loader and never loads the normal graph or verifies a DB target", async () => {
    const order: string[] = [], load = loaders(), verify = vi.fn();
    const install = vi.fn(() => { order.push("guard"); return guard; });
    load.safe.mockImplementation(async () => { order.push("safe"); });
    await bootstrapApi(env, [SAFE_RESTART_FLAG], load, verify, install);
    expect(order).toEqual(["guard", "safe"]);
    expect(load.safe).toHaveBeenCalledWith(guard);
    for (const fn of [load.normal, load.terminal, load.checked, verify]) expect(fn).not.toHaveBeenCalled();
  });
  it.each([
    { NODE_ENV: "production" },
    { NODE_ENV: "production", REPLIT_DEPLOYMENT: "1" },
    { NODE_ENV: "development", REPLIT_DEPLOYMENT: "1" },
    { NODE_ENV: "development", REPLIT_DEPLOYMENT: "" },
    { NODE_ENV: "test" }, {},
  ])("rejects non-unpublished-Development context %j before loading or installing anything", async invalid => {
    const load = loaders(), install = vi.fn(() => guard);
    await expect(bootstrapApi(invalid, [SAFE_RESTART_FLAG], load, vi.fn(), install)).rejects.toThrow();
    for (const fn of [...Object.values(load), install]) expect(fn).not.toHaveBeenCalled();
  });
  it.each([
    [SAFE_RESTART_FLAG, SAFE_RESTART_FLAG], [`${SAFE_RESTART_FLAG}=false`],
    [`${SAFE_RESTART_FLAG}=true`], [`${SAFE_RESTART_FLAG}-typo`],
    ["--development-safe-restar"], ["--unknown-startup-option"],
    [SAFE_RESTART_FLAG, "--terminal-test"], [SAFE_RESTART_FLAG, "--terminal-test-check"],
  ])("refuses malformed/conflicting arguments %j without ordinary fallback", async (...args) => {
    const load = loaders();
    await expect(bootstrapApi(env, args, load)).rejects.toThrow();
    for (const fn of Object.values(load)) expect(fn).not.toHaveBeenCalled();
  });
  it("refuses a configured terminal mode even without its CLI flag", () => {
    expect(() => safeRestartRequested({ ...env, EDUCORE_TERMINAL_TEST_MODE: "isolated" },
      [SAFE_RESTART_FLAG])).toThrow();
  });
  it("does not load the app when guard installation fails", async () => {
    const load = loaders();
    await expect(bootstrapApi(env, [SAFE_RESTART_FLAG], load, vi.fn(), () => {
      throw new Error("fixture guard failure");
    })).rejects.toThrow("fixture guard failure");
    for (const fn of Object.values(load)) expect(fn).not.toHaveBeenCalled();
  });
  it("never falls back if the safe handler fails", async () => {
    const load = loaders();
    load.safe.mockRejectedValue(new Error("fixture listener failure"));
    await expect(bootstrapApi(env, [SAFE_RESTART_FLAG], load, vi.fn(), () => guard)).rejects.toThrow();
    expect(load.normal).not.toHaveBeenCalled();
  });
  it("requires a safe loader rather than ignoring the opt-in", async () => {
    const { safe: _safe, ...load } = loaders();
    await expect(bootstrapApi(env, [SAFE_RESTART_FLAG], load)).rejects.toThrow();
    expect(load.normal).not.toHaveBeenCalled();
  });
  it("starts no workers, transports, intervals, timeouts or queues in safe selection", async () => {
    const starts = Object.fromEntries(["Telegram", "Owner", "maintenance", "teacher intents",
      "reconciliation", "dispatch", "interval", "timeout", "queue claim", "startup verification",
      "Clerk", "storage", "Flutterwave", "SMS", "email", "push"].map(name => [name, vi.fn()]));
    const load = loaders();
    load.normal.mockImplementation(async () => { for (const start of Object.values(starts)) start(); });
    await bootstrapApi(env, [SAFE_RESTART_FLAG], load, vi.fn(), () => guard);
    for (const start of Object.values(starts)) expect(start).not.toHaveBeenCalled();
  });
});

describe("safe local diagnostic and operational request boundary (no sockets)", () => {
  it.each(["/api/healthz", "/api/safe-restart/status", "/api/healthz?ignored=1"])(
    "serves only local evidence for %s", url => {
      const res = response();
      safeRestartHandler(guard, evidence)({ method: "GET", url }, res);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.end.mock.calls[0][0])).toMatchObject({
        mode: "development-safe-restart", ...evidence, workers: "not-started",
        database: "not-connected", io: { installed: true, rejectedAttempts: 0 },
      });
      expect(res.setHeader).toHaveBeenCalledWith("Cache-Control", "no-store");
    });
  it.each([
    ["POST", "/api/finance/provider-webhooks"],
    ["POST", "/api/webhooks/flutterwave/staff-nfc"],
    ["POST", "/api/webhooks/flutterwave/student-subscription"],
    ["POST", "/api/webhooks/flutterwave/live/student-subscription"],
    ["POST", "/api/webhooks/flutterwave/hosted-manual"],
    ["POST", "/api/webhooks/flutterwave/direct-student"],
    ["POST", "/api/communication/provider-receipts"],
    ["GET", "/api/readyz"], ["GET", "/api/finance"],
    ["POST", "/api/healthz"], ["OPTIONS", "/api/healthz"],
    ["GET", "/__clerk"], ["POST", "/api/terminal/events"],
    ["DELETE", "/api/arbitrary-future-route"],
  ])("rejects %s %s before any route/provider code", (method, url) => {
    const res = response();
    safeRestartHandler(guard, evidence)({ method, url }, res);
    expect(res.statusCode).toBe(503);
    expect(JSON.parse(res.end.mock.calls[0][0])).toMatchObject({
      error: "DEVELOPMENT_SAFE_RESTART_ACTIVE", retryable: true,
    });
    expect(res.setHeader).toHaveBeenCalledWith("Retry-After", "60");
  });
  it("HEAD returns headers without a body", () => {
    const res = response();
    safeRestartHandler(guard, evidence)({ method: "HEAD", url: "/api/healthz" }, res);
    expect(res.statusCode).toBe(200); expect(res.end).toHaveBeenCalledWith(undefined);
  });
  it("starts the restricted listener using a fake server, with no application timers", async () => {
    const interval = vi.spyOn(globalThis, "setInterval"), timeout = vi.spyOn(globalThis, "setTimeout");
    try {
      await startSafeRestartServer(guard, evidence, env);
      expect(createServer).toHaveBeenCalledOnce(); expect(listener.listen).toHaveBeenCalledWith(8080, expect.any(Function));
      expect(interval).not.toHaveBeenCalled(); expect(timeout).not.toHaveBeenCalled();
      for (const event of ["upgrade", "connect"]) {
        const socket = { destroy: vi.fn() };
        listener.on.mock.calls.find(([name]) => name === event)![1]({}, socket);
        expect(socket.destroy).toHaveBeenCalledOnce();
      }
    } finally { interval.mockRestore(); timeout.mockRestore(); }
  });
  it.each(["", "0", "65536", "8080oops"])("rejects invalid port %s without listening", async PORT => {
    await expect(startSafeRestartServer(guard, evidence, { ...env, PORT })).rejects.toThrow();
    expect(createServer).not.toHaveBeenCalled();
  });
  it("rejects direct Production use before constructing a listener", async () => {
    await expect(startSafeRestartServer(guard, evidence, { ...env, NODE_ENV: "production" })).rejects.toThrow();
    expect(createServer).not.toHaveBeenCalled();
  });
  it("rejects missing bundle evidence", async () => {
    await expect(startSafeRestartServer(guard, { ...evidence, bundleSha256: "" }, env)).rejects.toThrow();
    expect(createServer).not.toHaveBeenCalled();
  });
});
