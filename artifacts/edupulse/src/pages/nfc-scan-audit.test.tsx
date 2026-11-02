// @vitest-environment jsdom
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const request = vi.hoisted(() => vi.fn());
vi.mock('@workspace/api-client-react', () => ({ customFetch: (...args: unknown[]) => request(...args) }));
vi.mock('@/components/uid-actions', () => ({
  AssignUidModal: ({ uid }: { uid: string }) => <div role="dialog" data-testid="assign-modal">Assign {uid}</div>,
  backendError: (e: any) => e?.message ?? 'failed',
}));
import { NfcScanAuditPage } from './nfc-scan-audit';

let root: Root, container: HTMLDivElement, client: QueryClient;
const row = (id: number, extra: Record<string, unknown> = {}) => ({ id, deviceId: 4, deviceName: 'Gate A', schoolId: 2, schoolName: 'Ikeja Grammar',
  source: 'SCHOOL', kind: 'SCAN', uid: '04A1B2C3D4E5F6', occurredAt: null, receivedAt: '2026-11-02T08:00:00Z', eventId: 'e1',
  registration: 'UNREGISTERED', registeredAtScan: false, outcome: 'CARD_INELIGIBLE', reason: null, ...extra });
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  request.mockReset();
  request.mockResolvedValue({ readers: [], inventory: [], rows: [row(1), row(2, { registration: 'REGISTERED' }), row(3, { uid: 'zz' })], scanTotal: 73, total: 120, page: 1, pageSize: 50 });
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); });
const settle = async () => { await act(async () => { await new Promise(r => setTimeout(r, 25)); }); };
const mount = async () => { await act(async () => root.render(<QueryClientProvider client={client}><NfcScanAuditPage /></QueryClientProvider>)); await settle(); };
const q = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const lastUrl = () => String(request.mock.calls.at(-1)![0]);
const change = async (id: string, value: string) => {
  const el = q(id) as HTMLInputElement | HTMLSelectElement;
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
  await settle();
};

it('defaults to SCAN kind with scans view and page size 50', async () => {
  await mount();
  expect(lastUrl()).toContain('view=scans');
  expect(lastUrl()).toContain('kind=SCAN');
  expect(lastUrl()).toContain('pageSize=50');
  expect(q('stat-scan-total')!.textContent).toContain('73');
  expect(q('text-audit-page')!.textContent).toBe('Page 1 of 3');
});

it('applies filters and resets to page 1', async () => {
  await mount();
  await act(async () => q('button-audit-next')!.click()); await settle();
  expect(lastUrl()).toContain('page=2');
  await change('select-audit-registration', 'UNREGISTERED');
  await change('select-audit-source', 'OWNER');
  await change('input-audit-q', '04A1');
  expect(lastUrl()).toContain('page=1');
  expect(lastUrl()).toContain('registration=UNREGISTERED');
  expect(lastUrl()).toContain('source=OWNER');
  expect(lastUrl()).toContain('q=04A1');
  await change('select-audit-kind', 'HEARTBEAT');
  expect(lastUrl()).toContain('kind=HEARTBEAT');
});

it('offers Add to Registration only for valid unregistered UIDs and prefills the modal', async () => {
  await mount();
  expect(q('button-add-registration-1')).not.toBeNull();
  expect(q('button-add-registration-2')).toBeNull();
  expect(q('button-add-registration-3')).toBeNull();
  await act(async () => q('button-add-registration-1')!.click());
  expect(q('assign-modal')!.textContent).toBe('Assign 04A1B2C3D4E5F6');
});

it('surfaces export cap errors', async () => {
  await mount();
  request.mockRejectedValueOnce(Object.assign(new Error('cap'), { status: 409 }));
  await act(async () => q('button-export-csv')!.click()); await settle();
  expect(String(request.mock.calls.at(-1)![0])).toContain('format=CSV');
  expect(request.mock.calls.at(-1)![1]).toEqual({ responseType: 'text' });
  expect(q('text-export-error')!.textContent).toContain('5,000');
});

it('shows error state with retry', async () => {
  request.mockRejectedValue(new Error('down'));
  await mount();
  expect(q('text-audit-error')!.textContent).toContain('down');
  expect(q('button-retry-audit')).not.toBeNull();
});

it('is routed Owner-only and listed in Owner navigation', () => {
  const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  expect(app).toMatch(/<Route path="\/nfc-scan-audit">\s*<RoleGuard isPlatformOwnerOnly><NfcScanAuditPage \/><\/RoleGuard>/);
  const shared = readFileSync(resolve(process.cwd(), 'src/components/shared.tsx'), 'utf8');
  expect(shared).toContain("{ href: '/nfc-scan-audit', label: 'NFC Card Scan Audit', icon: CreditCard, roles: ['PLATFORM_OWNER'] }");
});
