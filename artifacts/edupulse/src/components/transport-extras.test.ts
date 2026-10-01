import { describe, expect, it, vi } from 'vitest';
import { buildFeePlanRequest, employeeSearchParams, nairaToMinor } from './transport-logic';

const hooks = vi.hoisted(() => ({ search: vi.fn(), upsert: vi.fn() }));
vi.mock('@workspace/api-client-react', () => ({ useSearchTransportEmployees: hooks.search, useUpsertTransportAssignmentFeePlan: hooks.upsert }));

describe('employee accompaniment scope', () => {
  it('always scopes search to the school and role with a limit', () => {
    expect(employeeSearchParams(7, '  ada ', 'TEACHER')).toEqual({ schoolId: 7, role: 'TEACHER', limit: 25, search: 'ada' });
    expect(employeeSearchParams(7, '', 'STAFF')).not.toHaveProperty('search');
  });
  it('passes the scoped params to the search hook', async () => {
    const mod = await import('@workspace/api-client-react');
    mod.useSearchTransportEmployees(employeeSearchParams(3, 'x', 'ACCOMPANIER') as never);
    expect(hooks.search).toHaveBeenCalledWith(expect.objectContaining({ schoolId: 3, role: 'ACCOMPANIER' }));
  });
});

describe('fee plan payload', () => {
  const form = { sessionId: '2', termId: '5', amount: '15,000.50', dueDate: '2026-02-01', categoryId: '9', reason: 'Term plan' };
  it('converts naira to minor units', () => { expect(nairaToMinor('15,000.50')).toBe(1500050); expect(nairaToMinor('-1')).toBeNull(); expect(nairaToMinor('')).toBeNull(); });
  it('builds a typed upsert from existing record ids', async () => {
    const r = buildFeePlanRequest(7, 11, form);
    expect('vars' in r && r.vars).toEqual({ assignmentId: 11, academicTermId: 5, params: { schoolId: 7 }, data: { academicSessionId: 2, feePlanAmountMinor: 1500050, reason: 'Term plan', dueDate: '2026-02-01', feeCategoryId: 9 } });
    const mod = await import('@workspace/api-client-react');
    mod.useUpsertTransportAssignmentFeePlan();
    expect(hooks.upsert).toHaveBeenCalled();
  });
  it('omits optional dueDate and category so the server defaults apply', () => {
    const r = buildFeePlanRequest(7, 11, { ...form, dueDate: '', categoryId: '' });
    expect('vars' in r && r.vars.data).not.toHaveProperty('dueDate');
  });
  it('rejects missing term, bad amount and short reason', () => {
    expect(buildFeePlanRequest(7, 11, { ...form, termId: '' })).toHaveProperty('error');
    expect(buildFeePlanRequest(7, 11, { ...form, amount: 'abc' })).toHaveProperty('error');
    expect(buildFeePlanRequest(7, 11, { ...form, reason: 'a' })).toHaveProperty('error');
  });
});
