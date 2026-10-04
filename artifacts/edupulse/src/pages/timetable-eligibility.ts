import type { AcademicSession, ClassSubjectAssignment, Employee, TeacherClassAssignment } from '@workspace/api-client-react';

export type TimetableSelection = {
  schoolId: number;
  sessionId: number;
  termId: number;
  classId: number;
  section: string;
  subjectId: number;
};

const dateOnly = (value: unknown): string | null => {
  const text = value instanceof Date ? value.toISOString() : value;
  return typeof text === 'string' && /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : null;
};

// Mirror timetable save authorization: explicit enrollments take precedence;
// otherwise a scoped subject-teacher grant itself establishes the relationship.
// Assignment IDs are not part of the timetable payload.
export function matchingTimetableSubjects(
  assignments: ClassSubjectAssignment[], selection: TimetableSelection,
  teaching: TeacherClassAssignment[] = [], session?: AcademicSession,
): Pick<ClassSubjectAssignment, 'subjectId' | 'teacherId'>[] {
  const enrolled = assignments.filter(a =>
    a.schoolId === selection.schoolId && a.sessionId === selection.sessionId &&
    a.classId === selection.classId && a.status.toUpperCase() === 'ACTIVE' &&
    (a.termId == null || a.termId === selection.termId) &&
    (a.section == null || a.section === '' || a.section === selection.section),
  );
  // The staffing UI stores a class-specific SUBJECT_TEACHER grant without
  // inserting a duplicate class_subjects row. Read that real grant directly.
  // Any explicit enrollment (including inactive/different-term restrictions)
  // takes precedence; a class teacher alone never introduces a subject.
  const assigned = teaching.filter(a =>
    a.assignmentType === 'SUBJECT_TEACHER' && a.subjectId != null &&
    a.schoolId === selection.schoolId && a.sessionId === selection.sessionId &&
    a.classId === selection.classId && a.status === 'ACTIVE' &&
    (a.section === '' || a.section === selection.section) &&
    session?.id === selection.sessionId && session.schoolId === selection.schoolId &&
    overlapsSession(a, session) &&
    !assignments.some(cs => cs.schoolId === selection.schoolId && cs.sessionId === selection.sessionId &&
      cs.classId === selection.classId && cs.subjectId === a.subjectId),
  ).map(a => ({ subjectId: a.subjectId!, teacherId: a.teacherId }));
  return [...enrolled, ...assigned];
}

function overlapsSession(a: TeacherClassAssignment, session: AcademicSession) {
  const start = dateOnly(a.startDate);
  const sessionStart = dateOnly(session.startDate);
  const sessionEnd = dateOnly(session.endDate) ?? new Date().toISOString().slice(0, 10);
  const end = dateOnly(a.endDate);
  return start != null && sessionStart != null && start <= sessionEnd &&
    (a.endDate == null || (end != null && end >= sessionStart));
}

export function matchingTimetableTeachers(
  teachers: Employee[], subjects: ClassSubjectAssignment[], assignments: TeacherClassAssignment[],
  session: AcademicSession | undefined, selection: TimetableSelection,
) {
  if (!selection.subjectId || session?.id !== selection.sessionId || session.schoolId !== selection.schoolId) return [];
  const sessionStart = dateOnly(session.startDate);
  const sessionEnd = dateOnly(session.endDate) ?? new Date().toISOString().slice(0, 10);
  if (!sessionStart) return [];
  const matchingSubjects = matchingTimetableSubjects(subjects, selection, assignments, session).filter(a => a.subjectId === selection.subjectId);
  return teachers.filter(teacher =>
    teacher.schoolId === selection.schoolId && teacher.type === 'TEACHER' && teacher.status === 'ACTIVE' &&
    matchingSubjects.some(a => a.teacherId == null || a.teacherId === teacher.id) &&
    assignments.some(a => {
      const start = dateOnly(a.startDate);
      const end = dateOnly(a.endDate);
      return a.schoolId === selection.schoolId && a.teacherId === teacher.id &&
        a.sessionId === selection.sessionId && a.classId === selection.classId &&
        (a.section === '' || a.section === selection.section) &&
        (a.assignmentType !== 'SUBJECT_TEACHER' || a.subjectId === selection.subjectId) &&
        a.status === 'ACTIVE' && start != null && start <= sessionEnd &&
        (a.endDate == null || (end != null && end >= sessionStart));
    }),
  );
}