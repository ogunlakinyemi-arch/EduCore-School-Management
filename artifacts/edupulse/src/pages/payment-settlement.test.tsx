// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  error: false,
  rows: [
    { schoolId: 7, schoolName: 'Configured school', status: 'PENDING_VERIFICATION', businessName: 'School business', bankName: 'Test bank', accountName: 'Test recipient', accountLast4: '7890', capability: { mode: 'MOCK', bankSubaccountsSupported: false } },
    { schoolId: 8, schoolName: 'Unconfigured school', status: 'NOT_CONFIGURED', capability: { mode: 'MOCK', bankSubaccountsSupported: false } },
  ],
  list: vi.fn(),
}));
vi.mock('@workspace/api-client-react', async importOriginal => {
  const actual = await importOriginal<typeof import('@workspace/api-client-react')>();
  const query = (data: unknown) => ({ data, isLoading: false, isError: false, isFetching: false, dataUpdatedAt: 0, refetch: vi.fn() });
  const mutation = () => ({ isPending: false, mutateAsync: vi.fn() });
  return {
    ...actual,
    useGetAuthorizedContext: () => query({ isPlatformOwner: true, roles: [] }),
    useGetPlatformPaymentSettlement: () => query({ status: 'NOT_CONFIGURED', capability: { mode: 'MOCK' } }),
    useListPlatformSchoolSettlements: (...args: unknown[]) => {
      state.list(...args);
      return { ...query(state.rows), isError: state.error };
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
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  state.error = false;
  state.list.mockClear();
});

describe('Owner school settlement oversight', () => {
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
});