import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { WalletCards, CircleAlert, CreditCard, RefreshCw } from 'lucide-react';
import {
  createStudentSubscriptionCheckout,
  getGetStudentSubscriptionPaymentQueryKey,
  getListSubscriptionsQueryKey,
  getStudentSubscriptionPayment,
  useGetStudentSubscriptionPayment,
  useListSubscriptions,
  useVerifyStudentSubscriptionPayment,
} from '@workspace/api-client-react';
import type { StudentSubscriptionPayment, StudentSubscriptionPaymentResponse, Subscription } from '@workspace/api-client-react';
import { SchoolDocumentHeader, SchoolDocumentPrintButton } from '@/components/school-document';
import {
  PageHeading, Button, StatusPill, SkeletonPage, ErrorState, EmptyState,
  TenantPicker, useTenant, money, date, useSchoolAdminAccess,
} from '@/components/shared';
import { useGetAuthorizedContext } from '@workspace/api-client-react';
import {
  checkoutEvidenceMatchesServer,
  findCheckoutForFlutterwaveReturn,
  getStudentCheckoutIdempotencyKey,
  isPaymentStatusPolling,
  isServerConfirmedPaid,
  loadStudentCheckoutAttempts,
  parseFlutterwaveReturn,
  safeStudentCheckoutUrl,
  saveStudentCheckoutAttempts,
  type StudentCheckoutAttempt,
} from './subscription-payment-helpers';

const note = 'text-xs leading-5 text-[hsl(var(--muted-foreground))]';

function paymentMessage(status: StudentSubscriptionPayment['status']) {
  return status.replaceAll('_', ' ').toLowerCase();
}

function SubscriptionPaymentDetails({
  attempt,
  isOwner,
  onRetryVerification,
  verifying,
  payment,
  allocations,
  receipt,
  refreshing,
  refreshError,
  onRefreshPayment,
}: {
  attempt?: StudentCheckoutAttempt;
  isOwner: boolean;
  onRetryVerification: (attempt: StudentCheckoutAttempt) => void;
  verifying: boolean;
  payment: StudentSubscriptionPayment | null;
  allocations: StudentSubscriptionPaymentResponse['allocations'];
  receipt: StudentSubscriptionPaymentResponse['receipt'];
  refreshing: boolean;
  refreshError: boolean;
  onRefreshPayment: () => void;
}) {
  const checkoutUrl = safeStudentCheckoutUrl(payment?.checkoutUrl);
  const receiptMatchesPayment = !!receipt
    && !!payment
    && receipt.receiptNumber.trim().length > 0
    && receipt.grossAmountMinor === payment.grossAmountMinor
    && receipt.currency === payment.currency
    && receipt.paidAt === payment.paidAt;
  const verifiedReceipt = payment?.status === 'PAID' && receiptMatchesPayment ? receipt : null;
  const receiptAllocations = verifiedReceipt?.allocations
    .filter(allocation => isOwner || allocation.recipientType === 'SCHOOL') ?? [];

  return (
    <div className="mt-4 rounded-xl border border-[hsl(var(--border)/.7)] bg-[hsl(var(--muted)/.15)] p-4" data-testid={`payment-attempt-${payment?.paymentId ?? 'unknown'}`}>
      {payment ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold text-[hsl(var(--muted-foreground))]">
              Payment #{payment.paymentId} · <span className="font-mono">{payment.reference}</span>
            </div>
            <StatusPill value={payment.status} />
          </div>
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
            <div><span className="text-[hsl(var(--muted-foreground))]">Gross</span><div className="font-bold">{money(payment.grossAmountMinor / 100)}</div></div>
            <div><span className="text-[hsl(var(--muted-foreground))]">Settlement</span><div className="font-semibold">{payment.settlementStatus.replaceAll('_', ' ').toLowerCase()}</div></div>
            <div><span className="text-[hsl(var(--muted-foreground))]">Reconciliation</span><div className="font-semibold">{payment.reconciliationStatus.replaceAll('_', ' ').toLowerCase()}</div></div>
          </div>
          {refreshError && <p className="mt-2 text-xs text-[hsl(var(--destructive))]">Could not refresh payment status. No client-cached status is being treated as authoritative.</p>}
          {refreshError && <Button variant="outline" className="mt-3" onClick={onRefreshPayment} testId={`button-refresh-payment-${payment.paymentId}`}>Refresh payment status</Button>}
          {isPaymentStatusPolling(payment) && <p className={`mt-2 ${note}`}>Payment remains {paymentMessage(payment.status)}. This record is being refreshed; no new checkout is started automatically.</p>}
          {attempt?.providerTransactionId && !isServerConfirmedPaid(payment) && (
            <Button
              variant="outline"
              className="mt-3"
              onClick={() => onRetryVerification(attempt)}
              disabled={verifying}
              testId={`button-retry-verification-${payment.paymentId}`}
            >
              <RefreshCw size={14} />{verifying ? 'Verifying...' : 'Retry verification'}
            </Button>
          )}
          {checkoutUrl && payment.status === 'PENDING' && (
            <a className="mt-3 inline-flex text-xs font-semibold text-[hsl(var(--primary))] underline" href={checkoutUrl} target="_blank" rel="noreferrer">
              Reopen secure checkout
            </a>
          )}
          {allocations.length > 0 && (
            <div className="mt-4 border-t border-[hsl(var(--border))] pt-3" data-testid={`payment-allocations-${payment.paymentId}`}>
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">Verified allocations</div>
              <dl className="divide-y divide-[hsl(var(--border))]">
                {allocations.filter(allocation => isOwner || allocation.recipientType === 'SCHOOL').map((allocation, index) => {
                  const label = allocation.recipientType === 'PLATFORM_PROVIDER_FEE'
                    ? 'Provider fee · platform expense'
                    : `${allocation.recipientType[0]}${allocation.recipientType.slice(1).toLowerCase()} allocation`;
                  const sign = allocation.entryType === 'EXPENSE' ? '−' : '';
                  return (
                    <div key={`${allocation.recipientType}-${index}`} className="flex justify-between gap-3 py-2 text-xs">
                      <dt>{label}</dt>
                      <dd className="font-bold tabular-nums">{sign}{money(allocation.amountMinor / 100)}</dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          )}
          {verifiedReceipt ? (
            <div className="mt-4 border-t border-[hsl(var(--border))] pt-3" data-testid={`student-subscription-receipt-${payment.paymentId}`}>
              <div className="text-xs font-bold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                Immutable receipt · {verifiedReceipt.receiptNumber}
              </div>
              <SchoolDocumentPrintButton
                label={`View / print receipt ${verifiedReceipt.receiptNumber}`}
                testId={`button-print-student-subscription-receipt-${payment.paymentId}`}
                className="mt-3"
              >
                <article className="school-document-page">
                  <SchoolDocumentHeader branding={{
                    name: verifiedReceipt.schoolName ?? undefined,
                    logoUrl: verifiedReceipt.schoolLogoVersionUrl ?? undefined,
                  }} />
                  <h2 className="school-document-title">Student subscription receipt</h2>
                  <dl className="school-document-grid">
                    <div className="school-document-field"><dt>Receipt number</dt><dd>{verifiedReceipt.receiptNumber}</dd></div>
                    <div className="school-document-field"><dt>Student</dt><dd>{verifiedReceipt.studentName ?? `Student ID: ${payment.studentId}`}</dd></div>
                    <div className="school-document-field"><dt>Session / term</dt><dd>{verifiedReceipt.sessionName ?? '—'} / {verifiedReceipt.termName ?? '—'}</dd></div>
                    <div className="school-document-field"><dt>Payment reference</dt><dd>{payment.reference}</dd></div>
                    <div className="school-document-field"><dt>Paid at</dt><dd>{verifiedReceipt.paidAt ? date(verifiedReceipt.paidAt) : '—'}</dd></div>
                    <div className="school-document-field"><dt>Amount received</dt><dd>{money(verifiedReceipt.grossAmountMinor / 100)}</dd></div>
                  </dl>
                  {receiptAllocations.length > 0 && (
                    <dl className="school-document-grid">
                      {receiptAllocations.map((allocation, index) => (
                        <div className="school-document-field" key={`${allocation.recipientType}-${index}`}>
                          <dt>{allocation.recipientType === 'PLATFORM_PROVIDER_FEE'
                            ? 'Provider fee · platform expense'
                            : `${allocation.recipientType[0]}${allocation.recipientType.slice(1).toLowerCase()} allocation`}</dt>
                          <dd>{allocation.entryType === 'EXPENSE' ? '−' : ''}{money(allocation.amountMinor / 100)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </article>
              </SchoolDocumentPrintButton>
            </div>
          ) : payment.status === 'PAID' ? (
            <p className={`mt-3 ${note}`} role={receipt ? 'alert' : 'status'}>{receipt
              ? 'The immutable receipt returned by the server does not match this paid payment and will not be printed.'
              : 'The server confirms this payment as paid. Its immutable receipt is not available yet; no receipt was created in the browser.'}</p>
          ) : null}
        </>
      ) : (
        <>
          <p className={note}>{refreshError ? 'Payment status could not be confirmed by the server. No cached status or allocation is shown.' : refreshing ? 'Checking persisted payment status with the server...' : 'Checkout was requested, but its outcome is not yet confirmed by the server. No second request will be sent automatically.'}</p>
          {refreshError && <Button variant="outline" className="mt-3" onClick={onRefreshPayment} testId="button-refresh-unknown-payment">Refresh payment status</Button>}
        </>
      )}
    </div>
  );
}

function SubscriptionRow({
  subscription,
  schoolId,
  attempts,
  isOwner,
  canCheckout,
  checkoutPending,
  verifying,
  onCheckout,
  onRetryVerification,
  onPaymentRefreshed,
}: {
  subscription: Subscription;
  schoolId: number;
  attempts: StudentCheckoutAttempt[];
  isOwner: boolean;
  canCheckout: boolean;
  checkoutPending: boolean;
  verifying: boolean;
  onCheckout: (subscription: Subscription, previousAttempt?: StudentCheckoutAttempt, retryFailedPayment?: boolean) => void;
  onRetryVerification: (attempt: StudentCheckoutAttempt) => void;
  onPaymentRefreshed: (attempt: StudentCheckoutAttempt, payment: StudentSubscriptionPayment) => void;
}) {
  const latestAttempt = attempts[attempts.length - 1];
  const selectedPaymentId = subscription.lastPaymentId ?? latestAttempt?.payment?.paymentId ?? null;
  const matchedAttempt = latestAttempt?.payment?.paymentId === selectedPaymentId ? latestAttempt : undefined;
  const paymentQuery = useGetStudentSubscriptionPayment(
    subscription.id,
    selectedPaymentId ?? 0,
    {
      query: {
        enabled: selectedPaymentId !== null && selectedPaymentId > 0,
        queryKey: getGetStudentSubscriptionPaymentQueryKey(
          subscription.id,
          selectedPaymentId ?? 0,
        ),
        staleTime: 0,
        refetchOnMount: 'always',
        refetchInterval: query => isPaymentStatusPolling(query.state.data?.payment) ? 12_000 : false,
      },
    },
  );
  const serverResponse = paymentQuery.data;
  const responsePayment = serverResponse?.payment;
  const matchesSubscriptionPayment = !!responsePayment
    && selectedPaymentId !== null
    && responsePayment.paymentId === selectedPaymentId
    && responsePayment.subscriptionId === subscription.id
    && responsePayment.schoolId === schoolId
    && (subscription.lastPaymentReference == null || responsePayment.reference === subscription.lastPaymentReference);
  const matchesCheckoutEvidence = !matchedAttempt
    || (!!responsePayment && checkoutEvidenceMatchesServer(matchedAttempt, responsePayment, schoolId));
  const payment = matchesSubscriptionPayment && matchesCheckoutEvidence ? responsePayment ?? null : null;
  const safeUrl = safeStudentCheckoutUrl(payment?.checkoutUrl);
  const hasPriorPayment = !!subscription.lastPaymentId || !!latestAttempt;
  const retryFailedPayment = payment?.status === 'FAILED';
  const canStartCheckout = canCheckout
    && (!hasPriorPayment || retryFailedPayment);

  useEffect(() => {
    const savedPayment = matchedAttempt?.payment;
    if (!matchedAttempt || !savedPayment || !payment) return;
    const changed = payment.status !== savedPayment.status
      || payment.checkoutUrl !== savedPayment.checkoutUrl
      || payment.paidAt !== savedPayment.paidAt
      || payment.failureCode !== savedPayment.failureCode
      || payment.settlementStatus !== savedPayment.settlementStatus
      || payment.reconciliationStatus !== savedPayment.reconciliationStatus
      || payment.providerFeeMinor !== savedPayment.providerFeeMinor
      || payment.settlementAmountMinor !== savedPayment.settlementAmountMinor;
    if (changed) onPaymentRefreshed(matchedAttempt, payment);
  }, [matchedAttempt, onPaymentRefreshed, payment]);

  return (
    <div className="border-b border-[hsl(var(--border)/.6)] px-5 py-5 transition-colors hover:bg-[hsl(var(--muted)/.2)] last:border-0 md:px-6">
      <div className="grid gap-3 md:grid-cols-[1.5fr_1fr_1fr_1fr_auto] md:items-center md:gap-4">
        <div>
          <div className="font-bold text-sm text-[hsl(var(--foreground))]">{subscription.studentName || `Student ID: ${subscription.studentId}`}</div>
          <div className="mt-1 text-xs font-mono text-[hsl(var(--muted-foreground))]">Student ID: {subscription.studentId}</div>
            {subscription.lastPaymentId && (
              <div className="mt-1 text-xs text-[hsl(var(--muted-foreground))]" data-testid={`latest-payment-${subscription.id}`}>
                Latest payment #{subscription.lastPaymentId}
                {subscription.lastPaymentStatus && ` · ${paymentMessage(subscription.lastPaymentStatus)}`}
                {subscription.lastPaymentReference && <> · <span className="font-mono">{subscription.lastPaymentReference}</span></>}
              </div>
            )}
        </div>
        <div className="text-sm font-bold display-font tracking-tight">{money(subscription.amount)}</div>
        <div className="text-sm font-medium text-[hsl(var(--muted-foreground))]">{subscription.term} · {date(subscription.expiresAt)}</div>
        <div><StatusPill value={subscription.status} /></div>
        <div className="flex justify-end">
          {canStartCheckout && (
            <Button
              onClick={() => onCheckout(subscription, latestAttempt, retryFailedPayment)}
              disabled={checkoutPending}
              testId={`button-checkout-subscription-${subscription.id}`}
            >
              <CreditCard size={14} />{checkoutPending ? 'Opening checkout...' : payment?.status === 'FAILED' ? 'Start new checkout' : 'Pay subscription'}
            </Button>
          )}
          {canCheckout && payment?.status === 'PENDING' && safeUrl && (
            <Button variant="outline" onClick={() => window.location.assign(safeUrl)} disabled={checkoutPending} testId={`button-continue-checkout-${subscription.id}`}>
              <CreditCard size={14} />Continue checkout
            </Button>
          )}
          {isOwner && <span className="text-xs text-[hsl(var(--muted-foreground))]">Read only</span>}
        </div>
      </div>
      {(latestAttempt || subscription.lastPaymentId) && (
        <SubscriptionPaymentDetails
          attempt={matchedAttempt}
          isOwner={isOwner}
          onRetryVerification={onRetryVerification}
          verifying={verifying}
          payment={payment}
          allocations={serverResponse?.payment === payment ? serverResponse.allocations : []}
          receipt={serverResponse?.payment === payment ? serverResponse.receipt : null}
          refreshing={paymentQuery.isLoading}
          refreshError={paymentQuery.isError || (!!responsePayment && !payment)}
          onRefreshPayment={() => { void paymentQuery.refetch(); }}
        />
      )}
    </div>
  );
}

// Subscription status is always taken from the server list/payment endpoints. Flutterwave's
// return query is only a verification signal and is never accepted as proof of payment.
export function SubscriptionsPage() {
  const { schoolId } = useTenant();
  const { isPlatformOwner } = useSchoolAdminAccess();
  const context = useGetAuthorizedContext().data;
  const canCheckout = !isPlatformOwner && !!schoolId && !!context?.roles?.some(
    role => role.schoolId === schoolId
      && (role.role === 'SCHOOL_ADMIN' || role.role === 'ACCOUNTANT')
      && role.status === 'ACTIVE',
  );
  const qc = useQueryClient();
  const verify = useVerifyStudentSubscriptionPayment();
  const checkout = useMutation({
    mutationFn: ({ subscriptionId, idempotencyKey }: { subscriptionId: number; idempotencyKey: string }) =>
      createStudentSubscriptionCheckout(subscriptionId, { headers: { 'Idempotency-Key': idempotencyKey } }),
  });
  const query = useListSubscriptions(
    { schoolId },
    {
      query: {
        enabled: !!schoolId,
        queryKey: getListSubscriptionsQueryKey({ schoolId }),
        refetchOnMount: 'always',
        refetchInterval: 30_000,
      },
    },
  );
  const subscriptions = query.data ?? [];
  const [attempts, setAttempts] = useState<StudentCheckoutAttempt[]>(() =>
    schoolId && typeof window !== 'undefined' ? loadStudentCheckoutAttempts(schoolId) : [],
  );
  const [message, setMessage] = useState<{ tone: 'warn' | 'ok' | 'error'; text: string } | null>(null);
  const processedCallback = useRef<string | null>(null);
  const verifyingAttemptKeys = useRef(new Set<string>());
  const checkingOutSubscriptionIds = useRef(new Set<number>());
  const attemptsRef = useRef(attempts);
  attemptsRef.current = attempts;

  useEffect(() => {
    setAttempts(schoolId && typeof window !== 'undefined' ? loadStudentCheckoutAttempts(schoolId) : []);
    processedCallback.current = null;
  }, [schoolId]);

  const commitAttempts = (next: StudentCheckoutAttempt[]) => {
    attemptsRef.current = next;
    if (schoolId && typeof window !== 'undefined') saveStudentCheckoutAttempts(schoolId, next);
    setAttempts(next);
  };
  const updateAttempt = (attempt: StudentCheckoutAttempt) => {
    const current = attemptsRef.current;
    const index = current.findIndex(item => item.idempotencyKey === attempt.idempotencyKey);
    const next = [...current];
    if (index < 0) next.push(attempt);
    else next[index] = attempt;
    commitAttempts(next);
  };
  const attemptsFor = (subscriptionId: number) => attempts.filter(attempt => attempt.requestedSubscriptionId === subscriptionId);

  const verifyPersistedPayment = async (attempt: StudentCheckoutAttempt, transactionId: string) => {
    if (!schoolId || !canCheckout || !attempt.payment || verifyingAttemptKeys.current.has(attempt.idempotencyKey)) return;
    verifyingAttemptKeys.current.add(attempt.idempotencyKey);
    const withTransaction = { ...attempt, providerTransactionId: transactionId };
    updateAttempt(withTransaction);
    try {
      const persisted = await getStudentSubscriptionPayment(attempt.payment.subscriptionId, attempt.payment.paymentId);
      if (!checkoutEvidenceMatchesServer(withTransaction, persisted.payment, schoolId)) {
        throw new Error('The server payment record does not match this checkout. It was not verified.');
      }

      if (persisted.payment.status === 'PAID') {
        updateAttempt({ ...withTransaction, payment: persisted.payment });
        setMessage({ tone: 'ok', text: 'The server already confirms this payment as paid.' });
      } else if (persisted.payment.status === 'PENDING' || persisted.payment.status === 'RECONCILIATION_REQUIRED') {
        const verified = await verify.mutateAsync({
          subscriptionId: persisted.payment.subscriptionId,
          data: {
            paymentReference: persisted.payment.reference,
            providerTransactionId: transactionId,
          },
        });
        if (!checkoutEvidenceMatchesServer(withTransaction, verified.payment, schoolId)) {
          throw new Error('The verification response did not match the persisted payment record.');
        }
        updateAttempt({ ...withTransaction, payment: verified.payment });
        setMessage(verified.payment.status === 'PAID'
          ? {
              tone: 'ok',
              text: verified.activated
                ? 'Payment was independently verified by the server. Refreshing the subscription and payment record.'
                : 'The server independently verified the payment as paid, but subscription activation was not confirmed. Refreshing both records.',
            }
          : { tone: 'warn', text: `The server reports ${paymentMessage(verified.payment.status)}. It is not marked paid.` });
      } else {
        updateAttempt({ ...withTransaction, payment: persisted.payment });
        setMessage({ tone: 'warn', text: `The server reports ${paymentMessage(persisted.payment.status)}. It is not marked paid.` });
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: getListSubscriptionsQueryKey({ schoolId }) }),
        qc.invalidateQueries({
          queryKey: getGetStudentSubscriptionPaymentQueryKey(
            attempt.payment.subscriptionId,
            attempt.payment.paymentId,
          ),
        }),
      ]);
      if (typeof window !== 'undefined') window.history.replaceState(null, '', window.location.pathname);
    } catch (error) {
      setMessage({
        tone: 'error',
        text: `${error instanceof Error ? error.message : 'Verification failed.'} The same persisted payment can be verified again; no new checkout was started.`,
      });
    } finally {
      verifyingAttemptKeys.current.delete(attempt.idempotencyKey);
    }
  };

  const verifyPaymentFromServerList = async (
    subscription: Subscription,
    reference: string,
    transactionId: string,
  ) => {
    const paymentId = subscription.lastPaymentId;
    if (!schoolId || !canCheckout || !paymentId || !subscription.lastPaymentReference) return;
    const verificationKey = `server-payment:${subscription.id}:${paymentId}`;
    if (verifyingAttemptKeys.current.has(verificationKey)) return;
    verifyingAttemptKeys.current.add(verificationKey);
    try {
      const persisted = await getStudentSubscriptionPayment(subscription.id, paymentId);
      const matchesServerList = persisted.payment.paymentId === paymentId
        && persisted.payment.subscriptionId === subscription.id
        && persisted.payment.schoolId === schoolId
        && persisted.payment.reference === reference
        && persisted.payment.reference === subscription.lastPaymentReference;
      if (!matchesServerList) {
        throw new Error('The server payment record does not match the selected subscription history. It was not verified.');
      }

      if (persisted.payment.status === 'PAID') {
        setMessage({ tone: 'ok', text: 'The server already confirms this payment as paid.' });
      } else if (persisted.payment.status === 'PENDING' || persisted.payment.status === 'RECONCILIATION_REQUIRED') {
        const verified = await verify.mutateAsync({
          subscriptionId: persisted.payment.subscriptionId,
          data: {
            paymentReference: persisted.payment.reference,
            providerTransactionId: transactionId,
          },
        });
        if (verified.payment.paymentId !== paymentId
          || verified.payment.subscriptionId !== subscription.id
          || verified.payment.schoolId !== schoolId
          || verified.payment.reference !== subscription.lastPaymentReference) {
          throw new Error('The verification response did not match the server-listed payment.');
        }
        setMessage(verified.payment.status === 'PAID'
          ? {
              tone: 'ok',
              text: verified.activated
                ? 'Payment was independently verified by the server. Refreshing the subscription and payment record.'
                : 'The server independently verified the payment as paid, but subscription activation was not confirmed. Refreshing both records.',
            }
          : { tone: 'warn', text: `The server reports ${paymentMessage(verified.payment.status)}. It is not marked paid.` });
      } else {
        setMessage({ tone: 'warn', text: `The server reports ${paymentMessage(persisted.payment.status)}. It is not marked paid.` });
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: getListSubscriptionsQueryKey({ schoolId }) }),
        qc.invalidateQueries({ queryKey: getGetStudentSubscriptionPaymentQueryKey(subscription.id, paymentId) }),
      ]);
      if (typeof window !== 'undefined') window.history.replaceState(null, '', window.location.pathname);
    } catch (error) {
      setMessage({
        tone: 'error',
        text: `${error instanceof Error ? error.message : 'Verification failed.'} The server-listed payment can be verified again; no new checkout was started.`,
      });
    } finally {
      verifyingAttemptKeys.current.delete(verificationKey);
    }
  };

  useEffect(() => {
    if (!schoolId || typeof window === 'undefined') return;
    const callback = parseFlutterwaveReturn(window.location.search);
    if (!new URLSearchParams(window.location.search).has('tx_ref')) return;
    const callbackKey = `${callback.reference ?? ''}|${callback.providerTransactionId ?? ''}`;
    if (processedCallback.current === callbackKey) return;

    if (!callback.reference || !callback.providerTransactionId) {
      processedCallback.current = callbackKey;
      setMessage({
        tone: 'warn',
        text: 'The Flutterwave return is missing a valid transaction reference or transaction ID. Payment remains unverified.',
      });
      return;
    }
    const schoolAttempts = attempts.filter(attempt => attempt.payment?.schoolId === schoolId);
    const matched = findCheckoutForFlutterwaveReturn(window.location.search, schoolAttempts);
    if (matched) {
      processedCallback.current = callbackKey;
      const attempt = { ...matched.attempt, providerTransactionId: matched.providerTransactionId };
      updateAttempt(attempt);
      void verifyPersistedPayment(attempt, matched.providerTransactionId);
      return;
    }
    if (query.isLoading || query.isError) return;
    const serverListedSubscription = subscriptions.find(subscription => subscription.schoolId === schoolId
      && !!subscription.lastPaymentId
      && subscription.lastPaymentReference === callback.reference);
    processedCallback.current = callbackKey;
    if (!serverListedSubscription) {
      setMessage({
        tone: 'warn',
        text: 'This return does not match a saved server checkout or server-listed payment for the selected school. Payment remains unverified.',
      });
      return;
    }
    void verifyPaymentFromServerList(serverListedSubscription, callback.reference, callback.providerTransactionId);
  }, [schoolId, attempts, query.isError, query.isLoading, subscriptions]);

  const startCheckout = async (
    subscription: Subscription,
    previousAttempt?: StudentCheckoutAttempt,
    retryFailedPayment = false,
  ) => {
    if (!schoolId || !canCheckout) return;
    if (checkingOutSubscriptionIds.current.has(subscription.id)) return;
    if (!retryFailedPayment && previousAttempt?.payment) return;
    if (!retryFailedPayment && previousAttempt && !previousAttempt.payment) {
      setMessage({
        tone: 'warn',
        text: 'The prior checkout outcome is still unknown. No new checkout request will be sent; wait for server reconciliation.',
      });
      return;
    }

    checkingOutSubscriptionIds.current.add(subscription.id);
    try {
      const idempotencyKey = getStudentCheckoutIdempotencyKey(
        schoolId,
        subscription.id,
        window.sessionStorage,
        undefined,
        retryFailedPayment,
      );
      const pendingAttempt: StudentCheckoutAttempt = {
        requestedSubscriptionId: subscription.id,
        idempotencyKey,
        payment: null,
        providerTransactionId: null,
      };
      updateAttempt(pendingAttempt);
      setMessage(null);
      const response = await checkout.mutateAsync({ subscriptionId: subscription.id, idempotencyKey });
      const payment = response.payment;
      if (payment.subscriptionId !== subscription.id || payment.schoolId !== schoolId) {
        throw new Error('The checkout response did not match the selected school subscription.');
      }
      const savedAttempt = { ...pendingAttempt, payment };
      updateAttempt(savedAttempt);
      await qc.invalidateQueries({ queryKey: getListSubscriptionsQueryKey({ schoolId }) });
      if (payment.status === 'RECONCILIATION_REQUIRED') {
        setMessage({ tone: 'warn', text: 'The server reports an unknown checkout outcome and requires reconciliation. No second request will be sent automatically.' });
        return;
      }
      const url = safeStudentCheckoutUrl(payment.checkoutUrl);
      if (payment.status === 'PENDING' && url) {
        window.location.assign(url);
        return;
      }
      setMessage({
        tone: payment.status === 'FAILED' ? 'error' : 'warn',
        text: payment.status === 'FAILED'
          ? 'The server reports that this payment attempt failed. You may explicitly start a new checkout.'
          : 'The server saved this payment, but did not provide a secure checkout URL. Its status will be refreshed; no second request was sent.',
      });
    } catch (error) {
      setMessage({
        tone: 'error',
        text: `${error instanceof Error ? error.message : 'Checkout could not be confirmed.'} Its outcome may be unknown. The saved idempotency key is retained and no new checkout will be sent automatically.`,
      });
    } finally {
      checkingOutSubscriptionIds.current.delete(subscription.id);
    }
  };

  if (!schoolId) {
    return <div className="fade-up"><PageHeading eyebrow="Financials / Subscriptions" title="Revenue & Access." description="Monitor student payment statuses and term enrollment." action={<TenantPicker />} /><EmptyState icon={WalletCards} title="Select a school context" description="Select a school to view its subscriptions." /></div>;
  }

  return (
    <div className="fade-up">
      <PageHeading
        eyebrow="Financials / Subscriptions"
        title="Revenue & Access."
        description="Monitor student payment statuses and term enrollment. Only independently verified server payments are marked paid."
        action={<div className="flex items-center gap-3"><TenantPicker /></div>}
      />

      {message && (
        <div role={message.tone === 'error' ? 'alert' : 'status'} className={`mb-5 rounded-xl border px-4 py-3 text-sm font-semibold ${message.tone === 'ok' ? 'border-[hsl(157_37%_43%/.3)] bg-[hsl(157_37%_43%/.08)]' : message.tone === 'error' ? 'border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--destructive)/.08)] text-[hsl(var(--destructive))]' : 'border-[hsl(35_83%_53%/.4)] bg-[hsl(35_83%_53%/.1)]'}`}>
          {message.text}
        </div>
      )}

      {query.isLoading ? <SkeletonPage /> : query.isError ? (
        <ErrorState retry={() => query.refetch()} />
      ) : (
        <div className="panel overflow-hidden">
          <div className="hidden grid-cols-[1.5fr_1fr_1fr_1fr_auto] gap-4 border-b border-[hsl(var(--border))] bg-[hsl(var(--muted)/.3)] px-6 py-4 text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))] md:grid">
            <span>Student Reference</span><span>Amount</span><span>Term Limit</span><span>Status</span><span />
          </div>
          {subscriptions.length ? subscriptions.map(subscription => (
            <SubscriptionRow
              key={subscription.id}
              subscription={subscription}
              schoolId={schoolId}
              attempts={attemptsFor(subscription.id)}
              isOwner={isPlatformOwner}
              canCheckout={canCheckout}
              checkoutPending={checkout.isPending}
              verifying={verify.isPending}
              onCheckout={startCheckout}
              onRetryVerification={attempt => {
                if (attempt.providerTransactionId) void verifyPersistedPayment(attempt, attempt.providerTransactionId);
              }}
              onPaymentRefreshed={(attempt, payment) => updateAttempt({ ...attempt, payment })}
            />
          )) : (
            <EmptyState icon={CircleAlert} title="No subscriptions" description="No payment records found for this term." />
          )}
        </div>
      )}
    </div>
  );
}