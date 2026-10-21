import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getGetPlatformSchoolSettlementQueryKey, getListPlatformSchoolSettlementsQueryKey,
  verifyPlatformSchoolSettlement, type SchoolSettlementSummary,
} from '@workspace/api-client-react';
import { Button } from '@/components/shared';
import { errMsg } from '@/pages/payroll-common';

type Result = { kind: 'ok' | 'error' | 'info'; message: string };

/** Development presentation only; the existing server remains the verification authority. */
export function DevelopmentBankVerification({ school, onStart, retained = false }: {
  school: SchoolSettlementSummary; onStart: () => void; retained?: boolean;
}) {
  const qc = useQueryClient();
  const lock = useRef(false);
  const control = useRef<HTMLButtonElement | null>(null);
  const resultElement = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const mutation = useMutation({
    mutationFn: (idempotencyKey: string) => verifyPlatformSchoolSettlement(school.schoolId, {
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
    retry: false,
  });
  useEffect(() => {
    if (!result || pending || !resultElement.current) return;
    // Do not steal focus from a different row while overlapping requests finish.
    if (document.activeElement !== document.body && document.activeElement !== control.current
      && document.activeElement !== resultElement.current) return;
    const element = resultElement.current;
    const bounds = element.getBoundingClientRect();
    element.focus({ preventScroll: true });
    if (bounds.top < 0 || bounds.bottom > window.innerHeight)
      element.scrollIntoView?.({ block: 'nearest' });
  }, [result, pending]);

  const run = async () => {
    if (lock.current) return;
    setResult(null);
    if (school.status === 'VERIFIED') {
      setResult({ kind: 'info', message: 'Already verified in the saved profile. No new provider request was made. Bank verification is not proof of collection-subaccount registration or settlement.' });
      return;
    }
    if (!window.confirm(`Ask the provider to verify the bank account holder for ${school.schoolName}? This does not create a collection subaccount or settle any funds.`)) return;
    lock.current = true;
    setPending(true);
    onStart();
    let outcome: Result = { kind: 'error', message: 'Bank verification is not confirmed.' };
    try {
      const response = await mutation.mutateAsync(crypto.randomUUID());
      if (response.schoolId !== school.schoolId || !['VERIFIED', 'PENDING_VERIFICATION', 'ACTION_REQUIRED', 'NOT_CONFIGURED'].includes(response.status))
        throw new Error('Unexpected server response; bank verification is not confirmed.');
      outcome = response.status === 'VERIFIED'
        ? { kind: 'ok', message: 'Server confirmed bank account verification status verified. Collection subaccount registration and settlement are not verified.' }
        : { kind: 'error', message: `Server returned bank account verification status ${response.status.replaceAll('_', ' ').toLowerCase()}. Successful verification is not confirmed.` };
    } catch (error) {
      const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
      outcome = { kind: 'error', message: status === 409
        ? `No new verification was confirmed (HTTP 409 conflict). ${errMsg(error)} The profile may already be verified or its details may have changed; check the refreshed saved status. No automatic retry was made.`
        : `Bank verification was not confirmed${typeof status === 'number' ? ` (HTTP ${status})` : ''}. ${errMsg(error)} No automatic retry was made.` };
    } finally {
      // Own cleanup per execution, even if a filtered row unmounts during refetch.
      try {
        await Promise.all([
          qc.invalidateQueries({ queryKey: getListPlatformSchoolSettlementsQueryKey() }, { throwOnError: true }),
          qc.invalidateQueries({ queryKey: getGetPlatformSchoolSettlementQueryKey(school.schoolId) }, { throwOnError: true }),
        ]);
      } catch {
        outcome = { ...outcome, message: `${outcome.message} The latest saved status could not be refreshed. Refresh the list before another attempt.` };
      } finally {
        lock.current = false;
        setPending(false);
      }
    }
    setResult(outcome);
  };
  const id = `bank-verification-result-${school.schoolId}`;
  return <>
    <span ref={element => { control.current = element?.querySelector('button') ?? null; }}>
      <Button variant="quiet" disabled={pending || retained || school.status === 'NOT_CONFIGURED' || !(school.capability.collection?.bankAccountVerificationConfigured || ['TEST', 'LIVE'].includes(school.capability.mode))}
        aria-busy={pending} aria-describedby={pending || result ? id : undefined}
        onClick={() => void run()} testId={`button-verify-${school.schoolId}`}>
        {pending ? 'Verifying bank details…' : 'Verify bank details'}
      </Button>
    </span>
    <div ref={resultElement} id={id} tabIndex={-1} role={result?.kind === 'error' ? 'alert' : 'status'}
      aria-live={result?.kind === 'error' ? 'assertive' : 'polite'} aria-atomic="true"
      data-testid={id} className={`basis-full text-sm ${result?.kind === 'error' ? 'text-[hsl(var(--destructive))]' : ''}`}>
      {pending ? 'Verifying with the provider and refreshing saved status… Even TEST verification can contact the real provider service.' : result?.message}
    </div>
  </>;
}
