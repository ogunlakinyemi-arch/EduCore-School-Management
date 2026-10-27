import { useRef, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
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
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [f, setF] = useState({ receivedFrom: '', evidenceReference: '', amount: '', notes: '', receivedOn: today });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<CashReceipt | null>(null);
  const [selectedLines, setSelectedLines] = useState<number[] | null>(null);
  const feeLines = useQuery<{
    selectable: boolean; reason: string | null;
    lines: Array<{ id: number; name: string; outstandingMinor: number }>;
  }>({
    queryKey: ['cash-invoice-lines', schoolId, invoice.id],
    enabled: open && !receipt, staleTime: 0, retry: false,
    queryFn: async () => {
      const r = await fetch(`/api/school/finance/invoices/${invoice.id}/lines?schoolId=${schoolId}`, { credentials: 'include' });
      if (!r.ok) throw new Error('Fee categories could not be loaded. Close and reopen to retry.');
      return r.json();
    },
  });
  // One key per distinct payload: retries after an error reuse it, edits get a new one.
  const attempt = useRef<{ fingerprint: string; key: string } | null>(null);
  if (!receipt && (invoice.outstandingMinor <= 0 || ['WAIVED', 'CANCELLED', 'PAID'].includes(invoice.status))) return null;

  const close = () => { if (pending) return; setOpen(false); setReceipt(null); setSelectedLines(null); setError(''); setF({ receivedFrom: '', evidenceReference: '', amount: '', notes: '', receivedOn: today }); attempt.current = null; };
  const chooseLines = (ids: number[]) => {
    setSelectedLines(ids);
    const minor = feeLines.data?.lines.filter(l => ids.includes(l.id)).reduce((sum, l) => sum + l.outstandingMinor, 0) ?? 0;
    setF(prev => ({ ...prev, amount: `${Math.floor(minor / 100)}.${String(minor % 100).padStart(2, '0')}` }));
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    const amountMinor = parseNairaToMinor(f.amount);
    if (amountMinor === null) return setError('Enter a positive amount with at most two decimal places.');
    if (selectedLines !== null && (!selectedLines.length || !feeLines.data?.selectable)) return setError('Select available fee categories or use the invoice balance.');
    if (amountMinor > invoice.outstandingMinor) return setError(`Amount cannot exceed the outstanding balance of ${naira(invoice.outstandingMinor)}.`);
    const body = { amountMinor, evidenceReference: f.evidenceReference.trim(), notes: f.notes.trim(), receivedFrom: f.receivedFrom.trim(), receivedOn: f.receivedOn,
      ...(selectedLines !== null ? { lineIds: [...selectedLines].sort((a,b)=>a-b) } : {}) };
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
        <fieldset disabled={pending} className="space-y-4">
        <legend className="sr-only">Cash collection details</legend>
        <p className="text-sm">{invoice.studentName} · outstanding {naira(invoice.outstandingMinor)}</p>
        <Field label="Received from"><input required minLength={3} value={f.receivedFrom} onChange={e => setF({ ...f, receivedFrom: e.target.value })} /></Field>
        <Field label="Cash reference"><input required minLength={3} value={f.evidenceReference} onChange={e => setF({ ...f, evidenceReference: e.target.value })} /></Field>
        <Field label="Apply payment to"><select value={selectedLines === null ? 'invoice' : 'categories'} onChange={e => {
          if(e.target.value === 'invoice') setSelectedLines(null); else chooseLines([]);
        }}>
          <option value="invoice">Invoice balance</option>
          <option value="categories" disabled={!feeLines.data?.selectable}>Selected fee categories in full</option>
        </select></Field>
        {feeLines.isLoading && <p className="text-xs" role="status">Loading fee categories…</p>}
        {feeLines.isError && <p className="text-xs" role="alert">Fee categories could not be loaded. Invoice-balance payments are still checked by the server.</p>}
        {feeLines.data && !feeLines.data.selectable && <p className="text-xs">{feeLines.data.reason}</p>}
        {selectedLines !== null && <fieldset className="space-y-2 rounded-lg border border-[hsl(var(--border))] p-3">
          <legend className="px-1 text-xs font-semibold">Fee categories</legend>
          {feeLines.data?.lines.map(line => {
            const nfc = /nfc.*subscription|subscription.*nfc/i.test(line.name);
            return <label key={line.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={selectedLines.includes(line.id)} disabled={nfc || line.outstandingMinor <= 0}
                onChange={e => chooseLines(e.target.checked ? [...selectedLines, line.id] : selectedLines.filter(id => id !== line.id))} />
              {line.name} · {naira(line.outstandingMinor)}{nfc && ' · existing NFC policy requires review'}
            </label>;
          })}
        </fieldset>}
        <Field label="Amount (₦)"><input required readOnly={selectedLines !== null} inputMode="decimal" aria-label="Cash amount in naira" value={f.amount} onChange={e => setF({ ...f, amount: e.target.value })} /></Field>
        <Field label="Date cash received"><input type="date" required max={today} value={f.receivedOn} onChange={e => setF({ ...f, receivedOn: e.target.value })} /></Field>
        <Field label="Notes"><textarea required minLength={3} rows={3} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} /></Field>
        {error && <p role="alert" className="text-sm text-[hsl(var(--destructive))]">{error}</p>}
        <div className="flex justify-end gap-3 border-t border-[hsl(var(--border))] pt-4"><Button variant="outline" onClick={close}>Cancel</Button><Button type="submit" disabled={pending} testId={`button-submit-cash-${invoice.id}`}>{pending ? 'Recording…' : 'Record payment'}</Button></div>
        </fieldset>
      </form>}
    </Modal>}
  </>;
}
