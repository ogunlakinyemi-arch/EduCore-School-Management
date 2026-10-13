// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(), students: vi.fn(), guardians: vi.fn(), thread: vi.fn(),
}));
vi.mock('wouter', () => ({ useLocation: () => ['/', mocks.navigate] }));
vi.mock('@workspace/api-client-react', async importOriginal => {
  const actual = await importOriginal<typeof import('@workspace/api-client-react')>();
  return {
    ...actual,
    useListCommunicationStudents: mocks.students,
    useListCommunicationGuardians: mocks.guardians,
    useGetParentCommunicationThread: mocks.thread,
    useListSchoolParentMessageThreads: () => ({ data: { items: [] }, isLoading: false, refetch: vi.fn() }),
    useCreateSchoolParentMessageThread: () => ({ mutateAsync: vi.fn() }),
    useReplyToParentCommunicationThread: () => ({ mutateAsync: vi.fn() }),
    useMarkParentCommunicationThreadRead: () => ({ mutateAsync: vi.fn() }),
    useArchiveParentCommunicationThread: () => ({ mutateAsync: vi.fn() }),
  };
});
vi.mock('@/components/school-ops-kit', () => ({ errMsg: () => 'Mock failure' }));
vi.mock('./security/ui', () => ({
  inputClass: '', Notice: ({ children }: any) => <div>{children}</div>,
}));
vi.mock('@/components/shared', () => ({
  Button: ({ children, onClick, disabled }: any) => <button onClick={onClick} disabled={disabled}>{children}</button>,
  EmptyState: () => <div>No messages</div>,
  ErrorState: ({ message, retry }: any) => <div>{message}<button onClick={retry}>Return to messages</button></div>,
  Field: ({ children }: any) => <div>{children}</div>,
  Modal: ({ children }: any) => <div>{children}</div>,
  SkeletonPage: () => <div>Loading</div>, StatusPill: () => <span />,
  date: () => '', time: () => '', cx: () => '',
}));
import { SchoolThreads } from './school-threads';
import { ThreadLinkPage } from './parent-communication/threads';
import { getListCommunicationStudentsQueryKey, getListCommunicationGuardiansQueryKey } from '@workspace/api-client-react';

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  mocks.students.mockReturnValue({ data: [], isLoading: false, isError: false });
  mocks.guardians.mockReturnValue({ data: [], isLoading: false, isError: false });
  mocks.thread.mockReturnValue({ data: undefined, isLoading: false, isError: false, refetch: vi.fn() });
  host = document.createElement('div'); document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe('school messaging query and recovery contracts', () => {
  it('keys student and guardian queries by school and selected student', async () => {
    mocks.students.mockReturnValue({ data: [{ id: 7, firstName: 'Synthetic', lastName: 'Student' }], isLoading: false });
    await act(async () => root.render(<SchoolThreads schoolId={101} teacher={false} />));
    expect(mocks.students.mock.lastCall?.[1].query.queryKey).toEqual(getListCommunicationStudentsQueryKey({ schoolId: 101 }));
    expect(mocks.guardians.mock.lastCall?.[2].query.enabled).toBe(false);
    await act(async () => {
      const select = host.querySelector('[data-testid="select-thread-student"]') as HTMLSelectElement;
      select.value = '7'; select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(mocks.guardians.mock.lastCall?.[2].query).toMatchObject({
      queryKey: getListCommunicationGuardiansQueryKey(7, { schoolId: 101 }), enabled: true,
    });
    await act(async () => root.render(<SchoolThreads schoolId={202} teacher={false} />));
    expect(mocks.students.mock.lastCall?.[1].query.queryKey).toEqual(getListCommunicationStudentsQueryKey({ schoolId: 202 }));
    expect(mocks.guardians.mock.lastCall?.[2].query.queryKey).toEqual(getListCommunicationGuardiansQueryKey(7, { schoolId: 202 }));
  });
  it('does not enable school queries without a school', async () => {
    await act(async () => root.render(<SchoolThreads schoolId={0} teacher={true} />));
    expect(mocks.students.mock.lastCall?.[1].query.enabled).toBe(false);
    expect(mocks.guardians.mock.lastCall?.[2].query.enabled).toBe(false);
  });
  for (const parent of [false, true]) {
    it.each(['0', '-1', 'abc', '1.5', '1e3', '9007199254740992'])(
      `rejects invalid thread %s and offers ${parent ? 'parent' : 'school'} recovery without fetching it`,
      async threadId => {
        await act(async () => root.render(<ThreadLinkPage threadId={threadId} parent={parent} />));
        expect(mocks.thread).not.toHaveBeenCalled();
        expect(host.textContent).toContain('conversation link is invalid');
        await act(async () => (host.querySelector('button') as HTMLButtonElement).click());
        expect(mocks.navigate).toHaveBeenCalledWith(parent ? '/parent/communication' : '/communications');
      },
    );
  }
  it('passes a valid numeric thread ID to the existing thread query', async () => {
    await act(async () => root.render(<QueryClientProvider client={new QueryClient()}><ThreadLinkPage threadId="12" /></QueryClientProvider>));
    expect(mocks.thread.mock.lastCall?.[0]).toBe(12);
  });
});
