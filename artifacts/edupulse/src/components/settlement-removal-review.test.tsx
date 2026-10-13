// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  companyReview: vi.fn(), schoolReview: vi.fn(), companyRemove: vi.fn(), schoolRemove: vi.fn(),
}));
vi.mock('@workspace/api-client-react', () => ({
  reviewCompanySettlementRemoval: api.companyReview,
  reviewSchoolSettlementRemoval: api.schoolReview,
  removeCompanyPendingSettlement: api.companyRemove,
  removeSchoolPendingSettlement: api.schoolRemove,
}));
vi.mock('./shared', () => ({
  Button: (p: any) => <button disabled={p.disabled} onClick={p.onClick} data-testid={p.testId}>{p.children}</button>,
  Info: (p: any) => <div>{p.label}: {p.value}</div>,
  Modal: (p: any) => <div role="dialog"><h2>{p.title}</h2>{p.children}<button onClick={p.onClose}>Close</button></div>,
  ErrorState: (p: any) => <div>{p.message}</div>,
}));
vi.mock('@/pages/payroll-common', () => ({
  entry: '', errMsg: (e: any) => e.message,
  Notice: (p: any) => <div>{p.children}</div>,
}));
import { SettlementRemovalReviewControl } from './settlement-removal-review';

const version = '2026-10-13T12:00:00.123456Z';
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let qc: QueryClient;
const review = () => ({
  developmentOnly: true, scope: 'YEMAIT_COMPANY', schoolId: null,
  profileId: 11, businessName: 'Synthetic Company', version,
  status: 'PENDING_VERIFICATION', eligible: true, notice: 'Audit and payment history retained.',
});
async function open(schoolId?: number) {
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={qc}><SettlementRemovalReviewControl schoolId={schoolId} /></QueryClientProvider>));
  await act(async () => (container.querySelector('[data-testid="button-review-pending-removal"]') as HTMLButtonElement).click());
  await act(async () => { await new Promise(r => setTimeout(r, 20)); });
}
async function type(text: string) {
  const input = container.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubEnv('DEV', true);
  api.companyReview.mockResolvedValue(review());
  api.schoolReview.mockResolvedValue({ ...review(), profileId: 12, scope: 'SCHOOL', schoolId: 7 });
  api.companyRemove.mockResolvedValue({ profileId: 11, status: 'NOT_CONFIGURED', removed: true });
  api.schoolRemove.mockResolvedValue({ profileId: 12, status: 'NOT_CONFIGURED', removed: true });
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  qc?.clear(); container?.remove();
  vi.clearAllMocks(); vi.unstubAllEnvs();
});

describe('Separate settlement removal review and authorization', () => {
  it('opens a metadata review without removing anything and permits cancellation', async () => {
    await open();
    expect(container.textContent).toContain('Profile ID: 11');
    expect(container.textContent).toContain(version);
    expect(api.companyRemove).not.toHaveBeenCalled();
    expect((container.querySelector('[data-testid="button-remove-pending-profile"]') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Cancel — keep profile')!.click());
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(api.companyRemove).not.toHaveBeenCalled();
  });
  it('requires the exact typed ID and sends the reviewed microsecond version', async () => {
    await open();
    await type('REMOVE PROFILE 12');
    const control = container.querySelector('[data-testid="button-remove-pending-profile"]') as HTMLButtonElement;
    expect(control.disabled).toBe(true);
    await type('REMOVE PROFILE 11');
    expect(control.disabled).toBe(false);
    await act(async () => control.click());
    expect(api.companyRemove).toHaveBeenCalledWith({ expectedProfileId: 11, expectedVersion: version, confirmation: 'REMOVE PROFILE 11' });
    expect(container.textContent).toContain('Audit and payment history retained');
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
  it('uses only the school-scoped API for a school review/removal', async () => {
    await open(7);
    expect(api.schoolReview).toHaveBeenCalledWith(7);
    expect(api.companyReview).not.toHaveBeenCalled();
    await type('REMOVE PROFILE 12');
    await act(async () => (container.querySelector('[data-testid="button-remove-pending-profile"]') as HTMLButtonElement).click());
    expect(api.schoolRemove).toHaveBeenCalledWith(7, { expectedProfileId: 12, expectedVersion: version, confirmation: 'REMOVE PROFILE 12' });
    expect(api.companyRemove).not.toHaveBeenCalled();
  });
  it('never enables removal of an ineligible profile', async () => {
    api.companyReview.mockResolvedValue({ ...review(), eligible: false, status: 'VERIFIED' });
    await open();
    expect(container.querySelector('input')).toBeNull();
    expect((container.querySelector('[data-testid="button-remove-pending-profile"]') as HTMLButtonElement).disabled).toBe(true);
    expect(api.companyRemove).not.toHaveBeenCalled();
  });
  it('clears confirmation when a refreshed version changes', async () => {
    await open();
    await type('REMOVE PROFILE 11');
    api.companyReview.mockResolvedValue({ ...review(), version: '2026-10-13T12:01:00.123456Z' });
    await act(async () => { await qc.invalidateQueries({ queryKey: ['settlement-removal-review'] }); });
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('');
    expect((container.querySelector('[data-testid="button-remove-pending-profile"]') as HTMLButtonElement).disabled).toBe(true);
  });
});
