import { useQueryClient } from '@tanstack/react-query';
import { useGetParentCommunicationChannels, getGetParentCommunicationChannelsQueryKey, useGetCommunicationPreferences, getGetCommunicationPreferencesQueryKey, useUpdateCommunicationPreference, useGetTelegramStatus, getGetTelegramStatusQueryKey } from '@workspace/api-client-react';
import { Info, StatusPill } from '@/components/shared';
import { Notice, QueryBoundary } from '../security/ui';
import { useState } from 'react';
import { safeMessage } from '../security/security-contract';
import { categoryLabel, channelTruth } from './comm-contract';
import { ParentTelegramControl, telegramGate } from '@/components/telegram-control';
import { WebPushControl } from '@/components/web-push-control';

export function Preferences({ schoolId }: { schoolId: number }) {
  const qc = useQueryClient();
  const ch = useGetParentCommunicationChannels({ query: { queryKey: getGetParentCommunicationChannelsQueryKey(), staleTime: 60000 } });
  const params = { schoolId };
  const pq = useGetCommunicationPreferences(params, { query: { queryKey: getGetCommunicationPreferencesQueryKey(params), staleTime: 30000 } });
  const tg = useGetTelegramStatus({ schoolId }, { query: { queryKey: getGetTelegramStatusQueryKey({ schoolId }) } });
  const upd = useUpdateCommunicationPreference(); const [msg, setMsg] = useState('');
  // Missing persisted rows use the same enabled default as the delivery service.
  const topics = ['ATTENDANCE', 'ACADEMIC', 'ASSIGNMENT', 'FINANCE', 'PAYMENT', 'ANNOUNCEMENT', 'ACCOUNT', 'SYSTEM', 'SUBSCRIPTION', 'PARTNER', 'SECURITY'] as const;
  const channels = ['IN_APP', 'SMS', 'EMAIL', 'PUSH', 'TELEGRAM'] as const;
  const available = (channel: typeof channels[number]) => channel !== 'SMS' &&
    ch.data?.channels.some(c => c.channel === channel && c.available) === true &&
    (channel !== 'TELEGRAM' || telegramGate(tg.data));
  const preferences = topics.flatMap(category => channels.map(channel =>
    pq.data?.preferences.find(p => p.category === category && p.channel === channel) ??
    { schoolId, category, channel, enabled: true, mandatory: category === 'ACCOUNT' || category === 'SECURITY' }));
  return <div className="space-y-5">
    <WebPushControl schoolId={schoolId} />
    <ParentTelegramControl schoolId={schoolId} />
    <section className="panel p-5"><div className="eyebrow">Channel availability</div><QueryBoundary query={ch}><div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{(ch.data?.channels ?? []).map(c => <Info key={c.channel} label={c.channel.replace('_', '-')} value={<span>{channelTruth(c)}<span className="mt-1 block text-xs font-normal text-[hsl(var(--muted-foreground))]">{c.detail}</span></span>} />)}</div></QueryBoundary><p className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">Available means local provider configuration is valid. Policy, consent and device/chat setup still apply. Provider acceptance is not confirmation of device receipt.</p></section>
    <section className="panel p-5"><div className="eyebrow">Preferences</div>{msg && <Notice tone="error">{msg}</Notice>}<QueryBoundary query={pq}><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[480px] text-sm"><thead className="text-left text-xs text-[hsl(var(--muted-foreground))]"><tr><th className="py-2">Topic</th><th>Channel</th><th>On</th></tr></thead><tbody>{preferences.map(p => <tr key={`${p.category}-${p.channel}`} className="border-t border-[hsl(var(--border)/.7)]"><td className="py-2">{categoryLabel(p.category)}</td><td>{p.channel}</td><td>{!available(p.channel) ? <input type="checkbox" checked={false} disabled aria-label={`${p.category} ${p.channel} unavailable`} /> : p.mandatory ? <StatusPill value="required" /> : <input type="checkbox" checked={p.enabled} disabled={upd.isPending} aria-label={`${p.category} ${p.channel}`} onChange={e => void upd.mutateAsync({ data: { schoolId: p.schoolId, category: p.category, channel: p.channel, enabled: e.target.checked } }).then(() => { setMsg(''); return qc.invalidateQueries({ queryKey: getGetCommunicationPreferencesQueryKey(params) }); }).catch(er => setMsg(safeMessage(er)))} />}</td></tr>)}</tbody></table></div></QueryBoundary></section></div>;
}
