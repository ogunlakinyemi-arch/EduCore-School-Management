import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  calculateStaffNfcAllocations,
  calculateStaffNfcRefundReversals,
  ensureCurrentStaffNfcTermSubscriptions,
  generateStaffNfcTermSubscriptions,
  getStaffNfcEligibility,
  normalizeVerifiedProviderPayment,
  staffNfcPaymentActivatesSubscription,
  type StaffNfcSqlExecutor,
  verifyFlutterwaveStaffWebhookSignature,
} from "./staff-nfc-billing-service";

const noPartnerRule = {
  priceMinor: 200_000,
  schoolShareMinor: 80_000,
  platformShareMinor: 110_000,
  partnerCommissionMinor: 10_000,
  noPartnerPlatformShareMinor: 120_000,
};

function mockExecutor(handler: (sql: string, values?: readonly unknown[]) => Promise<{ rows: unknown[] }> | { rows: unknown[] }) {
  return {
    async query<T = Record<string, unknown>>(sql: string, values?: readonly unknown[]) {
      const result = await handler(sql, values);
      return { rows: result.rows as T[] };
    },
  } satisfies StaffNfcSqlExecutor;
}

describe("staff NFC immutable allocation and provider policies", () => {
  it("balances the no-Partner NGN 2,000 split", () => {
    expect(calculateStaffNfcAllocations(noPartnerRule, null)).toEqual([
      { recipientType: "SCHOOL", recipientId: null, amountMinor: 80_000 },
      { recipientType: "PLATFORM", recipientId: null, amountMinor: 120_000 },
    ]);
  });

  it("balances the attributed-Partner split without shifting provider fees", () => {
    const allocation = calculateStaffNfcAllocations(noPartnerRule, 21);
    expect(allocation).toEqual([
      { recipientType: "SCHOOL", recipientId: null, amountMinor: 80_000 },
      { recipientType: "PLATFORM", recipientId: null, amountMinor: 110_000 },
      { recipientType: "PARTNER", recipientId: 21, amountMinor: 10_000 },
    ]);
    expect(allocation.reduce((sum, item) => sum + item.amountMinor, 0)).toBe(200_000);
  });

  it("rejects unbalanced or unsafe billing-rule snapshots", () => {
    expect(() => calculateStaffNfcAllocations({ ...noPartnerRule, platformShareMinor: 109_999 }, 21))
      .toThrow("allocations are inconsistent");
    expect(() => calculateStaffNfcAllocations({ ...noPartnerRule, priceMinor: Number.MAX_SAFE_INTEGER + 1 }, null))
      .toThrow("allocations are inconsistent");
    expect(() => calculateStaffNfcAllocations(noPartnerRule, 0)).toThrow("Partner attribution is invalid");
  });

  it("reverses cumulative partial refunds deterministically and exactly at full refund", () => {
    const original = calculateStaffNfcAllocations(noPartnerRule, 21);
    const first = calculateStaffNfcRefundReversals(original, 200_000, 0, 33_333);
    const second = calculateStaffNfcRefundReversals(original, 200_000, 33_333, 66_667);
    const final = calculateStaffNfcRefundReversals(original, 200_000, 100_000, 100_000);
    expect(first.reduce((sum, item) => sum + item.amountMinor, 0)).toBe(33_332);
    expect(second.reduce((sum, item) => sum + item.amountMinor, 0)).toBe(66_668);
    expect(final).toEqual([
      { recipientType: "SCHOOL", recipientId: null, amountMinor: 40_000 },
      { recipientType: "PLATFORM", recipientId: null, amountMinor: 55_000 },
      { recipientType: "PARTNER", recipientId: 21, amountMinor: 5_000 },
    ]);
    const reversedByType = [...first, ...second, ...final].reduce<Record<string, number>>((totals, item) => {
      totals[item.recipientType] = (totals[item.recipientType] ?? 0) + item.amountMinor;
      return totals;
    }, {});
    expect(reversedByType).toEqual({ SCHOOL: 80_000, PLATFORM: 110_000, PARTNER: 10_000 });
  });

  it("rejects over-refunds and invalid money snapshots", () => {
    expect(() => calculateStaffNfcRefundReversals(
      [{ recipientType: "SCHOOL", recipientId: null, amountMinor: 200_000 }],
      200_000,
      190_001,
      10_000,
    )).toThrow("Refund exceeds");
    expect(() => calculateStaffNfcRefundReversals(
      [{ recipientType: "SCHOOL", recipientId: null, amountMinor: -1 }],
      200_000,
      0,
      1,
    )).toThrow("allocation is invalid");
  });

  it("activates only a successful exact-amount, exact-reference verified transaction", () => {
    const expected = { reference: "staffnfc_12345678", amountMinor: 200_000, currency: "NGN" };
    const valid = {
      ...expected, status: "succeeded" as const, providerTransactionId: "123456",
    };
    expect(staffNfcPaymentActivatesSubscription(expected, valid)).toBe(true);
    expect(staffNfcPaymentActivatesSubscription(expected, { ...valid, status: "pending" })).toBe(false);
    expect(staffNfcPaymentActivatesSubscription(expected, { ...valid, reference: "other_ref_12345" })).toBe(false);
    expect(staffNfcPaymentActivatesSubscription(expected, { ...valid, amountMinor: 1 })).toBe(false);
    expect(staffNfcPaymentActivatesSubscription(expected, { ...valid, providerTransactionId: "0" })).toBe(false);
  });

  it.each(["", "0", "not-numeric", "9007199254740992", "usd"])(
    "rejects malformed transaction identifiers or currency (%s)",
    (invalid) => {
      const expected = { reference: "staffnfc_12345678", amountMinor: 200_000, currency: "NGN" };
      const verified = {
        ...expected,
        status: "succeeded" as const,
        providerTransactionId: invalid === "usd" ? "123456" : invalid,
        currency: invalid === "usd" ? invalid : "NGN",
      };
      expect(staffNfcPaymentActivatesSubscription(expected, verified)).toBe(false);
    },
  );

  it("snapshots valid provider fees independently and ignores malformed optional snapshots", () => {
    const expected = { reference: "staffnfc_12345678", amountMinor: 200_000, currency: "NGN" };
    expect(normalizeVerifiedProviderPayment(expected, {
      ...expected,
      status: "succeeded",
      providerTransactionId: "123456",
      providerFeeMinor: 1_250,
      providerSettlementAmountMinor: 198_750,
    })).toMatchObject({
      activates: true,
      providerFeeMinor: 1_250,
      providerSettlementAmountMinor: 198_750,
    });
    expect(normalizeVerifiedProviderPayment(expected, {
      ...expected,
      status: "succeeded",
      providerTransactionId: "123456",
      providerFeeMinor: -1,
      providerSettlementAmountMinor: Number.MAX_SAFE_INTEGER + 1,
    })).toMatchObject({
      activates: true,
      providerFeeMinor: null,
      providerSettlementAmountMinor: null,
    });
  });

  it("uses raw-body Flutterwave HMAC-SHA256/base64 signatures", () => {
    const raw = Buffer.from('{"event":"charge.completed","data":{"id":123}}');
    const secret = "at-least-sixteen-characters-long";
    const signature = createHmac("sha256", secret).update(raw).digest("base64");
    expect(verifyFlutterwaveStaffWebhookSignature(raw, signature, secret)).toBe(true);
    expect(verifyFlutterwaveStaffWebhookSignature(Buffer.from(`${raw.toString()} `), signature, secret)).toBe(false);
    expect(verifyFlutterwaveStaffWebhookSignature(raw, signature, "wrong-secret-which-is-long-enough")).toBe(false);
    expect(verifyFlutterwaveStaffWebhookSignature(raw, undefined, secret)).toBe(false);
  });

  it.each([
    [null, false, "UNPAID"],
    ["PENDING", true, "PENDING"],
    ["FAILED", true, "FAILED"],
    ["REFUNDED", true, "REFUNDED"],
    ["PARTIALLY_REFUNDED", true, "PARTIALLY_REFUNDED"],
    ["PAID", false, "EXPIRED"],
    ["PAID", true, "PAID"],
  ] as const)("uses only the supplied active academic term for eligibility (%s, %s)", async (
    rowStatus,
    activeTerm,
    expectedStatus,
  ) => {
    const statements: Array<{ sql: string; values?: readonly unknown[] }> = [];
    const executor = mockExecutor(async (sql, values) => {
        statements.push({ sql, values });
        return {
          rows: rowStatus === null
            ? []
            : [{ subscriptionId: 71, status: rowStatus, activeTerm }],
        };
      });
    const result = await getStaffNfcEligibility(executor, 10, 20, 30);
    expect(result.status).toBe(expectedStatus);
    expect(result.eligible).toBe(expectedStatus === "PAID");
    expect(result.subscriptionId).toBe(rowStatus === null ? null : 71);
    expect(statements).toHaveLength(1);
    expect(statements[0].sql).toContain("t.id=$3");
    expect(statements[0].values).toEqual([10, 20, 30]);
  });

  it("does not query or grant eligibility for malformed identities or terms", async () => {
    let calls = 0;
    const executor = mockExecutor(async () => {
        calls += 1;
        return { rows: [] };
      });
    expect(await getStaffNfcEligibility(executor, 0, 20, 30))
      .toEqual({ eligible: false, status: "UNPAID", subscriptionId: null });
    expect(await getStaffNfcEligibility(executor, 10, 20, 0))
      .toEqual({ eligible: false, status: "UNPAID", subscriptionId: null });
    expect(calls).toBe(0);
  });

  it("fails closed when the target academic term is not the active current term", async () => {
    let writes = 0;
    const executor = mockExecutor(async (sql) => {
        if (sql.includes("FROM academic_terms t")) {
          return { rows: [{ schoolId: 20, sessionId: 30, dueDate: "2026-06-30", eligible: false }] };
        }
        writes += 1;
        return { rows: [] };
      });
    await expect(generateStaffNfcTermSubscriptions(executor, 20, 30, 40, 50))
      .rejects.toThrow("active current academic term");
    expect(writes).toBe(0);
  });

  it("does not create subscriptions without an effective NGN billing rule", async () => {
    let queryCount = 0;
    const executor = mockExecutor(async (sql) => {
        queryCount += 1;
        if (sql.includes("FROM academic_terms t")) {
          return { rows: [{ schoolId: 20, sessionId: 30, dueDate: "2026-06-30", eligible: true }] };
        }
        return { rows: [] };
      });
    await expect(generateStaffNfcTermSubscriptions(executor, 20, 30, 40, 50))
      .rejects.toThrow("No effective staff NFC billing rule");
    expect(queryCount).toBe(2);
  });

  it("returns unchanged empty results without writing when no active Teacher or Staff employees exist", async () => {
    let insertCount = 0;
    const executor = mockExecutor(async (sql) => {
        if (sql.includes("FROM academic_terms t")) {
          return { rows: [{ schoolId: 20, sessionId: 30, dueDate: "2026-06-30", eligible: true }] };
        }
        if (sql.includes("FROM staff_nfc_billing_rules")) {
          return { rows: [{
            id: 2, version: 1, priceMinor: 200_000,
            schoolShareMinor: 80_000, platformShareMinor: 110_000,
            partnerCommissionMinor: 10_000, noPartnerPlatformShareMinor: 120_000,
            currency: "NGN", effectiveAt: "2020-01-01T00:00:00Z",
          }] };
        }
        if (sql.includes("FROM employees e")) return { rows: [] };
        insertCount += 1;
        return { rows: [] };
      });
    await expect(generateStaffNfcTermSubscriptions(executor, 20, 30, 40, 50))
      .resolves.toEqual({ eligibleCount: 0, generatedCount: 0, unchangedCount: 0 });
    expect(insertCount).toBe(0);
  });

  it("leaves future-term generation to the activation transaction until a term is payable", async () => {
    let calls = 0;
    const executor = mockExecutor(async (sql) => {
        calls += 1;
        expect(sql).toContain("t.start_date<=CURRENT_DATE");
        expect(sql).toContain("t.end_date>=CURRENT_DATE");
        return { rows: [] };
      });
    await expect(ensureCurrentStaffNfcTermSubscriptions(executor, 20, 50))
      .resolves.toEqual({ termId: null, sessionId: null, generatedCount: 0, unchangedCount: 0 });
    expect(calls).toBe(1);
  });

  it("rejects allocation reversals that do not match the verified gross allocation ledger", () => {
    expect(() => calculateStaffNfcRefundReversals([
      { recipientType: "SCHOOL", recipientId: null, amountMinor: 100_000 },
    ], 200_000, 0, 20_000)).toThrow("do not balance");
    expect(() => calculateStaffNfcRefundReversals([
      { recipientType: "PARTNER", recipientId: null, amountMinor: 200_000 },
    ], 200_000, 0, 20_000)).toThrow("allocation is invalid");
    expect(() => calculateStaffNfcRefundReversals([
      { recipientType: "SCHOOL", recipientId: 12, amountMinor: 200_000 },
    ], 200_000, 0, 20_000)).toThrow("allocation is invalid");
  });

  it.each(["pending", "failed"] as const)("does not activate a %s provider result", (status) => {
    const expected = { reference: "staffnfc_12345678", amountMinor: 200_000, currency: "NGN" };
    const verified = {
      ...expected,
      status,
      providerTransactionId: "123456",
    };
    expect(normalizeVerifiedProviderPayment(expected, verified).activates).toBe(false);
    expect(staffNfcPaymentActivatesSubscription(expected, verified)).toBe(false);
  });
});