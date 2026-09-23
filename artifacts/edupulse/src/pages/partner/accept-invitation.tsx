import { useEffect, useState } from 'react';
import { useRoute, useLocation } from 'wouter';
import { useAcceptPartnerInvitation } from '@workspace/api-client-react';
import { Button } from '@/components/shared';
import { CheckCircle2, XCircle, Loader2, Handshake } from 'lucide-react';

export default function AcceptInvitation() {
  const [match, params] = useRoute('/partner/invitations/:invitationId');
  const [, setLocation] = useLocation();
  const accept = useAcceptPartnerInvitation();
  
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (match && params.invitationId) {
      const invitationId = Number(params.invitationId);
      if (isNaN(invitationId)) {
        setStatus('error');
        setErrorMessage('Invalid invitation link format.');
        return;
      }

      accept.mutate({ invitationId }, {
        onSuccess: () => {
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
  }, [match, params?.invitationId]);

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
            <h1 className="display-font text-3xl font-bold mb-3">Welcome to EduPulse</h1>
            <p className="text-[hsl(var(--muted-foreground))] mb-8 leading-relaxed">
              Your partner account is ready. You can now start referring schools and managing your commissions.
            </p>
            <Button className="w-full h-12" onClick={() => setLocation('/partner')}>
              Go to Partner Dashboard
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