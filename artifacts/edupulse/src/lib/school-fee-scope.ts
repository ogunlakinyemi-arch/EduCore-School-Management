import type { AcademicSession, AcademicTerm, FeeStructure, SchoolClass } from '@workspace/api-client-react';

export type FeeCatalog = {
  schoolId: number;
  sessions: AcademicSession[];
  terms: AcademicTerm[];
  classes: SchoolClass[];
};
type Scope = { schoolId: number; sessionId: number; termId: number; classId?: number; section?: string | null };

export function feeScopeLabel(catalog: FeeCatalog | undefined, scope: Scope) {
  if (!catalog || catalog.schoolId !== scope.schoolId) return 'Academic details unavailable';
  const session = catalog.sessions.find(s => s.schoolId === scope.schoolId && s.id === scope.sessionId);
  const term = session && catalog.terms.find(t => t.sessionId === session.id && t.id === scope.termId);
  const schoolClass = catalog.classes.find(c => c.schoolId === scope.schoolId && c.id === scope.classId);
  return [session?.name ?? 'Session unavailable', term?.name ?? 'Term unavailable',
    ...(scope.classId ? [schoolClass?.name ?? 'Class unavailable', scope.section || 'All sections'] : [])].join(' · ');
}

/** Classes are saved as one row per section; use only siblings within this school. */
export function feeClassSections(classes: readonly SchoolClass[], schoolId: number, classId?: number) {
  const selected = classes.find(c => c.schoolId === schoolId && c.id === classId);
  return [...new Set(classes.filter(c => c.schoolId === schoolId && (!classId || (selected && c.name === selected.name)))
    .map(c => c.section).filter((s): s is string => !!s))].sort();
}
export function feeSectionClass(classes: readonly SchoolClass[], schoolId: number, classId: number, section: string) {
  const selected = classes.find(c => c.schoolId === schoolId && c.id === classId);
  return classes.find(c => c.schoolId === schoolId && c.name === selected?.name && c.section === section)?.id ?? classId;
}
export function matchingFeeStructures(structures: readonly FeeStructure[], scope: Scope) {
  return structures.filter(s => s.status === 'PUBLISHED' && s.schoolId === scope.schoolId
    && s.sessionId === scope.sessionId && s.termId === scope.termId && s.classId === scope.classId
    && (s.section ?? '') === (scope.section ?? ''));
}
export const SCHOOL_FEE_METHODS = [
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'CASH', label: 'Cash' },
] as const;
