import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  schoolId: 0,
  context: null as any,
  schoolDashboardCalls: 0,
  setSchoolId: vi.fn(),
  schools: [{
    id: 12,
    name: 'North School',
    code: 'NORTH-12',
    city: 'Lagos',
    state: 'Lagos',
    status: 'active',
    subscriptionStatus: 'active',
    studentCount: 64,
    activeStudentCount: 61,
    partnerReferral: { partnerName: 'Regional Partner' },
  }],
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetAuthorizedContext: () => ({ data: state.context, isLoading: false, isError: false }),
  useGetPlatformDashboard: () => ({
    data: { totalSchools: 3, activeSchools: 3, suspendedSchools: 0, totalStudents: 96, revenue: 1000 },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useGetSchoolDashboard: () => {
    state.schoolDashboardCalls += 1;
    return {
      data: { school: { name: 'North School' }, totalStudents: 64, totalClasses: 8, totalSubjects: 13 },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    };
  },
  useGetStudentSelfProfile: vi.fn(),
  useGetOwnAttendance: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: { schools: state.schools, totals: { teacherCount: 8, staffCount: 2, parentCount: 47 } }, isLoading: false, isError: false, refetch: vi.fn() }),
}));

vi.mock('wouter', () => ({
  Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

vi.mock('@/components/shared', () => ({
  PageHeading: ({ eyebrow, title, description, action }: any) => (
    <header><div>{eyebrow}</div><h1>{title}</h1><p>{description}</p>{action}</header>
  ),
  Metric: ({ label, value }: any) => <div data-metric={label}>{label}: {value}</div>,
  useTenant: () => ({ schoolId: state.schoolId, setSchoolId: state.setSchoolId }),
  SkeletonPage: () => <div>Loading</div>,
  ErrorState: ({ message }: any) => <div>{message || 'Error'}</div>,
  ActivityFeed: () => <div>Activity</div>,
  money: (amount: number) => String(amount),
  Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
  StatusPill: ({ value }: any) => <span>{value}</span>,
}));

import { Dashboard } from './dashboard';

const ownerContext = {
  isPlatformOwner: true,
  roles: [{ role: 'PLATFORM_OWNER', schoolId: null, status: 'ACTIVE' }],
};
const schoolAdminContext = {
  isPlatformOwner: false,
  roles: [{ role: 'SCHOOL_ADMIN', schoolId: 12, status: 'ACTIVE' }],
};

function renderDashboard() {
  return renderToStaticMarkup(<Dashboard />);
}

describe('Platform Owner dashboard separation', () => {
  beforeEach(() => {
    state.schoolId = 0;
    state.context = ownerContext;
    state.schoolDashboardCalls = 0;
    state.setSchoolId.mockClear();
  });

  it('shows a platform-level school view instead of SchoolDashboard for a selected school', () => {
    state.schoolId = 12;

    const html = renderDashboard();

    expect(html).toContain('owner-school-snapshot');
    expect(html).toContain('North School');
    expect(html).toContain('Subscription status');
    expect(html).toContain('Students &amp; e-ID');
    expect(html).toContain('NFC cards');
    expect(html).toContain('NFC devices');
    expect(html).toContain('Partners');
    expect(html).toContain('Audit log');
    expect(html).not.toContain('School Command Centre');
    expect(html).not.toContain('Staff &amp; Structure');
    expect(html).not.toContain('Total Classes');
    expect(html).not.toContain('Total Subjects');
    expect(html).not.toContain('Academic Session');
    expect(html).not.toContain('School finance');
    expect(html).not.toContain('>Manage</a>');
    expect(state.schoolDashboardCalls).toBe(0);
  });

  it('keeps the platform network dashboard when no school is selected', () => {
    const html = renderDashboard();

    expect(html).toContain('The whole network, at a glance.');
    expect(html).toContain('Total schools');
    expect(html).toContain('NFC devices');
    expect(html).not.toContain('School Command Centre');
    expect(state.schoolDashboardCalls).toBe(0);
  });

  it('keeps mixed-role Platform Owners in the platform school view', () => {
    state.schoolId = 12;
    state.context = {
      ...ownerContext,
      roles: [...ownerContext.roles, { role: 'SCHOOL_ADMIN', schoolId: 12, status: 'ACTIVE' }],
    };

    const html = renderDashboard();

    expect(html).toContain('owner-school-snapshot');
    expect(html).not.toContain('School Command Centre');
    expect(html).not.toContain('School finance');
    expect(state.schoolDashboardCalls).toBe(0);
  });

  it('preserves the School Admin school dashboard and its academic/finance management links', () => {
    state.schoolId = 12;
    state.context = schoolAdminContext;

    const html = renderDashboard();

    expect(html).toContain('North School Command Centre');
    expect(html).toContain('Staff &amp; Structure');
    expect(html).toContain('Academic Session');
    expect(html).toContain('href="/academics"');
    expect(html).toContain('href="/finance"');
    expect(state.schoolDashboardCalls).toBe(1);
  });
});