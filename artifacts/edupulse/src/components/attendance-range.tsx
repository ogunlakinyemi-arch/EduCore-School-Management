import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { phase9Request } from '@/hooks/use-phase9-api';
import { cx } from '@/components/shared';

export type RangeKind = 'today' | 'week' | 'month' | 'custom' | 'term' | 'session';
export type Range = { from: string; to: string };
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Pure range builder shared by the student and parent read-only views. */
export function rangeFor(kind: RangeKind, now: Date, o: { from?: string; to?: string; term?: Range | null; session?: Range | null } = {}): Range | null {
  const day = iso(now);
  if (kind === 'today') return { from: day, to: day };
  if (kind === 'week') return { from: iso(new Date(now.getTime() - 6 * 86400000)), to: day };
  if (kind === 'month') return { from: iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))), to: day };
  if (kind === 'custom') return o.from && o.to && o.from <= o.to ? { from: o.from, to: o.to } : null;
  const r = kind === 'term' ? o.term : o.session;
  return r ? { from: r.from, to: r.to } : null;
}

const LABELS: Array<[RangeKind, string]> = [['today', 'Today'], ['week', 'Week'], ['month', 'Month'], ['custom', 'Custom'], ['term', 'Term'], ['session', 'Session']];

/** Controls only; the caller fetches with the returned {from,to}. Read-only. */
export type Periods = { sessions: Array<{ id: number; name: string; startDate: string; endDate: string }>; terms: Array<{ id: number; academicSessionId: number; name: string; startDate: string; endDate: string }> };
/** periodsPath is the scoped own/child endpoint (no school-wide catalog access needed). */
export function AttendanceRangeControls({ periodsPath, onChange }: { periodsPath: string; onChange: (r: Range | null, kind: RangeKind) => void }) {
  const [kind, setKind] = useState<RangeKind>('week');
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [sessionId, setSessionId] = useState(''); const [termId, setTermId] = useState('');
  const periods = useQuery<Periods>({ queryKey: ['attendance-periods', periodsPath], queryFn: () => phase9Request<Periods>(periodsPath), retry: false });
  const sessions = { data: periods.data?.sessions ?? [], isError: periods.isError };
  const terms = { data: (periods.data?.terms ?? []).filter(t => String(t.academicSessionId) === sessionId) };
  const session = sessions.data.find(x => String(x.id) === sessionId);
  const term = terms.data.find(x => String(x.id) === termId);
  const emit = (k: RangeKind, o: Parameters<typeof rangeFor>[2]) => onChange(rangeFor(k, new Date(), o), k);
  const ctx = (n: Partial<{ from: string; to: string; sessionId: string; termId: string }> = {}) => {
    const sid = n.sessionId ?? sessionId; const tid = n.termId ?? termId;
    const s = sessions.data.find(x => String(x.id) === sid); const t = (periods.data?.terms ?? []).find(x => String(x.id) === tid);
    return { from: n.from ?? from, to: n.to ?? to, session: s ? { from: s.startDate.slice(0, 10), to: s.endDate.slice(0, 10) } : null, term: t ? { from: t.startDate.slice(0, 10), to: t.endDate.slice(0, 10) } : null };
  };
  void session; void term;
  return (
    <div className="space-y-3 p-4" data-testid="attendance-range">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Attendance period">
        {LABELS.map(([k, l]) => <button type="button" key={k} aria-pressed={kind === k} data-testid={`range-${k}`} onClick={() => { setKind(k); emit(k, ctx()); }} className={cx('rounded-lg border px-3 py-1.5 text-xs font-bold', kind === k ? 'border-[hsl(var(--primary))] bg-[hsl(var(--primary)/.1)]' : 'border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]')}>{l}</button>)}
      </div>
      {kind === 'custom' && (
        <div className="flex flex-wrap gap-3">
          <label className="text-xs font-bold">From <input type="date" value={from} data-testid="range-from" onChange={e => { setFrom(e.target.value); emit('custom', ctx({ from: e.target.value })); }} /></label>
          <label className="text-xs font-bold">To <input type="date" value={to} data-testid="range-to" onChange={e => { setTo(e.target.value); emit('custom', ctx({ to: e.target.value })); }} /></label>
          {from && to && from > to && <span className="text-xs text-[hsl(var(--destructive))]">The start date must be on or before the end date.</span>}
        </div>
      )}
      {(kind === 'term' || kind === 'session') && (
        sessions.isError ? <p className="text-xs text-[hsl(var(--muted-foreground))]">Term and session dates could not be loaded. Use the other periods or try again later.</p> : (
          <div className="flex flex-wrap gap-3">
            <select aria-label="Academic session" value={sessionId} data-testid="range-session-select" onChange={e => { setSessionId(e.target.value); setTermId(''); emit(kind, ctx({ sessionId: e.target.value, termId: '' })); }}>
              <option value="">Select session</option>{sessions.data.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {kind === 'term' && <select aria-label="Academic term" value={termId} disabled={!sessionId} data-testid="range-term-select" onChange={e => { setTermId(e.target.value); emit('term', ctx({ termId: e.target.value })); }}>
              <option value="">Select term</option>{terms.data.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>}
          </div>
        )
      )}
    </div>
  );
}
