import { useEffect, useRef, useState } from 'react';
import { SignUp, useAuth } from '@clerk/react';
import { Link, useLocation, useRoute } from 'wouter';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import {
  getGetAuthorizedContextQueryKey,
  useAcceptPartnerInvitation,
  useGetAuthorizedContext,
} from '@workspace/api-client-react';
import {
  destinationForAuthorizedContext,
  destinationForNewlyActivatedRole,
  consumeInvitationAuthFlow,
  invitationReturnUrl,
  readInvitationContext,
  setInvitationAuthFlow,
} from './acceptance-context';

const base = import.meta.env.BASE_URL.replace(/\/$/, '');

type ViewState =
  | { kind: 'processing' }
  | { kind: 'success'; destination: string }
  | { kind: 'error'; message: string };

function continuationAuthUrl(path: '/sign-in' | '/sign-up', returnUrl: string) {
  const params = new URL(returnUrl, window.location.origin).searchParams;
  const query = params.toString();
  return `${base}${path}${query ? `?${query}` : ''}`;
}

export default function InvitationAcceptance() {
  const [legacyMatch, legacyParams] = useRoute('/partner/invitations/:invitationToken/accept');
  const [partnerAliasMatch] = useRoute('/partner/accept-invitation');
  const [, setLocation] = useLocation();
  const { isLoaded, isSignedIn } = useAuth();
  const { mutateAsync } = useAcceptPartnerInvitation();
  const { refetch } = useGetAuthorizedContext({
    query: { queryKey: getGetAuthorizedContextQueryKey(), enabled: false },
  });
  const [view, setView] = useState<ViewState>({ kind: 'processing' });
  const startedFor = useRef<string | null>(null);

  const queryContext = readInvitationContext(window.location.search);
  const partnerToken = legacyMatch
    ? legacyParams?.invitationToken || queryContext.partnerToken
    : queryContext.partnerToken;
  const ticket = queryContext.ticket;
  const continuation = invitationReturnUrl({ ticket, partnerToken }, base);
  const signInUrl = continuationAuthUrl('/sign-in', continuation);

  useEffect(() => {
    if (legacyMatch && legacyParams?.invitationToken) {
      const forwarded = invitationReturnUrl({
        ticket,
        partnerToken: legacyParams.invitationToken,
      }, base);
      setLocation(forwarded, { replace: true });
    }
  }, [legacyMatch, legacyParams?.invitationToken, setLocation, ticket]);

  useEffect(() => {
    if (!legacyMatch && isLoaded && !isSignedIn && ticket) {
      setInvitationAuthFlow(ticket, 'signup');
    }
  }, [isLoaded, isSignedIn, legacyMatch, ticket]);

  useEffect(() => {
    if (legacyMatch) return;
    if (partnerAliasMatch && !partnerToken) {
      setView({
        kind: 'error',
        message: 'This partner invitation link is missing its invitation context. Ask the sender for a new link.',
      });
      return;
    }
    if (!ticket) {
      setView({
        kind: 'error',
        message: 'This invitation link is missing its secure Clerk ticket. Ask the sender for a new invitation link.',
      });
      return;
    }
    if (!isLoaded || !isSignedIn) return;

    // Keep processing idempotent across rerenders; the opaque context stays in memory only.
    const contextKey = `${ticket}:${partnerToken ?? ''}`;
    if (startedFor.current === contextKey) return;
    startedFor.current = contextKey;
    setView({ kind: 'processing' });
    const authFlow = consumeInvitationAuthFlow(ticket);

    void (async () => {
      try {
        if (partnerToken) {
          await mutateAsync({ data: { partnerInvitation: partnerToken } });
          const freshContext = await refetch();
          const hasActivePartnerRole = freshContext.data?.roles?.some(
            (role) => role.role === 'PARTNER' && role.status === 'ACTIVE',
          ) === true;
          if (!hasActivePartnerRole) {
            setView({
              kind: 'error',
              message: 'The partner invitation was submitted, but the account has no active partner access. Contact the invitation sender for help.',
            });
            return;
          }
          setView({ kind: 'success', destination: '/partner' });
          return;
        }

        const baselineContext = authFlow === 'signup' ? null : (await refetch()).data;
        const freshContext = (await refetch()).data;
        const destination = authFlow === 'signup'
          ? destinationForAuthorizedContext(freshContext)
          : destinationForNewlyActivatedRole(
              baselineContext,
              freshContext,
            );
        if (!destination) {
          const alreadyHadAccess = Boolean(
            baselineContext?.isPlatformOwner ||
            baselineContext?.roles?.some((role) => role.status === 'ACTIVE'),
          );
          setView({
            kind: 'error',
            message: alreadyHadAccess
              ? 'This account already has active access, but we could not verify that this invitation changed its permissions. It may already have been accepted; confirm with the invitation sender before continuing.'
              : 'We could not confirm a newly activated role for this invitation. It may be invalid, expired, or already used. Use the invited account or ask the sender for help.',
          });
          return;
        }
        setView({ kind: 'success', destination });
      } catch (error) {
        setView({
          kind: 'error',
          message: partnerToken
            ? partnerInvitationErrorMessage(error)
            : 'We could not verify the access assigned by this invitation. It may be invalid, expired, or already accepted. Contact the invitation sender for help.',
        });
      }
    })();
  }, [
    isLoaded,
    isSignedIn,
    legacyMatch,
    mutateAsync,
    partnerAliasMatch,
    partnerToken,
    refetch,
    ticket,
  ]);

  if (legacyMatch) {
    return <StatusCard title="Opening invitation" message="Preparing your secure invitation…" />;
  }

  if (!ticket || (partnerAliasMatch && !partnerToken)) {
    return (
      <StatusCard
        error
        title="Invitation link incomplete"
        message={view.kind === 'error' ? view.message : 'This invitation link is missing required context. Ask the sender for a new link.'}
      />
    );
  }

  if (!isLoaded) {
    return <StatusCard title="Loading secure invitation" message="Please wait while your invitation is prepared." loading />;
  }

  if (!isSignedIn) {
    return (
      <main className="flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] p-4">
        <section className="panel w-full max-w-lg p-6 text-center sm:p-10">
          <h1 className="display-font text-2xl font-bold">Accept your invitation</h1>
          <p className="mt-3 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
            Create your secure account to continue. If you already have an account, sign in to accept this invitation.
          </p>
          <div className="mt-7 flex justify-center">
            <SignUp
              routing="hash"
              signInUrl={signInUrl}
              forceRedirectUrl={continuation}
              fallbackRedirectUrl={continuation}
              appearance={{ elements: { rootBox: 'w-full', cardBox: 'w-full shadow-none', card: 'shadow-none border-0' } }}
            />
          </div>
          <p className="mt-5 text-center text-xs text-[hsl(var(--muted-foreground))]">
            Already registered?{' '}
            <Link href={signInUrl} className="font-bold text-[hsl(var(--primary))]">Sign in</Link>
          </p>
        </section>
      </main>
    );
  }

  if (view.kind === 'success') {
    return (
      <StatusCard
        success
        title="Invitation accepted"
        message="Your account access has been verified. Continue to your authorized portal."
        action={() => {
          window.sessionStorage.removeItem('edupulse:selected-portal');
          setLocation(view.destination);
        }}
        actionLabel="Continue"
      />
    );
  }

  if (view.kind === 'error') {
    return (
      <StatusCard
        error
        title="Could not accept invitation"
        message={view.message}
        action={() => setLocation('/')}
        actionLabel="Return home"
      />
    );
  }

  return (
    <StatusCard
      loading
      title="Verifying invitation"
      message="Please wait while we securely confirm your account access."
    />
  );
}

export function partnerInvitationErrorMessage(error: unknown): string {
  const apiError = error as {
    status?: number;
    message?: string;
    data?: Record<string, unknown> | null;
  };
  const detail = [apiError?.data?.error, apiError?.data?.message, apiError?.message]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();

  if (/already (accepted|used|redeemed)/.test(detail) || /already accepted/.test(detail)) {
    return 'This invitation has already been used. Sign in with the invited account or ask for a new invitation.';
  }
  if (detail.includes('invalid invitation token')) {
    return 'This invitation token is invalid. Ask the sender for a new invitation link.';
  }
  if (detail.includes('expired') || detail.includes('revoked')) {
    return 'This invitation has expired, was revoked, or has already been used. Ask the sender for a new invitation link.';
  }
  if (detail.includes('email does not match') || apiError?.status === 403) {
    return 'The signed-in account does not match the invited email. Continue with the invited account.';
  }
  return 'We could not accept this partner invitation. It may be invalid, expired, or already used. Ask the sender for a new invitation link.';
}

function StatusCard({
  title,
  message,
  loading = false,
  error = false,
  success = false,
  action,
  actionLabel,
}: {
  title: string;
  message: string;
  loading?: boolean;
  error?: boolean;
  success?: boolean;
  action?: () => void;
  actionLabel?: string;
}) {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] p-4">
      <section className="panel w-full max-w-lg p-8 text-center sm:p-10">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center rounded-2xl bg-[hsl(var(--secondary))]">
          {loading && <Loader2 className="animate-spin text-[hsl(var(--primary))]" size={28} />}
          {error && <AlertCircle className="text-[hsl(var(--destructive))]" size={28} />}
          {success && <CheckCircle2 className="text-emerald-600" size={28} />}
          {!loading && !error && !success && <Loader2 className="animate-spin text-[hsl(var(--primary))]" size={28} />}
        </div>
        <h1 className="display-font text-2xl font-bold">{title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">{message}</p>
        {action && actionLabel && (
          <button
            type="button"
            className="mt-7 w-full rounded-xl bg-[hsl(var(--primary))] px-5 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))]"
            onClick={action}
          >
            {actionLabel}
          </button>
        )}
      </section>
    </main>
  );
}