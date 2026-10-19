import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetAccountApplications, useDecideAccountApplication, getGetAccountApplicationsQueryKey,
} from '@workspace/api-client-react';
import { applyErrorMessage, notificationCopy } from '@/lib/application-intent';

type Filter = 'PENDING' | 'APPROVED' | 'REJECTED';

export default function AccountApplicationsPanel() {
  const qc = useQueryClient();
  const q = useGetAccountApplications();
  const decide = useDecideAccountApplication();
  const [filter, setFilter] = useState<Filter>('PENDING');
  const [confirm, setConfirm] = useState<{ id: number; status: 'APPROVED' | 'REJECTED' } | null>(null);
  const [reason, setReason] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<number, string>>({});

  const rows = (q.data ?? []).filter(a => a.status === filter);
  const run = () => {
    if (!confirm) return;
    if (confirm.status === 'REJECTED' && !reason.trim()) return;
    const { id, status } = confirm;
    setBusyId(id);
    setErrors(p => { const n = { ...p }; delete n[id]; return n; });
    decide.mutate({ applicationId: id, data: status === 'REJECTED' ? { status, reason: reason.trim() } : { status } }, {
      onSuccess: () => { setConfirm(null); setReason(''); void qc.invalidateQueries({ queryKey: getGetAccountApplicationsQueryKey() }); },
      onError: err => setErrors(p => ({ ...p, [id]: applyErrorMessage(err) })),
      onSettled: () => setBusyId(null),
    });
  };

  return (
    <section className="panel min-w-0 mt-8 p-4 md:p-8" data-testid="section-account-applications">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div><div className="eyebrow">New Users</div><h2 className="display-font mt-2 text-2xl font-bold">Applications</h2></div>
        <button type="button" data-testid="button-refresh-applications" className="rounded-xl border border-[hsl(var(--border))] px-4 py-2 text-sm font-bold" onClick={() => void q.refetch()} disabled={q.isFetching}>
          {q.isFetching ? 'Refreshing…' : 'Refresh list'}
        </button>
      </div>
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Application status">
        {(['PENDING', 'APPROVED', 'REJECTED'] as Filter[]).map(s => (
          <button key={s} type="button" role="tab" aria-selected={filter === s} data-testid={`filter-${s.toLowerCase()}`} onClick={() => setFilter(s)}
            className={`rounded-full px-3 py-1.5 text-xs font-bold ${filter === s ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'border border-[hsl(var(--border))]'}`}>
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </button>
        ))}
      </div>
      {q.isLoading ? <div role="status" className="text-sm">Loading applications…</div>
        : q.isError ? <div className="text-sm text-[hsl(var(--destructive))]">Could not load applications. <button type="button" className="font-bold underline" onClick={() => void q.refetch()}>Retry</button></div>
        : rows.length === 0 ? <div className="rounded-xl bg-[hsl(var(--muted)/.3)] p-6 text-center text-sm">No {filter.toLowerCase()} applications.</div>
        : <ul className="space-y-3">{rows.map(a => (
          <li key={a.id} data-testid={`row-application-${a.id}`} className="min-w-0 break-words rounded-xl border border-[hsl(var(--border))] p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>{a.firstName} {a.lastName}</strong>
              <span className="text-xs font-bold">{a.applicantType === 'SCHOOL_ADMIN' ? 'School Admin' : 'Partner'}</span>
            </div>
            <div className="mt-1 text-[hsl(var(--muted-foreground))]">{a.email} · {a.phone} · {a.city}, {a.state}</div>
            {a.schoolName && <div>School: {a.schoolName}</div>}
            {a.businessName && <div>Business: {a.businessName}</div>}
            {a.address && <div>Address: {a.address}</div>}
            <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Applied {new Date(a.createdAt).toLocaleString()}</div>
            {a.status !== 'PENDING' && (
              <div className="mt-2 text-xs">
                <div>Reviewed by {a.reviewerName ?? 'unknown'}{a.reviewedAt ? ` on ${new Date(a.reviewedAt).toLocaleString()}` : ''}</div>
                {a.rejectionReason && <div>Reason: {a.rejectionReason}</div>}
                <div data-testid={`text-notification-${a.id}`}>{notificationCopy(a.notificationStatus)}</div>
              </div>
            )}
            {errors[a.id] && <p role="alert" className="mt-2 text-xs text-[hsl(var(--destructive))]">{errors[a.id]}</p>}
            {a.status === 'PENDING' && (confirm?.id === a.id ? (
              <div className="mt-3 rounded-lg bg-[hsl(var(--secondary))] p-3">
                <p className="font-semibold">{confirm.status === 'APPROVED' ? 'Approve this application?' : 'Reject this application?'}</p>
                {confirm.status === 'REJECTED' && (
                  <textarea data-testid="input-rejection-reason" aria-label="Rejection reason" maxLength={1000} className="mt-2 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2" placeholder="Reason (required)" value={reason} onChange={e => setReason(e.target.value)} />
                )}
                <div className="mt-2 flex gap-2">
                  <button type="button" data-testid="button-confirm-decision" disabled={busyId === a.id || (confirm.status === 'REJECTED' && !reason.trim())} onClick={run} className="rounded-lg bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-bold text-[hsl(var(--primary-foreground))]">
                    {busyId === a.id ? 'Saving…' : 'Confirm'}
                  </button>
                  <button type="button" disabled={busyId === a.id} onClick={() => { setConfirm(null); setReason(''); }} className="rounded-lg border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-bold">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex gap-2">
                <button type="button" data-testid={`button-approve-${a.id}`} disabled={busyId !== null} onClick={() => { setConfirm({ id: a.id, status: 'APPROVED' }); setReason(''); }} className="rounded-lg bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-bold text-[hsl(var(--primary-foreground))]">Approve</button>
                <button type="button" data-testid={`button-reject-${a.id}`} disabled={busyId !== null} onClick={() => { setConfirm({ id: a.id, status: 'REJECTED' }); setReason(''); }} className="rounded-lg border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-bold">Reject</button>
              </div>
            ))}
          </li>))}</ul>}
    </section>
  );
}
