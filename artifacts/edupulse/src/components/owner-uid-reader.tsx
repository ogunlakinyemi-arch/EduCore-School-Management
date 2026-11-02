import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { customFetch, getListPlatformDevicesQueryKey, useUpdatePlatformDevice } from '@workspace/api-client-react';
import { Radio } from 'lucide-react';
import { Button, EmptyState, Field, date } from '@/components/shared';
import { AssignUidModal } from '@/components/uid-actions';

export type UidInventory = {
  readers: { deviceId: number; serialNumber: string; name: string; ownerUserId: number; lastReadAt: string | null;
    lastSeenAt?: string | null; lastReport?: ReaderReport | null; lastScan?: ReaderReport | null }[];
  inventory: { uid: string; readerDeviceId: number; capturedAt: string; assigned: boolean; schoolId: number | null; studentId: number | null; status: string | null }[];
};

type ReaderReport = { uid: string | null; rawUid?: string | null; scanStatus: string; duplicateUid?: boolean };
const scanLabels: Record<string, string> = {
  READY: 'Ready — present a compatible card',
  CAPTURED: 'UID captured',
  UNKNOWN_UNASSIGNED: 'Unknown / unassigned card — UID captured',
  ASSIGNED: 'Assigned card — UID captured (no attendance)',
  RESERVED: 'Registered / reserved card — UID captured',
  UNSUPPORTED_CARD: 'Unsupported card — reader could not obtain a compatible UID',
  MALFORMED_SCAN: 'Malformed scan — check the reader payload and timestamp',
  READER_ERROR: 'Reader error — check the antenna and terminal',
  TRANSPORT_ERROR: 'Reader transport error — check terminal connectivity',
};

export function readerConnection(reader: UidInventory['readers'][number], now = Date.now()) {
  const seen = reader.lastSeenAt ?? reader.lastReadAt;
  if (!seen) return 'Waiting for authenticated reader';
  return now - new Date(seen).getTime() > 90_000
    ? 'Reader offline or no recent authenticated report'
    : 'Authenticated reader connected';
}

function CopyUid({ uid }: { uid: string }) {
  const [message, setMessage] = useState('');
  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(uid);
      setMessage('UID copied');
    } catch { setMessage('Copy failed — select the UID and copy it manually'); }
  }
  return <span className="inline-flex flex-wrap items-center gap-2">
    <Button variant="outline" onClick={() => void copy()} title={`Copy UID ${uid}`}>Copy UID</Button>
    <span role="status" className="text-xs">{message}</span>
  </span>;
}

export const uidInventoryKey = ['platform-uid-inventory'] as const;

export function useUidInventory() {
  return useQuery({
    queryKey: uidInventoryKey,
    queryFn: () => customFetch<UidInventory>('/api/platform/uid-inventory'),
    refetchInterval: 10_000,
  });
}

const errText = 'text-sm font-medium text-[hsl(var(--destructive))]';

export function OwnerUidReaderSection({ inventory }: { inventory: ReturnType<typeof useUidInventory> }) {
  const { data, isLoading, isError, refetch } = inventory;
  const readers = data?.readers ?? [];
  const uids = data?.inventory ?? [];
  const [assign, setAssign] = useState<string | null>(null);
  const [unlink, setUnlink] = useState<UidInventory['readers'][number] | null>(null);
  return (
    <section className="mb-8" data-testid="section-owner-uid-readers">
      <h2 className="display-font text-xl font-bold">Owner UID reader</h2>
      <p className="mb-3 text-sm text-[hsl(var(--muted-foreground))]">Inventory hardware bound to you for capturing permanent card UIDs. It never records school attendance.</p>
      <p className="mb-3 text-sm">Present any compatible card, including an unknown, unassigned, locked or retired card. A successful read saves its UID to platform inventory only; it does not assign, activate, charge or unlock a card.</p>
      <div className="panel mb-3 p-4 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
        <strong className="text-[hsl(var(--foreground))]">Owner capture mode:</strong> configure the terminal to read UID bytes before attendance validation and POST an authenticated <span className="font-mono">CARD_SCAN</span> event with its owner-reader device credential (Bearer) to <span className="font-mono">/api/v1/owner-reader/uid-events</span>. It must not use the school attendance route. Send <span className="font-mono">READER_HEARTBEAT</span> every 30 seconds and <span className="font-mono">CARD_SCAN_ERROR</span> for hardware errors. Linking alone does not configure firmware or prove a connection.
      </div>
      {isError && data && <p role="alert" className={`${errText} mb-3`}>Dashboard transport error — showing previously received UIDs. Live scan status is unavailable. <button onClick={() => void refetch()}>Retry</button></p>}
      {isLoading ? <div className="panel skeleton h-24" /> : isError && !data ? (
        <div role="alert" className="panel p-4"><p className={errText}>UID inventory could not be loaded.</p><Button variant="outline" className="mt-2" onClick={() => void refetch()}>Retry</Button></div>
      ) : (
        <>
          <div className="panel mb-3 divide-y divide-[hsl(var(--border)/.6)]">
            {readers.length ? readers.map(r => (
              <div key={r.deviceId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4" data-testid={`owner-reader-${r.deviceId}`}>
                <div>
                  <div className="text-sm font-bold">{r.name}</div>
                  <div className="font-mono text-xs text-[hsl(var(--muted-foreground))]">{r.serialNumber} · Device ID {r.deviceId}</div>
                  <div className="mt-1 text-xs" role="status">{readerConnection(r)}</div>
                  {r.lastReadAt && <div className="text-xs">Last authenticated read: {date(r.lastReadAt)}</div>}
                  {r.lastReport && <p className="mt-2 text-sm" role="status">{scanLabels[r.lastReport.scanStatus] ?? 'Authenticated reader report received'}</p>}
                  {r.lastScan?.uid && <div className="mt-3 space-y-2" aria-live="polite">
                    <p className="text-xs">Latest captured UID — retained even if the next scan fails</p>
                    <p className="select-all break-all font-mono text-2xl font-bold">{r.lastScan.rawUid ?? r.lastScan.uid}</p>
                    {r.lastScan.rawUid && r.lastScan.rawUid !== r.lastScan.uid && <p className="text-xs">Inventory format: {r.lastScan.uid}</p>}
                    {r.lastScan.duplicateUid && <p className="text-xs">Duplicate UID — already in inventory / registration. Raw UID retained; no new card assignment.</p>}
                    <CopyUid uid={r.lastScan.rawUid ?? r.lastScan.uid} />
                  </div>}
                </div>
                <Button variant="outline" onClick={() => setUnlink(r)}>Release reader</Button>
              </div>
            )) : <EmptyState icon={Radio} title="No Owner UID reader bound" description="Use “Use as UID reader” on an unassigned NFC or Hybrid device." />}
          </div>
          <div className="panel overflow-hidden">
            <div className="border-b border-[hsl(var(--border))] px-5 py-3 text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Reader-reported UIDs · refreshes every 10s</div>
            {uids.length ? uids.map(u => {
              const reader = readers.find(r => r.deviceId === u.readerDeviceId);
              return (
                <div key={`${u.uid}-${u.capturedAt}`} className="grid gap-2 border-b border-[hsl(var(--border)/.6)] px-5 py-3 last:border-0 md:grid-cols-[1.2fr_1.2fr_1fr_1fr_auto]" data-testid={`uid-row-${u.uid}`}>
                  <span className="select-all font-mono text-sm font-bold">{u.uid}<CopyUid uid={u.uid} /></span>
                  <span className="text-xs">{reader ? `${reader.name} (${reader.serialNumber})` : `Device ${u.readerDeviceId}`}</span>
                  <span className="text-xs">{date(u.capturedAt)}</span>
                   <span className="text-xs font-bold">{u.assigned ? `${u.studentId && ['active','locked'].includes(u.status?.toLowerCase()??'') ? 'Assigned' : 'Reserved'}${u.status ? ` · ${u.status}` : ''}${u.studentId ? ` · student #${u.studentId}` : ''}${u.schoolId ? ` · school #${u.schoolId}` : ''}` : 'Available · unknown / unassigned'}</span>
                  {!u.assigned ? <Button variant="outline" onClick={() => setAssign(u.uid)} testId={`button-assign-uid-${u.uid}`}>Assign to Student</Button> : <span />}
                </div>
              );
            }) : <p className="px-5 py-6 text-sm text-[hsl(var(--muted-foreground))]">Waiting for authenticated reader. Captured UIDs appear only when hardware reports them.</p>}
          </div>
        </>
      )}
      {assign && <AssignUidModal uid={assign} onClose={() => setAssign(null)} />}
      {unlink && <ReasonConfirm
        title={`Release ${unlink.name}`}
        warning="This releases the Owner reader context and revokes its credential immediately."
        confirmLabel="Release reader"
        onCancel={() => setUnlink(null)}
        onDone={() => setUnlink(null)}
        path={`/api/platform/devices/${unlink.deviceId}/owner-reader/unlink`}
      />}
    </section>
  );
}

/** Reason + explicit confirmation form used for owner-reader release. */
export function ReasonConfirm({ title, warning, confirmLabel, path, onCancel, onDone }: { title: string; warning: string; confirmLabel: string; path: string; onCancel: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [ok, setOk] = useState(false);
  const m = useMutation({
    mutationFn: () => customFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: reason.trim() }) }),
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: getListPlatformDevicesQueryKey() }), qc.invalidateQueries({ queryKey: uidInventoryKey })]);
      onDone();
    },
  });
  return (
    <form className="space-y-4" onSubmit={e => { e.preventDefault(); m.mutate(); }} aria-label={title}>
      <p className="text-sm">{warning}</p>
      <Field label="Reason (required, min 3 characters)"><textarea required minLength={3} value={reason} onChange={e => setReason(e.target.value)} data-testid="input-reason" /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="!w-auto" checked={ok} onChange={e => setOk(e.target.checked)} data-testid="checkbox-confirm" />I confirm this action.</label>
      {m.isError && <p role="alert" className={errText}>The request returned an error or may not have completed. Refresh the device list to check the current state before retrying.</p>}
      <div className="flex justify-end gap-3 border-t border-[hsl(var(--border))] pt-4">
        <Button variant="outline" type="button" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={m.isPending || !ok || reason.trim().length < 3}>{m.isPending ? 'Working…' : confirmLabel}</Button>
      </div>
    </form>
  );
}

export function BindOwnerReaderForm({ device, onCancel, onDone }: { device: { id: number; name: string }; onCancel: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [credential, setCredential] = useState<string | null>(null);
  const m = useMutation({
    mutationFn: () => customFetch<{ deviceId: number; purpose: string; credential: string }>(`/api/platform/devices/${device.id}/owner-reader`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: reason.trim() }) }),
    onSuccess: async r => {
      setCredential(r.credential);
      await Promise.all([qc.invalidateQueries({ queryKey: getListPlatformDevicesQueryKey() }), qc.invalidateQueries({ queryKey: uidInventoryKey })]);
    },
  });
  if (credential) return (
    <div className="space-y-3">
      <p className="text-sm font-bold">Owner reader credential — shown once</p>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">Copy it now and load it into the device firmware. It cannot be retrieved again and is not stored in this browser.</p>
      <input aria-label="One-time owner reader credential" readOnly className="font-mono text-xs" value={credential} onFocus={e => e.currentTarget.select()} />
      <div className="flex justify-end gap-3">
        <Button variant="outline" onClick={() => void navigator.clipboard?.writeText(credential)}>Copy</Button>
        <Button onClick={() => { setCredential(null); onDone(); }}>Done</Button>
      </div>
    </div>
  );
  return (
    <form className="space-y-4" onSubmit={e => { e.preventDefault(); m.mutate(); }}>
      <p className="text-sm">Bind <strong>{device.name}</strong> as your Owner UID reader. It will stop being available for school assignment and cannot submit attendance.</p>
      <Field label="Reason (required, min 3 characters)"><textarea required minLength={3} value={reason} onChange={e => setReason(e.target.value)} data-testid="input-reason" /></Field>
      {m.isError && <p role="alert" className={errText}>Could not bind this device. Only unassigned NFC or Hybrid devices qualify.</p>}
      <div className="flex justify-end gap-3 border-t border-[hsl(var(--border))] pt-4">
        <Button variant="outline" type="button" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={m.isPending || reason.trim().length < 3}>{m.isPending ? 'Binding…' : 'Bind as UID reader'}</Button>
      </div>
    </form>
  );
}

/** Unlink a school device via existing PATCH; credential handling is untouched. */
export function UnlinkSchoolDeviceForm({ device, onCancel, onDone }: { device: { id: number; name: string; schoolName?: string | null }; onCancel: () => void; onDone: () => void }) {
  const update = useUpdatePlatformDevice();
  const [reason, setReason] = useState('');
  const [ok, setOk] = useState(false);
  return (
    <form className="space-y-4" onSubmit={e => { e.preventDefault(); update.mutate({ deviceId: device.id, data: { schoolId: null, reason: reason.trim() } as any }, { onSuccess: onDone }); }}>
      <p className="text-sm">Unlink <strong>{device.name}</strong> from {device.schoolName ?? 'its school'} and return it to Unassigned. Its previous school credential stops working.</p>
      <Field label="Reason (required, min 3 characters)"><textarea required minLength={3} value={reason} onChange={e => setReason(e.target.value)} data-testid="input-reason" /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="!w-auto" checked={ok} onChange={e => setOk(e.target.checked)} data-testid="checkbox-confirm" />I confirm unlinking this device.</label>
      {update.isError && <p role="alert" className={errText}>Unlink failed. The device was not changed.</p>}
      <div className="flex justify-end gap-3 border-t border-[hsl(var(--border))] pt-4">
        <Button variant="outline" type="button" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={update.isPending || !ok || reason.trim().length < 3}>{update.isPending ? 'Unlinking…' : 'Unlink device'}</Button>
      </div>
    </form>
  );
}
