import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import express from "express";
import { DatabasePool } from "@workspace/db/driver";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  pool: null as unknown as InstanceType<typeof DatabasePool>,
  fault: null as null | "beforeCommit" | "afterCommit",
  connect: vi.fn(),
}));
vi.mock("@workspace/db", () => ({ pool: { connect: () => state.connect() } }));
import { studentSubscriptionLiveWebhookRouter } from "../routes/student-subscription-live-webhooks";
import { FlutterwaveLiveAdapter } from "../lib/fee-providers";

// Never inherit an application connection or provider credential. The suite setup
// also strips secrets and denies external HTTP; PostgreSQL uses a fresh Unix socket.
let directory: string;
let postgres: ChildProcess;
let server: ReturnType<express.Express["listen"]>;
let base: string;
let up: string;
let down: string;
const verifier = "fictional-live-inbox-verifier";
const payload = JSON.stringify({
  event: "charge.completed",
  data: { id: 123456, tx_ref: "SCV3_isolated_live_fixture", amount: 5000, currency: "NGN",
    status: "successful", customer: { email: "omit@fixture.invalid" },
    card: { token: "fictional-private-token" }, meta: { ignored: "fictional-private-metadata" } },
});
async function post(body = payload, hash: string | null = verifier) {
  return fetch(base, { method: "POST", headers: { "content-type": "application/json",
    ...(hash === null ? {} : { "verif-hash": hash }) }, body });
}
async function receipts() {
  return (await state.pool.query("SELECT * FROM flutterwave_live_webhook_receipts ORDER BY id")).rows;
}
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "educore-live-inbox-pg-"));
  const data = path.join(directory, "data");
  const env = { PATH: process.env.PATH, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" };
  execFileSync("initdb", ["-D", data, "-U", "live_inbox_test", "-A", "trust", "--no-locale"], { env, stdio: "ignore" });
  postgres = spawn("postgres", ["-D", data, "-k", directory, "-h", "", "-p", "5432"], { env, stdio: "ignore" });
  state.pool = new DatabasePool({ host: directory, port: 5432, database: "postgres", user: "live_inbox_test",
    max: 8, connectionTimeoutMillis: 1000 });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { await state.pool.query("SELECT 1"); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 30)); }
  }
  if (!ready) throw new Error("Disposable PostgreSQL unavailable; no application database fallback");
  up = await readFile(new URL("../../../../lib/db/dev-reconciliation/flutterwave-live-webhook-inbox.up.sql", import.meta.url), "utf8");
  down = await readFile(new URL("../../../../lib/db/dev-reconciliation/flutterwave-live-webhook-inbox.down.sql", import.meta.url), "utf8");
  await state.pool.query(up);
  // Retained independent evidence: the additive DDL/service must not need or
  // mutate existing payment tables. This is a sentinel, not a full legacy clone.
  await state.pool.query("CREATE TABLE sandbox_history_fixture (reference text PRIMARY KEY, amount_minor integer); INSERT INTO sandbox_history_fixture VALUES ('SCV2_retained_fixture',500000)");
  const app = express();
  app.use("/live", express.raw({ type: "application/json", limit: "64kb" }), studentSubscriptionLiveWebhookRouter);
  await new Promise<void>(resolve => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Isolated listener unavailable");
  base = `http://127.0.0.1:${address.port}/live`;
}, 20000);

beforeEach(async () => {
  await state.pool.query("TRUNCATE flutterwave_live_webhook_receipts RESTART IDENTITY");
  state.fault = null;
  state.connect.mockReset().mockImplementation(async () => {
    const client = await state.pool.connect();
    return {
      query: async (sql: string, values?: unknown[]) => {
        if (sql === "COMMIT" && state.fault) {
          const fault = state.fault;
          state.fault = null;
          if (fault === "afterCommit") await client.query("COMMIT");
          throw new Error("Synthetic unavailable commit outcome");
        }
        return client.query(sql, values);
      },
      release: () => client.release(),
    };
  });
  for (const [key, value] of Object.entries({
    NODE_ENV: "production", EDUCORE_FLUTTERWAVE_MODE: "LIVE", EDUCORE_FLUTTERWAVE_LIVE_ENABLED: "true",
    EDUCORE_FLUTTERWAVE_WEBHOOK_ENVIRONMENT: "LIVE",
    FLUTTERWAVE_LIVE_SECRET_KEY: "FLWSECK-fictional-isolated-live-key",
    FLUTTERWAVE_WEBHOOK_VERIF_HASH: verifier,
    FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH: "fictional-separate-test-verifier",
  })) vi.stubEnv(key, value);
});
afterEach(async () => {
  expect((await state.pool.query("SELECT * FROM sandbox_history_fixture")).rows)
    .toEqual([{ reference: "SCV2_retained_fixture", amount_minor: 500000 }]);
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await state.pool?.end();
  if (postgres?.exitCode === null) await new Promise<void>(resolve => {
    postgres.once("exit", () => resolve()); postgres.kill("SIGTERM");
  });
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("isolated LIVE receipt DDL and real HTTP handler (financial processing disabled)", () => {
  it("persists authenticated bounded claims before reporting receiptRecorded, but never returns 200", async () => {
    const verify = vi.spyOn(FlutterwaveLiveAdapter.prototype, "verifyPayment");
    const handle = vi.spyOn(FlutterwaveLiveAdapter.prototype, "handleWebhook");
    const response = await post();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ processed: false, receiptRecorded: true });
    const [row] = await receipts();
    expect(row).toMatchObject({ provider: "FLUTTERWAVE", environment: "LIVE", signature_verified: true,
      processing_status: "BLOCKED_PENDING_REVIEW", delivery_count: 1,
      claims: { event: "charge.completed", reference: "SCV3_isolated_live_fixture",
        transactionId: "123456", status: "successful", amount: "5000", currency: "NGN" } });
    expect(row.payload_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(row)).not.toMatch(/omit@|private-token|private-metadata/);
    expect(verify).not.toHaveBeenCalled();
    expect(handle).not.toHaveBeenCalled();
  });
  it("deduplicates concurrent byte-identical deliveries in the LIVE namespace", async () => {
    const responses = await Promise.all(Array.from({ length: 8 }, () => post()));
    expect(responses.every(response => response.status === 503)).toBe(true);
    const rows = await receipts();
    expect(rows).toHaveLength(1);
    expect(rows[0].delivery_count).toBe(8);
  });
  it("does not conflate changed payloads or claim semantic/financial idempotency", async () => {
    await post();
    await post(payload.replace('"amount":5000', '"amount":1'));
    expect(await receipts()).toHaveLength(2);
  });
  it("rejects missing, wrong and TEST authentication without acquiring a database connection", async () => {
    for (const hash of [null, "", "wrong-verifier", "fictional-separate-test-verifier"]) {
      expect((await post(payload, hash)).status).toBe(401);
    }
    expect(state.connect).not.toHaveBeenCalled();
    expect(await receipts()).toHaveLength(0);
  });
  it("disabled flags, Development runtime and TEST-bound scope cannot persist a receipt", async () => {
    vi.stubEnv("EDUCORE_FLUTTERWAVE_LIVE_ENABLED", "");
    expect((await post()).status).toBe(503);
    vi.stubEnv("EDUCORE_FLUTTERWAVE_LIVE_ENABLED", "true");
    vi.stubEnv("NODE_ENV", "development");
    expect((await post()).status).toBe(503);
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EDUCORE_FLUTTERWAVE_WEBHOOK_ENVIRONMENT", "TEST");
    expect((await post()).status).toBe(503);
    expect(state.connect).not.toHaveBeenCalled();
  });
  it("rolls back a failed commit and records exactly one receipt on redelivery", async () => {
    state.fault = "beforeCommit";
    const response = await post();
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("receiptRecorded");
    expect(await receipts()).toHaveLength(0);
    expect((await post()).status).toBe(503);
    const [row] = await receipts();
    expect(row.delivery_count).toBe(1);
  });
  it("refuses acceptance on a lost COMMIT response and safely deduplicates the next delivery", async () => {
    state.fault = "afterCommit";
    const response = await post();
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("receiptRecorded");
    expect(await receipts()).toHaveLength(1);
    await post();
    const rows = await receipts();
    expect(rows).toHaveLength(1);
    expect(rows[0].delivery_count).toBe(2);
  });
  it("missing review-only schema returns 503 without leaking database details; retry works after isolated apply", async () => {
    await state.pool.query(down);
    const response = await post();
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toMatch(/relation|flutterwave_live_webhook_receipts|postgres/);
    await state.pool.query(up);
    expect((await post()).status).toBe(503);
    expect(await receipts()).toHaveLength(1);
  });
  it("adverse/refund then successful redelivery stays blocked and cannot clear a financial hold", async () => {
    for (const body of [
      JSON.stringify({ TransactionId: 123456, FlwRef: "fictional-ref", AmountRefunded: "100.01", status: "completed" }),
      JSON.stringify({ event: "charge.completed", data: { id: 123456, tx_ref: "SCV3_isolated_live_fixture", status: "reversed" } }),
      payload, payload,
    ]) {
      const response = await post(body);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ processed: false });
    }
    const rows = await receipts();
    expect(rows).toHaveLength(3);
    expect(rows.every(row => row.processing_status === "BLOCKED_PENDING_REVIEW")).toBe(true);
    expect(rows.some(row => row.claims.amount === "100.01")).toBe(true);
    // No payment tables even exist here: the handler cannot finalize/refund/hold money.
  });
  it("unknown reference, wrong amount/currency and malformed JSON remain only unverified receipts", async () => {
    for (const body of [
      JSON.stringify({ event: "charge.completed", data: { id: 999, tx_ref: "unknown_reference", amount: 1, currency: "USD", status: "successful" } }),
      "{malformed-json",
    ]) {
      const response = await post(body);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ processed: false });
    }
    expect(await receipts()).toHaveLength(2);
  });
  it("database rejects SANDBOX, unverified signatures and any processed/paid state", async () => {
    await post();
    for (const update of [
      "environment='SANDBOX'", "provider='OTHER'", "signature_verified=false",
      "processing_status='PROCESSED'", "processing_status='PAID'",
    ]) await expect(state.pool.query(`UPDATE flutterwave_live_webhook_receipts SET ${update}`)).rejects.toThrow();
    expect((await receipts())[0].processing_status).toBe("BLOCKED_PENDING_REVIEW");
  });
  it("empty rollback/reapply is reversible but rollback with retained evidence is refused", async () => {
    await state.pool.query(down);
    await state.pool.query(up);
    await post();
    const client = await state.pool.connect();
    try {
      await expect(client.query(down)).rejects.toThrow("preservation plan");
      await client.query("ROLLBACK");
    } finally { client.release(); }
    expect(await receipts()).toHaveLength(1);
  });
});
