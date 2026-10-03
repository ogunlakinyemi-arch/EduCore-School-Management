// @vitest-environment jsdom
// COMPONENT TESTS: owner/non-owner identities are mocked via useSchoolAdminAccess and hooks are mocked.
// These are not genuine Platform Owner browser verification.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const st = vi.hoisted(() => ({
  owner: true, rows: [] as unknown[], audit: [] as unknown[], auditError: false, overviewError: false,
  lock: vi.fn(), unlock: vi.fn(), invalidate: vi.fn(),
}));
vi.mock('@tanstack/react-query', async (orig) => ({ ...(await orig<object>()), useQueryClient: () => ({ invalidateQueries: st.invalidate }) }));
vi.mock('@workspace/api-client-react', async (orig) => ({
  ...(await orig<object>()),
  useGetSubscriptionEnforcementOverview: () => ({ data: st.rows, isLoading: false, isError: st.overviewError, refetch: vi.fn() }),
  useGetSchoolSubscriptionAudit: () => ({ data: st.auditError ? undefined : st.audit, isLoading: false, isError: st.auditError, refetch: vi.fn() }),
  useLockSchoolSubscriptions: () => ({ mutateAsync: st.lock }),
  useUnlockSchoolSubscriptions: () => ({ mutateAsync: st.unlock }),
}));
vi.mock('@/components/shared', async (orig) => ({
  ...(await orig<object>()),
  useTenant: () => ({ schoolId: 1 }),
  useSchoolAdminAccess: () => ({ isPlatformOwner: st.owner }),
}));
import { SubscriptionEnforcementPage } from './subscription-enforcement';

const row = (id: number, o: object = {}) => ({ schoolId: id, schoolName: `School ${id}`, status: 'ok', state: 'UNPAID', schoolEnforcementStatus: 'ACTIVE', manualVersion: id * 10, termId: 1, studentsTotal: 5, studentsPaid: 5, ...o });
let root: Root; let box: HTMLDivElement;
const render = () => { box = document.createElement('div'); document.body.appendChild(box); root = createRoot(box); act(() => root.render(<SubscriptionEnforcementPage />)); };
const q = (id: string) => box.ownerDocument.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const click = (id: string) => act(() => { q(id)!.click(); });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  st.owner = true; st.audit = []; st.auditError = false; st.overviewError = false;
  st.rows = [row(1), row(2, { schoolEnforcementStatus: 'LOCKED', reason: 'Dispute' })];
  st.lock.mockReset(); st.unlock.mockReset(); st.invalidate.mockReset().mockResolvedValue(undefined);
});
afterEach(() => { act(() => root.unmount()); box.remove(); });

describe('enforcement page (component tests, mocked identity)', () => {
  it('owner confirms single lock with id, expectedVersion, reason; invalidates', async () => {
    st.lock.mockResolvedValue([{ schoolId: 1, changed: true, state: 'LOCKED', manualVersion: 11 }]);
    render();
    click('button-lock-school-1');
    expect(q('confirm-schools')!.textContent).toContain('school #1');
    expect(q('confirm-schools')!.textContent).toContain('version 10');
    const ta = q('input-action-reason') as HTMLTextAreaElement;
    expect(ta.maxLength).toBe(500);
    act(() => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, 'Unpaid dispute'); ta.dispatchEvent(new Event('input', { bubbles: true })); });
    click('button-confirm-action'); await flush();
    expect(st.lock).toHaveBeenCalledWith({ data: { confirmed: true, schools: [{ schoolId: 1, expectedVersion: 10 }], reason: 'Unpaid dispute' } });
    expect(q('result-school-1')!.textContent).toContain('School locked');
    expect(st.invalidate.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
  it('cancel sends nothing', () => {
    render(); click('button-lock-school-1'); click('button-cancel-action');
    expect(st.lock).not.toHaveBeenCalled(); expect(q('confirm-schools')).toBeNull();
  });
  it('unlock for locked school states consequences and calls unlock only', async () => {
    st.unlock.mockResolvedValue([{ schoolId: 2, changed: true, state: 'ACTIVE' }]);
    render(); click('button-unlock-school-2');
    expect(q('confirm-consequences')!.textContent).toContain('Unpaid students and security restrictions remain');
    click('button-confirm-action'); await flush();
    expect(st.unlock).toHaveBeenCalledWith({ data: { confirmed: true, schools: [{ schoolId: 2, expectedVersion: 20 }] } });
    expect(st.lock).not.toHaveBeenCalled();
  });
  it('bulk lock disabled for mixed selection; allowed for homogeneous; partial failures shown', async () => {
    st.rows = [row(1), row(3), row(2, { schoolEnforcementStatus: 'LOCKED' })];
    st.lock.mockResolvedValue([{ schoolId: 1, changed: true, state: 'LOCKED' }, { schoolId: 3, changed: false, state: 'FAILED', error: 'Version conflict' }]);
    render();
    click('select-school-1'); click('select-school-2');
    expect((q('button-lock-selected') as HTMLButtonElement).disabled).toBe(true);
    click('select-school-2'); click('select-school-3');
    click('button-lock-selected');
    click('button-confirm-action'); await flush();
    expect(st.lock.mock.calls[0][0].data.schools).toEqual([{ schoolId: 1, expectedVersion: 10 }, { schoolId: 3, expectedVersion: 30 }]);
    expect(q('result-school-1')!.textContent).toContain('School locked');
    expect(q('result-school-3')!.textContent).toContain('Failed: Version conflict');
    expect(st.invalidate).toHaveBeenCalled();
  });
  it('stale selection (version change) clears selection and closes confirmation', () => {
    render(); click('select-school-1');
    st.rows = [row(1, { manualVersion: 99 }), row(2)];
    act(() => root.render(<SubscriptionEnforcementPage />));
    expect((q('select-school-1') as HTMLInputElement).checked).toBe(false);
    expect(q('enforcement-notice')!.textContent).toContain('selection was cleared');
  });
  it('payment change alone keeps selection', () => {
    render(); click('select-school-1');
    st.rows = [row(1, { studentsPaid: 1 }), row(2)];
    act(() => root.render(<SubscriptionEnforcementPage />));
    expect((q('select-school-1') as HTMLInputElement).checked).toBe(true);
  });
  it('payment/status change without manual change keeps selection, confirmation and actions', () => {
    render(); click('select-school-1'); click('button-lock-selected');
    st.rows = [row(1, { studentsPaid: 0, state: 'LOCKED', inGracePeriod: true }), row(2, { schoolEnforcementStatus: 'LOCKED', reason: 'Dispute' })];
    act(() => root.render(<SubscriptionEnforcementPage />));
    expect((q('select-school-1') as HTMLInputElement).checked).toBe(true);
    expect(q('confirm-schools')).not.toBeNull();
    expect(q('enforcement-notice')).toBeNull();
    expect(q('button-lock-school-1')).not.toBeNull();
    expect(q('button-unlock-school-2')).not.toBeNull();
  });
  it('mixed selection explains disabled bulk actions', () => {
    render(); click('select-school-1'); click('select-school-2');
    expect(q('mixed-selection-hint')!.textContent).toContain('bulk actions are disabled');
  });
  it('audit timestamps show Lagos date and time', () => {
    st.audit = [{ id: 9, schoolId: 1, action: 'SCHOOL_LOCKED', timestamp: '2025-01-02T23:30:00Z', actorUserId: 4, previousState: 'ACTIVE', newState: 'LOCKED', reason: null, requestId: 'r9', studentId: null }];
    render(); click('button-audit-1');
    expect(q('audit-event-9')!.textContent).toMatch(/03 Jan 2025.*00:30 WAT/);
  });
  it('SDK error shows retryable message and still refreshes', async () => {
    st.lock.mockRejectedValue(new Error('Server unavailable'));
    render(); click('button-lock-school-1'); click('button-confirm-action'); await flush();
    expect(q('action-error')!.textContent).toContain('Server unavailable');
    expect(st.invalidate).toHaveBeenCalled();
    expect(q('button-confirm-action')).not.toBeNull();
  });
  it('double click confirm sends once while pending', async () => {
    let resolve!: (v: unknown) => void;
    st.lock.mockReturnValue(new Promise(r => { resolve = r; }));
    render(); click('button-lock-school-1'); click('button-confirm-action'); click('button-confirm-action');
    expect(st.lock).toHaveBeenCalledTimes(1);
    await act(async () => { resolve([{ schoolId: 1, changed: true, state: 'LOCKED' }]); });
  });
  it('audit events display read-only for owner', () => {
    st.audit = [{ id: 7, schoolId: 1, action: 'SCHOOL_LOCKED', timestamp: '2025-01-02T00:00:00Z', actorUserId: 4, previousState: 'ACTIVE', newState: 'LOCKED', reason: 'Dispute', requestId: 'req-1', studentId: null }];
    render(); click('button-audit-1');
    expect(q('audit-event-7')!.textContent).toContain('SCHOOL_LOCKED');
    expect(q('audit-event-7')!.textContent).toContain('req-1');
    expect(q('audit-panel')!.querySelectorAll('input,textarea').length).toBe(0);
  });
  it('audit error offers retry', () => {
    st.auditError = true; render(); click('button-audit-1');
    expect(q('audit-error')).not.toBeNull(); expect(q('button-retry-audit')).not.toBeNull();
  });
  it('non-owner sees read-only overview and audit with no owner actions', () => {
    st.owner = false; st.audit = [{ id: 1, schoolId: 1, action: 'SCHOOL_UNLOCKED', timestamp: '2025-01-02T00:00:00Z', actorUserId: null, previousState: 'LOCKED', newState: 'ACTIVE', reason: null, requestId: 'r', studentId: null }];
    render();
    expect(q('enforcement-read-only')).not.toBeNull();
    expect(q('audit-event-1')).not.toBeNull();
    for (const id of ['button-lock-school-1', 'button-unlock-school-2', 'button-lock-selected', 'button-unlock-selected', 'select-school-1']) expect(q(id)).toBeNull();
  });
});
