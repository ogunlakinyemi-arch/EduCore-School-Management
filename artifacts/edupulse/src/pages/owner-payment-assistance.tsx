import { useEffect, useState } from 'react';
import {
  useGetAuthorizedContext, useGetOwnerSubscriptionPaymentRules,
  getGetOwnerSubscriptionPaymentRulesQueryKey, recordOwnerSubscriptionBankVerification,
  useGetOwnerSchoolAssistanceRequests, getGetOwnerSchoolAssistanceRequestsQueryKey,
} from '@workspace/api-client-react';
import { PageHeading, Button, ErrorState, StatusPill } from '@/components/shared';
import { BankRemittanceBatch } from '@/components/bank-remittance-batch';
import { useFinanceAction, naira } from '@/lib/current-finance';
import { VerifyDialog, type AssistanceSnapshot, type SubscriptionPaymentRulesSnapshot } from './subscription-payment-rules';

/** Existing school requests only: no rule creation, release approval or Owner-created checkout. */
export function OwnerPaymentAssistancePage() {
  const actorId = useGetAuthorizedContext().data?.user?.id;
  const [schoolId, setSchoolId] = useState<number | undefined>();
  const [page, setPage] = useState(1);
  const params = { ...(schoolId ? { schoolId } : {}), page, pageSize: 20 };
  const current = useGetOwnerSchoolAssistanceRequests(params, { query: {
    queryKey: [...getGetOwnerSchoolAssistanceRequestsQueryKey(params), 'actor', actorId],
    enabled: !!actorId, staleTime: 0, refetchOnMount: 'always', refetchInterval: 30000, retry: false,
    placeholderData: (previous, query) => query?.queryKey.at(-1) === actorId ? previous : undefined,
  } });
  const legacy = useGetOwnerSubscriptionPaymentRules({ query: {
    enabled: !!actorId,
    queryKey: [...getGetOwnerSubscriptionPaymentRulesQueryKey(), 'actor', actorId],
    staleTime: 0, refetchInterval: 30000,
  } });
  const data = current.data;
  useEffect(() => {
    if (data && !current.isPlaceholderData) {
      const last = Math.max(1, Math.ceil(data.total / data.pageSize));
      if (page > last) setPage(last);
    }
  }, [data, current.isPlaceholderData, page]);
  const cases = (legacy.data as Partial<SubscriptionPaymentRulesSnapshot> | undefined)?.assistance ?? [];
  const [verify, setVerify] = useState<AssistanceSnapshot | null>(null);
  const [notice, setNotice] = useState('');
  const fin = useFinanceAction();
  const refresh = async () => { await Promise.all([current.refetch(), legacy.refetch()]); };
  return <div className="fade-up space-y-5">
    <PageHeading eyebrow="Owner / Schools" title="School payment assistance"
      description="Respond to submitted requests. Ordinary online payments do not need Owner approval."
      action={<Button variant="outline" onClick={() => void refresh()}>Refresh</Button>} />
    {notice && <p role="status" className="panel p-4 text-sm">{notice}</p>}
    <section className="panel space-y-4 p-5" aria-label="School remittance requests">
      <h2 className="text-lg font-bold">School requests</h2>
      <p className="text-sm">A request or receipt is not payment. Confirm bank credit independently before allocating it.</p>
      <label className="block text-sm">School
        <select className="ml-3 rounded border bg-transparent p-2" value={schoolId ?? ''}
          onChange={e => { setSchoolId(e.target.value ? Number(e.target.value) : undefined); setPage(1); }}>
          <option value="">All schools</option>
          {data?.schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      {!actorId || current.isLoading || current.isPlaceholderData ? <p role="status">Loading requests…</p> : current.isError || !data
        ? <ErrorState message="School requests could not be loaded. No changes were made." retry={() => void current.refetch()} />
        : !data.storageAvailable ? <p role="status" className="text-sm">School remittance request storage is not installed. This is not an empty request list. Existing individual assistance requests remain available below. Payment operations have not been enabled.</p>
        : !data.batches.length ? <p className="text-sm">{schoolId ? 'No school remittance requests for this school.' : 'No school remittance requests.'}</p>
        : data.batches.map(b => <div key={b.id} className="space-y-2">
          <h3 className="text-sm font-semibold">{b.schoolName} · {b.termName}</h3>
          <BankRemittanceBatch key={`${schoolId ?? 'all'}:${b.id}`} b={b} fin={fin} owner assistanceOnly
            report={(r, ok) => {
              setNotice(r.ok ? ok : r.uncertain ? `${r.message} Outcome uncertain; refresh before resubmitting.` : r.message);
              if (r.ok) void refresh();
            }} /></div>)}
      {data?.storageAvailable && !current.isError && !current.isPlaceholderData && <nav aria-label="School requests pagination" className="flex flex-wrap items-center gap-3 text-sm">
        <Button variant="outline" disabled={page <= 1 || current.isFetching} onClick={() => setPage(p => p - 1)}>Previous</Button>
        <span>Page {data.page} of {Math.max(1, Math.ceil(data.total / data.pageSize))} · {data.total} request{data.total === 1 ? '' : 's'}</span>
        <Button variant="outline" disabled={page * data.pageSize >= data.total || current.isFetching} onClick={() => setPage(p => p + 1)}>Next</Button>
      </nav>}
    </section>
    <section className="panel space-y-4 p-5" aria-label="Existing individual assistance requests">
      <h2 className="text-lg font-bold">Individual assistance requests</h2>
      {legacy.isLoading ? <p>Loading…</p> : legacy.isError ? <ErrorState retry={() => void legacy.refetch()} />
        : !cases.filter(a => !schoolId || a.schoolId === schoolId).length ? <p className="text-sm">No individual requests.</p>
        : cases.filter(a => !schoolId || a.schoolId === schoolId).map(a => <div key={a.id} className="rounded-xl border p-4 text-sm">
          <div className="flex flex-wrap justify-between gap-2"><span>School #{a.schoolId} · Student #{a.studentId} · Term #{a.termId}</span><StatusPill value={a.status} /></div>
          <p className="mt-2">{naira(a.amountMinor)} · {a.requestNote}</p>
          {a.verifiedAmountMinor != null ? <p className="mt-2">Bank receipt recorded. This historical record alone does not establish a subscription payment.</p>
            : a.status === 'REQUESTED' && <Button variant="outline" className="mt-3" onClick={() => setVerify(a)}>Record bank receipt</Button>}
          {a.status === 'REQUESTED' && a.verifiedAmountMinor == null && <LegacyCancel id={a.id} fin={fin} onResult={async message => { setNotice(message); await refresh(); }} />}
        </div>)}
    </section>
    {verify && <VerifyDialog a={verify} onVerify={recordOwnerSubscriptionBankVerification}
      onClose={() => setVerify(null)} onDone={async message => { setNotice(message); setVerify(null); await refresh(); }} />}
  </div>;
}

function LegacyCancel({ id, fin, onResult }: {
  id: number; fin: ReturnType<typeof useFinanceAction>; onResult: (message: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  return <div className="mt-3 flex flex-wrap gap-2">
    <input aria-label={`Reason to decline request ${id}`} className="rounded border bg-transparent p-2"
      value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason to decline" />
    <Button variant="quiet" disabled={reason.trim().length < 3 || fin.busy === `legacy-cancel:${id}`} onClick={async () => {
      if (!window.confirm('Decline this unpaid request? Do not proceed if money was received.')) return;
      const r = await fin.run(`legacy-cancel:${id}`, 'LEGACY_ASSISTANCE_CANCEL', { id, reason: reason.trim() }, true);
      await onResult(r.ok ? 'Request declined.' : `${r.message}${r.uncertain ? ' Refresh before resubmitting.' : ''}`);
    }}>Decline request</Button>
  </div>;
}
