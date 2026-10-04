import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { activationBlockedReason, employeeNfcAccess } from './employee-nfc';

const src = readFileSync(new URL('./employee-nfc.tsx', import.meta.url), 'utf8');

describe('employee NFC identity and roles', () => {
  it('labels cards as employee identity, not student', () => {
    expect(src).toContain('badge-employee-identity');
    expect(src).toContain('Not a student card');
  });

  it('gives School Admin preview and discrepancy resolution, Owner official card control', () => {
    const ctx = { isPlatformOwner: false, roles: [{ schoolId: 4, role: 'SCHOOL_ADMIN', status: 'ACTIVE' }] };
    expect(employeeNfcAccess(ctx, 4)).toMatchObject({ canView: true, canManageCards: false, canResolve: true, readOnlyAttendance: false });
    expect(employeeNfcAccess(ctx, 5).canView).toBe(false);
    expect(employeeNfcAccess({ isPlatformOwner: true, roles: [] }, 4)).toMatchObject({ canManageCards: true, canResolve: false, readOnlyAttendance: true });
  });

  it('denies corporate and payroll roles and teachers', () => {
    expect(employeeNfcAccess({ roles: [{ schoolId: null, role: 'COMPANY_ACCOUNTANT', status: 'ACTIVE' }] }, 4).canView).toBe(false);
    expect(employeeNfcAccess({ roles: [{ schoolId: 4, role: 'TEACHER', status: 'ACTIVE' }] }, 4).canView).toBe(false);
  });

  it('blocks activation while payment is pending or unpaid', () => {
    const base = { status: 'LOCKED', paymentRequired: true, nfcEligible: false } as const;
    expect(activationBlockedReason({ ...base, termEligibility: 'PENDING' })).toMatch(/pending/i);
    expect(activationBlockedReason({ ...base, termEligibility: 'UNPAID' })).toMatch(/not paid/i);
    expect(activationBlockedReason({ ...base, termEligibility: 'PAID', nfcEligible: true })).toBeNull();
    expect(activationBlockedReason({ ...base, status: 'ACTIVE', termEligibility: 'PAID' })).toMatch(/locked/i);
  });

  it('never writes attendance from the owner path or ingests device events', () => {
    expect(src).not.toMatch(/useIngestEmployeeNfcAttendance/);
    expect(src).toContain('canResolve && r.status');
    expect(src).toContain('/my-nfc-subscription');
  });
});
