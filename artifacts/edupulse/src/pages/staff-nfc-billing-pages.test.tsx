import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const st = vi.hoisted(() => ({ roles: [] as Array<{ role: string; schoolId: number | null; status: string }>, owner: false, catalogCalls: 0, idle: () => ({ data: undefined as unknown, isLoading: false, isError: false, refetch: () => {}, mutate: () => {}, isPending: false }) }));
const idle = st.idle;

vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@/components/shared', async () => {
  const R = await import('react');
  const Pass = ({ children }: { children?: unknown }) => R.createElement('div', null, children as never);
  return {
    Button: ({ children, testId, disabled }: { children?: unknown; testId?: string; disabled?: boolean }) => R.createElement('button', { 'data-testid': testId, disabled }, children as never),
    EmptyState: ({ title }: { title: string }) => R.createElement('div', { 'data-testid': 'empty' }, title),
    ErrorState: Pass, Field: Pass, Info: Pass, Modal: Pass, SkeletonPage: Pass, TenantPicker: () => null,
    PageHeading: ({ title }: { title: string }) => R.createElement('h1', null, title),
    cx: (...p: Array<string | false | undefined | null>) => p.filter(Boolean).join(' '),
    date: (v?: string | null) => v ?? '-', useTenant: () => ({ schoolId: 7, setSchoolId: () => {} }),
  };
});
vi.mock('@workspace/api-client-react', () => {
  const idle = st.idle;
  const sub = { id: 5, status: 'UNPAID', priceMinor: 200000, dueDate: '2025-01-10', paidAt: null, cardStatus: 'NONE', isEligibleForNfc: false, sessionName: '2024/25', termName: 'First', latestPayment: null };
  const k = () => ['k'];
  return {
    useGetAuthorizedContext: () => ({ data: { isPlatformOwner: st.owner, roles: st.roles }, isLoading: false }),
    useGetMyStaffNfcSubscriptions: () => ({ ...idle(), data: { employee: { id: 1 }, currentSession: { academicSessionName: '2024/25' }, currentTerm: { academicTermName: 'First' }, currentSubscription: sub, nextSubscription: null, subscriptions: [sub] } }),
    useGetMyEmployeeNfcProfile: () => idle(),
    useCreateStaffNfcCheckout: idle, useVerifyMyStaffNfcPayment: idle, useGenerateStaffNfcTermSubscriptions: idle,
    useGetStaffNfcReceipt: idle, useListStaffNfcBillingRules: idle, useCreateStaffNfcBillingRule: idle, useListStaffNfcFinance: idle,
    useRequestStaffNfcRefund: idle, useReconcileStaffNfcPayment: idle,
    useGetMyStaffNfcPartnerCommissions: () => ({ ...idle(), data: { partnerId: 1, totals: { eligibleSubscriptionCount: 0, pendingCommissionMinor: 0, paidCommissionMinor: 0, commissionAmountMinor: 0 }, items: [], nextCursor: null } }),
    useListAcademicSessions: () => { st.catalogCalls++; throw new Error('catalog denied'); },
    useListAcademicTerms: () => { st.catalogCalls++; throw new Error('catalog denied'); },
    useListOwnerSchoolDirectory: idle,
    getGetMyEmployeeNfcProfileQueryKey: k, getGetMyStaffNfcSubscriptionsQueryKey: k, getListStaffNfcBillingRulesQueryKey: k,
    getListStaffNfcFinanceQueryKey: k, getGetMyStaffNfcPartnerCommissionsQueryKey: k, getListAcademicSessionsQueryKey: k,
    getListAcademicTermsQueryKey: k, getListOwnerSchoolDirectoryQueryKey: k, getGetStaffNfcReceiptQueryKey: k,
  };
});

import { MyStaffNfcSubscriptionPage, PartnerStaffNfcCommissionsPage } from './staff-nfc-billing';

describe('staff NFC page guards', () => {
  beforeEach(() => { st.catalogCalls = 0; st.owner = false; });

  it('STAFF self page renders and offers Pay without any academic catalog query', () => {
    st.roles = [{ role: 'STAFF', schoolId: 7, status: 'ACTIVE' }];
    const html = renderToStaticMarkup(<MyStaffNfcSubscriptionPage />);
    expect(html).toContain('button-pay-subscription');
    expect(html).toContain('2024/25');
    expect(st.catalogCalls).toBe(0);
  });

  it('Partner page renders for an active PARTNER only', () => {
    st.roles = [{ role: 'PARTNER', schoolId: null, status: 'ACTIVE' }];
    expect(renderToStaticMarkup(<PartnerStaffNfcCommissionsPage />)).toContain('partner-totals');
  });

  it.each([
    [[{ role: 'COMPANY_ACCOUNTANT', schoolId: null, status: 'ACTIVE' }, { role: 'PARTNER', schoolId: null, status: 'ACTIVE' }]],
    [[{ role: 'DEVICE_ACTIVATION_OFFICER', schoolId: null, status: 'ACTIVE' }]],
    [[{ role: 'STAFF', schoolId: 7, status: 'ACTIVE' }]],
    [[{ role: 'PARTNER', schoolId: null, status: 'INACTIVE' }]],
  ])('Partner page denies other roles', roles => {
    st.roles = roles;
    const html = renderToStaticMarkup(<PartnerStaffNfcCommissionsPage />);
    expect(html).toContain('Not available for this session');
    expect(html).not.toContain('partner-totals');
  });

  it('Owner is denied the Partner and self pages', () => {
    st.owner = true; st.roles = [{ role: 'PLATFORM_OWNER', schoolId: null, status: 'ACTIVE' }];
    expect(renderToStaticMarkup(<PartnerStaffNfcCommissionsPage />)).toContain('Not available');
    expect(renderToStaticMarkup(<MyStaffNfcSubscriptionPage />)).toContain('Not available');
  });
});
