import { describe, expect, it } from "vitest";
import {
  SubmitManualBankTransferBody,
  SubmitManualBankTransferHeader,
} from "@workspace/api-zod";
import { AuthError } from "../middlewares/auth";
import { invoiceStatus, payableAmount } from "./finance-money";

describe("school fee money and request validation", () => {
  it("accepts only positive integer minor-unit payments not exceeding current outstanding", () => {
    expect(payableAmount(250_000, 300_000)).toBe(250_000);
    expect(payableAmount(300_000, 300_000)).toBe(300_000);
    expect(() => payableAmount(300_001, 300_000)).toThrow(AuthError);
    expect(() => payableAmount(1.5, 300_000)).toThrow(AuthError);
    expect(() => payableAmount(0, 300_000)).toThrow(AuthError);
  });

  it("derives invoice paid state only from verified monetary amounts", () => {
    expect(invoiceStatus(0, 100_000)).toBe("UNPAID");
    expect(invoiceStatus(25_000, 100_000)).toBe("PARTIALLY_PAID");
    expect(invoiceStatus(100_000, 100_000)).toBe("PAID");
    expect(invoiceStatus(0, 0)).toBe("WAIVED");
  });

  it("rejects malformed transfer payloads and missing idempotency keys", () => {
    expect(SubmitManualBankTransferBody.safeParse({
      amountMinor: 400.25,
      bank: "A",
      transferReference: "x",
      transferDate: "not-a-date",
    }).success).toBe(false);
    expect(SubmitManualBankTransferBody.safeParse({
      amountMinor: 40_000,
      bank: "Sample Bank",
      transferReference: "TRF-9921",
      transferDate: "2026-09-02",
    }).success).toBe(true);
    expect(SubmitManualBankTransferHeader.safeParse({ "Idempotency-Key": "short" }).success).toBe(false);
    expect(SubmitManualBankTransferHeader.safeParse({ "Idempotency-Key": "transfer-req-2026-01" }).success).toBe(true);
  });
});