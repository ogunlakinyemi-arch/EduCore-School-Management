import { useGetParentChildSecuritySummary, getGetParentChildSecuritySummaryQueryKey } from '@workspace/api-client-react';
import { ErrorState, SkeletonPage, StatusPill, date, time } from '@/components/shared';
import { Notice } from '../security/ui';

const CARD: Record<string, string> = { ACTIVE: 'Card active', LOST: 'Card reported lost', INACTIVE: 'Card inactive', NO_CARD: 'No card issued' };

export function ChildStatus({ studentId }: { studentId: number }) {
  const q = useGetParentChildSecuritySummary(studentId, { query: { queryKey: getGetParentChildSecuritySummaryQueryKey(studentId), staleTime: 20000 } });
  if (q.isLoading) return <SkeletonPage />;
  if (q.isError || !q.data) return <ErrorState retry={() => void q.refetch()} />;
  const { nfcStatus, currentPresence: p, recentEvents } = q.data;
  const state = p?.state ?? null;
  return <section className="panel mb-5 p-4" data-testid="panel-child-status">
    <div className="eyebrow">Current status</div>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <StatusPill value={state ? state.replaceAll('_', ' ').toLowerCase() : 'no record'} />
      <span className="text-sm font-bold">{CARD[nfcStatus] ?? nfcStatus}</span>
      {p && <span className="text-xs text-[hsl(var(--muted-foreground))]">last recorded {date(p.lastOccurredAt)} {time(p.lastOccurredAt)}</span>}
    </div>
    {(state === 'REQUIRES_REVIEW' || !state) && <Notice tone="error">{state ? 'The school is reviewing this record, so your child\'s location is uncertain.' : 'There is no recorded entry or exit yet.'} If you are worried, contact the school office.</Notice>}
    {(state === 'ON_CAMPUS' || state === 'OFF_CAMPUS') && <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">This reflects the last card tap or recorded entry and exit. It is not live tracking.</p>}
    {nfcStatus === 'LOST' && <Notice>Ask the school office about a replacement card.</Notice>}
    {recentEvents.length > 0 && <ul className="mt-3 space-y-1 text-xs">{recentEvents.map((e, i) => <li key={i}>{e.eventType === 'ENTRY' ? 'Entered' : 'Left'} - {date(e.occurredAt)} {time(e.occurredAt)}</li>)}</ul>}
  </section>;
}
