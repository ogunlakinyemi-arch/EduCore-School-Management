import { useRef, useState, type FormEvent } from 'react';
import { Banknote } from 'lucide-react';
import type { FeeInvoice } from '@workspace/api-client-react';
import { Button, Field, Modal } from '@/components/shared';

export type CashReceipt = { id: number; schoolId: number; invoiceId: number; reference: string; amountMinor: number; currency: string; method: 'CASH'; status: 'VERIFIED'; receiptNumber: string };

export const parseNairaToMinor = (value: string): number | null => {
  if (!/^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(value.trim())) return null;
  const t = value.trim().replaceAll(',', '');
  const [w, f = ''] = t.split('.');
  const minor = BigInt(w) * 100n + BigInt(f.padEnd(2, '0'));
  return minor > 0n && minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
};
const naira = (minor: number) => `₦${(BigInt(minor) / 100n).toLocaleString('en-NG')}.${String(BigInt(minor) % 100n).padStart(2, '0')}`;

export function CashPaymentAction({ invoice, schoolId, onDone }: { invoice: FeeInvoice; schoolId: number; onDone: (receipt:CashReceipt) => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ receivedFrom: '', evidenceReference: '', amount: '', notes: '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<CashReceipt | null>(null);
  // One key per distinct payload: retries after an error reuse it, edits get a new one.
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  if (!receipt && (invoice.outstandingMinor <= 0 || ['WAIVED', 'CANCELLED', 'PAID'].includes(invoice.status))) return null;

  const close = () => { setOpen(false); setReceipt(null); setError(''); setF({ receivedFrom: '', evidenceReference: '', amount: '', notes: '' }); attempt.current = null; };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amountMinor = parseNairaToMinor(f.amount);
    if (amountMinor === null) return setError('Enter a positive amount with at most two decimal places.');
    if (amountMinor > invoice.outstandingMinor) return setError(`Amount cannot exceed the outstanding balance of ${naira(invoice.outstandingMinor)}.`);
    const body = { amountMinor, evidenceReference: f.evidenceReference.trim(), notes: f.notes.trim(), receivedFrom: f.receivedFrom.trim() };
    if (body.evidenceReference.length < 3 || body.notes.length < 3 || body.receivedFrom.length < 3) return setError('Received from, cash reference and notes each need at least 3 characters.');
    const fingerprint = JSON.stringify(body);
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, key: crypto.randomUUID() };
    setError(''); setPending(true);
    try {
      const r = await fetch(`/api/school/finance/invoices/${invoice.id}/cash-payments?schoolId=${schoolId}`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': attempt.current.key }, body: fingerprint,
      });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(res?.error || `Cash payment could not be recorded (${r.status}). You can retry safely.`);
      setReceipt(res as CashReceipt);
      attempt.current = null;
      onDone(res as CashReceipt);
    } catch (err) { setError(err instanceof Error ? err.message : 'Cash payment could not be recorded. You can retry safely.'); }
    finally { setPending(false); }
  };
  return <>
    <Button variant="quiet" onClick={() => setOpen(true)} testId={`button-cash-${invoice.id}`}><Banknote size={14} />Record cash</Button>
    {open && <Modal title="Record cash payment" eyebrow={invoice.invoiceNumber} onClose={close}>
      {receipt ? <div className="space-y-3" role="status" data-testid="cash-receipt-result">
        <p className="text-sm font-semibold">Cash payment verified.</p>
        <dl className="grid grid-cols-2 gap-2 text-sm"><dt>Receipt number</dt><dd className="font-mono font-bold">{receipt.receiptNumber}</dd><dt>Reference</dt><dd className="font-mono">{receipt.reference}</dd><dt>Amount</dt><dd className="font-bold">{naira(receipt.amountMinor)}</dd></dl>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">The receipt is available from the payments list.</p>
        <div className="flex justify-end"><Button onClick={close}>Done</Button></div>
      </div> : <form onSubmit={submit} className="space-y-4">
        <p className="text-sm">{invoice.studentName} · outstanding {naira(invoice.outstandingMinor)}</p>
        <Field label="Received from"><input required minLength={3} value={f.receivedFrom} onChange={e => setF({ ...f, receivedFrom: e.target.value })} /></Field>
        <Field label="Cash reference"><input required minLength={3} value={f.evidenceReference} onChange={e => setF({ ...f, evidenceReference: e.target.value })} /></Field>
        <Field label="Amount (₦)"><input required inputMode="decimal" aria-label="Cash amount in naira" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Notes"><textarea required minLength={3} rows={3} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
        {error && <p role="alert" className="text-sm text-[hsl(var(--destructive))]">{error}</p>}
        <div className="flex justify-end gap-3 border-t border-[hsl(var(--border))] pt-4"><Button variant="outline" onClick={close}>Cancel</Button><Button type="submit" disabled={pending} testId={`button-submit-cash-${invoice.id}`}>{pending ? 'Recording…' : 'Record payment'}</Button></div>
      </form>}
    </Modal>}
  </>;
}
