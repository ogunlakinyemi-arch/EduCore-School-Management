import { useQueryClient } from '@tanstack/react-query';
import { Bell, Check, BellRing, Inbox } from 'lucide-react';
import { 
  useListPlatformNotifications, useMarkPlatformNotificationRead, getListPlatformNotificationsQueryKey
} from '@workspace/api-client-react';
import { 
  PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, cx, date, time
} from '@/components/shared';

export function NotificationsPage() {
  const qc = useQueryClient();
  const notificationsQuery = useListPlatformNotifications();
  const markRead = useMarkPlatformNotificationRead();

  const notifications = notificationsQuery.data ?? [];

  const handleMarkRead = async (notificationId: number) => {
    if (markRead.isPending) return;
    await markRead.mutateAsync({ notificationId });
    // Update local cache immediately without full refetch for better UX
    qc.setQueryData(getListPlatformNotificationsQueryKey(), (old: any) => {
      if (!old) return old;
      return old.map((n: any) => n.id === notificationId ? { ...n, isRead: true } : n);
    });
  };

  const handleMarkAllRead = async () => {
    if (markRead.isPending) return;
    const unreadIds = notifications.filter((n: any) => !n.isRead).map((n: any) => n.id);
    for (const id of unreadIds) {
      await markRead.mutateAsync({ notificationId: id });
    }
    qc.invalidateQueries({ queryKey: getListPlatformNotificationsQueryKey() });
  };

  const unreadCount = notifications.filter((n: any) => !n.isRead).length;

  return (
    <div className="fade-up">
      <PageHeading 
        eyebrow="Platform / Communications" 
        title="System Notifications." 
        description="Alerts, approvals, and system events requiring attention."
        action={
          unreadCount > 0 && (
            <Button onClick={handleMarkAllRead} variant="outline">
              <Check size={16} /> Mark all as read
            </Button>
          )
        } 
      />

      {notificationsQuery.isLoading ? (
        <SkeletonPage />
      ) : notificationsQuery.isError ? (
        <ErrorState retry={() => notificationsQuery.refetch()} />
      ) : (
        <div className="panel overflow-hidden">
          {notifications.length > 0 ? (
            <div className="divide-y divide-[hsl(var(--border)/.6)]">
              {notifications.map((notification) => (
                <div key={notification.id} className={cx('flex gap-5 p-5 transition-colors hover:bg-[hsl(var(--muted)/.2)]', !notification.isRead && 'bg-[hsl(var(--primary)/.02)]')}>
                  <div className={cx(
                    'grid h-10 w-10 shrink-0 place-items-center rounded-2xl',
                    notification.severity === 'critical' ? 'bg-[hsl(var(--destructive)/.12)] text-[hsl(var(--destructive))]' :
                    notification.severity === 'warning' ? 'bg-[hsl(35_83%_53%/.15)] text-[hsl(28_73%_40%)] dark:text-[hsl(35_83%_55%)]' :
                    'bg-[hsl(var(--primary)/.08)] text-[hsl(var(--primary))] dark:bg-[hsl(var(--accent)/.15)] dark:text-[hsl(var(--accent))]'
                  )}>
                    {notification.isRead ? <Inbox size={18} /> : <BellRing size={18} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 mb-1">
                      <h4 className={cx("text-sm font-bold truncate", !notification.isRead ? "text-[hsl(var(--foreground))]" : "text-[hsl(var(--foreground)/.8)]")}>
                        {notification.title}
                      </h4>
                      <div className="flex items-center gap-2 shrink-0">
                        <StatusPill value={notification.severity} />
                        <span className="text-[11px] font-medium text-[hsl(var(--muted-foreground))] whitespace-nowrap">
                          {date(notification.createdAt)} at {time(notification.createdAt)}
                        </span>
                      </div>
                    </div>
                    <p className={cx("text-sm leading-relaxed", !notification.isRead ? "text-[hsl(var(--foreground)/.9)]" : "text-[hsl(var(--muted-foreground))]")}>
                      {notification.message}
                    </p>
                  </div>
                  {!notification.isRead && (
                    <div className="shrink-0 flex items-center">
                      <Button variant="quiet" onClick={() => handleMarkRead(notification.id)} className="h-8 w-8 p-0 rounded-full" title="Mark as read">
                        <Check size={14} />
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Bell} title="All caught up" description="You have no notifications at this time." />
          )}
        </div>
      )}
    </div>
  );
}
