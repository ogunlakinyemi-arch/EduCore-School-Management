// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ query: {} as any, options: {} as any, uid: 'owner-a' }));
vi.mock('@clerk/react', () => ({ useUser: () => ({ user: { id: state.uid } }) }));
vi.mock('@tanstack/react-query', () => ({ useQuery: (options: any) => { state.options = options; return state.query; } }));
import { SchoolSubscriptionTermPicker } from './school-subscription-term-picker';
const term = { id: 12, sessionName: '2026/2027', name: 'First term', startDate: '2026-09-01', endDate: '2026-12-15', status: 'ACTIVE', isCurrent: true };
beforeEach(() => { state.uid = 'owner-a'; state.query = { data: [term], isPending: false, isError: false, refetch: vi.fn() }; });
const render = (schoolId?: number) => renderToStaticMarkup(<SchoolSubscriptionTermPicker schoolId={schoolId} onChange={vi.fn()} />);
it('renders saved term IDs with session, dates and current status even when finance is unavailable', () => {
  const html = render(1);
  expect(html).toContain('value="12"');
  expect(html).toContain('2026/2027 · First term · 2026-09-01 – 2026-12-15 · Current · ACTIVE');
  expect(html).toContain('All terms');
});
it('isolates query caches by school and signed-in identity and never chooses a school', () => {
  render(1); expect(state.options.queryKey).toEqual(['school-subscription-calendar', 'owner-a', 1]);
  state.uid = 'owner-b'; render(2);
  expect(state.options.queryKey).toEqual(['school-subscription-calendar', 'owner-b', 2]);
  render(); expect(state.options.enabled).toBe(false);
  expect(render()).toContain('Choose a school first');
});
it('distinguishes loading, empty saved calendar and API error states', () => {
  state.query = { isPending: true };
  expect(render(1)).toContain('Loading academic terms');
  state.query = { data: [], isPending: false };
  expect(render(1)).toContain('No saved academic terms');
  expect(render(1)).not.toContain('All terms');
  state.query = { data: [term], isError: true, isPending: false };
  const html = render(1);
  expect(html).toContain('Retry academic terms');
  expect(html).not.toContain('value="12"');
  expect(html).not.toContain('No saved academic terms');
});
it('sends the saved numeric term ID or an explicit all-terms filter without starting payment', async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div'), root = createRoot(host), change = vi.fn();
  try {
    await act(async () => root.render(<SchoolSubscriptionTermPicker schoolId={1} onChange={change} />));
    const select = host.querySelector('select')!;
    await act(async () => { select.value = '12'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(change).toHaveBeenLastCalledWith(12);
    await act(async () => { select.value = ''; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(change).toHaveBeenLastCalledWith(undefined);
  } finally { await act(async () => root.unmount()); delete (globalThis as any).IS_REACT_ACT_ENVIRONMENT; }
});
