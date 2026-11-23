// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const st = vi.hoisted(() => ({
  schools: [{ id: 1, code: 'S1', name: 'Hill School' }, { id: 2, code: 'S2', name: 'River Academy' }] as any[],
  data: null as any,
  loading: false, error: false,
  mutateAsync: vi.fn(),
  invalidate: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: st.invalidate }) }));
vi.mock('@workspace/api-client-react', () => ({
  useListSchools: () => ({ data: st.schools, isLoading: false, isError: false, refetch: vi.fn() }),
  useGetOwnerFreeAcademicTerms: (p: { schoolId: number }) => ({ data: st.data ? { ...st.data, schoolId: p.schoolId } : undefined, isLoading: st.loading, isError: st.error, refetch: st.refetch }),
  useChangeOwnerFreeAcademicTerm: () => ({ mutateAsync: st.mutateAsync }),
  getListSchoolsQueryKey: () => ['schools'],
  getGetOwnerFreeAcademicTermsQueryKey: (p: any) => ['free', p],
  getListSubscriptionsQueryKey: () => ['subs'],
  getGetSchoolBillingContextQueryKey: () => ['billing'],
  getGetSubscriptionEnforcementOverviewQueryKey: () => ['enf'],
  getGetMySubscriptionEnforcementQueryKey: () => ['myenf'],
  getGetMyStudentPlatformAccessQueryKey: () => ['access'],
}));
vi.mock('@/components/shared', () => ({
  cx: (...p: any[]) => p.filter(Boolean).join(' '),
  Button: ({ children, onClick, disabled, testId }: any) => <button type="button" onClick={onClick} disabled={disabled} data-testid={testId}>{children}</button>,
  Modal: ({ title, children }: any) => <div role="dialog" aria-label={title}>{children}</div>,
}));
import { OwnerFreeAcademicTerms, calendarDate, canGrant, canSuspend, reasonValid } from './owner-free-academic-terms';

const term = (o: any = {}) => ({ id: 11, sessionId: 5, name: 'First Term', sessionName: '2026/2027', startDate: '2026-09-14', endDate: '2026-12-18', status: 'PAYMENT_REQUIRED', grantId: null, calendarChanged: false, ...o });
let root: Root; let host: HTMLDivElement;
const $ = (id: string) => host.querySelector(`[data-testid="${id}"]`) as any;
const render = () => act(() => { root.render(<OwnerFreeAcademicTerms />); });
const select = (id: string, v: string) => act(() => { const el = $(id); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!; set.call(el, v); el.dispatchEvent(new Event('change', { bubbles: true })); });
const type = (id: string, v: string) => act(() => { const el = $(id); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!; set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); });
const click = (id: string) => act(() => { $(id).click(); });
async function pickAll() { render(); select('select-free-term-school', '2'); select('select-free-term-session', '5'); select('select-free-term-term', '11'); }

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  st.data = { ready: true, terms: [term()], history: [] }; st.loading = false; st.error = false;
  st.mutateAsync.mockReset(); st.invalidate.mockReset(); st.refetch.mockReset();
});
afterEach(() => { act(() => root.unmount()); host.remove(); });

describe('owner free academic term helpers', () => {
  it('formats calendar dates without timezone shift', () => { expect(calendarDate('2027-01-01')).toBe('01 Jan 2027'); });
  it('validates trimmed reason 5-500', () => { expect(reasonValid('   abcd ')).toBe(false); expect(reasonValid(' abcde ')).toBe(true); expect(reasonValid('x'.repeat(501))).toBe(false); });
  it('gates grant and suspend', () => {
    expect(canGrant(true, term({ grantId: 3 }) as any)).toBe(false);
    expect(canGrant(false, term() as any)).toBe(false);
    expect(canSuspend(true, term({ grantId: 3, status: 'ACTIVE' }) as any)).toBe(true);
    expect(canSuspend(true, term({ grantId: 3, status: 'COMPLETED' }) as any)).toBe(false);
    expect(canSuspend(true, term({ grantId: null, status: 'TRIAL_GRANTED' }) as any)).toBe(false);
  });
});

describe('OwnerFreeAcademicTerms', () => {
  it('lists every school and explains policy', () => {
    render();
    expect(host.textContent).toContain('River Academy');
    expect($('free-term-policy').textContent).toContain('does not accrue BRO');
  });

  it('grants only after review and explicit confirmation, sending snapshot dates once', async () => {
    st.mutateAsync.mockResolvedValue({ schoolId: 2, termId: 11, action: 'grant' });
    await pickAll();
    expect($('button-review-free-term-grant').disabled).toBe(true);
    type('input-free-term-reason', '  Launch partner school  ');
    click('button-review-free-term-grant');
    expect($('free-term-confirm-summary').textContent).toContain('River Academy');
    expect($('free-term-confirm-summary').textContent).toContain('14 Sep 2026 to 18 Dec 2026');
    expect($('button-free-term-confirm').disabled).toBe(true);
    click('checkbox-free-term-confirm');
    await act(async () => { $('button-free-term-confirm').click(); });
    expect(st.mutateAsync).toHaveBeenCalledTimes(1);
    expect(st.mutateAsync).toHaveBeenCalledWith({ action: 'grant', data: { schoolId: 2, sessionId: 5, termId: 11, startDate: '2026-09-14', endDate: '2026-12-18', reason: 'Launch partner school', confirmed: true } });
    expect(st.invalidate).toHaveBeenCalledWith({ queryKey: ['subs'] });
    expect(st.invalidate).toHaveBeenCalledWith({ queryKey: ['access'] });
  });

  it('disables grant when a grant exists and allows suspend for Active', async () => {
    st.data.terms = [term({ grantId: 9, status: 'ACTIVE' })];
    await pickAll();
    type('input-free-term-reason', 'Policy review');
    expect($('button-review-free-term-grant').disabled).toBe(true);
    expect($('button-review-free-term-suspend').disabled).toBe(false);
  });

  it('shows calendar-changed grants as needing review', () => {
    st.data.terms = [term({ grantId: 9, status: 'SUSPENDED', calendarChanged: true })];
    render(); select('select-free-term-school', '1');
    expect($('free-term-status-11').textContent).toBe('Suspended · needs review');
  });

  it('keeps calendar read-only when schema not ready', async () => {
    st.data.ready = false;
    await pickAll();
    expect($('free-term-not-ready')).toBeTruthy();
    expect($('input-free-term-reason').disabled).toBe(true);
    expect($('button-review-free-term-grant').disabled).toBe(true);
  });

  it('ambiguous failure requires refresh and never retries', async () => {
    st.mutateAsync.mockRejectedValue(new Error('Network lost.'));
    await pickAll();
    type('input-free-term-reason', 'Launch partner school');
    click('button-review-free-term-grant'); click('checkbox-free-term-confirm');
    await act(async () => { $('button-free-term-confirm').click(); });
    expect(st.mutateAsync).toHaveBeenCalledTimes(1);
    expect($('free-term-notice').textContent).toContain('Refresh status before trying again');
    expect($('button-review-free-term-grant').disabled).toBe(true);
    expect($('button-free-term-refresh')).toBeTruthy();
  });

  it('resets term when session changes and shows error retry', () => {
    st.error = true; st.data = null;
    render(); select('select-free-term-school', '1');
    click('free-term-error-retry');
    expect(st.refetch).toHaveBeenCalled();
  });

  it('renders immutable history with WAT timestamp', () => {
    st.data.history = [{ id: 1, grantId: 9, actorUserId: 4, actorName: 'Owner Ama', schoolId: 1, sessionId: 5, termId: 11, status: 'TRIAL_GRANTED', reason: 'Launch', createdAt: '2026-09-01T23:30:00Z', startDate: '2026-09-14', endDate: '2026-12-18' }];
    render(); select('select-free-term-school', '1');
    const txt = $('free-term-history-1').textContent;
    expect(txt).toContain('Trial Granted'); expect(txt).toContain('Owner Ama'); expect(txt).toContain('WAT'); expect(txt).toContain('02 Sept 2026'.slice(0, 2));
  });
});
