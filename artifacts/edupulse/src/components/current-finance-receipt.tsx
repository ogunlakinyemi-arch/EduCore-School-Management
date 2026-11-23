import { useState } from 'react';
import { useUser } from '@clerk/react';
import { useGetCurrentFinanceReceipt, getGetCurrentFinanceReceiptQueryKey } from '@workspace/api-client-react';
import { Button, Modal } from '@/components/shared';
import { SchoolDocumentPrintButton } from '@/components/school-document';
import { apiErrorText, naira, type FinanceReceipt } from '@/lib/current-finance';

function isReceipt(d: unknown): d is FinanceReceipt {
  const r = d as FinanceReceipt | null;
  return !!r && typeof r.amountMinor === 'number' && r.currency === 'NGN' && Array.isArray(r.items) && typeof r.reference === 'string';
}

export function CurrentFinanceReceiptView({ receipt }: { receipt: FinanceReceipt }) {
  return <article className="school-document-page" data-testid={`receipt-${receipt.id}`}>
    <h2 className="school-document-title">{receipt.schoolName} · Student platform receipt</h2>
    <dl className="school-document-grid">
      <div className="school-document-field"><dt>Reference</dt><dd>{receipt.reference}</dd></div>
      <div className="school-document-field"><dt>Term</dt><dd>{receipt.termName}</dd></div>
      <div className="school-document-field"><dt>Amount received</dt><dd>{naira(receipt.amountMinor)}</dd></div>
      <div className="school-document-field"><dt>Refunded</dt><dd>{naira(receipt.refundedMinor)}</dd></div>
      <div className="school-document-field"><dt>Net paid</dt><dd>{naira(receipt.netPaidMinor)}</dd></div>
      <div className="school-document-field"><dt>Verified</dt><dd>{receipt.verifiedAt ? new Date(receipt.verifiedAt).toLocaleString('en-NG') : 'Not verified'}</dd></div>
    </dl>
    <table className="school-document-table"><thead><tr><th>Receipt no.</th><th>Student</th><th>Amount</th><th>Refunded</th><th>Net</th></tr></thead>
      <tbody>{receipt.items.map(i => <tr key={i.id}><td>{i.receiptNumber}</td><td>{i.studentName}</td><td>{naira(i.amountMinor)}</td><td>{naira(i.refundedMinor)}</td><td>{naira(i.netPaidMinor)}</td></tr>)}</tbody></table>
  </article>;
}

function ReceiptLoader({ id, allocationId, onClose }: { id: number; allocationId?: number; onClose: () => void }) {
  const { user } = useUser();
  const params = allocationId ? { allocationId } : undefined;
  const q = useGetCurrentFinanceReceipt(id, params, { query: {
    queryKey: [...getGetCurrentFinanceReceiptQueryKey(id, params), user?.id ?? 'anonymous'], enabled: !!user?.id, staleTime: 0, retry: false,
  } });
  return <Modal title={allocationId ? 'Child receipt' : 'Bulk receipt'} eyebrow="Verified payment" onClose={onClose}>
    {q.isLoading ? <div className="skeleton h-48 rounded-xl" />
      : q.isError ? <div role="alert" className="text-sm">{apiErrorText(q.error, 'This receipt is not available to you.')} <Button variant="outline" className="mt-3" onClick={() => void q.refetch()}>Retry</Button></div>
        : !isReceipt(q.data) ? <p role="alert" className="text-sm">The server did not return a verifiable receipt. Nothing is printed.</p>
          : !q.data.verifiedAt ? <p role="status" className="text-sm">This payment is not verified yet; no receipt can be issued.</p>
            : <div className="space-y-4"><div className="max-h-[60vh] overflow-auto rounded-xl border border-[hsl(var(--border))]"><CurrentFinanceReceiptView receipt={q.data} /></div>
              <SchoolDocumentPrintButton label="Print receipt" testId={`button-print-receipt-${id}-${allocationId ?? 'all'}`}><CurrentFinanceReceiptView receipt={q.data} /></SchoolDocumentPrintButton></div>}
  </Modal>;
}

export function CurrentFinanceReceiptButton({ id, allocationId, label }: { id: number; allocationId?: number; label: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="text-xs font-bold text-[hsl(var(--primary))] underline" onClick={() => setOpen(true)} data-testid={`button-receipt-${id}-${allocationId ?? 'all'}`}>{label}</button>
    {open && <ReceiptLoader id={id} allocationId={allocationId} onClose={() => setOpen(false)} />}
  </>;
}
