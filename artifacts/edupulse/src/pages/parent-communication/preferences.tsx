import { useQueryClient } from '@tanstack/react-query';
import { useGetParentCommunicationChannels, getGetParentCommunicationChannelsQueryKey, useGetCommunicationPreferences, getGetCommunicationPreferencesQueryKey, useUpdateCommunicationPreference } from '@workspace/api-client-react';
import { Info, StatusPill } from '@/components/shared';
import { Notice, QueryBoundary } from '../security/ui';
import { useState } from 'react';
import { safeMessage } from '../security/security-contract';
import { categoryLabel, channelTruth } from './comm-contract';

export function Preferences({ schoolId }: { schoolId: number }) {
  const qc = useQueryClient();
  const ch = useGetParentCommunicationChannels({ query: { queryKey: getGetParentCommunicationChannelsQueryKey(), staleTime: 60000 } });
  const params = { schoolId };
  const pq = useGetCommunicationPreferences(params, { query: { queryKey: getGetCommunicationPreferencesQueryKey(params), staleTime: 30000 } });
  const upd = useUpdateCommunicationPreference(); const [msg, setMsg] = useState('');
  return <div className="space-y-5">
    <section className="panel p-5"><div className="eyebrow">Channel availability</div><QueryBoundary query={ch}><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{(ch.data?.channels ?? []).map(c => <Info key={c.channel} label={c.channel.replace('_', '-')} value={<span>{channelTruth(c)}<span className="mt-1 block text-xs font-normal text-[hsl(var(--muted-foreground))]">{c.detail}</span></span>} />)}</div></QueryBoundary><p className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">A channel marked available means the school can attempt sending. Delivery to your phone is only confirmed when the provider acknowledges it.</p></section>
    <section className="panel p-5"><div className="eyebrow">Preferences</div>{msg && <Notice tone="error">{msg}</Notice>}<QueryBoundary query={pq}><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[480px] text-sm"><thead className="text-left text-xs text-[hsl(var(--muted-foreground))]"><tr><th className="py-2">Topic</th><th>Channel</th><th>On</th></tr></thead><tbody>{(pq.data?.preferences ?? []).map(p => <tr key={`${p.category}-${p.channel}`} className="border-t border-[hsl(var(--border)/.7)]"><td className="py-2">{categoryLabel(p.category)}</td><td>{p.channel}</td><td>{p.mandatory ? <StatusPill value="required" /> : <input type="checkbox" checked={p.enabled} disabled={upd.isPending} aria-label={`${p.category} ${p.channel}`} onChange={e => void upd.mutateAsync({ data: { schoolId: p.schoolId, category: p.category, channel: p.channel, enabled: e.target.checked } }).then(() => qc.invalidateQueries({ queryKey: getGetCommunicationPreferencesQueryKey(params) })).catch(er => setMsg(safeMessage(er)))} />}</td></tr>)}</tbody></table></div></QueryBoundary></section></div>;
}
