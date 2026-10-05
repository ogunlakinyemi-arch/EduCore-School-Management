// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('@/components/shared', () => ({
  Button: ({ children, variant: _variant, ...props }: any) => <button {...props}>{children}</button>,
}));

import { SchoolUserInvitationManagement } from './school-user-invitation-management';

const roles = ['TEACHER', 'ACCOUNTANT', 'PARENT', 'STUDENT', 'STAFF', 'DRIVER'] as const;
let root: Root;
let host: HTMLDivElement;

const originalInvitations = (role: string) => [
  {
    invitationId: `first-${role}`,
    email: `first-${role.toLowerCase()}@school.test`,
    fullName: 'First Invitee',
    role,
    status: 'PENDING',
    createdAt: '2025-01-01T00:00:00.000Z',
  },
  {
    invitationId: `middle-${role}`,
    email: `middle-${role.toLowerCase()}@school.test`,
    fullName: 'Middle Invitee',
    role,
    status: 'PENDING',
    createdAt: '2025-01-02T00:00:00.000Z',
  },
  {
    invitationId: `last-${role}`,
    email: `last-${role.toLowerCase()}@school.test`,
    fullName: 'Last Invitee',
    role,
    status: 'PENDING',
    createdAt: '2025-01-03T00:00:00.000Z',
  },
];

async function renderComponent(role: string) {
  await act(async () => root.render(<SchoolUserInvitationManagement schoolId={12} />));
  expect(host.textContent).toContain(role === 'STAFF' ? 'School Staff' : role.charAt(0) + role.slice(1).toLowerCase());
}

async function changeInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

describe.each(roles)('school invitation row actions for %s', (role) => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    let current = originalInvitations(role);
    let replacementSequence = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (init?.method === 'PATCH') {
        replacementSequence += 1;
        const email = JSON.parse(String(init.body)).email;
        current = [
          current[0],
          {
            ...current[1],
            invitationId: `replacement-${replacementSequence}-${role}`,
            email,
          },
          current[2],
        ];
        return {
          ok: true,
          json: async () => ({
            invitationId: `replacement-${replacementSequence}-${role}`,
            email,
            role,
            deliveryStatus: 'UNVERIFIED',
          }),
        } as Response;
      }
      if (init?.method === 'POST') {
        replacementSequence += 1;
        const email = current.find(item => path.includes(encodeURIComponent(item.invitationId)))?.email
          ?? `updated-${role.toLowerCase()}@school.test`;
        current = [
          current[0],
          {
            ...current[1],
            invitationId: `replacement-${replacementSequence}-${role}`,
            email,
          },
          current[2],
        ];
        return {
          ok: true,
          json: async () => ({
            invitationId: `replacement-${replacementSequence}-${role}`,
            email,
            role,
            deliveryStatus: 'UNVERIFIED',
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({ schoolId: 12, invitations: current }),
      } as Response;
    }));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it('edits and resends only the selected middle row with visible success', async () => {
    await renderComponent(role);
    const middleEmail = `middle-${role.toLowerCase()}@school.test`;
    const rows = [...host.querySelectorAll('li')];
    const selected = rows.find(row => row.textContent?.includes(middleEmail))!;
    const otherRows = rows.filter(row => row !== selected);
    expect(rows).toHaveLength(3);
    expect(otherRows.every(row => row.textContent?.includes('Resend Activation Email'))).toBe(true);

    await act(async () => {
      [...selected.querySelectorAll('button')].find(button => button.textContent === 'Edit email')?.click();
    });
    const updatedEmail = `corrected-${role.toLowerCase()}@school.test`;
    await changeInput(selected.querySelector<HTMLInputElement>('input[type="email"]')!, updatedEmail);
    await act(async () => {
      [...selected.querySelectorAll('button')].find(button => button.textContent?.includes('Save email'))?.click();
    });

    expect(fetch).toHaveBeenCalledWith(`/api/schools/12/users/invitations/middle-${role}`, expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ email: updatedEmail }),
    }));
    const replacementRow = [...host.querySelectorAll('li')].find(row => row.textContent?.includes(updatedEmail))!;
    expect(replacementRow.textContent).toContain(`Invitation email updated to ${updatedEmail}.`);

    await act(async () => {
      [...replacementRow.querySelectorAll('button')].find(button => button.textContent === 'Resend Activation Email')?.click();
    });
    expect(fetch).toHaveBeenCalledWith(`/api/schools/12/users/invitations/replacement-1-${role}/resend`, expect.objectContaining({
      method: 'POST',
      body: '{}',
    }));
    expect(host.textContent).toContain(`Invitation request accepted for ${updatedEmail}`);
    expect([...host.querySelectorAll('li')].filter(row => row.textContent?.includes('first-') || row.textContent?.includes('last-'))).toHaveLength(2);
    const relevantRequests = vi.mocked(fetch).mock.calls
      .map(([path]) => String(path))
      .filter(path => path.includes('/users/invitations/') && !path.endsWith('/resend') && path.includes('replacement') === false);
    expect(relevantRequests).toEqual([`/api/schools/12/users/invitations/middle-${role}`]);
  });

  it('shows accepted and unverified delivery feedback on the new row after staged recovery', async () => {
    const selectedId = `middle-${role}`;
    const replacementId = `replacement-recovered-${role}`;
    const email = `middle-${role.toLowerCase()}@school.test`;
    let current = [{
      invitationId: selectedId,
      email,
      fullName: 'Middle Invitee',
      role,
      status: 'RECOVERY_REQUIRED',
      recoveryAttemptId: `attempt-${role}` as string | undefined,
      recoveryState: 'DISPATCH_REJECTED' as string | undefined,
      createdAt: '2025-01-02T00:00:00.000Z',
    }];
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith('/reconcile')) {
        current = [{
          ...current[0],
          invitationId: replacementId,
          status: 'PENDING',
          recoveryAttemptId: undefined,
          recoveryState: undefined,
        }];
        return {
          ok: true,
          json: async () => ({
            status: 'PENDING',
            invitationId: replacementId,
            email,
            deliveryStatus: 'UNVERIFIED',
          }),
        } as Response;
      }
      if (path.endsWith('/resend')) {
        return {
          ok: true,
          json: async () => ({
            status: 'PENDING',
            invitationId: replacementId,
            email,
            deliveryStatus: 'UNVERIFIED',
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({ schoolId: 12, invitations: current }),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchMock);

    await renderComponent(role);
    const recoveryRow = [...host.querySelectorAll('li')].find(row => row.textContent?.includes(email))!;
    await act(async () => {
      [...recoveryRow.querySelectorAll('button')]
        .find(button => button.textContent === 'Retry activation email')?.click();
    });

    const recoveredRow = [...host.querySelectorAll('li')].find(row => row.textContent?.includes(email))!;
    expect(recoveredRow.textContent).toContain('PENDING');
    expect(recoveredRow.textContent).toContain(`Invitation request accepted for ${email}; inbox delivery is unverified.`);
    expect(recoveredRow.textContent).not.toContain('no new invitation was sent');
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/schools/12/users/invitations/${selectedId}/reconcile`,
      expect.objectContaining({ method: 'POST', body: '{}' }),
    );

    await act(async () => {
      [...recoveredRow.querySelectorAll('button')]
        .find(button => button.textContent === 'Resend Activation Email')?.click();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/schools/12/users/invitations/${replacementId}/resend`,
      expect.objectContaining({ method: 'POST', body: '{}' }),
    );
  });
});