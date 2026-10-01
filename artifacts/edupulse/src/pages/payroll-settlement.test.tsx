import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { IdentityBoundary, OutcomeBadge, ProviderBanner, SettlementHistoryTable, netOf, toMinor, transferOutcome } from './payroll-common';

describe('payroll and settlement safety', () => {
  it('keeps company and school identity separate', () => {
    expect(renderToStaticMarkup(<IdentityBoundary scope="COMPANY" />)).toContain('Yemait company funds');
    const school = renderToStaticMarkup(<IdentityBoundary scope="SCHOOL" />);
    expect(school).toContain('School funds');
    expect(school).toContain('separate from Yemait company money');
  });
  it('never presents pending, mock, unknown or unverified transfers as paid', () => {
    for (const s of ['PENDING', 'MOCK_PENDING', 'PROCESSING', 'CLAIMED', 'UNCERTAIN', 'RECONCILIATION_REQUIRED', 'UNPAID']) {
      expect(transferOutcome(s).label.toLowerCase()).not.toContain('provider verified');
    }
    expect(transferOutcome('PAID', false).tone).toBe('PENDING');
    expect(transferOutcome('PAID', true).label).toBe('Paid - provider verified');
    expect(renderToStaticMarkup(<OutcomeBadge status="MOCK_PENDING" />)).toContain('no funds moved');
  });
  it('shows an explicit mock banner and blocked state', () => {
    expect(renderToStaticMarkup(<ProviderBanner mode="MOCK" />)).toContain('No actual funds are moved');
    expect(renderToStaticMarkup(<ProviderBanner mode="NOT_CONFIGURED" />)).toContain('not configured');
  });
  it('does not count unverified settlement history as settled', () => {
    const html = renderToStaticMarkup(<SettlementHistoryTable rows={[{ id: 1, scope: 'SCHOOL', grossAmountMinor: 100000, amountSettledMinor: 100000, currency: 'NGN', status: 'SUCCESS', reconciliationStatus: 'PENDING', externalSettlementVerified: false, occurredAt: '2025-01-01T00:00:00Z' } as never]} />);
    expect(html).toContain('Not verified');
    expect(html).toContain('Unverified');
  });
  it('computes net pay in minor units with signed adjustments', () => {
    expect(toMinor('1500.50')).toBe(150050);
    expect(toMinor('-20', true)).toBe(-2000);
    expect(Number.isNaN(toMinor('abc'))).toBe(true);
    expect(netOf(500000, 20000, 10000, 5000, -1000)).toBe(524000);
  });
});
