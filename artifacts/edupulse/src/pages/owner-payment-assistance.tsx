import { useState } from 'react';
import {
  useGetAuthorizedContext, useGetOwnerSubscriptionPaymentRules,
  getGetOwnerSubscriptionPaymentRulesQueryKey, recordOwnerSubscriptionBankVerification,
} from '@workspace/api-client-react';
import { PageHeading, Button, ErrorState, StatusPill } from '@/components/shared';
import { BankRemittanceBatch } from '@/components/bank-remittance-batch';
import { isOverview, useCurrentFinance, useFinanceAction, naira } from '@/lib/current-finance';
import { VerifyDialog, type AssistanceSnapshot, type SubscriptionPaymentRulesSnapshot } from './subscription-payment-rules';

/** Existing school requests only: no rule creation, release approval or Owner-created checkout. */
export function OwnerPaymentAssistancePage() {
  const actorId = useGetAuthorizedContext().data?.user?.id;
  const [schoolId, setSchoolId] = useState<number | undefined>();
  const current = useCurrentFinance({ schoolId });
  const legacy = useGetOwnerSubscriptionPaymentRules({ query: {
    enabled: !!actorId,
    queryKey: [...getGetOwnerSubscriptionPaymentRulesQueryKey(), 'actor', actorId],
    staleTime: 0, refetchInterval: 30000,
  } });
  const data = isOverview(current.data) ? current.data : undefined;
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
          onChange={e => setSchoolId(e.target.value ? Number(e.target.value) : undefined)}>
          <option value="">All schools</option>
          {data?.schools.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      {current.isLoading ? <p>Loading requests…</p> : current.isError || !data
        ? <ErrorState message="School requests could not be loaded. No changes were made." retry={() => void current.refetch()} />
        : !data.batches.some(b => b.method === 'COMPANY_BANK') ? <p className="text-sm">No school remittance requests.</p>
        : data.batches.filter(b => b.method === 'COMPANY_BANK').map(b =>
          <BankRemittanceBatch key={`${schoolId ?? 'all'}:${b.id}`} b={b} fin={fin} owner={data.owner} assistanceOnly
            report={(r, ok) => {
              setNotice(r.ok ? ok : r.uncertain ? `${r.message} Outcome uncertain; refresh before resubmitting.` : r.message);
              if (r.ok) void refresh();
            }} />)}
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
