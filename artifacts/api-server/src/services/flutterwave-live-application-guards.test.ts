import { describe, expect, it, vi } from "vitest";
import { assertLiveIntentAllocation } from "./flutterwave-live-application-guards";
import { finalizeLiveSubscriptionDesign } from "./flutterwave-live-finalization-design";
import type { LiveCollectionEvidence } from "../lib/flutterwave-live-verification";

const baseIntent = {
  id: "17", environment: "LIVE", merchant_scope: "fixture_merchant",
  reference: "SCV3_live_fixture_12345", school_subaccount_id: "RS_123456789012",
  currency: "NGN", gross_minor: 500000, school_minor: 190000, merchant_gross_minor: 310000,
  partner_profile_id: 9 as number | null, partner_accrual_minor: 10000,
  on_hold: false, verified_transaction_id: null, verified_provider_reference: null,
};

describe("application allocation precheck (not a constraint replacement)", () => {
  it.each([true, false])("preserves exact allocation with BRO eligibility %s", eligible => {
    const intent = { ...baseIntent, partner_profile_id: eligible ? 9 : null,
      partner_accrual_minor: eligible ? 10000 : 0 };
    expect(() => assertLiveIntentAllocation(intent)).not.toThrow();
    expect(intent.school_minor + intent.merchant_gross_minor).toBe(500000);
    expect(intent.merchant_gross_minor - intent.partner_accrual_minor).toBe(eligible ? 300000 : 310000);
  });
  it.each([
    { environment: "TEST" }, { currency: "USD" }, { gross_minor: 500001 },
    { school_minor: 200000 }, { merchant_gross_minor: 300000 },
    { gross_minor: "500000" }, { partner_profile_id: null, partner_accrual_minor: 10000 },
    { partner_profile_id: 0 }, { partner_profile_id: -1 }, { partner_profile_id: 1.5 },
    { partner_profile_id: "9" }, { partner_profile_id: undefined },
    { partner_profile_id: 9, partner_accrual_minor: 0 }, { partner_accrual_minor: 10001 },
  ])("rejects malformed or changed snapshots: %j", patch => {
    expect(() => assertLiveIntentAllocation({ ...baseIntent, ...patch }))
      .toThrow(expect.objectContaining({ code: "LIVE_INTENT_ALLOCATION_INVALID" }));
  });
});

/** SQL protocol double: no pg client, sockets, provider fetch, trigger emulation or
 * constraint/concurrency claims. Execute the REAL finalizer, retaining transaction
 * staging to check that a rejected step cannot acknowledge a partial hold. */
function fixture(options: {
  existingEvidence?: boolean; failBatch?: boolean; duplicate?: boolean;
  authenticated?: boolean; noBatch?: boolean;
  intent?: Partial<typeof baseIntent>; proof?: Partial<LiveCollectionEvidence>;
} = {}) {
  const intent = { ...baseIntent, ...options.intent };
  const proof: LiveCollectionEvidence = {
    environment: "LIVE", merchantScope: intent.merchant_scope, reference: intent.reference,
    transactionId: "123", providerReference: "fixture_provider_ref",
    status: "succeeded", currency: "NGN", amountMinor: 500000, chargedAmountMinor: 500000,
    providerFeeMinor: 500, additionalFeeMinor: 50, recipientEvidence: "TRANSACTION_BOUND",
    recipients: [{ subaccountId: intent.school_subaccount_id, currency: "NGN", amountMinor: 190000 }],
    ...options.proof,
  };
  const durable = { held: false, accrual: "ACCRUED", batch: "APPROVED" };
  let staged = { ...durable };
  const trace: string[] = [];
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    const q = sql.replace(/\s+/g, " ").trim();
    trace.push(q);
    if (q === "BEGIN") { staged = { ...durable }; return { rows: [] }; }
    if (q === "COMMIT") { Object.assign(durable, staged); return { rows: [] }; }
    if (q === "ROLLBACK" || q.startsWith("SET LOCAL")) return { rows: [] };
    if (q.startsWith("SELECT id FROM flutterwave_live_webhook_receipts")) {
      return { rows: options.authenticated === false ? [] : [{ id: 7 }] };
    }
    if (q.startsWith("SELECT * FROM flutterwave_live_subscription_intents")) return { rows: [intent] };
    if (q.startsWith("SELECT * FROM flutterwave_live_collection_evidence")) return {
      rows: options.existingEvidence ? [{
        merchant_scope: intent.merchant_scope, transaction_id: proof.transactionId,
        provider_reference: proof.providerReference, currency: proof.currency, gross_minor: proof.amountMinor,
        provider_fee_minor: proof.providerFeeMinor, additional_fee_minor: proof.additionalFeeMinor,
        school_subaccount_id: intent.school_subaccount_id, school_minor: 190000,
      }] : [],
    };
    if (q.startsWith("UPDATE flutterwave_live_subscription_intents")) {
      if (q.includes("on_hold=true")) staged.held = true;
      return { rows: [] };
    }
    if (q.startsWith("INSERT INTO flutterwave_live_finalization_events")) {
      return { rows: options.duplicate ? [] : [{ id: 71 }] };
    }
    if (q.startsWith("SELECT id FROM flutterwave_live_finalization_events")) return { rows: [{ id: 71 }] };
    if (q.startsWith("UPDATE flutterwave_live_partner_accruals")) {
      staged.accrual = "HELD"; return { rows: [] };
    }
    if (q.startsWith("UPDATE flutterwave_live_commission_batches")) {
      expect(values).toEqual([intent.id, intent.merchant_scope]);
      expect(q).toContain("b.environment='LIVE' AND b.merchant_scope=$2");
      expect(q).toContain("bi.intent_id=$1");
      expect(q).toContain("a.environment='LIVE' AND a.state='HELD'");
      if (options.failBatch) throw new Error("synthetic batch update failure");
      if (!options.noBatch && staged.accrual === "HELD") staged.batch = "REVIEW_REQUIRED";
      return { rows: [] };
    }
    if (q.startsWith("INSERT INTO flutterwave_live_collection_evidence")
      || q.startsWith("INSERT INTO flutterwave_live_partner_accruals")
      || q.startsWith("INSERT INTO flutterwave_live_receipt_results")) return { rows: [] };
    if (q.startsWith("SELECT event_id FROM flutterwave_live_receipt_results")) return { rows: [{ event_id: 71 }] };
    throw new Error(`Unexpected test SQL: ${q}`);
  });
  const release = vi.fn();
  const connect = vi.fn(async () => ({ query, release }));
  const verify = vi.fn(async () => proof);
  const verifier = { enabled: true, environment: "LIVE", merchantScope: intent.merchant_scope, verify };
  const lifecycle = {
    collection: vi.fn(async () => { trace.push("LIFECYCLE_COLLECTION"); }),
    hold: vi.fn(async () => { trace.push("LIFECYCLE_HOLD"); }),
  };
  const raw = (adverse: boolean) => Buffer.from(JSON.stringify({
    event: adverse ? "chargeback.initiated" : "charge.completed",
    data: { id: 123, tx_ref: intent.reference, flw_ref: proof.providerReference,
      status: "successful", currency: "NGN", amount: 5000 },
  }));
  return { durable, trace, query, connect, verify, release, lifecycle,
    run: (adverse = true) => finalizeLiveSubscriptionDesign({ connect }, 7, raw(adverse), verifier, lifecycle) };
}

describe("trigger-independent application step inside the real finalizer", () => {
  it("invalidates held BRO batches before lifecycle and COMMIT without another connection", async () => {
    const f = fixture({ existingEvidence: true });
    expect(await f.run()).toMatchObject({ outcome: "HELD", operationallyProcessed: false });
    expect(f.durable).toEqual({ held: true, accrual: "HELD", batch: "REVIEW_REQUIRED" });
    const at = (fragment: string) => f.trace.findIndex(q => q.includes(fragment));
    expect(at("FOR UPDATE")).toBeLessThan(at("on_hold=true"));
    expect(at("on_hold=true")).toBeLessThan(at("UPDATE flutterwave_live_partner_accruals"));
    expect(at("UPDATE flutterwave_live_partner_accruals")).toBeLessThan(at("UPDATE flutterwave_live_commission_batches"));
    expect(at("UPDATE flutterwave_live_commission_batches")).toBeLessThan(at("LIFECYCLE_HOLD"));
    expect(at("LIFECYCLE_HOLD")).toBeLessThan(at("INSERT INTO flutterwave_live_receipt_results"));
    expect(f.trace.at(-1)).toBe("COMMIT");
    expect(f.connect).toHaveBeenCalledTimes(1);
    expect(f.release).toHaveBeenCalledOnce();
    expect(f.verify).not.toHaveBeenCalled(); // Already verified evidence, HOLD ONLY.
  });
  it("propagates invalidation errors and rolls back instead of acknowledging", async () => {
    const f = fixture({ existingEvidence: true, failBatch: true });
    await expect(f.run()).rejects.toThrow("synthetic batch update failure");
    expect(f.durable).toEqual({ held: false, accrual: "ACCRUED", batch: "APPROVED" });
    expect(f.trace.at(-1)).toBe("ROLLBACK");
    expect(f.trace).not.toContain("COMMIT");
    expect(f.lifecycle.hold).not.toHaveBeenCalled();
    expect(f.trace.some(q => q.startsWith("INSERT INTO flutterwave_live_receipt_results"))).toBe(false);
    expect(f.release).toHaveBeenCalledOnce();
  });
  it("replays an adverse event and keeps the batch in REVIEW_REQUIRED", async () => {
    const f = fixture({ existingEvidence: true, duplicate: true });
    expect(await f.run()).toMatchObject({ outcome: "HELD", duplicate: true });
    expect(await f.run()).toMatchObject({ outcome: "HELD", duplicate: true });
    expect(f.durable.batch).toBe("REVIEW_REQUIRED");
  });
  it("retains a hold with no eligible BRO or export batch", async () => {
    const f = fixture({ existingEvidence: true, noBatch: true,
      intent: { partner_profile_id: null, partner_accrual_minor: 0 } });
    expect(await f.run()).toMatchObject({ outcome: "HELD" });
    expect(f.durable.held).toBe(true);
    // No new batch or liability is fabricated by an UPDATE.
    expect(f.trace.some(q => q.startsWith("INSERT INTO flutterwave_live_partner_accruals"))).toBe(false);
  });
  it.each([true, false])("preserves verified collection with BRO eligibility %s", async eligible => {
    const f = fixture({ intent: { partner_profile_id: eligible ? 9 : null,
      partner_accrual_minor: eligible ? 10000 : 0 } });
    expect(await f.run(false)).toMatchObject({ outcome: "COLLECTION_VERIFIED", duplicate: false });
    expect(f.verify).toHaveBeenCalledOnce();
    expect(f.lifecycle.collection).toHaveBeenCalledOnce();
    expect(f.trace.some(q => q.startsWith("UPDATE flutterwave_live_commission_batches"))).toBe(false);
    expect(f.trace.some(q => q.startsWith("INSERT INTO flutterwave_live_partner_accruals"))).toBe(eligible);
    const evidence = f.query.mock.calls.find(([q]) => q.includes("INSERT INTO flutterwave_live_collection_evidence"));
    expect(evidence?.[0]).toContain("500000,'NGN',190000,310000");
    expect(evidence?.[1]?.slice(-3)).toEqual([eligible ? 10000 : 0, 500, 50]);
  });
  it("does not treat a duplicate collection as an adverse hold", async () => {
    const f = fixture({ duplicate: true, existingEvidence: true });
    expect(await f.run(false)).toMatchObject({ outcome: "COLLECTION_VERIFIED", duplicate: true });
    expect(f.durable.held).toBe(false);
    expect(f.lifecycle.hold).not.toHaveBeenCalled();
  });
  it.each([
    { recipientEvidence: "WEBHOOK_CLAIM" },
    { recipients: [{ subaccountId: "RS_wrong_recipient", currency: "NGN", amountMinor: 190000 }] },
    { providerFeeMinor: -1 }, { providerFeeMinor: Number.NaN },
    { providerFeeMinor: 300000 }, { chargedAmountMinor: 499999 },
  ])("still refuses unverified or unaffordable collection: %j", async proof => {
    const f = fixture({ proof });
    await expect(f.run(false)).rejects.toMatchObject({ code: "LIVE_VERIFICATION_MISMATCH" });
    expect(f.trace.at(-1)).toBe("ROLLBACK");
    expect(f.trace.some(q => q.startsWith("INSERT INTO flutterwave_live_finalization_events"))).toBe(false);
  });
  it("rejects an invalid intent allocation before verification or writes", async () => {
    const f = fixture({ intent: { school_minor: 200000 } });
    await expect(f.run(false)).rejects.toMatchObject({ code: "LIVE_INTENT_ALLOCATION_INVALID" });
    expect(f.verify).not.toHaveBeenCalled();
    expect(f.trace.some(q => q.startsWith("UPDATE") || q.startsWith("INSERT"))).toBe(false);
  });
  it("requires authenticated original-byte receipt binding", async () => {
    const f = fixture({ authenticated: false });
    await expect(f.run(false)).rejects.toMatchObject({ code: "LIVE_AUTHENTICATED_RECEIPT_MISMATCH" });
    expect(f.verify).not.toHaveBeenCalled();
  });
  it("remains disabled by default before acquiring any SQL client", async () => {
    const connect = vi.fn();
    await expect(finalizeLiveSubscriptionDesign({ connect }, 7, Buffer.from("{}")))
      .rejects.toMatchObject({ code: "LIVE_VERIFICATION_TRANSPORT_DISABLED" });
    expect(connect).not.toHaveBeenCalled();
  });
});
