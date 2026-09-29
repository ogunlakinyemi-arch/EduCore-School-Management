// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, useQuery } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  userId: 'owner' as string | null,
  requests: [] as string[],
  mounts: 0,
}));

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ userId: state.userId, isLoaded: true }),
  UserButton: () => null,
}));
vi.mock('./fee-payment-notifications', () => ({ FeePaymentNotifications: () => null }));
vi.mock('@/pages/communication-inbox', () => ({ CommunicationInboxBadge: () => null }));
vi.mock('@workspace/api-client-react', () => ({
  useGetAuthorizedContext: () => useQuery({
    queryKey: ['/api/me/authorized-context'],
    retry: false,
    queryFn: async () => {
      const requestedUser = state.userId;
      state.requests.push(requestedUser);
      return {
        isPlatformOwner: requestedUser === 'owner',
        roles: requestedUser === 'owner'
          ? [{ role: 'PLATFORM_OWNER', schoolId: null, status: 'ACTIVE' }]
          : [{ role: 'SCHOOL_ADMIN', schoolId: 12, status: 'ACTIVE' }],
      };
    },
  }),
  useGetCurrentUserSchools: () => ({ data: [], isLoading: false }),
  getGetCurrentUserSchoolsQueryKey: () => ['user-schools'],
  useListOwnerSchoolDirectory: () => ({ data: { schools: [] } }),
  getListOwnerSchoolDirectoryQueryKey: () => ['owner-school-directory'],
  useListPlatformNotifications: () => ({ data: [] }),
  getListPlatformNotificationsQueryKey: () => ['platform-notifications'],
}));

import { AuthQueryProvider } from './auth-query-provider';
import { TenantProvider } from './shared';
import { useGetAuthorizedContext } from '@workspace/api-client-react';

function AuthorizedPage() {
  const context = useGetAuthorizedContext();
  if (!context.data) return <div>Loading authorization</div>;
  return (
    <TenantProvider>
      <RoleLabel />
    </TenantProvider>
  );
}

function SignedInPage() {
  return state.userId ? <AuthorizedPage /> : <div>Signed out</div>;
}

function RoleLabel() {
  const context = useGetAuthorizedContext();
  useEffect(() => {
    state.mounts += 1;
  }, []);
  return <div>Dashboard: {context.data?.isPlatformOwner ? 'Owner' : 'School Admin'}</div>;
}

describe('TenantProvider authorization lifecycle', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    state.userId = 'owner';
    state.requests = [];
    state.mounts = 0;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('loads once without resetting or remounting the active authorization query', async () => {
    const reset = vi.spyOn(QueryClient.prototype, 'resetQueries');

    await act(async () => root.render(<AuthQueryProvider><AuthorizedPage /></AuthQueryProvider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });

    expect(container.textContent).toContain('Dashboard: Owner');
    // React Query may refetch once when the tenant's second observer mounts.
    // It must not keep refetching by resetting the parent authorization query.
    expect(state.requests.length).toBeGreaterThanOrEqual(1);
    expect(state.requests.length).toBeLessThanOrEqual(2);
    expect(state.mounts).toBe(1);
    expect(reset).not.toHaveBeenCalled();

    const initialRequests = state.requests.length;
    await act(async () => root.render(<AuthQueryProvider><AuthorizedPage /></AuthQueryProvider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(state.requests.length).toBe(initialRequests);
    expect(state.mounts).toBe(1);
    expect(container.textContent).toContain('Dashboard: Owner');
  });

  it('does not reuse Owner authorization after an account change', async () => {
    await act(async () => root.render(<AuthQueryProvider><SignedInPage /></AuthQueryProvider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(container.textContent).toContain('Dashboard: Owner');

    state.userId = null;
    await act(async () => root.render(<AuthQueryProvider><SignedInPage /></AuthQueryProvider>));
    expect(container.textContent).toBe('Signed out');

    state.userId = 'school-admin';
    await act(async () => root.render(<AuthQueryProvider><SignedInPage /></AuthQueryProvider>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });

    expect(container.textContent).toContain('Dashboard: School Admin');
    expect(container.textContent).not.toContain('Dashboard: Owner');
    expect(state.requests.filter(user => user === 'owner').length).toBeLessThanOrEqual(2);
    expect(state.requests.filter(user => user === 'school-admin').length).toBeGreaterThanOrEqual(1);
  });
});