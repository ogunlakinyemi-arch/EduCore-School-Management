import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ pool: { query: vi.fn() } }));

import { splitFinancialSummary } from "./flutterwave-split-reporting";

describe("current TEST split financial summary", () => {
  const currentPayment = {
    reference:"SCV3_financial_summary_fixture",
    school_amount_minor:190_000,
    platform_amount_minor:300_000,
    partner_amount_minor:10_000,
    partner_profile_id:71,
    provider_fee_minor:5_000,
    provider_additional_fee_minor:2_000,
  };

  it("separates merchant cash, Owner economic net, costs, and internal Partner accrual", () => {
    expect(splitFinancialSummary(currentPayment,[],{amount:"100.00",currency:"NGN",status:"PENDING"}))
      .toEqual({
        providerFeesMinor:7_000,
        providerTaxMinor:null,
        merchantGrossMinor:310_000,
        merchantNetMinor:303_000,
        merchantNetStatus:"CALCULATED_BEFORE_REFUNDS_NOT_BANK_SETTLEMENT",
        confirmedRefundMinor:0,
        internalPartnerAccrualMinor:10_000,
        internalPartnerAccrualStatus:"PENDING",
        platformNetMinor:293_000,
      });
  });

  it("does not invent a Partner accrual or provider taxes", () => {
    expect(splitFinancialSummary({
      ...currentPayment,platform_amount_minor:310_000,partner_amount_minor:0,partner_profile_id:null,
    },[],null)).toMatchObject({
      merchantGrossMinor:310_000,merchantNetMinor:303_000,
      internalPartnerAccrualMinor:0,internalPartnerAccrualStatus:"NOT_ELIGIBLE",
      providerTaxMinor:null,
    });
  });

  it("leaves merchant net unknown when any provider cost component is missing", () => {
    expect(splitFinancialSummary({
      ...currentPayment,provider_additional_fee_minor:null,
    },[],{amount:"100.00",currency:"NGN",status:"PENDING"})).toMatchObject({
      providerFeesMinor:null,merchantNetMinor:null,merchantNetStatus:"PROVIDER_COSTS_INCOMPLETE",
      platformNetMinor:null,
    });
  });

  it("keeps historical Partner checkout allocations out of the new internal-payable model", () => {
    expect(splitFinancialSummary({
      reference:"SCV2_financial_summary_fixture",
      school_amount_minor:190_000,platform_amount_minor:300_000,partner_amount_minor:10_000,
      partner_profile_id:71,provider_fee_minor:0,provider_additional_fee_minor:0,
    },[],{amount:"100.00",currency:"NGN",status:"PENDING"})).toMatchObject({
      merchantGrossMinor:300_000,internalPartnerAccrualMinor:0,
      internalPartnerAccrualStatus:"NOT_CURRENT_POLICY",
    });
  });

  it("reports confirmed refunds separately without pretending recipient recovery or bank credit", () => {
    expect(splitFinancialSummary(currentPayment,[{
      amount_minor:50_000,status:"CONFIRMED",platform_reversal_minor:31_000,
    }],{amount:"100",currency:"NGN",status:"HELD"})).toMatchObject({
      merchantGrossMinor:310_000,merchantNetMinor:303_000,confirmedRefundMinor:50_000,
      internalPartnerAccrualStatus:"HELD",platformNetMinor:262_000,
    });
  });
});
