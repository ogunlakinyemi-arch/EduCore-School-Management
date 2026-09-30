import { useEffect, useState } from 'react';
import { useRoute, useLocation } from 'wouter';
import { useAcceptPartnerInvitationByPath } from '@workspace/api-client-react';
import { Button } from '@/components/shared';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';

export default function AcceptInvitation() {
  const [match, params] = useRoute('/partner/invitations/:invitationToken/accept');
  const [, setLocation] = useLocation();
  const accept = useAcceptPartnerInvitationByPath();
  
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [activatedRole, setActivatedRole] = useState<string | null>(null);
  const [redirectTo, setRedirectTo] = useState('/partner');

  useEffect(() => {
    if (match && params.invitationToken) {
      const invitationToken = params.invitationToken;
      if (!/^[A-Za-z0-9_-]{32,}$/.test(invitationToken)) {
        setStatus('error');
        setErrorMessage('Invalid invitation link format.');
        return;
      }

      accept.mutate({ invitationToken }, {
        onSuccess: (result: any) => {
          setActivatedRole(result.role ?? 'PARTNER_OWNER');
          setRedirectTo(result.redirectTo ?? '/partner');
          setStatus('success');
        },
        onError: (err: any) => {
          setStatus('error');
          setErrorMessage(err.error || 'Failed to accept invitation. It may be expired or already used.');
        }
      });
    } else {
      setStatus('error');
      setErrorMessage('Invalid invitation link.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [match, params?.invitationToken]);

  return (
    <main className="min-h-[100dvh] bg-[hsl(var(--background))] p-4 flex items-center justify-center">
      <div className="panel p-8 md:p-12 text-center max-w-lg w-full animate-in fade-in slide-in-from-bottom-4 duration-500">
        
        {status === 'loading' && (
          <div className="flex flex-col items-center">
            <Loader2 className="animate-spin text-[hsl(var(--primary))] mb-6" size={40} />
            <h1 className="display-font text-2xl font-bold mb-2">Accepting Invitation...</h1>
            <p className="text-[hsl(var(--muted-foreground))]">Please wait while we set up your partner profile.</p>
          </div>
        )}

        {status === 'success' && (
          <div className="flex flex-col items-center">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[hsl(157_37%_43%/.15)] text-[hsl(157_37%_43%)] dark:text-[hsl(157_37%_55%)] mb-6">
              <CheckCircle2 size={32} />
            </div>
            <h1 className="display-font text-3xl font-bold mb-3">
              {activatedRole === 'SCHOOL_ADMIN' ? 'School Administrator Activated' :
                activatedRole === 'PARTNER_STAFF' ? 'Partner Staff Account Activated' : 'Welcome to Yemait EduCore'}
            </h1>
            <p className="text-[hsl(var(--muted-foreground))] mb-8 leading-relaxed">
              {activatedRole === 'SCHOOL_ADMIN'
                ? 'Your school administrator account is active. You can now sign in to manage your school.'
                : activatedRole === 'PARTNER_STAFF'
                  ? 'Your partner staff account is active. The partner portal is ready for you.'
                  : 'Your partner account is ready. You can now start referring schools and managing your commissions.'}
            </p>
            <Button className="w-full h-12" onClick={() => setLocation(redirectTo)}>
              {activatedRole === 'SCHOOL_ADMIN' ? 'Continue to School Dashboard' : 'Go to Partner Dashboard'}
            </Button>
          </div>
        )}

        {status === 'error' && (
          <div className="flex flex-col items-center">
            <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[hsl(var(--destructive)/.15)] text-[hsl(var(--destructive))] mb-6">
              <XCircle size={32} />
            </div>
            <h1 className="display-font text-2xl font-bold mb-3">Invitation Failed</h1>
            <p className="text-[hsl(var(--muted-foreground))] mb-8 leading-relaxed">
              {errorMessage}
            </p>
            <Button variant="outline" className="w-full" onClick={() => setLocation('/')}>
              Return Home
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}