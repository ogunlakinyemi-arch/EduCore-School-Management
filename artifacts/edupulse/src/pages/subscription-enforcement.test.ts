import { describe, expect, it } from 'vitest';
import type { SchoolSubscriptionSummary } from '@workspace/api-client-react';
import { canSelect, matchesFilter, snapshotMatches, toLockBody } from './subscription-enforcement';

const base: SchoolSubscriptionSummary = { schoolId: 1, schoolName: 'A', status: 's', state: 'UNPAID', termId: 9, termName: 'T1', enforcementDate: '2020-01-01', studentsTotal: 10, studentsPaid: 4 };
describe('enforcement helpers', () => {
  it('filters', () => {
    expect(matchesFilter(base, 'Partially Paid')).toBe(true);
    expect(matchesFilter(base, 'Overdue')).toBe(true);
    expect(matchesFilter({ ...base, inGracePeriod: true }, 'Overdue')).toBe(false);
    expect(matchesFilter({ ...base, studentsPaid: 10 }, 'Paid')).toBe(true);
  });
  it('selection and body use captured ids, not positions', () => {
    expect(canSelect({ ...base, inGracePeriod: true })).toBe(false);
    expect(canSelect({ ...base, schoolLocked: true })).toBe(true);
    const snap = { schoolId: 1, termId: 9, schoolName: 'A', termName: 'T1', enforcementDate: '2020-01-01' };
    expect(snapshotMatches(snap, base)).toBe(true);
    expect(snapshotMatches(snap, { ...base, termId: 10 })).toBe(false);
    expect(toLockBody([snap])).toEqual({ confirmed: true, schools: [{ schoolId: 1, termId: 9 }] });
  });
});
