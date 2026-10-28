// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null; let host: HTMLElement | null = null;
const render = (ui: ReactNode) => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); act(() => root!.render(ui)); };
const cleanup = () => { act(() => root?.unmount()); host?.remove(); root = null; host = null; };
const screen = { getByTestId: (id: string) => { const el = document.querySelector(`[data-testid="${id}"]`); if (!el) throw new Error('missing ' + id); return el as HTMLElement; } };
const fireEvent = {
  click: (el: HTMLElement) => act(() => { el.click(); }),
  change: (el: HTMLElement, { target: { value } }: { target: { value: string } }) => act(() => {
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  }),
};
const waitFor = async (fn: () => void) => { for (let i = 0; i < 20; i++) { try { fn(); return; } catch { await act(async () => { await new Promise(r => setTimeout(r, 10)); }); } } fn(); };
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const f = vi.hoisted(() => ({
  ctx: null as unknown,
  readiness: null as unknown,
  reviews: [] as unknown[],
  createMutate: vi.fn(),
  decideMutate: vi.fn(),
  readinessCalls: 0,
  checkout: vi.fn(),
  rulesState: 'ready' as 'ready' | 'empty' | 'error',
}));
const okCtx = { isPlatformOwner: true, user: { id: 7, status: 'ACTIVE' }, roles: [{ role: 'PLATFORM_OWNER', schoolId: null, status: 'ACTIVE' }] };
const q = (data: unknown) => ({ data, isSuccess: true, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() });
vi.mock('@workspace/api-client-react', () => ({
  useGetPilotReadiness:()=>q({checkedAt:"2026-10-27",calendars:[],productionChangeAllowed:false}),
  getGetPilotReadinessQueryKey:()=>["/api/platform/pilot-readiness"],
  useGetAuthorizedContext: () => ({ data: f.ctx, isLoading: false }),
  getGetNfcFeeCollectionFilterOptionsQueryKey: (p: unknown) => ['opts', p],
  useGetNfcFeeCollectionFilterOptions: () => q({ schools: [{ id: 1, name: 'Ikoyi Grammar' }], terms: [{ id: 4, schoolId: 1, schoolName: 'Ikoyi Grammar', sessionName: '2026/27', name: 'First', startDate: '2026-09-01', endDate: '2026-12-15', isCurrent: true }] }),
  getGetOwnerSubscriptionPaymentRulesQueryKey: () => ['rules'],
  useGetOwnerSubscriptionPaymentRules: () => ({ ...q({ proposals: f.rulesState === 'ready' ? [
    { id: 11, product: 'STUDENT_PLATFORM', status: 'DRAFT', amountMinor: 320000, currency:'NGN',schoolShareMinor:0, effectiveAt: '2026-09-01T00:00:00Z', endsAt: null, version: 3 },
    { id: 12, product: 'STUDENT_PLATFORM', status: 'RETIRED', amountMinor: 320000, effectiveAt: '2026-01-01T00:00:00Z', endsAt: null, version: 1 },
    { id: 13, product: 'TEACHER_STAFF_PLATFORM', status: 'DRAFT', amountMinor: 320000, effectiveAt: '2026-01-01T00:00:00Z', endsAt: null, version: 1 },
  ] : [] }), isSuccess: f.rulesState !== 'error', isError: f.rulesState === 'error' }),
  getGetDirectLiveReleaseReadinessQueryKey: (p: unknown) => ['readiness', p],
  useGetDirectLiveReleaseReadiness: () => { f.readinessCalls++; return q(f.readiness); },
  getListDirectLiveReleaseReviewsQueryKey: (p: unknown) => ['reviews', p],
  useListDirectLiveReleaseReviews: () => q({ reviews: f.reviews }),
  useCreateDirectLiveReleaseReview: () => ({ mutate: f.createMutate, isPending: false }),
  useDecideDirectLiveReleaseReview: () => ({ mutate: f.decideMutate, isPending: false }),
  createDirectStudentLiveCheckout: f.checkout,
}));
import { DirectFlutterwaveLiveReadinessPage, approvalBlockers } from './direct-flutterwave-live-readiness';

const check = (code: string, status = 'READY') => ({ code, label: code, status, detail: 'detail ' + code });
const readyR = (over: Record<string, unknown> = {}) => ({
  schoolId: 1, termId: 4, ruleId: 11, previewDigest: 'pd-abc', approvalReady: true, schemaReady: true, checkoutEnabled: false,
  facts: { schoolId: 1, termId: 4, ruleId: 11, release: 'R1', environment: 'LIVE', policy: 'NEW_ONLY_PRESERVE_LEGACY', reportDigest: 'rep-hash', eligibleStudentIds: [1, 2], legacyCount: 5, webhookAuthentication: 'V3_VERIF_HASH' },
  checks: [check('CONFIG'), check('NON_SPLIT_EVIDENCE', 'BLOCKED'), check('RUNTIME_SWITCH', 'BLOCKED')], ...over,
});
const review = (status: string, over: Record<string, unknown> = {}) => ({
  id: 5, schoolId: 1, termId: 4, ruleId: 11, status, facts: readyR().facts, evidenceDigest: 'ev-1', previewDigest: 'pd-abc',
  merchantEvidenceReference: 'MERCH-REF-001', merchantEvidenceHash: 'a'.repeat(64), expiresAt: new Date(Date.now() + 864e5).toISOString(),
  createdAt: '2026-08-01T00:00:00Z', reason: 'initial', events: [{ id: 'e1', action: 'CREATED', actorId: 7, reason: 'initial', createdAt: '2026-08-01T00:00:00Z' }], ...over,
});
let qc = new QueryClient();
const mount = () => render(<QueryClientProvider client={(qc = new QueryClient())}><DirectFlutterwaveLiveReadinessPage /></QueryClientProvider>);
const selectScope = () => {
  fireEvent.change(screen.getByTestId('select-live-school'), { target: { value: '1' } });
  fireEvent.change(screen.getByTestId('select-live-term'), { target: { value: '4' } });
  fireEvent.change(screen.getByTestId('select-live-rule'), { target: { value: '11' } });
};

beforeEach(() => { f.ctx = okCtx; f.readiness = readyR(); f.reviews = []; f.readinessCalls = 0; f.createMutate.mockReset(); f.decideMutate.mockReset(); f.checkout.mockReset(); });
afterEach(cleanup);

describe('Direct Flutterwave LIVE readiness', () => {
  afterEach(() => { f.rulesState = 'ready'; });
  it.each(['empty', 'error'] as const)('keeps unevaluated prerequisite guidance visible with an %s rule catalog', (state) => {
    f.rulesState = state;
    mount();
    const guide = screen.getByTestId('payment-readiness-guidance');
    expect(screen.getByTestId('readiness-not-evaluated').textContent).toContain('no selected scope has been evaluated');
    expect(guide.querySelectorAll('li')).toHaveLength(8);
    expect(guide.textContent).toContain('four approved functions and nine triggers');
    expect(guide.textContent).toContain('does not certify BRO enforcement');
    expect(guide.textContent).toContain('Do not create or activate a rule merely to reveal diagnostics');
    expect(guide.querySelector('button')).toBeNull();
    expect(f.readinessCalls).toBe(0);
    expect(f.createMutate).not.toHaveBeenCalled();
    expect(f.decideMutate).not.toHaveBeenCalled();
    expect(f.checkout).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="button-create-review"]')).toBeNull();
  });
  it('denies non-global owners without loading anything', () => {
    f.ctx = { ...okCtx, roles: [{ role: 'PLATFORM_OWNER', schoolId: 3, status: 'ACTIVE' }] };
    mount();
    expect(screen.getByTestId('direct-live-denied')).toBeTruthy();
    expect(document.querySelector('[data-testid="payment-readiness-guidance"]')).toBeNull();
    expect(f.readinessCalls).toBe(0);
  });
  it('shows only eligible rules, no auto-selection, and the switch warning', () => {
    mount();
    const opts = Array.from((screen.getByTestId('select-live-rule') as HTMLSelectElement).options).map(o => o.value);
    expect(opts).toEqual(['', '11']);
    expect(screen.getByTestId('empty-scope')).toBeTruthy();
    expect(screen.getByTestId('warning-operational-switch').textContent).toContain('NEVER enables LIVE');
  });
  it('readiness GET performs no mutations or checkout', () => {
    mount(); selectScope();
    expect(document.querySelector('[data-testid="readiness-not-evaluated"]')).toBeNull();
    expect(screen.getByTestId('payment-readiness-guidance').querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByTestId('text-checkout-enabled').textContent).toContain('Disabled here');
    expect(screen.getByTestId('list-blockers').textContent).toContain('No approval blockers');
    expect(f.createMutate).not.toHaveBeenCalled(); expect(f.decideMutate).not.toHaveBeenCalled(); expect(f.checkout).not.toHaveBeenCalled();
  });
  it('does not load readiness for an ID absent from the authorized catalog', () => {
    mount();
    const school = screen.getByTestId('select-live-school') as HTMLSelectElement;
    const injected = document.createElement('option');
    injected.value = '999'; injected.textContent = 'Not authorized';
    school.append(injected);
    fireEvent.change(school, { target: { value: '999' } });
    fireEvent.change(screen.getByTestId('select-live-term'), { target: { value: '4' } });
    fireEvent.change(screen.getByTestId('select-live-rule'), { target: { value: '11' } });
    expect(f.readinessCalls).toBe(0);
    expect(screen.getByTestId('empty-scope')).toBeTruthy();
    expect(f.createMutate).not.toHaveBeenCalled();
  });
  it('clears the rule and readiness when the selected school changes', () => {
    mount(); selectScope();
    fireEvent.change(screen.getByTestId('select-live-school'), { target: { value: '' } });
    expect((screen.getByTestId('select-live-rule') as HTMLSelectElement).value).toBe('');
    expect(document.querySelector('[data-testid="section-readiness"]')).toBeNull();
    expect(f.decideMutate).not.toHaveBeenCalled();
  });
  it('explains procedural and operational blockers without offering a bypass or checkout', () => {
    f.readiness = readyR({ schemaReady: false, approvalReady: false,
      checks: [check('SCHEMA', 'BLOCKED'), check('RUNTIME_SWITCH', 'BLOCKED'), check('FUTURE_REQUIREMENT', 'BLOCKED')] });
    mount(); selectScope();
    const guide = screen.getByTestId('payment-readiness-guidance');
    expect(guide.textContent).toContain('Ordinary Publish and manual managed-Production SQL do not resolve');
    expect(guide.textContent).toContain('Leave LIVE disabled');
    expect(guide.textContent).toContain('Keep payment blocked');
    expect(guide.textContent).toContain('Legacy split and hosted checkout remain archived');
    expect(guide.querySelector('button')).toBeNull();
    expect(f.checkout).not.toHaveBeenCalled();
    expect((screen.getByTestId('button-create-review') as HTMLButtonElement).disabled).toBe(true);
  });
  it('gates creation on valid evidence and no-split confirmation', () => {
    mount(); selectScope();
    const btn = screen.getByTestId('button-create-review') as HTMLButtonElement;
    fireEvent.change(screen.getByTestId('input-evidence-ref'), { target: { value: 'MERCH-REF-001' } });
    fireEvent.change(screen.getByTestId('input-evidence-hash'), { target: { value: 'A'.repeat(64) } });
    const exp = new Date(Date.now() + 2 * 864e5); const local = new Date(exp.getTime() - exp.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
    fireEvent.change(screen.getByTestId('input-expires'), { target: { value: local } });
    fireEvent.change(screen.getByTestId('input-create-reason'), { target: { value: 'Evidence filed' } });
    fireEvent.click(screen.getByTestId('checkbox-no-split'));
    expect(btn.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('input-evidence-hash'), { target: { value: 'a'.repeat(64) } });
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(f.createMutate).toHaveBeenCalledTimes(1);
    const vars = f.createMutate.mock.calls[0][0].data;
    expect(vars).toMatchObject({ schoolId: 1, termId: 4, ruleId: 11, previewDigest: 'pd-abc', noSplitConfirmed: true, policy: 'NEW_ONLY_PRESERVE_LEGACY' });
  });
  it.each([
    'GUARD_FUNCTION_DEFINITION:guard_student_direct_history',
    'TABLE_COLUMNS_OR_PRIVILEGES:student_direct_live_reviews',
  ])('describes failed schema verification without inventing missing storage: %s', (issue) => {
    f.readiness = readyR({ schemaReady: false, approvalReady: false,
      checks: [{ ...check('SCHEMA', 'BLOCKED'), detail: issue }] }); mount(); selectScope();
    const diagnostic = screen.getByTestId('text-schema-blocked').textContent;
    expect(diagnostic).toContain('schema, permissions or history guards have not passed verification');
    expect(diagnostic).not.toContain('storage is missing');
    expect(screen.getByTestId('list-blockers').textContent).toContain(issue);
    expect((screen.getByTestId('button-create-review') as HTMLButtonElement).disabled).toBe(true);
    expect(f.createMutate).not.toHaveBeenCalled();
    expect(f.decideMutate).not.toHaveBeenCalled();
    expect(f.checkout).not.toHaveBeenCalled();
  });
  it('requires REVIEWED state, final screen and explicit confirmation to approve', () => {
    f.reviews = [review('REVIEWED')]; mount(); selectScope();
    fireEvent.click(screen.getByTestId('button-open-final-5'));
    expect(screen.getByTestId('final-shares').textContent).toContain('School 0');
    expect(screen.getByTestId('final-report').textContent).toBe('rep-hash');
    const approve = screen.getByTestId('button-approve-5') as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.change(screen.getByTestId('input-decision-reason-5'), { target: { value: 'All verified' } });
    expect(approve.disabled).toBe(true);
    fireEvent.click(screen.getByTestId('checkbox-confirm-scope-5'));
    expect(approve.disabled).toBe(false);
    fireEvent.click(approve);
    expect(f.decideMutate.mock.calls[0][0]).toEqual({ id: 5, data: { action: 'APPROVED', evidenceDigest: 'ev-1', reason: 'All verified', confirmScope: true } });
  });
  it('blocks approval when stale or blocked', () => {
    f.readiness = readyR({ previewDigest: 'pd-new', approvalReady: false, checks: [check('CONFIG', 'BLOCKED')] });
    f.reviews = [review('REVIEWED')]; mount(); selectScope();
    expect(screen.getByTestId('text-stale-5')).toBeTruthy();
    fireEvent.click(screen.getByTestId('button-open-final-5'));
    fireEvent.change(screen.getByTestId('input-decision-reason-5'), { target: { value: 'try' } });
    fireEvent.click(screen.getByTestId('checkbox-confirm-scope-5'));
    expect((screen.getByTestId('button-approve-5') as HTMLButtonElement).disabled).toBe(true);
    expect(approvalBlockers(f.readiness as never).length).toBeGreaterThan(0);
  });
  it('shows controlled errors without retrying and renders history', async () => {
    f.reviews = [review('CREATED')];
    f.decideMutate.mockImplementation((_v, o) => { o.onError({ data: { message: 'Conflict' } }); o.onSettled(); });
    mount(); selectScope();
    expect(screen.getByTestId('history-5').textContent).toContain('CREATED by actor #7');
    fireEvent.change(screen.getByTestId('input-decision-reason-5'), { target: { value: 'checked' } });
    fireEvent.click(screen.getByTestId('button-mark-reviewed-5'));
    await waitFor(() => expect(screen.getByTestId('text-decision-result-5').textContent).toContain('Conflict'));
    expect(f.decideMutate).toHaveBeenCalledTimes(1);
    expect(f.checkout).not.toHaveBeenCalled();
  });
  it('reconciles readiness, reviews and actor-scoped rules caches after a decision', () => {
    f.reviews = [review('REVIEWED')];
    f.decideMutate.mockImplementation((_v, o) => { o.onSuccess({ id: 5, status: 'APPROVED' }); o.onSettled(); });
    mount(); selectScope();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    fireEvent.click(screen.getByTestId('button-open-final-5'));
    fireEvent.change(screen.getByTestId('input-decision-reason-5'), { target: { value: 'All verified' } });
    fireEvent.click(screen.getByTestId('checkbox-confirm-scope-5'));
    fireEvent.click(screen.getByTestId('button-approve-5'));
    const keys = spy.mock.calls.map(c => JSON.stringify((c[0] as { queryKey: unknown }).queryKey));
    expect(keys).toContain(JSON.stringify(['rules', 'actor', 7]));
    expect(keys.some(k => k.startsWith('["readiness"'))).toBe(true);
    expect(keys.some(k => k.startsWith('["reviews"'))).toBe(true);
    expect(f.decideMutate).toHaveBeenCalledTimes(1);
  });
});
