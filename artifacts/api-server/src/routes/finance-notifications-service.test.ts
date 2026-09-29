import { describe, expect, it, vi } from "vitest";
import {
  enqueueFinancePaymentNotifications,
  enqueueFinancePaymentNotificationsSafely,
  FinanceNotificationSettlementSafetyError,
  retryPendingFinancePaymentNotifications,
} from "./finance-notifications-service";

describe("finance payment notification enqueue", () => {
  it.each([
    ["PAYMENT_VERIFIED", "p.status='VERIFIED'", null],
    ["PAYMENT_REJECTED", "p.status='REJECTED'", null],
    ["PROVIDER_CHECKOUT_INITIATED", "p.status IN ('PENDING','PROCESSING','FAILED','VERIFIED')",
      "cs.state IN ('INITIALIZING','READY','FAILED','SETTLED','RELEASED')"],
    ["PROVIDER_CHECKOUT_PROCESSING", "p.status='PROCESSING'",
      "cs.state IN ('INITIALIZING','READY','FAILED')"],
    ["PROVIDER_PAYMENT_FAILED", "p.provider_transaction_id IS NOT NULL",
      "cs.state IN ('INITIALIZING','READY','FAILED','RELEASED')"],
    ["MANUAL_TRANSFER_SUBMITTED", "p.method='BANK_TRANSFER' AND p.status='PENDING'", null],
    ["MANUAL_TRANSFER_APPROVED", "p.method='BANK_TRANSFER' AND p.status='VERIFIED'", null],
    ["MANUAL_TRANSFER_REJECTED", "p.method='BANK_TRANSFER' AND p.status='REJECTED'", null],
    ["REFUND_APPROVED", "p.status IN ('VERIFIED','REFUNDED','REVERSED')", null],
    ["REVERSAL_APPROVED", "p.status IN ('VERIFIED','REFUNDED','REVERSED')", null],
  ] as const)("delivers %s to current active in-school recipients idempotently", async (eventType, statusGuard, stateGuard) => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const eventReferenceId = eventType === "REFUND_APPROVED" || eventType === "REVERSAL_APPROVED" ? 57 : 0;
    const created = await enqueueFinancePaymentNotifications(
      { query }, 31, 4, eventType, { amountMinor: 2500 }, eventReferenceId,
    );

    expect(created).toBe(2);
    const insertSql = query.mock.calls[0][0];
    expect(insertSql).toContain("p.school_id=$2");
    expect(insertSql).toContain(statusGuard);
    if (stateGuard) expect(insertSql).toContain(stateGuard);
    expect(insertSql).toContain("pa.school_id=t.school_id");
    expect(insertSql).toContain("rel.status='ACTIVE'");
    expect(insertSql).toContain("m.school_id=t.school_id");
    expect(insertSql).toContain("m.status='ACTIVE'");
    expect(insertSql).toContain("u.status='ACTIVE'");
    expect(insertSql).toContain("'PARENT'::text AS role");
    expect(insertSql).toContain("'STUDENT'::text");
    expect(insertSql).toContain("m.role IN ('SCHOOL_ADMIN','ACCOUNTANT')");
    expect(insertSql).toContain("fr.id=$4 AND fr.payment_id=p.id AND fr.invoice_id=p.invoice_id");
    expect(insertSql).toContain("fr.school_id=p.school_id AND fr.status='APPROVED'");
    expect(insertSql).toContain("event_reference_id");
    expect(insertSql).toContain("ON CONFLICT (payment_id,recipient_user_id,recipient_role,event_type,event_reference_id) DO NOTHING");
    expect(query.mock.calls[0][1]).toEqual([31, 4, eventType, eventReferenceId]);
    expect(query.mock.calls[1][0]).toContain("FEE_PAYMENT_NOTIFICATION");
    expect(query.mock.calls[1][1]).toEqual([4, 31, {
      amountMinor: 2500,
      createdCount: 2,
      eventType,
      channel: "IN_APP",
      externalChannels: { email: "BLOCKED_UNCONFIGURED", sms: "BLOCKED_UNCONFIGURED" },
    }]);
  });

  it("does not add an audit write if every idempotency key already exists", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await enqueueFinancePaymentNotifications({ query }, 31, 4, "PAYMENT_REJECTED")).toBe(0);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("rolls notification failure back to its savepoint and records durable retry work", async () => {
    const calls: string[] = [];
    const query = vi.fn(async (sql: string) => {
      calls.push(sql);
      if (sql.includes("INSERT INTO fee_payment_notifications")) throw new Error("simulated insert failure");
      if (sql.includes("INSERT INTO fee_payment_notification_outbox")) return { rows: [{ id: 3 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const result = await enqueueFinancePaymentNotificationsSafely(
      { query }, 31, 4, "PAYMENT_REJECTED", { reason: "Not matched" },
    );
    expect(result).toEqual({ queued: true });
    const outboxIndex = calls.findIndex((sql) => sql.includes("INSERT INTO fee_payment_notification_outbox"));
    const savepointIndex = calls.indexOf("SAVEPOINT fee_payment_notification_delivery");
    expect(outboxIndex).toBeGreaterThanOrEqual(0);
    expect(outboxIndex).toBeLessThan(savepointIndex);
    expect(calls).toContain("ROLLBACK TO SAVEPOINT fee_payment_notification_delivery");
    expect(calls.at(-1)).toBe("RELEASE SAVEPOINT fee_payment_notification_delivery");
  });

  it("isolates success-audit failure too and still records a retryable event", async () => {
    const calls: string[] = [];
    const query = vi.fn(async (sql: string) => {
      calls.push(sql);
      if (sql.startsWith("WITH target AS")) return { rows: [{ id: 4 }], rowCount: 1 };
      if (sql.includes("INSERT INTO audit_logs")) throw new Error("simulated audit failure");
      if (sql.includes("INSERT INTO fee_payment_notification_outbox")) return { rows: [{ id: 5 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    expect(await enqueueFinancePaymentNotificationsSafely(
      { query }, 31, 4, "PAYMENT_VERIFIED",
    )).toEqual({ queued: true });
    expect(calls).toContain("ROLLBACK TO SAVEPOINT fee_payment_notification_delivery");
    expect(calls.some((sql) => sql.includes("INSERT INTO fee_payment_notification_outbox"))).toBe(true);
  });

  it("propagates initial outbox persistence failure before attempting delivery", async () => {
    const calls: string[] = [];
    const query = vi.fn(async (sql: string) => {
      calls.push(sql);
      if (sql.includes("INSERT INTO fee_payment_notification_outbox")) throw new Error("outbox unavailable");
      return { rows: [], rowCount: 0 };
    });
    await expect(enqueueFinancePaymentNotificationsSafely(
      { query }, 31, 4, "PAYMENT_VERIFIED",
    )).rejects.toBeInstanceOf(FinanceNotificationSettlementSafetyError);
    expect(calls.some((sql) => sql.includes("INSERT INTO fee_payment_notification_outbox"))).toBe(true);
    expect(calls).not.toContain("SAVEPOINT fee_payment_notification_delivery");
    expect(calls.some((sql) => sql.startsWith("WITH target AS"))).toBe(false);
  });

  it("rejects an ineligible event when no durable intent was inserted or already exists", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("INSERT INTO fee_payment_notification_outbox")) return { rows: [], rowCount: 0 };
      if (sql.includes("SELECT id FROM fee_payment_notification_outbox")) return { rows: [] };
      return { rows: [], rowCount: 0 };
    });
    await expect(enqueueFinancePaymentNotificationsSafely(
      { query }, 31, 4, "PROVIDER_CHECKOUT_PROCESSING",
    )).rejects.toBeInstanceOf(FinanceNotificationSettlementSafetyError);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("SELECT id FROM fee_payment_notification_outbox"),
      [31, 4, "PROVIDER_CHECKOUT_PROCESSING", 0],
    );
  });

  it("propagates savepoint setup failure for caller transaction rollback", async () => {
    const calls: string[] = [];
    const query = vi.fn(async (sql: string) => {
      calls.push(sql);
      if (sql.startsWith("SAVEPOINT fee_payment_notification_delivery")) {
        throw new Error("savepoint unavailable");
      }
      return { rows: [], rowCount: 0 };
    });
    await expect(enqueueFinancePaymentNotificationsSafely(
      { query }, 31, 4, "PAYMENT_VERIFIED",
    )).rejects.toBeInstanceOf(FinanceNotificationSettlementSafetyError);
    expect(calls.some((sql) => sql.includes("INSERT INTO fee_payment_notification_outbox"))).toBe(true);
    expect(calls.some((sql) => sql.startsWith("WITH target AS"))).toBe(false);
  });

  it("retries pending events and removes the outbox row only after enqueue", async () => {
    const calls: string[] = [];
    const pending = {
      id: 9, payment_id: 31, school_id: 4, event_type: "REFUND_APPROVED",
      event_reference_id: 57, metadata: { refundId: 57, amountMinor: 2000 },
    };
    const clientQuery = vi.fn(async (sql: string) => {
      calls.push(sql);
      if (sql.startsWith("SELECT id,payment_id,school_id,event_type,event_reference_id,metadata")) {
        return { rows: [pending] };
      }
      if (sql.startsWith("WITH target AS")) return { rows: [{ id: 1 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const db = {
      query: vi.fn(async (sql: string) => {
        calls.push(sql);
        return { rows: [pending], rowCount: 1 };
      }),
      connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() })),
    };
    await retryPendingFinancePaymentNotifications(db, [4]);
    expect(calls).toContain("DELETE FROM fee_payment_notification_outbox WHERE id=$1 AND school_id=$2");
    expect(clientQuery).toHaveBeenCalledWith(
      expect.stringContaining("SELECT id,payment_id,school_id,event_type,event_reference_id,metadata"),
      [9, 4],
    );
  });

  it("retries an injected terminal provider-failure delivery without changing the event identity", async () => {
    const pending = {
      id: 12, payment_id: 32, school_id: 4, event_type: "PROVIDER_PAYMENT_FAILED",
      event_reference_id: 0, metadata: { provider: "PAYSTACK" },
    };
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const clientQuery = vi.fn(async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql.startsWith("SELECT id,payment_id,school_id,event_type,event_reference_id,metadata")) {
        return { rows: [pending], rowCount: 1 };
      }
      if (sql.startsWith("WITH target AS")) return { rows: [{ id: 88 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const db = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values });
        return { rows: [pending], rowCount: 1 };
      }),
      connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() })),
    };
    await retryPendingFinancePaymentNotifications(db, [4]);
    expect(calls.some(({ sql, values }) =>
      sql.startsWith("WITH target AS") && values?.[2] === "PROVIDER_PAYMENT_FAILED",
    )).toBe(true);
    expect(calls.some(({ sql, values }) =>
      sql.includes("DELETE FROM fee_payment_notification_outbox WHERE id=$1 AND school_id=$2")
        && values?.[0] === 12 && values?.[1] === 4,
    )).toBe(true);
  });

  it("treats outbox retry connection failure as best-effort", async () => {
    const db = {
      query: vi.fn(async () => ({
        rows: [{
          id: 9, payment_id: 31, school_id: 4, event_type: "PAYMENT_VERIFIED",
          event_reference_id: 0, metadata: {},
        }],
        rowCount: 1,
      })),
      connect: vi.fn(async () => { throw new Error("pool temporarily unavailable"); }),
    };
    await expect(retryPendingFinancePaymentNotifications(db, [4])).resolves.toBeUndefined();
  });
});