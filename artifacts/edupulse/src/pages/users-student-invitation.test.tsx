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
  candidateSearches: [] as Array<{ schoolId: number; role: string; search: string }>,
  missingStudentEmail: false,
  pendingParent: false,
  candidateResults: new Map<string, any[]>(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: any) => {
    if (options.queryKey[0] === 'school-user-invitations-for-activation') {
      return {
        data: mocks.pendingParent ? [{
          invitationId: 'inv_parent_44',
          email: 'grace@example.edu',
          role: 'PARENT',
          status: 'PENDING',
        }] : [],
        isLoading: false,
        isError: false,
        error: null,
      };
    }
    const [, queryParams] = options.queryKey;
    const params = queryParams && typeof queryParams === 'object'
      ? queryParams
      : { schoolId: queryParams ?? 7, role: '', search: '' };
    mocks.candidateSearches.push(params);
    const people: Record<string, any[]> = {
      STUDENT: [{ personId: 42, personType: 'STUDENT', fullName: 'Amara Nwosu', email: mocks.missingStudentEmail ? null : 'amara@example.edu', profileStatus: 'ACTIVE', accountStatus: null, admissionNo: 'ADM-007' }],
      TEACHER: [{ personId: 43, personType: 'TEACHER', fullName: 'Jordan Doe', email: 'jordan@example.edu', phone: '', profileStatus: 'ACTIVE', accountStatus: null, employeeNo: 'EMP-04' }],
      PARENT: [{
        personId: 44, personType: 'PARENT', fullName: 'Grace Okafor', email: 'grace@example.edu',
        phone: '08000000000', profileStatus: mocks.pendingParent ? 'PENDING' : 'ACTIVE',
        accountStatus: mocks.pendingParent ? null : 'ACTIVE', linkedUserId: mocks.pendingParent ? null : 51,
      }],
    };
    const resultKey = JSON.stringify([
      params.schoolId,
      params.role,
      params.search,
      options.enabled,
      mocks.missingStudentEmail,
      mocks.pendingParent,
    ]);
    let matches = mocks.candidateResults.get(resultKey);
    if (!matches) {
      matches = options.enabled
        ? (people[params.role] ?? []).filter(person =>
          !params.search || `${person.fullName} ${person.admissionNo ?? ''}`.toLowerCase().includes(params.search.toLowerCase()))
        : [];
      mocks.candidateResults.set(resultKey, matches);
    }
    return { data: matches, isLoading: false, isError: false, error: null };
  },
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
vi.mock('@/components/school-user-invitation-management', () => ({
  SchoolUserInvitationManagement: () => null,
}));

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
    mocks.candidateSearches = [];
    mocks.missingStudentEmail = false;
    mocks.pendingParent = false;
    mocks.candidateResults.clear();
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

  it('selects an existing student profile and submits its stored identity without re-entry', async () => {
    await renderPage();
    await act(async () => {
      [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Invite User'))?.click();
    });

    const role = host.querySelector<HTMLSelectElement>('select[name="role"]')!;
    await changeValue(role, 'STUDENT');
    expect(host.textContent).toContain('Existing school person');
    await changeValue(host.querySelector<HTMLInputElement>('input[aria-label="Search existing school people"]')!, 'Amara');
    expect(mocks.candidateSearches.at(-1)).toMatchObject({ schoolId: 7, role: 'STUDENT', search: 'Amara' });
    await changeValue(host.querySelector<HTMLSelectElement>('select[aria-label="Existing school person"]')!, '42');

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
        personId: 42,
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

  it('preserves teacher invitations using the selected employee profile and displays explicit server errors', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Invitation is not allowed' }),
    } as Response);
    await renderPage();
    await act(async () => {
      [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Invite User'))?.click();
    });
    await changeValue(host.querySelector<HTMLSelectElement>('select[aria-label="Existing school person"]')!, '43');

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
        personId: 43,
      }),
    }));
    expect(host.textContent).toContain('Invitation is not allowed');
  });

  it('shows inline validation when no existing school person is selected', async () => {
    await renderPage();
    await act(async () => {
      [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Invite User'))?.click();
    });
    await changeValue(host.querySelector<HTMLSelectElement>('select[name="role"]')!, 'STUDENT');

    await act(async () => {
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(host.textContent).toContain('Select an existing school person');
    expect(fetch).not.toHaveBeenCalledWith('/api/school-users/invitations', expect.anything());
  });

  it('clears the selected student when the role or school changes', async () => {
    await renderPage();
    await act(async () => {
      [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Invite User'))?.click();
    });
    const role = host.querySelector<HTMLSelectElement>('select[name="role"]')!;
    await changeValue(role, 'STUDENT');
    const personSelect = host.querySelector<HTMLSelectElement>('select[aria-label="Existing school person"]')!;
    await changeValue(personSelect, '42');
    expect(personSelect.value).toBe('42');

    await changeValue(role, 'TEACHER');
    await changeValue(host.querySelector<HTMLSelectElement>('select[name="role"]')!, 'STUDENT');
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Existing school person"]')!.value).toBe('');
    await changeValue(host.querySelector<HTMLSelectElement>('select[aria-label="Existing school person"]')!, '42');

    await act(async () => {
      [...host.querySelectorAll('button')].find(button => button.textContent === 'Switch school')?.click();
    });
    await renderPage();
    expect(host.querySelector<HTMLSelectElement>('select[aria-label="Existing school person"]')!.value).toBe('');
    expect(mocks.candidateSearches.at(-1)).toMatchObject({ schoolId: 8, role: 'STUDENT' });
  });

  it('requires profile email correction instead of allowing activation-time email re-entry', async () => {
    mocks.missingStudentEmail = true;
    await renderPage();
    await act(async () => {
      [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Invite User'))?.click();
    });
    await changeValue(host.querySelector<HTMLSelectElement>('select[name="role"]')!, 'STUDENT');
    await changeValue(host.querySelector<HTMLSelectElement>('select[aria-label="Existing school person"]')!, '42');
    expect(host.textContent).toContain('Correct the email on this existing school profile before activation');
    expect(host.querySelector('input[name="email"]')).toBeNull();
    expect(host.textContent).toContain('Email cannot be entered');
  });

  it('links children to an active parent through the existing-parent endpoint without invitations', async () => {
    await renderPage();
    await act(async () => {
      [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Invite User'))?.click();
    });
    await changeValue(host.querySelector<HTMLSelectElement>('select[name="role"]')!, 'PARENT');
    await changeValue(host.querySelector<HTMLSelectElement>('select[aria-label="Existing school person"]')!, '44');
    const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => {
      checkbox.click();
    });
    const linkButton = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Link children without invitation'))!;
    await act(async () => {
      linkButton.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    expect(fetch).toHaveBeenCalledWith('/api/parents/44/children?schoolId=7', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ studentIds: [42], relationshipType: 'Guardian' }),
    }));
    expect(fetch).not.toHaveBeenCalledWith('/api/school-users/invitations', expect.anything());
  });

  it('saves the child list and reuses an existing pending parent invitation in one flow', async () => {
    mocks.pendingParent = true;
    await renderPage();
    await act(async () => {
      [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Invite User'))?.click();
    });
    await changeValue(host.querySelector<HTMLSelectElement>('select[name="role"]')!, 'PARENT');
    await changeValue(host.querySelector<HTMLSelectElement>('select[aria-label="Existing school person"]')!, '44');
    const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await act(async () => {
      checkbox.click();
    });
    const continueButton = [...host.querySelectorAll('button')].find(button =>
      button.textContent?.includes('reuse existing invitation'))!;
    await act(async () => {
      continueButton.click();
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(fetch).toHaveBeenCalledWith('/api/parents/44/children?schoolId=7', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ studentIds: [42], relationshipType: 'Guardian' }),
    }));
    expect(fetch).toHaveBeenCalledWith('/api/schools/7/users/invitations/inv_parent_44/resend', expect.objectContaining({
      method: 'POST',
      body: '{}',
    }));
    expect(fetch).not.toHaveBeenCalledWith('/api/school-users/invitations', expect.anything());
  });
});