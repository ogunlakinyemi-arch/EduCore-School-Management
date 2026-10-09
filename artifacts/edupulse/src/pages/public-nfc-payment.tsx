import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { simulateNfcPaymentLink, viewPublicNfcPaymentLink, type NfcPaymentLink } from '@workspace/api-client-react';
import { NfcServiceBranding } from '@/components/nfc-service-branding';

const minor = (n: number) => `NGN ${(n / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
const readToken = () => (typeof window === 'undefined' ? '' : window.location.hash.slice(1));
export const safeFlutterwaveUrl = (u?: string | null) => {
  try { const p = new URL(u ?? ''); return p.protocol === 'https:' && p.hostname === 'checkout.flutterwave.com' && !p.username && !p.password ? p.toString() : null; } catch { return null; }
};
const statusText: Record<string, string> = {
  PENDING: 'Awaiting payment', SIMULATED_SUCCESS: 'Test completed (simulation only)', SIMULATED_FAILED: 'Test failed (simulation only)',
  EXPIRED: 'Link expired', CANCELLED: 'Link cancelled', PAID: 'Payment recorded', FAILED: 'Payment failed', RECONCILIATION_REQUIRED: 'Under review',
};

export default function PublicNfcPaymentPage() {
  const [token] = useState(readToken);
  const [link, setLink] = useState<NfcPaymentLink | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!token) { setError('This link is incomplete. Ask the school for a new payment link.'); return; }
    setBusy(true); setError('');
    try { setLink(await viewPublicNfcPaymentLink({ token })); }
    catch { setError('This payment link is invalid or no longer available.'); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const simulate = async (outcome: 'SUCCESS' | 'FAILED') => {
    setBusy(true); setError('');
    try { setLink(await simulateNfcPaymentLink({ token, outcome })); }
    catch { setError('The simulation could not be completed. Refresh and try again.'); }
    finally { setBusy(false); }
  };

  const pending = !error && link?.status === 'PENDING';
  const checkout = pending && link?.mode === 'FLUTTERWAVE_SANDBOX' ? safeFlutterwaveUrl(link.checkoutUrl) : null;
  const btn = 'rounded-xl border border-[hsl(var(--border))] px-4 py-2 text-sm font-bold disabled:opacity-50';

  return <main className="flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] p-5">
    <div className="panel w-full max-w-md p-6 fade-up" data-testid="public-nfc-payment">
      <div className="eyebrow">NFC term fee</div>
      <h1 className="display-font mt-1 text-2xl font-bold">Payment link</h1>
      <NfcServiceBranding />
      {!link && !error && <div className="skeleton mt-4 h-28 rounded-xl" />}
      {error && <p role="alert" className="mt-4 text-sm font-semibold text-[hsl(var(--destructive))]">{error}</p>}
      {link && <>
        {link.mode === 'DEVELOPMENT_SIMULATION' && <p className="mt-4 rounded-xl bg-[hsl(var(--secondary))] p-3 text-xs font-semibold">
          Development simulation. No money moves, no real receipt is issued and no subscription is activated.</p>}
        <dl className="mt-4 space-y-1 text-sm">
          <div>{link.schoolName}</div>
          <div className="font-bold">{link.studentIdentifier}</div>
          <div>{link.termName}, {link.sessionName}</div>
          <div className="text-xl font-bold tabular-nums">{minor(link.amountDueMinor)}</div>
          <div>Status: <b data-testid="public-nfc-status">{statusText[link.status] ?? link.status}</b></div>
          <div className="text-xs text-[hsl(var(--muted-foreground))]">Reference <span className="font-mono">{link.reference}</span> · Expires {new Date(link.expiresAt).toLocaleString()}</div>
        </dl>
        <p className="mt-4 text-xs leading-5">
          No EduCore account is needed. Check the school, student identifier and term before continuing.
          If you do not have a suitable device, school staff can assist using these instructions.
          Cash given to the school does not verify this NFC subscription.
        </p>
        <p className="mt-2 text-xs">Actual bank settlement: unverified.</p>
        {link.receiptReference && <p className="mt-2 text-xs">Verified receipt reference: {link.receiptReference}</p>}
        {link.status === 'SIMULATED_SUCCESS' && <p className="mt-3 text-xs">The test finished. This is not a payment.</p>}
        {!pending && ['EXPIRED', 'CANCELLED', 'FAILED', 'PAID'].includes(link.status) && <p className="mt-3 text-xs">This link can no longer be used to pay.</p>}
        {pending && link.mode === 'DEVELOPMENT_SIMULATION' && <div className="mt-4 flex flex-wrap gap-2">
          <button className={btn} disabled={busy} onClick={() => void simulate('SUCCESS')}>Simulate success</button>
          <button className={btn} disabled={busy} onClick={() => void simulate('FAILED')}>Simulate failure</button>
        </div>}
        {checkout && <a className={`${btn} mt-4 inline-block`} href={checkout} target="_blank" rel="noreferrer noopener">Pay on secure checkout</a>}
      </>}
      <button className={`${btn} mt-4 inline-flex items-center gap-2`} disabled={busy} onClick={() => void load()}><RefreshCw size={14} />Refresh</button>
    </div>
  </main>;
}
