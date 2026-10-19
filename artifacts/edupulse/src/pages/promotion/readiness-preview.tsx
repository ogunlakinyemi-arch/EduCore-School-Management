import { getGetPromotionReadinessQueryKey, useGetPromotionReadiness } from '@workspace/api-client-react';
import { Button } from '@/components/shared';

export function PromotionReadinessPreview({ schoolId, sourceSessionId }: {
  schoolId: number; sourceSessionId: number;
}) {
  const query = useGetPromotionReadiness({ schoolId, sourceSessionId }, {
    query: {
      queryKey: getGetPromotionReadinessQueryKey({ schoolId, sourceSessionId }),
      enabled: schoolId > 0 && sourceSessionId > 0, staleTime: 0, retry: false,
    },
  });
  return <section className="rounded-xl border border-[hsl(var(--border))] p-4 space-y-3" aria-label="Promotion evidence validation">
    <h3 className="font-bold">Published third-term evidence — validation only</h3>
    {!sourceSessionId ? <p>Select a source session to validate its evidence.</p>
      : query.isLoading ? <p role="status">Checking the selected school and session…</p>
      : query.isError ? <div role="alert">
        <p>Evidence could not be validated. No promotion is authorized.</p>
        <Button type="button" variant="quiet" onClick={() => query.refetch()}>Retry validation</Button>
      </div>
      : query.data ? <>
        <p>{query.data.cohortCount} currently enrolled student(s); {query.data.studentsWithPublishedResults} with published third-term evidence; {query.data.missingPublishedResults} without it.</p>
        <p>{query.data.publishedResultCount} valid published result row(s); {query.data.placementConflictCount} student(s) with conflicting placements.</p>
        <div role="status">
          <p className="font-bold">Promotion execution is not enabled by this preview.</p>
          <ul className="list-disc pl-5">{query.data.blockers.map(message => <li key={message}>{message}</li>)}</ul>
        </div>
        {query.data.warnings.map(message => <p key={message} className="text-xs text-[hsl(var(--muted-foreground))]">{message}</p>)}
      </> : <p>No validated evidence is available.</p>}
  </section>;
}
