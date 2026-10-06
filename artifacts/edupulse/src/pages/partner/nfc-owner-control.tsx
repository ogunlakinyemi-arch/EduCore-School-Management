import { useGetPartnerNfcPermission, useUpdatePartnerNfcPermission, getGetPartnerNfcPermissionQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/shared';
import { useToast } from '@/hooks/use-toast';

export function PartnerNfcOwnerControl({ partnerId }: { partnerId: number }) {
  const q = useGetPartnerNfcPermission(partnerId);
  const update = useUpdatePartnerNfcPermission();
  const qc = useQueryClient();
  const { toast } = useToast();
  const toggle = (enabled: boolean) => update.mutate({ partnerId, data: { enabled } }, {
    onSuccess: () => { toast({ title: enabled ? 'NFC activation granted' : 'NFC activation revoked' }); void qc.invalidateQueries({ queryKey: getGetPartnerNfcPermissionQueryKey(partnerId) }); },
    onError: (e: any) => toast({ title: 'Update failed', description: e?.message, variant: 'destructive' }),
  });
  return (
    <section className="panel mt-6 p-6" aria-label="NFC activation permission" data-testid="panel-partner-nfc">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="display-font text-xl font-bold">NFC card activation</h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">Lets this partner assign locked cards to students in referred schools.</p></div>
        {q.data && (q.data.enabled
          ? <Button variant="danger" disabled={update.isPending} onClick={() => toggle(false)} testId="button-revoke-nfc">Revoke</Button>
          : <Button disabled={update.isPending} onClick={() => toggle(true)} testId="button-grant-nfc">Grant</Button>)}
      </div>
      {q.isLoading ? <div className="skeleton h-16 rounded-xl" />
        : q.isError || !q.data ? <div role="alert" className="text-sm text-[hsl(var(--destructive))]">Permission could not be loaded. <button type="button" className="underline" onClick={() => void q.refetch()}>Retry</button></div>
        : <>
          <p className="mb-3 text-sm font-bold" data-testid="text-nfc-state">Current state: {q.data.enabled ? 'Enabled' : 'Disabled'}</p>
          {q.data.history.length ? <ul className="divide-y divide-[hsl(var(--border)/.6)] text-sm">{q.data.history.map(h => (
            <li key={h.id} className="py-2"><span className="font-semibold">{h.actorName}</span> changed {h.previousValue ? 'enabled' : 'disabled'} to {h.newValue ? 'enabled' : 'disabled'}
              <span className="block text-xs text-[hsl(var(--muted-foreground))]">{new Date(h.createdAt).toLocaleString()}</span></li>))}</ul>
            : <p className="text-sm text-[hsl(var(--muted-foreground))]">No permission changes recorded.</p>}
        </>}
    </section>
  );
}
