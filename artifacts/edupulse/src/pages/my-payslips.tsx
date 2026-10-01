import { useState } from 'react';
import { Banknote } from 'lucide-react';
import { useListMyPayrollPayslips, useGetMyPayrollPayslip, getListMyPayrollPayslipsQueryKey, getGetMyPayrollPayslipQueryKey } from '@workspace/api-client-react';
import type { OwnPayrollPayslip } from '@workspace/api-client-react';
import { Button, EmptyState, ErrorState, Info, Metric, Modal, PageHeading, SkeletonPage } from '@/components/shared';
import { FRESH_MS, Freshness, PrintButton, PrintStyles, OutcomeBadge, csvDownload, monthLabel, ngn, note } from './payroll-common';

function Slip({ id, fallback }: { id: number; fallback: OwnPayrollPayslip }) {
  const q = useGetMyPayrollPayslip(id, { query: { queryKey: getGetMyPayrollPayslipQueryKey(id), staleTime: FRESH_MS } });
  const p = q.data ?? fallback;
  return <div className="print-area" data-testid="payslip">
    <PrintStyles />
    {q.isError && <p role="alert" className="mb-3 text-sm text-[hsl(var(--destructive))]">Latest copy could not load; showing the list copy.</p>}
    <div className="mb-4"><div className="eyebrow">{p.schoolName ?? 'Yemait company'}</div><div className="display-font text-xl font-bold">{p.employeeName}</div><div className={note}>Payslip for {monthLabel(p.periodMonth)}</div></div>
    <dl className="divide-y divide-[hsl(var(--border))] text-sm">
      {([['Base salary', p.baseSalaryMinor], ['Allowance', p.allowanceMinor], ['Bonus', p.bonusMinor], ['Deductions', -p.deductionMinor], ['Adjustment', p.adjustmentMinor]] as const).map(([l, v]) => <div key={l} className="flex justify-between py-2"><dt>{l}</dt><dd className="tabular-nums">{ngn(v)}</dd></div>)}
      {p.adjustmentReason && <div className="py-2 text-xs">Adjustment reason: {p.adjustmentReason}</div>}
      <div className="flex justify-between py-3 text-base font-bold"><dt>Net salary</dt><dd className="tabular-nums">{ngn(p.netSalaryMinor)}</dd></div>
      <div className="flex justify-between py-2"><dt>Paid to</dt><dd className="font-mono">{p.maskedAccountNumber ?? 'Not on file'}</dd></div>
      <div className="flex justify-between py-2"><dt>Status</dt><dd><OutcomeBadge status={p.paymentStatus} /></dd></div>
      {p.transferReference && <div className="flex justify-between py-2"><dt>Reference</dt><dd className="font-mono text-xs">{p.transferReference}</dd></div>}
    </dl><div className="no-print mt-5"><PrintButton label="Print payslip" /></div>
  </div>;
}

export function MyPayslipsPage() {
  const [open, setOpen] = useState<OwnPayrollPayslip | null>(null);
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const params = { ...(from ? { fromMonth: from } : {}), ...(to ? { toMonth: to } : {}) };
  const q = useListMyPayrollPayslips(params, { query: { queryKey: getListMyPayrollPayslipsQueryKey(params), staleTime: FRESH_MS, refetchInterval: FRESH_MS } });
  const rows = q.data ?? [];
  const latest = rows[0];
  return <div className="fade-up">
    <PageHeading eyebrow="My pay" title="My payslips" description="Your own salary history only. Entries appear after the provider has verified your payment." />
    <div className="mb-5 flex flex-wrap items-end gap-3">
      <label className="block text-xs font-bold">From<input type="month" value={from} onChange={e => setFrom(e.target.value)} className="mt-1 block rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm" /></label>
      <label className="block text-xs font-bold">To<input type="month" value={to} onChange={e => setTo(e.target.value)} className="mt-1 block rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm" /></label>
      <Button variant="outline" disabled={!rows.length} onClick={() => csvDownload('my-payslips.csv', [['Month', 'Net', 'Status', 'Reference'], ...rows.map(r => [r.periodMonth, ngn(r.netSalaryMinor), r.paymentStatus, r.transferReference ?? ''])])}>Export CSV</Button>
      <div className="ml-auto"><Freshness updatedAt={q.dataUpdatedAt} fetching={q.isFetching} onRefresh={() => q.refetch()} /></div>
    </div>
    {q.isLoading ? <SkeletonPage /> : q.isError ? <ErrorState retry={() => q.refetch()} /> : <>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Metric label="Latest net pay" value={latest ? ngn(latest.netSalaryMinor) : '-'} detail={latest ? monthLabel(latest.periodMonth) : 'No payslips yet'} icon={Banknote} accent />
        <Info label="Bank account on file" value={latest?.maskedAccountNumber ? <span className="font-mono">{latest.maskedAccountNumber}</span> : 'None'} />
        <Info label="Bank profile" value="Managed by your school administrator. You cannot edit it here." />
      </div>
      <section className="panel overflow-hidden">{!rows.length ? <EmptyState icon={Banknote} title="No payslips" description="Payslips appear here once your salary has been paid and verified." /> :
        <div className="divide-y divide-[hsl(var(--border))]">{rows.map(r => <button key={r.id} type="button" onClick={() => setOpen(r)} className="grid w-full gap-2 p-5 text-left hover:bg-[hsl(var(--muted)/.3)] sm:grid-cols-[1fr_1fr_auto] sm:items-center" data-testid={`row-payslip-${r.id}`}>
          <div className="font-bold">{monthLabel(r.periodMonth)}</div><div className="tabular-nums">{ngn(r.netSalaryMinor)}</div><OutcomeBadge status={r.paymentStatus} /></button>)}</div>}</section>
    </>}
    {open && <Modal title="Payslip" eyebrow={monthLabel(open.periodMonth)} onClose={() => setOpen(null)}><Slip id={open.id} fallback={open} /></Modal>}
  </div>;
}
