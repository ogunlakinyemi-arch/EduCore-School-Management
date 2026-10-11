import { afterEach, describe, expect, it, vi } from 'vitest';
import { nfcPaymentError, safeFlutterwaveUrl } from './public-nfc-payment';
afterEach(() => vi.unstubAllEnvs());
describe('Public NFC link error messages', () => {
  it('permits the exact observed hosted TEST URL only in a Development build', () => {
    const url = 'https://checkout-v2.dev-flutterwave.com/v3/hosted/pay/fixture-link';
    vi.stubEnv('DEV', true); vi.stubEnv('PROD', false);
    expect(safeFlutterwaveUrl(url)).toBe(url);
    vi.stubEnv('DEV', false); vi.stubEnv('PROD', true);
    expect(safeFlutterwaveUrl(url)).toBeNull();
  });
  it.each([
    'http://checkout-v2.dev-flutterwave.com/v3/hosted/pay/fixture',
    'https://checkout-v2.dev-flutterwave.com.evil.test/v3/hosted/pay/fixture',
    'https://evil.dev-flutterwave.com/v3/hosted/pay/fixture',
    'https://key@checkout-v2.dev-flutterwave.com/v3/hosted/pay/fixture',
    'https://checkout-v2.dev-flutterwave.com:8443/v3/hosted/pay/fixture',
    'https://checkout-v2.dev-flutterwave.com/other',
  ])('rejects unsafe or unrelated sandbox links: %s', url => {
    vi.stubEnv('DEV', true); vi.stubEnv('PROD', false);
    expect(safeFlutterwaveUrl(url)).toBeNull();
  });
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
