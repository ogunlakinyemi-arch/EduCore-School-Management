// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ role: 'ACCOUNTANT', owner: false, verify: vi.fn() }));
vi.mock('@clerk/react', async original => ({
  ...await original<typeof import('@clerk/react')>(),
  useAuth: () => ({ userId: 'fixture' }),
}));
vi.mock('@workspace/api-client-react', async original => ({
  ...await original<typeof import('@workspace/api-client-react')>(),
  useGetAuthorizedContext: () => ({ data: {
    isPlatformOwner: state.owner,
    roles: [{ role: state.role, schoolId: state.owner ? null : 7, status: 'ACTIVE' }],
  } }),
  useVerifyStudentSubscriptionPayment: () => ({ mutateAsync: state.verify }),
}));
vi.mock('@/components/assisted-nfc-payment', () => ({ AssistedNfcPayment: () => null }));
import { StudentNfcObligationsPanel, getStudentNfcObligationsQueryKey } from './student-nfc-obligations';
import { CurrentSubscriptionPolicy } from './current-subscription-policy';
import { NfcServiceBranding } from './nfc-service-branding';
import partnerSource from '@/pages/partner/portal.tsx?raw';

describe('current policy versus retained financial records', () => {
  it.each(['SCHOOL_ADMIN', 'ACCOUNTANT', 'PLATFORM_OWNER', 'PARENT'])(
    'retains original paid and unpaid amounts without offering obsolete checkout for %s', role => {
      state.role = role; state.owner = role === 'PLATFORM_OWNER'; state.verify.mockClear();
      const client = new QueryClient();
      const base = {
        schoolId: 7, schoolName: 'Fictional School', className: 'Class A', section: '',
        sessionId: 11, termId: 12, sessionName: '2026/2027', termName: 'First term',
        amountMinor: 500000, ordinaryFeesMinor: 100000, totalMinor: 600000,
        schoolAllocatedMinor: 300000, platformAllocatedMinor: 190000, partnerAllocatedMinor: 10000,
        canPay: true, paymentMethod: 'FLUTTERWAVE', eligible: true,
      };
      const rows = ['PAID', 'UNPAID', 'LEGACY_REVIEW'].map((status, i) => ({
        ...base, studentId: i + 1, studentName: `Fictional student ${i + 1}`,
        subscriptionId: i + 10, status, reference: `HISTORICAL-${i}`, legacyInvoiceId: 99,
      }));
      const original = structuredClone(rows);
      const identity = `fixture:${state.owner ? 'owner' : 'user'}:${role}@${state.owner ? 0 : 7}`;
      client.setQueryData(getStudentNfcObligationsQueryKey(identity, { studentId: undefined, schoolId: 7 }), { rows });
      const html = renderToStaticMarkup(<QueryClientProvider client={client}>
        <StudentNfcObligationsPanel schoolId={7} manageReturn={false} />
      </QueryClientProvider>);
      expect(html).toContain('NFC payment and obligation history');
      const document = new DOMParser().parseFromString(html, 'text/html');
      const recordCards = document.querySelectorAll('[data-testid^="nfc-row-"]');
      expect(recordCards).toHaveLength(3);
      for (const card of recordCards) expect(card.textContent).toContain('₦5,000');
      expect(html).toContain('Original recorded NFC amount');
      expect(html).toContain('Separate school fees');
      expect(html).toContain('HISTORICAL-0');
      expect(html).not.toContain('Ordinary fees + NFC');
      expect(html).not.toContain('button-pay-nfc');
      expect(html).not.toContain('button-live-nfc');
      expect(rows).toEqual(original);
      expect(state.verify).not.toHaveBeenCalled();
      if (role === 'PARENT') expect(html).not.toContain('₦3,200');
      client.clear();
    },
  );
  it('explains the fixed platform price separately from school-controlled fees and original history', () => {
    const html = renderToStaticMarkup(<CurrentSubscriptionPolicy />);
    for (const text of ['₦3,200', 'parent-facing NFC/card fee', 'no school allocation',
      'current term remains free', 'January 2027 second term',
      'independently server-verified', 'Unpaid obligations are not silently repriced']) expect(html).toContain(text);
    expect(html).not.toContain('BRO commission');
    expect(html).not.toContain('₦150');
    const ownerHtml = renderToStaticMarkup(<CurrentSubscriptionPolicy showInternal />);
    expect(ownerHtml).toContain('₦150');
    expect(ownerHtml).toContain('not a checkout split or an automatic transfer');
  });
  it('removes configurable platform-arrangement copy without showing platform prices in shared family branding', () => {
    const html = renderToStaticMarkup(<NfcServiceBranding />);
    expect(html).toContain('Schools control only their own parent-facing fees');
    expect(html).not.toContain('configured payment arrangements');
    expect(html).not.toContain('₦3,200');
  });
  it('routes the remaining BRO split URL to an archive rather than operational legacy controls', () => {
    expect(partnerSource).toContain('path="/partner/flutterwave-settlements" component={ArchivedPaymentWorkflowPage}');
    expect(partnerSource).not.toContain('FlutterwaveSettlementsPage');
    expect(partnerSource).not.toContain('Split settlement account (Development TEST)');
  });
});
