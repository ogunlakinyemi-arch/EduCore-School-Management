/** Immutable checkout references select the policy; old checkouts never change. */
export type StudentAllocationVersion = 1 | 2;
const CURRENT_STUDENT_ALLOCATION_VERSION: StudentAllocationVersion = 2;
export function studentAllocationPolicy(reference?: string) {
  const version: StudentAllocationVersion = reference?.startsWith("SCV2_") ? 2 : 1;
  return allocationPolicyVersion(version);
}
function allocationPolicyVersion(version: StudentAllocationVersion) {
  return {
    version,
    schoolMinor: version === 2 ? 190_000 : 200_000,
    platformWithPartnerMinor: version === 2 ? 300_000 : 290_000,
    platformWithoutPartnerMinor: version === 2 ? 310_000 : 300_000,
    partnerMinor: 10_000,
  };
}
/** Current-policy summaries are separate from immutable payment references. */
export function currentStudentAllocationPolicy() {
  return allocationPolicyVersion(CURRENT_STUDENT_ALLOCATION_VERSION);
}
export function newStudentPaymentReference(reference: string) {
  if (!/^[A-Za-z0-9_-]{8,95}$/.test(reference)) throw new Error("Invalid generated student payment reference");
  return `SCV${CURRENT_STUDENT_ALLOCATION_VERSION}_${reference}`;
}
