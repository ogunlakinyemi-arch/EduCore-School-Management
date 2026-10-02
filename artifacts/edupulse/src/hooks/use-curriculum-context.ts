import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListAcademicSessions, useListAcademicTerms, useListClasses, useListSubjects,
  useListSchoolTeacherAssignments, getListSchoolTeacherAssignmentsQueryKey,
  getListLessonNotesQueryKey, getListSchoolCurriculumMappingsQueryKey,
  useListTeacherCurriculumTeachingContext, getListTeacherCurriculumTeachingContextQueryKey,
} from '@workspace/api-client-react';
import { FRESH } from '@/components/school-ops-kit';

type TeachingContext = {
  classId: number; className: string; section: string | null;
  subjectId: number; subjectName: string; subjectCode: string;
  sessionId: number; termId: number;
};

/** Session/term selection plus class/subject catalogs. Teachers get only backend-authorized teaching contexts. */
export function useCurriculumContext(schoolId: number, opts: { admin: boolean; teacher: boolean }) {
  const sessions = useListAcademicSessions({ schoolId }, { query: { enabled: schoolId > 0 && (opts.admin || opts.teacher), queryKey: ['sessions', schoolId], ...FRESH } });
  const sessionList = useMemo(() => sessions.data ?? [], [sessions.data]);
  const [sessionId, setSessionId] = useState(0);
  const [termId, setTermId] = useState(0);
  useEffect(() => { setSessionId(0); setTermId(0); }, [schoolId]);
  const activeSessionId = sessionId || sessionList.find(s => s.isCurrent)?.id || sessionList[0]?.id || 0;
  const terms = useListAcademicTerms(activeSessionId, { schoolId }, { query: { enabled: schoolId > 0 && (opts.admin || opts.teacher) && activeSessionId > 0, queryKey: ['terms', activeSessionId, schoolId], ...FRESH } });
  const termList = useMemo(() => terms.data ?? [], [terms.data]);
  const activeTermId = termList.some(t => t.id === termId) ? termId : termList.find(t => t.isCurrent)?.id || termList[0]?.id || 0;
  const classes = useListClasses({ schoolId }, { query: { enabled: schoolId > 0 && opts.admin, queryKey: ['classes', schoolId], ...FRESH } });
  const subjects = useListSubjects({ schoolId }, { query: { enabled: schoolId > 0 && opts.admin, queryKey: ['subjects', schoolId], ...FRESH } });
  const aParams = { status: 'ACTIVE' as const };
  const teachingParams = { sessionId: activeSessionId, termId: activeTermId };
  const teachingContexts = useListTeacherCurriculumTeachingContext(schoolId, teachingParams, { query: {
    queryKey: getListTeacherCurriculumTeachingContextQueryKey(schoolId, teachingParams),
    enabled: schoolId > 0 && opts.teacher && activeSessionId > 0 && activeTermId > 0,
    ...FRESH,
  } });
  const assignments = useListSchoolTeacherAssignments(schoolId, aParams, {
    query: {
      enabled: schoolId > 0 && opts.admin && !opts.teacher,
      queryKey: getListSchoolTeacherAssignmentsQueryKey(schoolId, aParams),
      ...FRESH,
    },
  });
  const assignmentRows = opts.teacher ? teachingContexts.data ?? [] : assignments.data ?? [];
  return {
    sessions: sessionList, terms: termList,
    sessionId: activeSessionId, termId: activeTermId,
    setSessionId: (id: number) => { setSessionId(id); setTermId(0); }, setTermId,
    classes: classes.data ?? [], subjects: subjects.data ?? [], assignments: assignmentRows,
    loading: sessions.isLoading || terms.isLoading || (opts.teacher && teachingContexts.isLoading),
    error: sessions.isError || terms.isError || (opts.teacher && teachingContexts.isError),
    refetch: () => { sessions.refetch(); terms.refetch(); teachingContexts.refetch(); },
  };
}

/** Invalidates every lesson note, monitoring, mapping and topic query of the school. */
export function useInvalidateSchool(schoolId: number) {
  const qc = useQueryClient();
  const notes = String(getListLessonNotesQueryKey(schoolId)[0]);
  const maps = String(getListSchoolCurriculumMappingsQueryKey(schoolId)[0]).replace(/\/mappings$/, '');
  return () => qc.invalidateQueries({ predicate: q => { const k = String(q.queryKey[0]); return k.startsWith(notes) || k.startsWith(maps); } });
}
