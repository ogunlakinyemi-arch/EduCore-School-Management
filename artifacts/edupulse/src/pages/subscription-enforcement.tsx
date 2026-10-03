import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Lock } from 'lucide-react';
import {
  getGetSubscriptionEnforcementOverviewQueryKey,
  getGetMySubscriptionEnforcementQueryKey,
  useGetSubscriptionEnforcementOverview,
  useLockSchoolSubscriptions,
} from '@workspace/api-client-react';
import type { LockSchoolSubscriptions200Item, SchoolSubscriptionSummary } from '@workspace/api-client-react';
import { PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState, Modal, useTenant, useSchoolAdminAccess, money, date } from '@/components/shared';

export const CONFIRM_PHRASE = 'LOCK CARDS & DEVICES';
export const FILTERS = ['All', 'Paid', 'Unpaid', 'Overdue', 'In Grace', 'Locked', 'Partially Paid'] as const;
export type Filter = typeof FILTERS[number];

export function matchesFilter(s: SchoolSubscriptionSummary, f: Filter, now = Date.now()): boolean {
  const total = s.studentsTotal ?? 0;
  const paid = s.studentsPaid ?? 0;
  const isPaid = total > 0 && paid >= total;
  const partial = paid > 0 && paid < total;
  const grace = !!s.inGracePeriod;
  switch (f) {
    case 'All': return true;
    case 'Paid': return isPaid;
    case 'Unpaid': return !isPaid;
    case 'Partially Paid': return partial;
    case 'In Grace': return grace;
    case 'Locked': return s.state === 'LOCKED' || !!s.schoolLocked;
    case 'Overdue': return !isPaid && !grace && !!s.enforcementDate && new Date(s.enforcementDate).getTime() < now;
  }
}

export type LockSnapshot = { schoolId: number; termId: number; schoolName: string; termName: string; enforcementDate?: string };
export const canSelect = (s: SchoolSubscriptionSummary) => !!s.termId && !s.inGracePeriod && (s.studentsTotal ?? 0) > (s.studentsPaid ?? 0);
export const snapshotMatches = (snap: LockSnapshot, s?: SchoolSubscriptionSummary) =>
  !!s && s.termId === snap.termId && (s.termName ?? '') === snap.termName && s.enforcementDate === snap.enforcementDate && canSelect(s);
export const toLockBody = (snaps: LockSnapshot[]) => ({ confirmed: true as const, schools: snaps.map(s => ({ schoolId: s.schoolId, termId: s.termId })) });

const mm = (v?: number) => (v === undefined ? '—' : money(v / 100));
const n = (v?: number) => (v === undefined ? '—' : v.toLocaleString('en-NG'));

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
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const [filter, setFilter] = useState<Filter>('All');
  const [selected, setSelected] = useState<Record<number, LockSnapshot>>({});
  const [confirming, setConfirming] = useState<LockSnapshot[] | null>(null);
  const [phrase, setPhrase] = useState('');
  const [results, setResults] = useState<{ snap: LockSnapshot; item?: LockSchoolSubscriptions200Item }[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Clear selection whenever the displayed term/enforcement context of a selected school changes.
  useEffect(() => {
    const byId = new Map(rows.map(r => [r.schoolId, r]));
    const stale = Object.values(selected).filter(s => !snapshotMatches(s, byId.get(s.schoolId)));
    if (stale.length) {
      setSelected({}); setConfirming(null); setPhrase('');
      setNotice('The displayed term or payment state changed, so your selection was cleared. Review and select again.');
    }
  }, [rows, selected]);

  const shown = rows.filter(r => matchesFilter(r, filter));
  const toggle = (r: SchoolSubscriptionSummary) => {
    if (!canSelect(r) || !r.termId) return;
    setNotice(null);
    setSelected(cur => {
      const next = { ...cur };
      if (next[r.schoolId]) delete next[r.schoolId];
      else next[r.schoolId] = { schoolId: r.schoolId, termId: r.termId!, schoolName: r.schoolName, termName: r.termName ?? '', enforcementDate: r.enforcementDate };
      return next;
    });
  };
  const open = () => { setError(null); setPhrase(''); setConfirming(Object.values(selected)); };
  const submit = async () => {
    if (!confirming || phrase !== CONFIRM_PHRASE) return;
    const snaps = confirming;
    const byId = new Map(rows.map(r => [r.schoolId, r]));
    if (snaps.some(s => !snapshotMatches(s, byId.get(s.schoolId)))) {
      setSelected({}); setConfirming(null); setNotice('The displayed context changed before confirmation. Nothing was sent.');
      return;
    }
    try {
      const res = await lock.mutateAsync({ data: toLockBody(snaps) });
      setResults(snaps.map(snap => ({ snap, item: res.find(i => i.schoolId === snap.schoolId) })));
      setSelected({}); setConfirming(null); setPhrase('');
      await qc.invalidateQueries({ queryKey: getGetSubscriptionEnforcementOverviewQueryKey(params) });
      await qc.invalidateQueries({ queryKey: getGetMySubscriptionEnforcementQueryKey() });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The lock request failed. Nothing is assumed locked.');
    }
  };
  const count = Object.keys(selected).length;

  return (
    <div className="fade-up min-w-0">
      <PageHeading eyebrow="Financials / Enforcement" title="Term Enforcement." description="Only unpaid students and their own cards or child-specific parent access are restricted. Paid students and schools in grace are never affected."
        action={<Link href="/subscriptions" className="text-xs font-bold text-[hsl(var(--primary))] underline" data-testid="link-back-subscriptions">Back to subscriptions</Link>} />
      {!isPlatformOwner && <div role="status" className="mb-5 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] px-4 py-3 text-sm" data-testid="enforcement-read-only">Read-only overview. Only the Platform Owner can lock cards and devices.</div>}
      {notice && <div role="status" className="mb-5 rounded-xl border border-[hsl(35_83%_53%/.4)] bg-[hsl(35_83%_53%/.1)] px-4 py-3 text-sm font-semibold">{notice}</div>}
      {results && (
        <div className="panel mb-5 p-5" data-testid="lock-results" role="status">
          <div className="flex items-center justify-between"><h2 className="display-font text-lg font-bold">Lock results</h2><Button variant="quiet" onClick={() => setResults(null)}>Dismiss</Button></div>
          <ul className="mt-3 divide-y divide-[hsl(var(--border)/.6)] text-sm">
            {results.map(({ snap, item }) => (
              <li key={snap.schoolId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="font-bold">{snap.schoolName} · {snap.termName}</span>
                <span className="text-xs">{item ? `${item.state === 'FAILED' ? 'Failed — this school was not changed; refresh and retry' : item.changed ? 'Restriction updated' : 'No change (policy already applied)'} · ${item.state}` : 'No result returned by the server'}</span>
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
          <Button variant="danger" className="ml-auto" disabled={!count || lock.isPending} onClick={open} testId="button-lock-selected"><Lock size={14} />Lock selected ({count})</Button>
        )}
      </div>
      {query.isLoading ? <SkeletonPage /> : query.isError ? <ErrorState retry={() => query.refetch()} /> : !shown.length ? (
        <div className="panel"><EmptyState icon={Lock} title="No schools match" description="No school matches this filter for the current term data." /></div>
      ) : (
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          {shown.map(r => (
            <article key={r.schoolId} className="panel min-w-0 p-5" data-testid={`enforcement-school-${r.schoolId}`}>
              <div className="flex items-start gap-3">
                {isPlatformOwner && <input type="checkbox" className="mt-1 h-4 w-4" aria-label={`Select ${r.schoolName}`} disabled={!canSelect(r)} checked={!!selected[r.schoolId]} onChange={() => toggle(r)} data-testid={`select-school-${r.schoolId}`} />}
                <div className="min-w-0 flex-1">
                  <h3 className="display-font break-words text-lg font-bold">{r.schoolName}</h3>
                  <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{r.termName ?? 'No current term'}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1"><StatusPill value={r.schoolLocked ? 'School locked' : r.state === 'LOCKED' ? 'Student lock' : r.state} />{r.inGracePeriod && <StatusPill value="In grace" />}</div>
              </div>
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
            </article>
          ))}
        </div>
      )}
      {confirming && (
        <Modal title="Confirm lock" eyebrow="Cards and devices" onClose={() => { if (!lock.isPending) setConfirming(null); }}>
          <p className="text-sm">These exact schools and terms will be locked. Only unpaid students, their cards and child-specific parent access are affected; paid and grace schools are skipped.</p>
          <ul className="my-4 space-y-1 text-sm font-bold">{confirming.map(s => <li key={s.schoolId}>{s.schoolName} · {s.termName} · enforcement {date(s.enforcementDate)}</li>)}</ul>
          <label className="block text-xs font-bold">Type {CONFIRM_PHRASE} to confirm
            <input value={phrase} onChange={e => setPhrase(e.target.value)} className="mt-1.5 w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-sm" data-testid="input-lock-phrase" autoComplete="off" />
          </label>
          {error && <p role="alert" className="mt-3 text-xs font-semibold text-[hsl(var(--destructive))]">{error}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirming(null)} disabled={lock.isPending}>Cancel</Button>
            <Button variant="danger" onClick={submit} disabled={phrase !== CONFIRM_PHRASE || lock.isPending} testId="button-confirm-lock"><Lock size={14} />{lock.isPending ? 'Locking...' : CONFIRM_PHRASE}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
