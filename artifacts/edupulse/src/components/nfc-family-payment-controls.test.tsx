import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { StudentNfcObligation } from '@workspace/api-client-react';
const state = vi.hoisted(() => ({ role: 'PARENT' }));
vi.mock('@workspace/api-client-react', () => ({
  useGetAuthorizedContext: () => ({ data: { roles: [{ role: state.role, schoolId: 1, status: 'ACTIVE' }] } }),
}));
vi.mock('./shared', () => ({
  Button: ({ children, disabled, testId }: { children: React.ReactNode; disabled?: boolean; testId?: string }) =>
    <button disabled={disabled} data-testid={testId}>{children}</button>,
}));
vi.mock('./school-document', () => ({ SchoolDocumentPrintButton: () => null }));
import { canOpenFamilyNfcPaymentLink, NfcPaymentLinkControls } from './nfc-payment-link-controls';
const row = { schoolId: 1, studentId: 2, termId: 3, subscriptionId: 4, status: 'UNPAID', canPay: true } as StudentNfcObligation;
const context = (role: string, schoolId = 1) => ({ roles: [{ role, schoolId, status: 'ACTIVE' }] });
describe('Separate family NFC payment action', () => {
  it.each(['PARENT', 'STUDENT'])('shows %s a TEST-only action and clearly labelled Development preview', role => {
    state.role = role;
    const html = renderToStaticMarkup(<NfcPaymentLinkControls row={row} familyView />);
    expect(html).toContain('Pay NFC Card Fees Through Flutterwave');
    expect(html).not.toContain('button disabled="" data-testid="button-live-nfc');
    expect(html).toContain('Flutterwave TEST MODE only in Development');
    expect(html).toContain('Preview Development payment link');
    expect(html).toContain('simulation does not collect money');
    expect(html).not.toContain('Cancel link');
  });
  it.each(['PAID', 'EXEMPT', 'LEGACY_REVIEW', 'PENDING'] as const)('does not generate another charge/link for %s', status => {
    expect(canOpenFamilyNfcPaymentLink(context('PARENT'), { ...row, status })).toBe(false);
  });
  it('does not offer a school-mismatched, Owner or inactive-eligibility action', () => {
    expect(canOpenFamilyNfcPaymentLink(context('PARENT', 99), row)).toBe(false);
    expect(canOpenFamilyNfcPaymentLink({ ...context('PARENT'), isPlatformOwner: true }, row)).toBe(false);
    expect(canOpenFamilyNfcPaymentLink(context('STUDENT'), { ...row, canPay: false })).toBe(false);
    expect(canOpenFamilyNfcPaymentLink(context('TEACHER'), row)).toBe(false);
  });
});
