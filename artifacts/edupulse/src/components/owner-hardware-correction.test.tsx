// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const request = vi.hoisted(() => vi.fn());
vi.mock('@workspace/api-client-react', async importOriginal => ({
  ...await importOriginal<any>(), customFetch: request,
}));
import { OwnerHardwareCorrection } from './owner-hardware-correction';

const before = [
  { deviceId: 3, serialNumber: 'DEVICE-1000', status: 'ACTIVE' },
  { deviceId: 4, serialNumber: 'YET-584E10FFC9EC', status: 'ACTIVE' },
];
const after = [
  { deviceId: 3, serialNumber: 'YET-584E10FFC9EC', status: 'ACTIVE' },
  { deviceId: 4, serialNumber: '', status: 'INACTIVE' },
];
let el: HTMLDivElement, root: Root, qc: QueryClient;
beforeEach(async () => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  request.mockReset();
  request.mockImplementation((_path, options) => options?.method === 'POST'
    ? Promise.resolve({ after, auditId: 21, auditedAt: '2026-11-02T14:00:00Z', credentialPreserved: true })
    : Promise.resolve({ before, after, fingerprint: 'a'.repeat(64) }));
  el = document.createElement('div'); document.body.append(el); root = createRoot(el);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => { root.render(<QueryClientProvider client={qc}><OwnerHardwareCorrection /></QueryClientProvider>); });
});
afterEach(async () => { await act(async () => root.unmount()); qc.clear(); el.remove(); });
async function review() {
  await act(async () => { (el.querySelector('button') as HTMLButtonElement).click(); });
  await act(async () => { await new Promise(r => setTimeout(r, 30)); });
}
async function confirm() {
  await act(async () => {
    const textarea = document.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Approved two-record correction');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click();
  });
  await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  await act(async () => { await new Promise(r => setTimeout(r, 30)); });
}
describe('Owner hardware identity correction', () => {
  it('does not request a review or mutate on mount', () => { expect(request).not.toHaveBeenCalled(); });
  it('reviews exact mapping, requires confirmation, and shows committed audit evidence', async () => {
    await review();
    expect(document.body.textContent).toContain('DEVICE-1000');
    expect(document.body.textContent).toContain('YET-584E10FFC9EC');
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    await confirm();
    expect(request).toHaveBeenCalledWith('/api/platform/devices/owner-hardware-correction', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ fingerprint: 'a'.repeat(64), reason: 'Approved two-record correction', confirm: true }),
    }));
    expect(document.body.textContent).toContain('Audit #21');
    expect(document.body.textContent).toContain('Device 3 credential preserved');
    expect(document.body.textContent).toContain('INACTIVE');
  });
  it('blocks mutation if preflight is unsafe or the route unavailable', async () => {
    request.mockRejectedValue(Error('Preflight blocked')); await review();
    expect(document.body.textContent).toContain('blocked or unavailable');
    expect(document.querySelector('form')).toBeNull();
    expect(request.mock.calls.every(([, options]) => options?.method !== 'POST')).toBe(true);
  });
  it('does not automatically retry an uncertain write', async () => {
    await review();
    request.mockRejectedValue(Error('Response lost')); await confirm();
    expect(document.body.textContent).toContain('Do not resubmit');
    expect(request.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
    expect(document.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  });
});
