import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CircleDollarSign, CreditCard, Download, ReceiptText, RefreshCw, ShieldCheck, Handshake, Layers3 } from 'lucide-react';
import {
  useGetAuthorizedContext, useGetMyEmployeeNfcProfile, getGetMyEmployeeNfcProfileQueryKey,
  useGetMyStaffNfcSubscriptions, getGetMyStaffNfcSubscriptionsQueryKey,
  useGenerateStaffNfcTermSubscriptions, useCreateStaffNfcCheckout, useVerifyMyStaffNfcPayment,
  useGetStaffNfcReceipt, useListStaffNfcBillingRules, getListStaffNfcBillingRulesQueryKey, useCreateStaffNfcBillingRule,
  useListStaffNfcFinance, getListStaffNfcFinanceQueryKey, useRequestStaffNfcRefund, useReconcileStaffNfcPayment,
  useGetMyStaffNfcPartnerCommissions, getGetMyStaffNfcPartnerCommissionsQueryKey,
  useListAcademicSessions, useListAcademicTerms, useListOwnerSchoolDirectory,
  getListAcademicSessionsQueryKey, getListAcademicTermsQueryKey, getListOwnerSchoolDirectoryQueryKey, getGetStaffNfcReceiptQueryKey,
} from '@workspace/api-client-react';
import type {
  StaffNfcAllocation, StaffNfcBillingRule, StaffNfcSubscription, StaffNfcReceipt, ListStaffNfcFinanceParams,
  GetMyStaffNfcPartnerCommissionsParams,
} from '@workspace/api-client-react';
import { Button, EmptyState, ErrorState, Field, Info, Modal, PageHeading, SkeletonPage, TenantPicker, cx, date, useTenant } from '@/components/shared';
import { SchoolDocumentHeader, SchoolDocumentPrintButton } from '@/components/school-document';

/* ---------- pure helpers (exported for tests) ---------- */
export const nairaMinor = (minor: number | null | undefined) => {
  const m = Math.round(minor ?? 0);
  const sign = m < 0 ? '-' : '';
  const abs = Math.abs(m);
  return `${sign}₦${Math.floor(abs / 100).toLocaleString('en-NG')}.${String(abs % 100).padStart(2, '0')}`;
};
export const parseNairaToMinor = (value: string): number | null => {
  const match = value.trim().match(/^([0-9]+)(?:\.([0-9]{1,2}))?$/);
  if (!match) return null;
  const minor = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
  return Number.isSafeInteger(minor) ? minor : null;
};
export type RuleAmounts = { priceMinor: number; schoolShareMinor: number; platformShareMinor: number; partnerCommissionMinor: number; noPartnerPlatformShareMinor: number };
/** Both Partner branches must sum exactly to the price. Returns error messages (empty = valid). */
export function validateRuleAmounts(a: RuleAmounts): string[] {
  const errors: string[] = [];
  const all = Object.values(a);
  if (all.some(v => !Number.isSafeInteger(v) || v < 0)) errors.push('Every amount must be a valid non-negative naira value.');
  if (a.priceMinor <= 0) errors.push('Price must be greater than zero.');
  if (a.schoolShareMinor + a.platformShareMinor + a.partnerCommissionMinor !== a.priceMinor) errors.push('With a Partner, school + platform + Partner must equal the price.');
  if (a.schoolShareMinor + a.noPartnerPlatformShareMinor !== a.priceMinor) errors.push('Without a Partner, school + platform must equal the price.');
  return errors;
}
/** Checkout redirect only to a server-provided https URL (http allowed for localhost sandbox). */
export function safeCheckoutUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))) return u.toString();
  } catch { /* invalid */ }
  return null;
}
export type CallbackParams = { reference: string | null; transactionId: string | null; providerStatus: string | null };
export function parseCallbackParams(search: string): CallbackParams {
  const q = new URLSearchParams(search);
  return {
    reference: q.get('reference') || q.get('tx_ref') || q.get('ref'),
    transactionId: q.get('transaction_id') || q.get('transactionId'),
    providerStatus: q.get('status'),
  };
}
/** A subscription counts as paid only when the server says PAID. Callback params never do. */
export const isVerifiedPaid = (s?: Pick<StaffNfcSubscription, 'status'> | null) => s?.status === 'PAID';
export const canPay = (s?: Pick<StaffNfcSubscription, 'status'> | null) => !!s && ['UNPAID', 'FAILED', 'CANCELLED', 'PENDING'].includes(s.status);
export const allocationLabel: Record<string, string> = {
  SCHOOL: 'School', PLATFORM: 'Platform', PARTNER: 'Partner', REVERSAL: 'Reversal', PLATFORM_PROVIDER_FEE: 'Provider fee (platform expense)',
};
const errMsg = (e: unknown) => {
  const x = e as { data?: { error?: string; retryable?: boolean }; message?: string } | undefined;
  return x?.data?.error ?? (e instanceof Error ? e.message : 'The request could not be completed.');
};
const FRESH = { staleTime: 15_000, refetchOnMount: 'always' as const, refetchOnWindowFocus: true, refetchInterval: 45_000 };
const entry = 'w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3.5 py-2.5 text-sm font-medium outline-none focus:border-[hsl(var(--primary))] focus:ring-2 focus:ring-[hsl(var(--primary)/.12)]';
const note = 'text-xs leading-5 text-[hsl(var(--muted-foreground))]';

export function useStaffNfcAccess() {
  const ctx = useGetAuthorizedContext();
  const { schoolId } = useTenant();
  const c = ctx.data;
  const isPlatformOwner = c?.isPlatformOwner === true;
  const roles = (c?.roles ?? []).filter(r => r.status === 'ACTIVE');
  const inSchool = (names: string[]) => !!schoolId && roles.some(r => r.schoolId === schoolId && names.includes(r.role as string));
  const has = (n: string) => roles.some(r => (r.role as string) === n);
  const restricted = has('DEVICE_ACTIVATION_OFFICER') || has('COMPANY_ACCOUNTANT');
  return {
    loading: ctx.isLoading, schoolId, isPlatformOwner,
    isPartner: !isPlatformOwner && !restricted && has('PARTNER'),
    isSelfRole: !isPlatformOwner && !restricted && inSchool(['TEACHER', 'STAFF']),
    isSchoolFinance: !isPlatformOwner && !restricted && inSchool(['SCHOOL_ADMIN', 'ACCOUNTANT']),
    isSchoolAdmin: !isPlatformOwner && !restricted && inSchool(['SCHOOL_ADMIN']),
  };
}

function Tone({ value }: { value?: string | null }) {
  if (!value) return null;
  const v = value.toUpperCase();
  const tone = ['PAID', 'ACTIVE', 'RECONCILED', 'VERIFIED'].includes(v) ? 'bg-[hsl(157_37%_43%/.15)] text-[hsl(157_37%_30%)]'
    : ['PENDING', 'UNPAID', 'RECONCILIATION_REQUIRED', 'PARTIALLY_REFUNDED', 'LOCKED'].includes(v) ? 'bg-[hsl(35_83%_53%/.15)] text-[hsl(28_73%_40%)]'
    : ['FAILED', 'CANCELLED', 'REFUNDED', 'INACTIVE'].includes(v) ? 'bg-[hsl(var(--destructive)/.15)] text-[hsl(var(--destructive))]'
    : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]';
  return <span className={cx('inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider', tone)} data-testid={`tone-${v.toLowerCase()}`}>{v.replaceAll('_', ' ')}</span>;
}

export function AllocationBreakdown({ allocations, showAll = true }: { allocations?: StaffNfcAllocation[]; showAll?: boolean }) {
  const rows = (allocations ?? []).filter(a => showAll || a.recipientType === 'SCHOOL');
  if (!rows.length) return <p className={note}>Allocations are recorded only after the server verifies payment.</p>;
  return <dl className="divide-y divide-[hsl(var(--border))] rounded-xl border border-[hsl(var(--border))] text-sm" data-testid="allocation-breakdown">
    {rows.map((a, i) => <div key={i} className="flex items-center justify-between gap-3 px-4 py-2.5">
      <dt className="font-semibold">{allocationLabel[a.recipientType] ?? a.recipientType}{a.status ? <span className="ml-2"><Tone value={a.status} /></span> : null}</dt>
      <dd className="font-bold tabular-nums">{nairaMinor(a.amountMinor)}</dd>
    </div>)}
  </dl>;
}

function Gate({ allowed, loading, title, children }: { allowed: boolean; loading: boolean; title: string; children: ReactNode }) {
  if (loading) return <SkeletonPage />;
  if (!allowed) return <EmptyState icon={ShieldCheck} title="Not available for this session" description={`${title} is restricted by role. Your current sign-in is not authorised to view it.`} />;
  return <>{children}</>;
}

/* ---------- receipt ---------- */
function receiptHtml(r: StaffNfcReceipt, showAll: boolean) {
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
  const rows = (r.allocations ?? []).filter(a => showAll || a.recipientType === 'SCHOOL').map(a => `<tr><td>${esc(allocationLabel[a.recipientType] ?? a.recipientType)}</td><td style="text-align:right">${nairaMinor(a.amountMinor)}</td></tr>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>${esc(r.receiptNumber)}</title><body style="font-family:Georgia,serif;max-width:560px;margin:32px auto"><h2>Yemait EduCore - Staff NFC E-ID receipt</h2><p>Receipt ${esc(r.receiptNumber)}<br>Issued ${esc(date(r.issuedAt))}</p><p>${esc(r.staffName)} (${esc(r.employeeNumber)})<br>${esc(r.schoolName)} - ${esc(r.sessionName)}, ${esc(r.termName)}</p><p>Verified amount: <b>${nairaMinor(r.payment.grossAmountMinor)}</b><br>Status: ${esc(r.payment.status)}<br>Reference: ${esc(r.payment.providerReference ?? '-')}</p><table width="100%">${rows}</table></body>`;
}
function ReceiptModal({ paymentId, schoolId, showAll, onClose }: { paymentId: number; schoolId: number; showAll: boolean; onClose: () => void }) {
  const q = useGetStaffNfcReceipt(paymentId, { schoolId }, { query: { queryKey: getGetStaffNfcReceiptQueryKey(paymentId, { schoolId }), ...FRESH, refetchInterval: false } });
  const r = q.data;
  const download = () => {
    if (!r) return;
    const url = URL.createObjectURL(new Blob([receiptHtml(r, showAll)], { type: 'text/html' }));
    const a = document.createElement('a'); a.href = url; a.download = `${r.receiptNumber}.html`; a.click(); URL.revokeObjectURL(url);
  };
  const receiptAllocations = (r?.allocations ?? []).filter(a => showAll || a.recipientType === 'SCHOOL');
  return <Modal title="Receipt" eyebrow="Server-issued, verified payment" onClose={onClose}>
    {q.isLoading ? <div className="h-40 animate-pulse rounded-xl bg-[hsl(var(--muted))]" /> : q.isError || !r ? <ErrorState retry={() => q.refetch()} message={errMsg(q.error) || 'Receipt unavailable.'} /> : <div className="space-y-4" data-testid="receipt-view">
      <div className="grid grid-cols-2 gap-3"><Info label="Receipt no." value={<span className="font-mono">{r.receiptNumber}</span>} /><Info label="Issued" value={date(r.issuedAt)} /><Info label="Staff" value={`${r.staffName} · ${r.employeeNumber}`} /><Info label="School" value={r.schoolName} /><Info label="Term" value={`${r.sessionName} · ${r.termName}`} /><Info label="Amount" value={nairaMinor(r.payment.grossAmountMinor)} /></div>
      <AllocationBreakdown allocations={r.allocations} showAll={showAll} />
      <div className="flex flex-wrap gap-2">
        <SchoolDocumentPrintButton label="Print receipt" testId="button-print-receipt">
          <article className="school-document-page">
            <SchoolDocumentHeader branding={{
              name: r.schoolName,
              logoUrl: r.schoolLogoVersionUrl ?? undefined,
            }} />
            <h2 className="school-document-title">Staff NFC E-ID payment receipt</h2>
            <dl className="school-document-grid">
              <div className="school-document-field"><dt>Receipt number</dt><dd>{r.receiptNumber}</dd></div>
              <div className="school-document-field"><dt>Issued</dt><dd>{date(r.issuedAt)}</dd></div>
              <div className="school-document-field"><dt>Staff member</dt><dd>{r.staffName}</dd></div>
              <div className="school-document-field"><dt>Employee number</dt><dd>{r.employeeNumber}</dd></div>
              <div className="school-document-field"><dt>School</dt><dd>{r.schoolName}</dd></div>
              <div className="school-document-field"><dt>Session / term</dt><dd>{r.sessionName} / {r.termName}</dd></div>
              <div className="school-document-field"><dt>Payment status</dt><dd>{r.payment.status}</dd></div>
              <div className="school-document-field"><dt>Provider</dt><dd>{r.payment.provider}</dd></div>
              <div className="school-document-field"><dt>Payment reference</dt><dd>{r.payment.providerReference ?? '—'}</dd></div>
              <div className="school-document-field"><dt>Paid at</dt><dd>{r.payment.paidAt ? date(r.payment.paidAt) : '—'}</dd></div>
              <div className="school-document-field"><dt>Gross amount</dt><dd>{nairaMinor(r.payment.grossAmountMinor)} {r.payment.currency}</dd></div>
              {r.payment.providerFeeMinor != null && <div className="school-document-field"><dt>Provider fee</dt><dd>{nairaMinor(r.payment.providerFeeMinor)} {r.payment.currency}</dd></div>}
              {r.payment.settlementAmountMinor != null && <div className="school-document-field"><dt>Settlement amount</dt><dd>{nairaMinor(r.payment.settlementAmountMinor)} {r.payment.currency}</dd></div>}
            </dl>
            {receiptAllocations.length > 0 && <table className="school-document-table">
              <thead><tr><th>Allocation</th><th>Amount</th></tr></thead>
              <tbody>{receiptAllocations.map((allocation, index) => <tr key={`${allocation.recipientType}-${index}`}>
                <td>{allocationLabel[allocation.recipientType] ?? allocation.recipientType}</td>
                <td>{nairaMinor(allocation.amountMinor)} {allocation.currency}</td>
              </tr>)}</tbody>
            </table>}
          </article>
        </SchoolDocumentPrintButton>
        <Button variant="outline" onClick={download} testId="button-download-receipt"><Download size={15} />Download</Button>
      </div>
    </div>}
  </Modal>;
}

/* ---------- Teacher/Staff self ---------- */
export function MyStaffNfcSubscriptionPage() {
  const access = useStaffNfcAccess();
  const qc = useQueryClient();
  const { schoolId } = access;
  const enabled = !!schoolId && access.isSelfRole && !access.loading;
  const params = { schoolId };
  const sub = useGetMyStaffNfcSubscriptions(params, { query: { enabled, queryKey: getGetMyStaffNfcSubscriptionsQueryKey(params), ...FRESH } });
  const profile = useGetMyEmployeeNfcProfile({ query: { enabled, queryKey: getGetMyEmployeeNfcProfileQueryKey(), ...FRESH } });
  const checkout = useCreateStaffNfcCheckout();
  const verify = useVerifyMyStaffNfcPayment();
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const [receiptId, setReceiptId] = useState<number | null>(null);
  const [callback, setCallback] = useState<CallbackParams | null>(() => typeof window === 'undefined' ? null : (p => p.reference ? p : null)(parseCallbackParams(window.location.search)));
  const verifiedKey = useRef<string | null>(null);

  const refetchOwn = () => {
    qc.invalidateQueries({ queryKey: getGetMyStaffNfcSubscriptionsQueryKey(params) });
    qc.invalidateQueries({ queryKey: getGetMyEmployeeNfcProfileQueryKey() });
    qc.invalidateQueries({ predicate: q => typeof q.queryKey[0] === 'string' && /^\/api\/staff-nfc\/payments\/\d+\/receipt$/.test(q.queryKey[0]) });
  };
  const runVerify = (cb: CallbackParams) => {
    if (!cb.reference || !cb.transactionId) { setMessage({ tone: 'warn', text: 'The provider return did not include a transaction ID, so payment cannot be verified yet. Nothing has been marked paid.' }); return; }
    verify.mutate({ data: { reference: cb.reference, providerTransactionId: cb.transactionId }, params }, {
      onSuccess: res => {
        refetchOwn();
        setCallback(null);
        window.history.replaceState(null, '', window.location.pathname);
        setMessage(res.activated && res.subscription.status === 'PAID'
          ? { tone: 'ok', text: 'Payment verified by the server. Your term subscription is active.' }
          : { tone: 'warn', text: `Server status: ${res.payment.status.replaceAll('_', ' ').toLowerCase()}. It is not marked paid until the provider confirms.` });
      },
      onError: e => setMessage({ tone: 'err', text: `${errMsg(e)} You can retry verification safely; your subscription records are unchanged.` }),
    });
  };
  const runVerifyRef = useRef(runVerify); runVerifyRef.current = runVerify;
  useEffect(() => {
    if (!callback?.reference || !enabled) return;
    const key = `${callback.reference}|${callback.transactionId}`;
    if (verifiedKey.current === key) return;
    verifiedKey.current = key;
    runVerifyRef.current(callback);
  }, [callback, enabled]);

  const pay = (s: StaffNfcSubscription) => checkout.mutate({ subscriptionId: s.id, params }, {
    onSuccess: res => {
      const url = safeCheckoutUrl(res.checkoutUrl);
      if (url) { window.location.assign(url); return; }
      refetchOwn();
      setMessage({ tone: 'warn', text: 'The provider did not return a secure checkout link. Your payment is still pending verification; try again shortly.' });
    },
    onError: e => setMessage({ tone: 'err', text: errMsg(e) }),
  });

  if (!schoolId && !access.loading && !access.isPlatformOwner && !access.isSelfRole) return <EmptyState icon={CreditCard} title="No school context" description="Your account is not attached to a school yet." />;
  const d = sub.data;
  const cur = d?.currentSubscription ?? null;
  const card = profile.data;
  const history = [...(d?.subscriptions ?? [])].sort((a, b) => b.id - a.id);
  return <div className="fade-up">
    <PageHeading eyebrow="My account / NFC E-ID" title="My NFC subscription" description="Your E-ID card works for the term only after the server has verified your payment." />
    <Gate allowed={access.isSelfRole} loading={access.loading} title="My NFC subscription">
      {message && <div role="status" data-testid="status-nfc-message" className={cx('mb-5 rounded-xl border px-4 py-3 text-sm font-semibold', message.tone === 'ok' && 'border-[hsl(157_37%_43%/.3)] bg-[hsl(157_37%_43%/.08)]', message.tone === 'warn' && 'border-[hsl(35_83%_53%/.4)] bg-[hsl(35_83%_53%/.1)]', message.tone === 'err' && 'border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--destructive)/.08)] text-[hsl(var(--destructive))]')}>
        {message.text}
        {callback?.reference && <Button variant="outline" className="ml-3" onClick={() => runVerify(callback)} disabled={verify.isPending} testId="button-retry-verify"><RefreshCw size={14} />Retry verification</Button>}
      </div>}
      {verify.isPending && <div className="mb-5 text-sm font-semibold text-[hsl(var(--muted-foreground))]" data-testid="status-verifying">Verifying your payment with the server...</div>}
      {sub.isLoading ? <SkeletonPage /> : sub.isError ? <ErrorState retry={() => sub.refetch()} message={errMsg(sub.error)} /> : !d?.currentTerm ? <EmptyState icon={CircleDollarSign} title="No active term" description="Billing starts when your school activates an academic term." /> : <>
        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          <section className="panel p-6 md:p-8" data-testid="panel-current-term">
            <div className="eyebrow">{d.currentSession?.academicSessionName} · {d.currentTerm.academicTermName}</div>
            {cur ? <>
              <div className="mt-4 flex flex-wrap items-end justify-between gap-4"><div className="display-font text-4xl font-bold tabular-nums">{nairaMinor(cur.priceMinor)}</div><Tone value={cur.status} /></div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3"><Info label="Due date" value={date(cur.dueDate)} /><Info label="Paid on" value={date(cur.paidAt)} /><Info label="Card service" value={cur.isEligibleForNfc ? 'Allowed' : 'Restricted'} /></div>
              <div className="mt-6 flex flex-wrap gap-3">
                {canPay(cur) && <Button onClick={() => pay(cur)} disabled={checkout.isPending} testId="button-pay-subscription"><CreditCard size={16} />{checkout.isPending ? 'Opening checkout...' : cur.status === 'PENDING' ? 'Continue payment' : 'Pay for this term'}</Button>}
                {cur.latestPayment && isVerifiedPaid(cur) && <Button variant="outline" onClick={() => setReceiptId(cur.latestPayment!.id)} testId="button-view-receipt"><ReceiptText size={16} />Receipt</Button>}
              </div>
              {cur.status === 'PENDING' && <p className={`mt-4 ${note}`}>A payment is awaiting provider confirmation. This page refreshes automatically.</p>}
            </> : <p className="mt-4 text-sm text-[hsl(var(--muted-foreground))]">No subscription has been generated for this term yet. Your school administrator generates term subscriptions.</p>}
          </section>
          <section className="space-y-4">
            <div className="panel p-6" data-testid="panel-card-status"><div className="eyebrow">NFC card</div>
              <div className="mt-3 flex items-center justify-between"><span className="text-lg font-bold">{profile.isLoading ? '...' : (card?.status ?? d.cardStatus ?? 'NONE')}</span>{card && <Tone value={card.termEligibility} />}</div>
              {card && <p className={`mt-2 ${note}`}>{card.nfcEligible ? 'Eligible for NFC services this term.' : 'Not eligible for NFC services until the term is paid.'}</p>}
              {profile.isError && <p className={`mt-2 ${note}`}>Card detail unavailable right now.</p>}
            </div>
            <div className="panel p-6"><div className="eyebrow">Next term</div>
              {d.nextSubscription ? <div className="mt-3 text-sm font-bold">{d.nextSubscription.sessionName} · {d.nextSubscription.termName}<div className={note}>{nairaMinor(d.nextSubscription.priceMinor)} due {date(d.nextSubscription.dueDate)}</div></div>
                : cur?.nextTerm?.termName ? <div className="mt-3 text-sm font-bold">{cur.nextTerm.sessionName} · {cur.nextTerm.termName}<div className={note}>{nairaMinor(cur.nextTerm.priceMinor)} due {date(cur.nextTerm.dueDate)}</div></div>
                : <p className={`mt-3 ${note}`}>Not scheduled yet. A paid term does not cover a later one.</p>}
            </div>
          </section>
        </div>
        <section className="panel mt-6 overflow-hidden"><div className="border-b border-[hsl(var(--border))] p-5"><div className="eyebrow">History</div><h2 className="display-font mt-1 text-xl font-bold">Term subscriptions</h2></div>
          {!history.length ? <EmptyState icon={Layers3} title="No history yet" description="Your terms and payments will be listed here." /> : <div className="divide-y divide-[hsl(var(--border))]" data-testid="list-history">
            {history.map(s => <div key={s.id} className="flex flex-wrap items-center gap-4 px-5 py-4" data-testid={`row-history-${s.id}`}>
              <div className="min-w-0 flex-1"><div className="font-bold">{s.sessionName} · {s.termName}</div><div className={note}>Due {date(s.dueDate)}{s.paidAt ? ` · paid ${date(s.paidAt)}` : ''}</div></div>
              <div className="font-bold tabular-nums">{nairaMinor(s.priceMinor)}</div><Tone value={s.status} />
              {s.status !== 'UNPAID' && s.latestPayment && ['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(s.status) && <Button variant="quiet" onClick={() => setReceiptId(s.latestPayment!.id)}>Receipt</Button>}
            </div>)}
          </div>}
        </section>
      </>}
      {receiptId && <ReceiptModal paymentId={receiptId} schoolId={schoolId} showAll={false} onClose={() => setReceiptId(null)} />}
    </Gate>
  </div>;
}

/* ---------- Finance (school scoped / owner global) ---------- */
function RefundModal({ item, schoolId, onClose, onResult }: { item: StaffNfcSubscription; schoolId: number; onClose: () => void; onResult: (m: string) => void }) {
  const refund = useRequestStaffNfcRefund();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [fail, setFail] = useState('');
  const max = item.latestPayment?.grossAmountMinor ?? item.priceMinor;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const minor = amount.trim() ? parseNairaToMinor(amount) : null;
    if (amount.trim() && (minor === null || minor < 1 || minor > max)) { setFail(`Enter an amount between ₦0.01 and ${nairaMinor(max)}, or leave blank for a full refund.`); return; }
    if (reason.trim().length < 3) { setFail('A reason is required.'); return; }
    refund.mutate({ subscriptionId: item.id, params: { schoolId }, data: { reason: reason.trim(), amountMinor: minor } }, {
      onSuccess: r => { onResult(r.refundStatus === 'PENDING' || r.refundStatus === 'RECONCILIATION_REQUIRED' ? `Refund of ${nairaMinor(r.requestedAmountMinor)} is ${r.refundStatus.toLowerCase().replaceAll('_', ' ')} with the provider. It has not been completed and allocations are not reversed.` : `Refund recorded: ${nairaMinor(r.refundedAmountMinor)} (${r.refundStatus.replaceAll('_', ' ').toLowerCase()}). Allocations reversed: ${r.allocationsReversed ? 'yes' : 'no'}.`); onClose(); },
      onError: e2 => setFail(errMsg(e2)),
    });
  };
  return <Modal title="Request refund" eyebrow={`${item.employeeName} · ${item.termName}`} onClose={onClose}>
    <form onSubmit={submit} className="space-y-4">
      <Info label="Verified payment" value={nairaMinor(max)} />
      <Field label="Amount in naira (blank = full)"><input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" className={entry} data-testid="input-refund-amount" /></Field>
      <Field label="Reason"><textarea value={reason} onChange={e => setReason(e.target.value)} className={entry} rows={3} data-testid="input-refund-reason" /></Field>
      <p className={note}>A refund is only shown as successful when the server reports it so. Provider-pending refunds stay pending.</p>
      {fail && <p role="alert" className="text-sm text-[hsl(var(--destructive))]">{fail}</p>}
      <Button type="submit" variant="danger" disabled={refund.isPending} testId="button-submit-refund">{refund.isPending ? 'Submitting...' : 'Submit refund request'}</Button>
    </form>
  </Modal>;
}

function GeneratePanel({ schoolId, onDone }: { schoolId: number; onDone: (m: string) => void }) {
  const qc = useQueryClient();
  const gen = useGenerateStaffNfcTermSubscriptions();
  const [sessionId, setSessionId] = useState('');
  const [termId, setTermId] = useState('');
  const [fail, setFail] = useState('');
  const sessions = useListAcademicSessions({ schoolId }, { query: { queryKey: getListAcademicSessionsQueryKey({ schoolId }), staleTime: 60_000 } });
  const terms = useListAcademicTerms(Number(sessionId), { schoolId }, { query: { enabled: !!sessionId, queryKey: getListAcademicTermsQueryKey(Number(sessionId), { schoolId }) } });
  const run = () => gen.mutate({ params: { schoolId, academicSessionId: Number(sessionId), academicTermId: Number(termId) } }, {
    onSuccess: r => { qc.invalidateQueries({ queryKey: getListStaffNfcFinanceQueryKey() }); qc.invalidateQueries({ queryKey: getGetMyStaffNfcSubscriptionsQueryKey() }); setFail(''); onDone(`Generated ${r.generatedCount} new, ${r.unchangedCount} already existed. Running this again is safe.`); },
    onError: e => setFail(errMsg(e)),
  });
  return <section className="panel mb-6 p-5" data-testid="panel-generate">
    <div className="eyebrow">Term management</div><h2 className="display-font mt-1 text-lg font-bold">Generate staff subscriptions</h2>
    <p className={`mt-1 ${note}`}>Creates one subscription per eligible employee for the term using the rule in force. Existing subscriptions are left unchanged.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <Field label="Session"><select className={entry} value={sessionId} onChange={e => { setSessionId(e.target.value); setTermId(''); }} data-testid="select-gen-session"><option value="">Select</option>{(sessions.data ?? []).map((s: { id: number; name: string }) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <Field label="Term"><select className={entry} value={termId} onChange={e => setTermId(e.target.value)} disabled={!sessionId} data-testid="select-gen-term"><option value="">Select</option>{(terms.data ?? []).map((t: { id: number; name: string }) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
      <Button onClick={run} disabled={!sessionId || !termId || gen.isPending} testId="button-generate-subscriptions">{gen.isPending ? 'Generating...' : 'Generate'}</Button>
    </div>
    {fail && <p role="alert" className="mt-3 text-sm text-[hsl(var(--destructive))]">{fail}</p>}
  </section>;
}

export function StaffNfcFinancePage() {
  const access = useStaffNfcAccess();
  const qc = useQueryClient();
  const { isPlatformOwner, isSchoolFinance, isSchoolAdmin, schoolId: tenantSchool } = access;
  const [ownerSchool, setOwnerSchool] = useState('');
  const [status, setStatus] = useState<ListStaffNfcFinanceParams['paymentStatus']>('all');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [sessionId, setSessionId] = useState(''); const [termId, setTermId] = useState('');
  const [partnerId, setPartnerId] = useState(''); const [search, setSearch] = useState('');
  const [cursors, setCursors] = useState<number[]>([]);
  const [message, setMessage] = useState('');
  const [fail, setFail] = useState('');
  const [refundItem, setRefundItem] = useState<StaffNfcSubscription | null>(null);
  const [receipt, setReceipt] = useState<{ id: number; schoolId: number } | null>(null);
  const allowed = isPlatformOwner || isSchoolFinance;
  const owners = useListOwnerSchoolDirectory({ status: 'all' }, { query: { enabled: isPlatformOwner, queryKey: getListOwnerSchoolDirectoryQueryKey({ status: 'all' }), staleTime: 60_000 } });
  const params: ListStaffNfcFinanceParams = {
    schoolId: isPlatformOwner ? (ownerSchool ? Number(ownerSchool) : undefined) : tenantSchool,
    ...(status && status !== 'all' ? { paymentStatus: status } : {}),
    ...(from ? { from } : {}), ...(to ? { to } : {}),
    ...(sessionId && Number(sessionId) ? { academicSessionId: Number(sessionId) } : {}),
    ...(termId && Number(termId) ? { academicTermId: Number(termId) } : {}),
    ...(isPlatformOwner && partnerId && Number(partnerId) ? { partnerId: Number(partnerId) } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
    limit: 25, ...(cursors.length ? { cursor: cursors[cursors.length - 1] } : {}),
  };
  const q = useListStaffNfcFinance(params, { query: { enabled: allowed && !access.loading, queryKey: getListStaffNfcFinanceQueryKey(params), ...FRESH } });
  const reconcile = useReconcileStaffNfcPayment();
  const d = q.data;
  const ownerView = isPlatformOwner && d?.role === 'PLATFORM_OWNER';
  const refresh = () => { qc.invalidateQueries({ queryKey: getListStaffNfcFinanceQueryKey() }); qc.invalidateQueries({ queryKey: getGetMyStaffNfcSubscriptionsQueryKey() }); qc.invalidateQueries({ queryKey: getGetMyStaffNfcPartnerCommissionsQueryKey() }); };
  const doReconcile = (s: StaffNfcSubscription) => {
    if (!s.latestPayment) return;
    reconcile.mutate({ paymentId: s.latestPayment.id, params: { schoolId: s.schoolId } }, {
      onSuccess: r => { setFail(''); setMessage(`Server outcome: payment ${r.payment.status.replaceAll('_', ' ').toLowerCase()}, reconciliation ${r.payment.reconciliationStatus.replaceAll('_', ' ').toLowerCase()}${r.activated ? ', subscription activated' : ''}.`); refresh(); },
      onError: e => { setMessage(''); setFail(errMsg(e)); },
    });
  };
  const resetPage = () => setCursors([]);
  const t = d?.totals;
  return <div className="fade-up">
    <PageHeading eyebrow={isPlatformOwner ? 'Owner / Finance' : 'School operations / Finance'} title="Staff NFC finance" description="Term subscriptions for Teacher and Staff E-ID cards. Only server-verified payments count as paid." action={isPlatformOwner ? undefined : <TenantPicker />} />
    <Gate allowed={allowed} loading={access.loading} title="Staff NFC finance">
      {isSchoolAdmin && tenantSchool ? <GeneratePanel key={tenantSchool} schoolId={tenantSchool} onDone={m => { setMessage(m); setFail(''); }} /> : null}
      {message && <div role="status" data-testid="status-finance-message" className="mb-5 rounded-xl border border-[hsl(157_37%_43%/.3)] bg-[hsl(157_37%_43%/.08)] px-4 py-3 text-sm font-semibold">{message}</div>}
      {fail && <div role="alert" className="mb-5 rounded-xl bg-[hsl(var(--destructive)/.08)] px-4 py-3 text-sm text-[hsl(var(--destructive))]">{fail}</div>}
      <section className="panel mb-6 grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4" aria-label="Filters">
        {isPlatformOwner && <Field label="School"><select className={entry} value={ownerSchool} onChange={e => { setOwnerSchool(e.target.value); resetPage(); }} data-testid="filter-school"><option value="">All schools</option>{(owners.data?.schools ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>}
        <Field label="Status"><select className={entry} value={status} onChange={e => { setStatus(e.target.value as typeof status); resetPage(); }} data-testid="filter-status">{['all', 'UNPAID', 'PENDING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED'].map(s => <option key={s} value={s}>{s === 'all' ? 'All statuses' : s.replaceAll('_', ' ')}</option>)}</select></Field>
        <Field label="Session ID"><input className={entry} inputMode="numeric" value={sessionId} onChange={e => { setSessionId(e.target.value.replace(/\D/g, '')); resetPage(); }} /></Field>
        <Field label="Term ID"><input className={entry} inputMode="numeric" value={termId} onChange={e => { setTermId(e.target.value.replace(/\D/g, '')); resetPage(); }} /></Field>
        <Field label="From"><input type="date" className={entry} value={from} onChange={e => { setFrom(e.target.value); resetPage(); }} /></Field>
        <Field label="To"><input type="date" className={entry} value={to} onChange={e => { setTo(e.target.value); resetPage(); }} /></Field>
        {isPlatformOwner && <Field label="Partner ID"><input className={entry} inputMode="numeric" value={partnerId} onChange={e => { setPartnerId(e.target.value.replace(/\D/g, '')); resetPage(); }} data-testid="filter-partner" /></Field>}
        <Field label="Employee / number"><input className={entry} value={search} onChange={e => { setSearch(e.target.value); resetPage(); }} data-testid="filter-employee" /></Field>
      </section>
      {q.isLoading ? <SkeletonPage /> : q.isError ? <ErrorState retry={() => q.refetch()} message={errMsg(q.error)} /> : <>
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="finance-totals">
          <Info label={ownerView ? 'Gross verified' : 'Verified collected'} value={nairaMinor(t?.grossAmountMinor)} />
          <Info label="School allocation" value={nairaMinor(t?.schoolAllocationMinor)} />
          {ownerView && <Info label="Platform revenue" value={nairaMinor(t?.platformRevenueMinor)} />}
          {ownerView && <Info label="Partner commission" value={nairaMinor(t?.partnerCommissionMinor)} />}
          {ownerView && <Info label="Provider fee expense (separate)" value={nairaMinor(t?.providerFeeExpenseMinor)} />}
          <Info label="Paid / pending" value={`${t?.paidCount ?? 0} / ${t?.pendingCount ?? 0}`} />
          <Info label="Failed / refunded" value={`${t?.failedCount ?? 0} / ${t?.refundedCount ?? 0}`} />
        </div>
        <section className="panel overflow-hidden">
          {!d?.items.length ? <EmptyState icon={CircleDollarSign} title="No staff subscriptions match" description="Adjust the filters, or generate term subscriptions for a school." /> : <div className="divide-y divide-[hsl(var(--border))]" data-testid="finance-rows">
            {d.items.map(s => { const p = s.latestPayment; return <div key={s.id} className="grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,1.4fr)_1fr_1fr_auto] md:items-center" data-testid={`row-nfc-${s.id}`}>
              <div><div className="font-bold">{s.employeeName}</div><div className={note}>{s.employeeNumber}{ownerView ? ` · ${s.schoolName ?? `School #${s.schoolId}`}` : ''} · {s.sessionName}, {s.termName}</div></div>
              <div className="text-sm"><div className="font-bold tabular-nums">{nairaMinor(s.priceMinor)}</div><div className={note}>School {nairaMinor(s.schoolShareMinor)}{ownerView ? ` · Platform ${nairaMinor(s.platformShareMinor)} · Partner ${nairaMinor(s.partnerShareMinor)}` : ''}</div></div>
              <div className="text-sm"><Tone value={s.status} /><div className={`mt-1 ${note}`}>{p?.paidAt ? `Paid ${date(p.paidAt)}` : `Due ${date(s.dueDate)}`}{p ? ` · recon ${p.reconciliationStatus.replaceAll('_', ' ').toLowerCase()}` : ''}{ownerView && p?.providerMode && p.providerMode !== 'SANDBOX' ? ` · ${p.providerMode.replaceAll('_', ' ').toLowerCase()}` : ''}</div>{ownerView && p && <div className={note}>Provider fee {nairaMinor(p.providerFeeMinor)} · settlement {nairaMinor(p.settlementAmountMinor)}</div>}</div>
              <div className="flex flex-wrap gap-2">
                {p && ['PAID', 'REFUNDED', 'PARTIALLY_REFUNDED'].includes(s.status) && <Button variant="quiet" onClick={() => setReceipt({ id: p.id, schoolId: s.schoolId })}>Receipt</Button>}
                {p && ['PENDING', 'RECONCILIATION_REQUIRED', 'FAILED'].includes(p.status) && <Button variant="outline" disabled={reconcile.isPending} onClick={() => doReconcile(s)} testId={`button-reconcile-${s.id}`}>Reconcile</Button>}
                {isPlatformOwner && p && s.status === 'PAID' && <Button variant="danger" onClick={() => { setMessage(''); setFail(''); setRefundItem(s); }} testId={`button-refund-${s.id}`}>Refund</Button>}
              </div>
            </div>; })}
          </div>}
          <div className="flex items-center justify-between border-t border-[hsl(var(--border))] p-4">
            <Button variant="quiet" disabled={!cursors.length} onClick={() => setCursors(c => c.slice(0, -1))}>Previous</Button>
            <Button variant="quiet" disabled={d?.nextCursor == null} onClick={() => d?.nextCursor != null && setCursors(c => [...c, d.nextCursor!])}>Next</Button>
          </div>
        </section>
      </>}
      {refundItem && <RefundModal item={refundItem} schoolId={refundItem.schoolId} onClose={() => setRefundItem(null)} onResult={m => { setMessage(m); setFail(''); refresh(); }} />}
      {receipt && <ReceiptModal paymentId={receipt.id} schoolId={receipt.schoolId} showAll={ownerView} onClose={() => setReceipt(null)} />}
    </Gate>
  </div>;
}

/* ---------- Billing rules (Owner only) ---------- */
export function StaffNfcBillingRulesPage() {
  const access = useStaffNfcAccess();
  const qc = useQueryClient();
  const allowed = access.isPlatformOwner;
  const params = { status: 'all' as const };
  const q = useListStaffNfcBillingRules(params, { query: { enabled: allowed, queryKey: getListStaffNfcBillingRulesQueryKey(params), ...FRESH } });
  const create = useCreateStaffNfcBillingRule();
  const [f, setF] = useState({ price: '', school: '', platform: '', partner: '', noPartner: '', effectiveAt: '' });
  const [fail, setFail] = useState<string[]>([]);
  const [ok, setOk] = useState('');
  const amounts = useMemo(() => ({ priceMinor: parseNairaToMinor(f.price) ?? NaN, schoolShareMinor: parseNairaToMinor(f.school) ?? NaN, platformShareMinor: parseNairaToMinor(f.platform) ?? NaN, partnerCommissionMinor: parseNairaToMinor(f.partner) ?? NaN, noPartnerPlatformShareMinor: parseNairaToMinor(f.noPartner) ?? NaN }), [f]);
  const live = validateRuleAmounts(amounts);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs = validateRuleAmounts(amounts);
    if (!f.effectiveAt || Number.isNaN(new Date(f.effectiveAt).getTime())) errs.push('Choose an effective date and time.');
    if (errs.length) { setFail(errs); return; }
    create.mutate({ data: { product: 'TEACHER_STAFF_NFC_EID', billingFrequency: 'ACADEMIC_TERM', currency: 'NGN', ...amounts, effectiveAt: new Date(f.effectiveAt).toISOString() } }, {
      onSuccess: r => { setFail([]); setOk(`Version ${r.version} created. It applies only to subscriptions generated on or after ${date(r.effectiveAt)}; existing subscriptions keep their original amounts.`); setF({ price: '', school: '', platform: '', partner: '', noPartner: '', effectiveAt: '' }); qc.invalidateQueries({ queryKey: getListStaffNfcBillingRulesQueryKey() }); },
      onError: er => { setOk(''); setFail([errMsg(er)]); },
    });
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(p => ({ ...p, [k]: e.target.value }));
  return <div className="fade-up">
    <PageHeading eyebrow="Owner / Billing rules" title="Billing rules" description="Versioned, effective-dated pricing. A new version never rewrites historical subscriptions." />
    <Gate allowed={allowed} loading={access.loading} title="Billing rules">
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <form onSubmit={submit} className="panel space-y-4 p-6" data-testid="form-billing-rule">
          <div className="eyebrow">New version</div>
          <p className={note} data-testid="rule-status-note">Rules are immutable. Status is assigned by the server when a version is created and is shown in history; historical versions are never edited.</p>
          <div className="grid grid-cols-3 gap-2 text-xs font-bold"><Info label="Product" value="Teacher/Staff NFC E-ID" className="col-span-3 sm:col-span-1" /><Info label="Frequency" value="Per academic term" /><Info label="Currency" value="NGN" /></div>
          <Field label="Price (₦)"><input className={entry} inputMode="decimal" value={f.price} onChange={set('price')} data-testid="input-rule-price" /></Field>
          <Field label="School share (₦)"><input className={entry} inputMode="decimal" value={f.school} onChange={set('school')} data-testid="input-rule-school" /></Field>
          <Field label="Platform share with Partner (₦)"><input className={entry} inputMode="decimal" value={f.platform} onChange={set('platform')} data-testid="input-rule-platform" /></Field>
          <Field label="Partner commission (₦)"><input className={entry} inputMode="decimal" value={f.partner} onChange={set('partner')} data-testid="input-rule-partner" /></Field>
          <Field label="Platform share without Partner (₦)"><input className={entry} inputMode="decimal" value={f.noPartner} onChange={set('noPartner')} data-testid="input-rule-nopartner" /></Field>
          <Field label="Effective from"><input type="datetime-local" className={entry} value={f.effectiveAt} onChange={set('effectiveAt')} data-testid="input-rule-effective" /></Field>
          {f.price && live.length > 0 && <ul className={cx(note, 'list-disc pl-5')} data-testid="rule-live-errors">{live.map(m => <li key={m}>{m}</li>)}</ul>}
          {fail.length > 0 && <ul role="alert" className="list-disc pl-5 text-sm text-[hsl(var(--destructive))]">{fail.map(m => <li key={m}>{m}</li>)}</ul>}
          {ok && <p role="status" className="text-sm font-semibold">{ok}</p>}
          <Button type="submit" disabled={create.isPending} testId="button-create-rule">{create.isPending ? 'Saving...' : 'Create rule version'}</Button>
        </form>
        <section className="panel overflow-hidden">
          <div className="border-b border-[hsl(var(--border))] p-5"><div className="eyebrow">History</div><h2 className="display-font mt-1 text-xl font-bold">Rule versions</h2></div>
          {q.isLoading ? <div className="p-5"><SkeletonPage /></div> : q.isError ? <ErrorState retry={() => q.refetch()} message={errMsg(q.error)} /> : !q.data?.length ? <EmptyState icon={Layers3} title="No rules" description="No billing rule exists yet." /> : <div className="divide-y divide-[hsl(var(--border))]" data-testid="rule-list">
            {q.data.map((r: StaffNfcBillingRule) => <div key={r.id} className="px-5 py-4 text-sm" data-testid={`row-rule-${r.id}`}>
              <div className="flex items-center justify-between"><div className="font-bold">Version {r.version} · {nairaMinor(r.priceMinor)}</div><Tone value={r.status} /></div>
              <div className={`mt-1 ${note}`}>Effective {date(r.effectiveAt)} · created {date(r.createdAt)}</div>
              <div className="mt-2 text-xs font-semibold">With Partner: school {nairaMinor(r.schoolShareMinor)}, platform {nairaMinor(r.platformShareMinor)}, Partner {nairaMinor(r.partnerCommissionMinor)}<br />No Partner: school {nairaMinor(r.schoolShareMinor)}, platform {nairaMinor(r.noPartnerPlatformShareMinor)}</div>
            </div>)}
          </div>}
        </section>
      </div>
    </Gate>
  </div>;
}

/* ---------- Partner ---------- */
export function PartnerStaffNfcCommissionsPage() {
  const access = useStaffNfcAccess();
  const [status, setStatus] = useState<GetMyStaffNfcPartnerCommissionsParams['status']>(undefined);
  const [sessionId, setSessionId] = useState(''); const [termId, setTermId] = useState('');
  const [cursors, setCursors] = useState<number[]>([]);
  const allowed = access.isPartner;
  const params: GetMyStaffNfcPartnerCommissionsParams = {
    ...(status ? { status } : {}), ...(Number(sessionId) ? { academicSessionId: Number(sessionId) } : {}), ...(Number(termId) ? { academicTermId: Number(termId) } : {}),
    limit: 25, ...(cursors.length ? { cursor: cursors[cursors.length - 1] } : {}),
  };
  const q = useGetMyStaffNfcPartnerCommissions(params, { query: { enabled: allowed && !access.loading, queryKey: getGetMyStaffNfcPartnerCommissionsQueryKey(params), ...FRESH } });
  const d = q.data;
  return <div className="fade-up">
    <PageHeading eyebrow="Partner / Staff NFC" title="Staff NFC commissions" description="Eligible activity in your attributed schools and your own commission. No payroll, bank or unrelated finance data is shown." />
    <Gate allowed={allowed} loading={access.loading} title="Partner commissions">
      <section className="panel mb-6 grid gap-3 p-5 sm:grid-cols-3">
        <Field label="Commission status"><select className={entry} value={status ?? ''} onChange={e => { setStatus((e.target.value || undefined) as typeof status); setCursors([]); }} data-testid="filter-commission-status"><option value="">All</option><option value="PENDING">Pending</option><option value="PAID">Paid</option><option value="REVERSED">Reversed</option></select></Field>
        <Field label="Session ID"><input className={entry} inputMode="numeric" value={sessionId} onChange={e => { setSessionId(e.target.value.replace(/\D/g, '')); setCursors([]); }} /></Field>
        <Field label="Term ID"><input className={entry} inputMode="numeric" value={termId} onChange={e => { setTermId(e.target.value.replace(/\D/g, '')); setCursors([]); }} /></Field>
      </section>
      {q.isLoading ? <SkeletonPage /> : q.isError ? <ErrorState retry={() => q.refetch()} message={errMsg(q.error)} /> : <>
        <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="partner-totals">
          <Info label="Eligible subscriptions" value={String(d?.totals.eligibleSubscriptionCount ?? 0)} />
          <Info label="Pending commission" value={nairaMinor(d?.totals.pendingCommissionMinor)} />
          <Info label="Paid commission" value={nairaMinor(d?.totals.paidCommissionMinor)} />
          <Info label="Total commission" value={nairaMinor(d?.totals.commissionAmountMinor)} />
        </div>
        <section className="panel overflow-hidden">
          {!d?.items.length ? <EmptyState icon={Handshake} title="No commission activity" description="Commission appears once a staff subscription in an attributed school is verified paid." /> : <div className="divide-y divide-[hsl(var(--border))]" data-testid="partner-rows">
            {d.items.map(i => <div key={i.subscriptionId} className="flex flex-wrap items-center gap-4 px-5 py-4" data-testid={`row-commission-${i.subscriptionId}`}>
              <div className="min-w-0 flex-1"><div className="font-bold">{i.schoolName}</div><div className={note}>{i.sessionName} · {i.termName}</div></div>
              <div className="text-sm tabular-nums"><div className="font-bold">{nairaMinor(i.commissionMinor)}</div><div className={note}>of {nairaMinor(i.priceMinor)}</div></div>
              <Tone value={i.paymentStatus} /><Tone value={i.commissionStatus} />
            </div>)}
          </div>}
          <div className="flex items-center justify-between border-t border-[hsl(var(--border))] p-4">
            <Button variant="quiet" disabled={!cursors.length} onClick={() => setCursors(c => c.slice(0, -1))}>Previous</Button>
            <Button variant="quiet" disabled={d?.nextCursor == null} onClick={() => d?.nextCursor != null && setCursors(c => [...c, d.nextCursor!])}>Next</Button>
          </div>
        </section>
      </>}
    </Gate>
  </div>;
}
