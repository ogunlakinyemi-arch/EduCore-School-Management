import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Bell, Check, ReceiptText, RefreshCw, X } from 'lucide-react';
import {
  useListMyFeePaymentNotifications, useMarkMyFeePaymentNotificationRead,
  useListMyFeeInvoiceNotifications, useMarkMyFeeInvoiceNotificationRead,
  getListMyFeePaymentNotificationsQueryKey, getListMyFeeInvoiceNotificationsQueryKey,
  getListParentFeeInvoicesQueryKey, getListParentFeePaymentsQueryKey,
  getListStudentFeeInvoicesQueryKey, getListStudentFeePaymentsQueryKey,
  getGetFeePaymentReceiptQueryKey, getGetSchoolFinanceSummaryQueryKey,
  getListFeeInvoicesQueryKey, getListSchoolFinancePaymentsQueryKey,
} from '@workspace/api-client-react';
import type { FeeInvoiceNotification, FeePaymentHistory, FeePaymentNotification, FeeReceipt } from '@workspace/api-client-react';

type Audience = 'parent' | 'student' | 'school';
type Notice = { kind: 'payment'; item: FeePaymentNotification } | { kind: 'invoice'; item: FeeInvoiceNotification };
const money = (minor: number) => `₦${(BigInt(minor) / 100n).toLocaleString('en-NG')}.${String(BigInt(minor) % 100n).padStart(2, '0')}`;
const eventLabels: Record<string, string> = {
  PAYMENT_VERIFIED: 'Payment verified',
  PAYMENT_REJECTED: 'Payment rejected',
  PROVIDER_CHECKOUT_INITIATED: 'Online checkout initiated',
  PROVIDER_CHECKOUT_PROCESSING: 'Online payment processing',
  PROVIDER_PAYMENT_FAILED: 'Online payment failed',
  MANUAL_TRANSFER_SUBMITTED: 'Manual bank transfer submitted',
  MANUAL_TRANSFER_APPROVED: 'Manual bank transfer approved',
  MANUAL_TRANSFER_REJECTED: 'Manual bank transfer rejected',
  REFUND_APPROVED: 'Refund approved',
  REVERSAL_APPROVED: 'Reversal approved',
};
const eventLabel = (eventType: string, method?: string) => {
  if (method === 'BANK_TRANSFER' && eventType === 'PAYMENT_VERIFIED') return 'Manual bank transfer approved';
  if (method === 'BANK_TRANSFER' && eventType === 'PAYMENT_REJECTED') return 'Manual bank transfer rejected';
  return eventLabels[eventType]
    ?? eventType.toLowerCase().split('_').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
};

export function FeePaymentNotifications({ audience, schoolId }: { audience: Audience; schoolId?: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const container = useRef<HTMLDivElement>(null);
  const seen = useRef<{ scope: string; ids: Set<string> }>({ scope: '', ids: new Set() });
  const params = audience === 'school' ? { schoolId } : undefined;
  const paymentQueryKey = getListMyFeePaymentNotificationsQueryKey(params);
  const invoiceQueryKey = getListMyFeeInvoiceNotificationsQueryKey(params);
  const queryOptions = { enabled: audience !== 'school' || !!schoolId, refetchInterval: 15000, refetchOnWindowFocus: true };
  const paymentQuery = useListMyFeePaymentNotifications(params, {
    query: { ...queryOptions, queryKey: paymentQueryKey },
  });
  const invoiceQuery = useListMyFeeInvoiceNotifications(params, {
    query: { ...queryOptions, queryKey: invoiceQueryKey },
  });
  const markPayment = useMarkMyFeePaymentNotificationRead();
  const markInvoice = useMarkMyFeeInvoiceNotificationRead();
  const payments = (paymentQuery.data ?? []).filter(item => audience !== 'school' || item.schoolId === schoolId);
  const invoices = (invoiceQuery.data ?? []).filter(item => audience !== 'school' || item.schoolId === schoolId);
  const items: Notice[] = [
    ...payments.map(item => ({ kind: 'payment' as const, item })),
    ...invoices.map(item => ({ kind: 'invoice' as const, item })),
  ].sort((a, b) => new Date(b.item.createdAt).getTime() - new Date(a.item.createdAt).getTime());
  const unread = items.filter(({ item }) => !item.isRead).length;
  const eventTypes = Array.from(new Set(items.map(({ kind, item }) =>
    kind === 'invoice' ? 'Invoice generated' : eventLabel(item.eventType, item.method))));
  const refresh = () => { void Promise.all([paymentQuery.refetch(), invoiceQuery.refetch()]); };

  useEffect(() => {
    const scope = `${audience}:${audience === 'school' ? schoolId : 'own'}`;
    if (seen.current.scope !== scope) seen.current = { scope, ids: new Set() };
    if (!paymentQuery.dataUpdatedAt && !invoiceQuery.dataUpdatedAt) return;
    const newlySeenPayments = payments.filter(item => !seen.current.ids.has(`payment:${item.id}`));
    const newlySeenInvoices = invoices.filter(item => !seen.current.ids.has(`invoice:${item.id}`));
    if (!newlySeenPayments.length && !newlySeenInvoices.length) return;
    for (const item of newlySeenPayments) seen.current.ids.add(`payment:${item.id}`);
    for (const item of newlySeenInvoices) seen.current.ids.add(`invoice:${item.id}`);
    const tasks: Promise<unknown>[] = [];
    if (audience === 'parent' || audience === 'student') {
      const paymentKey = audience === 'parent' ? getListParentFeePaymentsQueryKey() : getListStudentFeePaymentsQueryKey();
      const invoiceListKey = audience === 'parent' ? getListParentFeeInvoicesQueryKey() : getListStudentFeeInvoicesQueryKey();
      tasks.push(qc.invalidateQueries({ queryKey: invoiceListKey }));
      if (newlySeenPayments.length) {
        // Payment notifications carry no payment ID; only refresh exact matching records already in this recipient's history.
        const ownPayments = qc.getQueryData<FeePaymentHistory[]>(paymentKey) ?? [];
        const paymentIds = new Set(ownPayments.filter(payment =>
          newlySeenPayments.some(event => event.schoolId === payment.schoolId
            && event.paymentReference === payment.reference
            && event.invoiceNumber === payment.invoiceNumber
            && event.receiptNumber === payment.receiptNumber)).map(payment => payment.id));
        for (const id of paymentIds) tasks.push(qc.invalidateQueries({ queryKey: getGetFeePaymentReceiptQueryKey(id) }));
        tasks.push(qc.invalidateQueries({ predicate: cached => {
          const data = cached.state.data as FeeReceipt | undefined;
          return typeof cached.queryKey[0] === 'string'
            && /^\/api\/finance\/payments\/\d+\/receipt$/.test(cached.queryKey[0])
            && !!data && newlySeenPayments.some(event => event.schoolId === data.schoolId && event.receiptNumber === data.receiptNumber);
        } }));
        tasks.push(qc.invalidateQueries({ queryKey: paymentKey }));
      }
    } else if (schoolId) {
      const schoolParams = { schoolId };
      tasks.push(qc.invalidateQueries({ queryKey: getGetSchoolFinanceSummaryQueryKey(schoolParams) }));
      tasks.push(qc.invalidateQueries({ queryKey: getListFeeInvoicesQueryKey(schoolParams) }));
      if (newlySeenPayments.length) {
        tasks.push(qc.invalidateQueries({ queryKey: getListSchoolFinancePaymentsQueryKey(schoolParams) }));
      }
    }
    void Promise.all(tasks);
  }, [paymentQuery.dataUpdatedAt, invoiceQuery.dataUpdatedAt, audience, schoolId, qc]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onPointer); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const markRead = async (notice: Notice) => {
    try {
      if (notice.kind === 'invoice') await markInvoice.mutateAsync({ notificationId: notice.item.id });
      else await markPayment.mutateAsync({ notificationId: notice.item.id });
      setError('');
      await qc.invalidateQueries({ queryKey: notice.kind === 'invoice' ? invoiceQueryKey : paymentQueryKey });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not mark this notification as read.');
      refresh();
    }
  };
  const href = audience === 'parent' ? '/' : audience === 'student' ? '/my-fees' : '/finance';
  const destination = audience === 'parent' ? 'Open linked children and fees' : audience === 'student' ? 'View my fees and receipts' : 'Open school finance';
  const isLoading = paymentQuery.isLoading || invoiceQuery.isLoading;
  const isError = paymentQuery.isError || invoiceQuery.isError;
  const markPending = markPayment.isPending || markInvoice.isPending;

  return <div className="relative" ref={container}>
    <button type="button" onClick={() => setOpen(current => !current)} aria-label={`Finance notifications, ${unread} unread`} aria-expanded={open} aria-controls="fee-payment-notifications-panel" className="relative grid h-10 w-10 place-items-center rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))] transition-colors hover:border-[hsl(var(--primary)/.4)] hover:text-[hsl(var(--primary))]" data-testid="button-fee-notifications">
      <Bell size={18} />{unread > 0 && <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-[hsl(var(--primary))] px-1 text-[10px] font-bold text-[hsl(var(--primary-foreground))]" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
    </button>
    {open && <div id="fee-payment-notifications-panel" role="region" aria-label="Finance notifications" className="fixed inset-x-4 top-[75px] z-50 max-h-[min(70dvh,560px)] overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[390px]">
      <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-4 py-3"><div><div className="eyebrow">Finance notifications</div><h2 className="display-font mt-1 text-base font-bold">{unread} unread</h2><p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]" data-testid="text-payment-notification-event-types">Event types: {eventTypes.length ? eventTypes.join(', ') : 'Payment verified'}</p></div><div className="flex items-center gap-1"><button type="button" onClick={refresh} aria-label="Refresh finance notifications" className="rounded-lg p-2 hover:bg-[hsl(var(--muted))]"><RefreshCw size={15} /></button><button type="button" onClick={() => setOpen(false)} aria-label="Close finance notifications" className="rounded-lg p-2 hover:bg-[hsl(var(--muted))]"><X size={16} /></button></div></div>
      <div className="max-h-[min(58dvh,460px)] overflow-y-auto">
        {isLoading ? <div className="space-y-3 p-4" aria-label="Loading notifications"><div className="skeleton h-20 rounded-xl" /><div className="skeleton h-20 rounded-xl" /></div> :
          isError ? <div className="p-6 text-center"><p className="text-sm font-semibold">Finance alerts could not be loaded.</p><button type="button" onClick={refresh} className="mt-3 text-sm font-bold text-[hsl(var(--primary))] underline">Retry</button></div> :
            !items.length ? <div className="p-8 text-center"><ReceiptText size={24} className="mx-auto text-[hsl(var(--primary))]" /><p className="display-font mt-3 font-bold">No finance alerts yet</p><p className="mt-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]">New invoices, online checkout updates, transfer reviews, payment verifications, refunds, and reversals will appear here.</p></div> :
              <div className="divide-y divide-[hsl(var(--border))]">{items.map(notice => {
                const { item } = notice;
                const title = notice.kind === 'invoice' ? 'Invoice generated' : eventLabel(notice.item.eventType, notice.item.method);
                const amount = notice.kind === 'invoice' ? notice.item.amountMinor : notice.item.eventAmountMinor;
                 const paymentReferenceLabel = notice.kind === 'payment'
                   && ['PAYMENT_VERIFIED', 'MANUAL_TRANSFER_APPROVED'].includes(notice.item.eventType)
                   ? 'Receipt' : 'Payment reference';
                 const referenceText = notice.kind === 'payment'
                   ? paymentReferenceLabel === 'Receipt'
                     ? `Receipt ${notice.item.receiptNumber} · Payment reference ${notice.item.paymentReference}`
                     : `Payment reference ${notice.item.paymentReference}`
                   : '';
                return <article key={`${notice.kind}:${item.id}`} className={`p-4 ${item.isRead ? '' : 'bg-[hsl(var(--secondary)/.45)]'}`}>
                  <div className="flex items-start justify-between gap-3"><div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-bold"><ReceiptText size={15} className="shrink-0 text-[hsl(var(--primary))]" />{title} · {money(amount)}</div>
                    <p className="mt-1 break-words text-xs font-medium">{item.studentName} · {item.invoiceNumber}</p>
                    {notice.kind === 'invoice'
                      ? <p className="mt-1 text-xs font-medium">Outstanding balance · {money(notice.item.outstandingMinor)}</p>
                       : <>{notice.item.refundId !== null && <p className="mt-1 text-xs font-medium">Refund/reversal reference #{notice.item.refundId}</p>}<p className="mt-1 break-all font-mono text-[11px] text-[hsl(var(--muted-foreground))]">{referenceText}</p></>}
                    <p className="mt-1 text-[11px] text-[hsl(var(--muted-foreground))]">School #{item.schoolId} · {new Date(item.createdAt).toLocaleString('en-NG')}</p>
                  </div>{!item.isRead && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-[hsl(var(--primary))]" aria-label="Unread" />}</div>
                  <div className="mt-3 flex flex-wrap items-center gap-3"><Link href={href} onClick={() => setOpen(false)} className="text-xs font-bold text-[hsl(var(--primary))] underline">{destination}</Link>{!item.isRead && <button type="button" disabled={markPending} onClick={() => markRead(notice)} className="inline-flex items-center gap-1 text-xs font-bold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))] disabled:opacity-50" aria-label={`Mark ${notice.kind} notification for ${item.invoiceNumber} as read`}><Check size={13} />Mark read</button>}</div>
                </article>;
              })}</div>}
      </div>
      {error && <p role="alert" className="border-t border-[hsl(var(--border))] p-3 text-xs text-[hsl(var(--destructive))]">{error}</p>}
    </div>}
  </div>;
}