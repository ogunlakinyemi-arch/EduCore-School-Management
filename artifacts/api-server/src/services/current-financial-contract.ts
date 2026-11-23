/**
 * Current student payments only. These ports are server-injected capabilities,
 * never request-body proofs. No default HTTP transport or background job exists.
 */
export type CurrentSql = {
  query(sql: string, values?: any[]): Promise<{rows: any[]}>;
};
export type CurrentPool = {connect(): Promise<CurrentSql & {release(): void}>};
export type CurrentSource = number | {allocationId:number};
export type CurrentEntitlement = number | {bulkEntitlementId:number};
export const sourceOf = (row:any):CurrentSource => row.allocation_id
  ?{allocationId:Number(row.allocation_id)}:Number(row.attempt_id??row.direct_attempt_id);
export const sourceColumns = (source:CurrentSource) => typeof source==="number"
  ?{attemptId:source}:{allocationId:source.allocationId};
export class CurrentFinancialBlocked extends Error {
  constructor(public code: string) { super(code); }
}
export function demand(value: unknown, code: string): asserts value {
  if (!value) throw new CurrentFinancialBlocked(code);
}
export function positiveMinor(value: number) {
  demand(Number.isSafeInteger(value) && value > 0, "INVALID_AMOUNT_MINOR");
}
export function requestKey(value: string) {
  demand(/^[A-Za-z0-9_-]{16,100}$/.test(value), "INVALID_IDEMPOTENCY_KEY");
}
export type Outcome = "PENDING" | "SUCCEEDED" | "FAILED" | "REVERSED";
export type RefundFacts = {
  requestReference: string; collectionTransactionId: string; providerReference: string;
  amountMinor: number; currency: string; status: Outcome;
};
export type PayoutFacts = {
  requestReference: string; providerReference: string; amountMinor: number;
  currency: string; bankFingerprint: string; status: Outcome;
  evidenceReference: string;
};
export type FrozenBank = {
  fingerprint: string; sealed: {ciphertext: string; keyVersion: string};
  maskedAccountNumber: string; verified: true;
};
export type CurrentCapabilities = {
  now?: () => Date;
  // Only an explicitly approved, correlation-capable provider adapter may be injected.
  refunds?: {
    validate?:(input:{amountMinor:number})=>void;
    request(input: {reference: string; collectionTransactionId: string; amountMinor: number}): Promise<void | {providerReference:string}>;
    verify(reference: string): Promise<RefundFacts>;
  };
  collectionReversal?: (eventReference: string) => Promise<RefundFacts>;
  bank?: (c: CurrentSql, partnerId: number) => Promise<FrozenBank | null>;
  payoutEvidence?: (reference: string) => Promise<PayoutFacts>;
  recoveryEvidence?: (reference: string) => Promise<PayoutFacts>;
};
