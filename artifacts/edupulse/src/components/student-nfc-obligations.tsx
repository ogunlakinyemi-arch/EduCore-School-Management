import { useAuth } from '@clerk/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Nfc, ShieldCheck } from 'lucide-react';
import {
  createStudentSubscriptionCheckout,
  ApiError,
  customFetch,
  getGetStudentSubscriptionPaymentQueryKey,
  getStudentSubscriptionPayment,
  useGetAuthorizedContext,
  useGetStudentSubscriptionPayment,
  useVerifyStudentSubscriptionPayment,
  type StudentNfcLedger,
  type StudentNfcObligation,
  type StudentNfcSummary,
} from '@workspace/api-client-react';
import { Button, EmptyState, ErrorState, StatusPill, money, date } from '@/components/shared';
import {
  checkoutEvidenceMatchesServer,
  findCheckoutForFlutterwaveReturn,
  getStudentCheckoutIdempotencyKey,
  isPaymentStatusPolling,
  loadStudentCheckoutAttempts,
  parseFlutterwaveReturn,
  safeStudentCheckoutUrl,
  saveStudentCheckoutAttempts,
  type StudentCheckoutAttempt,
} from '@/pages/subscription-payment-helpers';

export type NfcObligationRow = StudentNfcObligation;
export type NfcObligationStatus = NfcObligationRow['status'];
export type NfcObligationSummary = StudentNfcSummary;
export type NfcObligationsResponse = StudentNfcLedger;
export type NfcObligationFilters = {
  schoolId?: number; studentId?: number; className?: string; section?: string; sessionId?: number; termId?: number;
};

export const NFC_OBLIGATIONS_PATH = '/api/student-nfc/obligations';

export function getStudentNfcObligationsUrl(filters: NfcObligationFilters = {}) {
  const q = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => { if (v !== undefined && v !== '') q.append(k, String(v)); });
  const s = q.toString();
  return s ? `${NFC_OBLIGATIONS_PATH}?${s}` : NFC_OBLIGATIONS_PATH;
}
export const getStudentNfcObligationsQueryKey = (identity = 'anon', filters: NfcObligationFilters = {}) =>
  [NFC_OBLIGATIONS_PATH, identity, filters] as const;

export function useStudentNfcObligations(filters: NfcObligationFilters = {}) {
  const context = useGetAuthorizedContext().data;
  const { userId } = useAuth();
  const identity = context && userId
    ? `${userId}:${context.isPlatformOwner ? 'owner' : 'user'}:${(context.roles ?? []).map(r => `${r.role}@${r.schoolId ?? 0}`).sort().join(',')}`
    : 'pending';
  return useQuery({
    queryKey: getStudentNfcObligationsQueryKey(identity, filters),
    queryFn: ({ signal }) => customFetch<NfcObligationsResponse>(getStudentNfcObligationsUrl(filters), { method: 'GET', signal }),
    enabled: !!context && !!userId,
    refetchOnMount: 'always',
    refetchInterval: 30_000,
    retry: 1,
  });
}

export const nfcStatusLabel: Record<NfcObligationStatus, string> = {
  UNPAID: 'Unpaid', PAID: 'Paid', PENDING: 'Pending', FAILED: 'Failed', EXEMPT: 'Exempt', LEGACY_REVIEW: 'Owner review',
};
export const minorToNaira = (minor: number) => money(minor / 100);

function RowPayment({ row, onPaid }: { row: NfcObligationRow; onPaid: () => void }) {
  const enabled = !!row.subscriptionId && !!row.lastPaymentId && (row.status === 'PENDING' || row.status === 'FAILED');
  const q = useGetStudentSubscriptionPayment(row.subscriptionId ?? 0, row.lastPaymentId ?? 0, {
    query: {
      enabled,
      queryKey: getGetStudentSubscriptionPaymentQueryKey(row.subscriptionId ?? 0, row.lastPaymentId ?? 0),
      refetchInterval: query => isPaymentStatusPolling(query.state.data?.payment) ? 30_000 : false,
    },
  });
  const payment = q.data?.payment;
  const matches = !!payment && payment.paymentId === row.lastPaymentId && payment.subscriptionId === row.subscriptionId
    && payment.schoolId === row.schoolId && (row.reference == null || payment.reference === row.reference);
  const paid = matches && payment?.status === 'PAID';
  useEffect(() => { if (paid) onPaid(); }, [paid, onPaid]);
  if (!enabled) return null;
  if (q.isError) return <p className="mt-2 text-xs text-[hsl(var(--destructive))]">Could not confirm payment status. <button className="font-bold underline" onClick={() => void q.refetch()}>Retry</button></p>;
  if (!matches || !payment) return <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">Checking payment status with the server...</p>;
  const url = safeStudentCheckoutUrl(payment.checkoutUrl);
  return <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]" data-testid={`nfc-payment-status-${row.studentId}-${row.termId}`}>
    Server status: {payment.status.replaceAll('_', ' ').toLowerCase()}. {isPaymentStatusPolling(payment) && 'Refreshing every 30 seconds.'}
    {payment.status === 'PENDING' && url && <> <a className="font-semibold text-[hsl(var(--primary))] underline" href={url} target="_blank" rel="noreferrer">Reopen secure checkout</a></>}
  </p>;
}

export function StudentNfcObligationsPanel({
  studentId, schoolId, canSeeSplit = false, teacherView = false, compact = false, manageReturn = true,
}: { studentId?: number; schoolId?:number; canSeeSplit?: boolean; teacherView?: boolean; compact?: boolean; manageReturn?: boolean }) {
  const qc = useQueryClient();
  const context = useGetAuthorizedContext().data;
  const isOwner = context?.isPlatformOwner === true;
  const query = useStudentNfcObligations({studentId,schoolId});
  const verify = useVerifyStudentSubscriptionPayment();
  const checkout = useMutation({
    mutationFn: ({ subscriptionId, idempotencyKey }: { subscriptionId: number; idempotencyKey: string }) =>
      createStudentSubscriptionCheckout(subscriptionId, { headers: { 'Idempotency-Key': idempotencyKey } }),
  });
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [f, setF] = useState({ schoolId: '', className: '', section: '', sessionId: '', termId: '' });
  const processed = useRef<string | null>(null);
  const inflight = useRef(new Set<number>());
  const rows = useMemo(() => (query.data?.rows ?? []).filter(r => !studentId || r.studentId === studentId), [query.data, studentId]);

  const invalidateAll = () => {
    void qc.invalidateQueries({ queryKey: [NFC_OBLIGATIONS_PATH] });
    void qc.invalidateQueries({ queryKey: ['/api/subscriptions'] });
  };
  const invalidateRef = useRef(invalidateAll);
  invalidateRef.current = invalidateAll;
  const onPaid = useRef(() => invalidateRef.current()).current;

  const opts = (key: 'schoolId' | 'className' | 'section' | 'sessionId' | 'termId') => {
    const seen = new Map<string, string>();
    rows.forEach(r => {
      if (key === 'schoolId') seen.set(String(r.schoolId), r.schoolName);
      if (key === 'className') seen.set(r.className, r.className);
      if (key === 'section') seen.set(r.section, r.section);
      if (key === 'sessionId') seen.set(String(r.sessionId), r.sessionName);
      if (key === 'termId') seen.set(String(r.termId), r.termName);
    });
    return [...seen.entries()];
  };
  const shown = rows.filter(r => (!f.schoolId || String(r.schoolId) === f.schoolId) && (!f.className || r.className === f.className) && (!f.section || r.section === f.section)
    && (!f.sessionId || String(r.sessionId) === f.sessionId) && (!f.termId || String(r.termId) === f.termId));
  const summary = useMemo(() => {
    const s = { eligible: 0, paid: 0, unpaid: 0, pending: 0, failed: 0, legacy: 0, exempt: 0, school: 0, platform: 0, partner: 0, collected: 0 };
    shown.forEach(r => {
      if (r.status !== 'EXEMPT' && r.status !== 'LEGACY_REVIEW') s.eligible += 1;
      if (r.status === 'PAID') s.paid += 1; else if (r.status === 'UNPAID') s.unpaid += 1;
      else if (r.status === 'PENDING') s.pending += 1; else if (r.status === 'FAILED') s.failed += 1;
      else if (r.status === 'LEGACY_REVIEW') s.legacy += 1; else s.exempt += 1;
      s.school += r.schoolAllocatedMinor; s.platform += r.platformAllocatedMinor; s.partner += r.partnerAllocatedMinor;
      if (r.status === 'PAID') s.collected += r.amountMinor;
    });
    return s;
  }, [shown]);

  const verifyReturn = async (attempt: StudentCheckoutAttempt, txId: string, schoolId: number) => {
    const key = attempt.idempotencyKey;
    if (!attempt.payment || inflight.current.has(-1)) return;
    inflight.current.add(-1);
    try {
      const persisted = await getStudentSubscriptionPayment(attempt.payment.subscriptionId, attempt.payment.paymentId);
      if (!checkoutEvidenceMatchesServer(attempt, persisted.payment, schoolId)) throw new Error('The server payment record does not match this checkout. It was not verified.');
      let status = persisted.payment.status;
      if (status === 'PENDING' || status === 'RECONCILIATION_REQUIRED') {
        const verified = await verify.mutateAsync({
          subscriptionId: persisted.payment.subscriptionId,
          data: { paymentReference: persisted.payment.reference, providerTransactionId: txId },
        });
        if (!checkoutEvidenceMatchesServer(attempt, verified.payment, schoolId)) throw new Error('The verification response did not match the persisted payment.');
        status = verified.payment.status;
      }
      setMessage(status === 'PAID'
        ? { tone: 'ok', text: 'The server independently verified this payment. Refreshing the ledger.' }
        : { tone: 'warn', text: `The server reports ${status.replaceAll('_', ' ').toLowerCase()}. It is not marked paid.` });
      invalidateAll();
      void key;
      window.history.replaceState(null, '', window.location.pathname);
    } catch (e) {
      setMessage({ tone: 'error', text: `${e instanceof Error ? e.message : 'Verification failed.'} No new checkout was started.` });
    } finally { inflight.current.delete(-1); }
  };

  useEffect(() => {
    if (!manageReturn || typeof window === 'undefined' || query.isLoading || query.isError || !query.data) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has('tx_ref')) return;
    const cb = parseFlutterwaveReturn(window.location.search);
    const k = `${cb.reference}|${cb.providerTransactionId}`;
    if (processed.current === k) return;
    processed.current = k;
    if (!cb.reference || !cb.providerTransactionId) {
      setMessage({ tone: 'warn', text: 'The Flutterwave return is missing a valid reference or transaction ID. Payment remains unverified.' });
      return;
    }
    const schools = [...new Set(rows.map(r => r.schoolId))];
    for (const schoolId of schools) {
      const attempts = loadStudentCheckoutAttempts(schoolId).filter(a => a.payment?.schoolId === schoolId);
      const match = findCheckoutForFlutterwaveReturn(window.location.search, attempts);
      const row = rows.find(r => r.schoolId === schoolId && r.subscriptionId === match?.attempt.requestedSubscriptionId);
      if (match && row) {
        const attempt = { ...match.attempt, providerTransactionId: match.providerTransactionId };
        saveStudentCheckoutAttempts(schoolId, attempts.map(a => a.idempotencyKey === attempt.idempotencyKey ? attempt : a));
        void verifyReturn(attempt, match.providerTransactionId, schoolId);
        return;
      }
    }
    setMessage({ tone: 'warn', text: 'This return does not match a saved checkout for your visible records. Payment remains unverified.' });
  }, [query.isLoading, query.isError, query.data]);

  const pay = async (row: NfcObligationRow) => {
    if (!row.canPay || isOwner || !row.subscriptionId || inflight.current.has(row.subscriptionId)) return;
    const subscriptionId = row.subscriptionId;
    inflight.current.add(subscriptionId);
    try {
      const attempts = loadStudentCheckoutAttempts(row.schoolId);
      const prior = attempts.find(a => a.requestedSubscriptionId === subscriptionId);
      if (prior && !prior.payment) { setMessage({ tone: 'warn', text: 'The prior checkout outcome is still unknown. Wait for server reconciliation.' }); return; }
      const idempotencyKey = getStudentCheckoutIdempotencyKey(row.schoolId, subscriptionId, window.sessionStorage, undefined, row.status === 'FAILED');
      const pending: StudentCheckoutAttempt = { requestedSubscriptionId: subscriptionId, idempotencyKey, payment: null, providerTransactionId: null };
      const base = attempts.filter(a => a.idempotencyKey !== idempotencyKey);
      saveStudentCheckoutAttempts(row.schoolId, [...base, pending]);
      setMessage(null);
      const res = await checkout.mutateAsync({ subscriptionId, idempotencyKey });
      const p = res.payment;
      if (p.subscriptionId !== subscriptionId || p.schoolId !== row.schoolId) throw new Error('The checkout response did not match the selected record.');
      saveStudentCheckoutAttempts(row.schoolId, [...base, { ...pending, payment: p }]);
      invalidateAll();
      const url = safeStudentCheckoutUrl(p.checkoutUrl);
      if (p.status === 'PENDING' && url) { window.location.assign(url); return; }
      setMessage({ tone: p.status === 'FAILED' ? 'error' : 'warn', text: `The server reports ${p.status.replaceAll('_', ' ').toLowerCase()}. No secure checkout is available.` });
    } catch (e) {
      if(e instanceof ApiError && ((e.status>=400 && e.status<500) || e.status===503)) {
        const saved=loadStudentCheckoutAttempts(row.schoolId);
        saveStudentCheckoutAttempts(row.schoolId,saved.filter(a=>a.requestedSubscriptionId!==subscriptionId || a.payment!=null));
      }
      setMessage({ tone: 'error', text: e instanceof Error ? e.message : 'Checkout could not be started.' });
    } finally { inflight.current.delete(subscriptionId); }
  };

  const sel = 'rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2.5 py-1.5 text-xs font-semibold';
  const filterSel = (key: 'schoolId' | 'className' | 'section' | 'sessionId' | 'termId', label: string) => {
    const o = opts(key);
    if (o.length < 2) return null;
    return <select aria-label={label} className={sel} value={f[key]} onChange={e => setF({ ...f, [key]: e.target.value })} data-testid={`filter-nfc-${key}`}>
      <option value="">{label}: all</option>{o.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
  };
  const showAllocations = canSeeSplit || isOwner;

  return <section className="panel mt-6 overflow-hidden" data-testid="panel-student-nfc">
    <div className="border-b border-[hsl(var(--border))] p-5 md:p-6">
      <div className="flex items-center gap-2 eyebrow"><Nfc size={14} />Automatic NFC subscription</div>
      <h2 className="display-font mt-1 text-xl font-bold">Term NFC fee, shown separately</h2>
      <p className="mt-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]">
        A fixed system fee of {minorToNaira(500000)} per student per term, paid through Flutterwave to the Platform Owner. Schools cannot create or change it.
        {' '}{minorToNaira(200000)} is the school allocation and {minorToNaira(300000)} the platform share.
        {teacherView && ' The school allocation is school revenue; it is not personal Teacher income and not an amount a Teacher pays.'}
        {' '}Terms already paid under the older school NFC charge are kept and flagged for Owner review; no second charge is made.
      </p>
    </div>
    {message && <div role={message.tone === 'error' ? 'alert' : 'status'} className="m-5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-4 py-3 text-sm font-semibold">{message.text}</div>}
    {query.isLoading ? <div className="p-6"><div className="skeleton h-24 rounded-xl" /></div>
      : query.isError ? <ErrorState retry={() => void query.refetch()} />
      : !rows.length ? <EmptyState icon={ShieldCheck} title="No NFC obligations" description="No automatic NFC term fees are recorded for the students you can see." />
      : <>
        <dl className="grid grid-cols-2 gap-3 p-5 text-xs md:grid-cols-5 md:p-6" data-testid="nfc-summary">
          {([['Eligible', summary.eligible], ['Paid', summary.paid], ['Unpaid', summary.unpaid], ['Pending', summary.pending], ['Failed', summary.failed]] as const).map(([l, v]) =>
            <div key={l}><dt className="text-[hsl(var(--muted-foreground))]">{l}</dt><dd className="mt-1 text-lg font-bold tabular-nums">{v}</dd></div>)}
          <div><dt className="text-[hsl(var(--muted-foreground))]">Total collected</dt><dd className="mt-1 font-bold tabular-nums" data-testid="nfc-collected">{minorToNaira(summary.collected)}</dd></div>
          {teacherView && <div><dt className="text-[hsl(var(--muted-foreground))]">School allocation (school revenue)</dt><dd className="mt-1 font-bold tabular-nums" data-testid="nfc-teacher-school-allocation">{minorToNaira(summary.school)}</dd></div>}
          {!compact && <>
            <div><dt className="text-[hsl(var(--muted-foreground))]">Owner review</dt><dd className="mt-1 font-bold tabular-nums">{summary.legacy}</dd></div>
            <div><dt className="text-[hsl(var(--muted-foreground))]">Exempt</dt><dd className="mt-1 font-bold tabular-nums">{summary.exempt}</dd></div>
            {showAllocations && <>
              <div><dt className="text-[hsl(var(--muted-foreground))]">School allocation</dt><dd className="mt-1 font-bold tabular-nums">{minorToNaira(summary.school)}</dd></div>
              <div><dt className="text-[hsl(var(--muted-foreground))]">Platform allocation</dt><dd className="mt-1 font-bold tabular-nums">{minorToNaira(summary.platform)}</dd></div>
              {isOwner && <div><dt className="text-[hsl(var(--muted-foreground))]">Partner actual</dt><dd className="mt-1 font-bold tabular-nums">{minorToNaira(summary.partner)}</dd></div>}
            </>}
          </>}
        </dl>
        {!compact && <div className="flex flex-wrap gap-2 px-5 pb-4 md:px-6">{isOwner && filterSel('schoolId', 'School')}{filterSel('className', 'Class')}{filterSel('section', 'Section')}{filterSel('sessionId', 'Session')}{filterSel('termId', 'Term')}</div>}
        <div className="divide-y divide-[hsl(var(--border)/.7)]">
          {shown.map(r => <article key={`${r.schoolId}-${r.studentId}-${r.termId}`} className="px-5 py-4 md:px-6" data-testid={`nfc-row-${r.studentId}-${r.termId}`}>
            <div className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr_auto] md:items-center">
              <div><div className="text-sm font-bold">{r.studentName}</div>
                <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{r.className} {r.section} · {r.sessionName}, {r.termName}{isOwner && ` · ${r.schoolName}`}</div></div>
              <div className="text-xs"><div className="text-[hsl(var(--muted-foreground))]">NFC fee (system)</div>
                <div className="font-bold tabular-nums">{r.status === 'EXEMPT' || r.status === 'LEGACY_REVIEW' ? minorToNaira(0) : minorToNaira(r.amountMinor)}</div></div>
              {teacherView ? <div /> : <div className="text-xs"><div className="text-[hsl(var(--muted-foreground))]">Ordinary fees + NFC</div>
                <div className="font-bold tabular-nums">{minorToNaira(r.ordinaryFeesMinor)} + {minorToNaira(r.amountMinor)} = {minorToNaira(r.totalMinor)}</div>
                {r.ordinaryFeesAssigned === false && <div className="mt-0.5 text-[hsl(var(--muted-foreground))]" data-testid={`nfc-scheduled-${r.studentId}-${r.termId}`}>Ordinary fees scheduled, not yet invoiced</div>}</div>}
              <div className="flex items-center gap-2"><span title={nfcStatusLabel[r.status]}><StatusPill value={r.status === 'LEGACY_REVIEW' ? 'Owner review' : r.status} /></span>
                {r.canPay && !isOwner && ['UNPAID', 'FAILED'].includes(r.status) && r.subscriptionId && (
                  <Button onClick={() => void pay(r)} disabled={checkout.isPending} testId={`button-pay-nfc-${r.studentId}-${r.termId}`}>
                    <CreditCard size={14} />{r.status === 'FAILED' ? 'Start new checkout' : 'Pay NFC fee'}</Button>)}
              </div>
            </div>
            {r.status === 'LEGACY_REVIEW' && <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">Existing school NFC charge (invoice #{r.legacyInvoiceId}) preserved for Owner review. No additional automatic NFC charge has been created.</p>}
            {r.status === 'EXEMPT' && <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">Exempt for this term. No payment is required.</p>}
            {(r.reference || r.paidAt) && <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">{r.reference && <>Ref <span className="font-mono">{r.reference}</span></>}{r.paidAt && <> · {date(r.paidAt)}</>} · {r.paymentMethod}</p>}
            {showAllocations && r.status === 'PAID' && <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">School {minorToNaira(r.schoolAllocatedMinor)} · Platform {minorToNaira(r.platformAllocatedMinor)}{isOwner && <> · Partner {minorToNaira(r.partnerAllocatedMinor)}</>}</p>}
            {!teacherView && !isOwner && <RowPayment row={r} onPaid={onPaid} />}
          </article>)}
        </div>
      </>}
  </section>;
}

/** Page for /subscriptions return and for roles without the legacy school list. */
export function StudentNfcFamilyPage({ title = 'NFC subscription' }: { title?: string }) {
  return <div className="mx-auto max-w-5xl p-5 md:p-8 fade-up">
    <div className="eyebrow">Fees / NFC</div>
    <h1 className="display-font mt-2 text-3xl font-bold">{title}</h1>
    <StudentNfcObligationsPanel />
  </div>;
}
