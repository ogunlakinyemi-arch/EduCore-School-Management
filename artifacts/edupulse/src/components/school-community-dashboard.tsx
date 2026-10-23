import { RefreshCw, Megaphone, Bus, DoorClosed } from 'lucide-react';
import { useGetAuthorizedContext, useGetSchoolCommunityDashboard, getGetSchoolCommunityDashboardQueryKey, type SchoolCommunityDashboard as CommunityData } from '@workspace/api-client-react';
import { Button } from '@/components/shared';

export const COMMUNITY_POLL_MS = 60_000;

export function formatSchoolDate(value: string | null | undefined, timeZone: string, withTime = false) {
  if (!value) return '';
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return value;
  const opts: Intl.DateTimeFormatOptions = withTime
    ? { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone }
    : { weekday: 'long', day: 'numeric', month: 'long', timeZone: /^\d{4}-\d{2}-\d{2}$/.test(value) ? 'UTC' : timeZone };
  try { return d.toLocaleString('en-NG', opts); } catch { return value; }
}
const pretty = (v: string) => v.replaceAll('_', ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase());
const isCancelled = (s: string) => /INACTIVE|CANCEL|WITHDRAW|REMOV|REVOK/i.test(s);

export type CommunityView = 'SCHOOL' | 'PARENT' | 'STUDENT' | 'DRIVER';

export function SchoolCommunityDashboard({ schoolId, view = 'SCHOOL' }: { schoolId: number; view?: CommunityView }) {
  const ctx = useGetAuthorizedContext();
  const userId = ctx.data?.user?.id;
  const allowed = !!ctx.data && !ctx.data.isPlatformOwner && !!userId && schoolId > 0;
  const q = useGetSchoolCommunityDashboard(schoolId, { view }, { query: {
    queryKey: [...getGetSchoolCommunityDashboardQueryKey(schoolId, { view }), 'identity', userId ?? 0],
    enabled: allowed, staleTime: 15_000, refetchInterval: COMMUNITY_POLL_MS, refetchOnMount: 'always', refetchOnWindowFocus: true,
  } });
  if (ctx.data?.isPlatformOwner) return null;
  const d = q.data;
  const head = (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="eyebrow">School community</div><h2 className="display-font mt-1 text-xl font-bold">{d?.schoolName || `School ${schoolId}`}</h2></div>
      <Button variant="outline" onClick={() => void q.refetch()} disabled={q.isFetching} testId={`button-refresh-community-${schoolId}`}><RefreshCw size={14} />{q.isFetching ? 'Refreshing...' : 'Refresh'}</Button>
    </div>
  );
  return (
    <section className="panel mb-6 min-w-0 p-5 md:p-6" aria-label="School community dashboard" data-testid={`community-dashboard-${schoolId}`} data-view={view}>
      {head}
      {ctx.isLoading || q.isLoading ? <div className="mt-4 space-y-3" role="status" aria-label="Loading school community"><div className="skeleton h-16 rounded-xl" /><div className="skeleton h-24 rounded-xl" /></div>
        : ctx.isError || q.isError || !d ? (
          <div role="alert" data-testid="community-error" className="mt-4 rounded-xl border border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--destructive)/.08)] p-4 text-sm font-medium text-[hsl(var(--destructive))]">
            {(q.error instanceof Error && q.error.message) || 'School community information could not be loaded.'}
            <button type="button" className="ml-2 font-bold underline" onClick={() => { void ctx.refetch(); void q.refetch(); }}>Retry</button>
          </div>
        ) : <CommunityDashboardBody d={d} />}
    </section>
  );
}

export function CommunityDashboardBody({ d }: { d: CommunityData }) {
  const tz = d.closing.timezone;
  const c = d.closing;
  return (
    <div className="mt-4 space-y-5">
      <div className="text-xs text-[hsl(var(--muted-foreground))]" data-testid="community-local-date">School local date: <b>{formatSchoolDate(c.date, tz)}</b> ({tz}). Updated {formatSchoolDate(d.asOf, tz, true)}.</div>
      <div className="rounded-xl border border-[hsl(var(--border))] p-4" data-testid="community-closing">
        <div className="flex items-center gap-2 text-sm font-bold"><DoorClosed size={16} />Closing time</div>
        {!c.configured ? <p className="mt-2 text-sm" data-testid="closing-not-configured">Closing time is not configured for this school. Confirm today's arrangements with the school.</p>
          : !c.dayOpen ? <p className="mt-2 text-sm" data-testid="closing-day-closed">School is closed today.</p>
          : <p className="mt-2 text-sm"><b className="display-font text-lg">{c.time ?? 'Not set'}</b> today</p>}
        {c.configured && c.effectiveAt ? <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]" data-testid="closing-effective">Effective {formatSchoolDate(c.effectiveAt, tz, true)}</p> : null}
      </div>
      <div data-testid="community-notices">
        <div className="mb-2 flex items-center gap-2 text-sm font-bold"><Megaphone size={16} />Notices</div>
        {!d.notices.length ? <p className="rounded-xl border border-dashed border-[hsl(var(--border))] p-4 text-sm text-[hsl(var(--muted-foreground))]">No notices for you right now.</p> : (
          <ul className="space-y-2">{d.notices.map(n => { const x = isCancelled(n.status); return (
            <li key={n.id} data-testid={`notice-${n.id}`} className={`rounded-xl border p-3 text-sm ${x ? 'border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--destructive)/.06)]' : 'border-[hsl(var(--border))]'}`}>
              <div className="flex flex-wrap items-center justify-between gap-2"><b className={x ? 'line-through' : ''}>{n.title}</b>
                <span className={`text-[10px] font-bold uppercase tracking-wider ${x ? 'text-[hsl(var(--destructive))]' : 'text-[hsl(var(--muted-foreground))]'}`}>{pretty(n.status)}</span></div>
              <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{pretty(n.category)} · {formatSchoolDate(n.startDate, tz)}{n.endDate && n.endDate !== n.startDate ? ` to ${formatSchoolDate(n.endDate, tz)}` : ''}</div>
              <div className="mt-1 text-xs">{pretty(n.change)} · {formatSchoolDate(n.changedAt, tz, true)}</div>
            </li>); })}</ul>)}
      </div>
      <div data-testid="community-bus-duties">
        <div className="mb-2 flex items-center gap-2 text-sm font-bold"><Bus size={16} />Bus duties</div>
        {!d.busDuties.length ? <p className="rounded-xl border border-dashed border-[hsl(var(--border))] p-4 text-sm text-[hsl(var(--muted-foreground))]">No active bus duty claim for you.</p> : (
          <ul className="space-y-2">{d.busDuties.map(b => (
            <li key={b.id} data-testid={`bus-duty-${b.id}`} className="rounded-xl border border-[hsl(var(--border))] p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2"><b>{b.routeName}</b><span className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">{pretty(b.status)}</span></div>
              <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{pretty(b.role)}{b.busIdentifier ? ` · Bus ${b.busIdentifier}` : ''}</div>
              {b.duty ? <div className="mt-2 text-xs"><div>{b.duty.startDate} to {b.duty.endDate}, {b.duty.startTime} to {b.duty.endTime}</div>{b.duty.instructions && <p className="mt-1 whitespace-pre-line">{b.duty.instructions}</p>}</div>
                : <div className="mt-2 text-xs" data-testid={`bus-duty-legacy-${b.id}`}>Duty period not set.</div>}
            </li>))}</ul>)}
      </div>
    </div>
  );
}
