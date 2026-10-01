import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  directory: {
    totals: { schoolCount: 2, studentCount: 0, activeStudentCount: 0, teacherCount: 0, staffCount: 0, parentCount: 0 },
    schools: [
      {
        id: 1, code: 'GFC', name: 'Greenfield College', city: 'Ikeja', state: 'Lagos', status: 'pending',
        createdAt: '2025-03-01T00:00:00.000Z', subscriptionStatus: 'trial', studentCount: 0, activeStudentCount: 0,
        teacherCount: 0, staffCount: 0, employeeCount: 0, accountantCount: 0, parentCount: 0,
        administrators: [], registrationStatus: 'PENDING', invitationStatus: 'PENDING',
        adminName: 'Ada Okafor', adminEmail: 'ada@greenfield.ng', adminPhone: '08031112222',
        dateAdded: '2025-03-01', invitationSentAt: '2025-03-02', acceptedAt: null,
        partnerReferral: { partnerId: 7, partnerName: 'Lagos EduReach', source: 'PARTNER_ADDED', status: 'ACTIVE', referralLinkId: null, registrationDate: '2025-03-01' },
      },
      {
        id: 2, code: 'HCA', name: 'Hillcrest Academy', city: 'Abuja', state: 'FCT', status: 'active',
        createdAt: '2025-01-01T00:00:00.000Z', subscriptionStatus: 'active', studentCount: 120, activeStudentCount: 118,
        teacherCount: 9, staffCount: 3, employeeCount: 0, accountantCount: 1, parentCount: 80,
        administrators: [{ id: 5, name: 'Ife Bello', email: 'ife@hillcrest.ng', status: 'ACTIVE' }],
        registrationStatus: 'ACTIVE', invitationStatus: 'ACCEPTED',
        adminName: 'Ife Bello', adminEmail: 'ife@hillcrest.ng', adminPhone: '08054445555',
        dateAdded: '2025-01-01', invitationSentAt: '2025-01-02', acceptedAt: '2025-01-05',
        partnerReferral: { partnerId: 7, partnerName: 'Lagos EduReach', source: 'PARTNER_ADDED', status: 'ACTIVE', referralLinkId: null, registrationDate: '2025-01-01' },
      },
    ],
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetSchool: () => ({}), useUpdateSchool: () => ({ isPending: false, isError: false, mutate: vi.fn() }),
  useGetSchoolDashboard: () => ({}), useGetAuthorizedContext: () => ({}),
  getListSchoolsQueryKey: () => ['schools'],
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: state.directory, isLoading: false, isError: false, refetch: vi.fn() }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('wouter', () => ({
  useParams: () => ({}), useLocation: () => ['/', vi.fn()],
  Link: ({ href, children, ...p }: any) => <a href={href} {...p}>{children}</a>,
}));
vi.mock('@/components/shared', () => ({
  PageHeading: ({ title, action }: any) => <header><h1>{title}</h1>{action}</header>,
  Button: ({ children, testId }: any) => <button data-testid={testId}>{children}</button>,
  StatusPill: ({ value }: any) => <span>{value}</span>,
  SkeletonPage: () => <div>Loading</div>, ErrorState: () => <div>Error</div>, EmptyState: () => <div>Empty</div>,
  Field: ({ children, label }: any) => <label>{label}{children}</label>,
  Info: () => null, Metric: ({ label, value }: any) => <div>{label}{value}</div>, ActivityFeed: () => null,
  Modal: () => null, cx: (...c: string[]) => c.join(' '), date: (v: string) => v, time: (v: string) => v,
  useTenant: () => ({ schoolId: 0, setSchoolId: vi.fn() }),
}));

import { SchoolsPage } from './schools';

describe('owner school directory partner relationships', () => {
  const html = renderToStaticMarkup(<SchoolsPage />).replace(/<!-- -->/g, '');
  const rel = (id: number) => {
    const m = html.match(new RegExp(`data-testid="text-partner-relation-${id}"[^>]*>([^<]*)<div data-testid="text-partner-admin-${id}"[^>]*>([^<]*)</div><div>([^<]*)</div>`));
    if (!m) throw new Error(`relation block ${id} missing`);
    return m;
  };

  it('shows the partner on both pending and active schools', () => {
    expect(html.match(/Lagos EduReach/g)).toHaveLength(2);
  });
  it('distinguishes pending from active with invitation and accepted date', () => {
    expect(rel(1)[1]).toMatch(/Pending school.*invitation pending/);
    expect(rel(1)[1]).not.toMatch(/accepted 20/);
    expect(rel(2)[1]).toMatch(/Active school.*invitation accepted.*accepted 2025-01-05/);
  });
  it('shows admin name, email and phone', () => {
    expect(rel(1)[2]).toContain('Ada Okafor / ada@greenfield.ng / 08031112222');
    expect(rel(2)[2]).toContain('Ife Bello / ife@hillcrest.ng / 08054445555');
  });
  it('shows date added and invitation sent', () => {
    expect(rel(1)[3]).toContain('Added 2025-03-01');
    expect(rel(1)[3]).toContain('sent 2025-03-02');
    expect(rel(2)[3]).toContain('sent 2025-01-02');
  });
});
