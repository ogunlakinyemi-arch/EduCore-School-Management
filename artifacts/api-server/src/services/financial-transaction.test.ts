import { describe, expect, it, vi } from "vitest";
import { beginFinancialTransaction, FINANCIAL_TRANSACTION_GATE_SQL, requireFeeAllocationTrigger } from "./financial-transaction";

describe("financial transaction boundary", () => {
  it("acquires the same transaction gate immediately after BEGIN", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    await beginFinancialTransaction({ query });
    expect(query.mock.calls).toEqual([["BEGIN"], [FINANCIAL_TRANSACTION_GATE_SQL]]);
  });
  it("does not proceed when gate acquisition fails", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [] }).mockRejectedValueOnce(new Error("gate unavailable"));
    await expect(beginFinancialTransaction({ query })).rejects.toThrow("gate unavailable");
    expect(query).toHaveBeenCalledTimes(2);
  });
  it.each([{ rows: [] }, { rows: [{ ready: false }] }, { rows: [{ ready: null }] }])("fails closed without the sole allocation trigger: %j", async ({ rows }) => {
    await expect(requireFeeAllocationTrigger({ query: vi.fn(async () => ({ rows })) }))
      .rejects.toThrow("verification blocked");
  });
  it("accepts the enabled allocation trigger contract", async () => {
    await expect(requireFeeAllocationTrigger({ query: vi.fn(async () => ({ rows: [{ ready: true }] })) }))
      .resolves.toBeUndefined();
  });
});
