import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  context: null as any,
  calls: [] as Array<{ enabled?: boolean }>,
}));

vi.mock('@workspace/api-client-react', () => {
  const q = (data: any) => (...args: any[]) => {
    state.calls.push({ enabled: args[args.length - 1]?.query?.enabled });
    return { data, isLoading: false, isError: false, refetch: vi.fn() };
  };
  const m = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, isError: false, reset: vi.fn() });
  return {
    useGetAuthorizedContext: () => ({ data: state.context, isLoading: false, isError: false }),
    useGetCurrentUserSchools: () => ({ data: [] }), useListOwnerSchoolDirectory: () => ({ data: { schools: [] } }),
    useListPlatformNotifications: () => ({ data: [] }),
    getAuthorizedContext: vi.fn(),
    useListSchoolTeacherAssignments: q([{ id: 1, assignmentKind: 'CLASS', employeeName: 'Ada Obi', employeeNo: 'T-1', assignmentType: 'CLASS_TEACHER', className: 'JSS 1', section: 'A', sessionName: '2025/2026', startDate: '2025-09-08', endDate: null, status: 'ACTIVE' }]),
    getListSchoolTeacherAssignmentsQueryKey: () => ['a'],
    useCreateSchoolTeacherAssignment: m, useUpdateSchoolTeacherAssignment: m,
    useListAcademicSessions: q([]), useListEmployees: q([]), useListClasses: q([]), useListSubjects: q([]),
  };
});
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@/components/shared', async () => {
  const React = await import('react');
  const pass = ({ children }: any) => React.createElement('div', null, children);
  return {
    useTenant: () => ({ schoolId: 5 }), PageHeading: ({ title, action }: any) => React.createElement('div', null, title, action),
    Button: ({ children, testId }: any) => React.createElement('button', { 'data-testid': testId }, children),
    StatusPill: ({ value }: any) => React.createElement('span', null, value), SkeletonPage: pass, ErrorState: pass, EmptyState: pass, Modal: pass, Field: pass,
    TenantPicker: () => null, cx: (...p: any[]) => p.filter(Boolean).join(' '),
  };
});

import { deriveSchoolRole, parseIsoDate, isValidRange } from '@/components/school-ops-kit';
import { TeacherAssignmentsPage } from './teacher-assignments';

describe('school ops role guard', () => {
  const ctx = (role: string, owner = false, schoolId = 5) => ({ isPlatformOwner: owner, roles: [{ schoolId, role, status: 'ACTIVE' }] });
  it('lets only an in-school admin write', () => {
    expect(deriveSchoolRole({ schoolId: 5, context: ctx('SCHOOL_ADMIN') }).canManage).toBe(true);
    expect(deriveSchoolRole({ schoolId: 5, context: ctx('TEACHER') }).canManage).toBe(false);
    expect(deriveSchoolRole({ schoolId: 5, context: ctx('SCHOOL_ADMIN', false, 9) }).canRead).toBe(false);
  });
  it('excludes platform owner from operational writes', () => {
    const r = deriveSchoolRole({ schoolId: 5, context: ctx('SCHOOL_ADMIN', true) });
    expect(r.canManage).toBe(false);
    expect(r.canRead).toBe(true);
  });
});

describe('date parser', () => {
  it('rejects impossible dates and reversed ranges', () => {
    expect(parseIsoDate('2025-02-31')).toBeNull();
    expect(parseIsoDate('2025-02-28')).not.toBeNull();
    expect(isValidRange('2025-03-02', '2025-03-01')).toBe(false);
    expect(isValidRange('2025-03-01', null)).toBe(true);
  });
});

describe('TeacherAssignmentsPage', () => {
  it('is read-only for teachers', () => {
    state.context = { isPlatformOwner: false, roles: [{ schoolId: 5, role: 'TEACHER', status: 'ACTIVE' }] };
    const html = renderToStaticMarkup(<TeacherAssignmentsPage />);
    expect(html).toContain('Ada Obi');
    expect(html).not.toContain('button-add-assignment');
    expect(html).not.toContain('button-deactivate-1');
  });
  it('offers management actions to school admins', () => {
    state.context = { isPlatformOwner: false, roles: [{ schoolId: 5, role: 'SCHOOL_ADMIN', status: 'ACTIVE' }] };
    const html = renderToStaticMarkup(<TeacherAssignmentsPage />);
    expect(html).toContain('button-add-assignment');
    expect(html).toContain('button-replace-1');
    expect(html).toContain('button-deactivate-1');
  });
});
