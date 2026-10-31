import { describe, it, expect, vi, beforeEach } from "vitest";
const state = vi.hoisted(() => ({ accrue: vi.fn() }));
vi.mock("./bro-commission-policy", async original => ({
  ...await original<typeof import("./bro-commission-policy")>(),
  accrueBroCommissionInTransaction: state.accrue,
}));
import { accrueVerifiedSubscriptionBro } from "./verified-subscription-bro-accrual";
const source = { schoolId: 1, studentId: 31, termId: 4, id: 9,
  email: "fixture@example.test", clerkUserId: "fixture-approver" };
function fixture(hasVerifiedSource = true) {
  const query = vi.fn(async (sql: string, _values?: unknown[]) => ({
    rows: sql.includes("SELECT o.school_id") && hasVerifiedSource ? [source] : [],
  }));
  return { query };
}
beforeEach(() => state.accrue.mockReset());
describe("verified subscription automatic BRO accrual transaction", () => {
  it("uses immutable verified source scope, never a caller-supplied Owner identity", async () => {
    const c = fixture();
    state.accrue.mockResolvedValue({ id: 7, amountMinor: 15000, existing: false });
    expect(await accrueVerifiedSubscriptionBro(c, 8)).toMatchObject({ amountMinor: 15000 });
    expect(state.accrue).toHaveBeenCalledWith(c, { schoolId: 1, studentId: 31, termId: 4 },
      { id: 9, email: source.email, clerkUserId: source.clerkUserId }, true);
    const sql = c.query.mock.calls.map(([sql]) => sql).join("\n");
    expect(sql).toContain("a.state='PAID'");
    expect(sql).toContain("PROVIDER_PAYMENT_VERIFIED");
    expect(sql).not.toMatch(/transfer|partner_payout|UPDATE|DELETE/i);
  });
  it("creates no commission without a verified PAID source and keeps the payment transaction intact", async () => {
    const c = fixture(false);
    expect(await accrueVerifiedSubscriptionBro(c, 8)).toBeNull();
    expect(state.accrue).not.toHaveBeenCalled();
    expect(c.query.mock.calls.map(([sql]) => sql)).toContain("ROLLBACK TO SAVEPOINT verified_subscription_bro");
    expect(c.query.mock.calls.some(([, values]) => values?.[1] === "BRO_COMMISSION_ACCRUAL_REVIEW")).toBe(true);
  });
  it("records a failed accrual attempt without undoing verification, then safely retries the same scope", async () => {
    const c = fixture();
    state.accrue.mockRejectedValueOnce(new Error("fictional audit failure"))
      .mockResolvedValueOnce({ id: 7, amountMinor: 15000, existing: false })
      .mockResolvedValueOnce({ id: 7, amountMinor: 15000, existing: true });
    expect(await accrueVerifiedSubscriptionBro(c, 8)).toBeNull();
    expect(await accrueVerifiedSubscriptionBro(c, 8)).toEqual({ id: 7, amountMinor: 15000, existing: false });
    expect(await accrueVerifiedSubscriptionBro(c, 8)).toEqual({ id: 7, amountMinor: 15000, existing: true });
    const calls = c.query.mock.calls;
    expect(calls.filter(([, values]) => values?.[1] === "BRO_COMMISSION_ACCRUAL_REVIEW")).toHaveLength(1);
    expect(calls.map(([sql]) => sql)).not.toContain("ROLLBACK");
    expect(calls.map(([sql]) => sql)).not.toContain("COMMIT");
  });
});
