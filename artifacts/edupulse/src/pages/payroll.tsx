import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Banknote, Users } from 'lucide-react';
import {
  useGetAuthorizedContext,
  useListSchoolPayrollEmployees, useUpdateSchoolPayrollEmployee, useListSchoolPayrollPeriods, useCreateSchoolPayrollPeriod, useGetSchoolPayrollPeriod,
  useUpdateSchoolPayrollPeriodItems, useSubmitSchoolPayrollPeriod, useApproveSchoolPayrollPeriod, useCreateSchoolPayrollTransfers, useReconcileSchoolPayrollTransfer, useGetSchoolPayrollReport,
  useListCompanyPayrollEmployees, useUpsertCompanyPayrollEmployee, useListCompanyPayrollPeriods, useCreateCompanyPayrollPeriod, useGetCompanyPayrollPeriod,
  useUpdateCompanyPayrollPeriodItems, useSubmitCompanyPayrollPeriod, useApproveCompanyPayrollPeriod, useCreateCompanyPayrollTransfers, useReconcileCompanyPayrollTransfer, useGetCompanyPayrollReport,
  getListSchoolPayrollEmployeesQueryKey, getListSchoolPayrollPeriodsQueryKey, getGetSchoolPayrollPeriodQueryKey, getGetSchoolPayrollReportQueryKey,
  getListCompanyPayrollEmployeesQueryKey, getListCompanyPayrollPeriodsQueryKey, getGetCompanyPayrollPeriodQueryKey, getGetCompanyPayrollReportQueryKey,
} from '@workspace/api-client-react';
import type { PayrollEmployeeProfile, PayrollItem, PayrollTransfer } from '@workspace/api-client-react';
import { Button, EmptyState, ErrorState, Field, Info, Metric, Modal, PageHeading, SkeletonPage, StatusPill, TenantPicker, useTenant } from '@/components/shared';
import { BankFields, FRESH_MS, Freshness, IdentityBoundary, Notice, OutcomeBadge, PrintButton, PrintStyles, ProviderBanner, Tabs, csvDownload, currentMonth, entry, errMsg, minorToInput, monthLabel, netOf, ngn, note, toMinor } from './payroll-common';

type Scope = 'COMPANY' | 'SCHOOL';
const OPEN_FOR_TRANSFER = ['APPROVED', 'PROCESSING', 'PARTIALLY_COMPLETED'];
const NEEDS_RECONCILE = ['PENDING', 'MOCK_PENDING', 'PROCESSING', 'CLAIMED', 'UNCERTAIN', 'RECONCILIATION_REQUIRED'];

/** Transfer references survive reload (no bank data stored) so a lost response is reconciled, never re-sent. */
const storeKey = (scope: Scope, schoolId: number, periodId: number) => `payroll-transfers:${scope}:${schoolId}:${periodId}`;
type Local = { transfers: Record<number, PayrollTransfer>; unknown: number[] };
const loadLocal = (k: string): Local => { try { return JSON.parse(sessionStorage.getItem(k) ?? '') as Local; } catch { return { transfers: {}, unknown: [] }; } };

function useApi(scope: Scope, schoolId: number, periodId: number | null, report: { fromMonth: string; toMonth: string } | null) {
  const S = scope === 'SCHOOL' && !!schoolId; const C = scope === 'COMPANY';
  const fresh = { staleTime: FRESH_MS, refetchInterval: FRESH_MS };
  const ep = { status: 'all' as const };
  const sEmp = useListSchoolPayrollEmployees(schoolId, ep, { query: { enabled: S, queryKey: getListSchoolPayrollEmployeesQueryKey(schoolId, ep), ...fresh } });
  const cEmp = useListCompanyPayrollEmployees(ep, { query: { enabled: C, queryKey: getListCompanyPayrollEmployeesQueryKey(ep), ...fresh } });
  const sPer = useListSchoolPayrollPeriods(schoolId, undefined, { query: { enabled: S, queryKey: getListSchoolPayrollPeriodsQueryKey(schoolId), ...fresh } });
  const cPer = useListCompanyPayrollPeriods(undefined, { query: { enabled: C, queryKey: getListCompanyPayrollPeriodsQueryKey(), ...fresh } });
  const sDet = useGetSchoolPayrollPeriod(schoolId, periodId ?? 0, { query: { enabled: S && !!periodId, queryKey: getGetSchoolPayrollPeriodQueryKey(schoolId, periodId ?? 0), ...fresh } });
  const cDet = useGetCompanyPayrollPeriod(periodId ?? 0, { query: { enabled: C && !!periodId, queryKey: getGetCompanyPayrollPeriodQueryKey(periodId ?? 0), ...fresh } });
  const rp = report ?? { fromMonth: currentMonth(), toMonth: currentMonth() };
  const sRep = useGetSchoolPayrollReport(schoolId, rp, { query: { enabled: S && !!report, queryKey: getGetSchoolPayrollReportQueryKey(schoolId, rp), staleTime: FRESH_MS } });
  const cRep = useGetCompanyPayrollReport(rp, { query: { enabled: C && !!report, queryKey: getGetCompanyPayrollReportQueryKey(rp), staleTime: FRESH_MS } });
  const m = {
    sProfile: useUpdateSchoolPayrollEmployee(), cProfile: useUpsertCompanyPayrollEmployee(),
    sCreate: useCreateSchoolPayrollPeriod(), cCreate: useCreateCompanyPayrollPeriod(),
    sItems: useUpdateSchoolPayrollPeriodItems(), cItems: useUpdateCompanyPayrollPeriodItems(),
    sSubmit: useSubmitSchoolPayrollPeriod(), cSubmit: useSubmitCompanyPayrollPeriod(),
    sApprove: useApproveSchoolPayrollPeriod(), cApprove: useApproveCompanyPayrollPeriod(),
    sPay: useCreateSchoolPayrollTransfers(), cPay: useCreateCompanyPayrollTransfers(),
    sRec: useReconcileSchoolPayrollTransfer(), cRec: useReconcileCompanyPayrollTransfer(),
  };
  const school = scope === 'SCHOOL';
  return {
    employees: school ? sEmp : cEmp, periods: school ? sPer : cPer, detail: school ? sDet : cDet, report: school ? sRep : cRep,
    saveProfile: (data: { employeeId: number; monthlySalaryMinor: number; allowanceMinor: number; deductionMinor: number; bankName: string; bankCode: string; accountName: string; accountNumber: string }) => school ? m.sProfile.mutateAsync({ schoolId, data }) : m.cProfile.mutateAsync({ data }),
    createPeriod: (data: { periodMonth: string; employeeIds?: number[] }) => school ? m.sCreate.mutateAsync({ schoolId, data }) : m.cCreate.mutateAsync({ data }),
    saveItems: (pid: number, data: Parameters<typeof m.sItems.mutateAsync>[0]['data']) => school ? m.sItems.mutateAsync({ schoolId, periodId: pid, data }) : m.cItems.mutateAsync({ periodId: pid, data }),
    submit: (pid: number) => school ? m.sSubmit.mutateAsync({ schoolId, periodId: pid }) : m.cSubmit.mutateAsync({ periodId: pid }),
    approve: (pid: number) => school ? m.sApprove.mutateAsync({ schoolId, periodId: pid }) : m.cApprove.mutateAsync({ periodId: pid }),
    pay: (pid: number, employeeIds: number[]) => school ? m.sPay.mutateAsync({ schoolId, periodId: pid, data: { employeeIds } }) : m.cPay.mutateAsync({ periodId: pid, data: { employeeIds } }),
    reconcile: (tid: number) => school ? m.sRec.mutateAsync({ schoolId, transferId: tid }) : m.cRec.mutateAsync({ transferId: tid }),
    busy: Object.values(m).some(x => x.isPending),
  };
}

function ProfileEditor({ emp, onSave, onClose, saving, error }: { emp: PayrollEmployeeProfile; onSave: (d: { employeeId: number; monthlySalaryMinor: number; allowanceMinor: number; deductionMinor: number; bankName: string; bankCode: string; accountName: string; accountNumber: string }) => void; onClose: () => void; saving: boolean; error: string }) {
  const [sal, setSal] = useState(minorToInput(emp.monthlySalaryMinor)); const [al, setAl] = useState(minorToInput(emp.allowanceMinor)); const [de, setDe] = useState(minorToInput(emp.deductionMinor));
  const [bank, setBank] = useState({ bankName: emp.bankName ?? '', bankCode: emp.bankCode ?? '', accountName: emp.accountName ?? emp.fullName, accountNumber: '' });
  const [local, setLocal] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const a = toMinor(sal), b = toMinor(al), c = toMinor(de);
    if ([a, b, c].some(Number.isNaN) || a < 1) { setLocal('Enter valid naira amounts; salary must be above zero.'); return; }
    onSave({ employeeId: emp.employeeId, monthlySalaryMinor: a, allowanceMinor: b, deductionMinor: c, ...bank, bankName: bank.bankName.trim(), accountName: bank.accountName.trim() });
  };
  return <Modal title={emp.fullName} eyebrow="Payroll profile" onClose={onClose}>
    <form onSubmit={submit} className="space-y-4" data-testid="form-payroll-profile">
      {(local || error) && <Notice kind="error">{local || error}</Notice>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Base salary (NGN)"><input className={entry} inputMode="decimal" value={sal} onChange={e => setSal(e.target.value)} /></Field>
        <Field label="Allowance"><input className={entry} inputMode="decimal" value={al} onChange={e => setAl(e.target.value)} /></Field>
        <Field label="Deduction"><input className={entry} inputMode="decimal" value={de} onChange={e => setDe(e.target.value)} /></Field>
      </div>
      <BankFields v={bank} set={p => setBank(s => ({ ...s, ...p }))} maskedCurrent={emp.maskedAccountNumber} />
      <p className={note}>Saved details are submitted to the server for encryption. Entering a bank account does not confirm any payment.</p>
      <Button type="submit" disabled={saving || bank.accountNumber.length !== 10} testId="button-save-profile">{saving ? 'Saving...' : 'Save profile'}</Button>
    </form></Modal>;
}

type Row = { allowance: string; bonus: string; deduction: string; adjustment: string; reason: string };

function PeriodWorkspace({ scope, schoolId, periodId, api, onBack, setMsg, setFail, refresh }: { scope: Scope; schoolId: number; periodId: number; api: ReturnType<typeof useApi>; onBack: () => void; setMsg: (s: string) => void; setFail: (s: string) => void; refresh: () => void }) {
  const period = api.detail.data;
  const key = storeKey(scope, schoolId, periodId);
  const [local, setLocal] = useState<Local>(() => loadLocal(key));
  const persist = (n: Local) => { setLocal(n); sessionStorage.setItem(key, JSON.stringify(n)); };
  const [rows, setRows] = useState<Record<number, Row>>({});
  const initFor = useRef<string>('');
  const [sel, setSel] = useState<number[]>([]);
  const items = period?.items;
  const status = period?.status;
  useEffect(() => {
    if (!items || !status) return;
    const sig = `${periodId}:${status}`;
    if (initFor.current === sig) return;
    initFor.current = sig;
    setRows(Object.fromEntries(items.map(i => [i.employeeId, { allowance: minorToInput(i.allowanceMinor), bonus: minorToInput(i.bonusMinor), deduction: minorToInput(i.deductionMinor), adjustment: minorToInput(i.adjustmentMinor), reason: i.adjustmentReason ?? '' }])));
  }, [items, status, periodId]);
  if (api.detail.isLoading) return <SkeletonPage />;
  if (api.detail.isError || !period) return <ErrorState retry={() => api.detail.refetch()} />;
  const draft = period.status === 'DRAFT';
  const canTransfer = OPEN_FOR_TRANSFER.includes(period.status) && period.providerMode !== 'NOT_CONFIGURED';
  const calc = (i: PayrollItem) => {
    const r = rows[i.employeeId]; if (!r) return { net: i.netSalaryMinor, ok: true };
    const v = [toMinor(r.allowance), toMinor(r.bonus), toMinor(r.deduction), toMinor(r.adjustment, true)];
    if (v.some(Number.isNaN)) return { net: NaN, ok: false };
    const net = netOf(i.baseSalaryMinor, v[0], v[1], v[2], v[3]);
    return { net, ok: net >= 0 && (v[3] === 0 || r.reason.trim().length > 0) };
  };
  const allOk = draft && period.items.every(i => calc(i).ok);
  const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); setFail(''); setMsg(ok); refresh(); } catch (e) { setFail(errMsg(e)); } };
  const saveItems = () => run(() => api.saveItems(periodId, { items: period.items.map(i => { const r = rows[i.employeeId]; return { employeeId: i.employeeId, allowanceMinor: toMinor(r.allowance), bonusMinor: toMinor(r.bonus), deductionMinor: toMinor(r.deduction), adjustmentMinor: toMinor(r.adjustment, true), adjustmentReason: r.reason.trim() }; }) }), 'Payroll lines saved; net pay recalculated by the server.');
  const send = async (ids: number[]) => {
    const failedRetry = ids.filter(id => period.items.find(i => i.employeeId === id)?.paymentStatus === 'FAILED');
    if (!window.confirm(`Send ${ids.length} transfer${ids.length > 1 ? 's' : ''} to the provider? ${scope === 'COMPANY' ? 'Funds come from the company account.' : 'Funds come from this school account.'} Paid status appears only after the provider verifies it.${failedRetry.length ? ' Some were previously verified as failed.' : ''}`)) return;
    try {
      const res = await api.pay(periodId, ids);
      const next = { transfers: { ...local.transfers }, unknown: local.unknown.filter(u => !ids.includes(u)) };
      res.items.forEach(t => { next.transfers[t.employeeId] = t; });
      persist(next); setFail(''); setSel([]);
      setMsg(`Provider response: ${res.paidCount} verified paid, ${res.pendingCount} pending, ${res.failedCount} failed, ${res.uncertainCount} need reconciliation.`); refresh();
    } catch (e) {
      persist({ ...local, unknown: Array.from(new Set([...local.unknown, ...ids])) });
      setFail(`${errMsg(e)} The outcome is unknown. Do not resend; refresh and check status.`); refresh();
    }
  };
  const reconcile = (t: PayrollTransfer) => run(async () => { const r = await api.reconcile(t.id); persist({ ...local, transfers: { ...local.transfers, [t.employeeId]: r } }); }, 'Reconciled against the provider for the existing reference. No new transfer was created.');
  const sendable = (i: PayrollItem) => canTransfer && !local.unknown.includes(i.employeeId) && !local.transfers[i.employeeId]?.requiresReconciliation && ['UNPAID', 'FAILED'].includes(i.paymentStatus);
  const bulkIds = sel.filter(id => { const i = period.items.find(x => x.employeeId === id); return i && sendable(i); });
  return <div className="print-area">
    <PrintStyles />
    <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3"><Button variant="quiet" onClick={onBack}>Back to periods</Button><Freshness updatedAt={api.detail.dataUpdatedAt} fetching={api.detail.isFetching} onRefresh={() => api.detail.refetch()} /></div>
    <ProviderBanner mode={period.providerMode} />
    <div className="mb-5 grid gap-4 sm:grid-cols-4"><Metric label="Period" value={monthLabel(period.periodMonth)} icon={Banknote} /><Metric label="Net payroll" value={ngn(period.netSalaryMinor)} icon={Banknote} accent /><Metric label="Verified paid" value={`${period.paidCount} / ${period.employeeCount}`} icon={Users} detail={`${period.pendingCount} pending, ${period.failedCount} failed`} /><Info label="Status" value={<StatusPill value={period.status.replaceAll('_', ' ')} />} /></div>
    <div className="no-print mb-4 flex flex-wrap gap-2">
      {draft && <Button variant="outline" disabled={api.busy || !allOk} onClick={saveItems} testId="button-save-items">Save lines</Button>}
      {draft && <Button disabled={api.busy} onClick={() => window.confirm('Submit this payroll for approval? Lines lock once submitted.') && run(() => api.submit(periodId), 'Submitted for approval.')} testId="button-submit-period">Submit for review</Button>}
      {period.status === 'PENDING_APPROVAL' && <Button disabled={api.busy} onClick={() => window.confirm('Approve this payroll? Approval does not pay anyone; transfers are sent separately.') && run(() => api.approve(periodId), 'Approved. No money has moved yet.')} testId="button-approve-period">Approve</Button>}
      {canTransfer && <Button disabled={api.busy || !bulkIds.length} onClick={() => send(bulkIds)} testId="button-bulk-transfer">Send selected ({bulkIds.length})</Button>}
      <PrintButton label="Print summary" />
    </div>
    {OPEN_FOR_TRANSFER.includes(period.status) && period.providerMode === 'NOT_CONFIGURED' && <Notice kind="error">Transfers are blocked: the provider is not configured for this environment.</Notice>}
    <div className="panel overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm">
      <thead className="eyebrow"><tr>{canTransfer && <th className="no-print p-3" />}<th className="p-3">Employee</th><th className="p-3 text-right">Base</th><th className="p-3">Allowance</th><th className="p-3">Bonus</th><th className="p-3">Deduction</th><th className="p-3">Adjustment</th><th className="p-3 text-right">Net</th><th className="p-3">Outcome</th><th className="no-print p-3" /></tr></thead>
      <tbody className="divide-y divide-[hsl(var(--border))]">{period.items.map(i => {
        const r = rows[i.employeeId]; const c = calc(i); const t = local.transfers[i.employeeId]; const unknown = local.unknown.includes(i.employeeId);
        const cell = (k: keyof Row) => draft && r ? <input aria-label={`${k} for ${i.fullName}`} className={`${entry} w-28 px-2 py-1.5`} inputMode="decimal" value={r[k]} onChange={e => setRows(s => ({ ...s, [i.employeeId]: { ...s[i.employeeId], [k]: e.target.value } }))} /> : null;
        return <tr key={i.employeeId} data-testid={`row-payroll-${i.employeeId}`}>
          {canTransfer && <td className="no-print p-3"><input type="checkbox" disabled={!sendable(i)} checked={sel.includes(i.employeeId)} onChange={e => setSel(s => e.target.checked ? [...s, i.employeeId] : s.filter(x => x !== i.employeeId))} aria-label={`Select ${i.fullName}`} /></td>}
          <td className="p-3"><div className="font-bold">{i.fullName}</div><div className={note}>{i.jobTitle ?? i.employeeType} / {i.bankName ?? 'No bank'} {i.maskedAccountNumber ?? ''}</div></td>
          <td className="p-3 text-right tabular-nums">{ngn(i.baseSalaryMinor)}</td>
          <td className="p-3">{cell('allowance') ?? ngn(i.allowanceMinor)}</td><td className="p-3">{cell('bonus') ?? ngn(i.bonusMinor)}</td><td className="p-3">{cell('deduction') ?? ngn(i.deductionMinor)}</td>
          <td className="p-3">{draft && r ? <div className="space-y-1">{cell('adjustment')}<input aria-label={`Adjustment reason for ${i.fullName}`} placeholder="Reason" className={`${entry} w-28 px-2 py-1.5`} value={r.reason} onChange={e => setRows(s => ({ ...s, [i.employeeId]: { ...s[i.employeeId], reason: e.target.value } }))} /></div> : <>{ngn(i.adjustmentMinor)}<div className={note}>{i.adjustmentReason}</div></>}</td>
          <td className={`p-3 text-right font-bold tabular-nums ${c.ok ? '' : 'text-[hsl(var(--destructive))]'}`}>{Number.isNaN(c.net) ? 'Invalid' : ngn(c.net)}</td>
          <td className="p-3">{unknown ? <span className="text-xs font-bold text-[hsl(var(--destructive))]">Request outcome unknown - do not resend</span> : <OutcomeBadge status={t?.status ?? i.paymentStatus} verified={t?.externalTransferVerified} />}{t?.failureMessage && <div className={note}>{t.failureMessage}</div>}{(t?.providerReference ?? i.transferReference) && <div className="font-mono text-[10px]">{t?.providerReference ?? i.transferReference}</div>}</td>
          <td className="no-print p-3"><div className="flex gap-1">
            {sendable(i) && <Button variant="outline" disabled={api.busy} onClick={() => send([i.employeeId])} testId={`button-transfer-${i.employeeId}`}>Send</Button>}
            {t && (NEEDS_RECONCILE.includes(t.status) || t.requiresReconciliation) && <Button variant="outline" disabled={api.busy} onClick={() => reconcile(t)} testId={`button-reconcile-${i.employeeId}`}>Reconcile</Button>}
            {unknown && !t && <span className={note}>No local reference. Refresh to see server status.</span>}
          </div></td></tr>; })}</tbody></table></div>
    {draft && !allOk && <p className="mt-3 text-sm text-[hsl(var(--destructive))]" role="alert">Fix invalid amounts, negative net pay, or add a reason for each non-zero adjustment before saving.</p>}
  </div>;
}

function Reports({ scope, schoolId, api: _a }: { scope: Scope; schoolId: number; api?: never }) {
  const [from, setFrom] = useState(currentMonth().slice(0, 4) + '-01'); const [to, setTo] = useState(currentMonth());
  const [applied, setApplied] = useState<{ fromMonth: string; toMonth: string }>({ fromMonth: from, toMonth: to });
  const api = useApi(scope, schoolId, null, applied);
  const r = api.report; const rows = r.data ?? [];
  return <section className="panel p-5">
    <div className="no-print mb-4 flex flex-wrap items-end gap-3"><Field label="From"><input type="month" className={entry} value={from} onChange={e => setFrom(e.target.value)} /></Field><Field label="To"><input type="month" className={entry} value={to} onChange={e => setTo(e.target.value)} /></Field>
      <Button onClick={() => from && to && from <= to && setApplied({ fromMonth: from, toMonth: to })} disabled={!from || !to || from > to}>Run report</Button>
      <Button variant="outline" disabled={!rows.length} onClick={() => csvDownload(`payroll-report-${applied.fromMonth}-${applied.toMonth}.csv`, [['Month', 'Employees', 'Gross', 'Allowance', 'Bonus', 'Deduction', 'Net', 'Verified paid', 'Pending', 'Failed'], ...rows.map(x => [x.periodMonth, x.employeeCount, ngn(x.grossSalaryMinor), ngn(x.allowanceMinor), ngn(x.bonusMinor), ngn(x.deductionMinor), ngn(x.netSalaryMinor), ngn(x.paidAmountMinor), ngn(x.pendingAmountMinor), x.failedCount])])}>Export CSV</Button><PrintButton /></div>
    {r.isLoading ? <SkeletonPage /> : r.isError ? <ErrorState retry={() => r.refetch()} /> : !rows.length ? <EmptyState icon={Banknote} title="No payroll in this range" description="Choose another range, or create a payroll period first." /> :
      <div className="print-area overflow-x-auto"><PrintStyles /><table className="w-full min-w-[720px] text-left text-sm"><thead className="eyebrow"><tr><th className="p-3">Month</th><th className="p-3 text-right">Staff</th><th className="p-3 text-right">Net</th><th className="p-3 text-right">Verified paid</th><th className="p-3 text-right">Pending</th><th className="p-3 text-right">Failed</th></tr></thead>
        <tbody className="divide-y divide-[hsl(var(--border))]">{rows.map(x => <tr key={x.periodMonth}><td className="p-3 font-bold">{monthLabel(x.periodMonth)}</td><td className="p-3 text-right">{x.employeeCount}</td><td className="p-3 text-right tabular-nums">{ngn(x.netSalaryMinor)}</td><td className="p-3 text-right tabular-nums">{ngn(x.paidAmountMinor)}</td><td className="p-3 text-right tabular-nums">{ngn(x.pendingAmountMinor)}</td><td className="p-3 text-right">{x.failedCount}</td></tr>)}</tbody></table><p className={`mt-3 ${note}`}>Bank details are excluded from reports.</p></div>}
  </section>;
}

function Workspace({ scope, schoolId }: { scope: Scope; schoolId: number }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'periods' | 'employees' | 'reports'>('periods');
  const [periodId, setPeriodId] = useState<number | null>(null);
  const [editing, setEditing] = useState<PayrollEmployeeProfile | null>(null);
  const [creating, setCreating] = useState(false);
  const [month, setMonth] = useState(currentMonth()); const [chosen, setChosen] = useState<number[] | null>(null);
  const [msg, setMsg] = useState(''); const [fail, setFail] = useState(''); const [dialogErr, setDialogErr] = useState('');
  const api = useApi(scope, schoolId, periodId, null);
  const refresh = () => qc.invalidateQueries({ predicate: q => typeof q.queryKey[0] === 'string' && /payroll/.test(q.queryKey[0]) });
  const emps = useMemo(() => api.employees.data ?? [], [api.employees.data]);
  const eligible = emps.filter(e => e.status === 'ACTIVE' && e.bankConfigured && e.monthlySalaryMinor > 0);
  const saveProfile = async (d: Parameters<typeof api.saveProfile>[0]) => { try { await api.saveProfile(d); setEditing(null); setDialogErr(''); setMsg('Payroll profile saved.'); refresh(); } catch (e) { setDialogErr(errMsg(e)); } };
  const create = async (e: FormEvent) => { e.preventDefault(); try { const p = await api.createPeriod({ periodMonth: month, ...(chosen?.length ? { employeeIds: chosen } : {}) }); setCreating(false); setDialogErr(''); setMsg(`Draft payroll for ${monthLabel(month)} created.`); refresh(); setPeriodId(p.periodId); setTab('periods'); } catch (er) { setDialogErr(errMsg(er)); } };
  const loadingAny = api.employees.isLoading || api.periods.isLoading;
  return <div>
    <IdentityBoundary scope={scope} />
    {scope === 'SCHOOL' && <p className={`mb-4 ${note}`}>Only this school's teachers and staff appear here.</p>}
    {msg && <Notice kind="ok" onClose={() => setMsg('')}>{msg}</Notice>}{fail && <Notice kind="error" onClose={() => setFail('')}>{fail}</Notice>}
    {periodId ? <PeriodWorkspace key={`${scope}-${schoolId}-${periodId}`} scope={scope} schoolId={schoolId} periodId={periodId} api={api} onBack={() => setPeriodId(null)} setMsg={setMsg} setFail={setFail} refresh={refresh} /> : <>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3"><Tabs tabs={[['periods', 'Pay periods'], ['employees', scope === 'COMPANY' ? 'Company employees' : 'Teachers and staff'], ['reports', 'Reports']] as const} value={tab} onChange={setTab} />
        <Freshness updatedAt={Math.max(api.periods.dataUpdatedAt, api.employees.dataUpdatedAt)} fetching={api.periods.isFetching || api.employees.isFetching} onRefresh={refresh} /></div>
      {tab === 'periods' && (loadingAny ? <SkeletonPage /> : api.periods.isError ? <ErrorState retry={() => api.periods.refetch()} /> : <section className="panel overflow-hidden">
        <div className="flex items-center justify-between border-b border-[hsl(var(--border))] p-5"><h2 className="display-font text-xl font-bold">Pay periods</h2><Button onClick={() => { setChosen(null); setDialogErr(''); setCreating(true); }} testId="button-new-period">New monthly payroll</Button></div>
        {!(api.periods.data ?? []).length ? <EmptyState icon={Banknote} title="No payroll yet" description="Create a monthly period from staff who have salary and bank details configured." /> :
          <div className="divide-y divide-[hsl(var(--border))]">{(api.periods.data ?? []).map(p => <button key={p.periodId} type="button" onClick={() => setPeriodId(p.periodId)} className="grid w-full gap-3 p-5 text-left hover:bg-[hsl(var(--muted)/.3)] sm:grid-cols-[1.2fr_1fr_1fr_auto] sm:items-center" data-testid={`row-period-${p.periodId}`}>
            <div className="font-bold">{monthLabel(p.periodMonth)}</div><div className="text-sm">{p.employeeCount} staff / {ngn(p.netSalaryMinor)}</div><div className={note}>{p.paidCount} verified paid, {p.pendingCount} pending, {p.failedCount} failed</div><StatusPill value={p.status.replaceAll('_', ' ')} /></button>)}</div>}
      </section>)}
      {tab === 'employees' && (api.employees.isLoading ? <SkeletonPage /> : api.employees.isError ? <ErrorState retry={() => api.employees.refetch()} /> : !emps.length ? <EmptyState icon={Users} title="No employees" description={scope === 'COMPANY' ? 'Add company employees first on the Company Employees page.' : 'Add teachers and staff on the Employees page first.'} /> :
        <section className="panel divide-y divide-[hsl(var(--border))]">{emps.map(e => <div key={e.employeeId} className="flex flex-wrap items-center gap-4 p-4" data-testid={`row-employee-${e.employeeId}`}>
          <div className="min-w-0 flex-1"><div className="font-bold">{e.fullName}</div><div className={note}>{e.jobTitle ?? e.employeeType} / {e.bankConfigured ? `${e.bankName} ${e.maskedAccountNumber ?? ''}` : 'Bank not configured'}</div></div>
          <div className="text-sm tabular-nums">{ngn(e.monthlySalaryMinor)}</div><StatusPill value={e.status} /><Button variant="outline" onClick={() => { setDialogErr(''); setEditing(e); }} testId={`button-edit-profile-${e.employeeId}`}>Configure</Button></div>)}</section>)}
      {tab === 'reports' && <Reports scope={scope} schoolId={schoolId} />}
    </>}
    {editing && <ProfileEditor key={editing.employeeId} emp={editing} onSave={saveProfile} onClose={() => setEditing(null)} saving={api.busy} error={dialogErr} />}
    {creating && <Modal title="New monthly payroll" eyebrow={scope === 'COMPANY' ? 'Company' : 'School'} onClose={() => setCreating(false)}><form onSubmit={create} className="space-y-4" data-testid="form-new-period">
      {dialogErr && <Notice kind="error">{dialogErr}</Notice>}
      <Field label="Month"><input type="month" required className={entry} value={month} onChange={e => setMonth(e.target.value)} /></Field>
      <div><div className="mb-2 text-xs font-bold text-[hsl(var(--muted-foreground))]">Employees ({chosen ? chosen.length : eligible.length} of {eligible.length} eligible)</div>
        {!eligible.length ? <p className={note}>No active employees with salary and bank details. Configure them first.</p> : <div className="max-h-56 space-y-1 overflow-auto rounded-xl border border-[hsl(var(--border))] p-2">{eligible.map(e => { const on = (chosen ?? eligible.map(x => x.employeeId)).includes(e.employeeId); return <label key={e.employeeId} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={on} onChange={ev => { const cur = chosen ?? eligible.map(x => x.employeeId); setChosen(ev.target.checked ? [...cur, e.employeeId] : cur.filter(x => x !== e.employeeId)); }} />{e.fullName}</label>; })}</div>}</div>
      <Button type="submit" disabled={api.busy || !eligible.length || chosen?.length === 0} testId="button-create-period">{api.busy ? 'Creating...' : 'Create draft'}</Button></form></Modal>}
  </div>;
}

export function PayrollPage() {
  const { schoolId } = useTenant();
  const ctx = useGetAuthorizedContext();
  const isOwner = ctx.data?.isPlatformOwner === true; // Owner scope always wins, even with a secondary School Admin role.
  const isAdmin = !!schoolId && ctx.data?.roles?.some(r => r.schoolId === schoolId && r.role === 'SCHOOL_ADMIN' && r.status === 'ACTIVE') === true;
  return <div className="fade-up">
    <PageHeading eyebrow="Finance / Payroll" title="Payroll" description={isOwner ? 'Yemait company payroll. School payroll is outside Owner operations.' : 'Monthly salaries for this school. Paid appears only after the provider verifies the transfer.'} action={!isOwner && isAdmin ? <TenantPicker /> : undefined} />
    {ctx.isLoading ? <SkeletonPage /> : ctx.isError ? <ErrorState retry={() => ctx.refetch()} /> :
      isOwner ? <Workspace key="company" scope="COMPANY" schoolId={0} /> : isAdmin ? <Workspace key={`school-${schoolId}`} scope="SCHOOL" schoolId={schoolId} /> :
      <EmptyState icon={Banknote} title="Payroll is not available for your role" description="Payroll management is limited to School Admins for their school and the Owner for company payroll." />}
  </div>;
}
