import { describe, expect, it } from "vitest";
import {
  calculateStudentSubscriptionAllocations,
  finalizeVerifiedStudentSubscriptionPayment,
  findStudentSubscriptionTermPaymentConflict,
  normalizeStudentSubscriptionProviderPayment,
  normalizeStudentSubscriptionTerm,
  studentSubscriptionAmountToMinor,
  studentSubscriptionPaymentActivates,
} from "./student-subscription-billing";
import type { ExpectedPayment, VerifiedPayment } from "./fee-providers";

const expected: ExpectedPayment = {
  reference: "student_123456789",
  amountMinor: 500_000,
  currency: "NGN",
};
const verified: VerifiedPayment = {
  ...expected,
  status: "succeeded",
  providerTransactionId: "812345",
};
const partnerRule = {
  id: 9,
  allocationTotal: 5_000,
  schoolAmount: 2_000,
  partnerAmount: 100,
  edupulseAmount: 2_900,
  currency: "NGN",
};

class FinalizationMemoryPool {
  readonly allocations: Array<{ entryType: string; recipientType: string; recipientId: number | null; amountMinor: number }> = [];
  partnerLedgerCount = 0;
  paymentStatus = "PENDING";
  reconciliationStatus = "PENDING";
  unresolvedFailedTermPayment = false;
  receiptSnapshot: Record<string, unknown> | null = null;
  logoVersionId: number | null = null;
  termPaymentConflict: { id: number; subscriptionId: number; status: string } | null = null;
  private transactionTail = Promise.resolve();
  constructor(private readonly attributed: boolean) {}

  async connect() {
    let releaseTransaction: (() => void) | undefined;
    return {
      query: async (sql: string, values: unknown[] = []) => {
        if (sql === "BEGIN") {
          const previous = this.transactionTail;
          this.transactionTail = new Promise<void>((resolve) => { releaseTransaction = resolve; });
          await previous;
          return { rows: [] };
        }
        if (sql === "COMMIT" || sql === "ROLLBACK") {
          releaseTransaction?.();
          releaseTransaction = undefined;
          return { rows: [] };
        }
        return this.query(sql, values);
      },
      release: () => undefined,
    };
  }

  async query(sql: string, values: unknown[] = []) {
    if (sql.includes("SELECT p.id,p.subscription_id AS")) {
      return { rows: [{
        id: 17,
        paymentId: 17,
        subscriptionId: 12,
        schoolId: 8,
        studentId: 4,
        sessionId: 3,
        termId: 2,
        payerUserId: 6,
        provider: "FLUTTERWAVE",
        providerMode: "SANDBOX",
        reference: expected.reference,
        grossAmountMinor: 500_000,
        currency: "NGN",
         status: this.paymentStatus,
         reconciliationStatus: this.reconciliationStatus,
        providerTransactionId: null,
        subscriptionTerm: "First Term",
        subscriptionStatus: "pending",
        verificationStatus: "pending",
        studentStatus: "ACTIVE",
        academicTermName: "First Term",
        termEndDate: "2026-01-31",
        currentTerm: true,
      }] };
    }
    if (sql.startsWith("SELECT id,subscription_id AS")
        && sql.includes("status IN ('PENDING','RECONCILIATION_REQUIRED','PAID')")) {
      return { rows: this.termPaymentConflict ? [this.termPaymentConflict] : [] };
    }
    if (sql.includes("SELECT id FROM student_subscription_payments")
        && sql.includes("provider_transaction_id=$2")) return { rows: [] };
    if (sql.includes("COALESCE(failure_code,'')<>'PROVIDER_VERIFIED_FAILED'")) {
      return { rows: this.unresolvedFailedTermPayment ? [{ id: 29 }] : [] };
    }
    if (sql.includes("FROM school_partner_attributions a")) {
      return { rows: this.attributed ? [{ attributionId: 22, partnerProfileId: 44 }] : [] };
    }
    if (sql.includes("FROM commission_rules")) {
      return { rows: [partnerRule] };
    }
    if (sql.includes("UPDATE subscriptions")) return { rows: [{ id: 12 }] };
    if (sql.includes("INSERT INTO student_subscription_allocations")) {
      this.allocations.push({
        entryType: String(values[1]),
        recipientType: String(values[2]),
        recipientId: values[3] == null ? null : Number(values[3]),
        amountMinor: Number(values[13]),
      });
      return { rows: [] };
    }
    if (sql.includes("INSERT INTO commission_ledger")) {
      this.partnerLedgerCount += 1;
      return { rows: [] };
    }
    if (sql.includes("FROM school_branding_logos") && sql.includes("is_current=true")) {
      return { rows: this.logoVersionId === null ? [] : [{ id: this.logoVersionId }] };
    }
    if (sql.includes("UPDATE student_subscription_payments")) {
      if (sql.includes("SET status='RECONCILIATION_REQUIRED'") || sql.includes("SET status=CASE")) {
        this.paymentStatus = "RECONCILIATION_REQUIRED";
      }
      if (sql.includes("SET reconciliation_status='RECONCILIATION_REQUIRED'")
          || sql.includes("reconciliation_status=CASE")) {
        this.reconciliationStatus = "RECONCILIATION_REQUIRED";
      }
      if (sql.includes("SET status=$1")) this.paymentStatus = String(values[0]);
      if (sql.includes("SET receipt_snapshot=")) {
        this.receiptSnapshot = JSON.parse(String(values[0]));
        return { rows: [] };
      }
      this.paymentStatus = sql.includes("status='PAID'") ? "PAID" : this.paymentStatus;
      return { rows: [] };
    }
    return { rows: [] };
  }
}

describe("student subscription trusted billing policy", () => {
  it("allocates NGN 5,000 with no Partner as School 2,000 and Platform 3,000", () => {
    const result = calculateStudentSubscriptionAllocations({ partnerProfileId: null });
    expect(result).toEqual([
      { recipientType: "SCHOOL", recipientId: null, amountMinor: 200_000 },
      { recipientType: "PLATFORM", recipientId: null, amountMinor: 300_000 },
    ]);
    expect(result.reduce((total, item) => total + item.amountMinor, 0)).toBe(500_000);
  });

  it("allocates an eligible Partner from the Platform share without changing gross", () => {
    const result = calculateStudentSubscriptionAllocations({
      partnerProfileId: 44,
      commissionRule: partnerRule,
    });
    expect(result).toEqual([
      { recipientType: "SCHOOL", recipientId: null, amountMinor: 200_000 },
      { recipientType: "PLATFORM", recipientId: null, amountMinor: 290_000 },
      { recipientType: "PARTNER", recipientId: 44, amountMinor: 10_000 },
    ]);
    expect(result.reduce((total, item) => total + item.amountMinor, 0)).toBe(500_000);
  });

  it("rejects a Partner allocation without a server-validated commission rule", () => {
    expect(() => calculateStudentSubscriptionAllocations({ partnerProfileId: 44 }))
      .toThrow("commission rule matching");
  });

  it("rejects a client or rule supplied invalid Partner identity", () => {
    expect(() => calculateStudentSubscriptionAllocations({
      partnerProfileId: 0,
      commissionRule: partnerRule,
    })).toThrow("commission rule matching");
  });

  it.each([
    { ...partnerRule, allocationTotal: 4_999 },
    { ...partnerRule, schoolAmount: 1_999 },
    { ...partnerRule, partnerAmount: 101 },
    { ...partnerRule, edupulseAmount: 2_899 },
    { ...partnerRule, currency: "USD" },
  ])("rejects a Partner rule that does not match the Student NGN 5,000 split", (commissionRule) => {
    expect(() => calculateStudentSubscriptionAllocations({
      partnerProfileId: 44,
      commissionRule,
    })).toThrow("commission rule matching");
  });

  it("does not permit an un-attributed subscription to inherit a Partner rule", () => {
    expect(() => calculateStudentSubscriptionAllocations({
      partnerProfileId: null,
      commissionRule: partnerRule,
    })).toThrow("Unattributed subscriptions");
  });

  it("accepts only server-persisted NGN 5,000 checkout and trusted Flutterwave identity", () => {
    expect(normalizeStudentSubscriptionProviderPayment(expected, verified)).toEqual(verified);
    expect(studentSubscriptionPaymentActivates(expected, verified)).toBe(true);
  });

  it("finalizes an unattributed provider payment into its fixed School and Platform allocations", async () => {
    const database = new FinalizationMemoryPool(false);
    const result = await finalizeVerifiedStudentSubscriptionPayment(database, 17, verified);

    expect(result).toMatchObject({ status: "PAID", activated: true, reconciliationRequired: false });
    expect(database.allocations).toEqual([
      { entryType: "CREDIT", recipientType: "SCHOOL", recipientId: null, amountMinor: 200_000 },
      { entryType: "CREDIT", recipientType: "PLATFORM", recipientId: null, amountMinor: 300_000 },
    ]);
    expect(database.partnerLedgerCount).toBe(0);
    expect(database.paymentStatus).toBe("PAID");
  });

  it("finalizes an eligible Partner allocation and a positive provider fee as a separate expense", async () => {
    const database = new FinalizationMemoryPool(true);
    const result = await finalizeVerifiedStudentSubscriptionPayment(database, 17, {
      ...verified,
      providerFeeMinor: 1_500,
      providerSettlementAmountMinor: 498_500,
    });

    expect(result).toMatchObject({ status: "PAID", activated: true });
    expect(database.allocations).toEqual([
      { entryType: "CREDIT", recipientType: "SCHOOL", recipientId: null, amountMinor: 200_000 },
      { entryType: "CREDIT", recipientType: "PLATFORM", recipientId: null, amountMinor: 290_000 },
      { entryType: "CREDIT", recipientType: "PARTNER", recipientId: 44, amountMinor: 10_000 },
      { entryType: "EXPENSE", recipientType: "PLATFORM_PROVIDER_FEE", recipientId: null, amountMinor: 1_500 },
    ]);
    expect(database.partnerLedgerCount).toBe(1);
    expect(database.allocations.filter((item) => item.entryType === "CREDIT")
      .reduce((total, item) => total + item.amountMinor, 0)).toBe(500_000);
  });

  it("stores only the immutable canonical logo-version URL in the future receipt snapshot", async () => {
    const database = new FinalizationMemoryPool(false);
    database.logoVersionId = 88;
    await finalizeVerifiedStudentSubscriptionPayment(database, 17, verified, (schoolId, logoId) =>
      `/api/schools/${schoolId}/branding/logo-versions/${logoId}`,
    );

    expect(database.receiptSnapshot?.schoolLogoVersionUrl)
      .toBe("/api/schools/8/branding/logo-versions/88");
    expect(database.receiptSnapshot).not.toHaveProperty("logoUrl", "/api/schools/8/branding/logo");
  });

  it("rejects a different Subscription row's open payment for the same student, school, session and term", async () => {
    const database = new FinalizationMemoryPool(false);
    database.termPaymentConflict = { id: 29, subscriptionId: 99, status: "PENDING" };
    const result = await finalizeVerifiedStudentSubscriptionPayment(database, 17, verified);

    expect(result).toMatchObject({
      status: "RECONCILIATION_REQUIRED",
      activated: false,
      reconciliationRequired: true,
      allocations: [],
    });
    expect(database.paymentStatus).toBe("RECONCILIATION_REQUIRED");
    expect(database.allocations).toEqual([]);
    expect(database.partnerLedgerCount).toBe(0);
  });

  it("serializes callback and webhook finalizers so the second caller observes PAID without duplicate allocations", async () => {
    const database = new FinalizationMemoryPool(false);
    const [callbackResult, webhookResult] = await Promise.all([
      finalizeVerifiedStudentSubscriptionPayment(database, 17, verified),
      finalizeVerifiedStudentSubscriptionPayment(database, 17, verified),
    ]);

    expect(callbackResult.status).toBe("PAID");
    expect(webhookResult.status).toBe("PAID");
    expect(database.paymentStatus).toBe("PAID");
    expect(database.allocations).toHaveLength(2);
  });

  it("queries open, uncertain and paid term attempts across all Subscription rows while allowing FAILED retries", async () => {
    const client = {
      query: async (sql: string, values?: unknown[]) => {
        expect(sql).toContain("school_id=$1 AND student_id=$2 AND academic_session_id=$3 AND academic_term_id=$4");
        expect(sql).toContain("status IN ('PENDING','RECONCILIATION_REQUIRED','PAID')");
        expect(sql).toContain("OR reconciliation_status='RECONCILIATION_REQUIRED'");
        expect(sql).not.toContain("subscription_id=$");
        expect(values).toEqual([8, 4, 3, 2, null]);
        return { rows: [{ id: 29, subscriptionId: 99, status: "PENDING" }] };
      },
    };
    const conflict = await findStudentSubscriptionTermPaymentConflict(client, {
      schoolId: 8,
      studentId: 4,
      sessionId: 3,
      termId: 2,
    });
    expect(conflict).toEqual({ id: 29, subscriptionId: 99, status: "PENDING" });
  });

  it("does not block a new attempt for an independently verified FAILED payment", async () => {
    const client = {
      query: async (sql: string) => {
        expect(sql).toContain("status IN ('PENDING','RECONCILIATION_REQUIRED','PAID')");
        expect(sql).toContain("OR reconciliation_status='RECONCILIATION_REQUIRED'");
        return { rows: [] };
      },
    };
    await expect(findStudentSubscriptionTermPaymentConflict(client, {
      schoolId: 8,
      studentId: 4,
      sessionId: 3,
      termId: 2,
    })).resolves.toBeNull();
  });

  it("does not claim the unique active-term slot when a late failed attempt conflicts with another active payment", async () => {
    const database = new FinalizationMemoryPool(false);
    database.paymentStatus = "FAILED";
    database.termPaymentConflict = { id: 29, subscriptionId: 99, status: "PAID" };

    const result = await finalizeVerifiedStudentSubscriptionPayment(database, 17, verified);

    expect(result.status).toBe("RECONCILIATION_REQUIRED");
    expect(database.paymentStatus).toBe("FAILED");
    expect(database.reconciliationStatus).toBe("PENDING");
    expect(database.allocations).toEqual([]);
  });

  it("keeps a term held when another FAILED attempt has unresolved provider reconciliation", async () => {
    const database = new FinalizationMemoryPool(false);
    database.unresolvedFailedTermPayment = true;

    const result = await finalizeVerifiedStudentSubscriptionPayment(database, 17, verified);

    expect(result.status).toBe("RECONCILIATION_REQUIRED");
    expect(database.paymentStatus).toBe("RECONCILIATION_REQUIRED");
    expect(database.allocations).toEqual([]);
  });

  it.each([
    [{ ...verified, reference: "untrusted_1234567" }],
    [{ ...verified, amountMinor: 1 }],
    [{ ...verified, currency: "USD" }],
    [{ ...verified, providerTransactionId: "" }],
    [{ ...verified, providerTransactionId: "bad-provider-id" }],
    [{ ...verified, providerTransactionId: "9007199254740992" }],
  ])("does not activate when verified provider data mismatches the persisted checkout", (payment) => {
    expect(studentSubscriptionPaymentActivates(expected, payment as VerifiedPayment)).toBe(false);
    expect(() => normalizeStudentSubscriptionProviderPayment(expected, payment as VerifiedPayment))
      .toThrow("does not match");
  });

  it.each(["pending", "failed"] as const)("does not activate a provider result in %s state", (status) => {
    expect(studentSubscriptionPaymentActivates(expected, { ...verified, status })).toBe(false);
  });

  it("keeps actual provider fees and settlement snapshots separate from revenue allocations", () => {
    const providerVerified = {
      ...verified,
      providerFeeMinor: 1_500,
      providerSettlementAmountMinor: 498_500,
    };
    expect(normalizeStudentSubscriptionProviderPayment(expected, providerVerified))
      .toMatchObject({ providerFeeMinor: 1_500, providerSettlementAmountMinor: 498_500 });
    expect(calculateStudentSubscriptionAllocations({ partnerProfileId: null }))
      .toHaveLength(2);
  });

  it("rejects invalid optional provider fee snapshots instead of hiding them", () => {
    expect(() => normalizeStudentSubscriptionProviderPayment(expected, {
      ...verified,
      providerFeeMinor: -1,
    })).toThrow("fee or settlement snapshot");
    expect(() => normalizeStudentSubscriptionProviderPayment(expected, {
      ...verified,
      providerSettlementAmountMinor: Number.MAX_SAFE_INTEGER + 1,
    })).toThrow("fee or settlement snapshot");
  });

  it.each(["", "  ", "x".repeat(121)])("requires a bounded academic term name (%s)", (term) => {
    expect(() => normalizeStudentSubscriptionTerm(term)).toThrow("current academic term");
  });

  it("normalizes the exact subscription term without accepting path-like substitution", () => {
    expect(normalizeStudentSubscriptionTerm("  First Term  ")).toBe("First Term");
    expect(normalizeStudentSubscriptionTerm("../term")).toBe("../term");
  });

  it.each([["5000", 500_000], ["5000.0", 500_000], ["5000.00", 500_000], ["0.01", 1]] as const)(
    "converts exact NGN values to minor units (%s)", (amount, expectedMinor) => {
      expect(studentSubscriptionAmountToMinor(amount)).toBe(expectedMinor);
    },
  );
});