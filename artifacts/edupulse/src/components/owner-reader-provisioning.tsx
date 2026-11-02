import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { customFetch, getListPlatformDevicesQueryKey } from '@workspace/api-client-react';
import { Button, Field } from '@/components/shared';

type ProvisionedReader = {
  deviceId: number; credential: string; credentialVersion: string;
  configuration: {
    endpointPath: string; deviceId: string; method: string;
    authenticationHeader: string; authenticationScheme: string; heartbeatIntervalSeconds: number;
  };
};

export function OwnerReaderProvisioning({ device, credentialVersion, onCancel, onDone }: {
  device: { id: number; name: string }; credentialVersion?: string;
  onCancel: () => void; onDone: () => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<ProvisionedReader | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const rotate = credentialVersion !== undefined;
  const mutation = useMutation({
    gcTime: 0,
    retry: false,
    mutationFn: () => customFetch<ProvisionedReader>(
      `/api/platform/devices/${device.id}/owner-reader${rotate ? '/credential' : ''}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        reason: reason.trim(), ...(rotate ? { confirm: true, expectedCredentialVersion: credentialVersion } : {}),
      }) }),
    onSuccess: async value => {
      setResult(value);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['platform-uid-inventory'] }),
        qc.invalidateQueries({ queryKey: getListPlatformDevicesQueryKey() }),
      ]);
    },
  });
  const copy = async (text: string) => {
    try {
      if (!navigator.clipboard?.writeText) throw Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      setCopyStatus('Copied. Store this credential securely on this terminal only.');
    } catch { setCopyStatus('Copy failed. Select and copy the displayed value manually.'); }
  };
  if (result) {
    const config = result.configuration;
    const endpoint = `${typeof window === 'undefined' ? '' : window.location.origin}${config.endpointPath}`;
    return <div className="space-y-4">
      <h3 className="font-bold">Owner reader credential — shown once</h3>
      <p className="text-sm">Load these matching settings into <strong>{device.name}</strong> (device #{result.deviceId}). Linking the device does not push settings to its firmware. Never put this key in a URL, logs, or a school reader.</p>
      <Field label="One-time Owner reader credential">
        <input aria-label="One-time owner reader credential" readOnly autoComplete="off" className="font-mono text-xs" value={result.credential} onFocus={e => e.currentTarget.select()} />
      </Field>
      <Button variant="outline" onClick={() => void copy(result.credential)}>Copy credential</Button>
      <dl className="space-y-2 break-all text-sm">
        <div><dt className="font-bold">Owner callback — heartbeat AND CARD_SCAN</dt><dd className="select-all font-mono">{config.method} {endpoint}</dd></div>
        <div><dt className="font-bold">Authentication</dt><dd>{config.authenticationHeader}: {config.authenticationScheme} &lt;the one-time credential above&gt;</dd></div>
        <div><dt className="font-bold">Exact device_id</dt><dd className="select-all font-mono">{config.deviceId}</dd></div>
        <div><dt className="font-bold">Heartbeat interval</dt><dd>{config.heartbeatIntervalSeconds} seconds</dd></div>
      </dl>
      <Button variant="outline" onClick={() => void copy(`${config.authenticationScheme} ${result.credential}`)}>Copy Authorization value</Button>
      <p role="status" className="text-xs">{copyStatus}</p>
      <p className="text-sm">Send JSON with event_id, device_id, event_type and timestamp. CARD_SCAN also includes the raw hex uid. READER_HEARTBEAT has no uid. Use a fresh ID/time per physical event; retry an uncertain event unchanged. Do not submit school_id or attendance fields.</p>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">HTTP 401 means delivery is not authenticated. Check this exact URL, Bearer scheme, device ID and latest dedicated Owner key. A school key, old Owner key or browser session will not work. Old retained scans must keep their event identity; stale scans outside five minutes need a fresh physical tap, not a fabricated timestamp.</p>
      <div className="flex justify-end"><Button onClick={() => { setResult(null); mutation.reset(); onDone(); }}>I have saved the terminal settings</Button></div>
    </div>;
  }
  return <form className="space-y-4" onSubmit={e => {
    e.preventDefault();
    if (!confirmed || reason.trim().length < 3 || mutation.isPending || mutation.isError) return;
    mutation.mutate();
  }}>
    <p className="text-sm">{rotate
      ? `Replace the dedicated Owner credential for ${device.name}. The existing Owner key stops working immediately. You must update this physical terminal with the replacement. This does not change its owner or switch it to school attendance.`
      : `Bind ${device.name} for Owner-only UID capture. School credentials are revoked. No attendance or card activation is performed.`}</p>
    <Field label="Reason"><textarea required minLength={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} /></Field>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="!w-auto" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I confirm this device and understand the credential change.</label>
    {mutation.isError && <p role="alert" className="text-sm text-[hsl(var(--destructive))]">Provisioning failed or its response was lost. Do not repeatedly submit. Close this form and refresh reader state before considering a new explicit rotation. A committed one-time key cannot be recovered.</p>}
    <div className="flex justify-end gap-3">
      <Button variant="outline" onClick={onCancel}>Cancel</Button>
      <Button type="submit" disabled={!confirmed || reason.trim().length < 3 || mutation.isPending || mutation.isError}>{mutation.isPending ? 'Provisioning…' : rotate ? 'Rotate Owner credential' : 'Bind as UID reader'}</Button>
    </div>
  </form>;
}
