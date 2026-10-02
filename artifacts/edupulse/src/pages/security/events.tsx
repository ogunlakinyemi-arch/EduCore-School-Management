import { useMemo, useState } from 'react';
import { useListSchoolSecurityEvents, getListSchoolSecurityEventsQueryKey } from '@workspace/api-client-react';
import type { ListSchoolSecurityEventsEventType, ListSchoolSecurityEventsResult } from '@workspace/api-client-react';
import { EmptyState, StatusPill } from '@/components/shared';
import { DoorOpen } from 'lucide-react';
import { dayRange, validDayRange, fmtDateTime } from './security-contract';
import { inputClass, Notice, Pager, QueryBoundary } from './ui';

export function Events({ schoolId }: { schoolId: number }) {
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [type, setType] = useState<'' | ListSchoolSecurityEventsEventType>(''); const [result, setResult] = useState<'' | ListSchoolSecurityEventsResult>('');
  const [search, setSearch] = useState(''); const [cursors, setCursors] = useState<number[]>([]);
  const page = cursors.length;
  const [editingDate, setEditingDate] = useState(false);
  const validDates = validDayRange(from, to);
  const params = { limit: 20, ...dayRange(from, to), ...(type ? { eventType: type } : {}), ...(result ? { result } : {}), ...(page ? { beforeId: cursors[page - 1] } : {}) };
  const q = useListSchoolSecurityEvents(schoolId, params, { query: { enabled: !!schoolId && validDates && !editingDate, queryKey: getListSchoolSecurityEventsQueryKey(schoolId, params), staleTime: 15000 } });
  const rows = useMemo(() => { const s = search.trim().toLowerCase(); return (q.data?.items ?? []).filter(e => !s || [e.personName, e.locationName, e.readerName, e.reasonCode, e.className].some(v => v?.toLowerCase().includes(s))); }, [q.data, search]);
  const reset = () => setCursors([]);
  return <div className="space-y-4">
    {!validDates && <Notice tone="error">Choose valid dates with From no later than To. No unfiltered request has been sent.</Notice>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" onFocusCapture={e => { if ((e.target as HTMLInputElement).type === 'date') setEditingDate(true); }} onBlurCapture={() => setEditingDate(false)}>
      <label className="text-xs font-bold">From<input type="date" className={inputClass} value={from} onChange={e => { setFrom(e.target.value); reset(); }} data-testid="input-events-from" /></label>
      <label className="text-xs font-bold">To<input type="date" className={inputClass} value={to} onChange={e => { setTo(e.target.value); reset(); }} /></label>
      <label className="text-xs font-bold">Direction<select className={inputClass} value={type} onChange={e => { setType(e.target.value as '' | ListSchoolSecurityEventsEventType); reset(); }}><option value="">All</option><option value="ENTRY">Entry</option><option value="EXIT">Exit</option></select></label>
      <label className="text-xs font-bold">Result<select className={inputClass} value={result} onChange={e => { setResult(e.target.value as '' | ListSchoolSecurityEventsResult); reset(); }}><option value="">All</option><option value="CONFIRMED">Confirmed</option><option value="REJECTED">Rejected</option></select></label>
      <label className="text-xs font-bold">Search this page<input className={inputClass} value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, reader, reason" data-testid="input-events-search" /></label>
    </div>
    <div className="panel overflow-hidden"><QueryBoundary query={q}>{!rows.length ? <EmptyState icon={DoorOpen} title="No events" description="No entry or exit events match these filters." /> : <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead className="text-xs text-[hsl(var(--muted-foreground))]"><tr><th className="p-3">When</th><th>Person</th><th>Direction</th><th>Where</th><th>Result</th></tr></thead><tbody>{rows.map(e => <tr key={e.id} className="border-t border-[hsl(var(--border)/.7)]" data-testid={`row-event-${e.id}`}><td className="p-3 whitespace-nowrap">{fmtDateTime(e.occurredAt)}</td><td><div className="font-bold">{e.personName ?? 'Unknown card'}</div><div className="text-xs text-[hsl(var(--muted-foreground))]">#{e.id} · {e.personType.toLowerCase()} {e.className ? `· ${e.className}` : ''}</div></td><td>{e.eventType}</td><td>{e.locationName ?? '—'}<div className="text-xs text-[hsl(var(--muted-foreground))]">{e.readerName ?? ''}</div></td><td><StatusPill value={e.identityResult} />{e.reasonCode && <div className="text-xs">{e.reasonCode}</div>}</td></tr>)}</tbody></table></div>}
      <Pager page={page} hasMore={!!q.data?.nextCursor} onPage={n => setCursors(c => n > page ? [...c, q.data!.nextCursor!] : c.slice(0, n))} /></QueryBoundary></div>
    <p className="text-xs text-[hsl(var(--muted-foreground))]">Event IDs shown here are what you enter when completing a pickup.</p>
  </div>;
}
