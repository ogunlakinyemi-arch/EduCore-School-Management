// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  links: [
    { id: 41, parentId: 201, studentId: 301, relationshipType: 'Guardian', status: 'ACTIVE', parentName: 'Guardian One', studentName: 'Student One' },
    { id: 42, parentId: 202, studentId: 301, relationshipType: 'Mother', status: 'INACTIVE', parentName: 'Guardian Two', studentName: 'Student One' },
    { id: 43, parentId: 201, studentId: 302, relationshipType: 'Father', status: 'ACTIVE', parentName: 'Guardian One', studentName: 'Student Two' },
  ],
  deactivate: vi.fn(async () => undefined),
}));

vi.mock('@workspace/api-client-react', async importOriginal => {
  const actual = await importOriginal<typeof import('@workspace/api-client-react')>();
  return {
    ...actual,
    useListParentStudentRelationships: () => ({
      data: state.links,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }),
    deactivateParentStudentRelationship: state.deactivate,
  };
});

import { GuardianLinksPanel } from './guardian-links-panel';

let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

async function renderPanel(props: { studentId?: number; parentId?: number }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root!.render(
    <QueryClientProvider client={client}>
      <GuardianLinksPanel schoolId={7} {...props} />
    </QueryClientProvider>,
  ));
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host.remove();
  state.deactivate.mockClear().mockResolvedValue(undefined);
  vi.restoreAllMocks();
});

describe('confirmed guardian unlink controls', () => {
  it('shows only active guardians for a student and links to the existing relink workflow', async () => {
    await renderPanel({ studentId: 301 });
    expect(host.textContent).toContain('Guardian One');
    expect(host.textContent).not.toContain('Guardian Two');
    expect(host.textContent).not.toContain('Student Two');
    expect(host.querySelectorAll('[data-testid^="button-unlink-relationship-"]')).toHaveLength(1);
    expect(host.querySelector('a[href="/parents"]')?.textContent).toContain('Parents & Guardians page');
    expect(host.querySelector('li')?.className).toContain('flex-wrap');
  });

  it('requires confirmation and deactivates only the selected relationship', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await renderPanel({ parentId: 201 });
    const button = host.querySelector<HTMLButtonElement>('[data-testid="button-unlink-relationship-41"]')!;
    await act(async () => button.click());
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('does not delete either record'));
    expect(state.deactivate).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await act(async () => button.click());
    expect(state.deactivate).toHaveBeenCalledWith(41);
    expect(host.textContent).toContain('Their records and history are unchanged.');
  });
});
