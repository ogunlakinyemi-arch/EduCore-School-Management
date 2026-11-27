import { useQuery } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import { Field } from '@/components/shared';
import { readSchoolSubscriptionTerms } from '@/lib/school-subscription-terms';

/** Independent of financial-writer readiness; existing calendar API enforces school access. */
export function SchoolSubscriptionTermPicker({ schoolId, termId, onChange }: {
  schoolId?: number; termId?: number; onChange: (termId: number | undefined) => void;
}) {
  const { user } = useUser();
  const query = useQuery({
    queryKey: ['school-subscription-calendar', user?.id, schoolId],
    queryFn: ({ signal }) => readSchoolSubscriptionTerms(schoolId!, signal),
    enabled: !!user?.id && !!schoolId,
    retry: false, staleTime: 0, refetchOnMount: 'always',
  });
  const terms = query.isError ? [] : query.data ?? [];
  const loading = !!schoolId && (!user?.id || query.isPending);
  const disabled = !schoolId || loading || query.isError || !terms.length;
  const placeholder = !schoolId ? 'Choose a school first' : loading ? 'Loading academic terms…'
    : query.isError ? 'Academic terms unavailable' : !terms.length ? 'No saved academic terms' : 'All terms';
  return <Field label="Academic term">
    <select data-testid="select-finance-term" value={terms.some(t => t.id === termId) ? termId : ''}
      disabled={disabled} onChange={e => {
        const id = Number(e.target.value);
        onChange(terms.some(t => t.id === id) ? id : undefined);
      }}>
      <option value="">{placeholder}</option>
      {terms.map(t => <option key={t.id} value={t.id}>
        {t.sessionName} · {t.name} · {t.startDate.slice(0, 10)} – {t.endDate.slice(0, 10)} · {t.isCurrent ? 'Current · ' : ''}{t.status}
      </option>)}
    </select>
    {loading && <p role="status" className="mt-1 text-xs">Loading this school's saved academic calendar…</p>}
    {!!schoolId && !loading && query.isError && <div role="alert" className="mt-1 text-xs">
      Could not load this school's academic terms. No calendar or payment changes were made.{' '}
      <button type="button" className="underline" onClick={() => void query.refetch()}>Retry academic terms</button>
    </div>}
    {!!schoolId && !loading && !query.isError && !terms.length && <p role="status" className="mt-1 text-xs">
      No saved academic terms are available for this school. No term has been created or selected automatically.
    </p>}
  </Field>;
}
