import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useSearchTransportEmployees, useListTransportRouteStaff, useAssignTransportRouteStaff, useUpdateTransportRouteStaff,
  useUpsertTransportAssignmentFeePlan, useCancelTransportAssignmentFeePlan, useListAcademicSessions, useListAcademicTerms,
  useListFeeCategories, useGetSchoolTransportPolicy, useUpdateSchoolTransportPolicy, useGenerateCurrentTermTransportInvoices,
  type TransportRoute, type TransportAssignment,
} from '@workspace/api-client-react';
import { Button, ErrorState, Field, Modal, StatusPill, date } from '@/components/shared';
import { ListSkeleton, Notice, inputCls } from '@/components/transport-parts';
import { STAFF_ROLES, buildFeePlanRequest, employeeSearchParams, errorMessage, formatNaira, type StaffRole } from '@/components/transport-logic';

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ predicate: q => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).toLowerCase().includes('transport') });
}
const key = (...p: unknown[]) => ['/api/transport', ...p];

export function RouteStaffModal({ schoolId, route, onClose }: { schoolId: number; route: TransportRoute; onClose: () => void }) {
  const invalidate = useInvalidate();
  const [role, setRole] = useState<StaffRole>('ACCOMPANIER');
  const [search, setSearch] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const staff = useListTransportRouteStaff(route.id, { schoolId }, { query: { queryKey: key('route-staff', route.id, schoolId), refetchInterval: 30000, staleTime: 15000 } });
  const found = useSearchTransportEmployees(employeeSearchParams(schoolId, search, role), { query: { queryKey: key('employees', schoolId, role, search.trim()), staleTime: 15000 } });
  const assign = useAssignTransportRouteStaff();
  const update = useUpdateTransportRouteStaff();
  const active = (staff.data ?? []).filter(s => s.isActive);
  const taken = new Set(active.map(s => s.employeeId));
  const opts = { onSuccess: () => { setErr(null); invalidate(); }, onError: (x: unknown) => setErr(errorMessage(x)) };
  return (
    <Modal title={`Bus companions - ${route.name}`} onClose={onClose}>
      <div className="space-y-4" data-testid="route-staff-modal">
        {err && <Notice tone="error" testId="route-staff-error">{err}</Notice>}
        {staff.isLoading ? <ListSkeleton rows={2} /> : staff.isError ? <ErrorState retry={() => staff.refetch()} message={errorMessage(staff.error, 'Companions could not be loaded.')} /> : (staff.data ?? []).length ? (
          <ul className="space-y-2">
            {(staff.data ?? []).map(s => (
              <li key={s.routeStaffId} className="flex items-center justify-between gap-3 rounded-xl border border-[hsl(var(--border))] p-3" data-testid={`route-staff-${s.routeStaffId}`}>
                <div><div className="text-sm font-bold">{s.employeeName}</div><div className="text-xs text-[hsl(var(--muted-foreground))]">{s.employeeNo} - {s.employeeType} - {s.role ?? 'ACCOMPANIER'}</div></div>
                <div className="flex items-center gap-2"><StatusPill value={s.isActive ? 'ACTIVE' : 'INACTIVE'} />
                  <Button variant="outline" disabled={update.isPending} onClick={() => update.mutate({ routeId: route.id, routeStaffId: s.routeStaffId, params: { schoolId }, data: { isActive: !s.isActive, reason: s.isActive ? 'Removed from bus companion duty' : 'Restored to bus companion duty' } }, opts)} testId={`button-toggle-staff-${s.routeStaffId}`}>{s.isActive ? 'Remove' : 'Restore'}</Button></div>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-[hsl(var(--muted-foreground))]">No teacher or staff member accompanies this route yet.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Who"><select className={inputCls} value={role} onChange={e => setRole(e.target.value as StaffRole)} data-testid="select-staff-role">{STAFF_ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></Field>
          <Field label="Search by name or number"><input className={inputCls} value={search} onChange={e => setSearch(e.target.value)} data-testid="input-staff-search" /></Field>
        </div>
        {found.isLoading ? <ListSkeleton rows={1} /> : found.isError ? <Notice tone="error">Employees could not be searched. <button className="underline" onClick={() => found.refetch()}>Retry</button></Notice> : (
          <ul className="max-h-48 space-y-2 overflow-auto">
            {(found.data ?? []).filter(e => !taken.has(e.employeeId)).map(e => (
              <li key={e.employeeId} className="flex items-center justify-between gap-3 text-sm">
                <span>{e.employeeName} <span className="text-xs text-[hsl(var(--muted-foreground))]">{e.employeeNo} - {e.employeeType}</span></span>
                <Button variant="outline" disabled={assign.isPending || route.status !== 'ACTIVE'} onClick={() => assign.mutate({ routeId: route.id, params: { schoolId }, data: { employeeId: e.employeeId, role } }, opts)} testId={`button-add-staff-${e.employeeId}`}>Add</Button>
              </li>
            ))}
            {!(found.data ?? []).filter(e => !taken.has(e.employeeId)).length && <li className="text-xs text-[hsl(var(--muted-foreground))]">No matching employees available.</li>}
          </ul>
        )}
      </div>
    </Modal>
  );
}

export function FeePlanModal({ schoolId, a, onClose }: { schoolId: number; a: TransportAssignment; onClose: () => void }) {
  const invalidate = useInvalidate();
  const sessions = useListAcademicSessions({ schoolId }, { query: { queryKey: key('sessions', schoolId), staleTime: 60000 } as never });
  const cats = useListFeeCategories({ schoolId }, { query: { queryKey: key('fee-categories', schoolId), staleTime: 60000 } as never });
  const list = sessions.data ?? [];
  const [sessionId, setSessionId] = useState(String(a.academicSessionId ?? ''));
  const effSession = sessionId || String(list.find(s => s.isCurrent)?.id ?? '');
  const terms = useListAcademicTerms(Number(effSession) || 0, { schoolId }, { query: { queryKey: key('terms', schoolId, effSession), enabled: !!Number(effSession) } as never });
  const [termId, setTermId] = useState(String(a.academicTermId ?? ''));
  const [amount, setAmount] = useState(a.feePlanAmountMinor ? String(a.feePlanAmountMinor / 100) : String(a.feeMinor / 100));
  const [dueDate, setDueDate] = useState(a.dueDate ?? '');
  const [categoryId, setCategoryId] = useState(String(a.feeCategoryId ?? ''));
  const [reason, setReason] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const upsert = useUpsertTransportAssignmentFeePlan();
  const cancel = useCancelTransportAssignmentFeePlan();
  const done = { onSuccess: () => { invalidate(); onClose(); }, onError: (x: unknown) => setErr(errorMessage(x)) };
  const save = () => {
    const r = buildFeePlanRequest(schoolId, a.id, { sessionId: effSession, termId, amount, dueDate, categoryId, reason });
    if ('error' in r) { setErr(r.error ?? null); return; }
    setErr(null); upsert.mutate(r.vars, done);
  };
  return (
    <Modal title={`Fee plan - ${a.studentName}`} onClose={onClose}>
      <div className="space-y-4" data-testid="fee-plan-modal">
        <div className="rounded-xl bg-[hsl(var(--muted)/.5)] p-3 text-xs">Route default fare: <b>{formatNaira(a.feeMinor)}</b>. A term plan overrides it for that term only. Invoices are issued by School Fees.</div>
        {a.feePlans.length > 0 && (
          <ul className="space-y-2" data-testid="fee-plan-list">
            {a.feePlans.map(p => (
              <li key={p.feePlanId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[hsl(var(--border))] p-3 text-sm">
                <span>{p.sessionName} - {p.termName}: <b>{formatNaira(p.feePlanAmountMinor)}</b> due {date(p.dueDate)}{p.feeCategoryName ? ` (${p.feeCategoryName})` : ''}</span>
                <span className="flex items-center gap-2"><StatusPill value={p.status} />
                  {p.status !== 'CANCELLED' && !p.invoiceId && <Button variant="outline" disabled={cancel.isPending} onClick={() => { if (reason.trim().length < 3) return setErr('Enter a reason below before cancelling a plan.'); cancel.mutate({ assignmentId: a.id, academicTermId: p.academicTermId, params: { schoolId }, data: { status: 'CANCELLED', reason: reason.trim() } }, done); }} testId={`button-cancel-plan-${p.feePlanId}`}>Cancel</Button>}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Session"><select className={inputCls} value={effSession} onChange={e => { setSessionId(e.target.value); setTermId(''); }} data-testid="select-plan-session"><option value="">Choose session</option>{list.map(s => <option key={s.id} value={s.id}>{s.name}{s.isCurrent ? ' (current)' : ''}</option>)}</select></Field>
          <Field label="Term"><select className={inputCls} value={termId} onChange={e => { setTermId(e.target.value); const t = (terms.data ?? []).find(x => String(x.id) === e.target.value); if (t && !dueDate) setDueDate(t.endDate.slice(0, 10)); }} data-testid="select-plan-term"><option value="">Choose term</option>{(terms.data ?? []).map(t => <option key={t.id} value={t.id}>{t.name}{t.isCurrent ? ' (current)' : ''}</option>)}</select></Field>
          <Field label="Plan amount (Naira)"><input className={inputCls} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} data-testid="input-plan-amount" /></Field>
          <Field label="Due date"><input type="date" className={inputCls} value={dueDate} onChange={e => setDueDate(e.target.value)} data-testid="input-plan-due" /></Field>
          <Field label="Fee category"><select className={inputCls} value={categoryId} onChange={e => setCategoryId(e.target.value)} data-testid="select-plan-category"><option value="">School Transport (default)</option>{(cats.data ?? []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <div className="flex items-end"><Button variant="outline" onClick={() => setAmount(String(a.feeMinor / 100))} testId="button-use-route-fare">Use route default fare</Button></div>
        </div>
        <Field label="Reason"><input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} data-testid="input-plan-reason" /></Field>
        {err && <Notice tone="error" testId="fee-plan-error">{err}</Notice>}
        <Button onClick={save} disabled={upsert.isPending} testId="button-save-plan">{upsert.isPending ? 'Saving...' : 'Save fee plan'}</Button>
      </div>
    </Modal>
  );
}

export function PolicyPanel({ schoolId }: { schoolId: number }) {
  const invalidate = useInvalidate();
  const q = useGetSchoolTransportPolicy({ schoolId }, { query: { queryKey: key('policy', schoolId), staleTime: 15000 } });
  const terms = useListAcademicSessions({ schoolId, status: 'ACTIVE' } as never, { query: { queryKey: key('policy-sessions', schoolId) } as never });
  const cur = (terms.data ?? []).find(s => s.isCurrent);
  const curTerms = useListAcademicTerms(cur?.id ?? 0, { schoolId }, { query: { queryKey: key('policy-terms', schoolId, cur?.id), enabled: !!cur } as never });
  const term = (curTerms.data ?? []).find(t => t.isCurrent);
  const upd = useUpdateSchoolTransportPolicy();
  const gen = useGenerateCurrentTermTransportInvoices();
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  if (q.isLoading) return <ListSkeleton rows={2} />;
  if (q.isError || !q.data) return <ErrorState retry={() => q.refetch()} message={errorMessage(q.error, 'Transport payment policy could not be loaded.')} />;
  const p = q.data;
  const set = (data: { paymentRequired?: boolean; suspendWhenOverdue?: boolean }) => upd.mutate({ params: { schoolId }, data }, { onSuccess: () => { setMsg(null); invalidate(); }, onError: x => setMsg({ tone: 'error', text: errorMessage(x) }) });
  return (
    <div className="space-y-4" data-testid="transport-policy">
      <div className="panel space-y-3 p-5">
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={p.paymentRequired} disabled={upd.isPending} onChange={e => set(e.target.checked ? { paymentRequired: true } : { paymentRequired: false, suspendWhenOverdue: false })} data-testid="toggle-payment-required" /><span><b>Require payment before transport starts</b><br /><span className="text-xs text-[hsl(var(--muted-foreground))]">New riders need a settled transport invoice.</span></span></label>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={p.suspendWhenOverdue} disabled={upd.isPending || !p.paymentRequired} onChange={e => set({ suspendWhenOverdue: e.target.checked })} data-testid="toggle-suspend-overdue" /><span><b>Suspend riders with overdue invoices</b><br /><span className="text-xs text-[hsl(var(--muted-foreground))]">Requires payment to be required.</span></span></label>
      </div>
      <div className="panel flex flex-wrap items-center justify-between gap-3 p-5">
        <div className="text-sm"><b>Current term invoices</b><div className="text-xs text-[hsl(var(--muted-foreground))]">{term ? `${cur?.name} - ${term.name}` : 'No current term is set in Academics.'}</div></div>
        <Button disabled={!term || gen.isPending} onClick={() => term && gen.mutate({ termId: term.id, params: { schoolId } }, { onSuccess: r => { setMsg({ tone: 'success', text: `${r.generatedInvoiceIds.length} invoice(s) generated from ${r.billableAssignmentCount} billable rider(s).` }); invalidate(); }, onError: x => setMsg({ tone: 'error', text: errorMessage(x) }) })} testId="button-generate-invoices">{gen.isPending ? 'Generating...' : 'Generate invoices'}</Button>
      </div>
      {msg && <Notice tone={msg.tone} testId="policy-message">{msg.text}</Notice>}
    </div>
  );
}
