// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const request = vi.hoisted(() => vi.fn());
vi.mock('@workspace/api-client-react', () => ({
  customFetch: (...args: unknown[]) => request(...args), getListPlatformDevicesQueryKey: () => ['devices'],
}));
import { OwnerReaderProvisioning } from './owner-reader-provisioning';
let root: Root, el: HTMLDivElement, client: QueryClient;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  request.mockReset();
  el = document.createElement('div'); document.body.append(el); root = createRoot(el);
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); el.remove(); });
async function mount(rotate = true) {
  await act(async () => root.render(<QueryClientProvider client={client}>
    <OwnerReaderProvisioning device={{ id: 7, name: 'Desk terminal' }} credentialVersion={rotate ? '1234567890abcdef' : undefined} onCancel={vi.fn()} onDone={vi.fn()} />
  </QueryClientProvider>));
  await act(async () => {
    const reason = el.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(reason, 'Repair Owner terminal authentication');
    reason.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () => { (el.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); });
  await act(async () => { (el.querySelector('button[type="submit"]') as HTMLButtonElement).click(); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
}
const response = { deviceId: 7, credential: 'fixture-only.secret', credentialVersion: 'new-version',
  configuration: { endpointPath: '/api/v1/owner-reader/uid-events', deviceId: 'EDUCORE07', method: 'POST',
    authenticationHeader: 'Authorization', authenticationScheme: 'Bearer', heartbeatIntervalSeconds: 30 } };
it('requires explicit confirmation and rotates the exact device with its optimistic version', async () => {
  request.mockResolvedValue(response); await mount();
  expect((el.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
  await submit();
  expect(request).toHaveBeenCalledWith('/api/platform/devices/7/owner-reader/credential', expect.objectContaining({
    method: 'POST', body: JSON.stringify({ reason: 'Repair Owner terminal authentication', confirm: true, expectedCredentialVersion: '1234567890abcdef' }),
  }));
  expect(el.textContent).toContain('EDUCORE07');
  expect(el.textContent).toContain('/api/v1/owner-reader/uid-events');
  expect(el.textContent).toContain('Authorization: Bearer');
  expect((el.querySelector('[aria-label="One-time owner reader credential"]') as HTMLInputElement).value).toBe(response.credential);
  expect(el.textContent).toContain('old Owner key');
});
it('first binding uses the separate Owner provision endpoint and never a school credential route', async () => {
  request.mockResolvedValue(response); await mount(false); await submit();
  expect(request.mock.lastCall![0]).toBe('/api/platform/devices/7/owner-reader');
});
it('blocks automatic retries after an uncertain one-time credential response', async () => {
  request.mockRejectedValue(new Error('Response lost'));
  await mount(); await submit();
  expect(request).toHaveBeenCalledTimes(1);
  expect(el.textContent).toContain('response was lost');
  expect((el.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { el.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(request).toHaveBeenCalledTimes(1);
});
