// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ customFetch: vi.fn(), legacy: vi.fn(), invalidate: vi.fn(async () => undefined) }));
vi.mock('@workspace/api-client-react', () => ({
  customFetch: (...a: any[]) => { h.customFetch(...a); return Promise.resolve({}); },
  useIssueCardReplacement: () => ({ mutateAsync: async (v: any) => { h.legacy(v); return {}; } }),
}));
vi.mock('@/components/owner-uid-reader', () => ({ useUidInventory: () => ({ data: { inventory: [{ uid: 'CAP1', assigned: false }, { uid: 'TAKEN', assigned: true }] } }) }));
vi.mock('@/components/uid-actions', () => ({ backendError: (e: any) => e.message, useInvalidateCardData: () => h.invalidate }));
vi.mock('@/components/shared', () => ({
  Button: (p: any) => <button disabled={p.disabled} onClick={p.onClick} data-testid={p.testId}>{p.children}</button>,
  Field: (p: any) => <label>{p.label}{p.children}</label>,
}));
import { IssueReplacementControl } from './issue-replacement-control';
import { canIssueRequest } from '@/pages/card-replacements-model';

beforeEach(() => { h.customFetch.mockClear(); h.legacy.mockClear(); });
const setup = async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const el = document.createElement('div'); document.body.appendChild(el);
  const onMessage = vi.fn();
  await act(async () => { createRoot(el).render(<IssueReplacementControl requestId={7} prepared={[{ id: 1, uid: 'PREP1' }]} preparedLoading={false} onMessage={onMessage} onError={vi.fn()} onDone={vi.fn()} />); });
  const sel = el.querySelector('select') as HTMLSelectElement;
  const pick = (v: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(sel, v); sel.dispatchEvent(new Event('change', { bubbles: true })); });
  const issue = () => act(async () => { (el.querySelector('[data-testid="button-issue-replacement-7"]') as HTMLElement).click(); });
  return { el, pick, issue, onMessage };
};

it('lists only unassigned captured UIDs and issues them via the inventory endpoint with confirm', async () => {
  const { el, pick, issue, onMessage } = await setup();
  expect(el.textContent).toContain('CAP1 (captured)');
  expect(el.textContent).not.toContain('TAKEN');
  await pick('CAP1'); await issue();
  expect(h.customFetch).toHaveBeenCalledWith('/api/platform/uid-inventory/replacements/7/issue', expect.objectContaining({ method: 'POST', body: JSON.stringify({ uid: 'CAP1', confirm: true }) }));
  expect(h.legacy).not.toHaveBeenCalled();
  expect(onMessage).toHaveBeenCalledWith('Replacement card issued.');
});

it('prepared UID uses the legacy hook, not the inventory endpoint', async () => {
  const { pick, issue } = await setup();
  await pick('PREP1'); await issue();
  expect(h.legacy).toHaveBeenCalledWith({ requestId: 7, data: { uid: 'PREP1' } });
  expect(h.customFetch).not.toHaveBeenCalled();
});

it('issue stays disabled with no selection, and the paid gate blocks unpaid or non-owner requests', async () => {
  const { el } = await setup();
  expect((el.querySelector('[data-testid="button-issue-replacement-7"]') as HTMLButtonElement).disabled).toBe(true);
  const owner = { owner: true, roles: [] };
  expect(canIssueRequest({ status: 'REQUESTED', paymentStatus: 'UNPAID' }, owner)).toBe(false);
  expect(canIssueRequest({ status: 'REQUESTED', paymentStatus: 'PAID' }, { owner: false, roles: ['SCHOOL_ADMIN'] })).toBe(false);
  expect(canIssueRequest({ status: 'REQUESTED', paymentStatus: 'PAID' }, owner)).toBe(true);
});
