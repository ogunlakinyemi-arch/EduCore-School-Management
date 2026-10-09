import { describe, expect, it } from 'vitest';
import { safeFlutterwaveUrl } from './public-nfc-payment';
import { canManageNfcPaymentLink } from '../components/nfc-payment-link-controls';

const row = { schoolId: 446, subscriptionId: 193, status: 'UNPAID' as const };
const context = (role: string, schoolId = 446, status = 'ACTIVE') => ({
  isPlatformOwner: false, roles: [{ role, schoolId, status }],
});
describe('NFC payment-link UI boundaries', () => {
  it.each(['SCHOOL_ADMIN', 'ACCOUNTANT'])('permits active %s only in the correct school', role => {
    expect(canManageNfcPaymentLink(context(role), row)).toBe(true);
    expect(canManageNfcPaymentLink(context(role, 447), row)).toBe(false);
    expect(canManageNfcPaymentLink(context(role, 446, 'INACTIVE'), row)).toBe(false);
  });
  it.each(['PARENT', 'STUDENT', 'TEACHER', 'STAFF', 'PARTNER'])('denies generation to %s', role => {
    expect(canManageNfcPaymentLink(context(role), row)).toBe(false);
  });
  it('keeps a dual-role platform Owner read-only', () => {
    expect(canManageNfcPaymentLink({ ...context('SCHOOL_ADMIN'), isPlatformOwner: true }, row)).toBe(false);
  });
  it.each(['PAID', 'EXEMPT', 'LEGACY_REVIEW'] as const)('does not charge a %s obligation', status => {
    expect(canManageNfcPaymentLink(context('SCHOOL_ADMIN'), { ...row, status })).toBe(false);
  });
  it('requires an existing subscription', () => {
    expect(canManageNfcPaymentLink(context('SCHOOL_ADMIN'), { ...row, subscriptionId: null })).toBe(false);
    expect(canManageNfcPaymentLink(undefined, row)).toBe(false);
  });
  it.each(['https://evil.test', 'http://checkout.flutterwave.com/pay', 'https://checkout.flutterwave.com.evil.test',
    'https://user:password@checkout.flutterwave.com/pay', 'javascript:alert(1)'])('rejects %s', url => {
    expect(safeFlutterwaveUrl(url)).toBeNull();
  });
  it('accepts only an actual HTTPS Flutterwave checkout URL', () => {
    expect(safeFlutterwaveUrl('https://checkout.flutterwave.com/pay/test')).toBe('https://checkout.flutterwave.com/pay/test');
  });
});
