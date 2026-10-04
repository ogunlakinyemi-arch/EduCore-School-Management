import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Banknote, Check, Clock3, FileCheck2, ReceiptText, ShieldCheck, X } from 'lucide-react';
import {
  useListSchoolFinancePayments, useGetSchoolFinancePayment, useVerifyManualBankTransfer, useRejectManualBankTransfer,
  useListPendingFeeAdjustments, useApproveFeeAdjustment, useListParentFeePayments, useListStudentFeePayments,
  useGetFeePaymentReceipt,
  getListSchoolFinancePaymentsQueryKey, getGetSchoolFinancePaymentQueryKey, getListPendingFeeAdjustmentsQueryKey,
  getListParentFeePaymentsQueryKey, getListStudentFeePaymentsQueryKey, getListParentFeeInvoicesQueryKey,
  getListStudentFeeInvoicesQueryKey, getListFeeInvoicesQueryKey, getGetSchoolFinanceSummaryQueryKey,
  getGetFeePaymentReceiptQueryKey,
  getListMyFeePaymentNotificationsQueryKey,
} from '@workspace/api-client-react';
import type { FeeAdjustment, FeeInvoice, FeePaymentHistory } from '@workspace/api-client-react';
import { Button, EmptyState, ErrorState, Modal, SkeletonPage, StatusPill } from '@/components/shared';
import { SchoolDocumentHeader, SchoolDocumentPrintButton, useSchoolDocumentBranding } from '@/components/school-document';

const amount = (minor: number) => {
  const cents = BigInt(minor);
  return `₦${(cents / 100n).toLocaleString('en-NG')}.${String(cents % 100n).padStart(2, '0')}`;
};
const input = 'w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3.5 py-2.5 text-sm outline-none focus:border-[hsl(var(--primary))]';
const muted = 'text-xs leading-5 text-[hsl(var(--muted-foreground))]';
const message = (error: unknown) => error instanceof Error ? error.message : 'Could not save this change. Please retry.';
const safeProof = (value: string | null) => {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.href : null;
  } catch { return null; }
};
function Detail({ label, value }: { label: string; value?: string | number | null }) {
  return <div><div className="eyebrow">{label}</div><div className="mt-1 break-words text-sm font-semibold">{value || '—'}</div></div>;
}

function ReviewPayment({ paymentId, schoolId, onClose, onChanged }: { paymentId: number; schoolId: number; onClose: () => void; onChanged: (text: string) => void }) {
  const qc = useQueryClient();
  const params = { schoolId };
  const query = useGetSchoolFinancePayment(paymentId, params, { query: { enabled: !!paymentId && !!schoolId, queryKey: getGetSchoolFinancePaymentQueryKey(paymentId, params) } });
  const verify = useVerifyManualBankTransfer();
  const reject = useRejectManualBankTransfer();
  const [action, setAction] = useState<'verify' | 'reject' | null>(null);
  const [evidence, setEvidence] = useState('');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [failure, setFailure] = useState('');
  const payment = query.data;
  const proof = safeProof(payment?.proofUrl ?? null);
  const canReview = payment?.status === 'PENDING' && payment.method === 'BANK_TRANSFER';
  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: getListSchoolFinancePaymentsQueryKey(params) }),
      qc.invalidateQueries({ queryKey: getListSchoolFinancePaymentsQueryKey({ schoolId, status: 'PENDING' }) }),
      qc.invalidateQueries({ queryKey: getGetSchoolFinancePaymentQueryKey(paymentId, params) }),
      qc.invalidateQueries({ queryKey: getListFeeInvoicesQueryKey(params) }),
      qc.invalidateQueries({ queryKey: getGetSchoolFinanceSummaryQueryKey(params) }),
      qc.invalidateQueries({ queryKey: getListParentFeePaymentsQueryKey() }),
      qc.invalidateQueries({ queryKey: getListStudentFeePaymentsQueryKey() }),
      qc.invalidateQueries({ queryKey: getListParentFeeInvoicesQueryKey() }),
      qc.invalidateQueries({ queryKey: getListStudentFeeInvoicesQueryKey() }),
      qc.invalidateQueries({ queryKey: getGetFeePaymentReceiptQueryKey(paymentId) }),
       qc.invalidateQueries({ queryKey: getListMyFeePaymentNotificationsQueryKey({ schoolId }) }),
       qc.invalidateQueries({ queryKey: getListMyFeePaymentNotificationsQueryKey() }),
    ]);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canReview || !action) return;
    if (!window.confirm(action === 'verify' ? `Verify ${amount(payment.amountMinor)} against the bank record? This will credit invoice ${payment.invoiceNumber}.` : `Reject this transfer submission for ${payment.invoiceNumber}?`)) return;
    try {
      if (action === 'verify') {
        const result = await verify.mutateAsync({ paymentId, params, data: { evidenceReference: evidence.trim(), reviewerNotes: notes.trim() } });
        await refresh(); onChanged(`Payment #${paymentId} verified. Receipt ${result.receiptNumber} is now available.`);
      } else {
        await reject.mutateAsync({ paymentId, params, data: { reason: reason.trim() } });
        await refresh(); onChanged(`Payment #${paymentId} rejected; no balance was credited.`);
      }
      onClose();
    } catch (error) { setFailure(message(error)); query.refetch(); }
  };
  return <Modal title={`Transfer #${paymentId}`} eyebrow="Bank reconciliation" onClose={onClose}>
    {query.isLoading ? <div className="space-y-3 animate-pulse"><div className="h-16 rounded-xl bg-[hsl(var(--muted))]" /><div className="h-36 rounded-xl bg-[hsl(var(--muted))]" /></div> : query.isError || !payment ? <ErrorState retry={() => query.refetch()} message="This transfer could not be loaded. No review action is available without its details." /> :
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[hsl(var(--secondary))] p-4"><div><div className="eyebrow">Submitted amount</div><div className="display-font mt-1 text-2xl font-bold tabular-nums">{amount(payment.amountMinor)}</div></div><StatusPill value={payment.status} /></div>
        <div className="grid gap-4 sm:grid-cols-2"><Detail label="Student" value={payment.studentName} /><Detail label="Invoice" value={payment.invoiceNumber} /><Detail label="Sending bank" value={payment.transferBank} /><Detail label="Bank reference" value={payment.transferReference} /><Detail label="Transfer date" value={payment.transferDate} /><Detail label="Submitted" value={new Date(payment.createdAt).toLocaleString('en-NG')} /><Detail label="Internal reference" value={payment.reference} /><Detail label="Method" value={payment.method.replaceAll('_', ' ')} /></div>
        <div className="rounded-xl border border-[hsl(var(--border))] p-4"><div className="eyebrow">Submitted proof</div>{proof ? <div className="mt-2"><div className={`${muted} break-all`}>External source: {new URL(proof).hostname}. Check the destination before opening.</div><a href={proof} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex max-w-full items-center gap-2 break-all text-sm font-semibold text-[hsl(var(--primary))] underline" data-testid={`link-transfer-proof-${payment.id}`}>Open evidence link <ArrowUpRight size={15} className="shrink-0" /></a></div> : <div className={`mt-2 ${muted}`}>{payment.proofUrl ? 'The supplied link cannot be opened safely. Only HTTPS evidence links are supported.' : 'No proof link was supplied. Confirm against the actual bank record.'}</div>}</div>
        {payment.status !== 'PENDING' && <div className="rounded-xl bg-[hsl(var(--muted)/.5)] p-4"><div className="grid gap-3 sm:grid-cols-2"><Detail label="Bank evidence reference" value={payment.verificationEvidenceReference} /><Detail label="Reviewed at" value={payment.verifiedAt ? new Date(payment.verifiedAt).toLocaleString('en-NG') : null} /><Detail label="Reviewer notes" value={payment.reviewerNotes} /><Detail label="Rejection reason" value={payment.rejectionReason} /></div>{payment.status === 'VERIFIED' && payment.receiptNumber && <div className="mt-3 text-sm font-bold text-[hsl(var(--primary))]">Receipt {payment.receiptNumber}</div>}</div>}
        {canReview && <><div className={`flex items-start gap-2 ${muted}`}><ShieldCheck size={17} className="shrink-0 text-[hsl(var(--primary))]" />Check amount, bank reference, date and proof against your bank statement before verifying. A pending transfer is not paid.</div><div className="flex gap-2"><Button variant={action === 'verify' ? 'primary' : 'outline'} onClick={() => { setAction('verify'); setFailure(''); }} testId="button-start-verify-transfer"><Check size={15} />Verify</Button><Button variant={action === 'reject' ? 'danger' : 'outline'} onClick={() => { setAction('reject'); setFailure(''); }} testId="button-start-reject-transfer"><X size={15} />Reject</Button></div>{action && <form onSubmit={submit} className="space-y-3 rounded-xl border border-[hsl(var(--border))] p-4">{action === 'verify' ? <><label className="block text-xs font-bold">Bank statement / evidence reference<input required minLength={3} maxLength={200} value={evidence} onChange={e => setEvidence(e.target.value)} className={`${input} mt-1.5`} data-testid="input-verification-evidence" /></label><label className="block text-xs font-bold">Reviewer notes<textarea required minLength={3} maxLength={1000} rows={3} value={notes} onChange={e => setNotes(e.target.value)} className={`${input} mt-1.5`} data-testid="input-verification-notes" /></label></> : <label className="block text-xs font-bold">Reason for rejection<textarea required minLength={3} maxLength={500} rows={3} value={reason} onChange={e => setReason(e.target.value)} className={`${input} mt-1.5`} data-testid="input-rejection-reason" /></label>}{failure && <p role="alert" className="text-sm text-[hsl(var(--destructive))]">{failure}</p>}<Button type="submit" disabled={verify.isPending || reject.isPending} variant={action === 'reject' ? 'danger' : 'primary'} testId="button-confirm-transfer-review">{verify.isPending || reject.isPending ? 'Saving…' : action === 'verify' ? 'Confirm verified payment' : 'Confirm rejection'}</Button></form>}</>}
      </div>}
  </Modal>;
}

export function SchoolPaymentQueue({ schoolId, onChanged }: { schoolId: number; onChanged: (message: string) => void }) {
  const params = { schoolId };
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [filter, setFilter] = useState<'PENDING' | 'ALL'>('PENDING');
  const pending = useListSchoolFinancePayments({ schoolId, status: 'PENDING' }, { query: { enabled: !!schoolId, queryKey: getListSchoolFinancePaymentsQueryKey({ schoolId, status: 'PENDING' }), refetchInterval: 30000 } });
  const all = useListSchoolFinancePayments(params, { query: { enabled: !!schoolId && filter === 'ALL', queryKey: getListSchoolFinancePaymentsQueryKey(params) } });
  const active = filter === 'PENDING' ? pending : all;
  return <section className="panel mt-6 overflow-hidden" data-testid="section-transfer-queue"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--border))] p-5 md:p-6"><div><div className="eyebrow">Bank reconciliation</div><h2 className="display-font mt-1 text-xl font-bold">Manual transfers <span className="text-sm text-[hsl(var(--muted-foreground))]">· {pending.data?.length ?? 0} pending</span></h2></div><div className="flex rounded-xl bg-[hsl(var(--secondary))] p-1">{(['PENDING', 'ALL'] as const).map(item => <button key={item} onClick={() => setFilter(item)} className={`rounded-lg px-3 py-2 text-xs font-bold ${filter === item ? 'bg-[hsl(var(--card))] shadow-sm' : 'text-[hsl(var(--muted-foreground))]'}`} data-testid={`button-payment-filter-${item.toLowerCase()}`}>{item === 'ALL' ? 'All payments' : 'Pending review'}</button>)}</div></div>{active.isLoading ? <div className="space-y-2 p-5"><div className="skeleton h-16 rounded-xl" /><div className="skeleton h-16 rounded-xl" /></div> : active.isError ? <div className="p-5"><ErrorState retry={() => active.refetch()} /></div> : !active.data?.length ? <EmptyState icon={Banknote} title={filter === 'PENDING' ? 'Queue is clear' : 'No transfers yet'} description={filter === 'PENDING' ? 'There are no submitted transfers waiting for bank reconciliation.' : 'Payments will appear here once families submit bank transfers.'} /> : <div className="divide-y divide-[hsl(var(--border))]">{active.data.map(payment => <div key={payment.id} className="flex flex-col gap-3 p-5 md:flex-row md:items-center md:gap-5 md:px-6" data-testid={`row-finance-payment-${payment.id}`}><div className="min-w-0 flex-1"><div className="text-sm font-bold">{payment.studentName} <span className="font-mono text-xs text-[hsl(var(--muted-foreground))]">· {payment.invoiceNumber}</span></div><div className={`mt-1 break-all ${muted}`}>{payment.transferBank || payment.method} · Ref {payment.transferReference || payment.reference} · {new Date(payment.createdAt).toLocaleDateString('en-NG')}</div></div><div className="flex flex-wrap items-center gap-3"><span className="text-sm font-bold tabular-nums">{amount(payment.amountMinor)}</span><StatusPill value={payment.status} /><Button variant="outline" onClick={() => setSelectedId(payment.id)} testId={`button-review-payment-${payment.id}`}>{payment.status === 'PENDING' ? 'Review' : 'Details'}</Button></div></div>)}</div>}{selectedId !== null && <ReviewPayment key={`${schoolId}-${selectedId}`} paymentId={selectedId} schoolId={schoolId} onClose={() => setSelectedId(null)} onChanged={onChanged} />}</section>;
}

export function PendingAdjustments({ schoolId, canApprove, onChanged }: { schoolId: number; canApprove: boolean; onChanged: (message: string) => void }) {
  const qc = useQueryClient();
  const params = { schoolId };
  const query = useListPendingFeeAdjustments(params, { query: { enabled: !!schoolId, queryKey: getListPendingFeeAdjustmentsQueryKey(params), refetchInterval: 30000 } });
  const approve = useApproveFeeAdjustment();
  const [failure, setFailure] = useState('');
  const [approved, setApproved] = useState<FeeAdjustment[]>([]);
  return <section className="panel mt-6 overflow-hidden"><div className="border-b border-[hsl(var(--border))] p-5 md:p-6"><div className="eyebrow">Approval desk</div><h2 className="display-font mt-1 text-xl font-bold">Pending adjustments <span className="text-sm text-[hsl(var(--muted-foreground))]">· {query.data?.length ?? 0}</span></h2><p className={`mt-2 ${muted}`}>Approval responses include the persisted approved amount and resulting balance. The generated contract currently exposes the pending queue only; it does not provide a historical adjustment list.</p></div>{failure && <p className="p-4 text-sm text-[hsl(var(--destructive))]" role="alert">{failure}</p>}{query.isLoading ? <div className="skeleton m-5 h-24 rounded-xl" /> : query.isError ? <div className="p-5"><ErrorState retry={() => query.refetch()} /></div> : !query.data?.length ? <EmptyState icon={FileCheck2} title="No approvals waiting" description="Requested fee adjustments will appear here for review." /> : <div className="divide-y divide-[hsl(var(--border))]">{query.data.map(adjustment => <div key={adjustment.id} className="flex flex-col gap-3 p-5 md:flex-row md:items-center md:px-6" data-testid={`row-pending-adjustment-${adjustment.id}`}><div className="min-w-0 flex-1"><div className="text-sm font-bold">{adjustment.studentName} · {adjustment.kind.toLowerCase()}</div><div className={`mt-1 ${muted}`}>{adjustment.invoiceNumber} · Requested {new Date(adjustment.requestedAt).toLocaleDateString('en-NG')}</div><p className="mt-2 break-words text-sm">{adjustment.reason}</p><div className={`mt-2 ${muted}`}>Requested {adjustment.percentage === null ? 'fixed amount' : `${adjustment.percentage}% discount`} · Original balance {adjustment.originalBalanceMinor === null ? 'not supplied' : amount(adjustment.originalBalanceMinor)}</div></div><div className="flex items-center gap-3"><strong className="tabular-nums">{adjustment.percentage === null ? amount(adjustment.amountMinor) : `${adjustment.percentage}% · ${amount(adjustment.amountMinor)}`}</strong>{canApprove ? <Button disabled={approve.isPending} onClick={async () => { if (!window.confirm(`Approve ${amount(adjustment.amountMinor)} ${adjustment.kind.toLowerCase()} on ${adjustment.invoiceNumber}?`)) return; try { const result = await approve.mutateAsync({ adjustmentId: adjustment.id, params }); setApproved(current => [result, ...current.filter(item => item.id !== result.id)]); setFailure(''); await Promise.all([qc.invalidateQueries({ queryKey: getListPendingFeeAdjustmentsQueryKey(params) }), qc.invalidateQueries({ queryKey: getListFeeInvoicesQueryKey(params) }), qc.invalidateQueries({ queryKey: getGetSchoolFinanceSummaryQueryKey(params) }), qc.invalidateQueries({ queryKey: getListParentFeeInvoicesQueryKey() }), qc.invalidateQueries({ queryKey: getListStudentFeeInvoicesQueryKey() }), qc.invalidateQueries({ predicate: item => item.queryKey[0] === '/api/school/finance/reports' && (item.queryKey[1] as { schoolId?: number } | undefined)?.schoolId === schoolId })]); onChanged(`Adjustment #${adjustment.id} approved.`); } catch (error) { setFailure(message(error)); } }} testId={`button-approve-adjustment-${adjustment.id}`}>Approve</Button> : <span className={muted}>School Admin approval required</span>}</div></div>)}</div>}{approved.length > 0 && <div className="border-t border-[hsl(var(--border))] p-5 md:p-6"><h3 className="font-bold">Approved decisions in this view</h3><div className="mt-3 divide-y divide-[hsl(var(--border))]">{approved.map(item => <div key={item.id} className="py-3 text-sm" data-testid={`row-approved-adjustment-${item.id}`}><div className="font-bold">Adjustment #{item.id} · {item.status}</div><div className={`mt-1 ${muted}`}>Requested {item.percentage === null ? 'fixed amount' : `${item.percentage}%`} · Approved amount {item.approvedAmountMinor === null ? 'not supplied' : amount(item.approvedAmountMinor)} · Original balance {item.originalBalanceMinor === null ? 'not supplied' : amount(item.originalBalanceMinor)} · Resulting balance {item.resultingBalanceMinor === null ? 'not supplied' : amount(item.resultingBalanceMinor)}</div></div>)}</div></div>}</section>;
}

function hasOriginalReceipt(payment: FeePaymentHistory): boolean {
  return !!payment.receiptNumber && ['VERIFIED', 'REFUNDED', 'REVERSED'].includes(payment.status);
}

function StudentStatementPrintDocument({
  schoolId,
  studentId,
  invoices,
  payments,
}: {
  schoolId: number;
  studentId: number;
  invoices: FeeInvoice[];
  payments: FeePaymentHistory[];
}) {
  const branding = useSchoolDocumentBranding(schoolId);
  const school = branding.data;
  const studentName = invoices[0]?.studentName ?? payments[0]?.studentName;
  return <SchoolDocumentPrintButton
    label="Print statement"
    testId={`button-print-student-statement-${schoolId}-${studentId}`}
    disabled={!school || branding.isLoading || branding.isError}
    unavailableMessage={branding.isError ? 'School branding could not be loaded. Retry before printing this statement.' : 'Loading the selected school identity.'}
  >
    <article className="school-document-page">
      <SchoolDocumentHeader branding={school ?? {}} />
      <h2 className="school-document-title">Student fee statement</h2>
      <dl className="school-document-grid">
        <div className="school-document-field"><dt>Student</dt><dd>{studentName ?? `Student #${studentId}`}</dd></div>
        <div className="school-document-field"><dt>Student ID</dt><dd>{studentId}</dd></div>
        <div className="school-document-field"><dt>Invoices in this statement</dt><dd>{invoices.length}</dd></div>
        <div className="school-document-field"><dt>Payment records</dt><dd>{payments.length}</dd></div>
        <div className="school-document-field"><dt>Fee total</dt><dd>{amount(invoices.reduce((sum, invoice) => sum + invoice.totalMinor, 0))}</dd></div>
        <div className="school-document-field"><dt>Verified paid balance</dt><dd>{amount(invoices.reduce((sum, invoice) => sum + invoice.paidMinor, 0))}</dd></div>
        <div className="school-document-field"><dt>Outstanding balance</dt><dd>{amount(invoices.reduce((sum, invoice) => sum + invoice.outstandingMinor, 0))}</dd></div>
      </dl>
      {!!invoices.length && <>
        <h3 className="school-document-title">Issued invoices</h3>
        <table className="school-document-table">
          <thead><tr><th>Invoice</th><th>Session / term</th><th>Status</th><th>Billed</th><th>Verified paid</th><th>Outstanding</th></tr></thead>
          <tbody>{invoices.map(invoice => <tr key={invoice.id}>
            <td>{invoice.invoiceNumber}</td>
            <td>{invoice.sessionId} / {invoice.termId}</td>
            <td>{invoice.status}</td>
            <td>{amount(invoice.totalMinor)}</td>
            <td>{amount(invoice.paidMinor)}</td>
            <td>{amount(invoice.outstandingMinor)}</td>
          </tr>)}</tbody>
        </table>
      </>}
      {!!payments.length && <>
        <h3 className="school-document-title">Payment activity</h3>
        <table className="school-document-table">
          <thead><tr><th>Invoice</th><th>Recorded</th><th>Method</th><th>Reference</th><th>Status</th><th>Amount</th></tr></thead>
          <tbody>{payments.map(payment => <tr key={payment.id}>
            <td>{payment.invoiceNumber}</td>
            <td>{new Date(payment.createdAt).toLocaleDateString('en-NG')}</td>
            <td>{payment.method.replaceAll('_', ' ')}</td>
            <td>{payment.transferReference || payment.reference}</td>
            <td>{payment.status}</td>
            <td>{amount(payment.amountMinor)}</td>
          </tr>)}</tbody>
        </table>
        <p className="mt-3 text-xs">Pending and rejected submissions are shown as activity; they are not counted as verified paid.</p>
      </>}
    </article>
  </SchoolDocumentPrintButton>;
}

function VerifiedReceipt({ payment, onClose }: { payment: FeePaymentHistory; onClose: () => void }) {
  const canOpenReceipt = hasOriginalReceipt(payment);
  const query = useGetFeePaymentReceipt(payment.id, undefined, { query: { enabled: canOpenReceipt, queryKey: getGetFeePaymentReceiptQueryKey(payment.id) } });
  const matchesPayment = query.data?.paymentId === payment.id
    && Number(query.data.snapshot?.invoiceId) === payment.invoiceId
    && Number(query.data.snapshot?.schoolId) === payment.schoolId
    && query.data.schoolId === payment.schoolId;
  const branding = useSchoolDocumentBranding(payment.schoolId);
  const snapshot = query.data?.snapshot;
  const hasSnapshotLogo = !!snapshot && Object.prototype.hasOwnProperty.call(snapshot, 'schoolLogo');
  const snapshotLogo = snapshot?.schoolLogo;
  const documentBranding = {
    ...(branding.data ?? {}),
    schoolId: payment.schoolId,
    name: typeof snapshot?.schoolName === 'string' ? snapshot.schoolName : branding.data?.name,
    logoUrl: hasSnapshotLogo
      ? typeof snapshotLogo === 'string' ? snapshotLogo : null
      : branding.data?.logoUrl,
  };
  const snapshotValue = (key: string) => {
    const value = snapshot?.[key];
    return typeof value === 'string' || typeof value === 'number' ? value : null;
  };
  const snapshotAmount = (key: string) => {
    const value = Number(snapshot?.[key]);
    return Number.isSafeInteger(value) && value >= 0 ? amount(value) : null;
  };
  return <Modal title="Original payment receipt" eyebrow={payment.invoiceNumber} onClose={onClose}>
    {query.isLoading ? <div className="skeleton h-32 rounded-xl" />
      : query.isError ? <ErrorState retry={() => query.refetch()} message="The original receipt could not be retrieved right now." />
        : query.data && !matchesPayment ? <div role="alert" className="rounded-xl bg-[hsl(var(--destructive)/.08)] p-4 text-sm text-[hsl(var(--destructive))]">The receipt does not match this invoice and school. Contact the finance office.</div>
          : query.data && canOpenReceipt ? <div>
            <div className="rounded-xl bg-[hsl(var(--secondary))] p-5">
              <div className="eyebrow">Original receipt · retained after payment changes</div>
              <div className="mt-2 break-all font-mono text-xl font-bold" data-testid="text-verified-receipt-number">{query.data.receiptNumber}</div>
              <div className="mt-3 text-sm">{payment.studentName} · {amount(payment.amountMinor)}</div>
              <div className={`mt-1 ${muted}`}>Payment status now: {payment.status} · Verified {payment.verifiedAt ? new Date(payment.verifiedAt).toLocaleDateString('en-NG') : 'by the school'}</div>
              {['REFUNDED', 'REVERSED'].includes(payment.status) && <p className="mt-3 text-xs font-semibold">This status reflects an internal ledger record, not confirmation that a provider-issued payout occurred.</p>}
            </div>
            <SchoolDocumentPrintButton
              label="Print receipt"
              testId={`button-print-receipt-${payment.id}`}
              className="mt-5"
              disabled={!branding.data || branding.isLoading || branding.isError || !documentBranding.name}
              unavailableMessage={branding.isError ? 'Official school details could not be loaded for this original receipt.' : 'School details are unavailable until the branding record loads.'}
            >
              <article className="school-document-page">
                <SchoolDocumentHeader branding={documentBranding} />
                <h2 className="school-document-title">Fee payment receipt</h2>
                <dl className="school-document-grid">
                  <div className="school-document-field"><dt>Receipt number</dt><dd>{query.data.receiptNumber}</dd></div>
                  <div className="school-document-field"><dt>Invoice number</dt><dd>{snapshotValue('invoiceNumber') ?? payment.invoiceNumber}</dd></div>
                  <div className="school-document-field"><dt>Student</dt><dd>{snapshotValue('studentName') ?? payment.studentName}</dd></div>
                  {snapshotValue('admissionNo') !== null && <div className="school-document-field"><dt>Admission number</dt><dd>{snapshotValue('admissionNo')}</dd></div>}
                  {snapshotValue('className') !== null && <div className="school-document-field"><dt>Class</dt><dd>{snapshotValue('className')}</dd></div>}
                  <div className="school-document-field"><dt>Session / term</dt><dd>{snapshotValue('sessionId') ?? '—'} / {snapshotValue('termId') ?? '—'}</dd></div>
                  {snapshotValue('payerName') !== null && <div className="school-document-field"><dt>Payer</dt><dd>{snapshotValue('payerName')}</dd></div>}
                  <div className="school-document-field"><dt>Payment reference</dt><dd>{snapshotValue('paymentReference') ?? payment.reference}</dd></div>
                  <div className="school-document-field"><dt>Payment method</dt><dd>{snapshotValue('method') ?? payment.method}</dd></div>
                  <div className="school-document-field"><dt>Receipt status</dt><dd>{snapshotValue('status') ?? 'VERIFIED'}</dd></div>
                  <div className="school-document-field"><dt>Amount received</dt><dd>{snapshotAmount('amountMinor') ?? amount(payment.amountMinor)}</dd></div>
                  {snapshotAmount('previousBalanceMinor') !== null && <div className="school-document-field"><dt>Balance before payment</dt><dd>{snapshotAmount('previousBalanceMinor')}</dd></div>}
                  {snapshotAmount('remainingBalanceMinor') !== null && <div className="school-document-field"><dt>Remaining balance</dt><dd>{snapshotAmount('remainingBalanceMinor')}</dd></div>}
                </dl>
                {['REFUNDED', 'REVERSED'].includes(payment.status) && <p className="school-document-error">Current payment status: {payment.status}. This is an internal ledger status, not confirmation of a provider payout.</p>}
              </article>
            </SchoolDocumentPrintButton>
          </div>
          : <p className={muted}>No original receipt is available for this payment.</p>}
  </Modal>;
}

export function FamilyPaymentHistory({ audience, studentId, invoices = [] }: { audience: 'parent' | 'student'; studentId?: number; invoices?: FeeInvoice[] }) {
  const parent = useListParentFeePayments({ query: { enabled: audience === 'parent', queryKey: getListParentFeePaymentsQueryKey(), refetchInterval: 30000 } });
  const student = useListStudentFeePayments({ query: { enabled: audience === 'student', queryKey: getListStudentFeePaymentsQueryKey(), refetchInterval: 30000 } });
  const query = audience === 'parent' ? parent : student;
  const [receipt, setReceipt] = useState<FeePaymentHistory | null>(null);
  const payments = (query.data ?? []).filter(payment => studentId === undefined || payment.studentId === studentId);
  const statementInvoices = invoices.filter(invoice => studentId === undefined || invoice.studentId === studentId);
  const statementSchoolIds = [...new Set([
    ...statementInvoices.map(invoice => invoice.schoolId),
    ...payments.map(payment => payment.schoolId),
  ])];
  return <section className="panel mt-5 overflow-hidden" data-testid="section-payment-history">
    <div className="border-b border-[hsl(var(--border))] p-5 md:p-6">
      <div className="eyebrow">Payment trail</div>
      <h2 className="display-font mt-1 text-xl font-bold">Transfer history</h2>
      <p className={`mt-1 ${muted}`}>Pending submissions are not included in verified paid balances. Refund/reversal statuses are internal ledger classifications, not provider payout confirmation.</p>
    </div>
    {query.isLoading ? <div className="space-y-2 p-5"><div className="skeleton h-16 rounded-xl" /><div className="skeleton h-16 rounded-xl" /></div>
      : query.isError ? <div className="p-5"><ErrorState retry={() => query.refetch()} /></div>
        : !payments.length ? <EmptyState icon={Clock3} title="No payment submissions" description="Submitted transfers and their review status will appear here after they are recorded." />
          : <div className="divide-y divide-[hsl(var(--border))]">{payments.map(payment => <div key={payment.id} className="flex flex-col gap-3 p-5 md:flex-row md:items-center md:px-6" data-testid={`row-payment-history-${payment.id}`}><div className="min-w-0 flex-1"><div className="text-sm font-bold">{payment.invoiceNumber} · {payment.studentName}</div><div className={`mt-1 break-all ${muted}`}>{payment.transferBank || payment.method.replaceAll('_', ' ')} · {payment.transferReference || payment.reference} · {new Date(payment.createdAt).toLocaleDateString('en-NG')}</div>{payment.status === 'REJECTED' && payment.rejectionReason && <div className="mt-2 text-xs text-[hsl(var(--destructive))]">Rejected: {payment.rejectionReason}</div>}{payment.status === 'PENDING' && <div className={`mt-2 ${muted}`}>Awaiting school verification. Not paid.</div>}{['REFUNDED', 'REVERSED'].includes(payment.status) && <div className={`mt-2 ${muted}`}>{payment.status === 'REFUNDED' ? 'Internal refund record' : 'Internal reversal record'}; provider payout is not confirmed here. Original payment receipt remains available below.</div>}</div><div className="flex flex-wrap items-center gap-3"><strong className="text-sm tabular-nums">{amount(payment.amountMinor)}</strong><StatusPill value={payment.status} />{hasOriginalReceipt(payment) && <Button variant="outline" onClick={() => setReceipt(payment)} testId={`button-open-receipt-${payment.id}`}><ReceiptText size={14} />Original receipt</Button>}</div></div>)}</div>}
    {!query.isLoading && !query.isError && statementSchoolIds.map(schoolId => {
      const schoolInvoices = statementInvoices.filter(invoice => invoice.schoolId === schoolId);
      const schoolPayments = payments.filter(payment => payment.schoolId === schoolId);
      const statementStudentId = studentId ?? schoolInvoices[0]?.studentId ?? schoolPayments[0]?.studentId;
      if (statementStudentId == null) return null;
      return <div key={schoolId} className="border-t border-[hsl(var(--border))] p-5">
        <StudentStatementPrintDocument schoolId={schoolId} studentId={statementStudentId} invoices={schoolInvoices} payments={schoolPayments} />
      </div>;
    })}
    {receipt && <VerifiedReceipt payment={receipt} onClose={() => setReceipt(null)} />}
  </section>;
}