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

  it('keeps invitation lifecycle separate from employee profile status', () => {
    expect(source).toContain('invitationStatus:');
    expect(source).toContain('<span>Profile status</span>');
    expect(source).toContain('<span>Invitation status</span>');
    expect(source).toContain('Invitation status: {invitation.status}. Profile status is managed separately.');
  });

  it('supports editing and resending only pending or expired invitations through invitation routes', () => {
    expect(source).toContain("employee.invitationStatus.status === 'PENDING' || employee.invitationStatus.status === 'EXPIRED'");
    expect(source).toContain('`${endpoint}/${id}/invitation`');
    expect(source).toContain("method: 'PATCH'");
    expect(source).toContain('body: JSON.stringify({ email })');
    expect(source).toContain('`${endpoint}/${employeeId}/invitation/resend`');
    expect(source).toContain("method: 'POST'");
    expect(source).toContain('body: JSON.stringify({ invitationId })');
    expect(source).toContain('invitationId?: string');
    expect(source).toContain('invitation.invitation?.invitationId');
    expect(source).toContain('disabled={emailPending || resendPending || !hasInvitationId}');
  });

  it('does not send edited employee profile emails through the generic profile patch', () => {
    expect(source).toContain('...(!initial ? { email: form.email.trim() } : {})');
    expect(source).toContain('readOnly={Boolean(initial)}');
    expect(source).toContain("invitationQuery.data.status === 'PENDING' || invitationQuery.data.status === 'EXPIRED'");
  });

  it('refreshes employee and invitation state after invitation mutations without changing role or school', () => {
    expect(source).toContain('await Promise.all([');
    expect(source).toContain('await refresh()');
    expect(source).toContain('ResentInvitation');
    expect(source).toContain('role:');
    expect(source).toContain('schoolId:');
  });
});