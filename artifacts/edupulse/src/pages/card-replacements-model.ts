export const REPLACEMENT_FEE_MINOR = 200000;
export const formatNairaMinor = (minor: number) => `₦${(minor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export type ReplacementActor = { owner: boolean; roles: string[] };
export function replacementPermissions({ owner, roles }: ReplacementActor) {
  const has = (r: string) => !owner && roles.includes(r);
  return {
    canView: owner || ['SCHOOL_ADMIN', 'PARENT', 'STUDENT'].some(has),
    canRequest: ['SCHOOL_ADMIN', 'PARENT', 'STUDENT'].some(has),
    canPay: has('PARENT'),
    canIssue: owner,
  };
}
export function canIssueRequest(req: { status: string; paymentStatus: string }, actor: ReplacementActor) {
  return replacementPermissions(actor).canIssue && req.status === 'REQUESTED' && req.paymentStatus === 'PAID';
}
export function replacementStatusLabel(req: { status: string; paymentStatus: string }) {
  if (req.status === 'ISSUED') return 'Issued';
  return req.paymentStatus === 'PAID' ? 'Paid, awaiting Owner issuance' : 'Awaiting payment';
}
export function preparedUnassignedCards<T extends { status: string }>(cards: T[]) {
  return cards.filter(c => String(c.status).toLowerCase() === 'unassigned');
}
export const idempotencyKeyFor = (requestId: number) => `card-replacement-${requestId}-${REPLACEMENT_FEE_MINOR}`;
