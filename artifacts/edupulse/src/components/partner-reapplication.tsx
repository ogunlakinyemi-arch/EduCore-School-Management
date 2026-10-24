import { useState } from 'react';
import { useClerk } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { useReapplyPartnerAccount } from '@workspace/api-client-react';
import { ApplicationForm } from './application-form';
import { emptyValues, validateApplication, clearDraft, type FieldErrors } from '@/lib/application-draft';
import { applyErrorMessage, clearApplicationIntent } from '@/lib/application-intent';

export function PartnerReapplication({ onCreated }: { onCreated?: () => void }) {
  const qc = useQueryClient();
  const { signOut } = useClerk();
  const mutation = useReapplyPartnerAccount();
  const [values,setValues] = useState(() => emptyValues('PARTNER',''));
  const [errors,setErrors] = useState<FieldErrors>({});
  const [error,setError] = useState<string | null>(null);
  const submit = () => {
    const result = validateApplication({ ...values,applicantType:'PARTNER' });
    setErrors(result.errors);
    if (!result.data) return;
    setError(null);
    mutation.mutate({ data:result.data }, {
      onSuccess: () => {
        // Account identity changed, not merely a form value: discard ALL old
        // query/portal state and remount the app against the new association.
        qc.clear(); clearDraft(); clearApplicationIntent();
        window.sessionStorage.removeItem('edupulse:selected-portal');
        if (onCreated) onCreated();
        else window.location.assign(`${import.meta.env.BASE_URL}apply`);
      },
      onError: (e) => {
        setError(applyErrorMessage(e));
        // A lost POST response may already have created the new association.
        // A user can reload to recover it; never retry this POST automatically.
      },
    });
  };
  return <section className="space-y-4" data-testid="partner-reapplication">
    <h1 className="display-font text-2xl font-bold">Apply again as a Partner</h1>
    <p className="text-sm">Your previous account remains archived. An eligible test Partner can use the same verified email for a new application. It will not include previous schools, roles or records, and requires Platform Owner approval.</p>
    <p className="text-sm text-[hsl(var(--muted-foreground))]">Sign out and sign in again first. An old session cannot be used for a new account.</p>
    <button type="button" className="rounded-xl border px-4 py-2 text-sm font-bold" disabled={mutation.isPending}
      onClick={() => void signOut({ redirectUrl:`${import.meta.env.BASE_URL}sign-in?redirect=/apply` })}>Sign out to sign in again</button>
    <ApplicationForm values={values} onChange={setValues} errors={errors} formError={error}
      partnerOnly pending={mutation.isPending} submitLabel="Submit new Partner application" onSubmit={submit} />
    {error && <button type="button" className="text-sm underline" onClick={() => window.location.reload()}>Reload application status</button>}
  </section>;
}
