import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Lock, LockOpen, History } from 'lucide-react';
import {
  getGetSubscriptionEnforcementOverviewQueryKey,
  getGetMySubscriptionEnforcementQueryKey,
  getGetSchoolSubscriptionAuditQueryKey,
  useGetSubscriptionEnforcementOverview,
  useGetSchoolSubscriptionAudit,
  useLockSchoolSubscriptions,
  useUnlockSchoolSubscriptions,
} from '@workspace/api-client-react';
import type { SchoolEnforcementActionResult, SchoolSubscriptionSummary } from '@workspace/api-client-react';
import { PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, Modal, useTenant, useSchoolAdminAccess, money, date } from '@/components/shared';

export const REASON_MAX = 500;
export const FILTERS = ['All', 'Paid', 'Unpaid', 'Overdue', 'In Grace', 'Partially Paid', 'School Locked', 'School Active'] as const;
export type Filter = typeof FILTERS[number];
export type EnforcementAction = 'LOCK' | 'UNLOCK';

const billingKnown = (s: SchoolSubscriptionSummary) => s.status !== 'UNAVAILABLE' && !!s.termId && (s.studentsTotal ?? 0) > 0 && s.studentsPaid !== undefined;
export const isManualLocked = (s: SchoolSubscriptionSummary) => s.schoolEnforcementStatus === 'LOCKED';

export function matchesFilter(s: SchoolSubscriptionSummary, f: Filter, now = Date.now()): boolean {
  const known = billingKnown(s);
  const total = s.studentsTotal ?? 0;
  const paid = s.studentsPaid ?? 0;
  const isPaid = known && paid >= total;
  const unpaid = known && paid < total;
  const grace = !!s.inGracePeriod;
  switch (f) {
    case 'All': return true;
    case 'Paid': return isPaid;
    case 'Unpaid': return unpaid;
    case 'Partially Paid': return known && paid > 0 && paid < total;
    case 'In Grace': return grace;
    case 'School Locked': return s.schoolEnforcementStatus === 'LOCKED';
    case 'School Active': return s.schoolEnforcementStatus === 'ACTIVE';
    case 'Overdue': return unpaid && !grace && !!s.enforcementDate && new Date(s.enforcementDate).getTime() < now;
  }
}

export type SelectionSnapshot = { schoolId: number; schoolName: string; status: 'ACTIVE' | 'LOCKED'; manualVersion: number };
export const snapshotOf = (s: SchoolSubscriptionSummary): SelectionSnapshot => ({ schoolId: s.schoolId, schoolName: s.schoolName, status: s.schoolEnforcementStatus, manualVersion: s.manualVersion });
export const snapshotMatches = (snap: SelectionSnapshot, s?: SchoolSubscriptionSummary) =>
  !!s && s.schoolEnforcementStatus === snap.status && s.manualVersion === snap.manualVersion;
export const actionAllowed = (action: EnforcementAction, snaps: SelectionSnapshot[]) =>
  snaps.length > 0 && snaps.every(s => s.status === (action === 'LOCK' ? 'ACTIVE' : 'LOCKED'));
export const toActionBody = (snaps: SelectionSnapshot[], reason: string) => {
  const r = reason.trim();
  return { confirmed: true as const, schools: snaps.map(s => ({ schoolId: s.schoolId, expectedVersion: s.manualVersion })), ...(r ? { reason: r } : {}) };
};

export function formatLagosTimestamp(v?: string | null): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(d) + ' WAT';
}
const mm = (v?: number) => (v === undefined ? '—' : money(v / 100));
const n = (v?: number) => (v === undefined ? '—' : v.toLocaleString('en-NG'));

type Outcome = { snap: SelectionSnapshot; item?: SchoolEnforcementActionResult };

function AuditPanel({ schoolId, name, onClose }: { schoolId: number; name?: string; onClose?: () => void }) {
  const q = useGetSchoolSubscriptionAudit({ schoolId }, { query: { queryKey: getGetSchoolSubscriptionAuditQueryKey({ schoolId }), enabled: !!schoolId } });
  const events = q.data ?? [];
  return (
    <section className="panel mt-5 p-5" data-testid="audit-panel" aria-label="Enforcement audit">
      <div className="flex items-center justify-between gap-2">
        <h2 className="display-font text-lg font-bold">Audit history{name ? ` · ${name}` : ''}</h2>
        {onClose && <Button variant="quiet" onClick={onClose} testId="button-close-audit">Close</Button>}
      </div>
      <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Read-only record of the last 50 events. Entries cannot be edited.</p>
      {q.isLoading ? <div className="mt-3 h-16 animate-pulse rounded-xl bg-[hsl(var(--secondary))]" data-testid="audit-loading" />
        : q.isError ? <div role="alert" className="mt-3 text-sm" data-testid="audit-error">Audit history could not be loaded. <button type="button" className="font-bold underline" onClick={() => void q.refetch()} data-testid="button-retry-audit">Retry</button></div>
        : !events.length ? <p className="mt-3 text-sm" data-testid="audit-empty">No enforcement events recorded for this school yet.</p>
        : (
          <ul className="mt-3 divide-y divide-[hsl(var(--border)/.6)] text-sm">
            {events.map(e => (
              <li key={e.id} className="min-w-0 break-words py-2" data-testid={`audit-event-${e.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-bold">{e.action}</span><span className="text-xs">{formatLagosTimestamp(e.timestamp)}</span></div>
                <div className="text-xs">{e.previousState ?? 'none'} to {e.newState ?? 'none'} · actor {e.actorUserId ?? 'system'}{e.studentId ? ` · student #${e.studentId}` : ''}</div>
                {e.reason && <div className="text-xs">Reason: {e.reason}</div>}
                <div className="text-[10px] text-[hsl(var(--muted-foreground))]">Request {e.requestId}</div>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

export function SubscriptionEnforcementPage() {
  const { schoolId } = useTenant();
  const { isPlatformOwner } = useSchoolAdminAccess();
  const qc = useQueryClient();
  const params = isPlatformOwner ? undefined : { schoolId };
  const query = useGetSubscriptionEnforcementOverview(params, {
    query: {
      enabled: isPlatformOwner || !!schoolId,
      queryKey: getGetSubscriptionEnforcementOverviewQueryKey(params),
      staleTime: 15_000, refetchOnMount: 'always', refetchInterval: 30_000,
    },
  });
  const lock = useLockSchoolSubscriptions();
  const unlock = useUnlockSchoolSubscriptions();
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const [filter, setFilter] = useState<Filter>('All');
  const [selected, setSelected] = useState<Record<number, SelectionSnapshot>>({});
  const [confirming, setConfirming] = useState<{ action: EnforcementAction; snaps: SelectionSnapshot[] } | null>(null);
  const [reason, setReason] = useState('');
  const [results, setResults] = useState<{ action: EnforcementAction; items: Outcome[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [auditId, setAuditId] = useState<number | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  // Any change to a selected school's manual state/version clears everything. Payment changes alone do not.
  useEffect(() => {
    if (!rows.length) return;
    const byId = new Map(rows.map(r => [r.schoolId, r]));
    const watched = [...Object.values(selected), ...(confirming?.snaps ?? [])];
    if (watched.some(s => !snapshotMatches(s, byId.get(s.schoolId)))) {
      setSelected({}); setConfirming(null); setReason('');
      setNotice('A selected school changed state, so your selection was cleared. Nothing was sent. Review and select again.');
    }
  }, [rows, selected, confirming]);

  const shown = rows.filter(r => matchesFilter(r, filter));
  const snaps = Object.values(selected);
  const count = snaps.length;
  const toggle = (r: SchoolSubscriptionSummary) => {
    setNotice(null);
    setSelected(cur => {
      const next = { ...cur };
      if (next[r.schoolId]) delete next[r.schoolId]; else next[r.schoolId] = snapshotOf(r);
      return next;
    });
  };
  const openFor = (action: EnforcementAction, list: SelectionSnapshot[]) => {
    if (pending || !actionAllowed(action, list)) return;
    setError(null); setReason(''); setConfirming({ action, snaps: list });
  };
  const submit = async () => {
    if (!confirming || inFlight.current) return;
    if (reason.length > REASON_MAX) return;
    const byId = new Map(rows.map(r => [r.schoolId, r]));
    if (confirming.snaps.some(s => !snapshotMatches(s, byId.get(s.schoolId)))) {
      setSelected({}); setConfirming(null); setNotice('The school state changed before confirmation. Nothing was sent.');
      return;
    }
    const { action, snaps: sent } = confirming;
    inFlight.current = true; setPending(true); setError(null);
    let settled = false;
    try {
      const data = toActionBody(sent, reason);
      const res = action === 'LOCK' ? await lock.mutateAsync({ data }) : await unlock.mutateAsync({ data });
      settled = true;
      setResults({ action, items: sent.map(snap => ({ snap, item: res.find(i => i.schoolId === snap.schoolId) })) });
      setSelected({}); setConfirming(null); setReason('');
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'The request failed. No school is assumed changed.');
    } finally {
      inFlight.current = false; setPending(false);
      // Refresh on every settlement, including errors, since a mixed or lost response may have changed state.
      void qc.invalidateQueries({ queryKey: getGetSubscriptionEnforcementOverviewQueryKey(params) });
      void qc.invalidateQueries({ queryKey: getGetMySubscriptionEnforcementQueryKey() });
      for (const s of sent) void qc.invalidateQueries({ queryKey: getGetSchoolSubscriptionAuditQueryKey({ schoolId: s.schoolId }) });
      void settled;
    }
  };
  const describe = (action: EnforcementAction, o: Outcome) => {
    if (!o.item) return 'No result returned by the server. Refresh before retrying.';
    if (o.item.state === 'FAILED') return `Failed: ${o.item.error ?? 'this school was not changed'}. Refresh and retry.`;
    if (!o.item.changed) return `No change; school was already ${o.item.state === 'LOCKED' ? 'locked' : 'active'}.`;
    return action === 'LOCK' ? 'School locked.' : 'School unlocked.';
  };
  const label = confirming?.action === 'LOCK' ? 'Lock School' : 'Unlock School';
  const own = !isPlatformOwner && schoolId ? schoolId : null;

  return (
    <div className="fade-up min-w-0">
      <PageHeading eyebrow="Financials / Enforcement" title="Term Enforcement."
        description="Two separate controls. Automatic enforcement restricts only unpaid students and their own cards or child-specific parent access, and never locks teachers or readers. Manual school lock is a deliberate Platform Owner action."
        action={<Link href="/subscriptions" className="text-xs font-bold text-[hsl(var(--primary))] underline" data-testid="link-back-subscriptions">Back to subscriptions</Link>} />
      {!isPlatformOwner && <div role="status" className="mb-5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-4 py-3 text-sm" data-testid="enforcement-read-only">Read-only overview. Only the Platform Owner can lock or unlock a school.</div>}
      {notice && <div role="status" data-testid="enforcement-notice" className="mb-5 rounded-xl border border-[hsl(35_83%_53%/.4)] bg-[hsl(35_83%_53%/.1)] px-4 py-3 text-sm font-semibold">{notice}</div>}
      {results && (
        <div className="panel mb-5 p-5" data-testid="action-results" role="status">
          <div className="flex items-center justify-between"><h2 className="display-font text-lg font-bold">{results.action === 'LOCK' ? 'Lock results' : 'Unlock results'}</h2><Button variant="quiet" onClick={() => setResults(null)} testId="button-dismiss-results">Dismiss</Button></div>
          <ul className="mt-3 divide-y divide-[hsl(var(--border)/.6)] text-sm">
            {results.items.map(o => (
              <li key={o.snap.schoolId} data-testid={`result-school-${o.snap.schoolId}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="font-bold">{o.snap.schoolName}</span>
                <span className="text-xs">{describe(results.action, o)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Filter schools">
        {FILTERS.map(f => (
          <button key={f} type="button" onClick={() => setFilter(f)} aria-pressed={filter === f} data-testid={`filter-${f.toLowerCase().replaceAll(' ', '-')}`}
            className={`rounded-full border px-3 py-1.5 text-xs font-bold ${filter === f ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))]'}`}>{f}</button>
        ))}
        {isPlatformOwner && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="danger" disabled={pending || !actionAllowed('LOCK', snaps)} onClick={() => openFor('LOCK', snaps)} testId="button-lock-selected"><Lock size={14} />Lock selected ({count})</Button>
            <Button variant="outline" disabled={pending || !actionAllowed('UNLOCK', snaps)} onClick={() => openFor('UNLOCK', snaps)} testId="button-unlock-selected"><LockOpen size={14} />Unlock selected ({count})</Button>
          </div>
        )}
      </div>
      {isPlatformOwner && count > 1 && !actionAllowed('LOCK', snaps) && !actionAllowed('UNLOCK', snaps) && (
        <p role="status" data-testid="mixed-selection-hint" className="mb-4 text-xs font-semibold">Selection mixes active and locked schools, so bulk actions are disabled. Select only active schools to lock, or only locked schools to unlock.</p>
      )}
      {query.isLoading ? <SkeletonPage /> : query.isError ? <ErrorState retry={() => query.refetch()} /> : !shown.length ? (
        <div className="panel"><EmptyState icon={Lock} title="No schools match" description="No school matches this filter for the current data." /></div>
      ) : (
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          {shown.map(r => (
            <article key={r.schoolId} className="panel min-w-0 p-5" data-testid={`enforcement-school-${r.schoolId}`}>
              <div className="flex items-start gap-3">
                {isPlatformOwner && <input type="checkbox" className="mt-1 h-4 w-4" aria-label={`Select ${r.schoolName}`} disabled={pending} checked={!!selected[r.schoolId]} onChange={() => toggle(r)} data-testid={`select-school-${r.schoolId}`} />}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1">
                      <h3 className="display-font break-words text-lg font-bold">{r.schoolName}</h3>
                      <div className="mt-1 break-words text-xs text-[hsl(var(--muted-foreground))]">Registration/code: {r.registrationNumber ?? '—'}</div>
                      <div className="mt-1 break-words text-xs text-[hsl(var(--muted-foreground))]">{[r.sessionName, r.termName ?? 'No current term'].filter(Boolean).join(' · ')}</div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-end">
                      <div className="flex items-center gap-1 text-xs"><span>School</span><StatusPill value={r.schoolEnforcementStatus} /></div>
                      <div className="flex items-center gap-1 text-xs"><span>Students</span><StatusPill value={r.state === 'LOCKED' ? 'Student lock' : r.state} /></div>
                      {r.inGracePeriod && <StatusPill value="In grace" />}
                    </div>
                  </div>
                </div>
              </div>
              {isManualLocked(r) && (
                <p className="mt-3 break-words text-xs" data-testid={`manual-lock-detail-${r.schoolId}`}>Manually locked{r.lockedAt ? ` on ${formatLagosTimestamp(r.lockedAt)}` : ''}{r.lockedByName ? ` by ${r.lockedByName}` : ''}.{r.reason ? ` Reason: ${r.reason}` : ''}</p>
              )}
              {!isManualLocked(r) && r.lastUnlockedAt && <p className="mt-3 break-words text-xs">Last unlocked {date(r.lastUnlockedAt)}{r.lastUnlockedByName ? ` by ${r.lastUnlockedByName}` : ''}.</p>}
              <dl className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3 [&>div]:min-w-0 [&>div]:break-words [&_dt]:whitespace-normal">
                <div><dt className="eyebrow">Start</dt><dd className="font-bold">{date(r.startDate)}</dd></div>
                <div><dt className="eyebrow">Ends</dt><dd className="font-bold">{date(r.endDate)}</dd></div>
                <div><dt className="eyebrow">Enforcement</dt><dd className="font-bold">{date(r.enforcementDate)}</dd></div>
                <div><dt className="eyebrow">Due</dt><dd className="font-bold">{mm(r.amountDueMinor)}</dd></div>
                <div><dt className="eyebrow">Paid</dt><dd className="font-bold">{mm(r.amountPaidMinor)}</dd></div>
                <div><dt className="eyebrow">Outstanding</dt><dd className="font-bold">{mm(r.outstandingMinor)}</dd></div>
                <div><dt className="eyebrow">Students paid</dt><dd className="font-bold">{n(r.studentsPaid)} / {n(r.studentsTotal)}</dd></div>
                <div><dt className="eyebrow">Students affected</dt><dd className="font-bold">{n(r.studentsAffected)}</dd></div>
                <div><dt className="eyebrow">Teachers affected</dt><dd className="font-bold">{n(r.teachersAffected)}</dd></div>
                <div><dt className="eyebrow">Parents affected</dt><dd className="font-bold">{n(r.parentsAffected)}</dd></div>
                <div><dt className="eyebrow">Student cards</dt><dd className="font-bold">{n(r.cardsLocked)}</dd></div>
                <div><dt className="eyebrow">Teacher cards</dt><dd className="font-bold">{n(r.teacherCardsLocked)}</dd></div>
                <div><dt className="eyebrow">Devices locked</dt><dd className="font-bold">{n(r.devicesLocked)}</dd></div>
              </dl>
              {isPlatformOwner && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {isManualLocked(r)
                    ? <Button variant="outline" disabled={pending} onClick={() => openFor('UNLOCK', [snapshotOf(r)])} testId={`button-unlock-school-${r.schoolId}`}><LockOpen size={14} />Unlock School</Button>
                    : <Button variant="danger" disabled={pending} onClick={() => openFor('LOCK', [snapshotOf(r)])} testId={`button-lock-school-${r.schoolId}`}><Lock size={14} />Lock School</Button>}
                  <Button variant="quiet" onClick={() => setAuditId(auditId === r.schoolId ? null : r.schoolId)} testId={`button-audit-${r.schoolId}`}><History size={14} />Audit</Button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {isPlatformOwner && auditId && <AuditPanel schoolId={auditId} name={rows.find(r => r.schoolId === auditId)?.schoolName} onClose={() => setAuditId(null)} />}
      {own && <AuditPanel schoolId={own} />}
      {confirming && (
        <Modal title={`Confirm ${label}`} eyebrow="Manual school enforcement" onClose={() => { if (!pending) setConfirming(null); }}>
          <p className="text-sm" data-testid="confirm-consequences">
            {confirming.action === 'LOCK'
              ? 'These exact schools will be locked by you as Platform Owner, regardless of payment, grace or calendar state. Users of a locked school lose school access until it is unlocked.'
              : 'These exact schools will have the manual school lock removed. Unpaid students and security restrictions remain in force.'}
          </p>
          <ul className="my-4 space-y-1 text-sm font-bold" data-testid="confirm-schools">{confirming.snaps.map(s => <li key={s.schoolId}>{s.schoolName} · school #{s.schoolId} · currently {s.status} · version {s.manualVersion}</li>)}</ul>
          <label className="block text-xs font-bold">Reason (optional, {reason.length}/{REASON_MAX})
            <textarea value={reason} maxLength={REASON_MAX} onChange={e => setReason(e.target.value)} rows={3} disabled={pending} className="mt-1.5 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm" data-testid="input-action-reason" />
          </label>
          {error && <p role="alert" data-testid="action-error" className="mt-3 text-xs font-semibold text-[hsl(var(--destructive))]">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirming(null)} disabled={pending} testId="button-cancel-action">Cancel</Button>
            <Button variant={confirming.action === 'LOCK' ? 'danger' : 'primary'} onClick={submit} disabled={pending} testId="button-confirm-action">{pending ? 'Working...' : `Confirm ${label}`}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
