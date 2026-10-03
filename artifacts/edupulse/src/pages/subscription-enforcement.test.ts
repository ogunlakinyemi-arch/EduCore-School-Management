import { describe, expect, it } from 'vitest';
import type { SchoolSubscriptionSummary } from '@workspace/api-client-react';
import { actionAllowed, matchesFilter, snapshotMatches, snapshotOf, toActionBody } from './subscription-enforcement';

const base: SchoolSubscriptionSummary = { schoolId: 1, schoolName: 'A', status: 's', state: 'UNPAID', schoolEnforcementStatus: 'ACTIVE', manualVersion: 3, termId: 9, termName: 'T1', enforcementDate: '2020-01-01', studentsTotal: 10, studentsPaid: 4 };
describe('enforcement helpers', () => {
  it('billing filters', () => {
    expect(matchesFilter(base, 'Partially Paid')).toBe(true);
    expect(matchesFilter(base, 'Overdue')).toBe(true);
    expect(matchesFilter({ ...base, inGracePeriod: true }, 'Overdue')).toBe(false);
    expect(matchesFilter({ ...base, studentsPaid: 10 }, 'Paid')).toBe(true);
  });
  it('unknown billing is not unpaid', () => {
    const unknown = { ...base, termId: undefined, studentsTotal: undefined, studentsPaid: undefined };
    expect(matchesFilter(unknown, 'Unpaid')).toBe(false);
    expect(matchesFilter(unknown, 'Paid')).toBe(false);
    expect(matchesFilter(unknown, 'Overdue')).toBe(false);
    for (const filter of ['Unpaid', 'Paid', 'Partially Paid', 'Overdue'] as const) {
      expect(matchesFilter({ ...base, status: 'UNAVAILABLE' }, filter)).toBe(false);
    }
  });
  it('manual ACTIVE/LOCKED filters are independent of billing', () => {
    const locked = { ...base, studentsPaid: 10, schoolEnforcementStatus: 'LOCKED' as const };
    expect(matchesFilter(locked, 'School Locked')).toBe(true);
    expect(matchesFilter(locked, 'School Active')).toBe(false);
    expect(matchesFilter(base, 'School Active')).toBe(true);
    expect(matchesFilter({ ...base, state: 'LOCKED' }, 'School Locked')).toBe(false);
  });
  it('snapshots use state and version; payment changes do not invalidate', () => {
    const snap = snapshotOf(base);
    expect(snapshotMatches(snap, { ...base, studentsPaid: 10, amountPaidMinor: 5 })).toBe(true);
    expect(snapshotMatches(snap, { ...base, manualVersion: 4 })).toBe(false);
    expect(snapshotMatches(snap, { ...base, schoolEnforcementStatus: 'LOCKED' })).toBe(false);
    expect(snapshotMatches(snap, undefined)).toBe(false);
  });
  it('action gating and body', () => {
    const a = snapshotOf(base);
    const l = snapshotOf({ ...base, schoolId: 2, schoolEnforcementStatus: 'LOCKED' });
    expect(actionAllowed('LOCK', [a])).toBe(true);
    expect(actionAllowed('LOCK', [a, l])).toBe(false);
    expect(actionAllowed('UNLOCK', [l])).toBe(true);
    expect(actionAllowed('UNLOCK', [])).toBe(false);
    expect(toActionBody([a], '  ')).toEqual({ confirmed: true, schools: [{ schoolId: 1, expectedVersion: 3 }] });
    expect(toActionBody([a], ' late ')).toEqual({ confirmed: true, schools: [{ schoolId: 1, expectedVersion: 3 }], reason: 'late' });
  });
});
