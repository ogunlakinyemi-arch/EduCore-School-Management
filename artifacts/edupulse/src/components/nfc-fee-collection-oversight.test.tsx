import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { NfcFeeCollectionRow } from '@workspace/api-client-react';

const rows: NfcFeeCollectionRow[] = [
  { invoiceId: 11, lineId: 21, schoolId: 3, schoolName: 'Lekki Hills', studentId: 7, studentName: 'Ada Obi', admissionNo: 'LH-0042', termId: 5, termName: 'First Term', feeName: 'NFC card fee', amountMinor: 320000, paidMinor: 150000, currency: 'NGN', invoiceStatus: 'ISSUED', status: 'PARTIALLY_PAID',
    payments: [{ id: 91, reference: '=HYPERLINK("x")', receiptNumber: null, method: 'BANK_TRANSFER', date: '2025-01-04T10:00:00Z', amountMinor: 150000, status: 'UNDER_REVIEW', recordedBy: 'Bursar Tolu', reviewedBy: null }] },
  { invoiceId: null, lineId: null, schoolId: 3, schoolName: 'Lekki Hills', studentId: 8, studentName: 'Bayo Ade', admissionNo: 'LH-0043', termId: 5, termName: 'First Term', feeName: null, amountMinor: null, paidMinor: 0, currency: 'NGN', invoiceStatus: 'NONE', status: 'NOT_CONFIGURED', payments: [] },
];

const hook = vi.fn((_p: unknown, _o: unknown) => ({ data: { items: rows, total: 2, limit: 25, offset: 0 }, isLoading: false, isError: false, isFetching: false, dataUpdatedAt: 0, refetch: vi.fn() }));
vi.mock('@clerk/react', () => ({ useAuth: () => ({ userId: 'u' }) }));
vi.mock('@workspace/api-client-react', async orig => ({
  ...(await orig<object>()),
  useGetAuthorizedContext: () => ({ data: { user: { id: 42 }, isPlatformOwner: true }, isLoading: false, isError: false }),
  useGetNfcFeeCollectionOversight: (p: unknown, o: unknown) => hook(p, o),
}));

import { NfcFeeCollectionOversight, csvCell, toOversightCsv, oversightQueryKey, formatMinor } from './nfc-fee-collection-oversight';

describe('NFC fee collection oversight', () => {
  const html = renderToStaticMarkup(<NfcFeeCollectionOversight />);
  it('shows heading, warning and honest statuses', () => {
    expect(html).toContain('NFC Fee Collection Oversight');
    expect(html).toContain('NGN 3,200 school-to-Yetenia');
    expect(html).toContain('PARTIALLY_PAID');
    expect(html).not.toMatch(/data-testid="status-0"[^>]*>FULLY_PAID/);
    expect(html).toContain('NOT_CONFIGURED');
    expect(formatMinor(null)).toBe('Not configured');
    expect(html).toContain('data-testid="amount-1">Not configured</td>');
  });
  it('displays references, recorder and reviewer', () => {
    expect(html).toContain('Bursar Tolu');
    expect(html).toContain('not yet reviewed');
    expect(html).toContain('pending school confirmation');
  });
  it('exposes no mutation actions or private data', () => {
    const buttons = [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map(m => m[1]);
    expect(buttons.sort()).toEqual(['Apply', 'Clear', 'Export this page (CSV)', 'Next', 'Previous', 'Refresh']);
    expect(html).not.toMatch(/subaccount|split|verify bank|mark paid/i);
    expect(html).not.toMatch(/objectPath|proofUrl|accountNumber/i);
  });
  it('uses an actor-isolated finite polling query', () => {
    const opts = hook.mock.calls[0][1] as { query: { queryKey: unknown[]; staleTime: number; refetchInterval: number } };
    expect(opts.query.queryKey).toContain('actor:42');
    expect(Number.isFinite(opts.query.staleTime)).toBe(true);
    expect(oversightQueryKey({}, 1)).not.toEqual(oversightQueryKey({}, 2));
  });
  it('protects CSV against formula injection and keeps NOT_CONFIGURED', () => {
    expect(csvCell('=SUM(A1)')).toBe(`"'=SUM(A1)"`);
    expect(csvCell('-1')).toBe(`"'-1"`);
    expect(csvCell('a"b')).toBe('"a""b"');
    const csv = toOversightCsv(rows);
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(csv).toContain('"NOT_CONFIGURED"');
    expect(csv).toContain('Bursar Tolu');
    expect(csv.split('\r\n')).toHaveLength(3);
  });
});
