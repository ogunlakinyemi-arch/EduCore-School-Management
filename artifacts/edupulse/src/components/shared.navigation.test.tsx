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
}));

vi.mock('@clerk/react', () => ({ UserButton: () => <div>User account</div> }));
vi.mock('./fee-payment-notifications', () => ({ FeePaymentNotifications: () => null }));
vi.mock('@workspace/api-client-react', () => ({
  useGetAuthorizedContext: () => ({ data: state.context, isLoading: false }),
  useGetCurrentUserSchools: () => ({ data: [] }),
  getGetCurrentUserSchoolsQueryKey: () => ['user-schools'],
  useListSchools: () => ({ data: [{ id: 12, name: 'North School' }] }),
  getListSchoolsQueryKey: () => ['schools'],
  useListPlatformNotifications: () => ({ data: [] }),
  getListPlatformNotificationsQueryKey: () => ['platform-notifications'],
}));
vi.mock('wouter', () => ({
  useLocation: () => ['/'],
  Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

import { Shell } from './shared';

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
  });
});