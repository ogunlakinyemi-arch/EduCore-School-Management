import { SignIn, SignUp } from '@clerk/react';
import { Link, useLocation } from 'wouter';
import { ShieldCheck, Sparkles, Zap } from 'lucide-react';

const base = import.meta.env.BASE_URL.replace(/\/$/, '');

export function AuthScreen({ mode }: { mode: 'sign-in' | 'sign-up' }) {
  const [, navigate] = useLocation();
  const isSignIn = mode === 'sign-in';

  return (
    <main className="min-h-[100dvh] bg-[hsl(var(--background))] p-4 md:p-8">
      <div className="mx-auto grid min-h-[calc(100dvh-2rem)] max-w-[1180px] overflow-hidden rounded-[28px] border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-xl md:min-h-[calc(100dvh-4rem)] md:grid-cols-[1.05fr_.95fr]">
        <section className="relative hidden overflow-hidden bg-[hsl(var(--sidebar))] p-10 text-[hsl(var(--sidebar-foreground))] md:flex md:flex-col">
          <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[hsl(var(--sidebar-primary)/.3)] blur-3xl" />
          <div className="relative flex items-center gap-3">
            <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[hsl(var(--accent))] text-[hsl(var(--accent-foreground))]"><Zap size={21} /></span>
            <span className="display-font text-xl font-bold">EduPulse</span>
          </div>
          <div className="relative my-auto max-w-lg">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-bold"><Sparkles size={14} />Secure school operations</div>
            <h1 className="display-font text-4xl font-bold leading-tight lg:text-5xl">One trusted identity for every school role.</h1>
            <p className="mt-5 max-w-md text-sm leading-6 text-[hsl(var(--sidebar-foreground)/.66)]">Your EduPulse permissions follow your account and school membership. Every request is checked again by the server.</p>
          </div>
          <div className="relative flex items-center gap-2 text-xs text-[hsl(var(--sidebar-foreground)/.62)]"><ShieldCheck size={16} />Tenant isolation and authenticated audit trails</div>
        </section>
        <section className="flex flex-col items-center justify-center p-5 sm:p-10">
          <button onClick={() => navigate('/')} className="mb-7 flex items-center gap-2 md:hidden">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-[hsl(var(--accent))]"><Zap size={17} /></span>
            <span className="display-font text-lg font-bold">EduPulse</span>
          </button>
          {isSignIn ? (
            <SignIn
              routing="path"
              path={`${base}/sign-in`}
              signUpUrl={`${base}/sign-up`}
              fallbackRedirectUrl={`${base}/`}
              appearance={{ elements: { rootBox: 'w-full', cardBox: 'w-full shadow-none', card: 'shadow-none border-0' } }}
            />
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