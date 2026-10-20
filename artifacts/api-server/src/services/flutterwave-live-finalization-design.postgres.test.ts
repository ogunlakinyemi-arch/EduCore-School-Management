import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { DatabasePool } from "@workspace/db/driver";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { finalizeLiveSubscriptionDesign } from "./flutterwave-live-finalization-design";
import { persistAuthenticatedLiveWebhookReceipt } from "./flutterwave-live-webhook-inbox";
import { blockedLiveCollectionVerifier, type LiveCollectionEvidence, type LiveCollectionVerifier } from "../lib/flutterwave-live-verification";

// Only fictional independent evidence and a fresh Unix-socket database. No app
// pool, runtime routes, provider adapters, inherited credentials or network calls.
let directory: string, postgres: ChildProcess, pool: InstanceType<typeof DatabasePool>, up: string, down: string;
const merchant = "merchant_fixture_live";
const reference = "SCV3_live_design_fixture";
const school = "RS_FictionalSchool123";
function body(data: Record<string, unknown> = {}) {
  return Buffer.from(JSON.stringify({ event: "charge.completed", data: {
    id: 123456, tx_ref: reference, amount: 5000, currency: "NGN", status: "successful", ...data,
  } }));
}
function verifier(changes: Partial<LiveCollectionEvidence> = {}, scope = merchant): LiveCollectionVerifier {
  return { enabled: true, environment: "LIVE", merchantScope: scope,
    verify: vi.fn(async input => ({
      environment: "LIVE", merchantScope: scope, reference: input.reference, transactionId: input.transactionId,
      providerReference: `FLW-fixture-${input.transactionId}`, status: "succeeded", currency: "NGN",
      amountMinor: 500000, chargedAmountMinor: 500000, providerFeeMinor: 6500, additionalFeeMinor: 500,
      recipientEvidence: "TRANSACTION_BOUND",
      recipients: [{ subaccountId: school, currency: "NGN", amountMinor: 190000 }], ...changes,
    })),
  };
}
async function intent(partner: number | null = 1, ref = reference, student = 1, scope = merchant) {
  await pool.query(`INSERT INTO flutterwave_live_subscription_intents
    (merchant_scope,reference,school_id,student_id,session_id,term_id,term_end_date,
     school_subaccount_id,partner_profile_id,partner_accrual_minor)
    VALUES ($1,$2,10,$3,1,1,'2026-12-31',$4,$5,$6)`,
    [scope, ref, student, school, partner, partner === null ? 0 : 10000]);
}
async function receipt(raw: Buffer) {
  // Authentication is covered by the actual HTTP inbox suite. This fixture calls
  // the ONLY-after-auth persistence boundary directly with synthetic bytes.
  await persistAuthenticatedLiveWebhookReceipt(pool, raw);
  return Number((await pool.query("SELECT id FROM flutterwave_live_webhook_receipts WHERE payload_sha256=$1",
    [createHash("sha256").update(raw).digest("hex")])).rows[0].id);
}
async function run(raw = body(), proof = verifier(), target: Parameters<typeof finalizeLiveSubscriptionDesign>[0] = pool) {
  return finalizeLiveSubscriptionDesign(target, await receipt(raw), raw, proof);
}
async function rows(table: string) {
  // Table names below are fixed test literals, not request input.
  return (await pool.query(`SELECT * FROM ${table}`)).rows;
}
async function counts() {
  return Promise.all(["flutterwave_live_collection_evidence", "flutterwave_live_finalization_events",
    "flutterwave_live_partner_accruals", "flutterwave_live_receipt_results"].map(async table => (await rows(table)).length));
}
function faultyPool(when: "before" | "after"): Parameters<typeof finalizeLiveSubscriptionDesign>[0] {
  return { connect: async () => {
    const client = await pool.connect();
    return { release: () => client.release(), query: async (sql, values) => {
      if (sql === "COMMIT") {
        if (when === "after") await client.query("COMMIT");
        throw new Error("Synthetic uncertain commit");
      }
      return client.query(sql, values);
    } };
  } };
}
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "educore-live-finalization-pg-"));
  const data = path.join(directory, "data");
  const env = { PATH: process.env.PATH, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" };
  execFileSync("initdb", ["-D", data, "-U", "live_design_test", "-A", "trust", "--no-locale"], { env, stdio: "ignore" });
  postgres = spawn("postgres", ["-D", data, "-k", directory, "-h", "", "-p", "5432"], { env, stdio: "ignore" });
  pool = new DatabasePool({ host: directory, port: 5432, database: "postgres", user: "live_design_test",
    connectionTimeoutMillis: 1000, max: 8 });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { await pool.query("SELECT 1"); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 30)); }
  }
  if (!ready) throw new Error("Disposable PostgreSQL unavailable; no application DB fallback");
  const inbox = await readFile(new URL("../../../../lib/db/dev-reconciliation/flutterwave-live-webhook-inbox.up.sql", import.meta.url), "utf8");
  up = await readFile(new URL("../../../../lib/db/dev-reconciliation/flutterwave-live-finalization.up.sql", import.meta.url), "utf8");
  down = await readFile(new URL("../../../../lib/db/dev-reconciliation/flutterwave-live-finalization.down.sql", import.meta.url), "utf8");
  await pool.query(inbox); await pool.query(up);
  await pool.query("CREATE TABLE sandbox_history_fixture(reference text PRIMARY KEY, transaction_id text, gross_minor integer); INSERT INTO sandbox_history_fixture VALUES ('SCV2_historical_fixture','123456',500000)");
}, 20000);
beforeEach(async () => {
  await pool.query("TRUNCATE flutterwave_live_subscription_intents, flutterwave_live_webhook_receipts RESTART IDENTITY CASCADE");
  await intent();
});
afterEach(async () => {
  expect(await rows("sandbox_history_fixture")).toEqual([
    { reference: "SCV2_historical_fixture", transaction_id: "123456", gross_minor: 500000 },
  ]);
  vi.restoreAllMocks(); vi.unstubAllEnvs();
});
afterAll(async () => {
  await pool?.end();
  if (postgres?.exitCode === null) await new Promise<void>(resolve => {
    postgres.once("exit", () => resolve()); postgres.kill("SIGTERM");
  });
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("offline LIVE-only finalization design, real draft DDL and transactions", () => {
  it("default verification and SANDBOX boundaries refuse before any database access, regardless of flags", async () => {
    const connect = vi.fn();
    vi.stubEnv("EDUCORE_FLUTTERWAVE_LIVE_ENABLED", "true");
    await expect(finalizeLiveSubscriptionDesign({ connect }, 1, body())).rejects.toMatchObject({ code: "LIVE_VERIFICATION_TRANSPORT_DISABLED" });
    await expect(finalizeLiveSubscriptionDesign({ connect }, 1, body(), { ...verifier(), environment: "SANDBOX" }))
      .rejects.toMatchObject({ code: "LIVE_VERIFICATION_TRANSPORT_DISABLED" });
    await expect(blockedLiveCollectionVerifier.verify({ reference, transactionId: "123456", currency: "NGN",
      amountMinor: 500000, schoolSubaccountId: school, signal: new AbortController().signal }))
      .rejects.toMatchObject({ code: "LIVE_VERIFICATION_TRANSPORT_DISABLED" });
    expect(connect).not.toHaveBeenCalled();
  });
  it.each([true, false])("records fixed school/merchant amounts and internal-only eligible Partner %s", async partner => {
    if (!partner) { await pool.query("TRUNCATE flutterwave_live_subscription_intents CASCADE"); await intent(null); }
    expect(await run()).toMatchObject({ outcome: "COLLECTION_VERIFIED", duplicate: false, operationallyProcessed: false });
    const [collection] = await rows("flutterwave_live_collection_evidence");
    expect(collection).toMatchObject({ environment: "LIVE", gross_minor: 500000, currency: "NGN",
      school_minor: 190000, merchant_gross_minor: 310000, provider_fee_minor: 6500, additional_fee_minor: 500,
      calculated_merchant_remainder_minor: 303000, calculated_owner_net_minor: partner ? 293000 : 303000,
      partner_accrual_minor: partner ? 10000 : 0 });
    const accruals = await rows("flutterwave_live_partner_accruals");
    expect(accruals).toHaveLength(partner ? 1 : 0);
    if (partner) expect(accruals[0]).toMatchObject({ amount_minor: 10000, state: "ACCRUED" });
  });
  it("concurrent duplicate receipt and re-encoded deliveries create one collection/event/accrual", async () => {
    const raw = body(), id = await receipt(raw);
    const outcomes = await Promise.all(Array.from({ length: 6 }, () => finalizeLiveSubscriptionDesign(pool, id, raw, verifier())));
    expect(outcomes.filter(outcome => !outcome.duplicate)).toHaveLength(1);
    await run(Buffer.from(JSON.stringify(JSON.parse(raw.toString()), null, 2)));
    expect(await counts()).toEqual([1, 1, 1, 2]);
  });
  it("never treats inbox metadata as a substitute for original authenticated bytes", async () => {
    const id = await receipt(body());
    const proof = verifier();
    await expect(finalizeLiveSubscriptionDesign(pool, id, Buffer.from(`${body().toString()} `), proof))
      .rejects.toMatchObject({ code: "LIVE_AUTHENTICATED_RECEIPT_MISMATCH" });
    await expect(finalizeLiveSubscriptionDesign(pool, 99999, body(), proof))
      .rejects.toMatchObject({ code: "LIVE_AUTHENTICATED_RECEIPT_MISMATCH" });
    expect(proof.verify).not.toHaveBeenCalled();
    expect(await counts()).toEqual([0, 0, 0, 0]);
  });
  it("rejects every mismatched independent proof before any financial design write", async () => {
    const mismatches: Partial<LiveCollectionEvidence>[] = [
      { environment: "SANDBOX" }, { merchantScope: "another_merchant" }, { reference: "SCV3_other_reference" },
      { transactionId: "999" }, { status: "pending" }, { status: "failed" }, { currency: "USD" },
      { amountMinor: 499999 }, { chargedAmountMinor: 500001 }, { providerFeeMinor: -1 },
      { providerFeeMinor: 0.1 }, { additionalFeeMinor: NaN }, { providerFeeMinor: 300000 },
      { recipientEvidence: "CHECKOUT_METADATA" }, { recipients: [] },
      { recipients: [{ subaccountId: "RS_AnotherSchool123", amountMinor: 190000, currency: "NGN" }] },
      { recipients: [{ subaccountId: school, amountMinor: 200000, currency: "NGN" }] },
      { recipients: [{ subaccountId: school, amountMinor: 190000, currency: "USD" }] },
      { recipients: [{ subaccountId: school, amountMinor: 190000, currency: "NGN" },
        { subaccountId: "RS_PartnerForbidden123", amountMinor: 10000, currency: "NGN" }] },
    ];
    for (const change of mismatches) await expect(run(body(), verifier(change)))
      .rejects.toMatchObject({ code: "LIVE_VERIFICATION_MISMATCH" });
    expect(await counts()).toEqual([0, 0, 0, 0]);
    expect((await rows("flutterwave_live_subscription_intents"))[0].verified_transaction_id).toBeNull();
  });
  it("rejects malformed, wrong-amount/currency/status/reference and contradictory raw identifiers", async () => {
    for (const raw of [
      body({ amount: 4999 }), body({ currency: "USD" }), body({ status: "pending" }),
      body({ tx_ref: "SCV2_historical_fixture" }), body({ TransactionId: 999 }),
      body({ flw_ref: "first", FlwRef: "contradiction" }), Buffer.from("{malformed"),
      body({ tx_ref: "SCV3_unknown_reference" }),
    ]) await expect(run(raw)).rejects.toThrow();
    expect(await counts()).toEqual([0, 0, 0, 0]);
  });
  it("cannot read another merchant's intent but can reuse a provider ID in a distinct LIVE merchant namespace", async () => {
    await expect(run(body(), verifier({}, "different_merchant"))).rejects.toMatchObject({ code: "LIVE_INTENT_UNMATCHED" });
    await run();
    await intent(null, "SCV3_second_merchant_fixture", 2, "different_merchant");
    await run(body({ tx_ref: "SCV3_second_merchant_fixture" }), verifier({}, "different_merchant"));
    expect(await rows("flutterwave_live_collection_evidence")).toHaveLength(2);
    // The unchanged SANDBOX sentinel deliberately has the SAME provider ID.
  });
  it("prevents provider transaction or immutable fee evidence from being reassigned", async () => {
    await run();
    await intent(1, "SCV3_second_live_fixture", 2);
    await expect(run(body({ tx_ref: "SCV3_second_live_fixture" }))).rejects.toThrow();
    await expect(run(body(), verifier({ providerFeeMinor: 6600 })))
      .rejects.toMatchObject({ code: "LIVE_IMMUTABLE_EVIDENCE_CHANGED" });
    expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it("partial/failed refund notifications hold the whole internal liability once and never assert recovery", async () => {
    await run();
    for (const [amount, status] of [["100.01", "completed"], ["4899.99", "failed"]]) {
      await run(Buffer.from(JSON.stringify({ TransactionId: 123456, FlwRef: "FLW-fixture-123456",
        AmountRefunded: amount, status })));
    }
    const late = await run(Buffer.from(`${body().toString()} `));
    expect(late).toMatchObject({ outcome: "HELD", operationallyProcessed: false });
    expect(await counts()).toEqual([1, 2, 1, 4]);
    expect((await rows("flutterwave_live_partner_accruals"))[0]).toMatchObject({ amount_minor: 10000, state: "HELD" });
    expect((await rows("flutterwave_live_collection_evidence"))[0].gross_minor).toBe(500000);
  });
  it("reversal before collection remains held after success and creates no new payable", async () => {
    await run(body({ status: "reversed" }));
    expect(await run()).toMatchObject({ outcome: "HELD" });
    expect(await counts()).toEqual([0, 2, 0, 2]);
    expect((await rows("flutterwave_live_subscription_intents"))[0]).toMatchObject({ on_hold: true, state: "REVIEW_REQUIRED" });
  });
  it("mismatched/unknown refund identities cannot hold another payment; invalid refund amounts are refused", async () => {
    await run();
    for (const fields of [
      { FlwRef: "wrong-original-reference" }, { TransactionId: 999 }, { AmountRefunded: "0" },
      { AmountRefunded: "5000.01" }, { currency: "USD" },
    ]) await expect(run(Buffer.from(JSON.stringify({ TransactionId: 123456, FlwRef: "FLW-fixture-123456",
      AmountRefunded: "100", status: "completed", ...fields })))).rejects.toThrow();
    expect((await rows("flutterwave_live_subscription_intents"))[0].on_hold).toBe(false);
    expect((await rows("flutterwave_live_partner_accruals"))[0].state).toBe("ACCRUED");
  });
  it("a won chargeback cannot release an existing hold", async () => {
    await run();
    for (const event of ["chargeback.initiated", "chargeback.won"]) await run(Buffer.from(JSON.stringify({
      event, data: { id: 123456, tx_ref: reference, flw_ref: "FLW-fixture-123456" },
    })));
    expect(await counts()).toEqual([1, 2, 1, 3]);
    expect((await rows("flutterwave_live_partner_accruals"))[0].state).toBe("HELD");
  });
  it("a matched adverse event holds original verified evidence even when a fresh provider read would fail", async () => {
    await run();
    const unavailable = verifier();
    unavailable.verify = vi.fn().mockRejectedValue(new Error("Fictional unavailable or reversed provider read"));
    expect(await run(body({ status: "reversed", flw_ref: "FLW-fixture-123456" }), unavailable))
      .toMatchObject({ outcome: "HELD" });
    expect(unavailable.verify).not.toHaveBeenCalled();
    expect((await rows("flutterwave_live_partner_accruals"))[0].state).toBe("HELD");
  });
  it.each(["before", "after"] as const)("commit loss %s durable commit is retry-safe without another accrual", async when => {
    await expect(run(body(), verifier(), faultyPool(when))).rejects.toThrow("uncertain commit");
    expect(await counts()).toEqual(when === "before" ? [0, 0, 0, 0] : [1, 1, 1, 1]);
    const outcome = await run();
    expect(outcome.duplicate).toBe(when === "after");
    expect(await counts()).toEqual([1, 1, 1, 1]);
  });
  it("failed adverse-event commit rolls back hold/event/link together and a retry safely holds", async () => {
    await run();
    const raw = body({ status: "refunded" });
    await expect(run(raw, verifier(), faultyPool("before"))).rejects.toThrow();
    expect((await rows("flutterwave_live_partner_accruals"))[0].state).toBe("ACCRUED");
    expect(await counts()).toEqual([1, 1, 1, 1]);
    await run(raw);
    expect((await rows("flutterwave_live_partner_accruals"))[0].state).toBe("HELD");
    expect(await counts()).toEqual([1, 2, 1, 2]);
  });
  it("verification failure/timeout cannot leave bound transactions or partial finalization", async () => {
    const unavailable = verifier();
    unavailable.verify = vi.fn().mockRejectedValue(new Error("Fictional unavailable provider"));
    await expect(run(body(), unavailable)).rejects.toThrow("unavailable");
    const hanging = verifier();
    hanging.verify = vi.fn(() => new Promise<LiveCollectionEvidence>(() => {}));
    await expect(run(body(), hanging)).rejects.toMatchObject({ code: "LIVE_VERIFICATION_TIMEOUT" });
    expect(await counts()).toEqual([0, 0, 0, 0]);
    expect((await rows("flutterwave_live_subscription_intents"))[0].verified_transaction_id).toBeNull();
  }, 10000);
  it("DDL rejects frozen-snapshot edits, SANDBOX records, Paid accruals and hold release", async () => {
    await expect(pool.query("UPDATE flutterwave_live_subscription_intents SET school_minor=200000")).rejects.toThrow();
    await expect(pool.query("UPDATE flutterwave_live_subscription_intents SET environment='SANDBOX'")).rejects.toThrow();
    await run();
    await expect(pool.query("UPDATE flutterwave_live_collection_evidence SET provider_fee_minor=0")).rejects.toThrow();
    await expect(pool.query("DELETE FROM flutterwave_live_finalization_events")).rejects.toThrow();
    await expect(pool.query("UPDATE flutterwave_live_partner_accruals SET state='PAID'")).rejects.toThrow();
    await run(body({ status: "reversed" }));
    await expect(pool.query("UPDATE flutterwave_live_subscription_intents SET on_hold=false")).rejects.toThrow();
    await expect(pool.query("UPDATE flutterwave_live_partner_accruals SET state='ACCRUED'")).rejects.toThrow();
  });
  it("empty rollback/reapply works; retained intents or financial evidence prevent destructive rollback", async () => {
    const client = await pool.connect();
    try {
      await expect(client.query(down)).rejects.toThrow("preservation review");
      await client.query("ROLLBACK");
    } finally { client.release(); }
    await pool.query("TRUNCATE flutterwave_live_subscription_intents CASCADE");
    await pool.query(down); await pool.query(up);
    await intent(); await run();
    expect(await counts()).toEqual([1, 1, 1, 1]);
  });
});
