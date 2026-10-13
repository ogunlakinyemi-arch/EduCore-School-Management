import { useState } from 'react';
import { useAuth } from '@clerk/react';
import type { FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Landmark, FlaskConical } from 'lucide-react';
import {
  useGetFlutterwaveSplitDashboard, getGetFlutterwaveSplitDashboardQueryKey,
  useGetFlutterwaveTransactionSplitEvidence,
  getGetFlutterwaveTransactionSplitEvidenceQueryKey,
  useSubmitFlutterwaveSplitRecipient,
  useReviewFlutterwaveSplitRecipient,
  useConfigureFlutterwaveSchoolSplits,
  useReconcileFlutterwaveSplitPayment,
  useRequestFlutterwaveSplitRefund,
  useVerifyFlutterwaveSplitRefund,
} from '@workspace/api-client-react';
import type {
  FlutterwaveRecipient, FlutterwaveSplitPayment, FlutterwaveSplitDashboard, FlutterwaveSplitScope,
} from '@workspace/api-client-react';
import { PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, useTenant, money } from '@/components/shared';

const entry = 'w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm';
const note = 'text-xs leading-5 text-[hsl(var(--muted-foreground))]';
const naira = (minor?: number | null) => (minor == null ? 'Not reported' : money(minor / 100));
const label = (s: string) => s.replaceAll('_', ' ').toLowerCase();

function errText(e: unknown) {
  const x = e as { data?: { error?: string; message?: string }; message?: string } | null;
  return x?.data?.error ?? x?.data?.message ?? x?.message ?? 'The request failed. Nothing was assumed to have succeeded.';
}
function isUnavailable(e: unknown) {
  return (e as { status?: number } | null)?.status === 404;
}

function Banner({ tone, children }: { tone: 'ok' | 'error' | 'warn'; children: React.ReactNode }) {
  const cls = tone === 'error' ? 'border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--destructive)/.08)] text-[hsl(var(--destructive))]'
    : tone === 'ok' ? 'border-[hsl(157_37%_43%/.3)] bg-[hsl(157_37%_43%/.08)]' : 'border-[hsl(35_83%_53%/.4)] bg-[hsl(35_83%_53%/.1)]';
  return <div role={tone === 'error' ? 'alert' : 'status'} className={`mb-4 rounded-xl border px-4 py-3 text-sm font-semibold ${cls}`}>{children}</div>;
}

function BankForm({ scopes, onDone }: { scopes: FlutterwaveSplitScope[]; onDone: (m: { tone: 'ok' | 'error'; text: string }) => void }) {
  const submit = useSubmitFlutterwaveSplitRecipient();
  const qc = useQueryClient();
  const [idx, setIdx] = useState(0);
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [businessEmail, setBusinessEmail] = useState('');
  const [attest, setAttest] = useState(false);
  const scope = scopes[idx];
  const valid = !!scope && /^\d{3,6}$/.test(bankCode.trim()) && /^\d{10}$/.test(accountNumber) && /^\+?\d{10,15}$/.test(contactPhone.trim()) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(businessEmail.trim()) && attest;
  const go = (e: FormEvent) => {
    e.preventDefault();
    if (!valid || !scope) return;
    submit.mutate({ data: { kind: scope.kind, entityId: scope.id, bankCode: bankCode.trim(), accountNumber, contactPhone: contactPhone.trim(), businessEmail: businessEmail.trim(), ownershipAttestation: attest } }, {
      onSuccess: () => {
        setAccountNumber(''); setBusinessEmail(''); setAttest(false);
        onDone({ tone: 'ok', text: 'Submitted for Platform Owner review. No TEST recipient exists yet and nothing has been paid.' });
        void qc.invalidateQueries({ predicate: q => /flutterwave|subscription/i.test(String(q.queryKey[0])) });
      },
      onError: e2 => onDone({ tone: 'error', text: errText(e2) }),
    });
  };
  return (
    <form onSubmit={go} className="panel mb-6 space-y-3 p-5" data-testid="form-flutterwave-recipient">
      <h2 className="display-font text-lg font-bold">Settlement account for TEST review</h2>
      <p className={note}>Only your own account can be submitted. A bank-name resolve is not proof of ownership; the Owner reviews it before any TEST recipient is created.</p>
      <label className="block text-xs font-bold">Account for
        <select className={`${entry} mt-1`} value={idx} onChange={e => setIdx(Number(e.target.value))} data-testid="select-recipient-scope">
          {scopes.map((s, i) => <option key={`${s.kind}-${s.id}`} value={i}>{s.name} ({s.kind.toLowerCase()})</option>)}
        </select>
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-xs font-bold">Bank code<input className={`${entry} mt-1`} inputMode="numeric" value={bankCode} onChange={e => setBankCode(e.target.value)} data-testid="input-bank-code" /></label>
        <label className="block text-xs font-bold">Account number (10 digits)<input className={`${entry} mt-1`} inputMode="numeric" maxLength={10} autoComplete="off" value={accountNumber} onChange={e => setAccountNumber(e.target.value.replace(/\D/g, ''))} data-testid="input-account-number" /></label>
        <label className="block text-xs font-bold">Contact phone<input className={`${entry} mt-1`} inputMode="tel" value={contactPhone} onChange={e => setContactPhone(e.target.value)} data-testid="input-contact-phone" /></label>
        <label className="block text-xs font-bold">Business email<input className={`${entry} mt-1`} type="email" required maxLength={254} value={businessEmail} onChange={e => setBusinessEmail(e.target.value)} data-testid="input-business-email" /></label>
      </div>
      <label className="flex items-start gap-2 text-xs"><input className="mt-0.5 h-4 w-4 shrink-0 p-0" type="checkbox" checked={attest} onChange={e => setAttest(e.target.checked)} data-testid="check-ownership-attestation" />I attest this settlement account belongs to the entity named above and is not a personal or platform account.</label>
      <Button type="submit" disabled={!valid || submit.isPending} testId="button-submit-recipient">{submit.isPending ? 'Submitting...' : 'Submit for review'}</Button>
    </form>
  );
}

function RecipientRow({ r, isOwner, onMsg }: { r: FlutterwaveRecipient; isOwner: boolean; onMsg: (m: { tone: 'ok' | 'error'; text: string }) => void }) {
  const review = useReviewFlutterwaveSplitRecipient();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [own, setOwn] = useState(false);
  const [distinct, setDistinct] = useState(false);
  const run = (action: 'APPROVE_AND_CREATE_TEST' | 'VERIFY_EXISTING_TEST' | 'RECOVER' | 'SUSPEND' | 'RETIRE') => {
    review.mutate({ recipientId: r.id, data: {
      action, note: noteText.trim(),
      ...(['APPROVE_AND_CREATE_TEST','VERIFY_EXISTING_TEST'].includes(action) ? { ownershipConfirmed: own, distinctFromPlatformAccountConfirmed: distinct } : {}),
      ...(action === 'VERIFY_EXISTING_TEST' ? { existingTestReference: 'RS_5F0DB5C736A2550E783A15B9EB9FBF09' as const } : {}),
    } }, {
      onSuccess: () => { onMsg({ tone: 'ok', text: `${label(action)} recorded. Check status below; ready means a TEST provider read-back only.` }); setOpen(false); setNoteText(''); void qc.invalidateQueries({ predicate: q => /flutterwave|subscription/i.test(String(q.queryKey[0])) }); },
      onError: e => onMsg({ tone: 'error', text: `${errText(e)} Do not retry creation blindly; use Recover to read the provider state.` }),
    });
  };
  const needsNote = noteText.trim().length < 10;
  const unknown = /UNKNOWN|ERROR|FAIL/i.test(r.status);
  return (
    <div className="border-b border-[hsl(var(--border)/.6)] px-5 py-4 last:border-0" data-testid={`recipient-${r.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><div className="text-sm font-bold">{r.entityName} <span className="text-xs font-normal text-[hsl(var(--muted-foreground))]">{r.kind.toLowerCase()}</span></div>
          <div className="text-xs text-[hsl(var(--muted-foreground))]">{r.bankName} · {r.maskedAccount} · {r.accountName}</div>
          <div className="text-xs text-[hsl(var(--muted-foreground))]">Business contact: {r.maskedBusinessEmail ?? 'Not supplied — submit a reviewed contact before creation'}</div></div>
        <StatusPill value={r.status} />
      </div>
      <p className={`mt-2 ${note}`}>
        {/READY|ACTIVE/i.test(r.status) ? 'TEST provider read-back succeeded. This is not evidence of any real bank deposit.'
          : /PENDING|SUBMITTED/i.test(r.status) ? 'Awaiting Owner review. Checkout will not split to this account yet.'
          : /SUSPEND/i.test(r.status) ? 'Suspended: no new checkout will use it. Already issued provider checkouts are not changed.'
          : /RETIRE/i.test(r.status) ? 'Retired: history is preserved.' : unknown ? 'Provider outcome is not confirmed. Use Recover (read-only) rather than creating again.' : `Status: ${label(r.status)}.`}
        {r.providerSubaccountId ? ` TEST subaccount ${r.providerSubaccountId}.` : ' No provider subaccount linked.'}
      </p>
      {r.reviewNote && <p className={note}>Review note: {r.reviewNote}</p>}
      {r.lastError && <p className="mt-1 text-xs text-[hsl(var(--destructive))]">Last error: {r.lastError}</p>}
      {isOwner && (
        <div className="mt-3">
          <Button variant="outline" onClick={() => setOpen(o => !o)} testId={`button-review-${r.id}`}>{open ? 'Close review' : 'Review'}</Button>
          {open && (
            <div className="mt-3 space-y-2 rounded-xl bg-[hsl(var(--muted)/.25)] p-4">
              <label className="block text-xs font-bold">Review note (required)<textarea className={`${entry} mt-1`} rows={2} value={noteText} onChange={e => setNoteText(e.target.value)} data-testid={`input-review-note-${r.id}`} /></label>
              <label className="flex items-start gap-2 text-xs"><input className="mt-0.5 h-4 w-4 shrink-0 p-0" type="checkbox" checked={own} onChange={e => setOwn(e.target.checked)} />I confirm this is the entity's own settlement account.</label>
              <label className="flex items-start gap-2 text-xs"><input className="mt-0.5 h-4 w-4 shrink-0 p-0" type="checkbox" checked={distinct} onChange={e => setDistinct(e.target.checked)} />I confirm it is distinct from the platform account.</label>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={review.isPending || needsNote || !own || !distinct || r.status !== 'BANK_RESOLVED'} onClick={() => run('VERIFY_EXISTING_TEST')} testId={`button-existing-test-${r.id}`}>Investigate existing TEST recipient (provider GETs)</Button>
                <Button disabled={review.isPending || needsNote || !own || !distinct} onClick={() => run('APPROVE_AND_CREATE_TEST')} testId={`button-approve-${r.id}`}>Approve and create TEST recipient</Button>
                <Button variant="outline" disabled={review.isPending || needsNote} onClick={() => run('RECOVER')} testId={`button-recover-${r.id}`}>Recover (read-only)</Button>
                <Button variant="outline" disabled={review.isPending || needsNote} onClick={() => run('SUSPEND')} testId={`button-suspend-${r.id}`}>Suspend</Button>
                <Button variant="danger" disabled={review.isPending || needsNote} onClick={() => run('RETIRE')} testId={`button-retire-${r.id}`}>Retire</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SchoolToggle({ schoolId, name, enabled, confirmed, onMsg }: { schoolId: number; name: string; enabled: boolean; confirmed: boolean; onMsg: (m: { tone: 'ok' | 'error'; text: string }) => void }) {
  const cfg = useConfigureFlutterwaveSchoolSplits();
  const qc = useQueryClient();
  const [attest, setAttest] = useState(confirmed);
  const save = (next: boolean) => cfg.mutate({ schoolId, data: { enabled: next, testSplitVerificationAuthorized: next ? attest : false } }, {
    onSuccess: () => { onMsg({ tone: 'ok', text: `Future splits ${next ? 'enabled' : 'disabled'} for ${name}. Issued checkouts and paid receipts are unchanged.` }); void qc.invalidateQueries({ predicate: q => /flutterwave|subscription/i.test(String(q.queryKey[0])) }); },
    onError: e => onMsg({ tone: 'error', text: errText(e) }),
  });
  return (
    <div className="border-b border-[hsl(var(--border)/.6)] px-5 py-4 last:border-0" data-testid={`school-split-${schoolId}`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-bold">{name}</span><StatusPill value={enabled ? 'enabled' : 'disabled'} /></div>
      <label className="mt-2 flex items-start gap-2 text-xs"><input className="mt-0.5 h-4 w-4 shrink-0 p-0" type="checkbox" checked={attest} onChange={e => setAttest(e.target.checked)} data-testid={`check-test-verification-${schoolId}`} />I authorize Development TEST split verification with reviewed recipients and merchant-borne fees. The payer must be charged exactly ₦5,000. This does not confirm automatic settlement or any bank deposit.</label>
      <div className="mt-2 flex gap-2">
        <Button disabled={cfg.isPending || !attest || enabled} onClick={() => save(true)} testId={`button-enable-splits-${schoolId}`}>Enable for future checkouts</Button>
        <Button variant="outline" disabled={cfg.isPending || !enabled} onClick={() => save(false)} testId={`button-disable-splits-${schoolId}`}>Disable</Button>
      </div>
    </div>
  );
}

function refundKey(paymentId: number) {
  const k = `edupulse:split-refund-key:${paymentId}`;
  let v = window.sessionStorage.getItem(k);
  if (!v) { v = `split-refund-${paymentId}-${crypto.randomUUID()}`; window.sessionStorage.setItem(k, v); }
  return { k, v };
}

function PaymentCard({ p, d, canReconcile, onMsg }: { p: FlutterwaveSplitPayment; d: FlutterwaveSplitDashboard; canReconcile: boolean; onMsg: (m: { tone: 'ok' | 'error'; text: string }) => void }) {
  const { userId } = useAuth();
  const evidence = useGetFlutterwaveTransactionSplitEvidence(p.paymentId, { query: {
    queryKey: [...getGetFlutterwaveTransactionSplitEvidenceQueryKey(p.paymentId),userId],
    enabled: false, retry: false,
  } });
  const qc = useQueryClient();
  const reconcile = useReconcileFlutterwaveSplitPayment();
  const refund = useRequestFlutterwaveSplitRefund();
  const verify = useVerifyFlutterwaveSplitRefund();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const refresh = () => void qc.invalidateQueries({ predicate: q => /flutterwave|subscription/i.test(String(q.queryKey[0])) });
  const amountMinor = Math.round(Number(amount) * 100);
  const amountOk = Number.isInteger(amountMinor) && amountMinor >= 10000 && amountMinor <= 500000;
  const pendingAdj = p.adjustments.some(a => /PENDING|UNKNOWN/i.test(a.status));
  const sendRefund = () => {
    const { k, v } = refundKey(p.paymentId);
    refund.mutate({ paymentId: p.paymentId, data: { amountMinor, reason: reason.trim(), idempotencyKey: v } }, {
      onSuccess: res => {
        const st = String((res as { status?: string } | undefined)?.status ?? '');
        if (!/UNKNOWN|PENDING/i.test(st)) window.sessionStorage.removeItem(k);
        onMsg({ tone: 'ok', text: 'Refund initiation recorded (TEST). Customer disbursement is separate; verify it before treating it as complete.' }); setOpen(false); refresh();
      },
      onError: e => onMsg({ tone: 'error', text: `${errText(e)} The idempotency key is kept so a deliberate retry cannot duplicate the refund.` }),
    });
  };
  const lines: [string, number | null | undefined][] = [
    ['School', p.schoolAmountMinor], ['Partner', p.partnerAmountMinor], ['Platform gross', p.platformAmountMinor],
  ];
  return (
    <div className="panel p-5" data-testid={`split-payment-${p.paymentId}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-bold">Payment #{p.paymentId} <span className="font-mono text-xs font-normal">{p.reference}</span></div>
        <div className="flex gap-2"><StatusPill value={p.status} /><StatusPill value={p.collectionStatus} /></div>
      </div>
      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-4">
        <div><span className={note}>Gross collected</span><div className="font-bold">{naira(p.grossAmountMinor)}</div></div>
        {lines.map(([l, v]) => <div key={l}><span className={note}>{l} (server-computed)</span><div className="font-bold">{naira(v)}</div></div>)}
      </div>
      <div className="mt-2 grid gap-2 text-xs sm:grid-cols-3">
        <div><span className={note}>Provider fee</span><div>{naira(p.providerFeeMinor)}</div></div>
        <div><span className={note}>Other reported provider fees</span><div>{naira(p.providerAdditionalFeeMinor)}</div></div>
        <div><span className={note}>Net platform allocation after costs/reversals</span><div>{naira(p.platformNetMinor)}</div></div>
      </div>
      <p className={`mt-1 ${note}`}>Net allocation is not a verified merchant cash balance; recipient refund recovery may still be outstanding.</p>
      <div className="mt-3 rounded-lg border border-[hsl(var(--border))] p-3 text-xs" data-testid={`transaction-evidence-${p.paymentId}`}>
        <strong>Provider transaction split verification: {evidence.isError || evidence.isFetching ? 'UNCONFIRMED' : evidence.data?.status ?? 'UNCONFIRMED — not checked'}</strong>
        <p>{evidence.isFetching ? 'Reading provider evidence; a previous result is not current confirmation.' : evidence.isError ? 'Provider read-back unavailable; any previous reading is not current confirmation.' : evidence.data?.reason ?? 'Server-computed shares and a paid collection are not proof of provider split allocation.'}</p>
        {evidence.data && !evidence.isError && <>
          <p>Transaction {evidence.data.transactionId} · checked {evidence.data.checkedAt}</p>
          <p>Provider fees: {naira(evidence.data.appFeeMinor)} + {naira(evidence.data.additionalFeeMinor)}. Expected platform gross: {naira(evidence.data.platformGrossMinor)}; computed net after reported costs: {naira(evidence.data.platformNetMinor)}.</p>
          {evidence.data.recipients.map(r => <p key={r.subaccountId}>{r.subaccountId}: expected {naira(r.amountMinor)}, provider-observed {r.observedAmountMinor == null ? 'unavailable' : naira(r.observedAmountMinor)}</p>)}
        </>}
        <p>No real bank settlement is verified. This button performs provider reads only; it does not initiate payments or update payment history.</p>
        {canReconcile && <Button variant="outline" disabled={evidence.isFetching || p.collectionStatus !== 'PAID'} onClick={() => void evidence.refetch()} testId={`button-transaction-evidence-${p.paymentId}`}>Read TEST transaction evidence (provider GETs)</Button>}
      </div>
      {p.reconciliationNote && <p className={`mt-2 ${note}`}>{p.reconciliationNote}</p>}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-left text-xs"><thead className="text-[hsl(var(--muted-foreground))]"><tr><th className="py-1 pr-3">Recipient</th><th className="pr-3">Expected</th><th className="pr-3">Observed</th><th className="pr-3">Status</th><th>Exception</th></tr></thead>
          <tbody>{p.recipients.length ? p.recipients.map(r => {
            const rec = d.recipients.find(x => x.id === r.recipientId);
            return <tr key={r.recipientId} className="border-t border-[hsl(var(--border)/.5)]">
              <td className="py-1.5 pr-3">{rec?.entityName ?? `Recipient #${r.recipientId}`}</td><td className="pr-3">{naira(r.expectedAmountMinor)}</td>
              <td className="pr-3">{r.observedAmountMinor == null ? 'Not yet observed' : naira(r.observedAmountMinor)}</td><td className="pr-3">{label(r.status)}</td>
              <td className={r.exception ? 'text-[hsl(var(--destructive))]' : ''}>{r.exception ?? 'None'}</td></tr>;
          }) : <tr><td colSpan={5} className="py-2">No recipient settlement lines reported by the provider yet.</td></tr>}</tbody></table>
      </div>
      {p.adjustments.length > 0 && (
        <div className="mt-3 space-y-2">{p.adjustments.map(a => (
          <div key={a.id} className="rounded-lg bg-[hsl(var(--muted)/.25)] p-3 text-xs" data-testid={`adjustment-${a.id}`}>
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-bold">Refund #{a.id} · {naira(a.amountMinor)}</span><StatusPill value={a.status} /></div>
            <div className={note}>Recipient recovery: {label(a.recoveryStatus)} (a review, not an automatic bank clawback). School {naira(a.schoolRecoveryMinor)} · Partner {naira(a.partnerRecoveryMinor)} · Platform reversal {naira(a.platformReversalMinor)}{a.providerRefundId ? ` · ${a.providerRefundId}` : ''}</div>
            {d.isOwner && <Button variant="outline" className="mt-2" disabled={verify.isPending} onClick={() => verify.mutate({ adjustmentId: a.id }, { onSuccess: () => { onMsg({ tone: 'ok', text: 'Refund verified read-only against the provider.' }); refresh(); }, onError: e => onMsg({ tone: 'error', text: errText(e) }) })} testId={`button-verify-refund-${a.id}`}>Verify refund (read-only)</Button>}
          </div>))}</div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {canReconcile && <Button variant="outline" disabled={reconcile.isPending} onClick={() => reconcile.mutate({ paymentId: p.paymentId }, { onSuccess: () => { onMsg({ tone: 'ok', text: 'Provider read-back refreshed. Observed amounts reflect the TEST provider only.' }); refresh(); }, onError: e => onMsg({ tone: 'error', text: errText(e) }) })} testId={`button-reconcile-${p.paymentId}`}>{reconcile.isPending ? 'Reading provider...' : 'Reconcile'}</Button>}
        {d.isOwner && p.status === 'PAID' && <Button variant="outline" onClick={() => setOpen(o => !o)} testId={`button-refund-open-${p.paymentId}`}>Refund (TEST)</Button>}
      </div>
      {open && d.isOwner && (
        <div className="mt-3 space-y-2 rounded-xl bg-[hsl(var(--muted)/.25)] p-4">
          <label className="block text-xs font-bold">Amount in NGN (100 to 5,000)<input className={`${entry} mt-1`} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} data-testid={`input-refund-amount-${p.paymentId}`} /></label>
          <label className="block text-xs font-bold">Reason<textarea className={`${entry} mt-1`} rows={2} value={reason} onChange={e => setReason(e.target.value)} data-testid={`input-refund-reason-${p.paymentId}`} /></label>
          {pendingAdj && <p className="text-xs text-[hsl(var(--destructive))]">A refund is pending or unknown. Verify it first; it is never re-sent automatically.</p>}
          <Button disabled={refund.isPending || !amountOk || reason.trim().length < 10 || pendingAdj} onClick={sendRefund} testId={`button-refund-submit-${p.paymentId}`}>{refund.isPending ? 'Submitting...' : 'Request refund'}</Button>
        </div>
      )}
    </div>
  );
}

export function FlutterwaveSettlementsPage() {
  const { userId,isLoaded } = useAuth();
  const { schoolId } = useTenant();
  const params = schoolId ? { schoolId } : undefined;
  const q = useGetFlutterwaveSplitDashboard(params, { query: {
    queryKey: [...getGetFlutterwaveSplitDashboardQueryKey(params),userId],
    enabled:isLoaded && !!userId,
    refetchOnMount: 'always', refetchInterval: 30_000, retry: false,
  } });
  const [msg, setMsg] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const d = q.data;
  const heading = <PageHeading eyebrow="Financials / Flutterwave splits" title="Split settlements." description="Development TEST mode only. Provider read-back is not a bank deposit." />;
  if (q.isLoading) return <div className="fade-up">{heading}<SkeletonPage /></div>;
  if (q.isError && isUnavailable(q.error)) return <div className="fade-up">{heading}<EmptyState icon={FlaskConical} title="Not available in this environment" description="Split settlements exist only in the Development environment. Nothing here is active, and no school or partner receives split payouts from this deployment." /></div>;
  if (q.isError || !d) return <div className="fade-up">{heading}<ErrorState retry={() => void q.refetch()} message={errText(q.error)} /></div>;
  const nonOwnerScopes = d.isOwner ? [] : d.scopes;
  const canReconcile = true;
  return (
    <div className="fade-up">
      {heading}
      <Banner tone="warn">TEST mode, {d.currency}, provider fees borne by the {d.feeBearer.toLowerCase()}. No real transfers are made. Existing paid receipts are never changed. Fees and applicable VAT are platform expenses. Only provider-reported costs appear below; confirm VAT inclusion against provider statements.</Banner>
      {!d.testCredentialConfigured && <Banner tone="error">The TEST credential format is not configured. Recipient creation will fail until it is. This reflects configuration format, not permissions.</Banner>}
      {msg && <Banner tone={msg.tone}>{msg.text}</Banner>}
      <div className="panel mb-6 p-5 text-xs leading-6" data-testid="text-split-rules">
        Rules: payer pays NGN 5,000; school receives NGN 2,000; an eligible partner receives NGN 100; platform gross is NGN 2,900 with a partner, otherwise NGN 3,000. Amounts are computed by the server only.
      </div>
      {nonOwnerScopes.length > 0 && <BankForm scopes={nonOwnerScopes} onDone={setMsg} />}
      {d.isOwner && <Banner tone="warn">The Platform Owner reviews submissions but cannot submit school or partner bank details.</Banner>}
      <h2 className="display-font mb-3 text-lg font-bold">Recipients</h2>
      <div className="panel mb-6 overflow-hidden">
        {d.recipients.length ? d.recipients.map(r => <RecipientRow key={r.id} r={r} isOwner={d.isOwner} onMsg={setMsg} />)
          : <EmptyState icon={Landmark} title="No recipients submitted" description="A missing recipient means checkout cannot split to that account." />}
      </div>
      {d.isOwner && d.schools.length > 0 && (<>
        <h2 className="display-font mb-3 text-lg font-bold">School split switches</h2>
        <p className={`${note} mb-3`}>Controls appear for the selected school or schools that submitted their own recipient details. Split mode stays off until ownership review and TEST provider read-back succeed.</p>
        <div className="panel mb-6 overflow-hidden">{d.schools.filter(s => s.schoolId === schoolId || d.recipients.some(r => r.kind === 'SCHOOL' && r.entityId === s.schoolId)).map(s => <SchoolToggle key={s.schoolId} schoolId={s.schoolId} name={d.scopes.find(x => x.kind === 'SCHOOL' && x.id === s.schoolId)?.name ?? d.recipients.find(r => r.kind === 'SCHOOL' && r.entityId === s.schoolId)?.entityName ?? `School #${s.schoolId}`} enabled={s.enabled} confirmed={s.testSplitVerificationAuthorized} onMsg={setMsg} />)}</div>
      </>)}
      <h2 className="display-font mb-3 text-lg font-bold">Split payments</h2>
      <div className="space-y-4">
        {d.payments.length ? d.payments.map(p => <PaymentCard key={p.paymentId} p={p} d={d} canReconcile={canReconcile && (d.isOwner || !!schoolId)} onMsg={setMsg} />)
          : <EmptyState icon={FlaskConical} title="No split payments yet" description="Payments appear here only after the server creates a split checkout." />}
      </div>
    </div>
  );
}
