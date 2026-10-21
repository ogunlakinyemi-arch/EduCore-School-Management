// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null; let host: HTMLElement;
const render = (el: any) => { host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); act(() => root!.render(el)); };
const cleanup = () => { act(() => root?.unmount()); host?.remove(); };
const q = (l: string) => host.querySelector(`[aria-label="${l}"]`) as any;
const txt = () => host.textContent ?? '';
const fireEvent = { change: (el: any, { target }: any) => act(() => { const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, target.value); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }), click: (el: any) => act(() => { el.click(); }) };
const byId = (id: string) => host.querySelector(`[data-testid="${id}"]`) as any;
const waitFor = async (f: () => void) => { await act(async () => { await Promise.resolve(); }); f(); };
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ state: {} as any, classesArgs: [] as any[], recArgs: [] as any[], exportFn: vi.fn(), report: null as any }));
vi.mock('@workspace/api-client-react', () => ({
  useListOwnerSchoolDirectory: () => ({ data: { schools: [{ id: 1, name: 'Alpha School' }, { id: 2, name: 'Beta School' }] } }),
  getListOwnerSchoolDirectoryQueryKey: () => ['d'],
  useListOwnerAttendanceClasses: (p: any, o: any) => { m.classesArgs.push({ p, o }); return { isError: !!m.state.classErr, refetch: vi.fn(), data: [{ id: 7, name: 'JSS 1' }] }; },
  getListOwnerAttendanceClassesQueryKey: () => ['c'],
  useGetOwnerAttendanceRecords: (p: any, o: any) => { m.recArgs.push({ p, o }); return { data: o.query.enabled ? m.report : undefined, isLoading: !!m.state.loading, isError: !!m.state.recErr, refetch: vi.fn() }; },
  getGetOwnerAttendanceRecordsQueryKey: () => ['r'],
  getOwnerAttendanceRecords: (p: any) => m.exportFn(p),
}));
vi.mock('@/components/shared', () => ({
  Button: ({ children, onClick, disabled, testId }: any) => <button onClick={onClick} disabled={disabled} data-testid={testId}>{children}</button>,
  EmptyState: ({ title }: any) => <div>{title}</div>,
  ErrorState: () => <div>error</div>,
  PageHeading: ({ title }: any) => <h1>{title}</h1>,
}));
import { OwnerAttendancePage } from './owner-attendance';

const ev = (id: number, at: string | null, source = 'NFC') => ({ eventId: id, eventType: 'X', source, status: 'OK', result: 'ACCEPTED', at });
let F = '', T = '';
const mk = (type: string) => ({ school: { id: 1, name: 'Alpha School' }, type, class: type === 'STUDENT' ? { id: 7, name: 'JSS 1' } : null, from: F, to: T, timeZone: 'Africa/Lagos', generatedAt: 'x', page: 1, pageSize: 50, total: 1,
  rows: [{ personId: 5, name: 'Ada', identifier: 'S-5', date: '2025-01-02', gateEntries: [ev(1, '2025-01-02T07:00:00Z'), ev(2, '2025-01-02T08:00:00Z')], gateExits: [], classroom: [ev(3, '2025-01-02T07:05:00Z', 'NFC_GATE_AUTO')], anomalies: [], status: 'PRESENT' }] });

beforeEach(() => { m.recArgs = []; m.exportFn.mockReset(); m.state = {}; m.report = mk('STUDENT'); URL.createObjectURL = vi.fn(() => 'blob:x'); URL.revokeObjectURL = vi.fn(); });
afterEach(cleanup);
const pick = (l: string, v: string) => fireEvent.change(q(l), { target: { value: v } });

describe('OwnerAttendancePage', () => {
  let n = 0;
  const bump = (r?: any) => { const d = new Date(Date.parse(q('To').value) + (n++ % 2 ? -1 : 1) * 86400000).toISOString().slice(0, 10); T = d; F = q('From').value; m.report = r ? r() : mk(q('Person type').value); pick('To', d); };
  const sync = () => { F = q('From').value; T = q('To').value; m.report = mk(q('Person type').value); };
  it('Entry Tag-in/Exit Tag-out labels; stale scope, loading, error, empty, csv guard', async () => {
    render(<OwnerAttendancePage />);
    sync(); pick('School', '1'); pick('Class', '7');
    expect(txt()).toContain('Entry Tag-in'); expect(txt()).toContain('Exit Tag-out');
    bump(() => ({ ...mk('STUDENT'), school: { id: 2, name: 'Beta School' } }));
    expect(txt()).not.toContain('Ada'); expect(byId('button-export-csv').disabled).toBe(true);
    bump(() => ({ ...mk('STUDENT'), rows: [] })); expect(txt()).toContain('No rows');
    m.state.loading = true; bump(); expect(txt()).toContain('Loading attendance');
    m.state = { recErr: true }; bump(); expect(txt()).toContain('error');
    m.state = { classErr: true }; bump(); expect(byId('button-export-csv').disabled).toBe(true);
    m.state = {}; bump();
    m.exportFn.mockResolvedValue({ not: 'csv' });
    fireEvent.click(byId('button-export-csv')); await waitFor(() => {});
    expect(txt()).toContain('Export failed'); expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
  it('scopes class to school, resets on change, shows student evidence', () => {
    render(<OwnerAttendancePage />);
    expect(txt()).toContain('Alpha School');
    expect(q('Class').disabled).toBe(true);
    pick('School', '1'); pick('Class', '7');
    expect(txt()).toContain('Ada');
    expect(txt()).toMatch(/NFC_GATE_AUTO \(provisional/);
    expect(host.querySelector('th')!.textContent).toBe('Name'); expect(txt()).toContain('Classroom');
    expect(byId('gate-entries-5-2025-01-02').querySelectorAll('li').length).toBe(2);
    expect(byId('gate-exits-5-2025-01-02').textContent).toBe('Not recorded');
    pick('School', '2');
    expect(q('Class').value).toBe('');
    expect(txt()).not.toContain('Ada');
    expect(m.classesArgs.at(-1).p).toEqual({ schoolId: 2 });
  });
  it('teacher view is gate-only with derived time', () => {
    m.report = mk('TEACHER');
    render(<OwnerAttendancePage />);
    pick('School', '1'); pick('Person type', 'TEACHER'); sync();
    expect(q('Class')).toBeNull();
    expect(Array.from(host.querySelectorAll('th')).some(t => t.textContent === 'Classroom')).toBe(false);
    expect(txt()).toContain('Time in (first Entry Tag-in)');
    expect(txt()).toContain('not separate clock records');
    expect(txt()).toContain('Not recorded');
  });
  it('exports selected filters as CSV without page, and has no write controls', async () => {
    m.exportFn.mockResolvedValue('a,b');
    render(<OwnerAttendancePage />);
    pick('School', '1'); pick('Class', '7');
    fireEvent.click(byId('button-export-csv'));
    await waitFor(() => expect(m.exportFn).toHaveBeenCalled());
    const arg = m.exportFn.mock.calls[0]![0];
    expect(arg).toMatchObject({ schoolId: 1, type: 'STUDENT', classId: 7, format: 'CSV' });
    expect(arg.page).toBeUndefined();
    const labels = Array.from(host.querySelectorAll('button')).map((b: any) => b.textContent as string);
    expect(labels.some((l: string) => /save|delete|correct|record event|edit/i.test(l))).toBe(false);
  });
});
