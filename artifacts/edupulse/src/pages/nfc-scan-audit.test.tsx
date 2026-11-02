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
const schoolData = { schools: [{ id: 2, name: 'Ikeja Grammar', code: 'IKG' }, { id: 8, name: 'Abuja College', code: 'ABJ' }] };
const deviceData = [
  { id: 4, name: 'Main Gate', serialNumber: 'NFC-004', schoolId: 2, schoolName: 'Ikeja Grammar' },
  { id: 5, name: 'Library Reader', serialNumber: 'NFC-005', schoolId: 2, schoolName: 'Ikeja Grammar' },
  { id: 9, name: 'North Gate', serialNumber: 'NFC-009', schoolId: 8, schoolName: 'Abuja College' },
  { id: 12, name: 'Owner Desk', serialNumber: 'OWN-012', schoolId: null },
];
const auditData = { readers: [], inventory: [], rows: [row(1), row(2, { registration: 'REGISTERED' }), row(3, { uid: 'zz' })], scanTotal: 73, total: 120, page: 1, pageSize: 50 };
const respond = (url: string) => url.includes('/schools/directory') ? schoolData : url.endsWith('/platform/devices') ? deviceData : auditData;
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  request.mockReset();
  request.mockImplementation(async (url: string) => respond(url));
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); vi.unstubAllGlobals(); });
const settle = async () => { await act(async () => { await new Promise(r => setTimeout(r, 25)); }); };
const mount = async () => { await act(async () => root.render(<QueryClientProvider client={client}><NfcScanAuditPage /></QueryClientProvider>)); await settle(); };
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const lastUrl = () => String(request.mock.calls.filter(call => String(call[0]).includes('view=scans')).at(-1)![0]);
const change = async (id: string, value: string) => {
  const el = q(id) as HTMLInputElement | HTMLSelectElement;
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); });
  await settle();
};
const openSelect = async (label: 'School' | 'Device') => {
  await act(async () => q(`select-audit-${label.toLowerCase()}`)!.click()); await settle();
};
const chooseOption = async (text: string) => {
  const item = [...document.querySelectorAll<HTMLElement>('[cmdk-item]')].find(item => item.textContent?.includes(text));
  expect(item, `Missing option ${text}`).toBeDefined();
  await act(async () => item!.click()); await settle();
};
const select = async (label: 'School' | 'Device', text: string) => { await openSelect(label); await chooseOption(text); };
const searchOptions = async (value: string) => {
  const input = document.querySelector<HTMLInputElement>('[cmdk-input]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }); await settle();
};
const visibleOptions = () => [...document.querySelectorAll('[cmdk-item]')].map(item => item.textContent).join(' ');

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

it('loads real authorized directories and offers named schools and all devices including Owner hardware', async () => {
  await mount();
  expect(request.mock.calls.map(call => call[0])).toContain('/api/platform/schools/directory?status=all');
  expect(request.mock.calls.map(call => call[0])).toContain('/api/platform/devices');
  await openSelect('School');
  expect(visibleOptions()).toContain('All schools');
  expect(visibleOptions()).toContain('Ikeja Grammar · IKG (#2)');
  expect(visibleOptions()).toContain('Abuja College · ABJ (#8)');
  await chooseOption('All schools');
  await openSelect('Device');
  expect(visibleOptions()).toContain('All devices');
  expect(visibleOptions()).toContain('Main Gate (#4) · NFC-004');
  expect(visibleOptions()).toContain('Owner Desk (#12)');
});

it('searches names, codes, IDs and serials within dropdowns without changing the audit until selection', async () => {
  await mount();
  const before = lastUrl();
  await openSelect('School'); await searchOptions('ABJ');
  expect(visibleOptions()).toContain('Abuja College');
  expect(visibleOptions()).not.toContain('Ikeja Grammar');
  expect(lastUrl()).toBe(before);
  await chooseOption('Abuja College');
  expect(lastUrl()).toContain('schoolId=8');
  await select('School', 'All schools');
  await openSelect('Device'); await searchOptions('NFC-005');
  expect(visibleOptions()).toContain('Library Reader');
  expect(visibleOptions()).not.toContain('Main Gate');
  await chooseOption('Library Reader');
  expect(lastUrl()).toContain('deviceId=5');
});

it('limits devices to the chosen school while retaining All devices', async () => {
  await mount(); await select('School', 'Ikeja Grammar');
  await openSelect('Device');
  expect(visibleOptions()).toContain('All devices');
  expect(visibleOptions()).toContain('Main Gate');
  expect(visibleOptions()).toContain('Library Reader');
  expect(visibleOptions()).not.toContain('North Gate');
  expect(visibleOptions()).not.toContain('Owner Desk');
  await chooseOption('All devices');
  expect(lastUrl()).toContain('schoolId=2');
  expect(lastUrl()).not.toContain('deviceId=');
});

it('atomically clears an incompatible device on school change and resets pagination', async () => {
  await mount(); await select('Device', 'North Gate');
  await act(async () => q('button-audit-next')!.click()); await settle();
  expect(lastUrl()).toContain('page=2');
  const start = request.mock.calls.length;
  await select('School', 'Ikeja Grammar');
  expect(lastUrl()).toContain('page=1');
  expect(lastUrl()).toContain('schoolId=2');
  expect(lastUrl()).not.toContain('deviceId=');
  expect(q('select-audit-device')!.textContent).toContain('All devices');
  expect(request.mock.calls.slice(start).some(call => String(call[0]).includes('schoolId=2') && String(call[0]).includes('deviceId=9'))).toBe(false);
});

it('preserves a compatible device and restores the full list under All schools', async () => {
  await mount(); await select('Device', 'Main Gate');
  await select('School', 'Ikeja Grammar');
  expect(lastUrl()).toContain('deviceId=4');
  await select('School', 'All schools');
  expect(lastUrl()).not.toContain('schoolId=');
  expect(lastUrl()).toContain('deviceId=4');
  await openSelect('Device');
  expect(visibleOptions()).toContain('North Gate');
  expect(visibleOptions()).toContain('Owner Desk');
});

it('clears school/device selections, search and dates with the existing reset', async () => {
  await mount(); await select('School', 'Ikeja Grammar'); await select('Device', 'Main Gate');
  await change('input-audit-q', 'AABB');
  await change('input-audit-from', '2026-11-01T09:00');
  await act(async () => q('button-clear-filters')!.click()); await settle();
  expect(lastUrl()).not.toMatch(/schoolId=|deviceId=|q=|from=/);
  expect(lastUrl()).toContain('page=1');
  expect(q('select-audit-school')!.textContent).toContain('All schools');
  expect(q('select-audit-device')!.textContent).toContain('All devices');
  expect((q('input-audit-q') as HTMLInputElement).value).toBe('');
});

it('uses selected IDs for CSV export without changing UID search or date input controls', async () => {
  await mount(); await select('School', 'Ikeja Grammar'); await select('Device', 'Library Reader');
  expect((q('input-audit-q') as HTMLInputElement).type).toBe('text');
  expect((q('input-audit-from') as HTMLInputElement).type).toBe('datetime-local');
  expect((q('input-audit-to') as HTMLInputElement).type).toBe('datetime-local');
  request.mockResolvedValueOnce('uid');
  vi.stubGlobal('URL', class extends URL { static createObjectURL() { return 'blob:test'; } static revokeObjectURL() {} });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  await act(async () => q('button-export-csv')!.click()); await settle();
  expect(lastUrl()).toContain('format=CSV');
  expect(lastUrl()).toContain('schoolId=2');
  expect(lastUrl()).toContain('deviceId=5');
  click.mockRestore();
});

it('shows directory failures with retry while preserving the independent audit', async () => {
  request.mockImplementation(async (url: string) => {
    if(url.includes('/schools/directory')) throw new Error('directory unavailable');
    return respond(url);
  });
  await mount();
  expect(container.textContent).toContain('Could not load schools');
  expect(q('stat-scan-total')!.textContent).toContain('73');
  request.mockImplementation(async (url: string) => respond(url));
  const retry = [...container.querySelectorAll('button')].find(button => button.textContent === 'Retry schools')!;
  await act(async () => retry.click()); await settle();
  await openSelect('School');
  expect(visibleOptions()).toContain('Ikeja Grammar');
});

it('supports keyboard selection and returns focus to the dropdown trigger', async () => {
  await mount(); await openSelect('Device'); await searchOptions('NFC-005');
  const input = document.querySelector<HTMLInputElement>('[cmdk-input]')!;
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  });
  await act(async () => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }); await settle();
  expect(lastUrl()).toContain('deviceId=5');
  expect(q('select-audit-device')!.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(q('select-audit-device'));
});

it('disables pending directory controls without blocking the scan audit', async () => {
  request.mockImplementation(async (url: string) => url.includes('/schools/directory') ? new Promise(() => {}) : respond(url));
  await mount();
  expect((q('select-audit-school') as HTMLButtonElement).disabled).toBe(true);
  expect(q('select-audit-school')!.textContent).toContain('Loading schools');
  expect(q('stat-scan-total')!.textContent).toContain('73');
  expect((q('select-audit-device') as HTMLButtonElement).disabled).toBe(false);
});
