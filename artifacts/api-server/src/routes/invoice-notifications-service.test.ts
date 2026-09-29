import { describe, expect, it, vi } from "vitest";
import {
  enqueueInvoiceGeneratedNotifications,
  enqueueInvoiceGeneratedNotificationsSafely,
  retryPendingInvoiceNotifications,
} from "./invoice-notifications-service";

describe("invoice generated notification delivery", () => {
  it("delivers idempotently only to active same-school linked recipients", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ eligible_count: 2, created_count: 2 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    expect(await enqueueInvoiceGeneratedNotifications({ query }, 77, 4)).toEqual({ eligibleCount: 2, createdCount: 2 });
    const insert = query.mock.calls[0][0];
    expect(insert).toContain("i.id=$1 AND i.school_id=$2");
    expect(insert).toContain("pa.school_id=t.school_id");
    expect(insert).toContain("rel.status='ACTIVE'");
    expect(insert).toContain("pa.status='ACTIVE'");
    expect(insert).toContain("m.school_id=t.school_id");
    expect(insert).toContain("m.role IN ('SCHOOL_ADMIN','ACCOUNTANT')");
    expect(insert).toContain("u.status='ACTIVE'");
    expect(insert).toContain("ON CONFLICT (school_id,invoice_id,recipient_user_id,recipient_role,event_type) DO NOTHING");
    expect(query.mock.calls[0][1]).toEqual([77, 4]);
    expect(query.mock.calls[1][0]).toContain("FEE_INVOICE_NOTIFICATION");
  });

  it("does not audit or duplicate if the invoice recipient key already exists", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ eligible_count: 2, created_count: 0 }], rowCount: 1 });
    expect(await enqueueInvoiceGeneratedNotifications({ query }, 77, 4)).toEqual({ eligibleCount: 2, createdCount: 0 });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("keeps the outbox row when delivery fails inside its savepoint", async () => {
    const calls: string[] = [];
    const query = vi.fn(async (sql: string) => {
      calls.push(sql);
      if (sql.includes("INSERT INTO fee_invoice_notifications")) throw new Error("temporary delivery failure");
      return { rows: [], rowCount: 0 };
    });
    expect(await enqueueInvoiceGeneratedNotificationsSafely({ query }, 77, 4)).toEqual({ queued: true });
    expect(calls.findIndex(sql => sql.includes("INSERT INTO fee_invoice_notification_outbox")))
      .toBeLessThan(calls.indexOf("SAVEPOINT fee_invoice_notification_delivery"));
    expect(calls).toContain("ROLLBACK TO SAVEPOINT fee_invoice_notification_delivery");
    expect(calls).toContain("RELEASE SAVEPOINT fee_invoice_notification_delivery");
    expect(calls.some(sql => sql.startsWith("DELETE FROM fee_invoice_notification_outbox"))).toBe(false);
  });

  it("retains a zero-recipient outbox intent and backs off before retry", async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql.startsWith("WITH target AS")) {
        return { rows: [{ eligible_count: 0, created_count: 0 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    expect(await enqueueInvoiceGeneratedNotificationsSafely({ query }, 77, 4)).toEqual({ queued: true });
    expect(calls.some(({ sql }) => sql.includes("INSERT INTO fee_invoice_notification_outbox"))).toBe(true);
    const defer = calls.find(({ sql }) => sql.startsWith("UPDATE fee_invoice_notification_outbox"))!;
    expect(defer.sql).toContain("attempts=attempts+1");
    expect(defer.sql).toContain("INTERVAL '15 seconds' * POWER(2,LEAST(attempts,8))");
    expect(defer.sql).toContain("last_error=$3");
    expect(defer.values).toEqual([77, 4, "No active eligible recipients; delivery deferred"]);
    expect(calls.some(({ sql }) => sql.startsWith("DELETE FROM fee_invoice_notification_outbox"))).toBe(false);
  });

  it("retries a pending outbox event and clears it only after delivery succeeds", async () => {
    const pending = { id: 19, invoice_id: 77, school_id: 4 };
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const clientQuery = vi.fn(async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql.startsWith("SELECT id,invoice_id,school_id")) return { rows: [pending], rowCount: 1 };
      if (sql.startsWith("WITH target AS")) return { rows: [{ eligible_count: 2, created_count: 1 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const db = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values });
        return { rows: [pending], rowCount: 1 };
      }),
      connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() })),
    };
    await retryPendingInvoiceNotifications(db, [4]);
    expect(calls.some(({ sql, values }) =>
      sql.includes("school_id=ANY($1::integer[])") && (values?.[0] as number[] | undefined)?.[0] === 4,
    )).toBe(true);
    expect(calls.some(({ sql, values }) =>
      sql.startsWith("SELECT id,invoice_id,school_id") && sql.includes("FOR UPDATE SKIP LOCKED")
        && values?.[0] === 19 && values?.[1] === 4)).toBe(true);
    expect(calls.some(({ sql }) => sql === "DELETE FROM fee_invoice_notification_outbox WHERE id=$1 AND school_id=$2")).toBe(true);
    expect(calls.some(({ sql }) => sql.startsWith("UPDATE fee_invoice_notification_outbox"))).toBe(false);
  });

  it("keeps retrying when no one is eligible, then delivers once after linkage appears", async () => {
    const pending = { id: 21, invoice_id: 77, school_id: 4 };
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const initialQuery = vi.fn(async (sql: string) => {
      calls.push({ sql });
      if (sql.startsWith("WITH target AS")) return { rows: [{ eligible_count: 0, created_count: 0 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    expect(await enqueueInvoiceGeneratedNotificationsSafely({ query: initialQuery }, 77, 4)).toEqual({ queued: true });
    expect(calls.some(({ sql }) => sql.startsWith("UPDATE fee_invoice_notification_outbox"))).toBe(true);

    let linked = false;
    let outboxPending = true;
    const clientQuery = vi.fn(async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql.startsWith("SELECT id,invoice_id,school_id")) return { rows: [pending], rowCount: 1 };
      if (sql.startsWith("WITH target AS")) {
        return { rows: [{ eligible_count: linked ? 2 : 0, created_count: linked ? 2 : 0 }], rowCount: 1 };
      }
      if (sql.startsWith("DELETE FROM fee_invoice_notification_outbox")) outboxPending = false;
      return { rows: [], rowCount: 1 };
    });
    const db = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values });
        return { rows: outboxPending ? [pending] : [], rowCount: outboxPending ? 1 : 0 };
      }),
      connect: vi.fn(async () => ({ query: clientQuery, release: vi.fn() })),
    };

    await retryPendingInvoiceNotifications(db, [4]);
    expect(calls.some(({ sql }) => sql.startsWith("UPDATE fee_invoice_notification_outbox"))).toBe(true);
    expect(outboxPending).toBe(true);

    // The next due retry sees the newly active same-school parent/admin memberships.
    linked = true;
    await retryPendingInvoiceNotifications(db, [4]);
    expect(outboxPending).toBe(false);
    const deliveryQueries = calls.filter(({ sql }) => sql.startsWith("WITH target AS"));
    expect(deliveryQueries).toHaveLength(3); // initial enqueue, no-link retry, linked retry
    expect(deliveryQueries[2].sql).toContain("ON CONFLICT (school_id,invoice_id,recipient_user_id,recipient_role,event_type) DO NOTHING");
    await retryPendingInvoiceNotifications(db, [4]);
    expect(deliveryQueries).toHaveLength(3);
  });
});