import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { ArrowRight, Clock3, CreditCard, ReceiptText, ShieldCheck } from 'lucide-react';
import {
  useGetParentFeeInvoicePaymentMethods, useGetParentFeeInvoiceCheckoutPolicy, useInitializeFeeProviderPayment, useListParentFeeInvoices,
  useListParentFeePayments, useGetFeePaymentReceipt, useGetParentChild,
  getGetParentFeeInvoicePaymentMethodsQueryKey, getGetParentFeeInvoiceCheckoutPolicyQueryKey, getListParentFeeInvoicesQueryKey,
  getListParentFeePaymentsQueryKey, getGetFeePaymentReceiptQueryKey, getGetParentChildQueryKey, getListMyFeePaymentNotificationsQueryKey,
} from '@workspace/api-client-react';
import type { FeeInvoice } from '@workspace/api-client-react';
import { Button, ErrorState, PageHeading, StatusPill } from '@/components/shared';

type Provider = 'PAYSTACK' | 'FLUTTERWAVE';
type Attempt = { studentId: number; invoiceId: number; paymentId: number; reference: string; amountMinor: number; provider: Provider; partial: boolean };
const storageKey = 'edupulse:parent-provider-checkout';
const money = (minor: number) => `₦${(BigInt(minor) / 100n).toLocaleString('en-NG')}.${String(BigInt(minor) % 100n).padStart(2, '0')}`;
const message = (error: unknown) => error instanceof Error ? error.message : 'Checkout could not be started. Please try again.';
const minorToInput = (minor: number) => `${BigInt(minor) / 100n}.${String(BigInt(minor) % 100n).padStart(2, '0')}`;
const parseNairaMinor = (value: string): number | null => {
  const trimmed = value.trim();
  if (!/^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.replaceAll(',', '').split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return minor > 0n && minor <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minor) : null;
};

export function ParentOnlineMethods({ invoice, studentId }: { invoice: FeeInvoice; studentId: number }) {
  const qc = useQueryClient();
  const methods = useGetParentFeeInvoicePaymentMethods(invoice.id, { query: { enabled: invoice.outstandingMinor > 0 && invoice.studentId === studentId, queryKey: getGetParentFeeInvoicePaymentMethodsQueryKey(invoice.id), refetchOnMount: 'always', refetchOnWindowFocus: true } });
  const policy = useGetParentFeeInvoiceCheckoutPolicy(invoice.id, { query: { enabled: invoice.outstandingMinor > 0 && invoice.studentId === studentId, queryKey: getGetParentFeeInvoiceCheckoutPolicyQueryKey(invoice.id), refetchOnMount: 'always', refetchOnWindowFocus: true } });
  const [amountInput, setAmountInput] = useState('');
  const [amountEdited, setAmountEdited] = useState(false);
  const [attempt, setAttempt] = useState<{ key: string; provider: Provider; amountMinor: number; partial: boolean } | null>(null);
  const handled = useRef('');
  const [failure, setFailure] = useState('');
  const checkout = useInitializeFeeProviderPayment({ request: { headers: attempt ? { 'Idempotency-Key': attempt.key } : {} } });
  const invoices = useListParentFeeInvoices({ query: { enabled: false, queryKey: getListParentFeeInvoicesQueryKey() } });
  const history = useListParentFeePayments({ query: { enabled: true, queryKey: getListParentFeePaymentsQueryKey(), refetchInterval: 10000 } });
  const unresolved = history.data?.some(item => item.invoiceId === invoice.id && item.studentId === studentId && (item.status === 'PENDING' || item.status === 'PROCESSING') && (item.method === 'PAYSTACK' || item.method === 'FLUTTERWAVE')) === true;
  const available = (methods.data ?? []).filter((value): value is Provider => value === 'PAYSTACK' || value === 'FLUTTERWAVE');
  const authorizedPolicy = policy.data?.invoiceId === invoice.id && policy.data.schoolId === invoice.schoolId;
  const outstanding = authorizedPolicy ? (policy.data?.outstandingMinor ?? invoice.outstandingMinor) : invoice.outstandingMinor;
  const displayedAmount = amountEdited ? amountInput : minorToInput(outstanding);
  const enteredMinor = parseNairaMinor(displayedAmount);
  const validAmount = authorizedPolicy && Number.isSafeInteger(outstanding) && outstanding > 0 &&
    enteredMinor !== null && enteredMinor <= outstanding && (policy.data?.partialPaymentsEnabled || enteredMinor === outstanding);
  const begin = (provider: Provider) => {
    if (!validAmount || enteredMinor === null) { setFailure('Enter an amount greater than ₦0.00 and no more than the outstanding balance, with at most two decimal places.'); return; }
    setFailure('');
    setAttempt({ key: crypto.randomUUID(), provider, amountMinor: enteredMinor, partial: enteredMinor < outstanding });
  };
  useEffect(() => {
    if (!attempt || handled.current === attempt.key) return;
    handled.current = attempt.key;
    const start = async () => {
      try {
        const [latestMethods, latestInvoices, latestPolicy] = await Promise.all([methods.refetch(), invoices.refetch(), policy.refetch()]);
        const latest = latestInvoices.data?.find(item => item.id === invoice.id && item.studentId === studentId && item.schoolId === invoice.schoolId);
        const latestHistory = await history.refetch();
        if (latestHistory.isError) throw new Error('Payment history could not be checked. Please retry before starting another checkout.');
        if (latestHistory.data?.some(item => item.invoiceId === invoice.id && item.studentId === studentId && (item.status === 'PENDING' || item.status === 'PROCESSING') && (item.method === 'PAYSTACK' || item.method === 'FLUTTERWAVE'))) throw new Error('An online payment is already processing for this invoice. Check its status before attempting another.');
        if (latestMethods.isError || !latestMethods.data?.includes(attempt.provider) || !latest || latest.outstandingMinor < 1) throw new Error('This payment method or invoice is no longer payable. Nothing was charged.');
        if (latestPolicy.isError || latestPolicy.data?.invoiceId !== latest.id || latestPolicy.data.schoolId !== latest.schoolId || !Number.isSafeInteger(latestPolicy.data.outstandingMinor) || latestPolicy.data.outstandingMinor !== latest.outstandingMinor) throw new Error('Checkout policy or outstanding balance changed. Refresh the invoice before paying.');
        const requestedMinor = attempt.partial ? attempt.amountMinor : latestPolicy.data.outstandingMinor;
        if (!Number.isSafeInteger(requestedMinor) || requestedMinor < 1 || requestedMinor > latestPolicy.data.outstandingMinor || (attempt.partial && !latestPolicy.data.partialPaymentsEnabled)) throw new Error('This payment amount is no longer permitted. No checkout was started.');
        const result = await checkout.mutateAsync({ invoiceId: latest.id, provider: attempt.provider, ...(attempt.partial ? { data: { amountMinor: requestedMinor } } : {}) });
        if ('outcome' in result) throw new Error(result.error || 'Checkout is processing. Check payment history before trying again.');
        if (result.invoiceId !== invoice.id || result.provider !== attempt.provider || result.status !== 'PENDING' || result.amountMinor !== requestedMinor) throw new Error('Checkout details did not match the current invoice. Please contact the school.');
        const url = new URL(result.checkoutUrl);
        if (url.protocol !== 'https:' || url.username || url.password) throw new Error('The provider did not return a secure checkout address.');
        const record: Attempt = { studentId, invoiceId: invoice.id, paymentId: result.paymentId, reference: result.reference, amountMinor: result.amountMinor, provider: result.provider, partial: result.amountMinor < latestPolicy.data.outstandingMinor };
        window.sessionStorage.setItem(storageKey, JSON.stringify(record));
        qc.invalidateQueries({ queryKey: getListParentFeePaymentsQueryKey() });
        window.location.assign(url.href);
      } catch (error) { setFailure(message(error)); setAttempt(null); }
    };
    void start();
    // The key represents one intentional attempt. Hook and query objects are deliberately not dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt?.key]);
  if (methods.isLoading || policy.isLoading) return <div className="mt-4 skeleton h-10 max-w-64 rounded-xl" />;
  if (methods.isError) return <div className="mt-4 text-xs text-[hsl(var(--destructive))]">Online methods unavailable. <button onClick={() => methods.refetch()} className="underline">Retry</button></div>;
  if (!available.length) return null;
  if (policy.isError || !authorizedPolicy) return <div className="mt-4 text-xs text-[hsl(var(--destructive))]">Checkout policy unavailable. <button onClick={() => policy.refetch()} className="underline">Retry</button></div>;
  return <div className="mt-4 border-t border-[hsl(var(--border))] pt-4">
    <div className="mb-3 text-xs font-bold text-[hsl(var(--muted-foreground))]">Secure hosted checkout · outstanding {money(outstanding)}</div>
    {policy.data?.partialPaymentsEnabled ? <label className="mb-3 block max-w-xs"><span className="mb-1.5 block text-xs font-bold">Pay now (₦) · full amount selected by default</span><span className="flex items-center rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3.5 focus-within:border-[hsl(var(--primary))]"><span className="mr-2 text-sm font-bold">₦</span><input type="text" inputMode="decimal" aria-label="Online payment amount in naira" value={displayedAmount} onChange={event => { setAmountInput(event.target.value); setAmountEdited(true); setFailure(''); }} disabled={!!attempt} className="w-full bg-transparent py-2.5 text-sm font-semibold tabular-nums outline-none" data-testid={`input-online-amount-${invoice.id}`} /></span><span className="mt-1 block text-xs text-[hsl(var(--muted-foreground))]">You may pay part of the balance. Enter up to two decimal places; maximum {money(outstanding)}.</span></label> : <div className="mb-3 text-sm font-semibold">Full payment {money(outstanding)} <span className="text-xs font-normal text-[hsl(var(--muted-foreground))]">· partial payments unavailable</span></div>}
    {policy.data?.partialPaymentsEnabled && amountEdited && !validAmount && <p role="alert" className="mb-3 text-xs text-[hsl(var(--destructive))]">Enter a positive amount no greater than {money(outstanding)}, with at most two decimal places.</p>}
    <div className="flex flex-wrap gap-2">{available.map(provider => <Button key={provider} variant="outline" disabled={!!attempt || history.isLoading || history.isError || unresolved || !validAmount} onClick={() => begin(provider)} testId={`button-pay-${provider.toLowerCase()}-${invoice.id}`}><CreditCard size={15} />{attempt?.provider === provider ? 'Opening checkout…' : `Pay ${validAmount && enteredMinor !== outstanding ? 'part now' : 'now'} with ${provider === 'PAYSTACK' ? 'Paystack' : 'Flutterwave'}`}</Button>)}</div>
    {unresolved && <p role="status" className="mt-2 text-xs font-medium text-[hsl(var(--muted-foreground))]">An online payment is processing for this invoice. Wait for confirmation before trying again.</p>}
    {history.isError && <button className="mt-2 text-xs text-[hsl(var(--destructive))] underline" onClick={() => history.refetch()}>Payment history unavailable · retry</button>}
    {failure && <p role="alert" className="mt-2 text-xs text-[hsl(var(--destructive))]">{failure}</p>}
    <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">Leaving for the provider does not mark this invoice paid. Only verified payment history can do that.</p>
  </div>;
}

export function ParentCheckoutReturn() {
  const [attempt] = useState<Attempt | null>(() => {
    try {
      const value = JSON.parse(window.sessionStorage.getItem(storageKey) || 'null') as Attempt | null;
      return value && Number.isSafeInteger(value.studentId) && value.studentId > 0 && Number.isSafeInteger(value.paymentId) && value.paymentId > 0 && Number.isSafeInteger(value.invoiceId) && value.invoiceId > 0 && typeof value.reference === 'string' ? value : null;
    } catch { return null; }
  });
  const qc = useQueryClient();
  const child = useGetParentChild(attempt?.studentId ?? 0, { query: { enabled: !!attempt, queryKey: getGetParentChildQueryKey(attempt?.studentId ?? 0), refetchInterval: 4000, refetchOnWindowFocus: true } });
  const history = useListParentFeePayments({ query: { enabled: !!attempt && !!child.data, queryKey: getListParentFeePaymentsQueryKey(), refetchInterval: 4000, refetchOnWindowFocus: true } });
  const invoices = useListParentFeeInvoices({ query: { enabled: !!attempt && !!child.data, queryKey: getListParentFeeInvoicesQueryKey(), refetchInterval: 4000, refetchOnWindowFocus: true } });
  const payment = history.data?.find(item => item.id === attempt?.paymentId && item.invoiceId === attempt.invoiceId && item.studentId === attempt.studentId && item.reference === attempt.reference && item.schoolId === child.data?.schoolId);
  const verified = payment?.status === 'VERIFIED' && !!payment.receiptNumber;
  const receipt = useGetFeePaymentReceipt(attempt?.paymentId ?? 0, undefined, { query: { enabled: verified, queryKey: getGetFeePaymentReceiptQueryKey(attempt?.paymentId ?? 0), refetchInterval: verified ? 4000 : false } });
  const receiptMatches = !!receipt.data && !!attempt && !!payment && receipt.data.paymentId === payment.id && receipt.data.schoolId === payment.schoolId && receipt.data.snapshot.invoiceId === attempt.invoiceId && receipt.data.snapshot.schoolId === payment.schoolId && receipt.data.receiptNumber === payment.receiptNumber;
  useEffect(() => {
    if (verified) void qc.invalidateQueries({ queryKey: getListMyFeePaymentNotificationsQueryKey() });
  }, [verified, qc]);
  useEffect(() => {
    if (!attempt || !child.data || !history.data) return;
    if (payment?.status === 'PENDING' || payment?.status === 'PROCESSING' || !payment) {
      qc.invalidateQueries({ queryKey: getListParentFeeInvoicesQueryKey() });
      qc.invalidateQueries({ queryKey: getGetFeePaymentReceiptQueryKey(attempt.paymentId) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.dataUpdatedAt]);
  if (!attempt) return <div className="mx-auto max-w-2xl p-6"><PageHeading eyebrow="Parent portal / Checkout return" title="Find your payment" description="A return address does not confirm payment. Open your child's fee history to see verified transactions." /><Link href="/" className="text-sm font-bold text-[hsl(var(--primary))]">Open parent portal <ArrowRight size={14} className="inline" /></Link></div>;
  return <div className="mx-auto max-w-2xl p-5 md:p-10">
    <PageHeading eyebrow="Parent portal / Hosted checkout" title="Payment status" description="We confirm payment from the school ledger, not from the provider's return link." />
    {child.isLoading || history.isLoading || invoices.isLoading ? <div className="space-y-3"><div className="skeleton h-32 rounded-2xl" /><div className="skeleton h-20 rounded-2xl" /></div> :
      child.isError || !child.data ? <ErrorState retry={() => child.refetch()} message="This child could not be verified against your parent account." /> :
      history.isError || invoices.isError ? <ErrorState retry={() => { history.refetch(); invoices.refetch(); }} message="Payment history is unavailable. No successful payment can be shown yet." /> :
      <div className="panel p-6 md:p-8">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[hsl(var(--primary))]"><ShieldCheck size={17} />Server-verified status</div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><h2 className="display-font text-2xl font-bold">{verified ? 'Payment Successful' : payment && ['FAILED', 'REJECTED', 'CANCELLED'].includes(payment.status) ? 'Payment not completed' : 'Processing payment'}</h2><StatusPill value={payment?.status ?? 'PROCESSING'} /></div>
        <div className="mt-3 text-sm font-semibold tabular-nums">{money(verified && payment ? payment.amountMinor : attempt.amountMinor)}</div>
        <div className="mt-1 text-xs font-medium text-[hsl(var(--muted-foreground))]">{attempt.partial ? 'Partial payment toward this invoice' : 'Full outstanding payment'}</div>
        <div className="mt-2 break-all font-mono text-xs text-[hsl(var(--muted-foreground))]">Reference {payment?.reference ?? attempt.reference} · Invoice #{attempt.invoiceId}</div>
        {verified ? <div className="mt-5">{receipt.isLoading ? <div className="skeleton h-14 rounded-xl" /> : receipt.isError ? <ErrorState retry={() => receipt.refetch()} message="Payment is verified, but the receipt is not available yet." /> : receiptMatches ? <Button variant="outline" onClick={() => window.print()}><ReceiptText size={16} />View / Print Receipt {receipt.data?.receiptNumber}</Button> : <p className="text-xs text-[hsl(var(--destructive))]">Receipt does not match this payment. Contact the school finance office.</p>}</div> :
          <p className="mt-4 flex items-start gap-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]"><Clock3 size={17} className="mt-0.5 shrink-0" />{payment && ['FAILED', 'REJECTED', 'CANCELLED'].includes(payment.status) ? 'No receipt was issued. Check your payment history or try again from the invoice.' : 'Your provider may take a moment to confirm. This page checks verified payment history automatically; do not pay again while it is processing.'}</p>}
        <div className="mt-6 flex flex-wrap gap-2"><Button variant="outline" onClick={() => { history.refetch(); invoices.refetch(); child.refetch(); }}>Check again</Button><Link href={`/parent/fees/${attempt.studentId}`} className="inline-flex items-center gap-2 rounded-xl bg-[hsl(var(--primary))] px-4 py-2.5 text-sm font-bold text-[hsl(var(--primary-foreground))]">Back to fees <ArrowRight size={15} /></Link></div>
      </div>}
  </div>;
}