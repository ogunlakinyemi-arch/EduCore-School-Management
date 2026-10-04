import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  schoolId: 0,
  selectSchool: vi.fn((id: number) => { state.schoolId = id; }),
  requests: [] as Array<{ params: Parameters<typeof getListStudentsUrl>[0]; enabled: boolean }>,
  errorStatus: null as number | null,
}));

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tanstack/react-query')>(),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('@workspace/api-client-react', async (importOriginal) => ({
  ...await importOriginal<typeof import('@workspace/api-client-react')>(),
  useGetSchool: () => ({ data: null }),
  useGetAuthorizedContext: () => ({ data: { isPlatformOwner: false, roles: [] } }),
  useListStudents: (params: Parameters<typeof getListStudentsUrl>[0], options: { query: { enabled: boolean } }) => {
    state.requests.push({ params, enabled: options.query.enabled });
    return { data: [], isLoading: false, isError: state.errorStatus !== null, error: state.errorStatus === null ? null : { status: state.errorStatus } };
  },
}));

vi.mock('@/components/shared', () => ({
  PageHeading: ({ title, action }: any) => <header><h1>{title}</h1>{action}</header>,
  Button: ({ children }: any) => <button>{children}</button>,
  EmptyState: ({ title }: any) => <div>{title}</div>,
  ErrorState: ({ message }: any) => <div>{message}</div>,
  TenantPicker: () => <button onClick={() => state.selectSchool(2)}>Select school</button>,
  useTenant: () => ({ schoolId: state.schoolId, setSchoolId: state.selectSchool }),
  useSchoolAdminAccess: () => ({ canManageSchool: false }),
  cx: (...classes: string[]) => classes.join(' '),
}));

import { getListStudentsUrl } from '@workspace/api-client-react';
import { StudentsPage } from './students';

describe('Student Directory default request', () => {
  beforeEach(() => {
    state.schoolId = 0;
    state.requests = [];
    state.errorStatus = null;
    state.selectSchool.mockClear();
  });

  it('uses the valid ACTIVE filter after selecting a school', () => {
    expect(renderToStaticMarkup(<StudentsPage />)).toContain('Select a school context');
    expect(state.requests[0]).toMatchObject({ enabled: false, params: { schoolId: 0, status: 'ACTIVE' } });

    state.selectSchool(2);
    expect(renderToStaticMarkup(<StudentsPage />)).toContain('Student Directory');
    expect(state.requests[1]).toMatchObject({ enabled: true, params: { schoolId: 2, status: 'ACTIVE' } });
    expect(getListStudentsUrl(state.requests[1].params)).toBe('/api/students?schoolId=2&status=ACTIVE');
  });

  it('shows a student-specific explanation if a school or filter is rejected', () => {
    state.schoolId = 2;
    state.errorStatus = 400;
    const html = renderToStaticMarkup(<StudentsPage />);
    expect(html).toContain('selected school or student filters were rejected');
    expect(html).not.toContain('operations feed');
  });
});