// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Router, Route, Switch, useLocation } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const state = vi.hoisted(() => ({
  contextLoading: false, profileLoading: false, allowed: false, permissionError: false,
  roles: [{ role: 'PARTNER', status: 'ACTIVE', schoolId: null }],
  platformOwner: false, permissions: { 7: false, 8: true } as Record<number, boolean>,
  updates: [] as { partnerId: number; data: { enabled: boolean } }[],
}));
vi.mock('@workspace/api-client-react', async original => ({
  ...await original<typeof import('@workspace/api-client-react')>(),
  useGetAuthorizedContext: () => ({
    isLoading: state.contextLoading,
    data: state.contextLoading ? undefined : { isPlatformOwner: state.platformOwner, roles: state.roles },
  }),
  useGetPartnerProfile: () => ({
    isLoading: state.profileLoading,
    data: state.profileLoading ? undefined : { fullName: 'Controlled Partner', isOwner: false, partnerRole: 'PARTNER_STAFF' },
  }),
  useGetPartnerDashboard: () => ({ isLoading: false, data: { referredSchools: 0 } }),
  useListPartners: () => ({ isLoading: false, data: [
    { id: 7, fullName: 'Partner A', partnerCode: 'A', status: 'ACTIVE', totalSchools: 0, totalCommissionEarned: 0 },
    { id: 8, fullName: 'Partner B', partnerCode: 'B', status: 'ACTIVE', totalSchools: 0, totalCommissionEarned: 0 },
  ] }),
  useGetPartnerNfcPermission: (id: number) => ({
    isLoading: false, isError: state.permissionError, isFetching: false,
    data: { enabled: state.permissions[id], history: [] }, refetch: vi.fn(),
  }),
  useUpdatePartnerNfcPermission: () => ({
    isPending: false,
    mutate: (input: { partnerId: number; data: { enabled: boolean } }, options: { onSuccess: () => void }) => {
      state.updates.push(input); state.permissions[input.partnerId] = input.data.enabled; options.onSuccess();
    },
  }),
}));
vi.mock('@clerk/react', async original => ({
  ...await original<typeof import('@clerk/react')>(),
  UserButton: () => null,
}));
vi.mock('@/pages/partner/nfc-access', () => ({ usePartnerNfcAccess: () => ({ allowed: state.allowed }) }));
vi.mock('@/pages/communication-inbox', () => ({ CommunicationInboxBadge: () => null, CommunicationInbox: () => null }));
vi.mock('@/components/shared', async original => ({
  ...await original<typeof import('@/components/shared')>(),
  TenantProvider: ({ children }: { children: ReactNode }) => children,
  Shell: ({ children }: { children: ReactNode }) => children,
}));
import PartnerPortal from './portal';
import PartnerManagement from './management';
import { PartnerNfcOwnerControl } from './nfc-owner-control';
import { ProtectedRoutes, RoleGuard } from '@/App';

let root: Root, container: HTMLDivElement, client: QueryClient;
beforeEach(() => {
  Object.assign(state, { contextLoading: false, profileLoading: false, allowed: false, permissionError: false,
    platformOwner: false, roles: [{ role: 'PARTNER', status: 'ACTIVE', schoolId: null }],
    permissions: { 7: false, 8: true }, updates: [] });
  window.sessionStorage.clear();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // No application requests reach Development: the sole overview query uses this fixture response.
  vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(async () => {
  await act(async () => root.unmount()); client.clear(); container.remove(); vi.unstubAllGlobals();
});
async function render(node: ReactNode, path = '/partner') {
  const location = memoryLocation({ path });
  function LocationObserver() {
    const [path] = useLocation();
    return <output data-testid="current-path">{path}</output>;
  }
  await act(async () => root.render(
    <QueryClientProvider client={client}><Router hook={location.hook}><LocationObserver />{node}</Router></QueryClientProvider>,
  ));
  return location;
}
describe('Partner landing and explicit route authorization', () => {
  it('reproduces the original missing landing route without blaming a context race', async () => {
    await render(<Switch><Route path="/partner">Dashboard</Route><Route>404 Page Not Found</Route></Switch>, '/');
    expect(container.textContent).toContain('404 Page Not Found');
  });
  it('resolved Partner context at the sign-in landing path opens the real dashboard without a click', async () => {
    await render(<ProtectedRoutes />, '/');
    expect(container.querySelector('[data-testid=current-path]')?.textContent).toBe('/partner');
    expect(container.textContent).toContain('Welcome, Controlled Partner.');
    expect(container.textContent).not.toContain('404');
  });
  it.each(['/partner', '/partner/'])('direct navigation and refresh at %s render the dashboard', async path => {
    await render(<RoleGuard allowedRoles={['PARTNER']}><PartnerPortal /></RoleGuard>, path);
    expect(container.textContent).toContain('Welcome, Controlled Partner.');
    // Remount the application view at the same URL; this is a DOM test,
    // not proof of a new Clerk browser session or an actual browser refresh.
    await act(async () => root.unmount());
    root = createRoot(container);
    client.clear();
    await render(<RoleGuard allowedRoles={['PARTNER']}><PartnerPortal /></RoleGuard>, path);
    expect(container.textContent).not.toContain('404');
  });
  it('pending authoritative role context shows loading, never a 404 or protected portal', async () => {
    state.contextLoading = true; await render(<ProtectedRoutes />, '/');
    expect(container.querySelector('[role=status]')?.textContent).toContain('Loading your authorized portal');
    expect(container.textContent).not.toContain('404');
    expect(container.textContent).not.toContain('Welcome');
  });
  it('pending profile shows the existing loading component rather than a 404', async () => {
    state.profileLoading = true; await render(<PartnerPortal />);
    expect(container.textContent).not.toContain('404');
    expect(container.textContent).not.toContain('Welcome');
  });
  it.each(['SCHOOL_ADMIN', 'TEACHER'])('non-Partner %s cannot enter Partner routes', async role => {
    state.roles = [{ role, status: 'ACTIVE', schoolId: null }];
    await render(<RoleGuard allowedRoles={['PARTNER']}><PartnerPortal /></RoleGuard>);
    expect(container.textContent).toContain('Access Denied');
    expect(container.textContent).not.toContain('Controlled Partner');
  });
  it('inactive Partner membership is denied', async () => {
    state.roles = [{ role: 'PARTNER', status: 'INACTIVE', schoolId: null }];
    await render(<RoleGuard allowedRoles={['PARTNER']}><PartnerPortal /></RoleGuard>);
    expect(container.textContent).toContain('Access Denied');
  });
  it('unknown Partner URLs keep their actual 404', async () => {
    await render(<PartnerPortal />, '/partner/not-a-real-page');
    expect(container.textContent).toContain('404 Page Not Found');
  });
  it('uses real subtree patterns instead of the invalid /partner* pattern', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toContain('<Route path="/partner/*"><RoleGuard');
    expect(app).not.toContain('<Route path="/partner*">');
  });
  it('NFC navigation appears only with live permission, and disappears on revocation', async () => {
    await render(<PartnerPortal />);
    expect(container.querySelector('[data-testid=link-partner-nfc-activation-mobile]')).toBeNull();
    state.allowed = true; await render(<PartnerPortal />);
    expect(container.querySelector('[data-testid=link-partner-nfc-activation-mobile]')).not.toBeNull();
    expect(container.querySelector('[data-testid=link-partner-nfc-activation]')).not.toBeNull();
    state.allowed = false; await render(<PartnerPortal />);
    expect(container.querySelector('[data-testid=link-partner-nfc-activation-mobile]')).toBeNull();
  });
});
describe('existing Owner Partner management permission discovery', () => {
  it('overview renders a clearly named state/control for each Partner', async () => {
    await render(<RoleGuard isPlatformOwnerOnly><PartnerManagement /></RoleGuard>, '/partners');
    expect(container.textContent).toContain('Access Denied');
    state.platformOwner = true;
    await render(<RoleGuard isPlatformOwnerOnly><PartnerManagement /></RoleGuard>, '/partners');
    expect(container.querySelector('[data-testid=text-nfc-state-7]')?.textContent).toBe('Disabled');
    expect(container.querySelector('[data-testid=text-nfc-state-8]')?.textContent).toBe('Enabled');
    expect(container.querySelector('[data-testid=button-grant-nfc-7]')?.textContent).toContain('Grant NFC Card Activation to Partner A');
    expect(container.querySelector('[data-testid=button-revoke-nfc-8]')?.textContent).toContain('Revoke NFC Card Activation for Partner B');
  });
  it('grant/revoke submit the existing contract and state persists across a fresh render', async () => {
    await render(<PartnerNfcOwnerControl partnerId={7} partnerName="Partner A" compact />);
    await act(async () => (container.querySelector('button') as HTMLButtonElement).click());
    expect(state.updates[0]).toEqual({ partnerId: 7, data: { enabled: true } });
    await render(<PartnerNfcOwnerControl partnerId={7} partnerName="Partner A" compact />);
    expect(container.textContent).toContain('Enabled');
    await act(async () => (container.querySelector('button') as HTMLButtonElement).click());
    expect(state.updates[1]).toEqual({ partnerId: 7, data: { enabled: false } });
    await render(<PartnerNfcOwnerControl partnerId={7} partnerName="Partner A" compact />);
    expect(container.textContent).toContain('Disabled');
  });
  it('an error cannot leave an actionable cached permission toggle', async () => {
    state.permissionError = true;
    await render(<PartnerNfcOwnerControl partnerId={7} compact />);
    expect(container.querySelector('[role=alert]')).not.toBeNull();
    expect(container.querySelector('[data-testid=button-grant-nfc-7]')).toBeNull();
  });
});
