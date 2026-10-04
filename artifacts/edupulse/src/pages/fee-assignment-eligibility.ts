import type { FeeStructure, SchoolClass, Student } from '@workspace/api-client-react';

type StructureScope = Pick<FeeStructure, 'schoolId' | 'classId' | 'section'>;
type ClassScope = Pick<SchoolClass, 'id' | 'schoolId' | 'name'>;
type StudentScope = Pick<Student, 'id' | 'schoolId' | 'className' | 'section'>;

// Match the invoice assignment API's exact class-name/optional-section policy.
// IDs remain students.id, never admission numbers or invoice identifiers.
export function eligibleFeeAssignmentStudents<T extends StudentScope>(
  students: readonly T[], classes: readonly ClassScope[],
  structure: StructureScope, schoolId: number,
): T[] {
  if (structure.schoolId !== schoolId) return [];
  const schoolClass = classes.find(c => c.id === structure.classId && c.schoolId === schoolId);
  if (!schoolClass) return [];
  return students.filter(s => s.schoolId === schoolId && s.className === schoolClass.name
    && (structure.section == null || s.section === structure.section));
}