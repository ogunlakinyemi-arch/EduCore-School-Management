import { useEffect, useState } from 'react';
import { useListParentCommunicationChildren, getListParentCommunicationChildrenQueryKey } from '@workspace/api-client-react';
import { EmptyState, ErrorState, PageHeading, SkeletonPage } from '@/components/shared';
import { Users } from 'lucide-react';
import { Tabs, inputClass } from '../security/ui';
import { Feed } from './feed';
import { ChildStatus } from './child-status';
import { Threads } from './threads';
import { ChildPickup } from './pickup';
import { Preferences } from './preferences';

type Tab = 'inbox' | 'messages' | 'announcements' | 'security' | 'history' | 'preferences';

export default function ParentCommunicationCentre({ standalone = true }: { standalone?: boolean }) {
  const q = useListParentCommunicationChildren(undefined, { query: { queryKey: getListParentCommunicationChildrenQueryKey(), staleTime: 60000 } });
  const kids = q.data?.children ?? [];
  const [sid, setSid] = useState(0); const [tab, setTab] = useState<Tab>('inbox');
  useEffect(() => { if (!sid && kids.length) setSid(kids[0].studentId); }, [kids, sid]);
  const child = kids.find(k => k.studentId === sid);
  const options = kids.map(k => ({ studentId: k.studentId, label: `${k.firstName} ${k.lastName} (${k.schoolName})` }));
  return <main className={standalone ? 'mx-auto max-w-6xl p-4 md:p-8 fade-up' : 'fade-up'}>
    <PageHeading eyebrow="Family / Communication" title="Communication centre." description="Updates, messages and pickup arrangements for your own children." />
    {q.isLoading ? <SkeletonPage /> : q.isError ? <ErrorState retry={() => void q.refetch()} /> : !kids.length ? <EmptyState icon={Users} title="No linked children" description="Children linked to your account will appear here." /> : <>
      <label className="mb-5 block max-w-sm text-xs font-bold">Child<select className={inputClass} value={sid} onChange={e => setSid(Number(e.target.value))} data-testid="select-child">{options.map(o => <option key={o.studentId} value={o.studentId}>{o.label}</option>)}</select></label>
      <Tabs tabs={[{ id: 'inbox', label: 'Inbox' }, { id: 'messages', label: 'Messages' }, { id: 'announcements', label: 'Announcements' }, { id: 'security', label: 'Child security' }, { id: 'history', label: 'History' }, { id: 'preferences', label: 'Preferences' }]} value={tab} onChange={id => {
        if (['inbox', 'messages', 'announcements', 'security', 'history', 'preferences'].includes(id)) setTab(id as Tab);
      }} />
      {child && <>
        {tab === 'inbox' && <Feed key={`i${sid}`} childId={sid} schoolId={child.schoolId} />}
        {tab === 'messages' && <Threads key={`m${sid}`} childId={sid} schoolId={child.schoolId} children={options} />}
        {tab === 'announcements' && <Feed key={`a${sid}`} childId={sid} schoolId={child.schoolId} fixedCategory="ANNOUNCEMENT" />}
        {tab === 'security' && <><ChildStatus key={`c${sid}`} studentId={sid} /><div className="mb-5"><h2 className="display-font mb-2 text-lg font-bold">Arrival and exit activity</h2><Feed key={`s${sid}`} childId={sid} schoolId={child.schoolId} fixedCategory="SECURITY" /></div><ChildPickup studentId={sid} /></>}
        {tab === 'history' && <Feed key={`h${sid}`} childId={sid} schoolId={child.schoolId} history />}
        {tab === 'preferences' && <Preferences schoolId={child.schoolId} />}
      </>}</>}
  </main>;
}
