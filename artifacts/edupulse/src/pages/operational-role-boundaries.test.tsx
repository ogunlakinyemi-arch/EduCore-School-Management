import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  context: null as any,
  stateOverrides: {} as Record<string, any[]>,
}));

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: (initial: unknown) => {
      const key = initial === null ? 'null' : `${typeof initial}:${String(initial)}`;
      const values = state.stateOverrides[key];
      const defaultValue = typeof initial === 'function'
        ? (initial as () => unknown)()
        : initial;
      return [values?.length ? values.shift() : defaultValue, vi.fn()];
    },
  };
});

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('@workspace/api-client-react', () => {
  const query = (data: any) => ({ data, isLoading: false, isError: false, refetch: vi.fn() });
  const mutation = () => ({ mutate: vi.fn(), isPending: false, isError: false });
  const queryKey = () => [];

  return {
    useGetAuthorizedContext: () => query(state.context),

    useGetSchoolAttendanceToday: () => query({ entries: 12, exits: 3, present: 9, discrepancies: 1 }),
    useListSchoolAttendanceEvents: () => query([{
      id: 41,
      schoolId: 12,
      studentId: 21,
      studentName: 'Ari Learner',
      eventType: 'SCHOOL_ENTRY',
      occurredAt: '2025-03-01T08:00:00.000Z',
      status: 'MISMATCH',
      identificationMethod: 'NFC',
    }]),
    useListAttendanceDiscrepancies: () => query([{
      id: 51,
      schoolId: 12,
      studentId: 21,
      studentName: 'Ari Learner',
      kind: 'MISSING_EXIT',
      detectedAt: '2025-03-01T16:00:00.000Z',
      status: 'OPEN',
    }]),
    useCreateManualAttendance: mutation,
    useCorrectAttendance: mutation,
    useResolveAttendanceDiscrepancy: mutation,
    useGetClassAttendance: () => query([]),
    useGetSchoolBranding: () => query({ schoolId: 12, name: 'Test school', logoUrl: null }),
    getGetSchoolBrandingQueryKey: queryKey,
    getGetClassAttendanceQueryKey: queryKey,
    getGetSchoolAttendanceTodayQueryKey: queryKey,
    getListSchoolAttendanceEventsQueryKey: queryKey,
    getListAttendanceDiscrepanciesQueryKey: queryKey,

    useListAcademicAssessments: () => query([{
      id: 9,
      title: 'Math assessment',
      classId: 5,
      maxScore: 100,
      status: 'DRAFT',
    }]),
    getListAcademicAssessmentsQueryKey: queryKey,
    useListAcademicResults: () => query([{
      id: 61,
      studentId: 21,
      score: 68,
      remark: 'Needs practice',
    }]),
    useCreateAcademicResult: mutation,
    useUpdateAcademicResult: mutation,
    usePublishAcademicAssessmentResults: mutation,
    getListAcademicResultsQueryKey: queryKey,
    useListAcademicReportCards: () => query([]),
    useCreateAcademicReportCard: mutation,
    usePublishAcademicReportCard: mutation,
    getListAcademicReportCardsQueryKey: queryKey,
    useListAcademicGradingRules: () => query([]),
    useCreateAcademicGradingRule: mutation,
    useUpdateAcademicGradingRule: mutation,
    getListAcademicGradingRulesQueryKey: queryKey,
    useListAcademicSessions: () => query([{ id: 7, name: '2025 Session', isCurrent: true }]),
    useListAcademicTerms: () => query([{ id: 8, name: 'First', isCurrent: true }]),
    useListClasses: () => query([{ id: 5, name: 'Class Five', section: 'A' }]),
    useListSubjects: () => query([{ id: 4, name: 'Mathematics' }]),
    useListStudents: () => query([{
      id: 21,
      firstName: 'Ari',
      lastName: 'Learner',
      admissionNo: 'A-21',
    }]),

    useListAcademicTimetable: () => query([{
      id: 71,
      weekday: 'MONDAY',
      startTime: '08:00',
      endTime: '09:00',
      subjectId: 4,
      teacherId: 31,
      room: 'Rm 2',
    }]),
    useCreateAcademicTimetableEntry: mutation,
    useUpdateAcademicTimetableEntry: mutation,
    getListAcademicTimetableQueryKey: queryKey,
    useGetMyAcademicTimetable: () => query([]),
    getGetMyAcademicTimetableQueryKey: queryKey,
    useListEmployees: () => query([{ id: 31, firstName: 'Taylor', lastName: 'Teacher' }]),
  };
});

vi.mock('@/components/shared', () => ({
  Button: ({ children, onClick, type = 'button', disabled }: any) => (
    <button type={type} onClick={onClick} disabled={disabled}>{children}</button>
  ),
  EmptyState: ({ title, description }: any) => <div><strong>{title}</strong><p>{description}</p></div>,
  ErrorState: ({ message }: any) => <div>{message || 'Error'}</div>,
  Field: ({ label, children }: any) => <label>{label}{children}</label>,
  Metric: ({ label, value }: any) => <div>{label}: {value}</div>,
  Modal: ({ title, children }: any) => <section><h2>{title}</h2>{children}</section>,
  PageHeading: ({ title, description, action }: any) => <header><h1>{title}</h1><p>{description}</p>{action}</header>,
  SkeletonPage: () => <div>Loading</div>,
  StatusPill: ({ value }: any) => <span>{value}</span>,
  TenantPicker: () => null,
  useTenant: () => ({ schoolId: 12, setSchoolId: vi.fn() }),
  cx: (...parts: Array<string | false | undefined | null>) => parts.filter(Boolean).join(' '),
  time: (value?: string) => value || '',
}));

import { AttendancePage } from './attendance';
import { ResultsPage } from './results';
import { TimetablePage } from './timetable';

const ownerWithSchoolAdminRole = {
  isPlatformOwner: true,
  roles: [
    { role: 'PLATFORM_OWNER', schoolId: null, status: 'ACTIVE' },
    { role: 'SCHOOL_ADMIN', schoolId: 12, status: 'ACTIVE' },
  ],
};
const schoolAdminOnly = {
  isPlatformOwner: false,
  roles: [{ role: 'SCHOOL_ADMIN', schoolId: 12, status: 'ACTIVE' }],
};

function render(element: React.ReactElement) {
  return renderToStaticMarkup(element);
}

function setInitialState(overrides: Record<string, any[]> = {}) {
  state.context = ownerWithSchoolAdminRole;
  state.stateOverrides = overrides;
}

describe('mixed-role Platform Owner school-operation pages', () => {
  beforeEach(() => setInitialState());

  it('does not render attendance Record, Correct, or Resolve controls for an Owner with SCHOOL_ADMIN', () => {
    setInitialState({
      'string:events': ['discrepancies'],
    });

    const html = render(<AttendancePage />);

    expect(html).toContain('Attendance, with context.');
    expect(html).toContain('Ari Learner');
    expect(html).not.toContain('Record event');
    expect(html).not.toContain('Correct');
    expect(html).not.toContain('Review');
    expect(html).not.toContain('Resolution Action');
    expect(html).not.toContain('Submit Resolution');
  });

  it('keeps intended attendance controls for an ordinary School Admin', () => {
    state.context = schoolAdminOnly;

    const eventsHtml = render(<AttendancePage />);
    expect(eventsHtml).toContain('Record event');
    expect(eventsHtml).toContain('Correct');

    setInitialState({ 'string:events': ['discrepancies'] });
    state.context = schoolAdminOnly;
    const discrepanciesHtml = render(<AttendancePage />);
    expect(discrepanciesHtml).toContain('Review');
  });

  it('does not render result editing, publishing, report-card, or grading controls for a mixed-role Owner', () => {
    setInitialState({ 'string:': [9] });

    const html = render(<ResultsPage />);

    expect(html).toContain('Math assessment');
    expect(html).not.toContain('Report Cards');
    expect(html).not.toContain('Grading Rules');
    expect(html).not.toContain('Publish Results');
    expect(html).not.toContain('Generate Card');
    expect(html).not.toContain('New Rule');
    expect(html).not.toContain('>Save</button>');
    expect(html).toMatch(/placeholder="Score"[^>]*disabled/);
  });

  it('keeps intended result, report-card, and grading controls for an ordinary School Admin', () => {
    state.context = schoolAdminOnly;
    state.stateOverrides = { 'string:': [9] };

    const html = render(<ResultsPage />);

    expect(html).toContain('Report Cards');
    expect(html).toContain('Grading Rules');
    expect(html).toContain('Publish Results');
    expect(html).toMatch(/placeholder="Score"(?![^>]*disabled)/);
  });

  it('renders the Owner timetable as view-only even when a class is selected', () => {
    setInitialState({ 'string:': [5] });

    const html = render(<TimetablePage />);

    expect(html).toContain('MONDAY');
    expect(html).toContain('Mathematics');
    expect(html).not.toContain('Manage Timetable');
    expect(html).not.toContain('Add Entry');
    expect(html).not.toContain('Edit Timetable Entry');
    expect(html).not.toContain('>Save</button>');
    expect(html).not.toContain('<button');
  });

  it('keeps intended timetable management and Save controls for an ordinary School Admin', () => {
    state.context = schoolAdminOnly;
    state.stateOverrides = {
      'string:': [5],
      null: [{ create: true, classId: 5 }],
    };

    const html = render(<TimetablePage />);

    expect(html).toContain('MONDAY');
    expect(html).toContain('Add Entry');
    expect(html).toContain('Save');
    expect(html).toContain('Add Timetable Entry');
  });
});