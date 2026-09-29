import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Bell, Check, ReceiptText, RefreshCw, X } from 'lucide-react';
import {
  useListMyFeePaymentNotifications, useMarkMyFeePaymentNotificationRead,
  getListMyFeePaymentNotificationsQueryKey,
  getListParentFeeInvoicesQueryKey, getListParentFeePaymentsQueryKey,
  getListStudentFeeInvoicesQueryKey, getListStudentFeePaymentsQueryKey,
  getGetFeePaymentReceiptQueryKey, getGetSchoolFinanceSummaryQueryKey,
  getListFeeInvoicesQueryKey, getListSchoolFinancePaymentsQueryKey,
} from '@workspace/api-client-react';
import type { FeePaymentHistory, FeeReceipt } from '@workspace/api-client-react';

type Audience = 'parent' | 'student' | 'school';
const money = (minor: number) => `₦${(BigInt(minor) / 100n).toLocaleString('en-NG')}.${String(BigInt(minor) % 100n).padStart(2, '0')}`;
const eventLabels: Record<string, string> = {
  PAYMENT_VERIFIED: 'Payment verified',
  PAYMENT_REJECTED: 'Payment rejected',
  REFUND_APPROVED: 'Refund approved',
  REVERSAL_APPROVED: 'Reversal approved',
};
const eventLabel = (eventType: string) => eventLabels[eventType]
  ?? eventType.toLowerCase().split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');

export function FeePaymentNotifications({ audience, schoolId }: { audience: Audience; schoolId?: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const container = useRef<HTMLDivElement>(null);
  const seen = useRef<{ scope: string; ids: Set<number> }>({ scope: '', ids: new Set() });
  const params = audience === 'school' ? { schoolId } : undefined;
  const queryKey = getListMyFeePaymentNotificationsQueryKey(params);
  const query = useListMyFeePaymentNotifications(params, {
    query: { enabled: audience !== 'school' || !!schoolId, queryKey, refetchInterval: 15000, refetchOnWindowFocus: true },
  });
  const mark = useMarkMyFeePaymentNotificationRead();
  const items = (query.data ?? []).filter(item => audience !== 'school' || item.schoolId === schoolId);
  const unread = items.filter(item => !item.isRead).length;
  const eventTypes = Array.from(new Set(items.map(item => eventLabel(item.eventType))));
  useEffect(() => {
    const scope = `${audience}:${audience === 'school' ? schoolId : 'own'}`;
    if (seen.current.scope !== scope) seen.current = { scope, ids: new Set() };
    if (!query.data || !query.dataUpdatedAt) return;
    const newlySeen = query.data.filter(item =>
      (audience !== 'school' || item.schoolId === schoolId)
      && !seen.current.ids.has(item.id));
    if (!newlySeen.length) return;
    // Record IDs before invalidation. Mark-read and subsequent polls return the same
    // events, so neither one can trigger a refetch loop.
    for (const item of newlySeen) seen.current.ids.add(item.id);
    const tasks: Promise<unknown>[] = [];
    if (audience === 'parent' || audience === 'student') {
      const paymentKey = audience === 'parent' ? getListParentFeePaymentsQueryKey() : getListStudentFeePaymentsQueryKey();
      tasks.push(qc.invalidateQueries({ queryKey: audience === 'parent' ? getListParentFeeInvoicesQueryKey() : getListStudentFeeInvoicesQueryKey() }));
      // Notifications carry no payment ID. Only refresh receipt IDs already belonging
      // to this recipient's cached payment history and matching the event's school.
      const ownPayments = qc.getQueryData<FeePaymentHistory[]>(paymentKey) ?? [];
      const paymentIds = new Set(ownPayments.filter(payment =>
        newlySeen.some(event => event.schoolId === payment.schoolId
          && event.paymentReference === payment.reference
          && event.invoiceNumber === payment.invoiceNumber
          && event.receiptNumber === payment.receiptNumber)).map(payment => payment.id));
      for (const id of paymentIds) tasks.push(qc.invalidateQueries({ queryKey: getGetFeePaymentReceiptQueryKey(id) }));
      // A cached receipt may predate its matching payment-history refresh. Restrict
      // any such invalidation to an exact receipt number and school from the event.
      tasks.push(qc.invalidateQueries({ predicate: cached => {
        const data = cached.state.data as FeeReceipt | undefined;
        return typeof cached.queryKey[0] === 'string'
          && /^\/api\/finance\/payments\/\d+\/receipt$/.test(cached.queryKey[0])
          && !!data && newlySeen.some(event => event.schoolId === data.schoolId && event.receiptNumber === data.receiptNumber);
      } }));
      tasks.push(qc.invalidateQueries({ queryKey: paymentKey }));
    } else if (schoolId) {
      const params = { schoolId };
      tasks.push(qc.invalidateQueries({ queryKey: getGetSchoolFinanceSummaryQueryKey(params) }));
      tasks.push(qc.invalidateQueries({ queryKey: getListFeeInvoicesQueryKey(params) }));
      tasks.push(qc.invalidateQueries({ queryKey: getListSchoolFinancePaymentsQueryKey(params) }));
    }
    void Promise.all(tasks);
  }, [query.dataUpdatedAt, audience, schoolId, qc]);
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const markRead = async (id: number) => {
    try {
      await mark.mutateAsync({ notificationId: id });
      setError('');
      await qc.invalidateQueries({ queryKey });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not mark this notification as read.');
      query.refetch();
    }
  };
  const href = audience === 'parent' ? '/' : audience === 'student' ? '/my-fees' : '/finance';
  const destination = audience === 'parent' ? 'Open linked children and fees' : audience === 'student' ? 'View my fees and receipts' : 'Open school finance';
  return <div className="relative" ref={container}>
    <button type="button" onClick={() => setOpen(current => !current)} aria-label={`Payment notifications, ${unread} unread`} aria-expanded={open} aria-controls="fee-payment-notifications-panel" className="relative grid h-10 w-10 place-items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))] transition-colors hover:border-[hsl(var(--primary)/.4)] hover:text-[hsl(var(--primary))]" data-testid="button-fee-notifications">
      <Bell size={18} />{unread > 0 && <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-[hsl(var(--primary))] px-1 text-[10px] font-bold text-[hsl(var(--primary-foreground))]" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
    </button>
    {open && <div id="fee-payment-notifications-panel" role="region" aria-label="Payment notifications" className="fixed inset-x-4 top-[75px] z-50 max-h-[min(70dvh,560px)] overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[390px]">
      <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-4 py-3"><div><div className="eyebrow">Payment notifications</div><h2 className="display-font mt-1 text-base font-bold">{unread} unread</h2><p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]" data-testid="text-payment-notification-event-types">Event types: {eventTypes.length ? eventTypes.join(', ') : 'Payment verified'}</p></div><div className="flex items-center gap-1"><button type="button" onClick={() => query.refetch()} aria-label="Refresh payment notifications" className="rounded-lg p-2 hover:bg-[hsl(var(--muted))]"><RefreshCw size={15} /></button><button type="button" onClick={() => setOpen(false)} aria-label="Close payment notifications" className="rounded-lg p-2 hover:bg-[hsl(var(--muted))]"><X size={16} /></button></div></div>
       <div className="max-h-[min(58dvh,460px)] overflow-y-auto">
        {query.isLoading ? <div className="space-y-3 p-4" aria-label="Loading notifications"><div className="skeleton h-20 rounded-xl" /><div className="skeleton h-20 rounded-xl" /></div> :
          query.isError ? <div className="p-6 text-center"><p className="text-sm font-semibold">Payment alerts could not be loaded.</p><button type="button" onClick={() => query.refetch()} className="mt-3 text-sm font-bold text-[hsl(var(--primary))] underline">Retry</button></div> :
            !items.length ? <div className="p-8 text-center"><ReceiptText size={24} className="mx-auto text-[hsl(var(--primary))]" /><p className="display-font mt-3 font-bold">No payment alerts yet</p><p className="mt-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]">Payment verifications, rejections, approved refunds, and approved reversals will appear here.</p></div> :
           <div className="divide-y divide-[hsl(var(--border))]">{items.map(item => <article key={item.id} className={`p-4 ${item.isRead ? '' : 'bg-[hsl(var(--secondary)/.45)]'}`}>
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2 text-sm font-bold"><ReceiptText size={15} className="shrink-0 text-[hsl(var(--primary))]" />{eventLabel(item.eventType)} · {money(item.eventAmountMinor)}</div><p className="mt-1 break-words text-xs font-medium">{item.studentName} · {item.invoiceNumber}</p>{item.refundId !== null && <p className="mt-1 text-xs font-medium">Refund/reversal reference #{item.refundId}</p>}<p className="mt-1 break-all font-mono text-[11px] text-[hsl(var(--muted-foreground))]">{item.eventType === 'PAYMENT_VERIFIED' ? 'Receipt' : 'Payment reference'} {item.receiptNumber} · {item.paymentReference}</p><p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">School #{item.schoolId} · {new Date(item.createdAt).toLocaleString('en-NG')}</p></div>{!item.isRead && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[hsl(var(--primary))]" aria-label="Unread" />}</div>
            <div className="mt-3 flex flex-wrap items-center gap-3"><Link href={href} onClick={() => setOpen(false)} className="text-xs font-bold text-[hsl(var(--primary))] underline">{destination}</Link>{!item.isRead && <button type="button" disabled={mark.isPending} onClick={() => markRead(item.id)} className="inline-flex items-center gap-1 text-xs font-bold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))] disabled:opacity-50" aria-label={`Mark notification for receipt ${item.receiptNumber} as read`}><Check size={13} />Mark read</button>}</div>
          </article>)}</div>}
      </div>
      {error && <p role="alert" className="border-t border-[hsl(var(--border))] p-3 text-xs text-[hsl(var(--destructive))]">{error}</p>}
    </div>}
  </div>;
}