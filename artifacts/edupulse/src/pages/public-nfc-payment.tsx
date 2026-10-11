import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { checkoutPublicNfcPaymentLink, verifyPublicNfcPaymentLink, simulateNfcPaymentLink, viewPublicNfcPaymentLink, type NfcPaymentLink } from '@workspace/api-client-react';
import { NfcServiceBranding } from '@/components/nfc-service-branding';

const minor = (n: number) => `NGN ${(n / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}`;
const readToken = () => (typeof window === 'undefined' ? '' : window.location.hash.slice(1).split(/[?&]/)[0]);
export const safeFlutterwaveUrl = (u?: string | null) => {
  try { const p = new URL(u ?? ''); return p.protocol === 'https:' && p.hostname === 'checkout.flutterwave.com' && !p.username && !p.password ? p.toString() : null; } catch { return null; }
};
const statusText: Record<string, string> = {
  PENDING: 'Awaiting payment', SIMULATED_SUCCESS: 'Test completed (simulation only)', SIMULATED_FAILED: 'Test failed (simulation only)',
  EXPIRED: 'Link expired', CANCELLED: 'Link cancelled', PAID: 'Payment recorded', FAILED: 'Payment failed', RECONCILIATION_REQUIRED: 'Under review',
};
export function nfcPaymentError(error: unknown) {
  const api = error as { status?: number; data?: { error?: string } };
  if (api?.status === 400 || api?.status === 404) return 'This payment link is invalid or incomplete. Ask the school for a new link.';
  if (api?.status === 503) return 'Flutterwave TEST payment is temporarily unavailable. Ask school staff to check the Development configuration.';
  if (api?.status === 409 && typeof api.data?.error === 'string') return api.data.error;
  return 'The payment service could not respond. Refresh or contact school staff. No payment has been confirmed.';
}

export default function PublicNfcPaymentPage() {
  const [token] = useState(readToken);
  const [link, setLink] = useState<NfcPaymentLink | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState('');

  const load = useCallback(async () => {
    if (!token) { setError('This link is incomplete. Ask the school for a new payment link.'); return; }
    setBusy(true); setError(''); setLink(null);
    try { setLink(await viewPublicNfcPaymentLink({ token })); }
    catch (e) { setError(nfcPaymentError(e)); }
    finally { setBusy(false); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);

  const simulate = async (outcome: 'SUCCESS' | 'FAILED') => {
    setBusy(true); setError('');
    try { setLink(await simulateNfcPaymentLink({ token, outcome })); }
    catch { setError('The simulation could not be completed. Refresh and try again.'); }
    finally { setBusy(false); }
  };

  const verify = async () => {
    setBusy(true); setError('');
    try { setLink(await verifyPublicNfcPaymentLink({ token })); }
    catch (e) { setError(nfcPaymentError(e)); }
    finally { setBusy(false); }
  };
  const checkoutPayment = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await checkoutPublicNfcPaymentLink({ token, email: email.trim() });
      setLink(result);
      const url = result.status === 'PENDING' ? safeFlutterwaveUrl(result.checkoutUrl) : null;
      if (url) window.location.assign(url);
      else if (result.status !== 'PAID') setError('Checkout is initializing or needs review. Do not start another payment; refresh or check payment status.');
    } catch (e) { setError(nfcPaymentError(e)); }
    finally { setBusy(false); }
  };

  const pending = !error && link?.status === 'PENDING';
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
        {link.mode === 'FLUTTERWAVE_SANDBOX' && <p className="mt-4 rounded-xl bg-[hsl(var(--secondary))] p-3 text-xs font-semibold">
          Flutterwave TEST MODE. No real money moves and no automatic bank splits run. Only server-verified test payments update the Development subscription.</p>}
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
        {link.receiptReference && <p className="mt-2 text-xs">Verified TEST receipt reference: {link.receiptReference} (not a real-money receipt)</p>}
        {link.status === 'SIMULATED_SUCCESS' && <p className="mt-3 text-xs">The test finished. This is not a payment.</p>}
        {!pending && ['EXPIRED', 'CANCELLED', 'FAILED', 'PAID'].includes(link.status) && <p className="mt-3 text-xs">This link can no longer be used to pay.</p>}
        {pending && link.mode === 'DEVELOPMENT_SIMULATION' && <div className="mt-4 flex flex-wrap gap-2">
          <button className={btn} disabled={busy} onClick={() => void simulate('SUCCESS')}>Simulate success</button>
          <button className={btn} disabled={busy} onClick={() => void simulate('FAILED')}>Simulate failure</button>
        </div>}
        {pending && link.mode === 'FLUTTERWAVE_SANDBOX' && <form className="mt-4 space-y-2" onSubmit={event => void checkoutPayment(event)}>
          <label className="block text-sm font-semibold" htmlFor="nfc-payer-email">Email for Flutterwave TEST checkout</label>
          <input id="nfc-payer-email" className="w-full rounded-xl border bg-transparent px-3 py-2 text-sm" type="email"
            required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} autoComplete="email" />
          <button type="submit" className={btn} disabled={busy}>Pay NFC Card Fees Through Flutterwave</button>
        </form>}
        {link.mode === 'FLUTTERWAVE_SANDBOX' && !['PAID', 'EXPIRED', 'CANCELLED'].includes(link.status) &&
          <button className={`${btn} mt-3`} disabled={busy} onClick={() => void verify()}>Check payment status with Flutterwave</button>}
        {link.mode === 'FLUTTERWAVE_SANDBOX' && <p className="mt-2 text-xs">Returning from checkout does not prove payment. Use “Check payment status” or refresh after the verified webhook arrives.</p>}
      </>}
      <button className={`${btn} mt-4 inline-flex items-center gap-2`} disabled={busy} onClick={() => void load()}><RefreshCw size={14} />Refresh</button>
    </div>
  </main>;
}
