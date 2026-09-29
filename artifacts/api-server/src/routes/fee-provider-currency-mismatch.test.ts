import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; values: unknown[] }>,
  poolQuery: vi.fn(),
  clientQuery: vi.fn(),
  payment: {} as Record<string, any>,
}));

vi.mock("@workspace/db", () => ({
  pool: {
    query: (...args: any[]) => fake.poolQuery(...args),
    connect: async () => ({ query: (...args: any[]) => fake.clientQuery(...args), release: vi.fn() }),
  },
}));

import { settleVerifiedPayment } from "./fee-provider-webhooks";

beforeEach(() => {
  fake.calls.length = 0;
  fake.payment = {
    id: 11,
    school_id: 2,
    invoice_id: 22,
    student_id: 33,
    reference: "fee_0123456789abcdef",
    amount_minor: 1234,
    currency: "NGN",
    method: "PAYSTACK",
    provider: "PAYSTACK",
    provider_transaction_id: null,
    status: "PENDING",
    invoice_student_id: 33,
    invoice_currency: "NGN",
    total_minor: 1234,
    paid_minor: 0,
    outstanding_minor: 1234,
    invoice_status: "UNPAID",
    session_provider: "PAYSTACK",
    session_reference: "fee_0123456789abcdef",
    session_state: "READY",
  };
  fake.poolQuery.mockReset().mockImplementation(async () => ({ rows: [] }));
  fake.clientQuery.mockReset().mockImplementation(async (sql: string, values: unknown[] = []) => {
    fake.calls.push({ sql, values });
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
    if (sql.includes("INSERT INTO fee_provider_webhook_events") && sql.includes("'RECEIVED'")) {
      return { rows: [{ id: 1 }] };
    }
    if (sql.includes("SELECT p.*,i.total_minor")) return { rows: [{ ...fake.payment }] };
    if (sql.includes("UPDATE fee_provider_webhook_events SET status='RECONCILIATION_REQUIRED'")) return { rows: [] };
    throw new Error(`Unexpected currency mismatch settlement query: ${sql}`);
  });
});

describe("provider currency verification", () => {
  it("does not verify or credit an otherwise matching payment when provider currency differs", async () => {
    const result = await settleVerifiedPayment(
      "PAYSTACK",
      "paystack:currency-mismatch-456",
      {
        reference: "fee_0123456789abcdef",
        amountMinor: 1234,
        currency: "USD",
        status: "succeeded",
        providerTransactionId: "456",
      },
      Buffer.from(JSON.stringify({
        event: "charge.success",
        data: { id: 456, reference: "fee_0123456789abcdef" },
      })),
    );

    expect(result).toBe("reconciliation_required");
    expect(fake.calls.some(({ sql }) => sql.includes("UPDATE fee_provider_webhook_events SET status='RECONCILIATION_REQUIRED'"))).toBe(true);
    expect(fake.calls.some(({ sql }) => sql.includes("UPDATE fee_payments SET status='VERIFIED'"))).toBe(false);
    expect(fake.calls.some(({ sql }) => sql.includes("UPDATE fee_invoices SET paid_minor"))).toBe(false);
    expect(fake.calls.some(({ sql }) => sql.includes("INSERT INTO fee_receipts"))).toBe(false);
    expect(fake.payment).toMatchObject({ status: "PENDING", currency: "NGN" });
  });
});