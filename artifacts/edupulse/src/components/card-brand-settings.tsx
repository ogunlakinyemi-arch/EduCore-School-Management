import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch } from '@workspace/api-client-react';
import { Button, Field } from '@/components/shared';
import { backendError } from '@/components/uid-actions';

type Brand = { primaryColor: string | null; secondaryColor: string | null };
const HEX = /^#[0-9A-Fa-f]{6}$/;

export function CardBrandSettings({ schoolId }: { schoolId: number }) {
  const qc = useQueryClient();
  const key = ['card-brand', schoolId];
  const path = `/api/platform/schools/${schoolId}/card-brand`;
  const q = useQuery({ queryKey: key, queryFn: () => customFetch<Brand>(path) });
  const [primary, setPrimary] = useState('');
  const [secondary, setSecondary] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (q.data) { setPrimary(q.data.primaryColor ?? ''); setSecondary(q.data.secondaryColor ?? ''); } }, [q.data]);
  const m = useMutation({
    mutationFn: () => customFetch<Brand>(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ primaryColor: primary, secondaryColor: secondary }) }),
    onSuccess: async () => {
      setSaved(true);
      await Promise.all([qc.invalidateQueries({ queryKey: key }), qc.invalidateQueries({ queryKey: ['official-card-preview'] })]);
    },
  });
  const valid = HEX.test(primary) && HEX.test(secondary);
  return (
    <form className="panel mb-6 p-5" onSubmit={e => { e.preventDefault(); setSaved(false); m.mutate(); }} data-testid="form-card-brand">
      <h2 className="display-font text-lg font-bold">Card brand colors</h2>
      <p className="mb-3 text-sm text-[hsl(var(--muted-foreground))]">These colors apply to Teacher/Staff fronts and card reverses. Student decorations are extracted from the school logo; the primary setting is used only if extraction is unavailable. Unset school colors use a restrained fallback. Current branding stays until you save.</p>
      {q.isError ? <p role="alert" className="text-sm font-medium text-[hsl(var(--destructive))]">{backendError(q.error)} <button type="button" className="underline" onClick={() => void q.refetch()}>Retry</button></p> : q.isLoading ? <div className="skeleton h-16" /> : (
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <Field label="Primary color (#RRGGBB)"><input value={primary} maxLength={7} placeholder="#1A2B3C" onChange={e => setPrimary(e.target.value)} className="font-mono" data-testid="input-brand-primary" /></Field>
          <Field label="Secondary color (#RRGGBB)"><input value={secondary} maxLength={7} placeholder="#D4A017" onChange={e => setSecondary(e.target.value)} className="font-mono" data-testid="input-brand-secondary" /></Field>
          <Button type="submit" testId="button-save-brand" disabled={!valid || m.isPending}>{m.isPending ? 'Saving...' : 'Save colors'}</Button>
        </div>
      )}
      {m.isError && <p role="alert" className="mt-3 text-sm font-medium text-[hsl(var(--destructive))]" data-testid="text-brand-error">{backendError(m.error)}</p>}
      {saved && !m.isError && <p role="status" className="mt-3 text-sm font-semibold text-emerald-600">Card colors saved.</p>}
    </form>
  );
}
