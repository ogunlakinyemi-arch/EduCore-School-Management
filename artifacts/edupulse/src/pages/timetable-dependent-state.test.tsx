// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AcademicSession, ClassSubjectAssignment, Employee, Subject, TeacherClassAssignment } from '@workspace/api-client-react';
import { ManageTimetableView, TimetableEditor } from './timetable';

const state = vi.hoisted(() => ({
  create: vi.fn(), update: vi.fn(), requests: [] as Array<{ endpoint: string; params: any; options: any }>,
  subjects: [] as Subject[], classSubjects: [] as ClassSubjectAssignment[], assignments: [] as TeacherClassAssignment[],
}));
const sessions = [
  { id: 2, schoolId: 1, name: '2026/2027', startDate: '2026-09-01', endDate: '2027-07-31', isCurrent: true, status: 'ACTIVE' },
  { id: 8, schoolId: 1, name: '2025/2026', startDate: '2025-09-01', endDate: '2026-07-31', status: 'COMPLETED' },
] satisfies AcademicSession[];
const teachers = [
  { id: 6, schoolId: 1, employeeId: 'T006', firstName: 'Maths', lastName: 'Teacher', type: 'TEACHER', status: 'ACTIVE' },
  { id: 16, schoolId: 1, employeeId: 'T016', firstName: 'English', lastName: 'Teacher', type: 'TEACHER', status: 'ACTIVE' },
] satisfies Employee[];
const classes = [{ id: 4, schoolId: 1, name: 'SS2', section: 'B' }, { id: 14, schoolId: 1, name: 'SS2', section: 'C' }];
const terms = [{ id: 3, sessionId: 2, name: 'FIRST', isCurrent: true }, { id: 9, sessionId: 2, name: 'SECOND' }, { id: 10, sessionId: 8, name: 'FIRST' }];

vi.mock('@workspace/api-client-react', () => {
  const key = (endpoint: string) => (...args: any[]) => [endpoint, ...args];
  const result = (endpoint: string, data: any, params: any, options: any) => {
    state.requests.push({ endpoint, params, options });
    return { data: options?.query?.enabled === false ? undefined : data, isLoading: false, isError: false, refetch: vi.fn() };
  };
  return {
    useListAcademicSessions: (p: any, o: any) => result('sessions', sessions, p, o),
    useListAcademicTerms: (id: number, p: any, o: any) => result('terms', terms.filter(t => t.sessionId === id), { ...p, sessionId: id }, o),
    useListClasses: (p: any, o: any) => result('classes', classes, p, o),
    useListSubjects: (p: any, o: any) => result('subjects', state.subjects, p, o),
    useListEmployees: (p: any, o: any) => result('employees', teachers, p, o),
    useListClassSubjectAssignments: (p: any, o: any) => result('classSubjects', state.classSubjects.filter(a => a.schoolId === p.schoolId && a.sessionId === p.sessionId), p, o),
    useListTeacherClassAssignments: (p: any, o: any) => result('assignments', state.assignments.filter(a => a.schoolId === p.schoolId && a.sessionId === p.sessionId), p, o),
    useListAcademicTimetable: (p: any, o: any) => result('timetable', [], p, o),
    useCreateAcademicTimetableEntry: () => ({ mutateAsync: state.create, isPending: false }),
    useUpdateAcademicTimetableEntry: () => ({ mutateAsync: state.update, isPending: false }),
    getListAcademicSessionsQueryKey: key('sessions'), getListAcademicTermsQueryKey: key('terms'),
    getListClassesQueryKey: key('classes'), getListSubjectsQueryKey: key('subjects'), getListEmployeesQueryKey: key('employees'),
    getListClassSubjectAssignmentsQueryKey: key('classSubjects'), getListTeacherClassAssignmentsQueryKey: key('assignments'),
    getListAcademicTimetableQueryKey: key('timetable'), getGetMyAcademicTimetableQueryKey: key('mine'),
  };
});
vi.mock('@/components/shared', () => ({
  Field: ({ label, children }: any) => <label>{label}{children}</label>,
  Button: ({ children, variant, testId, ...props }: any) => <button type="button" data-testid={testId} {...props}>{children}</button>,
  SkeletonPage: () => <div>Loading</div>, ErrorState: ({ message }: any) => <div>{message}</div>,
  EmptyState: ({ title }: any) => <div>{title}</div>, Modal: ({ children }: any) => <div role="dialog">{children}</div>,
}));

let host: HTMLDivElement;
let root: Root;
let qc: QueryClient;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.history.replaceState(null, '', '/timetable');
  vi.clearAllMocks(); state.requests = [];
  classes[1].section = 'C';
  state.create.mockResolvedValue({ id: 71 });
  state.update.mockResolvedValue({ id: 71 });
  state.subjects = [
    { id: 5, schoolId: 1, name: 'Maths', code: 'MAT', status: 'ACTIVE' },
    { id: 15, schoolId: 1, name: 'English', code: 'ENG', status: 'ACTIVE' },
    { id: 25, schoolId: 99, name: 'Other-school subject', code: 'OTHER', status: 'ACTIVE' },
  ];
  state.classSubjects = [
    { id: 20, schoolId: 1, classId: 4, section: 'B', subjectId: 5, teacherId: 6, sessionId: 2, termId: 3, status: 'ACTIVE' },
    { id: 21, schoolId: 1, classId: 14, section: 'C', subjectId: 15, teacherId: 16, sessionId: 2, termId: 3, status: 'ACTIVE' },
  ];
  state.assignments = [
    { id: 22, schoolId: 1, classId: 4, section: 'B', subjectId: 5, teacherId: 6, sessionId: 2, assignmentType: 'SUBJECT_TEACHER', status: 'ACTIVE', startDate: '2026-09-01' },
    { id: 23, schoolId: 1, classId: 14, section: 'C', subjectId: 15, teacherId: 16, sessionId: 2, assignmentType: 'SUBJECT_TEACHER', status: 'ACTIVE', startDate: '2026-09-01' },
  ];
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); qc.clear(); host.remove(); });
const select = (label: string) => host.querySelector<HTMLSelectElement>(`[aria-label="Timetable ${label}"]`)!;
async function change(label: string, value: string) {
  await act(async () => { const node = select(label); node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); });
}
async function renderEditor(props: any = {}) {
  await act(async () => root.render(<QueryClientProvider client={qc}><TimetableEditor schoolId={1}
    initialSessionId={2} initialTermId={3} defaultClassId={4} onDone={vi.fn()} onCancel={vi.fn()} {...props} /></QueryClientProvider>));
}
async function submit() {
  await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
}
describe('timetable period → class → section → subject → teacher', () => {
  it('shows only the real school/class/section subject and its eligible teacher', async () => {
    await renderEditor(); expect([...select('subject').options].map(o => o.value)).toEqual(['', '5']);
    await change('subject', '5'); expect([...select('teacher').options].map(o => o.value)).toEqual(['', '6']);
    await change('teacher', '6'); await submit();
    expect(state.create).toHaveBeenCalledWith({ data: expect.objectContaining({ schoolId: 1, sessionId: 2, termId: 3, classId: 4, section: 'B', subjectId: 5, teacherId: 6 }) });
  });
  it('clears every dependent selection when session changes without choosing a fallback term', async () => {
    await renderEditor(); await change('subject', '5'); await change('teacher', '6');
    await change('session', '8');
    expect(select('term').value).toBe(''); expect(select('class').value).toBe('');
    expect(select('section').value).toBe('__choose__'); expect(select('subject').value).toBe(''); expect(select('teacher').value).toBe('');
    await submit(); expect(state.create).not.toHaveBeenCalled();
    await change('term', '10'); expect(select('class').value).toBe('');
  });
  it('clears class, section, subject and teacher on a term change', async () => {
    await renderEditor(); await change('subject', '5'); await change('teacher', '6'); await change('term', '9');
    expect(select('class').value).toBe(''); expect(select('section').value).toBe('__choose__');
    expect(select('subject').value).toBe(''); expect(select('teacher').value).toBe('');
    await change('class', '4'); await change('section', 'B');
    expect(select('subject').disabled).toBe(true);
    expect(host.textContent).toContain('No active subject is assigned');
    await submit(); expect(state.create).not.toHaveBeenCalled();
  });
  it('requires a fresh section after class changes', async () => {
    await renderEditor(); await change('subject', '5'); await change('teacher', '6'); await change('class', '14');
    expect(select('section').value).toBe('__choose__'); expect(select('subject').disabled).toBe(true);
    expect(select('teacher').value).toBe('');
    await change('section', 'C'); expect([...select('subject').options].map(o => o.value)).toEqual(['', '15']);
  });
  it('maps a section change to the existing class-row ID and clears stale subject/teacher IDs', async () => {
    await renderEditor(); await change('subject', '5'); await change('teacher', '6'); await change('section', 'C');
    expect(select('class').value).toBe('14'); expect(select('subject').value).toBe(''); expect(select('teacher').value).toBe('');
    await change('subject', '15'); await change('teacher', '16'); await submit();
    expect(state.create).toHaveBeenCalledWith({ data: expect.objectContaining({ classId: 14, section: 'C', subjectId: 15, teacherId: 16 }) });
  });
  it('clears a teacher when its subject changes', async () => {
    state.classSubjects.push({ ...state.classSubjects[0], id: 30, subjectId: 15, teacherId: 16 });
    state.assignments.push({ ...state.assignments[0], id: 31, subjectId: 15, teacherId: 16 });
    await renderEditor(); await change('subject', '5'); await change('teacher', '6'); await change('subject', '15');
    expect(select('teacher').value).toBe(''); expect([...select('teacher').options].map(o => o.value)).toEqual(['', '16']);
    await submit(); expect(state.create).not.toHaveBeenCalled();
  });
  it('allows an explicitly chosen no-section class without native required-field blocking', async () => {
    classes[1].section = '';
    state.classSubjects[1].section = '';
    state.assignments[1].section = '';
    await renderEditor(); await change('class', '14'); await change('section', '__none__');
    expect(select('section').checkValidity()).toBe(true);
    await change('subject', '15'); await change('teacher', '16'); await submit();
    expect(state.create).toHaveBeenCalledWith({ data: expect.objectContaining({ classId: 14, section: '', subjectId: 15, teacherId: 16 }) });
  });
  it('uses generated catalog keys and school/session-scoped assignment requests with fresh data', async () => {
    await renderEditor();
    for (const endpoint of ['sessions', 'terms', 'classes', 'subjects', 'employees', 'classSubjects', 'assignments']) {
      const request = state.requests.find(r => r.endpoint === endpoint)!;
      expect(request.params.schoolId).toBe(1);
      expect(request.options.query.queryKey[0]).toBe(endpoint);
      expect(request.options.query.staleTime).toBe(0);
      expect(request.options.query.refetchOnMount).toBe('always');
    }
    for (const endpoint of ['classSubjects', 'assignments']) expect(state.requests.find(r => r.endpoint === endpoint)?.params.sessionId).toBe(2);
    await change('session', '8');
    for (const endpoint of ['classSubjects', 'assignments']) expect(state.requests.filter(r => r.endpoint === endpoint).at(-1)?.params.sessionId).toBe(8);
  });
  it('explains a missing teacher assignment and blocks save', async () => {
    state.assignments = [];
    await renderEditor(); await change('subject', '5');
    expect(select('teacher').disabled).toBe(true); expect(host.textContent).toContain('No teacher is assigned to this subject/class.');
    await submit(); expect(state.create).not.toHaveBeenCalled();
  });
  it('clears removed subjects and revoked assignments on a refetch', async () => {
    await renderEditor(); await change('subject', '5'); await change('teacher', '6');
    state.classSubjects = []; await renderEditor();
    expect(select('subject').value).toBe(''); expect(select('teacher').value).toBe('');
    await submit(); expect(state.create).not.toHaveBeenCalled();
  });
  it('does not restore old edit IDs after changing to another session and back', async () => {
    await renderEditor({ initial: { id: 71, sessionId: 2, termId: 3, classId: 4, subjectId: 5, teacherId: 6 } });
    await change('session', '8'); await change('session', '2'); await change('term', '3');
    expect(select('class').value).toBe(''); expect(select('subject').value).toBe(''); expect(select('teacher').value).toBe('');
    await submit(); expect(state.update).not.toHaveBeenCalled();
  });
  it('clears the page class filter when session or term changes', async () => {
    await act(async () => root.render(<QueryClientProvider client={qc}><ManageTimetableView schoolId={1} canEdit /></QueryClientProvider>));
    const changeFilter = async (testId: string, value: string) => {
      await act(async () => { const node = host.querySelector<HTMLSelectElement>(`[data-testid="${testId}"]`)!;
        node.value = value; node.dispatchEvent(new Event('change', { bubbles: true })); });
    };
    await changeFilter('select-timetable-filter-class', '4'); await changeFilter('select-timetable-term', '9');
    expect(host.querySelector<HTMLSelectElement>('[data-testid=select-timetable-filter-class]')?.value).toBe('');
    await changeFilter('select-timetable-filter-class', '4'); await changeFilter('select-timetable-session', '8');
    expect(host.querySelector<HTMLSelectElement>('[data-testid=select-timetable-term]')?.value).toBe('');
    expect(host.querySelector<HTMLSelectElement>('[data-testid=select-timetable-filter-class]')?.value).toBe('');
  });
  it('restores the same school/session/term/class view after a full component reload', async () => {
    window.history.replaceState(null, '', '/timetable?schoolId=1&sessionId=2&termId=3&classId=4');
    const renderPage = () => root.render(<QueryClientProvider client={qc}><ManageTimetableView schoolId={1} canEdit /></QueryClientProvider>);
    await act(async () => renderPage());
    expect(host.querySelector<HTMLSelectElement>('[data-testid=select-timetable-filter-class]')?.value).toBe('4');
    await act(async () => {
      const node = host.querySelector<HTMLSelectElement>('[data-testid=select-timetable-filter-class]')!;
      node.value = '14'; node.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(new URLSearchParams(window.location.search).get('classId')).toBe('14');
    await act(async () => root.unmount()); root = createRoot(host);
    await act(async () => renderPage());
    expect(host.querySelector<HTMLSelectElement>('[data-testid=select-timetable-session]')?.value).toBe('2');
    expect(host.querySelector<HTMLSelectElement>('[data-testid=select-timetable-term]')?.value).toBe('3');
    expect(host.querySelector<HTMLSelectElement>('[data-testid=select-timetable-filter-class]')?.value).toBe('14');
    expect(state.requests.filter(r => r.endpoint === 'timetable').at(-1)?.params).toEqual({ schoolId: 1, sessionId: 2, termId: 3, classId: 14 });
  });
  it('does not import another school URL context into the active tenant', async () => {
    window.history.replaceState(null, '', '/timetable?schoolId=99&sessionId=8&termId=10&classId=14');
    await act(async () => root.render(<QueryClientProvider client={qc}><ManageTimetableView schoolId={1} canEdit /></QueryClientProvider>));
    expect(host.querySelector<HTMLSelectElement>('[data-testid=select-timetable-session]')?.value).toBe('2');
    expect(host.querySelector<HTMLSelectElement>('[data-testid=select-timetable-term]')?.value).toBe('3');
    expect(host.querySelector<HTMLSelectElement>('[data-testid=select-timetable-filter-class]')?.value).toBe('');
    expect(state.requests.filter(r => r.endpoint === 'timetable').at(-1)?.options.query.enabled).toBe(false);
  });
  it('ignores malformed URL IDs instead of sending NaN or negative IDs', async () => {
    window.history.replaceState(null, '', '/timetable?schoolId=1&sessionId=NaN&termId=-3&classId=1junk');
    await act(async () => root.render(<QueryClientProvider client={qc}><ManageTimetableView schoolId={1} canEdit /></QueryClientProvider>));
    expect(host.querySelector<HTMLSelectElement>('[data-testid=select-timetable-session]')?.value).toBe('2');
    expect(host.querySelector<HTMLSelectElement>('[data-testid=select-timetable-term]')?.value).toBe('3');
    expect(host.querySelector<HTMLSelectElement>('[data-testid=select-timetable-filter-class]')?.value).toBe('');
  });
});