export type LinkPersonType = 'STUDENT' | 'TEACHER' | 'STAFF';
export type Person = Record<string, any>;
export const NOT_AVAILABLE = 'Not available';

export const normalizeUid = (v: string) => v.trim().toUpperCase();

export function personName(p: Person): string {
  return [p.firstName, p.middleName, p.lastName].filter(Boolean).join(' ') || p.name || p.employeeName || NOT_AVAILABLE;
}

export const validSchoolId = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && Number.isInteger(n) && n > 0 ? n : 0;
};

/** Params for the panel's own school-scoped card list. */
export const scopedCardsParams = (schoolId: unknown) => ({ schoolId: validSchoolId(schoolId) });

/** Login/account activation status: only an explicit accountStatus projection. */
export function accountStatus(p: Person): string {
  const v = p.accountStatus;
  return typeof v === 'string' && v ? v : NOT_AVAILABLE;
}

export function employeeMatchesType(p: Person, type: LinkPersonType): boolean {
  return String(p.type ?? p.role ?? '').toUpperCase() === type;
}

export function personDetails(p: Person, type: LinkPersonType) {
  if (type === 'STUDENT') {
    const cls = [p.className, p.section].filter(Boolean).join(' ');
    return { identifier: p.admissionNo || NOT_AVAILABLE, group: cls || NOT_AVAILABLE };
  }
  const subjects = Array.isArray(p.subjects) ? p.subjects.map(String).filter(Boolean).join(', ') : '';
  const detail = type === 'TEACHER'
    ? subjects || p.department
    : p.roleTitle || p.department;
  return { identifier: p.employeeId || NOT_AVAILABLE, group: detail || NOT_AVAILABLE };
}

const STUDENT_RANK: Record<string, number> = { active: 0, locked: 1, unassigned: 2 };
const EMPLOYEE_RANK: Record<string, number> = { ACTIVE: 0, LOCKED: 1 };

export function findCurrentCard(type: LinkPersonType, person: Person | undefined, studentCards: Person[], employeeCards: Person[]) {
  if (!person) return undefined;
  const pick = (rows: Person[], rank: Record<string, number>, key: (s: string) => string) =>
    rows.filter(c => c.uid && key(String(c.status ?? '')) in rank)
      .sort((x, y) => rank[key(String(x.status))] - rank[key(String(y.status))])[0];
  if (type === 'STUDENT') {
    return pick(studentCards.filter(c => c.studentId === person.id), STUDENT_RANK, s => s.toLowerCase());
  }
  return pick(employeeCards.filter(c => c.employeeId === person.id), EMPLOYEE_RANK, s => s.toUpperCase());
}

export type LinkRequest =
  | { kind: 'student'; params: { schoolId: number }; data: { uid: string; studentId: number } }
  | { kind: 'employee'; schoolId: number; data: { uid: string; employeeId: number; personType: 'TEACHER' | 'STAFF' } };

export function buildLinkRequest(type: LinkPersonType, schoolId: number, personId: number, uid: string): LinkRequest | null {
  const u = normalizeUid(uid);
  if (!schoolId || !personId || u.length < 4) return null;
  if (type === 'STUDENT') return { kind: 'student', params: { schoolId }, data: { uid: u, studentId: personId } };
  return { kind: 'employee', schoolId, data: { uid: u, employeeId: personId, personType: type } };
}

export const linkErrorMessage = (e: unknown) =>
  (e as any)?.data?.error || (e as any)?.message || 'The card could not be linked.';
