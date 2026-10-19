import { useEffect, useRef, useState } from 'react';
import { SignIn, SignUp, useAuth, useClerk } from '@clerk/react';
import { Link, useLocation } from 'wouter';
import { ShieldCheck, Sparkles, Zap } from 'lucide-react';
import {
  setInvitationAuthFlow,
  invitationReturnUrl,
  readInvitationContext,
} from '@/pages/invitations/acceptance-context';
import { parseApplicantType, saveApplicationIntent, readApplicationIntent } from '@/lib/application-intent';
import { ApplicationForm } from '@/components/application-form';
import { emptyValues, loadDraft, saveDraft, switchApplicantType, validateApplication, type ApplicationValues, type FieldErrors } from '@/lib/application-draft';
import { shouldEndPreviousSignInSession } from '@/lib/sign-in-session-policy';

const base = import.meta.env.BASE_URL.replace(/\/$/, '');

function SignInSessionGate({
  invitationRedirectUrl,
  signUpUrl,
}: {
  invitationRedirectUrl: string | null;
  signUpUrl: string;
}) {
  const { isLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const [, setLocation] = useLocation();
  const signedInOnEntry = useRef<boolean | null>(null);
  const signOutStarted = useRef(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    // Capture the entry state once. A successful sign-in updates isSignedIn
    // while this page is still mounted; that new session must never be ended
    // by the account-switch behavior intended for an earlier session.
    if (signedInOnEntry.current === null) signedInOnEntry.current = Boolean(isSignedIn);
    if (!isSignedIn) return;
    if (!shouldEndPreviousSignInSession(signedInOnEntry.current, Boolean(invitationRedirectUrl))) {
      setLocation(invitationRedirectUrl ?? `${base}/`, { replace: true });
      return;
    }
    if (signOutStarted.current || signOutError) return;

    signOutStarted.current = true;
    const signInUrl = `${window.location.origin}${base}/sign-in`;

    void signOut()
      .then(() => {
        window.location.replace(signInUrl);
      })
      .catch(() => {
        signOutStarted.current = false;
        setSignOutError('We could not end the previous session. Please try again.');
      });
  }, [isLoaded, isSignedIn, signOut, signOutError, invitationRedirectUrl, setLocation]);

  if (signOutError) {
    return (
      <div className="w-full max-w-sm rounded-2xl border border-[hsl(var(--destructive)/.25)] p-6 text-center">
        <p className="text-sm text-[hsl(var(--destructive))]">{signOutError}</p>
        <button
          type="button"
          className="mt-4 rounded-xl bg-[hsl(var(--primary))] px-4 py-2 text-sm font-bold text-[hsl(var(--primary-foreground))]"
          onClick={() => {
            setSignOutError(null);
            window.location.reload();
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  if (!isLoaded || isSignedIn || signOutStarted.current) {
    return (
      <div className="flex min-h-44 w-full items-center justify-center text-sm text-[hsl(var(--muted-foreground))]">
        Preparing a secure sign-in…
      </div>
    );
  }

  return (
    <SignIn
      routing="path"
      path={`${base}/sign-in`}
      signUpUrl={signUpUrl}
      forceRedirectUrl={invitationRedirectUrl ?? undefined}
      fallbackRedirectUrl={invitationRedirectUrl ?? `${base}/`}
      appearance={{ elements: { rootBox: 'w-full', cardBox: 'w-full shadow-none', card: 'shadow-none border-0' } }}
    />
  );
}

export function AuthScreen({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const [, navigate] = useLocation();
  const isSignIn = mode === 'sign-in';
  const [accountType, setAccountType] = useState('');
  const [values, setValues] = useState<ApplicationValues>(() => {
    const q = new URLSearchParams(window.location.search);
    const t = parseApplicantType(q.get('applicantType'));
    const priorIntent = readApplicationIntent();
    const referralToken = q.get('ref') ?? priorIntent.referralToken;
    if (t) saveApplicationIntent(t, t === 'SCHOOL_ADMIN' ? referralToken : '');
    const intent = readApplicationIntent();
    const draft = loadDraft();
    const initial = draft ? (t ? switchApplicantType(draft, t) : draft)
      : emptyValues(t ?? intent.type ?? 'SCHOOL_ADMIN', referralToken);
    return { ...initial, referralToken: initial.applicantType === 'SCHOOL_ADMIN'
      ? referralToken || initial.referralToken : '' };
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [authStep, setAuthStep] = useState(() => (window.location.pathname ?? '').replace(/\/$/, '') !== `${base}/sign-up` && (window.location.pathname ?? '').startsWith(`${base}/sign-up/`) && loadDraft() !== null);
  const invitationContext = readInvitationContext(window.location.search);
  const invitationRedirectUrl = invitationContext.ticket
    ? invitationReturnUrl(invitationContext, base)
    : null;
  const invitationQuery = invitationRedirectUrl
    ? new URL(invitationRedirectUrl, window.location.origin).search
    : '';
  const signInUrl = `${base}/sign-in${invitationQuery}`;
  const signUpUrl = `${base}/sign-up${invitationQuery}`;
  const isPublicApplication = !isSignIn && !invitationContext.ticket;
  const signUpRedirect = invitationRedirectUrl ?? (isPublicApplication ? `${base}/apply?submit=1` : undefined);

  useEffect(() => {
    if (invitationContext.ticket) {
      setInvitationAuthFlow(invitationContext.ticket, isSignIn ? 'signin' : 'signup');
    }
  }, [invitationContext.ticket, isSignIn]);

  return (
    <main className="auth-screen min-h-[100dvh] w-full min-w-0 bg-[hsl(var(--background))] p-3 sm:p-4 md:p-8">
      <div className="mx-auto grid min-h-[calc(100dvh-1.5rem)] w-full min-w-0 max-w-[1180px] grid-cols-[minmax(0,1fr)] overflow-hidden rounded-[28px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-xl sm:min-h-[calc(100dvh-2rem)] md:min-h-[calc(100dvh-4rem)] md:grid-cols-[minmax(0,1.05fr)_minmax(0,.95fr)]">
        <section className="relative hidden overflow-hidden bg-[hsl(var(--sidebar))] p-10 text-[hsl(var(--sidebar-foreground))] md:flex md:flex-col">
          <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[hsl(var(--sidebar-primary)/.3)] blur-3xl" />
          <div className="relative flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"><Zap size={21} /></span>
            <span className="display-font text-xl font-bold">Yetenia EduCore</span>
          </div>
          <div className="relative my-auto max-w-lg">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold"><Sparkles size={14} />Secure school operations</div>
            <h1 className="display-font text-4xl font-bold leading-tight lg:text-5xl">One trusted identity for every school role.</h1>
            <p className="mt-5 max-w-md text-sm leading-6 text-[hsl(var(--sidebar-foreground)/.66)]">Your Yetenia EduCore permissions follow your account and school membership. Every request is checked again by the server.</p>
          </div>
          <div className="relative flex items-center gap-2 text-xs text-[hsl(var(--sidebar-foreground)/.62)]"><ShieldCheck size={16} />Tenant isolation and authenticated audit trails</div>
        </section>
        <section className="flex min-w-0 flex-col items-center justify-center px-3 py-5 sm:p-10">
          <button onClick={() => navigate('/')} className="mb-7 flex items-center gap-2 md:hidden">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[hsl(var(--accent))]"><Zap size={17} /></span>
            <span className="display-font text-lg font-bold">Yetenia EduCore</span>
          </button>
          {isSignIn && (
            <div className="mb-5 w-full max-w-sm">
              <label htmlFor="account-type" className="mb-2 block text-sm font-semibold">Select account type</label>
              <select
                id="account-type"
                className="min-w-0 max-w-full w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 text-sm"
                value={accountType}
                onChange={(event) => {
                  const selected = event.target.value;
                  setAccountType(selected);
                  if (selected) window.sessionStorage.setItem('edupulse:selected-portal', selected);
                  else window.sessionStorage.removeItem('edupulse:selected-portal');
                }}
              >
                <option value="">Choose your portal</option>
                <option value="SCHOOL_ADMIN">School Administrator</option>
                <option value="TEACHER">Teacher</option>
                <option value="ACCOUNTANT">Accountant</option>
                <option value="COMPANY_ACCOUNTANT">Company Accountant</option>
                <option value="DEVICE_ACTIVATION_OFFICER">Device Activation Officer</option>
                <option value="STAFF">Staff</option>
                <option value="DRIVER">Driver</option>
                <option value="PARENT">Parent</option>
                <option value="STUDENT">Student</option>
                <option value="PARTNER">Partner / Partner Administrator / Staff</option>
                <option value="PLATFORM_OWNER">Platform Owner</option>
              </select>
              <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
                This selection does not change your access. Your verified account and school permissions determine which portal opens.
              </p>
            </div>
          )}
          {isSignIn ? (
            <SignInSessionGate invitationRedirectUrl={invitationRedirectUrl} signUpUrl={signUpUrl} />
          ) : isPublicApplication && !authStep ? (
            <ApplicationForm values={values} onChange={setValues} errors={errors} formError={formError}
              onSubmit={() => {
                const r = validateApplication(values);
                setErrors(r.errors);
                if (!r.data) { setFormError('Please correct the highlighted fields.'); return; }
                const saved = saveDraft(values);
                if (!saved.ok) { setFormError(saved.error ?? 'Could not save your application.'); return; }
                saveApplicationIntent(values.applicantType, values.referralToken);
                setFormError(null);
                setAuthStep(true);
              }} />
          ) : (
            <>
            {isPublicApplication && (
              <div className="mb-5 w-full min-w-0 max-w-sm rounded-xl border border-[hsl(var(--border))] p-3 text-sm" data-testid="application-approval-notice">
                <h2 className="font-bold">{values.applicantType === 'PARTNER' ? 'Partner' : 'School Admin'} application</h2>
                <p className="mt-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]">
                  Your details are saved for this browser session only. Create your account with email and password or Google; finishing authentication submits your application automatically. Platform Owner approval is required before you can access a dashboard.
                </p>
                <button type="button" data-testid="button-edit-application" className="mt-2 text-xs font-bold underline" onClick={() => setAuthStep(false)}>Edit application details</button>
              </div>
            )}
            <SignUp
              routing="path"
              path={`${base}/sign-up`}
              signInUrl={signInUrl}
              initialValues={isPublicApplication && values.email ? { emailAddress: values.email.trim().toLowerCase() } : undefined}
              forceRedirectUrl={signUpRedirect}
              fallbackRedirectUrl={invitationRedirectUrl ?? `${base}/`}
              appearance={{ elements: { rootBox: 'w-full', cardBox: 'w-full shadow-none', card: 'shadow-none border-0' } }}
            />
            </>
          )}
          {isPublicApplication && !authStep && (
            <p className="mt-5 text-center text-xs text-[hsl(var(--muted-foreground))]" data-testid="footer-sign-in">
              Already registered?{' '}<Link href="/sign-in" className="font-bold text-[hsl(var(--primary))]">Sign in</Link>
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
