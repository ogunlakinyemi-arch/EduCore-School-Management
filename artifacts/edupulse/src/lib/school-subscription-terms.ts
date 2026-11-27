import { listAcademicSessions, listAcademicTerms, type AcademicTerm } from '@workspace/api-client-react';

export type SchoolSubscriptionTerm = AcademicTerm & { sessionName: string };

/** Calendar metadata only. Never calls the financial overview or a calendar writer. */
export async function readSchoolSubscriptionTerms(schoolId: number, signal?: AbortSignal): Promise<SchoolSubscriptionTerm[]> {
  const sessions = await listAcademicSessions({ schoolId, status: 'all' }, { signal });
  const scoped = sessions.filter(session => session.schoolId === schoolId);
  const groups = await Promise.all(scoped.map(async session => {
    const terms = await listAcademicTerms(session.id, { schoolId }, { signal });
    return terms.filter(term => term.sessionId === session.id)
      .map(term => ({ ...term, sessionName: session.name }));
  }));
  return groups.flat();
}
