import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bus, Clock, ShieldAlert, UsersRound } from 'lucide-react';
import {
  useGetAuthorizedContext, useGetParentChildren, useGetChildTransport, useListChildTransportRequests, useRequestChildTransportChange,
  useGetChildTransportHistory, useGetOwnStudentTransport, useGetOwnStudentTransportHistory,
  getGetChildTransportQueryKey, getGetChildTransportHistoryQueryKey, getListChildTransportRequestsQueryKey,
  type TransportSelfView, type TransportHistoryEntry, type TransportRequest,
} from '@workspace/api-client-react';
import { Button, EmptyState, ErrorState, Field, PageHeading, StatusPill, cx, date } from '@/components/shared';
import { AssignmentSummary, HistoryList, InvoiceList, ListSkeleton, Notice, RequestRow, SectionTitle, inputCls } from '@/components/transport-parts';
import { TRANSPORT_POLL_MS, TRANSPORT_STALE_MS, errorMessage, familyAudience, validateEffective } from '@/components/transport-logic';

const fresh = { staleTime: TRANSPORT_STALE_MS, refetchInterval: TRANSPORT_POLL_MS, refetchOnWindowFocus: true, refetchOnMount: 'always' } as const;
const today = () => new Date().toISOString().slice(0, 10);

export default function FamilyTransportPage() {
  const ctx = useGetAuthorizedContext();
  const [mode, setMode] = useState<'parent' | 'student'>('parent');
  if (ctx.isLoading) return <ListSkeleton rows={3} />;
  if (ctx.isError) return <ErrorState retry={() => ctx.refetch()} message="We could not confirm your access." />;
  const audience = familyAudience(ctx.data);
  if (audience === 'denied') {
    return (
      <div data-testid="family-transport-denied"><PageHeading eyebrow="Family" title="My transport" />
        <div className="panel"><EmptyState icon={ShieldAlert} title="Not available for this account" description="This page is for parents and students. School staff manage transport from the Transport page." /></div>
      </div>
    );
  }
  const active = audience === 'both' ? mode : audience;
  return (
    <div className="mx-auto max-w-5xl" data-testid="family-transport">
      <PageHeading eyebrow="Family" title="My transport" description={active === 'parent' ? 'Where your child rides, when, and what the school has approved. Requests are reviewed by the school; nothing changes until they approve.' : 'Your bus, stops and schedule. This view is read-only.'} />
      {audience === 'both' && (
        <div className="mb-6 flex w-fit gap-1 rounded-xl bg-[hsl(var(--muted))] p-1">
          {(['parent', 'student'] as const).map(m => <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m} className={cx('rounded-lg px-4 py-2 text-sm font-bold', mode === m ? 'bg-[hsl(var(--background))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]')}>{m === 'parent' ? 'My children' : 'Myself'}</button>)}
        </div>
      )}
      {active === 'parent' ? <ParentView /> : <StudentView />}
    </div>
  );
}

function StatusBanner({ view }: { view: TransportSelfView }) {
  const label = view.transportStatus === 'NOT_ASSIGNED' ? 'Not assigned' : view.transportStatus.charAt(0) + view.transportStatus.slice(1).toLowerCase();
  const msg = view.transportStatus === 'ACTIVE' ? 'Transport is active.' : view.transportStatus === 'SUSPENDED' ? 'Transport is suspended by the school for now.' : view.transportStatus === 'DEACTIVATED' ? 'Transport has been stopped.' : 'No bus has been assigned yet.';
  return <div className="mb-4 flex items-center gap-3"><StatusPill value={view.transportStatus === 'NOT_ASSIGNED' ? 'pending' : view.transportStatus} /><span className="text-sm font-bold">{label}</span><span className="text-sm text-[hsl(var(--muted-foreground))]">{msg}</span></div>;
}

function Details({ view, history, historyState, financeHref }: { view: TransportSelfView; history: TransportHistoryEntry[]; historyState: { loading: boolean; error: boolean; retry: () => void }; financeHref: string }) {
  return (
    <div className="space-y-6">
      <section className="panel p-5 md:p-6" data-testid="transport-current">
        <SectionTitle icon={Bus} title="Current transport" />
        <StatusBanner view={view} />
        {view.assignment ? <><AssignmentSummary a={view.assignment} /><p className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">Effective {date(view.assignment.effectiveDate)}. {view.assignment.reason}</p></> : <p className="text-sm text-[hsl(var(--muted-foreground))]">There is no bus, route or stop to show.</p>}
      </section>
      <section className="panel p-5 md:p-6"><SectionTitle title="Transport fees" hint="Paid through School Fees" /><InvoiceList invoices={view.invoices} financeHref={financeHref} financeLabel="Pay or review in Fees" /></section>
      <section className="panel p-5 md:p-6"><SectionTitle title="History" />
        {historyState.loading ? <ListSkeleton rows={2} /> : historyState.error ? <Notice tone="error">The history could not load. <button className="underline" onClick={historyState.retry}>Retry</button></Notice> : <HistoryList entries={history} />}
      </section>
    </div>
  );
}

function StudentView() {
  const q = useGetOwnStudentTransport({ query: { ...fresh } as never });
  const h = useGetOwnStudentTransportHistory({ query: { ...fresh } as never });
  if (q.isLoading) return <ListSkeleton rows={3} />;
  if (q.isError || !q.data) return <ErrorState retry={() => q.refetch()} message={errorMessage(q.error, 'Your transport details could not be loaded.')} />;
  return <Details view={q.data} history={h.data ?? q.data.history ?? []} historyState={{ loading: h.isLoading && !q.data.history?.length, error: h.isError && !q.data.history?.length, retry: () => h.refetch() }} financeHref="/my-fees" />;
}

function ParentView() {
  const kids = useGetParentChildren();
  const [pick, setPick] = useState<number | null>(null);
  if (kids.isLoading) return <ListSkeleton rows={3} />;
  if (kids.isError) return <ErrorState retry={() => kids.refetch()} message="Your linked children could not be loaded." />;
  const list = kids.data ?? [];
  if (!list.length) return <div className="panel"><EmptyState icon={UsersRound} title="No linked children" description="Ask the school administrator to link your children to your parent profile." /></div>;
  const child = list.find(c => c.id === pick) ?? list[0];
  return (
    <div>
      {list.length > 1 && (
        <div className="mb-6 flex flex-wrap gap-2" role="tablist" aria-label="Choose child">
          {list.map(c => <button key={c.id} role="tab" aria-selected={c.id === child.id} onClick={() => setPick(c.id)} data-testid={`select-child-${c.id}`} className={cx('rounded-xl border px-4 py-2 text-sm font-bold', c.id === child.id ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/.08)]' : 'border-[hsl(var(--border))]')}>{c.firstName} {c.lastName}</button>)}
        </div>
      )}
      <ChildTransport key={child.id} studentId={child.id} name={`${child.firstName} ${child.lastName}`} />
    </div>
  );
}

function ChildTransport({ studentId, name }: { studentId: number; name: string }) {
  const q = useGetChildTransport(studentId, { query: { ...fresh, queryKey: getGetChildTransportQueryKey(studentId) } as never });
  const h = useGetChildTransportHistory(studentId, { query: { ...fresh, queryKey: getGetChildTransportHistoryQueryKey(studentId) } as never });
  const r = useListChildTransportRequests(studentId, { query: { ...fresh, queryKey: getListChildTransportRequestsQueryKey(studentId) } as never });
  if (q.isLoading) return <ListSkeleton rows={3} />;
  if (q.isError || !q.data) return <ErrorState retry={() => q.refetch()} message={errorMessage(q.error, `${name}'s transport details could not be loaded.`)} />;
  const requests = r.data ?? [];
  return (
    <div className="space-y-6">
      <Details view={q.data} history={h.data ?? q.data.history ?? []} historyState={{ loading: h.isLoading && !q.data.history?.length, error: h.isError && !q.data.history?.length, retry: () => h.refetch() }} financeHref={`/parent/fees/${studentId}`} />
      <section className="panel p-5 md:p-6" data-testid="transport-requests">
        <SectionTitle icon={Clock} title="Requests to the school" />
        <RequestForm studentId={studentId} status={q.data.transportStatus} requests={requests} />
        <div className="mt-5 space-y-3">
          {r.isLoading ? <ListSkeleton rows={1} /> : r.isError ? <Notice tone="error">Requests could not load. <button className="underline" onClick={() => r.refetch()}>Retry</button></Notice> : requests.length ? [...requests].sort((a: TransportRequest, b: TransportRequest) => b.createdAt.localeCompare(a.createdAt)).map(x => <RequestRow key={x.id} r={x} />) : <p className="text-sm text-[hsl(var(--muted-foreground))]">You have not sent any requests for {name}.</p>}
        </div>
      </section>
    </div>
  );
}

function RequestForm({ studentId, status, requests }: { studentId: number; status: TransportSelfView['transportStatus']; requests: TransportRequest[] }) {
  const qc = useQueryClient();
  const send = useRequestChildTransportChange();
  const pending = requests.find(x => x.status === 'PENDING');
  const canStart = status !== 'ACTIVE';
  const canStop = status === 'ACTIVE' || status === 'SUSPENDED';
  const [type, setType] = useState<'ACTIVATE' | 'DEACTIVATE'>(canStart ? 'ACTIVATE' : 'DEACTIVATE');
  const [eff, setEff] = useState(today()); const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null); const [ok, setOk] = useState(false);
  if (pending) return <Notice testId="request-pending">A request to {pending.requestType === 'ACTIVATE' ? 'start' : 'stop'} transport from {date(pending.effectiveDate)} is waiting for the school. You can send another once it is reviewed.</Notice>;
  const submit = (e: FormEvent) => {
    e.preventDefault(); setOk(false);
    const v = validateEffective(eff, reason); if (v) return setErr(v);
    setErr(null);
    send.mutate({ studentId, data: { requestType: type, effectiveDate: eff, reason: reason.trim() } }, {
      onSuccess: () => { setOk(true); setReason(''); qc.invalidateQueries({ predicate: q => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).includes('transport') }); },
      onError: x => setErr(errorMessage(x)),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-4" data-testid="transport-request-form">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="I would like to"><select className={inputCls} value={type} onChange={e => setType(e.target.value as typeof type)} data-testid="select-request-type">{canStart && <option value="ACTIVATE">Start school transport</option>}{canStop && <option value="DEACTIVATE">Stop school transport</option>}</select></Field>
        <Field label="From date"><input type="date" className={inputCls} value={eff} onChange={e => setEff(e.target.value)} data-testid="input-request-date" /></Field>
      </div>
      <Field label="Reason"><textarea rows={2} className={inputCls} value={reason} onChange={e => setReason(e.target.value)} data-testid="input-request-reason" /></Field>
      {err && <Notice tone="error" testId="request-error">{err}</Notice>}
      {ok && <Notice tone="success" testId="request-sent">Request sent. The school will review it and respond here.</Notice>}
      <Button type="submit" disabled={send.isPending || (!canStart && !canStop)} testId="button-send-request">{send.isPending ? 'Sending...' : 'Send request'}</Button>
    </form>
  );
}
