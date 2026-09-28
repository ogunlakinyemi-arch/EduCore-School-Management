import { AuthError } from "../middlewares/auth";

export function payableAmount(requestedMinor: number, outstandingMinor: number) {
  if (!Number.isSafeInteger(requestedMinor) || requestedMinor <= 0) {
    throw new AuthError(400, "Payment amount must be a positive integer number of minor currency units");
  }
  if (!Number.isSafeInteger(outstandingMinor) || outstandingMinor < 0 || requestedMinor > outstandingMinor) {
    throw new AuthError(409, "Payment exceeds the current outstanding invoice amount");
  }
  return requestedMinor;
}

export function invoiceStatus(paidMinor: number, totalMinor: number) {
  if (totalMinor === 0) return "WAIVED";
  if (paidMinor >= totalMinor) return "PAID";
  if (paidMinor > 0) return "PARTIALLY_PAID";
  return "UNPAID";
}