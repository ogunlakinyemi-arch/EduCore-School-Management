import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, BarChart3, FileClock, ShieldCheck } from 'lucide-react';
import {
  useBulkAssignFeeStructure, useRequestFeeRefund, useApproveFeeRefund, useGetSchoolFinanceReport,
  useListSchoolFeeRefunds, useGetSchoolFeeRefund, useGetSchoolFinancePayment,
  useListAcademicSessions, useListAcademicTerms, useListClasses, useListFeeCategories, useListSchoolFinancePayments,
  useGetFeePaymentReceipt, getGetSchoolFinanceReportQueryKey, getListAcademicSessionsQueryKey,
  GetSchoolFinanceReportMethod,
  getListAcademicTermsQueryKey, getListClassesQueryKey, getListFeeCategoriesQueryKey,
  getListSchoolFinancePaymentsQueryKey, getGetFeePaymentReceiptQueryKey,
  getListFeeInvoicesQueryKey, getGetSchoolFinanceSummaryQueryKey,
  getListParentFeeInvoicesQueryKey, getListStudentFeeInvoicesQueryKey,
  getListParentFeePaymentsQueryKey, getListStudentFeePaymentsQueryKey,
  getListSchoolFeeRefundsQueryKey, getGetSchoolFeeRefundQueryKey, getGetSchoolFinancePaymentQueryKey,
} from '@workspace/api-client-react';
import type { FeeBulkAssignmentResult, FeePaymentHistory, FeeStructure, GetSchoolFinanceReportParams, GetSchoolFinanceReportReportType, GetSchoolFinanceReportProvider, GetSchoolFinanceReportMethod as FinanceReportMethod } from '@workspace/api-client-react';
import { Button, EmptyState, ErrorState, Field, Modal, StatusPill } from '@/components/shared';

const input = 'w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3.5 py-2.5 text-sm font-medium outline-none focus:border-[hsl(var(--primary))]';
const money = (minor: number) => {
  const cents = BigInt(minor);
  return `₦${(cents / 100n).toLocaleString('en-NG')}.${String(cents % 100n).padStart(2, '0')}`;
};
const minorInput = (minor: number) => `${BigInt(minor) / 100n}.${String(BigInt(minor) % 100n).padStart(2, '0')}`;
const parseMinor = (value: string) => {
  const match = value.trim().match(/^(?:([0-9]+)(?:\.([0-9]{0,2}))?|\.([0-9]{1,2}))$/);
  if (!match) return Number.NaN;
  const minor = BigInt(match[1] || '0') * 100n + BigInt((match[2] ?? match[3] ?? '').padEnd(2, '0') || '0');
  return minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : Number.NaN;
};
const errorMessage = (error: unknown) => error instanceof Error ? error.message : 'Could not complete this request. Please retry.';
const reportTypes = [
  ['summary', 'Summary'], ['payments', 'Payments'], ['outstanding', 'Outstanding'], ['category', 'Category'],
  ['class', 'Class'], ['term', 'Term'], ['adjustment', 'Adjustments'], ['refund', 'Refunds'], ['provider-reconciliation', 'Provider reconciliation'],
] as const;
const invalidateFinance = (qc: ReturnType<typeof useQueryClient>, schoolId: number) => Promise.all([
  qc.invalidateQueries({ queryKey: getListFeeInvoicesQueryKey({ schoolId }) }),
  qc.invalidateQueries({ queryKey: getGetSchoolFinanceSummaryQueryKey({ schoolId }) }),
  qc.invalidateQueries({ queryKey: getListSchoolFinancePaymentsQueryKey({ schoolId }) }),
  qc.invalidateQueries({ queryKey: getListParentFeeInvoicesQueryKey() }),
  qc.invalidateQueries({ queryKey: getListStudentFeeInvoicesQueryKey() }),
  qc.invalidateQueries({ queryKey: getListParentFeePaymentsQueryKey() }),
  qc.invalidateQueries({ queryKey: getListStudentFeePaymentsQueryKey() }),
  qc.invalidateQueries({ queryKey: getListSchoolFeeRefundsQueryKey({ schoolId }) }),
  qc.invalidateQueries({ queryKey: getListSchoolFeeRefundsQueryKey({ schoolId, status: 'ALL' }) }),
  qc.invalidateQueries({ predicate: query => query.queryKey[0] === '/api/school/finance/reports' && (query.queryKey[1] as { schoolId?: number } | undefined)?.schoolId === schoolId }),
]);

export function BulkAssignment({ schoolId, structures, onChanged }: { schoolId: number; structures: FeeStructure[]; onChanged: (message: string) => void }) {
  const qc = useQueryClient();
  const [sessionId, setSessionId] = useState('');
  const [termId, setTermId] = useState('');
  const [classId, setClassId] = useState('');
  const [section, setSection] = useState('');
  const [structureId, setStructureId] = useState('');
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [result, setResult] = useState<FeeBulkAssignmentResult | null>(null);
  const [failure, setFailure] = useState('');
  const sessions = useListAcademicSessions({ schoolId }, { query: { enabled: !!schoolId, queryKey: getListAcademicSessionsQueryKey({ schoolId }) } });
  const terms = useListAcademicTerms(Number(sessionId), { schoolId }, { query: { enabled: !!schoolId && !!sessionId, queryKey: getListAcademicTermsQueryKey(Number(sessionId), { schoolId }) } });
  const classes = useListClasses({ schoolId }, { query: { enabled: !!schoolId, queryKey: getListClassesQueryKey({ schoolId }) } });
  const bulk = useBulkAssignFeeStructure();
  const matching = structures.filter(s => s.status === 'PUBLISHED' && s.schoolId === schoolId && s.sessionId === Number(sessionId) && s.termId === Number(termId) && s.classId === Number(classId) && (s.section ?? '') === section);
  const chosen = matching.find(s => s.id === Number(structureId));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!chosen || dueDate < issueDate) { setFailure('Select a matching published structure and a due date on or after the issue date.'); return; }
    if (!window.confirm(`Issue invoices to active students in ${classes.data?.find(c => c.id === Number(classId))?.name ?? 'this class'}${section ? `, section ${section}` : ''}? Existing assignments will be skipped.`)) return;
    try {
      const response = await bulk.mutateAsync({ params: { schoolId }, data: { structureId: chosen.id, classId: Number(classId), ...(section ? { section } : {}), issueDate, dueDate } });
      setResult(response); setFailure('');
      await invalidateFinance(qc, schoolId);
      onChanged(`${response.createdCount} invoices issued; ${response.skippedCount} students skipped. Review the per-student result below.`);
    } catch (error) { setFailure(errorMessage(error)); }
  };
  const sections = [...new Set((classes.data ?? []).filter(c => c.id === Number(classId)).map(c => c.section).filter(Boolean).concat(structures.filter(s => s.classId === Number(classId) && s.sessionId === Number(sessionId) && s.termId === Number(termId)).map(s => s.section ?? '').filter(Boolean)))];
  return <section className="panel mt-6 overflow-hidden" data-testid="section-bulk-assignment">
    <div className="border-b border-[hsl(var(--border))] p-5 md:p-6"><div className="eyebrow">Issue at scale · duplicate-aware</div><h2 className="display-font mt-1 text-xl font-bold">Bulk invoice assignment</h2><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Choose an academic cohort and its published fee version. Each eligible student receives an invoice; existing assignments are reported, not silently replaced.</p></div>
    {sessions.isLoading || classes.isLoading ? <div className="space-y-3 p-6"><div className="skeleton h-12 rounded-xl" /><div className="skeleton h-12 rounded-xl" /></div> : sessions.isError || classes.isError ? <ErrorState retry={() => { sessions.refetch(); classes.refetch(); }} /> : <form onSubmit={submit} className="space-y-5 p-5 md:p-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Field label="Academic session"><select required className={input} value={sessionId} onChange={e => { setSessionId(e.target.value); setTermId(''); setStructureId(''); setResult(null); }}><option value="">Select session</option>{sessions.data?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Term"><select required className={input} value={termId} disabled={!sessionId || terms.isLoading} onChange={e => { setTermId(e.target.value); setStructureId(''); setResult(null); }}><option value="">Select term</option>{terms.data?.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select>{terms.isError && <button type="button" className="mt-1 text-xs underline" onClick={() => terms.refetch()}>Retry terms</button>}</Field>
        <Field label="Class"><select required className={input} value={classId} onChange={e => { setClassId(e.target.value); setSection(''); setStructureId(''); setResult(null); }}><option value="">Select class</option>{classes.data?.map(c => <option key={c.id} value={c.id}>{c.name}{c.section ? ` · ${c.section}` : ''}</option>)}</select></Field>
        <Field label="Section"><select className={input} value={section} onChange={e => { setSection(e.target.value); setStructureId(''); setResult(null); }}><option value="">Whole class / no section</option>{sections.map(s => <option key={s} value={s}>{s}</option>)}</select></Field>
      </div>
      <Field label="Published fee structure"><select required className={input} value={structureId} onChange={e => { setStructureId(e.target.value); setResult(null); }}><option value="">Select matching structure</option>{matching.map(s => <option key={s.id} value={s.id}>Structure #{s.id} · version {s.version} · {money(s.lines.reduce((n, line) => n + line.amountMinor, 0))}</option>)}</select></Field>
      {sessionId && termId && classId && !matching.length && <p className="rounded-xl bg-[hsl(var(--secondary))] p-4 text-sm">No published structure matches this exact session, term, class and section. Publish one in Fee structures first.</p>}
      <div className="grid gap-4 sm:grid-cols-2"><Field label="Issue date"><input type="date" required className={input} value={issueDate} onChange={e => setIssueDate(e.target.value)} /></Field><Field label="Due date"><input type="date" required min={issueDate} className={input} value={dueDate} onChange={e => setDueDate(e.target.value)} /></Field></div>
      {failure && <p role="alert" className="text-sm text-[hsl(var(--destructive))]">{failure}</p>}
      <Button type="submit" disabled={!chosen || bulk.isPending}>{bulk.isPending ? 'Issuing invoices…' : 'Review and issue invoices'}</Button>
    </form>}
    {result && <div className="border-t border-[hsl(var(--border))] p-5 md:p-6" role="status"><div className="eyebrow">Assignment record</div><div className="mt-2 flex flex-wrap gap-3"><strong>{result.createdCount} assigned</strong><span>·</span><strong>{result.skippedCount} skipped</strong></div><div className="mt-4 max-h-72 overflow-y-auto divide-y divide-[hsl(var(--border))] rounded-xl border border-[hsl(var(--border))]">{result.results.map((item, index) => <div key={`${item.studentId}-${index}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm"><span className="font-medium">Student #{item.studentId} {item.invoiceId ? `· Invoice #${item.invoiceId}` : ''}</span><span className="flex items-center gap-2"><StatusPill value={item.status} /><span className="text-[hsl(var(--muted-foreground))]">{item.reason || (item.status === 'CREATED' ? 'Invoice issued' : 'Not assigned')}</span></span></div>)}</div></div>}
  </section>;
}

export function FinanceReports({ schoolId }: { schoolId: number }) {
  const [reportType, setReportType] = useState<GetSchoolFinanceReportReportType>('summary');
  const [sessionId, setSessionId] = useState('');
  const [termId, setTermId] = useState('');
  const [classId, setClassId] = useState('');
  const [section, setSection] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [method, setMethod] = useState<FinanceReportMethod | ''>('');
  const [status, setStatus] = useState('');
  const [provider, setProvider] = useState<GetSchoolFinanceReportProvider | ''>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rowSearch, setRowSearch] = useState('');
  const parsedStudentId = /^\d+$/.test(studentId.trim()) ? Number(studentId) : null;
  const validStudentId = parsedStudentId !== null && Number.isSafeInteger(parsedStudentId) && parsedStudentId >= 1;
  const invalidStudentId = !!studentId && !validStudentId;
  const params: GetSchoolFinanceReportParams = { schoolId, reportType, ...(sessionId ? { sessionId: Number(sessionId) } : {}), ...(termId ? { termId: Number(termId) } : {}), ...(classId ? { classId: Number(classId) } : {}), ...(section.trim() ? { section: section.trim() } : {}), ...(categoryId ? { categoryId: Number(categoryId) } : {}), ...(validStudentId ? { studentId: parsedStudentId as number } : {}), ...(method ? { method } : {}), ...(status.trim() ? { status: status.trim() } : {}), ...(provider ? { provider } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) };
  const query = useGetSchoolFinanceReport(params, { query: { enabled: !!schoolId && !invalidStudentId && (!from || !to || from <= to), queryKey: getGetSchoolFinanceReportQueryKey(params), refetchInterval: 60000 } });
  const sessions = useListAcademicSessions({ schoolId }, { query: { enabled: !!schoolId, queryKey: getListAcademicSessionsQueryKey({ schoolId }) } });
  const terms = useListAcademicTerms(Number(sessionId), { schoolId }, { query: { enabled: !!schoolId && !!sessionId, queryKey: getListAcademicTermsQueryKey(Number(sessionId), { schoolId }) } });
  const classes = useListClasses({ schoolId }, { query: { enabled: !!schoolId, queryKey: getListClassesQueryKey({ schoolId }) } });
  const categories = useListFeeCategories({ schoolId }, { query: { enabled: !!schoolId, queryKey: getListFeeCategoriesQueryKey({ schoolId }) } });
  return <section className="panel mt-6 overflow-hidden" data-testid="section-finance-reports">
    <div className="border-b border-[hsl(var(--border))] p-5 md:p-6"><div className="eyebrow">School-scoped reporting</div><h2 className="display-font mt-1 text-xl font-bold">Finance reports</h2><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Live ledger views. Filters travel to the report service; historical receipts and decisions are never rewritten.</p></div>
    <div className="flex gap-1 overflow-x-auto border-b border-[hsl(var(--border))] px-4 py-2">{reportTypes.map(([type, label]) => <button key={type} onClick={() => setReportType(type)} aria-pressed={reportType === type} className={`shrink-0 rounded-lg px-3 py-2 text-xs font-bold ${reportType === type ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]'}`}>{label}</button>)}</div>
    <div className="grid gap-3 border-b border-[hsl(var(--border))] p-5 sm:grid-cols-2 xl:grid-cols-4">
      <Field label="Session"><select className={input} value={sessionId} onChange={e => { setSessionId(e.target.value); setTermId(''); }}><option value="">All sessions</option>{sessions.data?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <Field label="Term"><select className={input} value={termId} disabled={!sessionId} onChange={e => setTermId(e.target.value)}><option value="">All terms</option>{terms.data?.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
      <Field label="Class"><select className={input} value={classId} onChange={e => setClassId(e.target.value)}><option value="">All classes</option>{classes.data?.map(c => <option key={c.id} value={c.id}>{c.name} {c.section}</option>)}</select></Field>
      <Field label="Section"><input className={input} maxLength={100} placeholder="All sections" value={section} onChange={e => setSection(e.target.value)} /></Field>
      <Field label="Category"><select className={input} value={categoryId} onChange={e => setCategoryId(e.target.value)}><option value="">All categories</option>{categories.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="Student ID (server filter)"><input className={input} type="number" min="1" step="1" inputMode="numeric" value={studentId} onChange={e => setStudentId(e.target.value)} aria-invalid={invalidStudentId} data-testid="input-report-student-id" />{invalidStudentId && <span className="mt-1 block text-xs text-[hsl(var(--destructive))]" role="alert">Enter a positive whole-number student ID.</span>}</Field>
      <Field label="Payment method"><select className={input} value={method} onChange={e => setMethod(e.target.value as FinanceReportMethod | '')} data-testid="select-report-method"><option value="">All methods</option>{Object.values(GetSchoolFinanceReportMethod).map(value => <option key={value} value={value}>{value === 'BANK_TRANSFER' ? 'Bank transfer' : value.replaceAll('_', ' ')}</option>)}</select></Field>
      <Field label="Provider"><select className={input} value={provider} onChange={e => setProvider(e.target.value as GetSchoolFinanceReportProvider | '')}><option value="">All providers</option><option value="MANUAL_BANK_TRANSFER">Manual bank transfer</option><option value="REMITA">Remita</option><option value="FLUTTERWAVE">Flutterwave</option><option value="PAYSTACK">Paystack</option></select></Field>
      <Field label="Payment date from"><input className={input} type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
      <Field label="Payment date to"><input className={input} type="date" min={from || undefined} value={to} onChange={e => setTo(e.target.value)} /></Field>
      <Field label="Status"><input className={input} maxLength={60} placeholder="All statuses" value={status} onChange={e => setStatus(e.target.value)} /></Field>
      <Field label="Returned-row search (student / invoice / reference)"><input className={input} maxLength={150} placeholder="Search returned rows only" value={rowSearch} onChange={e => setRowSearch(e.target.value)} data-testid="input-report-row-search" /><span className="mt-1 block text-xs text-[hsl(var(--muted-foreground))]">This only narrows visible rows; it does not alter server totals. Use Student ID or Payment method for total-affecting filters.</span></Field>
      <div className="flex items-end"><Button variant="quiet" onClick={() => { setSessionId(''); setTermId(''); setClassId(''); setSection(''); setCategoryId(''); setStudentId(''); setMethod(''); setStatus(''); setProvider(''); setFrom(''); setTo(''); setRowSearch(''); }}>Clear filters</Button></div>
      {(sessions.isError || classes.isError || categories.isError || terms.isError) && <div className="col-span-full text-xs text-[hsl(var(--destructive))]">Some filter choices are unavailable. <button className="underline" onClick={() => { sessions.refetch(); classes.refetch(); categories.refetch(); if (sessionId) terms.refetch(); }}>Retry filters</button></div>}
    </div>
     {invalidStudentId ? <p role="alert" className="p-6 text-sm text-[hsl(var(--destructive))]">A student ID filter must be a positive whole number; results are paused until it is valid.</p> : from && to && from > to ? <p role="alert" className="p-6 text-sm text-[hsl(var(--destructive))]">The end date must be on or after the start date.</p> : query.isLoading ? <div className="space-y-3 p-6"><div className="skeleton h-24 rounded-xl" /><div className="skeleton h-40 rounded-xl" /></div> : query.isError ? <ErrorState retry={() => query.refetch()} /> : query.data && query.data.schoolId !== schoolId ? <p role="alert" className="p-6">The report returned a different school context. No data is shown.</p> : query.data && <div className="p-5 md:p-6">
       <p className="mb-4 rounded-xl bg-[hsl(var(--secondary)/.65)] p-4 text-xs leading-5 text-[hsl(var(--muted-foreground))]" data-testid="text-report-date-scope">Payment-date filters apply to collected totals for the selected period. Billed, outstanding, refund and reversal totals cover currently scoped invoices and are not limited to that payment-date period.</p>
       <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[
        ['Billed', query.data.totalBilledMinor], ['Collected', query.data.totalCollectedMinor], ['Outstanding', query.data.totalOutstandingMinor],
        ['Discounts', query.data.totalDiscountMinor], ['Waivers', query.data.totalWaiverMinor], ['Refunded', query.data.totalRefundedMinor], ['Reversed', query.data.totalReversedMinor],
      ].map(([label, value]) => <div key={label} className="rounded-xl bg-[hsl(var(--secondary)/.65)] p-4"><div className="eyebrow">{label}</div><div className="display-font mt-2 text-lg font-bold tabular-nums">{money(value as number)}</div></div>)}</div>
      <h3 className="mt-7 text-sm font-bold">Breakdown · {reportTypes.find(([type]) => type === reportType)?.[1]}</h3>
      {(() => {
        const needle = rowSearch.trim().toLocaleLowerCase();
         const rows = query.data.rows.filter(row => !needle || [row.label, row.studentName, row.studentId, row.invoiceNumber, row.invoiceId, row.reference, row.providerReference, row.eventId, row.webhookTransactionId, row.verifiedTransactionId, row.reason].some(value => value !== null && value !== undefined && String(value).toLocaleLowerCase().includes(needle)));
         return !rows.length ? <EmptyState icon={BarChart3} title="No rows for these filters" description="Try a different academic period, payment date, student, invoice, reference, status or provider. Totals above reflect the selected report." /> : <div className="mt-3 divide-y divide-[hsl(var(--border))] rounded-xl border border-[hsl(var(--border))]">{rows.map((row, i) => <div key={`${row.invoiceId ?? row.reference ?? row.label}-${i}`} className="px-4 py-4 text-sm" data-testid={`row-finance-report-${i}`}><div className="flex flex-wrap items-start justify-between gap-3"><div><strong className="break-words">{row.studentName || row.label}</strong>{row.studentId != null && <span className="ml-2 text-xs text-[hsl(var(--muted-foreground))]">Student #{row.studentId}</span>}<div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[hsl(var(--muted-foreground))]">{row.invoiceNumber && <span>Invoice {row.invoiceNumber}{row.invoiceId != null ? ` · #${row.invoiceId}` : ''}</span>}{row.reference && <span>Reference {row.reference}</span>}{row.paymentDate && <span>Payment date {new Date(row.paymentDate).toLocaleDateString('en-NG')}</span>}</div></div><span className="text-xs text-[hsl(var(--muted-foreground))]">{row.count} record{row.count === 1 ? '' : 's'}</span></div><div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4"><span>Amount: <strong className="tabular-nums">{money(row.amountMinor)}</strong></span><span>Secondary: <strong className="tabular-nums">{money(row.secondaryAmountMinor)}</strong></span>{row.originalAmountMinor != null && <span>Original: <strong className="tabular-nums">{money(row.originalAmountMinor)}</strong></span>}{row.paidMinor != null && <span>Paid: <strong className="tabular-nums">{money(row.paidMinor)}</strong></span>}{row.outstandingMinor != null && <span>Outstanding: <strong className="tabular-nums">{money(row.outstandingMinor)}</strong></span>}{row.overdue != null && <span>Overdue: <strong>{row.overdue ? 'Yes' : 'No'}</strong></span>}</div>{reportType === 'provider-reconciliation' && <div className="mt-4 rounded-lg bg-[hsl(var(--secondary)/.55)] p-3 text-xs leading-5" data-testid={`row-reconciliation-details-${i}`}><div className="flex flex-wrap gap-x-4 gap-y-1"><span>Source: <strong>{row.sourceType || '—'}</strong></span><span>Provider: <strong>{row.provider || '—'}</strong></span><span>Checkout: <strong>{row.checkoutState || '—'}</strong></span><span>Payment: <strong>{row.paymentStatus || '—'}</strong></span><span>Event/signature: <strong>{row.reconciliationStatus || '—'}</strong> / <strong>{row.signatureVerified === null || row.signatureVerified === undefined ? 'unavailable' : row.signatureVerified ? 'verified' : 'not verified'}</strong></span>{row.eventDate && <span>Event date: <strong>{new Date(row.eventDate).toLocaleString('en-NG')}</strong></span>}</div><div className="mt-2 break-all text-[hsl(var(--muted-foreground))]">{row.eventId && <span>Event {row.eventId} · </span>}{row.webhookTransactionId && <span>Webhook transaction {row.webhookTransactionId} · </span>}{row.verifiedTransactionId && <span>Verified transaction {row.verifiedTransactionId} · </span>}{row.providerReference && <span>Provider reference {row.providerReference}</span>}</div>{row.reason && <p className="mt-2 text-[hsl(var(--destructive))]">Failure / reconciliation reason: {row.reason}</p>}</div>}</div>)}</div>;
      })()}
    </div>}
  </section>;
}

export function RefundDesk({ schoolId, canApprove, canRequest, onChanged }: { schoolId: number; canApprove: boolean; canRequest: boolean; onChanged: (message: string) => void }) {
  const qc = useQueryClient();
  const payments = useListSchoolFinancePayments({ schoolId }, { query: { enabled: !!schoolId, queryKey: getListSchoolFinancePaymentsQueryKey({ schoolId }), refetchInterval: 30000 } });
  const [filter, setFilter] = useState<'PENDING' | 'ALL'>('PENDING');
  const pendingQueue = useListSchoolFeeRefunds({ schoolId }, { query: { enabled: !!schoolId, queryKey: getListSchoolFeeRefundsQueryKey({ schoolId }), refetchInterval: 30000 } });
  const allQueue = useListSchoolFeeRefunds({ schoolId, status: 'ALL' }, { query: { enabled: !!schoolId && filter === 'ALL', queryKey: getListSchoolFeeRefundsQueryKey({ schoolId, status: 'ALL' }), refetchInterval: 30000 } });
  const queue = filter === 'PENDING' ? pendingQueue : allQueue;
  const request = useRequestFeeRefund();
  const [paymentId, setPaymentId] = useState<number | null>(null);
  const [refundId, setRefundId] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [transactionType, setTransactionType] = useState<'REFUND' | 'REVERSAL'>('REFUND');
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState('');
  const [success, setSuccess] = useState('');
  const original = payments.data?.find(p => p.id === paymentId && p.schoolId === schoolId);
  const receiptParams = { schoolId };
  const receipt = useGetFeePaymentReceipt(paymentId ?? 0, receiptParams, { query: { enabled: !!original?.receiptNumber && !!paymentId, queryKey: getGetFeePaymentReceiptQueryKey(paymentId ?? 0, receiptParams) } });
  const receiptMatches = !!receipt.data && !!original && receipt.data.paymentId === original.id && receipt.data.schoolId === schoolId && Number(receipt.data.snapshot?.invoiceId) === original.invoiceId && Number(receipt.data.snapshot?.schoolId) === schoolId;
  const submitRequest = async (event: FormEvent) => {
    event.preventDefault();
    if (!canRequest || !original || original.status !== 'VERIFIED') return;
    const minor = parseMinor(amount);
    if (!Number.isSafeInteger(minor) || minor < 1 || minor > original.amountMinor) { setFailure('Enter an amount greater than zero and no greater than the original payment.'); return; }
    try {
       const result = await request.mutateAsync({ paymentId: original.id, params: { schoolId }, data: { amountMinor: minor, transactionType, reason: reason.trim() } });
       setRefundId(result.id); setPaymentId(null); setFailure(''); setSuccess(`${transactionType === 'REFUND' ? 'Refund' : 'Reversal'} request #${result.id} recorded as an internal ledger record. No provider payout is asserted.`);
      await Promise.all([
        invalidateFinance(qc, schoolId),
        qc.invalidateQueries({ queryKey: getGetSchoolFeeRefundQueryKey(result.id, { schoolId }) }),
        qc.invalidateQueries({ queryKey: getGetSchoolFinancePaymentQueryKey(original.id, { schoolId }) }),
        qc.invalidateQueries({ queryKey: getGetFeePaymentReceiptQueryKey(original.id, receiptParams) }),
      ]);
      onChanged(`Refund request #${result.id} recorded. Awaiting externally evidenced approval.`);
    } catch (error) { setFailure(errorMessage(error)); }
  };
  return <section className="panel mt-6 overflow-hidden" data-testid="section-refund-desk">
    <div className="border-b border-[hsl(var(--border))] p-5 md:p-6"><div className="eyebrow">Exception ledger</div><h2 className="display-font mt-1 text-xl font-bold">Refunds & reversals</h2><p className="mt-2 max-w-3xl text-sm leading-6 text-[hsl(var(--muted-foreground))]">Request a refund against a verified payment. School Admin approval records a refund or reversal already evidenced outside this workspace; it does not send funds through Remita, Flutterwave, Paystack or the bank. The original payment and receipt stay immutable.</p></div>
    {success && <p role="status" className="m-5 rounded-xl bg-[hsl(var(--secondary))] p-4 text-sm font-semibold">{success}</p>}
    <div className="border-b border-[hsl(var(--border))]"><div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 md:px-6"><div><div className="eyebrow">School refund queue</div><h3 className="display-font mt-1 text-lg font-bold">{filter === 'PENDING' ? `${pendingQueue.data?.length ?? 0} awaiting review` : 'Full refund history'}</h3></div><div className="flex rounded-xl bg-[hsl(var(--secondary))] p-1">{(['PENDING', 'ALL'] as const).map(value => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)} className={`rounded-lg px-3 py-2 text-xs font-bold ${filter === value ? 'bg-[hsl(var(--card))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]'}`}>{value === 'PENDING' ? 'Pending' : 'All records'}</button>)}</div></div>
     {queue.isLoading ? <div className="space-y-2 p-5"><div className="skeleton h-16 rounded-xl" /><div className="skeleton h-16 rounded-xl" /></div> : queue.isError ? <ErrorState retry={() => queue.refetch()} /> : !queue.data?.length ? <EmptyState icon={FileClock} title={filter === 'PENDING' ? 'No refunds or reversals awaiting review' : 'No refund/reversal records yet'} description={filter === 'PENDING' ? 'Requests submitted by finance operators will appear here for school review.' : 'Requested and approved internal ledger records will appear here.'} /> : <div className="divide-y divide-[hsl(var(--border))]">{queue.data.filter(item => item.schoolId === schoolId).map(item => <div key={item.id} className="flex flex-col gap-3 p-5 md:flex-row md:items-center md:justify-between md:px-6"><div className="min-w-0"><div className="text-sm font-bold">{item.studentName} · {item.invoiceNumber}</div><div className="mt-1 break-all font-mono text-xs text-[hsl(var(--muted-foreground))]">{item.transactionType === 'REFUND' ? 'Refund' : 'Reversal'} #{item.id} · {item.reference} · Payment #{item.paymentId} · {new Date(item.requestedAt).toLocaleDateString('en-NG')}</div><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{item.reason}</p><p className="mt-1 text-xs font-semibold">Internal ledger record only; provider-issued payout is not confirmed.</p></div><div className="flex flex-wrap items-center gap-3"><strong className="tabular-nums">{money(item.amountMinor)}</strong><StatusPill value={item.status} /><Button variant="outline" onClick={() => { setRefundId(item.id); setFailure(''); }}>Details</Button></div></div>)}</div>}
    </div>
    {refundId !== null && <RefundReview key={`${schoolId}-${refundId}`} schoolId={schoolId} refundId={refundId} canApprove={canApprove} canRequest={canRequest} onClose={() => setRefundId(null)} onChanged={message => { setSuccess(message); onChanged(message); }} />}
     {canRequest && <div className="border-b border-[hsl(var(--border))] p-5 md:p-6"><div className="eyebrow">Start a request</div><h3 className="display-font mt-1 text-lg font-bold">Verified payments</h3><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Open the original receipt before requesting an internal refund/reversal record.</p></div>}
     {canRequest && (payments.isLoading ? <div className="space-y-3 p-5"><div className="skeleton h-16 rounded-xl" /><div className="skeleton h-16 rounded-xl" /></div> : payments.isError ? <ErrorState retry={() => payments.refetch()} /> : !payments.data?.some(p => p.status === 'VERIFIED' && p.schoolId === schoolId) ? <EmptyState icon={FileClock} title="No verified payments to review" description="A refund request starts with a verified payment. Pending submissions cannot be reversed." /> : <div className="divide-y divide-[hsl(var(--border))]">{payments.data.filter(p => p.schoolId === schoolId && p.status === 'VERIFIED').map(payment => <div key={payment.id} className="flex flex-col gap-3 p-5 md:flex-row md:items-center md:justify-between md:px-6"><div><strong className="text-sm">{payment.studentName} · {payment.invoiceNumber}</strong><div className="mt-1 font-mono text-xs text-[hsl(var(--muted-foreground))]">Payment #{payment.id} · {payment.reference} · {payment.receiptNumber || 'Receipt pending'}</div></div><div className="flex flex-wrap items-center gap-3"><strong className="tabular-nums">{money(payment.amountMinor)}</strong><Button variant="outline" disabled={!payment.receiptNumber} onClick={() => { setPaymentId(payment.id); setFailure(''); setAmount(''); setReason(''); }}>Review / request</Button></div></div>)}</div>)}
    {paymentId !== null && <Modal title="Request a refund or reversal" eyebrow="Original payment retained" onClose={() => setPaymentId(null)}>{!original ? <ErrorState retry={() => payments.refetch()} message="The original payment is no longer available in this school." /> : <div className="space-y-4">
      <OriginalPayment payment={original} />
      {receipt.isLoading ? <div className="skeleton h-16 rounded-xl" /> : receipt.isError ? <ErrorState retry={() => receipt.refetch()} message="Original receipt could not be retrieved. Request is unavailable." /> : !receiptMatches ? <p role="alert" className="text-sm text-[hsl(var(--destructive))]">Receipt does not match the selected school, invoice and payment.</p> : <div className="rounded-xl border border-[hsl(var(--border))] p-4"><div className="eyebrow">Immutable original receipt</div><div className="mt-1 font-mono text-sm font-bold">{receipt.data?.receiptNumber}</div><div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Snapshot: invoice #{receipt.data?.snapshot.invoiceId} · school #{receipt.data?.snapshot.schoolId}</div></div>}
       <form onSubmit={submitRequest} className="space-y-3"><Field label="Internal transaction classification"><select className={input} value={transactionType} onChange={e => setTransactionType(e.target.value as typeof transactionType)} data-testid="select-refund-transaction-type"><option value="REFUND">Refund</option><option value="REVERSAL">Reversal</option></select></Field><p className="text-xs text-[hsl(var(--muted-foreground))]">This records the school ledger classification only; it does not initiate or confirm a provider payout.</p><Field label="Amount to request (₦)"><input required type="number" min="0.01" step="0.01" max={minorInput(original.amountMinor)} className={input} value={amount} onChange={e => setAmount(e.target.value)} /></Field><Field label="Reason"><textarea required minLength={3} maxLength={500} rows={3} className={input} value={reason} onChange={e => setReason(e.target.value)} /></Field>{failure && <p role="alert" className="text-sm text-[hsl(var(--destructive))]">{failure}</p>}<Button type="submit" disabled={request.isPending || !receiptMatches || !canRequest}>{request.isPending ? 'Recording…' : `Record ${transactionType.toLowerCase()} request`}</Button></form>
    </div>}</Modal>}
  </section>;
}

function RefundReview({ schoolId, refundId, canApprove, canRequest, onClose, onChanged }: { schoolId: number; refundId: number; canApprove: boolean; canRequest: boolean; onClose: () => void; onChanged: (message: string) => void }) {
  const qc = useQueryClient();
  const params = { schoolId };
  const refund = useGetSchoolFeeRefund(refundId, params, { query: { enabled: !!schoolId && !!refundId, queryKey: getGetSchoolFeeRefundQueryKey(refundId, params), refetchInterval: 30000 } });
  const paymentId = refund.data?.paymentId ?? 0;
  const payment = useGetSchoolFinancePayment(paymentId, params, { query: { enabled: !!paymentId && refund.data?.schoolId === schoolId, queryKey: getGetSchoolFinancePaymentQueryKey(paymentId, params) } });
  const receipt = useGetFeePaymentReceipt(paymentId, params, { query: { enabled: !!paymentId && !!payment.data?.receiptNumber && payment.data.schoolId === schoolId, queryKey: getGetFeePaymentReceiptQueryKey(paymentId, params) } });
  const approve = useApproveFeeRefund();
  const [evidence, setEvidence] = useState('');
  const [notes, setNotes] = useState('');
  const [failure, setFailure] = useState('');
  const record = refund.data;
  const verified = !!record && record.schoolId === schoolId && !!payment.data && payment.data.schoolId === schoolId &&
    record.paymentId === payment.data.id && record.invoiceId === payment.data.invoiceId &&
    record.invoiceNumber === payment.data.invoiceNumber && record.paymentReference === payment.data.reference &&
    !!receipt.data && receipt.data.schoolId === schoolId && receipt.data.paymentId === record.paymentId &&
    receipt.data.snapshot.schoolId === schoolId && receipt.data.snapshot.invoiceId === record.invoiceId;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!record || !verified || !canApprove || record.status !== 'PENDING') return;
    if (!window.confirm(`Record external ${money(record.amountMinor)} refund/reversal for payment #${record.paymentId}? This does not send funds through the provider.`)) return;
    try {
      await approve.mutateAsync({ refundId: record.id, params, data: { evidenceReference: evidence.trim(), reviewerNotes: notes.trim() } });
      setFailure('');
      await Promise.all([
        invalidateFinance(qc, schoolId),
        qc.invalidateQueries({ queryKey: getGetSchoolFeeRefundQueryKey(refundId, params) }),
        qc.invalidateQueries({ queryKey: getGetSchoolFinancePaymentQueryKey(record.paymentId, params) }),
        qc.invalidateQueries({ queryKey: getGetFeePaymentReceiptQueryKey(record.paymentId, params) }),
      ]);
      onChanged(`Externally evidenced refund #${record.id} recorded. Original payment and receipt retained; no provider payout initiated.`);
    } catch (error) { setFailure(errorMessage(error)); refund.refetch(); }
  };
  return <Modal title={`Refund #${refundId}`} eyebrow="School refund ledger" onClose={onClose}>
    {refund.isLoading ? <div className="space-y-3"><div className="skeleton h-20 rounded-xl" /><div className="skeleton h-28 rounded-xl" /></div> :
    refund.isError || !record ? <ErrorState retry={() => refund.refetch()} message="Could not load this refund record. No approval is available without its details." /> :
    record.schoolId !== schoolId ? <p role="alert" className="text-sm text-[hsl(var(--destructive))]">This refund does not belong to the selected school.</p> :
    <div className="space-y-5">
       <div className="rounded-xl bg-[hsl(var(--secondary))] p-4"><div className="flex justify-between gap-3"><div><div className="eyebrow">{record.transactionType === 'REFUND' ? 'Refund request' : 'Reversal request'}</div><div className="display-font mt-1 text-2xl font-bold tabular-nums">{money(record.amountMinor)}</div></div><StatusPill value={record.status} /></div><div className="mt-3 break-all font-mono text-xs">{record.reference}</div></div>
       {record.status === 'PENDING' && <p role="status" className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-sm leading-6">This request is still pending; it is not an approved refund or reversal, does not change the original payment or receipt, and does not initiate a payout.</p>}
      <div className="grid gap-3 text-sm sm:grid-cols-2"><div><span className="eyebrow">Student / class</span><p className="mt-1 font-semibold">{record.studentName} · {record.className} {record.section}</p></div><div><span className="eyebrow">Invoice</span><p className="mt-1 font-semibold">{record.invoiceNumber} · #{record.invoiceId}</p></div><div><span className="eyebrow">Original payment</span><p className="mt-1 break-all font-semibold">#{record.paymentId} · {record.paymentReference}</p></div><div><span className="eyebrow">Payment amount / method</span><p className="mt-1 font-semibold">{money(record.paymentAmountMinor)} · {record.paymentMethod}</p></div><div><span className="eyebrow">Requested</span><p className="mt-1">{new Date(record.requestedAt).toLocaleString('en-NG')}</p></div><div><span className="eyebrow">Reason</span><p className="mt-1 break-words">{record.reason}</p></div></div>
      {payment.isLoading || receipt.isLoading ? <div className="skeleton h-24 rounded-xl" /> : payment.isError || receipt.isError ? <ErrorState retry={() => { payment.refetch(); receipt.refetch(); }} message="Original payment or receipt evidence could not be loaded. Approval is unavailable." /> : verified && payment.data && receipt.data ? <div className="space-y-3"><OriginalPayment payment={payment.data} /><div className="rounded-xl border border-[hsl(var(--border))] p-4"><div className="eyebrow">Immutable original receipt</div><div className="mt-1 break-all font-mono text-sm font-bold">{receipt.data.receiptNumber}</div><div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Snapshot: invoice #{receipt.data.snapshot.invoiceId} · school #{receipt.data.snapshot.schoolId}</div></div></div> : <p role="alert" className="rounded-xl bg-[hsl(var(--destructive)/.08)] p-4 text-sm text-[hsl(var(--destructive))]">Original payment and receipt could not be matched to this school and invoice. Approval is blocked.</p>}
       {record.status !== 'PENDING' ? <div className="rounded-xl bg-[hsl(var(--secondary))] p-4 text-sm"><div className="eyebrow">Recorded decision</div><p className="mt-2">External evidence: <strong className="break-all">{record.evidenceReference || '—'}</strong></p><p className="mt-1">Reviewer notes: {record.reviewerNotes || '—'}</p><p className="mt-1">Approved: {record.approvedAt ? new Date(record.approvedAt).toLocaleString('en-NG') : '—'}</p><p className="mt-2 font-semibold">This is an internal ledger record; provider payout is not confirmed.</p></div> :
        canApprove ? <form onSubmit={submit} className="space-y-3 border-t border-[hsl(var(--border))] pt-4"><p className="flex items-start gap-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]"><ShieldCheck size={16} className="shrink-0" />Confirm funds were returned externally before approval. This records evidence in the ledger; it does not send money through a provider.</p><Field label="External evidence reference"><input required minLength={3} maxLength={200} className={input} value={evidence} onChange={e => setEvidence(e.target.value)} /></Field><Field label="Reviewer notes"><textarea required minLength={3} maxLength={1000} rows={3} className={input} value={notes} onChange={e => setNotes(e.target.value)} /></Field>{failure && <p role="alert" className="text-sm text-[hsl(var(--destructive))]">{failure}</p>}<Button type="submit" disabled={approve.isPending || !verified}>{approve.isPending ? 'Recording…' : 'Approve evidenced refund'}</Button></form> :
         <p className="text-xs leading-5 text-[hsl(var(--muted-foreground))]">{canApprove ? 'Approval is available only after the original payment and receipt are verified and external refund evidence is supplied.' : canRequest ? 'As an Accountant, you can request and track this refund, but an active School Admin for this school must review and record the evidenced approval. This request remains pending until that decision is recorded.' : 'Only an active School Admin for this school can approve this request.'}</p>}
    </div>}
  </Modal>;
}

function OriginalPayment({ payment }: { payment: FeePaymentHistory }) {
  const proof = (() => { try { const url = new URL(payment.proofUrl ?? ''); return url.protocol === 'https:' ? url.href : null; } catch { return null; } })();
  return <div className="rounded-xl bg-[hsl(var(--secondary))] p-4"><div className="flex justify-between gap-2"><div className="eyebrow">Original verified payment</div><StatusPill value={payment.status} /></div><div className="mt-2 text-lg font-bold tabular-nums">{money(payment.amountMinor)}</div><div className="mt-2 space-y-1 break-words text-xs"><p>{payment.studentName} · {payment.invoiceNumber}</p><p>Payment #{payment.id} · {payment.method} · {payment.reference}</p><p>Receipt {payment.receiptNumber ?? '—'} · Verified {payment.verifiedAt ? new Date(payment.verifiedAt).toLocaleString('en-NG') : '—'}</p><p>Bank reference: {payment.transferReference ?? payment.verificationEvidenceReference ?? '—'}</p>{proof && <a href={proof} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[hsl(var(--primary))] underline">Original proof <ArrowUpRight size={13} /></a>}</div></div>;
}