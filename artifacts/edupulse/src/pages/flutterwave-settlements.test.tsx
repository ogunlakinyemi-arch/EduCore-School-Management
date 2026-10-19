// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const f = vi.hoisted(() => ({
  userId: 'unit-owner' as string | null, loaded: true, schoolId: null as number | null,
  dashboard: vi.fn(), evidence: vi.fn(), review: vi.fn(), submit: vi.fn(), other: vi.fn(),
  dashboardOptions: null as any, evidenceOptions: null as any,
}));
vi.mock('@clerk/react', () => ({ useAuth: () => ({ userId: f.userId, isLoaded: f.loaded }) }));
vi.mock('@/components/shared', () => ({
  useTenant: () => ({ schoolId: f.schoolId }),
  money: (n: number) => `NGN ${n.toLocaleString('en-NG')}`,
  Button: ({ children, testId, variant: _variant, ...props }: any) => <button data-testid={testId} {...props}>{children}</button>,
  PageHeading: ({ title, description }: any) => <header>{title}{description}</header>,
  StatusPill: ({ value }: any) => <span>{value}</span>,
  SkeletonPage: () => <div>Loading TEST dashboard</div>,
  EmptyState: ({ title, description }: any) => <div>{title}{description}</div>,
  ErrorState: ({ message, retry }: any) => <div role="alert">{message}<button onClick={retry}>Retry dashboard</button></div>,
}));
vi.mock('@workspace/api-client-react', async () => {
  const { useQuery, useMutation } = await import('@tanstack/react-query');
  return {
    getGetFlutterwaveSplitDashboardQueryKey: (p: unknown) => ['flutterwave-dashboard', p],
    getGetFlutterwaveTransactionSplitEvidenceQueryKey: (id: number) => ['flutterwave-evidence', id],
    useGetFlutterwaveSplitDashboard: (_p: unknown, options: any) => {
      f.dashboardOptions = options.query;
      return useQuery({ ...options.query, queryFn: f.dashboard });
    },
    useGetFlutterwaveTransactionSplitEvidence: (_id: number, options: any) => {
      f.evidenceOptions = options.query;
      return useQuery({ ...options.query, queryFn: f.evidence });
    },
    useReviewFlutterwaveSplitRecipient: () => useMutation({ mutationFn: f.review }),
    useSubmitFlutterwaveSplitRecipient: () => useMutation({ mutationFn: f.submit }),
    useConfigureFlutterwaveSchoolSplits: () => useMutation({ mutationFn: f.other }),
    useReconcileFlutterwaveSplitPayment: () => useMutation({ mutationFn: f.other }),
    useRequestFlutterwaveSplitRefund: () => useMutation({ mutationFn: f.other }),
    useVerifyFlutterwaveSplitRefund: () => useMutation({ mutationFn: f.other }),
  };
});
import { FlutterwaveSettlementsPage } from './flutterwave-settlements';

const reference = 'RS_5F0DB5C736A2550E783A15B9EB9FBF09';
const recipient = {
  id: 10, entityId: 1, kind: 'SCHOOL', entityName: 'UNIT SCHOOL', status: 'BANK_RESOLVED',
  bankName: 'UNIT BANK', maskedAccount: '••••6789', accountName: 'UNIT ACCOUNT',
  maskedBusinessEmail: 'f•••@school.edu.ng', mode: 'TEST', providerSubaccountId: null,
  reviewNote: null, lastError: null,
};
const payment = {
  paymentId: 40, reference: 'unit-payment', status: 'COLLECTION_PAID', collectionStatus: 'PAID',
  grossAmountMinor: 500000, schoolAmountMinor: 200000, partnerAmountMinor: 10000, platformAmountMinor: 290000,
  providerFeeMinor: null, providerAdditionalFeeMinor: null, platformNetMinor: null,
  refundedAmountMinor: 0, recipients: [], adjustments: [],
};
const dashboard = () => ({
  developmentOnly: true, mode: 'TEST', currency: 'NGN', feeBearer: 'PLATFORM', isOwner: true,
  testCredentialConfigured: true, scopes: [{ kind: 'SCHOOL', id: 1, name: 'UNIT SCHOOL' }],
  recipients: [{ ...recipient }], schools: [{ schoolId: 1, enabled: false, testSplitVerificationAuthorized: false }],
  payments: [{ ...payment }],
  currentAllocationPolicy: { version: 2, schoolMinor: 190000, platformWithPartnerMinor: 300000, platformWithoutPartnerMinor: 310000, partnerMinor: 10000 },
});
const partialEvidence = () => ({
  status: 'UNCONFIRMED', evidenceLevel: 'PARTIAL', reason: 'Matching collection only; allocation unavailable.',
  paymentId: 40, transactionId: '1234', reference: 'unit-payment', checkedAt: 'unit-check-time',
  bankSettlementVerified: false, platformGrossMinor: 290000, platformNetMinor: 283000,
  appFeeMinor: 7000, additionalFeeMinor: 0, recipients: [{ subaccountId: 'RS_UNITSchool000001', amountMinor: 200000, observedAmountMinor: null }],
});

let host: HTMLDivElement, root: Root, client: QueryClient;
const node = <T extends HTMLElement = HTMLElement>(id: string) => host.querySelector<T>(`[data-testid="${id}"]`)!;
async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
}
async function render() {
  await act(async () => root.render(<QueryClientProvider client={client}><FlutterwaveSettlementsPage /></QueryClientProvider>));
  await settle();
}
async function click(id: string) { await act(async () => node(id).click()); await settle(); }
async function fill(id: string, value: string) {
  await act(async () => {
    const element = node<HTMLInputElement | HTMLTextAreaElement>(id);
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function openReviewed() {
  await click('button-review-10');
  await fill('input-review-note-10', 'Reviewed unit-only ownership');
  await act(async () => host.querySelectorAll<HTMLInputElement>('[data-testid="recipient-10"] input[type=checkbox]').forEach(x => x.click()));
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  f.userId = 'unit-owner'; f.loaded = true; f.schoolId = null;
  for (const fn of [f.dashboard, f.evidence, f.review, f.submit, f.other]) fn.mockReset();
  f.dashboard.mockResolvedValue(dashboard());
  f.evidence.mockResolvedValue(partialEvidence());
  f.review.mockResolvedValue({ ...recipient, status: 'TEST_READY' });
  f.submit.mockResolvedValue(recipient);
  // Any accidental real fetch fails locally; every API hook above uses mocks.
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No network permitted in offline UI acceptance'); }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); client.clear(); host.remove(); vi.unstubAllGlobals();
});

describe('Offline signed-in TEST verification screen (mock identity/API, real React/query behavior)', () => {
  it('shows canonical current policy separately from unchanged historical splits without automatic provider reads', async () => {
    await render();
    expect(node('button-review-10')).not.toBeNull();
    expect(host.textContent).toContain('f•••@school.edu.ng');
    expect(host.textContent).toContain('NGN 2,000');
    expect(host.textContent).toContain('NGN 100');
    expect(host.textContent).toContain('NGN 2,900');
    const rules = node('text-split-rules').textContent!;
    expect(rules).toContain('school receives NGN 1,900');
    expect(rules).toContain('Platform Owner receives NGN 3,000');
    expect(rules).toContain('Partner receives NGN 100');
    expect(rules).toContain('Without an eligible Partner, school receives NGN 1,900 and Platform Owner receives NGN 3,100');
    expect(rules).toContain('Provider processing fees are separate Owner expenses');
    expect(rules).not.toMatch(/NGN 2,000|NGN 2,900/);
    expect(f.dashboardOptions.queryKey).toContain('owner-policy-v2');
    expect(f.evidence).not.toHaveBeenCalled();
    expect(f.evidenceOptions.enabled).toBe(false);
    expect(f.evidenceOptions.queryKey.at(-1)).toBe('unit-owner');
  });
  it.each([false, true])('hides all financial actions while auth is unresolved or signed out (%s)', async loaded => {
    f.loaded = loaded; f.userId = null;
    await render();
    expect(node('button-review-10')).toBeNull();
    expect(f.dashboard).not.toHaveBeenCalled(); expect(f.evidence).not.toHaveBeenCalled();
  });
  it('never substitutes historical amounts when current policy metadata is unavailable', async () => {
    f.dashboard.mockResolvedValue({ ...dashboard(), currentAllocationPolicy: null });
    await render();
    const rules = node('text-split-rules').textContent!;
    expect(rules).toContain('Current allocation policy is unavailable');
    expect(rules).not.toMatch(/NGN 2,000|NGN 2,900/);
    expect(host.textContent).toContain('NGN 2,000');
  });
  it('shows loading without controls while the dashboard is pending', async () => {
    f.dashboard.mockReturnValue(new Promise(() => {}));
    await render(); expect(host.textContent).toContain('Loading TEST dashboard');
    expect(node('button-review-10')).toBeNull();
  });
  it.each([403, 404, 503])('fails closed on dashboard denial/unavailability (%s)', async status => {
    f.dashboard.mockRejectedValue({ status, message: 'Access unavailable' });
    await render(); expect(node('button-review-10')).toBeNull();
    expect(node('button-transaction-evidence-40')).toBeNull();
    expect(f.review).not.toHaveBeenCalled();
    expect(host.textContent).toContain(status === 404 ? 'Not available in this environment' : 'Access unavailable');
  });
  it('rejects a non-Development dashboard before exposing actions', async () => {
    f.dashboard.mockResolvedValue({ ...dashboard(), developmentOnly: false });
    await render(); expect(node('button-review-10')).toBeNull();
  });
  it('recovers from a denied dashboard only after an explicit successful retry', async () => {
    f.dashboard.mockRejectedValueOnce({ status: 503, message: 'Authorization unavailable' }).mockResolvedValue(dashboard());
    await render(); expect(node('button-review-10')).toBeNull();
    await act(async () => Array.from(host.querySelectorAll('button')).find(x => x.textContent === 'Retry dashboard')!.click());
    await settle(); expect(node('button-review-10')).not.toBeNull();
  });
  it.each(['SCHOOL_ADMIN', 'PARTNER'])('does not expose Owner review/reuse controls to %s', async role => {
    f.userId = `unit-${role}`; f.schoolId = role === 'SCHOOL_ADMIN' ? 1 : null;
    f.dashboard.mockResolvedValue({ ...dashboard(), isOwner: false });
    await render(); expect(node('button-review-10')).toBeNull();
    expect(node('form-flutterwave-recipient')).not.toBeNull();
    expect(node('text-split-rules')).toBeNull();
    expect(host.textContent).not.toContain('NGN 2,900');
    expect(host.textContent).not.toContain('NGN 3,100');
    expect(node('button-transaction-evidence-40')).toBeNull();
    if (role === 'PARTNER') expect(node('button-transaction-evidence-40')).toBeNull();
  });
  it('requires a note and both attestations, then submits only the exact reviewed reference', async () => {
    await render(); await click('button-review-10');
    expect(node<HTMLButtonElement>('button-existing-test-10').disabled).toBe(true);
    await fill('input-review-note-10', 'Reviewed unit-only ownership');
    const checks = host.querySelectorAll<HTMLInputElement>('[data-testid="recipient-10"] input[type=checkbox]');
    await act(async () => checks[0].click());
    expect(node<HTMLButtonElement>('button-existing-test-10').disabled).toBe(true);
    await act(async () => checks[1].click()); await click('button-existing-test-10');
    expect(f.review).toHaveBeenCalledOnce();
    expect(f.review.mock.calls[0][0]).toEqual({ recipientId: 10, data: {
      action: 'VERIFY_EXISTING_TEST', note: 'Reviewed unit-only ownership', ownershipConfirmed: true,
      distinctFromPlatformAccountConfirmed: true, existingTestReference: reference,
    } });
    expect(f.other).not.toHaveBeenCalled();
  });
  it('blocks all review mutations while a reviewed GET is pending', async () => {
    f.review.mockReturnValue(new Promise(() => {}));
    await render(); await openReviewed(); await click('button-existing-test-10');
    for (const id of ['existing-test', 'approve', 'recover', 'suspend', 'retire']) expect(node<HTMLButtonElement>(`button-${id}-10`).disabled).toBe(true);
    expect(f.review).toHaveBeenCalledOnce();
  });
  it('does not claim readiness when the server returns an unconfirmed review result with HTTP success', async () => {
    f.review.mockResolvedValue({ ...recipient, status: 'CREATION_UNKNOWN' });
    await render(); await openReviewed(); await click('button-existing-test-10');
    expect(host.querySelector('[role=alert]')?.textContent).toContain('read-back is unconfirmed');
    expect(f.other).not.toHaveBeenCalled();
  });
  it('reports review request errors and never retries or creates automatically', async () => {
    f.review.mockRejectedValue({ message: 'Ownership mismatch' });
    await render(); await openReviewed(); await click('button-existing-test-10');
    expect(host.textContent).toContain('Ownership mismatch');
    expect(f.review).toHaveBeenCalledOnce(); expect(f.other).not.toHaveBeenCalled();
  });
  it('disables creation and existing-reference linking outside BANK_RESOLVED', async () => {
    f.dashboard.mockResolvedValue({ ...dashboard(), recipients: [{ ...recipient, status: 'TEST_READY' }] });
    await render(); await openReviewed();
    expect(node<HTMLButtonElement>('button-existing-test-10').disabled).toBe(true);
    expect(node<HTMLButtonElement>('button-approve-10').disabled).toBe(true);
  });
  it.each(['PARTIAL', 'UNAVAILABLE', 'MISMATCH'])('renders %s evidence distinctly, never bank settlement', async evidenceLevel => {
    f.evidence.mockResolvedValue({ ...partialEvidence(), evidenceLevel, status: evidenceLevel === 'MISMATCH' ? 'MISMATCH' : 'UNCONFIRMED' });
    await render(); await click('button-transaction-evidence-40');
    expect(node('transaction-evidence-40').textContent).toContain(`Evidence level: ${evidenceLevel}`);
    expect(host.textContent).toContain('No real bank settlement is verified');
  });
  it('hides cached complete evidence during refresh and after failure, without financial mutations', async () => {
    // Synthetic old cache only; deliberately not provider proof.
    f.evidence.mockResolvedValueOnce({ ...partialEvidence(), status: 'CONFIRMED', evidenceLevel: 'COMPLETE_VERIFIED' });
    await render(); await click('button-transaction-evidence-40');
    expect(node('transaction-evidence-40').textContent).toContain('no confirmation is accepted');
    expect(node('transaction-evidence-40').textContent).not.toContain('COMPLETE_VERIFIED');
    let reject!: (reason: unknown) => void;
    f.evidence.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
    await click('button-transaction-evidence-40');
    expect(node('transaction-evidence-40').textContent).toContain('Reading provider evidence');
    expect(node('transaction-evidence-40').textContent).not.toContain('COMPLETE_VERIFIED');
    expect(node<HTMLButtonElement>('button-transaction-evidence-40').disabled).toBe(true);
    await act(async () => reject(new Error('Read unavailable'))); await settle();
    expect(node('transaction-evidence-40').textContent).toContain('Provider read-back unavailable');
    expect(node('transaction-evidence-40').textContent).not.toContain('unit-check-time');
    expect(f.other).not.toHaveBeenCalled();
  });
  it('isolates evidence, feedback and open review state across identity switches', async () => {
    await render(); await click('button-transaction-evidence-40'); await openReviewed();
    f.userId = 'unit-second-owner'; await render();
    expect(f.dashboardOptions.queryKey.at(-1)).toBe('unit-second-owner');
    expect(f.evidenceOptions.queryKey.at(-1)).toBe('unit-second-owner');
    expect(node('input-review-note-10')).toBeNull();
    expect(node('transaction-evidence-40').textContent).not.toContain('unit-check-time');
    expect(f.evidence).toHaveBeenCalledOnce();
  });
  it('does not carry a previous identity’s mutation error into the next identity’s screen', async () => {
    f.review.mockRejectedValue({ message: 'unit-owner-private-review-error' });
    await render(); await openReviewed(); await click('button-existing-test-10');
    expect(host.textContent).toContain('unit-owner-private-review-error');
    f.userId = 'unit-second-owner'; await render();
    expect(host.textContent).not.toContain('unit-owner-private-review-error');
  });
  it('clears attestations after a completed review instead of carrying consent into the next action', async () => {
    await render(); await openReviewed(); await click('button-existing-test-10'); await click('button-review-10');
    expect(Array.from(host.querySelectorAll<HTMLInputElement>('[data-testid="recipient-10"] input[type=checkbox]')).every(x => !x.checked)).toBe(true);
  });
});
