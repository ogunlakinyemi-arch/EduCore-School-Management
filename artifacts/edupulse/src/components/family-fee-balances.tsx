import type { FeeInvoice, StudentNfcObligation } from '@workspace/api-client-react';
import { useStudentNfcObligations } from './student-nfc-obligations';
import { ErrorState, money } from './shared';

export function familyFeeBalances(
  invoices: Pick<FeeInvoice, 'outstandingMinor' | 'paidMinor'>[],
  nfcRows: Pick<StudentNfcObligation, 'amountMinor' | 'status'>[],
) {
  const schoolOutstanding = invoices.reduce((sum, invoice) => sum + invoice.outstandingMinor, 0);
  const schoolPaid = invoices.reduce((sum, invoice) => sum + invoice.paidMinor, 0);
  // The NFC ledger is independent: neither a paid school invoice nor a simulated
  // public-link outcome is evidence of a verified NFC payment.
  const nfcOutstanding = nfcRows.reduce((sum, row) =>
    sum + (['UNPAID', 'PENDING', 'FAILED'].includes(row.status) ? row.amountMinor : 0), 0);
  return { schoolOutstanding, schoolPaid, nfcOutstanding, combinedOutstanding: schoolOutstanding + nfcOutstanding };
}

export function FamilyFeeBalances({ invoices, studentId }: { invoices: FeeInvoice[]; studentId?: number }) {
  const nfc = useStudentNfcObligations({ studentId });
  const rows = (nfc.data?.rows ?? []).filter(row => studentId == null || row.studentId === studentId);
  const totals = familyFeeBalances(invoices, rows);
  const ready = !nfc.isLoading && !nfc.isError && !!nfc.data;
  return <section aria-label="Independent school and NFC fee balances">
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {[
        ['Total outstanding', ready ? money(totals.combinedOutstanding / 100) : 'Unavailable', 'School fees + separate NFC subscription'],
        ['School fees outstanding', money(totals.schoolOutstanding / 100), "Use the school's configured payment methods"],
        ['NFC outstanding', ready ? money(totals.nfcOutstanding / 100) : 'Unavailable', 'Separate Flutterwave payment when configured'],
        ['School payments verified', money(totals.schoolPaid / 100), 'Does not mark the NFC subscription paid'],
      ].map(([label, amount, detail], index) => <div key={label} className={`panel p-5 ${index === 0 ? 'border-[hsl(var(--primary))]' : ''}`}>
        <div className="eyebrow">{label}</div><div className="mt-2 text-2xl font-bold tabular-nums" data-testid={`family-fee-balance-${index}`}>{amount}</div>
        <div className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">{detail}</div>
      </div>)}
    </div>
    {nfc.isLoading && <p role="status" className="mt-3 text-xs">Checking NFC balances before calculating the combined total...</p>}
    {nfc.isError && <div className="mt-3"><ErrorState retry={() => nfc.refetch()} message="NFC balances could not be loaded. The combined total is unavailable; ordinary school fees remain separate." /></div>}
  </section>;
}
