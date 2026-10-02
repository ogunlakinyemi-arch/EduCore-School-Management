import { describe, expect, it } from 'vitest';
import { buildLinkRequest, accountStatus, personDetails, findCurrentCard, employeeMatchesType, validSchoolId, scopedCardsParams } from './lib-card-link';
import { readFileSync } from 'node:fs';

describe('owner card link helpers', () => {
  it('builds student payload with numeric id', () => {
    expect(buildLinkRequest('STUDENT', 3, 9, ' ab12cd ')).toEqual({ kind: 'student', params: { schoolId: 3 }, data: { uid: 'AB12CD', studentId: 9 } });
  });
  it('builds teacher and staff payloads', () => {
    expect(buildLinkRequest('TEACHER', 3, 5, 'ABCD1')).toEqual({ kind: 'employee', schoolId: 3, data: { uid: 'ABCD1', employeeId: 5, personType: 'TEACHER' } });
    expect(buildLinkRequest('STAFF', 3, 6, 'ABCD1')).toMatchObject({ data: { personType: 'STAFF' } });
  });
  it('rejects missing school, person or short uid', () => {
    expect(buildLinkRequest('STUDENT', 0, 1, 'ABCD')).toBeNull();
    expect(buildLinkRequest('STUDENT', 1, 0, 'ABCD')).toBeNull();
    expect(buildLinkRequest('STAFF', 1, 1, 'AB')).toBeNull();
  });
  it('never claims unknown account status is Active', () => {
    expect(accountStatus({})).toBe('Not available');
    expect(accountStatus({ status: 'ACTIVE', admissionStatus: 'ADMITTED' })).toBe('Not available');
    expect(accountStatus({ accountStatus: 'ACTIVATED' })).toBe('ACTIVATED');
    expect(personDetails({ employeeId: 'E1' }, 'STAFF').group).toBe('Not available');
  });
  it('finds current card and filters employee type', () => {
    expect(findCurrentCard('STUDENT', { id: 2 }, [{ studentId: 2, uid: 'X', status: 'active' }], [])?.uid).toBe('X');
    expect(findCurrentCard('TEACHER', { id: 2 }, [], [{ employeeId: 2, uid: 'T', status: 'ACTIVE' }])?.uid).toBe('T');
    expect(employeeMatchesType({ type: 'teacher' }, 'TEACHER')).toBe(true);
    expect(employeeMatchesType({ type: 'STAFF' }, 'TEACHER')).toBe(false);
  });
  it('prioritises active over historical cards and scopes queries', () => {
    const rows = [{ studentId: 2, uid: 'OLD', status: 'lost' }, { studentId: 2, uid: 'L', status: 'locked' }, { studentId: 2, uid: 'A', status: 'active' }];
    expect(findCurrentCard('STUDENT', { id: 2 }, rows, [])?.uid).toBe('A');
    expect(findCurrentCard('STUDENT', { id: 2 }, [rows[0]], [])).toBeUndefined();
    expect(findCurrentCard('STAFF', { id: 1 }, [], [{ employeeId: 1, uid: 'R', status: 'REPLACED' }])).toBeUndefined();
    expect(validSchoolId(NaN)).toBe(0);
    expect(validSchoolId(-3)).toBe(0);
    expect(scopedCardsParams(7)).toEqual({ schoolId: 7 });
    expect(scopedCardsParams('x')).toEqual({ schoolId: 0 });
  });
  it('resets person on school/type change and keeps existing flows', () => {
    const c = readFileSync(new URL('./components/owner-card-link.tsx', import.meta.url), 'utf8');
    expect(c).toMatch(/changeSchool[^\n]*resetPerson/);
    expect(c).toContain('useListCards(cardsParams');
    expect(c).toMatch(/changeType[^\n]*resetPerson/);
    const p = readFileSync(new URL('./pages/cards.tsx', import.meta.url), 'utf8');
    expect(p).toContain('Provision Card');
    expect(p).toContain('/reassign');
    expect(p).toContain('useUpdateCardStatus');
  });
});
