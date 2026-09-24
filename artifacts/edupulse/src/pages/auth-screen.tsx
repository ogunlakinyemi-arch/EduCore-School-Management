import { useEffect, useRef, useState } from 'react';
import { SignIn, SignUp, useAuth, useClerk } from '@clerk/react';
import { Link, useLocation } from 'wouter';
import { ShieldCheck, Sparkles, Zap } from 'lucide-react';

const base = import.meta.env.BASE_URL.replace(/\/$/, '');

function SignInSessionGate() {
  const { isLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const signOutStarted = useRef(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || signOutStarted.current || signOutError) return;

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
  }, [isLoaded, isSignedIn, signOut, signOutError]);

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
      signUpUrl={`${base}/sign-up`}
      fallbackRedirectUrl={`${base}/`}
      appearance={{ elements: { rootBox: 'w-full', cardBox: 'w-full shadow-none', card: 'shadow-none border-0' } }}
    />
  );
}

export function AuthScreen({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const [, navigate] = useLocation();
  const isSignIn = mode === 'sign-in';
  const [accountType, setAccountType] = useState('');

  return (
    <main className="min-h-[100dvh] bg-[hsl(var(--background))] p-4 md:p-8">
      <div className="mx-auto grid min-h-[calc(100dvh-2rem)] max-w-[1180px] overflow-hidden rounded-[28px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-xl md:min-h-[calc(100dvh-4rem)] md:grid-cols-[1.05fr_.95fr]">
        <section className="relative hidden overflow-hidden bg-[hsl(var(--sidebar))] p-10 text-[hsl(var(--sidebar-foreground))] md:flex md:flex-col">
          <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[hsl(var(--sidebar-primary)/.3)] blur-3xl" />
          <div className="relative flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"><Zap size={21} /></span>
            <span className="display-font text-xl font-bold">Yemait EduCore</span>
          </div>
          <div className="relative my-auto max-w-lg">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold"><Sparkles size={14} />Secure school operations</div>
            <h1 className="display-font text-4xl font-bold leading-tight lg:text-5xl">One trusted identity for every school role.</h1>
            <p className="mt-5 max-w-md text-sm leading-6 text-[hsl(var(--sidebar-foreground)/.66)]">Your Yemait EduCore permissions follow your account and school membership. Every request is checked again by the server.</p>
          </div>
          <div className="relative flex items-center gap-2 text-xs text-[hsl(var(--sidebar-foreground)/.62)]"><ShieldCheck size={16} />Tenant isolation and authenticated audit trails</div>
        </section>
        <section className="flex flex-col items-center justify-center p-5 sm:p-10">
          <button onClick={() => navigate('/')} className="mb-7 flex items-center gap-2 md:hidden">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[hsl(var(--accent))]"><Zap size={17} /></span>
            <span className="display-font text-lg font-bold">Yemait EduCore</span>
          </button>
          {isSignIn && (
            <div className="mb-5 w-full max-w-sm">
              <label htmlFor="account-type" className="mb-2 block text-sm font-semibold">Select account type</label>
              <select
                id="account-type"
                className="w-full rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-3 text-sm"
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
                <option value="STAFF">Staff</option>
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
            <SignInSessionGate />
          ) : (
            <SignUp
              routing="path"
              path={`${base}/sign-up`}
              signInUrl={`${base}/sign-in`}
              fallbackRedirectUrl={`${base}/`}
              appearance={{ elements: { rootBox: 'w-full', cardBox: 'w-full shadow-none', card: 'shadow-none border-0' } }}
            />
          )}
          <p className="mt-5 text-center text-xs text-[hsl(var(--muted-foreground))]">
            {isSignIn ? 'Need an account?' : 'Already registered?'}{' '}
            <Link href={isSignIn ? '/sign-up' : '/sign-in'} className="font-bold text-[hsl(var(--primary))]">
              {isSignIn ? 'Create one' : 'Sign in'}
            </Link>
          </p>
        </section>
      </div>
    </main>
  );
}