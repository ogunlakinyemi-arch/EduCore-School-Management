import type { AcademicSession, ClassSubjectAssignment, Employee, TeacherClassAssignment } from '@workspace/api-client-react';
import { matchingTimetableSubjects, matchingTimetableTeachers } from './timetable-eligibility';

export type SetupScope = { schoolId: number; sessionId: number; termId: number | null; classId: number; section: string };
export type SubjectChoice = { subjectId: number; teacherId: number | null };

const sectionMatches = (a: { section?: string | null }, section: string) =>
  a.section == null || a.section === '' || a.section === section;
const active = (a: { status?: string | null }) => String(a.status ?? '').toUpperCase() === 'ACTIVE';

/** Every class_subjects row for this class/session (any term, any status). */
export function classRows(rows: ClassSubjectAssignment[], scope: SetupScope) {
  return rows.filter(a => a.schoolId === scope.schoolId && a.sessionId === scope.sessionId && a.classId === scope.classId);
}

/** Active links stored exactly at the selected scope. These are editable and form the stale-edit guard. */
export function exactScopeLinks(rows: ClassSubjectAssignment[], scope: SetupScope) {
  return classRows(rows, scope).filter(a => active(a) && sectionMatches(a, scope.section) &&
    (scope.termId == null ? a.termId == null : a.termId === scope.termId));
}

/** Active session-wide links shown read-only while a specific term is selected. */
export function inheritedSessionLinks(rows: ClassSubjectAssignment[], scope: SetupScope) {
  if (scope.termId == null) return [];
  return classRows(rows, scope).filter(a => active(a) && sectionMatches(a, scope.section) && a.termId == null);
}

/** Term-specific links (or inactive rows) outside the selected scope. Kept untouched by a save. */
export function retainedOtherLinks(rows: ClassSubjectAssignment[], scope: SetupScope) {
  const own = new Set([...exactScopeLinks(rows, scope), ...inheritedSessionLinks(rows, scope)].map(a => a.id));
  return classRows(rows, scope).filter(a => !own.has(a.id) && (a.termId != null || !active(a)));
}

/**
 * Staffing-only SUBJECT_TEACHER grants count as implicit links only when no
 * class_subjects row exists in any term/status for that class/session/subject.
 * Reuses the timetable helper so both screens agree.
 */
export function implicitStaffingLinks(rows: ClassSubjectAssignment[], teaching: TeacherClassAssignment[], session: AcademicSession | undefined, scope: SetupScope) {
  const explicitSubjects = new Set(classRows(rows, scope).map(a => a.subjectId));
  const matches = matchingTimetableSubjects(rows, { schoolId: scope.schoolId, sessionId: scope.sessionId, termId: scope.termId ?? 0, classId: scope.classId, section: scope.section, subjectId: 0 }, teaching, session);
  const seen = new Set<number>();
  return matches.filter(m => {
    if (explicitSubjects.has(m.subjectId) || seen.has(m.subjectId)) return false;
    seen.add(m.subjectId);
    return true;
  });
}

/** Initial checkbox state: exact explicit links plus implicit staffing ones, never inherited annual links. */
export function initialChoices(rows: ClassSubjectAssignment[], teaching: TeacherClassAssignment[], session: AcademicSession | undefined, scope: SetupScope): Map<number, SubjectChoice> {
  const out = new Map<number, SubjectChoice>();
  for (const a of exactScopeLinks(rows, scope)) {
    if (!out.has(a.subjectId)) out.set(a.subjectId, { subjectId: a.subjectId, teacherId: a.teacherId ?? null });
  }
  for (const a of implicitStaffingLinks(rows, teaching, session, scope)) {
    if (!out.has(a.subjectId)) out.set(a.subjectId, { subjectId: a.subjectId, teacherId: null });
  }
  return out;
}

/**
 * Responsible-teacher choices for setup: every ACTIVE TEACHER employee of this
 * school. Choosing one explicitly asks the backend to reuse or append a
 * SUBJECT_TEACHER assignment; the timetable stays strict.
 */
export function setupTeacherChoices(teachers: Employee[], schoolId: number) {
  return teachers.filter(t => {
    const e = t as Employee & { employeeType?: string | null; employmentStatus?: string | null };
    return e.schoolId === schoolId && String(e.employeeType ?? e.type ?? '').toUpperCase() === 'TEACHER' &&
      String(e.employmentStatus ?? e.status ?? '').toUpperCase() === 'ACTIVE';
  });
}

/** Teachers already eligible through current staffing, via a synthetic unpinned class-subject row. */
export function eligibleSetupTeachers(teachers: Employee[], teaching: TeacherClassAssignment[], session: AcademicSession | undefined, scope: SetupScope, subjectId: number) {
  const synthetic = { id: -1, schoolId: scope.schoolId, sessionId: scope.sessionId, termId: null, classId: scope.classId, section: null, subjectId, teacherId: null, status: 'ACTIVE' } as unknown as ClassSubjectAssignment;
  return matchingTimetableTeachers(teachers, [synthetic], teaching, session,
    { schoolId: scope.schoolId, sessionId: scope.sessionId, termId: scope.termId ?? 0, classId: scope.classId, section: scope.section, subjectId });
}

export function buildSetupPayload(scope: SetupScope, expectedAssignmentIds: number[], choices: Map<number, SubjectChoice>) {
  const unique = new Map<number, SubjectChoice>();
  for (const c of choices.values()) if (!unique.has(c.subjectId)) unique.set(c.subjectId, c);
  return {
    schoolId: scope.schoolId, classId: scope.classId, sessionId: scope.sessionId, termId: scope.termId,
    expectedAssignmentIds: [...new Set(expectedAssignmentIds)].sort((a, b) => a - b),
    subjects: [...unique.values()].sort((a, b) => a.subjectId - b.subjectId).map(c => ({ subjectId: c.subjectId, teacherId: c.teacherId ?? null })),
  };
}

export function scopeQuery(scope: { schoolId: number; sessionId?: number | null; termId?: number | null; classId?: number | null }) {
  const p = new URLSearchParams({ schoolId: String(scope.schoolId) });
  if (scope.sessionId) p.set('sessionId', String(scope.sessionId));
  if (scope.termId) p.set('termId', String(scope.termId));
  if (scope.classId) p.set('classId', String(scope.classId));
  return p.toString();
}

/** URL IDs are honoured only when the URL schoolId matches the current tenant. */
export function urlScopeId(search: string, schoolId: number, name: 'sessionId' | 'termId' | 'classId') {
  const p = new URLSearchParams(search);
  if (p.get('schoolId') !== String(schoolId)) return undefined;
  const raw = p.get(name);
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : undefined;
}
