// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const request = vi.hoisted(() => vi.fn());
vi.mock('@workspace/api-client-react', () => ({
  customFetch: (...args: unknown[]) => request(...args), getListPlatformDevicesQueryKey: () => ['devices'],
  useUpdatePlatformDevice: vi.fn(),
}));
vi.mock('@/components/uid-actions', () => ({ AssignUidModal: ({ uid }: { uid: string }) => <div role="dialog">Confirm registration for {uid}</div> }));
import { CardUidInventoryPage } from './card-uid-inventory';

let root: Root, container: HTMLDivElement, client: QueryClient;
const sample = { uid: 'AABBCCDD', rawUid: 'aabbccdd', readerDeviceId: 7, deviceName: 'Owner desk',
  serialNumber: 'DESK-7', capturedAt: '2026-11-02T08:01:00Z', firstSeenAt: '2026-11-02T08:00:00Z',
  lastSeenAt: '2026-11-02T08:01:00Z', assigned: false, schoolId: null, studentId: null, status: null,
  duplicate: true, scanCount: 2, captureStatus: 'UNKNOWN_UNASSIGNED' };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  request.mockReset();
  request.mockResolvedValue({ readers: [], inventory: [sample], total: 51, page: 1, pageSize: 50 });
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(async () => {
  await act(async () => root.unmount()); client.clear(); container.remove();
});
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); }); };
const mount = async () => {
  await act(async () => root.render(<QueryClientProvider client={client}><CardUidInventoryPage /></QueryClientProvider>));
  await settle();
};
const click = async (text: string) => {
  const button = [...container.querySelectorAll('button')].find(b => b.textContent === text)!;
  await act(async () => button.click()); await settle();
};
const change = async (label: string, value: string, select = false) => {
  const input = container.querySelector(`[aria-label="${label}"]`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(select ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event(select ? 'change' : 'input', { bubbles: true }));
  });
  await settle();
};
it('shows a dedicated inventory with raw UID, duplicate, source and receipt timestamps', async () => {
  await mount();
  expect(container.textContent).toContain('Card UID Inventory');
  expect(container.textContent).toContain('aabbccdd');
  expect(container.textContent).toContain('Unknown / unassigned');
  expect(container.textContent).toContain('Duplicate UID');
  expect(container.textContent).toContain('Owner desk');
  expect(container.textContent).toContain('DESK-7');
  expect(container.textContent).toContain(new Date(sample.firstSeenAt).toLocaleString('en-NG'));
  expect(container.textContent).toContain(new Date(sample.lastSeenAt).toLocaleString('en-NG'));
  expect(container.querySelector('a[href="/devices"]')).toBeTruthy();
});
it('searches, filters and paginates using the real inventory query contract', async () => {
  await mount();
  await click('Next');
  expect(request.mock.lastCall![0]).toContain('page=2');
  await change('Search UID or reader', 'aabb');
  expect(request.mock.lastCall![0]).toContain('q=aabb');
  expect(request.mock.lastCall![0]).toContain('page=1');
  await change('Capture status', 'DUPLICATE', true);
  expect(request.mock.lastCall![0]).toContain('status=DUPLICATE');
  await change('Seen on device ID', '7');
  expect(request.mock.lastCall![0]).toContain('deviceId=7');
  expect(request.mock.lastCall![0]).toContain('pageSize=50');
});
it('keeps an explicit inventory visible with guidance before any UID is captured', async () => {
  request.mockResolvedValue({ readers: [], inventory: [], total: 0 });
  await mount();
  expect(container.textContent).toContain('Card UID Inventory');
  expect(container.textContent).toContain('No UIDs captured yet');
  expect(container.textContent).toContain('does not need a student connection');
  expect(container.textContent).toContain('Configure');
});
it('reports a fetch failure with retry without inventing card results', async () => {
  request.mockRejectedValue(new Error('Transport unavailable'));
  await mount();
  expect(container.textContent).toContain('Inventory delivery failed');
  expect(container.textContent).not.toContain('aabbccdd');
  expect(container.textContent).toContain('Retry inventory');
});
it('copies a raw UID and only opens the explicit confirmation workflow on registration', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  await mount(); await click('Copy UID');
  expect(writeText).toHaveBeenCalledWith('aabbccdd');
  expect(container.textContent).toContain('UID copied');
  await click('Add to Registration');
  expect(container.querySelector('[role="dialog"]')?.textContent).toContain('AABBCCDD');
  expect(request.mock.calls.every(([path]) => String(path).startsWith('/api/platform/uid-inventory?'))).toBe(true);
});
