import { describe, expect, it } from 'vitest';
import { REPLACEMENT_FEE_MINOR, formatNairaMinor, replacementPermissions, canIssueRequest, replacementStatusLabel, preparedUnassignedCards } from './card-replacements-model';
const owner = { owner: true, roles: [] }, admin = { owner: false, roles: ['SCHOOL_ADMIN'] }, parent = { owner: false, roles: ['PARENT'] };
describe('card replacements', () => {
  it('prices at 2,000 naira', () => { expect(REPLACEMENT_FEE_MINOR).toBe(200000); expect(formatNairaMinor(200000)).toBe('₦2,000.00'); });
  it('permissions', () => {
    expect(replacementPermissions(owner)).toMatchObject({ canIssue: true, canRequest: false, canPay: false });
    expect(replacementPermissions(admin)).toMatchObject({ canIssue: false, canRequest: true, canPay: true });
    expect(replacementPermissions(parent)).toMatchObject({ canPay: true, canIssue: false });
    expect(replacementPermissions({ owner: false, roles: ['TEACHER'] }).canView).toBe(false);
  });
  it('gates issuance on payment', () => {
    expect(canIssueRequest({ status: 'REQUESTED', paymentStatus: 'UNPAID' }, owner)).toBe(false);
    expect(canIssueRequest({ status: 'REQUESTED', paymentStatus: 'PAID' }, owner)).toBe(true);
    expect(canIssueRequest({ status: 'REQUESTED', paymentStatus: 'PAID' }, admin)).toBe(false);
    expect(canIssueRequest({ status: 'ISSUED', paymentStatus: 'PAID' }, owner)).toBe(false);
  });
  it('status labels and unassigned filter', () => {
    expect(replacementStatusLabel({ status: 'REQUESTED', paymentStatus: 'UNPAID' })).toBe('Awaiting payment');
    expect(replacementStatusLabel({ status: 'ISSUED', paymentStatus: 'PAID' })).toBe('Issued');
    expect(preparedUnassignedCards([{ status: 'unassigned' }, { status: 'active' }])).toHaveLength(1);
  });
});
