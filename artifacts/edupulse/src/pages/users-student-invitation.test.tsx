// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  owner: false,
  schoolId: 7,
  studentRequests: [] as Array<{ params: any; enabled: boolean }>,
  invalidateQueries: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock('@workspace/api-client-react', () => ({
  useListUsers: () => ({ data: [], isLoading: false, isError: false }),
  useListSchoolUsers: () => ({ data: [], isLoading: false, isError: false }),
  getListUsersQueryKey: () => ['users'],
  getListSchoolUsersQueryKey: () => ['school-users'],
  useGetAuthorizedContext: () => ({
    data: {
      isPlatformOwner: mocks.owner,
      roles: [{ schoolId: mocks.schoolId, role: 'SCHOOL_ADMIN' }],
    },
  }),
  useListStudents: (params: any, options: { query: { enabled: boolean } }) => {
    mocks.studentRequests.push({ params, enabled: options.query.enabled });
    const matchesSearch = !params.search || 'Amara Nwosu ADM-007'.toLowerCase().includes(params.search.toLowerCase());
    return {
      data: matchesSearch ? [{ id: 42, firstName: 'Amara', lastName: 'Nwosu', admissionNo: 'ADM-007' }] : [],
      isLoading: false,
      isError: false,
    };
  },
  getListStudentsQueryKey: (params: any) => ['students', params],
}));

vi.mock('@/components/shared', () => ({
  PageHeading: ({ action }: any) => <header>{action}</header>,
  Button: ({ children, ...props }: any) => <button {...props}>{children}</button>,
  StatusPill: () => null,
  SkeletonPage: () => <div>Loading</div>,
  ErrorState: () => <div>Error</div>,
  EmptyState: ({ title }: any) => <div>{title}</div>,
  Modal: ({ children }: any) => <section>{children}</section>,
  Field: ({ children }: any) => <label>{children}</label>,
  TenantPicker: () => <button type="button" onClick={() => { mocks.schoolId = 8; }}>Switch school</button>,
  useTenant: () => ({ schoolId: mocks.schoolId, setSchoolId: vi.fn() }),
  cx: (...classes: string[]) => classes.join(' '),
  date: () => '',
}));

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));

import { UsersPage } from './users';

let root: Root;
let host: HTMLDivElement;

const renderPage = async () => {
  await act(async () => root.render(<UsersPage />));
};

const changeValue = async (element: HTMLInputElement | HTMLSelectElement, value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

describe('school student invitation UI', () => {
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    mocks.owner = false;
    mocks.schoolId = 7;
    mocks.studentRequests = [];
    mocks.invalidateQueries.mockReset();
    mocks.toast.mockReset();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'DISPATCH_REQUESTED', email: 'amara@example.edu' }),
    }));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  it('searches active students in the selected school and submits the selected profile ID', async () => {
    await renderPage();
    await act(async () => {
      [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Invite User'))?.click();
    });

    const role = host.querySelector<HTMLSelectElement>('select[name="role"]')!;
    await changeValue(role, 'STUDENT');
    expect(host.textContent).toContain('Student access links to this existing school profile');
    expect(mocks.studentRequests.at(-1)).toMatchObject({
      params: { schoolId: 7, status: 'ACTIVE', search: undefined },
      enabled: true,
    });

    await changeValue(host.querySelector<HTMLInputElement>('input[aria-label="Search active students"]')!, 'Amara');
    expect(mocks.studentRequests.at(-1)).toMatchObject({
      params: { schoolId: 7, status: 'ACTIVE', search: 'Amara' },
      enabled: true,
    });
    await changeValue(host.querySelector<HTMLInputElement>('input[name="fullName"]')!, 'Amara Nwosu');
    await changeValue(host.querySelector<HTMLInputElement>('input[name="email"]')!, 'amara@example.edu');
    await changeValue(host.querySelector<HTMLSelectElement>('select[name="studentId"]')!, '42');

    await act(async () => {
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(fetch).toHaveBeenCalledWith('/api/school-users/invitations', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        schoolId: 7,
        fullName: 'Amara Nwosu',
        email: 'amara@example.edu',
        phone: '',
        role: 'STUDENT',
        studentId: 42,
      }),
    }));
  });

  it('keeps Student unavailable in the platform-owner form', async () => {
    mocks.owner = true;
    await renderPage();
    await act(async () => {
      [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Invite School Admin'))?.click();
    });

    expect(host.querySelector('select[name="role"]')).toBeNull();
    expect(host.textContent).not.toContain('Existing student profile');
    expect(mocks.studentRequests.every(request => !request.enabled)).toBe(true);
  });

  it('does not claim administrator access is Active from the invitation POST response', async () => {
    mocks.owner = true;
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ACTIVE', email: 'admin@example.edu', expiresAt: null }),
    } as Response);
    await renderPage();
    await act(async () => {
      [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Invite School Admin'))?.click();
    });
    await changeValue(host.querySelector<HTMLInputElement>('input[name="fullName"]')!, 'Morgan Admin');
    await changeValue(host.querySelector<HTMLInputElement>('input[name="email"]')!, 'admin@example.edu');
    await act(async () => {
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Administrator invitation request completed',
      description: expect.stringContaining("actual status"),
    }));
    expect(mocks.toast.mock.calls[0][0].title).not.toBe('Access granted');
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['school-admin-invitations', 7] });
  });

  it('preserves teacher invitations and displays explicit server errors', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Invitation is not allowed' }),
    } as Response);
    await renderPage();
    await act(async () => {
      [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Invite User'))?.click();
    });
    await changeValue(host.querySelector<HTMLInputElement>('input[name="fullName"]')!, 'Jordan Doe');
    await changeValue(host.querySelector<HTMLInputElement>('input[name="email"]')!, 'jordan@example.edu');

    await act(async () => {
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(fetch).toHaveBeenCalledWith('/api/school-users/invitations', expect.objectContaining({
      body: JSON.stringify({
        schoolId: 7,
        fullName: 'Jordan Doe',
        email: 'jordan@example.edu',
        phone: '',
        role: 'TEACHER',
      }),
    }));
    expect(host.textContent).toContain('Invitation is not allowed');
  });

  it('shows inline validation when a student profile is not selected', async () => {
    await renderPage();
    await act(async () => {
      [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Invite User'))?.click();
    });
    await changeValue(host.querySelector<HTMLSelectElement>('select[name="role"]')!, 'STUDENT');
    await changeValue(host.querySelector<HTMLInputElement>('input[name="fullName"]')!, 'Amara Nwosu');
    await changeValue(host.querySelector<HTMLInputElement>('input[name="email"]')!, 'amara@example.edu');

    await act(async () => {
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(host.textContent).toContain('Select an existing student profile');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('clears the selected student when the role or school changes', async () => {
    await renderPage();
    await act(async () => {
      [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Invite User'))?.click();
    });
    const role = host.querySelector<HTMLSelectElement>('select[name="role"]')!;
    await changeValue(role, 'STUDENT');
    const studentSelect = host.querySelector<HTMLSelectElement>('select[name="studentId"]')!;
    await changeValue(studentSelect, '42');
    expect(studentSelect.value).toBe('42');

    await changeValue(role, 'TEACHER');
    await changeValue(host.querySelector<HTMLSelectElement>('select[name="role"]')!, 'STUDENT');
    expect(host.querySelector<HTMLSelectElement>('select[name="studentId"]')!.value).toBe('');
    await changeValue(host.querySelector<HTMLSelectElement>('select[name="studentId"]')!, '42');

    await act(async () => {
      [...host.querySelectorAll('button')].find(button => button.textContent === 'Switch school')?.click();
    });
    await renderPage();
    expect(host.querySelector<HTMLSelectElement>('select[name="studentId"]')!.value).toBe('');
    expect(mocks.studentRequests.at(-1)).toMatchObject({ params: { schoolId: 8, status: 'ACTIVE' } });
  });
});