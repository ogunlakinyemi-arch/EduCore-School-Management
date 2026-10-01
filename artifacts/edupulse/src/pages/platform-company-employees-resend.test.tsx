// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  employees: [
    {
      id: 1, fullName: 'Staff A', email: 'a@yemait.test', phone: null, jobTitle: 'Accountant',
      status: 'ACTIVE', role: 'COMPANY_ACCOUNTANT', schoolId: null, createdAt: '', updatedAt: '',
      invitationStatus: { employeeId: 1, email: 'a@yemait.test', status: 'PENDING', invitation: { email: 'a@yemait.test', role: 'COMPANY_ACCOUNTANT', status: 'PENDING', deliveryConfirmed: false, invitationId: 'clerk-invitation-a', createdAt: '2026-02-03T11:42:18.000Z' } },
    },
    {
      id: 2, fullName: 'Staff B', email: 'b@yemait.test', phone: null, jobTitle: 'Activation Officer',
      status: 'ACTIVE', role: 'DEVICE_ACTIVATION_OFFICER', schoolId: 72, createdAt: '', updatedAt: '',
      invitationStatus: { employeeId: 2, email: 'b@yemait.test', status: 'PENDING', invitation: { email: 'b@yemait.test', role: 'DEVICE_ACTIVATION_OFFICER', status: 'PENDING', deliveryConfirmed: false, invitationId: 'clerk-invitation-selected-b', createdAt: '2026-02-03T11:42:18.000Z' } },
    },
    {
      id: 3, fullName: 'Staff C', email: 'c@yemait.test', phone: null, jobTitle: 'Accountant',
      status: 'ACTIVE', role: 'COMPANY_ACCOUNTANT', schoolId: null, createdAt: '', updatedAt: '',
      invitationStatus: { employeeId: 3, email: 'c@yemait.test', status: 'PENDING', invitation: { email: 'c@yemait.test', role: 'COMPANY_ACCOUNTANT', status: 'PENDING', deliveryConfirmed: false, invitationId: 'clerk-invitation-c', createdAt: '2026-02-03T11:42:18.000Z' } },
    },
  ] as any[],
  invitationIdByEmployee: {
    1: 'clerk-invitation-a',
    2: 'clerk-invitation-selected-b',
    3: 'clerk-invitation-c',
  } as Record<number, string | null>,
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: ({ queryKey }: any) => {
      if (queryKey.includes('invitation')) {
        const employeeId = Number(queryKey[2]);
        const invitationId = state.invitationIdByEmployee[employeeId];
        const employee = state.employees.find((candidate) => candidate.id === employeeId);
        const summary = employee?.invitationStatus.invitation;
        return {
          data: {
            employeeId,
            email: summary?.email ?? employee?.email ?? '',
            status: 'PENDING',
            invitation: invitationId ? { ...summary, status: 'PENDING', deliveryConfirmed: false, invitationId } : null,
          },
          isPending: false,
          isError: false,
          refetch: vi.fn(),
        };
      }
      if (queryKey[0] === 'platform-school-directory') {
        return { data: [], isPending: false, isError: false };
      }
      return { data: state.employees, isPending: false, isError: false, refetch: vi.fn() };
    },
  };
});

vi.mock('@workspace/api-client-react', () => ({
  getListDeviceActivationOfficersQueryKey: () => ['activation-grants'],
  useGrantDeviceActivationOfficer: () => ({ mutate: vi.fn(), isPending: false, reset: vi.fn() }),
  useListDeviceActivationOfficers: () => ({ data: [], isPending: false, isError: false }),
  useRevokeDeviceActivationOfficer: () => ({ mutate: vi.fn(), isPending: false, reset: vi.fn() }),
}));

vi.mock('@/components/shared', () => ({
  Button: ({ children, testId, ...props }: any) => <button data-testid={testId} {...props}>{children}</button>,
  EmptyState: () => <div>Empty</div>,
  ErrorState: () => <div>Error</div>,
  Field: ({ children, label }: any) => <label>{label}{children}</label>,
  Modal: ({ children, title }: any) => <section role="dialog" aria-label={title}>{children}</section>,
  PageHeading: ({ eyebrow, title, description, action }: any) => <header><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p>{action}</header>,
  SkeletonPage: () => <div>Loading</div>,
  StatusPill: ({ value }: any) => <span>{value}</span>,
}));

import { PlatformCompanyEmployeesPage } from './platform-company-employees';

let root: Root;
let host: HTMLDivElement;
let queryClient: QueryClient;

describe('internal employee resend invitation identity', () => {
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    state.invitationIdByEmployee = {
      1: 'clerk-invitation-a',
      2: 'clerk-invitation-selected-b',
      3: 'clerk-invitation-c',
    };
    state.employees[0].invitationStatus = {
      employeeId: 1,
      email: 'a@yemait.test',
      status: 'PENDING',
      invitation: {
        email: 'a@yemait.test',
        role: 'COMPANY_ACCOUNTANT',
        status: 'PENDING',
        deliveryConfirmed: false,
        invitationId: 'clerk-invitation-a',
        createdAt: '2026-02-03T11:42:18.000Z',
      },
    };
    state.employees[1].invitationStatus = {
      employeeId: 2,
      email: 'b@yemait.test',
      status: 'PENDING',
      invitation: {
        email: 'b@yemait.test',
        role: 'DEVICE_ACTIVATION_OFFICER',
        status: 'PENDING',
        deliveryConfirmed: false,
        invitationId: 'clerk-invitation-selected-b',
        createdAt: '2026-02-03T11:42:18.000Z',
      },
    };
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    host.remove();
    vi.unstubAllGlobals();
  });

  it('shows the current invitation details and requested time while keeping active invitations out of resend management', async () => {
    state.employees[0].invitationStatus.status = 'ACTIVE';
    await act(async () => root.render(<QueryClientProvider client={queryClient}><PlatformCompanyEmployeesPage /></QueryClientProvider>));

    const pendingRow = [...host.querySelectorAll('div')].find((row) =>
      row.textContent?.includes('Staff B') && row.querySelector('[data-testid="button-edit-invitation-2"]'),
    )!;
    expect(pendingRow.textContent).toContain('PENDING');
    expect(pendingRow.textContent).toContain('Role: DEVICE ACTIVATION OFFICER');
    expect(pendingRow.textContent).toContain('Invitation email: b@yemait.test');
    expect(pendingRow.textContent).toContain(`Requested ${new Date('2026-02-03T11:42:18.000Z').toLocaleString()}`);
    expect(host.querySelector('[data-testid="button-edit-invitation-1"]')).toBeNull();
    expect(host.querySelector('[data-testid="button-resend-invitation-row-1"]')).toBeNull();
    expect(host.querySelector('[data-testid="button-resend-invitation-1"]')).toBeNull();

    await act(async () => pendingRow.querySelector<HTMLButtonElement>('[data-testid="button-edit-invitation-2"]')!.click());
    const dialog = host.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Invitation status: PENDING');
    expect(dialog.textContent).toContain('Role: DEVICE ACTIVATION OFFICER');
    expect(dialog.textContent).toContain(`Requested ${new Date('2026-02-03T11:42:18.000Z').toLocaleString()}`);
    expect(dialog.textContent).toContain('Resend Link');
  });

  it('resends directly from the selected row once on a rapid double click without affecting other rows', async () => {
    let finishRequest!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finishRequest = resolve; })));
    await act(async () => root.render(<QueryClientProvider client={queryClient}><PlatformCompanyEmployeesPage /></QueryClientProvider>));

    const selectedRow = [...host.querySelectorAll('div')].find((row) =>
      row.textContent?.includes('Staff B') && row.querySelector('[data-testid="button-resend-invitation-row-2"]'),
    )!;
    const resend = selectedRow.querySelector<HTMLButtonElement>('[data-testid="button-resend-invitation-row-2"]')!;
    expect(resend.textContent).toBe('Resend Link');
    expect(host.querySelector('[data-testid="button-resend-invitation-row-1"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="button-resend-invitation-row-3"]')).not.toBeNull();

    await act(async () => {
      resend.click();
      resend.click();
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/api/platform/company-employees/2/invitation/resend', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ invitationId: 'clerk-invitation-selected-b' }),
    }));
    expect(fetch).not.toHaveBeenCalledWith('/api/platform/company-employees/1/invitation/resend', expect.anything());
    expect(fetch).not.toHaveBeenCalledWith('/api/platform/company-employees/3/invitation/resend', expect.anything());
    expect(host.textContent).toContain('Requesting…');
    await act(async () => {
      finishRequest({
        ok: true,
        json: async () => ({
          employeeId: 2,
          email: 'b@yemait.test',
          role: 'DEVICE_ACTIVATION_OFFICER',
          schoolId: 72,
          invitation: { status: 'DISPATCH_REQUEST_ACCEPTED', deliveryConfirmed: false, invitationId: 'new-id', expiresAt: '' },
        }),
      } as Response);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.textContent).toContain(
      'Clerk accepted the invitation request for b@yemait.test. Dispatch and inbox delivery are not confirmed.',
    );
  });

  it('resends a selected Company Accountant row once without dispatching neighboring invitations', async () => {
    state.employees[1].invitationStatus.invitation.role = 'COMPANY_ACCOUNTANT';
    state.employees[1].invitationStatus.invitation.invitationId = 'clerk-accountant-middle';
    let finishRequest!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finishRequest = resolve; })));
    await act(async () => root.render(<QueryClientProvider client={queryClient}><PlatformCompanyEmployeesPage /></QueryClientProvider>));

    const selectedRow = [...host.querySelectorAll('div')].find((row) =>
      row.textContent?.includes('Staff B') && row.querySelector('[data-testid="button-resend-invitation-row-2"]'),
    )!;
    const resend = selectedRow.querySelector<HTMLButtonElement>('[data-testid="button-resend-invitation-row-2"]')!;
    await act(async () => {
      resend.click();
      resend.click();
      await Promise.resolve();
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/api/platform/company-employees/2/invitation/resend', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ invitationId: 'clerk-accountant-middle' }),
    }));
    expect(fetch).not.toHaveBeenCalledWith('/api/platform/company-employees/1/invitation/resend', expect.anything());
    expect(fetch).not.toHaveBeenCalledWith('/api/platform/company-employees/3/invitation/resend', expect.anything());
    expect(host.textContent).toContain('Requesting…');

    await act(async () => {
      finishRequest({
        ok: true,
        json: async () => ({
          employeeId: 2,
          email: 'b@yemait.test',
          role: 'COMPANY_ACCOUNTANT',
          schoolId: null,
          invitation: { status: 'DISPATCH_REQUEST_ACCEPTED', deliveryConfirmed: false, invitationId: 'new-accountant-id', expiresAt: '' },
        }),
      } as Response);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.textContent).toContain(
      'Clerk accepted the invitation request for b@yemait.test. Dispatch and inbox delivery are not confirmed.',
    );
  });

  it('fails closed when the selected invitation status has no stable invitation ID', async () => {
    state.invitationIdByEmployee[2] = null;
    state.employees[1].invitationStatus.invitation.invitationId = null;
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => root.render(<QueryClientProvider client={queryClient}><PlatformCompanyEmployeesPage /></QueryClientProvider>));
    expect(host.querySelector('[data-testid="button-resend-invitation-row-2"]')).toBeNull();
    const selectedRow = [...host.querySelectorAll('div')].find((row) =>
      row.textContent?.includes('Staff B') && row.querySelector('[data-testid="button-edit-invitation-2"]'),
    )!;
    await act(async () => selectedRow.querySelector<HTMLButtonElement>('[data-testid="button-edit-invitation-2"]')!.click());
    const resend = host.querySelector<HTMLButtonElement>('[data-testid="button-resend-invitation-2"]')!;

    expect(resend.disabled).toBe(true);
    expect(host.textContent).toContain('Invitation ID is unavailable.');
    await act(async () => resend.click());
    expect(fetch).not.toHaveBeenCalled();
  });

  it('releases the keyed guard after a reset and a settled request', async () => {
    const deferred: Array<{ resolve: (response: Response) => void }> = [];
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => deferred.push({ resolve })));
    vi.stubGlobal('fetch', fetchMock);
    await act(async () => root.render(<QueryClientProvider client={queryClient}><PlatformCompanyEmployeesPage /></QueryClientProvider>));

    const selectedRow = [...host.querySelectorAll('div')].find((row) =>
      row.textContent?.includes('Staff B') && row.querySelector('[data-testid="button-edit-invitation-2"]'),
    )!;
    await act(async () => selectedRow.querySelector<HTMLButtonElement>('[data-testid="button-edit-invitation-2"]')!.click());
    const resend = host.querySelector<HTMLButtonElement>('[data-testid="button-resend-invitation-2"]')!;
    await act(async () => resend.click());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const emailInput = host.querySelector<HTMLInputElement>('[data-testid="input-invitation-email-2"]')!;
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(emailInput), 'value')?.set;
      valueSetter?.call(emailInput, 'updated-b@yemait.test');
      emailInput.dispatchEvent(new Event('input', { bubbles: true }));
      emailInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(host.textContent).toContain('Requesting…');

    await act(async () => {
      deferred[0].resolve({
        ok: true,
        json: async () => ({
          employeeId: 2,
          email: 'b@yemait.test',
          role: 'DEVICE_ACTIVATION_OFFICER',
          schoolId: 72,
          invitation: { status: 'DISPATCH_REQUEST_ACCEPTED', deliveryConfirmed: false, invitationId: 'replacement-b', expiresAt: '' },
        }),
      } as Response);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(resend.disabled).toBe(false);
    expect(host.textContent).toContain('Resend Link');

    await act(async () => resend.click());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith('/api/platform/company-employees/2/invitation/resend', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ invitationId: 'clerk-invitation-selected-b' }),
    }));
    await act(async () => {
      deferred[1].resolve({
        ok: true,
        json: async () => ({
          employeeId: 2,
          email: 'b@yemait.test',
          role: 'DEVICE_ACTIVATION_OFFICER',
          schoolId: 72,
          invitation: { status: 'DISPATCH_REQUEST_ACCEPTED', deliveryConfirmed: false, invitationId: 'replacement-b-2', expiresAt: '' },
        }),
      } as Response);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });
});