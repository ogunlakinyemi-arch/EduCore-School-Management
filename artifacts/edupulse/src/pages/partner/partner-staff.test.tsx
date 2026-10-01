// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  profile: { id: 4, isOwner: true, partnerRole: 'PARTNER_OWNER' },
  invitations: [] as Array<Record<string, unknown>>,
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetPartnerProfile: () => ({
    data: state.profile,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/components/shared', () => ({
  Button: ({ children, testId, variant: _variant, ...props }: any) => (
    <button data-testid={testId} {...props}>{children}</button>
  ),
  EmptyState: ({ title, description }: any) => <div>{title} {description}</div>,
  ErrorState: ({ message }: any) => <div role="alert">{message}</div>,
  Field: ({ children, label }: any) => <label>{label}{children}</label>,
  SkeletonPage: () => <div>Loading</div>,
  StatusPill: ({ value }: any) => <span>{value}</span>,
}));

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));

import PartnerStaff from './partner-staff';

let root: Root;
let host: HTMLDivElement;
let queryClient: QueryClient;
let serverInvitations: Array<Record<string, unknown>>;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

async function renderPage() {
  const page = <QueryClientProvider client={queryClient}><PartnerStaff /></QueryClientProvider>;
  for (let attempt = 0; attempt < 20; attempt++) {
    await act(async () => {
      root.render(page);
      await new Promise(resolve => setTimeout(resolve, 10));
    });
    if (host.textContent !== 'Loading') break;
  }
}

beforeEach(() => {
  state.profile = { id: 4, isOwner: true, partnerRole: 'PARTNER_OWNER' };
  serverInvitations = [
    { id: 101, email: 'first@example.test', recipient: 'First person', status: 'PENDING', role: 'PARTNER_STAFF', permission: 'STANDARD', createdAt: '2025-01-01T10:00:00Z', expiresAt: '2025-01-08T10:00:00Z' },
    { id: 202, email: 'middle@example.test', recipient: 'Middle person', status: 'PENDING', role: 'PARTNER_FINANCE', permission: 'FINANCE', createdAt: '2025-01-02T10:00:00Z', expiresAt: '2025-01-09T10:00:00Z' },
    { id: 303, email: 'last@example.test', recipient: 'Last person', status: 'EXPIRED', role: 'PARTNER_ADMIN', permission: 'ADMIN', createdAt: '2025-01-03T10:00:00Z', expiresAt: '2025-01-10T10:00:00Z' },
    { id: 404, email: 'accepted@example.test', recipient: 'Accepted account', status: 'ACCEPTED', role: 'PARTNER_STAFF', permission: 'STANDARD' },
    { id: 505, email: 'revoked@example.test', recipient: 'Revoked invitation', status: 'REVOKED', role: 'PARTNER_FINANCE', permission: 'FINANCE' },
  ];
  state.invitations = serverInvitations;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});

afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  host.remove();
  vi.unstubAllGlobals();
});

describe('partner staff invitation management', () => {
  it.each([
    ['STANDARD', 'PARTNER_STAFF'],
    ['FINANCE', 'PARTNER_FINANCE'],
    ['ADMIN', 'PARTNER_ADMIN'],
  ])('resends only the selected middle %s invitation and shows success', async (permission, role) => {
    serverInvitations = serverInvitations.map((row) =>
      row.id === 202 ? { ...row, permission, role } : row);
    state.invitations = serverInvitations;

    let finishResend!: (value: Response) => void;
    const mockedFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/partner/staff' && method === 'GET') return response([]);
      if (url === '/api/partner/staff/invitations' && method === 'GET') return response(serverInvitations);
      if (url === '/api/partner/staff-invitations/202/resend' && method === 'POST') {
        const replacement = {
          id: 204, email: 'middle@example.test', recipient: 'Middle person', status: 'PENDING',
          role, permission, createdAt: '2025-02-01T10:00:00Z', expiresAt: '2025-02-08T10:00:00Z',
        };
        serverInvitations = serverInvitations.filter(row => row.id !== 202).concat(replacement);
        return new Promise<Response>(resolve => { finishResend = resolve; });
      }
      return response({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', mockedFetch);
    await renderPage();

    expect(host.querySelector('[data-testid="row-partner-invitation-101"]')?.textContent).toContain('first@example.test');
    expect(host.querySelector('[data-testid="row-partner-invitation-202"]')?.textContent).toContain('Middle person');
    expect(host.querySelector('[data-testid="text-invitation-role-202"]')?.textContent).toContain(
      permission === 'ADMIN' ? 'Partner Administrator' : `Partner Staff · ${permission === 'STANDARD' ? 'Standard' : 'Finance'}`,
    );
    expect(host.querySelector('[data-testid="row-partner-invitation-303"]')?.textContent).toContain('EXPIRED');
    expect(host.querySelector('[data-testid="row-partner-invitation-404"]')).toBeNull();
    expect(host.querySelector('[data-testid="row-partner-invitation-505"]')).toBeNull();

    const resendMiddle = host.querySelector<HTMLButtonElement>('[data-testid="button-resend-partner-invitation-202"]')!;
    await act(async () => {
      resendMiddle.click();
      resendMiddle.click();
      await Promise.resolve();
    });

    expect(mockedFetch).toHaveBeenCalledTimes(3);
    expect(mockedFetch).toHaveBeenCalledWith('/api/partner/staff-invitations/202/resend', expect.objectContaining({
      method: 'POST',
    }));
    expect(host.querySelector('[data-testid="status-invitation-action-202"]')?.textContent).toContain('Requesting');
    expect(host.querySelector('[data-testid="status-invitation-action-101"]')).toBeNull();
    expect(host.querySelector('[data-testid="status-invitation-action-303"]')).toBeNull();

    await act(async () => {
      finishResend(response({
        id: 204, email: 'middle@example.test', recipient: 'Middle person', status: 'PENDING',
        role, permission, createdAt: '2025-02-01T10:00:00Z', expiresAt: '2025-02-08T10:00:00Z',
      }));
      await new Promise(resolve => setTimeout(resolve, 20));
    });
    expect(host.querySelector('[data-testid="row-partner-invitation-101"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="row-partner-invitation-303"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="row-partner-invitation-202"]')).toBeNull();
    expect(host.querySelector('[data-testid="row-partner-invitation-204"]')?.textContent).toContain('middle@example.test');
    expect(host.querySelector('[data-testid="status-invitation-action-204"]')?.textContent).toContain('request accepted');
  });

  it('does not query staff or invitation data for another partner role', async () => {
    state.profile = { id: 40, isOwner: false, partnerRole: 'PARTNER_FINANCE' };
    const mockedFetch = vi.fn();
    vi.stubGlobal('fetch', mockedFetch);
    await renderPage();
    expect(host.textContent).toContain('Partner owner access required');
    expect(mockedFetch).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="button-resend-partner-invitation-202"]')).toBeNull();
  });

  it('offers exact-attempt reconciliation for an unresolved creation row without normal resend or revoke actions', async () => {
    const unresolvedCreation = {
      id: 707, email: 'new-staff@example.test', recipient: 'new-staff@example.test',
      status: 'UNKNOWN_PROVIDER_STATE', role: 'PARTNER_ADMIN', permission: 'ADMIN',
      invitationAttemptId: 'staff-create-attempt', selectedInvitationId: null,
      createdAt: '2025-02-01T10:00:00Z', expiresAt: '2025-02-08T10:00:00Z',
    };
    const mockedFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/partner/staff' && method === 'GET') return response([]);
      if (url === '/api/partner/staff/invitations' && method === 'GET') return response([unresolvedCreation]);
      if (url === '/api/partner/staff-invitations/707/resend' && method === 'POST') {
        expect(JSON.parse(String(init?.body))).toEqual({ mode: 'reconcile' });
        return response({
          ...unresolvedCreation, status: 'PENDING', invitationAttemptStatus: 'RECOVERED',
        });
      }
      return response({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', mockedFetch);
    await renderPage();

    expect(host.querySelector('[data-testid="row-partner-invitation-707"]')?.textContent)
      .toContain('Partner Administrator');
    expect(host.querySelector('[data-testid="button-resend-partner-invitation-707"]')).toBeNull();
    expect(host.querySelector('[data-testid="button-revoke-partner-invitation-707"]')).toBeNull();
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="button-reconcile-partner-invitation-707"]')!.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(mockedFetch).toHaveBeenCalledWith('/api/partner/staff-invitations/707/resend',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ mode: 'reconcile' }) }));
    expect(host.querySelector('[data-testid="status-invitation-action-707"]')?.textContent)
      .toContain('No new email was sent');
    expect(host.querySelector('[data-testid="status-invitation-action-707"]')?.textContent)
      .not.toContain('request accepted');
  });

  it('projects an unresolved source resend as one reconciliation-only row', async () => {
    const unresolvedSource = {
      id: 202, email: 'middle@example.test', recipient: 'Middle person',
      status: 'DISPATCHING', role: 'PARTNER_FINANCE', permission: 'FINANCE',
      invitationAttemptId: 'staff-resend-attempt', selectedInvitationId: 202,
    };
    const mockedFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/partner/staff' && method === 'GET') return response([]);
      if (url === '/api/partner/staff/invitations' && method === 'GET') return response([unresolvedSource]);
      if (url === '/api/partner/staff-invitations/202/resend' && method === 'POST') {
        expect(JSON.parse(String(init?.body))).toEqual({ mode: 'reconcile' });
        return response({ ...unresolvedSource, status: 'PENDING', invitationAttemptStatus: 'RECOVERED' });
      }
      return response({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', mockedFetch);
    await renderPage();

    expect(host.querySelectorAll('[data-testid^="row-partner-invitation-202"]')).toHaveLength(1);
    expect(host.querySelector('[data-testid="button-resend-partner-invitation-202"]')).toBeNull();
    expect(host.querySelector('[data-testid="button-revoke-partner-invitation-202"]')).toBeNull();
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="button-reconcile-partner-invitation-202"]')!.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(host.querySelector('[data-testid="status-invitation-action-202"]')?.textContent)
      .toContain('Invitation recovered. No new email was sent.');
  });

  it('keeps admin portal permissions and revokes only the selected expired invitation', async () => {
    state.profile = { id: 4, isOwner: false, partnerRole: 'PARTNER_ADMIN' };
    const mockedFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/partner/staff' && method === 'GET') return response([]);
      if (url === '/api/partner/staff/invitations' && method === 'GET') return response(serverInvitations);
      if (url === '/api/partner/staff-invitations/303' && method === 'DELETE') {
        const index = serverInvitations.findIndex(row => row.id === 303);
        if (index >= 0) serverInvitations.splice(index, 1);
        return response({ id: 303, partnerId: 4, status: 'REVOKED' });
      }
      return response({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', mockedFetch);
    await renderPage();

    expect(host.querySelector('[data-testid="button-invite-partner-staff"]')).not.toBeNull();
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="button-revoke-partner-invitation-303"]')!.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(mockedFetch).toHaveBeenCalledWith('/api/partner/staff-invitations/303', expect.objectContaining({ method: 'DELETE' }));
    expect(host.querySelector('[data-testid="row-partner-invitation-303"]')).toBeNull();
    expect(host.querySelector('[data-testid="status-invitation-action-303"]')?.textContent).toContain('Invitation revoked');
    expect(host.querySelector('[data-testid="row-partner-invitation-101"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="row-partner-invitation-202"]')).not.toBeNull();
  });

  it('shows stale invitation errors against only the selected row', async () => {
    const mockedFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url === '/api/partner/staff' && method === 'GET') return response([]);
      if (url === '/api/partner/staff/invitations' && method === 'GET') return response(serverInvitations);
      if (url === '/api/partner/staff-invitations/202/resend' && method === 'POST') {
        return response({ error: 'Staff invitation not found' }, 404);
      }
      return response({ error: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', mockedFetch);
    await renderPage();
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="button-resend-partner-invitation-202"]')!.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(host.querySelector('[data-testid="error-invitation-action-202"]')?.textContent).toContain('Staff invitation not found');
    expect(host.querySelector('[data-testid="error-invitation-action-101"]')).toBeNull();
    expect(host.querySelector('[data-testid="error-invitation-action-303"]')).toBeNull();
  });
});