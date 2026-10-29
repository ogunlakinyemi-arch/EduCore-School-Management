import {
  useListAcademicSessions, useListAcademicTerms,
  getListAcademicSessionsQueryKey, getListAcademicTermsQueryKey,
} from '@workspace/api-client-react';
import { Field } from '@/components/shared';

/** School-owned academic IDs are selected by name, never guessed or shared across schools. */
export function FinancePeriodFilters({ schoolId, sessionId, termId, onChange }: {
  schoolId?: number; sessionId: string; termId: string;
  onChange: (sessionId: string, termId: string) => void;
}) {
  const params = { schoolId: schoolId ?? 0 };
  const sessions = useListAcademicSessions(params, {
    query: { enabled: !!schoolId, queryKey: getListAcademicSessionsQueryKey(params), retry: false },
  });
  const terms = useListAcademicTerms(Number(sessionId), params, {
    query: { enabled: !!schoolId && !!sessionId, queryKey: getListAcademicTermsQueryKey(Number(sessionId), params), retry: false },
  });
  const sessionOptions = (sessions.data ?? []).filter(s => s.schoolId === schoolId);
  const termOptions = (terms.data ?? []).filter(t => t.sessionId === Number(sessionId));
  const entry = 'w-full rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3.5 py-2.5 text-sm';
  return <>
    <Field label="Academic session">
      <select className={entry} value={sessionId} disabled={!schoolId || sessions.isLoading || sessions.isError}
        onChange={e => onChange(e.target.value, '')} data-testid="filter-academic-session">
        <option value="">{!schoolId ? 'Choose a school first' : sessions.isLoading ? 'Loading sessions…' : 'All sessions'}</option>
        {sessionOptions.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {sessions.isError && <button type="button" className="mt-1 text-xs underline" onClick={() => void sessions.refetch()}>Could not load sessions. Retry</button>}
      {!!schoolId && !sessions.isLoading && !sessions.isError && !sessionOptions.length && <p className="mt-1 text-xs">No academic sessions saved for this school.</p>}
    </Field>
    <Field label="Academic term">
      <select className={entry} value={termId} disabled={!schoolId || !sessionId || terms.isLoading || terms.isError}
        onChange={e => onChange(sessionId, e.target.value)} data-testid="filter-academic-term">
        <option value="">{!sessionId ? 'Choose a session first' : terms.isLoading ? 'Loading terms…' : 'All terms'}</option>
        {termOptions.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
      {terms.isError && <button type="button" className="mt-1 text-xs underline" onClick={() => void terms.refetch()}>Could not load terms. Retry</button>}
      {!!sessionId && !terms.isLoading && !terms.isError && !termOptions.length && <p className="mt-1 text-xs">No academic terms saved for this session.</p>}
    </Field>
  </>;
}
