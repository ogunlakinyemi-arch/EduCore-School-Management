import { useArchiveCommunicationNotification, useUnarchiveCommunicationNotification } from '@workspace/api-client-react';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useListCommunicationNotifications, getListCommunicationNotificationsQueryKey, useMarkCommunicationNotificationRead } from '@workspace/api-client-react';
import type { CommunicationCategory, CommunicationNotification } from '@workspace/api-client-react';
import { Link } from 'wouter';
import { MailOpen } from 'lucide-react';
import { Button, EmptyState, ErrorState, SkeletonPage, date, time, cx } from '@/components/shared';
import { inputClass } from '../security/ui';
import { ACTIVITY_CATEGORIES, categoryLabel } from './comm-contract';
import { visibleCommunicationNotifications } from '../communication-contract';

const safe = (l: string | null) => l && l.startsWith('/') && !l.startsWith('//') && !l.includes('\\') ? l : null;

export function Feed({ childId, schoolId, fixedCategory, history = false }: { childId: number; schoolId: number; fixedCategory?: CommunicationCategory; history?: boolean }) {
  const qc = useQueryClient();
  const [category, setCategory] = useState<'' | CommunicationCategory>(fixedCategory ?? ''); const [unread, setUnread] = useState(false); const [search, setSearch] = useState(''); const [before, setBefore] = useState<number | undefined>(); const [older, setOlder] = useState<CommunicationNotification[]>([]);
  const params = { schoolId, childId, limit: 20, ...(category ? { category } : {}), ...(unread ? { isRead: false } : {}), ...(search.trim() ? { search: search.trim() } : {}), ...(history ? { includeArchived: true, includeExpired: true } : {}), ...(before ? { beforeId: before } : {}) };
  const q = useListCommunicationNotifications(params, { query: { queryKey: getListCommunicationNotificationsQueryKey(params), staleTime: 20000 } });
  const mark = useMarkCommunicationNotificationRead(); const archive = useArchiveCommunicationNotification(); const unarchive = useUnarchiveCommunicationNotification();
  const [archMsg, setArchMsg] = useState('');
  const items = visibleCommunicationNotifications([...older, ...(q.data?.items ?? [])]).filter((x, i, a) => a.findIndex(o => o.id === x.id) === i);
  const reset = () => { setBefore(undefined); setOlder([]); };
  const read = async (id: number) => { await mark.mutateAsync({ notificationId: id }); await qc.invalidateQueries({ queryKey: getListCommunicationNotificationsQueryKey() }); };
  const toggleArchive = async (n: CommunicationNotification) => { try { if (n.isArchived) await unarchive.mutateAsync({ notificationId: n.id }); else await archive.mutateAsync({ notificationId: n.id }); setArchMsg(''); reset(); await qc.invalidateQueries({ queryKey: getListCommunicationNotificationsQueryKey() }); } catch { setArchMsg('Could not change archive state. Try again.'); } };
  const noArchive = (n: CommunicationNotification) => n.category === 'SECURITY' || n.category === 'ACCOUNT';
  return <div className="space-y-4">{archMsg && <p role="alert" className="text-xs font-bold text-[hsl(var(--destructive))]">{archMsg}</p>}
    <div className="flex flex-wrap items-end gap-3">
      {!fixedCategory && <label className="text-xs font-bold">Type<select className={inputClass} value={category} onChange={e => { setCategory(e.target.value as '' | CommunicationCategory); reset(); }} data-testid="select-feed-category"><option value="">Everything</option>{ACTIVITY_CATEGORIES.map(c => <option key={c} value={c}>{categoryLabel(c)}</option>)}<option value="ANNOUNCEMENT">Announcements</option></select></label>}
      <label className="text-xs font-bold">Search<input className={inputClass} value={search} onChange={e => { setSearch(e.target.value); reset(); }} placeholder="Search messages" data-testid="input-feed-search" /></label>
      <label className="flex items-center gap-2 pb-2.5 text-xs font-bold"><input type="checkbox" checked={unread} onChange={e => { setUnread(e.target.checked); reset(); }} />Unread only</label></div>
    <div className="panel overflow-hidden">{q.isLoading ? <SkeletonPage /> : q.isError ? <ErrorState retry={() => void q.refetch()} /> : !items.length ? <EmptyState icon={MailOpen} title="Nothing here yet" description="Updates about your child will appear here." /> :
      <div className="divide-y divide-[hsl(var(--border)/.7)]">{items.map(n => <article key={n.id} className={cx('p-4', !n.isRead && 'bg-[hsl(var(--secondary)/.4)]')} data-testid={`row-feed-${n.id}`}><div className="eyebrow">{categoryLabel(n.category)}{!n.isRead && ' · new'}</div><h3 className="mt-1 font-bold">{n.subject || 'School update'}</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm text-[hsl(var(--muted-foreground))]">{n.body}</p>
        <div className="mt-2 flex flex-wrap gap-4 text-xs text-[hsl(var(--muted-foreground))]"><span>{date(n.createdAt)} {time(n.createdAt)}</span>{safe(n.link) && <Link href={safe(n.link)!} className="font-bold text-[hsl(var(--primary))]">Open</Link>}{!n.isRead && <button className="font-bold text-[hsl(var(--primary))]" onClick={() => void read(n.id)}>Mark read</button>}{!noArchive(n) && <button className="font-bold text-[hsl(var(--primary))]" onClick={() => void toggleArchive(n)} data-testid={`button-archive-${n.id}`}>{n.isArchived ? 'Restore' : 'Archive'}</button>}{n.isArchived && <span>archived</span>}</div>
        {n.deliveries.length > 0 && <div className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">Delivery: {n.deliveries.map(d => `${d.channel} ${d.simulated ? 'simulated' : d.status.toLowerCase()}`).join(', ')}</div>}</article>)}</div>}
      {q.data?.hasMore && <div className="border-t border-[hsl(var(--border))] p-3 text-center"><Button variant="outline" onClick={() => { setOlder(items); setBefore(q.data?.nextBeforeId ?? undefined); }}>Load older</Button></div>}</div></div>;
}
