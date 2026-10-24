import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Button, Field } from '@/components/shared';
import { backendError } from '@/components/uid-actions';

export function CardVerificationPage() {
  const [token, setToken] = useState('');
  const m = useMutation({
    mutationFn: () => customFetch<{ valid: boolean; message: string }>('/api/v1/id-cards/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token.trim() }) }),
  });
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[hsl(var(--background))] p-6">
      <form className="panel fade-up w-full max-w-lg space-y-4 p-8" onSubmit={e => { e.preventDefault(); m.mutate(); }} data-testid="form-card-verification">
        <h1 className="display-font text-2xl font-bold">Verify an ID card</h1>
        <p className="text-sm text-[hsl(var(--muted-foreground))]">Paste the opaque contents of the QR code printed on the card. This checks the current issued-card record, not the physical card or holder. It is not the NFC UID and grants no access or attendance permission.</p>
        <Field label="QR contents"><textarea required rows={4} value={token} onChange={e => setToken(e.target.value)} className="font-mono text-xs" data-testid="input-verify-token" /></Field>
        {m.isError && <p role="alert" className="text-sm font-medium text-[hsl(var(--destructive))]" data-testid="text-verify-error">{backendError(m.error)}</p>}
        {m.data && <p role="status" className={`text-sm font-bold ${m.data.valid ? 'text-emerald-600' : 'text-[hsl(var(--destructive))]'}`} data-testid="text-verify-result">{m.data.valid ? 'Valid: ' : 'Not valid: '}{m.data.message}</p>}
        <Button type="submit" testId="button-verify-card" disabled={!token.trim() || m.isPending}>{m.isPending ? 'Verifying...' : 'Verify card'}</Button>
      </form>
    </div>
  );
}
export default CardVerificationPage;
