// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadStudentCheckoutAttempts, saveStudentCheckoutAttempts } from './subscription-payment-helpers';

const state = vi.hoisted(() => ({
  schoolId: 7,
  owner: false,
  roles: [{ role: 'ACCOUNTANT', schoolId: 7, status: 'ACTIVE' }] as Array<{ role: string; schoolId: number | null; status: string }>,
  subscriptions: [] as any[],
  paymentResponse: null as any,
  paymentQueryOptions: null as any,
  checkout: vi.fn(),
  getPayment: vi.fn(),
  verify: vi.fn(),
  invalidateQueries: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: state.invalidateQueries }),
  useMutation: ({ mutationFn }: { mutationFn: (args: any) => Promise<unknown> }) => ({
    mutateAsync: (args: any) => mutationFn(args),
    isPending: false,
  }),
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetSchoolBillingContext: () => ({data:{mode:'TEST',schoolId:state.schoolId,actorId:88},isLoading:false,isError:false}),
  createStudentSubscriptionCheckout: (...args: any[]) => state.checkout(...args),
  getStudentSubscriptionPayment: (...args: any[]) => state.getPayment(...args),
  getGetStudentSubscriptionPaymentQueryKey: (subscriptionId: number, paymentId: number) => [`payment:${subscriptionId}:${paymentId}`],
  getListSubscriptionsQueryKey: (params: unknown) => ['/api/subscriptions', params],
  useGetStudentSubscriptionPayment: (subscriptionId: number, _paymentId: number, options: any) => {
    state.paymentQueryOptions = options;
    return {
      data: state.paymentResponse,
      isLoading: subscriptionId > 0 && !state.paymentResponse,
      isError: false,
      refetch: vi.fn(),
    };
  },
  useGetAuthorizedContext: () => ({ data: { user:{id:88},isPlatformOwner: state.owner, roles: state.roles } }),
  useListSubscriptions: () => ({ data: state.subscriptions, isLoading: false, isError: false, refetch: vi.fn() }),
  useVerifyStudentSubscriptionPayment: () => ({ mutateAsync: (args: unknown) => state.verify(args), isPending: false }),
}));

vi.mock('@/components/shared', () => ({
  Button: ({ children, onClick, disabled, testId, className }: any) => <button data-testid={testId} className={className} onClick={onClick} disabled={disabled}>{children}</button>,
  EmptyState: ({ title }: any) => <div>{title}</div>,
  ErrorState: ({ retry }: any) => <button onClick={retry}>Retry list</button>,
  PageHeading: ({ title, action }: any) => <header><h1>{title}</h1>{action}</header>,
  SkeletonPage: () => <div>Loading</div>,
  StatusPill: ({ value }: any) => <span>{value}</span>,
  TenantPicker: () => <button>Tenant picker</button>,
  date: (value?: string | null) => value ?? '-',
  money: (value: number) => `₦${value}`,
  useSchoolAdminAccess: () => ({ isPlatformOwner: state.owner }),
  useTenant: () => ({ schoolId: state.schoolId, setSchoolId: vi.fn() }),
}));

vi.mock('@/components/student-nfc-obligations', () => ({
  StudentNfcObligationsPanel: () => <div data-testid="mock-nfc-panel" />,
  StudentNfcFamilyPage: () => <div data-testid="mock-nfc-family" />,
}));
vi.mock('@/components/owner-free-academic-terms', () => ({
  OwnerFreeAcademicTerms: () => <section id="free-academic-terms" tabIndex={-1} data-testid="mock-owner-free-terms">Free academic terms</section>,
}));

vi.mock('@/components/school-document', () => ({
  SchoolDocumentHeader: ({ branding }: any) => <header data-testid="school-document-header" data-logo-url={branding.logoUrl}>{branding.name}</header>,
  SchoolDocumentPrintButton: ({ children, label, testId }: any) => <div><button data-testid={testId}>{label}</button>{children}</div>,
}));

vi.mock('@/components/current-finance-panel', () => ({ ConnectedFinancePanel: () => null }));
import { SubscriptionsPage, SubscriptionsRoute } from './subscriptions';

const payment = (overrides: Record<string, unknown> = {}) => ({
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
  providerFeeMinor: null,
  settlementAmountMinor: null,
  currency: 'NGN',
  settlementStatus: 'PENDING',
  reconciliationStatus: 'PENDING',
  checkoutUrl: null,
  failureCode: null,
  createdAt: '2025-01-01T00:00:00.000Z',
  paidAt: null,
  ...overrides,
});

const subscription = {
  id: 91,
  schoolId: 7,
  studentId: 44,
  studentName: 'Ari Learner',
  amount: 5000,
  schoolShare: 2000,
  edupulseShare: 3000,
  status: 'pending',
  verificationStatus: 'pending',
  provider: 'flutterwave',
  term: '2025 First',
  expiresAt: '2025-12-31',
};

let host: HTMLDivElement;
let root: Root;

async function renderPage() {
  await act(async () => root.render(<SubscriptionsPage />));
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/subscriptions');
  state.schoolId = 7;
  state.owner = false;
  state.roles = [{ role: 'ACCOUNTANT', schoolId: 7, status: 'ACTIVE' }];
  state.subscriptions = [subscription];
  state.paymentResponse = null;
  state.paymentQueryOptions = null;
  state.checkout = vi.fn();
  state.getPayment = vi.fn(async () => ({ payment: payment(), subscription: {}, allocations: [], activated: false }));
  state.verify = vi.fn(async () => ({ payment: payment(), subscription: {}, allocations: [], activated: false }));
  state.invalidateQueries = vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('trusted student-subscription payment workflow', () => {
  it('puts an accessible free-term shortcut before the Owner subscription view', async () => {
    state.owner = true;
    state.roles = [{role:'PLATFORM_OWNER',schoolId:null,status:'ACTIVE'}];
    await act(async () => root.render(<SubscriptionsRoute />));
    const link=host.querySelector<HTMLAnchorElement>('a[href="#free-academic-terms"]')!;
    const target=host.querySelector<HTMLElement>('#free-academic-terms')!;
    expect(link.textContent).toContain('Jump to Free academic terms');
    expect(host.firstElementChild?.getAttribute('aria-label')).toBe('Subscription sections');
    await act(async () => link.click());
    expect(document.activeElement).toBe(target);
  });

  it('does not offer Owner free-term navigation to a school accountant', async () => {
    await act(async () => root.render(<SubscriptionsRoute />));
    expect(host.querySelector('[data-testid="owner-subscription-shortcut"]')).toBeNull();
    expect(host.querySelector('#free-academic-terms')).toBeNull();
  });

  it('does not accept Flutterwave success status as payment and sends the contract payload only after server lookup', async () => {
    const persistedPayment = payment();
    saveStudentCheckoutAttempts(7, [{
      requestedSubscriptionId: 91,
      idempotencyKey: 'student-sub-7-91-known-key',
      payment: persistedPayment as any,
      providerTransactionId: null,
    }], window.sessionStorage);
    state.paymentResponse = { payment: persistedPayment, subscription: {}, allocations: [], activated: false };
    window.history.replaceState(null, '', '/subscriptions?status=successful&tx_ref=PERSISTED_REF_123&transaction_id=9876');

    await renderPage();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

    expect(state.getPayment).toHaveBeenCalledWith(91, 12);
    expect(state.verify).toHaveBeenCalledWith({
      subscriptionId: 91,
      data: { paymentReference: 'PERSISTED_REF_123', providerTransactionId: '9876' },
    });
    expect(host.textContent).toContain('server reports pending');
    expect(host.textContent).not.toContain('server reports paid');
    expect(window.location.search).toBe('');
  });

  it('cannot verify callback IDs without a saved server checkout mapping', async () => {
    window.history.replaceState(null, '', '/subscriptions?status=successful&tx_ref=CLIENT_REF_123&transaction_id=9876');
    await renderPage();
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });

    expect(state.getPayment).not.toHaveBeenCalled();
    expect(state.verify).not.toHaveBeenCalled();
    expect(host.textContent).toContain('does not match a saved server checkout');
    expect(host.textContent).not.toContain('PAID');
  });

  it('does not display a cached PAID status before a matching server payment response', async () => {
    saveStudentCheckoutAttempts(7, [{
      requestedSubscriptionId: 91,
      idempotencyKey: 'student-sub-7-91-known-key',
      payment: payment({ status: 'PAID' }) as any,
      providerTransactionId: null,
    }], window.sessionStorage);
    state.paymentResponse = null;
    await renderPage();

    expect(host.textContent).toContain('Checking persisted payment status with the server');
    expect(host.textContent).not.toContain('PAID');
    expect(host.textContent).not.toContain('Verified allocations');
  });

  it('uses the generated payment query key for persisted-payment polling', async () => {
    saveStudentCheckoutAttempts(7, [{
      requestedSubscriptionId: 91,
      idempotencyKey: 'student-sub-7-91-known-key',
      payment: payment() as any,
      providerTransactionId: null,
    }], window.sessionStorage);
    state.paymentResponse = { payment: payment(), subscription: {}, allocations: [], activated: false };
    await renderPage();

    expect(state.paymentQueryOptions.query.queryKey).toEqual(['payment:91:12']);
  });

  it('keeps a retained unpaid subscription visible without offering or initiating archived checkout', async () => {
    await renderPage();

    expect(host.textContent).toContain('Ari Learner');
    expect(host.textContent).toContain('₦5000');
    expect(host.textContent).toContain('Legacy checkout archived; reviewed platform rule required');
    expect(host.querySelector('[data-testid="button-checkout-subscription-91"]')).toBeNull();
    expect(host.querySelector('[data-testid="button-continue-checkout-91"]')).toBeNull();
    expect(state.checkout).not.toHaveBeenCalled();
    expect(loadStudentCheckoutAttempts(7, window.sessionStorage)).toEqual([]);
  });

  it('preserves an unknown historical checkout outcome without offering or automatically resending archived checkout', async () => {
    const attempts = [{
      requestedSubscriptionId: 91,
      idempotencyKey: 'student-sub-7-91-unknown-outcome',
      payment: null,
      providerTransactionId: null,
    }];
    saveStudentCheckoutAttempts(7, attempts, window.sessionStorage);
    await renderPage();
    await act(async () => root.unmount());
    root = createRoot(host);
    await renderPage();

    expect(host.textContent).toContain('Legacy checkout archived; reviewed platform rule required');
    expect(host.querySelector('[data-testid="button-checkout-subscription-91"]')).toBeNull();
    expect(state.checkout).not.toHaveBeenCalled();
    expect(state.getPayment).not.toHaveBeenCalled();
    expect(state.verify).not.toHaveBeenCalled();
    expect(loadStudentCheckoutAttempts(7, window.sessionStorage)).toEqual(attempts);
  });

  it.each(['9876', null])('retries the persisted payment without another checkout, redirect ID=%s (mocked API)', async transactionId => {
    const persistedPayment = payment();
    saveStudentCheckoutAttempts(7, [{
      requestedSubscriptionId: 91,
      idempotencyKey: 'student-sub-7-91-known-key',
      payment: persistedPayment as any,
      providerTransactionId: transactionId,
    }], window.sessionStorage);
    state.paymentResponse = { payment: persistedPayment, subscription: {}, allocations: [], activated: false };
    state.verify.mockRejectedValue(new Error('Provider verification is still pending'));
    await renderPage();

    const retry = () => host.querySelector<HTMLButtonElement>('[data-testid="button-retry-verification-12"]')!;
    await act(async () => retry().click());
    await act(async () => retry().click());

    expect(state.getPayment).toHaveBeenCalledTimes(2);
    expect(state.verify).toHaveBeenCalledTimes(2);
    expect(state.verify).toHaveBeenNthCalledWith(1, {
      subscriptionId: 91,
      data: { paymentReference: 'PERSISTED_REF_123', ...(transactionId ? { providerTransactionId: transactionId } : {}) },
    });
    expect(state.verify).toHaveBeenNthCalledWith(2, {
      subscriptionId: 91,
      data: { paymentReference: 'PERSISTED_REF_123', ...(transactionId ? { providerTransactionId: transactionId } : {}) },
    });
    expect(state.checkout).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="button-checkout-subscription-91"]')).toBeNull();
  });

  it('keeps Platform Owner view read-only and hides school payment controls', async () => {
    state.owner = true;
    state.roles = [
      { role: 'PLATFORM_OWNER', schoolId: null, status: 'ACTIVE' },
      { role: 'SCHOOL_ADMIN', schoolId: 7, status: 'ACTIVE' },
    ];
    await renderPage();
    expect(host.textContent).toContain('Read only');
    expect(host.querySelector('[data-testid="button-checkout-subscription-91"]')).toBeNull();
  });

  it('shows only SCHOOL allocations to school finance and reserves platform and BRO lines for Owner view', async () => {
    const paidPayment = payment({ status: 'PAID', paidAt: '2025-01-02T00:00:00.000Z' });
    const response = {
      payment: paidPayment,
      subscription: {},
      activated: true,
      receipt: {
        receiptNumber: 'STU-REC-12',
        paidAt: paidPayment.paidAt,
        grossAmountMinor: paidPayment.grossAmountMinor,
        currency: paidPayment.currency,
        schoolName: 'Example School',
        studentName: 'Ari Learner',
        sessionName: '2025',
        termName: 'First',
        schoolLogoVersionUrl: '/immutable-logo-v7.png',
        allocations: [
          { recipientType: 'SCHOOL', recipientId: 7, entryType: 'CREDIT', amountMinor: 200000, currency: 'NGN' },
          { recipientType: 'PLATFORM', recipientId: null, entryType: 'CREDIT', amountMinor: 290000, currency: 'NGN' },
          { recipientType: 'PARTNER', recipientId: 33, entryType: 'CREDIT', amountMinor: 10000, currency: 'NGN' },
          { recipientType: 'PLATFORM_PROVIDER_FEE', recipientId: null, entryType: 'EXPENSE', amountMinor: 3000, currency: 'NGN' },
        ],
      },
      allocations: [
        { recipientType: 'SCHOOL', recipientId: 7, entryType: 'CREDIT', amountMinor: 200000, currency: 'NGN' },
        { recipientType: 'PLATFORM', recipientId: null, entryType: 'CREDIT', amountMinor: 290000, currency: 'NGN' },
        { recipientType: 'PARTNER', recipientId: 33, entryType: 'CREDIT', amountMinor: 10000, currency: 'NGN' },
        { recipientType: 'PLATFORM_PROVIDER_FEE', recipientId: null, entryType: 'EXPENSE', amountMinor: 3000, currency: 'NGN' },
      ],
    };
    state.subscriptions = [{
      ...subscription,
      lastPaymentId: 12,
      lastPaymentStatus: 'PAID',
      lastPaymentReference: 'PERSISTED_REF_123',
    }];
    state.paymentResponse = response;
    await renderPage();
    expect(host.textContent).toContain('School allocation');
    expect(host.textContent).not.toContain('Platform allocation');
    expect(host.textContent).not.toContain('BRO allocation');
    expect(host.textContent).not.toContain('Provider fee');
    expect(host.textContent).toContain('Immutable receipt · STU-REC-12');
    expect(host.querySelector('[data-testid="button-print-student-subscription-receipt-12"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="school-document-header"]')?.getAttribute('data-logo-url')).toBe('/immutable-logo-v7.png');

    state.owner = true;
    state.roles = [
      { role: 'PLATFORM_OWNER', schoolId: null, status: 'ACTIVE' },
      { role: 'SCHOOL_ADMIN', schoolId: 7, status: 'ACTIVE' },
    ];
    await renderPage();
    expect(host.textContent).toContain('Platform allocation');
    expect(host.textContent).toContain('BRO allocation');
    expect(host.textContent).toContain('Provider fee · platform expense');
  });
});