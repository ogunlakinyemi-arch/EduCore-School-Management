import { describe, expect, it } from 'vitest';
import type { StudentSubscriptionPayment } from '@workspace/api-client-react';
import {
  checkoutEvidenceMatchesServer,
  findCheckoutForFlutterwaveReturn,
  getStudentCheckoutIdempotencyKey,
  isPaymentStatusPolling,
  isServerConfirmedPaid,
  loadStudentCheckoutAttempts,
  parseFlutterwaveReturn,
  safeStudentCheckoutUrl,
  saveStudentCheckoutAttempts,
  type StudentCheckoutAttempt,
} from './subscription-payment-helpers';

const payment = {
  paymentId: 12,
  subscriptionId: 91,
  schoolId: 7,
  studentId: 44,
  sessionId: 2025,
  termId: 3,
  payerUserId: 88,
  provider: 'FLUTTERWAVE',
  providerMode: 'SANDBOX',
  reference: 'PERSISTED_REF_123',
  status: 'PENDING',
  grossAmountMinor: 500000,
  currency: 'NGN',
  settlementStatus: 'PENDING',
  reconciliationStatus: 'PENDING',
  checkoutUrl: null,
} as StudentSubscriptionPayment;

describe('student subscription payment helpers', () => {
  it('accepts only server-provided HTTPS checkout destinations', () => {
    expect(safeStudentCheckoutUrl('https://checkout.flutterwave.com/pay/abc')).toContain('https://');
    expect(safeStudentCheckoutUrl('http://checkout.example/pay')).toBeNull();
    expect(safeStudentCheckoutUrl('javascript:alert(1)')).toBeNull();
    expect(safeStudentCheckoutUrl('https://user:pass@checkout.example/pay')).toBeNull();
  });

  it('extracts Flutterwave IDs but does not treat the provider status as success', () => {
    expect(parseFlutterwaveReturn('?status=successful&tx_ref=PERSISTED_REF_123&transaction_id=9876')).toEqual({
      reference: 'PERSISTED_REF_123',
      providerTransactionId: '9876',
    });
    expect(parseFlutterwaveReturn('?status=successful&tx_ref=OTHER_REF_123&transaction_id=nope'))
      .toEqual({ reference: 'OTHER_REF_123', providerTransactionId: null });
    expect(isServerConfirmedPaid(payment)).toBe(false);
    expect(isServerConfirmedPaid({ status: 'PAID' })).toBe(true);
    expect(isPaymentStatusPolling(payment)).toBe(true);
    expect(isPaymentStatusPolling({ status: 'RECONCILIATION_REQUIRED' })).toBe(true);
    expect(isPaymentStatusPolling({ status: 'FAILED' })).toBe(false);
  });

  it('maps callback reference only to previously persisted server checkout evidence', () => {
    const attempt: StudentCheckoutAttempt = {
      requestedSubscriptionId: 91,
      idempotencyKey: 'student-sub-7-91-fixed-key',
      payment,
      providerTransactionId: null,
    };
    expect(findCheckoutForFlutterwaveReturn(
      '?status=successful&tx_ref=PERSISTED_REF_123&transaction_id=9876',
      [attempt],
    )).toEqual({ attempt, providerTransactionId: '9876' });
    expect(findCheckoutForFlutterwaveReturn(
      '?tx_ref=CLIENT_SELECTED_123&transaction_id=9876',
      [attempt],
    )).toBeNull();
    expect(checkoutEvidenceMatchesServer(attempt, payment, 7)).toBe(true);
    expect(checkoutEvidenceMatchesServer(attempt, { ...payment, schoolId: 8 }, 7)).toBe(false);
    expect(checkoutEvidenceMatchesServer(attempt, { ...payment, reference: 'CLIENT_REF_123' }, 7)).toBe(false);
  });

  it('reuses the stable key for the same checkout and rotates only on an explicit next request', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    const first = getStudentCheckoutIdempotencyKey(7, 91, storage, () => 'attempt-one');
    const duplicate = getStudentCheckoutIdempotencyKey(7, 91, storage, () => 'must-not-be-used');
    const explicitRetry = getStudentCheckoutIdempotencyKey(7, 91, storage, () => 'attempt-two', true);
    expect(first).toBe('student-sub-7-91-attempt-one');
    expect(duplicate).toBe(first);
    expect(explicitRetry).toBe('student-sub-7-91-attempt-two');
  });

  it('persists pending payment evidence for callbacks and status polling', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    };
    const attempt: StudentCheckoutAttempt = {
      requestedSubscriptionId: 91,
      idempotencyKey: 'student-sub-7-91-fixed-key',
      payment,
      providerTransactionId: '9876',
    };
    saveStudentCheckoutAttempts(7, [attempt], storage);
    expect(loadStudentCheckoutAttempts(7, storage)).toEqual([attempt]);
  });
});