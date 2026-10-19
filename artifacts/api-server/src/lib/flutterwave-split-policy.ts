import { AuthError } from "../middlewares/auth";
import { studentAllocationPolicy, type StudentAllocationVersion } from "./student-allocation-policy";

export type FixedSplitInstruction = {
  id: string;
  transaction_charge_type: "flat_subaccount";
  transaction_charge: number;
};
export function isSplitDevelopment() {
  return process.env.NODE_ENV === "development" && !process.env.REPLIT_DEPLOYMENT;
}
export function requireSplitDevelopment() {
  if (!isSplitDevelopment()) throw new AuthError(404, "Split settlement is Development-only");
}
export function fixedSplitInstructions(school: string, partner: string | null, version: StudentAllocationVersion = 1): FixedSplitInstruction[] {
  const policy = studentAllocationPolicy(`SCV${version}_`);
  const ids = [school, ...(partner && !policy.deferredPartner ? [partner] : [])];
  if (ids.some(id => !/^RS_[A-Za-z0-9]{12,80}$/.test(id)) || new Set(ids).size !== ids.length) {
    throw new AuthError(409, "Distinct verified recipient IDs are required");
  }
  return ids.map((id, index) => ({
    id, transaction_charge_type: "flat_subaccount", transaction_charge: index === 0 ? policy.schoolMinor / 100 : 100,
  }));
}
export function ngnMinor(value: unknown): number {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(value));
  if (!match) throw new AuthError(409, "Invalid provider monetary evidence");
  const result = Number(BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0") || "0"));
  if (!Number.isSafeInteger(result)) throw new AuthError(409, "Provider amount is out of range");
  return result;
}
/** Cumulative rounding: replay and successive partial refunds conserve every kobo. */
export function cumulativeRefundShares(totalRefundMinor: number, hasPartner: boolean, version: StudentAllocationVersion = 1) {
  if (!Number.isSafeInteger(totalRefundMinor) || totalRefundMinor < 0 || totalRefundMinor > 500000) {
    throw new AuthError(409, "Refund exceeds the payment");
  }
  const policy = studentAllocationPolicy(`SCV${version}_`);
  const school = Math.floor(totalRefundMinor * policy.schoolMinor / 500000);
  const partner = hasPartner ? Math.floor(totalRefundMinor * 10000 / 500000) : 0;
  return { school, partner, platform: totalRefundMinor - school - partner };
}
