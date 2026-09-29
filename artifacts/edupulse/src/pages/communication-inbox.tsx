import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Bell, CheckCheck, MailOpen, ArrowRight, RefreshCw } from 'lucide-react';
import { useListCommunicationNotifications, useMarkCommunicationNotificationRead, useMarkAllCommunicationNotificationsRead, getListCommunicationNotificationsQueryKey } from '@workspace/api-client-react';
import type { CommunicationNotification } from '@workspace/api-client-react';
import { PageHeading, Button, EmptyState, ErrorState, SkeletonPage, date, time, cx } from '@/components/shared';
import { inboxItems, visibleCommunicationNotifications } from './communication-contract';

// Only system-generated finance/payment notices live in the separate finance bell.
const safeLink = (link: string | null) => link && link.startsWith('/') && !link.startsWith('//') && !link.includes('\\') ? link : null;

export function CommunicationInbox({ standalone = false }: { standalone?: boolean }) {
  const qc = useQueryClient();
  const [beforeId, setBeforeId] = useState<number | undefined>();
  const [older, setOlder] = useState<CommunicationNotification[]>([]);
  const [error, setError] = useState('');
  const params = { limit: 30, ...(beforeId ? { beforeId } : {}) };
  const query = useListCommunicationNotifications(params, { query: { queryKey: getListCommunicationNotificationsQueryKey(params), refetchInterval: 30000 } });
  const mark = useMarkCommunicationNotificationRead();
  const markAll = useMarkAllCommunicationNotificationsRead();
  const current = visibleCommunicationNotifications(inboxItems(query.data));
  const items = [...older, ...current].filter((item, index, array) => array.findIndex(other => other.id === item.id) === index);
  const unread = items.filter(item => !item.isRead).length;
  const refresh = async () => { setBeforeId(undefined); setOlder([]); await qc.invalidateQueries({ queryKey: getListCommunicationNotificationsQueryKey() }); };
  const onRead = async (id: number) => {
    try {
      await mark.mutateAsync({ notificationId: id });
      setOlder(prev => prev.map(item => item.id === id ? { ...item, isRead: true } : item));
      setError('');
      await qc.invalidateQueries({ queryKey: getListCommunicationNotificationsQueryKey() });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not mark this message read.'); }
  };
  const onAll = async () => {
    try {
      // Read only the categories displayed here: the endpoint's read-all is broader than this view.
      for (const item of items.filter(item => !item.isRead)) await mark.mutateAsync({ notificationId: item.id });
      setOlder(prev => prev.map(item => ({ ...item, isRead: true })));
      setError('');
      await qc.invalidateQueries({ queryKey: getListCommunicationNotificationsQueryKey() });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not mark all messages read.'); }
  };
  const onAllAcrossFeeds = async () => {
    if (!window.confirm('Mark all notifications read, including notices in the separate finance feed?')) return;
    try {
      await markAll.mutateAsync({ data: {} });
      setOlder(prev => prev.map(item => ({ ...item, isRead: true })));
      setError('');
      await qc.invalidateQueries({ queryKey: getListCommunicationNotificationsQueryKey() });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not mark notifications read.'); }
  };
  return <div className={cx('fade-up', standalone && 'mx-auto max-w-6xl p-5 md:p-8')}>
    <PageHeading eyebrow="Your messages / Communication" title="Inbox." description="School messages and account updates in one place. Fee and payment alerts remain in your finance notifications." action={<div className="flex flex-wrap gap-2"><Link href="/notification-settings" className="inline-flex items-center rounded-xl border border-[hsl(var(--border))] px-4 py-2.5 text-sm font-bold" data-testid="link-notification-settings">Preferences</Link><Button variant="outline" onClick={() => void refresh()}><RefreshCw size={15} /> Refresh</Button></div>} />
    <div className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--border))] p-5">
        <div><div className="eyebrow">Message centre</div><h2 className="display-font mt-1 text-xl font-bold" data-testid="text-unread-messages">{unread} unread {unread === 1 ? 'message' : 'messages'}</h2></div>
        <div className="flex flex-wrap items-center gap-2">{unread > 0 && <Button variant="quiet" disabled={mark.isPending || markAll.isPending} onClick={() => void onAll()}><CheckCheck size={16} /> Mark visible messages read</Button>}<Button variant="quiet" disabled={mark.isPending || markAll.isPending} onClick={() => void onAllAcrossFeeds()}>Mark all across feeds</Button></div>
      </div>
      {error && <p className="p-4 text-sm text-[hsl(var(--destructive))]" role="alert">{error}</p>}
      {query.isLoading ? <SkeletonPage /> : query.isError ? <ErrorState retry={() => void query.refetch()} /> : !items.length ? <EmptyState icon={MailOpen} title="A quiet inbox" description="When your school sends an announcement or an account update, you’ll find it here." /> :
        <div className="divide-y divide-[hsl(var(--border)/.7)]">{items.map(item => <article key={item.id} className={cx('flex gap-4 p-5 md:p-6', !item.isRead && 'bg-[hsl(var(--secondary)/.4)]')} data-testid={`row-message-${item.id}`}>
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]"><Bell size={18} /></div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2"><span className="eyebrow">{item.category.replaceAll('_', ' ')}</span>{!item.isRead && <span className="h-2 w-2 rounded-full bg-[hsl(var(--primary))]" aria-label="Unread" />}</div>
            <h3 className="mt-1 font-bold">{item.subject || 'School update'}</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-[hsl(var(--muted-foreground))]">{item.body}</p>
            <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-[hsl(var(--muted-foreground))]"><span>{date(item.createdAt)} at {time(item.createdAt)}</span>{safeLink(item.link) && <Link href={safeLink(item.link)!} className="inline-flex items-center gap-1 font-bold text-[hsl(var(--primary))]" data-testid={`link-message-${item.id}`}>Open related page <ArrowRight size={13} /></Link>}{!item.isRead && <button type="button" onClick={() => void onRead(item.id)} disabled={mark.isPending} className="font-bold text-[hsl(var(--primary))] disabled:opacity-50" data-testid={`button-read-message-${item.id}`}>Mark read</button>}</div>
          </div>
        </article>)}</div>}
      {query.data?.hasMore && <div className="border-t border-[hsl(var(--border))] p-4 text-center"><Button variant="outline" disabled={query.isFetching} onClick={() => { setOlder(prev => [...prev, ...(query.data?.items ?? [])]); setBeforeId(query.data?.nextBeforeId ?? undefined); }}>Load older messages</Button></div>}
    </div>
  </div>;
}

export function CommunicationInboxBadge() {
  const params = { limit: 100 };
  const query = useListCommunicationNotifications(params, { query: { queryKey: getListCommunicationNotificationsQueryKey(params), refetchInterval: 30000 } });
  const count = visibleCommunicationNotifications(inboxItems(query.data)).filter(item => !item.isRead).length;
  return <Link href="/inbox" className="relative grid h-10 w-10 place-items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))]" aria-label={`Messages, ${count} unread on this page`} data-testid="link-inbox-header"><Bell size={18} />{count > 0 && <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-[hsl(var(--primary))] px-1 text-[10px] font-bold text-[hsl(var(--primary-foreground))]" aria-hidden="true">{count > 99 ? '99+' : count}</span>}</Link>;
}