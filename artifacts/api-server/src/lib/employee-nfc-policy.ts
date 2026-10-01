export type EmployeeNfcPersonType = "TEACHER" | "STAFF";

/** Student records can never be coerced into a staff record or card binding. */
export function employeeNfcPersonType(value: unknown): EmployeeNfcPersonType | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized === "TEACHER") return "TEACHER";
  if (normalized === "STAFF") return "STAFF";
  return null;
}

/** Caller/device identity assertions must match the employee record exactly. */
export function employeeNfcIdentityMatches(
  actualPersonType: unknown,
  claimedPersonType: unknown,
) {
  const actual = employeeNfcPersonType(actualPersonType);
  const claimed = employeeNfcPersonType(claimedPersonType);
  return actual !== null && actual === claimed;
}

/**
 * Employee/card status does not imply a paid term entitlement. Fail closed on
 * unknown provider/subscription states and require server-verified payment.
 */
export function isVerifiedCurrentTermNfcEntitlement(input: {
  paymentStatus?: unknown;
  verificationStatus?: unknown;
  providerVerifiedAt?: unknown;
}) {
  const paid = String(input.paymentStatus ?? "").trim().toUpperCase() === "PAID";
  const providerStatus = String(input.verificationStatus ?? "").trim().toUpperCase();
  if (providerStatus && !["VERIFIED", "SUCCEEDED"].includes(providerStatus)) return false;
  const verified =
    providerStatus === "VERIFIED" ||
    providerStatus === "SUCCEEDED" ||
    (input.providerVerifiedAt instanceof Date &&
      Number.isFinite(input.providerVerifiedAt.getTime())) ||
    (typeof input.providerVerifiedAt === "string" &&
      input.providerVerifiedAt.trim().length > 0 &&
      Number.isFinite(new Date(input.providerVerifiedAt).getTime()));
  return paid && verified;
}

export function employeeNfcCardActionStatus(
  value: unknown,
): "ACTIVE" | "LOCKED" | "DEACTIVATED" | null {
  switch (String(value ?? "").trim().toUpperCase()) {
    case "ACTIVATE":
      return "ACTIVE";
    case "LOCK":
      return "LOCKED";
    case "DEACTIVATE":
      return "DEACTIVATED";
    default:
      return null;
  }
}

/** Only a 24-hour numeric UTC offset is accepted when parsing report periods. */
export function validEmployeeNfcIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value
    : null;
}