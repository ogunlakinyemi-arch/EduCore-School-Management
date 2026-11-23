/**
 * Current student payments only. These ports are server-injected capabilities,
 * never request-body proofs. No default HTTP transport or background job exists.
 */
export type CurrentSql = {
  query(sql: string, values?: any[]): Promise<{rows: any[]}>;
};
export type CurrentPool = {connect(): Promise<CurrentSql & {release(): void}>};
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
    request(input: {reference: string; collectionTransactionId: string; amountMinor: number}): Promise<void>;
    verify(reference: string): Promise<RefundFacts>;
  };
  collectionReversal?: (eventReference: string) => Promise<RefundFacts>;
  bank?: (c: CurrentSql, partnerId: number) => Promise<FrozenBank | null>;
  payoutEvidence?: (reference: string) => Promise<PayoutFacts>;
  recoveryEvidence?: (reference: string) => Promise<PayoutFacts>;
};
