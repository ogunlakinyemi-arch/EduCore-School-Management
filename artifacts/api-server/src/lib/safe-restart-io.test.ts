import { describe, expect, it, vi } from "vitest";
import { applySafeRestartIoGuards, SafeRestartIoError } from "./safe-restart-io";

describe("fail-closed in-process I/O boundaries with fake transports only", () => {
  it.each([
    "Telegram getMe", "Telegram getWebhookInfo", "Telegram getUpdates", "Telegram sendMessage",
    "BulkSMSNigeria SMS", "Termii SMS", "Resend email", "HTTP email",
    "web push", "Flutterwave initialization", "Flutterwave verification", "Flutterwave refund",
    "Flutterwave transfer", "Paystack", "Clerk authentication", "Clerk invitation",
    "object storage", "storage signing sidecar", "callback-triggered verification",
  ])("rejects %s before the fake network transport is invoked", async name => {
    const original = vi.fn(async () => ({ accepted: true }));
    const api = { send: original };
    const guard = applySafeRestartIoGuards([{ name, target: api, key: "send", asynchronous: true }]);
    await expect(api.send()).rejects.toMatchObject({ code: "DEVELOPMENT_SAFE_RESTART_IO_BLOCKED" });
    expect(original).not.toHaveBeenCalled();
    expect(guard.status()).toEqual({ installed: true, isolation: "in-process-not-os", rejectedAttempts: 1 });
  });
  it.each(["http.request", "https.request", "http2.connect", "net.connect", "socket.connect",
    "tls.connect", "datagram.send", "dns.lookup", "dns.Resolver", "worker_threads.Worker",
    "child_process.spawn", "application interval"])("rejects synchronous %s without invoking it", name => {
    const original = vi.fn(), api = { call: original };
    applySafeRestartIoGuards([{ name, target: api, key: "call" }]);
    expect(() => api.call()).toThrow(SafeRestartIoError);
    expect(original).not.toHaveBeenCalled();
  });
  it("blocks constructor-based calls too and records the attempt", () => {
    const original = vi.fn(), api = { Worker: original };
    const guard = applySafeRestartIoGuards([{ name: "Worker", target: api, key: "Worker" }]);
    expect(() => new api.Worker()).toThrow(SafeRestartIoError);
    expect(original).not.toHaveBeenCalled(); expect(guard.status().rejectedAttempts).toBe(1);
  });
  it("cannot silently replace an installed deny boundary", () => {
    const api = { send: vi.fn() };
    applySafeRestartIoGuards([{ name: "send", target: api, key: "send" }]);
    expect(() => Object.defineProperty(api, "send", { value: vi.fn() })).toThrow();
  });
  it("preflights every boundary rather than partially installing an incomplete guard", () => {
    const original = vi.fn(), api = { send: original };
    expect(() => applySafeRestartIoGuards([
      { name: "present", target: api, key: "send" },
      { name: "missing", target: {}, key: "send" },
    ])).toThrow("Cannot install");
    expect(api.send).toBe(original);
  });
  it("refuses a non-writable transport boundary", () => {
    const api = Object.freeze({ send: vi.fn() });
    expect(() => applySafeRestartIoGuards([{ name: "frozen", target: api, key: "send" }])).toThrow();
  });
  it("does not disclose arguments, addresses or credentials in rejection messages", async () => {
    const api = { send: vi.fn<(secret: string) => Promise<void>>() };
    applySafeRestartIoGuards([{ name: "fetch", target: api, key: "send", asynchronous: true }]);
    await expect(api.send("fictional-private-argument")).rejects.toThrow(
      "External I/O is disabled in Development Safe Restart Mode");
  });
});
