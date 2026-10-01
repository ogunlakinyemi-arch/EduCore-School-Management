import { describe, expect, it } from "vitest";
import { completeVerifiedPayment, finalizeVerifiedRefund } from "./staff-nfc-billing";
import type { VerifiedPayment } from "../lib/fee-providers";
import type { FlutterwaveRefundResult } from "../lib/fee-providers";

class FinalizationMemoryDatabase {
  payment: Record<string, any>;
  allocations: Array<Record<string, any>> = [];
  paymentRefundUpdateCount = 0;
  reversalInsertCount = 0;
  logoVersionId: number | null = null;
  receiptSnapshot: Record<string, any> | null = null;
  refundStatus = "PENDING";
  providerRefundId: string | null = null;
  refundedAmountMinor = 0;

  constructor(partnerProfileId: number | null = null) {
    this.payment = {
      id: 81,
      paymentId: 81,
      subscriptionId: 61,
      employeeId: 51,
      schoolId: 41,
      sessionId: 31,
      termId: 21,
      provider: "MOCK",
      providerMode: "DEVELOPMENT_MOCK",
      reference: "staffnfc_test_12345678",
      grossAmountMinor: 200_000,
      providerTransactionId: null,
      status: "PENDING",
      refundedAmountMinor: 0,
      billingRuleId: 8,
      billingRuleVersion: 3,
      priceMinor: 200_000,
      schoolShareMinor: 80_000,
      platformShareMinor: partnerProfileId === null ? 120_000 : 110_000,
      partnerShareMinor: partnerProfileId === null ? 0 : 10_000,
      partnerProfileId,
      attributionId: partnerProfileId === null ? null : 78,
      rulePriceMinor: 200_000,
      ruleSchoolShareMinor: 80_000,
      rulePlatformShareMinor: 110_000,
      rulePartnerCommissionMinor: 10_000,
      ruleNoPartnerPlatformShareMinor: 120_000,
      currency: "NGN",
      subscriptionStatus: "PENDING",
    };
  }

  async connect() {
    return {
      query: this.query.bind(this),
      release: () => undefined,
    };
  }

  async query(sql: string, values: unknown[] = []) {
    if (sql.includes("SELECT p.id,p.subscription_id AS") && sql.includes("FROM staff_nfc_payments p")) {
      return { rows: [{ ...this.payment }] };
    }
    if (sql.includes("SELECT id FROM staff_nfc_payments")
        && sql.includes("provider_transaction_id=$2")) {
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO staff_nfc_allocations")
        && sql.includes("VALUES ($1,'REVERSAL'")) {
      this.reversalInsertCount += 1;
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO staff_nfc_allocations")) {
      const expense = sql.includes("VALUES ($1,'EXPENSE'");
      const allocation = expense
        ? {
            idempotencyKey: values[0],
            entryType: "EXPENSE",
            recipientType: "PLATFORM_PROVIDER_FEE",
            recipientId: null,
            amountMinor: values[11],
            currency: "NGN",
          }
        : {
            idempotencyKey: values[0],
            entryType: "CREDIT",
            recipientType: values[2],
            recipientId: values[3],
            amountMinor: values[13],
            currency: "NGN",
          };
      this.allocations.push(allocation);
      return { rows: [{ id: this.allocations.length }] };
    }
    if (sql.includes("SELECT id FROM staff_nfc_allocations WHERE idempotency_key")) {
      return { rows: [] };
    }
    if (sql.includes("SELECT e.employee_no AS")) {
      return { rows: [{
        employeeNo: "E-51",
        employeeName: "A Staff Member",
        schoolName: "Example School",
        sessionName: "2025/2026",
        termName: "First Term",
        reference: this.payment.reference,
        grossAmountMinor: 200_000,
        currency: "NGN",
        paidAt: null,
        provider: this.payment.provider,
        providerMode: this.payment.providerMode,
        providerFeeMinor: values[0] ?? null,
        settlementAmountMinor: null,
      }] };
    }
    if (sql.includes("FROM school_branding_logos") && sql.includes("is_current=true")) {
      return { rows: this.logoVersionId === null ? [] : [{ id: this.logoVersionId }] };
    }
    if (sql.includes("SELECT recipient_type AS \"recipientType\"")
        && sql.includes("FROM staff_nfc_allocations")
        && !sql.includes("entry_type='CREDIT'")) {
      return { rows: this.allocations.map((allocation) => ({
        recipientType: allocation.recipientType,
        recipientId: allocation.recipientId,
        amountMinor: allocation.amountMinor,
        currency: "NGN",
      })) };
    }
    if (sql.includes("SELECT r.id,r.payment_id AS")) {
      return {
        rows: [{
          id: 71,
          refundId: 71,
          paymentId: 81,
          schoolId: 41,
          amountMinor: 20_000,
          refundStatus: this.refundStatus,
          providerRefundId: this.providerRefundId,
          provider: "FLUTTERWAVE",
          providerMode: "SANDBOX",
          providerTransactionId: "551234",
          grossAmountMinor: 200_000,
          refundedAmountMinor: this.refundedAmountMinor,
          paymentStatus: "PAID",
          subscriptionId: 61,
          employeeId: 51,
          sessionId: 31,
          termId: 21,
          reference: "staffnfc_test_12345678",
          billingRuleId: 8,
          billingRuleVersion: 3,
          attributionId: null,
        }],
      };
    }
    if (sql.includes("FROM staff_nfc_allocations")
        && sql.includes("entry_type='CREDIT'")) {
      return { rows: [
        { recipientType: "SCHOOL", recipientId: null, amountMinor: 80_000 },
        { recipientType: "PLATFORM", recipientId: null, amountMinor: 120_000 },
      ] };
    }
    if (sql.includes("UPDATE staff_nfc_refunds")
        && sql.includes("SET status='SUCCEEDED'")) {
      this.refundStatus = "SUCCEEDED";
      this.providerRefundId = String(values[0]);
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO staff_nfc_receipts")) {
      this.receiptSnapshot = JSON.parse(String(values[4]));
      return { rows: [] };
    }
    if (sql.includes("UPDATE staff_nfc_payments")
        && sql.includes("refunded_amount_minor=$1")) {
      this.paymentRefundUpdateCount += 1;
      this.refundedAmountMinor = Number(values[0]);
      return { rows: [] };
    }
    return { rows: [] };
  }
}

describe("staff NFC route finalization regressions", () => {
  it.each([
    { partnerProfileId: null, expected: [["SCHOOL", 80_000], ["PLATFORM", 120_000]] },
    { partnerProfileId: 81, expected: [["SCHOOL", 80_000], ["PLATFORM", 110_000], ["PARTNER", 10_000]] },
  ])("finalizes a verified $partnerProfileId partner branch against its frozen billing rule", async ({ partnerProfileId, expected }) => {
    const database = new FinalizationMemoryDatabase(partnerProfileId);
    const verified: VerifiedPayment = {
      reference: "staffnfc_test_12345678",
      amountMinor: 200_000,
      currency: "NGN",
      status: "succeeded",
      providerTransactionId: "551234",
    };

    const result = await completeVerifiedPayment(81, verified, null, database as any);

    expect(result).toMatchObject({ paymentId: 81, subscriptionId: 61, activated: true });
    expect(database.allocations
      .filter((allocation) => allocation.entryType === "CREDIT")
      .map((allocation) => [allocation.recipientType, allocation.amountMinor]))
      .toEqual(expected);
  });

  it("records a positive verified provider fee as a separate Platform expense", async () => {
    const database = new FinalizationMemoryDatabase();
    const verified: VerifiedPayment = {
      reference: "staffnfc_test_12345678",
      amountMinor: 200_000,
      currency: "NGN",
      status: "succeeded",
      providerTransactionId: "551234",
      providerFeeMinor: 1_250,
      providerSettlementAmountMinor: 198_750,
    };

    await completeVerifiedPayment(81, verified, null, database as any);

    expect(database.allocations).toContainEqual(expect.objectContaining({
      entryType: "EXPENSE",
      recipientType: "PLATFORM_PROVIDER_FEE",
      recipientId: null,
      amountMinor: 1_250,
    }));
    expect(database.allocations.filter((allocation) => allocation.entryType === "CREDIT")
      .reduce((total, allocation) => total + Number(allocation.amountMinor), 0)).toBe(200_000);
  });

  it("stores only the immutable canonical logo-version URL in a future staff receipt", async () => {
    const database = new FinalizationMemoryDatabase();
    database.logoVersionId = 73;
    await completeVerifiedPayment(81, {
      reference: "staffnfc_test_12345678",
      amountMinor: 200_000,
      currency: "NGN",
      status: "succeeded",
      providerTransactionId: "551234",
    }, null, database as any);

    expect(database.receiptSnapshot?.schoolLogoVersionUrl)
      .toBe("/api/schools/41/branding/logo-versions/73");
    expect(database.receiptSnapshot).not.toHaveProperty("logoUrl", "/api/schools/41/branding/logo");
  });

  it("does not double reverse a partial refund when its provider webhook replays the request result", async () => {
    const database = new FinalizationMemoryDatabase();
    const providerResult: FlutterwaveRefundResult = {
      providerRefundId: "refund-8721",
      providerTransactionId: "551234",
      amountMinor: 20_000,
      status: "succeeded",
    };

    const requestResult = await finalizeVerifiedRefund(71, providerResult, null, database as any);
    const reversalsAfterRequest = database.reversalInsertCount;
    const paymentUpdatesAfterRequest = database.paymentRefundUpdateCount;
    const webhookResult = await finalizeVerifiedRefund(71, providerResult, null, database as any);

    expect(requestResult).toBe("partial_refund");
    expect(webhookResult).toBe("duplicate");
    expect(reversalsAfterRequest).toBe(2);
    expect(database.reversalInsertCount).toBe(reversalsAfterRequest);
    expect(paymentUpdatesAfterRequest).toBe(1);
    expect(database.paymentRefundUpdateCount).toBe(paymentUpdatesAfterRequest);
    expect(database.refundedAmountMinor).toBe(20_000);
  });
});