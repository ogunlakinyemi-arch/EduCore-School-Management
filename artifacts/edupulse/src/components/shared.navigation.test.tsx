import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  schoolId: 12,
  context: {
    isPlatformOwner: true,
    user: { name: 'Platform Owner' },
    roles: [
      { role: 'PLATFORM_OWNER', schoolId: null, status: 'ACTIVE' },
      { role: 'SCHOOL_ADMIN', schoolId: 12, status: 'ACTIVE' },
      { role: 'STUDENT', schoolId: 12, status: 'ACTIVE' },
    ],
  } as any,
  ownerDirectoryCalls: [] as any[],
  librarian: false,
}));

vi.mock('@clerk/react', () => ({
  UserButton: () => <div>User account</div>,
  useAuth: () => ({ userId: 'owner-test-user', isLoaded: true }),
}));
vi.mock('./fee-payment-notifications', () => ({ FeePaymentNotifications: () => null }));
vi.mock('@/pages/communication-inbox', () => ({ CommunicationInboxBadge: () => null }));
vi.mock('@/components/subscription-access-banner', () => ({ SubscriptionAccessBanner: () => null }));
vi.mock('@/hooks/use-phase9-api', () => ({
  usePhase9List: () => ({ data: { canManageLoans: state.librarian, canManageCatalogue: state.librarian, canAssignStaff: false } }),
}));
vi.mock('@workspace/api-client-react', () => ({
  useGetAuthorizedContext: () => ({ data: state.context, isLoading: false }),
  useGetCurrentUserSchools: () => ({ data: [] }),
  getGetCurrentUserSchoolsQueryKey: () => ['user-schools'],
  useListOwnerSchoolDirectory: (params: any, options: any) => {
    state.ownerDirectoryCalls.push({ params, options });
    return { data: { schools: [
      { id: 12, name: 'North School' },
      { id: 13, name: 'Suspended School' },
    ] }, isLoading: false };
  },
  getListOwnerSchoolDirectoryQueryKey: (params: any) => ['owner-school-directory', params],
  useListPlatformNotifications: () => ({ data: [] }),
  getListPlatformNotificationsQueryKey: () => ['platform-notifications'],
}));
vi.mock('wouter', () => ({
  useLocation: () => ['/'],
  Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

import { Shell, TenantSessionBoundary } from './shared';

describe('Platform Owner navigation', () => {
  beforeEach(() => {
    state.schoolId = 12;
    state.context = {
      isPlatformOwner: true,
      user: { name: 'Platform Owner' },
      roles: [
        { role: 'PLATFORM_OWNER', schoolId: null, status: 'ACTIVE' },
        { role: 'SCHOOL_ADMIN', schoolId: 12, status: 'ACTIVE' },
        { role: 'STUDENT', schoolId: 12, status: 'ACTIVE' },
      ],
    };
    state.ownerDirectoryCalls = [];
    state.librarian = false;
  });

  it('keeps platform links and hides school-operation links even for a mixed-role Owner', () => {
    const html = renderToStaticMarkup(
      <Shell><div>Dashboard content</div></Shell>,
    );

    for (const href of ['/schools', '/students', '/company-employees', '/partners', '/devices', '/cards', '/audit', '/users']) {
      expect(html).toContain(`href="${href}"`);
    }
    for (const href of ['/parents', '/employees', '/academics', '/subjects', '/classes', '/academic-work', '/results', '/timetable', '/attendance', '/finance', '/people/imports', '/my-academics', '/my-fees']) {
      expect(html).not.toContain(`href="${href}"`);
    }
    expect(html).toContain('aria-label="Owner school context"');
    expect(html).toContain('Suspended School');
    expect(state.ownerDirectoryCalls.some(call => call.params.status === 'all')).toBe(true);
  });

  it('does not show the Owner context selector to a School Admin', () => {
    state.context = {
      isPlatformOwner: false,
      user: { name: 'School Admin' },
      roles: [{ role: 'SCHOOL_ADMIN', schoolId: 12, status: 'ACTIVE' }],
    };

    const html = renderToStaticMarkup(<Shell><div>School content</div></Shell>);

    expect(html).not.toContain('Owner school context');
    expect(html).not.toContain('Suspended School');
  });

  it('hides Library for a Teacher without librarian duty', () => {
    state.context = { isPlatformOwner: false, user: { name: 'Teacher' },
      roles: [{role:'TEACHER',schoolId:12,status:'ACTIVE'}] };
    const html=renderToStaticMarkup(<Shell><div>Teacher content</div></Shell>);
    expect(html).not.toContain('data-testid="button-nav-section-library"');
    expect(html).toContain('data-testid="button-nav-section-assessments"');
  });

  it('adds Library to the same Teacher account with librarian duty', () => {
    state.librarian = true;
    state.context = { isPlatformOwner: false, user: { name: 'Teacher' },
      roles: [{role:'TEACHER',schoolId:12,status:'ACTIVE'}] };
    const html=renderToStaticMarkup(<Shell><div>Teacher content</div></Shell>);
    expect(html).toContain('data-testid="button-nav-section-library"');
    expect(html).toContain('data-testid="button-nav-section-assessments"');
    expect(html).not.toContain('href="/schools"');
  });
});

describe('tenant session isolation', () => {
  it('does not render the prior account context while a new identity is loading', () => {
    const html = renderToStaticMarkup(
      <TenantSessionBoundary
        session={{ userId: 'owner-account', status: 'ready', context: { isPlatformOwner: true } } as any}
        currentUserId="school-account"
        isLoaded
      >
        <div>Prior account dashboard</div>
      </TenantSessionBoundary>,
    );

    expect(html).not.toContain('Prior account dashboard');
  });

  it('keeps application children hidden when fetching the new account context fails', () => {
    const html = renderToStaticMarkup(
      <TenantSessionBoundary
        session={{ userId: 'school-account', status: 'error' }}
        currentUserId="school-account"
        isLoaded
      >
        <div>Prior account dashboard</div>
      </TenantSessionBoundary>,
    );

    expect(html).toContain('tenant-context-error');
    expect(html).toContain('Could not verify your account context');
    expect(html).not.toContain('Prior account dashboard');
  });
});