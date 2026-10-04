import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { Bus, History, MapPin, ReceiptText } from 'lucide-react';
import type { TransportAssignment, TransportHistoryEntry, TransportInvoiceStatus, TransportRequest } from '@workspace/api-client-react';
import { StatusPill, cx, date } from '@/components/shared';
import { formatNaira } from './transport-logic';

export const inputCls = 'w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2.5 text-sm font-medium outline-none focus:border-[hsl(var(--primary))] disabled:opacity-60';

export function Notice({ tone = 'info', children, testId }: { tone?: 'info' | 'error' | 'success'; children: ReactNode; testId?: string }) {
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} data-testid={testId} className={cx('rounded-xl border px-4 py-3 text-sm font-medium',
      tone === 'error' && 'border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--destructive)/.08)] text-[hsl(var(--destructive))]',
      tone === 'success' && 'border-[hsl(157_37%_43%/.35)] bg-[hsl(157_37%_43%/.1)] text-[hsl(157_37%_28%)]',
      tone === 'info' && 'border-[hsl(var(--border))] bg-[hsl(var(--muted)/.5)] text-[hsl(var(--muted-foreground))]')}>{children}</div>
  );
}

export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return <div className="space-y-3 animate-pulse" aria-busy="true">{Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton h-20 rounded-2xl" />)}</div>;
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: Array<{ id: T; label: string; count?: number }> }) {
  return (
    <div role="tablist" className="mb-6 flex w-full gap-1 overflow-x-auto rounded-xl bg-[hsl(var(--muted))] p-1 md:w-fit">
      {items.map(t => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)} data-testid={`tab-transport-${t.id}`}
          className={cx('whitespace-nowrap rounded-lg px-4 py-2 text-sm font-bold transition-colors', value === t.id ? 'bg-[hsl(var(--background))] shadow-sm' : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]')}>
          {t.label}{t.count !== undefined && <span className="ml-2 text-xs opacity-60">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function HistoryList({ entries, testId = 'transport-history' }: { entries: TransportHistoryEntry[]; testId?: string }) {
  if (!entries.length) return <p className="py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">No transport changes have been recorded yet.</p>;
  const sorted = [...entries].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <ol className="relative space-y-4 border-l-2 border-[hsl(var(--border))] pl-5" data-testid={testId}>
      {sorted.map(h => (
        <li key={h.id} className="relative">
          <span className="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 border-[hsl(var(--card))] bg-[hsl(var(--primary))]" />
          <div className="flex flex-wrap items-center gap-2 text-sm font-bold">{h.eventType.replaceAll('_', ' ').toLowerCase().replace(/^./, c => c.toUpperCase())}<span className="text-xs font-medium text-[hsl(var(--muted-foreground))]">effective {date(h.effectiveDate)}</span></div>
          <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">{h.reason}</p>
          <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{h.actorName} ({h.actorRole.replaceAll('_', ' ').toLowerCase()}) - recorded {date(h.createdAt)}</div>
        </li>
      ))}
    </ol>
  );
}

export function InvoiceList({ invoices, financeHref, financeLabel = 'Open in Finance' }: { invoices: TransportInvoiceStatus[]; financeHref?: string; financeLabel?: string }) {
  if (!invoices.length) return <p className="text-sm text-[hsl(var(--muted-foreground))]">No transport invoice has been issued. Fees follow the existing school fee process.</p>;
  return (
    <div className="space-y-2" data-testid="transport-invoices">
      {invoices.map(i => (
        <div key={i.invoiceId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[hsl(var(--border))] p-3 text-sm">
          <div><div className="font-bold">{i.invoiceNumber}</div><div className="text-xs text-[hsl(var(--muted-foreground))]">Due {date(i.dueDate)}</div></div>
          <div className="text-right"><div className="font-bold">{formatNaira(i.paidMinor)} of {formatNaira(i.totalMinor)}</div><div className="text-xs text-[hsl(var(--muted-foreground))]">Outstanding {formatNaira(i.outstandingMinor)}</div></div>
          <StatusPill value={i.status} />
        </div>
      ))}
      {financeHref && <Link href={financeHref} className="inline-flex items-center gap-1.5 pt-1 text-xs font-bold text-[hsl(var(--primary))] hover:underline"><ReceiptText size={14} />{financeLabel}</Link>}
    </div>
  );
}

export function AssignmentSummary({ a }: { a: Pick<TransportAssignment, 'busName' | 'registrationNumber' | 'routeName' | 'driverName' | 'pickup' | 'dropoff' | 'schedule' | 'feeMinor' | 'status'> }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2" data-testid="transport-assignment-summary">
      <div className="rounded-2xl bg-[hsl(var(--secondary))] p-4">
        <div className="eyebrow flex items-center gap-1.5"><Bus size={13} />Bus and route</div>
        <div className="mt-2 font-bold">{a.busName} <span className="font-medium text-[hsl(var(--muted-foreground))]">({a.registrationNumber})</span></div>
        <div className="text-sm">{a.routeName}</div>
        <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Driver: {a.driverName}{(a as { driverPhone?: string | null }).driverPhone ? ` - ${(a as { driverPhone?: string | null }).driverPhone}` : ''}</div>
      </div>
      <div className="rounded-2xl bg-[hsl(var(--secondary))] p-4">
        <div className="eyebrow flex items-center gap-1.5"><MapPin size={13} />Stops and times</div>
        <div className="mt-2 text-sm"><strong>Pickup:</strong> {a.pickup.name}</div>
        <div className="text-sm"><strong>Drop-off:</strong> {a.dropoff.name}</div>
        <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{a.schedule.departureTime} to {a.schedule.arrivalTime} - {a.schedule.weekdays.map(d => d.slice(0, 3)).join(', ')}</div>
      </div>
    </div>
  );
}

export function RequestRow({ r, children }: { r: TransportRequest; children?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] p-4" data-testid={`transport-request-${r.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-bold">{r.studentName} - {r.requestType === 'ACTIVATE' ? 'Start transport' : 'Stop transport'}</div>
        <StatusPill value={r.status} />
      </div>
      <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Requested {date(r.requestDate)} - effective {date(r.effectiveDate)}</div>
      <p className="mt-2 text-sm">{r.reason}</p>
      {r.status !== 'PENDING' && (r.schoolNote || r.schoolAction) && (
        <p className="mt-2 rounded-lg bg-[hsl(var(--muted)/.5)] p-2.5 text-xs text-[hsl(var(--muted-foreground))]">School response{r.schoolAction ? ` (${r.schoolAction.replaceAll('_', ' ').toLowerCase()})` : ''}: {r.schoolNote || 'No note'}{r.reviewedAt ? ` - ${date(r.reviewedAt)}` : ''}</p>
      )}
      {children}
    </div>
  );
}

export function SectionTitle({ icon: Icon = History, title, hint }: { icon?: typeof History; title: string; hint?: string }) {
  return <div className="mb-4 flex items-center gap-2"><Icon size={16} className="text-[hsl(var(--primary))]" /><h2 className="display-font text-lg font-bold">{title}</h2>{hint && <span className="text-xs text-[hsl(var(--muted-foreground))]">{hint}</span>}</div>;
}
