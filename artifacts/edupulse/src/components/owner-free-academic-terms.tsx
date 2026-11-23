import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarCheck2, History, RefreshCw, ShieldAlert } from 'lucide-react';
import {
  getGetMyStudentPlatformAccessQueryKey,
  getGetMySubscriptionEnforcementQueryKey,
  getGetOwnerFreeAcademicTermsQueryKey,
  getGetSchoolBillingContextQueryKey,
  getGetSubscriptionEnforcementOverviewQueryKey,
  getListSchoolsQueryKey,
  getListSubscriptionsQueryKey,
  useChangeOwnerFreeAcademicTerm,
  useGetOwnerFreeAcademicTerms,
  useListSchools,
} from '@workspace/api-client-react';
import type { GetOwnerFreeAcademicTerms200, GetOwnerFreeAcademicTerms200TermsItem, School } from '@workspace/api-client-react';
import { Button, Modal, cx } from '@/components/shared';

type Term = GetOwnerFreeAcademicTerms200TermsItem;
export type FreeTermAction = 'grant' | 'suspend';
export const REASON_MIN = 5;
export const REASON_MAX = 500;

export const STATUS_LABEL: Record<Term['status'], string> = {
  TRIAL_GRANTED: 'Trial Granted', ACTIVE: 'Active', COMPLETED: 'Completed',
  PAYMENT_REQUIRED: 'Payment Required', PAID: 'Paid', SUSPENDED: 'Suspended',
};

/** Calendar dates are shown as saved (YYYY-MM-DD); never converted through a local timezone. */
export function calendarDate(v?: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v ?? '');
  if (!m) return '—';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const mi = Number(m[2]) - 1;
  if (mi < 0 || mi > 11) return '—';
  return `${m[3]} ${months[mi]} ${m[1]}`;
}
export const isoDay = (v: string) => v.slice(0, 10);

export function lagosTimestamp(v?: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(d) + ' WAT';
}

export const reasonValid = (r: string) => { const t = r.trim(); return t.length >= REASON_MIN && t.length <= REASON_MAX; };
export const canGrant = (ready: boolean, t?: Term) => !!t && ready && t.grantId == null && !t.calendarChanged && t.status !== 'COMPLETED';
export const canSuspend = (ready: boolean, t?: Term) => !!t && ready && t.grantId != null && (t.status === 'ACTIVE' || t.status === 'TRIAL_GRANTED');
export const termLabel = (t: Term) => t.calendarChanged && t.grantId != null ? 'Suspended · needs review' : STATUS_LABEL[t.status] ?? t.status;

const historyLabel = (s: string) => (STATUS_LABEL as Record<string, string>)[s] ?? s.replaceAll('_', ' ').toLowerCase();

const tone = (t: Term) => t.calendarChanged && t.grantId != null ? 'warn'
  : t.status === 'ACTIVE' || t.status === 'TRIAL_GRANTED' ? 'ok'
  : t.status === 'SUSPENDED' || t.status === 'PAYMENT_REQUIRED' ? 'bad' : 'muted';
const toneClass = { ok: 'bg-[hsl(157_37%_43%/.15)] text-[hsl(157_37%_30%)]', warn: 'bg-[hsl(35_83%_53%/.15)] text-[hsl(28_73%_40%)]', bad: 'bg-[hsl(var(--destructive)/.12)] text-[hsl(var(--destructive))]', muted: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]' };

function TermStatus({ term }: { term: Term }) {
  return <span data-testid={`free-term-status-${term.id}`} className={cx('inline-flex rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider', toneClass[tone(term)])}>{termLabel(term)}</span>;
}

export type Snapshot = { action: FreeTermAction; schoolId: number; schoolName: string; sessionId: number; sessionName: string; termId: number; termName: string; startDate: string; endDate: string; reason: string; grantId: number | null; status: Term['status'] };

export const snapshotStillValid = (s: Snapshot, t?: Term) => !!t && t.id === s.termId && t.sessionId === s.sessionId
  && isoDay(t.startDate) === s.startDate && isoDay(t.endDate) === s.endDate && t.status === s.status && t.grantId === s.grantId;

export function PolicyNotice() {
  return (
    <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.6)] p-4 text-xs leading-5" data-testid="free-term-policy">
      <div className="mb-1 font-bold text-[hsl(var(--foreground))]">What a free academic term is, and is not</div>
      <ul className="list-disc space-y-0.5 pl-4 text-[hsl(var(--muted-foreground))]">
        <li>Current free-launch policy applies. School-owned January 2027 second-term gates are unchanged by this control.</li>
        <li>A grant is a free entitlement, not a payment. It is never shown as Paid, does not create or alter invoices or receipts, and does not accrue BRO commission.</li>
        <li>It covers exactly one school-owned term and expires at the saved end date. It does not extend and does not grant the next term.</li>
        <li>Manual school locks and security locks remain separate and are not lifted by a grant.</li>
        <li>Suspending a grant stops only the free entitlement. Existing verified paid access is not revoked. A grant does not activate or unlock an NFC card.</li>
        <li>Payment Required describes a term's normal obligation; checkout still requires that school's calendar, approved pricing and release gates.</li>
      </ul>
    </div>
  );
}

/** Owner-only. Mount only for a verified Platform Owner. */
export function OwnerFreeAcademicTerms() {
  const schools = useListSchools(undefined, { query: { queryKey: getListSchoolsQueryKey(), staleTime: 60_000 } });
  const [schoolId, setSchoolId] = useState<number | null>(null);
  const list: School[] = schools.data ?? [];
  const school = list.find(s => s.id === schoolId);
  useEffect(() => {
    // The Owner component may mount after sign-in/context loading, after the
    // browser's initial fragment lookup. Restore the requested destination.
    if (window.location.hash === '#free-academic-terms') document.getElementById('free-academic-terms')?.focus();
  }, []);

  return (
    <section id="free-academic-terms" tabIndex={-1} className="panel mt-6 min-w-0 scroll-mt-6 p-5 md:p-6" data-testid="owner-free-academic-terms" aria-labelledby="free-terms-heading">
      <div className="mb-4 flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[hsl(var(--accent)/.18)] text-[hsl(var(--accent-foreground))]"><CalendarCheck2 size={18} /></span>
        <div className="min-w-0">
          <div className="eyebrow">Platform Owner · free entitlement</div>
          <h2 id="free-terms-heading" className="display-font text-xl font-bold">Free academic terms</h2>
          <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Grant or suspend one school's free term. Free is never verified money.</p>
        </div>
      </div>
      <PolicyNotice />
      <div className="mt-5">
        {schools.isLoading ? <div className="skeleton h-11 rounded-xl" data-testid="free-term-schools-loading" />
          : schools.isError ? <InlineError text="Schools could not be loaded." onRetry={() => void schools.refetch()} testId="free-term-schools-error" />
          : !list.length ? <p className="text-sm" data-testid="free-term-schools-empty">No schools exist yet.</p>
          : (
            <label className="block text-xs font-bold">School
              <select className="mt-1.5" value={schoolId ?? ''} data-testid="select-free-term-school"
                onChange={e => setSchoolId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Select any school</option>
                {list.map(s => <option key={s.id} value={s.id}>{s.name} · {s.code}</option>)}
              </select>
            </label>
          )}
      </div>
      {school && <SchoolFreeTerms key={school.id} school={school} />}
    </section>
  );
}

function InlineError({ text, onRetry, testId }: { text: string; onRetry: () => void; testId: string }) {
  return (
    <div role="alert" data-testid={testId} className="flex flex-wrap items-center gap-3 rounded-xl border border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--destructive)/.06)] px-4 py-3 text-sm">
      <span>{text}</span>
      <Button variant="outline" onClick={onRetry} testId={`${testId}-retry`}><RefreshCw size={14} />Retry</Button>
    </div>
  );
}

function SchoolFreeTerms({ school }: { school: School }) {
  const qc = useQueryClient();
  const params = { schoolId: school.id };
  const key = getGetOwnerFreeAcademicTermsQueryKey(params);
  const query = useGetOwnerFreeAcademicTerms(params, { query: { enabled: school.id > 0, queryKey: key, staleTime: 0, refetchInterval: 60_000 } });
  const change = useChangeOwnerFreeAcademicTerm();
  const data: GetOwnerFreeAcademicTerms200 | undefined = query.data && query.data.schoolId === school.id ? query.data : undefined;
  const ready = data?.ready === true;
  const terms = useMemo(() => data?.terms ?? [], [data]);
  const sessions = useMemo(() => {
    const m = new Map<number, string>();
    for (const t of terms) if (!m.has(t.sessionId)) m.set(t.sessionId, t.sessionName);
    return [...m.entries()];
  }, [terms]);

  const [sel, setSel] = useState<{ sessionId: number | null; termId: number | null }>({ sessionId: null, termId: null });
  const [reason, setReason] = useState('');
  const [review, setReview] = useState<Snapshot | null>(null);
  const [ack, setAck] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const inFlight = useRef(false);

  const sessionTerms = terms.filter(t => t.sessionId === sel.sessionId);
  const term = sessionTerms.find(t => t.id === sel.termId);
  const writable = ready && !needsRefresh && !pending;

  const pickSession = (v: string) => { setSel({ sessionId: v ? Number(v) : null, termId: null }); setReview(null); setNotice(null); };
  const pickTerm = (v: string) => { setSel(s => ({ ...s, termId: v ? Number(v) : null })); setReview(null); setNotice(null); };

  const open = (action: FreeTermAction) => {
    if (!term || !writable || !reasonValid(reason)) return;
    if (action === 'grant' ? !canGrant(ready, term) : !canSuspend(ready, term)) return;
    setAck(false);
    setReview({ action, schoolId: school.id, schoolName: school.name, sessionId: term.sessionId, sessionName: term.sessionName, termId: term.id, termName: term.name, startDate: isoDay(term.startDate), endDate: isoDay(term.endDate), reason: reason.trim(), grantId: term.grantId, status: term.status });
  };

  const refresh = async () => {
    const r = await query.refetch();
    if (!r.isError) { setNeedsRefresh(false); setNotice(null); }
  };

  const invalidateAll = () => Promise.all([
    qc.invalidateQueries({ queryKey: key }),
    qc.invalidateQueries({ queryKey: getListSubscriptionsQueryKey() }),
    qc.invalidateQueries({ queryKey: getGetSchoolBillingContextQueryKey() }),
    qc.invalidateQueries({ queryKey: getGetSubscriptionEnforcementOverviewQueryKey() }),
    qc.invalidateQueries({ queryKey: getGetMySubscriptionEnforcementQueryKey() }),
    qc.invalidateQueries({ queryKey: getGetMyStudentPlatformAccessQueryKey() }),
  ]);

  const submit = async () => {
    if (!review || !ack || inFlight.current) return;
    if (!snapshotStillValid(review, terms.find(t => t.id === review.termId))) {
      setReview(null);
      setNotice({ tone: 'warn', text: 'This term changed after you opened the review. Nothing was sent. Review the current calendar and try again.' });
      return;
    }
    inFlight.current = true; setPending(true);
    const { action, schoolId, sessionId, termId, startDate, endDate, reason: r } = review;
    try {
      await change.mutateAsync({ action, data: { schoolId, sessionId, termId, startDate, endDate, reason: r, confirmed: true } });
      setReview(null); setReason('');
      setNotice({ tone: 'ok', text: action === 'grant' ? `Free academic term granted for ${review.termName}. It ends on ${calendarDate(endDate)} and is not a payment.` : `Free academic term suspended for ${review.termName}.` });
      void invalidateAll();
    } catch (e) {
      setReview(null); setNeedsRefresh(true);
      const msg = e instanceof Error && e.message ? `${e.message} ` : '';
      setNotice({ tone: 'error', text: `${msg}The outcome is not confirmed and nothing was retried. Refresh status before trying again.` });
      void invalidateAll();
    } finally {
      inFlight.current = false; setPending(false);
    }
  };

  if (query.isLoading) return <div className="mt-5 space-y-2" data-testid="free-term-loading"><div className="skeleton h-11 rounded-xl" /><div className="skeleton h-24 rounded-xl" /></div>;
  if (query.isError || !data) return <div className="mt-5"><InlineError text={`Free-term calendar for ${school.name} could not be loaded.`} onRetry={() => void query.refetch()} testId="free-term-error" /></div>;

  const trimmedLen = reason.trim().length;
  const grantOk = canGrant(ready, term) && reasonValid(reason) && writable;
  const suspendOk = canSuspend(ready, term) && reasonValid(reason) && writable;

  return (
    <div className="mt-5 min-w-0 space-y-5" data-testid={`free-term-school-${school.id}`}>
      {!ready && (
        <div role="status" data-testid="free-term-not-ready" className="flex gap-2 rounded-xl border border-[hsl(35_83%_53%/.4)] bg-[hsl(35_83%_53%/.1)] px-4 py-3 text-sm">
          <ShieldAlert size={16} className="mt-0.5 shrink-0" />
          <span>Free-term storage has not been applied to this environment yet. The calendar below is read-only and grant or suspend actions are disabled until the schema is applied.</span>
        </div>
      )}
      {notice && (
        <div role={notice.tone === 'error' ? 'alert' : 'status'} data-testid="free-term-notice"
          className={cx('flex flex-wrap items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold', notice.tone === 'ok' ? 'bg-[hsl(157_37%_43%/.12)]' : notice.tone === 'warn' ? 'bg-[hsl(35_83%_53%/.12)]' : 'bg-[hsl(var(--destructive)/.08)] text-[hsl(var(--destructive))]')}>
          <span className="min-w-0 flex-1">{notice.text}</span>
          {needsRefresh && <Button variant="outline" onClick={() => void refresh()} testId="button-free-term-refresh"><RefreshCw size={14} />Refresh status</Button>}
        </div>
      )}

      {!terms.length ? (
        <p className="rounded-xl border border-dashed border-[hsl(var(--border))] p-5 text-sm" data-testid="free-term-empty">{school.name} has no academic sessions or terms yet. The school must set up its own calendar first.</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-bold">Academic session
              <select className="mt-1.5" value={sel.sessionId ?? ''} onChange={e => pickSession(e.target.value)} data-testid="select-free-term-session" disabled={pending}>
                <option value="">Select session</option>
                {sessions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label className="block text-xs font-bold">Term
              <select className="mt-1.5" value={sel.termId ?? ''} onChange={e => pickTerm(e.target.value)} data-testid="select-free-term-term" disabled={pending || sel.sessionId == null}>
                <option value="">{sel.sessionId == null ? 'Select a session first' : 'Select term'}</option>
                {sessionTerms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
          </div>

          <ul className="divide-y divide-[hsl(var(--border)/.6)] rounded-xl border border-[hsl(var(--border))]" data-testid="free-term-calendar" aria-label={`${school.name} academic calendar`}>
            {terms.map(t => (
              <li key={t.id} className={cx('flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center', t.id === sel.termId && 'bg-[hsl(var(--primary)/.05)]')} data-testid={`free-term-row-${t.id}`}>
                <div className="min-w-0 flex-1">
                  <div className="font-bold">{t.sessionName} · {t.name}</div>
                  <div className="text-xs text-[hsl(var(--muted-foreground))]">{calendarDate(t.startDate)} to {calendarDate(t.endDate)}</div>
                  {t.calendarChanged && t.grantId != null && <div className="mt-1 text-xs font-semibold text-[hsl(28_73%_40%)]" data-testid={`free-term-calendar-changed-${t.id}`}>School calendar dates changed after this grant. It is treated as suspended and needs review; it was not silently extended.</div>}
                </div>
                <TermStatus term={t} />
              </li>
            ))}
          </ul>

          {term && (
            <div className="space-y-3 rounded-xl border border-[hsl(var(--border))] p-4" data-testid="free-term-action-panel">
              <div className="text-sm"><span className="font-bold">{term.sessionName} · {term.name}</span> <span className="text-[hsl(var(--muted-foreground))]">· {calendarDate(term.startDate)} to {calendarDate(term.endDate)}</span></div>
              <label className="block text-xs font-bold">Reason (required, {REASON_MIN}–{REASON_MAX} characters · {trimmedLen}/{REASON_MAX})
                <textarea rows={3} maxLength={REASON_MAX + 50} value={reason} onChange={e => setReason(e.target.value)} disabled={!ready || pending} className="mt-1.5" data-testid="input-free-term-reason" />
              </label>
              {reason.length > 0 && !reasonValid(reason) && <p className="text-xs text-[hsl(var(--destructive))]" data-testid="free-term-reason-error">Reason must be {REASON_MIN} to {REASON_MAX} characters after trimming.</p>}
              {term.grantId != null && <p className="text-xs text-[hsl(var(--muted-foreground))]" data-testid="free-term-existing-grant">This term already has grant #{term.grantId}. A second grant is not allowed.</p>}
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button onClick={() => open('grant')} disabled={!grantOk} testId="button-review-free-term-grant" className="w-full sm:w-auto">Review Grant Free Academic Term</Button>
                <Button variant="danger" onClick={() => open('suspend')} disabled={!suspendOk} testId="button-review-free-term-suspend" className="w-full sm:w-auto">Review Suspend</Button>
              </div>
            </div>
          )}
        </>
      )}

      <div data-testid="free-term-history">
        <div className="mb-2 flex items-center gap-2 text-sm font-bold"><History size={15} />Grant history · {school.name}</div>
        <p className="mb-2 text-xs text-[hsl(var(--muted-foreground))]">Immutable record. Entries cannot be edited or removed. Times in Africa/Lagos (WAT).</p>
        {!data.history.length ? <p className="text-sm" data-testid="free-term-history-empty">No free-term events recorded for this school.</p> : (
          <ol className="divide-y divide-[hsl(var(--border)/.6)] text-sm">
            {data.history.map(h => {
              const t = terms.find(x => x.id === h.termId);
              return (
                <li key={h.id} className="min-w-0 break-words py-2" data-testid={`free-term-history-${h.id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-bold">{historyLabel(h.status)}</span><span className="text-xs">{lagosTimestamp(h.createdAt)}</span></div>
                  <div className="text-xs">{h.actorName} (user #{h.actorUserId}) · {school.name} · {t ? `${t.sessionName} · ${t.name}` : `term #${h.termId}`} · grant #{h.grantId}</div>
                  <div className="text-xs">Dates {calendarDate(h.startDate)} to {calendarDate(h.endDate)}</div>
                  <div className="text-xs">Reason: {h.reason}</div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      {review && (
        <Modal title={review.action === 'grant' ? 'Confirm Grant Free Academic Term' : 'Confirm Suspend'} eyebrow="Platform Owner · explicit confirmation" onClose={() => { if (!pending) setReview(null); }}>
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2" data-testid="free-term-confirm-summary">
            <div><dt className="eyebrow">School</dt><dd className="font-bold">{review.schoolName}</dd></div>
            <div><dt className="eyebrow">Session</dt><dd className="font-bold">{review.sessionName}</dd></div>
            <div><dt className="eyebrow">Term</dt><dd className="font-bold">{review.termName}</dd></div>
            <div><dt className="eyebrow">Dates</dt><dd className="font-bold">{calendarDate(review.startDate)} to {calendarDate(review.endDate)}</dd></div>
            <div className="sm:col-span-2"><dt className="eyebrow">Reason</dt><dd className="break-words">{review.reason}</dd></div>
          </dl>
          <p className="mt-4 text-xs leading-5" data-testid="free-term-confirm-scope">
            {review.action === 'grant'
              ? 'Scope: this school and this term only. Not a payment; invoices and receipts are unchanged and no BRO commission accrues. It expires on the saved end date and does not grant the next term. Manual school and security locks remain in force.'
              : 'Scope: this school and this term only. The free entitlement stops; no payment, invoice or receipt is created or reversed. Manual school and security locks are unaffected.'}
          </p>
          <label className="mt-4 flex items-start gap-2 text-xs font-semibold">
            <input type="checkbox" className="mt-0.5 h-4 w-4 w-auto" checked={ack} onChange={e => setAck(e.target.checked)} disabled={pending} data-testid="checkbox-free-term-confirm" />
            I have reviewed this exact school, term, dates and reason.
          </label>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={() => setReview(null)} disabled={pending} testId="button-free-term-cancel">Cancel</Button>
            <Button variant={review.action === 'grant' ? 'primary' : 'danger'} onClick={() => void submit()} disabled={!ack || pending} testId="button-free-term-confirm">
              {pending ? 'Sending...' : review.action === 'grant' ? 'Grant Free Academic Term' : 'Suspend'}
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
