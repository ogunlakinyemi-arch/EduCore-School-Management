import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { customFetch, useGetAuthorizedContext, getListCardsQueryKey } from '@workspace/api-client-react';
import { Button, Field, Modal } from '@/components/shared';
import { uidInventoryKey } from '@/components/owner-uid-reader';
import { backendError } from '@/components/uid-actions';
import type { LinkPersonType } from '@/lib-card-link';

export function OwnerDetachCard({ schoolId, personId, personType, personName, card, onDetached }: {
  schoolId: number; personId: number; personType: LinkPersonType; personName: string;
  card: { id: number; uid: string; status: string }; onDetached: () => void;
}) {
  const authorized = useGetAuthorizedContext();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const close = () => { if (!mutation.isPending) { setOpen(false); setReason(''); setDetails(''); setConfirmed(false); } };
  const mutation = useMutation({
    mutationFn: () => customFetch(`/api/platform/uid-inventory/cards/${card.id}/unlink`, {
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({kind:'DETACH',schoolId,personId,personType,confirm:true,
        reason:details.trim() ? `${reason}: ${details.trim()}` : reason}),
    }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({queryKey:getListCardsQueryKey()}),
        qc.invalidateQueries({queryKey:uidInventoryKey}),
        qc.invalidateQueries({queryKey:['owner-link-students']}),
        qc.invalidateQueries({queryKey:['owner-link-employees']}),
        qc.invalidateQueries({queryKey:['owner-link-emp-cards']}),
        qc.invalidateQueries({predicate:query => typeof query.queryKey[0]==='string' &&
          (query.queryKey[0].includes('/employee-nfc/') || query.queryKey[0].includes('/students'))}),
      ]);
      setOpen(false);onDetached();
    },
  });
  if (authorized.data?.isPlatformOwner !== true || !personId || !schoolId ||
      !card.id || !card.uid || !['active','locked'].includes(card.status.toLowerCase())) return null;
  const valid = !!reason && (reason!=='Other' || details.trim().length>=3);
  return <>
    <Button type="button" variant="danger" testId="button-direct-unlink" onClick={() => {
      mutation.reset();setReason('');setDetails('');setConfirmed(false);setOpen(true);
    }}>Unlink Card</Button>
    {open && <Modal title="Unlink Card" eyebrow="Platform Owner confirmation" onClose={close}>
      <div className="space-y-4" data-testid="dialog-direct-unlink">
        <p>Card <strong className="break-all font-mono">{card.uid}</strong> will be detached from <strong>{personName}</strong>.
          The person will no longer have this card linked. Its inventory record and history will be kept.</p>
        <p className="text-sm">This is not a lost/damaged report. No replacement or charge will be created.
          The card becomes unassigned; later assignment follows the existing school and registration rules.</p>
        <Field label="Reason">
          <select value={reason} onChange={e => setReason(e.target.value)} disabled={mutation.isPending} data-testid="select-direct-unlink-reason">
            <option value="">Select a reason</option>
            {['Reassignment','Returned card','Correction','Other'].map(value => <option key={value}>{value}</option>)}
          </select>
        </Field>
        <Field label={reason==='Other' ? 'Explain the reason (required)' : 'Additional details (optional)'}>
          <input value={details} maxLength={450} disabled={mutation.isPending} onChange={e => setDetails(e.target.value)} data-testid="input-direct-unlink-details" />
        </Field>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="!w-auto" checked={confirmed} disabled={mutation.isPending}
            onChange={e => setConfirmed(e.target.checked)} data-testid="confirm-direct-unlink" />
          I confirm this card should be detached from {personName}.
        </label>
        {mutation.isError && <p role="alert" className="text-sm text-[hsl(var(--destructive))]">{backendError(mutation.error)}</p>}
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" variant="outline" testId="cancel-direct-unlink" disabled={mutation.isPending} onClick={close}>Cancel</Button>
          <Button type="button" variant="danger" testId="confirm-direct-unlink-submit" disabled={!valid || !confirmed || mutation.isPending}
            onClick={() => { if(valid && confirmed) mutation.mutate(); }}>{mutation.isPending ? 'Unlinking…' : 'Confirm unlink'}</Button>
        </div>
      </div>
    </Modal>}
  </>;
}
