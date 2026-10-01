import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  AllocationBreakdown, canPay, isVerifiedPaid, nairaMinor, parseCallbackParams, parseNairaToMinor, safeCheckoutUrl, validateRuleAmounts,
} from './staff-nfc-billing';

const rule = { priceMinor: 200000, schoolShareMinor: 80000, platformShareMinor: 110000, partnerCommissionMinor: 10000, noPartnerPlatformShareMinor: 120000 };

describe('staff NFC billing helpers', () => {
  it('formats money exactly', () => {
    expect(nairaMinor(200000)).toBe('₦2,000.00');
    expect(parseNairaToMinor('2000.5')).toBe(200050);
    expect(parseNairaToMinor('abc')).toBeNull();
  });

  it('accepts the default rule and both Partner branches sum to the price', () => {
    expect(validateRuleAmounts(rule)).toEqual([]);
    expect(rule.schoolShareMinor + rule.platformShareMinor + rule.partnerCommissionMinor).toBe(rule.priceMinor);
    expect(rule.schoolShareMinor + rule.noPartnerPlatformShareMinor).toBe(rule.priceMinor);
  });

  it('rejects invalid sums', () => {
    expect(validateRuleAmounts({ ...rule, platformShareMinor: 100000 }).length).toBe(1);
    expect(validateRuleAmounts({ ...rule, noPartnerPlatformShareMinor: 100000 }).length).toBe(1);
    expect(validateRuleAmounts({ ...rule, priceMinor: 0 }).length).toBeGreaterThan(0);
    expect(validateRuleAmounts({ ...rule, schoolShareMinor: -1 }).length).toBeGreaterThan(0);
  });

  it('only redirects to server https checkout URLs', () => {
    expect(safeCheckoutUrl('https://checkout.flutterwave.com/v3/hosted/pay/abc')).toContain('flutterwave');
    expect(safeCheckoutUrl('javascript:alert(1)')).toBeNull();
    expect(safeCheckoutUrl('http://evil.example/x')).toBeNull();
    expect(safeCheckoutUrl(null)).toBeNull();
  });

  it('callback parameters never imply paid; identity comes from server status', () => {
    const cb = parseCallbackParams('?status=successful&tx_ref=REF1&transaction_id=998');
    expect(cb).toEqual({ reference: 'REF1', transactionId: '998', providerStatus: 'successful' });
    expect(isVerifiedPaid({ status: 'PENDING' })).toBe(false);
    expect(isVerifiedPaid({ status: 'PAID' })).toBe(true);
    expect(canPay({ status: 'PAID' })).toBe(false);
    expect(canPay({ status: 'UNPAID' })).toBe(true);
  });
});

describe('allocation display', () => {
  const allocations = [
    { recipientType: 'SCHOOL', recipientId: 1, amountMinor: 80000, currency: 'NGN' },
    { recipientType: 'PLATFORM', recipientId: null, amountMinor: 120000, currency: 'NGN' },
    { recipientType: 'PLATFORM_PROVIDER_FEE', recipientId: null, amountMinor: 3000, currency: 'NGN' },
  ] as never;

  it('owner sees all lines including provider fee as separate expense', () => {
    const html = renderToStaticMarkup(<AllocationBreakdown allocations={allocations} />);
    expect(html).toContain('₦800.00');
    expect(html).toContain('Platform');
    expect(html).toContain('Provider fee (platform expense)');
  });

  it('school scope hides platform-confidential lines', () => {
    const html = renderToStaticMarkup(<AllocationBreakdown allocations={allocations} showAll={false} />);
    expect(html).toContain('School');
    expect(html).not.toContain('Platform');
    expect(html).not.toContain('Provider fee');
  });
});
