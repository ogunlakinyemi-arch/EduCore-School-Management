import { useState } from 'react';
import { Landmark } from 'lucide-react';
import { Button, Field, StatusPill } from '@/components/shared';
import { CurrentFinanceReceiptButton } from '@/components/current-finance-receipt';
import { naira, toMinor, useFinanceAction, type Batch } from '@/lib/current-finance';

export type BankBatch = Batch;
export type BankInstructions = { available: boolean; bank: { businessName: string; bankName: string; accountName: string; accountNumber: string } | null; message: string; transferReference: string; collectionPeriodEligible: boolean };
type Fin = ReturnType<typeof useFinanceAction>;
type RunResult = Awaited<ReturnType<Fin['run']>>;
export const act = (a: Parameters<Fin['run']>[1]) => a;
export const STUDENT_FEE_MINOR = 320000;

const muted = 'text-[hsl(var(--muted-foreground))]';
const box = 'rounded-xl border border-[hsl(var(--border))]';
const btn = 'h-8 px-3 text-xs';

function isInstructions(v: unknown): v is BankInstructions {
  const o = v as BankInstructions | null;
  return !!o && typeof o === 'object' && typeof o.available === 'boolean' && typeof o.transferReference === 'string';
}

/** One company-bank remittance batch. Requests and uploads are never payment; only the Owner's
 * independently checked aggregate credit (BANK_VERIFIED) establishes payment, then allocation is a separate step. */
export function BankRemittanceBatch({ b, fin, report, owner, readOnly }: { b: BankBatch; fin: Fin; report: (r: RunResult, ok: string) => void; owner: boolean; readOnly?: boolean }) {
  const [ins, setIns] = useState<BankInstructions | null>(null);
  const [insErr, setInsErr] = useState('');
  const [verify, setVerify] = useState<{ bank: string; ref: string; date: string; amount: string; checked: boolean; reason: string } | null>(null);
  const [closeReason, setCloseReason] = useState('');
  const [postReason, setPostReason] = useState('');
  const today = new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lagos',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const open = b.state === 'REQUESTED';
  const credited = ['BANK_VERIFIED', 'RECOVERY_REQUIRED', 'COMPLETED'].includes(b.state);
  const unresolved = b.items.filter(i => i.state !== 'POSTED');
  const pendingBro = owner ? b.items.filter(i => i.broAccrualPending).length : 0;
  const expected = b.items.length * STUDENT_FEE_MINOR;

  const loadInstructions = async () => {
    setInsErr('');
    const r = await fin.run(`bi:${b.id}`, act('BANK_INSTRUCTIONS'), { id: b.id }, false);
    if (r.ok && isInstructions(r.result)) setIns(r.result);
    else { setIns(null); setInsErr(r.ok ? 'The server response did not match the expected instructions. Do not transfer funds.' : `${r.message} Do not transfer funds until instructions load.`); }
  };
  const vMinor = verify ? toMinor(verify.amount) : null;
  const vOk = !!verify && verify.bank.trim().length >= 2 && /^[A-Za-z0-9/._ -]{6,120}$/.test(verify.ref)
    &&verify.ref.replace(/\s/g,'').length>=6&&/[A-Za-z0-9]/.test(verify.ref)&&!!verify.date && verify.date <= today
    && vMinor === b.amountMinor && verify.checked && verify.reason.trim().length >= 3;

  return <div className={`${box} p-4`} data-testid={`bank-batch-${b.id}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2"><Landmark size={14} /><span className="font-mono text-xs">{b.reference}</span><span className="rounded-md bg-[hsl(var(--secondary))] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">Company bank</span><StatusPill value={b.state} /></div>
      <span className="font-mono font-bold" data-testid={`text-bank-amount-${b.id}`}>{naira(b.amountMinor)}</span>
    </div>
    <p className={`mt-1 text-xs ${muted}`}>{b.items.length} student{b.items.length === 1 ? '' : 's'} × ₦3,200 = {naira(expected)}{expected !== b.amountMinor && <b className="ml-1 text-[hsl(var(--destructive))]">Server amount differs from expected; transfer only the server amount after Owner review.</b>}</p>
    {open && <p className={`mt-1 text-xs font-semibold`}>Requested only. Not paid. A transfer, receipt or upload is not payment until the Owner independently verifies the credit on the company bank statement.</p>}
    {b.state === 'BANK_VERIFIED' && <p className="mt-1 text-xs font-semibold">Aggregate company credit verified; this establishes payment. Allocation to students is a separate step.</p>}
    {b.state === 'RECOVERY_REQUIRED' && <p className="mt-1 text-xs font-semibold text-[hsl(var(--destructive))]">Credit verified but some allocations are unresolved. Retry allocation; nothing is resent to a provider.</p>}

    {b.bankProof && <div className={`mt-2 rounded-lg bg-[hsl(var(--muted))] p-2 text-xs`} data-testid={`text-bank-proof-${b.id}`}>
      Verified credit: {b.bankProof.bankName} · ref <span className="font-mono">{b.bankProof.statementReference}</span> · {b.bankProof.creditDate} · {naira(b.bankProof.amountMinor)}
      {b.bankProof.verifiedAt && <> · checked {new Date(b.bankProof.verifiedAt).toLocaleString('en-NG',{timeZone:'Africa/Lagos'})} WAT</>}</div>}

    <ul className="mt-2 grid gap-1 text-xs md:grid-cols-2">{b.items.map(i => <li key={i.id} className="flex flex-wrap items-center justify-between gap-2" data-testid={`bank-item-${i.id}`}>
      <span>{i.studentName}{i.error && <span className="ml-1 text-[hsl(var(--destructive))]">{i.error}</span>}</span>
      <span className="flex items-center gap-2"><StatusPill value={i.state} />
        {owner && i.broAccrualPending && <span className="text-[10px] font-bold uppercase text-[hsl(var(--accent-foreground))]">BRO accrual pending</span>}
        {credited && i.state === 'POSTED' && <CurrentFinanceReceiptButton id={b.id} allocationId={i.id} label="Child receipt" />}</span></li>)}</ul>

    {!readOnly && <div className="mt-3 flex flex-wrap items-end gap-2">
      {open && <Button variant="outline" className={btn} disabled={fin.busy === `bi:${b.id}`} onClick={() => void loadInstructions()} testId={`button-bank-instructions-${b.id}`}>{fin.busy === `bi:${b.id}` ? 'Loading…' : ins ? 'Reload transfer instructions' : 'Show transfer instructions'}</Button>}
      {owner && open && !verify && <Button className={btn} onClick={() => setVerify({ bank: '', ref: '', date: '', amount: '', checked: false, reason: '' })} testId={`button-open-bank-verify-${b.id}`}>Verify company credit</Button>}
      {owner && credited && unresolved.length > 0 && <>
        <input className="!w-48 !py-1.5 text-xs" placeholder="Allocation reason" value={postReason} onChange={e => setPostReason(e.target.value)} data-testid={`input-bank-post-reason-${b.id}`} />
        <Button className={btn} disabled={postReason.trim().length < 3 || fin.busy === `bp:${b.id}`} onClick={async () => { const r = await fin.run(`bp:${b.id}`, act('BANK_POST'), { id: b.id, reason: postReason.trim() }, true); report(r, `Allocation requested for ${unresolved.length} unresolved student(s). Statuses below are the server's.`); if (r.ok) setPostReason(''); }} testId={`button-bank-post-${b.id}`}>{fin.pendingKey(`bp:${b.id}`) ? 'Resubmit same allocation' : `Allocate to ${unresolved.length} student(s)`}</Button></>}
      {owner && credited && unresolved.length === 0 && pendingBro > 0 && <Button variant="outline" className={btn} disabled={fin.busy === `br:${b.id}`} onClick={async () => report(await fin.run(`br:${b.id}`, 'BULK_RECOVER', { id: b.id }, false), 'Pending BRO accrual retried. No charge is made.')} testId={`button-bank-bro-recover-${b.id}`}>Retry {pendingBro} pending BRO accrual(s)</Button>}
      {credited && <CurrentFinanceReceiptButton id={b.id} label="Batch receipt" />}
    </div>}

    {insErr && <p role="alert" className="mt-2 text-xs font-semibold text-[hsl(var(--destructive))]">{insErr}</p>}
    {ins && open && <div className={`${box} mt-3 space-y-1 p-3 text-xs`} data-testid={`bank-instructions-${b.id}`}>
      <div>Transfer exactly <b className="font-mono">{naira(b.amountMinor)}</b> with reference <b className="select-all font-mono">{ins.transferReference}</b>.</div>
      {!ins.collectionPeriodEligible && <p role="alert" className="font-semibold text-[hsl(var(--destructive))]">This period is not eligible for collection. Do not transfer.</p>}
      {ins.available && ins.bank ? <div className="grid gap-1 sm:grid-cols-2"><span>Business: <b>{ins.bank.businessName}</b></span><span>Bank: <b>{ins.bank.bankName}</b></span><span>Account name: <b>{ins.bank.accountName}</b></span><span>Account number: <b className="select-all font-mono">{ins.bank.accountNumber}</b></span></div>
        : <p role="alert" className="font-semibold">{ins.message || 'Verified company account details are unavailable. Do not transfer funds.'}</p>}
      <p className={muted}>Do not transfer twice. Viewing instructions does not record a payment.</p>
    </div>}

    {owner && open && verify && <div className={`${box} mt-3 grid gap-3 p-3 md:grid-cols-2`} data-testid={`form-bank-verify-${b.id}`}>
      <Field label="Bank name"><input value={verify.bank} onChange={e => setVerify({ ...verify, bank: e.target.value })} data-testid={`input-bank-name-${b.id}`} /></Field>
      <Field label="Statement reference"><input value={verify.ref} onChange={e => setVerify({ ...verify, ref: e.target.value })} data-testid={`input-bank-ref-${b.id}`} /></Field>
      <Field label="Credit date"><input type="date" max={today} value={verify.date} onChange={e => setVerify({ ...verify, date: e.target.value })} data-testid={`input-bank-date-${b.id}`} /></Field>
      <Field label={`Credited amount (₦), must equal ${naira(b.amountMinor)}`} error={verify.amount && vMinor !== b.amountMinor ? 'Must match the batch amount exactly. Partial or excess credits cannot be verified here.' : undefined}>
        <input inputMode="decimal" value={verify.amount} onChange={e => setVerify({ ...verify, amount: e.target.value })} data-testid={`input-bank-amount-${b.id}`} /></Field>
      <Field label="Reason"><input value={verify.reason} onChange={e => setVerify({ ...verify, reason: e.target.value })} data-testid={`input-bank-verify-reason-${b.id}`} /></Field>
      <label className="flex items-start gap-2 text-xs font-semibold"><input type="checkbox" className="mt-0.5 h-4 !w-4" checked={verify.checked} onChange={e => setVerify({ ...verify, checked: e.target.checked })} data-testid={`check-bank-independent-${b.id}`} />I checked this credit on the company bank statement myself, not from a school receipt, screenshot or upload.</label>
      <div className="flex gap-2 md:col-span-2"><Button variant="outline" className={btn} onClick={() => setVerify(null)}>Close</Button>
        <Button className={btn} disabled={!vOk || fin.busy === `bv:${b.id}`} onClick={async () => {
          if (!verify || vMinor === null) return;
          const r = await fin.run(`bv:${b.id}`, act('BANK_VERIFY'), { id: b.id, bankName: verify.bank.trim(), statementReference: verify.ref.trim(), creditDate: verify.date, amountMinor: vMinor, independentlyChecked: true, reason: verify.reason.trim() }, true);
          report(r, 'Company credit verified. Allocate it to students as a separate step.'); if (r.ok) setVerify(null);
        }} testId={`button-submit-bank-verify-${b.id}`}>{fin.pendingKey(`bv:${b.id}`) ? 'Resubmit same verification' : 'Record verified credit'}</Button></div>
    </div>}

    {!readOnly && open && <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-[hsl(var(--border))] pt-3">
      <input className="!w-56 !py-1.5 text-xs" placeholder="Reason to cancel / reject" value={closeReason} onChange={e => setCloseReason(e.target.value)} data-testid={`input-bank-close-reason-${b.id}`} />
      <Button variant="quiet" className={btn} disabled={closeReason.trim().length < 3 || fin.busy === `bc:${b.id}`} onClick={async () => { if (!window.confirm('Cancel this unpaid bank request? Do not cancel if money was already transferred; ask the Owner to verify instead.')) return; const r = await fin.run(`bc:${b.id}`, act('BANK_CANCEL'), { id: b.id, reason: closeReason.trim() }, true); report(r, 'Unpaid bank request cancelled.'); if (r.ok) setCloseReason(''); }} testId={`button-bank-cancel-${b.id}`}>Cancel request</Button>
      {owner && <Button variant="danger" className={btn} disabled={closeReason.trim().length < 3 || fin.busy === `bj:${b.id}`} onClick={async () => { if (!window.confirm('Reject this uncredited bank request?')) return; const r = await fin.run(`bj:${b.id}`, act('BANK_REJECT'), { id: b.id, reason: closeReason.trim() }, true); report(r, 'Uncredited bank request rejected.'); if (r.ok) setCloseReason(''); }} testId={`button-bank-reject-${b.id}`}>Reject</Button>}
    </div>}
    <p className={`mt-2 text-[11px] ${muted}`}>Online refunds and provider reversal are unavailable for company-bank remittances; independently verified manual refund reconciliation needs a separate supported process. Partial refunds keep access while verified net paid stays above zero; a full refund or reversal removes access.</p>
  </div>;
}
