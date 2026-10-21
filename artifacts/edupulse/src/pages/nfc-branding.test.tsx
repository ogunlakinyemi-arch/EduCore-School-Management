import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NfcPaymentLink } from '@workspace/api-client-react';

const renderState = vi.hoisted(() => ({ calls: 0, link: null as NfcPaymentLink | null }));
vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    useState: () => [[ 'private-fixture-token', renderState.link, '', false ][renderState.calls++], vi.fn()],
  };
});
import PublicNfcPaymentPage from './public-nfc-payment';
import { NfcServiceBranding } from '../components/nfc-service-branding';

const fixture: NfcPaymentLink = {
  reference: 'NFC_fixture', schoolName: 'Fixture School', studentName:'Fixture Student', studentIdentifier: 'STUDENT-001',
  termName: 'First term', sessionName: '2026/2027', amountMinor: 500000, amountDueMinor: 500000,
  currency: 'NGN', mode: 'DEVELOPMENT_SIMULATION', status: 'PENDING',
  expiresAt: '2026-10-16T12:00:00.000Z', settlementStatus: 'UNVERIFIED',
  subscriptionActivated: false, checkoutUrl: null, receiptReference: null,
  expectedAllocations: [{ recipientType: 'SCHOOL', amountMinor: 200000 }, { recipientType: 'PLATFORM', amountMinor: 300000 }],
};
describe('Company branding and unchanged public NFC notices', () => {
  beforeEach(() => { renderState.calls = 0; renderState.link = { ...fixture }; });
  it('identifies the unchanged product, renamed company, service and company domain', () => {
    const html = renderToStaticMarkup(<NfcServiceBranding />);
    expect(html).toContain('Yetenia EduCore');
    expect(html).toContain('YETENIA TECHNOLOGIES LIMITED');
    expect(html).toContain('NFC Student Attendance and School Entry Notifications');
    expect(html).toContain('https://yetenia.com');
    expect(html).toContain('This NFC subscription is provided through Yetenia EduCore, operated by YETENIA TECHNOLOGIES LIMITED. Your payment is processed according to the configured payment arrangements for your school and the platform.');
    expect(html).not.toMatch(/yemait\s+technolog/i);
  });
  it('keeps identifiers, term, fixed fee, reference, status and expiry visible', () => {
    const html = renderToStaticMarkup(<PublicNfcPaymentPage />);
    for (const copy of ['Fixture School', 'Fixture Student', 'STUDENT-001', 'First term', '2026/2027', '5,000.00',
      'NFC_fixture', 'Awaiting payment', 'Expires', 'YETENIA TECHNOLOGIES LIMITED']) expect(html).toContain(copy);
  });
  it('keeps simulation warnings prominent and retains no-account, assistance and cash warnings', () => {
    const html = renderToStaticMarkup(<PublicNfcPaymentPage />);
    expect(html).toContain('Development simulation. No money moves, no real receipt is issued and no subscription is activated.');
    expect(html.indexOf('Development simulation.')).toBeLessThan(html.indexOf('Fixture School'));
    expect(html).toContain('No EduCore account is needed.');
    expect(html).toContain('school staff can assist');
    expect(html).toContain('Cash given to the school does not verify this NFC subscription.');
    expect(html).toContain('Actual bank settlement: unverified.');
    expect(html).not.toContain('Pay on secure checkout');
  });
  it('still labels a simulated success as a test, not a genuine payment', () => {
    renderState.link = { ...fixture, status: 'SIMULATED_SUCCESS' };
    const html = renderToStaticMarkup(<PublicNfcPaymentPage />);
    expect(html).toContain('Test completed (simulation only)');
    expect(html).toContain('The test finished. This is not a payment.');
    expect(html).not.toContain('Simulate success');
    expect(html).not.toContain('Verified receipt reference');
  });
});
