import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./platform-company-employees.tsx', import.meta.url), 'utf8');

describe('internal company employee invitation form', () => {
  it('requires the Owner to choose an internal role and school-scopes activation officers', () => {
    expect(source).toContain('data-testid="select-company-employee-role"');
    expect(source).toContain('<option value="" disabled>Choose an employee role</option>');
    expect(source).toContain('value="COMPANY_ACCOUNTANT"');
    expect(source).toContain('value="DEVICE_ACTIVATION_OFFICER"');
    expect(source).toContain('form.role === \'DEVICE_ACTIVATION_OFFICER\'');
    expect(source).toContain('data-testid="select-company-employee-authorized-school"');
    expect(source).toContain('schoolId: Number(form.schoolId)');
  });

  it('discloses that a Clerk request is not proof of email delivery', () => {
    expect(source).toContain('deliveryConfirmed: boolean');
    expect(source).toContain('not independently confirmed');
    expect(source).toContain('not confirmed dispatch or inbox delivery');
  });
});