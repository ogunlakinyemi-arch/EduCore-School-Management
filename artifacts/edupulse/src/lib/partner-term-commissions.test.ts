import { describe, it, expect } from 'vitest';
import { groupCommissions, isEligible, prepareApproval, isAmbiguousFailure, formatSum } from './partner-term-commissions';
const mk = (o: Record<string, unknown>) => ({ id: 1, partnerId: 1, partnerName: 'P', schoolId: 1, studentId: 1, sessionId: 1, termId: 1, term: 'First', sessionName: '2025', reference: 'r', status: 'PENDING', amountMinor: 100, grossMinor: 1000, schoolMinor: 500, providerFeeMinor: 10, providerAdditionalFeeMinor: 0, vatMinor: null, merchantRemainderMinor: 1, ownerNetMinor: 1, eligible: true, termEnded: true, settlementStatus: 'x', ...o }) as never;
const store = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) } as unknown as Storage; };
describe('term commissions', () => {
  it('groups across school-specific term ids and keeps unknown', () => {
    const g = groupCommissions([mk({ id: 1 }), mk({ id: 2, schoolId: 2, termId: 9 })]);
    expect(g).toHaveLength(1);
    expect(g[0].termIds.sort()).toEqual([1, 9]);
    expect(formatSum(g[0].vat)).toBe('Unknown');
  });
  it('eligibility needs all three conditions', () => {
    expect(isEligible(mk({}))).toBe(true);
    expect(isEligible(mk({ termEnded: false }))).toBe(false);
    expect(isEligible(mk({ status: 'APPROVED' }))).toBe(false);
  });
  it('retains the same key and payload on retry', () => {
    const s = store();
    const a = prepareApproval(s, [3, 2]);
    const b = prepareApproval(s, [9]);
    expect(b).toEqual(a);
    expect(a.commissionIds).toEqual([2, 3]);
    expect(isAmbiguousFailure(new Error('net'))).toBe(true);
    expect(isAmbiguousFailure({ status: 409 })).toBe(false);
  });
});
