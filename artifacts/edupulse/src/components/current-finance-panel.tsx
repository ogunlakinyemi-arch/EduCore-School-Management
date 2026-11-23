import { useMemo, useState, type ReactNode } from 'react';
import { RefreshCw, Landmark, ShieldAlert, Receipt, CircleAlert } from 'lucide-react';
import { Button, Field, StatusPill } from '@/components/shared';
import { CurrentFinanceReceiptButton } from '@/components/current-finance-receipt';
import {
  isOverview, isUnavailable, naira, safeHttpsUrl, toMinor, useCurrentFinance, useFinanceAction, apiErrorText,
  type FinanceOverview, type Payment, type Source,
} from '@/lib/current-finance';

type Mode = 'bro' | 'owner' | 'school';
const VERIFIED_PHASES = ['VERIFIED', 'RECOVERY_REQUIRED', 'COMPLETED'];
type Notice = { tone: 'ok' | 'warn' | 'error'; text: string; checkoutUrl?: string | null } | null;

const muted = 'text-[hsl(var(--muted-foreground))]';
const box = 'rounded-xl border border-[hsl(var(--border))]';

function Section({ title, eyebrow, children, testId }: { title: string; eyebrow: string; children: ReactNode; testId?: string }) {
  return <section className="border-t border-[hsl(var(--border))] p-5 md:p-6" data-testid={testId}>
    <div className="eyebrow">{eyebrow}</div>
    <h3 className="display-font mt-1 text-lg font-bold">{title}</h3>
    <div className="mt-4">{children}</div>
  </section>;
}
const Empty = ({ children }: { children: ReactNode }) => <p className={`rounded-xl border border-dashed border-[hsl(var(--border))] p-4 text-sm ${muted}`}>{children}</p>;

export function NoticeBar({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  if (!notice) return null;
  const tone = notice.tone === 'ok' ? 'border-[hsl(157_37%_43%/.4)] bg-[hsl(157_37%_43%/.08)]'
    : notice.tone === 'warn' ? 'border-[hsl(var(--accent)/.5)] bg-[hsl(var(--accent)/.1)]' : 'border-[hsl(var(--destructive)/.4)] bg-[hsl(var(--destructive)/.06)]';
  const url = safeHttpsUrl(notice.checkoutUrl);
  return <div role={notice.tone === 'error' ? 'alert' : 'status'} className={`mx-5 mt-4 flex flex-wrap items-start justify-between gap-3 rounded-xl border p-3 text-sm md:mx-6 ${tone}`} data-testid="finance-notice">
    <div><div>{notice.text}</div>
      {url && <a href={url} rel="noopener noreferrer" className="mt-2 inline-block font-bold underline" data-testid="link-bulk-checkout">Open the single bulk checkout</a>}</div>
    <button type="button" className="text-xs font-bold underline" onClick={onClose}>Dismiss</button>
  </div>;
}

export function ConnectedFinancePanel({ mode, schoolId: fixedSchoolId, ownerSelectedSchool }: { mode: Mode; schoolId?: number | null; ownerSelectedSchool?: boolean }) {
  const [schoolId, setSchoolId] = useState<number | undefined>(fixedSchoolId ?? undefined);
  const [termScope, setTermScope] = useState<{schoolId:number;termId:number}|null>(null);
  const effectiveSchool = fixedSchoolId ?? schoolId;
  const termId=termScope?.schoolId===effectiveSchool?termScope?.termId:undefined;
  const setTermId=(id:number|undefined)=>setTermScope(effectiveSchool&&id?{schoolId:effectiveSchool,termId:id}:null);
  const schoolScopeMissing = mode === 'school' && !fixedSchoolId;
  const query = useCurrentFinance({ schoolId: mode === 'bro' ? undefined : effectiveSchool, termId }, !schoolScopeMissing);
  const fin = useFinanceAction();
  const [notice, setNotice] = useState<Notice>(null);

  const title = mode === 'bro' ? 'Your connected earnings & withdrawals' : mode === 'owner' ? 'Connected payments & BRO oversight' : 'Student platform collections';
  const catalog:Pick<FinanceOverview,'schools'|'terms'>=isOverview(query.data)?query.data:{schools:[],terms:[]};
  const scopedTerms = catalog.terms.filter(t => t.schoolId === effectiveSchool);
  const scopeControls=mode!=='bro'&&<div className="grid gap-3 border-t border-[hsl(var(--border))] px-5 py-4 md:grid-cols-2 md:px-6">
    {!fixedSchoolId&&<Field label="School scope"><select value={effectiveSchool??''} onChange={e=>{
      setSchoolId(e.target.value?Number(e.target.value):undefined);setTermScope(null);
    }} data-testid="select-finance-school">
      <option value="">{mode==='owner'?'All schools · overview only':'Select a school'}</option>
      {effectiveSchool&&!catalog.schools.some(s=>s.id===effectiveSchool)&&<option value={effectiveSchool}>Selected school #{effectiveSchool}</option>}
      {catalog.schools.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
    </select></Field>}
    <Field label="Academic term"><select value={termId??''} disabled={!effectiveSchool} onChange={e=>{
      const id=Number(e.target.value);setTermId(scopedTerms.some(t=>t.id===id)?id:undefined);
    }} data-testid="select-finance-term">
      <option value="">{effectiveSchool?'All terms':'Choose a school first'}</option>
      {scopedTerms.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
    </select></Field>
    <p className={`text-xs ${muted}`}>{effectiveSchool?'Figures and actions are limited to the selected school.':'All schools is an overview. Select one school before choosing its term or collecting payments.'}</p>
    <Button variant="outline" onClick={()=>{if(!fixedSchoolId)setSchoolId(undefined);setTermScope(null);}}
      testId="button-reset-finance-scope">Reset school / term scope</Button>
  </div>;

  const shell = (body: ReactNode) => <div className="panel my-6 overflow-hidden" data-testid={`current-finance-${mode}`}>
    <header className="flex flex-wrap items-end justify-between gap-4 bg-[linear-gradient(120deg,hsl(var(--primary)/.06),transparent_60%)] p-5 md:p-6">
      <div><div className="eyebrow">Current finance · ledger view</div>
        <h2 className="display-font mt-1 text-2xl font-bold">{title}</h2>
        <p className={`mt-1 max-w-2xl text-xs leading-5 ${muted}`}>Accrued entitlements and approvals are internal records. Only bank-verified payments and reconciled payouts represent money that has moved.</p></div>
      <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching} testId={`button-refresh-finance-${mode}`}><RefreshCw size={14} className={query.isFetching ? 'animate-spin' : ''} />Refresh</Button>
    </header>
    <NoticeBar notice={notice} onClose={() => setNotice(null)} />
    {scopeControls}
    {body}
  </div>;

  if (schoolScopeMissing) return shell(<div className="p-6 text-sm" role="status">{ownerSelectedSchool === false ? 'Select a school explicitly to view its connected collections. No school is chosen on your behalf.' : 'Select a school to view connected collections.'}</div>);
  if (query.isLoading) return shell(<div className="grid gap-3 p-6 md:grid-cols-3">{[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="skeleton h-20 rounded-xl" />)}</div>);
  if (query.isError && isUnavailable(query.error)) return shell(<div className="flex items-start gap-3 p-6" role="status" data-testid="finance-unavailable">
    <ShieldAlert className="mt-0.5 shrink-0 text-[hsl(var(--accent))]" size={20} />
    <div><div className="font-bold">Connected finance is not available yet</div>
      <p className={`mt-1 text-sm ${muted}`}>The server has not enabled this ledger. Balances are unknown, not zero. Nothing can be requested or paid from here until it is released.</p></div></div>);
  if (query.isError || !isOverview(query.data)) return shell(<div className="p-6" role="alert">
    <p className="text-sm">{query.isError ? apiErrorText(query.error, 'Finance records could not be confirmed.') : 'The server response did not match the expected finance ledger.'} No balance can be inferred.</p>
    <Button className="mt-3" variant="outline" onClick={() => void query.refetch()} testId="button-retry-finance">Retry</Button></div>);

  const data = query.data;
  const report = (r: Awaited<ReturnType<typeof fin.run>>, ok: string) => {
    if (r.ok) setNotice({ tone: 'ok', text: ok, checkoutUrl: typeof r.result.checkoutUrl === 'string' ? r.result.checkoutUrl : null });
    else setNotice({ tone: r.uncertain ? 'warn' : 'error', text: r.uncertain ? `${r.message} The outcome is uncertain. The same request identity is kept; check the refreshed records before submitting this exact request again.` : r.message });
  };
  const ctx = { data, fin, report };

  return shell(<>
    {data.blockers.length > 0 && <div className="mx-5 mt-4 rounded-xl border border-[hsl(var(--accent)/.5)] bg-[hsl(var(--accent)/.08)] p-3 text-sm md:mx-6" role="status" data-testid="finance-blockers">
      <div className="flex items-center gap-2 font-bold"><CircleAlert size={15} />Release gates in effect</div>
      <ul className="mt-1 list-disc pl-5 text-xs">{data.blockers.map((b, i) => <li key={i}>{b}</li>)}</ul></div>}
    <SummaryLedger data={data} mode={mode} />
    {mode === 'bro' && <BroWithdraw {...ctx} />}
    {mode === 'owner' && <OwnerDecisions {...ctx} />}
    {mode === 'owner' && <OwnerPayouts {...ctx} />}
    {mode !== 'bro' && <BulkCollections {...ctx} schoolId={effectiveSchool} termId={termId} terms={scopedTerms} setTermId={setTermId} readOnly={!effectiveSchool} />}
    {mode !== 'bro' && <PaymentsAndRefunds {...ctx} owner={data.owner} />}
  </>);
}

type Ctx = { data: FinanceOverview; fin: ReturnType<typeof useFinanceAction>; report: (r: Awaited<ReturnType<ReturnType<typeof useFinanceAction>['run']>>, ok: string) => void };

function SummaryLedger({ data, mode }: { data: FinanceOverview; mode: Mode }) {
  const s = data.summary;
  const x = s as typeof s & { requestedMinor?: number | null; pendingApprovalMinor?: number | null; failedMinor?: number | null; reversedMinor?: number | null };
  const opt = (v: number | null | undefined) => typeof v === 'number' && Number.isFinite(v) ? v : null;
  const failedReversed = opt(x.failedMinor) === null && opt(x.reversedMinor) === null ? null : (opt(x.failedMinor) ?? 0) + (opt(x.reversedMinor) ?? 0);
  const accrued: (readonly [string, number | null, string])[] = [
    ['Earned (accrued)', s.earnedMinor, `${s.studentCount} eligible verified student-term${s.studentCount === 1 ? '' : 's'} at ₦150 each, funded separately by the platform. Not a transfer.`],
    ...(opt(x.requestedMinor) !== null || opt(x.pendingApprovalMinor) !== null
      ? [['Requested by BRO', opt(x.requestedMinor), 'Included in a withdrawal request.'] as const, ['Pending Owner approval', opt(x.pendingApprovalMinor), 'Requested lines still awaiting a decision.'] as const]
      : [['Not yet approved', s.pendingMinor, 'Includes earned lines not yet requested and requested lines awaiting decision. See the request list for the split.'] as const]),
    ['Approved, not yet paid', s.approvedMinor, 'Approval is not a bank credit.'],
    ['Available to pay out', s.availableMinor, 'Approved and matured, not yet paid. Still not a bank credit.'],
    ['Failed / reversed', failedReversed, failedReversed === null ? 'Not reported by the server for this scope.' : 'Payout attempts that failed or were reversed.'],
  ];
  return <div className="grid gap-0 border-t border-[hsl(var(--border))] mt-4 md:grid-cols-[1fr_auto]" data-testid="finance-summary">
    <div className="grid grid-cols-2 gap-px bg-[hsl(var(--border))] lg:grid-cols-3">
      {accrued.map(([label, v, hint]) => <div key={label} className="bg-[hsl(var(--card))] p-4">
        <div className="text-[10px] font-bold uppercase tracking-[.14em] text-[hsl(var(--muted-foreground))]">{label}</div>
        <div className="mt-1 font-mono text-lg font-bold tabular-nums" data-testid={`summary-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`}>{v === null ? 'Unavailable' : naira(v)}</div>
        <div className={`mt-1 text-[11px] leading-4 ${muted}`}>{hint}</div></div>)}
    </div>
    <div className="flex flex-col justify-center gap-1 bg-[hsl(var(--sidebar))] p-5 text-[hsl(var(--sidebar-foreground))] md:min-w-[220px]">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.14em] text-[hsl(var(--sidebar-accent-foreground))]"><Landmark size={13} />Bank-verified paid</div>
      <div className="font-mono text-2xl font-bold tabular-nums" data-testid="summary-paid">{naira(s.paidMinor)}</div>
      <div className="text-[11px] opacity-75">{mode === 'school' ? 'Reconciled payouts only.' : 'Only reconciled payouts count here.'}</div>
    </div>
  </div>;
}

function BroWithdraw({ data, fin, report }: Ctx) {
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState('');
  const available = data.entitlements.filter(e => e.state === 'REQUESTED' && e.requestId === null);
  const toggle = (k: string) => setPicked(p => { const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const keys = [...picked].filter(k => available.some(e => e.key === k)).sort();
  const slot = 'withdraw-request';
  const retained = fin.pendingKey(slot);
  const total = available.filter(e => picked.has(e.key)).reduce((a, e) => a + e.amountMinor, 0);
  const submit = async () => {
    const r = await fin.run(slot, 'WITHDRAW_REQUEST', { entitlementKeys: keys, reason: reason.trim() }, true);
    report(r, 'Withdrawal requested. It is pending Owner decision; no money has moved.');
    if (r.ok) { setPicked(new Set()); setReason(''); }
  };
  return <>
    <Section eyebrow="Entitlements" title="Your student-term earnings" testId="bro-entitlements">
      {data.entitlements.length === 0 ? <Empty>No entitlements have accrued yet. Each eligible, verified student-term subscription accrues ₦150.</Empty> :
        <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead className={`text-xs ${muted}`}><tr><th className="p-2"></th><th className="p-2">Student</th><th className="p-2">School / term</th><th className="p-2">Amount</th><th className="p-2">State</th></tr></thead>
          <tbody>{data.entitlements.map(e => <tr key={e.key} className="border-t border-[hsl(var(--border))]">
            <td className="p-2"><input type="checkbox" className="h-4 w-4" disabled={!(e.state === 'REQUESTED' && e.requestId === null)} checked={picked.has(e.key)} onChange={() => toggle(e.key)} aria-label={`Select ${e.studentName}`} data-testid={`check-entitlement-${e.key}`} /></td>
            <td className="p-2 font-semibold">{e.studentName}</td><td className="p-2">{e.schoolName} · {e.termName}</td>
            <td className="p-2 font-mono">{naira(e.amountMinor)}</td><td className="p-2"><StatusPill value={e.state} /></td></tr>)}</tbody></table></div>}
      <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
        <Field label="Reason for withdrawal (required)"><input value={reason} maxLength={500} onChange={e => setReason(e.target.value)} placeholder="e.g. End of term withdrawal" data-testid="input-withdraw-reason" /></Field>
        <Button onClick={() => void submit()} disabled={!keys.length || reason.trim().length < 3 || fin.busy === slot} testId="button-request-withdrawal">
          {fin.busy === slot ? 'Requesting...' : retained ? 'Resubmit same request' : `Request ${naira(total)}`}</Button>
      </div>
      <p className={`mt-2 text-xs ${muted}`}>You can request withdrawal of your own earned entitlements that are not already in a request. Term-end approval is still enforced by the server. Payout is decided and initiated by the Platform Owner.</p>
    </Section>
    <Section eyebrow="Requests" title="Withdrawal requests" testId="bro-requests">
      {data.requests.length === 0 ? <Empty>No withdrawal requests yet.</Empty> : <RequestList data={data} />}
    </Section>
    <Section eyebrow="Payouts" title="Payout status" testId="bro-payouts">
      {data.payouts.length === 0 ? <Empty>No payouts have been prepared.</Empty> : <PayoutTable data={data} />}
    </Section>
  </>;
}

function RequestList({ data, decide }: { data: FinanceOverview; decide?: (requestId: number, key: string) => ReactNode }) {
  return <div className="space-y-3">{data.requests.map(r => <div key={r.id} className={`${box} p-4`} data-testid={`request-${r.id}`}>
    <div className="flex flex-wrap justify-between gap-2"><div className="font-bold">Request #{r.id} · {r.broName}</div><div className="font-mono font-bold">{naira(r.totalMinor)}</div></div>
    <div className={`text-xs ${muted}`}>{new Date(r.createdAt).toLocaleString('en-NG')}</div>
    <ul className="mt-3 divide-y divide-[hsl(var(--border))] text-sm">{r.lines.map(l => <li key={l.entitlementKey} className="flex flex-wrap items-center justify-between gap-2 py-2">
      <div><span className="font-semibold">{l.studentName}</span>{l.reason && <span className={`ml-2 text-xs ${muted}`}>{l.reason}</span>}</div>
      <div className="flex flex-wrap items-center gap-2"><StatusPill value={l.state} />{decide?.(r.id, l.entitlementKey)}</div></li>)}</ul>
  </div>)}</div>;
}

function PayoutTable({ data, actions }: { data: FinanceOverview; actions?: (id: number, state: string) => ReactNode }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead className={`text-xs ${muted}`}><tr><th className="p-2">Payout</th><th className="p-2">Entitlement</th><th className="p-2">Amount</th><th className="p-2">Account</th><th className="p-2">State</th>{actions && <th className="p-2"></th>}</tr></thead>
    <tbody>{data.payouts.map(p => <tr key={p.id} className="border-t border-[hsl(var(--border))]">
      <td className="p-2 font-mono text-xs">#{p.id} {p.reference ?? ''}</td><td className="p-2 font-mono text-xs">{p.entitlementKey}</td>
      <td className="p-2 font-mono">{naira(p.amountMinor)}</td><td className="p-2 font-mono text-xs">{p.maskedAccountNumber ?? 'Not on file'}</td>
      <td className="p-2"><StatusPill value={p.state} /></td>{actions && <td className="p-2">{actions(p.id, p.state)}</td>}</tr>)}</tbody></table></div>;
}

function OwnerDecisions({ data, fin, report }: Ctx) {
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const decide = (requestId: number, key: string) => {
    const line = data.requests.find(r => r.id === requestId)?.lines.find(l => l.entitlementKey === key);
    if (!line || !['PENDING', 'REQUESTED'].includes(line.state)) return null;
    const id = `${requestId}:${key}`; const slot = `decide:${id}`; const reason = reasons[id] ?? '';
    const go = async (decision: 'APPROVED' | 'REJECTED') => report(await fin.run(slot, 'WITHDRAW_DECIDE', { requestId, entitlementKey: key, decision, reason: reason.trim() }, true),
      decision === 'APPROVED' ? 'Line approved. Approval is not payment; initiate the payout separately.' : 'Line rejected and held for review; it remains linked to this request.');
    return <span className="flex flex-wrap items-center gap-2">
      <input className="!w-44 !py-1.5 text-xs" placeholder="Decision reason" value={reason} onChange={e => setReasons(r => ({ ...r, [id]: e.target.value }))} data-testid={`input-decide-reason-${id}`} />
      <Button variant="danger" className="h-8 px-3 text-xs" disabled={reason.trim().length < 3 || fin.busy === slot} onClick={() => void go('REJECTED')} testId={`button-reject-${id}`}>Reject</Button>
      <Button className="h-8 px-3 text-xs" disabled={reason.trim().length < 3 || fin.busy === slot} onClick={() => void go('APPROVED')} testId={`button-approve-${id}`}>Approve</Button>
    </span>;
  };
  return <Section eyebrow="Withdrawal decisions" title="Review each requested line" testId="owner-requests">
    {data.requests.length === 0 ? <Empty>No BRO withdrawal requests are waiting.</Empty> : <RequestList data={data} decide={decide} />}
  </Section>;
}

function OwnerPayouts({ data, fin, report }: Ctx) {
  const [reason, setReason] = useState('');
  const [recovery, setRecovery] = useState<{ id: number; amount: string; evidence: string } | null>(null);
  const payable = data.entitlements.filter(e => e.available
    && data.payouts.filter(p => p.entitlementKey === e.key).every(p => p.state === 'FAILED'));
  return <Section eyebrow="Payouts" title="Prepare, then verify BRO payouts" testId="owner-payouts">
    <p className={`mb-3 text-xs ${muted}`}>Approved lines are paid without a second entitlement approval. Preparing a payout does not send money. A payout counts as paid only after reconciliation independently confirms the bank transfer.</p>
    {payable.length === 0 ? <Empty>No approved lines are waiting for payout.</Empty> : <>
      <Field label="Payout reason (applies to the line you initiate)"><input value={reason} onChange={e => setReason(e.target.value)} data-testid="input-payout-reason" /></Field>
      <ul className="mt-3 divide-y divide-[hsl(var(--border))] text-sm">{payable.map(e => {
        // A verified failed attempt starts a new request generation, even if
        // its original initiation response was lost and that key was retained.
        const failedIds=data.payouts.filter(p=>p.entitlementKey===e.key).map(p=>p.id);
        const slot=`payout:${e.key}${failedIds.length?`:after:${Math.max(...failedIds)}`:''}`;
        return <li key={e.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
        <span><b>{e.studentName}</b> <span className={muted}>{e.schoolName} · {e.termName}</span> <span className="font-mono">{naira(e.amountMinor)}</span></span>
        <Button className="h-8 px-3 text-xs" disabled={reason.trim().length < 3 || fin.busy === slot} onClick={async () => report(await fin.run(slot, 'PAYOUT_INITIATE', { entitlementKey: e.key, reason: reason.trim() }, true), 'Payout prepared. This app has not sent a transfer. Complete the separately authorized bank transfer externally using the saved reference, then reconcile to independently verify its outcome.')} testId={`button-initiate-payout-${e.key}`}>
          {fin.pendingKey(slot) ? 'Resubmit same payout' : 'Prepare payout'}</Button></li>; })}</ul></>}
    <div className="mt-5">{data.payouts.length === 0 ? <Empty>No payouts recorded.</Empty> : <PayoutTable data={data} actions={(id, state) => <span className="flex gap-2">
      {state !== 'PAID' && state !== 'RECOVERED' && <Button variant="outline" className="h-8 px-3 text-xs" disabled={fin.busy === `pr:${id}`} onClick={async () => report(await fin.run(`pr:${id}`, 'PAYOUT_RECONCILE', { id }, false), 'Reconciliation checked the provider record. The state shown below is the verified outcome.')} testId={`button-reconcile-payout-${id}`}>Reconcile</Button>}
      {state === 'PAID' && <Button variant="outline" className="h-8 px-3 text-xs" onClick={() => setRecovery({ id, amount: '', evidence: '' })} testId={`button-recover-payout-${id}`}>Record recovery</Button>}
    </span>} />}</div>
    {recovery && <div className={`${box} mt-4 grid gap-3 p-4 md:grid-cols-[1fr_1fr_auto] md:items-end`} data-testid="form-bro-recovery">
      <Field label={`Recovered amount (NGN) for payout #${recovery.id}`}><input inputMode="decimal" value={recovery.amount} onChange={e => setRecovery({ ...recovery, amount: e.target.value })} data-testid="input-recovery-amount" /></Field>
      <Field label="Bank evidence reference"><input value={recovery.evidence} onChange={e => setRecovery({ ...recovery, evidence: e.target.value })} data-testid="input-recovery-evidence" /></Field>
      <div className="flex gap-2"><Button variant="outline" onClick={() => setRecovery(null)}>Cancel</Button>
        <Button disabled={!toMinor(recovery.amount) || recovery.evidence.trim().length < 3 || fin.busy === `rec:${recovery.id}`} onClick={async () => {
          const r = await fin.run(`rec:${recovery.id}`, 'BRO_RECOVERY', { id: recovery.id, amountMinor: toMinor(recovery.amount), evidenceReference: recovery.evidence.trim() }, true);
          report(r, 'Recovery recorded against verified bank evidence.'); if (r.ok) setRecovery(null);
        }} testId="button-submit-recovery">Record</Button></div></div>}
  </Section>;
}

function BulkCollections({ data, fin, report, schoolId, termId, terms, setTermId, readOnly }: Ctx & { schoolId?: number; termId?: number; terms: { id: number; name: string }[]; setTermId: (n: number | undefined) => void; readOnly?: boolean }) {
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [reason, setReason] = useState('');
  const [tx, setTx] = useState<Record<number, string>>({});
  const eligible = data.eligibleStudents.filter(s => s.eligible);
  const ids = [...picked].filter(id => eligible.some(s => s.id === id)).sort((a, b) => a - b);
  const slot = `bulk:${schoolId}:${termId}`;
  const create = async () => {
    const r = await fin.run(slot, 'BULK_CREATE', { schoolId, termId, studentIds: ids, reason: reason.trim() }, true);
    report(r, 'One bulk charge was created for the selected students. Pay through its single checkout, then verify.');
    if (r.ok) { setPicked(new Set()); setReason(''); }
  };
  return <Section eyebrow="Bulk collection" title={readOnly ? 'Bulk collections (select a school to collect)' : 'Collect for several students in one charge'} testId="bulk-collections">
    {!readOnly && <>
      {!schoolId || !termId ? <div className="max-w-sm"><Field label="Choose the term to collect for"><select value={termId ?? ''} onChange={e => setTermId(e.target.value ? Number(e.target.value) : undefined)} data-testid="select-bulk-term">
        <option value="">Select a term</option>{terms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field></div>
        : data.eligibleStudents.length === 0 ? <Empty>No students are listed for this term.</Empty> : <>
          <div className="mb-2 flex justify-end"><button type="button" className="text-xs font-bold underline" onClick={() => setPicked(new Set(eligible.map(s => s.id)))} data-testid="button-select-all-eligible">Select all eligible ({eligible.length})</button></div>
          <ul className="grid gap-2 md:grid-cols-2">{data.eligibleStudents.map(s => <li key={s.id}><label className={`${box} flex items-start gap-3 p-3 ${s.eligible ? '' : 'opacity-60'}`}>
            <input type="checkbox" className="mt-0.5 h-4 w-4 !w-4" disabled={!s.eligible} checked={picked.has(s.id)} onChange={() => setPicked(p => { const n = new Set(p); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })} data-testid={`check-student-${s.id}`} />
            <span><span className="block text-sm font-semibold">{s.name}</span>{s.reason && <span className={`text-xs ${muted}`}>{s.reason}</span>}</span></label></li>)}</ul>
          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <Field label="Reason"><input value={reason} onChange={e => setReason(e.target.value)} data-testid="input-bulk-reason" /></Field>
            <Button disabled={!ids.length || reason.trim().length < 3 || fin.busy === slot} onClick={() => void create()} testId="button-create-bulk">{fin.pendingKey(slot) ? 'Resubmit same bulk charge' : `Create one charge for ${ids.length}`}</Button>
          </div></>}
    </>}
    <div className="mt-5 space-y-3">{data.batches.length === 0 ? <Empty>No bulk collections yet.</Empty> : data.batches.map(b => {
      const url = safeHttpsUrl(b.checkoutUrl);
      const unresolved = b.items.filter(i => i.state !== 'POSTED');
      const verified = VERIFIED_PHASES.includes(b.state);
      return <div key={b.id} className={`${box} p-4`} data-testid={`batch-${b.id}`}>
        <div className="flex flex-wrap items-center justify-between gap-2"><div><span className="font-mono text-xs">{b.reference}</span> <StatusPill value={b.state} /></div><span className="font-mono font-bold">{naira(b.amountMinor)}</span></div>
        <ul className="mt-2 grid gap-1 text-xs md:grid-cols-2">{b.items.map(i => <li key={i.id} className="flex flex-wrap items-center justify-between gap-2"><span>{i.studentName}{i.error && <span className="ml-1 text-[hsl(var(--destructive))]">{i.error}</span>}</span>
          <span className="flex items-center gap-2"><StatusPill value={i.state} />{verified && i.state === 'POSTED' ? <CurrentFinanceReceiptButton id={b.id} allocationId={i.id} label="Child receipt" /> : null}</span></li>)}</ul>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          {url && !readOnly && (b.state === 'PENDING' || b.state === 'READY') && <a href={url} rel="noopener noreferrer" className="rounded-xl bg-[hsl(var(--primary))] px-3 py-2 text-xs font-bold text-[hsl(var(--primary-foreground))]" data-testid={`link-batch-checkout-${b.id}`}>Open checkout</a>}
          {!readOnly && !verified && b.state !== 'PROCESSING' && <>
            <input className="!w-48 !py-1.5 text-xs" placeholder="Provider transaction ID" value={tx[b.id] ?? ''} onChange={e => setTx(t => ({ ...t, [b.id]: e.target.value }))} data-testid={`input-batch-tx-${b.id}`} />
            <Button variant="outline" className="h-8 px-3 text-xs" disabled={!(tx[b.id] ?? '').trim() || fin.busy === `bv:${b.id}`} onClick={async () => report(await fin.run(`bv:${b.id}`, 'BULK_VERIFY', { id: b.id, transactionId: (tx[b.id] ?? '').trim() }, false), 'Verification requested with the provider. Only server-verified items are treated as paid.')} testId={`button-verify-batch-${b.id}`}>Verify payment</Button></>}
          {!readOnly && verified && (b.state === 'RECOVERY_REQUIRED' || unresolved.length > 0) && <Button variant="outline" className="h-8 px-3 text-xs" disabled={fin.busy === `br:${b.id}`} onClick={async () => report(await fin.run(`br:${b.id}`, 'BULK_RECOVER', { id: b.id }, false), `Recovery applied to ${unresolved.length} unresolved item(s) only.`)} testId={`button-recover-batch-${b.id}`}>Recover {unresolved.length} unresolved</Button>}
          {verified && <CurrentFinanceReceiptButton id={b.id} label="Batch receipt" />}
        </div></div>;
    })}</div>
  </Section>;
}

function PaymentsAndRefunds({ data, fin, report, owner }: Ctx & { owner: boolean }) {
  const [refundFor, setRefundFor] = useState<Payment | null>(null);
  const [amount, setAmount] = useState(''); const [reason, setReason] = useState('');
  const [reversal, setReversal] = useState<{ source: Source; sourceId: number; ref: string } | null>(null);
  const amountMinor = toMinor(amount);
  const refundable = useMemo(() => data.payments.filter(p => p.netPaidMinor > 0), [data.payments]);
  const refundSlot = refundFor ? `refund:${refundFor.source}:${refundFor.id}` : '';
  return <>
    <Section eyebrow="Verified payments" title="Payments received" testId="finance-payments">
      {!owner && <p className={`mb-3 text-xs ${muted}`} data-testid="refund-owner-review">Refunds are created and reviewed by the Platform Owner. Contact the Owner with the payment reference to request one.</p>}
      {data.payments.length === 0 ? <Empty>No verified payments in this scope.</Empty> :
        <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className={`text-xs ${muted}`}><tr><th className="p-2">Student</th><th className="p-2">Reference</th><th className="p-2">Paid</th><th className="p-2">Refunded</th><th className="p-2">Net</th><th className="p-2">State</th><th className="p-2"></th></tr></thead>
          <tbody>{data.payments.map(p => <tr key={`${p.source}-${p.id}`} className="border-t border-[hsl(var(--border))]">
            <td className="p-2 font-semibold">{p.studentName}<div className={`text-[10px] ${muted}`}>{p.source}</div></td><td className="p-2 font-mono text-xs">{p.reference}</td>
            <td className="p-2 font-mono">{naira(p.amountMinor)}</td><td className="p-2 font-mono">{naira(p.refundedMinor)}</td><td className="p-2 font-mono font-bold">{naira(p.netPaidMinor)}</td>
            <td className="p-2"><StatusPill value={p.state} /></td>
            <td className="p-2"><span className="flex flex-wrap gap-2">
              {owner && p.netPaidMinor > 0 && <Button variant="outline" className="h-8 px-3 text-xs" onClick={() => { setRefundFor(p); setAmount(''); setReason(''); }} testId={`button-refund-${p.source}-${p.id}`}>Refund</Button>}
              {owner && <Button variant="quiet" className="h-8 px-3 text-xs" onClick={() => setReversal({ source: p.source, sourceId: p.id, ref: '' })} testId={`button-reversal-${p.source}-${p.id}`}>Record reversal</Button>}
            </span></td></tr>)}</tbody></table></div>}
      {owner && refundFor && refundable.includes(refundFor) && <div className={`${box} mt-4 grid gap-3 p-4 md:grid-cols-[1fr_2fr_auto] md:items-end`} data-testid="form-refund">
        <Field label={`Amount (NGN), up to ${naira(refundFor.netPaidMinor)}`} error={amount && (!amountMinor || amountMinor > refundFor.netPaidMinor) ? 'Enter a positive amount within the net paid.' : undefined}>
          <input inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} data-testid="input-refund-amount" /></Field>
        <Field label={`Reason for refunding ${refundFor.studentName}`}><input value={reason} onChange={e => setReason(e.target.value)} data-testid="input-refund-reason" /></Field>
        <div className="flex gap-2"><Button variant="outline" onClick={() => setRefundFor(null)}>Cancel</Button>
          <Button disabled={!amountMinor || amountMinor > refundFor.netPaidMinor || reason.trim().length < 3 || fin.busy === refundSlot} onClick={async () => {
            const r = await fin.run(refundSlot, 'REFUND_REQUEST', { source: refundFor.source, sourceId: refundFor.id, amountMinor, reason: reason.trim() }, true);
            report(r, 'Refund requested. It needs approval and dispatch before any money leaves.'); if (r.ok) setRefundFor(null);
          }} testId="button-submit-refund">{fin.pendingKey(refundSlot) ? 'Resubmit same refund' : 'Request refund'}</Button></div></div>}
      {reversal && <div className={`${box} mt-4 grid gap-3 p-4 md:grid-cols-[1fr_auto] md:items-end`} data-testid="form-reversal">
        <Field label={`Provider reversal event reference for ${reversal.source} payment #${reversal.sourceId}`}><input value={reversal.ref} onChange={e => setReversal({ ...reversal, ref: e.target.value })} data-testid="input-reversal-ref" /></Field>
        <div className="flex gap-2"><Button variant="outline" onClick={() => setReversal(null)}>Cancel</Button>
          <Button variant="danger" disabled={reversal.ref.trim().length < 3 || fin.busy === `rev:${reversal.sourceId}`} onClick={async () => {
            const r = await fin.run(`rev:${reversal.sourceId}`, 'COLLECTION_REVERSAL', { source: reversal.source, sourceId: reversal.sourceId, eventReference: reversal.ref.trim() }, true);
            report(r, 'Collection reversal recorded.'); if (r.ok) setReversal(null);
          }} testId="button-submit-reversal">Record reversal</Button></div></div>}
    </Section>
    <Section eyebrow="Refunds" title="Refund pipeline" testId="finance-refunds">
      {data.refunds.length === 0 ? <Empty>No refunds requested.</Empty> : <ul className="divide-y divide-[hsl(var(--border))] text-sm">{data.refunds.map(rf => <li key={rf.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
        <span><b>{rf.studentName}</b> <span className="font-mono">{naira(rf.amountMinor)}</span> <span className={`text-xs ${muted}`}>{rf.source} #{rf.sourceId}</span></span>
        <span className="flex flex-wrap items-center gap-2"><StatusPill value={rf.state} />
          {owner && rf.state === 'REQUESTED' && <Button className="h-8 px-3 text-xs" disabled={fin.busy === `ra:${rf.id}`} onClick={async () => report(await fin.run(`ra:${rf.id}`, 'REFUND_APPROVE', { id: rf.id }, true), 'Refund approved. Dispatch is a separate step.')} testId={`button-approve-refund-${rf.id}`}>Approve</Button>}
          {owner && rf.state === 'APPROVED' && <Button className="h-8 px-3 text-xs" disabled={fin.busy === `rd:${rf.id}`} onClick={async () => report(await fin.run(`rd:${rf.id}`, 'REFUND_DISPATCH', { id: rf.id }, false), 'Refund dispatch requested from the provider.')} testId={`button-dispatch-refund-${rf.id}`}>Dispatch</Button>}
          {owner && ['PENDING','DISPATCHED', 'PROCESSING', 'UNKNOWN'].includes(rf.state) && <Button variant="outline" className="h-8 px-3 text-xs" disabled={fin.busy === `rr:${rf.id}`} onClick={async () => report(await fin.run(`rr:${rf.id}`, 'REFUND_RECONCILE', { id: rf.id }, false), 'Refund status checked. Pending is not completed; the server independently verifies the outcome.')} testId={`button-reconcile-refund-${rf.id}`}>Check refund status</Button>}
        </span></li>)}</ul>}
      <p className={`mt-3 flex items-center gap-2 text-xs ${muted}`}><Receipt size={13} />If the provider cannot dispatch or reconcile refunds, the server message is shown as-is; nothing is marked refunded locally.</p>
    </Section>
  </>;
}
