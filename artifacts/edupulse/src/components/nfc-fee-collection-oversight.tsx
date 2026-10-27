import { useState, type FormEvent } from 'react';
import { Receipt } from 'lucide-react';
import {
  useGetAuthorizedContext, useGetNfcFeeCollectionOversight, getGetNfcFeeCollectionOversightQueryKey,
} from '@workspace/api-client-react';
import type { GetNfcFeeCollectionOversightParams, NfcFeeCollectionRow } from '@workspace/api-client-react';
import { Button, EmptyState, ErrorState, SkeletonPage } from '@/components/shared';
import { Freshness, entry, note, FRESH_MS } from '@/pages/payroll-common';

export const OVERSIGHT_STATUSES = ['FULLY_PAID', 'PARTIALLY_PAID', 'UNPAID', 'PENDING_EVIDENCE', 'UNDER_REVIEW', 'REJECTED', 'NOT_CONFIGURED', 'CANCELLED', 'REVIEW_REQUIRED'] as const;
type Status = typeof OVERSIGHT_STATUSES[number];
export const PAGE_SIZE = 25;

export const STATUS_TEXT: Record<string, string> = {
  FULLY_PAID: 'Fully paid (school confirmed)',
  PARTIALLY_PAID: 'Partially paid, balance outstanding',
  UNPAID: 'Unpaid',
  PENDING_EVIDENCE: 'Pending evidence from parent',
  UNDER_REVIEW: 'Under school review, receipt pending',
  REJECTED: 'Rejected by school',
  NOT_CONFIGURED: 'No fee assigned (not paid, not free)',
  CANCELLED: 'Cancelled',
  REVIEW_REQUIRED: 'Review required (zero/waived/legacy)',
};
const TONE: Record<string, string> = {
  FULLY_PAID: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  PARTIALLY_PAID: 'border-amber-300 bg-amber-50 text-amber-900',
  PENDING_EVIDENCE: 'border-amber-300 bg-amber-50 text-amber-900',
  UNDER_REVIEW: 'border-sky-300 bg-sky-50 text-sky-900',
  REVIEW_REQUIRED: 'border-amber-400 bg-amber-100 text-amber-950',
  REJECTED: 'border-rose-300 bg-rose-50 text-rose-800',
  UNPAID: 'border-rose-200 bg-rose-50 text-rose-800',
};
export const statusLabel = (s: string) => STATUS_TEXT[s] ?? s.replaceAll('_', ' ').toLowerCase();

export function formatMinor(minor: number | null | undefined, currency = 'NGN') {
  if (minor == null) return 'Not configured';
  return `${currency} ${(minor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Actor-isolated cache key: one signed-in identity never reads another's cached rows. */
export const oversightQueryKey = (params: GetNfcFeeCollectionOversightParams, userId: number | string | undefined) =>
  [...getGetNfcFeeCollectionOversightQueryKey(params), `actor:${userId ?? 'unknown'}`] as const;

/** Neutralise spreadsheet formula injection, then RFC4180-quote. */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replaceAll('"', '""')}"`;
}

export function toOversightCsv(rows: NfcFeeCollectionRow[]): string {
  const head = ['School ID', 'School', 'Student ID', 'Student', 'Admission no', 'Term ID', 'Term', 'Invoice ID', 'Line ID', 'Fee', 'Amount (minor)', 'Paid (minor)', 'Currency', 'Status', 'Invoice status', 'Payment references', 'Receipt numbers', 'Payment methods', 'Payment dates', 'Payment amounts (minor)', 'Payment statuses', 'Recorded by', 'Reviewed by'];
  const join = (r: NfcFeeCollectionRow, f: (p: NfcFeeCollectionRow['payments'][number]) => unknown) => r.payments.map(p => String(f(p) ?? '')).join(' | ');
  const lines = rows.map(r => [
    r.schoolId, r.schoolName, r.studentId, r.studentName, r.admissionNo, r.termId, r.termName, r.invoiceId, r.lineId, r.feeName,
    r.amountMinor == null ? 'NOT_CONFIGURED' : r.amountMinor, r.paidMinor, r.currency, r.status, r.invoiceStatus,
    join(r, p => p.reference), join(r, p => p.receiptNumber), join(r, p => p.method), join(r, p => p.date), join(r, p => p.amountMinor),
    join(r, p => p.status), join(r, p => p.recordedBy ?? 'unknown'), join(r, p => p.reviewedBy ?? 'not reviewed'),
  ].map(csvCell).join(','));
  return [head.map(csvCell).join(','), ...lines].join('\r\n');
}

function downloadCsv(rows: NfcFeeCollectionRow[]) {
  const url = URL.createObjectURL(new Blob([toOversightCsv(rows)], { type: 'text/csv;charset=utf-8' }));
  try {
    const a = document.createElement('a');
    a.href = url; a.download = `nfc-fee-collection-oversight-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  } finally { setTimeout(() => URL.revokeObjectURL(url), 0); }
}

const when = (d?: string | null) => { if (!d) return '—'; const t = new Date(d); return Number.isNaN(t.getTime()) ? d : t.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }); };

export function StatusBadge({ status, testId }: { status: string; testId?: string }) {
  return <span className={`inline-flex rounded-md border px-2 py-0.5 font-mono text-[11px] font-bold ${TONE[status] ?? 'border-[hsl(var(--border))] bg-[hsl(var(--secondary))]'}`} title={statusLabel(status)} data-testid={testId}>{status}</span>;
}

export function OversightWarning() {
  return <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="note" data-testid="nfc-oversight-warning">
    <div className="mb-1 font-bold">Read-only oversight of parent-to-school NFC fee collection</div>
    <ul className="list-disc space-y-1 pl-5">
      <li>These rows are parent-to-school collections only. They are not the separate NGN 3,200 school-to-Yetenia platform payment.</li>
      <li>A receipt stays pending until the school confirms the payment. Partially paid is not fully paid.</li>
      <li>Neither a fee status nor a bank attestation activates a card.</li>
      <li>NOT_CONFIGURED means no fee is assigned. It does not mean paid or free. Zero or waived rows show as REVIEW_REQUIRED.</li>
      <li>The Platform Owner cannot edit fee or payment status here. School Admin or an authorized accountant review remains unchanged.</li>
    </ul>
  </div>;
}

function Payments({ row }: { row: NfcFeeCollectionRow }) {
  if (!row.payments.length) return <span className={note}>No payments recorded</span>;
  return <ul className="space-y-2">{row.payments.map(p => <li key={p.id} className="rounded-lg border border-[hsl(var(--border))] p-2 text-xs" data-testid={`payment-${p.id}`}>
    <div className="flex flex-wrap items-center gap-2"><span className="font-mono font-bold" data-testid={`payment-ref-${p.id}`}>{p.reference}</span><StatusBadge status={p.status} testId={`payment-status-${p.id}`} /></div>
    <div className="mt-1 text-[hsl(var(--muted-foreground))]">{formatMinor(p.amountMinor, row.currency)} · {p.method} · {when(p.date)}</div>
    <div className="text-[hsl(var(--muted-foreground))]">Receipt: <span className="font-mono">{p.receiptNumber ?? 'pending school confirmation'}</span></div>
    <div data-testid={`payment-actors-${p.id}`}>Recorded by {p.recordedBy ?? 'unknown'} · Reviewed by {p.reviewedBy ?? 'not yet reviewed'}</div>
  </li>)}</ul>;
}

const rowKey = (r: NfcFeeCollectionRow, i: number) => `${r.schoolId}-${r.studentId}-${r.termId}-${r.invoiceId ?? 'x'}-${r.lineId ?? i}`;

export function OversightRows({ rows }: { rows: NfcFeeCollectionRow[] }) {
  return <>
    <div className="hidden overflow-x-auto lg:block"><table className="w-full text-sm" data-testid="nfc-oversight-table">
      <thead className="bg-[hsl(var(--secondary))] text-left"><tr className="eyebrow">{['School', 'Student', 'Term', 'Fee line', 'Amount', 'Paid', 'Status', 'Payments'].map(h => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
      <tbody className="divide-y divide-[hsl(var(--border))]">{rows.map((r, i) => <tr key={rowKey(r, i)} className="align-top" data-testid={`nfc-oversight-row-${i}`}>
        <td className="px-3 py-3"><div className="font-bold">{r.schoolName}</div><div className={note}>ID {r.schoolId}</div></td>
        <td className="px-3 py-3"><div className="font-bold">{r.studentName}</div><div className={note}>{r.admissionNo} · ID {r.studentId}</div></td>
        <td className="px-3 py-3">{r.termName}<div className={note}>ID {r.termId}</div></td>
        <td className="px-3 py-3">{r.feeName ?? '—'}<div className={note}>Invoice {r.invoiceId ?? '—'} / line {r.lineId ?? '—'} · <StatusBadge status={r.invoiceStatus} /></div></td>
        <td className="px-3 py-3 font-mono" data-testid={`amount-${i}`}>{formatMinor(r.amountMinor, r.currency)}</td>
        <td className="px-3 py-3 font-mono">{formatMinor(r.paidMinor, r.currency)}</td>
        <td className="px-3 py-3"><StatusBadge status={r.status} testId={`status-${i}`} /><div className={`${note} mt-1 max-w-[180px]`}>{statusLabel(r.status)}</div></td>
        <td className="min-w-[260px] px-3 py-3"><Payments row={r} /></td>
      </tr>)}</tbody></table></div>
    <div className="divide-y divide-[hsl(var(--border))] lg:hidden">{rows.map((r, i) => <div key={rowKey(r, i)} className="space-y-2 p-4" data-testid={`nfc-oversight-card-${i}`}>
      <div className="flex flex-wrap items-start justify-between gap-2"><div><div className="font-bold">{r.studentName}</div><div className={note}>{r.admissionNo} · {r.schoolName} (ID {r.schoolId})</div></div><StatusBadge status={r.status} /></div>
      <p className={note}>{statusLabel(r.status)}</p>
      <div className="grid grid-cols-2 gap-2 text-xs"><div>Term: {r.termName}</div><div>Fee: {r.feeName ?? '—'}</div><div>Amount: <span className="font-mono">{formatMinor(r.amountMinor, r.currency)}</span></div><div>Paid: <span className="font-mono">{formatMinor(r.paidMinor, r.currency)}</span></div><div>Invoice {r.invoiceId ?? '—'} / line {r.lineId ?? '—'}</div><div>Invoice: {r.invoiceStatus}</div></div>
      <Payments row={r} />
    </div>)}</div>
  </>;
}

export function NfcFeeCollectionOversight() {
  const ctx = useGetAuthorizedContext();
  const userId = ctx.data?.user?.id;
  const [draft, setDraft] = useState({ search: '', schoolId: '', termId: '' });
  const [applied, setApplied] = useState(draft);
  const [status, setStatus] = useState<'all' | Status>('all');
  const [page, setPage] = useState(0);
  const pos = (v: string) => { const n = Number(v.trim()); return v.trim() && Number.isInteger(n) && n > 0 ? n : undefined; };
  const params: GetNfcFeeCollectionOversightParams = {
    limit: PAGE_SIZE, offset: page * PAGE_SIZE,
    ...(applied.search.trim() ? { search: applied.search.trim().slice(0, 100) } : {}),
    ...(pos(applied.schoolId) ? { schoolId: pos(applied.schoolId) } : {}),
    ...(pos(applied.termId) ? { termId: pos(applied.termId) } : {}),
    ...(status !== 'all' ? { status } : {}),
  };
  const q = useGetNfcFeeCollectionOversight(params, { query: { queryKey: oversightQueryKey(params, userId), enabled: userId != null, staleTime: FRESH_MS, refetchInterval: FRESH_MS } });
  const rows = q.data?.items ?? [];
  const total = q.data?.total ?? 0;
  const submit = (e: FormEvent) => { e.preventDefault(); setApplied(draft); setPage(0); };
  return <section className="panel overflow-hidden" data-testid="nfc-fee-collection-oversight">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--border))] p-4">
      <div><div className="eyebrow">Read only</div><h2 className="display-font text-xl font-bold">NFC Fee Collection Oversight</h2></div>
      <div className="flex flex-wrap items-center gap-2">
        <Freshness updatedAt={q.dataUpdatedAt} fetching={q.isFetching} onRefresh={() => q.refetch()} />
        <Button variant="outline" disabled={!rows.length} onClick={() => downloadCsv(rows)} testId="button-export-oversight-csv">Export this page (CSV)</Button>
      </div>
    </div>
    <div className="p-4 pb-0"><OversightWarning /></div>
    <form onSubmit={submit} className="flex flex-wrap gap-2 px-4 pb-4">
      <input className={`${entry} max-w-xs`} maxLength={100} placeholder="Search school, student, admission no" aria-label="Search" value={draft.search} onChange={e => setDraft(d => ({ ...d, search: e.target.value }))} data-testid="input-oversight-search" />
      <input className={`${entry} max-w-[120px]`} inputMode="numeric" placeholder="School ID" aria-label="School ID" value={draft.schoolId} onChange={e => setDraft(d => ({ ...d, schoolId: e.target.value }))} data-testid="input-oversight-school" />
      <input className={`${entry} max-w-[120px]`} inputMode="numeric" placeholder="Term ID" aria-label="Term ID" value={draft.termId} onChange={e => setDraft(d => ({ ...d, termId: e.target.value }))} data-testid="input-oversight-term" />
      <select className={`${entry} max-w-[220px]`} value={status} onChange={e => { setStatus(e.target.value as typeof status); setPage(0); }} aria-label="Status filter" data-testid="select-oversight-status">
        <option value="all">All statuses</option>{OVERSIGHT_STATUSES.map(s => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}
      </select>
      <Button type="submit" variant="outline" testId="button-oversight-apply">Apply</Button>
      <Button variant="quiet" onClick={() => { const b = { search: '', schoolId: '', termId: '' }; setDraft(b); setApplied(b); setStatus('all'); setPage(0); }}>Clear</Button>
    </form>
    <p className={`${note} px-4 pb-3`}>Each row is one immutable school fee invoice line. A student can appear on several historical rows. Private files, proof images, parent contacts and bank details are never shown or exported.</p>
    {ctx.isLoading || q.isLoading ? <SkeletonPage /> : q.isError || ctx.isError ? <ErrorState retry={() => { ctx.refetch(); q.refetch(); }} /> : !rows.length
      ? <EmptyState icon={Receipt} title="No fee lines match" description="Adjust the search, school ID, term ID or status filter." />
      : <OversightRows rows={rows} />}
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--border))] p-4 text-sm">
      <span data-testid="text-oversight-range">{total ? `${page * PAGE_SIZE + 1}–${Math.min(total, page * PAGE_SIZE + rows.length)} of ${total}` : '0 rows'}</span>
      <div className="flex gap-2"><Button variant="outline" disabled={page === 0 || q.isFetching} onClick={() => setPage(p => Math.max(0, p - 1))} testId="button-oversight-prev">Previous</Button>
        <Button variant="outline" disabled={(page + 1) * PAGE_SIZE >= total || q.isFetching} onClick={() => setPage(p => p + 1)} testId="button-oversight-next">Next</Button></div>
    </div>
  </section>;
}
