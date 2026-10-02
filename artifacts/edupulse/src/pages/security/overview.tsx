import { useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { useGetSchoolSecurityDashboard, getGetSchoolSecurityDashboardQueryKey, useListSchoolCampusPresence, getListSchoolCampusPresenceQueryKey, useResolveSchoolCampusPresenceReview } from '@workspace/api-client-react';
import type { PresenceReviewInputState } from '@workspace/api-client-react';
import { Button, EmptyState, Info, StatusPill } from '@/components/shared';
import { ShieldCheck } from 'lucide-react';
import { dayRange, validDayRange, fmtDateTime, presenceUncertain, safeMessage } from './security-contract';
import { inputClass, Notice, QueryBoundary, Pager } from './ui';

export function Overview({ schoolId, canMutate }: { schoolId: number; canMutate: boolean }) {
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [editingDate, setEditingDate] = useState(false);
  const params = dayRange(from, to);
  const validDates = validDayRange(from, to);
  const q = useGetSchoolSecurityDashboard(schoolId, params, { query: { enabled: !!schoolId && validDates && !editingDate, queryKey: getGetSchoolSecurityDashboardQueryKey(schoolId, params), staleTime: 15000 } });
  const d = q.data;
  return <div className="space-y-6">
    {!validDates && <Notice tone="error">Choose valid dates with From no later than To.</Notice>}
    <div className="grid gap-3 sm:grid-cols-2 md:max-w-md" onFocusCapture={e => { if ((e.target as HTMLInputElement).type === 'date') setEditingDate(true); }} onBlurCapture={() => setEditingDate(false)}><label className="text-xs font-bold">From<input type="date" className={inputClass} value={from} onChange={e => setFrom(e.target.value)} data-testid="input-overview-from" /></label><label className="text-xs font-bold">To<input type="date" className={inputClass} value={to} onChange={e => setTo(e.target.value)} data-testid="input-overview-to" /></label></div>
    <QueryBoundary query={q}>{d && <>
      {presenceUncertain(d) && <Notice>{d.presenceRequiresReview} people have uncertain campus presence. Counts below may be off until reviewed.</Notice>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Info label="Students on campus" value={d.studentsOnCampus} /><Info label="Staff on campus" value={d.staffOnCampus} /><Info label="Off campus" value={d.offCampusPeople} /><Info label="Needs review" value={d.presenceRequiresReview} />
        <Info label="Accepted entries" value={d.acceptedEntryEvents} /><Info label="Accepted exits" value={d.acceptedExitEvents} /><Info label="Late arrivals" value={d.lateArrivals} /><Info label="Early departures" value={d.earlyDepartures} />
        <Info label="Rejected attempts" value={d.rejectedAttempts} /><Info label="Revoked card attempts" value={d.revokedCardAttempts} /><Info label="Visitors on campus" value={d.visitorsCurrentlyOnCampus} /><Info label="Visitor check-ins today" value={d.todayVisitorCheckIns} /><Info label="Open incidents" value={d.openIncidents} /><Info label="Pending pickups" value={d.pendingPickupRequests} />
      </div>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">Door hardware is not connected. Records come from card reads only. There is no GPS tracking and no remote door unlock.</p>
    </>}</QueryBoundary>
    <section className="panel p-5"><div className="eyebrow">Cards</div><h3 className="display-font mt-1 text-lg font-bold">Lost or replaced cards</h3><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Cards are marked lost or replaced through the existing card lifecycle.</p><Link href="/cards" className="mt-3 inline-flex rounded-xl border border-[hsl(var(--border))] px-4 py-2.5 text-sm font-bold" data-testid="link-security-cards">Open NFC cards</Link></section>
    <Presence schoolId={schoolId} canMutate={canMutate} />
  </div>;
}

export function Presence({ schoolId, canMutate }: { schoolId: number; canMutate: boolean }) {
  const qc = useQueryClient();
  const [cursors, setCursors] = useState<number[]>([]);
  const page = cursors.length;
  const params = { limit: 15, ...(page ? { beforeId: cursors[page - 1] } : {}) };
  const q = useListSchoolCampusPresence(schoolId, params, { query: { enabled: !!schoolId, queryKey: getListSchoolCampusPresenceQueryKey(schoolId, params), staleTime: 15000 } });
  const resolve = useResolveSchoolCampusPresenceReview();
  const [msg, setMsg] = useState(''); const [reasons, setReasons] = useState<Record<number, string>>({});
  const act = async (id: number, state: PresenceReviewInputState) => {
    const reason = (reasons[id] ?? '').trim(); if (!reason) { setMsg('A reason is required to resolve a review.'); return; }
    try { await resolve.mutateAsync({ schoolId, presenceId: id, data: { state, reason } }); setMsg(''); await qc.invalidateQueries({ queryKey: getListSchoolCampusPresenceQueryKey(schoolId) }); await qc.invalidateQueries({ queryKey: getGetSchoolSecurityDashboardQueryKey(schoolId) }); } catch (e) { setMsg(safeMessage(e)); }
  };
  return <section className="panel overflow-hidden"><div className="p-5"><div className="eyebrow">Campus presence</div><h3 className="display-font mt-1 text-lg font-bold">Who is where</h3></div>
    {msg && <div className="px-5 pb-3"><Notice tone="error">{msg}</Notice></div>}
    <QueryBoundary query={q}>{!q.data?.items.length ? <EmptyState icon={ShieldCheck} title="No presence records" description="Presence appears once cards are read at a reader." /> : <div className="divide-y divide-[hsl(var(--border)/.7)]">{q.data.items.map(p => <div key={p.id} className="flex flex-col gap-2 p-4 md:flex-row md:items-center md:justify-between" data-testid={`row-presence-${p.id}`}>
      <div><div className="font-bold">{p.personName}</div><div className="text-xs text-[hsl(var(--muted-foreground))]">{p.personType.toLowerCase()} {p.className ? `· ${p.className} ${p.section ?? ''}` : ''} · last seen {fmtDateTime(p.lastOccurredAt)}</div>{p.reviewReason && <div className="text-xs text-[hsl(var(--destructive))]">Review: {p.reviewReason}</div>}</div>
      <div className="flex flex-wrap items-center gap-2"><StatusPill value={p.state.replaceAll('_', ' ')} />{canMutate && p.state === 'REQUIRES_REVIEW' && <><input className={`${inputClass} w-44`} placeholder="Reason" value={reasons[p.id] ?? ''} onChange={e => setReasons(r => ({ ...r, [p.id]: e.target.value }))} /><Button variant="outline" onClick={() => void act(p.id, 'ON_CAMPUS')}>On campus</Button><Button variant="outline" onClick={() => void act(p.id, 'OFF_CAMPUS')}>Off campus</Button></>}</div></div>)}</div>}
      <Pager page={page} hasMore={!!q.data?.nextCursor} onPage={n => setCursors(c => n > page ? [...c, q.data!.nextCursor!] : c.slice(0, n))} /></QueryBoundary></section>;
}
