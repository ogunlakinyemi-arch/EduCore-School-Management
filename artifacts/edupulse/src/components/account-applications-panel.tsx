import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetAccountApplications, useDecideAccountApplication, getGetAccountApplicationsQueryKey, getAccountApplications,
  useManageAccountApplicationNotification,
} from '@workspace/api-client-react';
import { applyErrorMessage, notificationCopy } from '@/lib/application-intent';

type Filter = 'PENDING' | 'APPROVED' | 'REJECTED';

export default function AccountApplicationsPanel() {
  const qc = useQueryClient();
  const q = useGetAccountApplications({ query: {
    queryKey: getGetAccountApplicationsQueryKey(),
    staleTime: 0, refetchOnMount: 'always', refetchOnWindowFocus: true, refetchInterval: 30_000,
  } });
  const decide = useDecideAccountApplication({ mutation: { retry: false } });
  const emailAction = useManageAccountApplicationNotification({ mutation: { retry: false } });
  const [emailConfirmId, setEmailConfirmId] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>('PENDING');
  const [confirm, setConfirm] = useState<{ id: number; status: 'APPROVED' | 'REJECTED' } | null>(null);
  const [reason, setReason] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [uncertainId, setUncertainId] = useState<number | null>(null);
  const running = useRef(false);

  const rows = (q.data ?? []).filter(a => a.status === filter);
  const manageEmail = async (id: number, action: 'RETRY' | 'RECONCILE') => {
    if (running.current || uncertainId !== null) return;
    running.current = true; setBusyId(id);
    setErrors(p => { const n = { ...p }; delete n[id]; return n; });
    try {
      const saved = await emailAction.mutateAsync({applicationId:id,data:{action}});
      setEmailConfirmId(null);
      setNotice(`Server notification status: ${saved.notificationDeliveryConfirmed ? 'Delivery confirmed by provider' : notificationCopy(saved.notificationStatus)}. Approval/access was not changed.`);
    } catch (error) {
      setUncertainId(id); setEmailConfirmId(null);
      setErrors(p => ({...p,[id]:`${applyErrorMessage(error)} No approval was repeated. Refresh status before another email action.`}));
    } finally {
      await qc.invalidateQueries({queryKey:getGetAccountApplicationsQueryKey()})
        .catch(() => { setUncertainId(id); setNotice('Notification status could not be refreshed. Refresh the list before another action; approval/access was not changed.'); });
      running.current = false; setBusyId(null);
    }
  };
  const refresh = async () => {
    const result = await q.refetch();
    if (!result.isError && result.data && uncertainId !== null) {
      setUncertainId(null); setConfirm(null); setEmailConfirmId(null); setErrors({});
      setNotice('List refreshed from the server. Review the current status before making another decision.');
    }
  };
  const run = async () => {
    if (!confirm || running.current || uncertainId !== null) return;
    if (confirm.status === 'REJECTED' && !reason.trim()) return;
    const { id, status } = confirm;
    running.current = true;
    setBusyId(id);
    setNotice(null);
    setErrors(p => { const n = { ...p }; delete n[id]; return n; });
    try {
      const saved = await decide.mutateAsync({ applicationId: id, data: status === 'REJECTED' ? { status, reason: reason.trim() } : { status } });
      if (saved?.id !== id || saved.status !== status) throw new Error('The server did not confirm the requested decision.');
      setConfirm(null); setReason(''); setFilter(status);
      setNotice(`Server confirmed application ${id} is ${status.toLowerCase()}.`);
      await qc.invalidateQueries({ queryKey: getGetAccountApplicationsQueryKey() })
        .catch(() => setNotice(`Server confirmed application ${id} is ${status.toLowerCase()}, but the list could not be refreshed. Use Refresh list; do not repeat the decision.`));
    } catch (err) {
      const message = applyErrorMessage(err);
      setErrors(p => ({ ...p, [id]: message }));
      setNotice(`Decision request failed: ${message}. Checking the server; no decision will be resent automatically.`);
      try {
        const queryKey = getGetAccountApplicationsQueryKey();
        // Do not let an older in-flight list request stand in for a post-failure check.
        await qc.cancelQueries({ queryKey });
        const latest = await qc.fetchQuery({ queryKey, queryFn: () => getAccountApplications(), staleTime: 0, retry: false });
        const actual = latest.find(a => a.id === id);
        if (actual && (actual.status === 'APPROVED' || actual.status === 'REJECTED')) {
          setConfirm(null); setReason(''); setFilter(actual.status);
          setErrors(p => { const n = { ...p }; delete n[id]; return n; });
          setNotice(`Decision response failed: ${message}. A fresh server check confirms application ${id} is ${actual.status.toLowerCase()}. No additional decision was sent.`);
        } else {
          setUncertainId(id);
          setNotice(`Decision not confirmed: ${message}. ${actual?.status === 'PENDING' ? 'The server currently reports Pending.' : 'The application could not be found in the fresh list.'} Refresh the list and review its status before making another decision.`);
        }
      } catch {
        setUncertainId(id);
        setNotice(`Decision not confirmed: ${message}. Server status could not be checked. Refresh the list before making another decision.`);
      }
    } finally {
      running.current = false;
      setBusyId(null);
    }
  };

  return (
    <section className="panel min-w-0 mt-8 p-4 md:p-8" data-testid="section-account-applications">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div><div className="eyebrow">New Users</div><h2 className="display-font mt-2 text-2xl font-bold">Applications</h2></div>
        <button type="button" data-testid="button-refresh-applications" className="rounded-xl border border-[hsl(var(--border))] px-4 py-2 text-sm font-bold" onClick={() => void refresh()} disabled={q.isFetching || busyId !== null}>
          {q.isFetching ? 'Refreshing…' : 'Refresh list'}
        </button>
      </div>
      {notice && <p role="status" data-testid="text-decision-status" className="mb-4 break-words rounded-xl border border-[hsl(var(--border))] p-3 text-sm">{notice}</p>}
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
              <strong>{a.fullName || `${a.firstName} ${a.lastName}`}</strong>
              <span className="text-xs font-bold">{a.applicantType === 'SCHOOL_ADMIN' ? 'School Admin' : 'Partner'}</span>
            </div>
            <div className="mt-1 text-[hsl(var(--muted-foreground))]">{a.email} · {a.phone}</div>
            {a.partnerType && <div data-testid={`text-partner-type-${a.id}`}>Partner type: {a.partnerType === 'BUSINESS' ? 'Business' : 'Individual'}</div>}
            {a.schoolName && <div>School: {a.schoolName}</div>}
            {a.businessName && <div>Business: {a.businessName}</div>}
            {a.address && <div>Address: {a.address}</div>}
            <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Applied {new Date(a.createdAt).toLocaleString()}</div>
            {a.status !== 'PENDING' && (
              <div className="mt-2 text-xs">
                <div>Reviewed by {a.reviewerName ?? 'unknown'}{a.reviewedAt ? ` on ${new Date(a.reviewedAt).toLocaleString()}` : ''}</div>
                {a.rejectionReason && <div>Reason: {a.rejectionReason}</div>}
                <div data-testid={`text-notification-${a.id}`}>{a.notificationDeliveryConfirmed ? 'Delivery confirmed by provider' : notificationCopy(a.notificationStatus)}</div>
                {a.notificationReason && <p className="mt-1" data-testid={`text-notification-reason-${a.id}`}>{a.notificationReason}</p>}
                <div className="mt-2 flex flex-wrap gap-2">
                  <button type="button" data-testid={`button-retry-email-${a.id}`} disabled={!a.notificationRetryAllowed || busyId !== null || uncertainId !== null} onClick={() => setEmailConfirmId(a.id)}
                    className="rounded-lg border border-[hsl(var(--border))] px-3 py-1.5 disabled:opacity-50">Retry email only</button>
                  {a.notificationCanReconcile && <button type="button" data-testid={`button-reconcile-email-${a.id}`} disabled={busyId !== null || uncertainId !== null} onClick={() => void manageEmail(a.id,'RECONCILE')}
                    className="rounded-lg border border-[hsl(var(--border))] px-3 py-1.5">Check provider status</button>}
                </div>
                {emailConfirmId === a.id && <div className="mt-2 rounded-lg bg-[hsl(var(--secondary))] p-3">
                  <p>Send the notification to {a.email}? This retries email only, not approval.</p>
                  <button type="button" data-testid="button-confirm-email-retry" disabled={!a.notificationRetryAllowed || busyId !== null} onClick={() => void manageEmail(a.id,'RETRY')} className="mt-2 rounded-lg border border-[hsl(var(--border))] px-3 py-1.5">Confirm email retry</button>
                  <button type="button" disabled={busyId !== null} onClick={() => setEmailConfirmId(null)} className="ml-2">Cancel</button>
                </div>}
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
                   <button type="button" data-testid="button-confirm-decision" disabled={busyId !== null || uncertainId !== null || (confirm.status === 'REJECTED' && !reason.trim())} onClick={() => void run()} className="rounded-lg bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-bold text-[hsl(var(--primary-foreground))]">
                    {busyId === a.id ? 'Saving…' : 'Confirm'}
                  </button>
                  <button type="button" disabled={busyId === a.id} onClick={() => { setConfirm(null); setReason(''); }} className="rounded-lg border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-bold">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex gap-2">
                 <button type="button" data-testid={`button-approve-${a.id}`} disabled={busyId !== null || uncertainId !== null} onClick={() => { setConfirm({ id: a.id, status: 'APPROVED' }); setReason(''); }} className="rounded-lg bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-bold text-[hsl(var(--primary-foreground))]">Approve</button>
                 <button type="button" data-testid={`button-reject-${a.id}`} disabled={busyId !== null || uncertainId !== null} onClick={() => { setConfirm({ id: a.id, status: 'REJECTED' }); setReason(''); }} className="rounded-lg border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-bold">Reject</button>
              </div>
            ))}
          </li>))}</ul>}
    </section>
  );
}
