import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ context: null as any, enabled: {} as Record<string, boolean | undefined> }));

vi.mock('@workspace/api-client-react', () => {
  const q = (name: string, data: any) => (...args: any[]) => {
    state.enabled[name] = args[args.length - 1]?.query?.enabled;
    return { data, isLoading: false, isError: false, refetch: vi.fn() };
  };
  const m = () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false, isError: false, reset: vi.fn() });
  return {
    useGetAuthorizedContext: () => ({ data: state.context, isLoading: false, isError: false }),
    useListSchoolTeacherDuty: q('duty', [{ id: 3, employeeId: 1, employeeName: 'Ada Obi', employeeNo: 'T-1', dutyRole: 'Gate', startDate: '2000-01-01', endDate: '2999-12-31', status: 'ACTIVE', notes: null }]),
    getListSchoolTeacherDutyQueryKey: () => ['d'], useCreateSchoolTeacherDuty: m, useUpdateSchoolTeacherDuty: m,
    useListEmployees: q('employees', []),
    useListSchoolAcademicCalendar: q('calendar', [{ id: 'x1', schoolId: 5, sessionId: 2, sessionName: '2025/2026', title: 'Resumption', category: 'RESUMPTION', startDate: '2025-09-08', academic: true, audience: ['PARENT'], status: 'ACTIVE', source: 'SESSION_TERM' }]),
    getListSchoolAcademicCalendarQueryKey: () => ['c'], useCreateSchoolCalendarEvent: m, useUpdateSchoolCalendarEvent: m, useGenerateSchoolAcademicCalendar: m,
    useListAcademicSessions: q('sessions', []), useListAcademicTerms: q('terms', []),
    useGetSchoolBranding: q('branding', undefined), getGetSchoolBrandingQueryKey: () => ['b'],
    useGetSchoolLogo: q('logo', undefined), getGetSchoolLogoQueryKey: () => ['l'], getGetCurrentUserSchoolsQueryKey: () => ['u'],
    useUpdateSchoolBranding: m, useRequestSchoolLogoUpload: m, useConfirmSchoolLogoUpload: m,
  };
});
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@/components/shared', async () => {
  const React = await import('react');
  const pass = ({ children }: any) => React.createElement('div', null, children);
  return {
    useTenant: () => ({ schoolId: 5 }), PageHeading: ({ title, action }: any) => React.createElement('div', null, title, action),
    Button: ({ children, testId }: any) => React.createElement('button', { 'data-testid': testId }, children),
    StatusPill: ({ value }: any) => React.createElement('span', null, value), SkeletonPage: pass, ErrorState: pass, EmptyState: ({ title }: any) => React.createElement('div', null, title),
    Modal: pass, Field: pass, TenantPicker: () => null, cx: (...p: any[]) => p.filter(Boolean).join(' '),
  };
});

import { TeacherDutyPage } from './teacher-duty';
import { AcademicCalendarPage } from './academic-calendar';
import { SchoolBrandingPage } from './school-branding';

const as = (role: string) => { state.context = { isPlatformOwner: false, roles: [{ schoolId: 5, role, status: 'ACTIVE' }] }; };

describe.each(['TEACHER', 'PARENT'])('read-only %s', role => {
  beforeEach(() => { state.enabled = {}; as(role); });
  it('sees duty without write controls or catalog queries', () => {
    const html = renderToStaticMarkup(<TeacherDutyPage />);
    expect(html).toContain('Ada Obi');
    expect(html).not.toContain('button-add-duty');
    expect(html).not.toContain('button-toggle-duty-3');
  });
  it('sees the calendar without waiting on or enabling org-wide catalogs', () => {
    const html = renderToStaticMarkup(<AcademicCalendarPage />);
    expect(html).toContain('Resumption');
    expect(html).not.toContain('button-add-event');
    expect(state.enabled.calendar).toBe(true);
    expect(state.enabled.sessions).toBe(false);
    expect(state.enabled.terms).toBe(false);
  });
});

describe('logo and branding scope', () => {
  beforeEach(() => { state.enabled = {}; });
  it('does not request branding or logo for a non-admin', () => {
    as('PARENT');
    const html = renderToStaticMarkup(<SchoolBrandingPage />);
    expect(html).toContain('School Administrators only');
    expect(state.enabled.branding).toBe(false);
    expect(state.enabled.logo).toBe(false);
  });
  it('enables branding for the school admin', () => {
    as('SCHOOL_ADMIN');
    renderToStaticMarkup(<SchoolBrandingPage />);
    expect(state.enabled.branding).toBe(true);
  });
});
