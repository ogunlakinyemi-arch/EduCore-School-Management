import { useQuery } from '@tanstack/react-query';
import { useUser } from '@clerk/react';
import { listAcademicSessions, listAcademicTerms, listClasses } from '@workspace/api-client-react';
import { feeScopeLabel, type FeeCatalog } from '@/lib/school-fee-scope';

export async function readSchoolFeeCatalog(schoolId: number, signal?: AbortSignal): Promise<FeeCatalog> {
  const [sessions, classes] = await Promise.all([
    listAcademicSessions({ schoolId, status: 'all' }, { signal }),
    listClasses({ schoolId }, { signal }),
  ]);
  const scoped = sessions.filter(s => s.schoolId === schoolId);
  const terms = await Promise.all(scoped.map(async s =>
    (await listAcademicTerms(s.id, { schoolId }, { signal })).filter(t => t.sessionId === s.id)));
  return { schoolId, sessions: scoped, classes: classes.filter(c => c.schoolId === schoolId), terms: terms.flat() };
}
export function useSchoolFeeCatalog(schoolId: number) {
  const { user } = useUser();
  return useQuery({
    queryKey: ['school-fee-academic-labels', user?.id, schoolId],
    queryFn: ({ signal }) => readSchoolFeeCatalog(schoolId, signal),
    enabled: !!user?.id && !!schoolId, retry: false, staleTime: 30_000,
  });
}
export function SchoolFeeScopeLabel(props: {
  schoolId: number; sessionId: number; termId: number; classId?: number; section?: string | null;
}) {
  const query = useSchoolFeeCatalog(props.schoolId);
  if (query.isPending) return <span>Loading academic details…</span>;
  if (query.isError) return <span>Academic details unavailable. <button type="button" className="underline" onClick={() => void query.refetch()}>Retry</button></span>;
  return <span>{feeScopeLabel(query.data, props)}</span>;
}
