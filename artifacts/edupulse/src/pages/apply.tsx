import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';
import { Redirect, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetMyAccountApplication, useSubmitAccountApplication, getGetMyAccountApplicationQueryKey,
  getGetAuthorizedContextQueryKey,
} from '@workspace/api-client-react';
import { applyErrorMessage, clearApplicationIntent, readApplicationIntent } from '@/lib/application-intent';
import { clearDraft, emptyValues, loadDraft, validateApplication, type ApplicationValues, type FieldErrors } from '@/lib/application-draft';
import { ApplicationForm } from '@/components/application-form';


export function ApplicationPortal({ pendingAccess = false, autoSubmit = false }: { pendingAccess?: boolean; autoSubmit?: boolean }) {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const q = useGetMyAccountApplication();
  const submit = useSubmitAccountApplication();
  const intent = readApplicationIntent();
  const [values, setValues] = useState<ApplicationValues>(() => loadDraft() ?? emptyValues(intent.type ?? 'SCHOOL_ADMIN', intent.referralToken));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const autoStarted = useRef(false);
  const submitRef = useRef(submit.mutate);
  submitRef.current = submit.mutate;
  const refetchRef = useRef(q.refetch);
  refetchRef.current = q.refetch;
  const qcRef = useRef(qc);
  qcRef.current = qc;

  const send = useCallback((v: ApplicationValues): boolean => {
    const { errors, data } = validateApplication(v);
    setFieldErrors(errors);
    if (!data) { setError('Please correct the highlighted fields.'); return false; }
    setError(null);
    submitRef.current({ data }, {
      onSuccess: () => { clearDraft(); clearApplicationIntent(); void qcRef.current.invalidateQueries({ queryKey: getGetMyAccountApplicationQueryKey() }); },
      onError: (err: unknown) => {
        setError(applyErrorMessage(err));
        // The POST may have succeeded with a lost response; recover the real state.
        void Promise.resolve(refetchRef.current()).catch(() => undefined);
      },
    });
    return true;
  }, []);

  const canAutoSubmit = autoSubmit && !!q.data && !q.data.application && q.data.eligible;
  useEffect(() => {
    if (!canAutoSubmit || autoStarted.current) return;
    autoStarted.current = true;
    const draft = loadDraft();
    if (!draft) return;
    setValues(draft);
    send(draft);
  }, [canAutoSubmit, send]);

  const shell = (children: React.ReactNode) => (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] p-4" data-testid="application-portal">
      <div className="panel min-w-0 w-full max-w-xl break-words p-6 md:p-8 fade-up">{children}</div>
    </main>
  );

  if (q.isLoading) return shell(<div role="status" className="text-sm">Checking your application…</div>);
  if (q.isError || !q.data) return shell(
    <div>
      <p className="text-sm text-[hsl(var(--destructive))]">We could not load your application status.</p>
      <button type="button" className="mt-4 rounded-xl bg-[hsl(var(--primary))] px-4 py-2 text-sm font-bold text-[hsl(var(--primary-foreground))]" onClick={() => void q.refetch()}>Retry</button>
    </div>,
  );

  const { application, eligible } = q.data;

  if (!application && !eligible) {
    if (pendingAccess) return shell(
      <div className="text-center"><h1 className="display-font text-2xl font-bold">Access Pending</h1>
        <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">Your account has not been assigned any roles yet. Please contact your administrator.</p></div>,
    );
    return <Redirect to="/" />;
  }

  if (application) {
    const approved = application.status === 'APPROVED';
    return shell(
      <div>
        <div className="eyebrow">Application</div>
        <h1 className="display-font mt-1 text-2xl font-bold" data-testid="text-application-status">{application.status}</h1>
        <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">
          {application.status === 'PENDING' && 'Your application is awaiting review by the platform owner.'}
          {approved && 'Your application was approved.'}
          {application.status === 'REJECTED' && 'Your application was not approved.'}
        </p>
        {application.status === 'REJECTED' && application.rejectionReason && (
          <p className="mt-3 rounded-lg bg-[hsl(var(--destructive)/.08)] p-3 text-sm" data-testid="text-rejection-reason">Reason: {application.rejectionReason}</p>
        )}
        <div className="mt-5 flex flex-wrap gap-3">
          {approved && (
            <button type="button" disabled={opening} data-testid="button-open-dashboard" className="rounded-xl bg-[hsl(var(--primary))] px-4 py-2 text-sm font-bold text-[hsl(var(--primary-foreground))]"
              onClick={async () => {
                setOpening(true);
                try {
                  clearApplicationIntent();
                  window.sessionStorage.removeItem('edupulse:selected-portal');
                  await qc.invalidateQueries({ queryKey: getGetAuthorizedContextQueryKey() });
                  await qc.refetchQueries({ queryKey: getGetAuthorizedContextQueryKey() });
                  navigate('/');
                } catch { setError('Your application is approved, but the dashboard could not be refreshed. Please retry.'); }
                finally { setOpening(false); }
              }}>{opening ? 'Loading your role…' : 'Go to dashboard'}</button>
          )}
          {application.status === 'PENDING' && (
            <button type="button" className="rounded-xl border border-[hsl(var(--border))] px-4 py-2 text-sm font-bold" onClick={() => void q.refetch()}>Check status</button>
          )}
        </div>
        {error && <p role="alert" className="mt-3 text-sm text-[hsl(var(--destructive))]">{error}</p>}
      </div>,
    );
  }

  return shell(
    <div className="space-y-4">
      <div className="eyebrow">Apply</div>
      <h1 className="display-font text-2xl font-bold">Tell us about you</h1>
      <ApplicationForm values={values} onChange={setValues} errors={fieldErrors} formError={error} pending={submit.isPending} onSubmit={() => send(values)} />
    </div>,
  );
}

export default function ApplyPage() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div className="min-h-[100dvh] bg-[hsl(var(--background))]" />;
  if (!isSignedIn) return <Redirect to="/sign-in?redirect=/apply" />;
  const autoSubmit = new URLSearchParams(window.location.search).get('submit') === '1';
  return <ApplicationPortal autoSubmit={autoSubmit} />;
}
