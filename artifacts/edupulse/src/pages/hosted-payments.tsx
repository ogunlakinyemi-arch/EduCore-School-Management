import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { CircleAlert, CreditCard, ExternalLink, Landmark, RefreshCw, ShieldCheck } from 'lucide-react';
import {
  PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState,
  TenantPicker, useTenant, money, date, useSchoolAdminAccess,
} from '@/components/shared';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ReceiptDownloadButton, ReceiptFilePicker, uploadPrivateReceipt, validateReceiptFile } from '@/components/private-receipt';
import { HostedSchoolPayout } from '@/components/hosted-school-payout';

// All monetary values from this API are NGN minor units (kobo).
type Policy = { grossMinor: number; schoolMinor: number; broMinor: number; platformWithBroMinor: number; platformWithoutBroMinor: number };
type HostedConfig = { enabled: boolean; mode: 'TEST' | 'LIVE'; ready: boolean; blockers: string[]; policy: Policy; ledgerOnly: boolean;
  schoolPayouts?:{ready:boolean;blockers:string[]} };
type Eligible = { subscriptionId: number; studentId: number; studentName: string; schoolId: number; termId: number; termName: string };
type Order = {
  reference: string; schoolId: number; studentId: number; studentName: string; termName: string;
  environment: 'TEST' | 'LIVE';
  status: 'PENDING' | 'READY' | 'PAID' | 'FAILED' | 'RECONCILIATION_REQUIRED';
  checkoutUrl: string | null; grossMinor: number; feeMinor: number | null; schoolDueMinor: number; broDueMinor: number;
  platformNetMinor: number | null; schoolSettled: boolean; broSettled: boolean; hold: boolean; createdAt: string;
  settlementReceiptId: string | null; settlementDate: string | null; settlementExternalReference: string | null; settlementUploadedBy: number | null;
  schoolName:string;schoolSettlementStatus:string;schoolPayoutClaimed:boolean;schoolPayoutSucceeded:boolean;
  schoolPayoutFeeMinor:number|null;platformNetAfterPayoutMinor:number|null;
};

const B = '/api/hosted-payments';
const get = <T,>(url: string) => customFetch<T>(url, { method: 'GET', responseType: 'json' });
const post = <T,>(url: string, body: unknown) => customFetch<T>(url, {
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' }, responseType: 'json',
});
const ngn = (minor: number | null | undefined) => (minor == null ? 'Not yet known' : money(minor / 100));
const note = 'text-xs leading-5 text-[hsl(var(--muted-foreground))]';
const HEX64 = /^[a-f0-9]{64}$/;

function errorText(error: unknown) {
  const data = (error as { data?: { message?: string; error?: string; code?: string } } | null)?.data;
  return data?.message ?? data?.error ?? data?.code ?? (error instanceof Error ? error.message : 'Request failed.');
}

function safeUrl(url: string | null) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch { return null; }
}

function idempotencyKey(schoolId: number, subscriptionId: number, termId: number) {
  const storageKey = `edupulse:hosted-checkout:${schoolId}:${subscriptionId}:${termId}`;
  const existing = window.sessionStorage.getItem(storageKey);
  if (existing) return existing;
  const key = `hosted-${schoolId}-${subscriptionId}-${termId}-${crypto.randomUUID()}`;
  window.sessionStorage.setItem(storageKey, key);
  return key;
}

function EnvBadge({ env }: { env: 'TEST' | 'LIVE' }) {
  return env === 'TEST'
    ? <span className="rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide" data-testid="badge-test-mode">Test mode · no real money</span>
    : <span className="rounded-md bg-[hsl(var(--primary)/.12)] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[hsl(var(--primary))]">Live</span>;
}

function ConfigPanel({ config, isOwner }: { config: HostedConfig;isOwner:boolean }) {
  const p = config.policy;
  return (
    <section className="panel p-5" data-testid="hosted-config">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="display-font text-lg font-bold">Collection policy</h2>
        <EnvBadge env={config.mode} />
        <StatusPill value={config.enabled && config.ready ? 'READY' : 'BLOCKED'} />
      </div>
      <p className={`mt-1 ${note}`}>Verified collections accrue a pending school entitlement. Only the Platform Owner may confirm a Flutterwave school transfer or record an external manual settlement.</p>
      {isOwner&&config.schoolPayouts&&!config.schoolPayouts.ready&&<div className={`mt-3 ${note}`}><strong>School payouts disabled:</strong><ul className="ml-4 list-disc">{config.schoolPayouts.blockers.map((b,i)=><li key={i}>{b}</li>)}</ul></div>}
      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-5">
        <div><dt className={note}>Gross per term</dt><dd className="font-bold tabular-nums">{ngn(p.grossMinor)}</dd></div>
        <div><dt className={note}>School share</dt><dd className="font-bold tabular-nums">{ngn(p.schoolMinor)}</dd></div>
        {isOwner&&<><div><dt className={note}>BRO share (if eligible)</dt><dd className="font-bold tabular-nums">{ngn(p.broMinor)}</dd></div>
        <div><dt className={note}>Platform, with BRO</dt><dd className="font-bold tabular-nums">{ngn(p.platformWithBroMinor)}</dd></div>
        <div><dt className={note}>Platform, no BRO</dt><dd className="font-bold tabular-nums">{ngn(p.platformWithoutBroMinor)}</dd></div></>}
      </dl>
      <p className={`mt-2 ${note}`}>Platform amounts are before provider fees.</p>
      {(!config.enabled || !config.ready || config.blockers.length > 0) && (
        <div role="alert" className="mt-4 rounded-xl border border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--destructive)/.06)] p-4 text-sm" data-testid="hosted-blockers">
          <div className="flex items-center gap-2 font-bold text-[hsl(var(--destructive))]"><CircleAlert size={16} />Hosted checkout is {config.enabled ? 'not ready' : 'disabled'}</div>
          {config.blockers.length > 0
            ? <ul className="mt-2 list-disc pl-5">{config.blockers.map(b => <li key={b}>{b}</li>)}</ul>
            : <p className="mt-2">The server did not report specific blockers.</p>}
        </div>
      )}
    </section>
  );
}

function SettleDialog({ order, onClose }: { order: Order | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [beneficiary, setBeneficiary] = useState<'SCHOOL' | 'BRO'>('SCHOOL');
  const [externalReference, setExternalReference] = useState('');
  const [proofSha256, setProof] = useState('');
  const [ownershipConfirmed, setOwnership] = useState(false);
  const [transferCompleted, setTransferCompleted] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [amountNaira, setAmountNaira] = useState('');
  const [settlementDate, setSettlementDate] = useState('');
  const [uploaded, setUploaded] = useState<{ id: string; sha256: string; key: string } | null>(null);
  const today = new Date().toISOString().slice(0, 10);
  const settle = useMutation({
    mutationFn: async (o: Order) => {
      const path = `${B}/orders/${encodeURIComponent(o.reference)}/settle`;
      if (beneficiary === 'BRO') {
        return post<Order>(path, { beneficiary, externalReference: externalReference.trim(), proofSha256: proofSha256.trim().toLowerCase(), ownershipConfirmed: true });
      }
      // Upload once per (file, order, date) so a failed settle call can be retried without re-uploading.
      const key = file ? `${o.reference}|${file.name}|${file.size}|${file.lastModified}|${settlementDate}` : '';
      let receipt = uploaded && uploaded.key === key ? uploaded : null;
      if (!receipt) {
        const r = await uploadPrivateReceipt({
          kind: 'SCHOOL_SETTLEMENT', orderReference: o.reference, amountMinor: o.schoolDueMinor,
          purpose: `School settlement for hosted order ${o.reference}`, transferDate: settlementDate, transferCompleted: true,
        }, file as File);
        receipt = { id: r.id, sha256: r.sha256, key };
        setUploaded(receipt);
      }
      return post<Order>(path, {
        beneficiary: 'SCHOOL', externalReference: externalReference.trim(), proofReceiptId: receipt.id, settlementDate, ownershipConfirmed: true,
      });
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['hosted-payments', 'orders'] }); onClose(); },
  });
  useEffect(() => {
    if (!order) return;
    setBeneficiary(!order.schoolSettled&&!order.schoolPayoutClaimed ? 'SCHOOL' : 'BRO');
    setExternalReference(''); setProof(''); setOwnership(false); setTransferCompleted(false); setFile(null); setAmountNaira(''); setSettlementDate(''); setUploaded(null); settle.reset();
  }, [order?.reference]); // eslint-disable-line react-hooks/exhaustive-deps

  const proofValid = HEX64.test(proofSha256.trim().toLowerCase());
  const alreadySettled = order ? (beneficiary === 'SCHOOL' ? order.schoolSettled : order.broSettled) : true;
  const amountExact = !!order && Math.round(Number(amountNaira) * 100) === order.schoolDueMinor && amountNaira.trim() !== '';
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(settlementDate) && settlementDate <= today;
  const schoolReady = transferCompleted && !validateReceiptFile(file) && amountExact && dateValid;
  const evidenceOk = beneficiary === 'BRO' ? proofValid : schoolReady;
  const canSubmit = !!order && order.status === 'PAID' && externalReference.trim().length >= 4 && evidenceOk && ownershipConfirmed && !alreadySettled && !settle.isPending;

  return (
    <Dialog open={!!order} onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Confirm external settlement</DialogTitle>
          <DialogDescription>
            This records a transfer you already completed outside EduCore. It does not send money.
          </DialogDescription>
        </DialogHeader>
        {order && (
          <form className="space-y-4 text-sm" onSubmit={e => { e.preventDefault(); if (canSubmit) settle.mutate(order); }}>
            <div className="rounded-lg bg-[hsl(var(--muted)/.3)] p-3 text-xs">
              <span className="font-mono">{order.reference}</span> · {order.studentName} · {order.termName} <EnvBadge env={order.environment} />
            </div>
            <fieldset>
              <legend className="mb-1 font-semibold">Beneficiary</legend>
              <div className="flex gap-2">
                {(['SCHOOL', 'BRO'] as const).map(b => {
                  const due = b === 'SCHOOL' ? order.schoolDueMinor : order.broDueMinor;
                  const done = b === 'SCHOOL' ? order.schoolSettled : order.broSettled;
                  return (
                    <label key={b} className={`flex-1 cursor-pointer rounded-lg border p-3 ${beneficiary === b ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/.06)]' : 'border-[hsl(var(--border))]'} ${due <= 0 || done ? 'opacity-50' : ''}`}>
                      <input type="radio" className="sr-only" name="beneficiary" value={b} checked={beneficiary === b} disabled={due <= 0 || done} onChange={() => setBeneficiary(b)} />
                      <div className="font-bold">{b === 'SCHOOL' ? 'School' : 'BRO'}</div>
                      <div className="tabular-nums">{ngn(due)}</div>
                      <div className={note}>{done ? 'Already settled' : due <= 0 ? 'Nothing owed' : 'Owed'}</div>
                    </label>
                  );
                })}
              </div>
              {beneficiary === 'BRO' && <p className={`mt-2 ${note}`}>BRO shares cannot be settled before the term ends. The server rejects early confirmations.</p>}
            </fieldset>
            <label className="block">
              <span className="font-semibold">External transfer reference</span>
              <input className="mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 font-mono" value={externalReference} onChange={e => setExternalReference(e.target.value)} placeholder="Bank or provider transfer reference" data-testid="input-external-reference" />
            </label>
            {beneficiary === 'SCHOOL' && (
              <div className="space-y-3 rounded-lg border border-[hsl(var(--border))] p-3">
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1" checked={transferCompleted} disabled={order.status !== 'PAID'} onChange={e => setTransferCompleted(e.target.checked)} data-testid="checkbox-transfer-completed" />
                  <span>The transfer to the school has already been completed outside EduCore.</span>
                </label>
                {transferCompleted && order.status === 'PAID' ? <>
                  <label className="block">
                    <span className="font-semibold">Amount transferred (NGN)</span>
                    <input type="number" step="0.01" min="0" className="mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 tabular-nums" value={amountNaira} onChange={e => setAmountNaira(e.target.value)} placeholder={(order.schoolDueMinor / 100).toFixed(2)} data-testid="input-settlement-amount" />
                    {amountNaira && !amountExact && <span className="mt-1 block text-xs text-[hsl(var(--destructive))]">Must equal the school amount owed exactly: {ngn(order.schoolDueMinor)}.</span>}
                  </label>
                  <label className="block">
                    <span className="font-semibold">Settlement date</span>
                    <input type="date" max={today} className="mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2" value={settlementDate} onChange={e => setSettlementDate(e.target.value)} data-testid="input-settlement-date" />
                    {settlementDate && !dateValid && <span className="mt-1 block text-xs text-[hsl(var(--destructive))]">Use the actual transfer date. Future dates are not accepted.</span>}
                  </label>
                  <ReceiptFilePicker file={file} onChange={f => { setFile(f); setUploaded(null); }} label="Transfer receipt" testId="input-settlement-receipt" />
                  {uploaded && <p className={note}>Uploaded. Server SHA-256: <span className="break-all font-mono">{uploaded.sha256}</span></p>}
                </> : <p className={note}>Confirm the transfer is complete before attaching its receipt.</p>}
              </div>
            )}
            {beneficiary === 'BRO' && (<>
            <label className="block">
              <span className="font-semibold">Evidence SHA-256</span>
              <input className="mt-1 w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 font-mono text-xs" value={proofSha256} onChange={e => setProof(e.target.value)} placeholder="64 hexadecimal characters" data-testid="input-proof-sha256" />
              {proofSha256 && !proofValid && <span className="mt-1 block text-xs text-[hsl(var(--destructive))]">Must be exactly 64 hexadecimal characters.</span>}
            </label>
            </>)}
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={ownershipConfirmed} onChange={e => setOwnership(e.target.checked)} data-testid="checkbox-ownership" />
              <span>I confirm this transfer was completed to the verified {beneficiary === 'SCHOOL' ? 'school' : 'BRO'} account and the evidence hash belongs to that transfer.</span>
            </label>
            {order.status !== 'PAID' && <p role="alert" className="text-xs text-[hsl(var(--destructive))]">Only server-confirmed PAID orders can be settled.</p>}
            {settle.isError && <p role="alert" className="text-xs text-[hsl(var(--destructive))]">{errorText(settle.error)}</p>}
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={!canSubmit} testId="button-confirm-settlement"><ShieldCheck size={14} />{settle.isPending ? 'Uploading and recording...' : 'Record settlement'}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function OrderRow({ order, isOwner, onSettle }: { order: Order; isOwner: boolean; onSettle: (o: Order) => void }) {
  const qc = useQueryClient();
  const reconcile = useMutation({
    mutationFn: () => post<Order>(`${B}/orders/${encodeURIComponent(order.reference)}/reconcile`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hosted-payments', 'orders'] }),
  });
  const url = safeUrl(order.checkoutUrl);
  const openable = !isOwner && url && (order.status === 'PENDING' || order.status === 'READY');
  return (
    <div className="border-b border-[hsl(var(--border)/.6)] px-5 py-4 last:border-0" data-testid={`hosted-order-${order.reference}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-bold">{order.studentName} · {order.schoolName}</div>
          <div className={note}>{order.termName} · <span className="font-mono">{order.reference}</span> · {date(order.createdAt)}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <EnvBadge env={order.environment} />
          <StatusPill value={order.status} />
          {order.hold && <span className="rounded-md bg-[hsl(var(--destructive)/.1)] px-2 py-0.5 text-[11px] font-bold uppercase text-[hsl(var(--destructive))]">On hold</span>}
        </div>
      </div>
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-5">
        <div><dt className={note}>Gross</dt><dd className="font-bold tabular-nums">{ngn(order.grossMinor)}</dd></div>
        {isOwner&&<div><dt className={note}>Provider fee</dt><dd className="font-bold tabular-nums">{ngn(order.feeMinor)}</dd></div>}
        <div><dt className={note}>School entitlement</dt><dd className="font-bold tabular-nums">{ngn(order.schoolDueMinor)}</dd><dd>{order.schoolPayoutSucceeded?'Provider-verified success':order.schoolSettled?'Confirmed external transfer':order.schoolSettlementStatus??'Pending settlement'}</dd></div>
        {isOwner&&<><div><dt className={note}>BRO owed</dt><dd className="font-bold tabular-nums">{ngn(order.broDueMinor)}</dd><dd>{order.broDueMinor <= 0 ? 'No BRO' : order.broSettled ? 'Settled externally' : 'Not settled'}</dd></div>
        <div><dt className={note}>Platform net after reported fees</dt><dd className="font-bold tabular-nums">{ngn(order.schoolPayoutSucceeded?order.platformNetAfterPayoutMinor:order.platformNetMinor)}</dd>{order.schoolPayoutFeeMinor!=null&&<dd>Transfer fee {ngn(order.schoolPayoutFeeMinor)}</dd>}</div></>}
      </dl>
      <div className="mt-3 flex flex-wrap gap-2">
        {isOwner&&(order.schoolPayoutClaimed||(order.status==='PAID'&&!order.schoolSettled))&&
          <HostedSchoolPayout reference={order.reference} claimed={order.schoolPayoutClaimed} successful={order.schoolPayoutSucceeded}/>}
        {openable && <a href={url} rel="noreferrer" className="inline-flex items-center gap-1 rounded-xl bg-[hsl(var(--primary))] px-4 py-2 text-xs font-bold text-[hsl(var(--primary-foreground))]" data-testid={`link-checkout-${order.reference}`}><ExternalLink size={14} />Open hosted checkout</a>}
        {order.status !== 'PAID' && (
          <Button variant="outline" onClick={() => reconcile.mutate()} disabled={reconcile.isPending} testId={`button-reconcile-${order.reference}`}>
            <RefreshCw size={14} />{reconcile.isPending ? 'Reconciling...' : 'Reconcile with server'}
          </Button>
        )}
        {isOwner && order.status === 'PAID' && ((!order.schoolSettled&&!order.schoolPayoutClaimed) || (order.broDueMinor > 0 && !order.broSettled)) && (
          <Button onClick={() => onSettle(order)} testId={`button-settle-${order.reference}`}><Landmark size={14} />Confirm external settlement</Button>
        )}
      </div>
      {isOwner&&order.schoolSettled && (order.settlementReceiptId || order.settlementDate || order.settlementExternalReference) && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-[hsl(var(--muted)/.3)] p-3 text-xs" data-testid={`settlement-proof-${order.reference}`}>
          <span>School settlement {order.settlementDate ? `on ${date(order.settlementDate)}` : ''}{order.settlementExternalReference && <> · Transfer ref <span className="font-mono">{order.settlementExternalReference}</span></>}{order.settlementUploadedBy != null && <> · Uploaded by user {order.settlementUploadedBy}</>}</span>
          {order.settlementReceiptId && <ReceiptDownloadButton id={order.settlementReceiptId} label="Download settlement receipt" />}
        </div>
      )}
      {reconcile.isError && <p role="alert" className="mt-2 text-xs text-[hsl(var(--destructive))]">{errorText(reconcile.error)}</p>}
      {order.status === 'RECONCILIATION_REQUIRED' && <p className={`mt-2 ${note}`}>The provider outcome is not confirmed. It is not treated as paid.</p>}
    </div>
  );
}

export function HostedPaymentsPage() {
  const { schoolId } = useTenant();
  const { isPlatformOwner, isSchoolAdmin } = useSchoolAdminAccess();
  const canCreate = isSchoolAdmin && !isPlatformOwner;
  const qc = useQueryClient();
  const [settling, setSettling] = useState<Order | null>(null);
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const handledRef = useRef<string | null>(null);

  const config = useQuery({ queryKey: ['hosted-payments', 'config'], queryFn: () => get<HostedConfig>(`${B}/config`) });
  const eligible = useQuery({
    queryKey: ['hosted-payments', 'eligible', schoolId],
    queryFn: () => get<{ subscriptions: Eligible[] }>(`${B}/eligible?schoolId=${schoolId}`),
    enabled: canCreate && !!schoolId,
  });
  const ordersKey = ['hosted-payments', 'orders', schoolId ?? 'all'];
  const orders = useQuery({
    queryKey: ordersKey,
    queryFn: () => get<{ orders: Order[] }>(`${B}/orders${schoolId ? `?schoolId=${schoolId}` : ''}`),
    enabled: isPlatformOwner || (canCreate && !!schoolId),
    refetchInterval: q => (q.state.data?.orders.some(o => o.status === 'PENDING' || o.status === 'READY') ? 20_000 : false),
  });

  const checkout = useMutation({
    mutationFn: (s: Eligible) => post<Order>(`${B}/checkout`, {
      subscriptionId: s.subscriptionId, termId: s.termId, idempotencyKey: idempotencyKey(s.schoolId, s.subscriptionId, s.termId),
    }),
    onSuccess: order => {
      void qc.invalidateQueries({ queryKey: ['hosted-payments'] });
      setMessage({ tone: 'ok', text: `Checkout ${order.reference} created with status ${order.status.toLowerCase()}. Payment is not confirmed until the server reconciles it.` });
    },
    onError: e => setMessage({ tone: 'error', text: errorText(e) }),
  });

  // Return from hosted checkout: the redirect itself is never treated as proof of payment.
  useEffect(() => {
    const reference = new URLSearchParams(window.location.search).get('reference');
    if (!reference || handledRef.current === reference) return;
    handledRef.current = reference;
    setMessage({ tone: 'warn', text: `Checking ${reference} with the server. The redirect alone does not confirm payment.` });
    post<Order>(`${B}/orders/${encodeURIComponent(reference)}/reconcile`, {})
      .then(order => {
        setMessage(order.status === 'PAID'
          ? { tone: 'ok', text: `Server reconciliation confirms ${order.reference} as paid.` }
          : { tone: 'warn', text: `Server reports ${order.reference} as ${order.status.replaceAll('_', ' ').toLowerCase()}. It is not marked paid.` });
        void qc.invalidateQueries({ queryKey: ['hosted-payments', 'orders'] });
      })
      .catch(e => setMessage({ tone: 'error', text: `${errorText(e)} Reconciliation can be retried from the order list.` }))
      .finally(() => window.history.replaceState(null, '', window.location.pathname));
  }, [qc]);

  if (config.isLoading) return <SkeletonPage />;
  const cfg = config.data;
  const ready = !!cfg && cfg.enabled && cfg.ready;
  const list = orders.data?.orders ?? [];
  const totals = list.filter(o => o.status === 'PAID').reduce((acc, o) => ({
    school: acc.school + o.schoolDueMinor, schoolDone: acc.schoolDone + (o.schoolSettled ? o.schoolDueMinor : 0),
    bro: acc.bro + o.broDueMinor, broDone: acc.broDone + (o.broSettled ? o.broDueMinor : 0),
  }), { school: 0, schoolDone: 0, bro: 0, broDone: 0 });

  return (
    <div className="space-y-6 p-5 md:p-8">
      <PageHeading
        eyebrow="Finance"
        title="Hosted payments"
        description={isPlatformOwner ? 'Collection ledger, reconciliation and confirmation of externally completed settlements.' : 'Create hosted checkouts for eligible subscriptions in the current term.'}
        action={<TenantPicker />}
      />
      {message && (
        <div role={message.tone === 'error' ? 'alert' : 'status'} className={`rounded-xl border px-4 py-3 text-sm ${message.tone === 'error' ? 'border-[hsl(var(--destructive)/.3)] text-[hsl(var(--destructive))]' : 'border-[hsl(var(--border))] bg-[hsl(var(--secondary))]'}`}>{message.text}</div>
      )}
      {config.isError || !cfg
        ? <ErrorState retry={() => void config.refetch()} message={`Hosted payment configuration could not be loaded: ${errorText(config.error)}`} />
        : <ConfigPanel config={cfg} isOwner={isPlatformOwner}/>}

      {canCreate && (
        <section className="panel overflow-hidden">
          <div className="border-b border-[hsl(var(--border))] px-5 py-4">
            <h2 className="display-font text-lg font-bold">Eligible subscriptions</h2>
            <p className={note}>Existing subscriptions for the current term, as listed by the server.</p>
          </div>
          {!schoolId ? <div className="p-5"><EmptyState icon={CreditCard} title="Select a school" description="Choose your school to list eligible subscriptions." /></div>
            : eligible.isLoading ? <div className="p-5"><SkeletonPage /></div>
            : eligible.isError ? <div className="p-5"><ErrorState retry={() => void eligible.refetch()} message={errorText(eligible.error)} /></div>
            : (eligible.data?.subscriptions.length ?? 0) === 0 ? <div className="p-5"><EmptyState icon={CreditCard} title="Nothing eligible" description="No existing subscription in the current term is eligible for hosted checkout." /></div>
            : eligible.data!.subscriptions.map(s => (
              <div key={`${s.subscriptionId}-${s.termId}`} className="flex flex-wrap items-center justify-between gap-3 border-b border-[hsl(var(--border)/.6)] px-5 py-3 last:border-0">
                <div>
                  <div className="font-bold">{s.studentName}</div>
                  <div className={note}>{s.termName} · Student ID {s.studentId} · Subscription {s.subscriptionId}</div>
                </div>
                <Button onClick={() => checkout.mutate(s)} disabled={!ready || checkout.isPending} title={!ready ? 'Hosted checkout is blocked by configuration' : undefined} testId={`button-create-checkout-${s.subscriptionId}`}>
                  <CreditCard size={14} />{checkout.isPending && checkout.variables?.subscriptionId === s.subscriptionId ? 'Creating...' : 'Create hosted checkout'}
                </Button>
              </div>
            ))}
        </section>
      )}

      {isPlatformOwner && list.length > 0 && (
        <section className="panel grid gap-4 p-5 text-sm sm:grid-cols-4" data-testid="settlement-totals">
          <div><div className={note}>School owed (paid orders)</div><div className="font-bold tabular-nums">{ngn(totals.school)}</div></div>
          <div><div className={note}>School settled externally</div><div className="font-bold tabular-nums">{ngn(totals.schoolDone)}</div></div>
          <div><div className={note}>BRO owed (paid orders)</div><div className="font-bold tabular-nums">{ngn(totals.bro)}</div></div>
          <div><div className={note}>BRO settled externally</div><div className="font-bold tabular-nums">{ngn(totals.broDone)}</div></div>
        </section>
      )}

      <section className="panel overflow-hidden">
        <div className="border-b border-[hsl(var(--border))] px-5 py-4">
          <h2 className="display-font text-lg font-bold">{isPlatformOwner ? 'Collection ledger' : 'Hosted checkout orders'}</h2>
          <p className={note}>Status shown is the server record. Use reconcile to refresh an unconfirmed order.</p>
        </div>
        {orders.isLoading ? <div className="p-5"><SkeletonPage /></div>
          : orders.isError ? <div className="p-5"><ErrorState retry={() => void orders.refetch()} message={errorText(orders.error)} /></div>
          : list.length === 0 ? <div className="p-5"><EmptyState icon={Landmark} title="No hosted orders" description="Hosted checkout orders appear here once created." /></div>
          : list.map(o => <OrderRow key={o.reference} order={o} isOwner={isPlatformOwner} onSettle={setSettling} />)}
      </section>

      {isPlatformOwner && <SettleDialog order={settling} onClose={() => setSettling(null)} />}
    </div>
  );
}
