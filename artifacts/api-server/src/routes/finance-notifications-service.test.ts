import { describe, expect, it, vi } from "vitest";
import { enqueueVerifiedFeePaymentNotifications } from "./finance-notifications-service";

describe("verified fee payment notification enqueue", () => {
  it("resolves only active in-school recipients and is idempotent per role/event", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }], rowCount: 2 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    const created = await enqueueVerifiedFeePaymentNotifications({ query }, 31, 4);

    expect(created).toBe(2);
    const insertSql = query.mock.calls[0][0];
    expect(insertSql).toContain("p.school_id=$2 AND p.status='VERIFIED'");
    expect(insertSql).toContain("pa.school_id=t.school_id");
    expect(insertSql).toContain("rel.status='ACTIVE'");
    expect(insertSql).toContain("m.school_id=t.school_id");
    expect(insertSql).toContain("m.status='ACTIVE'");
    expect(insertSql).toContain("u.status='ACTIVE'");
    expect(insertSql).toContain("ON CONFLICT (payment_id,recipient_user_id,recipient_role,event_type) DO NOTHING");
    expect(query.mock.calls[0][1]).toEqual([31, 4]);
    expect(query.mock.calls[1][0]).toContain("FEE_PAYMENT_NOTIFICATION");
    expect(query.mock.calls[1][1]).toEqual([4, 31, {
      createdCount: 2, eventType: "PAYMENT_VERIFIED", channel: "IN_APP",
    }]);
  });

  it("does not add an audit write if every idempotency key already exists", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await enqueueVerifiedFeePaymentNotifications({ query }, 31, 4)).toBe(0);
    expect(query).toHaveBeenCalledTimes(1);
  });
});