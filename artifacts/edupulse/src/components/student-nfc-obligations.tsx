import { useAuth } from '@clerk/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Nfc, ShieldCheck } from 'lucide-react';
import {
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
import { AssistedNfcPayment } from '@/components/assisted-nfc-payment';
import { EmptyState, ErrorState, StatusPill, money, date } from '@/components/shared';
import {
  checkoutEvidenceMatchesServer,
  findCheckoutForFlutterwaveReturn,
  isPaymentStatusPolling,
  loadStudentCheckoutAttempts,
  parseFlutterwaveReturn,
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
  UNPAID: 'Awaiting payment', PAID: 'Paid and verified', PENDING: 'Payment pending verification', FAILED: 'Payment failed', EXEMPT: 'Exempt', LEGACY_REVIEW: 'Owner review',
};
export const nfcFeeStatusLabel = (row: NfcObligationRow) =>
  ['UNPAID', 'FAILED'].includes(row.status) && row.paymentLinkStatus === 'EXPIRED' ? 'Link expired' : nfcStatusLabel[row.status];
export const minorToNaira = (minor: number | undefined) => minor == null ? 'Not available' : money(minor / 100);

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
  return <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]" data-testid={`nfc-payment-status-${row.studentId}-${row.termId}`}>
    Server status: {payment.status.replaceAll('_', ' ').toLowerCase()}. {isPaymentStatusPolling(payment) && 'Refreshing every 30 seconds.'}
  </p>;
}

export function StudentNfcObligationsPanel({
  studentId, schoolId, canSeeSplit = false, teacherView = false, compact = false, manageReturn = true, familyPortal = false,
}: { studentId?: number; schoolId?:number; canSeeSplit?: boolean; teacherView?: boolean; compact?: boolean; manageReturn?: boolean; familyPortal?: boolean }) {
  const qc = useQueryClient();
  const context = useGetAuthorizedContext().data;
  const isOwner = context?.isPlatformOwner === true;
  const platformAdminView = !isOwner && (context?.roles ?? []).some(r=>r.status==='ACTIVE'&&['SCHOOL_ADMIN','ACCOUNTANT'].includes(r.role)&&r.schoolId===schoolId);
  const familyView = !isOwner && (familyPortal || ((context?.roles ?? []).some(r => r.status === 'ACTIVE' && ['PARENT', 'STUDENT'].includes(r.role))
    && !(context?.roles ?? []).some(r => r.status === 'ACTIVE' && ['SCHOOL_ADMIN', 'ACCOUNTANT'].includes(r.role))));
  const query = useStudentNfcObligations({studentId,schoolId});
  const verify = useVerifyStudentSubscriptionPayment();
  const [message, setMessage] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [f, setF] = useState({ schoolId: '', className: '', section: '', sessionId: '', termId: '' });
  const processed = useRef<string | null>(null);
  // Existing-reference reconciliation still needs its concurrency guard.
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
      s.school += r.schoolAllocatedMinor ?? 0; s.platform += r.platformAllocatedMinor ?? 0; s.partner += r.partnerAllocatedMinor ?? 0;
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

  const sel = 'rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2.5 py-1.5 text-xs font-semibold';
  const filterSel = (key: 'schoolId' | 'className' | 'section' | 'sessionId' | 'termId', label: string) => {
    const o = opts(key);
    if (o.length < 2) return null;
    return <select aria-label={label} className={sel} value={f[key]} onChange={e => setF({ ...f, [key]: e.target.value })} data-testid={`filter-nfc-${key}`}>
      <option value="">{label}: all</option>{o.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
  };
  const showAllocations = isOwner;

  return <section className="panel mt-6 overflow-hidden" data-testid="panel-student-nfc">
    <div className="border-b border-[hsl(var(--border))] p-5 md:p-6">
      <div className="flex items-center gap-2 eyebrow"><Nfc size={14} />Retained NFC records</div>
      <h2 className="display-font mt-1 text-xl font-bold">NFC payment and obligation history</h2>
      <p className="mt-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]">
        {platformAdminView?<>School Admins can select one student and academic term for a direct, non-split Flutterwave payment to Yetenia EduCore. The platform fee is fixed at ₦3,200 and is not school-configurable. Checkout stays blocked until the direct LIVE release gates are satisfied.
        {' '}The separate parent-to-school NFC card/subscription fee workflow is unchanged and does not satisfy this platform obligation.
        {' '}The records below retain their original historical amounts and allocations. They are not a new price list or permission to charge again.</>:familyView?<>Existing NFC records retain their original amounts and references. These records are not a new fee announcement.</>:<>
        Historical NFC subscription records retain their original amounts. They are not the current subscription price or permission to collect again.
        {isOwner && <> Current subscription: {minorToNaira(320000)} per student per academic term, paid by the School Admin to the platform. No school allocation, split payment or school subaccount settlement. Eligible BRO commission is {minorToNaira(15000)}, recorded internally under effective-dated approval rules. Provider fees are a separate platform expense. The current term remains free; collection resumes from each school’s actual January 2027 second term. Historical payments and commission rules remain unchanged. These are not verified bank settlements.</>}
        {' '}Terms already paid under the older school NFC charge are kept and flagged for Owner review; no second charge is made.</>}
      </p>
      {!familyView && !teacherView && <div className="mt-3"><AssistedNfcPayment schoolId={schoolId} onCreated={invalidateAll} /></div>}
    </div>
    {message && <div role={message.tone === 'error' ? 'alert' : 'status'} className="m-5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-4 py-3 text-sm font-semibold">{message.text}</div>}
    {query.isLoading ? <div className="p-6"><div className="skeleton h-24 rounded-xl" /></div>
      : query.isError ? <ErrorState retry={() => void query.refetch()} />
      : !rows.length ? <EmptyState icon={ShieldCheck} title="No NFC records" description="No NFC payment records are available for the students you can see." />
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
              {isOwner && <div><dt className="text-[hsl(var(--muted-foreground))]">BRO actual</dt><dd className="mt-1 font-bold tabular-nums">{minorToNaira(summary.partner)}</dd></div>}
            </>}
          </>}
        </dl>
        {!compact && <div className="flex flex-wrap gap-2 px-5 pb-4 md:px-6">{isOwner && filterSel('schoolId', 'School')}{filterSel('className', 'Class')}{filterSel('section', 'Section')}{filterSel('sessionId', 'Session')}{filterSel('termId', 'Term')}</div>}
        <div className="divide-y divide-[hsl(var(--border)/.7)]">
          {shown.map(r => <article key={`${r.schoolId}-${r.studentId}-${r.termId}`} className="px-5 py-4 md:px-6" data-testid={`nfc-row-${r.studentId}-${r.termId}`}>
            <div className="grid gap-3 md:grid-cols-[1.4fr_1fr_1fr_auto] md:items-center">
              <div><div className="text-sm font-bold">{r.studentName}</div>
                <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{r.className} {r.section} · {r.sessionName}, {r.termName}{isOwner && ` · ${r.schoolName}`}</div></div>
               <div className="text-xs"><div className="text-[hsl(var(--muted-foreground))]">Original recorded NFC amount · not current pricing</div>
                 <div className="font-bold tabular-nums">{minorToNaira(r.amountMinor)}</div></div>
               {teacherView ? <div /> : <div className="text-xs"><div className="text-[hsl(var(--muted-foreground))]">Separate school fees</div>
                 <div className="font-bold tabular-nums">{minorToNaira(r.ordinaryFeesMinor)}</div>
                {r.ordinaryFeesAssigned === false && <div className="mt-0.5 text-[hsl(var(--muted-foreground))]" data-testid={`nfc-scheduled-${r.studentId}-${r.termId}`}>Ordinary fees scheduled, not yet invoiced</div>}</div>}
              <div className="flex items-center gap-2"><span title={nfcFeeStatusLabel(r)}><StatusPill value={nfcFeeStatusLabel(r)} /></span>
              </div>
            </div>
            {r.status === 'LEGACY_REVIEW' && <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">Existing school NFC charge (invoice #{r.legacyInvoiceId}) preserved for Owner review.</p>}
            {r.status === 'EXEMPT' && <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">Exempt for this term. No payment is required.</p>}
            {(r.reference || r.paidAt) && <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">{r.reference && <>Ref <span className="font-mono">{r.reference}</span></>}{r.paidAt && <> · {date(r.paidAt)}</>} · {r.paymentMethod}</p>}
             {showAllocations && r.status === 'PAID' && <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Historical allocation, unchanged: School {minorToNaira(r.schoolAllocatedMinor)} · Platform {minorToNaira(r.platformAllocatedMinor)}{isOwner && <> · BRO {minorToNaira(r.partnerAllocatedMinor)}</>}</p>}
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
