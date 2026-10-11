import { describe, expect, it } from 'vitest';
import { nfcPaymentError, safeFlutterwaveUrl } from './public-nfc-payment';
describe('Public NFC link error messages', () => {
  it.each([400, 404])('explains invalid/unknown links for HTTP %s', status => {
    expect(nfcPaymentError({ status })).toContain('Ask the school for a new link');
  });
  it('shows safe review/expired/used messages supplied by the server', () => {
    expect(nfcPaymentError({ status: 409, data: { error: 'This TEST payment link is not available for checkout' } }))
      .toBe('This TEST payment link is not available for checkout');
  });
  it('does not expose raw server errors, stack traces or false payment success', () => {
    const text = nfcPaymentError({ status: 500, data: { error: 'private stack and secret details' } });
    expect(text).toContain('No payment has been confirmed');
    expect(text).not.toContain('private'); expect(text).not.toContain('HTTP 500');
  });
  it('reports unavailable TEST configuration without leaking keys', () => {
    expect(nfcPaymentError({ status: 503 })).toContain('Development configuration');
  });
  it('only permits safe Flutterwave checkout URLs', () => {
    expect(safeFlutterwaveUrl('https://checkout.flutterwave.com/v3/test')).toBeTruthy();
    expect(safeFlutterwaveUrl('https://evil.example.test')).toBeNull();
    expect(safeFlutterwaveUrl('https://key@checkout.flutterwave.com')).toBeNull();
  });
});
