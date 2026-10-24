// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ data: undefined as any, submit: vi.fn(), review: vi.fn(), refetch: vi.fn(), uid: 1, params: [] as any[], opts: [] as any[] }));
vi.mock('@workspace/api-client-react', async importOriginal => ({
  ...await importOriginal<typeof import('@workspace/api-client-react')>(),
  useGetAuthorizedContext: () => ({ data: { user: { id: m.uid } } }),
  getGetLiveSchoolSubaccountsQueryKey: (p?: unknown) => ['/flutterwave/live/school-subaccounts', ...(p ? [p] : [])],
  useGetLiveSchoolSubaccounts: (p: unknown, o: unknown) => { m.params.push(p); m.opts.push(o); return { data: m.data, isLoading: false, isError: false, isFetching: false, dataUpdatedAt: 0, refetch: m.refetch }; },
  submitLiveSchoolSubaccount: (...a: unknown[]) => m.submit(...a),
  reviewLiveSchoolSubaccount: (...a: unknown[]) => m.review(...a),
}));
import { OwnerLiveOnboarding, SchoolLiveOnboarding } from './live-school-subaccount-onboarding';

const item = (o: any = {}) => ({ id: 5, schoolId: 7, schoolName: 'Fictional Academy', status: 'BANK_VERIFIED', bankName: 'Fictional Bank', accountName: 'Fictional Academy Ltd', maskedAccount: '******6789', businessName: 'Fictional Biz', businessEmail: 'a@fict.test', businessPhone: '0800', providerSubaccountId: null, errorCode: null, errorMessage: null, canApprove: true, canRecover: false, updatedAt: 'x', checkoutEnabled: false, ...o });
const H = 'a'.repeat(64);
let host: HTMLDivElement; let root: Root; let client: QueryClient;
const settle = () => act(async () => { await new Promise(r => setTimeout(r, 10)); });
const q = (id: string) => document.body.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
const render = async (ui: React.ReactElement) => { await act(async () => root.render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)); await settle(); };
const click = async (el: HTMLElement) => { await act(async () => el.click()); await settle(); };
const type = async (id: string, v: string) => act(async () => {
  const el = q(id) as HTMLInputElement; const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }));
});

beforeEach(() => {
  m.uid = 1; m.data = { ready: true, blockers: [], items: [item()] }; m.params = []; m.opts = [];
  m.submit.mockReset().mockResolvedValue(item()); m.review.mockReset().mockResolvedValue(item({ status: 'LIVE_VERIFIED' })); m.refetch.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });

describe('School Admin', () => {
  it('queries its own school, submits explicitly, has no account inputs', async () => {
    await render(<SchoolLiveOnboarding schoolId={7} />);
    expect(m.params[0]).toEqual({ schoolId: 7 });
    expect(document.body.querySelectorAll('input').length).toBe(0);
    expect(m.submit).not.toHaveBeenCalled();
    await click(q('button-submit-live-onboarding'));
    expect(m.submit).toHaveBeenCalledWith(7);
  });
  it('disables submit when not ready and shows blockers', async () => {
    m.data = { ready: false, blockers: ['LIVE_ONBOARDING_DISABLED', 'SOME_NEW_CODE'], items: [] };
    await render(<SchoolLiveOnboarding schoolId={7} />);
    expect((q('button-submit-live-onboarding') as HTMLButtonElement).disabled).toBe(true);
    expect(q('blocker-LIVE_ONBOARDING_DISABLED')).toBeTruthy();
    expect(q('blocker-SOME_NEW_CODE').textContent).toContain('some new code');
    expect(q('live-empty')).toBeTruthy();
  });
  it('does not resubmit automatically after an unknown failure', async () => {
    m.submit.mockRejectedValue(new Error('Gateway timeout'));
    await render(<SchoolLiveOnboarding schoolId={7} />);
    await click(q('button-submit-live-onboarding')); await settle();
    expect(m.submit).toHaveBeenCalledTimes(1);
  });
});

describe('Owner', () => {
  it('shows masked data, LIVE-vs-TEST distinction, and checkout gate', async () => {
    m.data = { ready: true, blockers: [], items: [item({ status: 'LIVE_VERIFIED', providerSubaccountId: 'sub_x' })] };
    await render(<OwnerLiveOnboarding />);
    expect(q('live-masked-5').textContent).toBe('******6789');
    expect(q('live-onboarding').textContent).toContain('LIVE-only');
    expect(q('live-onboarding').textContent).toContain('no TEST fallback'.replace('no', 'There is no'));
    expect(q('live-item-5').textContent).toContain('Checkout remains separately gated');
    expect(m.params[0]).toBeUndefined();
  });
  it('validates evidence and sends exact approval payload', async () => {
    await render(<OwnerLiveOnboarding />);
    await click(q('button-live-approve-5')); await click(q('button-live-approve-confirm'));
    expect(q('live-validation')).toBeTruthy(); expect(m.review).not.toHaveBeenCalled();
    for (const k of ['ownershipConfirmed', 'distinctFromPlatformAccountConfirmed', 'merchantOwnershipConfirmed', 'kycConfirmed']) await click(q(`check-${k}`));
    for (const k of ['ownershipEvidenceSha256', 'merchantEvidenceSha256', 'feeBearerEvidenceSha256', 'splitPolicyEvidenceSha256']) await type(`input-${k}`, H);
    await type('input-live-note', 'short');
    await click(q('button-live-approve-confirm')); expect(m.review).not.toHaveBeenCalled();
    await type('input-live-note', 'Verified documents on file');
    await click(q('button-live-approve-confirm'));
    expect(m.review).toHaveBeenCalledTimes(1);
    expect(m.review.mock.calls[0][0]).toBe(5);
    expect(m.review.mock.calls[0][1]).toEqual({ action: 'APPROVE_AND_CREATE', note: 'Verified documents on file', ownershipConfirmed: true, distinctFromPlatformAccountConfirmed: true, merchantOwnershipConfirmed: true, kycConfirmed: true, feeBearer: 'MERCHANT', ownershipEvidenceSha256: H, merchantEvidenceSha256: H, feeBearerEvidenceSha256: H, splitPolicyEvidenceSha256: H });
  });
  it('hides approve when canApprove false; recovery sends RECOVER only and no auto create after error', async () => {
    m.data = { ready: true, blockers: [], items: [item({ status: 'CREATION_UNKNOWN', canApprove: false, canRecover: true, errorCode: 'PROVIDER_UNKNOWN', errorMessage: 'No response' })] };
    m.review.mockRejectedValue(new Error('Still unknown'));
    await render(<OwnerLiveOnboarding />);
    expect(q('button-live-approve-5')).toBeNull(); expect(q('button-live-reject-5')).toBeNull();
    expect(q('live-error-5').textContent).toContain('PROVIDER_UNKNOWN');
    await click(q('button-live-recover-5')); await type('input-live-action-note', 'Read provider state');
    await click(q('button-live-action-confirm')); await settle();
    expect(m.review).toHaveBeenCalledTimes(1);
    expect(m.review.mock.calls[0][1]).toEqual({ action: 'RECOVER', note: 'Read provider state' });
  });
  it('disables actions when not ready and polls', async () => {
    m.data = { ready: false, blockers: ['LIVE_CREDENTIALS_MISSING'], items: [item({ status: 'CREATING' })] };
    await render(<OwnerLiveOnboarding />);
    expect((q('button-live-approve-5') as HTMLButtonElement).disabled).toBe(true);
    const ri = m.opts[0].query.refetchInterval;
    expect(ri({ state: { data: m.data } })).toBe(5000);
    expect(ri({ state: { data: { items: [] } } })).toBeGreaterThan(5000);
    expect(m.opts[0].query.queryKey).toContain('owner');
    expect(m.opts[0].query.queryKey).toContain('user:1');
  });
  it('isolates query keys by signed-in user', async () => {
    await render(<OwnerLiveOnboarding />); m.uid = 2; await render(<OwnerLiveOnboarding />);
    const keys = m.opts.map((o: any) => o.query.queryKey.join('|'));
    expect(keys[0]).toContain('user:1'); expect(keys[keys.length - 1]).toContain('user:2');
    expect(keys[0]).not.toBe(keys[keys.length - 1]);
  });
  it('shows the actual provider ID to the Owner only, not as checkout enablement', async () => {
    m.data = { ready: true, blockers: [], items: [item({ status: 'LIVE_VERIFIED', canApprove: false, providerSubaccountId: 'RS_REAL123' })] };
    await render(<OwnerLiveOnboarding />);
    expect(q('live-provider-id-5').textContent).toBe('RS_REAL123');
    expect(q('live-item-5').textContent).toContain('does not enable checkout');
    await render(<SchoolLiveOnboarding schoolId={7} />);
    expect(document.body.textContent).not.toContain('RS_REAL123');
  });
  it('offers no Reject for STALE and labels newest-200 with a school filter', async () => {
    m.data = { ready: true, blockers: [], items: [item({ status: 'STALE', canApprove: false })] };
    await render(<OwnerLiveOnboarding />);
    expect(q('button-live-reject-5')).toBeNull();
    expect(q('live-list-scope').textContent).toContain('newest 200');
    await type('input-live-school-filter', '9');
    await act(async () => { q('button-live-school-filter').click(); }); await settle();
    expect(m.params[m.params.length - 1]).toEqual({ schoolId: 9 });
  });
});

describe('School Admin submit outcome', () => {
  it('reports bank failure instead of success for ACTION_REQUIRED', async () => {
    m.submit.mockResolvedValue(item({ status: 'ACTION_REQUIRED', errorCode: 'ACCOUNT_NAME_MISMATCH', errorMessage: 'Name does not match' }));
    await render(<SchoolLiveOnboarding schoolId={7} />);
    await click(q('button-submit-live-onboarding'));
    expect(document.body.textContent).toContain('needs action');
    expect(document.body.textContent).toContain('ACCOUNT_NAME_MISMATCH');
    expect(document.body.textContent).not.toContain('passed');
  });
  it('disables submit when creation is claimed', async () => {
    m.data = { ready: true, blockers: [], items: [item({ status: 'CREATION_UNKNOWN' })] };
    await render(<SchoolLiveOnboarding schoolId={7} />);
    expect((q('button-submit-live-onboarding') as HTMLButtonElement).disabled).toBe(true);
    expect(q('live-submit-locked')).toBeTruthy();
  });
  it('maps backend blocker codes to prerequisites', async () => {
    m.data = { ready: false, blockers: ['LIVE_ONBOARDING_SCHEMA_APPROVAL_REQUIRED', 'LIVE_ONBOARDING_ENABLEMENT_REQUIRED'], items: [] };
    await render(<SchoolLiveOnboarding schoolId={7} />);
    expect(q('blocker-LIVE_ONBOARDING_SCHEMA_APPROVAL_REQUIRED').textContent).toContain('schema');
    expect(q('blocker-LIVE_ONBOARDING_ENABLEMENT_REQUIRED').textContent).toContain('EDUCORE_FLUTTERWAVE_LIVE_ONBOARDING_ENABLED');
  });
});
