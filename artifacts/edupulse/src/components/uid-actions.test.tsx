// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi, beforeEach } from 'vitest';

const impl = vi.hoisted(() => ({ fn: (async () => ({})) as (...a: any[]) => Promise<any> }));
const customFetch = vi.hoisted(() => vi.fn());
vi.mock('@workspace/api-client-react', () => ({
  customFetch: (...a: any[]) => { customFetch(...a); return impl.fn(...a); },
  useListSchools: () => ({ data: [{ id: 3, name: 'Hillcrest' }], isLoading: false }),
  useListStudents: () => ({ data: [{ id: 9, firstName: 'Ada', lastName: 'Obi', admissionNo: 'A1' }], isLoading: false }),
  getListCardsQueryKey: () => ['cards'], getListStudentsQueryKey: () => ['students'], getListCardReplacementsQueryKey: () => ['repl'],
}));
vi.mock('@/components/owner-uid-reader', () => ({ uidInventoryKey: ['inv'] }));
vi.mock('@/components/shared', () => ({
  Button: (p: any) => <button type={p.type ?? 'button'} disabled={p.disabled} onClick={p.onClick} data-testid={p.testId}>{p.children}</button>,
  Field: (p: any) => <label>{p.label}{p.children}</label>,
  Modal: (p: any) => <div>{p.children}</div>,
}));
import { AssignUidModal, OwnerUnlinkCard } from './uid-actions';

const set = (el: Element, v: string, proto: any) => act(async () => {
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v);
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
});
const click = (el: Element) => act(async () => { (el as HTMLElement).click(); });
const mount = async (ui: React.ReactElement) => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  const el = document.createElement('div'); document.body.appendChild(el);
  await act(async () => { createRoot(el).render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>); });
  return el;
};
beforeEach(() => customFetch.mockReset());

it('assign requires confirmation and posts the contract body', async () => {
  impl.fn = async () => ({});
  const onClose = vi.fn();
  const el = await mount(<AssignUidModal uid="04AABB" onClose={onClose} />);
  const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement;
  expect((q('input-assign-uid') as HTMLInputElement).readOnly).toBe(true);
  await set(q('select-assign-school'), '3', HTMLSelectElement.prototype);
  await set(q('select-assign-student'), '9', HTMLSelectElement.prototype);
  expect((q('button-assign-submit') as HTMLButtonElement).disabled).toBe(true);
  await click(q('checkbox-assign-confirm'));
  await click(q('button-assign-submit'));
  expect(customFetch).toHaveBeenCalledWith('/api/platform/uid-inventory/assign', expect.objectContaining({ body: JSON.stringify({ uid: '04AABB', schoolId: 3, studentId: 9, confirm: true }) }));
  expect(onClose).toHaveBeenCalled();
});

it('assign shows backend error', async () => {
  impl.fn = async () => { await Promise.resolve(); throw Object.assign(new Error('x'), { data: { error: 'UID already assigned' } }); };
  const el = await mount(<AssignUidModal uid="04AABB" onClose={vi.fn()} />);
  const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement;
  await set(q('select-assign-school'), '3', HTMLSelectElement.prototype);
  await set(q('select-assign-student'), '9', HTMLSelectElement.prototype);
  await click(q('checkbox-assign-confirm'));
  await click(q('button-assign-submit'));
  await act(async () => { await new Promise(r => setTimeout(r, 20)); });
  expect(q('text-assign-error').textContent).toBe('UID already assigned');
});

it('unlink needs confirm and reports employee School Admin path', async () => {
  impl.fn = async () => ({ requiresSchoolAdminRequest: true });
  const el = await mount(<OwnerUnlinkCard cards={[{ id: 5, studentName: 'Ada', status: 'ACTIVE', uid: 'U1' }]} />);
  const q = (id: string) => el.querySelector(`[data-testid="${id}"]`) as HTMLElement;
  await set(q('select-unlink-card'), '5', HTMLSelectElement.prototype);
  await set(q('select-unlink-kind'), 'DAMAGED', HTMLSelectElement.prototype);
  await set(q('input-unlink-reason'), 'cracked', HTMLInputElement.prototype);
  expect((q('button-unlink-submit') as HTMLButtonElement).disabled).toBe(true);
  await click(q('checkbox-unlink-confirm'));
  await click(q('button-unlink-submit'));
  expect(customFetch).toHaveBeenCalledWith('/api/platform/uid-inventory/cards/5/unlink', expect.objectContaining({ body: JSON.stringify({ kind: 'DAMAGED', reason: 'cracked', confirm: true }) }));
  expect(q('text-unlink-success').textContent).toContain('School Admin');
});
