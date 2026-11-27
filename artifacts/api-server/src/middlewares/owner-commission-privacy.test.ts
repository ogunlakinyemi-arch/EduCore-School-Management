import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ reads: vi.fn() }));
vi.mock("./auth", () => ({
  getUserContext: (req: express.Request) => (req as any).testContext,
  requireAuthentication: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    const role = req.header("x-test-role") ?? "PARENT";
    (req as any).testContext = {
      user: { status: req.header("x-test-inactive") ? "INACTIVE" : "ACTIVE" },
      roles: [{ role, status: req.header("x-test-inactive-role") ? "INACTIVE" : "ACTIVE", schoolId: role === "PLATFORM_OWNER" ? null : 7 }],
    };
    next();
  },
}));
import privacy, { withoutBroFinancialData } from "./owner-commission-privacy";
import { requireAuthentication } from "./auth";
const app = express();
app.use(requireAuthentication());
app.use(privacy);
app.get("/school/finance/overview", (_req, res) => {
  state.reads();
  res.json({ schoolTotalMinor: 320000, commissionAmountMinor: 15000,
    nested: { partnerShareMinor: 10000, allocations: [
      { recipientType: "SCHOOL", amountMinor: 250000 },
      { recipientType: "PARTNER", amountMinor: 10000 },
    ] }, school: { name: "Fictional School" } });
});
app.get("/partner/dashboard", (_req, res) => { state.reads(); res.json({ referredSchools: 2, outstandingCommission: 150 }); });
app.get("/partner/commissions", (_req, res) => { state.reads(); res.json([{ amountMinor: 15000 }]); });
let server: ReturnType<typeof app.listen>;
let url = "";
beforeAll(async () => new Promise<void>(resolve => {
  server = app.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (address && typeof address === "object") url = `http://127.0.0.1:${address.port}`;
    resolve();
  });
}));
afterAll(async () => new Promise<void>((resolve, reject) =>
  server.close(error => error ? reject(error) : resolve()),
));
const get = (path: string, role: string, inactive = false, inactiveRole = false) =>
  fetch(`${url}${path}`, { headers: { "x-test-role": role, ...(inactive ? { "x-test-inactive": "1" } : {}),
    ...(inactiveRole ? { "x-test-inactive-role": "1" } : {}) } });
describe("Owner-only BRO financial visibility", () => {
  it.each(["SCHOOL_ADMIN", "ACCOUNTANT", "TEACHER", "STUDENT", "PARENT", "PARTNER"])(
    "strips commission fields and denies guessed commission URLs to %s before handler calls", async role => {
      const overview = await get("/school/finance/overview", role);
      expect(overview.status).toBe(200);
      const body = await overview.json() as any;
      expect(body.schoolTotalMinor).toBe(320000);
      expect(body.school.name).toBe("Fictional School");
      expect(JSON.stringify(body)).not.toMatch(/commission|partnerShare|PARTNER|15000|10000/i);
      const dash = await get("/partner/dashboard", role);
      expect(await dash.json()).toEqual({ referredSchools: 2 });
      for (const path of [
        "/partner/commissions", "/partner/deferred-commissions", "/partner/staff-nfc/commissions",
        "/partner/payouts", "/partner/payout-information",
      ]) {
        state.reads.mockClear();
        const response = await get(path, role);
        expect(response.status).toBe(404);
        expect(state.reads).not.toHaveBeenCalled();
      }
    },
  );
  it("preserves full Owner results and denies inactive Owner membership", async () => {
    const response = await get("/school/finance/overview", "PLATFORM_OWNER");
    const body = await response.json() as any;
    expect(body.commissionAmountMinor).toBe(15000);
    expect(body.nested.partnerShareMinor).toBe(10000);
    expect(body.nested.allocations).toHaveLength(2);
    const inactive = await get("/school/finance/overview", "PLATFORM_OWNER", true);
    expect(JSON.stringify(await inactive.json())).not.toContain("commission");
    const inactiveMembership = await get("/school/finance/overview", "PLATFORM_OWNER", false, true);
    expect(JSON.stringify(await inactiveMembership.json())).not.toContain("commission");
  });
  it("retains ordinary fee fields while masking BRO recipient lists without changing inputs", () => {
    const original = { feeAmountMinor: 500000, partner_share_minor: 15000, bro_share_minor: 15000, allocations: [
      { recipientType: "SCHOOL", amountMinor: 350000 },
      { recipientType: "PARTNER", amountMinor: 15000 },
    ] };
    expect(withoutBroFinancialData(original)).toEqual({ feeAmountMinor: 500000,
      allocations: [{ recipientType: "SCHOOL", amountMinor: 350000 }] });
    expect(original.allocations).toHaveLength(2);
  });
  it("keeps school operational prices and settlement totals but omits internal platform/provider allocations",()=>{
    const input={feeAmountMinor:500000,schoolTotalMinor:500000,settlementAmountMinor:350000,
      platformShareMinor:135000,platformNetMinor:120000,platform_amount_minor:135000,
      providerFeeMinor:15000,internalPartnerAccrualMinor:15000,broAccrualPending:true,
      allocations:[{recipientType:"SCHOOL",amountMinor:350000},{recipientType:"PLATFORM",amountMinor:135000},
        {recipientType:"PLATFORM_PROVIDER_FEE",amountMinor:15000},{recipientType:"PARTNER",amountMinor:15000}]};
    expect(withoutBroFinancialData(input)).toEqual({feeAmountMinor:500000,schoolTotalMinor:500000,settlementAmountMinor:350000,
      allocations:[{recipientType:"SCHOOL",amountMinor:350000}]});
    expect(input.allocations).toHaveLength(4);
  });
});
