// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const base = {
  timezone: 'Africa/Lagos', operatingDays: [1, 2, 3, 4, 5], arrivalStart: '06:30', arrivalEnd: '08:00', lateCutoff: '08:15',
  absenceAssessment: '10:00', weekdaysClosing: '15:00', fridayClosing: '13:00', missingTagOutStart: '15:30', missingTagOutEnd: '18:00',
  fridayMissingTagOut: '13:30', classroomDeadline: '09:00', duplicateSeconds: 30, offlineMaxHours: 48, closures: [], exemptions: [],
  rules: { entryEnabled: true, exitEnabled: true, lateness: true, absenceReview: true, classroomAnomalies: true, missingTagOut: true, offlineSync: true, notifications: false, allowEarlyExit: false, allowReentry: true, provisionalClassPresence: true },
};
const st = vi.hoisted(() => ({ data: null as any, isError: false, mutate: vi.fn(), assess: vi.fn(), invalidate: vi.fn(), refetch: vi.fn(), keys: [] as any[] }));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: st.invalidate }) }));
vi.mock('@workspace/api-client-react', () => ({
  getGetSchoolAttendanceScheduleQueryKey: (p: any) => ['/api/school/attendance/schedule', p],
  getGetSchoolCommunityDashboardQueryKey: (id: number) => [`/api/schools/${id}/community-dashboard`],
  useGetSchoolAttendanceSchedule: (p: any) => { st.keys.push(p.schoolId); return { data: st.isError ? undefined : st.data, isLoading: false, isError: st.isError, error: new Error('Internal server error: column created_at; private SQL details'), refetch: st.refetch }; },
  useUpdateSchoolAttendanceSchedule: () => ({ mutate: st.mutate, isPending: false }),
  useAssessSchoolAttendance: () => ({ mutate: st.assess, isPending: false }),
}));
vi.mock('@/components/shared', () => ({
  Button: ({ children, onClick, type = 'button', disabled, testId }: any) => <button type={type} onClick={onClick} disabled={disabled} data-testid={testId}>{children}</button>,
  Field: ({ label, children }: any) => <label><span>{label}</span>{children}</label>,
  ErrorState: ({ message, retry }: any) => <div role="alert">{message}<button onClick={retry}>Retry</button></div>,
}));
import { SchoolAttendanceSchedulePanel } from './school-attendance-schedule';

let root: Root; let box: HTMLDivElement;
const render = (schoolId: number, canEdit: boolean) => act(() => root.render(<SchoolAttendanceSchedulePanel schoolId={schoolId} canEdit={canEdit} />));
const q = (s: string) => box.querySelector(s) as HTMLElement;
function type(el: HTMLInputElement | HTMLTextAreaElement, v: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); });
}
const click = (el: HTMLElement) => act(() => { el.click(); });

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  st.data = { schedule: structuredClone(base), revision: 4, precedence: ['Closure', 'Approved correction', 'Exemption'] };
  st.isError = false; st.mutate.mockReset(); st.assess.mockReset(); st.invalidate.mockReset();
  box = document.createElement('div'); document.body.appendChild(box); root = createRoot(box);
});
afterEach(() => { act(() => root.unmount()); box.remove(); });

describe('school attendance schedule', () => {
  it('submits the school closing/review times through the existing tenant API and reloads the saved values', () => {
    render(7, true);
    const values: Record<string,string> = {
      'Monday school closing':'15:00','Tuesday school closing':'14:30',
      'Wednesday school closing':'14:00','Thursday school closing':'13:45','Friday school closing':'12:30',
      'Missing tag-out window opens':'15:15','Missing tag-out window ends':'17:00',
      'Friday missing tag-out check':'13:30',
    };
    for (const [label,value] of Object.entries(values))
      type(q(`input[aria-label="${label}"]`) as HTMLInputElement,value);
    type(q('textarea') as HTMLTextAreaElement,'Approved school closing times');
    act(() => { q('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); });
    const [request,callbacks] = st.mutate.mock.calls[0];
    expect(request.params).toEqual({schoolId:7});
    expect(request.data).toMatchObject({revision:4,reason:'Approved school closing times',
      schedule:{weekdaysClosing:'15:00',fridayClosing:'12:30',
        closingByWeekday:{'1':'15:00','2':'14:30','3':'14:00','4':'13:45','5':'12:30'},missingTagOutStart:'15:15',
        missingTagOutEnd:'17:00',fridayMissingTagOut:'13:30'}});
    const response={...st.data,revision:5,schedule:structuredClone(request.data.schedule)};
    act(() => { st.data=response; callbacks.onSuccess(response); });
    render(7,true);
    for (const [label,value] of Object.entries(values))
      expect((q(`input[aria-label="${label}"]`) as HTMLInputElement).value).toBe(value);
    expect(q('[data-testid=text-schedule-revision]').textContent).toContain('5');
    expect(st.invalidate).toHaveBeenCalledWith({queryKey:['/api/school/attendance/schedule',{schoolId:7}]});
    expect(st.invalidate).toHaveBeenCalledWith({queryKey:['/api/schools/7/community-dashboard']});
    expect(request.data.schedule.rules).toEqual(base.rules);
    expect(request.data.schedule.duplicateSeconds).toBe(base.duplicateSeconds);
    expect(request.data.schedule.offlineMaxHours).toBe(base.offlineMaxHours);
  });
  it('shows defaults, precedence and revision', () => {
    render(1, true);
    expect((box.querySelector('input[aria-label="Arrival opens"]') as HTMLInputElement).value).toBe('06:30');
    expect(q('[data-testid=text-precedence]').textContent).toContain('Closure → Approved correction');
    expect(q('[data-testid=text-schedule-revision]').textContent).toContain('4');
    expect((q('input[aria-label="Operating day Sat"]') as HTMLInputElement).checked).toBe(false);
  });
  it('saves with revision and reason, then invalidates the tenant query', () => {
    render(7, true);
    click(q('input[aria-label=Notifications]'));
    click(Array.from(box.querySelectorAll('button')).find(b => b.textContent === 'Add closure')!);
    type(q('input[type=date]') as HTMLInputElement, '2025-12-25');
    type(box.querySelector('input[type=date]')!.closest('label')!.parentElement!.querySelectorAll('input')[1] as HTMLInputElement, 'Christmas');
    expect(q('[data-testid=status-schedule-dirty]')).toBeTruthy();
    type(q('textarea') as HTMLTextAreaElement, 'Term calendar');
    act(() => { q('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    const arg = st.mutate.mock.calls[0][0];
    expect(arg.params).toEqual({ schoolId: 7 });
    expect(arg.data.revision).toBe(4);
    expect(arg.data.reason).toBe('Term calendar');
    expect(arg.data.schedule.rules.notifications).toBe(true);
    expect(arg.data.schedule.closures).toEqual([{ date: '2025-12-25', reason: 'Christmas' }]);
    act(() => st.mutate.mock.calls[0][1].onSuccess({}));
    expect(st.invalidate).toHaveBeenCalledWith({ queryKey: ['/api/school/attendance/schedule', { schoolId: 7 }] });
  });
  it('blocks save without reason and shows validation', () => {
    render(1, true);
    click(q('input[aria-label=Lateness]'));
    act(() => { q('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(st.mutate).not.toHaveBeenCalled();
    expect(q('[data-testid=list-schedule-errors]').textContent).toContain('Reason');
  });
  it('shows server save error', () => {
    render(1, true);
    click(q('input[aria-label=Lateness]'));
    type(q('textarea') as HTMLTextAreaElement, 'Fix');
    act(() => { q('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    act(() => st.mutate.mock.calls[0][1].onError(new Error('Revision conflict')));
    expect(q('[data-testid=text-save-error]').textContent).toContain('Revision conflict');
  });
  it('is read-only without edit access', () => {
    render(1, false);
    expect(q('[data-testid=text-schedule-readonly]')).toBeTruthy();
    expect(q('[data-testid=button-save-schedule]')).toBeNull();
    expect(q('[data-testid=button-run-assessment]')).toBeNull();
    expect(box.querySelectorAll('fieldset[disabled]').length).toBeGreaterThan(0);
  });
  it('shows load error with retry', () => {
    st.refetch.mockClear();
    st.isError = true; render(1, true);
    expect(q('[role=alert]').textContent).toContain('could not be loaded');
    expect(q('[role=alert]').className).toContain('text-[hsl(var(--destructive))]');
    expect(q('[role=alert]').textContent).toContain('selected school');
    expect(q('[role=alert]').textContent).not.toMatch(/Internal server error|created_at|private SQL/);
    click(q('[data-testid=button-retry-attendance-schedule]'));
    expect(st.refetch).toHaveBeenCalledTimes(1);
    act(() => { st.isError = false; }); render(1, true);
    expect(q('[data-testid=form-attendance-schedule]')).toBeTruthy();
    expect(q('[role=alert]')).toBeNull();
  });
  it('labels unsaved defaults as unconfigured instead of pretending they are persisted', () => {
    st.data = { schedule: structuredClone(base), revision: 0, precedence: [] };
    render(7, true);
    expect(q('[data-testid=text-schedule-unconfigured]').textContent).toContain('suggested defaults');
    expect(q('[data-testid=text-schedule-revision]').textContent).toContain('0');
    expect((q('input[aria-label="Friday school closing"]') as HTMLInputElement).value).toBe(base.fridayClosing);
  });
  it('resets draft on tenant change and ignores late response from old tenant', () => {
    render(1, true);
    click(q('input[aria-label=Lateness]'));
    type(q('textarea') as HTMLTextAreaElement, 'Old tenant');
    act(() => { q('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    const lateError = st.mutate.mock.calls[0][1].onError;
    st.data = { schedule: structuredClone(base), revision: 9, precedence: [] };
    render(2, true);
    expect(q('[data-testid=status-schedule-dirty]')).toBeNull();
    expect(q('[data-testid=text-schedule-revision]').textContent).toContain('9');
    act(() => lateError(new Error('stale')));
    expect(q('[data-testid=text-save-error]')).toBeNull();
  });
  it('continues assessment batches while cursor is present', () => {
    render(1, true);
    click(q('[data-testid=button-run-assessment]'));
    expect(st.assess.mock.calls[0][0]).toEqual({ params: { schoolId: 1 }, data: { afterStudentId: 0 } });
    act(() => st.assess.mock.calls[0][1].onSuccess({ date: '2025-01-06', reviewed: 100, created: 3, nextAfterStudentId: 100 }));
    click(q('[data-testid=button-continue-assessment]'));
    expect(st.assess.mock.calls[1][0].data.afterStudentId).toBe(100);
  });
});
