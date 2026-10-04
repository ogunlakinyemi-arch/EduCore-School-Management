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

// Mirror the existing save predicate, including wildcard sections and term-wide
// subject assignments. Assignment IDs are not part of the timetable payload.
export function matchingTimetableSubjects(assignments: ClassSubjectAssignment[], selection: TimetableSelection) {
  return assignments.filter(a =>
    a.schoolId === selection.schoolId && a.sessionId === selection.sessionId &&
    a.classId === selection.classId && a.status.toUpperCase() === 'ACTIVE' &&
    (a.termId == null || a.termId === selection.termId) &&
    (a.section == null || a.section === '' || a.section === selection.section),
  );
}

export function matchingTimetableTeachers(
  teachers: Employee[], subjects: ClassSubjectAssignment[], assignments: TeacherClassAssignment[],
  session: AcademicSession | undefined, selection: TimetableSelection,
) {
  if (!selection.subjectId || session?.id !== selection.sessionId || session.schoolId !== selection.schoolId) return [];
  const sessionStart = dateOnly(session.startDate);
  const sessionEnd = dateOnly(session.endDate) ?? new Date().toISOString().slice(0, 10);
  if (!sessionStart) return [];
  const matchingSubjects = matchingTimetableSubjects(subjects, selection).filter(a => a.subjectId === selection.subjectId);
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