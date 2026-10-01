import type { StudentSubscriptionPayment } from '@workspace/api-client-react';

export type StudentCheckoutAttempt = {
  requestedSubscriptionId: number;
  idempotencyKey: string;
  payment: StudentSubscriptionPayment | null;
  providerTransactionId: string | null;
};

const CHECKOUTS_KEY = 'edupulse.student-subscription-checkouts';
const KEY_PREFIX = 'edupulse.student-subscription-idempotency';
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,120}$/;

export function safeStudentCheckoutUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null;
  } catch {
    return null;
  }
}

export function parseFlutterwaveReturn(search: string): {
  reference: string | null;
  providerTransactionId: string | null;
} {
  const query = new URLSearchParams(search);
  const reference = query.get('tx_ref');
  const providerTransactionId = query.get('transaction_id');
  return {
    reference: reference && /^[A-Za-z0-9_-]{8,100}$/.test(reference) ? reference : null,
    providerTransactionId: providerTransactionId && /^[0-9]{1,16}$/.test(providerTransactionId)
      ? providerTransactionId
      : null,
  };
}

export function findCheckoutForFlutterwaveReturn(
  search: string,
  attempts: StudentCheckoutAttempt[],
): { attempt: StudentCheckoutAttempt; providerTransactionId: string } | null {
  const callback = parseFlutterwaveReturn(search);
  if (!callback.reference || !callback.providerTransactionId) return null;
  const attempt = attempts.find(item => item.payment?.reference === callback.reference);
  return attempt ? { attempt, providerTransactionId: callback.providerTransactionId } : null;
}

export function checkoutEvidenceMatchesServer(
  attempt: StudentCheckoutAttempt,
  payment: StudentSubscriptionPayment,
  schoolId: number,
): boolean {
  return !!attempt.payment
    && attempt.requestedSubscriptionId === payment.subscriptionId
    && attempt.payment.paymentId === payment.paymentId
    && attempt.payment.subscriptionId === payment.subscriptionId
    && attempt.payment.reference === payment.reference
    && payment.schoolId === schoolId;
}

export function loadStudentCheckoutAttempts(
  schoolId: number,
  storage: Pick<Storage, 'getItem'> = window.sessionStorage,
): StudentCheckoutAttempt[] {
  try {
    const raw = storage.getItem(`${CHECKOUTS_KEY}:${schoolId}`);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is StudentCheckoutAttempt => {
      if (!item || typeof item !== 'object') return false;
      const attempt = item as Partial<StudentCheckoutAttempt>;
      return Number.isSafeInteger(attempt.requestedSubscriptionId)
        && typeof attempt.idempotencyKey === 'string'
        && IDEMPOTENCY_KEY_PATTERN.test(attempt.idempotencyKey)
        && (attempt.payment === null || (!!attempt.payment
          && typeof attempt.payment === 'object'
          && Number.isSafeInteger(attempt.payment.paymentId)
          && Number.isSafeInteger(attempt.payment.subscriptionId)
          && typeof attempt.payment.reference === 'string'))
        && (attempt.providerTransactionId === null
          || (typeof attempt.providerTransactionId === 'string' && /^[0-9]{1,16}$/.test(attempt.providerTransactionId)));
    });
  } catch {
    return [];
  }
}

export function saveStudentCheckoutAttempts(
  schoolId: number,
  attempts: StudentCheckoutAttempt[],
  storage: Pick<Storage, 'setItem'> = window.sessionStorage,
): void {
  storage.setItem(`${CHECKOUTS_KEY}:${schoolId}`, JSON.stringify(attempts));
}

export function getStudentCheckoutIdempotencyKey(
  schoolId: number,
  subscriptionId: number,
  storage: Pick<Storage, 'getItem' | 'setItem'> = window.sessionStorage,
  keyFactory: () => string = () => {
    const cryptoApi = globalThis.crypto;
    return typeof cryptoApi?.randomUUID === 'function'
      ? cryptoApi.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  },
  rotate = false,
): string {
  const storageKey = `${KEY_PREFIX}:${schoolId}:${subscriptionId}`;
  const existing = storage.getItem(storageKey);
  if (!rotate && existing && IDEMPOTENCY_KEY_PATTERN.test(existing)) return existing;

  const key = `student-sub-${schoolId}-${subscriptionId}-${keyFactory()}`;
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) throw new Error('Could not create a valid checkout idempotency key.');
  storage.setItem(storageKey, key);
  return key;
}

export function isServerConfirmedPaid(payment?: Pick<StudentSubscriptionPayment, 'status'> | null): boolean {
  return payment?.status === 'PAID';
}

export function isPaymentStatusPolling(payment?: Pick<StudentSubscriptionPayment, 'status'> | null): boolean {
  return payment?.status === 'PENDING' || payment?.status === 'RECONCILIATION_REQUIRED';
}