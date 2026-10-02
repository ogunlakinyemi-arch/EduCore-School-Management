import { useState } from 'react';
import { useGetSchoolSecurityAccess, getGetSchoolSecurityAccessQueryKey } from '@workspace/api-client-react';
import { PageHeading, TenantPicker, useTenant } from '@/components/shared';
import { liveAccess } from './security-contract';
import { Tabs, Forbidden, QueryBoundary } from './ui';
import { Overview, Presence } from './overview';
import { Events } from './events';
import { Readers } from './readers';
import { Visitors } from './visitors';
import { Pickup } from './pickup';
import { Incidents } from './incidents';
import { Settings } from './settings';

type Tab = 'overview' | 'events' | 'presence' | 'readers' | 'visitors' | 'pickup' | 'incidents' | 'settings';

export default function SchoolSecurityPage() {
  const { schoolId } = useTenant();
  const accessQ = useGetSchoolSecurityAccess(schoolId, { query: { enabled: !!schoolId, queryKey: getGetSchoolSecurityAccessQueryKey(schoolId), staleTime: 30000 } });
  const a = liveAccess(accessQ.data);
  const owner = accessQ.data?.actorRole === 'PLATFORM_OWNER';
  const [tab, setTab] = useState<Tab>('overview');
  const tabs: { id: Tab; label: string }[] = [...(a.read ? [{ id: 'overview' as const, label: 'Overview' }, { id: 'events' as const, label: 'Entry/Exit events' }] : []),
    ...(a.presence ? [{ id: 'presence' as const, label: 'Campus presence' }] : []), ...(a.readers ? [{ id: 'readers' as const, label: 'Readers' }] : []),
    ...(a.visitors ? [{ id: 'visitors' as const, label: 'Visitors' }] : []), ...(a.pickup ? [{ id: 'pickup' as const, label: 'Pickup' }] : []),
    ...(a.incidents ? [{ id: 'incidents' as const, label: 'Incidents' }] : []), ...(a.settings ? [{ id: 'settings' as const, label: 'Settings' }] : [])];
  const active: Tab | null = tabs.some(t => t.id === tab) ? tab : tabs[0]?.id ?? null;
  return <div className="fade-up"><PageHeading eyebrow="Campus / School security" title="School security." description="Card-read entry and exit records, presence, visitors and pickup. This system records card reads; it does not track GPS or unlock doors." action={owner ? <TenantPicker /> : undefined} />
    {!schoolId ? <p className="text-sm">Select a school to continue.</p> : <QueryBoundary query={accessQ}>{!a.view || !active ? <Forbidden /> : <>
      {a.readOnly && <p className="mb-3 text-xs font-bold text-[hsl(var(--muted-foreground))]" data-testid="text-security-readonly">Read-only access.</p>}
      <Tabs tabs={tabs} value={active} onChange={id => {
        if (tabs.some(item => item.id === id)) setTab(id as Tab);
      }} />
      {active === 'overview' && <Overview schoolId={schoolId} canMutate={false} />}
      {active === 'events' && <Events schoolId={schoolId} />}
      {active === 'presence' && <Presence schoolId={schoolId} canMutate />}
      {active === 'readers' && <Readers schoolId={schoolId} canMutate />}
      {active === 'visitors' && <Visitors schoolId={schoolId} canMutate />}
      {active === 'pickup' && <Pickup schoolId={schoolId} canMutate />}
      {active === 'incidents' && <Incidents schoolId={schoolId} canMutate />}
      {active === 'settings' && <Settings schoolId={schoolId} canMutate canGrant={a.grants} delegated={a.delegated} />}
    </>}</QueryBoundary>}</div>;
}
