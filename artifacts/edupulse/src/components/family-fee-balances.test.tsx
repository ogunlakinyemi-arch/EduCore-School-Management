import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeeInvoice, StudentNfcObligation } from '@workspace/api-client-react';

const state = vi.hoisted(() => ({ rows: [] as StudentNfcObligation[], error: false }));
vi.mock('./student-nfc-obligations', () => ({
  useStudentNfcObligations: () => ({ data: { rows: state.rows }, isLoading: false, isError: state.error, refetch: vi.fn() }),
}));
vi.mock('./shared', () => ({
  money: (value: number) => `₦${value.toLocaleString('en-NG')}`,
  ErrorState: ({ message }: { message: string }) => <p role="alert">{message}</p>,
}));
import { FamilyFeeBalances, familyFeeBalances } from './family-fee-balances';

const invoice = { outstandingMinor: 3400000, paidMinor: 0 } as FeeInvoice;
const unpaid = { studentId: 1, status: 'UNPAID', amountMinor: 500000 } as StudentNfcObligation;
describe('Family fee balances', () => {
  beforeEach(() => { state.rows = [unpaid]; state.error = false; });
  it('adds the example ordinary fees and separate NFC fee to 39000', () => {
    expect(familyFeeBalances([invoice], [unpaid])).toMatchObject({
      schoolOutstanding: 3400000, nfcOutstanding: 500000, combinedOutstanding: 3900000,
    });
    const html = renderToStaticMarkup(<FamilyFeeBalances invoices={[invoice]} studentId={1} />);
    for (const text of ['₦39,000', '₦34,000', '₦5,000', "school&#x27;s configured payment methods", 'Separate Flutterwave'])
      expect(html).toContain(text);
  });
  it('does not clear NFC when school fees are paid', () => {
    expect(familyFeeBalances([{ outstandingMinor: 0, paidMinor: 3400000 }], [unpaid])).toMatchObject({
      schoolPaid: 3400000, nfcOutstanding: 500000, combinedOutstanding: 500000,
    });
  });
  it.each(['PAID', 'EXEMPT', 'LEGACY_REVIEW'] as const)('does not double-count %s NFC', status => {
    expect(familyFeeBalances([invoice], [{ ...unpaid, status }]).nfcOutstanding).toBe(0);
  });
  it.each(['PENDING', 'FAILED'] as const)('does not treat %s NFC as paid', status => {
    expect(familyFeeBalances([invoice], [{ ...unpaid, status }]).combinedOutstanding).toBe(3900000);
  });
  it('filters the parent summary to the selected child', () => {
    state.rows.push({ ...unpaid, studentId: 2 });
    const html = renderToStaticMarkup(<FamilyFeeBalances invoices={[invoice]} studentId={1} />);
    expect(html).toContain('₦39,000');
    expect(html).not.toContain('₦44,000');
  });
  it('does not silently present an incomplete total when NFC loading fails', () => {
    state.error = true;
    const html = renderToStaticMarkup(<FamilyFeeBalances invoices={[invoice]} />);
    expect(html).toContain('combined total is unavailable');
    expect(html).not.toContain('₦39,000');
    expect(html).toContain('₦34,000');
  });
});
