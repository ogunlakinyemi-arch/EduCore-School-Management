// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ verify: vi.fn(), list: vi.fn(), detail: vi.fn() }));
vi.mock('@workspace/api-client-react', async original => ({
  ...await original<typeof import('@workspace/api-client-react')>(),
  verifyPlatformSchoolSettlement: f.verify,
}));
vi.mock('@/components/shared', () => ({
  Button: ({ testId, variant: _variant, ...props }: any) => <button data-testid={testId} {...props} />,
}));
vi.mock('@/pages/payroll-common', () => ({
  errMsg: (error: unknown) => error instanceof Error ? error.message : 'The request could not be completed. Please try again.',
}));
import {
  getListPlatformSchoolSettlementsQueryKey, getGetPlatformSchoolSettlementQueryKey,
  type SchoolSettlementSummary,
} from '@workspace/api-client-react';
import { DevelopmentBankVerification } from './development-bank-verification';

const fixtures = () => [7, 8].map(schoolId => ({
  schoolId, schoolName: `Fictional school ${schoolId}`, status: 'PENDING_VERIFICATION',
  capability: { mode: 'TEST', collection: { bankAccountVerificationConfigured: true } },
} as SchoolSettlementSummary));
let rows: SchoolSettlementSummary[];
let root: ReturnType<typeof createRoot>, host: HTMLDivElement, client: QueryClient;
const node = <T extends HTMLElement = HTMLElement>(id: string) => host.querySelector<T>(`[data-testid="${id}"]`)!;
const control = (id = 7) => node<HTMLButtonElement>(`button-verify-${id}`);
const result = (id = 7) => node(`bank-verification-result-${id}`);
const deferred = () => {
  let resolve!: (value: any) => void, reject!: (error: unknown) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); }); }
async function click(id = 7) { await act(async () => control(id).click()); await flush(); }
function Harness() {
  const list = useQuery({ queryKey: getListPlatformSchoolSettlementsQueryKey({ status: 'all', limit: 100 }), queryFn: f.list });
  useQuery({ queryKey: getGetPlatformSchoolSettlementQueryKey(7), queryFn: f.detail });
  return <>{list.data?.map((school: SchoolSettlementSummary) => <div key={school.schoolId} data-testid={`row-${school.schoolId}`}>
    <span data-testid={`saved-${school.schoolId}`}>{school.status}</span>
    <DevelopmentBankVerification school={school} onStart={() => {}} />
  </div>)}</>;
}
async function open() {
  await act(async () => root.render(<QueryClientProvider client={client}><Harness /></QueryClientProvider>));
  await flush();
}
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  rows = fixtures();
  f.verify.mockReset(); f.list.mockReset().mockImplementation(async () => rows);
  f.detail.mockReset().mockResolvedValue({ status: 'PENDING_VERIFICATION' });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  // All verification and refresh requests are mocked. Any network escape fails.
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No external requests allowed'); }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); client.clear(); host.remove();
  expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
describe('Development row-local bank verification (mock API, real React Query)', () => {
  it('shows progress, blocks rapid duplicate clicks only in the selected row, and refreshes before displaying success', async () => {
    const pending = deferred(); f.verify.mockReturnValue(pending.promise);
    await open();
    await act(async () => { control().click(); control().click(); });
    expect(f.verify).toHaveBeenCalledTimes(1);
    expect(control().disabled).toBe(true); expect(control(8).disabled).toBe(false);
    expect(control().textContent).toContain('Verifying bank details');
    expect(result().getAttribute('role')).toBe('status');
    expect(result().textContent).toContain('Even TEST');
    expect(f.verify).toHaveBeenCalledWith(7, { headers: { 'Idempotency-Key': expect.stringMatching(/^[a-f0-9-]{36}$/) } });
    rows = rows.map(s => s.schoolId === 7 ? { ...s, status: 'VERIFIED' } : s);
    await act(async () => pending.resolve({ schoolId: 7, status: 'VERIFIED' })); await flush();
    expect(node('saved-7').textContent).toBe('VERIFIED');
    expect(result().textContent).toContain('Server confirmed');
    expect(result().textContent).toContain('settlement are not verified');
    expect(f.list).toHaveBeenCalledTimes(2); expect(f.detail).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(result());
  });
  it('keeps overlapping rows independent and releases each action after its own failure/success', async () => {
    const a = deferred(), b = deferred();
    f.verify.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    await open(); await click(); await click(8);
    await act(async () => b.resolve({ schoolId: 8, status: 'VERIFIED' })); await flush();
    expect(control().disabled).toBe(true); expect(control(8).disabled).toBe(false);
    await act(async () => a.reject(Object.assign(new Error('Provider unavailable'), { status: 503 }))); await flush();
    expect(control().disabled).toBe(false);
    expect(result().textContent).toContain('HTTP 503');
    expect(result(8).textContent).toContain('Server confirmed');
    expect(f.verify).toHaveBeenCalledTimes(2);
  });
  it('shows a safe mismatch reason and refreshes a persisted ACTION_REQUIRED even on HTTP 409', async () => {
    f.verify.mockImplementation(async () => {
      rows = rows.map(s => s.schoolId === 7 ? { ...s, status: 'ACTION_REQUIRED' } : s);
      throw Object.assign(new Error('The name returned by Flutterwave does not match the configured account holder; no settlement recipient was verified'), { status: 409 });
    });
    await open(); await click();
    expect(node('saved-7').textContent).toBe('ACTION_REQUIRED');
    expect(result().getAttribute('role')).toBe('alert');
    expect(result().textContent).toContain('HTTP 409 conflict');
    expect(result().textContent).toContain('does not match');
    expect(result().textContent).toContain('No automatic retry');
    expect(f.verify).toHaveBeenCalledTimes(1);
    expect(f.list).toHaveBeenCalledTimes(2); expect(f.detail).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['BANK_RESOLUTION_PROVIDER_AUTH_REJECTED', 'provider HTTP 401', false],
    ['BANK_RESOLUTION_INVALID_BANK_OR_ACCOUNT', 'provider HTTP 400', true],
    ['BANK_RESOLUTION_PROVIDER_RATE_LIMITED', 'provider HTTP 429', false],
    ['BANK_RESOLUTION_PROVIDER_OUTAGE', 'provider HTTP 502', false],
    ['BANK_RESOLUTION_PROVIDER_TIMEOUT', 'no provider HTTP status', false],
  ])('shows the safe server diagnostic code %s once, without retrying', async (code, detail, fictionalHint) => {
    f.verify.mockRejectedValue(Object.assign(new Error(`HTTP 503: Flutterwave did not confirm (${detail}). The bank details remain unverified.`), {
      status: 503, data: { error: 'safe', code },
    }));
    await open(); await click();
    expect(result().getAttribute('role')).toBe('alert');
    expect(result().textContent).toContain('HTTP 503');
    expect(result().textContent).toContain(detail);
    expect(result().textContent).toContain(`Diagnostic code: ${code}.`);
    expect(result().textContent?.includes('Fictional or test bank details')).toBe(fictionalHint);
    expect(node('saved-7').textContent).toBe('PENDING_VERIFICATION');
    expect(f.verify).toHaveBeenCalledTimes(1);
  });
  it('ignores non-allowlisted error codes', async () => {
    f.verify.mockRejectedValue(Object.assign(new Error('Unavailable'), { status: 503, data: { code: 'PAYROLL_PROVIDER_UNAVAILABLE' } }));
    await open(); await click();
    expect(result().textContent).not.toContain('Diagnostic code');
  });
  it('clears an old error immediately when another intentional attempt begins', async () => {
    const pending = deferred();
    f.verify.mockRejectedValueOnce(new Error('Previous unavailable response')).mockReturnValueOnce(pending.promise);
    await open(); await click();
    expect(result().textContent).toContain('Previous unavailable response');
    await click();
    expect(result().textContent).not.toContain('Previous unavailable response');
    expect(result().textContent).toContain('Verifying with the provider');
    await act(async () => pending.reject(new Error('Still unavailable'))); await flush();
  });
  it('explains already-verified profiles without a new provider call', async () => {
    rows[0].status = 'VERIFIED';
    await open(); await click();
    expect(result().textContent).toContain('Already verified in the saved profile');
    expect(result().textContent).toContain('No new provider request');
    expect(f.verify).not.toHaveBeenCalled(); expect(window.confirm).not.toHaveBeenCalled();
  });
  it('explains a stale-state 409 and refreshes without claiming a new verification', async () => {
    f.verify.mockRejectedValue(Object.assign(new Error('Settlement bank details changed during verification; reload and retry explicitly'), { status: 409 }));
    await open(); await click();
    expect(result().textContent).toContain('profile may already be verified');
    expect(result().textContent).not.toContain('Server confirmed');
    expect(f.list).toHaveBeenCalledTimes(2);
  });
  it.each(['PENDING_VERIFICATION', 'ACTION_REQUIRED', undefined])('does not invent success for HTTP 200 with status %s', async status => {
    f.verify.mockResolvedValue({ schoolId: 7, status });
    await open(); await click();
    expect(result().getAttribute('role')).toBe('alert');
    expect(result().textContent).not.toContain('Server confirmed');
    expect(node('saved-7').textContent).toBe('PENDING_VERIFICATION');
  });
  it('warns when refresh fails after a successful verification response, and releases the row', async () => {
    f.verify.mockResolvedValue({ schoolId: 7, status: 'VERIFIED' });
    await open(); f.list.mockRejectedValue(new Error('Refresh unavailable')); await click();
    expect(result().textContent).toContain('latest saved status could not be refreshed');
    expect(control().disabled).toBe(false);
  });
  it('does not submit or refetch when confirmation is cancelled', async () => {
    vi.mocked(window.confirm).mockReturnValue(false);
    await open(); await click();
    expect(f.verify).not.toHaveBeenCalled(); expect(f.list).toHaveBeenCalledTimes(1);
  });
  it('preserves the unconfigured provider guard', async () => {
    rows[0].capability.mode = 'NOT_CONFIGURED';
    rows[0].capability.collection!.bankAccountVerificationConfigured = false;
    await open();
    expect(control().disabled).toBe(true);
    await click();
    expect(f.verify).not.toHaveBeenCalled();
  });
  it('rejects a successful response for another school instead of claiming verification', async () => {
    f.verify.mockResolvedValue({ schoolId: 8, status: 'VERIFIED' });
    await open(); await click();
    expect(result().textContent).toContain('Unexpected server response');
    expect(result().textContent).not.toContain('Server confirmed');
  });
  it('does not steal focus from another school when a request finishes', async () => {
    const pending = deferred(); f.verify.mockReturnValue(pending.promise);
    await open(); await click(); control(8).focus();
    await act(async () => pending.resolve({ schoolId: 7, status: 'VERIFIED' })); await flush();
    expect(document.activeElement).toBe(control(8));
  });
});
