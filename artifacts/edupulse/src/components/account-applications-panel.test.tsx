import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const data = vi.hoisted(() => [
  { id: 1, applicantType: 'SCHOOL_ADMIN', firstName: 'Ada', lastName: 'Okafor', email: 'a@x.ng', phone: '080', city: 'Ikeja', state: 'Lagos', schoolName: 'Hill School', status: 'PENDING', createdAt: '2024-01-01', notificationStatus: 'NOT_REQUESTED' },
]);
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@workspace/api-client-react', () => ({
  useGetAccountApplications: () => ({ data, isLoading: false, isError: false, isFetching: false, refetch: vi.fn() }),
  useDecideAccountApplication: () => ({ mutate: vi.fn() }),
  getGetAccountApplicationsQueryKey: () => ['x'],
}));
import AccountApplicationsPanel from './account-applications-panel';
import { notificationCopy } from '@/lib/application-intent';

describe('account applications panel', () => {
  it('lists pending applicants with actions', () => {
    const html = renderToStaticMarkup(<AccountApplicationsPanel />);
    expect(html).toContain('Hill School');
    expect(html).toContain('button-approve-1');
    expect(html).toContain('button-reject-1');
  });
  it('never claims delivery for ACCEPTED and flags review states', () => {
    expect(notificationCopy('ACCEPTED')).toContain('not confirmed');
    expect(notificationCopy('SENDING')).toContain('needs review');
    expect(notificationCopy('UNKNOWN')).toContain('not be resent');
  });
});
