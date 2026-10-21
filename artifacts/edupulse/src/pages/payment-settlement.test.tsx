// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  error: false,
  owner: true,
  rows: [
    { schoolId: 7, schoolName: 'Configured school', status: 'PENDING_VERIFICATION', businessName: 'School business', bankName: 'Test bank', accountName: 'Test recipient', accountLast4: '7890', capability: { mode: 'MOCK', bankSubaccountsSupported: false } },
    { schoolId: 8, schoolName: 'Unconfigured school', status: 'NOT_CONFIGURED', capability: { mode: 'MOCK', bankSubaccountsSupported: false } },
  ],
  list: vi.fn(),
  verify: vi.fn(),
}));
vi.mock('@workspace/api-client-react', async importOriginal => {
  const actual = await importOriginal<typeof import('@workspace/api-client-react')>();
  const { useQuery } = await import('@tanstack/react-query');
  const query = (data: unknown) => ({ data, isLoading: false, isError: false, isFetching: false, dataUpdatedAt: 0, refetch: vi.fn() });
  const mutation = () => ({ isPending: false, mutateAsync: vi.fn() });
  return {
    ...actual,
    useGetAuthorizedContext: () => query({ isPlatformOwner: state.owner, roles: [] }),
    verifyPlatformSchoolSettlement: state.verify,
    useGetPlatformPaymentSettlement: () => query({ status: 'NOT_CONFIGURED', capability: { mode: 'MOCK' } }),
    useListPlatformSchoolSettlements: (...args: any[]) => {
      state.list(...args);
      return useQuery({ ...args[1].query, queryFn: async () => {
        if (state.error) throw new Error('Unable to load settlement list');
        return state.rows;
      } });
    },
    useListPlatformSettlementHistory: () => query([]),
    useGetPlatformSchoolSettlement: (id: number) => query(state.rows.find(r => r.schoolId === id)),
    useUpdatePlatformPaymentSettlement: mutation,
    useVerifyPlatformSchoolSettlement: mutation,
  };
});
vi.mock('@/components/shared', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/shared')>(),
  useTenant: () => ({ schoolId: 7 }),
}));
import { PaymentSettlementPage } from './payment-settlement';

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Only mocked settlement requests are allowed'); }));
});
const button = (text: string, within: Element = container) =>
  Array.from(within.querySelectorAll('button')).find(b => b.textContent?.trim() === text)!;
async function open() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root!.render(<QueryClientProvider client={client}><PaymentSettlementPage /></QueryClientProvider>));
  await act(async () => button('School oversight').click());
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  state.error = false;
  state.owner = true;
  state.list.mockClear();
  state.verify.mockReset();
  state.rows[0].capability.mode = 'MOCK';
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Owner school settlement oversight', () => {
  it('sends an explicit per-action idempotency key for bank verification without claiming subaccount or settlement success', async () => {
    state.rows[0].capability.mode = 'TEST';
    state.verify.mockResolvedValue({ schoolId: 7, status: 'VERIFIED' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await open();
    const control = container.querySelector('[data-testid="button-verify-7"]') as HTMLButtonElement;
    expect(control.disabled).toBe(false);
    await act(async () => control.click());
    expect(state.verify).toHaveBeenCalledWith(7, {
      headers: { 'Idempotency-Key': expect.stringMatching(/^[a-f0-9-]{36}$/) },
    });
    expect(container.textContent).toContain('bank account verification status verified');
    expect(container.textContent).toContain('Collection subaccount registration and settlement are not verified');
  });
  it('renders configured and unconfigured schools with masked details and a genuine empty profile', async () => {
    await open();
    expect(state.list).toHaveBeenLastCalledWith(
      { status: 'all', limit: 100 },
      expect.objectContaining({ query: expect.objectContaining({ enabled: true }) }),
    );
    expect(container.textContent).toContain('Configured school');
    expect(container.textContent).toContain('Unconfigured school');
    expect(container.textContent).toContain('****7890');
    expect(container.textContent).not.toContain('1234567890');
    const row = container.querySelector('[data-testid="row-school-settlement-8"]')!;
    expect(row.textContent).toContain('No bank');
    await act(async () => button('Details', row).click());
    expect(document.body.textContent).toContain('School account not configured');
    expect(document.body.textContent).toContain('Bank account details are not available yet');
  });

  it('retains an actual API failure rather than presenting it as a successful empty state', async () => {
    state.error = true;
    await open();
    expect(container.textContent).toMatch(/load this view/);
    expect(container.textContent).not.toContain('No schools match');
    expect(container.querySelector('[data-testid="row-school-settlement-7"]')).toBeNull();
  });
  it('keeps the row-local result visible when verification moves a school outside the selected filter', async () => {
    state.rows[0].capability.mode = 'TEST';
    const originalRows = state.rows;
    state.verify.mockImplementation(async () => {
      state.rows = [];
      return { schoolId: 7, status: 'VERIFIED' };
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      await open();
      const filter = container.querySelector('select[aria-label="Status filter"]')!;
      await act(async () => {
        (filter as HTMLSelectElement).value = 'PENDING_VERIFICATION';
        filter.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
      await act(async () => (container.querySelector('[data-testid="button-verify-7"]') as HTMLButtonElement).click());
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
      const row = container.querySelector('[data-testid="row-school-settlement-7"]')!;
      expect(row.textContent).toContain('Server confirmed bank account verification status verified');
      expect(row.textContent).toContain('badge shows last listed status');
      expect((row.querySelector('[data-testid="button-verify-7"]') as HTMLButtonElement).disabled).toBe(true);
    } finally { state.rows = originalRows; }
  });
  it('keeps the production verification presentation unchanged', async () => {
    vi.stubEnv('DEV', false);
    state.rows[0].capability.mode = 'TEST';
    state.verify.mockResolvedValue({ schoolId: 7, status: 'VERIFIED' });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await open();
    await act(async () => (container.querySelector('[data-testid="button-verify-7"]') as HTMLButtonElement).click());
    expect(container.querySelector('[data-testid="bank-verification-result-7"]')).toBeNull();
    expect(container.textContent).toContain('bank account verification status verified');
    expect(container.textContent).not.toContain('Even TEST verification may contact');
  });
});