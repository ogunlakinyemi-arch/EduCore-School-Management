import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const data = vi.hoisted(() => [
  { id: 1, applicantType: 'SCHOOL_ADMIN', firstName: 'Ada', lastName: 'Okafor', email: 'a@x.ng', phone: '080', city: 'Ikeja', state: 'Lagos', schoolName: 'Hill School', status: 'PENDING', createdAt: '2024-01-01', notificationStatus: 'NOT_REQUESTED' },
]);
const flags = vi.hoisted(() => ({isLoading:false,isError:false}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock('@workspace/api-client-react', () => ({
  useGetAccountApplications: () => ({ data, ...flags, isFetching: false, refetch: vi.fn() }),
  useDecideAccountApplication: () => ({ mutate: vi.fn() }),
  useManageAccountApplicationNotification: () => ({ mutateAsync: vi.fn() }),
  getGetAccountApplicationsQueryKey: () => ['x'],
}));
import AccountApplicationsPanel from './account-applications-panel';
import { notificationCopy } from '@/lib/application-intent';

describe('account applications panel', () => {
  it('shows the submitted School Admin email to the Owner', () => {
    const html=renderToStaticMarkup(<AccountApplicationsPanel/>);
    expect(html).toContain('Hill School');
    expect(html).toContain('a@x.ng');
  });
  it.each(['loading','error'])('shows an explicit %s state instead of hiding review', mode => {
    flags.isLoading=mode==='loading';flags.isError=mode==='error';
    try {
      const html=renderToStaticMarkup(<AccountApplicationsPanel/>);
      expect(html).toContain('Applications');
      expect(html).toContain(mode==='loading'?'Loading applications':'Could not load applications');
      if(mode==='error')expect(html).toContain('Retry');
    } finally {flags.isLoading=false;flags.isError=false;}
  });
  it('shows a truthful empty Pending state with all decision filters', () => {
    const original=data.splice(0);
    try{
      const html=renderToStaticMarkup(<AccountApplicationsPanel/>);
      expect(html).toContain('No pending applications.');
      for(const status of ['pending','approved','rejected'])expect(html).toContain(`filter-${status}`);
    }finally{data.push(...original)}
  });
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
