import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  context: { isPlatformOwner: true } as any,
  setSchoolId: vi.fn(),
  setLocation: vi.fn(),
  actions: {} as Record<string, (() => void) | undefined>,
  school: {
    id: 12,
    name: 'North School',
    code: 'NORTH-12',
    city: 'Lagos',
    state: 'Lagos',
    status: 'active',
    subscriptionStatus: 'active',
    createdAt: '2024-01-01T00:00:00.000Z',
    administrators: [],
    partnerReferral: null,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetAuthorizedContext: () => ({ data: state.context, isLoading: false, isError: false, refetch: vi.fn() }),
  useGetSchool: () => ({ data: state.school, isLoading: false, isError: false, refetch: vi.fn() }),
  useGetSchoolDashboard: () => ({ data: { totalStudents: 64 }, isLoading: false, isError: false, refetch: vi.fn() }),
  useCreateSchool: () => ({}),
  useUpdateSchool: () => ({}),
  getListSchoolsQueryKey: () => ['schools'],
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: state.school, isLoading: false, isError: false, refetch: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock('wouter', () => ({
  useParams: () => ({ id: '12' }),
  useLocation: () => ['/', state.setLocation],
  Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

vi.mock('@/components/shared', () => ({
  PageHeading: ({ eyebrow, title, description, action }: any) => (
    <header><div>{eyebrow}</div><h1>{title}</h1><p>{description}</p>{action}</header>
  ),
  Button: ({ children, onClick, testId }: any) => {
    if (testId) state.actions[testId] = onClick;
    return <button data-testid={testId}>{children}</button>;
  },
  StatusPill: ({ value }: any) => <span>{value}</span>,
  SkeletonPage: () => <div>Loading</div>,
  ErrorState: ({ message }: any) => <div>{message || 'Error'}</div>,
  EmptyState: () => <div>Empty</div>,
  Field: ({ children, label }: any) => <label>{label}{children}</label>,
  Info: ({ label, value }: any) => <div>{label}{value}</div>,
  Metric: ({ label, value }: any) => <div>{label}{value}</div>,
  ActivityFeed: () => <div>Activity</div>,
  Modal: () => null,
  cx: (...classes: string[]) => classes.join(' '),
  date: (value: string) => value,
  time: (value: string) => value,
  useTenant: () => ({ schoolId: 0, setSchoolId: state.setSchoolId }),
}));

import { SchoolOverview } from './schools';

describe('school overview navigation actions', () => {
  beforeEach(() => {
    state.context = { isPlatformOwner: true };
    state.setSchoolId.mockClear();
    state.setLocation.mockClear();
    state.actions = {};
  });

  it('lets a Platform Owner open the school snapshot while preserving directory access', () => {
    const html = renderToStaticMarkup(<SchoolOverview />);

    expect(html).toContain('Open dashboard snapshot');
    expect(html).toContain('Open directory');
    state.actions['button-open-owner-dashboard']?.();
    expect(state.setSchoolId).toHaveBeenLastCalledWith(12);
    expect(state.setLocation).toHaveBeenLastCalledWith('/');

    state.setSchoolId.mockClear();
    state.setLocation.mockClear();
    state.actions['button-open-school-directory']?.();
    expect(state.setSchoolId).toHaveBeenLastCalledWith(12);
    expect(state.setLocation).toHaveBeenLastCalledWith('/students');
  });

  it('keeps the snapshot action Owner-only for School Admins', () => {
    state.context = { isPlatformOwner: false };
    const html = renderToStaticMarkup(<SchoolOverview />);

    expect(html).not.toContain('Open dashboard snapshot');
    expect(html).toContain('Open directory');
    state.actions['button-open-school-directory']?.();
    expect(state.setSchoolId).toHaveBeenLastCalledWith(12);
    expect(state.setLocation).toHaveBeenLastCalledWith('/students');
  });
});