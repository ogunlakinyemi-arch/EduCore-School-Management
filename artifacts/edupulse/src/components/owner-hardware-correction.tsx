import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch, getListPlatformDevicesQueryKey } from '@workspace/api-client-react';
import type { GetOwnerHardwareCorrection200, ApplyOwnerHardwareCorrection200 } from '@workspace/api-client-react';
import { Button, Field, Modal } from './shared';

export function OwnerHardwareCorrection() {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const qc = useQueryClient();
  const path = '/api/platform/devices/owner-hardware-correction';
  const preview = useQuery({
    queryKey: ['owner-hardware-correction'], enabled: open, gcTime: 0, staleTime: 0, retry: false,
    queryFn: () => customFetch<GetOwnerHardwareCorrection200>(path),
  });
  const apply = useMutation({
    retry: false, gcTime: 0,
    mutationFn: () => customFetch<ApplyOwnerHardwareCorrection200>(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fingerprint: preview.data?.fingerprint, reason: reason.trim(), confirm: confirmed }),
    }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: getListPlatformDevicesQueryKey() }),
        qc.invalidateQueries({ queryKey: ['platform-uid-inventory'] }),
      ]);
    },
  });
  const close = () => {
    if (apply.isPending) return;
    setOpen(false); setReason(''); setConfirmed(false); apply.reset();
    qc.removeQueries({ queryKey: ['owner-hardware-correction'] });
  };
  return <>
    <Button variant="outline" onClick={() => setOpen(true)}>Review Device 3 / 4 identity correction</Button>
    {open && <Modal title="Review hardware identity correction" onClose={close}>
      <p className="mb-3 text-sm">Only Device 3 and Device 4 are eligible. Device 3 keeps its numeric ID, Owner binding and key. No school assignments or terminal events are changed. This does not fix firmware authentication or synchronize pending events.</p>
      {apply.data ? <div role="status">
        <p>Correction committed. Audit #{apply.data.auditId} — {apply.data.auditedAt}</p>
        {apply.data.after.map(d => <p key={d.deviceId}>Device {d.deviceId}: {d.serialNumber || '(serial cleared; historical record)'} — {d.status}</p>)}
        <p>Device 3 credential preserved. Terminal settings and queued events were not changed.</p>
        <Button onClick={close}>Close</Button>
      </div> : preview.isLoading ? <p role="status">Checking current records and constraints…</p>
        : preview.isError || !preview.data ? <p role="alert">Correction is blocked or unavailable. No change was submitted. Current records, schema and ownership must meet the exact reviewed conditions.</p>
          : <form onSubmit={e => { e.preventDefault(); if (confirmed && reason.trim().length >= 3 && !apply.isPending && !apply.isError) apply.mutate(); }}>
            <div className="my-3 space-y-2 text-sm">
              {preview.data.before.map((d, i) => <p key={d.deviceId}>Device {d.deviceId}: <strong>{d.serialNumber} / {d.status}</strong> → <strong>{preview.data!.after[i].serialNumber || '(serial cleared; history retained)'} / {preview.data!.after[i].status}</strong></p>)}
            </div>
            <Field label="Reason"><textarea required minLength={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></Field>
            <label className="my-3 flex gap-2 text-sm"><input className="!w-auto" type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I confirm this exact two-record identity correction.</label>
            {apply.isError && <p role="alert" className="my-3 text-sm">The request failed or its response was lost. Do not resubmit. Close and refresh the device records and audit evidence before another review.</p>}
            <Button type="submit" disabled={!confirmed || reason.trim().length < 3 || apply.isPending || apply.isError || preview.isFetching}>{apply.isPending ? 'Applying…' : 'Confirm atomic correction'}</Button>
          </form>}
    </Modal>}
  </>;
}
