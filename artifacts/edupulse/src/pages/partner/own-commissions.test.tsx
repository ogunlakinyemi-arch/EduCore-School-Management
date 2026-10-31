// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, it, expect, vi } from 'vitest';
const f = vi.hoisted(() => ({ user: 'bro-one', options: vi.fn(), error: false }));
vi.mock('@clerk/react', () => ({ useUser: () => ({ user: { id: f.user } }) }));
vi.mock('@workspace/api-client-react', async original => ({
  ...await original<typeof import('@workspace/api-client-react')>(),
  useGetMyBroCommissionEntitlements: (options: unknown) => {
    f.options(options);
    return { isLoading: false, isError: f.error, refetch: vi.fn(),
      data: { earnedMinor: 15000, currency: 'NGN', platformRevenue: 320000,
        items: [{ id: 1, studentId: 31, termId: 4, amountMinor: 15000, currency: 'NGN',
          status: 'PENDING_OWNER_APPROVAL', earnedAt: '2027-01-18T10:00:00Z', schoolPayment: 320000 }] } };
  },
}));
import OwnBroCommissions from './own-commissions';
describe('BRO own commission display', () => {
  it('shows own student/term entitlement with polling and identity-isolated cache, not school collections', () => {
    f.error = false;
    const html = renderToStaticMarkup(<OwnBroCommissions />);
    expect(html).toContain('₦150.00 earned'); expect(html).toContain('Student #31');
    expect(html).toContain('Term #4'); expect(html).toContain('awaiting approval');
    expect(html).not.toMatch(/320000|3,200|revenue|schoolPayment|policyId/);
    const { query } = f.options.mock.lastCall![0] as any;
    expect(query.refetchInterval).toBe(10000);
    expect(query.refetchOnMount).toBe('always');
    expect(query.queryKey).toContain('bro-one');
    f.user = 'bro-two'; renderToStaticMarkup(<OwnBroCommissions />);
    expect((f.options.mock.lastCall![0] as any).query.queryKey).toContain('bro-two');
    expect((f.options.mock.lastCall![0] as any).query.queryKey).not.toContain('bro-one');
  });
  it('never renders a stale balance as confirmed after a read failure', () => {
    f.error = true;
    const html = renderToStaticMarkup(<OwnBroCommissions />);
    expect(html).toContain('could not be confirmed'); expect(html).not.toContain('₦150.00 earned');
  });
});
