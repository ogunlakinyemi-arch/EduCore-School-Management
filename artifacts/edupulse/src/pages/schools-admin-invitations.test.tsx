// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  owner: true,
  schoolStatus: 'pending',
  administrators: [] as Array<{ id: number; name: string; email: string }>,
  invalidateQueries: vi.fn(),
  invitations: [
    {
      invitationId: 101,
      claimId: 'claim-pending',
      email: 'incorrect@school.edu',
      fullName: 'Jordan Doe',
      status: 'PENDING',
      clerkStatus: 'pending',
      isCurrent: true,
      membershipId: null,
      userId: null,
      createdAt: '2024-01-01T00:00:00.000Z',
      expiresAt: '2024-01-08T00:00:00.000Z',
    },
    {
      invitationId: 102,
      claimId: 'claim-active',
      email: 'active@school.edu',
      fullName: 'Alex Active',
      status: 'ACTIVE',
      clerkStatus: 'accepted',
      isCurrent: true,
      membershipId: 202,
      userId: 303,
      createdAt: '2024-01-01T00:00:00.000Z',
      expiresAt: null,
    },
    {
      invitationId: 103,
      claimId: 'claim-expired',
      email: 'expired@school.edu',
      fullName: 'Taylor Expired',
      status: 'EXPIRED',
      clerkStatus: 'expired',
      isCurrent: false,
      membershipId: null,
      userId: null,
      createdAt: '2024-01-01T00:00:00.000Z',
      expiresAt: '2024-01-08T00:00:00.000Z',
    },
    {
      invitationId: 104,
      claimId: 'claim-pending-b',
      email: 'pending-b@school.edu',
      fullName: 'Morgan Pending',
      status: 'PENDING',
      clerkStatus: 'pending',
      isCurrent: true,
      membershipId: null,
      userId: null,
      createdAt: '2024-01-02T00:00:00.000Z',
      expiresAt: '2024-01-09T00:00:00.000Z',
    },
    {
      invitationId: 105,
      claimId: 'claim-pending-c',
      email: 'pending-c@school.edu',
      fullName: 'Casey Pending',
      status: 'PENDING',
      clerkStatus: 'pending',
      isCurrent: true,
      membershipId: null,
      userId: null,
      createdAt: '2024-01-03T00:00:00.000Z',
      expiresAt: '2024-01-10T00:00:00.000Z',
    },
  ],
}));
const defaultInvitations = fixtures.invitations;

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: fixtures.invalidateQueries }),
  useQuery: ({ queryKey }: any) => queryKey[0] === 'school-admin-invitations'
    ? { data: { schoolId: 12, role: 'SCHOOL_ADMIN', invitations: fixtures.invitations }, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() }
    : { data: {
        id: 12, code: 'NORTH-12', name: 'North School', city: 'Lagos', state: 'Lagos',
        status: fixtures.schoolStatus, subscriptionStatus: 'active', createdAt: '2024-01-01T00:00:00.000Z',
        administrators: fixtures.administrators, partnerReferral: null,
      }, isLoading: false, isError: false, refetch: vi.fn() },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetAuthorizedContext: () => ({ data: { isPlatformOwner: fixtures.owner }, isLoading: false, isError: false, refetch: vi.fn() }),
  useGetSchool: () => ({ data: {}, isLoading: false, isError: false, refetch: vi.fn() }),
  useGetSchoolDashboard: () => ({ data: {}, isLoading: false, isError: false, refetch: vi.fn() }),
  useUpdateSchool: () => ({}),
  getListSchoolsQueryKey: () => ['schools'],
}));

vi.mock('wouter', () => ({
  useParams: () => ({ id: '12' }),
  useLocation: () => ['/', vi.fn()],
  Link: ({ href, children, ...props }: any) => <a href={href} {...props}>{children}</a>,
}));

vi.mock('@/components/shared', () => ({
  PageHeading: ({ eyebrow, title, description, action }: any) => <header><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p>{action}</header>,
  Button: ({ children, onClick, testId, variant: _variant, ...props }: any) => <button data-testid={testId} onClick={onClick} {...props}>{children}</button>,
  StatusPill: ({ value }: any) => <span>{value}</span>,
  SkeletonPage: () => <div>Loading</div>,
  ErrorState: () => <div>Error</div>,
  EmptyState: () => <div>Empty</div>,
  Field: ({ children, label }: any) => <label>{label}{children}</label>,
  Info: ({ label, value }: any) => <div>{label}{value}</div>,
  Metric: ({ label, value }: any) => <div>{label}{value}</div>,
  ActivityFeed: () => <div>Activity</div>,
  Modal: () => null,
  cx: (...classes: string[]) => classes.join(' '),
  date: (value: string) => value,
  time: (value: string) => value,
  useTenant: () => ({ setSchoolId: vi.fn() }),
}));

import { SchoolOverview } from './schools';

let root: Root;
let host: HTMLDivElement;

async function renderPage() {
  await act(async () => root.render(<SchoolOverview />));
}

async function changeValue(element: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe('Platform Owner school administrator invitation status', () => {
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    fixtures.owner = true;
    fixtures.schoolStatus = 'pending';
    fixtures.administrators = [];
    fixtures.invalidateQueries.mockReset();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'PENDING',
        invitationId: 101,
        supersededInvitationId: null,
        previousInviteRevoked: false,
        email: 'corrected@school.edu',
        schoolId: 12,
        role: 'SCHOOL_ADMIN',
        dispatchStatus: 'REQUEST_ACCEPTED',
        deliveryStatus: 'UNVERIFIED',
        expiresAt: '2024-02-01T00:00:00.000Z',
      }),
    }));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    fixtures.invitations = defaultInvitations;
  });

  it('shows actual backend states and does not offer actions for Active invitations', async () => {
    await renderPage();

    expect(host.textContent).toContain('PENDING');
    expect(host.textContent).toContain('ACTIVE');
    expect(host.textContent).toContain('EXPIRED');
    const activeRow = [...host.querySelectorAll('li')].find(row => row.textContent?.includes('active@school.edu'))!;
    expect(activeRow.querySelector('button')).toBeNull();
    expect([...host.querySelectorAll('button')].some(button => button.textContent?.includes('Edit email'))).toBe(true);
  });

  it('shows Pending Administrator Registration until the backend reports Active', async () => {
    await renderPage();

    const operationalStatus = host.querySelector('[data-testid="operational-school-status"]')!;
    expect(operationalStatus.textContent).toBe('Pending Administrator Registration');

    fixtures.schoolStatus = 'active';
    fixtures.administrators = [{ id: 1, name: 'Jordan Doe', email: 'incorrect@school.edu' }];
    await renderPage();
    expect(host.querySelector('[data-testid="operational-school-status"]')?.textContent).toBe('active');
  });

  it('keeps an established inactive school labeled Inactive without an administrator', async () => {
    fixtures.schoolStatus = 'inactive';
    await renderPage();

    expect(host.querySelector('[data-testid="operational-school-status"]')?.textContent).toBe('inactive');
  });

  it('keeps invitation status and delivery details outside Operational status', async () => {
    await renderPage();

    const operationalStatus = host.querySelector('[data-testid="operational-school-status"]')!;
    const invitationArea = host.querySelector('[aria-label="School administrator invitations"]')!;
    expect(operationalStatus.textContent).toBe('Pending Administrator Registration');
    expect(operationalStatus.textContent).not.toContain('PENDING');
    expect(invitationArea.textContent).toContain('PENDING');
    expect(invitationArea.textContent).toContain('Administrator invitation status');
  });

  it('lets the Owner correct pending email and resend pending or expired invitations', async () => {
    await renderPage();
    const pendingRow = [...host.querySelectorAll('li')].find(row => row.textContent?.includes('incorrect@school.edu'))!;
    await act(async () => [...pendingRow.querySelectorAll('button')].find(button => button.textContent?.includes('Edit email'))?.click());
    await changeValue(pendingRow.querySelector<HTMLInputElement>('input[type="email"]')!, 'corrected@school.edu');
    await act(async () => [...pendingRow.querySelectorAll('button')].find(button => button.textContent?.includes('Save email'))?.click());

    expect(fetch).toHaveBeenCalledWith('/api/schools/12/invitations/101', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ email: 'corrected@school.edu' }),
    }));
    expect(host.textContent).toContain('Pending invitation email updated.');

    const pendingResend = [...host.querySelectorAll('li')].find(row => row.textContent?.includes('incorrect@school.edu'))!;
    await act(async () => [...pendingResend.querySelectorAll('button')].find(button => button.textContent?.includes('Resend'))?.click());
    const expiredRow = [...host.querySelectorAll('li')].find(row => row.textContent?.includes('expired@school.edu'))!;
    await act(async () => [...expiredRow.querySelectorAll('button')].find(button => button.textContent?.includes('Resend'))?.click());

    expect(fetch).toHaveBeenCalledWith('/api/schools/12/invitations/101/resend', expect.objectContaining({
      method: 'POST',
      body: '{}',
    }));
    expect(fetch).toHaveBeenCalledWith('/api/schools/12/invitations/103/resend', expect.objectContaining({
      method: 'POST',
      body: '{}',
    }));
    expect(fixtures.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['school-admin-invitations', 12] });
    expect(host.textContent).toContain('Invitation PENDING request accepted');
    expect(host.textContent).toContain('unverified');
  });

  it('isolates a selected row and blocks a rapid duplicate resend before the next render', async () => {
    let finishResend!: () => void;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/invitations/104/resend')) {
        return new Promise<Response>((resolve) => {
          finishResend = () => resolve({
            ok: true,
            json: async () => ({
              status: 'PENDING', invitationId: 104, email: 'pending-b@school.edu',
              deliveryStatus: 'UNVERIFIED',
            }),
          } as Response);
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      } as Response);
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderPage();

    const rowA = [...host.querySelectorAll('li')].find(row => row.textContent?.includes('incorrect@school.edu'))!;
    const rowB = [...host.querySelectorAll('li')].find(row => row.textContent?.includes('pending-b@school.edu'))!;
    const rowC = [...host.querySelectorAll('li')].find(row => row.textContent?.includes('pending-c@school.edu'))!;
    const resendB = [...rowB.querySelectorAll('button')].find(button => button.textContent?.includes('Resend'))!;

    await act(async () => {
      resendB.click();
      resendB.click();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/schools/12/invitations/104/resend', expect.objectContaining({
      method: 'POST',
      body: '{}',
    }));
    expect(rowA.textContent).toContain('Resend');
    expect(rowA.textContent).not.toContain('Resending');
    expect(rowB.textContent).toContain('Resending…');
    expect(rowC.textContent).toContain('Resend');
    expect(rowC.textContent).not.toContain('Resending');

    await act(async () => finishResend());
  });

  it('shows accepted and unverified delivery feedback when a staged attempt is retried', async () => {
    const recoveryInvitation = {
      ...fixtures.invitations[0],
      status: 'RECOVERY_REQUIRED',
      recoveryState: 'DISPATCH_REJECTED',
      recoveryAttemptId: 'attempt-owner-recovery',
    };
    fixtures.invitations = [recoveryInvitation];
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'PENDING',
        invitationId: 206,
        email: 'corrected@school.edu',
        deliveryStatus: 'UNVERIFIED',
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderPage();

    const recoveryRow = [...host.querySelectorAll('li')].find(row =>
      row.textContent?.includes('incorrect@school.edu')
    )!;
    await act(async () => {
      [...recoveryRow.querySelectorAll('button')]
        .find(button => button.textContent?.includes('Retry staged attempt'))?.click();
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/schools/12/invitations/101/reconcile', expect.objectContaining({
      method: 'POST',
      body: '{}',
    }));
    const feedback = [...host.querySelectorAll('[role="status"]')]
      .map(element => element.textContent)
      .find(message => message?.includes('Invitation request accepted'));
    expect(feedback).toBe('Invitation request accepted for corrected@school.edu; inbox delivery is unverified.');
    expect(feedback).not.toContain('no new invitation was sent');
  });

  it('does not expose invitation management to School Admins', async () => {
    fixtures.owner = false;
    await renderPage();
    expect(host.textContent).not.toContain('Administrator invitation status');
    expect(host.textContent).not.toContain('Edit email');
  });
});