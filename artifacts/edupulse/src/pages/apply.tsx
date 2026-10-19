import { useState } from 'react';
import { useAuth } from '@clerk/react';
import { Redirect, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetMyAccountApplication, useSubmitAccountApplication, getGetMyAccountApplicationQueryKey,
  getGetAuthorizedContextQueryKey,
} from '@workspace/api-client-react';
import { applyErrorMessage, clearApplicationIntent, readApplicationIntent, type ApplicantType } from '@/lib/application-intent';

const inputCls = 'w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 text-sm';

export function ApplicationPortal({ pendingAccess = false }: { pendingAccess?: boolean }) {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const q = useGetMyAccountApplication();
  const submit = useSubmitAccountApplication();
  const intent = readApplicationIntent();
  const [type, setType] = useState<ApplicantType>(intent.type ?? 'SCHOOL_ADMIN');
  const [f, setF] = useState({ firstName: '', lastName: '', phone: '', city: '', state: '', schoolName: '', businessName: '', address: '' });
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF(p => ({ ...p, [k]: e.target.value }));

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

  const isSchool = type === 'SCHOOL_ADMIN';
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const req = ['firstName', 'lastName', 'phone', 'city', 'state'] as const;
    if (req.some(k => !f[k].trim()) || (isSchool && !f.schoolName.trim())) { setError('Please complete all required fields.'); return; }
    submit.mutate({
      data: {
        applicantType: type, firstName: f.firstName.trim(), lastName: f.lastName.trim(), phone: f.phone.trim(),
        city: f.city.trim(), state: f.state.trim(),
        ...(isSchool ? { schoolName: f.schoolName.trim() } : {}),
        ...(f.businessName.trim() ? { businessName: f.businessName.trim() } : {}),
        ...(f.address.trim() ? { address: f.address.trim() } : {}),
        ...(intent.referralToken ? { referralToken: intent.referralToken } : {}),
      },
    }, {
      onSuccess: () => void qc.invalidateQueries({ queryKey: getGetMyAccountApplicationQueryKey() }),
      onError: err => setError(applyErrorMessage(err)),
    });
  };
  return shell(
    <form onSubmit={onSubmit} className="space-y-4" data-testid="form-application">
      <div className="eyebrow">Apply</div>
      <h1 className="display-font text-2xl font-bold">Tell us about you</h1>
      <label className="block text-sm font-semibold">Applying as
        <select data-testid="select-applicant-type" className={`${inputCls} mt-1`} value={type} onChange={e => setType(e.target.value as ApplicantType)}>
          <option value="SCHOOL_ADMIN">School Admin</option><option value="PARTNER">Partner</option>
        </select>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-semibold">First name<input className={`${inputCls} mt-1`} data-testid="input-first-name" value={f.firstName} onChange={set('firstName')} /></label>
        <label className="text-sm font-semibold">Last name<input className={`${inputCls} mt-1`} data-testid="input-last-name" value={f.lastName} onChange={set('lastName')} /></label>
        <label className="text-sm font-semibold">Phone<input className={`${inputCls} mt-1`} data-testid="input-phone" value={f.phone} onChange={set('phone')} /></label>
        <label className="text-sm font-semibold">City<input className={`${inputCls} mt-1`} data-testid="input-city" value={f.city} onChange={set('city')} /></label>
        <label className="text-sm font-semibold">State<input className={`${inputCls} mt-1`} data-testid="input-state" value={f.state} onChange={set('state')} /></label>
        {isSchool && <label className="text-sm font-semibold">School name<input className={`${inputCls} mt-1`} data-testid="input-school-name" value={f.schoolName} onChange={set('schoolName')} /></label>}
        <label className="text-sm font-semibold">Business name (optional)<input className={`${inputCls} mt-1`} value={f.businessName} onChange={set('businessName')} /></label>
        <label className="text-sm font-semibold">Address (optional)<input className={`${inputCls} mt-1`} value={f.address} onChange={set('address')} /></label>
      </div>
      {error && <p role="alert" data-testid="text-apply-error" className="text-sm text-[hsl(var(--destructive))]">{error}</p>}
      <button type="submit" disabled={submit.isPending} data-testid="button-submit-application" className="w-full rounded-xl bg-[hsl(var(--primary))] px-4 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))]">
        {submit.isPending ? 'Submitting…' : 'Submit application'}
      </button>
    </form>,
  );
}

export default function ApplyPage() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <div className="min-h-[100dvh] bg-[hsl(var(--background))]" />;
  if (!isSignedIn) return <Redirect to="/sign-in?redirect=/apply" />;
  return <ApplicationPortal />;
}
