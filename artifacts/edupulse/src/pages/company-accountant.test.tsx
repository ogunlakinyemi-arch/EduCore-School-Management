import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  overview: {
    subscriptions: {
      verifiedSubscriptionCount: 3,
      verifiedRevenue: '15000.00',
      verifiedEduPulseShare: '9000.00',
      unverifiedSubscriptionCount: 1,
      activeVerifiedCount: 2,
    },
    commissions: [{ status: 'PAYABLE', currency: 'NGN', count: 2, amount: '900.00' }],
    payouts: [{ status: 'PAID', currency: 'NGN', count: 1, amount: '300.00' }],
  },
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey.includes('overview') ? state.overview : [],
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

import { CompanyAccountantPage } from './company-accountant';

describe('restricted Company Accountant finance page', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders company subscription revenue and partner accounting summaries only', () => {
    const markup = renderToStaticMarkup(<CompanyAccountantPage />);
    expect(markup).toContain('Verified subscription revenue');
    expect(markup).toContain('EduPulse share of verified revenue');
    expect(markup).toContain('Commission totals');
    expect(markup).toContain('Payout totals');
    expect(markup).toContain('School fees and school finance records are not available here.');
    expect(markup).not.toContain('Student fees');
    expect(markup).not.toContain('schoolName');
  });
});